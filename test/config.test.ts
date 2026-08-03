import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from '@lightning-js/lightning'
import type {
  EnvironmentInstance,
  ResolvedConfig,
} from '@nasti-toolchain/nasti'
import type { Config as RspeedyConfig } from '@lynx-js/rspeedy'

import {
  createRspeedyConfig,
  extendNastiConfig,
  resolveNativeEntry,
  resolveTargets,
} from '../src/config.js'
import type { RspeedyRuntime } from '../src/dependencies.js'
import { pluginVueLynx } from '../src/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('Vue Lynx target configuration', () => {
  test('registers explicit Lynx and optional web environments', async () => {
    const targets = resolveTargets({
      entry: {
        app: {
          import: ['./src/polyfill.ts', './src/index.ts'],
        },
      },
      outDir: 'output/native',
      web: {
        outDir: 'output/web',
      },
    })
    const config = extendNastiConfig({ root }, targets)

    expect(config.environments?.client).toMatchObject({
      consumer: 'client',
      buildEnabled: false,
    })
    expect(config.environments?.client?.driver).toBeUndefined()
    expect(config.environments?.lynx).toMatchObject({
      consumer: 'client',
      driver: 'rspeedy',
      entry: ['./src/polyfill.ts', './src/index.ts'],
      build: {
        outDir: 'output/native',
      },
    })
    expect(config.environments?.web).toMatchObject({
      consumer: 'client',
      driver: 'rspeedy',
      build: {
        outDir: 'output/web',
      },
    })
  })

  test('maps resolved Nasti values into an Rspeedy configuration', async () => {
    const pluginOptions = {
      entry: './src/index.ts',
      publicPath: '/assets/',
      web: false,
    } as const
    const config = {
      root,
      base: '/app/',
      mode: 'development',
      command: 'serve',
      server: {
        host: true,
        port: 4321,
        hmr: false,
        cors: true,
        proxy: {},
      },
    } as unknown as ResolvedConfig
    const environment = {
      name: 'lynx',
      config,
      options: {
        entry: ['./src/index.ts'],
        build: {
          outDir: 'dist/lynx',
          sourcemap: 'hidden',
          minify: false,
          cssMinify: false,
          emptyOutDir: true,
        },
      },
    } as EnvironmentInstance
    const target = resolveTargets(pluginOptions)[0]!
    const runtime: RspeedyRuntime = {
      rspeedyVersion: '0.14.5',
      vueLynxVersion: '0.5.1',
      async createRspeedy() {
        throw new Error('not used')
      },
      mergeRspeedyConfig(...configs) {
        return Object.assign({}, ...configs)
      },
      pluginVueLynx() {
        return []
      },
    }

    const rspeedyConfig = await createRspeedyConfig(
      runtime,
      environment,
      target,
      pluginOptions,
      'serve',
    )

    expect(rspeedyConfig).toMatchObject({
      mode: 'development',
      environments: {
        lynx: {},
      },
      source: {
        entry: './src/index.ts',
      },
      output: {
        assetPrefix: '/assets/',
        distPath: {
          root: path.join(root, 'dist/lynx'),
        },
        sourceMap: {
          js: 'hidden-source-map',
          css: true,
        },
      },
      dev: {
        hmr: false,
        liveReload: false,
        writeToDisk: true,
      },
      server: {
        base: '/app/',
        host: '0.0.0.0',
        port: 4321,
      },
    } satisfies RspeedyConfig)
  })

  test('configures background and main-thread Nasti environments', () => {
    const targets = resolveTargets({
      backend: 'nasti',
      entry: {
        main: './src/index.ts',
      },
    })
    const config = extendNastiConfig({ root }, targets, 'nasti')

    expect(config.framework).toBe('vue')
    expect(config.environments?.client?.buildEnabled).toBe(false)
    expect(config.environments?.lynx).toMatchObject({
      consumer: 'client',
      driver: '@nasti-toolchain/plugin-vue-lynx:native-serve',
      buildEnabled: false,
    })
    expect(config.environments?.['lynx-background']).toMatchObject({
      consumer: 'client',
      entry: './src/index.ts',
      build: {
        outDir: 'dist/lynx/.nasti/main/background',
        target: 'es2019',
        css: {
          inject: false,
          emit: false,
        },
        rolldownOptions: {
          output: {
            format: 'iife',
            entryFileNames: 'background.js',
          },
        },
      },
    })
    expect(
      config.environments?.['lynx-background']?.build?.rolldownOptions
        ?.transform?.target,
    ).toBeUndefined()
    expect(config.environments?.['lynx-main-thread']).toMatchObject({
      consumer: 'client',
      entry: './src/index.ts',
      build: {
        target: 'es2019',
        css: {
          inject: false,
          emit: false,
        },
        rolldownOptions: {
          output: {
            entryFileNames: 'main-thread.js',
          },
        },
      },
    })
  })

  test('requires one native entry import', () => {
    expect(resolveNativeEntry({ main: './src/index.ts' })).toEqual({
      name: 'main',
      import: './src/index.ts',
    })
    expect(() =>
      resolveNativeEntry(['./src/polyfill.ts', './src/index.ts']),
    ).toThrow('exactly one entry import')
  })

  test('rejects web and external drivers on the native backend', () => {
    expect(() =>
      pluginVueLynx({
        web: true,
      }),
    ).toThrow('does not support the web target')

    expect(() =>
      pluginVueLynx({
        backend: 'nasti',
        web: true,
      }),
    ).toThrow('does not support the web target')

    const targets = resolveTargets({
      backend: 'nasti',
    })
    expect(() =>
      extendNastiConfig(
        {
          root,
          environments: {
            'lynx-background': {
              driver: 'custom',
            },
          },
        },
        targets,
        'nasti',
      ),
    ).toThrow('requires Rolldown')
  })
})
