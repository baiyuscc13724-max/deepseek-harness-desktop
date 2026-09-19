const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL, fileURLToPath } = require('node:url')
// Defense in depth: run with an allowlisted child environment, then deny all
// non-fixture filesystem calls and all network by default before loading code.
for (const name of Object.keys(process.env)) if (/^(?:HARNESS|DSH)_/.test(name)) delete process.env[name]
const fixtureRoots = new Set()
const ioCounts = Object.create(null)
const repository = path.resolve(__dirname, '..')
const within = (file, root) => { const relative = path.relative(root, file); return !relative.startsWith('..') && !path.isAbsolute(relative) }
for (const method of ['readFile', 'writeFile', 'mkdir', 'rename', 'rm', 'readdir']) {
  const original = fs[method]
  fs[method] = async (...args) => {
    ioCounts[method] = (ioCounts[method] || 0) + 1
    for (const input of method === 'rename' ? args.slice(0, 2) : args.slice(0, 1)) {
      const file = path.resolve(input instanceof URL ? fileURLToPath(input) : String(input))
      const fixture = [...fixtureRoots].some(root => within(file, root))
      const sourceRead = ['readFile', 'readdir'].includes(method) && within(file, repository) && !file.includes(`${path.sep}.release-state${path.sep}`)
      if (!fixture && !sourceRead) throw new Error(`TEST_NON_FIXTURE_IO_DENIED:${method}`)
    }
    return original(...args)
  }
}
let forbiddenNetworkAttempts = 0
const forbiddenFetch = async () => { forbiddenNetworkAttempts++; throw new Error('TEST_NETWORK_FORBIDDEN') }
globalThis.fetch = forbiddenFetch
const { ProviderMeterRegistry } = require('../electron/bridge/provider-meter-service.cjs')
const { saveModelRouting, getModelRouting, ROUTING_PRESET_ID } = require('../electron/bridge/model-routing-service.cjs')

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deep-audit-config-'))
  fixtureRoots.add(root)
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}
async function meterHome(root, name, key) {
  const home = path.join(root, name)
  await fs.mkdir(home, { recursive: true })
  await fs.writeFile(path.join(home, 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    synthetic:\n      apiKeyEnv: AUDIT_KEY\n')
  await fs.writeFile(path.join(home, '.credentials.yaml'), `AUDIT_KEY: ${key}\n`)
  return home
}
function meterAdapter(refresh) { return { id: 'synthetic-meter', supports: () => true, refresh } }
function balance(value) { return { meters: [{ kind: 'balance', value }] } }
function gate() { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }

test('fixture guard denies non-fixture reads writes and network without dispatch', async () => {
  assert.equal(Object.keys(process.env).some(name => /^(?:HARNESS|DSH)_/.test(name)), false)
  await assert.rejects(fs.readFile(path.join(os.tmpdir(), 'not-a-fixture', 'capabilities.json')), /TEST_NON_FIXTURE_IO_DENIED/)
  await assert.rejects(fs.writeFile(path.join(os.tmpdir(), 'not-a-fixture', 'sentinel'), 'x'), /TEST_NON_FIXTURE_IO_DENIED/)
  await assert.rejects(fetch('https://synthetic.invalid'), /TEST_NETWORK_FORBIDDEN/)
  assert.equal(forbiddenNetworkAttempts, 1)
})

test('meter cache is isolated across homes and synthetic credential rotation', async t => {
  const root = await temporary(t)
  const a = await meterHome(root, 'a', 'fake-key-a')
  const b = await meterHome(root, 'b', 'fake-key-b')
  let calls = 0
  const registry = new ProviderMeterRegistry({ environment: {}, adapters: [meterAdapter(async () => balance(++calls))] })
  assert.equal((await registry.readAll({ dshHome: a })).snapshots[0].meters[0].value, 1)
  assert.equal((await registry.readAll({ dshHome: b })).snapshots[0].meters[0].value, 2)
  await fs.writeFile(path.join(a, '.credentials.yaml'), 'AUDIT_KEY: fake-key-rotated\n')
  assert.equal((await registry.readAll({ dshHome: a })).snapshots[0].meters[0].value, 3)
  assert.equal((await registry.readAll({ dshHome: a })).snapshots[0].meters[0].value, 3)
  assert.equal(JSON.stringify([...registry.cache.keys()]).includes('fake-key'), false)
})

test('meter inflight coalesces same snapshot but isolates concurrent account change', async () => {
  const pending = gate()
  let calls = 0
  const registry = new ProviderMeterRegistry({ adapters: [meterAdapter(async ({ credential }) => {
    calls++
    if (credential.value === 'fake-a') await pending.promise
    return balance(credential.value === 'fake-a' ? 1 : 2)
  })] })
  const p = { id: 'synthetic', name: 'Synthetic', profile: {} }
  const first = registry.refreshProvider(p, { credential: { value: 'fake-a' } }, true)
  const duplicate = registry.refreshProvider(p, { credential: { value: 'fake-a' } }, true)
  const second = registry.refreshProvider(p, { credential: { value: 'fake-b' } }, true)
  pending.release()
  const values = await Promise.all([first, duplicate, second])
  assert.deepEqual(values.map(v => v.meters[0].value), [1, 1, 2])
  assert.equal(calls, 2)
})

test('meter synchronous adapter failure is retryable instead of sticky inflight', async () => {
  let calls = 0
  const registry = new ProviderMeterRegistry({ adapters: [meterAdapter(() => {
    if (++calls === 1) throw new Error('fake-private-detail')
    return balance(42)
  })] })
  const p = { id: 'synthetic', profile: {} }
  assert.equal((await registry.refreshProvider(p, {}, true)).status, 'error')
  assert.equal(registry.inFlight.size, 0)
  assert.equal((await registry.refreshProvider(p, {}, true)).meters[0].value, 42)
})

test('meter never reuses a future cache entry after clock rollback', async () => {
  let now = 10000; let calls = 0
  const registry = new ProviderMeterRegistry({ now: () => now, adapters: [meterAdapter(async () => balance(++calls))] })
  const p = { id: 'synthetic', profile: {} }
  await registry.refreshProvider(p, {}, false)
  now = 9000
  assert.equal((await registry.refreshProvider(p, {}, false)).meters[0].value, 2)
})

async function routingHome(t) {
  const root = await temporary(t)
  const dshHome = path.join(root, 'home')
  const shippedPresetRoot = path.join(root, 'presets')
  const standard = path.join(shippedPresetRoot, 'standard')
  await fs.mkdir(standard, { recursive: true }); await fs.mkdir(dshHome)
  await fs.writeFile(path.join(standard, 'preset.yml'), 'name: Synthetic\n')
  await fs.writeFile(path.join(standard, 'agent.cordis.yml'), '- name: "@deepseek-ai/dsh-compaction-basic"\n- name: "@deepseek-ai/dsh-tool-subagent"\n  config: { provider: spawn }\n')
  await fs.writeFile(path.join(dshHome, 'settings.yaml'), 'agent-presets:\n  default: standard\n')
  return { dshHome, shippedPresetRoot }
}
const route = model => ({ main: { provider: 'synthetic', model }, subagent: { inheritMain: false, provider: 'synthetic', model: `worker-${model}` } })

test('routing settings failure restores preset bytes as well as route state', async t => {
  const options = await routingHome(t)
  await saveModelRouting(options, route('first'))
  const composition = path.join(options.dshHome, '.agent-presets', ROUTING_PRESET_ID, 'agent.cordis.yml')
  const before = await fs.readFile(composition, 'utf8')
  await assert.rejects(saveModelRouting({ ...options, writeFileAtomic: async (file, contents) => {
    if (path.basename(file) === 'settings.yaml') throw new Error('synthetic write denial')
    await fs.writeFile(file, contents)
  } }, route('second')), /synthetic write denial/)
  assert.equal((await getModelRouting(options)).main.model, 'first')
  assert.equal(await fs.readFile(composition, 'utf8'), before)
  assert.deepEqual((await fs.readdir(path.dirname(composition))).filter(n => n.includes('.tmp-') || n.includes('.bak-')), [])
})

test('routing state write failure also restores previously committed preset', async t => {
  const options = await routingHome(t)
  await saveModelRouting(options, route('first'))
  const composition = path.join(options.dshHome, '.agent-presets', ROUTING_PRESET_ID, 'agent.cordis.yml')
  const before = await fs.readFile(composition, 'utf8')
  await assert.rejects(saveModelRouting({ ...options, writeFileAtomic: async () => { throw new Error('synthetic state denial') } }, route('second')), /synthetic state denial/)
  assert.equal(await fs.readFile(composition, 'utf8'), before)
})

test('routing same-home concurrent saves settle with coherent state and preset', async t => {
  const options = await routingHome(t)
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => saveModelRouting(options, route(`model-${i}`))))
  assert.deepEqual(results.map(r => r.status), Array(6).fill('fulfilled'))
  const current = await getModelRouting(options)
  const composition = await fs.readFile(path.join(options.dshHome, '.agent-presets', ROUTING_PRESET_ID, 'agent.cordis.yml'), 'utf8')
  assert.match(composition, new RegExp(`model: ${current.subagent.model}`))
  const state = JSON.parse(await fs.readFile(path.join(options.dshHome, 'harness-desktop-model-routing.json'), 'utf8'))
  assert.equal(state.main.model, current.main.model)
})

