;(function () {
'use strict'
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
        auto: Boolean(data.auto),
        pixel: Number.isFinite(data.pixel) ? Math.max(1, Math.min(10, Math.round(data.pixel))) : null,
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

})()
