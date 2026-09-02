const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { ensureDesktopMemoryToolsPlugin } = require('../electron/bridge/desktop-memory-tools-plugin-service.cjs')

test('privacy-bounded automatic local memory tool installs idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-memory-tools-'))
  try {
    const bundledRoot = path.resolve(__dirname, '..', 'plugins', 'dsh-desktop-memory-tools')
    const first = await ensureDesktopMemoryToolsPlugin({ dshHome: root, bundledRoot })
    const second = await ensureDesktopMemoryToolsPlugin({ dshHome: root, bundledRoot })
    assert.equal(first.patchChanged, true)
    assert.equal(second.patchChanged, false)
    const profile = path.join(root, 'profiles', 'web')
    const patch = await readFile(path.join(profile, 'cordis.patch.yml'), 'utf8')
    const plugin = await readFile(path.join(profile, 'node_modules', 'dsh-desktop-memory-tools', 'lib', 'index.js'), 'utf8')
    assert.match(patch, /id: desktop-memory-tools/u)
    assert.match(plugin, /name: 'local_memory'/u)
    assert.match(plugin, /enum: \['status', 'search', 'remember', 'suggest', 'pack'\]/u)
    assert.doesNotMatch(plugin, /enum:\s*\[[^\]]*(?:update|delete|remove)/u)
    assert.match(plugin, /currentDirectHumanRoot/u)
    assert.match(plugin, /currentRoot\(ctx, exec\)/u)
    assert.match(plugin, /never save raw transcripts/u)
    assert.match(plugin, /团队成员必须使用负责人下发的临时 Memory Pack/u)
    assert.match(plugin, /source_session_id/u)
    assert.match(plugin, /scope_type: writeScope\.type/u)
    assert.match(plugin, /HARNESS_DESKTOP_CAPABILITIES_STATE_FILE/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('only the root can recall private memory and durable writes require a direct human turn', async () => {
  const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-desktop-memory-tools', 'lib', 'index.js')
  const mod = await import(`${pathToFileURL(pluginFile).href}?authority=${Date.now()}`)
  const cwd = path.resolve('test-project')
  const rootAgent = {
    id: 'root',
    session: {
      header: { cwd },
      events: [
        { type: 'turn/start' },
        { type: 'user/message', data: { source: { kind: 'user' } } }
      ],
      snapshotEvents() { return this.events.slice() }
    }
  }
  const childAgent = { id: 'child', session: { header: { cwd }, events: rootAgent.session.events } }
  const ctx = { agents: { roots: () => [rootAgent] } }
  assert.equal(mod.currentRoot(ctx, { agent: rootAgent }), true)
  assert.equal(mod.currentRoot(ctx, { agent: childAgent }), false)
  assert.equal(mod.currentDirectHumanRoot(ctx, { agent: rootAgent }), true)
  assert.equal(mod.currentDirectHumanRoot(ctx, { agent: childAgent }), false)
  assert.deepEqual(mod.rootScopes({ agent: rootAgent }), [
    { type: 'personal', ref: null },
    { type: 'project', ref: cwd }
  ])
})

test('main memory path bounds recall and safe automatic capture', async () => {
  const main = await readFile(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /if \(!preferences\.autoRecall\)/u)
  assert.match(main, /if \(!preferences\.autoCapture\)/u)
  assert.match(main, /Math\.min\(8/u)
  assert.match(main, /Math\.min\(5/u)
  assert.match(main, /ensureMemoryService\(\)\.recall/u)
  assert.match(main, /statuses: \[status\], scopes: \[scope\]/u)
  assert.match(main, /hit\.scopeType === scope\.scopeType && hit\.scopeRef === scope\.scopeRef/u)
  assert.match(main, /content: safeBrowserText\(hit\.content, 2000\)/u)
  assert.match(main, /createMemoryPack\(hits, \{ teamId, taskId \}\)/u)
  assert.match(main, /const status = action === 'suggest' \? 'candidate' : 'active'/u)
  assert.doesNotMatch(main, /return \{ stored: true,.*content/u)
})
