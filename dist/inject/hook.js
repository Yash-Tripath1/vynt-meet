;(function () {
'use strict'
// VYNT filter maths.
//
// Ported verbatim from Yash-Tripath1/Vynt src/App.tsx (applyPreset / applyFisheye
// / clamp / getEffectivePixelSize) at commit 50116b4. The per-pixel arithmetic is
// intentionally byte-for-byte identical to upstream so the extension looks exactly
// like the desktop app. Do not "improve" the constants here: visual parity is a
// feature, and tests/filters.test.js enforces it against the original.
//
// The one deliberate change is applyFisheye(), which uses a precomputed remap table.
// The remap depends only on (x, y, width, height) and never on pixel data, so it is
// frame-invariant. Caching it is arithmetically identical and ~4x faster. See
// fisheyeLut.js and tests/fisheyeLut.test.js, which proves equivalence.

function clamp(value) {
  return Math.max(0, Math.min(255, value))
}

function getEffectivePixelSize(pixelSize) {
  return 1 + Math.pow(pixelSize - 1, 1.45) * 0.22
}

/**
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} context
 */
function applyFisheye(context, width, height, lut) {
  const imageData = context.getImageData(0, 0, width, height)
  const source = new Uint8ClampedArray(imageData.data)
  const output = imageData.data

  if (!lut || lut.width !== width || lut.height !== height) {
    return applyFisheyeDirect(context, imageData, source, output, width, height)
  }

  const map = lut.map // Uint32Array of source pixel offsets; 0xFFFFFFFF = outside the lens
  for (let i = 0, p = 0; i < width * height; i += 1, p += 4) {
    const sourceIndex = map[i]
    if (sourceIndex === 0xffffffff) {
      output[p] = 8
      output[p + 1] = 8
      output[p + 2] = 7
      output[p + 3] = 255
      continue
    }
    output[p] = source[sourceIndex]
    output[p + 1] = source[sourceIndex + 1]
    output[p + 2] = source[sourceIndex + 2]
    output[p + 3] = 255
  }

  context.putImageData(imageData, 0, 0)
}

/** Original upstream implementation, kept as the correctness reference and fallback. */
function applyFisheyeDirect(context, imageData, source, output, width, height) {
  const centerX = width / 2
  const centerY = height / 2

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const outputIndex = (y * width + x) * 4
      const normalizedX = (x - centerX) / centerX
      const normalizedY = (y - centerY) / centerY
      const radius = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)

      if (radius > 1) {
        output[outputIndex] = 8
        output[outputIndex + 1] = 8
        output[outputIndex + 2] = 7
        output[outputIndex + 3] = 255
        continue
      }

      const sourceRadius = Math.pow(radius, 1.55)
      const angle = Math.atan2(normalizedY, normalizedX)
      const sourceX = Math.round(centerX + Math.cos(angle) * sourceRadius * centerX)
      const sourceY = Math.round(centerY + Math.sin(angle) * sourceRadius * centerY)
      const safeX = Math.max(0, Math.min(width - 1, sourceX))
      const safeY = Math.max(0, Math.min(height - 1, sourceY))
      const sourceIndex = (safeY * width + safeX) * 4

      output[outputIndex] = source[sourceIndex]
      output[outputIndex + 1] = source[sourceIndex + 1]
      output[outputIndex + 2] = source[sourceIndex + 2]
      output[outputIndex + 3] = 255
    }
  }

  context.putImageData(imageData, 0, 0)
}

/**
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} context
 * @param {{width:number,height:number,map:Uint32Array}} [lut]
 */
