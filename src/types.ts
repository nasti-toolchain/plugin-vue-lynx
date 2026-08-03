import type {
  EnvironmentBuildResult,
  EnvironmentInstance,
  EnvironmentServeResult,
  ResolvedConfig,
} from '@nasti-toolchain/nasti'
import type {
  Config as RspeedyConfig,
  Entry as RspeedyEntry,
} from '@lynx-js/rspeedy'
import type { PluginVueLynxOptions } from 'vue-lynx/plugin'

export type { PluginVueLynxOptions, RspeedyConfig, RspeedyEntry }

export type VueLynxBackend = 'rspeedy' | 'nasti'

export interface RspeedyConfigFactoryContext {
  command: 'build' | 'serve'
  environment: EnvironmentInstance
  nastiConfig: ResolvedConfig
  rspeedyEnvironment: string
}

export type RspeedyConfigInput =
  | RspeedyConfig
  | ((
      context: RspeedyConfigFactoryContext,
    ) => RspeedyConfig | Promise<RspeedyConfig>)

export interface VueLynxTargetOptions {
  /**
   * Nasti environment name.
   * @defaultValue `lynx` for the native target and `web` for the web target.
   */
  name?: string
  /**
   * Rspeedy environment selected by the driver.
   * @defaultValue Same as `name`.
   */
  rspeedyEnvironment?: string
  /** Rspeedy entry configuration for this target. */
  entry?: RspeedyEntry
  /** Output directory relative to the Nasti root. */
  outDir?: string
  /** Production asset prefix for this target. */
  publicPath?: string
  /** Target-specific Rspeedy configuration or configuration factory. */
  rspeedy?: RspeedyConfigInput
  /** Target-specific Vue Lynx compiler options. */
  vue?: false | PluginVueLynxOptions
}

export interface VueLynxPluginOptions {
  /**
   * Build backend.
   *
   * `nasti` builds the background and main-thread graphs with Nasti/Rolldown,
   * encodes a native `.lynx.bundle` with TASM, and rebuilds that bundle during
   * `nasti dev` through a serve-only environment driver.
   *
   * @defaultValue `rspeedy`
   */
  backend?: VueLynxBackend
  /** Convenience entry configuration for the native Lynx target. */
  entry?: RspeedyEntry
  /** Convenience output directory for the native Lynx target. */
  outDir?: string
  /** Convenience production asset prefix for the native Lynx target. */
  publicPath?: string
  /** Native Lynx target customization. */
  lynx?: VueLynxTargetOptions
  /**
   * Enable a parallel web target, or customize it.
   * @defaultValue false
   */
  web?: boolean | VueLynxTargetOptions
  /** Shared Rspeedy configuration or configuration factory. */
  rspeedy?: RspeedyConfigInput
  /**
   * Shared Vue Lynx compiler options. Set to `false` only when an equivalent
   * Vue Lynx Rsbuild plugin is supplied through `rspeedy.plugins`.
   */
  vue?: false | PluginVueLynxOptions
  /** Optional lifecycle bridge for framework integrations and tests. */
  bridge?: VueLynxBridge
}

export interface ResolvedVueLynxTarget {
  name: string
  rspeedyEnvironment: string
  entry: RspeedyEntry
  outDir: string
  publicPath?: string
  rspeedy?: RspeedyConfigInput
  vue?: false | PluginVueLynxOptions
  kind: 'lynx' | 'web'
}

export interface VueLynxQrCodeMetadata {
  environment: string
  entry: string
  url: string
  value: string
}

export interface VueLynxServeMetadata {
  environment: string
  rspeedyEnvironment: string
  port: number
  baseUrls: string[]
  entries: Record<string, string>
  previewUrls: string[]
  qrCodes: VueLynxQrCodeMetadata[]
}

export interface VueLynxEnvironmentServeResult
  extends EnvironmentServeResult {
  metadata: VueLynxServeMetadata
}

export type VueLynxBridgeEvent =
  | {
      type: 'build'
      environment: string
      result: EnvironmentBuildResult
    }
  | {
      type: 'serve'
      environment: string
      result: VueLynxEnvironmentServeResult
    }
  | {
      type: 'change'
      environment: string
      file: string
      event: 'add' | 'change' | 'unlink'
    }
  | {
      type: 'close'
      environment: string
    }

export interface VueLynxBridge {
  onEvent: (event: VueLynxBridgeEvent) => void | Promise<void>
}

export type VueLynxEventListener = (
  event: VueLynxBridgeEvent,
) => void | Promise<void>

export interface VueLynxEnvironmentState {
  name: string
  status: 'idle' | 'building' | 'serving' | 'closed'
  build?: EnvironmentBuildResult
  service?: VueLynxEnvironmentServeResult
}

export interface VueLynxPluginApi {
  readonly version: string
  getEnvironment: (
    name: string,
  ) => Readonly<VueLynxEnvironmentState> | undefined
  getEnvironments: () => ReadonlyMap<string, Readonly<VueLynxEnvironmentState>>
  subscribe: (listener: VueLynxEventListener) => () => void
}
