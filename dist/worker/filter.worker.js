// VYNT filter worker.
//
// Owns its own OffscreenCanvas, renders each incoming frame into it, and hands the result
// back as an ImageBitmap. The main thread blits that onto the <canvas> whose stream Meet
// is encoding, then calls track.requestFrame().
//
// This deliberately does NOT use transferControlToOffscreen(): that call permanently
// removes the 2d context from the main-thread canvas, which would make the main-thread
// fallback path impossible to enter after a worker failure. Two cheap GPU blits per frame
// is a fair price for being able to degrade gracefully instead of sending a frozen frame.
//
// Loaded as a module worker: new Worker(url, { type: 'module' }).

import { createRenderer } from '../core/renderer.js'
import { normalizeSettings } from '../core/settings.js'

const render = createRenderer()

let canvas = null
let context = null
let settings = normalizeSettings(null)
let outWidth = 1280
let outHeight = 720

function ensureCanvas() {
  if (canvas && canvas.width === outWidth && canvas.height === outHeight) return true
  if (typeof OffscreenCanvas === 'undefined') return false

  canvas = new OffscreenCanvas(outWidth, outHeight)
  context = canvas.getContext('2d', { willReadFrequently: false })
  return Boolean(context)
}

self.onmessage = (event) => {
  const message = event.data
  if (!message || typeof message !== 'object') return

  switch (message.type) {
    case 'init': {
      if (Number.isFinite(message.width) && message.width > 0) outWidth = Math.round(message.width)
      if (Number.isFinite(message.height) && message.height > 0) outHeight = Math.round(message.height)
      settings = normalizeSettings(message.settings)
      self.postMessage(ensureCanvas() ? { type: 'ready' } : { type: 'error', error: 'OffscreenCanvas unavailable' })
      break
    }

    case 'configure': {
      settings = normalizeSettings(message.settings)
      const nextWidth = Number.isFinite(message.width) && message.width > 0 ? Math.round(message.width) : outWidth
      const nextHeight = Number.isFinite(message.height) && message.height > 0 ? Math.round(message.height) : outHeight
      if (nextWidth !== outWidth || nextHeight !== outHeight) {
        outWidth = nextWidth
        outHeight = nextHeight
        ensureCanvas()
      }
      break
    }

    case 'frame': {
      if (!message.bitmap) return
      let output = null
      try {
        if (!context && !ensureCanvas()) {
          self.postMessage({ type: 'error', error: 'no render surface' })
          return
        }
        render(context, canvas, outWidth, outHeight, message.bitmap, settings)
        output = canvas.transferToImageBitmap()
      } catch (error) {
        self.postMessage({ type: 'error', error: String((error && error.message) || error) })
        return
      } finally {
        // ImageBitmaps hold GPU memory; releasing promptly is what keeps a long call from
        // leaking. The source bitmap is always consumed by now.
        message.bitmap.close()
      }
      self.postMessage({ type: 'rendered', bitmap: output }, [output])
      break
    }
  }
}
