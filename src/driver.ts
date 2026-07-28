import path from 'node:path'

import type {
  EnvironmentDriver,
  EnvironmentDriverContext,
  EnvironmentInstance,
} from '@nasti-toolchain/nasti'

import { PLUGIN_NAME } from './constants.js'
import { createRspeedyConfig } from './config.js'
import {
  loadRspeedyRuntime,
  type RspeedyBuildResultLike,
  type RspeedyDevServerLike,
  type RspeedyRuntime,
  type StatsLike,
} from './dependencies.js'
import {
  normalizeBuildResult,
  normalizeServeResult,
} from './normalize.js'
import type { VueLynxPluginApiController } from './plugin-api.js'
import type {
  ResolvedVueLynxTarget,
  VueLynxPluginOptions,
} from './types.js'

export interface CreateDriverOptions {
  environment: EnvironmentInstance
  target: ResolvedVueLynxTarget
  pluginOptions: VueLynxPluginOptions
  apiController: VueLynxPluginApiController
  loadRuntime?: (root: string) => Promise<RspeedyRuntime>
}

export function createRspeedyEnvironmentDriver({
  environment,
  target,
  pluginOptions,
  apiController,
  loadRuntime = loadRspeedyRuntime,
}: CreateDriverOptions): EnvironmentDriver {
  let runtimePromise: Promise<RspeedyRuntime> | undefined
  let buildResult: RspeedyBuildResultLike | undefined
  let devServer: RspeedyDevServerLike | undefined
  let closed = false

  const getRuntime = () => {
    runtimePromise ??= loadRuntime(environment.config.root)
    return runtimePromise
  }

  return {
    name: `rspeedy:${target.rspeedyEnvironment}`,

    async build(context) {
      assertOpen(closed, environment.name)
      apiController.setBuilding(environment.name)
      const runtime = await getRuntime()
      logVersions(context, runtime)
      const rspeedyConfig = await createRspeedyConfig(
        runtime,
        environment,
        target,
        pluginOptions,
        'build',
      )
      const rspeedy = await runtime.createRspeedy({
        cwd: context.config.root,
        rspeedyConfig,
        environment: [target.rspeedyEnvironment],
        // Rspeedy's default plugins key behavior from this caller identity.
        callerName: 'rspeedy',
      })
      buildResult = await rspeedy.build()
      const result = await normalizeBuildResult({
        environment: environment.name,
        rspeedyEnvironment: target.rspeedyEnvironment,
        outDir: path.resolve(
          context.config.root,
          environment.options.build.outDir,
        ),
        publicPath: target.publicPath ?? context.config.base,
        ...(buildResult.stats ? { stats: buildResult.stats } : {}),
      })
      await apiController.setBuildResult(environment.name, result)
      return result
    },

    async serve(context) {
      assertOpen(closed, environment.name)
      const runtime = await getRuntime()
      logVersions(context, runtime)
      const rspeedyConfig = await createRspeedyConfig(
        runtime,
        environment,
        target,
        pluginOptions,
        'serve',
      )
      const rspeedy = await runtime.createRspeedy({
        cwd: context.config.root,
        rspeedyConfig,
        environment: [target.rspeedyEnvironment],
        callerName: 'rspeedy',
      })
      devServer = await rspeedy.createDevServer()
      const listening = await devServer.listen()
      devServer = listening.server ?? devServer
      const stats = await getEnvironmentStats(
        devServer,
        target.rspeedyEnvironment,
      )
      const result = await normalizeServeResult({
        environment: environment.name,
        rspeedyEnvironment: target.rspeedyEnvironment,
        port: listening.port,
        urls: listening.urls,
        ...(stats ? { stats } : {}),
      })
      await apiController.setServeResult(environment.name, result)
      return result
    },

    async watchChange(file, event) {
      assertOpen(closed, environment.name)
      await apiController.notifyChange(environment.name, file, event)
    },

    async close() {
      if (closed) return
      closed = true
      const errors: unknown[] = []
      if (devServer) {
        try {
          await devServer.close()
        } catch (error) {
          errors.push(error)
        }
      }
      if (buildResult) {
        try {
          await buildResult.close()
        } catch (error) {
          errors.push(error)
        }
      }
      await apiController.notifyClose(environment.name)
      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          `[${PLUGIN_NAME}] failed to close Rspeedy for ` +
            `"${environment.name}".`,
        )
      }
    },
  }
}

export function createClientBridgeDriver(): EnvironmentDriver {
  return {
    name: 'vue-lynx:client-bridge',
    build() {
      return {
        output: [],
        entries: {},
        manifest: {
          bridge: true,
          reason:
            'Nasti 2.x requires a client environment; Vue Lynx uses explicit targets.',
        },
      }
    },
  }
}

async function getEnvironmentStats(
  server: RspeedyDevServerLike,
  environment: string,
): Promise<StatsLike | undefined> {
  const environmentApi = server.environments?.[environment]
  return environmentApi ? await environmentApi.getStats() : undefined
}

function assertOpen(closed: boolean, environment: string): void {
  if (closed) {
    throw new Error(
      `[${PLUGIN_NAME}] environment driver "${environment}" is already closed.`,
    )
  }
}

function logVersions(
  context: EnvironmentDriverContext,
  runtime: RspeedyRuntime,
): void {
  context.logger.info(
    `[${PLUGIN_NAME}] ${context.environment.name}: ` +
      `@lynx-js/rspeedy ${runtime.rspeedyVersion}, ` +
      `vue-lynx ${runtime.vueLynxVersion}`,
  )
}
