const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const sourcePath = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
const source = fs.readFileSync(sourcePath, 'utf8')

// These are source-level contract tests: routing policy is intentionally a root-model
// decision, while the Host enforces identity, lifecycle, and capacity invariants.
test('multi-team creation has no active-team global suppression', () => {
  const createTeam = source.slice(source.indexOf('async function createTeam'))
  assert.match(createTeam, /document\.teams\.filter\(\(team\) => team\.rootLeadSessionId === lead\.id && team\.state !== "closed"\)/u)
  assert.doesNotMatch(createTeam, /openTeams[\s\S]{0,200}state === "active"[\s\S]{0,200}reject/u)
  assert.match(createTeam, /HARD_MAX_TEAMS_PER_ROOT/u)
})

test('hard team limit is per fixed root and counts unclosed peers', () => {
  assert.match(source, /const HARD_MAX_TEAMS_PER_ROOT = 8/u)
  assert.match(source, /openTeamCounts\.get\(team\.rootLeadSessionId\)/u)
  assert.match(source, /team\.state !== "closed"/u)
  assert.match(source, /AGENT_TEAMS_TEAM_LIMIT/u)
})

test('active turns are shared across every unclosed team of a root', () => {
  assert.match(source, /function activeWorkerTurnsForLead\(document, rootLeadSessionId\)/u)
  assert.match(source, /document\.teams\.filter\(\(team\) => team\.rootLeadSessionId === rootLeadSessionId && team\.state !== "closed"\)/u)
  assert.match(source, /activeWorkerTurnsForLead\(document, lead\.id\) \+ plan\.members\.length > document\.settings\.maxActiveTurns/u)
  assert.match(source, /root lead active-turn limit reached across its teams/u)
})

test('top-level creation authority is limited to direct human input or the exact admitted goal round', () => {
  assert.match(source, /function hasExactGoalRoundRootAuthority/u)
  assert.match(source, /ctx\.agents\.roots\(\)\.includes\(execution\.agent\)/u)
  assert.match(source, /event\.type === "user\/message" && event\.data\?\.source\?\.kind === "user"/u)
  assert.match(source, /event\.data\?\.source\?\.kind === "goal"/u)
  assert.match(source, /event\.data\.source\.goalId === goal\.id/u)
  assert.match(source, /event\.data\.source\.revision === goal\.revision/u)
  assert.match(source, /event\.data\.source\.round === goal\.roundsStarted/u)
  assert.match(source, /goal\.phase !== "active" \|\| goal\.activation !== "armed"/u)
  assert.match(source, /team creation requires direct host-attested human input or the exact current admitted goal continuation/u)
  assert.equal((source.match(/\n      requireTeamCreationRoot\(ctx, execution\);/gu) || []).length, 3)
})

test('goal-round creation authority rejects stale, inactive, disarmed, and non-root callers', async () => {
  const mod = await import(`${pathToFileURL(sourcePath).href}?goal-round-creation-authority=${Date.now()}`)
  const root = { id: 'goal-root' }
  const worker = { id: 'goal-worker' }
  let goal
  const ctx = {
    agents: { roots: () => [root] },
    goals: { get(agent) { assert.equal(agent, root); return goal } }
  }
  const execution = (agent, source) => ({ agent, events: [{ type: 'user/message', data: { source } }] })
  assert.equal(mod.hasTeamCreationRootAuthority(ctx, execution(root, { kind: 'user' })), true)

  goal = { id: 'goal-1', revision: 3, phase: 'active', activation: 'armed', roundsStarted: 7 }
  const exact = { kind: 'goal', goalId: goal.id, revision: goal.revision, round: goal.roundsStarted }
  assert.equal(mod.hasExactGoalRoundRootAuthority(ctx, execution(root, exact)), true)
  assert.equal(mod.hasTeamCreationRootAuthority(ctx, execution(root, exact)), true)
  for (const source of [
    { ...exact, goalId: 'other-goal' },
    { ...exact, revision: goal.revision + 1 },
    { ...exact, round: goal.roundsStarted - 1 },
    { kind: 'coordinator', goalId: goal.id, revision: goal.revision, round: goal.roundsStarted }
  ]) assert.equal(mod.hasTeamCreationRootAuthority(ctx, execution(root, source)), false)

  goal = { ...goal, phase: 'paused' }
  assert.equal(mod.hasTeamCreationRootAuthority(ctx, execution(root, exact)), false)
  goal = { ...goal, phase: 'active', activation: 'disarmed' }
  assert.equal(mod.hasTeamCreationRootAuthority(ctx, execution(root, exact)), false)
  goal = { ...goal, activation: 'armed' }
  assert.equal(mod.hasTeamCreationRootAuthority(ctx, execution(worker, exact)), false)
  assert.equal(mod.inject.includes('goals'), true)
})

