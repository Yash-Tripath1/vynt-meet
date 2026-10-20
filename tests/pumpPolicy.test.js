// The background-tab freeze fix: the worker ticks pump the render chain only when it
// has gone silent, and frame grabbing falls back to the camera track when the hidden
// <video> element stops advancing. Both decisions are pure -- and pinned here.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  shouldPumpFromTick,
  nextGrabMode,
  noteElementTime,
  TICK_SLACK,
  STALL_MS,
} from '../src/core/pumpPolicy.js'

test('a live render chain keeps ticks as no-ops', () => {
  // rVFC drew 20ms ago; the chain is healthy, the tick must not double-pump.
  assert.equal(shouldPumpFromTick({ now: 1000, lastDrawTime: 980, interval: 33 }), false)
})

test('a silent chain (hidden tab) lets a tick pump', () => {
  // Nothing has drawn for well over two frame periods.
  assert.equal(shouldPumpFromTick({ now: 5000, lastDrawTime: 1000, interval: 33 }), true)
})

test('the silence threshold is TICK_SLACK frame periods', () => {
  const interval = 33
  const last = 1000
  assert.equal(shouldPumpFromTick({ now: last + interval * (TICK_SLACK - 0.5), lastDrawTime: last, interval }), false)
  assert.equal(shouldPumpFromTick({ now: last + interval * TICK_SLACK, lastDrawTime: last, interval }), true)
})

test('bad clock inputs fail open (better to draw than to freeze)', () => {
  assert.equal(shouldPumpFromTick({ now: NaN, lastDrawTime: 1, interval: 33 }), true)
  assert.equal(shouldPumpFromTick({ now: 1, lastDrawTime: NaN, interval: 33 }), true)
  assert.equal(shouldPumpFromTick({ now: 1, lastDrawTime: 1, interval: 0 }), true)
})

test('grab mode follows element health', () => {
  assert.equal(nextGrabMode({ mode: 'element', elementStalled: false }), 'element')
  assert.equal(nextGrabMode({ mode: 'element', elementStalled: true }), 'track')
  assert.equal(nextGrabMode({ mode: 'track', elementStalled: true }), 'track')
  assert.equal(nextGrabMode({ mode: 'track', elementStalled: false }), 'element')
})

test('a slow camera does not read as a stalled element', () => {
  // 10 fps camera: consecutive samples within one camera frame legitimately repeat.
  const state = { lastTime: null, since: 0 }
  assert.equal(noteElementTime(state, 3.2, 0), false)
  assert.equal(noteElementTime(state, 3.2, 100), false) // same frame, 100ms apart
  assert.equal(noteElementTime(state, 3.2, 250), false) // still under STALL_MS
  assert.equal(noteElementTime(state, 3.3, 300), false) // clock advanced -> healthy
})

test('a frozen element is detected only after STALL_MS', () => {
  const state = { lastTime: null, since: 0 }
  assert.equal(noteElementTime(state, 7.5, 0), false)
  assert.equal(noteElementTime(state, 7.5, STALL_MS - 1), false)
  assert.equal(noteElementTime(state, 7.5, STALL_MS), true)
  assert.equal(noteElementTime(state, 7.5, STALL_MS + 500), true)
  // Recovery: one advance clears the verdict.
  assert.equal(noteElementTime(state, 7.6, STALL_MS + 501), false)
})
