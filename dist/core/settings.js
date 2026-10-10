// Single source of truth for settings, shared by the popup, the bridge and the
// injected hook. Values are validated on the way in because the MAIN world is shared
// with the page: anything crossing that boundary is untrusted input.

export const FILTERS = [
  { id: 'original', label: 'ORIGINAL', shortLabel: 'RAW' },
  { id: 'vyntage', label: 'VYNTAGE', shortLabel: 'VYNT' },
  { id: 'digicam', label: '2007 DIGICAM', shortLabel: '2007' },
  { id: 'nightflash', label: 'NIGHT FLASH', shortLabel: 'FLASH' },
  { id: 'neoncity', label: 'NEON CITY', shortLabel: 'NEON' },
  { id: 'fisheye', label: 'FISHEYE', shortLabel: 'FISH' },
  { id: 'vhs', label: 'VHS TAPE', shortLabel: 'VHS' },
  { id: 'goldenfilm', label: 'GOLDEN FILM', shortLabel: 'FILM' },
]

export const FILTER_IDS = FILTERS.map((f) => f.id)

export const LIMITS = {
  pixelSize: { min: 1, max: 10, step: 1 },
  grain: { min: 0, max: 100, step: 1 },
  zoom: { min: 1, max: 2, step: 0.05 },
}

// Meet overlays the participant name on the bottom-left of each tile, so the date stamp
// defaults to the opposite corner. All four are offered for the classic look.
export const STAMP_CORNERS = ['bottom-right', 'bottom-left', 'top-left', 'top-right']

export const DEFAULT_SETTINGS = {
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

export const STORAGE_KEY = 'vyntSettings'

function toNumber(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Coerce anything -- a storage read, a postMessage payload, a forged page event --
 * into a settings object that is safe to render with. Unknown keys are dropped.
 */
export function normalizeSettings(input) {
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

export function getFilterLabel(filterMode) {
  return FILTERS.find((f) => f.id === filterMode)?.label ?? 'ORIGINAL'
}

export function getFilterShortLabel(filterMode) {
  return FILTERS.find((f) => f.id === filterMode)?.shortLabel ?? 'RAW'
}