test('memory project writes without workspace reject before capability read or network', async t => {
  const inherited = process.env.HARNESS_DESKTOP_CAPABILITIES_STATE_FILE
  delete process.env.HARNESS_DESKTOP_CAPABILITIES_STATE_FILE
  t.after(() => { if (inherited === undefined) delete process.env.HARNESS_DESKTOP_CAPABILITIES_STATE_FILE; else process.env.HARNESS_DESKTOP_CAPABILITIES_STATE_FILE = inherited })
  let fetchCalls = 0
  t.mock.method(globalThis, 'fetch', async () => { fetchCalls++; throw new Error('TEST_NETWORK_FORBIDDEN') })
  const module = await import(pathToFileURL(path.resolve(__dirname, '../plugins/dsh-desktop-memory-tools/lib/index.js')).href)
  const agent = { id: 'synthetic-root', session: { header: {}, snapshotEvents: () => [{ type: 'turn/start' }, { type: 'user/message', data: { source: { kind: 'user' } } }] } }
  let tool
  module.apply({ agents: { roots: () => [agent] }, systemPrompt: { section() {} }, tools: { register(value) { tool = value } } })
  const readsBefore = ioCounts.readFile || 0
  await assert.rejects(async () => tool.execute({ action: 'remember', scope: 'project', content: 'Synthetic project fact' }, { agent }), /工作区|workspace/i)
  await assert.rejects(async () => tool.execute({ action: 'suggest', kind: 'project', content: 'Synthetic project fact' }, { agent }), /工作区|workspace/i)
  assert.equal(ioCounts.readFile || 0, readsBefore)
  assert.equal(fetchCalls, 0)
})

const mcpServer = { id: 'synthetic', serverName: 'synthetic', label: 'Synthetic', enabled: true, transport: { kind: 'streamable-http', url: 'https://synthetic.invalid/mcp', headerRefs: { Authorization: 'FAKE_TOKEN' } } }

test('MCP close during credential resolution never starts a late client', async t => {
  const { McpManager } = await import('../plugins/dsh-desktop-mcp-manager/lib/index.js')
  const root = await temporary(t); const pending = gate(); const entered = gate(); let mounts = 0
  const manager = new McpManager({ file: path.join(root, 'mcp.json'), credentials: { resolve: async () => { entered.release(); await pending.promise; return { value: 'fake-token' } } }, mount: async () => { mounts++; return { dispose() {} } } })
  const creating = manager.create(mcpServer)
  await entered.promise
  const closing = manager.close()
  pending.release()
  await Promise.all([creating, closing])
  assert.equal(mounts, 0)
  assert.equal(manager.runtimes.size, 0)
})