function applyPreset(context, width, height, filterMode, grain, lut) {
  if (filterMode === 'fisheye') {
    applyFisheye(context, width, height, lut)
  }

  if (filterMode === 'original' && grain === 0) {
    return
  }

  const imageData = context.getImageData(0, 0, width, height)
  const data = imageData.data
  const original = new Uint8ClampedArray(data)
  const manualGrain = grain * 0.28

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const leftX = Math.max(0, x - 1)
      const rightX = Math.min(width - 1, x + 1)
      const leftIndex = (y * width + leftX) * 4
      const rightIndex = (y * width + rightX) * 4

      let red = original[index]
      let green = original[index + 1]
      let blue = original[index + 2]

      const luminance = red * 0.299 + green * 0.587 + blue * 0.114
      const normalizedX = (x - width / 2) / (width / 2)
      const normalizedY = (y - height / 2) / (height / 2)
      const distanceFromCenter = Math.sqrt(
        normalizedX * normalizedX + normalizedY * normalizedY
      )

      if (filterMode === 'vyntage') {
        red = red * 1.1 + 15
        green = green * 1.01 + 7
        blue = blue * 0.8 + 1

        red = luminance + (red - luminance) * 0.84
        green = luminance + (green - luminance) * 0.79
        blue = luminance + (blue - luminance) * 0.7

        red = (red - 128) * 0.87 + 138
        green = (green - 128) * 0.85 + 134
        blue = (blue - 128) * 0.82 + 127

        const noise = (Math.random() - 0.5) * (15 + manualGrain)
        red += noise * 1.1
        green += noise * 0.93
        blue += noise * 0.72

        const vignette = 1 - Math.max(0, distanceFromCenter - 0.2) * 0.2
        red *= vignette
        green *= vignette
        blue *= vignette
      }

      if (filterMode === 'digicam') {
        red = original[leftIndex]
        green = original[index + 1]
        blue = original[rightIndex + 2]

        red = red * 1.08 + 7
        green = green * 0.99 + 1
        blue = blue * 0.89 - 2

        red = (red - 128) * 1.07 + 128
        green = (green - 128) * 1.04 + 128
        blue = (blue - 128) * 1.01 + 128

        const noise = (Math.random() - 0.5) * (13 + manualGrain)
        red += noise * 1.05
        green += noise * 0.82
        blue += noise * 0.72

        const vignette = 1 - Math.max(0, distanceFromCenter - 0.34) * 0.26
        red *= vignette
        green *= vignette
        blue *= vignette

        const colourStep = 12
        red = Math.round(red / colourStep) * colourStep
        green = Math.round(green / colourStep) * colourStep
        blue = Math.round(blue / colourStep) * colourStep
      }

      if (filterMode === 'nightflash') {
        red = luminance * 1.18 + 24
        green = luminance * 1.1 + 14
        blue = luminance * 1.2 + 26

        const flashFalloff = 1 - Math.min(0.6, distanceFromCenter * 0.52)
        red *= flashFalloff
        green *= flashFalloff
        blue *= flashFalloff

        const noise = (Math.random() - 0.5) * (24 + manualGrain)
        red += noise
        green += noise * 0.85
        blue += noise * 1.22
      }

      if (filterMode === 'neoncity') {
        const splitX = Math.max(0, x - 2)
        const splitIndex = (y * width + splitX) * 4
        red = original[splitIndex] * 1.22 + 12
        green = green * 0.9 + 2
        blue = blue * 1.3 + 18
        const neonLuminance = red * 0.299 + green * 0.587 + blue * 0.114
        red = neonLuminance + (red - neonLuminance) * 1.38
        green = neonLuminance + (green - neonLuminance) * 1.04
        blue = neonLuminance + (blue - neonLuminance) * 1.46
        red = (red - 128) * 1.15 + 118
        green = (green - 128) * 1.18 + 110
        blue = (blue - 128) * 1.18 + 132
        const scanline = y % 4 < 2 ? 0.9 : 1.05
        const noise = (Math.random() - 0.5) * (10 + manualGrain)
        red = red * scanline + noise
        green = green * scanline + noise * 0.7
        blue = blue * scanline + noise * 1.2
      }

      if (filterMode === 'vhs') {
        const tapeLeftX = Math.max(0, x - 2)
        const tapeRightX = Math.min(width - 1, x + 2)
        const tapeLeftIndex = (y * width + tapeLeftX) * 4
        const tapeRightIndex = (y * width + tapeRightX) * 4

        red = original[tapeLeftIndex]
        green = original[index + 1]
        blue = original[tapeRightIndex + 2]

        const mutedLuminance = red * 0.299 + green * 0.587 + blue * 0.114
        red = mutedLuminance + (red - mutedLuminance) * 0.72 + 4
        green = mutedLuminance + (green - mutedLuminance) * 0.68
        blue = mutedLuminance + (blue - mutedLuminance) * 0.82 + 7

        const scanline = y % 4 < 2 ? 0.86 : 1
        red *= scanline
        green *= scanline
        blue *= scanline

        const noise = (Math.random() - 0.5) * (20 + manualGrain)
        red += noise
        green += noise
        blue += noise * 1.2
      }

      if (filterMode === 'goldenfilm') {
        red = red * 1.15 + 18
        green = green * 1.03 + 10
        blue = blue * 0.78 + 2

        red = (red - 128) * 0.88 + 135
        green = (green - 128) * 0.86 + 133
        blue = (blue - 128) * 0.84 + 128

        const noise = (Math.random() - 0.5) * (9 + manualGrain)
        red += noise
        green += noise * 0.9
        blue += noise * 0.7
      }

      if (filterMode === 'fisheye') {
        red = red * 1.04 + 4
        green = green * 1.01 + 2
        blue = blue * 1.06 + 5

        const noise = (Math.random() - 0.5) * (8 + manualGrain)
        red += noise
        green += noise
        blue += noise
      }

      if (filterMode === 'original' && grain > 0) {
        const noise = (Math.random() - 0.5) * manualGrain
        red += noise
        green += noise
        blue += noise
      }

      data[index] = clamp(red)
      data[index + 1] = clamp(green)
      data[index + 2] = clamp(blue)
      data[index + 3] = 255
    }
  }

  context.putImageData(imageData, 0, 0)
}

