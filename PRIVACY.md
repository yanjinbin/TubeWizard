# Privacy Policy — TubeWizard

_Last updated: 2026-06-22_

TubeWizard ("the Extension") is committed to protecting your privacy.
This policy explains what data the Extension accesses and how it is used.

## Summary

**The Extension does not collect, store, transmit, or sell any personal data.**
It has no servers, no analytics, and no third-party tracking. Everything runs
locally in your browser.

## Data the Extension uses

| Data | Purpose | Where it stays |
|------|---------|----------------|
| Your feature settings (toggles, preferred quality/FPS) | To remember your preferences between sessions | Stored locally via `chrome.storage.sync`; synced only across your own signed-in Chrome profile by Google, never sent to us |
| Open YouTube tab information (tab IDs, URLs) | To coordinate single playback — pausing background YouTube tabs when you start a video | Held in memory only, never persisted or transmitted |

The Extension reads the buffered duration and the browser's existing network
timing for the currently playing video (for the optional Buffer + Speed HUD).
This information is displayed on screen only and is never recorded or sent
anywhere.

## Permissions explained

- **`tabs`** — Required to detect other open YouTube tabs and pause them so only
  one video plays at a time. The Extension only ever inspects YouTube tabs.
- **`storage`** — Required to save your settings locally.
- **Host access to `*.youtube.com`** — Required to run the feature scripts on
  YouTube pages. The Extension runs on no other websites.

## Data sharing

We do **not** share any data with third parties, because we do not collect any.

## Changes to this policy

If this policy changes, the updated version will be published at this URL with a
new "Last updated" date.

## Contact

Questions? Open an issue at the project repository or contact the developer
listed on the Chrome Web Store listing.