test('MCP close disposes a delayed mount and refuses later mutations', async t => {
  const { McpManager } = await import('../plugins/dsh-desktop-mcp-manager/lib/index.js')
  const root = await temporary(t); const pending = gate(); const entered = gate(); let disposed = 0
  const manager = new McpManager({ file: path.join(root, 'mcp.json'), credentials: { resolve: async () => ({ value: 'fake-token' }) }, mount: async () => { entered.release(); await pending.promise; return { dispose() { disposed++ } } } })
  const creating = manager.create(mcpServer)
  await entered.promise
  const closing = manager.close()
  pending.release()
  await Promise.all([creating, closing])
  assert.equal(disposed, 1)
  assert.equal(manager.runtimes.size, 0)
  await assert.rejects(manager.delete('synthetic', 1), /closed|stopping/i)
})

test('marketplace repository identity rejects suffix-host spoofing and URL suffix tricks', () => {
  const { repositoryIdentity } = require('../electron/bridge/plugin-marketplace-service.cjs')
  for (const value of ['https://evilgithub.com/bradeGithub/DSH-Plugins-Marketplace', 'https://attacker.invalid/github.com/bradeGithub/DSH-Plugins-Marketplace', 'https://attacker.invalid/?url=github.com/bradeGithub/DSH-Plugins-Marketplace']) assert.equal(repositoryIdentity(value), '')
  for (const value of ['https://github.com/bradeGithub/DSH-Plugins-Marketplace.git', 'git+https://github.com/bradeGithub/DSH-Plugins-Marketplace.git', 'git@github.com:bradeGithub/DSH-Plugins-Marketplace.git']) assert.equal(repositoryIdentity(value), 'bradegithub/dsh-plugins-marketplace')
})

test('search invalid numeric entities do not abort useful RSS parsing', async () => {
  const { plainText } = await import('../plugins/dsh-desktop-web-search/lib/index.js')
  assert.equal(plainText('Useful &#99999999999; &#xD800; &#0; &#65;'), 'Useful � � � A')
})

test('search enforces streaming body limit before response.text and cancels reader', async () => {
  const { PublicSearchProvider } = await import('../plugins/dsh-desktop-web-search/lib/index.js')
  let cancels = 0; let reads = 0; let textCalls = 0
  const provider = new PublicSearchProvider(() => ({ engines: [{ id: 'fake', url: () => 'https://synthetic.invalid', parse: () => [] }], fetchImpl: async () => ({ ok: true, headers: new Headers(), body: { getReader: () => ({ read: async () => { reads++; return { done: false, value: new Uint8Array(1024 * 1024) } }, cancel: async () => { cancels++ }, releaseLock() {} }) }, text: async () => { textCalls++; return '' } }) }))
  await assert.rejects(provider.search({ query: 'synthetic' }))
  assert.equal(textCalls, 0)
  assert.equal(reads, 3)
  assert.equal(cancels, 1)
})

test('search result truncation is reported truthfully', async () => {
  const { PublicSearchProvider } = await import('../plugins/dsh-desktop-web-search/lib/index.js')
  const provider = new PublicSearchProvider(() => ({ maxResults: 1, engines: [{ id: 'fake', url: () => 'https://synthetic.invalid', parse: () => [{ url: 'https://a.invalid' }, { url: 'https://b.invalid' }] }], fetchImpl: async () => ({ ok: true, headers: new Headers(), text: async () => '' }) }))
  const result = await provider.search({ query: 'synthetic' })
  assert.equal(result.sources.length, 1)
  assert.equal(result.truncated, true)
})

test('search transport errors never retain raw proxy details in error chains', async () => {
  const { PublicSearchProvider } = await import('../plugins/dsh-desktop-web-search/lib/index.js')
  const provider = new PublicSearchProvider(() => ({ engines: [{ id: 'fake', url: () => 'https://synthetic.invalid', parse: () => [] }], fetchImpl: async () => { throw new Error('fake-proxy-credential-marker') } }))
  await assert.rejects(provider.search({ query: 'synthetic' }), error => {
    const nested = error.errors[0]
    assert.equal(nested.cause, undefined)
    assert.doesNotMatch(nested.message, /fake-proxy-credential-marker/)
    return true
  })
})

test('memory scoped writes and authority failures use only fixture capabilities and fake network', async t => {
  const root = await temporary(t)
  const file = path.join(root, 'capabilities.json')
  await fs.writeFile(file, JSON.stringify({ origin: 'http://127.0.0.1:1', token: 'fake-capability-token' }))
  process.env.HARNESS_DESKTOP_CAPABILITIES_STATE_FILE = file
  t.after(() => { delete process.env.HARNESS_DESKTOP_CAPABILITIES_STATE_FILE })
  const calls = []
  t.mock.method(globalThis, 'fetch', async (_url, request) => { calls.push(JSON.parse(request.body)); return { ok: true, json: async () => ({ stored: true }) } })
  const { apply } = await import('../plugins/dsh-desktop-memory-tools/lib/index.js')
  let events = [{ type: 'turn/start' }, { type: 'user/message', data: { source: { kind: 'user' } } }]
  const agent = { id: 'synthetic-root', session: { header: { cwd: root }, snapshotEvents: () => events } }
  let tool
  apply({ agents: { roots: () => [agent] }, systemPrompt: { section() {} }, tools: { register(t) { tool = t } } })
  await tool.execute({ action: 'remember', scope: 'project', content: 'fixture-only' }, { agent })
  assert.equal(calls[0].payload.scope_ref, root)
  assert.equal(calls[0].payload.scope_type, 'project')
  await tool.execute({ action: 'suggest', scope: 'personal', content: 'fixture-only' }, { agent })
  assert.equal(calls[1].payload.scope_type, 'personal')
  assert.equal(calls[1].payload.scope_ref, null)
  const before = ioCounts.readFile
  const child = { ...agent, id: 'synthetic-child' }
  for (const action of ['search', 'pack', 'remember', 'suggest']) await assert.rejects(tool.execute({ action }, { agent: child }))
  events = [{ type: 'turn/start' }, { type: 'user/message', data: { source: { kind: 'system' } } }]
  await assert.rejects(tool.execute({ action: 'remember' }, { agent }))
  events = [{ type: 'turn/start' }, { type: 'user/message', data: { source: { kind: 'user' } } }, { type: 'turn/end' }]
  await assert.rejects(tool.execute({ action: 'suggest' }, { agent }))
  assert.equal(calls.length, 2)
  assert.equal(ioCounts.readFile, before)
})

