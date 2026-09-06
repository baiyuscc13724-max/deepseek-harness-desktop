const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../plugins/dsh-agent-teams/lib')

test('UI-only scope never changes the persisted team ledger schema', async () => {
  const source = await fs.readFile(path.join(root, 'index.js'), 'utf8')
  const start = source.indexOf('function buildTeamLedgerEntry(')
  const end = source.indexOf('function validateTeamLedgerEntry(', start)
  assert.ok(start >= 0 && end > start)
  const artifact = value => {
    const bytes = Buffer.from(JSON.stringify(value) + '\n')
    return { hash: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  }
  const build = Function('jsonArtifact', 'clone', 'teamLedgerIndex', 'projectTeamScope', source.slice(start, end) + ';return buildTeamLedgerEntry')(
    artifact, structuredClone, () => ({ members: [], tasks: [] }), () => ({ mode: 'project' })
  )
  const team = { id: 'team', rootLeadSessionId: 'root', name: 'Example', objective: 'Test', revision: 1, state: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
  const entry = build(team, 0, 'hot')
  assert.equal(Object.hasOwn(entry, 'scope'), false)
  assert.deepEqual(Object.keys(entry), ['ordinal', 'id', 'storage', 'hash', 'bytes', 'keys', 'rootLeadSessionId', 'name', 'objective', 'revision', 'state', 'createdAt', 'updatedAt', 'pauseEpoch', 'index'])
  assert.equal(entry.hash, artifact(team).hash)
})

test('failed initial SSE with a rejected REST fallback exposes an error, not infinite loading', async () => {
  const source = await fs.readFile(path.join(root, 'client.js'), 'utf8')
  let hook, effect, stream, stateIndex = 0
  const states = [], timers = new Map()
  let timerId = 0
  const React = {
    createElement() {}, startTransition: work => work(),
    useState(value) { const index = stateIndex++; states[index] = value; return [value, next => { states[index] = next }] },
    useRef: current => ({ current }), useEffect: work => { effect = work }
  }
  class EventSource {
    constructor() { stream = this }
    addEventListener() {} removeEventListener() {} close() {}
  }
  const window = { __ModuleLoader__: { load(definition) { hook = definition.factory(() => React).__testHook } } }
  vm.runInNewContext(source.replace('    exports.apply = apply;', '    exports.__testHook = useTeamState;\n    exports.apply = apply;'), {
    window, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }, EventSource,
    setTimeout: work => { timers.set(++timerId, work); return timerId }, clearTimeout: id => timers.delete(id),
    fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: 'manifest index disagrees', code: 'AGENT_TEAMS_INVALID_REQUEST' }) })
  })
  hook('root', '')
  const cleanup = effect()
  try {
    stream.onerror()
    assert.equal(timers.size, 1)
    const [id, work] = timers.entries().next().value
    timers.delete(id); work()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(states[0], null)
    assert.equal(states[1], 'manifest index disagrees')
  } finally { cleanup() }
  assert.equal(timers.size, 0)
})

for (const mode of ['headers', 'body', 'cancel', 'success', 'malformed']) {
  test(`state request cleans up its deadline on ${mode}`, async () => {
    const source = await fs.readFile(path.join(root, 'client.js'), 'utf8')
    const start = source.indexOf('    function fetchState(')
    const end = source.indexOf('    function fetchTaskDetail(', start)
    let timeout, cleared = false
    const fetch = async () => mode === 'headers' || mode === 'cancel' ? new Promise(() => {}) : ({
      ok: true,
      json: () => mode === 'body' ? new Promise(() => {}) : mode === 'malformed' ? Promise.reject(new SyntaxError('bad JSON')) : Promise.resolve({ enabled: true, team: null })
    })
    // Deliberately omit AbortController: the bounded promise must still settle.
    const fetchState = Function('fetch', 'setTimeout', 'clearTimeout', 'AbortController', 'stateUrl', source.slice(start, end) + ';return fetchState')(
      fetch, (work, delay) => { assert.equal(delay, 10000); timeout = work; return 1 }, () => { cleared = true }, undefined, () => '/state'
    )
    const request = fetchState('root', '')
    request.catch(() => {})
    await new Promise(resolve => setImmediate(resolve))
    if (mode === 'success') assert.equal((await request).enabled, true)
    else if (mode === 'malformed') await assert.rejects(request, /bad JSON/)
    else {
      const rejected = assert.rejects(request, mode === 'cancel' ? /cancelled/ : /timed out/)
      if (mode === 'cancel') request.cancel(); else timeout()
      await rejected
    }
    assert.equal(cleared, true)
  })
}
