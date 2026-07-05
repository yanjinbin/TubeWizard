// ─── Isolated world bridge ────────────────────────────────────────────────────
// Runs in the extension's isolated world. Has access to chrome.* APIs but NOT
// to the page's JS objects (e.g. movie_player). It relays settings to the MAIN
// world script (inject.js) via CustomEvents, and handles feature 1 (single
// playback), which only needs DOM events that ARE shared across worlds.

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

// True only while this content script's extension context is still alive.
// After the extension is reloaded/updated, old content scripts linger in the
// page with a dead chrome.runtime — any chrome.* call then throws synchronously.
function extAlive() {
  return Boolean(chrome.runtime?.id);
}

// Safe wrapper: never let a dead-context error escape.
function safeSendMessage(message) {
  if (!extAlive()) return;
  try {
    chrome.runtime.sendMessage(message)?.catch?.(() => {});
  } catch {
    /* context invalidated — ignore */
  }
}

// Localized HUD labels — the MAIN world script can't call chrome.i18n, so we
// resolve them here (isolated world) and pass them along with the settings.
async function fetchMessages(lang) {
  try {
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const json = await (await fetch(url)).json();
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, v.message]));
  } catch {
    return null;
  }
}

async function hudLabels() {
  const { lang = "" } = await chrome.storage.sync.get("lang");
  const msgs = lang ? await fetchMessages(lang) : null;
  const m = (k) => msgs?.[k] ?? chrome.i18n.getMessage(k);
  return {
    ample: m("hudAmple"),
    healthy: m("hudHealthy"),
    ok: m("hudOk"),
    low: m("hudLow"),
    danger: m("hudDanger"),
  };
}

// Push settings down to the MAIN world script
async function broadcastSettings() {
  const detail = { ...settings, _hud: await hudLabels() };
  window.dispatchEvent(new CustomEvent("yte:settings", { detail }));
}

// Load stored settings, then announce to MAIN world
chrome.storage.sync.get(null, (stored) => {
  if (stored && Object.keys(stored).length > 0) settings = { ...settings, ...stored };
  broadcastSettings();
});

// Re-broadcast when the MAIN world script signals it's ready (it may load first)
window.addEventListener("yte:request-settings", broadcastSettings);

// Messages from background / popup
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "SETTINGS_UPDATE":
      settings = msg.settings;
      broadcastSettings();
      break;
    case "PAUSE":
      // Generation guard: a PAUSE carrying an older generation than the grant
      // this tab already holds is stale (it was addressed to a takeover that
      // this tab has since reversed) — ignore it instead of killing the
      // playback the user just started.
      if (typeof msg.gen === "number") {
        if (msg.gen <= lastAllowGen) break;
        extPauseGen = msg.gen;
      }
      pauseViaPlayerApi();
      break;
  }
});

// Pausing the raw <video> element desyncs YouTube's player state machine from
// the media element (player stays UNSTARTED while the element "plays" with no
// data, and the loader never restarts — infinite spinner). Route pauses through
// the MAIN world script so it can use the player API (pauseVideo) instead; it
// falls back to video.pause() only when the API isn't ready yet.
function pauseViaPlayerApi() {
  lastExtPauseTime = Date.now();
  window.dispatchEvent(new CustomEvent("yte:pause-video"));
}
function playViaPlayerApi() {
  window.dispatchEvent(new CustomEvent("yte:play-video"));
}

// ─── Feature 1: single playback ───────────────────────────────────────────────
// Track real user gestures so we can tell a user-initiated play (click / key)
// apart from YouTube autoplay (new tab, tab switch, navigation).
let lastGestureTime = 0;
["pointerdown", "keydown"].forEach((type) =>
  document.addEventListener(type, () => { lastGestureTime = Date.now(); }, true)
);

// Play-token generation bookkeeping (see PAUSE handler above).
let lastAllowGen = 0;      // generation of the newest grant this tab received
let extPauseGen = null;    // generation of the PAUSE we last honored

// Media-key / Global Media Controls plays carry no DOM gesture. Recognize them
// by exclusion: YouTube only starts playback on its own right after a page
// load / SPA navigation — a play in a tab that has already played, long after
// the last navigation, must come from the user.
let tabHasPlayed = false;
let lastNavTime = Date.now();
document.addEventListener("yt-navigate-finish", () => { lastNavTime = Date.now(); });
document.addEventListener("playing", (e) => {
  if (e.target.tagName === "VIDEO" && !isPreviewVideo(e.target)) tabHasPlayed = true;
}, true);

// Inline hover previews on browse pages (home / search / subscriptions) run in
// their own muted player (#inline-preview-player inside ytd-video-preview),
// separate from the real #movie_player. They are teasers, not playback: they
// must neither take the play token nor be paused — otherwise merely pointing
// the mouse at the video grid would silence the tab the user is listening to.
function isPreviewVideo(video) {
  return Boolean(video.closest("ytd-video-preview, #inline-preview-player"));
}

// …but YouTube ALSO fires gesture-less plays on its own in two moments: right
// when a hidden tab becomes visible (deferred autoplay on first view / resume
// on tab switch), and right after we paused it to deny a request (it retries).
// Those must NOT count as user-initiated, or merely switching to this tab
// would steal the play token and pause the tab the user was listening to.
let lastBecameVisible = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") lastBecameVisible = Date.now();
});
let lastExtPauseTime = 0; // stamped in pauseViaPlayerApi()

// DOM events cross the isolated/main world boundary, so this works here.
document.addEventListener("play", (e) => {
  if (e.target.tagName !== "VIDEO") return;
  if (isPreviewVideo(e.target)) return;
  if (!settings.singlePlayback) return;
  if (!extAlive()) return;

  const video = e.target;
  const now = Date.now();
  const mediaKeyResume =
    tabHasPlayed &&
    now - lastNavTime > 5000 &&
    now - lastBecameVisible > 1500 && // not YouTube's play-on-tab-switch
    now - lastExtPauseTime > 1500;    // not YouTube retrying after our deny
  const userInitiated = now - lastGestureTime < 1000 || mediaKeyResume;

  // Ask the background whether this tab owns playback. We do NOT pre-pause
  // here because the async roundtrip (service-worker wake + two storage reads)
  // takes 200-500 ms and causes the video to visibly stall at the start.
  // If the background denies the request we pause at that point instead.
  try {
    chrome.runtime.sendMessage({ type: "REQUEST_PLAY", userInitiated }, (resp) => {
      if (chrome.runtime.lastError) return; // context gone / no receiver
      const allowed = !resp || resp.allow !== false;
      if (!allowed) {
        pauseViaPlayerApi();
        return;
      }
      if (typeof resp?.gen === "number" && resp.gen > lastAllowGen) {
        lastAllowGen = resp.gen;
        // A stale PAUSE may have landed between our play and this grant
        // (message order isn't guaranteed) — undo it.
        if (extPauseGen !== null && extPauseGen < resp.gen && video.paused) {
          extPauseGen = null;
          playViaPlayerApi();
        }
      }
    });
  } catch {
    /* context invalidated — ignore */
  }
}, true);