async function scheduleFixture(t) {
  const { registerScheduleTools } = await import('@deepseek-ai/dsh-schedule')
  t.mock.method(Date, 'now', () => Date.parse('2026-09-12T12:00:00Z'))
  const events = []; const tools = new Map(); let flush = async () => true
  const agent = { id: 'synthetic-schedule-root', session: { ownEvents: () => events.slice(), append(type, data) { events.push({ type, data }) } } }
  const dispose = registerScheduleTools({ sessions: { flush: () => flush() }, logger: { warn() {} } }, { tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } }, agent, () => {})
  t.after(dispose)
  const execute = (name, args, owner = agent, signal = new AbortController().signal) => tools.get(name).execute(args, { agent: owner, signal })
  return { events, agent, execute, setFlush: f => { flush = f } }
}

test('official schedule create/list/delete supports after offset zone and fixed-rate selectors', async t => {
  const f = await scheduleFixture(t)
  const selectors = [{ after_seconds: 60 }, { at: '2026-09-13T00:00:00+08:00' }, { at: { date: '2026-09-13', time: '09:00:00', time_zone: 'Asia/Shanghai' } }, { every_seconds: 300 }]
  for (const selector of selectors) { const created = await f.execute('schedule_create', { prompt: 'fixture reminder', ...selector }); assert.ok(created.id, JSON.stringify(created)) }
  const rows = await f.execute('schedule_list', {})
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map(row => row.id), ['schedule-1', 'schedule-2', 'schedule-3', 'schedule-4'])
  assert.equal((await f.execute('schedule_delete', { id: rows[0].id })).deleted, true)
  assert.equal((await f.execute('schedule_delete', { id: rows[0].id })).deleted, false)
  assert.equal((await f.execute('schedule_list', {})).length, 3)
})

test('official schedule validation and exact-agent isolation never append invalid requests', async t => {
  const f = await scheduleFixture(t)
  const invalid = [{}, { after_seconds: 1, every_seconds: 300 }, { after_seconds: 0 }, { after_seconds: 1.5 }, { every_seconds: 299 }, { every_seconds: Number.MAX_SAFE_INTEGER + 1 }, { at: '2026-09-13T00:00:00' }, { at: { date: '2026-09-13', time: '09:00:00', time_zone: 'Invalid/Zone' } }]
  for (const selector of invalid) assert.ok((await f.execute('schedule_create', { prompt: 'fixture', ...selector })).code)
  assert.ok((await f.execute('schedule_create', { prompt: 'fixture', after_seconds: 1 }, { ...f.agent })).code)
  const aborted = new AbortController(); aborted.abort()
  assert.ok((await f.execute('schedule_create', { prompt: 'fixture', after_seconds: 1 }, f.agent, aborted.signal)).code)
  assert.equal(f.events.length, 0)
})

test('official schedule serializes concurrent creates and recovers persistence uncertainty through list', async t => {
  const f = await scheduleFixture(t)
  const created = await Promise.all(Array.from({ length: 20 }, () => f.execute('schedule_create', { prompt: 'fixture', after_seconds: 60 })))
  assert.equal(new Set(created.map(row => row.id)).size, 20)
  f.setFlush(async () => false)
  assert.equal((await f.execute('schedule_create', { prompt: 'fixture', after_seconds: 60 })).code, 'persistence_uncertain')
  assert.equal(f.events.length, 20)
  let flushes = 0
  f.setFlush(async () => ++flushes !== 2)
  const uncertain = await f.execute('schedule_create', { prompt: 'fixture', after_seconds: 60 })
  assert.equal(uncertain.code, 'persistence_uncertain')
  assert.equal(f.events.length, 21)
  f.setFlush(async () => true)
  assert.equal((await f.execute('schedule_list', {})).filter(row => row.id === uncertain.id).length, 1)
})

test('meter stale fallback respects elapsed failure time and never hides revoked authentication', async () => {
  let now = 0; let state = 'success'
  const registry = new ProviderMeterRegistry({ now: () => now, staleMs: 100, adapters: [meterAdapter(async () => {
    if (state === 'success') return balance(7)
    if (state === 'late') now = 101
    throw Object.assign(new Error('fake-private-detail'), { code: state === 'auth' ? 'METER_AUTH_REQUIRED' : 'METER_UNAVAILABLE' })
  })] })
  const p = { id: 'synthetic', profile: {} }
  await registry.refreshProvider(p, {}, true)
  state = 'fail'; now = 50
  assert.equal((await registry.refreshProvider(p, {}, true)).stale, true)
  state = 'auth'
  assert.equal((await registry.refreshProvider(p, {}, true)).status, 'auth-required')
  state = 'late'
  assert.equal((await registry.refreshProvider(p, {}, true)).status, 'unavailable')
})

test('meter digest cache remains bounded across 300 account snapshots', async () => {
  const registry = new ProviderMeterRegistry({ now: () => 0, adapters: [meterAdapter(async () => balance(1))] })
  for (let i = 0; i < 300; i++) await registry.refreshProvider({ id: 'synthetic', profile: {} }, { credential: { value: `fake-${i}` } }, false)
  assert.equal(registry.cache.size, 256)
  assert.equal(registry.inFlight.size, 0)
})

