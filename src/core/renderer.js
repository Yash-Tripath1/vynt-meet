// The per-frame render pipeline, shared by the worker and the main-thread fallback.
//
// NOTE on imports: this file is consumed two ways. As an ES module (worker + unit tests)
// the imports below are required. In the built MAIN-world bundle (build.js) those same
// import lines are stripped, because the bundle concatenates these sources in dependency
// order into one IIFE where the functions are already in scope.
//
import { applyPreset, getEffectivePixelSize, drawTimestamp } from './filters.js'
import { drawCover } from './layout.js'
import { getFisheyeLut } from './fisheyeLut.js'
//
// Structurally identical to upstream renderFrame() (App.tsx:388-446) with two fixes
// that only matter for a 30 fps live feed:
//   - the working canvas is allocated once and reused instead of per frame
//     (upstream calls document.createElement('canvas') inside renderFrame, App.tsx:409)
//   - fisheye uses the cached remap table
//
// It runs in a Worker against an OffscreenCanvas and on the main thread against an
// HTMLCanvasElement, so it must not touch `document`.

export function createRenderer() {
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
      drawTimestamp(targetContext, targetWidth, targetHeight, new Date())
    }
  }
}