test('bootstrap and team_start are mutually exclusive creation paths', () => {
  assert.match(source, /complete bounded task\/member plan is already known[\s\S]*team_bootstrap/u)
  assert.match(source, /never call both team_start and team_bootstrap for the same team/iu)
  assert.match(source, /team_start and then the existing task\/spawn tools/u)
  assert.match(source, /team_task_create/u)
  assert.match(source, /team_spawn/u)
})

test('automatic routing distinguishes level 1, level 2, level 3 and expansion', () => {
  assert.match(source, /Level 1.*simple, tightly coupled, or non-parallel work alone/u)
  assert.match(source, /Level 2.*only one auxiliary executor is needed/u)
  assert.match(source, /Level 3.*at least two sustained, genuinely independent workstreams/u)
  assert.match(source, /When an active team's objective needs another delegation/u)
  assert.match(source, /team_expansion_request/u)
})

test('cross-root and nested teams remain forbidden while same-root peers are allowed', () => {
  assert.match(source, /a root lead session cannot also be an active worker; nested teams are forbidden/u)
  assert.match(source, /cross-team actions require the same fixed root lead to own both teams/u)
  assert.match(source, /Only their same fixed root lead may relay across teams with target_team_id/u)
})

test('routing receipts are Host-scoped audit facts rather than model-routing enforcement claims', () => {
  assert.match(source, /const ROUTING_LEVELS = Object\.freeze\(\["level1", "level2", "level3"\]\)/u)
  assert.match(source, /function recordRoutingReceipt/u)
  assert.match(source, /rootSessionId: execution\.agent\.id/u)
  assert.match(source, /turnKey: execution\.turnKey/u)
  assert.match(source, /projectKey: projectKeyForRoot\(execution\.agent\)/u)
  assert.match(source, /candidateWorkstreams < 2/u)
  assert.match(source, /routing receipt decisions are model-declared; only root, turn, project, and team scope are Host-derived, and the receipt does not force model routing/u)
  assert.match(source, /decisionAuthority: "model_declared"/u)
})

test('all levels use an explicit gate while team creation finalizes the same Level 3 decision', () => {
  assert.match(source, /name: "team_route_goal"/u)
  assert.match(source, /enum: ROUTING_LEVELS/u)
  assert.match(source, /creationPath: "team_start"/u)
  assert.match(source, /creationPath: "team_bootstrap"/u)
  assert.match(source, /recordRoutingReceipt\(store, execution/u)
})

test('routing receipt OCC admits one immutable decision per Host-derived root turn', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-teams-routing-receipt-'))
  try {
    const mod = await import(`${pathToFileURL(sourcePath).href}?routing-receipt=${Date.now()}`)
    const store = new mod.AgentTeamsStore(path.join(temporary, 'storages', 'agent_teams.json'), { enabled: true })
    await store.init()
    const agent = { id: 'routing-root', session: { header: { cwd: temporary } } }
    const execution = { agent, turnKey: 'a'.repeat(64) }
    const decision = { level: 'level2', reasonCategory: 'single_auxiliary_executor', explicitUserTeamRequest: false, candidateWorkstreams: 1, creationPath: 'subagent', outcome: 'recorded' }
    const concurrent = await Promise.all([
      mod.recordRoutingReceipt(store, execution, decision),
      mod.recordRoutingReceipt(store, execution, decision)
    ])
    assert.equal(concurrent.filter(result => result.reused).length, 1)
    assert.equal(store.snapshot().routingReceipts.length, 1)
    const receipt = store.snapshot().routingReceipts[0]
    assert.equal(receipt.rootSessionId, agent.id)
    assert.equal(receipt.turnKey, execution.turnKey)
    assert.match(receipt.projectKey, /^[a-f0-9]{64}$/u)
    await assert.rejects(
      mod.recordRoutingReceipt(store, execution, { level: 'level1', reasonCategory: 'simple_or_tightly_coupled', candidateWorkstreams: 0, creationPath: 'none' }),
      error => error?.code === 'AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT'
    )
    assert.equal(store.snapshot().routingReceipts.length, 1)
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true })
  }
})