function formatTimestamp(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const year = date.getFullYear()

  const rawHour = date.getHours()
  const hour = rawHour % 12 || 12
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  const meridiem = rawHour >= 12 ? 'PM' : 'AM'

  return `${month}-${day}-${year}   ${hour}:${minute}:${second} ${meridiem}`
}

function drawTimestamp(context, width, height, timestamp, corner) {
  const text = formatTimestamp(timestamp)
  const fontSize = Math.max(13, Math.round(width * 0.022))
  const padding = Math.max(14, Math.round(width * 0.03))

  // Meet draws the participant's name over the BOTTOM-LEFT of every tile, which is exactly
  // where upstream VYNT stamps the date. So the default here is bottom-right; the corner is
  // configurable for anyone who wants the classic digicam look back.
  const c = corner || 'bottom-right'
  let x = padding
  let y = height - padding
  let align = 'left'
  let baseline = 'bottom'
  if (c === 'bottom-right') {
    x = width - padding
    align = 'right'
  } else if (c === 'top-left') {
    y = padding
    baseline = 'top'
  } else if (c === 'top-right') {
    x = width - padding
    y = padding
    align = 'right'
    baseline = 'top'
  }

  context.save()
  context.font = `bold ${fontSize}px "Courier New", monospace`
  context.textAlign = align
  context.textBaseline = baseline
  context.lineWidth = Math.max(2, Math.round(fontSize * 0.13))
  context.strokeStyle = 'rgba(10, 10, 9, 0.88)'
  context.fillStyle = 'rgba(239, 239, 228, 0.96)'
  context.strokeText(text, x, y)
  context.fillText(text, x, y)
  context.restore()
}


// Frame-invariant remap table for the fisheye filter.
//
// Upstream computes Math.pow / Math.atan2 / Math.cos / Math.sin / Math.round and two
// bounds clamps for every pixel of every frame. None of that depends on pixel data --
// only on (x, y, width, height). So we compute it once per output size and cache it.
// tests/fisheyeLut.test.js asserts the cached path is pixel-identical to the original.

const cache = new Map()

function getFisheyeLut(width, height) {
  const key = `${width}x${height}`
  const cached = cache.get(key)
  if (cached) return cached

  const map = new Uint32Array(width * height)
  const centerX = width / 2
  const centerY = height / 2

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const normalizedX = (x - centerX) / centerX
      const normalizedY = (y - centerY) / centerY
      const radius = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)

      if (radius > 1) {
        map[y * width + x] = 0xffffffff
        continue
      }

      const sourceRadius = Math.pow(radius, 1.55)
      const angle = Math.atan2(normalizedY, normalizedX)
      const sourceX = Math.round(centerX + Math.cos(angle) * sourceRadius * centerX)
      const sourceY = Math.round(centerY + Math.sin(angle) * sourceRadius * centerY)
      const safeX = Math.max(0, Math.min(width - 1, sourceX))
      const safeY = Math.max(0, Math.min(height - 1, sourceY))

      map[y * width + x] = (safeY * width + safeX) * 4
    }
  }

  const lut = { width, height, map }
  // Cap the cache: the output size is stable during a call, but a device switch or an
  // aspect change must not grow this without bound.
  if (cache.size >= 8) cache.delete(cache.keys().next().value)
  cache.set(key, lut)
  return lut
}

function clearFisheyeLutCache() {
  cache.clear()
}


// Frame fitting and mirroring.
//
// Two deliberate deviations from upstream src/App.tsx, both because we are producing a
// transmitted feed rather than a selfie preview:
//
//   1. Mirroring is optional and OFF by default. Upstream drawMirroredCover() mirrors
//      unconditionally (App.tsx:93-94), which is right for a preview and wrong for
//      transmission: Meet mirrors your self-view itself and sends unmirrored video, so
//      pre-mirroring would show every other participant a mirrored you.
//   2. The crop is computed separately from the draw, so the main thread can hand the
//      worker a pre-cropped ImageBitmap (GPU-side crop) instead of shipping full frames.
//
// The cover-crop arithmetic itself is copied verbatim from upstream.

/**
 * @returns {{sx:number,sy:number,sw:number,sh:number}}
 */
function computeCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight, zoom) {
  const sourceAspectRatio = sourceWidth / sourceHeight
  const targetAspectRatio = targetWidth / targetHeight

  let cropWidth = sourceWidth
  let cropHeight = sourceHeight

  if (sourceAspectRatio > targetAspectRatio) {
    cropWidth = sourceHeight * targetAspectRatio
  } else {
    cropHeight = sourceWidth / targetAspectRatio
  }

  cropWidth /= zoom
  cropHeight /= zoom

  return {
    sx: (sourceWidth - cropWidth) / 2,
    sy: (sourceHeight - cropHeight) / 2,
    sw: cropWidth,
    sh: cropHeight,
  }
}

/**
 * Draw an already-cropped source so that it fills the target box.
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} context
 * @param {CanvasImageSource} source
 */
