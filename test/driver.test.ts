import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from '@lightning-js/lightning'
import type {
  EnvironmentDriverContext,
  EnvironmentInstance,
  ResolvedConfig,
} from '@nasti-toolchain/nasti'

import type { RspeedyRuntime } from '../src/dependencies.js'
import { createRspeedyEnvironmentDriver } from '../src/driver.js'
import { createPluginApiController } from '../src/plugin-api.js'
import type { VueLynxBridgeEvent } from '../src/types.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('Rspeedy environment driver', () => {
  test('builds, serves, bridges changes, and closes resources once', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vue-lynx-driver-'))
    temporaryDirectories.push(root)
    const config = {
      root,
      base: '/',
      mode: 'production',
      command: 'build',
      server: {
        host: 'localhost',
        port: 3000,
        hmr: true,
        cors: true,
        proxy: {},
      },
    } as unknown as ResolvedConfig
    const environment = {
      name: 'lynx',
      consumer: 'client',
      mode: 'build',
      config,
      options: {
        consumer: 'client',
        driver: 'rspeedy',
        entry: ['./src/index.ts'],
        build: {
          outDir: 'dist/lynx',
          sourcemap: false,
          minify: false,
          cssMinify: false,
          emptyOutDir: true,
        },
      },
    } as EnvironmentInstance
    const buildClose = vi.fn(async () => {})
    const serverClose = vi.fn(async () => {})
    const events: VueLynxBridgeEvent[] = []
    const apiController = createPluginApiController({
      onEvent(event) {
        events.push(event)
      },
    })
    const runtime: RspeedyRuntime = {
      rspeedyVersion: '0.14.5',
      vueLynxVersion: '0.5.1',
      async createRspeedy() {
        return {
          context: {
            distPath: path.join(root, 'dist/lynx'),
          },
          async build() {
            await mkdir(path.join(root, 'dist/lynx'), { recursive: true })
            await writeFile(
              path.join(root, 'dist/lynx/main.lynx.bundle'),
              'bundle',
            )
            return {
              stats: {
                toJson: () => ({
                  entrypoints: {
                    main: {
                      assets: ['main.lynx.bundle'],
                    },
                  },
                }),
              },
              close: buildClose,
            }
          },
          async createDevServer() {
            return {
              environments: {
                lynx: {
                  async getStats() {
                    return {
                      toJson: () => ({
                        entrypoints: {
                          main: {
                            assets: ['main.lynx.bundle'],
                          },
                        },
                      }),
                    }
                  },
                },
              },
              async listen() {
                return {
                  port: 3000,
                  urls: ['http://localhost:3000/'],
                }
              },
              close: serverClose,
            }
          },
        }
      },
      mergeRspeedyConfig(...configs) {
        return Object.assign({}, ...configs)
      },
      pluginVueLynx() {
        return []
      },
    }
    const driver = createRspeedyEnvironmentDriver({
      environment,
      target: {
        name: 'lynx',
        rspeedyEnvironment: 'lynx',
        entry: './src/index.ts',
        outDir: 'dist/lynx',
        kind: 'lynx',
      },
      pluginOptions: {},
      apiController,
      loadRuntime: async () => runtime,
    })
    const context = {
      environment,
      config,
      logger: {
        info: vi.fn(),
      },
    } as unknown as EnvironmentDriverContext

    const buildResult = await driver.build?.(context)
    expect(buildResult?.entries).toEqual({
      main: 'main.lynx.bundle',
    })

    const serveResult = await driver.serve?.({
      ...context,
      server: {} as never,
    })
    expect(serveResult?.localUrls).toEqual([
      'http://localhost:3000/main.lynx.bundle',
    ])

    await driver.watchChange?.(
      path.join(root, 'src/index.ts'),
      'change',
      context,
    )
    await driver.close?.(context)
    await driver.close?.(context)

    expect(buildClose).toHaveBeenCalledTimes(1)
    expect(serverClose).toHaveBeenCalledTimes(1)
    expect(events.map((event) => event.type)).toEqual([
      'build',
      'serve',
      'change',
      'close',
    ])
    expect(apiController.api.getEnvironment('lynx')).toMatchObject({
      status: 'closed',
    })
  })
})
