import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  AppHmrContext,
  BuildAppContext,
  DevServer,
  EnvironmentBuildOutput,
  EnvironmentDriver,
  EnvironmentDriverServeContext,
  EnvironmentInstance,
  NastiPlugin,
  PluginApi,
  ResolvedConfig,
} from '@nasti-toolchain/nasti'

import { encodeNativeBundle } from './native-bundle.js'
import {
  NASTI_BACKGROUND_ENVIRONMENT,
  NASTI_MAIN_THREAD_ENVIRONMENT,
  NATIVE_SERVE_DRIVER,
  PLUGIN_NAME,
} from './constants.js'
import {
  extendNastiConfig,
  resolveNativeEntry,
} from './config.js'
import type { VueLynxPluginApiController } from './plugin-api.js'
import {
  transformBackgroundWorklets,
  transformMainThreadWorklets,
} from './native-worklet.js'
import type {
  ResolvedVueLynxTarget,
  VueLynxEnvironmentServeResult,
  VueLynxPluginApi,
} from './types.js'
import { VUE_LYNX_PLUGIN_API_KEY } from './plugin-api.js'

const BACKGROUND_BOOTSTRAP = "import 'vue-lynx/entry-background';"
const MAIN_THREAD_BOOTSTRAP = [
  "import 'vue-lynx/main-thread';",
  "import '@lynx-js/react/worklet-runtime';",
].join('\n')
const BACKGROUND_FILE = 'background.js'
const MAIN_THREAD_FILE = 'main-thread.js'
const REBUILD_DEBOUNCE_MS = 50

export interface NastiNativePluginOptions {
  target: ResolvedVueLynxTarget
  apiController: VueLynxPluginApiController
}

