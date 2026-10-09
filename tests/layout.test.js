import test from 'node:test'
import assert from 'node:assert/strict'

import { computeCoverCrop, drawCover } from '../src/core/layout.js'

test('matching aspects crop the full source', () => {
  const crop = computeCoverCrop(1280, 720, 640, 360, 1)
  assert.equal(crop.sx, 0)
  assert.equal(crop.sy, 0)
  assert.equal(crop.sw, 1280)
  assert.equal(crop.sh, 720)
})

test('source wider than target crops horizontally', () => {
  // 16:9 source into a 4:3 box keeps full height and trims the sides.
  const crop = computeCoverCrop(1280, 720, 640, 480, 1)
  assert.equal(crop.sh, 720)
  assert.equal(crop.sw, 720 * (640 / 480))
  assert.equal(crop.sx, (1280 - crop.sw) / 2)
  assert.equal(crop.sy, 0)
})

test('source taller than target crops vertically', () => {
  const crop = computeCoverCrop(720, 1280, 640, 480, 1)
  assert.equal(crop.sw, 720)
  assert.equal(crop.sh, 720 / (640 / 480))
  assert.equal(crop.sx, 0)
  assert.equal(crop.sy, (1280 - crop.sh) / 2)
})

test('zoom narrows the crop and re-centres it', () => {
  const base = computeCoverCrop(1280, 720, 640, 360, 1)
  const zoomed = computeCoverCrop(1280, 720, 640, 360, 2)
  assert.equal(zoomed.sw, base.sw / 2)
  assert.equal(zoomed.sh, base.sh / 2)
  assert.equal(zoomed.sx, (1280 - zoomed.sw) / 2)
})

test('drawCover without mirror is a single straight blit', () => {
  const calls = []
  const ctx = {
    clearRect: (...a) => calls.push(['clearRect', ...a]),
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (...a) => calls.push(['translate', ...a]),
    scale: (...a) => calls.push(['scale', ...a]),
    drawImage: (...a) => calls.push(['drawImage', ...a]),
  }
  drawCover(ctx, 'src', 320, 180, false)
  assert.ok(!calls.some(([op]) => op === 'translate'), 'no mirror transform')
  assert.deepEqual(calls.find(([op]) => op === 'drawImage'), ['drawImage', 'src', 0, 0, 320, 180])
})

test('drawCover with mirror flips horizontally', () => {
  const calls = []
  const ctx = {
    clearRect: () => {},
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (...a) => calls.push(['translate', ...a]),
    scale: (...a) => calls.push(['scale', ...a]),
    drawImage: (...a) => calls.push(['drawImage', ...a]),
  }
  drawCover(ctx, 'src', 320, 180, true)
  assert.deepEqual(calls.find(([op]) => op === 'translate'), ['translate', 320, 0])
  assert.deepEqual(calls.find(([op]) => op === 'scale'), ['scale', -1, 1])
})
