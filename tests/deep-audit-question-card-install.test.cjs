'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { syncBuiltinESMExports } = require('node:module')
const repo = path.resolve(__dirname, '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const Q = '@deepseek-ai/dsh-client-ui-user-questions'
const BASE = '232a66c60ab295db19336fbe37ab3b0c326b38a17c9d1d0cf23371b8b4664df6'
const FINAL = '6f382a535cb182b062365773c57b23579e8195c0096901c1864c0b1ae0079457'
const frozenHelper = '251b67da1cc2c3846181200a681bb9849927758e0ace48d6eac72b0d773f2fe7'
const frozenBehavior = 'b42ad3d295fce400a76ed469f5b2b35783b3eeac1d221edb5b322d07c83a82b8'
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'question install 中文 '))
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const modules = path.join(root, 'node_modules')
  const files = {}
  const clients = ['dsh-api-session-controller','dsh-client-ui-chat','dsh-client-ui-conversation','dsh-client-connection','dsh-client-ui-schedule','dsh-client-ui-attachment','dsh-client-ui-user-questions']
  const servers = ['dsh-session-turn-outline','dsh-api-gateway','dsh-api-remotes','dsh-session','dsh-session-projection-cache','dsh-storage-domain','dsh-storage-json','dsh-llm-pi-ai']
  for (const [name, file] of [...clients.map(name => ['@deepseek-ai/' + name, 'client.js']), ...servers.map(name => ['@deepseek-ai/' + name, 'index.js']), ['dsh-plugin-marketplace', 'index.js']]) {
    const dir = path.join(modules, name)
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
    fs.copyFileSync(path.join(repo, 'node_modules', name, 'package.json'), path.join(dir, 'package.json'))
    const target = path.join(dir, 'lib', file)
    fs.copyFileSync(path.join(repo, 'node_modules', name, 'lib', file), target)
    files[name] = target
  }
  assert.equal(hash(fs.readFileSync(path.join(repo, 'scripts/deep-audit-question-card-patch.mjs'))), frozenHelper)
  const api = await import(pathToFileURL(path.join(repo, 'scripts/patch-official-runtime.mjs')).href)
  const conversation = files['@deepseek-ai/dsh-client-ui-conversation']
  fs.writeFileSync(conversation, api.restoreModernConversationComposerVisibilitySource(fs.readFileSync(conversation, 'utf8')))
  const question = files[Q]
  assert.equal(hash(fs.readFileSync(question)), BASE)
  return { root, modules, files, api, question, conversation, targets: { conversation, session: files['@deepseek-ai/dsh-api-session-controller'], attachment: files['@deepseek-ai/dsh-client-ui-attachment'] } }
}
function snapshot(f) { return Object.fromEntries(Object.entries(f.files).map(([name, file]) => [name, hash(fs.readFileSync(file))])) }
async function install(f) {
  await f.api.assertInstalledAlpha5RuntimePreflight(f.root)
  const visibility = await f.api.patchInstalledModernConversationComposerVisibility(f.conversation)
  const provider = await f.api.patchInstalledProviderAuthIsolation(f.files['@deepseek-ai/dsh-llm-pi-ai'])
  const marketplace = await f.api.patchInstalledMarketplace155(f.files['dsh-plugin-marketplace'])
  const imageQueue = await f.api.patchInstalledAlpha5ImageQueuePerformance(f.targets)
  const core = await f.api.patchInstalledSessionCoreClient(f.conversation)
  const question = (await f.api.patchQuestionCardRuntime(f.root)).changed
  return { visibility, provider, marketplace, imageQueue, core, question }
}

test('normal question install hooks run after strict native preflight and preserve the full known composition on replay', async t => {
  const f = await fixture(t)
  const once = await install(f)
  assert.deepEqual(once, { visibility: true, provider: true, marketplace: true, imageQueue: true, core: true, question: true })
  const complete = snapshot(f)
  assert.equal(complete[Q], FINAL)
  assert.equal(complete['@deepseek-ai/dsh-client-ui-conversation'], '30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066')
  assert.equal(complete['@deepseek-ai/dsh-llm-pi-ai'], '28a7850e44bc24cdd0e5e7222eb0fe655877d1433db59f8ff435934528ba0207')
  assert.equal(complete['dsh-plugin-marketplace'], 'bba2417fc236501badf532c76a85673410c5579a5e54d420565c02e963836bde')
  assert.deepEqual(await install(f), { visibility: false, provider: false, marketplace: false, imageQueue: false, core: false, question: false })
  assert.deepEqual(snapshot(f), complete)
  const source = fs.readFileSync(path.join(repo, 'scripts/patch-official-runtime.mjs'), 'utf8')
  const preflight = source.lastIndexOf('if (targetsAlpha5) await assertInstalledAlpha5RuntimePreflight(root)')
  const firstWrite = source.lastIndexOf('const sessionChanged = targetsAlpha5 ?')
  const core = source.lastIndexOf('const sessionCoreChanged = targetsAlpha5 ? await patchInstalledSessionCoreClient() : false')
  const question = source.lastIndexOf('const questionCardChanged = targetsAlpha5 ? (await patchQuestionCardRuntime(root)).changed : false')
  assert.ok(preflight >= 0 && firstWrite > preflight && core > firstWrite && question > core, 'normal CLI wiring is source-checked, never executed')
})

