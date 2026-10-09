import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveOutputSize, MAX_OUTPUT_WIDTH } from '../src/pipeline/captureStreamSource.js'

test('common resolutions pass through unchanged', () => {
  assert.deepEqual(resolveOutputSize(1280, 720), { width: 1280, height: 720 })
  assert.deepEqual(resolveOutputSize(640, 360), { width: 640, height: 360 })
  assert.deepEqual(resolveOutputSize(640, 480), { width: 640, height: 480 })
})

test('large sources are capped to the max output width', () => {
  const size = resolveOutputSize(1920, 1080)
  assert.equal(size.width, MAX_OUTPUT_WIDTH)
  assert.equal(size.height, 720)
  assert.equal(size.height % 2, 0, 'encoder-friendly even height')
})

test('degenerate input falls back to sane defaults', () => {
  assert.deepEqual(resolveOutputSize(0, 0), { width: 1280, height: 720 })
  assert.deepEqual(resolveOutputSize(-5, NaN), { width: 1280, height: 720 })
})