function drawCover(context, source, targetWidth, targetHeight, mirror) {
  context.clearRect(0, 0, targetWidth, targetHeight)
  context.save()

  if (mirror) {
    context.translate(targetWidth, 0)
    context.scale(-1, 1)
  }

  context.drawImage(source, 0, 0, targetWidth, targetHeight)
  context.restore()
}


// Single source of truth for settings, shared by the popup, the bridge and the
// injected hook. Values are validated on the way in because the MAIN world is shared
// with the page: anything crossing that boundary is untrusted input.

const FILTERS = [
  { id: 'original', label: 'ORIGINAL', shortLabel: 'RAW' },
  { id: 'vyntage', label: 'VYNTAGE', shortLabel: 'VYNT' },
  { id: 'digicam', label: '2007 DIGICAM', shortLabel: '2007' },
  { id: 'nightflash', label: 'NIGHT FLASH', shortLabel: 'FLASH' },
  { id: 'neoncity', label: 'NEON CITY', shortLabel: 'NEON' },
  { id: 'fisheye', label: 'FISHEYE', shortLabel: 'FISH' },
  { id: 'vhs', label: 'VHS TAPE', shortLabel: 'VHS' },
  { id: 'goldenfilm', label: 'GOLDEN FILM', shortLabel: 'FILM' },
]

const FILTER_IDS = FILTERS.map((f) => f.id)

const LIMITS = {
  pixelSize: { min: 1, max: 10, step: 1 },
  grain: { min: 0, max: 100, step: 1 },
  zoom: { min: 1, max: 2, step: 0.05 },
}

// Meet overlays the participant name on the bottom-left of each tile, so the date stamp
// defaults to the opposite corner. All four are offered for the classic look.
const STAMP_CORNERS = ['bottom-right', 'bottom-left', 'top-left', 'top-right']

const DEFAULT_SETTINGS = {
  enabled: true,
  filterMode: 'vyntage',
  pixelSize: 3,
  grain: 34,
  zoom: 1,
  dateImprint: false,
  stampCorner: 'bottom-right',
  mirror: false, // transmission-correct default; see core/layout.js
  autoQuality: true, // raise pixelation automatically if the frame rate dips
  fpsCap: 30,
}

const STORAGE_KEY = 'vyntSettings'

function toNumber(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Coerce anything -- a storage read, a postMessage payload, a forged page event --
 * into a settings object that is safe to render with. Unknown keys are dropped.
 */
function normalizeSettings(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const filterMode = FILTER_IDS.includes(raw.filterMode) ? raw.filterMode : DEFAULT_SETTINGS.filterMode

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
    filterMode,
    pixelSize: Math.round(toNumber(raw.pixelSize, DEFAULT_SETTINGS.pixelSize, LIMITS.pixelSize.min, LIMITS.pixelSize.max)),
    grain: Math.round(toNumber(raw.grain, DEFAULT_SETTINGS.grain, LIMITS.grain.min, LIMITS.grain.max)),
    zoom: toNumber(raw.zoom, DEFAULT_SETTINGS.zoom, LIMITS.zoom.min, LIMITS.zoom.max),
    dateImprint: typeof raw.dateImprint === 'boolean' ? raw.dateImprint : DEFAULT_SETTINGS.dateImprint,
    stampCorner: STAMP_CORNERS.includes(raw.stampCorner) ? raw.stampCorner : DEFAULT_SETTINGS.stampCorner,
    mirror: typeof raw.mirror === 'boolean' ? raw.mirror : DEFAULT_SETTINGS.mirror,
    autoQuality: typeof raw.autoQuality === 'boolean' ? raw.autoQuality : DEFAULT_SETTINGS.autoQuality,
    fpsCap: toNumber(raw.fpsCap, DEFAULT_SETTINGS.fpsCap, 1, 60),
  }
}

function getFilterLabel(filterMode) {
  return FILTERS.find((f) => f.id === filterMode)?.label ?? 'ORIGINAL'
}

function getFilterShortLabel(filterMode) {
  return FILTERS.find((f) => f.id === filterMode)?.shortLabel ?? 'RAW'
}


// Lightweight, opt-out frame-rate guard.
//
// The filter loop is CPU-bound, and weak laptops can dip below a smooth 30 fps on the
// heavier filters. Rather than let a call degrade, we nudge pixelation up (which shrinks
// the working canvas and is the single biggest cost lever) when the measured frame rate
// stays low. We only ever *increase* pixelation and never auto-reduce it: dropping back
// down when the load is transient would cause visible flapping mid-call, and a slightly
// softer image is always preferable to a stuttering one.
//
// Kept as a pure function so the decision rule is unit-testable in isolation.

const AUTO_QUALITY = {
  // Below this sustained fps we step pixelation up.
  lowFps: 22,
  // Hard cap on how many pixelation steps we may add on top of the user's choice.
  maxBoost: 4,
}

/**
 * @param {{fps:number, currentBoost:number}} args
 * @returns {number} the next boost (0..maxBoost)
 */
