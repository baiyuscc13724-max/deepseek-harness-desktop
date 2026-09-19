const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const definition = (enabled = false) => ({ id: 'fixture', serverName: 'fixture', label: 'Fixture only', enabled, transport: { kind: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: {} } })
async function managerFixture(t) {
  const { McpManager } = await import('../plugins/dsh-desktop-mcp-manager/lib/index.js')
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-audit-settings-'))
  const file = path.join(directory, 'servers.json')
  let mounts = 0; let disposals = 0
  const manager = new McpManager({ file, credentials: { resolve: async () => undefined }, mount: async () => { mounts++; return { dispose: async () => { disposals++ } } } })
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }) })
  async function breakPersistence() { await rm(file, { force: true }); await mkdir(file) }
  async function restorePersistence() { await rm(file, { recursive: true, force: true }) }
  return { manager, file, breakPersistence, restorePersistence, mounts: () => mounts, disposals: () => disposals }
}

test('MCP failed create has no phantom row and the same ID can be retried', async t => {
  const f = await managerFixture(t)
  await f.breakPersistence()
  await assert.rejects(f.manager.create(definition(true)))
  assert.deepEqual(f.manager.list(), [])
  assert.equal(f.mounts(), 0)
  await f.restorePersistence()
  const created = await f.manager.create(definition(true))
  assert.equal(created.revision, 1)
  assert.equal(f.mounts(), 1)
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).servers.length, 1)
})

test('MCP failed update preserves committed revision and running instance for retry', async t => {
  const f = await managerFixture(t)
  await f.manager.create(definition(true))
  await f.breakPersistence()
  await assert.rejects(f.manager.setEnabled('fixture', 1, false))
  assert.equal(f.manager.list()[0].revision, 1)
  assert.equal(f.manager.list()[0].enabled, true)
  assert.equal(f.manager.list()[0].status.phase, 'ready')
  assert.equal(f.disposals(), 0)
  await f.restorePersistence()
  const saved = await f.manager.setEnabled('fixture', 1, false)
  assert.equal(saved.revision, 2)
  assert.equal(f.disposals(), 1)
})

test('MCP failed delete retains row and running instance and permits same-revision retry', async t => {
  const f = await managerFixture(t)
  await f.manager.create(definition(true))
  await f.breakPersistence()
  await assert.rejects(f.manager.delete('fixture', 1))
  assert.equal(f.manager.list().length, 1)
  assert.equal(f.manager.list()[0].status.phase, 'ready')
  assert.equal(f.disposals(), 0)
  await f.restorePersistence()
  await f.manager.delete('fixture', 1)
  assert.deepEqual(f.manager.list(), [])
  assert.equal(f.disposals(), 1)
})

function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))
const response = value => ({ ok: true, json: async () => value })

// Execute the actual settings component and handlers, with an in-memory hook
// scheduler and fake fetch only. No runtime, browser, credentials or network.
async function mcpClientFixture(fetcher) {
  const source = await readFile(path.join(root, 'plugins/dsh-desktop-mcp-manager/lib/client.js'), 'utf8')
  const hooks = []; const effects = []; let cursor = 0; let component; let registration
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity).filter(value => value != null) } },
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }] },
    useRef(initial) { const index = cursor++; return hooks[index] || (hooks[index] = { current: initial }) },
    useCallback(fn, deps) { const index = cursor++; const previous = hooks[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) hooks[index] = { fn, deps }; return hooks[index].fn },
    useEffect(fn, deps) { const index = cursor++; const previous = hooks[index]; if (!previous || deps.some((value, i) => value !== previous[i])) { hooks[index] = deps; effects.push(fn) } }
  }
  let confirmations = 0
  const window = { __ModuleLoader__: { load(value) { registration = value } }, confirm() { confirmations++; return true } }
  const document = { querySelector() { return null }, createElement() { return { dataset: {} } }, head: { appendChild() {} } }
  new Function('window', 'navigator', 'fetch', 'document', source)(window, { language: 'en' }, fetcher, document)
  registration.factory(() => React).apply({ slots: { inject(_name, callback) { callback() }, register(_metadata, value) { component = value } } })
  function render() { cursor = 0; const tree = component(); for (const effect of effects.splice(0)) effect(); return tree }
  function all(tree, predicate) { const result = []; function visit(node) { if (!node || typeof node !== 'object') return; if (predicate(node)) result.push(node); node.children.forEach(visit) } visit(tree); return result }
  function one(tree, predicate) { const nodes = all(tree, predicate); assert.equal(nodes.length, 1); return nodes[0] }
  function draft(values) { for (const [placeholder, value] of Object.entries(values)) one(render(), node => node.props.placeholder === placeholder).props.onChange({ target: { value } }) }
  function text(tree) { return typeof tree === 'string' ? tree : tree?.children?.map(text).join(' ') || '' }
  return { render, all, one, draft, text, confirmations: () => confirmations }
}