export function createNastiNativePlugin({
  target,
  apiController,
}: NastiNativePluginOptions): NastiPlugin {
  const entry = resolveNativeEntry(target.entry)
  const bundleFileName = `${entry.name}.lynx.bundle`
  let resolvedConfig: ResolvedConfig | undefined
  let absoluteEntry = ''
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined
  let rebuildChain: Promise<void> = Promise.resolve()
  let pendingRebuild:
    | { reason: string; server?: DevServer | undefined }
    | undefined
  let latestBundle: Uint8Array | undefined
  let closed = false

  const bundlePath = () => {
    if (!resolvedConfig) {
      throw new Error(`[${PLUGIN_NAME}] native build was not configured.`)
    }
    return path.resolve(resolvedConfig.root, target.outDir, bundleFileName)
  }

  const rebuildBundle = async (reason: string): Promise<Uint8Array> => {
    if (!resolvedConfig) {
      throw new Error(`[${PLUGIN_NAME}] native build was not configured.`)
    }
    apiController.setBuilding(target.name)
    resolvedConfig.logger.info(
      `[${PLUGIN_NAME}] rebuilding native bundle (${reason})…`,
    )
    const { build } = await import('@nasti-toolchain/nasti')
    // Dev rebuilds must keep development `import.meta.env` semantics even
    // though the programmatic API always runs as command: "build".
    await build({
      root: resolvedConfig.root,
      logLevel: 'warn',
      mode: 'development',
    })
    const source = await readFile(bundlePath())
    latestBundle = source
    return source
  }

  const enqueueRebuild = (reason: string, server?: DevServer) => {
    rebuildChain = rebuildChain
      .then(async () => {
        if (closed) return
        await rebuildBundle(reason)
        server?.ws.send({
          type: 'custom',
          event: 'vue-lynx:native-bundle',
          data: { fileName: bundleFileName },
          environment: target.name,
        })
      })
      .catch((error) => {
        const normalized =
          error instanceof Error ? error : new Error(String(error))
        resolvedConfig?.logger.error(
          `[${PLUGIN_NAME}] native rebuild failed: ${normalized.message}`,
          { error: normalized },
        )
      })
    return rebuildChain
  }

  const scheduleRebuild = (reason: string, server?: DevServer) => {
    if (closed) return
    pendingRebuild = { reason, server }
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined
      const pending = pendingRebuild
      pendingRebuild = undefined
      if (!pending || closed) return
      void enqueueRebuild(pending.reason, pending.server)
    }, REBUILD_DEBOUNCE_MS)
  }

  const getFreshBundle = async (): Promise<Uint8Array> => {
    if (rebuildTimer && pendingRebuild) {
      clearTimeout(rebuildTimer)
      rebuildTimer = undefined
      const pending = pendingRebuild
      pendingRebuild = undefined
      await enqueueRebuild(pending.reason, pending.server)
    } else {
      await rebuildChain
    }
    if (latestBundle) return latestBundle
    return rebuildBundle('dev-server start')
  }

  return {
    name: PLUGIN_NAME,
    enforce: 'post',

    config(config) {
      return extendNastiConfig(config, [target], 'nasti')
    },

    configResolved(config) {
      resolvedConfig = config
      absoluteEntry = path.resolve(config.root, entry.import)
    },

    setup(api: PluginApi) {
      api.expose<VueLynxPluginApi>(
        VUE_LYNX_PLUGIN_API_KEY,
        apiController.api,
      )
    },

    createEnvironmentDriver(environment) {
      if (environment.options.driver !== NATIVE_SERVE_DRIVER) return
      return createNativeServeDriver({
        environment,
        target,
        bundleFileName,
        apiController,
        getBundle: getFreshBundle,
        scheduleRebuild: (reason, server) => scheduleRebuild(reason, server),
        markClosed: () => {
          closed = true
          clearTimeout(rebuildTimer)
          pendingRebuild = undefined
        },
      })
    },

    applyToEnvironment(environment) {
      return (
        environment.name === target.name ||
        environment.name === NASTI_BACKGROUND_ENVIRONMENT ||
        environment.name === NASTI_MAIN_THREAD_ENVIRONMENT
      )
    },

    buildStart() {
      if (this.environment?.name === NASTI_BACKGROUND_ENVIRONMENT) {
        apiController.setBuilding(target.name)
      }
    },

    async transform(code, id) {
      const environment = this.environment?.name
      if (
        environment !== NASTI_BACKGROUND_ENVIRONMENT &&
        environment !== NASTI_MAIN_THREAD_ENVIRONMENT
      ) {
        return
      }
      if (
        !resolvedConfig ||
        !path.isAbsolute(cleanId(id))
      ) {
        return
      }

      // CSS is collected through Nasti's EnvironmentCssMetadata (`getCss`);
      // browser injection/emission is already disabled in the native config.
      if (isStyleRequest(id)) {
        return
      }

      const isEntry = cleanId(id) === absoluteEntry
      if (environment === NASTI_BACKGROUND_ENVIRONMENT) {
        const transformed = await transformBackgroundWorklets({ code, id })
        return isEntry
          ? `${BACKGROUND_BOOTSTRAP}\n${transformed}`
          : transformed
      }

      const transformed = await transformMainThreadWorklets({ code, id })
      return isEntry
        ? `${MAIN_THREAD_BOOTSTRAP}\n${transformed}`
        : transformed
    },

    generateBundle() {
      const environment = this.environment
      if (!environment) return
      if (environment.name === NASTI_BACKGROUND_ENVIRONMENT) {
        environment.setBuildMetadata({
          entries: { [entry.name]: BACKGROUND_FILE },
        })
      } else if (environment.name === NASTI_MAIN_THREAD_ENVIRONMENT) {
        environment.setBuildMetadata({
          entries: { [entry.name]: MAIN_THREAD_FILE },
        })
      }
    },

    async afterBuildApp(_results, _api, context) {
      if (!resolvedConfig) {
        throw new Error(`[${PLUGIN_NAME}] native build was not configured.`)
      }
      const background = requireEntryCode(
        context,
        NASTI_BACKGROUND_ENVIRONMENT,
        entry.name,
      )
      const mainThread = requireEntryCode(
        context,
        NASTI_MAIN_THREAD_ENVIRONMENT,
        entry.name,
      )
      const source = await encodeNativeBundle({
        backgroundCode: background,
        mainThreadCode: mainThread,
        styles: collectCssSources(context, NASTI_BACKGROUND_ENVIRONMENT),
      })
      latestBundle = source instanceof Uint8Array ? source : undefined
      const fileName = bundleFileName
      context.emitFile({
        type: 'asset',
        fileName,
        source,
      })
      await apiController.setBuildResult(target.name, {
        output: [
          {
            type: 'asset',
            fileName,
            source,
          },
        ],
        entries: {
          [entry.name]: fileName,
        },
        publicPath: resolvedConfig.base,
        manifest: {
          backend: 'nasti',
          environments: [
            NASTI_BACKGROUND_ENVIRONMENT,
            NASTI_MAIN_THREAD_ENVIRONMENT,
          ],
        },
      })
    },

    async handleHotUpdateApp(context: AppHmrContext) {
      const touched = Object.keys(context.environments).some(
        (name) =>
          name === NASTI_BACKGROUND_ENVIRONMENT ||
          name === NASTI_MAIN_THREAD_ENVIRONMENT ||
          name === target.name,
      )
      if (!touched) return
      scheduleRebuild(`hmr ${context.file}`, context.server)
    },
  }
}

