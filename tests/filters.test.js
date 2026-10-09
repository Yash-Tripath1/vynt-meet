// Proves the ported filter maths in src/core/filters.js are pixel-identical to the
// upstream implementation in Yash-Tripath1/Vynt (src/App.tsx), which we ship verbatim as
// tests/fixtures/originalAppFilters.cjs.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import * as ported from '../src/core/filters.js'
import { getFisheyeLut } from '../src/core/fisheyeLut.js'
import { makeCtx, maxAbsDiff, withSeededRandom } from './helpers.js'

const require = createRequire(import.meta.url)
const original = require('./fixtures/originalAppFilters.cjs')

const FILTERS = ['original', 'vyntage', 'digicam', 'nightflash', 'neoncity', 'fisheye', 'vhs', 'goldenfilm']
const W = 64
const H = 40
const GRAIN = 34

// Each run must see the *same* seeded random sequence, so the seed is reset immediately
// before each side of the comparison. (Running them under one stream would feed the
// second call a different noise sequence and make every grainy filter "diverge".)
test('ported filters are pixel-identical to upstream for all 8 modes', async () => {
  for (const filter of FILTERS) {
    const ctxA = makeCtx(W, H) // upstream
    const ctxB = makeCtx(W, H) // ported

    await withSeededRandom(1337, () => original.applyPreset(ctxA, W, H, filter, GRAIN))
    await withSeededRandom(1337, () => ported.applyPreset(ctxB, W, H, filter, GRAIN))

    const diff = maxAbsDiff(ctxA._backing, ctxB._backing)
    assert.equal(diff, 0, `${filter} diverged by ${diff}`)
  }
})

test('ported filters with the fisheye LUT are pixel-identical to upstream', async () => {
  const ctxA = makeCtx(W, H)
  const ctxB = makeCtx(W, H)

  await withSeededRandom(4242, () => original.applyPreset(ctxA, W, H, 'fisheye', GRAIN))
  await withSeededRandom(4242, () => ported.applyPreset(ctxB, W, H, 'fisheye', GRAIN, getFisheyeLut(W, H)))

  assert.equal(maxAbsDiff(ctxA._backing, ctxB._backing), 0)
})

test('original with zero grain is a no-op (fast path safe)', async () => {
  await withSeededRandom(7, () => {
    const ctx = makeCtx(W, H)
    const before = ctx._backing.slice()
    ported.applyPreset(ctx, W, H, 'original', 0)
    assert.equal(maxAbsDiff(before, ctx._backing), 0)
  })
})

test('getEffectivePixelSize matches upstream formula', () => {
  for (const p of [1, 2, 3, 5, 10]) {
    assert.equal(ported.getEffectivePixelSize(p), original.getEffectivePixelSize(p))
  }
})
