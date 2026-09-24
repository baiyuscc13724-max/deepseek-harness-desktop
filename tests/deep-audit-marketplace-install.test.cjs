const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { pathToFileURL, fileURLToPath } = require('node:url')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const sourceFile = path.join(root, 'node_modules/dsh-plugin-marketplace/lib/index.js')
const digest = value => createHash('sha256').update(value).digest('hex').toUpperCase()
async function temporary(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'market-audit-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir }
async function fixture(t, options = {}) {
  const dir = await temporary(t)
  await fs.mkdir(path.join(dir, 'marketplace'), { recursive: true })
  await fs.mkdir(path.join(dir, 'profiles/web'), { recursive: true })
  await fs.writeFile(path.join(dir, 'profiles/web/cordis.patch.yml'), '[]\n')
  const { patchMarketplace155Source } = await import('../scripts/deep-audit-marketplace-patch.mjs')
  let source = patchMarketplace155Source(await fs.readFile(sourceFile, 'utf8')).source
  source = source.replace(/^import .*;\r?\n/gm, '').replace(/\bexport (?=const |function )/g, '').replace(/^export \{[^\n]+\};?$/m, '').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(sourceFile).href))
  const deny = () => { throw new Error('TEST_PROCESS_FORBIDDEN') }
  const sandbox = { ...path, ...require('node:crypto'), ...fs, ...options.fs,
    execFile: deny, spawnSync: deny, mkdtemp: deny,
    promisify: require('node:util').promisify, createRequire: require('node:module').createRequire,
    fileURLToPath, gunzipSync: require('node:zlib').gunzipSync,
    homedir: () => dir, tmpdir: () => dir, process: { env: { DSH_HOME: dir }, platform: process.platform },
    Buffer, URL, AbortSignal, TextDecoder, setTimeout, clearTimeout,
    console: { warn() {}, log() {}, error() {} }, fetch: async () => { throw new Error('TEST_NETWORK_FORBIDDEN') } }
  sandbox.cp = options.fs?.cp || (async (from, to, opts) => {
    for (const file of [from, to]) assert.ok(path.resolve(file).startsWith(dir + path.sep), 'copy stays in exact fixture')
    await fs.cp(from, to, opts)
  })
  const api = await vm.runInNewContext(`(async()=>{${source}\nreturn { applyEnvEdit, appendPatchEntry, removePatchEntry, saveInstalled, removeInstalled, installRepo, auditMergeDotEnv, seed(repo,record){installedMap.set(repo,record)}, envSnapshot(){return JSON.parse(JSON.stringify(envStore))} };})()`, sandbox, { filename: sourceFile })
  return { dir, api, env: path.join(dir, 'marketplace/envs.json'), dotenv: path.join(dir, '.env') }
}

test('production marketplace installer validates identity/hash, patches only temp and refuses drift', async t => {
  const dir = await temporary(t), lib = path.join(dir, 'lib'), target = path.join(lib, 'index.js')
  await fs.mkdir(lib)
  const manifest = path.join(dir, 'package.json'), original = await fs.readFile(sourceFile, 'utf8')
  const { MARKETPLACE_155_INPUT_SHA256, MARKETPLACE_155_OUTPUT_SHA256 } = await import('../scripts/deep-audit-marketplace-patch.mjs')
  const { patchInstalledMarketplace155 } = await import('../scripts/patch-official-runtime.mjs')
  // A clean `npm ci` installs the pristine marketplace source, while a developer machine
  // holds the patched artifact after its own postinstall. Both are legitimate starting
  // states, so bind the fixture to whichever recognized artifact is installed.
  const pristine = digest(original) === MARKETPLACE_155_INPUT_SHA256
  assert.equal(pristine || digest(original) === MARKETPLACE_155_OUTPUT_SHA256, true, 'installed marketplace source is a recognized artifact')
  await fs.writeFile(manifest, JSON.stringify({ name: 'dsh-plugin-marketplace', version: '1.5.5' }))
  await fs.writeFile(target, original)
  assert.equal(await patchInstalledMarketplace155(target), pristine)
  const output = await fs.readFile(target, 'utf8')
  assert.equal(digest(output), MARKETPLACE_155_OUTPUT_SHA256)
  assert.equal(await patchInstalledMarketplace155(target), false)
  await fs.writeFile(target, output + '\n// drift')
  await assert.rejects(patchInstalledMarketplace155(target), /source hash changed/)
  assert.equal(await fs.readFile(target, 'utf8'), output + '\n// drift')
  await fs.writeFile(target, original)
  await fs.writeFile(manifest, JSON.stringify({ name: 'wrong-package', version: '1.5.5' }))
  await assert.rejects(patchInstalledMarketplace155(target), /identity\/version changed/)
  await fs.writeFile(manifest, JSON.stringify({ name: 'dsh-plugin-marketplace', version: '1.5.6' }))
  await assert.rejects(patchInstalledMarketplace155(target), /identity\/version changed/)
  assert.equal(await fs.readFile(sourceFile, 'utf8'), original)
})

