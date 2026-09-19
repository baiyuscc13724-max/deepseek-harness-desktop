'use strict'
// Exercises the newly added maintenance patch against a THROWAWAY copy of the subagent package:
//   scripts/patch-official-runtime.mjs -> patchInstalledSubagentTransportClassification
// It never touches node_modules in place, never runs the CLI, never starts the product.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const repo = path.resolve(__dirname, '..')
const PACKAGE = '@deepseek-ai/dsh-subagent'
const PRIOR_PATCHED = '875D76C0F97E32F7D5CE8EA2A025CCDA7DDC1E80DAF903AD4D7C090CBCB4C837'
const PATCHED = 'AE12BDE9FBCA8C1B7ACFE2937558690222CF926C2CE99AC4ACD6B281493E5D1A'
const sha = x => createHash('sha256').update(x).digest('hex').toUpperCase()

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'round4 subagent transport 中文 '))
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const packageRoot = path.join(root, 'node_modules', PACKAGE)
  fs.mkdirSync(path.join(packageRoot, 'lib'), { recursive: true })
  const src = path.join(repo, 'node_modules', PACKAGE)
  fs.copyFileSync(path.join(src, 'package.json'), path.join(packageRoot, 'package.json'))
  const file = path.join(packageRoot, 'lib', 'index.js')
  fs.copyFileSync(path.join(src, 'lib', 'index.js'), file)
  const api = await import(pathToFileURL(path.join(repo, 'scripts/deep-audit-subagent-transport-patch.mjs')).href)
  return { root, packageRoot, file, api }
}

function classifierFrom(text) {
  const start = text.indexOf('function boundedSubagentTerminalDiagnostic(')
  assert.ok(start >= 0, 'classifier must exist')
  const end = text.indexOf('\nfunction createLifecycleEmitter(', start)
  assert.ok(end > start, 'classifier must be followed by the lifecycle emitter')
  const body = text.slice(start, end)
  return new Function(`return (${body.slice(0, body.lastIndexOf('}') + 1)})`)()
}

test('the checkout carries the exact prior-patched subagent artifact this rule chains onto', () => {
  const source = fs.readFileSync(path.join(repo, 'node_modules', PACKAGE, 'lib', 'index.js'), 'utf8')
  assert.equal(sha(source), PRIOR_PATCHED)
})

test('the patch applies once, is idempotent, and produces exactly the pinned artifact', async t => {
  const f = await fixture(t)
  assert.equal(await f.api.patchInstalledSubagentTransportClassification(f.file), true)
  const once = fs.readFileSync(f.file, 'utf8')
  assert.equal(sha(once), PATCHED)
  assert.equal(once.split('\t\t\t} else if (rawCode === "transport" || rawMessage.includes("fetch failed")) {').length - 1, 1, 'the new branch must be inserted exactly once')
  assert.equal(await f.api.patchInstalledSubagentTransportClassification(f.file), false)
  assert.equal(sha(fs.readFileSync(f.file, 'utf8')), PATCHED, 'replay must not change a single byte')
})

test('the patched artifact classifies the observed delegation failure as retryable, and changes nothing else', async t => {
  const f = await fixture(t)
  await f.api.patchInstalledSubagentTransportClassification(f.file)
  const before = classifierFrom(fs.readFileSync(path.join(repo, 'node_modules', PACKAGE, 'lib', 'index.js'), 'utf8'))
  const after = classifierFrom(fs.readFileSync(f.file, 'utf8'))
  assert.deepEqual(after('error', { code: 'TRANSPORT', message: 'fetch failed' }, false), {
    code: 'SUBAGENT_PROVIDER_UNAVAILABLE', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: false, nextAction: 'retry_current_task'
  })
  assert.equal(before('error', { code: 'TRANSPORT', message: 'fetch failed' }, false).code, 'SUBAGENT_ERROR')
  const untouched = [
    ['aborted', 'aborted', {}], ['max-tokens', 'max-tokens', {}], ['refusal', 'refusal', {}], ['completed', 'completed', {}],
    ['teardown', 'error', { message: 'activation_teardown_failed' }],
    ['pi_ai_error', 'error', { code: 'pi_ai_error', message: 'model not found' }],
    ['timeout', 'error', { message: 'timed out' }], ['rate limit', 'error', { message: 'rate limit' }],
    ['overload', 'error', { message: 'overload' }], ['unavailable', 'error', { message: 'unavailable' }],
    ['internal', 'error', new TypeError('x is not a function')], ['enoent', 'error', { code: 'ENOENT', message: 'nope' }]
  ]
  for (const [label, stopReason, sourceValue] of untouched) {
    assert.deepEqual(after(stopReason, sourceValue, false), before(stopReason, sourceValue, false), `changed branch: ${label}`)
  }
})

test('the rule lives outside the frozen installer, so no accepted pin is disturbed', () => {
  const installer = fs.readFileSync(path.join(repo, 'scripts/patch-official-runtime.mjs'))
  assert.equal(sha(installer.toString('utf8')), '058D138507CCC626D3A30130C2D25DC976CFBBB8A9A44899F1BEB26BEE3CDD1F')
  assert.ok(!installer.includes('patchInstalledSubagentTransportClassification'))
})

test('inspection reports patchable, already-patched, and refused without writing', async t => {
  const f = await fixture(t)
  assert.equal(f.api.inspectInstalledSubagent(f.file).state, 'patchable')
  const before = fs.readFileSync(f.file, 'utf8')
  await f.api.patchInstalledSubagentTransportClassification(f.file)
  assert.equal(f.api.inspectInstalledSubagent(f.file).state, 'already-patched')
  const manifest = path.join(f.packageRoot, 'package.json')
  fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, 'utf8')), version: '9.9.9' }))
  assert.equal(f.api.inspectInstalledSubagent(f.file).state, 'refused')
  assert.equal(sha(fs.readFileSync(f.file, 'utf8')), PATCHED, 'inspection must never write')
  assert.notEqual(before, null)
})

test('a drifted source is refused and left byte-identical', async t => {
  const f = await fixture(t)
  const original = fs.readFileSync(f.file, 'utf8')
  fs.appendFileSync(f.file, '\n// unknown drift\n')
  const drifted = fs.readFileSync(f.file, 'utf8')
  await assert.rejects(f.api.patchInstalledSubagentTransportClassification(f.file), /neither the known prior patched artifact[\s\S]*nor the transport-classified artifact/)
  assert.equal(fs.readFileSync(f.file, 'utf8'), drifted)
  assert.notEqual(drifted, original)
})

test('a foreign identity or unknown version is refused before any write', async t => {
  for (const change of [{ name: '@deepseek-ai/other-subagent' }, { version: '0.1.2-alpha.4' }, { version: '9.9.9' }]) {
    const f = await fixture(t)
    const manifest = path.join(f.packageRoot, 'package.json')
    fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, 'utf8')), ...change }))
    const before = fs.readFileSync(f.file, 'utf8')
    await assert.rejects(f.api.patchInstalledSubagentTransportClassification(f.file), /identity or version changed/)
    assert.equal(fs.readFileSync(f.file, 'utf8'), before)
  }
})
