const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
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
    status: 0,
    headers: {},
    headersSent: false,
    chunks: [],
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

test('model tools create a team, spawn independent members, and relay with non-user authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-runtime-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?runtime=${Date.now()}`)
    const tools = new Map()
    const routes = new Map()
    const listeners = new Map()
    const followups = []
    const starts = []
    let relayGate
    let relayEntered
    let spawnGate
    let spawnEntered
    let failInterrupt = false
    let leadAvailable = true
    const rootAgent = {
      id: 'lead-session', status: 'running', options: { provider: 'test-provider', model: 'test-model' },
      session: { events: [
        { type: 'turn/start', data: {} },
        { type: 'user/message', data: { source: { kind: 'user' } } }
      ] }
    }
    const recoveryAgent = {
      id: 'recovery-session', status: 'running', options: { provider: 'test-provider', model: 'test-model' },
      session: { events: [
        { type: 'turn/start', data: {} },
        { type: 'user/message', data: { source: { kind: 'user' } } }
      ] }
    }
    let activeInitiator = rootAgent
    const ctx = {
      logger: { info() {}, warn() {}, error() {} },
      tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
      systemPrompt: { section() { return () => {} } },
      webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
      effect(setup) { setup() },
      on(event, handler) { listeners.set(event, handler); return () => listeners.delete(event) },
      agents: {
        get(id) { if (leadAvailable && id === rootAgent.id) return rootAgent; if (id === recoveryAgent.id) return recoveryAgent },
        roots() { return [...(leadAvailable ? [rootAgent] : []), recoveryAgent] },
        currentInitiator() { return activeInitiator }
      },
      subagents: {
        async startContinuable(spec) {
          starts.push(spec)
          if (spawnGate) {
            spawnEntered()
            await spawnGate
          }
          return { childId: starts.length === 1 ? 'worker-session' : `worker-session-${starts.length}`, messageId: `initial-message-${starts.length}` }
        },
        async followup(parent, childId, content, options) {
          followups.push({ parent, childId, content, options })
          if (relayGate && content?.[0]?.text?.includes('Race with shutdown')) {
            relayEntered()
            await relayGate
          }
          return `message-${followups.length}`
        },
        interrupt() { if (failInterrupt) throw new Error('interrupt failed') }
      }
    }
    mod.apply(ctx)

    const settings = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4
    }))
    assert.equal(settings.status, 200)

    const started = await tools.get('team_start').execute({ objective: 'Implement and verify collaboration' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(started.ok, true)
    assert.equal(started.team.objective, 'Implement and verify collaboration')

    const unsafeDisable = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: false
    }))
    assert.equal(unsafeDisable.status, 409)

    const spawned = await tools.get('team_spawn').execute({
      team_id: started.team.id, name: 'Researcher', role: 'research', prompt: 'Collect evidence', model: 'special-model'
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(spawned.ok, true)
    assert.equal(starts.length, 1)
    assert.equal(starts[0].request.parent, rootAgent)
    assert.equal(starts[0].request.agentOptions.model, 'special-model')
    assert.match(starts[0].request.prompt[0].text, /Do not begin any task/u)
    assert.equal(followups[0].options.source.kind, 'coordinator')
    assert.equal(followups[0].childId, 'worker-session')

    const forbiddenWorkerControl = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'worker-session', action: 'member-stop', memberId: 'worker-session', mode: 'retire'
    }))
    assert.equal(forbiddenWorkerControl.status, 403)
    const forbiddenSpoofedLeadControl = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: rootAgent.id, action: 'close', teamId: started.team.id, force: true
    }))
    assert.equal(forbiddenSpoofedLeadControl.status, 403)

    await tools.get('team_message').execute({ team_id: started.team.id, recipient_session_id: 'Researcher', message: 'Verify source B' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(followups[1].options.source.kind, 'coordinator')
    assert.equal(followups[1].options.source.senderSessionId, rootAgent.id)
    assert.match(followups[1].content[0].text, /from Lead/u)
    assert.ok(followups.every(item => item.options.source.kind === 'coordinator'))

    let releaseRelay
    relayGate = new Promise(resolve => { releaseRelay = resolve })
    const enteredRelay = new Promise(resolve => { relayEntered = resolve })
    const racingMessage = tools.get('team_message').execute({ team_id: started.team.id, recipient_session_id: 'Researcher', message: 'Race with shutdown' }, { agent: rootAgent, signal: new AbortController().signal })
    await enteredRelay
    const racingShutdown = tools.get('team_shutdown').execute({ team_id: started.team.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    releaseRelay()
    await Promise.all([racingMessage, racingShutdown])
    const persisted = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8'))
    const persistedTeam = persisted.teams.find(team => team.id === started.team.id)
    assert.equal(persistedTeam.state, 'closed')
    assert.equal(persistedTeam.messages.find(message => message.body === 'Race with shutdown').status, 'delivered')
    await assert.rejects(
      tools.get('team_shutdown').execute({ team_id: started.team.id, force: true }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_CLOSING'
    )

    const secondTeam = (await tools.get('team_start').execute({ objective: 'Spawn shutdown race' }, { agent: rootAgent, signal: new AbortController().signal })).team
    let releaseSpawn
    spawnGate = new Promise(resolve => { releaseSpawn = resolve })
    const enteredSpawn = new Promise(resolve => { spawnEntered = resolve })
    const racingSpawn = tools.get('team_spawn').execute({ team_id: secondTeam.id, name: 'Builder', role: 'Build', prompt: 'Wait for publication' }, { agent: rootAgent, signal: new AbortController().signal })
    await enteredSpawn
    const shutdownDuringSpawn = tools.get('team_shutdown').execute({ team_id: secondTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    releaseSpawn()
    await Promise.all([racingSpawn, shutdownDuringSpawn])
    const afterSpawnRace = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === secondTeam.id)
    assert.equal(afterSpawnRace.state, 'closed')
    assert.equal(afterSpawnRace.members.find(member => member.name === 'Builder').state, 'retired')

    spawnGate = undefined
    const recoverableTeam = (await tools.get('team_start').execute({ objective: 'Recover failed shutdown' }, { agent: rootAgent, signal: new AbortController().signal })).team
    await tools.get('team_spawn').execute({ team_id: recoverableTeam.id, name: 'Operator', role: 'Operate', prompt: 'Stay controllable' }, { agent: rootAgent, signal: new AbortController().signal })
    failInterrupt = true
    const failedShutdown = await tools.get('team_shutdown').execute({ team_id: recoverableTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(failedShutdown.team.state, 'active')
    assert.equal(failedShutdown.failures.length, 1)
    failInterrupt = false
    const retriedShutdown = await tools.get('team_shutdown').execute({ team_id: recoverableTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(retriedShutdown.team.state, 'closed')

    const gracefulTeam = (await tools.get('team_start').execute({ objective: 'Graceful shutdown' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const gracefulMember = (await tools.get('team_spawn').execute({ team_id: gracefulTeam.id, name: 'Closer', role: 'Close', prompt: 'Finish cleanly' }, { agent: rootAgent, signal: new AbortController().signal })).member
    const gracefulShutdown = await tools.get('team_shutdown').execute({ team_id: gracefulTeam.id }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(gracefulShutdown.team.state, 'closing')
    await listeners.get('subagent/end')({ id: gracefulMember.sessionId, stopReason: 'completed' })
    const afterGracefulEnd = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === gracefulTeam.id)
    assert.equal(afterGracefulEnd.state, 'closed')

    const orphan = (await tools.get('team_start').execute({ objective: 'Recover orphan' }, { agent: rootAgent, signal: new AbortController().signal })).team
    leadAvailable = false
    activeInitiator = recoveryAgent
    const orphanPreview = await tools.get('team_recover').execute({ team_id: orphan.id }, { agent: recoveryAgent, signal: new AbortController().signal })
    assert.equal(orphanPreview.candidates.length, 1)
    assert.equal(orphanPreview.recovered.length, 0)
    const orphanRecovery = await tools.get('team_recover').execute({ team_id: orphan.id, confirm: true }, { agent: recoveryAgent, signal: new AbortController().signal })
    assert.equal(orphanRecovery.recovered[0].state, 'closed')
    leadAvailable = true
    activeInitiator = rootAgent
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})
