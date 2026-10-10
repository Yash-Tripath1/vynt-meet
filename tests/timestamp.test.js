// The date stamp used to sit bottom-left -- exactly where Google Meet draws the
// participant's name over your tile. The default is now bottom-right; these tests pin the
// geometry of every corner so the fix can't regress.

import test from 'node:test'
import assert from 'node:assert/strict'

import { drawTimestamp } from '../src/core/filters.js'

const W = 640
const H = 360
const PAD = Math.max(14, Math.round(W * 0.03))

function capture() {
  const calls = []
  return {
    calls,
    textAlign: null,
    textBaseline: null,
    save() {},
    restore() {},
    strokeText(text, x, y) {
      calls.push({ op: 'strokeText', text, x, y, align: this.textAlign, baseline: this.textBaseline })
    },
    fillText() {},
  }
}

test('default corner is bottom-right, clear of Meet\'s name label', () => {
  const ctx = capture()
  drawTimestamp(ctx, W, H, new Date(2026, 0, 2, 13, 4, 9))
  const call = ctx.calls[0]
  assert.equal(call.align, 'right')
  assert.equal(call.baseline, 'bottom')
  assert.equal(call.x, W - PAD)
  assert.equal(call.y, H - PAD)
})

test('bottom-left keeps the classic digicam position', () => {
  const ctx = capture()
  drawTimestamp(ctx, W, H, new Date(), 'bottom-left')
  const call = ctx.calls[0]
  assert.equal(call.align, 'left')
  assert.equal(call.baseline, 'bottom')
  assert.equal(call.x, PAD)
  assert.equal(call.y, H - PAD)
})

test('top corners flip the baseline', () => {
  const tl = capture()
  drawTimestamp(tl, W, H, new Date(), 'top-left')
  assert.equal(tl.calls[0].align, 'left')
  assert.equal(tl.calls[0].baseline, 'top')
  assert.equal(tl.calls[0].y, PAD)

  const tr = capture()
  drawTimestamp(tr, W, H, new Date(), 'top-right')
  assert.equal(tr.calls[0].align, 'right')
  assert.equal(tr.calls[0].baseline, 'top')
  assert.equal(tr.calls[0].x, W - PAD)
})

test('an unknown corner falls back to left/bottom rather than throwing', () => {
  const ctx = capture()
  drawTimestamp(ctx, W, H, new Date(), 'center-ish')
  assert.equal(ctx.calls[0].align, 'left')
  assert.equal(ctx.calls[0].baseline, 'bottom')
})