function decideBoost({ fps, currentBoost }) {
  const boost = Number.isFinite(currentBoost) ? currentBoost : 0
  if (!Number.isFinite(fps)) return boost
  if (fps < AUTO_QUALITY.lowFps && boost < AUTO_QUALITY.maxBoost) return boost + 1
  return boost
}


// The per-frame render pipeline, shared by the worker and the main-thread fallback.
//
// NOTE on imports: this file is consumed two ways. As an ES module (worker + unit tests)
// the imports below are required. In the built MAIN-world bundle (build.js) those same
// import lines are stripped, because the bundle concatenates these sources in dependency
// order into one IIFE where the functions are already in scope.
//
//
// Structurally identical to upstream renderFrame() (App.tsx:388-446) with two fixes
// that only matter for a 30 fps live feed:
//   - the working canvas is allocated once and reused instead of per frame
//     (upstream calls document.createElement('canvas') inside renderFrame, App.tsx:409)
//   - fisheye uses the cached remap table
//
// It runs in a Worker against an OffscreenCanvas and on the main thread against an
// HTMLCanvasElement, so it must not touch `document`.

function createRenderer() {
  let workingCanvas = null
  let workingContext = null
  let workingWidth = 0
  let workingHeight = 0
  let workingReadFrequently = false

  function ensureWorking(width, height, readFrequently, factory) {
    if (workingCanvas && workingWidth === width && workingHeight === height && workingReadFrequently === readFrequently) {
      return workingContext
    }

    workingCanvas = factory(width, height)
    workingContext = workingCanvas.getContext('2d', { willReadFrequently: readFrequently })
    if (!workingContext) throw new Error('VYNT could not create a texture canvas.')

    workingWidth = width
    workingHeight = height
    workingReadFrequently = readFrequently
    return workingContext
  }

  /**
   * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} targetContext
   * @param {HTMLCanvasElement|OffscreenCanvas} targetCanvas
   * @param {CanvasImageSource} source already cropped to the cover region
   */
  return function render(targetContext, targetCanvas, targetWidth, targetHeight, source, settings) {
    if (targetCanvas.width !== targetWidth) targetCanvas.width = targetWidth
    if (targetCanvas.height !== targetHeight) targetCanvas.height = targetHeight

    // Passthrough fast path: at pixelSize 1 with no grain and no imprint, upstream's
    // working canvas is the same size as the target and applyPreset() returns without
    // touching a pixel, so the whole pipeline reduces to one cover blit. This is what
    // "VYNT off" uses, which keeps a disabled extension down to a single GPU copy per
    // frame instead of a full pixel loop. Visually identical to the slow path.
    if (settings.filterMode === 'original' && settings.grain === 0 && !settings.dateImprint && settings.pixelSize <= 1) {
      targetContext.imageSmoothingEnabled = false
      drawCover(targetContext, source, targetWidth, targetHeight, settings.mirror)
      return
    }

    const effectivePixelSize = getEffectivePixelSize(settings.pixelSize)
    const width = Math.max(1, Math.floor(targetWidth / effectivePixelSize))
    const height = Math.max(1, Math.floor(targetHeight / effectivePixelSize))
    const readFrequently = settings.filterMode !== 'original' || settings.grain > 0

    const workingContext = ensureWorking(width, height, readFrequently, (w, h) => {
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      return canvas
    })

    workingContext.imageSmoothingEnabled = false

    drawCover(workingContext, source, width, height, settings.mirror)

    const lut = settings.filterMode === 'fisheye' ? getFisheyeLut(width, height) : undefined
    applyPreset(workingContext, width, height, settings.filterMode, settings.grain, lut)

    targetContext.imageSmoothingEnabled = false
    targetContext.clearRect(0, 0, targetWidth, targetHeight)
    targetContext.drawImage(workingCanvas, 0, 0, targetWidth, targetHeight)

    if (settings.dateImprint) {
      drawTimestamp(targetContext, targetWidth, targetHeight, new Date(), settings.stampCorner)
    }
  }
}


// Filtered video track source -- the "virtual camera" core.
//
// Given the real camera track, produces a track carrying Vynt-filtered frames that we
// hand to Google Meet in place of the original. Audio is never touched; the caller
// passes the original stream's audio tracks straight through.
//
// Rendering happens in a Worker when one can be created. If the worker cannot start or
// errors later (page CSP, a Chrome change, an unusual environment) we fall back to
// rendering on the main thread rather than sending a frozen frame for the rest of the
// call. Because the canvas keeps a normal 2d context, that fallback is always reachable.

// NOTE on imports: consumed two ways. As an ES module (unit tests) these imports are
// required; in the built MAIN-world bundle build.js strips them, since the bundle
// concatenates the core sources in dependency order and the identifiers are in scope.

const MAX_OUTPUT_WIDTH = 1280

