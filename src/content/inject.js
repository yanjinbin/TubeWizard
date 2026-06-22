// ─── MAIN world script ────────────────────────────────────────────────────────
// Runs in the page's JavaScript context, so it CAN call YouTube's player API
// (movie_player.getAvailableQualityLevels / setPlaybackQuality / ...) and patch
// HTMLVideoElement.prototype in the world where YouTube actually invokes it.
// Settings arrive from the isolated content script via CustomEvents.

(() => {
  const QUALITY_ORDER = [
    "hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny",
  ];

  let settings = {
    singlePlayback: true,
    disablePip: true,
    autoQuality: true,
    preferredQuality: "hd2160",
    preferredFps: 60,
    autoQualityFallback: true,
    theaterMode: false,
    bufferHud: false,
    autoplay: true,
  };

  let pipInstalled = false;

  // ─── Settings sync with isolated world ─────────────────────────────────────
  window.addEventListener("yte:settings", (e) => {
    settings = e.detail;
    installPipBlock();      // idempotent
    scheduleQuality();      // re-apply if autoQuality just got enabled
    scheduleTheater();      // re-apply theater preference
    scheduleHud();          // toggle buffer/speed HUD
    scheduleAutoplayBlock();// sync YouTube's "autoplay next" toggle
  });

  // We may load before the isolated script broadcasts; ask for current settings.
  window.dispatchEvent(new CustomEvent("yte:request-settings"));

  // ─── Feature 2: disable Picture-in-Picture ─────────────────────────────────
  function installPipBlock() {
    if (pipInstalled) return;
    pipInstalled = true;

    const orig = HTMLVideoElement.prototype.requestPictureInPicture;
    HTMLVideoElement.prototype.requestPictureInPicture = function () {
      if (settings.disablePip) {
        return Promise.reject(new DOMException("Disabled by TubeWizard", "NotAllowedError"));
      }
      return orig.call(this);
    };

    const applyAttr = () =>
      document.querySelectorAll("video").forEach((v) => {
        v.disablePictureInPicture = !!settings.disablePip;
      });
    applyAttr();
    new MutationObserver(applyAttr).observe(document.documentElement, {
      childList: true, subtree: true,
    });

    const style = document.createElement("style");
    style.id = "yte-pip-style";
    style.textContent = `.ytp-pip-button { display: none !important; }`;
    document.documentElement.appendChild(style);
  }

  // ─── Feature 3: Auto HD + FPS ──────────────────────────────────────────────
  function scheduleQuality() {
    if (!settings.autoQuality) return;
    waitForPlayer().then(attachQualityListener);
  }

  function waitForPlayer() {
    return new Promise((resolve) => {
      const existing = getPlayer();
      if (existing) return resolve(existing);
      const observer = new MutationObserver(() => {
        const player = getPlayer();
        if (player) { observer.disconnect(); resolve(player); }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function attachQualityListener(player) {
    const video = player.querySelector("video") ?? document.querySelector("video");
    if (!video) return;

    const apply = () => applyQuality(player);

    if (video.readyState >= 1 /* HAVE_METADATA */) {
      apply();
    } else {
      video.addEventListener("loadedmetadata", apply, { once: true });
    }
    // YouTube can reset quality once the buffer fills; re-apply on first canplay.
    video.addEventListener("canplay", apply, { once: true });
  }

  function applyQuality(player) {
    if (!settings.autoQuality) return;
    const available = player.getAvailableQualityLevels?.();
    if (!available?.length) return;

    const target = pickBestQuality(available);
    if (!target) return;

    player.setPlaybackQualityRange?.(target, target);
    player.setPlaybackQuality?.(target);
  }

  function getPlayer() {
    const el =
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player");
    if (!el || typeof el.getAvailableQualityLevels !== "function") return null;
    return el;
  }

  function pickBestQuality(available) {
    // `available` is already ordered high→low by YouTube. Match the user's
    // preferred resolution; the fps dimension can't be chosen via
    // setPlaybackQuality (YouTube auto-selects the highest fps for a label).
    const preferredIdx = QUALITY_ORDER.indexOf(settings.preferredQuality);
    if (preferredIdx === -1) return available[0] ?? null;

    // Exact match available → use it.
    if (available.includes(settings.preferredQuality)) {
      return settings.preferredQuality;
    }

    // No exact match. Without fallback, do nothing.
    if (!settings.autoQualityFallback) return null;

    // Fallback: pick the highest available quality that is NOT above the
    // preferred one (i.e. step down from preferred, never up).
    const stepDown = QUALITY_ORDER.slice(preferredIdx);
    return stepDown.find((q) => available.includes(q)) ?? null;
  }

  // ─── Theater (wide) mode ───────────────────────────────────────────────────
  function scheduleTheater() {
    if (!settings.theaterMode) return;
    waitForWatchFlexy().then(applyTheater);
  }

  function waitForWatchFlexy() {
    return new Promise((resolve) => {
      const existing = document.querySelector("ytd-watch-flexy");
      if (existing) return resolve(existing);
      const observer = new MutationObserver(() => {
        const el = document.querySelector("ytd-watch-flexy");
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function applyTheater(flexy) {
    if (!settings.theaterMode) return;
    // Already in theater mode → nothing to do.
    if (flexy.hasAttribute("theater")) return;
    // The size button toggles default ⇄ theater. Click it to switch.
    const btn = document.querySelector(".ytp-size-button");
    if (btn) btn.click();
  }

  // ─── Buffer + Speed HUD (embedded in the player control bar) ────────────────
  // Adapted from the "YouTube 缓冲 + 速度 HUD" userscript. Instead of a draggable
  // floating overlay, the readout is inserted into .ytp-right-controls so it sits
  // at the right side of the control bar, just after YouTube's own buttons.
  const HUD_DECAY = 0.55;
  let liveBps = 0;
  let speedObserverStarted = false;
  let hudEl = null, hudBuf = null, hudSpd = null, hudTimer = null;

  // Zero extra I/O: read bytes/duration straight from the browser's resource
  // timing entries for videoplayback requests.
  function startSpeedObserver() {
    if (speedObserverStarted) return;
    speedObserverStarted = true;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!/videoplayback/.test(e.name)) continue;
          const bytes = e.transferSize || e.encodedBodySize || 0;
          const dt = e.duration / 1000;
          if (bytes > 0 && dt > 0.02) {
            const b = (bytes * 8) / dt;
            liveBps = liveBps ? liveBps * HUD_DECAY + b * (1 - HUD_DECAY) : b;
          }
        }
      }).observe({ type: "resource", buffered: true });
    } catch { /* PerformanceObserver unsupported */ }
  }

  function describeBuf(buf) {
    if (buf >= 30) return { txt: `缓冲充足 ${buf.toFixed(0)}s`, color: "#7CFC9B" };
    if (buf >= 15) return { txt: `缓冲健康 ${buf.toFixed(0)}s`, color: "#9CE37D" };
    if (buf >= 8)  return { txt: `缓冲一般 ${buf.toFixed(0)}s`, color: "#FFD93D" };
    if (buf >= 4)  return { txt: `缓冲偏低 ${buf.toFixed(1)}s`, color: "#FFA64D" };
    return { txt: `缓冲危险 ${buf.toFixed(1)}s`, color: "#ff6b6b" };
  }
  const fmtBps = (b) => (!b ? "... Mbps" : `${(b / 1e6).toFixed(1)} Mbps`);

  function scheduleHud() {
    if (!settings.bufferHud) { removeHud(); return; }
    startSpeedObserver();
    if (!hudTimer) hudTimer = setInterval(hudTick, 1000);
    ensureHud();
    hudTick();
  }

  function ensureHud() {
    const rightControls = document.querySelector(".ytp-right-controls");
    if (!rightControls) return false;          // control bar not ready yet
    if (hudEl && hudEl.isConnected) return true;

    hudEl = document.createElement("div");
    hudEl.className = "yte-hud";
    hudEl.style.cssText = [
      "display:inline-flex", "align-items:center", "gap:8px", "height:100%",
      "padding:0 10px", "vertical-align:top", "white-space:nowrap",
      "font:600 12px/1 ui-monospace,Menlo,monospace",
      "text-shadow:0 0 3px #000,0 1px 2px #000",
    ].join(";");
    hudBuf = document.createElement("span");
    hudSpd = document.createElement("span");
    hudSpd.style.color = "#E0E0E0";
    hudEl.append(hudBuf, hudSpd);
    // Prepend → sits at the left edge of the right-side controls, right after
    // YouTube's left-side play/volume/time group.
    rightControls.insertBefore(hudEl, rightControls.firstChild);
    return true;
  }

  function removeHud() {
    if (hudEl) { hudEl.remove(); hudEl = null; }
    if (hudTimer) { clearInterval(hudTimer); hudTimer = null; }
  }

  function hudTick() {
    if (!settings.bufferHud) { removeHud(); return; }
    if (!ensureHud()) return;

    const v =
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video");
    if (!v) { hudEl.style.display = "none"; return; }
    hudEl.style.display = "inline-flex";

    let buf = 0;
    try {
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime + 0.1 &&
            v.currentTime <= v.buffered.end(i) + 0.1) {
          buf = v.buffered.end(i) - v.currentTime;
          break;
        }
      }
    } catch { /* buffered may throw mid-seek */ }

    const d = describeBuf(buf);
    hudBuf.textContent = d.txt;
    hudBuf.style.color = d.color;
    hudSpd.textContent = fmtBps(liveBps);
  }

  // ─── Autoplay toggle ───────────────────────────────────────────────────────
  // Mirror YouTube's native "autoplay next video" toggle to the user's setting.
  function scheduleAutoplayBlock() {
    waitForAutonavToggle().then((btn) => {
      if (!btn) return;
      const isOn = btn.getAttribute("aria-checked") === "true";
      // Click only when the current state doesn't match the desired one.
      if (isOn !== settings.autoplay) btn.click();
    });
  }

  function waitForAutonavToggle() {
    return new Promise((resolve) => {
      const sel = ".ytp-autonav-toggle-button";
      const existing = document.querySelector(sel);
      if (existing) return resolve(existing);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(sel);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // Don't wait forever — the toggle only exists on watch pages.
      setTimeout(() => { observer.disconnect(); resolve(null); }, 10000);
    });
  }

  // ─── SPA navigation ────────────────────────────────────────────────────────
  document.addEventListener("yt-navigate-finish", () => {
    userStartedThisPage = false;
    scheduleQuality();
    scheduleTheater();
    scheduleHud();
    scheduleAutoplayBlock();
  });
})();
