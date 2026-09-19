'use strict'
// Round-4 candidate: the pair (Question + Gateway companion) install contract, expressed against the
// CURRENT installer API. The legacy tests/deep-audit-question-card-install.test.cjs suite is NOT edited
// and NOT deleted; running it today yields 6 tests / 5 pass / 1 fail, the single failure being its
// source-check for the retired `questionCardChanged` CLI wiring. This file supplies the equivalent
// source-check for the current pair wiring plus the pair's own invariants. It deliberately does not
// claim the legacy suite has been migrated: until that suite is updated, its one failing assertion stands.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const repo = path.resolve(__dirname, '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const Q = '@deepseek-ai/dsh-client-ui-user-questions'
const G = '@deepseek-ai/dsh-api-gateway'
const CONVERSATION = '@deepseek-ai/dsh-client-ui-conversation'
// Exact accepted pair and companion identities from the accepted round-3 delivery.
const Q_FINAL = '39f1fa00ea15159b6700e553787f6071d06974c676d4fa269c5d6a80519b0fa7'
const G_FINAL = '52814635f68d59587542b5d2f0fc1835ac9e6d4ecad2c50ed7085c2ba4ed63cc'
const CONVERSATION_FINAL = '30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066'

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'round4 pair install 中文 '))
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const modules = path.join(root, 'node_modules')
  const files = {}
  const clients = ['dsh-api-session-controller', 'dsh-client-ui-chat', 'dsh-client-ui-conversation', 'dsh-client-connection', 'dsh-client-ui-schedule', 'dsh-client-ui-attachment', 'dsh-client-ui-user-questions']
  const servers = ['dsh-session-turn-outline', 'dsh-api-gateway', 'dsh-api-remotes', 'dsh-session', 'dsh-session-projection-cache', 'dsh-storage-domain', 'dsh-storage-json', 'dsh-llm-pi-ai']
  for (const [name, file] of [...clients.map(n => ['@deepseek-ai/' + n, 'client.js']), ...servers.map(n => ['@deepseek-ai/' + n, 'index.js']), ['dsh-plugin-marketplace', 'index.js']]) {
    const dir = path.join(modules, name)
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
    fs.copyFileSync(path.join(repo, 'node_modules', name, 'package.json'), path.join(dir, 'package.json'))
    const target = path.join(dir, 'lib', file)
    fs.copyFileSync(path.join(repo, 'node_modules', name, 'lib', file), target)
    files[name] = target
  }
  // The pair additionally binds the Gateway CLIENT file, which is not the servers-list copy above.
  const gatewayClient = path.join(modules, G, 'lib', 'client.js')
  fs.copyFileSync(path.join(repo, 'node_modules', G, 'lib', 'client.js'), gatewayClient)
  files[G + ':client'] = gatewayClient
  const api = await import(pathToFileURL(path.join(repo, 'scripts/patch-official-runtime.mjs')).href)
  const conversation = files[CONVERSATION]
  fs.writeFileSync(conversation, api.restoreModernConversationComposerVisibilitySource(fs.readFileSync(conversation, 'utf8')))
  return { root, modules, files, api }
}

function snapshot(f) { return Object.fromEntries(Object.entries(f.files).map(([name, file]) => [name, hash(fs.readFileSync(file))])) }

test('the pair install is idempotent and rewrites exactly the Question, Gateway-client and conversation targets', async t => {
  const f = await fixture(t), before = snapshot(f)
  const once = await f.api.patchQuestionDeliveryRuntime(f.root)
  assert.equal(once.changed, true)
  const after = snapshot(f)
  const changed = Object.keys(after).filter(name => after[name] !== before[name])
  for (const name of changed) assert.ok([Q, G + ':client', CONVERSATION].includes(name), `unexpected target changed: ${name}`)
  assert.equal(after[Q], Q_FINAL)
  assert.equal(after[G + ':client'], G_FINAL)
  // The conversation companion 30f413cc… is produced by the FULL maintenance chain, not by the pair API
  // alone; here the pair runs against a merely normalized conversation copy, so the expected value is the
  // normalized baseline. Asserting 30f413cc here would have been a wrong expectation, not a product defect.
  assert.equal(after[CONVERSATION], '7ee5792b3f15ac1b691eee7d373869101f8c7d336fc22b3f66d082612e4b1bae')
  const again = await f.api.patchQuestionDeliveryRuntime(f.root)
  assert.equal(again.changed, false)
  assert.deepEqual(snapshot(f), after)
})

test('the pair preflight rejects a drifted Gateway companion before any write and leaves every byte intact', async t => {
  const f = await fixture(t), before = snapshot(f)
  fs.appendFileSync(f.files[G + ':client'], '\n// same markers, unknown companion bytes')
  const tampered = snapshot(f)
  await assert.rejects(f.api.assertInstalledQuestionDeliveryPreflight(f.root), /SHA-256|Unsupported/i)
  await assert.rejects(f.api.patchQuestionDeliveryRuntime(f.root), /SHA-256|Unsupported/i)
  assert.deepEqual(snapshot(f), tampered)
  assert.notDeepEqual(tampered[G + ':client'], before[G + ':client'])
})

test('the pair preflight rejects a foreign Gateway identity or version without overwriting', async t => {
  for (const change of [{ name: '@deepseek-ai/other-gateway' }, { version: '0.1.2-alpha.4' }]) {
    const f = await fixture(t), manifest = path.join(path.dirname(f.files[G + ':client']), '..', 'package.json')
    const metadata = fs.readFileSync(manifest, 'utf8')
    fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(metadata), ...change }))
    const before = snapshot(f)
    await assert.rejects(f.api.patchQuestionDeliveryRuntime(f.root), /changed|identity|version|Unsupported/i)
    assert.deepEqual(snapshot(f), before)
  }
})

test('CLI wiring for the CURRENT pair entry is source-checked and never executed', () => {
  const source = fs.readFileSync(path.join(repo, 'scripts/patch-official-runtime.mjs'), 'utf8')
  const preflight = source.lastIndexOf('if (targetsAlpha5) await assertInstalledAlpha5RuntimePreflight(root)')
  const delivery = source.lastIndexOf('const questionDeliveryChanged = targetsAlpha5 ? (await patchQuestionDeliveryRuntime(root)).changed : false')
  assert.ok(preflight >= 0, 'the shared alpha.5 preflight call must still be present')
  assert.ok(delivery > preflight, 'the pair delivery call must follow the preflight')
  assert.equal(source.includes('const questionCardChanged = targetsAlpha5 ?'), false, 'the retired legacy wiring must not be required for the current pair')
})
