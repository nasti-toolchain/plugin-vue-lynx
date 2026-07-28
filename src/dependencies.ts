import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Config as RspeedyConfig } from '@lynx-js/rspeedy'
import type { PluginVueLynxOptions } from 'vue-lynx/plugin'

import {
  MAX_RSPEEDY_VERSION,
  MIN_RSPEEDY_VERSION,
  MIN_VUE_LYNX_VERSION,
  PLUGIN_NAME,
} from './constants.js'

interface PackageDescriptor {
  name: string
  version: string
  exports?: unknown
}

export interface RspeedyBuildResultLike {
  stats?: StatsLike
  close: () => Promise<void>
}

export interface StatsLike {
  toJson?: (options?: Record<string, unknown>) => unknown
}

export interface RspeedyDevEnvironmentLike {
  getStats: () => Promise<StatsLike>
}

export interface RspeedyDevServerLike {
  environments?: Record<string, RspeedyDevEnvironmentLike>
  listen: () => Promise<{
    port: number
    urls: string[]
    server?: RspeedyDevServerLike
  }>
  close: () => Promise<void>
}

export interface RspeedyInstanceLike {
  context: {
    distPath: string
  }
  build: (options?: { watch?: boolean }) => Promise<RspeedyBuildResultLike>
  createDevServer: () => Promise<RspeedyDevServerLike>
}

export interface RspeedyRuntime {
  rspeedyVersion: string
  vueLynxVersion: string
  createRspeedy: (options: {
    cwd: string
    rspeedyConfig: RspeedyConfig
    environment: string[]
    callerName: string
  }) => Promise<RspeedyInstanceLike>
  mergeRspeedyConfig: (
    ...configs: RspeedyConfig[]
  ) => RspeedyConfig
  pluginVueLynx: (
    options?: PluginVueLynxOptions,
  ) => NonNullable<RspeedyConfig['plugins']>
}

