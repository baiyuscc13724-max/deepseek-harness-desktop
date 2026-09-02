const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { access, mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')

function agent(id, source = 'coordinator') {
  return {
    id,
    status: 'running',
    options: { provider: 'test-provider', model: 'test-model' },
    session: { events: [
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { source: { kind: source } } }
    ], snapshotEvents() { return this.events.slice() } }
  }
}

function member(id, name, kind, state, timestamp) {
  return {
    id: `${kind}:${id}`,
    sessionId: id,
    name,
    role: kind === 'lead' ? 'root lead and coordinator' : `${name} role`,
    kind,
    state,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function createContext(rootAgent, senderAgent, targetAgent) {
  const tools = new Map()
  const prompts = []
  const listeners = new Map()
  let initiator = rootAgent
  const agents = new Map([[rootAgent.id, rootAgent], [senderAgent.id, senderAgent], [targetAgent.id, targetAgent]])
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, guard() { return () => {} } },
    systemPrompt: { section(section) { prompts.push(section); return () => {} } },
    webServer: { register() { return () => {} } },
    effect(setup) { setup() },
    on(event, handler) { listeners.set(event, handler); return () => listeners.delete(event) },
    agents: {
      get(id) { return agents.get(id) },
      roots() { return [rootAgent] },
      currentInitiator() { return initiator }
    },
    subagents: {
      followup() { throw new Error('automatic collaboration must not wake a target') },
      interrupt() {},
      drainContinuableChildren: async () => {}
    }
  }
  return { ctx, tools, prompts, listeners, setInitiator(value) { initiator = value } }
}