test('env clear removes duplicate/export/multiline old values while preserving unrelated bytes', async t => {
  const f = await fixture(t)
  await fs.writeFile(f.env, JSON.stringify({ 'fake/a': { FAKE_KEY: 'old' } }))
  await fs.writeFile(f.dotenv, '# keep\r\n export FAKE_KEY="old\r\nsecret"\r\nFAKE_KEY=duplicate\r\nOTHER_KEY=stay\r\n# tail\r\n')
  await f.api.applyEnvEdit('fake/a', { FAKE_KEY: '' })
  assert.equal(await fs.readFile(f.dotenv, 'utf8'), '# keep\r\nOTHER_KEY=stay\r\n# tail\r\n')
  assert.deepEqual(JSON.parse(await fs.readFile(f.env, 'utf8')), { 'fake/a': {} })
})

test('env concurrent independent repos preserve both values and reject cross-owner deletion', async t => {
  const f = await fixture(t)
  await Promise.all([f.api.applyEnvEdit('fake/a', { FAKE_A: 'value-a' }), f.api.applyEnvEdit('fake/b', { FAKE_B: 'value-b' })])
  const before = await fs.readFile(f.dotenv, 'utf8')
  assert.match(before, /FAKE_A="value-a"/); assert.match(before, /FAKE_B="value-b"/)
  await assert.rejects(f.api.applyEnvEdit('fake/b', { FAKE_A: '' }), /KEY_CONFLICT/)
  assert.equal(await fs.readFile(f.dotenv, 'utf8'), before)
})

test('env serialization round trips through the actual bootstrap Node parseEnv', async t => {
  const f = await fixture(t), parseEnv = require('node:util').parseEnv
  const values = { FAKE_PATH: 'C:\\fixture\\path', FAKE_QUOTE: 'with"quote#tag', FAKE_SINGLE: "with'quote", FAKE_SLASH_N: 'literal\\nvalue' }
  await f.api.applyEnvEdit('fake/a', values)
  const parsed = parseEnv(await fs.readFile(f.dotenv, 'utf8'))
  const stored = JSON.parse(await fs.readFile(f.env, 'utf8'))['fake/a']
  for (const [key, value] of Object.entries(values)) {
    assert.equal(parsed[key], value)
    assert.equal(stored[key], parsed[key])
  }
})

test('env deletion follows bootstrap quote termination and cannot consume unrelated lines', async t => {
  const f = await fixture(t)
  const original = 'FAKE_PATH="C:\\fixture\\"\nOTHER_KEY="untouched"\n'
  assert.equal(require('node:util').parseEnv(original).OTHER_KEY, 'untouched')
  await fs.writeFile(f.dotenv, original)
  await f.api.applyEnvEdit('fake/a', { FAKE_PATH: '' })
  assert.equal(await fs.readFile(f.dotenv, 'utf8'), 'OTHER_KEY="untouched"\n')
})

test('env edits preserve unrelated multiline values and inline comments', async t => {
  const f = await fixture(t)
  const unrelated = 'OTHER="one\nFAKE_KEY=inside-unrelated-value\nthree"\n'
  await fs.writeFile(f.dotenv, unrelated + 'FAKE_KEY=old # keep note\n')
  await f.api.applyEnvEdit('fake/a', { FAKE_KEY: '' })
  assert.equal(await fs.readFile(f.dotenv, 'utf8'), unrelated + '# keep note\n')
})

test('unrepresentable dotenv input is rejected without changing either file or exposing its value', async t => {
  const f = await fixture(t)
  const before = '# fixture\nFAKE_KEY=old\n'
  await fs.writeFile(f.dotenv, before); await fs.writeFile(f.env, '{}')
  for (const value of ['all\"\'`#delimiters', '\"mixed\'`#', 'one\0two']) {
    await assert.rejects(f.api.applyEnvEdit('fake/a', { FAKE_KEY: value }), error => error.message === 'MARKETPLACE_ENV_VALUE_UNREPRESENTABLE' && error.cause === undefined)
    assert.equal(await fs.readFile(f.dotenv, 'utf8'), before)
    assert.equal(await fs.readFile(f.env, 'utf8'), '{}')
  }
  await f.api.applyEnvEdit('fake/a', { FAKE_KEY: 'retry-fixture' })
  await f.api.applyEnvEdit('fake/a', { FAKE_KEY: '' })
  assert.equal(require('node:util').parseEnv(await fs.readFile(f.dotenv, 'utf8')).FAKE_KEY, undefined)
})