interface NativeServeDriverOptions {
  environment: EnvironmentInstance
  target: ResolvedVueLynxTarget
  bundleFileName: string
  apiController: VueLynxPluginApiController
  getBundle: () => Promise<Uint8Array>
  scheduleRebuild: (reason: string, server: DevServer) => void
  markClosed: () => void
}

function createNativeServeDriver({
  environment,
  target,
  bundleFileName,
  apiController,
  getBundle,
  scheduleRebuild,
  markClosed,
}: NativeServeDriverOptions): EnvironmentDriver {
  let server: DevServer | undefined

  return {
    name: NATIVE_SERVE_DRIVER,

    async serve(context: EnvironmentDriverServeContext) {
      server = context.server
      const source = await getBundle()
      const port = context.server.config.server.port
      const host =
        context.server.config.server.host === true
          ? '0.0.0.0'
          : String(context.server.config.server.host)
      const base = normalizePublicBase(context.config.base)
      const pathname = `${base}${bundleFileName}`
      const localUrls = [`http://127.0.0.1:${port}${pathname}`]
      const networkUrls =
        host === '0.0.0.0' || host === '::'
          ? []
          : [`http://${host}:${port}${pathname}`]

      const result: VueLynxEnvironmentServeResult = {
        localUrls,
        networkUrls,
        middleware(request, response, next) {
          const urlPath = request.url?.split('?', 1)[0] ?? ''
          if (urlPath !== pathname && urlPath !== `/${bundleFileName}`) {
            next()
            return
          }
          void getBundle()
            .then((bundle) => {
              response.statusCode = 200
              response.setHeader('Content-Type', 'application/octet-stream')
              response.setHeader('Content-Length', String(bundle.byteLength))
              response.end(Buffer.from(bundle))
            })
            .catch((error) => next(error))
        },
        metadata: {
          environment: environment.name,
          rspeedyEnvironment: environment.name,
          port,
          baseUrls: localUrls,
          entries: { [path.parse(bundleFileName).name]: pathname },
          previewUrls: localUrls,
          qrCodes: [
            {
              environment: environment.name,
              entry: path.parse(bundleFileName).name,
              url: localUrls[0]!,
              value: localUrls[0]!,
            },
          ],
        },
      }

      await apiController.setServeResult(target.name, result)
      // Keep a warm copy for the first request.
      void source
      return result
    },

    async watchChange(file, event) {
      if (!server) return
      await apiController.notifyChange(environment.name, file, event)
      scheduleRebuild(`${event} ${file}`, server)
    },

    async close() {
      markClosed()
      await apiController.notifyClose(target.name)
    },
  }
}

function normalizePublicBase(base: string): string {
  if (!base || base === '/') return '/'
  return base.endsWith('/') ? base : `${base}/`
}

function collectCssSources(
  context: BuildAppContext,
  environment: string,
): string[] {
  const css = context.getCss(environment)
  if (!css) return []
  return Object.values(css.modules)
    .map((module) => module.code || module.source)
    .filter((value) => value.length > 0)
}

function requireEntryCode(
  context: BuildAppContext,
  environment: string,
  entryName: string,
): string {
  const artifact =
    context.getEntry(environment, entryName) ??
    context.getArtifact(
      environment,
      environment === NASTI_BACKGROUND_ENVIRONMENT
        ? BACKGROUND_FILE
        : MAIN_THREAD_FILE,
    )
  if (!artifact) {
    throw new Error(
      `[${PLUGIN_NAME}] missing ${environment} entry "${entryName}".`,
    )
  }
  return artifactCode(artifact, environment)
}

function artifactCode(
  artifact: EnvironmentBuildOutput,
  environment: string,
): string {
  if (typeof artifact.code === 'string') return artifact.code
  if (typeof artifact.source === 'string') return artifact.source
  if (artifact.source instanceof Uint8Array) {
    return new TextDecoder().decode(artifact.source)
  }
  throw new Error(
    `[${PLUGIN_NAME}] ${environment} did not produce JavaScript code.`,
  )
}

function isStyleRequest(id: string): boolean {
  const [file, query = ''] = id.split('?', 2)
  return (
    /\.(?:css|less|sass|scss|styl|stylus)$/.test(file ?? '') ||
    /(?:^|&)type=style(?:&|$)/.test(query)
  )
}

function cleanId(id: string): string {
  return id.split('?', 1)[0]!
}