async function seedTeam(mod, filePath, rootAgent, senderAgent, targetAgent) {
  const store = new mod.AgentTeamsStore(filePath, { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
  await store.init()
  const timestamp = new Date().toISOString()
  await store.mutate(document => {
    document.teams.push({
      id: 'team-host-integration',
      rootLeadSessionId: rootAgent.id,
      name: 'Host integration',
      objective: 'Verify opaque no-wake collaboration tools',
      state: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
      members: [
        member(rootAgent.id, 'Lead', 'lead', 'running', timestamp),
        member(senderAgent.id, 'Sender', 'worker', 'ready', timestamp),
        member(targetAgent.id, 'Target', 'worker', 'ready', timestamp)
      ],
      tasks: [{
        id: 'target-owned-task',
        title: 'Target-owned resource',
        state: 'in_progress',
        dependsOn: [],
        crossTeamDependsOn: [],
        files: ['src/host-owned.js'],
        assigneeSessionId: targetAgent.id,
        createdAt: timestamp,
        updatedAt: timestamp,
        claimedAt: timestamp
      }],
      messages: []
    })
  })
  return store
}

test('Host registers opaque discovery, verified intent, and target-only no-wake inbox tools', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'collaboration-host-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?collaboration-host=${Date.now()}`)
    const rootAgent = agent('root-private', 'user')
    const senderAgent = agent('sender-private')
    const targetAgent = agent('target-private')
    const teamStore = await seedTeam(mod, path.join(root, 'storages', 'agent_teams.json'), rootAgent, senderAgent, targetAgent)
    const runtime = createContext(rootAgent, senderAgent, targetAgent)
    mod.apply(runtime.ctx, { enabled: true, maxMembers: 4, maxActiveTurns: 4 })

    assert.equal(runtime.tools.has('collaboration_discover'), true)
    assert.equal(runtime.tools.has('collaboration_intent'), true)
    assert.equal(runtime.tools.has('collaboration_inbox'), true)
    assert.match(runtime.tools.get('collaboration_discover').description, /never raw session IDs/u)
    const prompt = runtime.prompts.find(section => section.name === 'tool:agent-teams').text({})
    assert.match(prompt, /Observe → Avoid → Require → Resolve → Admit → Deliver/u)
    assert.match(prompt, /silent no-wake inbox/u)

    runtime.setInitiator(senderAgent)
    const discovered = await runtime.tools.get('collaboration_discover').execute({
      team_id: 'team-host-integration', resource_ref: 'src/host-owned.js'
    }, { agent: senderAgent, signal: new AbortController().signal })
    assert.equal(discovered.ok, true)
    assert.equal(discovered.candidates.length, 1)
    assert.equal(discovered.candidates[0].displayName, 'Target')
    assert.match(discovered.candidates[0].routeRef, /^route_/u)
    assert.equal(JSON.stringify(discovered).includes('target-private'), false)
    assert.equal(JSON.stringify(discovered).includes('root-private'), false)

    const admitted = await runtime.tools.get('collaboration_intent').execute({
      team_id: 'team-host-integration',
      route_ref: discovered.candidates[0].routeRef,
      reason: 'UNIQUE_OWNER',
      resource_ref: 'src/host-owned.js',
      message: 'Please confirm the exact owner-only decision.',
      wake_level: 2
    }, { agent: senderAgent, signal: new AbortController().signal })
    assert.equal(admitted.ok, true)
    assert.equal(admitted.admitted, true)
    assert.equal(admitted.code, 'ADMITTED_WAKE_DOWNGRADED')
    assert.equal(admitted.deliveryMode, 'inbox')
    assert.equal(admitted.wakeLevel, 1)
    assert.equal(JSON.stringify(admitted).includes('target-private'), false)

    runtime.setInitiator(targetAgent)
    const inbox = await runtime.tools.get('collaboration_inbox').execute({ team_id: 'team-host-integration' }, { agent: targetAgent, signal: new AbortController().signal })
    assert.equal(inbox.items.length, 1)
    assert.equal(inbox.items[0].message, 'Please confirm the exact owner-only decision.')
    const acknowledged = await runtime.tools.get('collaboration_inbox').execute({
      team_id: 'team-host-integration', action: 'acknowledge', item_ref: inbox.items[0].itemRef
    }, { agent: targetAgent, signal: new AbortController().signal })
    assert.equal(acknowledged.status, 'acknowledged')

    runtime.setInitiator(senderAgent)
    const senderInbox = await runtime.tools.get('collaboration_inbox').execute({ team_id: 'team-host-integration' }, { agent: senderAgent, signal: new AbortController().signal })
    assert.deepEqual(senderInbox.items, [])

    await teamStore.mutate(document => {
      const team = document.teams[0]
      team.state = 'paused'
      team.updatedAt = new Date(Date.now() + 1_000).toISOString()
    })
    const paused = await runtime.tools.get('collaboration_intent').execute({
      team_id: 'team-host-integration',
      route_ref: discovered.candidates[0].routeRef,
      reason: 'UNIQUE_OWNER',
      resource_ref: 'src/host-owned.js',
      message: 'This paused sender must be rejected.'
    }, { agent: senderAgent, signal: new AbortController().signal })
    assert.equal(paused.admitted, false)
    assert.equal(paused.code, 'SENDER_PAUSED')

    const persisted = JSON.parse(await readFile(path.join(root, 'storages', 'agent_collaboration.json'), 'utf8'))
    assert.equal(persisted.inbox.length, 1)
    assert.equal(persisted.audit.some(event => event.decisionCode === 'SENDER_PAUSED'), true)
  } finally {
    process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})

test('disabled empty initialization does not create collaboration storage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'collaboration-host-disabled-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?collaboration-host-disabled=${Date.now()}`)
    const rootAgent = agent('root-disabled', 'user')
    const runtime = createContext(rootAgent, agent('sender-disabled'), agent('target-disabled'))
    mod.apply(runtime.ctx)
    await new Promise(resolve => setImmediate(resolve))
    await assert.rejects(access(path.join(root, 'storages', 'agent_collaboration.json')), error => error.code === 'ENOENT')
  } finally {
    process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})