test('routing concurrent independent homes retain their own main and worker selections', async t => {
  const a = await routingHome(t); const b = await routingHome(t)
  const [left, right] = await Promise.all([saveModelRouting(a, route('left')), saveModelRouting(b, route('right'))])
  assert.equal(left.main.model, 'left'); assert.equal(right.main.model, 'right')
  assert.equal((await getModelRouting(a)).subagent.model, 'worker-left')
  assert.equal((await getModelRouting(b)).subagent.model, 'worker-right')
})

test('image edit boundary rejects escaped and symlink inputs before reading bytes', async () => {
  const { resolveInputImage } = await import('../plugins/dsh-codex-image-bridge/src/core.js')
  let reads = 0
  const fakeFs = { resolve: async value => ({ value }), lstat: async () => ({ type: 'file' }), contains: () => false, readBytes: async () => { reads++ } }
  await assert.rejects(resolveInputImage(fakeFs, {}, 'outside.png', repository, 100, new AbortController().signal), error => error.code === 'INPUT_OUTSIDE_WORKSPACE')
  fakeFs.contains = () => true
  fakeFs.lstat = async () => ({ type: 'symlink' })
  await assert.rejects(resolveInputImage(fakeFs, {}, 'linked.png', repository, 100, new AbortController().signal), error => error.code === 'INPUT_NOT_REGULAR')
  assert.equal(reads, 0)
})

async function marketplaceFixture(t, overrides = {}) {
  const root = await temporary(t)
  await fs.mkdir(path.join(root, 'profiles/web'), { recursive: true })
  await fs.writeFile(path.join(root, 'profiles/web/cordis.patch.yml'), '[]\n')
  const filename = path.join(repository, 'node_modules/dsh-plugin-marketplace/lib/index.js')
  let source = await fs.readFile(filename, 'utf8')
  if (process.env.DEEP_AUDIT_MARKETPLACE_CANDIDATE === 'pinned-maintenance') {
    const { patchMarketplace155Source } = await import('../scripts/deep-audit-marketplace-patch.mjs')
    source = patchMarketplace155Source(source).source
    const hash = require('node:crypto').createHash('sha256').update(source).digest('hex').toUpperCase()
    if (!marketplaceFixture.candidateHash) { marketplaceFixture.candidateHash = hash; console.log(`marketplace-candidate-sha256=${hash}`) }
    assert.equal(hash, marketplaceFixture.candidateHash)
  }
  // Module-syntax adaptation only; route and persistence function bodies remain production source.
  source = source.replace(/^import .*;\r?\n/gm, '').replace(/\bexport (?=const |function )/g, '').replace(/^export \{[^\n]+\};?$/m, '').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href))
  const deny = () => { throw new Error('TEST_PROCESS_FORBIDDEN') }
  const sandbox = { ...require('node:path'), ...require('node:crypto'), ...fs,
    execFile: deny, spawnSync: deny, cp: deny, mkdtemp: deny,
    open: async (file, ...args) => { assert.ok(within(file, root), 'open restricted to exact temporary marketplace fixture'); return fs.open(file, ...args) },
    promisify: require('node:util').promisify, createRequire: require('node:module').createRequire,
    fileURLToPath, gunzipSync: require('node:zlib').gunzipSync,
    homedir: () => root, tmpdir: () => root, process: { env: { DSH_HOME: root }, platform: process.platform },
    Buffer, URL, AbortSignal, TextDecoder, setTimeout, clearTimeout,
    console: { warn() {}, log() {}, error() {} }, fetch: overrides.fetch || (async () => { throw new Error('TEST_NETWORK_FORBIDDEN') }) }
  if (overrides.allowCopy) sandbox.cp = async (source, dest, options) => {
    assert.ok(within(source, root) && within(dest, root), 'copy restricted to exact temporary marketplace fixture')
    return fs.cp(source, dest, options)
  }
  Object.assign(sandbox, overrides.fs || {})
  const api = await require('node:vm').runInNewContext(`(async () => { ${source}\ngetList = async () => []; checkSelfUpdate = async () => {}; loadFeedback = async () => {}; loadEnvStore = async () => {}; return { apply, appendPatchEntry, saveInstalled, installRepo, sanitizeLog, loadInstalled, seed(repo,record) { installedMap.set(repo,record) }, setBusy(value) { installRunning=value } }; })()`, sandbox, { filename })
  const routes = new Map()
  if (!overrides.noApply) api.apply({ get: () => ({ register(route) { routes.set(route.path, route.handler) } }), logger: { warn() {} } })
  const invoke = async (route, method = 'GET', body, extra = {}) => {
    const request = { method, url: `/api/marketplace/${route}`, headers: { host: '127.0.0.1:60000', 'x-dsh-marketplace': '1' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) }, ...extra }
    let status; let result
    await routes.get(`/api/marketplace/${route}`)(request, { writeHead(value) { status = value }, end(data) { result = JSON.parse(data) } })
    return { status, result }
  }
  return { api, root, routes, invoke }
}

test('marketplace all 16 registered routes reject unsupported methods without network or subprocess', async t => {
  const f = await marketplaceFixture(t)
  assert.equal(f.routes.size, 16)
  for (const route of f.routes.keys()) assert.equal((await f.invoke(route.replace('/api/marketplace/', ''), 'PATCH')).status, 405, route)
})

test('marketplace protected read/write routes reject untrusted origin and remote socket before body parsing', async t => {
  const f = await marketplaceFixture(t)
  const reads = ['backup', 'logs', 'feedback/pending', 'env-keys']
  const posts = ['self-update', 'backup/webdav', 'restore/webdav', 'feedback', 'feedback/token', 'env-edit', 'install', 'uninstall']
  for (const route of [...reads, ...posts, 'restore/diff', 'check-update']) {
    const result = await f.invoke(route, reads.includes(route) ? 'GET' : 'POST', '{bad', { headers: { host: 'evil.invalid', 'x-dsh-marketplace': '1' } })
    assert.equal(result.status, 403, route)
  }
  for (const route of posts) assert.equal((await f.invoke(route, 'POST', '{bad', { socket: { remoteAddress: '192.168.1.2' } })).status, 403, route)
})

