import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  afterEach,
  describe,
  expect,
  test,
} from '@lightning-js/lightning'

import {
  normalizeBuildResult,
  normalizeServeResult,
} from '../src/normalize.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('Rspeedy result normalization', () => {
  test('collects emitted files and maps native entry bundles', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'vue-lynx-build-'))
    temporaryDirectories.push(outDir)
    await mkdir(path.join(outDir, 'assets'))
    await writeFile(path.join(outDir, 'main.lynx.bundle'), 'bundle')
    await writeFile(path.join(outDir, 'assets/icon.png'), 'png')

    const result = await normalizeBuildResult({
      environment: 'lynx',
      rspeedyEnvironment: 'lynx',
      outDir,
      publicPath: '/static',
      stats: {
        toJson: () => ({
          entrypoints: {
            main: {
              assets: ['main.lynx.bundle'],
            },
          },
        }),
      },
    })

    expect(result.output.map((item) => item.fileName)).toEqual([
      'assets/icon.png',
      'main.lynx.bundle',
    ])
    expect(result.output[1]?.type).toBe('chunk')
    expect(result.entries).toEqual({
      main: 'main.lynx.bundle',
    })
    expect(result.publicPath).toBe('/static/')
    expect(result.manifest).toMatchObject({
      environment: 'lynx',
      rspeedyEnvironment: 'lynx',
      assets: ['assets/icon.png', 'main.lynx.bundle'],
    })
  })

  test('emits device URLs, web previews, and QR metadata', async () => {
    const result = await normalizeServeResult({
      environment: 'web',
      rspeedyEnvironment: 'web',
      port: 3000,
      urls: ['http://localhost:3000/app', 'http://192.168.1.5:3000/app'],
      stats: {
        toJson: () => ({
          children: [
            {
              entrypoints: {
                main: {
                  assets: [{ name: 'main.web.bundle' }],
                },
              },
            },
          ],
        }),
      },
    })

    expect(result.localUrls).toEqual([
      'http://localhost:3000/app/main.web.bundle',
    ])
    expect(result.networkUrls).toEqual([
      'http://192.168.1.5:3000/app/main.web.bundle',
    ])
    expect(result.metadata.previewUrls).toEqual([
      'http://localhost:3000/app/__web_preview?casename=main.web.bundle',
      'http://192.168.1.5:3000/app/__web_preview?casename=main.web.bundle',
    ])
    expect(result.metadata.qrCodes).toHaveLength(2)
  })
})
