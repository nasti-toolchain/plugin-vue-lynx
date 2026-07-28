import type {
  NastiPlugin,
  PluginApi,
} from '@nasti-toolchain/nasti'

import {
  CLIENT_BRIDGE_DRIVER,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  RSPEEDY_DRIVER,
} from './constants.js'
import {
  extendNastiConfig,
  resolveTargets,
} from './config.js'
import {
  createClientBridgeDriver,
  createRspeedyEnvironmentDriver,
} from './driver.js'
import {
  createPluginApiController,
  VUE_LYNX_PLUGIN_API_KEY,
} from './plugin-api.js'
import type {
  VueLynxPluginApi,
  VueLynxPluginOptions,
} from './types.js'

export {
  PLUGIN_VERSION,
  RSPEEDY_DRIVER,
  VUE_LYNX_PLUGIN_API_KEY,
}
export type {
  PluginVueLynxOptions,
  RspeedyConfig,
  RspeedyConfigFactoryContext,
  RspeedyConfigInput,
  RspeedyEntry,
  VueLynxBridge,
  VueLynxBridgeEvent,
  VueLynxEnvironmentServeResult,
  VueLynxEnvironmentState,
  VueLynxPluginApi,
  VueLynxPluginOptions,
  VueLynxQrCodeMetadata,
  VueLynxServeMetadata,
  VueLynxTargetOptions,
} from './types.js'

/**
 * Connect Vue Lynx and Rspeedy to Nasti's Environment Driver API.
 */
export function pluginVueLynx(
  options: VueLynxPluginOptions = {},
): NastiPlugin {
  const targets = resolveTargets(options)
  const targetsByName = new Map(
    targets.map((target) => [target.name, target]),
  )
  const apiController = createPluginApiController(options.bridge)

  return {
    name: PLUGIN_NAME,

    config(config) {
      return extendNastiConfig(config, targets)
    },

    setup(api: PluginApi) {
      api.expose<VueLynxPluginApi>(
        VUE_LYNX_PLUGIN_API_KEY,
        apiController.api,
      )
    },

    createEnvironmentDriver(environment) {
      if (environment.options.driver === CLIENT_BRIDGE_DRIVER) {
        return createClientBridgeDriver()
      }
      if (environment.options.driver !== RSPEEDY_DRIVER) return

      const target =
        targetsByName.get(environment.name) ??
        ({
          name: environment.name,
          rspeedyEnvironment: environment.name,
          entry:
            environment.options.entry.length === 1
              ? environment.options.entry[0]!
              : environment.options.entry,
          outDir: environment.options.build.outDir,
          kind:
            environment.name === 'web' ||
            environment.name.startsWith('web-')
              ? 'web'
              : 'lynx',
        } as const)

      return createRspeedyEnvironmentDriver({
        environment,
        target,
        pluginOptions: options,
        apiController,
      })
    },
  }
}

export default pluginVueLynx