test('Level 3 routing receipt finalizes recorded decision exactly once under concurrent replay', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-teams-routing-finalize-'))
  try {
    const mod = await import(`${pathToFileURL(sourcePath).href}?routing-finalize=${Date.now()}`)
    const store = new mod.AgentTeamsStore(path.join(temporary, 'storages', 'agent_teams.json'), { enabled: true })
    await store.init()
    const agent = { id: 'finalize-root', session: { header: { cwd: temporary } } }
    const execution = { agent, turnKey: 'finalize-turn' }
    const decision = { level: 'level3', reasonCategory: 'independent_sustained_workstreams', explicitUserTeamRequest: false, candidateWorkstreams: 2, creationPath: 'team_start', outcome: 'recorded' }
    const recorded = await mod.recordRoutingReceipt(store, execution, decision)
    assert.equal(recorded.receipt.outcome, 'recorded')
    assert.equal(recorded.receipt.teamId, undefined)
    const team = await mod.createTeam(store, agent, { objective: 'Finalize one recorded routing decision' })
    const terminal = { ...decision, outcome: 'created', teamId: team.id }
    const concurrent = await Promise.all([
      mod.recordRoutingReceipt(store, execution, terminal),
      mod.recordRoutingReceipt(store, execution, terminal)
    ])
    assert.equal(concurrent.filter(result => result.finalized).length, 1)
    assert.equal(concurrent.filter(result => result.reused).length, 1)
    const receipt = store.snapshot().routingReceipts[0]
    assert.equal(receipt.id, recorded.receipt.id)
    assert.equal(receipt.outcome, 'created')
    assert.equal(receipt.teamId, team.id)
    assert.ok(receipt.finalizedAt)
    await assert.rejects(
      mod.recordRoutingReceipt(store, execution, { ...decision, outcome: 'failed' }),
      error => error?.code === 'AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT'
    )
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true })
  }
})

test('routing receipt phases reject direct terminals, failed team binding, and invalid successful teams', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-teams-routing-negative-'))
  try {
    const mod = await import(`${pathToFileURL(sourcePath).href}?routing-negative=${Date.now()}`)
    const store = new mod.AgentTeamsStore(path.join(temporary, 'storages', 'agent_teams.json'), { enabled: true })
    await store.init()
    const agent = { id: 'negative-root', session: { header: { cwd: temporary } } }
    const decision = { level: 'level3', reasonCategory: 'independent_sustained_workstreams', explicitUserTeamRequest: false, candidateWorkstreams: 2, creationPath: 'team_start' }
    await assert.rejects(
      mod.recordRoutingReceipt(store, { agent, turnKey: 'direct-failed' }, { ...decision, outcome: 'failed' }),
      error => error?.code === 'AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT'
    )
    await assert.rejects(
      mod.recordRoutingReceipt(store, { agent, turnKey: 'level1-failed' }, { level: 'level1', reasonCategory: 'simple_or_tightly_coupled', explicitUserTeamRequest: false, candidateWorkstreams: 0, creationPath: 'none', outcome: 'failed' }),
      /Level 1 and Level 2 routing decisions must remain recorded/u
    )
    const realTeam = await mod.createTeam(store, agent, { objective: 'Real same-root routing team' })
    await mod.recordRoutingReceipt(store, { agent, turnKey: 'failed-team' }, { ...decision, outcome: 'recorded' })
    await assert.rejects(
      mod.recordRoutingReceipt(store, { agent, turnKey: 'failed-team' }, { ...decision, outcome: 'failed', teamId: realTeam.id }),
      /failed routing finalization cannot bind a team/u
    )
    await mod.recordRoutingReceipt(store, { agent, turnKey: 'unknown-team' }, { ...decision, outcome: 'recorded' })
    await assert.rejects(
      mod.recordRoutingReceipt(store, { agent, turnKey: 'unknown-team' }, { ...decision, outcome: 'created', teamId: 'missing-team' }),
      /routing receipt team scope must be Host-derived from the same root and project/u
    )
    const foreign = { id: 'foreign-root', session: { header: { cwd: temporary } } }
    const foreignTeam = await mod.createTeam(store, foreign, { objective: 'Foreign routing team' })
    await mod.recordRoutingReceipt(store, { agent, turnKey: 'foreign-team' }, { ...decision, outcome: 'recorded' })
    await assert.rejects(
      mod.recordRoutingReceipt(store, { agent, turnKey: 'foreign-team' }, { ...decision, outcome: 'created', teamId: foreignTeam.id }),
      /routing receipt team scope must be Host-derived from the same root and project/u
    )
    const missingProjectTeam = await mod.createTeam(store, agent, { objective: 'Missing project routing team' })
    await store.mutate(document => { document.teams.find(team => team.id === missingProjectTeam.id).projectKey = undefined })
    await mod.recordRoutingReceipt(store, { agent, turnKey: 'missing-project' }, { ...decision, outcome: 'recorded' })
    await assert.rejects(
      mod.recordRoutingReceipt(store, { agent, turnKey: 'missing-project' }, { ...decision, outcome: 'created', teamId: missingProjectTeam.id }),
      /routing receipt team scope must be Host-derived from the same root and project/u
    )
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true })
  }
})