async function readyClient(fetcher) {
  const f = await mcpClientFixture(fetcher); f.render(); await tick()
  f.draft({ 'docs-server': 'fixture', docs_tools: 'fixture', 'Documentation tools': 'Fixture', 'https://example.com/mcp': 'https://example.invalid/mcp' })
  return f
}

test('MCP save locks every draft field and ignores duplicate same-turn submit', async () => {
  const gate = deferred(); let writes = 0
  const f = await readyClient(async (_url, options) => { if (options.method === 'POST') { writes++; await gate.promise } return response({ servers: [] }) })
  const submit = f.one(f.render(), node => node.type === 'form').props.onSubmit
  const first = submit({ preventDefault() {} })
  const second = submit({ preventDefault() {} })
  const controls = f.all(f.render(), node => ['input', 'select', 'textarea'].includes(node.type))
  const locked = controls.every(node => node.props.disabled)
  gate.resolve(); await Promise.all([first, second])
  assert.equal(writes, 1, 'an already-dispatched save cannot dispatch twice before React rerenders')
  assert.equal(f.confirmations(), 1)
  assert.equal(locked, true, 'new edits cannot be erased by the pending save acknowledgement')
  assert.ok(f.all(f.render(), node => node.type === 'input').some(node => !node.props.disabled))
})