function resolveOutputSize(sourceWidth, sourceHeight) {
  const width = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1280
  const height = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : 720

  if (width <= MAX_OUTPUT_WIDTH) {
    return { width: Math.round(width / 2) * 2, height: Math.round(height / 2) * 2 }
  }

  const scale = MAX_OUTPUT_WIDTH / width
  return { width: MAX_OUTPUT_WIDTH, height: Math.round((height * scale) / 2) * 2 }
}

/**
 * @param {object} options
 * @param {string|null} options.workerUrl resolved chrome-extension:// URL, or null
 * @param {(telemetry:{fps:number,mode:string})=>void} [options.onTelemetry]
 */
function createCaptureStreamSource(options) {
  const workerUrl = options && options.workerUrl ? options.workerUrl : null
  const onTelemetry = (options && options.onTelemetry) || null

  let worker = null
  let workerReady = false
  let workerFailed = false
  let pendingFrame = false

  let canvas = null
  let context = null
  let render = null

  let video = null
  let outputTrack = null
  let outputStream = null
  let sourceTrack = null

  let settings = normalizeSettings(null)
  let outWidth = 1280
  let outHeight = 720
  let crop = { sx: 0, sy: 0, sw: 1280, sh: 720 }

  let frameCallbackId = null
  let usingVideoFrameCallback = false
  let lastFrameTime = 0
  let running = false
  let stopped = false

  let framesSinceReport = 0
  let lastReportTime = 0
  let autoBoost = 0 // extra pixelation steps added by the frame-rate guard

  function requestFrame() {
    if (outputTrack && typeof outputTrack.requestFrame === 'function') {
      outputTrack.requestFrame()
    }
  }

  // The settings the renderer actually uses: the user's, plus any auto-quality boost.
  function eff() {
    if (autoBoost <= 0) return settings
    // 10 matches LIMITS.pixelSize.max in core/settings.js.
    return Object.assign({}, settings, { pixelSize: Math.min(10, settings.pixelSize + autoBoost) })
  }

  function pushEffective() {
    if (worker && workerReady) {
      worker.postMessage({ type: 'configure', settings: eff(), width: outWidth, height: outHeight })
    }
  }

  function maybeAutoBoost(fps) {
    if (!settings.autoQuality) return
    const next = decideBoost({ fps, currentBoost: autoBoost })
    if (next !== autoBoost) {
      autoBoost = next
      pushEffective()
    }
  }

  function noteFrame(now) {
    framesSinceReport += 1
    if (now - lastReportTime >= 1000) {
      const fps = Math.round((framesSinceReport * 1000) / (now - lastReportTime))
      maybeAutoBoost(fps)
      if (onTelemetry) {
        onTelemetry({
          fps,
          mode: settings.filterMode,
          auto: autoBoost > 0,
          pixel: eff().pixelSize,
        })
      }
      framesSinceReport = 0
      lastReportTime = now
    }
  }

  function abandonWorker() {
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    worker = null
    workerReady = false
    workerFailed = true
    pendingFrame = false
  }

  function startWorker() {
    if (!workerUrl || typeof Worker === 'undefined') return false

    try {
      worker = new Worker(workerUrl, { type: 'module' })
    } catch (error) {
      worker = null
      return false
    }

    worker.onmessage = (event) => {
      const message = event.data
      if (!message) return

      if (message.type === 'ready') {
        workerReady = true
        return
      }

      if (message.type === 'error') {
        // Degrade to the main thread instead of freezing the outgoing video.
        abandonWorker()
        return
      }

      if (message.type === 'rendered') {
        pendingFrame = false
        if (!running || !context) return
        if (message.bitmap) {
          try {
            context.drawImage(message.bitmap, 0, 0)
          } catch (error) {
            // A torn bitmap is not worth stopping the call over.
          }
          message.bitmap.close()
        }
        requestFrame()
      }
    }

    worker.onerror = () => abandonWorker()

    worker.postMessage({
      type: 'init',
      width: outWidth,
      height: outHeight,
      settings: eff(),
    })
    return true
  }

  function recomputeCrop() {
    crop = computeCoverCrop(
      video.videoWidth,
      video.videoHeight,
      outWidth,
      outHeight,
      settings.zoom
    )
  }

  async function drawOnce(now) {
    if (pendingFrame || !running || !video || video.readyState < 2) return
    if (!video.videoWidth || !video.videoHeight) return

    let bitmap
    try {
      bitmap = await createImageBitmap(video, crop.sx, crop.sy, crop.sw, crop.sh)
    } catch (error) {
      // A frame can be dropped while the track reconfigures. The next callback retries.
      return
    }

    if (!running) {
      bitmap.close()
      return
    }

    if (worker && workerReady && !workerFailed) {
      pendingFrame = true
      try {
        worker.postMessage({ type: 'frame', bitmap }, [bitmap])
      } catch (error) {
        pendingFrame = false
        abandonWorker()
      }
      noteFrame(now)
      return
    }

    pendingFrame = true
    try {
      if (context) {
        render(context, canvas, outWidth, outHeight, bitmap, eff())
        requestFrame()
        noteFrame(now)
      }
    } finally {
      bitmap.close()
      pendingFrame = false
    }
  }

  function scheduleNext() {
    if (!running) return
    if (usingVideoFrameCallback) {
      frameCallbackId = video.requestVideoFrameCallback(onVideoFrame)
    } else if (typeof requestAnimationFrame === 'function') {
      frameCallbackId = requestAnimationFrame(onVideoFrame)
    }
  }

  function onVideoFrame(now) {
    frameCallbackId = null
    if (!running) return

    const timestamp = typeof now === 'number' ? now : performance.now()
    const interval = 1000 / settings.fpsCap
    if (timestamp - lastFrameTime < interval) {
      scheduleNext()
      return
    }
    lastFrameTime = timestamp

    void drawOnce(timestamp).then(scheduleNext, scheduleNext)
  }

  function stopAll() {
    if (stopped) return
    stopped = true
    running = false

    if (video) {
      if (frameCallbackId !== null) {
        if (usingVideoFrameCallback && typeof video.cancelVideoFrameCallback === 'function') {
          video.cancelVideoFrameCallback(frameCallbackId)
        } else if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(frameCallbackId)
        }
      }
      frameCallbackId = null
      video.srcObject = null
    }

    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      worker = null
    }
    workerReady = false

    if (outputStream) outputStream.getTracks().forEach((t) => t.stop())
    if (sourceTrack && sourceTrack.readyState === 'live') sourceTrack.stop()

    video = null
    canvas = null
    context = null
    outputTrack = null
    outputStream = null
    sourceTrack = null
  }

  return {
    /**
     * @param {MediaStreamTrack} track the real camera track
     * @param {object} initialSettings
     * @returns {Promise<{track:MediaStreamTrack, stream:MediaStream}>}
     */
    async start(track, initialSettings) {
      if (stopped) throw new Error('source already stopped')
      settings = normalizeSettings(initialSettings)
      sourceTrack = track

      video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.autoplay = true
      video.srcObject = new MediaStream([track])

      await video.play().catch(() => undefined)

      // Wait for real dimensions instead of trusting the 300x150 element defaults.
      for (let i = 0; i < 50 && !video.videoWidth; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      const size = resolveOutputSize(video.videoWidth, video.videoHeight)
      outWidth = size.width
      outHeight = size.height

      canvas = document.createElement('canvas')
      canvas.width = outWidth
      canvas.height = outHeight
      context = canvas.getContext('2d', { willReadFrequently: false })
      if (!context) throw new Error('VYNT could not create an output canvas.')

      // captureStream(0) means "emit only when requestFrame() is called", which avoids the
      // duplicate frames and wasted encoder work a fixed rate produces when our render
      // loop runs slower than the requested rate.
      outputStream = typeof canvas.captureStream === 'function'
        ? canvas.captureStream(0)
        : canvas.captureStream(30)
      outputTrack = outputStream.getVideoTracks()[0]

      render = createRenderer()
      recomputeCrop()

      // If the page stops the track we handed it, release the real camera.
      if (outputTrack && typeof outputTrack.addEventListener === 'function') {
        outputTrack.addEventListener('ended', () => stopAll())
      }

      startWorker()

      usingVideoFrameCallback = Boolean(video && typeof video.requestVideoFrameCallback === 'function')
      running = true
      lastFrameTime = 0
      lastReportTime = performance.now()
      scheduleNext()

      return { track: outputTrack, stream: outputStream }
    },

    update(nextSettings) {
      settings = normalizeSettings(nextSettings)
      pushEffective()
      if (video && video.videoWidth) recomputeCrop()
    },

    /** @returns {{worker:boolean,width:number,height:number}} */
    status() {
      return {
        worker: Boolean(worker && workerReady && !workerFailed),
        width: outWidth,
        height: outHeight,
      }
    },

    stop: stopAll,
  }
}


