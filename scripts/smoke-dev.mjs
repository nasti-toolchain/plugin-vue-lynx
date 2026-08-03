import assert from 'node:assert/strict'
import { createServer as createTcpServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServer as createNastiServer } from '@nasti-toolchain/nasti'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const exampleRoot = path.join(repositoryRoot, 'examples/basic')
const port = await findAvailablePort()

// Example defaults to the native backend; force Rspeedy for this smoke path.
process.env['VUE_LYNX_RSPEEDY_BACKEND'] = '1'

let server

try {
  server = await createNastiServer({
    root: exampleRoot,
    logLevel: 'silent',
    server: {
      host: '127.0.0.1',
      port,
    },
  })
  await server.listen(port)

  for (const environment of ['lynx', 'web']) {
    const service = server.environmentServices[environment]
    assert.ok(service, `missing ${environment} development service`)
    const urls = [...(service.localUrls ?? []), ...(service.networkUrls ?? [])]
    assert.ok(urls.length > 0, `missing ${environment} development URL`)

    const response = await fetchWhenReady(urls[0])
    assert.equal(
      response.status,
      200,
      `${environment} bundle returned HTTP ${response.status}`,
    )
    assert.ok(
      Number(response.headers.get('content-length') ?? 0) > 0 ||
        (await response.arrayBuffer()).byteLength > 0,
      `${environment} bundle was empty`,
    )
  }

  process.stdout.write('Vue Lynx development smoke test passed.\n')
} finally {
  await server?.close()
}

async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = createTcpServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const availablePort =
        address && typeof address === 'object' ? address.port : undefined
      probe.close((error) => {
        if (error) reject(error)
        else resolve(availablePort)
      })
    })
  })
}

async function fetchWhenReady(url) {
  let lastError
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Development bundle did not become ready: ${url}`, {
    cause: lastError,
  })
}