test('MCP committed save with failed reload reports refresh recovery, not a failed write', async () => {
  let reads = 0; let writes = 0
  const f = await readyClient(async (_url, options) => {
    if (options.method === 'POST') { writes++; return response({ result: { id: 'fixture' } }) }
    if (++reads === 2) throw new Error('Fixture read unavailable')
    return response({ servers: [] })
  })
  await f.one(f.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  const tree = f.render(); const message = f.text(tree)
  assert.match(message, /configuration updated/i)
  assert.match(message, /refresh.*retry|retry.*refresh/i)
  assert.doesNotMatch(message, /Action failed:/)
  assert.equal(f.one(tree, node => node.props.placeholder === 'docs-server').props.value, '')
  assert.equal(f.one(tree, node => node.type === 'button' && node.props.type === 'submit').props.disabled, true)
  await f.one(tree, node => node.props.className === 'dmm-button dmm-refresh').props.onClick()
  assert.equal(f.one(f.render(), node => node.type === 'button' && node.props.type === 'submit').props.disabled, false)
  assert.equal(writes, 1, 'refresh recovery never repeats a mutation')
})

test('MCP rejected save retains the draft and retry succeeds once', async () => {
  let writes = 0
  const f = await readyClient(async (_url, options) => {
    if (options.method === 'POST' && ++writes === 1) throw new Error('Fixture save failed')
    return response({ servers: [] })
  })
  await f.one(f.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(f.one(f.render(), node => node.props.placeholder === 'docs-server').props.value, 'fixture')
  assert.match(f.text(f.render()), /Action failed: Fixture save failed/)
  await f.one(f.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(f.one(f.render(), node => node.props.placeholder === 'docs-server').props.value, '')
  assert.equal(writes, 2)
})

test('MCP concurrent create/update/delete commit in order without exposing staged rows', async t => {
  const f = await managerFixture(t)
  const entered = deferred(); const release = deferred(); const commits = []
  const commit = f.manager.commit.bind(f.manager)
  f.manager.commit = async rows => {
    commits.push([...rows.values()].map(row => row.revision))
    if (commits.length === 1) { entered.resolve(); await release.promise }
    await commit(rows)
  }
  const operations = [f.manager.create(definition(true)), f.manager.create(definition(false)), f.manager.update('fixture', 1, definition(false)), f.manager.delete('fixture', 2)]
  const results = Promise.allSettled(operations)
  await entered.promise
  assert.deepEqual(f.manager.list(), [], 'pending durable commit must not be visible to a GET')
  assert.deepEqual(commits, [[1]], 'later writes remain queued')
  assert.equal(f.mounts(), 0)
  release.resolve()
  const settled = await results
  assert.deepEqual(settled.map(item => item.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled'])
  assert.equal(settled[1].reason.code, 'MCP_ID_CONFLICT')
  assert.deepEqual(commits, [[1], [2], []])
  assert.deepEqual(f.manager.list(), [])
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')).servers, [])
  assert.equal(f.mounts(), 1)
  assert.equal(f.disposals(), 1)
})

test('MCP concurrent conflicting updates reject the stale revision without a second stop', async t => {
  const f = await managerFixture(t)
  await f.manager.create(definition(true))
  const results = await Promise.allSettled([f.manager.setEnabled('fixture', 1, false), f.manager.update('fixture', 1, { ...definition(true), label: 'Stale update' })])
  assert.deepEqual(results.map(item => item.status), ['fulfilled', 'rejected'])
  assert.equal(results[1].reason.code, 'MCP_REVISION_CONFLICT')
  assert.equal(f.manager.list()[0].label, 'Fixture only')
  assert.equal(f.manager.list()[0].revision, 2)
  assert.equal(f.disposals(), 1)
})

test('MCP list read fences a same-turn mutation and duplicate refresh until settled', async () => {
  const gate = deferred(); let reads = 0; let writes = 0
  const f = await readyClient(async (_url, options) => {
    if (options.method === 'POST') { writes++; return response({ result: {} }) }
    if (++reads === 2) await gate.promise
    return response({ servers: [] })
  })
  const tree = f.render()
  const refresh = f.one(tree, node => node.props.className === 'dmm-button dmm-refresh').props.onClick
  const pending = refresh()
  await refresh()
  await f.one(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(writes, 0)
  assert.equal(reads, 2)
  assert.equal(f.confirmations(), 0)
  assert.equal(f.one(f.render(), node => node.type === 'button' && node.props.type === 'submit').props.disabled, true)
  gate.resolve(); await pending
  assert.equal(f.one(f.render(), node => node.props.placeholder === 'docs-server').props.value, 'fixture')
})

test('MCP initial read failure is not misrepresented as an empty configured list', async () => {
  let reads = 0
  const f = await mcpClientFixture(async () => { if (++reads === 1) throw new Error('Fixture offline'); return response({ servers: [] }) })
  f.render(); await tick()
  assert.match(f.text(f.render()), /Refresh to retry/)
  assert.doesNotMatch(f.text(f.render()), /No MCP servers configured/)
  assert.equal(f.one(f.render(), node => node.type === 'button' && node.props.type === 'submit').props.disabled, true)
  await f.one(f.render(), node => node.props.className === 'dmm-button dmm-refresh').props.onClick()
  assert.match(f.text(f.render()), /No MCP servers configured/)
  assert.equal(f.one(f.render(), node => node.type === 'button' && node.props.type === 'submit').props.disabled, false)
})

for (const action of ['update', 'delete']) test(`MCP ${action} distinguishes committed config from unconfirmed disposal`, async t => {
  const f = await managerFixture(t)
  let stops = 0
  f.manager.mount = async () => ({ dispose: async () => { stops++; throw new Error('private disposal detail') } })
  await f.manager.create(definition(true))
  const result = action === 'update' ? await f.manager.setEnabled('fixture', 1, false) : await f.manager.delete('fixture', 1)
  assert.equal(result.cleanup.phase, 'stop-failed')
  assert.equal(result.cleanup.outcome, 'unknown')
  assert.doesNotMatch(JSON.stringify(result), /private disposal detail/)
  assert.equal(stops, 1, 'unknown cleanup is not automatically retried')
  assert.equal(f.manager.runtimes.has('fixture'), true, 'failed disposal retains its handle')
  const persisted = JSON.parse(await readFile(f.file, 'utf8')).servers
  assert.equal(persisted.length, action === 'update' ? 1 : 0)
  if (action === 'update') {
    assert.equal(result.revision, 2)
    assert.equal(result.enabled, false)
  } else {
    assert.equal(result.deleted, true)
    await assert.rejects(f.manager.create(definition(true)), error => error.code === 'MCP_CLEANUP_REQUIRED')
    assert.equal(stops, 1)
  }
})

test('MCP reconnect is serialized with delete so a late mount cannot resurrect a removed server', async t => {
  const f = await managerFixture(t)
  await f.manager.create(definition(true))
  const entered = deferred(); const release = deferred(); let reconnectedDisposals = 0
  f.manager.mount = async () => { entered.resolve(); await release.promise; return { dispose: async () => { reconnectedDisposals++ } } }
  const reconnecting = f.manager.reconnect('fixture', 1)
  await entered.promise
  let deleteEnteredCommit = false
  const commit = f.manager.commit.bind(f.manager)
  f.manager.commit = async rows => { deleteEnteredCommit = true; await commit(rows) }
  const deleting = f.manager.delete('fixture', 1)
  await tick()
  const overlapped = deleteEnteredCommit
  release.resolve()
  await Promise.all([reconnecting, deleting])
  assert.equal(overlapped, false, 'delete cannot enter persistence while reconnect still owns the lifecycle queue')
  assert.equal(reconnectedDisposals, 1)
  assert.equal(f.manager.runtimes.has('fixture'), false)
  assert.deepEqual(f.manager.list(), [])
})

test('MCP client explicitly warns that committed changes have unconfirmed connection cleanup', async () => {
  const f = await readyClient(async (_url, options) => response(options.method === 'POST'
    ? { result: { cleanup: { phase: 'stop-failed', outcome: 'unknown' } } }
    : { servers: [] }))
  await f.one(f.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.match(f.text(f.render()), /configuration updated/i)
  assert.match(f.text(f.render()), /could not confirm.*stopped/i)
  assert.doesNotMatch(f.text(f.render()), /Action failed:/)
  assert.ok(f.all(f.render(), node => node.props.role === 'alert').length > 0)
})
