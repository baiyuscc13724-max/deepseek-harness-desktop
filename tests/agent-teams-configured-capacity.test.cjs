const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, rm } = require('node:fs/promises')
const { Readable } = require('node:stream')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
const queueSubagentPrompt = Symbol.for('dsh.subagent.queuePrompt')

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

function openDirectHumanTurn(agent) {
  agent.session.events.push(
    { type: 'turn/end', data: {} },
    { type: 'turn/start', data: {} },
    { type: 'user/message', data: { source: { kind: 'user' } } }
  )
}

test('configured 8/8 capacity saves directly and bootstraps eight visible peers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-bootstrap-eight-'))
  const previousHome = process.env.DSH_HOME
  const cleanups = []
  process.env.DSH_HOME = root
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?bootstrap-eight=${Date.now()}-${Math.random()}`)
    const tools = new Map(), routes = new Map(), prompts = [], starts = [], followups = []
    const lead = {
      id: 'bootstrap-eight-lead',
      status: 'running',
      options: { provider: 'main-provider', model: 'main-model' },
      session: { header: { cwd: root }, events: [{ type: 'turn/start', data: {} }, { type: 'user/message', data: { source: { kind: 'user' } } }], snapshotEvents() { return this.events.slice() } },
      inbox: { nextTurn: [], nextStep: [], remove() { return false } },
      followup() {},
      steer() {}
    }
    const ctx = {
      logger: { info() {}, warn() {}, error() {} },
      get: () => undefined,
      tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, guard() { return () => {} } },
      systemPrompt: { section(section) { prompts.push(section); return () => {} } },
      webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
      effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
      on() { return () => {} },
      agents: { get(id) { return id === lead.id ? lead : undefined }, roots() { return [lead] }, currentInitiator() { return lead } },
      subagents: {
        async startContinuable(spec) { starts.push(spec); return { childId: spec.childId, messageId: `start-${starts.length}` } },
        async [queueSubagentPrompt](parent, childId, content) { followups.push({ parent, childId, content }); return `followup-${followups.length}` },
        async drainContinuableChildren() {}
      }
    }

    mod.apply(ctx)
    const saved = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings',
      action: 'settings',
      enabled: true,
      maxMembers: 8,
      maxActiveTurns: 8,
      autopilotEnabled: false,
      autopilotMaxAdditionalRounds: 200
    }))
    assert.equal(saved.status, 200, saved.body)
    assert.deepEqual(JSON.parse(saved.body).state.config, {
      enabled: true,
      maxMembers: 8,
      maxActiveTurns: 8,
      autopilotEnabled: false,
      autopilotMaxAdditionalRounds: 200
    })

    const teamsPrompt = prompts.find(section => section.name === 'tool:agent-teams').text({})
    assert.match(teamsPrompt, /Configured capacity is 8 managed member\(s\) per team and 8 simultaneously active member\(s\)/u)
    assert.match(teamsPrompt, /complete bootstrap plan may contain up to 8 visible peers/u)
    assert.match(tools.get('team_bootstrap').description, /hard maximum 8 visible peers/u)

    function plan(count, requestId) {
      return {
        request_id: requestId,
        objective: `Use ${count} independent peers`,
        candidate_workstreams: count,
        tasks: Array.from({ length: count }, (_, index) => ({
          key: `task-${index}`,
          title: `Task ${index}`,
          member_key: `member-${index}`,
          files: [`src/capacity-${index}`]
        })),
        members: Array.from({ length: count }, (_, index) => ({
          key: `member-${index}`,
          name: `Role${index}`,
          role: `own stream ${index}`,
          prompt: `Complete only stream ${index}.`
        }))
      }
    }

    openDirectHumanTurn(lead)
    const bootstrapped = await tools.get('team_bootstrap').execute(plan(8, 'bootstrap-eight'), { agent: lead, signal: new AbortController().signal })
    assert.equal(bootstrapped.operation.phase, 'complete', JSON.stringify(bootstrapped.error))
    assert.equal(bootstrapped.memberRefs.length, 8)
    assert.equal(bootstrapped.taskRefs.length, 8)
    assert.equal(bootstrapped.team.members.filter(member => member.kind === 'worker').length, 8)
    assert.equal(starts.length, 8)
    assert.equal(followups.length, 8)

    openDirectHumanTurn(lead)
    await assert.rejects(
      tools.get('team_bootstrap').execute(plan(9, 'bootstrap-nine'), { agent: lead, signal: new AbortController().signal }),
      error => error?.code === 'AGENT_TEAMS_INVALID_BOOTSTRAP'
    )
    assert.equal(starts.length, 8, 'the hard maximum must reject before provisioning a ninth bootstrap peer')
  } finally {
    process.env.DSH_HOME = previousHome
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('one expansion proposal accepts eight independent outcomes and rejects a ninth', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?expansion-eight=${Date.now()}-${Math.random()}`)
  function requestFor(count) {
    return {
      sourceTaskId: 'source-task',
      parallelBenefit: 'Eight independent outcomes materially reduce the critical path.',
      workstreams: Array.from({ length: count }, (_, index) => ({
        title: `Outcome ${index}`,
        deliverable: `Return independent result ${index}.`,
        acceptance_criteria: `Result ${index} has observable evidence.`,
        resources: [`resource-${index}`]
      }))
    }
  }
  assert.equal(mod.normalizeExpansionRequest(requestFor(8)).workstreams.length, 8)
  assert.throws(
    () => mod.normalizeExpansionRequest(requestFor(9)),
    error => error?.code === 'AGENT_TEAMS_INVALID_EXPANSION'
  )
})
