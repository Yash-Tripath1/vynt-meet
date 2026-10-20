# VYNT for Google Meet — Runbook

Everything you need to go from "I have the repo" to "it's filtering my Meet call", plus what to
do when something isn't right. Read top to bottom the first time; after that it's a reference.

---

## Phase 0 — Prerequisites

- **Browser:** Chrome, Edge, or any Chromium at version **115 or newer**. (Check
  `chrome://settings/help`.) Firefox/Safari will not work — the design is Chromium-only.
- **Node.js 16+** only if you edit the sources and rebuild, or run the tests. **You do NOT need
  Node just to load and use the extension** — `dist/` is already built.
- A webcam, and a Google account able to join a Meet call (a second participant or a second
  device helps for end-to-end confirmation, but your own tile is enough to see the filter).

## Phase 1 — Get the code

Either way gives you an identical `dist/`:

```bash
# from GitHub
git clone https://github.com/Yash-Tripath1/vynt-meet.git
cd vynt-meet

# or from the zip you were given
unzip vynt-meet.zip && cd vynt-meet
```

No `npm install`, no build. If you ever edit `src/`, regenerate `dist/` with `node build.js`.

## Phase 2 — Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (toggle, top-right).
3. Click **Load unpacked**.
4. Select the **`dist/` folder** (the folder itself, not a file inside it).
5. The "VYNT for Google Meet" card appears. Pin it from the puzzle-piece menu so the icon is
   visible.

If you see a red **Errors** button on the card, open it and read — a manifest typo shows up here.
A clean load shows nothing.

## Phase 3 — Confirm the hook is alive on Meet (10 seconds)

This is the check for the one thing we couldn't verify headlessly (Meet's CSP vs. our MAIN-world
injection).

1. Open a new tab to `https://meet.google.com`.
2. Open DevTools (**F12**) and go to the **Console** on *that* tab.
3. Type and run:

```js
navigator.mediaDevices.getUserMedia.__vyntPatched
```

| Result | Meaning | What to do |
|---|---|---|
| `true` | Injection worked; the hook owns `getUserMedia`. | Continue to Phase 4. |
| `undefined` | The page's CSP blocked the MAIN-world file from running. | See "Fallback if CSP blocks us" below. |

## Phase 4 — See it work

1. On Meet, start or join a call (the **pre-join green-room** already counts — it requests the
   camera, so you can preview before joining).
2. Allow camera access when prompted.
3. Look at **your own tile**: it should carry the current filter (default `VYNTAGE`).
4. Click the toolbar icon: the popup shows a **Live** status line with filter + fps + whether the
   worker or the main thread is rendering. The toolbar **badge** shows the short label (e.g. `VYNT`).
5. Click a different filter chip — your tile changes in under ~200 ms, no rejoin needed.
6. **Background-tab check (0.2.1+):** with a second account or a friend on the call, switch
   away from Meet so the tab is fully hidden. Their view of your tile must **keep moving** (it
   used to freeze). The popup status shows ` · bg` while the worker clock is carrying the load.

### Optional sanity check without Meet

Serves the synthetic-camera harness so you can watch the pipeline filter without a call:

```bash
cd vynt-meet && python3 -m http.server 8000
# open http://localhost:8000/harness/meet-like.html
```

## Phase 5 — Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `__vyntPatched` is `undefined` on Meet | Page CSP blocked the MAIN-world script | Fallback below |
| Tile not filtered, but `__vyntPatched` is `true` | Meet grabbed the camera before the toggle / a stale stream | Turn your camera **off and on** in Meet, or rejoin |
| Video freezes when you switch tabs | Background-tab timer throttling (Option A captureStream) | Known limitation; flip to the `MediaStreamTrackGenerator` strategy (see plan) |
| Popup says "waiting for Meet to request the camera" | You're on Meet but no call/green-room is open | Join or open the pre-join screen |
| Camera LED stays on after leaving | A pipeline didn't tear down | Close the tab; report it — teardown is supposed to stop the track |
| Fisheye feels slow on a weak laptop | It's the heaviest filter at high res | Raise **pixelation**, or accept ~20 fps |

### Fallback if CSP blocks us

If Phase 3 returns `undefined`, the fix is one of (in order of preference):

1. **Nonce relay (B1):** the ISOLATED bridge reads the page's `script[nonce]` and injects the hook
   with that nonce, satisfying `strict-dynamic`.
2. **`chrome.scripting.executeScript` + `func` (B2):** Meet's CSP allows `'unsafe-eval'`, so an
   eval-based MAIN-world injection can pass where a file load doesn't.
3. **`registerContentScripts` (B3):** dynamic registration instead of the static manifest entry.

Because `dist/inject/hook.js` is a single self-contained IIFE, all three remain possible without a
rewrite. This is a ~half-day change; it is *not* a redesign.

## Phase 6 — Tests & CI (optional but recommended)

Run the suite locally (26 tests, includes bit-identical filter parity):

```bash
node --test tests/
```

Add CI so every push is checked. Create `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node build.js
      - run: node --test tests/
```

A `.gitignore` for Node artefacts (harmless here since there are no deps):

```
node_modules/
.DS_Store
```

## Phase 7 — Shipping to the Chrome Web Store (later)

Only when the above is green on real hardware. You'll need: a developer account ($5 one-off), a
zip of `dist/` (no source), a privacy-practice description (local-only processing), and a
single-purpose justification. The minimal permission surface (one host pattern + `storage`) is
deliberately what makes this review passable. Do this *after* Phase 4 is confirmed on real calls.
