# VYNT for Google Meet

Your camera, a little digital nostalgia — now piped straight into your Google Meet call.

A **Manifest V3 Chrome/Chromium extension** that applies VYNT's eight Y2K camera filters to the
video Google Meet *transmits*, so every participant sees the filtered feed and your own Meet tile
shows the result live. A derivative of
[Yash-Tripath1/Vynt](https://github.com/Yash-Tripath1/Vynt) (MIT, © 2026 Anadi Tripathi); the
filter mathematics are a **verbatim, bit-identical port** of the original.

Everything is processed locally. No media ever leaves your device.

---

## The eight filters

`ORIGINAL` · `VYNTAGE` · `2007 DIGICAM` · `NIGHT FLASH` · `NEON CITY` · `FISHEYE` · `VHS TAPE` · `GOLDEN FILM`

Plus live **pixelation**, **grain**, **zoom**, an optional **mirror** toggle, a **date stamp** with a
configurable corner, and an **auto-quality** guard that keeps weak laptops smooth.

---

## Quick start (no build needed)

`dist/` is a complete, ready-to-load extension.

1. You need Chrome / Edge / Chromium **115 or newer**.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist/` folder.
4. Open [meet.google.com](https://meet.google.com) and join a call (the pre-join green-room already
   previews it, since it requests the camera). Your tile carries the filter.

Change filters mid-call from the toolbar icon — applies in ~200 ms, no rejoin. See `RUNBOOK.md`
for the full step-by-step, the on-Meat verification check, and troubleshooting.

### Rebuilding / testing

Dependency-free (no `npm install`), Node >= 16:

```bash
node build.js      # regenerate dist/ from src/
node --test tests/ # 42 unit tests, incl. bit-identical filter parity
```

---

## What's new in 0.2.1 — background tabs keep streaming

Switching away from Meet used to freeze your video for everyone else: the render loop was
clocked by `requestVideoFrameCallback`/`requestAnimationFrame`, which browsers stop firing
in hidden tabs, so the outgoing track simply stopped receiving frames. Fixed the way the
production WebRTC tooling does it:

- **The filter worker is now the clock.** Worker timers are exempt from hidden-tab
  throttling, so the worker posts `tick` messages; a tick only draws when the regular
  render chain has gone silent (≥2 frame periods), so foreground pacing is untouched.
- **Stall-proof frame grabbing.** Frames normally come from the hidden `<video>` element
  (which keeps advancing on Chromium); if an engine stalls it, `ImageCapture.grabFrame()`
  pulls straight from the camera track — visibility-independent — and the pipeline
  switches back the moment the element recovers.
- The popup status shows `· bg` when the worker clock is carrying the load, so you can see
  the fix working.

Verified headlessly (unit tests pin the tick-gating and stall policy); see
"Verification status" for how to confirm it on a real call.

## What's new in 0.2.0

- **Date stamp no longer hides behind the participant name.** Meet overlays the name on the
  *bottom-left* of every tile — exactly where upstream VYNT stamps the date. The stamp now
  defaults to **bottom-right**, and a **STAMP CORNER** control offers all four corners for the
  classic digicam look.
- **Auto quality.** A frame-rate guard nudges pixelation up (the single biggest cost lever) when
  the measured rate dips below ~22 fps, so a weak laptop degrades to "softer" rather than
  "stuttering". It only ever increases, never flaps back, and is opt-out via the **AUTO QUALITY**
  toggle. The popup shows `auto px<n>` when it has engaged. Decision rule is a pure, unit-tested
  function (`src/core/autoQuality.js`).

---

## How it works

```
            MAIN world (Meet's own JS context)          ISOLATED world        extension
            ─────────────────────────────────────────   ───────────────────   ──────────
Meet ──calls──► navigator.mediaDevices.getUserMedia ◄─┐
                            │ (patched)                 │ inject/hook.js      content/bridge.js   popup
                            ▼                           │  ▲      ▲           │  ▲   │            │
                     real camera track ──► pipeline ────┘  │      │           │  │   └─ chrome.storage.sync
                            │                     ▲        │      └─postMessage(handshake/settings)
                            ▼                     │        └─postMessage(telemetry fps/filter/auto)
                     filtered track ──► Meet      │
                                                  └─ worker (OffscreenCanvas) or main-thread fallback
```

1. **`content/bridge.js`** (ISOLATED) reads `chrome.storage.sync` and relays settings + the worker
   URL into the page via a token-tagged `postMessage`.
2. **`inject/hook.js`** (MAIN, `document_start`) shadows `getUserMedia` before Meet's bundle loads.
   When Meet asks for video, the real camera runs through the filter pipeline and Meet receives a
   `canvas.captureStream()` track instead. **Audio passes through untouched.**
3. The pixel loop runs in a **Worker against an `OffscreenCanvas`** so it never blocks Meet's own
   JS, falling back to the main thread if a worker can't start. The same worker is the
   pipeline's **clock**: hidden tabs kill `requestVideoFrameCallback`/rAF, but not worker
   timers, so worker ticks keep `requestFrame()` firing and your video keeps moving while you
   are on another tab.

### Trust model, stated plainly

The MAIN-world hook shares its world with the page, so a hostile page could read telemetry or forge
settings — the ceiling is cosmetic (change your filter, read your fps). It cannot reach extension
storage, message the extension, or touch the camera beyond what it could already do. Every crossing
goes through `normalizeSettings()`.

### Two transmission-correct defaults

- **Unmirrored.** Upstream mirrors its preview; Meet mirrors your self-view itself and sends
  unmirrored video. Pre-mirroring would show everyone a mirrored you, so the Meet path defaults to
  `mirror: false` (toggleable).
- **Bottom-right stamp.** See "What's new" above.

---

## Performance

Benchmarked on a 2-core VM at Meet's resolution (grain 34): seven of eight filters land at
**70–100 fps**; `FISHEYE` was the outlier at 20 fps because it recomputed `pow/atan2/cos/sin` per
pixel per frame. Here that frame-invariant remap is **precomputed into a lookup table**
(`src/core/fisheyeLut.js`), proven bit-identical by `tests/filters.test.js` and ~4× faster.
`VYNTAGE` at the default pixelation sits comfortably inside a 30 fps budget, and auto quality
catches the rest.

---

## Verification status — read this

**Verified headless (42 tests):** bit-identical filter parity incl. the fisheye LUT; timestamp
corner geometry for all four corners; renderer fast path = one blit, no working canvas; hostile
settings coerce to safe defaults; bundles are self-contained IIFEs; auto-quality decision rule;
background-tab pump gating and element-stall policy.

**Verified on real hardware by the maintainer:** the MAIN-world hook installs on live Meet
(`navigator.mediaDevices.getUserMedia.__vyntPatched === true`), and a call carries the filter.

**Needs a two-party check:** the background-tab fix — switch away from Meet mid-call and confirm
on a second account (or a friend) that your tile keeps moving. The popup shows `· bg` when the
worker clock is carrying the load.

**Not verifiable headless:** Meet's exact CSP interplay on every Chrome channel, and long-call
behaviour across hardware. If a future Chrome blocks the MAIN-world file, the self-contained IIFE
keeps the nonce-relay / `executeScript` fallbacks available (~half-day change, not a redesign).

---

## Distributing it — making it a "real" extension

Three realistic paths, in order of reach.

### A. Chrome Web Store (recommended — how strangers install it in one click)

1. **Create a developer account.** One-time **$5** fee at the
   [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole). This is Google's
   requirement, not ours.
2. **Prepare the package.** Zip the **contents of `dist/`** (the folder's files at the zip root,
   with `manifest.json` at the top level). No source maps or `src/` needed.
3. **Write the store listing.** Name, summary, description, category (Productivity / Fun), the
   `icons/` artwork, and at least one screenshot of a filtered Meet tile.
4. **Fill the privacy practices.** This project is local-only: declare that it handles camera
   video, that processing is on-device, and that **nothing is transmitted or stored remotely**.
   That story is short and true — lean on it.
5. **Submit for review.** Review checks permission justification and single purpose. Our surface
   is deliberately minimal (one host pattern `https://meet.google.com/*` + `storage`), which is
   exactly what makes this reviewable. Expect a permission-justification question about the
   MAIN-world injection; answer: it is the only way to substitute the camera feed Meet transmits.
6. Once approved, anyone installs from the store with one click and automatic updates.

### B. Microsoft Edge Add-ons (broadens reach, same code)

Edge is Chromium and accepts the same MV3 package via
[Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge). You can reuse
the Chrome Web Store listing and the same `dist/` zip. Many camera-effect extensions ship to both.

### C. Sideloading / GitHub Releases (no store, for your own users)

1. Tag a release and attach `vynt-meet.zip` (or a `dist.zip`).
2. Users: download, unzip, `chrome://extensions` → Developer mode → **Load unpacked** → `dist/`.
3. Document that sideloaded extensions show a "developer mode" notice and won't auto-update — fine
   for a community release, not for strangers.

### Why not GitHub Pages or a direct `.crx`?

Chrome refuses to install `.crx` files hosted on ordinary websites and can't install an extension
from a web page at all — the store (or developer-mode sideloading) is the only install path. A
GitHub Pages site is great for docs and the harness, but it cannot distribute the extension itself.

---

## Project layout

```
manifest.json               MV3 manifest (one host pattern + storage)
build.js                    dependency-free bundler (IIFE wrap + import/export strip)
src/core/                   filters / fisheye LUT / layout / settings / autoQuality / renderer
src/pipeline/               captureStreamSource — the virtual-camera core
src/inject/hook.js          MAIN-world getUserMedia patch
src/content/bridge.entry.js ISOLATED relay (chrome.storage <-> postMessage)
src/background.js           storage defaults + toolbar badge
src/popup/                  toolbar popup (filters, sliders, stamp corner, auto quality, live status)
src/worker/filter.worker.js OffscreenCanvas pixel loop
harness/meet-like.html      synthetic-camera demo page
tests/                      node:test suite (35 tests) + upstream fixture
.github/workflows/ci.yml    build + test on every push
dist/                       build output = the loadable extension
```

## License

MIT. Filter mathematics © 2026 Anadi Tripathi, ported verbatim from
[Yash-Tripath1/Vynt](https://github.com/Yash-Tripath1/Vynt). See `LICENSE`.
