// Isolated-world bridge. The only part of the extension that touches both chrome.* APIs
// and the MAIN-world hook, so every setting crosses the boundary here and nowhere else.

;(function vyntBridge() {
  'use strict'

  const token = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : String(Math.random()).slice(2) + String(Date.now())

  const workerUrl = chrome.runtime.getURL('worker/filter.worker.js')
  let settings = normalizeSettings(null)
  let lastTelemetry = null
  let handshakeCount = 0

  function sendHandshake() {
    handshakeCount += 1
    window.postMessage({ __vynt: 'handshake', token, workerUrl, settings }, '*')
  }

  function sendSettings() {
    window.postMessage({ __vynt: 'settings', token, settings }, '*')
  }

  chrome.storage.sync.get(STORAGE_KEY, (stored) => {
    settings = normalizeSettings(stored && stored[STORAGE_KEY])
    sendHandshake()

    // Whichever document_start script ran first, make sure the hook has settings before
    // Meet's bundle asks for the camera. Three tries over the first few seconds covers
    // the ordering race without leaving a listener running for the life of the tab.
    let tries = 0
    const retry = setInterval(() => {
      tries += 1
      sendHandshake()
      if (tries >= 3) clearInterval(retry)
    }, 750)
  })

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return
    settings = normalizeSettings(changes[STORAGE_KEY].newValue)
    sendSettings()
  })

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || typeof data !== 'object') return

    if (data.__vynt === 'hookReady') {
      sendHandshake()
      return
    }

    if (data.__vynt === 'telemetry') {
      // Telemetry from the MAIN world is untrusted. Keep it to two scalars so nothing
      // unvalidated ever reaches the extension side.
      const fps = Number.isFinite(data.fps) ? Math.max(0, Math.min(240, Math.round(data.fps))) : null
      lastTelemetry = {
        active: Boolean(data.active),
        filter: typeof data.filter === 'string' ? data.filter.slice(0, 16) : 'off',
        worker: Boolean(data.worker),
        fps,
        at: Date.now(),
      }

      chrome.runtime
        .sendMessage({ type: 'vynt-telemetry', telemetry: lastTelemetry })
        .catch(() => undefined)
    }
  })

  // The popup asks for live state on the active Meet tab.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'vynt-status') return false
    sendResponse({
      settings,
      telemetry: lastTelemetry,
      handshakeCount,
      workerUrl,
    })
    return false
  })
})()
