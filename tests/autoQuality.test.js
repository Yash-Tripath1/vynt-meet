import test from 'node:test'
import assert from 'node:assert/strict'

import { decideBoost, AUTO_QUALITY } from '../src/core/autoQuality.js'

test('low fps steps the boost up', () => {
  assert.equal(decideBoost({ fps: 15, currentBoost: 0 }), 1)
  assert.equal(decideBoost({ fps: AUTO_QUALITY.lowFps - 1, currentBoost: 2 }), 3)
})

test('healthy fps holds the boost', () => {
  assert.equal(decideBoost({ fps: 30, currentBoost: 0 }), 0)
  assert.equal(decideBoost({ fps: AUTO_QUALITY.lowFps, currentBoost: 1 }), 1, 'boundary is not low')
})

test('boost is capped at the maximum', () => {
  assert.equal(decideBoost({ fps: 5, currentBoost: AUTO_QUALITY.maxBoost }), AUTO_QUALITY.maxBoost)
})

test('non-numeric fps changes nothing', () => {
  assert.equal(decideBoost({ fps: NaN, currentBoost: 2 }), 2)
  assert.equal(decideBoost({ fps: undefined, currentBoost: 1 }), 1)
})

test('boost never auto-reduces (no flapping)', () => {
  // Even a great frame rate after a bad stretch keeps the current boost.
  assert.equal(decideBoost({ fps: 60, currentBoost: 3 }), 3)
})
