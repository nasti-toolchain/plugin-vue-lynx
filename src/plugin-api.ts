import type {
  EnvironmentBuildResult,
} from '@nasti-toolchain/nasti'

import { PLUGIN_NAME, PLUGIN_VERSION } from './constants.js'
import type {
  VueLynxBridge,
  VueLynxBridgeEvent,
  VueLynxEnvironmentServeResult,
  VueLynxEnvironmentState,
  VueLynxEventListener,
  VueLynxPluginApi,
} from './types.js'

export const VUE_LYNX_PLUGIN_API_KEY = Symbol.for(`${PLUGIN_NAME}/api`)

export interface VueLynxPluginApiController {
  api: VueLynxPluginApi
  setBuilding: (environment: string) => void
  setBuildResult: (
    environment: string,
    result: EnvironmentBuildResult,
  ) => Promise<void>
  setServeResult: (
    environment: string,
    result: VueLynxEnvironmentServeResult,
  ) => Promise<void>
  notifyChange: (
    environment: string,
    file: string,
    event: 'add' | 'change' | 'unlink',
  ) => Promise<void>
  notifyClose: (environment: string) => Promise<void>
}

export function createPluginApiController(
  bridge?: VueLynxBridge,
): VueLynxPluginApiController {
  const listeners = new Set<VueLynxEventListener>()
  const states = new Map<string, VueLynxEnvironmentState>()

  const stateFor = (environment: string): VueLynxEnvironmentState => {
    const existing = states.get(environment)
    if (existing) return existing
    const created: VueLynxEnvironmentState = {
      name: environment,
      status: 'idle',
    }
    states.set(environment, created)
    return created
  }

  const emit = async (event: VueLynxBridgeEvent): Promise<void> => {
    try {
      await bridge?.onEvent(event)
      await Promise.all([...listeners].map((listener) => listener(event)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `[${PLUGIN_NAME}] bridge failed for "${event.environment}" ` +
          `during ${event.type}: ${message}`,
        { cause: error },
      )
    }
  }

  return {
    api: {
      version: PLUGIN_VERSION,
      getEnvironment(name) {
        return states.get(name)
      },
      getEnvironments() {
        return states
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    setBuilding(environment) {
      const state = stateFor(environment)
      state.status = 'building'
    },
    async setBuildResult(environment, result) {
      const state = stateFor(environment)
      state.status = 'idle'
      state.build = result
      await emit({ type: 'build', environment, result })
    },
    async setServeResult(environment, result) {
      const state = stateFor(environment)
      state.status = 'serving'
      state.service = result
      await emit({ type: 'serve', environment, result })
    },
    async notifyChange(environment, file, event) {
      await emit({ type: 'change', environment, file, event })
    },
    async notifyClose(environment) {
      const state = stateFor(environment)
      state.status = 'closed'
      await emit({ type: 'close', environment })
    },
  }
}