test('marketplace backup diff and status routes remain bounded to fixture-owned state', async t => {
  const f = await marketplaceFixture(t)
  f.api.seed('fake/plugin', { repo: 'fake/plugin', type: 'plugin', name: 'fake-plugin', location: path.join(f.root, 'profiles/web/node_modules/fake-plugin'), envKeys: ['FAKE_KEY'], secret: 'fake-secret-marker' })
  const backup = await f.invoke('backup')
  assert.equal(backup.status, 200); assert.doesNotMatch(JSON.stringify(backup.result), /fake-secret-marker|node_modules/)
  const diff = await f.invoke('restore/diff', 'POST', { backup: { repos: [{ repo: 'fake/plugin' }, { repo: 'fake/other' }] } })
  assert.deepEqual(diff.result.already, ['fake/plugin']); assert.deepEqual(diff.result.missing, ['fake/other'])
  assert.equal((await f.invoke('restore/diff', 'POST', '{bad')).status, 400)
  assert.equal((await f.invoke('restore/diff', 'POST', { backup: { repos: [{}] } })).status, 400)
  for (const route of ['logs', 'feedback/pending', 'self-update', 'list', 'skills']) assert.equal((await f.invoke(route)).status, 200, route)
  for (const route of ['backup/webdav', 'restore/webdav']) assert.equal((await f.invoke(route, 'POST', { url: 'file:///fixture.json' })).status, 400)
  f.api.setBusy({ fake: true })
  assert.equal((await f.invoke('self-update', 'POST', {})).status, 409)
})

test('upstream marketplace regression patch writes genuinely serialize before reading', async t => {
  let active = 0; let maximum = 0
  const f = await marketplaceFixture(t, { noApply: true, fs: { readFile: async (...args) => {
    if (!String(args[0]).endsWith('cordis.patch.yml')) return fs.readFile(...args)
    active++; maximum = Math.max(maximum, active)
    try { return await fs.readFile(...args) } finally { active-- }
  } } })
  const outcomes = await Promise.allSettled([f.api.appendPatchEntry('fixture-a', 'fixture-a'), f.api.appendPatchEntry('fixture-b', 'fixture-b')])
  assert.equal(maximum, 1, 'at most one read-modify-write transaction may enter at a time')
  assert.ok(outcomes.every(row => row.status === 'fulfilled'))
  const text = await fs.readFile(path.join(f.root, 'profiles/web/cordis.patch.yml'), 'utf8')
  assert.match(text, /name: fixture-a/); assert.match(text, /name: fixture-b/)
})

test('upstream marketplace regression WebDAV transport errors never expose fake credentials', async t => {
  const f = await marketplaceFixture(t, { fetch: async () => { throw new Error('fake-sensitive-proxy-marker') } })
  for (const route of ['backup/webdav', 'restore/webdav']) {
    const result = await f.invoke(route, 'POST', { url: 'https://fixture.invalid/backup' })
    assert.equal(result.result.status, 'failed')
    assert.doesNotMatch(JSON.stringify(result), /fake-sensitive-proxy-marker/)
  }
})

test('marketplace env token feedback and update preflights use synthetic state only', async t => {
  const f = await marketplaceFixture(t)
  f.api.seed('fake/plugin', { type: 'plugin', envKeys: ['FAKE_KEY'] })
  assert.equal((await f.invoke('env-edit', 'POST', { repo: 'fake/plugin', values: { DSH_HOME: 'ignored' } })).status, 400)
  assert.equal((await f.invoke('env-edit', 'POST', { repo: 'fake/plugin', values: { FAKE_KEY: 'fake-marker\nINJECTED=bad' } })).status, 200)
  const dotenv = await fs.readFile(path.join(f.root, '.env'), 'utf8')
  assert.doesNotMatch(dotenv, /^INJECTED=/m)
  const keys = await f.invoke('env-keys', 'GET', undefined, { url: '/api/marketplace/env-keys?repo=fake/plugin' })
  assert.equal(keys.result.configured.FAKE_KEY, true)
  assert.doesNotMatch(JSON.stringify(keys), /fake-marker/)
  assert.equal((await f.invoke('feedback/token', 'POST', { token: 'fake-token-marker' })).result.hasToken, true)
  const token = await f.invoke('feedback/token')
  assert.equal(token.result.hasToken, true); assert.doesNotMatch(JSON.stringify(token), /fake-token-marker/)
  assert.equal((await f.invoke('feedback/token', 'POST', { token: '' })).result.hasToken, false)
  assert.equal((await f.invoke('feedback', 'POST', { repo: 'fake/missing', ok: true })).result.issueUrl, null)
  for (const route of ['check-update', 'install']) assert.equal((await f.invoke(route, 'POST', { repo: 'invalid' })).status, 400, route)
  assert.equal((await f.invoke('uninstall', 'POST', { repo: 'fake/missing' })).status, 200)
  f.api.seed('fake/cli', { type: 'cli', name: '../../../not-allowed' })
  assert.equal((await f.invoke('check-update', 'POST', { repo: 'fake/cli' })).status, 400)
})

test('upstream marketplace regression clearing env credentials also clears bootstrap dotenv value', async t => {
  const f = await marketplaceFixture(t)
  f.api.seed('fake/plugin', { type: 'plugin', envKeys: ['FAKE_KEY'] })
  assert.equal((await f.invoke('env-edit', 'POST', { repo: 'fake/plugin', values: { FAKE_KEY: 'fake-delete-marker' } })).status, 200)
  assert.equal((await f.invoke('env-edit', 'POST', { repo: 'fake/plugin', values: { FAKE_KEY: '' } })).status, 200)
  assert.doesNotMatch(await fs.readFile(path.join(f.root, '.env'), 'utf8'), /fake-delete-marker/)
})

