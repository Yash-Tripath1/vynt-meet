# Installing VYNT for Google Meet (for friends)

No store listing yet — install it as an unpacked extension. Takes about a minute.

**You need:** desktop Chrome, Edge, or another Chromium browser, version **115 or newer**.
(Phones and Firefox won't work.)

## Steps

1. **Get the extension** from whoever shared this:
   - They sent you `vynt-meet-dist-*.zip` → unzip it and remember where.
   - They sent a GitHub link → open the repo, press the green **Code** button → **Download ZIP**,
     unzip it, and look for the `dist` folder inside.
2. In Chrome, open **`chrome://extensions`** (Edge: `edge://extensions`).
3. Turn on **Developer mode** (top-right switch).
4. Click **Load unpacked** and choose the folder that contains `manifest.json`:
   - sent zip → the unzipped folder itself
   - GitHub zip → the **`dist`** folder inside
5. Optional: click the puzzle-piece icon and **pin** VYNT so its toolbar button stays visible.
6. Open [meet.google.com](https://meet.google.com), join a call (the camera preview already
   shows it), and look at **your tile**. Switch filters live from the VYNT toolbar button.

## Good to know

- **Keep the folder where it is** — Chrome loads the extension from disk. If you move or delete
  it, the extension breaks; just Load unpacked again from the new place.
- Unpacked extensions **don't auto-update**. When a new version comes out, download it and press
  the **⟳ reload** button on the VYNT card in `chrome://extensions` (pointing it at the new folder),
  or remove and load again.
- If the filter doesn't show up: reload the extension (⟳), then turn your camera **off and on**
  in Meet (or rejoin).
- Everything is processed on your computer. No video or audio is uploaded anywhere.