test('shared mandatory preflight rejects missing or foreign question package before any maintenance writes', async t => {
  for (const fault of ['missing', 'identity', 'version', 'hash']) {
    const f = await fixture(t), manifest = path.join(path.dirname(f.question), '../package.json')
    if (fault === 'missing') fs.rmSync(path.resolve(path.dirname(manifest)), { recursive: true, force: true })
    else if (fault === 'hash') fs.appendFileSync(f.question, '\n// same markers, unknown source')
    else fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, 'utf8')), [fault === 'identity' ? 'name' : 'version']: 'foreign' }))
    const allBytes = () => Object.fromEntries(Object.values(f.files).flatMap(file => [file, path.join(path.dirname(file), '../package.json')]).map(file => [file, fs.existsSync(file) ? hash(fs.readFileSync(file)) : null]))
    const before = allBytes()
    await assert.rejects(install(f), fault === 'missing' ? { code: 'ENOENT' } : fault === 'hash' ? /SHA-256/ : /identity/)
    assert.deepEqual(allBytes(), before, 'nothing in the full maintenance chain may be written on a failed shared preflight')
  }
})

test('question adapter changes only its exact target and checks every replay byte', async t => {
  const f = await fixture(t), before = snapshot(f)
  const result = await f.api.patchQuestionCardRuntime(f.root)
  assert.deepEqual(result, { package: Q, file: f.question, changed: true, sha256: FINAL })
  const after = snapshot(f)
  assert.deepEqual(Object.keys(after).filter(name => after[name] !== before[name]), [Q])
  assert.equal(await f.api.assertInstalledQuestionCardNativeCapability(f.root), false)
  assert.equal((await f.api.patchQuestionCardRuntime(f.root)).changed, false)
  assert.deepEqual(snapshot(f), after)
  assert.deepEqual(fs.readdirSync(path.dirname(f.question)), ['client.js'])
})

test('question preflight and writer reject wrong identity, version and same-marker drift without overwriting', async t => {
  const f = await fixture(t)
  const manifest = path.join(path.dirname(f.question), '../package.json')
  const metadata = fs.readFileSync(manifest, 'utf8'), original = fs.readFileSync(f.question, 'utf8')
  for (const change of [{ name: '@deepseek-ai/other' }, { version: '0.1.2-alpha.4' }]) {
    fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(metadata), ...change }))
    const before = snapshot(f)
    await assert.rejects(f.api.assertInstalledQuestionCardNativeCapability(f.root), /identity/)
    await assert.rejects(f.api.patchQuestionCardRuntime(f.root), /identity/)
    assert.deepEqual(snapshot(f), before)
  }
  fs.writeFileSync(manifest, metadata)
  await f.api.patchQuestionCardRuntime(f.root)
  const patched = fs.readFileSync(f.question, 'utf8')
  for (const input of [original + '\n', original.replace(/\n/g, '\r\n'), patched + '\n// identical markers, foreign bytes']) {
    fs.writeFileSync(f.question, input)
    const before = snapshot(f)
    await assert.rejects(f.api.assertInstalledQuestionCardNativeCapability(f.root), /SHA-256/)
    await assert.rejects(f.api.patchQuestionCardRuntime(f.root), /SHA-256/)
    assert.deepEqual(snapshot(f), before)
    assert.equal(fs.readFileSync(f.question, 'utf8'), input)
  }
})