test('second env publication failure restores exact JSON and dotenv bytes and allows a clean retry', async t => {
  let fail = true
  const f = await fixture(t, { fs: { rename: async (from, to) => {
    if (fail && from.includes('.stage-') && path.basename(to) === '.env') { fail = false; throw new Error('secret-fixture-transport-detail') }
    return fs.rename(from, to)
  } } })
  const oldJson = '{ "fake/a": {"FAKE_A":"old"} }\n', oldDot = '# untouched\r\nFAKE_A=old\r\n'
  await fs.writeFile(f.env, oldJson); await fs.writeFile(f.dotenv, oldDot)
  await assert.rejects(f.api.applyEnvEdit('fake/a', { FAKE_A: 'new' }), error => error.message === 'MARKETPLACE_ENV_WRITE_FAILED' && error.cause === undefined)
  assert.equal(await fs.readFile(f.env, 'utf8'), oldJson); assert.equal(await fs.readFile(f.dotenv, 'utf8'), oldDot)
  await f.api.applyEnvEdit('fake/a', { FAKE_A: 'new' })
  assert.match(await fs.readFile(f.dotenv, 'utf8'), /FAKE_A="new"/)
  assert.equal((await fs.readdir(path.dirname(f.env))).some(file => /backup-|stage-|transaction|\.lock$/.test(file)), false)
})

test('env rollback failure preserves recovery evidence and fences later writes', async t => {
  const f = await fixture(t, { fs: { rename: async (from, to) => {
    if ((from.includes('.stage-') && path.basename(to) === '.env') || from.includes('.backup-')) throw new Error('fixture failure')
    return fs.rename(from, to)
  } } })
  await fs.writeFile(f.env, '{"fake/a":{"FAKE_A":"old"}}'); await fs.writeFile(f.dotenv, 'FAKE_A=old\n')
  await assert.rejects(f.api.applyEnvEdit('fake/a', { FAKE_A: 'new' }), /RECOVERY_REQUIRED/)
  const after = await fs.readFile(f.env, 'utf8')
  assert.ok((await fs.readdir(path.dirname(f.env))).some(name => name.includes('.backup-')))
  await assert.rejects(f.api.applyEnvEdit('fake/b', { FAKE_B: 'value' }), /RECOVERY_REQUIRED/)
  assert.equal(await fs.readFile(f.env, 'utf8'), after)
  assert.equal(await fs.readFile(f.dotenv, 'utf8'), 'FAKE_A=old\n')
})

test('env unknown disk state and concurrent-process lock are never silently overwritten', async t => {
  const f = await fixture(t)
  await fs.writeFile(f.env, '{broken-secret-fixture')
  await assert.rejects(f.api.applyEnvEdit('fake/a', { FAKE_A: 'new' }), error => !error.message.includes('secret-fixture'))
  assert.equal(await fs.readFile(f.env, 'utf8'), '{broken-secret-fixture')
  await fs.writeFile(f.env + '.lock', 'another writer')
  await assert.rejects(f.api.applyEnvEdit('fake/a', { FAKE_A: 'new' }), { code: 'EEXIST' })
  assert.equal(await fs.readFile(f.env + '.lock', 'utf8'), 'another writer')
})

test('installed and patch queue families preserve ordered concurrent mutations', async t => {
  const f = await fixture(t)
  await Promise.all([f.api.saveInstalled('fake/a', { type: 'skill' }), f.api.saveInstalled('fake/b', { type: 'skill' }), f.api.removeInstalled('fake/a')])
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(f.dir, 'marketplace/installed.json'), 'utf8'))), ['fake/b'])
  await Promise.all([f.api.appendPatchEntry('a', 'fake-a'), f.api.appendPatchEntry('b', 'fake-b'), f.api.removePatchEntry('fake-a')])
  const patch = await fs.readFile(path.join(f.dir, 'profiles/web/cordis.patch.yml'), 'utf8')
  assert.match(patch, /fake-b/); assert.doesNotMatch(patch, /fake-a/)
})

for (const type of ['skill', 'agent-preset']) {
  for (const failure of ['copy', 'activate', 'none']) {
    test(`${type} staged replacement preserves old tree on ${failure} and commits only complete trees`, async t => {
      const f = await fixture(t, { fs: {
        ...(failure === 'copy' ? { cp: async () => { throw new Error('fixture-copy-failure') } } : {}),
        rename: async (from, to) => { if (failure === 'activate' && from.includes('.stage-')) throw new Error('fixture-activate-failure'); return fs.rename(from, to) }
      } })
      const cache = path.join(f.dir, 'cache'), destination = path.join(f.dir, type === 'skill' ? 'skills' : '.agent-presets', 'fixture-skill')
      await fs.mkdir(cache); await fs.mkdir(destination, { recursive: true })
      const name = type === 'skill' ? 'SKILL.md' : 'AGENTS.md'
      await fs.writeFile(path.join(cache, name), type === 'skill' ? '---\nname: fixture-skill\ndescription: Fixture\n---\nnew' : 'new')
      await fs.writeFile(path.join(destination, name), 'old-good')
      const work = f.api.installRepo({ type, cacheDir: cache, repo: 'fake/fixture-skill', log: [], answers: {}, logLine() {}, lang: 'en' })
      if (failure === 'none') { await work; assert.match(await fs.readFile(path.join(destination, name), 'utf8'), /new/) }
      else { await assert.rejects(work, /fixture-(copy|activate)-failure/); assert.equal(await fs.readFile(path.join(destination, name), 'utf8'), 'old-good') }
      assert.deepEqual(await fs.readdir(path.dirname(destination)), ['fixture-skill'])
    })
  }
}
