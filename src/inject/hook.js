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
      onTelemetry: (telemetry) => report({ fps: telemetry.fps, mode: telemetry.mode }),
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
