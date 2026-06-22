<div align="center">

<img src="store-assets/icon.png" width="120" alt="TubeWizard logo" />

# TubeWizard

**Power-ups for YouTube — single playback, auto HD/FPS, and more.**

`All local` · `zero data collection` · `no account needed`

</div>

---

<table>
  <tr>
    <td width="65%" valign="top">
      <img src="store-assets/screenshot.png" alt="TubeWizard on a YouTube watch page" width="100%" />
      <p align="center"><sub>Auto HD + Buffer / Speed HUD on a watch page</sub></p>
    </td>
    <td width="35%" valign="top">
      <img src="store-assets/options.png" alt="TubeWizard options panel" width="100%" />
      <p align="center"><sub>One-click settings popup</sub></p>
    </td>
  </tr>
</table>

## Features

- **Single Playback** — Only one YouTube video plays across all your tabs. A
  video takes over only when you actively click play; opening videos in
  background tabs won't interrupt what you're watching, and switching to a
  non-YouTube tab keeps your current video going.
- **Auto HD + FPS** — Automatically set your preferred resolution (up to 4K/2160p)
  and frame rate on every video, with optional fallback to the next best quality.
- **Disable Picture-in-Picture** — Block the PiP button and the PiP API.
- **Theater Mode** — Always start videos in the wide theater layout.
- **Autoplay control** — Mirror YouTube's "autoplay next" toggle to your preference.
- **Buffer + Speed HUD** — Optional live buffer health and download speed in the
  player control bar, with zero extra network usage.

## Install (development)

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

## Project structure

```
manifest.json              Manifest V3 config
src/background/            Service worker — single-playback coordination
src/content/content.js     Isolated-world bridge (chrome.* APIs)
src/content/inject.js      Main-world script (player API, quality, PiP, HUD)
src/popup/                 Settings popup
icons/                     Extension icons
docs/privacy.html          Privacy policy (GitHub Pages)
```

## Privacy

TubeWizard collects nothing. See the [Privacy Policy](https://yanjinbin.github.io/TubeWizard/privacy.html).

## License

MIT

---

_TubeWizard is an independent extension and is not affiliated with, endorsed by,
or sponsored by YouTube or Google LLC._
