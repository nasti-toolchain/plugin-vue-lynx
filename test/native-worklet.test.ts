import { describe, expect, test } from '@lightning-js/lightning'

import {
  extractLocalImports,
  extractRegistrations,
  transformBackgroundWorklets,
  transformMainThreadWorklets,
} from '../src/native-worklet.js'

describe('native Nasti worklet transforms', () => {
  test('uses the same worklet id in background and main-thread output', async () => {
    const code = `
import './child.js'
import './theme.css'
const onTap = () => {
  'main thread'
  console.log('tap')
}
export { onTap }
`
    const id = '/project/src/App.ts'
    const background = await transformBackgroundWorklets({ code, id })
    const mainThread = await transformMainThreadWorklets({ code, id })
    const backgroundId = /_wkltId:\s*"([^"]+)"/.exec(background)?.[1]
    const mainThreadId =
      /registerWorkletInternal\("main-thread",\s*"([^"]+)"/.exec(
        mainThread,
      )?.[1]

    expect(backgroundId).toBeTruthy()
    expect(mainThreadId).toBe(backgroundId)
    expect(mainThread).toContain("import './child.js';")
    expect(mainThread).not.toContain('theme.css')
  })

  test('extracts balanced registrations and local dependency edges', () => {
    const registrations = extractRegistrations(`
registerWorkletInternal("main-thread", "one", function () {
  return call(")");
});
registerWorkletInternal("main-thread", "two", () => ({ ok: true }));
`)
    expect(registrations).toContain('"one"')
    expect(registrations).toContain('"two"')
    expect(extractLocalImports(`
import value from './value.js'
export { other } from "./other.js"
import '@scope/runtime'
`)).toBe("import './value.js';\nimport \"./other.js\";")
  })
})
