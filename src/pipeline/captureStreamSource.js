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
import { normalizeSettings } from '../core/settings.js'
import { computeCoverCrop } from '../core/layout.js'
import { createRenderer } from '../core/renderer.js'
import { decideBoost } from '../core/autoQuality.js'

export const MAX_OUTPUT_WIDTH = 1280

export function resolveOutputSize(sourceWidth, sourceHeight) {
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
export function createCaptureStreamSource(options) {
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
