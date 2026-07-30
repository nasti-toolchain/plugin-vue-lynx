import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { decode_napi as decode } from '@lynx-js/tasm'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const bundlePath = path.join(
  repositoryRoot,
  'examples/basic/dist/lynx/main.lynx.bundle',
)
const source = await readFile(bundlePath)
assert.ok(source.byteLength > 0, 'native bundle is empty')

const decoded = decode(source)
const serialized = JSON.stringify(decoded)
assert.match(serialized, /app-service\.js/, 'missing app-service manifest')
assert.match(serialized, /background\.js/, 'missing background manifest')
assert.equal(decoded['is-lepusng-binary'], true, 'main thread is not bytecode')
assert.ok(
  decoded['main-thread-script']?.lepus_code_len > 0,
  'missing main-thread bytecode',
)
assert.ok(
  decoded['background-thread-script']?.length >= 2,
  'missing background scripts',
)

const mainThread = await readFile(
  path.join(
    repositoryRoot,
    'examples/basic/dist/lynx/.nasti/main/main-thread/main-thread.js',
  ),
  'utf8',
)
const background = await readFile(
  path.join(
    repositoryRoot,
    'examples/basic/dist/lynx/.nasti/main/background/background.js',
  ),
  'utf8',
)
assert.match(mainThread, /registerWorkletInternal/, 'missing worklet registration')
assert.match(mainThread, /Nasti native backend/, 'missing worklet application code')
assert.match(background, /Nasti × Vue Lynx/, 'missing background application code')

process.stdout.write(
  `Decoded and verified ${path.relative(repositoryRoot, bundlePath)}.\n`,
)
