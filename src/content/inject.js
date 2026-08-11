// ─── MAIN world script ────────────────────────────────────────────────────────
// Runs in the page's JavaScript context, so it CAN call YouTube's player API
// (movie_player.getAvailableQualityLevels / setPlaybackQuality / ...) and patch
// HTMLVideoElement.prototype in the world where YouTube actually invokes it.
// Settings arrive from the isolated content script via CustomEvents.

(() => {
  const QUALITY_ORDER = [
    "hd4320", "hd2160", "hd1440", "hd1080p", "hd1080", "hd720", "large", "medium", "small", "tiny",
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
    hideContinueWatching: false,
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
    applyContinueWatchingStyle();
  });

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

  function applyQuality(player, forceStepDown) {
    if (!settings.autoQuality) return;
    const available = player.getAvailableQualityLevels?.();
    if (!available?.length) return;

    const target = pickBestQuality(available);
    if (!target) return;

    if (!qualityRelaxed) {
      // Pin min = max to hold the preferred quality.
      player.setPlaybackQualityRange?.(target, target);
      player.setPlaybackQuality?.(target);
      return;
    }

    // Relaxed by the stall watchdog: free the minimum so ABR can step down to
    // keep playback alive on a weak connection. Never re-pin the preferred
    // quality — that would undo the relaxation and re-stall the video.
    player.setPlaybackQualityRange?.(lowestQuality(available), target);
    if (forceStepDown) {
      // Nudge the live stream one notch below the preferred level so the
      // rescue re-fetch doesn't restart at the heavy rendition.
      const step = stepDownQuality(available, target) ?? lowestQuality(available);
      player.setPlaybackQuality?.(step);
    }
  }

  // Next-lower level below the preferred target. YouTube lists `available`
  // high→low, so the direct successor is exactly one notch down.
  function stepDownQuality(available, target) {
    const idx = available.indexOf(target);
    return idx !== -1 && idx < available.length - 1 ? available[idx + 1] : null;
  }

  function lowestQuality(available) {
    for (let i = QUALITY_ORDER.length - 1; i >= 0; i--) {
      if (available.includes(QUALITY_ORDER[i])) return QUALITY_ORDER[i];
    }
    return available[available.length - 1];
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
  let speedObserverStarted = false;
  let hudEl = null, hudBuf = null, hudSpd = null, hudTimer = null;

  // Rolling log of {t, bytes} for videoplayback fetches (fallback estimate).
  const WINDOW_MS = 5000;
  const byteLog = [];

  // Zero extra I/O: record bytes downloaded per videoplayback request, timestamped
  // by wall-clock arrival, so we can average throughput over a real time window.
  // The same arrivals feed `lastDataAt`, the stall watchdog's ground truth for
  // "the connection is alive" — chunks can arrive seconds apart on a slow link
  // even though the buffer is growing, and that must not look like a stall.
  function startSpeedObserver() {
    if (speedObserverStarted) return;
    speedObserverStarted = true;
    try {
      new PerformanceObserver((list) => {
        const now = performance.now();
        for (const e of list.getEntries()) {
          if (!/videoplayback/.test(e.name)) continue;
          const bytes = e.transferSize || e.encodedBodySize || 0;
          if (bytes > 0) {
            byteLog.push({ t: now, bytes });
            lastDataAt = Math.max(lastDataAt, now);
          }
        }
      }).observe({ type: "resource", buffered: true });
    } catch { /* PerformanceObserver unsupported */ }
  }

  // Preferred: YouTube's own connection-bandwidth estimate (matches the
  // "Connection Speed" line in Stats for nerds). Returns bits/sec or null.
  function getYtBandwidthBps() {
    const player = getPlayer();
    const stats = player?.getStatsForNerds?.();
    if (!stats) return null;
    // Across player versions the field has been bandwidth_kbps / bandwidthKbps,
    // value like "25261.624" (kbps) — sometimes with thousands separators/units.
    const raw = stats.bandwidth_kbps ?? stats.bandwidthKbps ?? stats.bandwidth;
    if (raw == null) return null;
    const kbps = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
    return kbps > 0 ? kbps * 1000 : null;
  }

  // Fallback: average throughput over the last WINDOW_MS of real time.
  function getWindowBps() {
    const cutoff = performance.now() - WINDOW_MS;
    let bytes = 0;
    while (byteLog.length && byteLog[0].t < cutoff) byteLog.shift();
    for (const e of byteLog) bytes += e.bytes;
    if (bytes === 0) return 0;
    return (bytes * 8) / (WINDOW_MS / 1000);
  }

  // Speed shown by the HUD: YouTube's estimate when available, else the window avg.
  function currentSpeedBps() {
    return getYtBandwidthBps() ?? getWindowBps();
  }

  // Labels are injected from the isolated world (chrome.i18n); fall back to en.
  const HUD_FALLBACK = {
    ample: "Buffer ample", healthy: "Buffer healthy", ok: "Buffer ok",
    low: "Buffer low", danger: "Buffer critical",
  };
  function describeBuf(buf) {
    const L = settings._hud || HUD_FALLBACK;
    if (buf >= 30) return { txt: `${L.ample} ${buf.toFixed(0)}s`, color: "#7CFC9B" };
    if (buf >= 15) return { txt: `${L.healthy} ${buf.toFixed(0)}s`, color: "#9CE37D" };
    if (buf >= 8)  return { txt: `${L.ok} ${buf.toFixed(0)}s`, color: "#FFD93D" };
    if (buf >= 4)  return { txt: `${L.low} ${buf.toFixed(1)}s`, color: "#FFA64D" };
    return { txt: `${L.danger} ${buf.toFixed(1)}s`, color: "#ff6b6b" };
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
    hudSpd.textContent = fmtBps(currentSpeedBps());
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


  // ─── Hide "Continue Watching" miniplayer popup ─────────────────────────────
  function applyContinueWatchingStyle() {
    let style = document.getElementById("yte-cwp-style");
    if (settings.hideContinueWatching) {
      if (!style) {
        style = document.createElement("style");
        style.id = "yte-cwp-style";
        document.documentElement.appendChild(style);
      }
      style.textContent = `ytd-miniplayer { display: none !important; }`;
    } else if (style) {
      style.remove();
    }
  }

  // ─── Pause bridge ──────────────────────────────────────────────────────────
  // The isolated content script asks us to pause. Pausing the raw <video>
  // desyncs YouTube's state machine (player stuck UNSTARTED, loader never
  // restarts), so prefer the player API and fall back only if it isn't ready.
  window.addEventListener("yte:pause-video", () => {
    const player = getPlayer();
    if (player?.pauseVideo) {
      player.pauseVideo();
    } else {
      document.querySelector("video")?.pause();
    }
  });

  // Resume after a stale PAUSE was honored by mistake (generation race).
  window.addEventListener("yte:play-video", () => {
    const player = getPlayer();
    if (player?.playVideo) {
      player.playVideo();
    } else {
      document.querySelector("video")?.play().catch(() => {});
    }
  });

  // ─── Stall watchdog ────────────────────────────────────────────────────────
  // Resuming a long-paused tab must re-establish media connections; behind a
  // proxy that drops idle connections the fetch can hang forever (spinner,
  // empty buffer). When playback is genuinely stuck — no media bytes arriving
  // AND no buffer growth — relax the quality pin so ABR can step down, and
  // re-seek in place to abort dead requests and re-fetch.
  //
  // Slow-but-alive connections must NOT trigger a rescue: on a throttled link
  // chunks arrive seconds apart, so buffered.end() can stand still for a while
  // even though data is flowing. The byte-arrival log is the ground truth —
  // recent bytes mean the connection is healthy, no matter how slowly.
  const STALL_MS = 8000;
  let qualityRelaxed = false;
  let stallSince = 0;
  let lastBufferedEnd = -1;
  let lastDataAt = 0; // performance.now() of the last videoplayback bytes seen
  let rescuedAt = 0;

  setInterval(() => {
    const video =
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video");
    const player = getPlayer();
    if (!video || !player || video.paused || video.readyState >= 3) {
      stallSince = 0;
      return;
    }

    const now = performance.now();

    // Data is still arriving (even slowly) → not a stall, leave the buffer
    // alone and let YouTube's own ABR deal with the slow connection.
    if (now - lastDataAt < STALL_MS) {
      stallSince = 0;
      return;
    }

    // Playing-intent but not enough data. Stall only counts while the buffer
    // makes no progress either.
    let bufferedEnd = -1;
    try {
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime + 0.1) {
          bufferedEnd = Math.max(bufferedEnd, video.buffered.end(i));
        }
      }
    } catch { /* mid-seek */ }

    if (bufferedEnd > lastBufferedEnd) {
      lastBufferedEnd = bufferedEnd;
      stallSince = 0;
      return;
    }

    if (!stallSince) { stallSince = now; return; }
    if (now - stallSince < STALL_MS) return;
    if (now - rescuedAt < STALL_MS * 2) return; // one rescue per window

    // Capture the resume position before changing quality. YouTube may rebuild
    // the media source synchronously inside applyQuality(), during which the
    // raw video's currentTime can briefly fall back to 0. Reading it afterward
    // would turn this in-place recovery into seekTo(0) and restart the video.
    const resumeTime = video.currentTime;
    if (!Number.isFinite(resumeTime) || resumeTime < 0) return;

    rescuedAt = now;
    stallSince = 0;
    lastBufferedEnd = -1; // the rescue clears the buffer — track it afresh
    if (!qualityRelaxed) {
      qualityRelaxed = true;
      applyQuality(player, true);
    }
    // Re-seek to the same spot: aborts hung media requests and restarts them.
    player.seekTo?.(resumeTime, true);

    // YouTube tears down and rebuilds its media pipeline asynchronously after
    // a quality change; the synchronous seek above can land in the dying
    // pipeline and be dropped, leaving the player to restart from 0. Verify
    // the position a moment later and re-assert it — but only if it fell
    // BACKWARD (the reset case), never undo forward progress.
    (async () => {
      const v =
        document.querySelector("video.html5-main-video") ||
        document.querySelector("video");
      const p = getPlayer();
      if (!v || !p) return;
      await new Promise((r) => setTimeout(r, 500));
      if (!v.isConnected || v.currentTime >= resumeTime - 2) return;
      p.seekTo?.(resumeTime, true);
      await new Promise((r) => setTimeout(r, 250));
      if (v.isConnected && v.currentTime < resumeTime - 2) {
        // Last resort on the raw element; YouTube's player syncs to element
        // seeks via its own seeking listener.
        try { v.currentTime = resumeTime; } catch { /* mid-seek */ }
      }
    })();
  }, 1000);

  // ─── SPA navigation ────────────────────────────────────────────────────────
  document.addEventListener("yt-navigate-finish", () => {
    qualityRelaxed = false; // fresh video → try the preferred pin again
    stallSince = 0;
    lastBufferedEnd = -1;
    scheduleQuality();
    scheduleTheater();
    scheduleHud();
    scheduleAutoplayBlock();
  });

  // Always-on (idempotent): the stall watchdog needs the byte-arrival log to
  // tell a slow connection from a dead one, independent of the HUD setting.
  startSpeedObserver();

  // All state above is now initialized — safe to ask the isolated script for the
  // current settings (it replies synchronously via a "yte:settings" event, which
  // would hit the temporal dead zone if dispatched before the declarations).
  window.dispatchEvent(new CustomEvent("yte:request-settings"));
})();
