const DEFAULT_SETTINGS = {
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

async function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULT_SETTINGS, resolve));
}

// ─── Single playback: one "play token" across all YouTube tabs ────────────────
// playingTabId holds the tab currently allowed to play. A tab may play only if:
//   • it already holds the token (same tab — e.g. in-tab navigation), or
//   • no tab holds the token (first video / previous holder gone), or
//   • the play was user-initiated (a real click/keypress) → it takes the token
//     over and the previous holder is paused.
// Autoplay in any other tab (new background tab, switched-to tab) is denied.
let playingTabId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "REQUEST_PLAY") {
    handleRequestPlay(msg, sender).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
});

async function handleRequestPlay(msg, sender) {
  const settings = await getSettings();
  if (!settings.singlePlayback) return { allow: true };

  const tabId = sender.tab?.id;
  if (!tabId) return { allow: true };

  // Drop a stale token if its tab no longer exists.
  if (playingTabId !== null && playingTabId !== tabId && !(await tabExists(playingTabId))) {
    playingTabId = null;
  }

  // Already the player → keep playing.
  if (playingTabId === tabId) return { allow: true };

  // No current player → this tab becomes it.
  if (playingTabId === null) {
    playingTabId = tabId;
    return { allow: true };
  }

  // A different tab holds the token. Only a real user action may take over.
  if (msg.userInitiated) {
    const previous = playingTabId;
    playingTabId = tabId;
    chrome.tabs.sendMessage(previous, { type: "PAUSE" }).catch(() => {});
    return { allow: true };
  }

  // Autoplay while another tab owns playback → deny.
  return { allow: false };
}

async function tabExists(id) {
  try {
    await chrome.tabs.get(id);
    return true;
  } catch {
    return false;
  }
}

chrome.tabs.onRemoved.addListener((id) => {
  if (playingTabId === id) playingTabId = null;
});

// ─── Push settings to tabs on load / settings change ─────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const settings = await getSettings();
  chrome.tabs.sendMessage(tabId, { type: "SETTINGS_UPDATE", settings }).catch(() => {});
});

chrome.storage.onChanged.addListener(async () => {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATE", settings }).catch(() => {});
  }
});
