import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

// Make sure dist is freshly built so these assertions are meaningful.
test.before(() => {
  execFileSync(process.execPath, [join(root, 'build.js')], { cwd: root })
})

function readDist(rel) {
  const p = join(dist, rel)
  assert.ok(existsSync(p), `missing dist file: ${rel}`)
  return readFileSync(p, 'utf8')
}

for (const rel of ['inject/hook.js', 'content/bridge.js']) {
  test(`${rel} is a self-contained IIFE with no module statements`, () => {
    const code = readDist(rel)
    assert.ok(code.trimStart().startsWith(';(function ()'), `${rel} must open with an IIFE`)
    assert.ok(code.trimEnd().endsWith('})()'), `${rel} must close the IIFE`)
    assert.ok(!/^\s*(import|export)\s/m.test(code), `${rel} leaked a module statement`)
  })
}

test('hook bundle defines the pipeline the hook uses', () => {
  const code = readDist('inject/hook.js')
  for (const symbol of ['createCaptureStreamSource', 'normalizeSettings', 'computeCoverCrop', 'applyPreset', 'getFisheyeLut']) {
    assert.ok(code.includes(symbol), `hook bundle missing ${symbol}`)
  }
})

test('manifest matches the dist layout', () => {
  const manifest = JSON.parse(readDist('manifest.json'))
  for (const entry of manifest.content_scripts) for (const js of entry.js) assert.ok(existsSync(join(dist, js)), `content_script ${js} missing`)
  for (const res of manifest.web_accessible_resources[0].resources) {
    // core/*.js is a glob; check at least the concrete ones exist.
    if (res.includes('*')) continue
    assert.ok(existsSync(join(dist, res)), `web_accessible ${res} missing`)
  }
  assert.ok(existsSync(join(dist, 'core/renderer.js')))
  assert.ok(existsSync(join(dist, manifest.background.service_worker)))
})
