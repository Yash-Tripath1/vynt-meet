import test from 'node:test'
import assert from 'node:assert/strict'

import { createRenderer } from '../src/core/renderer.js'
import { makeCtx, withSeededRandom } from './helpers.js'

// The renderer falls back to document.createElement in environments without
// OffscreenCanvas (i.e. Node). We record every working canvas it creates so tests can
// observe whether the pixel loop ran at all.
let createdWorkingContexts = []
globalThis.document = {
  createElement() {
    const el = {
      width: 0,
      height: 0,
      getContext() {
        const ctx = makeCtx(Math.max(1, el.width), Math.max(1, el.height))
        createdWorkingContexts.push(ctx)
        return ctx
      },
    }
    return el
  },
}

const BASE = {
  filterMode: 'vyntage',
  pixelSize: 3,
  grain: 34,
  zoom: 1,
  mirror: false,
  dateImprint: false,
  fpsCap: 30,
}

function target() {
  const canvas = { width: 0, height: 0 }
  const ctx = makeCtx(1, 1)
  ctx._drawCalls = 0
  ctx.drawImage = () => {
    ctx._drawCalls += 1
  }
  return { canvas, ctx }
}

test.beforeEach(() => {
  createdWorkingContexts = []
})

test('slow path reads pixels through the working canvas', async () => {
  await withSeededRandom(99, () => {
    const render = createRenderer()
    const { canvas, ctx } = target()
    render(ctx, canvas, 320, 180, {}, BASE)

    assert.ok(createdWorkingContexts.length >= 1, 'expected a working canvas')
    const work = createdWorkingContexts[0]
    assert.ok(work._log.some(([op]) => op === 'getImageData'), 'expected pixel readback')
    assert.ok(work._log.some(([op]) => op === 'putImageData'), 'expected pixel writeback')
    assert.equal(ctx._drawCalls, 1, 'upscale blit onto the target')
  })
})

test('passthrough fast path does a single blit and no working canvas at all', () => {
  const render = createRenderer()
  const { canvas, ctx } = target()
  render(ctx, canvas, 320, 180, {}, { ...BASE, filterMode: 'original', grain: 0, pixelSize: 1 })

  assert.equal(createdWorkingContexts.length, 0, 'fast path must not allocate a working canvas')
  assert.equal(ctx._drawCalls, 1, 'exactly one cover blit')
})

test('renderer resizes the target canvas to the requested size', () => {
  const render = createRenderer()
  const { canvas, ctx } = target()
  render(ctx, canvas, 320, 180, {}, { ...BASE, filterMode: 'original', grain: 0, pixelSize: 1 })
  assert.equal(canvas.width, 320)
  assert.equal(canvas.height, 180)
})
