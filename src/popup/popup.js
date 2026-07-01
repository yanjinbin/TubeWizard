const FIELDS = ["singlePlayback", "disablePip", "theaterMode", "bufferHud", "autoplay", "hideContinueWatching", "autoQuality", "preferredQuality", "preferredFps", "autoQualityFallback"];

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

function el(id) {
  return document.getElementById(id);
}

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    for (const key of FIELDS) {
      const input = el(key);
      if (!input) continue;
      if (input.type === "checkbox") {
        input.checked = settings[key];
      } else {
        input.value = settings[key];
      }
    }
    updateQualityOptionsVisibility(settings.autoQuality);
  });
}

function saveSettings() {
  const settings = {};
  for (const key of FIELDS) {
    const input = el(key);
    if (!input) continue;
    settings[key] = input.type === "checkbox" ? input.checked : input.value;
  }
  settings.preferredFps = Number(settings.preferredFps);
  chrome.storage.sync.set(settings);
}

function updateQualityOptionsVisibility(enabled) {
  el("qualityOptions").classList.toggle("disabled", !enabled);
}


async function fetchMessages(lang) {
  try {
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const json = await (await fetch(url)).json();
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, v.message]));
  } catch {
    return null;
  }
}

const RTL_LANGS = new Set(["ar", "fa"]);

async function applyI18n() {
  const { lang = "" } = await chrome.storage.sync.get("lang");
  const messages = lang ? await fetchMessages(lang) : null;
  const resolvedLang = lang || chrome.i18n.getUILanguage();
  document.documentElement.lang = resolvedLang;
  document.documentElement.dir = RTL_LANGS.has(resolvedLang.split("-")[0]) ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    const msg = messages?.[key] ?? chrome.i18n.getMessage(key);
    if (msg) node.textContent = msg;
  });
  const sel = el("langSelect");
  if (sel) sel.value = lang;
}

document.addEventListener("DOMContentLoaded", async () => {
  await applyI18n();
  loadSettings();

  const { version } = chrome.runtime.getManifest();
  el("footer-version").textContent = `v${version}`;

  for (const key of FIELDS) {
    const input = el(key);
    if (!input) continue;
    input.addEventListener("change", () => {
      saveSettings();
      if (key === "autoQuality") updateQualityOptionsVisibility(input.checked);
    });
  }

  el("langSelect").addEventListener("change", async (e) => {
    await chrome.storage.sync.set({ lang: e.target.value });
    await applyI18n();
    // Notify all YouTube tabs to refresh HUD labels
    const settings = await new Promise((r) => chrome.storage.sync.get(null, r));
    const tabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
    tabs.forEach((tab) =>
      chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATE", settings }).catch(() => {})
    );
  });
});