test('marketplace fixture skill install list backup and uninstall never execute third-party code', async t => {
  const f = await marketplaceFixture(t, { allowCopy: true })
  const cache = path.join(f.root, 'marketplace/cache/fake__fixture-skill')
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(path.join(cache, 'SKILL.md'), '---\nname: fixture-skill\ndescription: Synthetic fixture\n---\nFixture only.\n')
  const installed = await f.invoke('install', 'POST', { repo: 'fake/fixture-skill' })
  assert.equal(installed.result.status, 'done', JSON.stringify(installed))
  assert.match(await fs.readFile(path.join(f.root, 'skills/fixture-skill/SKILL.md'), 'utf8'), /Fixture only/)
  assert.equal((await f.invoke('backup')).result.backup.repos.length, 1)
  assert.equal((await f.invoke('uninstall', 'POST', { repo: 'fake/fixture-skill' })).result.status, 'done')
  await assert.rejects(fs.stat(path.join(f.root, 'skills/fixture-skill')), { code: 'ENOENT' })
  assert.equal((await f.invoke('backup')).result.backup.repos.length, 0)
})

test('upstream marketplace regression failed skill replacement preserves previously installed files', async t => {
  const f = await marketplaceFixture(t, { noApply: true, fs: { cp: async () => { throw new Error('fixture-copy-failure') } } })
  const cache = path.join(f.root, 'cache'); const installed = path.join(f.root, 'skills/fixture-skill')
  await fs.mkdir(cache, { recursive: true }); await fs.mkdir(installed, { recursive: true })
  await fs.writeFile(path.join(cache, 'SKILL.md'), '---\nname: fixture-skill\ndescription: Fixture\n---\nnew')
  await fs.writeFile(path.join(installed, 'SKILL.md'), 'old-good-fixture')
  await assert.rejects(f.api.installRepo({ type: 'skill', cacheDir: cache, repo: 'fake/fixture-skill', log: [], answers: {}, logLine() {}, lang: 'en' }), /fixture-copy-failure/)
  assert.equal(await fs.readFile(path.join(installed, 'SKILL.md'), 'utf8'), 'old-good-fixture')
})

test('public fetch delegation normal results pass through but errors never expose raw causes', async () => {
  const { DesktopPublicFetchProvider } = await import('../plugins/dsh-desktop-web-search/lib/index.js')
  const provider = { available: () => true, fetch: async () => ({ body: { kind: 'text', content: 'fixture page' } }) }
  const wrapper = new DesktopPublicFetchProvider({ fetchProviders: new Map([['http', provider]]) })
  assert.equal((await wrapper.fetch({ url: 'https://fixture.invalid/page' })).body.content, 'fixture page')
  for (const code of ['WEB_PROVIDER_ERROR', 'WEB_BLOCKED_URL', 'WEB_ABORTED']) {
    provider.fetch = async () => { throw Object.assign(new Error('fake-private-transport-marker'), { code, cause: new Error('fake-private-cause') }) }
    await assert.rejects(wrapper.fetch({ url: 'https://fixture.invalid/page' }), error => { assert.equal(error.code, code); assert.doesNotMatch(error.message, /fake-private/); assert.equal(error.cause, undefined); return true })
  }
})

async function publicHttpFixture({ lookup, request }) {
  const filename = path.join(repository, 'node_modules/@deepseek-ai/dsh-web-fetch-http/lib/index.js')
  let source = await fs.readFile(filename, 'utf8')
  source = source.replace(/^import .*;\r?\n/gm, '').replace(/^export \{[^\n]+\};?$/m, '')
  const sandbox = { z: (await import('@deepseek-ai/schemastery')).default,
    WebError: (await import('@deepseek-ai/dsh-web')).WebError, ...(await import('@deepseek-ai/dsh-timeout')),
    lookup, isIP: require('node:net').isIP, ipaddr: require('node:module').createRequire(filename)('ipaddr.js'),
    fakeRequest: request, URL, Symbol, TextDecoder, Buffer, AbortController, AbortSignal, setTimeout, clearTimeout }
  return require('node:vm').runInNewContext(`(() => { ${source}\npublicHttpNetwork.request = fakeRequest; return { HttpFetchProvider, resolvePublicAddresses }; })()`, sandbox, { filename })
}

test('official public HTTP fetch rejects private and mixed DNS answers before fake transport', async () => {
  let transports = 0
  const { HttpFetchProvider } = await publicHttpFixture({ lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }], request: async () => { transports++; throw new Error('unreachable') } })
  const p = new HttpFetchProvider({ timeoutMs: 1000, maxRedirects: 5, maxResponseBytes: 4096, maxBodyChars: 1024, userAgent: 'fixture' })
  for (const url of ['http://127.0.0.1/', 'http://10.0.0.1/', 'http://169.254.169.254/', 'https://fixture.invalid/']) await assert.rejects(p.fetch({ url }), error => error.code === 'WEB_BLOCKED_URL')
  assert.equal(transports, 0)
})

test('official public HTTP fetch follows only same-origin redirects and rechecks DNS', async () => {
  let lookups = 0; let transports = 0; let closed = 0
  const { HttpFetchProvider } = await publicHttpFixture({ lookup: async () => [{ address: ++lookups === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }], request: async () => { transports++; return { response: new Response('', { status: 302, headers: { location: '/next' } }), close: async () => { closed++ } } } })
  const limits = { timeoutMs: 1000, maxRedirects: 5, maxResponseBytes: 4096, maxBodyChars: 1024, userAgent: 'fixture' }
  await assert.rejects(new HttpFetchProvider(limits).fetch({ url: 'https://fixture.invalid/start' }), error => error.code === 'WEB_BLOCKED_URL')
  assert.equal(transports, 1); assert.equal(closed, 1)
  const cross = await publicHttpFixture({ lookup: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => ({ response: new Response('', { status: 302, headers: { location: 'https://other.invalid/' } }), close: async () => {} }) })
  await assert.rejects(new cross.HttpFetchProvider(limits).fetch({ url: 'https://fixture.invalid/' }), error => error.code === 'WEB_REDIRECT_BLOCKED')
})

