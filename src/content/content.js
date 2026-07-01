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
      document.querySelector("video")?.pause();
      break;
  }
});

// ─── Feature 1: single playback ───────────────────────────────────────────────
// Track real user gestures so we can tell a user-initiated play (click / key)
// apart from YouTube autoplay (new tab, tab switch, navigation).
let lastGestureTime = 0;
["pointerdown", "keydown"].forEach((type) =>
  document.addEventListener(type, () => { lastGestureTime = Date.now(); }, true)
);

// DOM events cross the isolated/main world boundary, so this works here.
document.addEventListener("play", (e) => {
  if (e.target.tagName !== "VIDEO") return;
  if (!settings.singlePlayback) return;
  if (!extAlive()) return;

  const video = e.target;
  const userInitiated = Date.now() - lastGestureTime < 1000;

  // Ask the background whether this tab owns playback. We do NOT pre-pause
  // here because the async roundtrip (service-worker wake + two storage reads)
  // takes 200-500 ms and causes the video to visibly stall at the start.
  // If the background denies the request we pause at that point instead.
  try {
    chrome.runtime.sendMessage({ type: "REQUEST_PLAY", userInitiated }, (resp) => {
      if (chrome.runtime.lastError) return; // context gone / no receiver
      const allowed = !resp || resp.allow !== false;
      if (!allowed) {
        video.pause();
      }
    });
  } catch {
    /* context invalidated — ignore */
  }
}, true);
