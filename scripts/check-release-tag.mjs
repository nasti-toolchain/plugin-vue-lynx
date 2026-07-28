import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2]

assert.ok(tag, 'Missing release tag.')
assert.equal(
  tag,
  `v${packageJson.version}`,
  `Release tag ${tag} does not match package version ${packageJson.version}.`,
)
