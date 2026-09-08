# Pinpoint

Mark up a web page, hand the notes to a coding agent.

Drag a box or click an element, write what's wrong with it, repeat. One click
then puts a text file on your clipboard — each screenshot's path with its note
underneath — ready to paste into Claude Code or any agent that reads files.

Firefox and Chrome, Windows and macOS.

## Install

Needs [Node](https://nodejs.org) 18+.

```sh
npm install
npm run build          # -> dist/firefox, dist/chrome
npm run install-host   # lets Pinpoint write files and use the clipboard
```

Then load the extension:

- **Firefox** — `about:debugging` → This Firefox → Load Temporary Add-on →
  pick `dist/firefox/manifest.json`. Or `npm run dev` for a persistent dev
  profile with it already loaded.
- **Chrome** — `chrome://extensions` → Developer mode → Load unpacked →
  pick `dist/chrome`. `npm run dev:chrome` opens a separate dev profile on that
  page; Chrome ignores `--load-extension`, so the first load is still by hand.

The native host is optional. Without it Pinpoint still works, but saves through
the browser's Downloads folder and copies the notes as text rather than as a
file. `npm run uninstall-host` removes it.

## Use

| | |
|---|---|
| `Alt+Shift+P` | drag a region |
| `Alt+Shift+O` | click one element |
| `Ctrl+Enter` | save the note |
| `Esc` | finish |

Then **Copy bundle** in the popup, and paste. Settings (output folder, what
metadata to include, image format) live on the options page.

Pages built with Astro carry `data-astro-source-file`, so notes on those come
with the component and line number already attached.

## Develop

```sh
npm test               # native host, overlay, real-Chrome load, UI renders
npm run lint           # web-ext lint
npm run icons          # re-rasterise icons/icon.svg after editing it
```

`extension/` is shared source with no manifest; `manifests/` holds one per
browser and `scripts/build.mjs` combines them. The Chrome manifest carries a
committed public key purely to pin the extension id, because the native host
has to allowlist it in advance.

## License

MIT