test('frozen question writer preserves old bytes on competing lock and injected rename failure, then recovers', async t => {
  const f = await fixture(t), before = snapshot(f), lock = f.question + '.dsh-patch.lock'
  fs.writeFileSync(lock, 'competing-fixture-owner')
  await assert.rejects(f.api.patchQuestionCardRuntime(f.root), { code: 'EEXIST' })
  assert.equal(fs.readFileSync(lock, 'utf8'), 'competing-fixture-owner')
  assert.deepEqual(snapshot(f), before)
  fs.unlinkSync(lock)
  // A scoped built-in I/O fault, not a replacement algorithm or edited helper.
  // This isolated test process runs serially; restore all ESM bindings in finally.
  const rename = fsp.rename
  let calls = 0
  fsp.rename = async (from, to) => {
    if (to !== f.question) return rename(from, to)
    assert.ok(from.startsWith(f.question + '.dsh-patch-')); calls++
    throw Object.assign(new Error('synthetic question rename failure'), { code: 'EPERM' })
  }
  syncBuiltinESMExports()
  try { await assert.rejects(f.api.patchQuestionCardRuntime(f.root), /synthetic question rename failure/) }
  finally { fsp.rename = rename; syncBuiltinESMExports() }
  assert.equal(calls, 1)
  assert.deepEqual(snapshot(f), before)
  assert.deepEqual(fs.readdirSync(path.dirname(f.question)), ['client.js'])
  assert.equal((await f.api.patchQuestionCardRuntime(f.root)).sha256, FINAL)
  assert.equal(hash(fs.readFileSync(path.join(repo, 'scripts/deep-audit-question-card-patch.mjs'))), frozenHelper)
})

function replaceOnce(source, before, after) { assert.equal(source.split(before).length, 2); return source.replace(before, after) }

test('actual installed question bundle passes frozen isolated Chromium behavior with memory transformation forbidden', { timeout: 90000 }, async t => {
  const f = await fixture(t)
  await install(f)
  const authored = fs.readFileSync(path.join(repo, 'tests/deep-audit-question-card.test.cjs'), 'utf8')
  assert.equal(hash(authored), frozenBehavior)
  const boundary = "if (process.versions.electron && process.argv.includes('--question-electron')) {"
  assert.equal(authored.split(boundary).length, 2)
  let header = authored.split(boundary)[0]
  header = replaceOnce(header, "const repo = path.resolve(__dirname, '..')", 'const repo = ' + JSON.stringify(repo))
  header = replaceOnce(header, "const bundlePath = path.join(repo, 'node_modules/@deepseek-ai/dsh-client-ui-user-questions/lib/client.js')", 'const bundlePath = ' + JSON.stringify(f.question))
  header = replaceOnce(header, "const patchedMode = process.argv.includes('--patched')", 'const patchedMode = true')
  header = replaceOnce(header, "const patchModule = () => import(require('node:url').pathToFileURL(path.join(repo,'scripts/deep-audit-question-card-patch.mjs')).href)", "const patchModule = () => { throw Error('Memory transformation forbidden in installed fixture') }")
  header = replaceOnce(header, `    const originalBundle = fs.readFileSync(bundlePath, 'utf8')
    const patch = await patchModule()
    assert.equal(sha(originalBundle),patch.QUESTION_BASE_SHA256,'Exact read-only source bundle')
    const bundle = patchedMode ? patch.patchQuestionCardSource(originalBundle) : originalBundle`, `    const bundle = fs.readFileSync(bundlePath, 'utf8')
    assert.equal(sha(bundle), ${JSON.stringify(FINAL)}, 'Actual installed output, never a memory transform')`)
  header = replaceOnce(header, "const conversation = fs.readFileSync(path.join(repo, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'), 'utf8')", 'const conversation = fs.readFileSync(' + JSON.stringify(f.conversation) + ", 'utf8')")
  header = replaceOnce(header, "    await run('ReactDOM.flushSync(()=>domRoot.unmount())')", "    await run('ReactDOM.flushSync(()=>domRoot.unmount())')\n    return { checkCount: checks.length, bundleSha256: sha(bundle) }")
  assert.equal(header.includes('patch.patchQuestionCardSource'), false)
  const profile = path.join(f.root, 'electron-profile'), receipt = path.join(f.root, 'behavior-receipt.json')
  fs.mkdirSync(profile)
  const entry = path.join(f.root, 'installed-question-fixture.cjs')
  fs.writeFileSync(entry, header + `\nelectronMain().then(result => { fs.writeFileSync(${JSON.stringify(receipt)}, JSON.stringify(result)); require('electron').app.exit(0) }, error => { console.error(error); require('electron').app.exit(1) })\n`)
  const executable = path.join(repo, 'node_modules/electron/dist/electron.exe')
  assert.ok(fs.existsSync(executable), 'Cached Electron required; never download')
  const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH, TEMP: profile, TMP: profile, HOME: profile, USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile }
  const result = require('node:child_process').spawnSync(executable, [entry, '--question-electron', profile], { cwd: repo, env, stdio: 'inherit', timeout: 75000 })
  assert.ifError(result.error); assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(fs.readFileSync(receipt, 'utf8')), { checkCount: 44, bundleSha256: FINAL })
  assert.equal(hash(fs.readFileSync(f.question)), FINAL)
  assert.equal(hash(fs.readFileSync(path.join(repo, 'node_modules', Q, 'lib/client.js'))), BASE, 'real dependency untouched')
})
