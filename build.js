#!/usr/bin/env node
// Dependency-free build: `node build.js`.
//
// Copies the module sources into dist/ unchanged (the worker and the popup are ES
// modules) and produces two self-contained bundles by concatenation:
//
//   dist/inject/hook.js   core + pipeline + MAIN-world hook, wrapped in one IIFE
//   dist/content/bridge.js core/settings + isolated-world bridge, wrapped in one IIFE
//
// Wrapping in an IIFE is a hard requirement, not a nicety: the hook runs in the page's
// MAIN world, so any top-level identifier we leak becomes a global the page can
// overwrite. Keeping everything in closure scope is what keeps Meet from being able to
// redefine our own functions out from under us mid-call.
//
// No npm install is required. Node >= 16.

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const src = join(root, 'src')
const dist = join(root, 'dist')

function read(rel) {
  return readFileSync(join(src, rel), 'utf8')
}

// Some sources (renderer.js) are also ES modules so the worker and tests can import them.
// In the concatenated bundle their import lines must go away: the bundle already holds
// those functions in scope.
function stripExports(code) {
  return code
    .split('\n')
    .filter((line) => !/^import\s/.test(line))
    .map((line) => (line.startsWith('export ') ? line.slice('export '.length) : line))
    .join('\n')
}

function assertNoModules(code, label) {
  const bad = code.match(/^\s*(import|export)\s/m)
  if (bad) {
    throw new Error(`${label} still contains a module statement: "${bad[0].trim()}"`)
  }
}

function wrap(code) {
  return `;(function () {\n'use strict'\n${code}\n})()\n`
}

const core = [
  'core/filters.js',
  'core/fisheyeLut.js',
  'core/layout.js',
  'core/settings.js',
  'core/renderer.js',
]

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

// Static files and icons.
copyFileSync(join(root, 'manifest.json'), join(dist, 'manifest.json'))
cpSync(join(root, 'icons'), join(dist, 'icons'), { recursive: true })

// ES-module sources that the worker and popup import directly.
cpSync(join(src, 'core'), join(dist, 'core'), { recursive: true })
cpSync(join(src, 'worker'), join(dist, 'worker'), { recursive: true })
cpSync(join(src, 'popup'), join(dist, 'popup'), { recursive: true })
copyFileSync(join(src, 'background.js'), join(dist, 'background.js'))
mkdirSync(join(dist, 'inject'), { recursive: true })
mkdirSync(join(dist, 'content'), { recursive: true })

// Bundles.
const hookBundle = [
  ...core.map(read).map(stripExports),
  stripExports(read('pipeline/captureStreamSource.js')),
  stripExports(read('inject/hook.js')),
].join('\n\n')
assertNoModules(hookBundle, 'inject/hook.js')
writeFileSync(join(dist, 'inject', 'hook.js'), wrap(hookBundle))

const bridgeBundle = [stripExports(read('core/settings.js')), stripExports(read('content/bridge.entry.js'))].join('\n\n')
assertNoModules(bridgeBundle, 'content/bridge.js')
writeFileSync(join(dist, 'content', 'bridge.js'), wrap(bridgeBundle))

// Report.
const files = []
for (const rel of ['manifest.json', 'inject/hook.js', 'content/bridge.js', 'background.js']) {
  files.push(rel)
}
for (const f of readdirSync(join(dist, 'core'))) files.push('core/' + f)
for (const f of readdirSync(join(dist, 'worker'))) files.push('worker/' + f)
for (const f of readdirSync(join(dist, 'popup'))) files.push('popup/' + f)

console.log('built dist/:')
for (const f of files.sort()) {
  const size = existsSync(join(dist, f)) ? readFileSync(join(dist, f)).length : 0
  console.log(`  ${f.padEnd(24)} ${size} B`)
}
