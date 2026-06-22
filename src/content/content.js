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

// Push settings down to the MAIN world script
function broadcastSettings() {
  window.dispatchEvent(new CustomEvent("yte:settings", { detail: settings }));
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

// Set when WE programmatically resume a video, so our own play() call doesn't
// recurse back into this handler.
let resuming = false;

// DOM events cross the isolated/main world boundary, so this works here.
document.addEventListener("play", (e) => {
  if (e.target.tagName !== "VIDEO") return;
  if (!settings.singlePlayback) return;
  if (resuming) { resuming = false; return; }
  if (!extAlive()) return;

  const video = e.target;
  const userInitiated = Date.now() - lastGestureTime < 1000;

  // Autoplay (tab switch, new tab, navigation): stop it instantly to avoid any
  // audible/visible flicker, then confirm with the background whether this tab
  // actually owns playback. Only resume if granted.
  if (!userInitiated) video.pause();

  try {
    chrome.runtime.sendMessage({ type: "REQUEST_PLAY", userInitiated }, (resp) => {
      if (chrome.runtime.lastError) return; // context gone / no receiver
      const allowed = !resp || resp.allow !== false;
      if (!allowed) {
        video.pause();
      } else if (!userInitiated && video.paused) {
        // We pre-paused an autoplay but this tab does own playback → resume.
        resuming = true;
        video.play().catch(() => { resuming = false; });
      }
    });
  } catch {
    /* context invalidated — ignore */
  }
}, true);
