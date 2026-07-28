import path from 'node:path'

import type {
  EnvironmentInstance,
  EnvironmentOptions,
  NastiConfig,
} from '@nasti-toolchain/nasti'
import type { Config as RspeedyConfig } from '@lynx-js/rspeedy'

import {
  CLIENT_BRIDGE_DRIVER,
  PLUGIN_NAME,
  RSPEEDY_DRIVER,
} from './constants.js'
import type { RspeedyRuntime } from './dependencies.js'
import type {
  ResolvedVueLynxTarget,
  RspeedyConfigFactoryContext,
  RspeedyConfigInput,
  VueLynxPluginOptions,
  VueLynxTargetOptions,
} from './types.js'

export function resolveTargets(
  options: VueLynxPluginOptions,
): ResolvedVueLynxTarget[] {
  const native = resolveTarget(
    'lynx',
    {
      ...(options.entry !== undefined ? { entry: options.entry } : {}),
      ...(options.outDir !== undefined ? { outDir: options.outDir } : {}),
      ...(options.publicPath !== undefined
        ? { publicPath: options.publicPath }
        : {}),
      ...(options.rspeedy !== undefined ? { rspeedy: options.rspeedy } : {}),
      ...(options.vue !== undefined ? { vue: options.vue } : {}),
      ...options.lynx,
    },
    'lynx',
  )
  const targets = [native]

  if (options.web) {
    const webOptions = options.web === true ? {} : options.web
    targets.push(
      resolveTarget(
        'web',
        {
          ...(options.entry !== undefined ? { entry: options.entry } : {}),
          ...(options.rspeedy !== undefined
            ? { rspeedy: options.rspeedy }
            : {}),
          ...(options.vue !== undefined ? { vue: options.vue } : {}),
          ...webOptions,
        },
        'web',
      ),
    )
  }

  const names = new Set<string>()
  for (const target of targets) {
    if (names.has(target.name)) {
      throw new Error(
        `[${PLUGIN_NAME}] duplicate Nasti environment "${target.name}".`,
      )
    }
    names.add(target.name)
  }
  return targets
}

function resolveTarget(
  kind: 'lynx' | 'web',
  options: VueLynxTargetOptions,
  defaultName: string,
): ResolvedVueLynxTarget {
  const name = options.name ?? defaultName
  const resolved: ResolvedVueLynxTarget = {
    name,
    rspeedyEnvironment: options.rspeedyEnvironment ?? name,
    entry: options.entry ?? './src/index.ts',
    outDir: options.outDir ?? path.join('dist', name),
    kind,
  }
  if (options.publicPath !== undefined) {
    resolved.publicPath = options.publicPath
  }
  if (options.rspeedy !== undefined) {
    resolved.rspeedy = options.rspeedy
  }
  if (options.vue !== undefined) {
    resolved.vue = options.vue
  }
  return resolved
}

export function extendNastiConfig(
  config: NastiConfig,
  targets: ResolvedVueLynxTarget[],
): NastiConfig {
  const existingEnvironments = config.environments ?? {}
  const environments: Record<string, EnvironmentOptions> = {
    ...existingEnvironments,
  }

  const targetNames = new Set(targets.map((target) => target.name))
  if (!Object.hasOwn(existingEnvironments, 'client') && !targetNames.has('client')) {
    environments.client = {
      consumer: 'client',
      driver: CLIENT_BRIDGE_DRIVER,
    }
  }

  for (const target of targets) {
    const existing = existingEnvironments[target.name] ?? {}
    if (existing.driver && existing.driver !== RSPEEDY_DRIVER) {
      throw new Error(
        `[${PLUGIN_NAME}] environment "${target.name}" already uses driver ` +
          `"${existing.driver}"; expected "${RSPEEDY_DRIVER}".`,
      )
    }
    environments[target.name] = {
      ...existing,
      consumer: existing.consumer ?? 'client',
      entry: existing.entry ?? toNastiEntry(target.entry),
      driver: RSPEEDY_DRIVER,
      build: {
        outDir: target.outDir,
        ...existing.build,
      },
    }
  }

  return {
    ...config,
    environments,
  }
}

function toNastiEntry(
  entry: ResolvedVueLynxTarget['entry'],
): string | string[] {
  if (typeof entry === 'string' || Array.isArray(entry)) return entry

  const imports = Object.values(entry).flatMap((value) => {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value
    if (typeof value.import === 'string') return [value.import]
    return value.import ?? []
  })
  return imports.length === 1 ? imports[0]! : imports
}

export async function createRspeedyConfig(
  runtime: RspeedyRuntime,
  environment: EnvironmentInstance,
  target: ResolvedVueLynxTarget,
  options: VueLynxPluginOptions,
  command: 'build' | 'serve',
): Promise<RspeedyConfig> {
  const config = environment.config
  const context: RspeedyConfigFactoryContext = {
    command,
    environment,
    nastiConfig: config,
    rspeedyEnvironment: target.rspeedyEnvironment,
  }
  const sourceMap = resolveSourceMap(environment.options.build.sourcemap)
  const hmr = config.server.hmr !== false
  const host =
    config.server.host === true ? '0.0.0.0' : String(config.server.host)
  const entry =
    target.entry ??
    (environment.options.entry.length === 1
      ? environment.options.entry[0]
      : environment.options.entry)
  const vueOptions =
    target.vue !== undefined ? target.vue : options.vue
  const vuePlugins =
    vueOptions === false ? [] : runtime.pluginVueLynx(vueOptions ?? {})

  const baseConfig: RspeedyConfig = {
    mode: command === 'build' ? 'production' : 'development',
    environments: {
      [target.rspeedyEnvironment]: {},
    },
    source: {
      entry,
    },
    output: {
      assetPrefix: target.publicPath ?? config.base,
      cleanDistPath: environment.options.build.emptyOutDir,
      distPath: {
        root: path.resolve(config.root, environment.options.build.outDir),
      },
      minify: {
        js: Boolean(environment.options.build.minify),
        css: environment.options.build.cssMinify,
      },
      sourceMap,
    },
    dev: {
      assetPrefix: true,
      hmr,
      liveReload: hmr,
      writeToDisk: true,
    },
    server: {
      base: config.base,
      cors: config.server.cors,
      host,
      port: config.server.port,
      proxy: config.server.proxy as RspeedyConfig['server'] extends {
        proxy?: infer Proxy
      }
        ? Proxy
        : never,
      strictPort: false,
    },
    plugins: vuePlugins,
  }

  const shared = await resolveConfigInput(options.rspeedy, context)
  const targetSpecific =
    target.rspeedy === options.rspeedy
      ? undefined
      : await resolveConfigInput(target.rspeedy, context)
  return runtime.mergeRspeedyConfig(
    baseConfig,
    ...(shared ? [shared] : []),
    ...(targetSpecific ? [targetSpecific] : []),
  )
}

async function resolveConfigInput(
  input: RspeedyConfigInput | undefined,
  context: RspeedyConfigFactoryContext,
): Promise<RspeedyConfig | undefined> {
  if (!input) return undefined
  return typeof input === 'function' ? await input(context) : input
}

function resolveSourceMap(
  sourceMap: boolean | 'inline' | 'hidden',
): NonNullable<RspeedyConfig['output']>['sourceMap'] {
  if (sourceMap === 'inline') {
    return { js: 'inline-source-map', css: true }
  }
  if (sourceMap === 'hidden') {
    return { js: 'hidden-source-map', css: true }
  }
  if (sourceMap) {
    return { js: 'source-map', css: true }
  }
  return { js: false, css: false }
}
