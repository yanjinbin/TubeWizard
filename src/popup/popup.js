const FIELDS = ["singlePlayback", "disablePip", "theaterMode", "bufferHud", "autoplay", "autoQuality", "preferredQuality", "preferredFps", "autoQualityFallback"];

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
  // Coerce fps to number
  settings.preferredFps = Number(settings.preferredFps);
  chrome.storage.sync.set(settings);
}

function updateQualityOptionsVisibility(enabled) {
  el("qualityOptions").classList.toggle("disabled", !enabled);
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();

  for (const key of FIELDS) {
    const input = el(key);
    if (!input) continue;
    input.addEventListener("change", () => {
      saveSettings();
      if (key === "autoQuality") {
        updateQualityOptionsVisibility(input.checked);
      }
    });
  }
});
