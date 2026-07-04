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
// playingTabId holds the tab currently allowed to play; playGen is a monotonic
// generation that increments on every ownership change, so content scripts can
// discard PAUSE messages that raced with (and lost to) a newer grant. Persisted
// in chrome.storage.session so both survive MV3 service-worker sleep/wake
// cycles (in-memory variables reset every time the worker goes idle).
async function getPlayState() {
  const { playingTabId = null, playGen = 0 } =
    await chrome.storage.session.get(["playingTabId", "playGen"]);
  return { playingTabId, playGen };
}
async function setPlayState(playingTabId, playGen) {
  await chrome.storage.session.set({ playingTabId, playGen });
}

// Serialize REQUEST_PLAY handling: two interleaved handlers could otherwise
// read the same generation and both write gen+1, breaking monotonicity.
let requestPlayQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "REQUEST_PLAY") {
    // The queue must never end up rejected, or every later request would skip
    // its handler — so each link catches all of its own errors.
    requestPlayQueue = requestPlayQueue.then(async () => {
      try {
        sendResponse(await handleRequestPlay(msg, sender));
      } catch {
        try { sendResponse({ allow: true }); } catch { /* channel closed */ }
      }
    });
    return true; // keep the message channel open for the async response
  }
});

async function handleRequestPlay(msg, sender) {
  const settings = await getSettings();
  if (!settings.singlePlayback) return { allow: true };

  const tabId = sender.tab?.id;
  if (!tabId) return { allow: true };

  let { playingTabId, playGen } = await getPlayState();

  // Drop a stale token if its tab no longer exists.
  if (playingTabId !== null && playingTabId !== tabId && !(await tabExists(playingTabId))) {
    playingTabId = null;
  }

  // Already the player → keep playing.
  if (playingTabId === tabId) return { allow: true, gen: playGen };

  // No current player → this tab becomes it.
  if (playingTabId === null) {
    await setPlayState(tabId, playGen + 1);
    return { allow: true, gen: playGen + 1 };
  }

  // A different tab holds the token. Only a real user action may take over.
  if (msg.userInitiated) {
    const previous = playingTabId;
    await setPlayState(tabId, playGen + 1);
    chrome.tabs.sendMessage(previous, { type: "PAUSE", gen: playGen + 1 }).catch(() => {});
    return { allow: true, gen: playGen + 1 };
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
  const { playingTabId, playGen } = await getPlayState();
  if (playingTabId === id) await setPlayState(null, playGen);
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
