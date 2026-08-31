const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const runtime = readFileSync(path.join(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-models', 'lib', 'client.js'), 'utf8')

test('native alpha.2 model settings binds credentials to official remotes', () => {
  assert.match(runtime, /ctx\.remote\.credentials\.describe\(\[ref\]\)/u)
  assert.match(runtime, /ctx\.remote\.credentials\.set\(ref, value\)/u)
  assert.match(runtime, /ctx\.remote\.credentials\.unset\(ref\)/u)
  assert.match(runtime, /ctx\.remote\.settings\.mutate\(ns, ops, expectedRevision\)/u)
})

test('native alpha.2 model settings discovers through the official remote', () => {
  assert.match(runtime, /ctx\.remote\.llm\.discoverModels\(settingsNs, request\)/u)
  assert.match(runtime, /answer\.kind === "refused"/u)
  assert.match(runtime, /answer\.models/u)
})

test('native alpha.2 model settings never reads or reveals credentials', () => {
  assert.doesNotMatch(runtime, /process\.env|Deno\.env|Bun\.env|credentials\.(?:get|read|reveal)\(/u)
})
