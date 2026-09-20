'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, rm } = require('node:fs/promises')
const { Readable } = require('node:stream')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')

function request(method, url, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(payload)
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:9945', origin: 'http://127.0.0.1:9945', ...(method === 'POST' ? { 'x-harness-agent-teams': '1' } : {}) }
  return req
}

function response() {
  let resolve
  const done = new Promise(value => { resolve = value })
  return {
    status: 0, headers: {}, headersSent: false, chunks: [],
    writeHead(status, headers) { this.status = status; this.headers = headers || {}; this.headersSent = true },
    write(chunk) { this.chunks.push(String(chunk)); return true },
    end(chunk = '') { if (chunk) this.chunks.push(String(chunk)); resolve({ status: this.status, body: this.chunks.join(''), headers: this.headers }) },
    done
  }
}

async function invoke(route, req) {
  const res = response()
  await route.handler(req, res)
  return res.done
}

function openDirectHumanTurn(agent) {
  agent.session.events.push(
    { type: 'turn/end', data: {} },
    { type: 'turn/start', data: {} },
    { type: 'user/message', data: { source: { kind: 'user' } } }
  )
}

const LEVEL3 = { level: 'level3', reason_category: 'independent_sustained_workstreams', candidate_workstreams: 2, creation_path: 'team_start' }

test('a same-turn creation failure keeps the immutable Level 3 decision retryable without weakening it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-routing-retry-'))
  const cleanups = []
  const previousHome = process.env.DSH_HOME
  let authorityStore
  // The plugin resolves its durable store from DSH_HOME, so the fixture must own it.
  process.env.DSH_HOME = root
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?routing-retry=${Date.now()}-${Math.random()}`)
    const tools = new Map(), routes = new Map()
    const lead = {
      id: 'routing-retry-lead', status: 'running', options: { provider: 'main-provider', model: 'main-model' },
      session: { header: { cwd: root }, events: [{ type: 'turn/start', data: {} }, { type: 'user/message', data: { source: { kind: 'user' } } }], snapshotEvents() { return this.events.slice() } },
      inbox: { nextTurn: [], nextStep: [], remove() { return false } }, followup() {}, steer() {}
    }
    const ctx = {
      logger: { info() {}, warn() {}, error() {} },
      get: () => undefined,
      tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, guard() { return () => {} } },
      systemPrompt: { section() { return () => {} } },
      webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
      effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
      on() { return () => {} },
      agents: { get(id) { return id === lead.id ? lead : undefined }, roots() { return [lead] }, currentInitiator() { return lead } },
      subagents: {}
    }
    mod.apply(ctx)
    const enabled = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: false, autopilotMaxAdditionalRounds: 200
    }))
    assert.equal(enabled.status, 200, enabled.body)
    const stateFile = path.join(root, 'storages', 'agent_teams.json')
    authorityStore = new mod.AgentTeamsStore(stateFile)
    await authorityStore.init()
    const persisted = () => authorityStore.snapshot()
    const execution = { agent: lead, signal: new AbortController().signal }

    openDirectHumanTurn(lead)
    await tools.get('team_route_goal').execute(LEVEL3, execution)
    const first = await tools.get('team_start').execute({ request_id: 'shared-request', objective: 'First binding', candidate_workstreams: 2 }, execution)
    assert.equal(first.routing.receipt.outcome, 'created')
    assert.equal(persisted().teams.length, 1)

    // Second turn: the same request_id with different input fails before any team is created.
    openDirectHumanTurn(lead)
    await tools.get('team_route_goal').execute(LEVEL3, execution)
    await assert.rejects(
      tools.get('team_start').execute({ request_id: 'shared-request', objective: 'Conflicting input', candidate_workstreams: 2 }, execution),
      error => error?.code === 'AGENT_TEAMS_IDEMPOTENCY_CONFLICT'
    )
    const failed = persisted()
    assert.equal(failed.teams.length, 1, 'a failed start must not persist a partial team')
    const failedReceipt = failed.routingReceipts.at(-1)
    assert.equal(failedReceipt.outcome, 'failed', 'the failure stays recorded for audit')
    assert.equal(failedReceipt.teamId, undefined, 'a failed finalization can never bind a team')

    // The turn's decision remains immutable: a different decision still conflicts.
    await assert.rejects(
      tools.get('team_start').execute({ request_id: 'different-decision', objective: 'Different decision', candidate_workstreams: 3 }, execution),
      error => error?.code === 'AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT' && /different routing decision/u.test(error.message)
    )

    // The exact same decision may still be retried inside this turn.
    const retry = await tools.get('team_start').execute({ request_id: 'retry-request', objective: 'Corrected input', candidate_workstreams: 2 }, execution)
    assert.equal(retry.routing.receipt.teamId, retry.team.id, 'a successful retry binds the first team to this turn')
    const settled = persisted()
    assert.equal(settled.teams.length, 2)
    const settledReceipt = settled.routingReceipts.find(receipt => receipt.id === retry.routing.receipt.id)
    assert.equal(settledReceipt.outcome, 'created')
    assert.equal(settledReceipt.teamId, retry.team.id)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    for (const cleanup of cleanups.reverse()) cleanup()
    await authorityStore?.close?.()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
