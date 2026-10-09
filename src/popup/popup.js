import { FILTERS, STORAGE_KEY, normalizeSettings } from '../core/settings.js'

const elements = {
  toggle: document.getElementById('toggle'),
  toggleState: document.getElementById('toggleState'),
  filters: document.getElementById('filters'),
  controls: document.getElementById('controls'),
  pixel: document.getElementById('pixel'),
  grain: document.getElementById('grain'),
  zoom: document.getElementById('zoom'),
  pixelOut: document.getElementById('pixelOut'),
  grainOut: document.getElementById('grainOut'),
  zoomOut: document.getElementById('zoomOut'),
  dateImprint: document.getElementById('dateImprint'),
  mirror: document.getElementById('mirror'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  footnote: document.getElementById('footnote'),
}

let settings = normalizeSettings(null)
let saveTimer = null

function save() {
  // Debounced: a slider drag fires many change events and chrome.storage.sync has a
  // write-rate limit.
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    chrome.storage.sync.set({ [STORAGE_KEY]: settings })
  }, 120)
}

function renderFilters() {
  elements.filters.textContent = ''
  for (const filter of FILTERS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'chip'
    button.textContent = filter.label
    button.setAttribute('role', 'radio')
    button.setAttribute('aria-checked', String(filter.id === settings.filterMode))
    if (filter.id === settings.filterMode) button.classList.add('is-active')
    button.addEventListener('click', () => {
      settings = normalizeSettings({ ...settings, filterMode: filter.id })
      renderFilters()
      save()
    })
    elements.filters.appendChild(button)
  }
}

function renderControls() {
  elements.pixel.value = String(settings.pixelSize)
  elements.grain.value = String(settings.grain)
  elements.zoom.value = String(settings.zoom)
  elements.pixelOut.textContent = String(settings.pixelSize)
  elements.grainOut.textContent = String(settings.grain)
  elements.zoomOut.textContent = settings.zoom.toFixed(2) + 'x'
  elements.dateImprint.checked = settings.dateImprint
  elements.mirror.checked = settings.mirror

  const dimmed = !settings.enabled
  elements.filters.classList.toggle('is-dimmed', dimmed)
  elements.controls.classList.toggle('is-dimmed', dimmed)
  elements.toggle.setAttribute('aria-pressed', String(settings.enabled))
  elements.toggleState.textContent = settings.enabled ? 'ON' : 'OFF'
  elements.toggle.classList.toggle('is-off', dimmed)
}

function render() {
  renderFilters()
  renderControls()
}

elements.toggle.addEventListener('click', () => {
  settings = normalizeSettings({ ...settings, enabled: !settings.enabled })
  renderControls()
  save()
})

elements.pixel.addEventListener('input', (event) => {
  settings = normalizeSettings({ ...settings, pixelSize: Number(event.target.value) })
  renderControls()
  save()
})

elements.grain.addEventListener('input', (event) => {
  settings = normalizeSettings({ ...settings, grain: Number(event.target.value) })
  renderControls()
  save()
})

elements.zoom.addEventListener('input', (event) => {
  settings = normalizeSettings({ ...settings, zoom: Number(event.target.value) })
  renderControls()
  save()
})

elements.dateImprint.addEventListener('change', (event) => {
  settings = normalizeSettings({ ...settings, dateImprint: event.target.checked })
  save()
})

elements.mirror.addEventListener('change', (event) => {
  settings = normalizeSettings({ ...settings, mirror: event.target.checked })
  save()
})

function describeStatus(state) {
  if (!state) {
    elements.statusDot.className = 'dot is-idle'
    elements.statusText.textContent = 'No Google Meet tab in focus'
    elements.footnote.textContent =
      'Open meet.google.com and join a call. VYNT replaces the camera feed Meet transmits, so your own tile shows the result.'
    return
  }

  if (!state.handshakeCount) {
    elements.statusDot.className = 'dot is-idle'
    elements.statusText.textContent = 'Meet tab found, waiting for the page'
    return
  }

  const telemetry = state.telemetry
  if (!telemetry || !telemetry.active) {
    elements.statusDot.className = 'dot is-armed'
    elements.statusText.textContent = 'Ready - waiting for Meet to request the camera'
    elements.footnote.textContent =
      'Meet asks for the camera when you join. If you are already in a call, turn your camera off and on again to pick up VYNT.'
    return
  }

  const fps = Number.isFinite(telemetry.fps) ? ` ${telemetry.fps} fps` : ''
  const surface = telemetry.worker ? 'worker' : 'main thread'
  elements.statusDot.className = 'dot is-live'
  elements.statusText.textContent = `Live - ${telemetry.filter.toUpperCase()}${fps} - ${surface}`
  elements.footnote.textContent = settings.enabled
    ? 'Changes apply immediately. Your video is filtered on this device and never uploaded.'
    : 'VYNT is off, so Meet is getting an unfiltered passthrough of your camera.'
}

async function refreshStatus() {
  let tabId = null
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    tabId = tab ? tab.id : null
  } catch (error) {
    tabId = null
  }

  if (typeof tabId !== 'number') {
    describeStatus(null)
    return
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'vynt-status' })
    describeStatus(response || null)
  } catch (error) {
    // No content script on this tab: it is not Meet.
    describeStatus(null)
  }
}

async function init() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY)
  settings = normalizeSettings(stored && stored[STORAGE_KEY])
  render()
  await refreshStatus()
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes[STORAGE_KEY]) return
  settings = normalizeSettings(changes[STORAGE_KEY].newValue)
  render()
})

void init()
setInterval(() => void refreshStatus(), 1500)
