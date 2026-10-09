import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeSettings, DEFAULT_SETTINGS, FILTER_IDS, getFilterShortLabel } from '../src/core/settings.js'

test('defaults are applied when given nothing', () => {
  const s = normalizeSettings(null)
  assert.deepEqual(s, DEFAULT_SETTINGS)
  assert.equal(s.filterMode, 'vyntage')
})

test('unknown filter ids fall back to the default', () => {
  const s = normalizeSettings({ filterMode: 'not-a-filter' })
  assert.equal(s.filterMode, DEFAULT_SETTINGS.filterMode)
})

test('every FILTERS id is accepted', () => {
  for (const id of FILTER_IDS) {
    assert.equal(normalizeSettings({ filterMode: id }).filterMode, id)
  }
})

test('numeric values are clamped and coerced', () => {
  const s = normalizeSettings({ pixelSize: 999, grain: -5, zoom: 7, fpsCap: 400 })
  assert.equal(s.pixelSize, 10)
  assert.equal(s.grain, 0)
  assert.equal(s.zoom, 2)
  assert.equal(s.fpsCap, 60)

  const t = normalizeSettings({ pixelSize: '3', grain: '40', zoom: '1.5' })
  assert.equal(t.pixelSize, 3)
  assert.equal(t.grain, 40)
  assert.equal(t.zoom, 1.5)
})

test('non-numeric and hostile values become defaults', () => {
  const s = normalizeSettings({
    pixelSize: 'abc',
    grain: NaN,
    zoom: Infinity,
    enabled: 'yes',
    mirror: 1,
    filterMode: { toString: () => 'vhs' },
  })
  assert.equal(s.pixelSize, DEFAULT_SETTINGS.pixelSize)
  assert.equal(s.grain, DEFAULT_SETTINGS.grain)
  assert.equal(s.zoom, DEFAULT_SETTINGS.zoom)
  assert.equal(s.enabled, true) // 'yes' is not a boolean
  assert.equal(s.mirror, false)
  assert.equal(s.filterMode, DEFAULT_SETTINGS.filterMode)
})

test('short labels resolve', () => {
  assert.equal(getFilterShortLabel('vyntage'), 'VYNT')
  assert.equal(getFilterShortLabel('unknown'), 'RAW')
})
