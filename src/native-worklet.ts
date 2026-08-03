import path from 'node:path'

import { PLUGIN_NAME } from './constants.js'

const MAIN_THREAD_DIRECTIVES = [
  "'main thread'",
  '"main thread"',
] as const

export interface NativeWorkletTransformOptions {
  code: string
  id: string
}

export async function transformBackgroundWorklets({
  code,
  id,
}: NativeWorkletTransformOptions): Promise<string> {
  if (!hasMainThreadDirective(code) || isDependency(id)) return code
  return runWorkletTransform(code, id, 'JS')
}

export async function transformMainThreadWorklets({
  code,
  id,
}: NativeWorkletTransformOptions): Promise<string> {
  if (isDependency(id)) return code

  const imports = extractLocalImports(code)
  if (!hasMainThreadDirective(code)) return imports

  const transformed = await runWorkletTransform(code, id, 'LEPUS')
  return [imports, extractRegistrations(transformed)]
    .filter(Boolean)
    .join('\n')
}

export function hasMainThreadDirective(code: string): boolean {
  return MAIN_THREAD_DIRECTIVES.some((directive) => code.includes(directive))
}

export function extractLocalImports(code: string): string {
  const imports: string[] = []
  const importPattern =
    /^[ \t]*(?:(?:import\s+(?:[^'"]*?[ \t]+from[ \t]+)?|export\s+[^'"]*?[ \t]+from[ \t]+)(['"])([^'"]+)\1[ \t]*;?)/gm
  let match: RegExpExecArray | null

  while ((match = importPattern.exec(code)) !== null) {
    const quote = match[1]
    const specifier = match[2]
    if (
      specifier?.startsWith('.') &&
      !isStyleRequest(specifier)
    ) {
      imports.push(`import ${quote}${specifier}${quote};`)
    }
  }

  return imports.join('\n')
}

export function extractRegistrations(code: string): string {
  const registrations: string[] = []
  const marker = 'registerWorkletInternal('
  let searchFrom = 0

  while (true) {
    const start = code.indexOf(marker, searchFrom)
    if (start === -1) break

    const close = findBalancedEnd(code, start + marker.length - 1)
    if (close === -1) {
      throw new Error(
        `[${PLUGIN_NAME}] could not parse a main-thread worklet registration.`,
      )
    }

    let end = close + 1
    if (code[end] === ';') end++
    registrations.push(code.slice(start, end))
    searchFrom = end
  }

  return registrations.join('\n')
}

async function runWorkletTransform(
  code: string,
  id: string,
  target: 'JS' | 'LEPUS',
): Promise<string> {
  let transformModule: typeof import('@lynx-js/react/transform')
  try {
    transformModule = await import('@lynx-js/react/transform')
  } catch (error) {
    throw missingNativeDependency('@lynx-js/react', error)
  }

  const interopModule = transformModule as typeof transformModule & {
    default?: typeof transformModule
  }
  const transform =
    transformModule.transformReactLynxSync ??
    interopModule.default?.transformReactLynxSync
  if (!transform) {
    throw new Error(
      `[${PLUGIN_NAME}] "@lynx-js/react/transform" does not expose ` +
        'transformReactLynxSync().',
    )
  }

  const filename = cleanId(id)
  const result = transform(code, {
    pluginName:
      target === 'JS'
        ? 'vue:nasti-worklet'
        : 'vue:nasti-worklet-main-thread',
    filename,
    sourcemap: false,
    cssScope: false,
    shake: false,
    compat: false,
    refresh: false,
    defineDCE: false,
    directiveDCE: false,
    worklet: {
      target,
      filename,
      runtimePkg: 'vue-lynx',
    },
  })

  if (result.errors.length > 0) {
    const details = result.errors
      .map((error) => error.text)
      .filter(Boolean)
      .join('\n')
    throw new Error(
      `[${PLUGIN_NAME}] ${target} worklet transform failed for ` +
        `${path.basename(filename)}${details ? `:\n${details}` : '.'}`,
    )
  }
  return result.code
}

function findBalancedEnd(code: string, openingParen: number): number {
  let depth = 0
  let quote: '"' | "'" | '`' | undefined
  let escaped = false

  for (let index = openingParen; index < code.length; index++) {
    const character = code[index]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = undefined
      }
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
    } else if (character === '(') {
      depth++
    } else if (character === ')' && --depth === 0) {
      return index
    }
  }
  return -1
}

function isDependency(id: string): boolean {
  return cleanId(id).split(path.sep).includes('node_modules')
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

function missingNativeDependency(packageName: string, cause: unknown): Error {
  return new Error(
    `[${PLUGIN_NAME}] the experimental Nasti backend requires ` +
      `"${packageName}". Install the Nasti backend peers before building.`,
    { cause },
  )
}