// VYNT for Google Meet -- injected into the MAIN world at document_start.
//
// This runs in Meet's own JavaScript context, which is the only place a
// navigator.mediaDevices.getUserMedia patch is visible to Meet. It has no access to any
// chrome.* API, so all settings arrive from the isolated-world bridge by postMessage.
//
// Trust model, stated plainly: the page shares this world. It can read our telemetry and
// forge settings messages. The ceiling on that is cosmetic -- a hostile page can change
// which filter you are using or read your frame rate. It cannot reach extension storage,
// cannot message the extension, and cannot touch the camera beyond what it could already
// do on its own. Every value crossing the boundary goes through normalizeSettings().
//
// Hard requirement: never break the call. Every path that could throw falls back to the
// untouched camera stream.

;(function vyntHook() {
  'use strict'

  const mediaDevices = navigator.mediaDevices
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return
  if (mediaDevices.getUserMedia.__vyntPatched) return

  // Passthrough look used when VYNT is switched off mid-call. Hits the renderer's fast
  // path: one cover blit per frame, no pixel loop.
  const PASSTHROUGH = {
    enabled: true,
    filterMode: 'original',
    pixelSize: 1,
    grain: 0,
    zoom: 1,
    dateImprint: false,
    mirror: false,
    fpsCap: 30,
  }

  let token = null
  let workerUrl = null
  let settings = normalizeSettings(null)
  let active = null

  const nativeGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices)

  function effectiveSettings() {
    return settings.enabled ? settings : normalizeSettings(PASSTHROUGH)
  }

  function report(extra) {
    try {
      window.postMessage(
        Object.assign(
          {
            __vynt: 'telemetry',
            token,
            active: Boolean(active),
            filter: settings.enabled ? settings.filterMode : 'off',
            worker: active ? active.source.status().worker : false,
          },
          extra || {}
        ),
        '*'
      )
    } catch (error) {
      // Telemetry is never worth throwing over.
    }
  }

  function applySettings(next) {
    settings = normalizeSettings(next)
    if (active) {
      try {
        active.source.update(effectiveSettings())
      } catch (error) {
        // Keep the existing pipeline running with the previous settings.
      }
    }
    report()
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || typeof data !== 'object' || typeof data.__vynt !== 'string') return

    if (data.__vynt === 'handshake') {
      token = typeof data.token === 'string' && data.token.length > 0 ? data.token : token
      if (typeof data.workerUrl === 'string' && data.workerUrl.startsWith('chrome-extension://')) {
        workerUrl = data.workerUrl
      }
      if (data.settings) applySettings(data.settings)
      else report()
      return
    }

    // Anything else must carry the token the bridge handed us.
    if (!token || data.token !== token) return
    if (data.__vynt === 'settings') applySettings(data.settings)
  })

  async function filterStream(stream) {
    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack) return stream

    // Meet re-requests the camera when you switch devices. Only one pipeline may own the
    // camera at a time, so retire the previous one before starting a new one -- otherwise
    // the old source keeps the device open after the call ends.
    if (active) {
      try {
        active.source.stop()
      } catch (error) {
        // Nothing useful to do; the new pipeline still gets built.
      }
      active = null
    }

    const source = createCaptureStreamSource({
      workerUrl,
      onTelemetry: (telemetry) =>
        report({ fps: telemetry.fps, mode: telemetry.mode, auto: Boolean(telemetry.auto), pixel: telemetry.pixel }),
    })

    const result = await source.start(videoTrack, effectiveSettings())

    const mixed = new MediaStream()
    mixed.addTrack(result.track)
    // Audio is never processed. Meet's own tracks pass straight through.
    stream.getAudioTracks().forEach((track) => mixed.addTrack(track))

    active = { source }
    report()
    return mixed
  }

  function patchedGetUserMedia(constraints) {
    let wantsVideo = false
    try {
      wantsVideo = Boolean(constraints && constraints.video)
    } catch (error) {
      wantsVideo = false
    }

    const pending = nativeGetUserMedia(constraints)
    if (!wantsVideo) return pending

    // A rejection (permission denied, no device) must reach Meet unchanged.
    return pending.then((stream) => filterStream(stream).catch((error) => stream))
  }

  patchedGetUserMedia.__vyntPatched = true

  try {
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      value: patchedGetUserMedia,
      writable: true,
      configurable: true,
      enumerable: true,
    })
  } catch (error) {
    try {
      mediaDevices.getUserMedia = patchedGetUserMedia
    } catch (innerError) {
      return
    }
  }

  // Legacy callback form. Meet does not use it, but other code on the page might.
  const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia
  if (typeof legacy === 'function' && !legacy.__vyntPatched) {
    const nativeLegacy = legacy.bind(navigator)
    const patchedLegacy = function (constraints, onSuccess, onError) {
      let wantsVideo = false
      try {
        wantsVideo = Boolean(constraints && constraints.video)
      } catch (error) {
        wantsVideo = false
      }
      if (!wantsVideo) return nativeLegacy(constraints, onSuccess, onError)

      return nativeLegacy(
        constraints,
        (stream) => {
          filterStream(stream).then(onSuccess, () => onSuccess(stream))
        },
        onError
      )
    }
    patchedLegacy.__vyntPatched = true
    try {
      navigator.getUserMedia = patchedLegacy
      if (navigator.webkitGetUserMedia) navigator.webkitGetUserMedia = patchedLegacy
    } catch (error) {
      // Optional; the promise path is what matters.
    }
  }

  window.addEventListener('pagehide', () => {
    if (active) {
      try {
        active.source.stop()
      } catch (error) {
        // Already going away.
      }
      active = null
    }
  })

  // Ask the bridge for settings and the worker URL. The bridge also re-sends on a timer,
  // so this works whichever of the two document_start scripts ran first.
  report()
  try {
    window.postMessage({ __vynt: 'hookReady' }, '*')
  } catch (error) {
    // The bridge's timer will find us anyway.
  }
})()

})()
