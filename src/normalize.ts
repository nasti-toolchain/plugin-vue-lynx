import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  EnvironmentBuildOutput,
  EnvironmentBuildResult,
} from '@nasti-toolchain/nasti'

import type { StatsLike } from './dependencies.js'
import type {
  VueLynxEnvironmentServeResult,
  VueLynxServeMetadata,
} from './types.js'

interface StatsAsset {
  name?: string
}

interface StatsEntrypoint {
  assets?: Array<string | StatsAsset>
}

interface StatsJson {
  assets?: StatsAsset[]
  children?: StatsJson[]
  entrypoints?: Record<string, StatsEntrypoint>
  [key: string]: unknown
}

export async function normalizeBuildResult(options: {
  environment: string
  rspeedyEnvironment: string
  outDir: string
  publicPath: string
  stats?: StatsLike
}): Promise<EnvironmentBuildResult> {
  const stats = toStatsJson(options.stats)
  const output = await readBuildOutput(options.outDir)
  const entries = resolveEntries(
    stats,
    output.map((item) => item.fileName),
    options.rspeedyEnvironment,
  )
  const publicPath = ensureTrailingSlash(options.publicPath)

  return {
    output,
    entries,
    publicPath,
    manifest: {
      environment: options.environment,
      rspeedyEnvironment: options.rspeedyEnvironment,
      publicPath,
      entries,
      assets: output.map((item) => item.fileName),
    },
    stats,
  }
}

export async function normalizeServeResult(options: {
  environment: string
  rspeedyEnvironment: string
  port: number
  urls: string[]
  stats?: StatsLike
}): Promise<VueLynxEnvironmentServeResult> {
  const stats = toStatsJson(options.stats)
  const entries = resolveEntries(stats, [], options.rspeedyEnvironment)
  if (Object.keys(entries).length === 0) {
    entries.main = `main.${options.rspeedyEnvironment}.bundle`
  }

  const baseUrls = options.urls.map(ensureTrailingSlash)
  const entryUrls = baseUrls.flatMap((baseUrl) =>
    Object.values(entries).map((entry) => joinUrl(baseUrl, entry)),
  )
  const localUrls: string[] = []
  const networkUrls: string[] = []
  for (const url of entryUrls) {
    if (isLocalUrl(url)) localUrls.push(url)
    else networkUrls.push(url)
  }

  const previewUrls =
    options.rspeedyEnvironment === 'web' ||
    options.rspeedyEnvironment.startsWith('web-')
      ? baseUrls.flatMap((baseUrl) =>
          Object.values(entries).map((entry) =>
            joinUrl(
              baseUrl,
              `__web_preview?casename=${encodeURIComponent(entry)}`,
            ),
          ),
        )
      : []
  const qrCodes = [...localUrls, ...networkUrls].map((url) => {
    const entry =
      Object.entries(entries).find(([, file]) => url.endsWith(file))?.[0] ??
      'main'
    return {
      environment: options.environment,
      entry,
      url,
      value: url,
    }
  })
  const metadata: VueLynxServeMetadata = {
    environment: options.environment,
    rspeedyEnvironment: options.rspeedyEnvironment,
    port: options.port,
    baseUrls,
    entries,
    previewUrls,
    qrCodes,
  }

  return {
    localUrls,
    networkUrls,
    metadata,
  }
}

export function resolveEntries(
  stats: StatsJson,
  files: string[],
  rspeedyEnvironment: string,
): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const node of flattenStats(stats)) {
    for (const [name, entrypoint] of Object.entries(node.entrypoints ?? {})) {
      const assets = entrypoint.assets ?? []
      const fileNames = assets
        .map((asset) => (typeof asset === 'string' ? asset : asset.name))
        .filter((asset): asset is string => Boolean(asset))
      const selected =
        fileNames.find((file) =>
          file.endsWith(`.${rspeedyEnvironment}.bundle`),
        ) ??
        fileNames.find((file) => file.endsWith('.bundle')) ??
        fileNames.find((file) => /\.(?:m?js|cjs)$/.test(file))
      if (selected) entries[name] = selected
    }
  }

  if (Object.keys(entries).length > 0) return entries
  for (const file of files) {
    if (!file.endsWith(`.${rspeedyEnvironment}.bundle`)) continue
    const name =
      path.basename(file).slice(
        0,
        -`.${rspeedyEnvironment}.bundle`.length,
      ) || 'main'
    entries[name] = file
  }
  return entries
}

function toStatsJson(stats?: StatsLike): StatsJson {
  if (!stats?.toJson) return {}
  const value = stats.toJson({
    all: false,
    assets: true,
    entrypoints: true,
    errors: true,
    hash: true,
    timings: true,
    warnings: true,
  })
  return value && typeof value === 'object' ? (value as StatsJson) : {}
}

function flattenStats(stats: StatsJson): StatsJson[] {
  const values = [stats]
  for (const child of stats.children ?? []) values.push(...flattenStats(child))
  return values
}

async function readBuildOutput(
  directory: string,
  relativeDirectory = '',
): Promise<EnvironmentBuildOutput[]> {
  let entries
  try {
    entries = await readdir(path.join(directory, relativeDirectory), {
      withFileTypes: true,
    })
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : ''
    if (code === 'ENOENT') return []
    throw error
  }

  const output: EnvironmentBuildOutput[] = []
  for (const entry of entries) {
    if (entry.name === '.rsbuild' || entry.name === '.rspeedy') continue
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      output.push(...(await readBuildOutput(directory, relativePath)))
      continue
    }
    if (!entry.isFile()) continue
    const fileName = relativePath.split(path.sep).join('/')
    output.push({
      fileName,
      type: isChunk(fileName) ? 'chunk' : 'asset',
      source: new Uint8Array(await readFile(path.join(directory, relativePath))),
    })
  }
  return output.sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  )
}

function isChunk(fileName: string): boolean {
  return /\.(?:bundle|cjs|js|mjs)$/.test(fileName)
}

function ensureTrailingSlash(value: string): string {
  if (!value) return '/'
  return value.endsWith('/') ? value : `${value}/`
}

function joinUrl(baseUrl: string, fileName: string): string {
  return new URL(fileName.replace(/^\//, ''), ensureTrailingSlash(baseUrl))
    .href
}

function isLocalUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1'
    )
  } catch {
    return false
  }
}
