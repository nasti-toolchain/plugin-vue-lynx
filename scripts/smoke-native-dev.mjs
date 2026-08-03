import assert from 'node:assert/strict'
import { createServer as createTcpServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const exampleRoot = path.join(repositoryRoot, 'examples/basic')
const port = await findAvailablePort()

process.env['VUE_LYNX_NATIVE_BACKEND'] = '1'

const { createServer: createNastiServer } = await import(
  '@nasti-toolchain/nasti'
)

let server

try {
  server = await createNastiServer({
    root: exampleRoot,
    logLevel: 'warn',
    server: {
      host: '127.0.0.1',
      port,
    },
  })
  await server.listen(port)

  const service = server.environmentServices.lynx
  assert.ok(service, 'missing lynx native development service')
  const urls = [...(service.localUrls ?? []), ...(service.networkUrls ?? [])]
  assert.ok(urls.length > 0, 'missing lynx native development URL')

  const response = await fetchWhenReady(urls[0])
  assert.equal(
    response.status,
    200,
    `native bundle returned HTTP ${response.status}`,
  )
  const bytes = await response.arrayBuffer()
  assert.ok(bytes.byteLength > 0, 'native bundle was empty')

  process.stdout.write('Vue Lynx native development smoke test passed.\n')
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Native development bundle did not become ready: ${url}`, {
    cause: lastError,
  })
}
