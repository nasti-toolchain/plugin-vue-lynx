import path from 'node:path'
import { createRequire } from 'node:module'

import type {
  EnvironmentInstance,
  EnvironmentOptions,
  NastiConfig,
} from '@nasti-toolchain/nasti'
import type { Config as RspeedyConfig } from '@lynx-js/rspeedy'

import {
  NASTI_BACKGROUND_ENVIRONMENT,
  NASTI_MAIN_THREAD_ENVIRONMENT,
  PLUGIN_NAME,
  RSPEEDY_DRIVER,
} from './constants.js'
import type { RspeedyRuntime } from './dependencies.js'
import type {
  ResolvedVueLynxTarget,
  RspeedyConfigFactoryContext,
  RspeedyConfigInput,
  RspeedyEntry,
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
  backend: 'rspeedy' | 'nasti' = 'rspeedy',
): NastiConfig {
  if (backend === 'nasti') {
    return extendNativeNastiConfig(config, targets)
  }

  const existingEnvironments = config.environments ?? {}
  const environments: Record<string, EnvironmentOptions> = {
    ...existingEnvironments,
  }

  const targetNames = new Set(targets.map((target) => target.name))
  if (!Object.hasOwn(existingEnvironments, 'client') && !targetNames.has('client')) {
    // Nasti still requires a client environment slot; disable it instead of
    // installing a no-op driver. Nasti 2.4.2 always mounts client
    // transformMiddleware and crashes when that context is missing.
    environments.client = {
      consumer: 'client',
      buildEnabled: false,
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

function extendNativeNastiConfig(
  config: NastiConfig,
  targets: ResolvedVueLynxTarget[],
): NastiConfig {
  if (targets.length !== 1 || targets[0]?.kind !== 'lynx') {
    throw new Error(
      `[${PLUGIN_NAME}] the experimental Nasti backend currently supports ` +
        'one native Lynx target and does not support the web target.',
    )
  }

  const target = targets[0]
  const entry = resolveNativeEntry(target.entry)
  const environments = config.environments ?? {}
  const intermediateRoot = path.join(target.outDir, '.nasti', entry.name)
  const vueRuntime = resolveVueLynxRuntime(config.root)

  return {
    ...config,
    framework: 'vue',
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        vue: vueRuntime,
      },
    },
    build: {
      ...config.build,
      outDir: target.outDir,
    },
    environments: {
      ...environments,
      client: {
        ...environments.client,
        buildEnabled: false,
      },
      [NASTI_BACKGROUND_ENVIRONMENT]: createNativeEnvironment(
        environments[NASTI_BACKGROUND_ENVIRONMENT],
        entry.import,
        path.join(intermediateRoot, 'background'),
        'background.js',
        NASTI_BACKGROUND_ENVIRONMENT,
        vueRuntime,
      ),
      [NASTI_MAIN_THREAD_ENVIRONMENT]: createNativeEnvironment(
        environments[NASTI_MAIN_THREAD_ENVIRONMENT],
        entry.import,
        path.join(intermediateRoot, 'main-thread'),
        'main-thread.js',
        NASTI_MAIN_THREAD_ENVIRONMENT,
        vueRuntime,
      ),
    },
  }
}

function createNativeEnvironment(
  existing: EnvironmentOptions | undefined,
  entry: string,
  outDir: string,
  fileName: string,
  condition: string,
  vueRuntime: string,
): EnvironmentOptions {
  if (existing?.driver) {
    throw new Error(
      `[${PLUGIN_NAME}] native environment "${condition}" already uses ` +
        `driver "${existing.driver}"; the Nasti backend requires Rolldown.`,
    )
  }
  const existingOutput = existing?.build?.rolldownOptions?.output
  return {
    ...existing,
    consumer: 'client',
    entry,
    resolve: {
      ...existing?.resolve,
      conditions: [
        condition,
        ...(existing?.resolve?.conditions ?? ['browser', 'import']),
      ],
      alias: {
        ...existing?.resolve?.alias,
        vue: vueRuntime,
      },
    },
    build: {
      ...existing?.build,
      outDir,
      // Lynx main-thread / background need the ES2019 baseline; Nasti 2.4.1+
      // applies `build.target` to OXC and Rolldown without a low-level workaround.
      target: 'es2019',
      css: {
        ...existing?.build?.css,
        // Keep the CSS module graph for TASM encoding, but skip browser
        // injection and hashed .css emission.
        inject: false,
        emit: false,
      },
      rolldownOptions: {
        ...existing?.build?.rolldownOptions,
        output: {
          ...existingOutput,
          format: 'iife',
          name:
            condition === NASTI_BACKGROUND_ENVIRONMENT
              ? 'VueLynxBackground'
              : 'VueLynxMainThread',
          entryFileNames: fileName,
          chunkFileNames: `${condition}-[name].[hash].js`,
        },
      },
    },
  }
}

function resolveVueLynxRuntime(root: string | undefined): string {
  const absoluteRoot = path.resolve(root ?? process.cwd())
  try {
    return createRequire(path.join(absoluteRoot, 'package.json')).resolve(
      'vue-lynx',
    )
  } catch (error) {
    throw new Error(
      `[${PLUGIN_NAME}] the experimental Nasti backend requires "vue-lynx" ` +
        `to be resolvable from "${absoluteRoot}".`,
      { cause: error },
    )
  }
}

export interface NativeEntry {
  name: string
  import: string
}

export function resolveNativeEntry(entry: RspeedyEntry): NativeEntry {
  if (typeof entry === 'string') {
    return { name: path.parse(entry).name, import: entry }
  }
  if (Array.isArray(entry)) {
    if (entry.length === 1 && entry[0]) {
      return { name: path.parse(entry[0]).name, import: entry[0] }
    }
    throw new Error(
      `[${PLUGIN_NAME}] the experimental Nasti backend currently requires ` +
        'exactly one entry import.',
    )
  }

  const entries = Object.entries(entry)
  if (entries.length !== 1 || !entries[0]) {
    throw new Error(
      `[${PLUGIN_NAME}] the experimental Nasti backend currently supports ` +
        'exactly one named entry.',
    )
  }
  const [name, value] = entries[0]
  const imports =
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value
        : typeof value.import === 'string'
          ? [value.import]
          : value.import
  if (imports?.length !== 1 || !imports[0]) {
    throw new Error(
      `[${PLUGIN_NAME}] native entry "${name}" must contain exactly one import.`,
    )
  }
  return { name, import: imports[0] }
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