// These extra transaction checks are explicitly candidate-only, in addition to
// running every unchanged original regression against the same pinned output.
if (process.env.DEEP_AUDIT_MARKETPLACE_CANDIDATE === 'pinned-maintenance') {
  test('marketplace candidate env second-file activation failure rolls back bytes and allows retry', async t => {
    let fail = false
    const f = await marketplaceFixture(t, { fs: { rename: async (from, to) => {
      if (fail && path.basename(to) === '.env' && from.includes('.stage-')) throw new Error('fixture-env-activation')
      return fs.rename(from, to)
    } } })
    f.api.seed('fake/plugin', { type: 'plugin', envKeys: ['FAKE_KEY'] })
    const put = value => f.invoke('env-edit', 'POST', { repo: 'fake/plugin', values: { FAKE_KEY: value } })
    assert.equal((await put('old-fixture')).status, 200)
    const files = [path.join(f.root, 'marketplace/envs.json'), path.join(f.root, '.env')]
    const before = await Promise.all(files.map(file => fs.readFile(file, 'utf8')))
    fail = true
    assert.equal((await put('new-fixture')).status, 500)
    assert.deepEqual(await Promise.all(files.map(file => fs.readFile(file, 'utf8'))), before)
    fail = false
    assert.equal((await put('retry-fixture')).status, 200)
    for (const file of files) assert.match(await fs.readFile(file, 'utf8'), /retry-fixture/)
  })

  test('marketplace candidate incomplete env rollback retains recovery marker and blocks further writes', async t => {
    let fail = false
    const f = await marketplaceFixture(t, { fs: { rename: async (from, to) => {
      if (fail && ((path.basename(to) === '.env' && from.includes('.stage-')) || (path.basename(to) === 'envs.json' && from.includes('.backup-')))) throw new Error('fixture-env-recovery')
      return fs.rename(from, to)
    } } })
    f.api.seed('fake/plugin', { type: 'plugin', envKeys: ['FAKE_KEY'] })
    const put = value => f.invoke('env-edit', 'POST', { repo: 'fake/plugin', values: { FAKE_KEY: value } })
    assert.equal((await put('old-fixture')).status, 200)
    fail = true
    assert.match((await put('partial-fixture')).result.error, /RECOVERY_REQUIRED/)
    const marker = path.join(f.root, 'marketplace/envs.json.transaction')
    await fs.stat(marker)
    fail = false
    assert.match((await put('must-not-commit')).result.error, /RECOVERY_REQUIRED/)
    assert.doesNotMatch(await fs.readFile(path.join(f.root, 'marketplace/envs.json'), 'utf8'), /must-not-commit/)
    await fs.stat(marker)
  })

  test('marketplace candidate skill activation failure restores old tree and retry succeeds', async t => {
    let fail = true
    const f = await marketplaceFixture(t, { noApply: true, allowCopy: true, fs: { rename: async (from, to) => {
      if (fail && from.includes('.stage-') && path.basename(to) === 'fixture-skill') throw new Error('fixture-tree-activation')
      return fs.rename(from, to)
    } } })
    const cache = path.join(f.root, 'cache'); const installed = path.join(f.root, 'skills/fixture-skill')
    await fs.mkdir(cache, { recursive: true }); await fs.mkdir(installed, { recursive: true })
    await fs.writeFile(path.join(cache, 'SKILL.md'), '---\nname: fixture-skill\ndescription: Fixture\n---\nnew-fixture')
    await fs.writeFile(path.join(installed, 'SKILL.md'), 'old-fixture')
    const install = () => f.api.installRepo({ type: 'skill', cacheDir: cache, repo: 'fake/fixture-skill', log: [], answers: {}, logLine() {}, lang: 'en' })
    await assert.rejects(install(), /fixture-tree-activation/)
    assert.equal(await fs.readFile(path.join(installed, 'SKILL.md'), 'utf8'), 'old-fixture')
    fail = false
    await install()
    assert.match(await fs.readFile(path.join(installed, 'SKILL.md'), 'utf8'), /new-fixture/)
  })

  test('marketplace candidate dotenv round-trips actual Node parser or rejects without changing either file', async t => {
    const f = await marketplaceFixture(t)
    f.api.seed('fake/plugin', { type: 'plugin', envKeys: ['FAKE_KEY'] })
    const put = value => f.invoke('env-edit', 'POST', { repo: 'fake/plugin', values: { FAKE_KEY: value } })
    const files = [path.join(f.root, 'marketplace/envs.json'), path.join(f.root, '.env')]
    assert.equal((await put('initial-fixture')).status, 200)
    const values = ['C:\\Program Files\\Fixture\\bin', 'C:\\fixture\\', 'literal\\n', 'double"quote', "single'quote", 'back`tick', 'hash#value', 'line\nbreak', '"mixed\'`#', 'final-fixture']
    let accepted = 0
    for (const value of values) {
      const before = await Promise.all(files.map(file => fs.readFile(file, 'utf8')))
      const result = await put(value)
      if (value === 'final-fixture') assert.equal(result.status, 200, JSON.stringify({ result, syntheticDotEnv: before[1] }))
      if (result.status === 200) {
        accepted++
        const dotenv = await fs.readFile(files[1], 'utf8')
        assert.equal(require('node:util').parseEnv(dotenv).FAKE_KEY, value.trim().replace(/[\r\n]+/g, ' '))
      } else {
        assert.equal(result.status, 500)
        assert.deepEqual(await Promise.all(files.map(file => fs.readFile(file, 'utf8'))), before)
      }
    }
    assert.ok(accepted >= 8)
    assert.equal((await put('')).status, 200)
    assert.equal(require('node:util').parseEnv(await fs.readFile(files[1], 'utf8')).FAKE_KEY, undefined)
  })
}