test('routing receipt rollover preserves a tamper-evident ordered archive summary', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-teams-routing-rollover-'))
  try {
    const mod = await import(`${pathToFileURL(sourcePath).href}?routing-rollover=${Date.now()}`)
    const store = new mod.AgentTeamsStore(path.join(temporary, 'storages', 'agent_teams.json'), { enabled: true })
    await store.init()
    const at = new Date().toISOString()
    await store.mutate(document => {
      document.routingReceipts = Array.from({ length: 2048 }, (_, index) => ({
        id: `receipt-${index}`, rootSessionId: `root-${index}`, turnKey: `turn-${index}`, projectKey: 'a'.repeat(64),
        level: 'level1', reasonCategory: 'simple_or_tightly_coupled', explicitUserTeamRequest: false,
        candidateWorkstreams: 0, creationPath: 'none', outcome: 'recorded', decisionAuthority: 'model_declared', createdAt: at
      }))
    })
    const agent = { id: 'rollover-root', session: { header: { cwd: temporary } } }
    await mod.recordRoutingReceipt(store, { agent, turnKey: 'new-turn' }, { level: 'level1', reasonCategory: 'simple_or_tightly_coupled', candidateWorkstreams: 0, creationPath: 'none', outcome: 'recorded' })
    const snapshot = store.snapshot()
    assert.equal(snapshot.routingReceipts.length, 2048)
    assert.equal(snapshot.routingReceipts.some(receipt => receipt.id === 'receipt-0'), false)
    assert.equal(snapshot.routingReceiptArchive.count, 1)
    assert.equal(snapshot.routingReceiptArchive.lastReceiptId, 'receipt-0')
    assert.match(snapshot.routingReceiptArchive.chainHash, /^[a-f0-9]{64}$/u)
    assert.notEqual(snapshot.routingReceiptArchive.chainHash, '0'.repeat(64))
    const reloaded = new mod.AgentTeamsStore(store.filePath)
    await reloaded.init()
    assert.deepEqual(reloaded.snapshot().routingReceiptArchive, snapshot.routingReceiptArchive)
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true })
  }
})

test('Level 3 receipt validation rejects unrelatedness-only and forged shape claims', async () => {
  const mod = await import(`${pathToFileURL(sourcePath).href}?routing-validation=${Date.now()}`)
  const base = { version: 7, settings: { enabled: true, maxMembers: 4, maxActiveTurns: 4 }, teams: [], routingReceipts: [] }
  const receipt = {
    id: 'receipt', rootSessionId: 'root', turnKey: 'turn', projectKey: 'a'.repeat(64), level: 'level3',
    reasonCategory: 'independent_sustained_workstreams', explicitUserTeamRequest: false, candidateWorkstreams: 1,
    creationPath: 'team_start', outcome: 'created', teamId: 'team', createdAt: new Date().toISOString()
  }
  assert.throws(() => mod.validateStoreDocument({ ...base, routingReceipts: [receipt] }), /at least two candidate workstreams/u)
  assert.throws(() => mod.validateStoreDocument({ ...base, routingReceipts: [{ ...receipt, candidateWorkstreams: 2, unrelated: true }] }), /unsupported field/u)
})