export async function loadRspeedyRuntime(root: string): Promise<RspeedyRuntime> {
  const rspeedyPackage = await loadPackage(root, '@lynx-js/rspeedy')
  assertMinimumVersion(
    '@lynx-js/rspeedy',
    rspeedyPackage.descriptor.version,
    MIN_RSPEEDY_VERSION,
  )
  assertVersionBefore(
    '@lynx-js/rspeedy',
    rspeedyPackage.descriptor.version,
    MAX_RSPEEDY_VERSION,
    'vue-lynx 0.5.x requires Rsbuild 1.x, while Rspeedy 0.15+ uses Rsbuild 2.x',
  )

  const vueLynxPackage = await loadPackage(root, 'vue-lynx')
  assertMinimumVersion(
    'vue-lynx',
    vueLynxPackage.descriptor.version,
    MIN_VUE_LYNX_VERSION,
  )

  let rspeedyModule: Record<string, unknown>
  let vueLynxPluginModule: Record<string, unknown>
  try {
    ;[rspeedyModule, vueLynxPluginModule] = await Promise.all([
      importPackageExport(rspeedyPackage, '.'),
      importPackageExport(vueLynxPackage, './plugin'),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[${PLUGIN_NAME}] failed to initialize Vue Lynx tooling: ${message}. ` +
        'Install compatible optional peers with ' +
        '"pnpm add -D @lynx-js/rspeedy vue-lynx @rsbuild/plugin-vue".',
      { cause: error },
    )
  }

  const createRspeedy = rspeedyModule.createRspeedy
  const mergeRspeedyConfig = rspeedyModule.mergeRspeedyConfig
  const pluginVueLynx = vueLynxPluginModule.pluginVueLynx
  if (
    typeof createRspeedy !== 'function' ||
    typeof mergeRspeedyConfig !== 'function' ||
    typeof pluginVueLynx !== 'function'
  ) {
    throw new Error(
      `[${PLUGIN_NAME}] incompatible tooling API detected. ` +
        `Found @lynx-js/rspeedy ${rspeedyPackage.descriptor.version} and ` +
        `vue-lynx ${vueLynxPackage.descriptor.version}; expected createRspeedy(), ` +
        'mergeRspeedyConfig(), and pluginVueLynx().',
    )
  }

  return {
    rspeedyVersion: rspeedyPackage.descriptor.version,
    vueLynxVersion: vueLynxPackage.descriptor.version,
    createRspeedy: createRspeedy as RspeedyRuntime['createRspeedy'],
    mergeRspeedyConfig:
      mergeRspeedyConfig as RspeedyRuntime['mergeRspeedyConfig'],
    pluginVueLynx: pluginVueLynx as RspeedyRuntime['pluginVueLynx'],
  }
}

interface LoadedPackage {
  descriptor: PackageDescriptor
  directory: string
}

async function loadPackage(
  root: string,
  packageName: string,
): Promise<LoadedPackage> {
  const projectRequire = createRequire(path.join(root, 'package.json'))
  const pluginRequire = createRequire(import.meta.url)
  const packageJsonSpecifier = `${packageName}/package.json`

  let packageJsonPath: string | undefined
  for (const resolver of [projectRequire, pluginRequire]) {
    try {
      packageJsonPath = resolver.resolve(packageJsonSpecifier)
      break
    } catch {
      // Try the next resolution scope.
    }
  }

  if (!packageJsonPath) {
    throw new Error(
      `[${PLUGIN_NAME}] missing optional peer dependency "${packageName}". ` +
        'Install Vue Lynx tooling with ' +
        '"pnpm add -D @lynx-js/rspeedy vue-lynx @rsbuild/plugin-vue".',
    )
  }

  const descriptor = JSON.parse(
    await readFile(packageJsonPath, 'utf8'),
  ) as PackageDescriptor
  return {
    descriptor,
    directory: path.dirname(packageJsonPath),
  }
}

async function importPackageExport(
  loadedPackage: LoadedPackage,
  subpath: string,
): Promise<Record<string, unknown>> {
  const target = resolveExportTarget(loadedPackage.descriptor.exports, subpath)
  if (!target) {
    throw new Error(
      `package "${loadedPackage.descriptor.name}" does not export "${subpath}"`,
    )
  }
  const file = path.resolve(loadedPackage.directory, target)
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>
}

function resolveExportTarget(
  exportsField: unknown,
  subpath: string,
): string | undefined {
  if (typeof exportsField === 'string') {
    return subpath === '.' ? exportsField : undefined
  }
  if (!exportsField || typeof exportsField !== 'object') return undefined

  const exportsRecord = exportsField as Record<string, unknown>
  const selected =
    Object.keys(exportsRecord).some((key) => key.startsWith('.'))
      ? exportsRecord[subpath]
      : subpath === '.'
        ? exportsField
        : undefined
  return selectConditionalExport(selected)
}

function selectConditionalExport(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const selected = selectConditionalExport(item)
      if (selected) return selected
    }
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  for (const condition of ['import', 'node', 'default']) {
    const selected = selectConditionalExport(record[condition])
    if (selected) return selected
  }
  for (const nested of Object.values(record)) {
    const selected = selectConditionalExport(nested)
    if (selected) return selected
  }
  return undefined
}

function assertMinimumVersion(
  packageName: string,
  actual: string,
  minimum: string,
): void {
  const actualParts = parseVersion(actual)
  const minimumParts = parseVersion(minimum)
  const supported =
    actualParts[0] > minimumParts[0] ||
    (actualParts[0] === minimumParts[0] &&
      (actualParts[1] > minimumParts[1] ||
        (actualParts[1] === minimumParts[1] &&
          actualParts[2] >= minimumParts[2])))
  if (!supported) {
    throw new Error(
      `[${PLUGIN_NAME}] ${packageName} ${actual} is unsupported; ` +
        `version ${minimum} or newer is required.`,
    )
  }
}

function assertVersionBefore(
  packageName: string,
  actual: string,
  excluded: string,
  reason: string,
): void {
  if (compareVersions(parseVersion(actual), parseVersion(excluded)) >= 0) {
    throw new Error(
      `[${PLUGIN_NAME}] ${packageName} ${actual} is unsupported: ${reason}. ` +
        `Install a compatible version with ` +
        `"pnpm add -D '${packageName}@>=${MIN_RSPEEDY_VERSION} <${excluded}'".`,
    )
  }
}

function compareVersions(
  left: [number, number, number],
  right: [number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!
    if (difference !== 0) return difference
  }
  return 0
}

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) return [0, 0, 0]
  return [
    Number(match[1] ?? 0),
    Number(match[2] ?? 0),
    Number(match[3] ?? 0),
  ]
}
