import path from 'node:path'

import type {
  BuildAppContext,
  EnvironmentBuildOutput,
  NastiPlugin,
  PluginApi,
  ResolvedConfig,
} from '@nasti-toolchain/nasti'

import { encodeNativeBundle } from './native-bundle.js'
import {
  NASTI_BACKGROUND_ENVIRONMENT,
  NASTI_MAIN_THREAD_ENVIRONMENT,
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

export interface NastiNativePluginOptions {
  target: ResolvedVueLynxTarget
  apiController: VueLynxPluginApiController
}

export function createNastiNativePlugin({
  target,
  apiController,
}: NastiNativePluginOptions): NastiPlugin {
  const entry = resolveNativeEntry(target.entry)
  const styles = new Map<string, string>()
  let resolvedConfig: ResolvedConfig | undefined
  let absoluteEntry = ''

  return {
    name: PLUGIN_NAME,
    enforce: 'post',

    config(config, env) {
      if (env.command !== 'build') {
        throw new Error(
          `[${PLUGIN_NAME}] the experimental Nasti backend currently ` +
            'supports production builds only. Use the Rspeedy backend for dev.',
        )
      }
      return extendNastiConfig(config, [target], 'nasti')
    },

    configResolved(config) {
      resolvedConfig = config
      absoluteEntry = path.resolve(config.root, entry.import)
      styles.clear()
    },

    setup(api: PluginApi) {
      api.expose<VueLynxPluginApi>(
        VUE_LYNX_PLUGIN_API_KEY,
        apiController.api,
      )
    },

    applyToEnvironment(environment) {
      return (
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

      if (isStyleRequest(id)) {
        if (environment === NASTI_BACKGROUND_ENVIRONMENT) {
          const css = extractNastiCss(code)
          if (css === undefined) {
            throw new Error(
              `[${PLUGIN_NAME}] could not collect CSS from "${id}". ` +
                'The experimental backend only supports Nasti CSS modules.',
            )
          }
          styles.set(id, css)
        }
        return {
          code: '',
          moduleSideEffects: 'no-treeshake',
        }
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
      const background = requireCodeArtifact(
        context,
        NASTI_BACKGROUND_ENVIRONMENT,
        BACKGROUND_FILE,
      )
      const mainThread = requireCodeArtifact(
        context,
        NASTI_MAIN_THREAD_ENVIRONMENT,
        MAIN_THREAD_FILE,
      )
      const source = await encodeNativeBundle({
        backgroundCode: background,
        mainThreadCode: mainThread,
        styles: [...styles.values()],
      })
      const fileName = `${entry.name}.lynx.bundle`
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
  }
}

function requireCodeArtifact(
  context: BuildAppContext,
  environment: string,
  fileName: string,
): string {
  const artifact = context.getArtifact(environment, fileName)
  if (!artifact) {
    throw new Error(
      `[${PLUGIN_NAME}] missing ${environment} artifact "${fileName}".`,
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

function extractNastiCss(code: string): string | undefined {
  const match = /\bconst css = ("(?:\\.|[^"\\])*");/.exec(code)
  if (!match?.[1]) return undefined
  try {
    return JSON.parse(match[1]) as string
  } catch {
    return undefined
  }
}

function cleanId(id: string): string {
  return id.split('?', 1)[0]!
}
