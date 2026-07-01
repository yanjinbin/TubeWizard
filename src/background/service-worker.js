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
  hideContinueWatching: false,
};

async function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULT_SETTINGS, resolve));
}

// ─── Single playback: one "play token" across all YouTube tabs ────────────────
// playingTabId holds the tab currently allowed to play. Persisted in
// chrome.storage.session so it survives MV3 service-worker sleep/wake cycles
// (in-memory variables reset every time the worker goes idle).
async function getPlayingTabId() {
  const { playingTabId = null } = await chrome.storage.session.get("playingTabId");
  return playingTabId;
}
async function setPlayingTabId(id) {
  await chrome.storage.session.set({ playingTabId: id });
}

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

  let playingTabId = await getPlayingTabId();

  // Drop a stale token if its tab no longer exists.
  if (playingTabId !== null && playingTabId !== tabId && !(await tabExists(playingTabId))) {
    playingTabId = null;
  }

  // Already the player → keep playing.
  if (playingTabId === tabId) return { allow: true };

  // No current player → this tab becomes it.
  if (playingTabId === null) {
    await setPlayingTabId(tabId);
    return { allow: true };
  }

  // A different tab holds the token. Only a real user action may take over.
  if (msg.userInitiated) {
    const previous = playingTabId;
    await setPlayingTabId(tabId);
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

chrome.tabs.onRemoved.addListener(async (id) => {
  const playingTabId = await getPlayingTabId();
  if (playingTabId === id) await setPlayingTabId(null);
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
