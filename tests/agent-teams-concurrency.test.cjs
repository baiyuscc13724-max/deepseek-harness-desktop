const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')

function request(url) {
  const req = new EventEmitter()
  req.method = 'GET'
  req.url = url
  req.headers = { host: '127.0.0.1:9945', origin: 'http://127.0.0.1:9945' }
  return req
}

function response() {
  return {
    status: 0,
    headers: {},
    headersSent: false,
    chunks: [],
    writeHead(status, headers) { this.status = status; this.headers = headers || {}; this.headersSent = true },
    write(chunk) { this.chunks.push(String(chunk)); return true },
    end(chunk = '') { if (chunk) this.chunks.push(String(chunk)) }
  }
}

function context(routes, cleanups) {
  return {
    logger: { info() {}, warn() {}, error() {} },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
    effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    on() { return () => {} }
  }
}

test('six independent team sessions receive only relevant SSE mutations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-concurrency-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const requests = []
  const cleanups = []
  let store
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?concurrency=${Date.now()}`)
    store = new mod.AgentTeamsStore(path.join(root, 'storages', 'agent_teams.json'), { enabled: true, maxMembers: 8, maxActiveTurns: 8 })
    await store.init()
    const leads = Array.from({ length: 6 }, (_, index) => ({
      id: `lead-${index}`,
      options: { provider: 'test-provider', model: 'test-model' }
    }))
    const teams = []
    for (const [index, lead] of leads.entries()) {
      teams.push(await mod.createTeam(store, lead, { objective: `team ${index}`, leadName: `Lead ${index}` }))
    }

    const routes = new Map()
    mod.apply(context(routes, cleanups), { enabled: true, maxMembers: 8, maxActiveTurns: 8 })
    const eventRoute = routes.get('/api/agent-teams/events')
    assert.ok(eventRoute)

    const responses = []
    for (const lead of leads) {
      const req = request(`/api/agent-teams/events?sessionId=${lead.id}`)
      const res = response()
      requests.push(req)
      responses.push(res)
      await eventRoute.handler(req, res)
      assert.equal(res.status, 200)
      assert.equal(res.chunks.length, 1, 'each connection receives one initial snapshot')
    }

    await mod.createTask(store, leads[0], { teamId: teams[0].id, title: 'targeted mutation' })
    await new Promise(resolve => setTimeout(resolve, 80))

    assert.equal(responses[0].chunks.length, 2, 'the affected root receives the coalesced update')
    for (const res of responses.slice(1)) {
      assert.equal(res.chunks.length, 1, 'unrelated roots are not broadcast an identical snapshot')
    }
  } finally {
    const cleanupErrors = []
    for (const req of requests) req.emit('close')
    await new Promise(resolve => setImmediate(resolve))
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup() } catch (error) { cleanupErrors.push(error) }
    }
    try { await store?.close() } catch (error) { cleanupErrors.push(error) }
    process.env.DSH_HOME = previousHome
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (cleanupErrors.length === 1) throw cleanupErrors[0]
    if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'Agent Teams concurrency cleanup failed')
  }
})
