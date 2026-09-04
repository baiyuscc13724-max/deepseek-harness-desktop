const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { readFile } = require('node:fs/promises')
const { performance } = require('node:perf_hooks')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
const NOW = '2026-09-01T00:00:00.000Z'
const AUTHORIZATION_EPOCH = 'a'.repeat(32)

async function loadPlugin(label) {
  return import(`${pathToFileURL(pluginFile).href}?${label}=${Date.now()}-${Math.random()}`)
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
const AUTOPILOT_SETTINGS_KEYS = ['enabled', 'maxMembers', 'maxActiveTurns', 'autopilotEnabled', 'autopilotMaxAdditionalRounds']
function autopilotSettingsProof(settings, authorizationEpoch) {
  return {
    version: 1,
    settingsHash: hash(['agent-teams-autopilot-settings-v1', AUTOPILOT_SETTINGS_KEYS.map(key => settings[key])]),
    enabled: settings.enabled,
    autopilotEnabled: settings.autopilotEnabled,
    authorizationEpoch,
    authorizedAt: Date.parse(NOW)
  }
}

function projectKey(cwd) {
  const normalized = cwd.trim().replace(/\\/gu, '/').replace(/\/+$/u, '')
  const scope = process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
  return hash(['agent-teams-project-v1', scope])
}

function objectiveHash(objective) {
  return hash(['agent-teams-autopilot-objective-v1', objective])
}

function planHash(team) {
  return hash({
    objective: team.objective,
    tasks: team.tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      dependsOn: task.dependsOn,
      crossTeamDependsOn: task.crossTeamDependsOn ?? [],
      files: task.files ?? [],
      capabilities: task.capabilities ?? [],
      externalEffects: (task.externalEffects ?? []).map(effect => ({
        name: effect.name,
        policy: effect.policy,
        idempotencyKey: effect.idempotencyKey
      }))
    }))
  })
}

function makeTask(index, workerSessionId, { state = 'in_progress', effectPolicy = 'none' } = {}) {
  const taskId = `task-${index}`
  const claimId = `claim-${index}`
  return {
    id: taskId,
    title: `Task ${index}`,
    description: `Bounded workstream ${index}`,
    state,
    revision: 2,
    dependsOn: [],
    crossTeamDependsOn: [],
    files: [`src/team-${index}.js`],
    assigneeSessionId: workerSessionId,
    createdAt: NOW,
    updatedAt: NOW,
    claimedAt: NOW,
    claimId,
    leaseEpoch: 0,
    attempt: 1,
    attemptHistory: [],
    interruptionHistory: [],
    lifecycleLedger: [{
      kind: 'claim', sequence: 1, at: NOW, attempt: 1,
      claimId, leaseEpoch: 0, actorId: workerSessionId
    }],
    capabilities: [{ name: 'workspace', status: 'verified', source: 'trusted Host fixture' }],
    externalEffects: [{ name: `effect-${index}`, policy: effectPolicy, outcome: 'not_started' }]
  }
}

function makeTeam(index, root, goal, { withGrant, budget, taskState, memberState, effectPolicy }) {
  const teamId = `team-${index}`
  const workerSessionId = `worker-${index}`
  const canonicalProjectKey = projectKey(root.session.header.cwd)
  const team = {
    id: teamId,
    rootLeadSessionId: root.id,
    name: `Team ${index}`,
    objective: `Deliver workstream ${index}`,
    revision: 1,
    state: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    start: { requestId: `start-${index}`, inputHash: hash(['start', index]) },
    pauseEpoch: 0,
    projectKey: canonicalProjectKey,
    ownershipHistory: [],
    members: [
      {
        id: `lead-${index}`, sessionId: root.id, name: 'Coordinator', role: 'lead', kind: 'lead',
        state: 'running', createdAt: NOW, updatedAt: NOW
      },
      {
        id: `worker-record-${index}`, sessionId: workerSessionId, name: `Worker ${index}`, role: 'worker', kind: 'worker',
        state: memberState, runId: `run-${index}`, createdAt: NOW, updatedAt: NOW, publishedAt: NOW
      }
    ],
    tasks: [makeTask(index, workerSessionId, { state: taskState, effectPolicy })],
    messages: [],
    memberRecoveries: [],
    taskCommandReceipts: []
  }
  const exactPlanHash = planHash(team)
  team.plan = {
    phase: 'active',
    revision: 1,
    hash: exactPlanHash,
    committedAt: NOW,
    activatedAt: NOW,
    migrationState: 'ready',
    authorization: {
      source: 'host_verified',
      attestedAt: NOW,
      confirmedPlanHash: exactPlanHash,
      permissions: 'host_verified',
      files: 'host_verified',
      cost: 'host_verified',
      externalSideEffects: 'host_verified'
    }
  }
  if (withGrant) {
    team.autopilot = {
      version: 1,
      status: 'active',
      authority: 'direct_human',
      grantId: `grant-${index}`,
      routingReceiptId: `routing-${index}`,
      authorizationEpoch: AUTHORIZATION_EPOCH,
      rootSessionId: root.id,
      projectKey: canonicalProjectKey,
      goalId: goal.id,
      goalObjectiveHash: objectiveHash(goal.objective),
      pauseEpochAtGrant: 0,
      planHashAtGrant: exactPlanHash,
      baseMaxGoalRounds: goal.maxGoalRounds,
      expectedMaxGoalRounds: goal.maxGoalRounds,
      maxAdditionalRounds: budget,
      additionalRoundsGranted: 0,
      wakes: [],
      grantedAt: NOW
    }
  }
  return team
}

function fixture({
  teamCount = 1,
  version = 8,
  withGrant = true,
  autopilotEnabled = true,
  includeAutopilotSettings = true,
  budget = 2,
  taskState = 'in_progress',
  memberState = 'running',
  effectPolicy = 'none',
  rootStatus = 'idle',
  goalOverrides = {}
} = {}) {
  const cwd = path.resolve('C:/workspace/autopilot')
  const root = {
    id: 'root-autopilot',
    status: rootStatus,
    session: { header: { cwd } },
    followups: [],
    steering: [],
    followup(message) { this.followups.push(message) },
    steer(message) { this.steering.push(message) }
  }
  const goal = {
    id: 'goal-autopilot',
    objective: 'Finish every Agent Team workstream',
    revision: 3,
    phase: 'active',
    activation: 'armed',
    roundsStarted: 4,
    maxGoalRounds: 4,
    ...goalOverrides
  }
  root.session.events = [
    { type: 'turn/start', id: 'autopilot-goal-turn', time: NOW, data: {} },
    { type: 'user/message', data: { source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round: goal.roundsStarted } } }
  ]
  root.session.snapshotEvents = () => root.session.events.slice()
  const teams = Array.from({ length: teamCount }, (_, offset) => makeTeam(offset + 1, root, goal, {
    withGrant, budget, taskState, memberState, effectPolicy
  }))
  const settings = { enabled: true, maxMembers: 4, maxActiveTurns: 4 }
  if (includeAutopilotSettings) {
    settings.autopilotEnabled = autopilotEnabled
    settings.autopilotMaxAdditionalRounds = budget
  }
  const routingReceipts = teams.map((team, offset) => ({
    id: `routing-${offset + 1}`,
    rootSessionId: root.id,
    turnKey: `direct-human-turn-${offset + 1}`,
    projectKey: team.projectKey,
    level: 'level3',
    reasonCategory: 'explicit_user_team_request',
    explicitUserTeamRequest: true,
    candidateWorkstreams: 1,
    creationPath: 'team_start',
    outcome: 'created',
    teamId: team.id,
    decisionAuthority: 'model_declared',
    establishmentAuthority: 'direct_human',
    createdAt: NOW,
    finalizedAt: NOW
  }))
  return {
    root,
    goal,
    document: {
      version,
      settings,
      teams,
      routingReceipts,
      routingReceiptArchive: { version: 1, count: 0, chainHash: '0'.repeat(64) }
    }
  }
}

function addClosedHistoryBallast(document) {
  const sessionId = 'closed-history-root'
  const body = 'x'.repeat(60 * 1024)
  document.teams.push({
    id: 'closed-history-team',
    rootLeadSessionId: sessionId,
    name: 'Closed history ballast',
    objective: 'Preserve a realistic large closed-team history',
    revision: 1,
    state: 'closed',
    createdAt: NOW,
    updatedAt: NOW,
    pauseEpoch: 0,
    ownershipHistory: [],
    members: [{
      id: 'closed-history-lead', sessionId, name: 'History', role: 'lead', kind: 'lead',
      state: 'retired', createdAt: NOW, updatedAt: NOW
    }],
    tasks: [],
    messages: Array.from({ length: 120 }, (_, index) => ({
      id: `closed-history-message-${index}`,
      fromSessionId: sessionId,
      toSessionId: sessionId,
      body,
      createdAt: NOW,
      status: 'delivered',
      deliveredAt: NOW
    })),
    memberRecoveries: [],
    taskCommandReceipts: [],
    closure: {
      outcome: 'cancelled',
      attemptedAt: NOW,
      closedAt: NOW,
      reason: 'historical fixture',
      forced: false,
      cancelledTaskIds: [],
      failures: []
    }
  })
  assert.ok(Buffer.byteLength(JSON.stringify(document)) >= 7 * 1024 * 1024)
  return document
}

function advancingClock(stepMs = 3) {
  let timestamp = Date.parse(NOW)
  let calls = 0
  const clock = () => {
    calls += 1
    timestamp += stepMs
    return new Date(timestamp).toISOString()
  }
  clock.calls = () => calls
  return clock
}

function submitTask(document, teamIndex = 0) {
  const team = document.teams[teamIndex]
  const task = team.tasks[0]
  task.state = 'submitted'
  task.revision += 1
  task.updatedAt = NOW
  task.submission = {
    taskId: task.id,
    claimId: task.claimId,
    leaseEpoch: task.leaseEpoch,
    submittedAt: NOW,
    submittedBy: task.assigneeSessionId,
    source: 'explicit_complete'
  }
  task.lifecycleLedger.push({
    kind: 'submission', sequence: task.lifecycleLedger.length + 1, at: NOW, attempt: task.attempt,
    claimId: task.claimId, leaseEpoch: task.leaseEpoch, actorId: task.assigneeSessionId
  })
  team.revision += 1
  return document
}

function touchSubmittedProjection(document, teamIndex = 0) {
  const team = document.teams[teamIndex]
  team.tasks[0].revision += 1
  team.revision += 1
  return document
}

function returnTaskToProducer(document, teamIndex = 0) {
  const team = document.teams[teamIndex]
  const task = team.tasks[0]
  task.state = 'in_progress'
  task.revision += 1
  task.updatedAt = NOW
  delete task.submission
  team.revision += 1
  return document
}

function refreshPlan(team) {
  const exactPlanHash = planHash(team)
  team.plan.hash = exactPlanHash
  team.plan.authorization.confirmedPlanHash = exactPlanHash
  return exactPlanHash
}

function pendingReady() {
  return new Promise(() => {})
}

let fakeStoreIndex = 0
class FakeStore {
  constructor(document, { notifyMutations = true, maxMutationNotifications = Number.POSITIVE_INFINITY } = {}) {
    this.document = structuredClone(document)
    this.listeners = new Set()
    this.notifyMutations = notifyMutations
    this.maxMutationNotifications = maxMutationNotifications
    this.mutationNotifications = 0
    this.snapshotCalls = 0
    this.mutateCalls = 0
    this.changedWrites = 0
    this.publications = 0
    this.mutationPublications = 0
    this.externalPublications = 0
    this.mutationFailures = []
    this.filePath = `agent-teams-autopilot-fixture-${++fakeStoreIndex}.json`
  }

  snapshot() {
    this.snapshotCalls += 1
    return structuredClone(this.document)
  }

  async read(reader = document => document) {
    return structuredClone(await reader(this.document))
  }

  runOperation(operation) {
    return operation()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(next) {
    this.document = structuredClone(next)
    this.externalPublications += 1
    this.publications += 1
    this.#notify()
  }

  failNextMutation(error = new Error('injected durable mutation failure')) {
    this.mutationFailures.push(error)
  }

  async mutate(mutator) {
    this.mutateCalls += 1
    const before = this.document
    const draft = structuredClone(before)
    const result = await mutator(draft)
    if (this.mutationFailures.length > 0) throw this.mutationFailures.shift()
    if (JSON.stringify(before) === JSON.stringify(draft)) return structuredClone(result)
    const previousTeams = new Map(before.teams.map(team => [team.id, team]))
    for (const team of draft.teams) {
      const previous = previousTeams.get(team.id)
      if (previous === undefined) {
        team.revision = 1
        continue
      }
      const previousWithoutRevision = structuredClone(previous)
      const teamWithoutRevision = structuredClone(team)
      delete previousWithoutRevision.revision
      delete teamWithoutRevision.revision
      team.revision = JSON.stringify(previousWithoutRevision) === JSON.stringify(teamWithoutRevision)
        ? previous.revision ?? 1
        : (previous.revision ?? 1) + 1
    }
    this.document = draft
    this.changedWrites += 1
    this.mutationPublications += 1
    this.publications += 1
    if (this.notifyMutations && this.mutationNotifications < this.maxMutationNotifications) {
      this.mutationNotifications += 1
      this.#notify()
    }
    return structuredClone(result)
  }

  #notify() {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

function fakeRuntime(root, document, initialGoal, {
  editFailures = 0,
  editAfterMutationFailures = 0,
  resumeFailures = 0,
  resumeAfterMutationFailures = 0,
  notifyMutations = true,
  maxMutationNotifications = Number.POSITIVE_INFINITY,
  onDisarm,
  authorizationEpoch = AUTHORIZATION_EPOCH
} = {}) {
  const listeners = new Map()
  let goal = initialGoal === undefined ? undefined : structuredClone(initialGoal)
  let hostAuthorizationEpoch = authorizationEpoch
  let hostAutopilotSettingsProof = autopilotSettingsProof(document.settings, hostAuthorizationEpoch)
  let remainingEditFailures = editFailures
  let remainingEditAfterMutationFailures = editAfterMutationFailures
  let remainingResumeFailures = resumeFailures
  let remainingResumeAfterMutationFailures = resumeAfterMutationFailures
  const effects = []
  const warnings = []
  const attempts = { edit: 0, resume: 0, disarm: 0, revoke: 0 }
  const store = new FakeStore(document, { notifyMutations, maxMutationNotifications })
  const authorizationProvider = {
    available: true,
    async readAutopilotAuthorizationState() { return { authorizationEpoch: hostAuthorizationEpoch, autopilotSettingsProof: hostAutopilotSettingsProof } },
    async revokeAutopilotAuthorizations(request) {
      attempts.revoke += 1
      assert.equal(request.authorizationEpoch, hostAuthorizationEpoch)
      hostAuthorizationEpoch = 'z'.repeat(32)
      hostAutopilotSettingsProof = null
      return { authorizationEpoch: hostAuthorizationEpoch, autopilotSettingsProof: hostAutopilotSettingsProof }
    }
  }
  const assertGoalRef = ref => {
    assert.equal(ref.id, goal.id)
    assert.equal(ref.revision, goal.revision)
  }
  const ctx = {
    agents: {
      get: id => id === root.id ? root : undefined,
      roots: () => [root],
      withoutInitiator: operation => operation()
    },
    subagents: {
      async drainContinuableChildren(parent) { assert.equal(parent, root) }
    },
    goals: {
      get: agent => agent === root ? structuredClone(goal) : undefined,
      disarm: agent => {
        assert.equal(agent, root)
        if (typeof onDisarm === 'function') onDisarm(store.snapshot(), structuredClone(goal))
        attempts.disarm += 1
        effects.push({ type: 'disarm' })
        goal = { ...goal, activation: 'disarmed' }
        return structuredClone(goal)
      },
      edit: (agent, ref, request) => {
        assert.equal(agent, root)
        assertGoalRef(ref)
        attempts.edit += 1
        if (remainingEditFailures > 0) {
          remainingEditFailures -= 1
          throw new Error('injected goal edit failure before mutation')
        }
        goal = { ...goal, revision: goal.revision + 1, maxGoalRounds: request.maxGoalRounds }
        effects.push({ type: 'edit', target: request.maxGoalRounds })
        if (remainingEditAfterMutationFailures > 0) {
          remainingEditAfterMutationFailures -= 1
          throw new Error('injected goal edit failure after mutation')
        }
        return structuredClone(goal)
      },
      resume: (agent, ref) => {
        assert.equal(agent, root)
        assertGoalRef(ref)
        attempts.resume += 1
        if (remainingResumeFailures > 0) {
          remainingResumeFailures -= 1
          throw new Error('injected goal resume failure before mutation')
        }
        goal = { ...goal, revision: goal.revision + 1, phase: 'active', activation: 'armed' }
        delete goal.blockedReason
        effects.push({ type: 'resume' })
        if (remainingResumeAfterMutationFailures > 0) {
          remainingResumeAfterMutationFailures -= 1
          throw new Error('injected goal resume failure after mutation')
        }
        return structuredClone(goal)
      }
    },
    logger: { warn(message) { warnings.push(String(message)) } },
    on(name, listener) {
      const group = listeners.get(name) ?? new Set()
      group.add(listener)
      listeners.set(name, group)
      return () => group.delete(listener)
    }
  }
  return {
    attempts,
    ctx,
    effects,
    warnings,
    store,
    authorizationProvider,
    getGoal: () => goal === undefined ? undefined : structuredClone(goal),
    setGoal(patch) {
      if (goal === undefined) throw new Error('cannot patch a cleared goal')
      goal = { ...goal, ...patch, revision: patch.revision ?? goal.revision + 1 }
    },
    clearGoal() { goal = undefined },
    setAuthorizationEpoch(value) { hostAuthorizationEpoch = value },
    emit(name, payload) { for (const listener of listeners.get(name) ?? []) listener(payload) }
  }
}

async function waitFor(predicate, message = 'condition was not observed') {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail(message)
}

function startAutopilot(mod, value, options = {}) {
  const runtime = fakeRuntime(value.root, value.document, value.goal, options)
  const autopilot = mod.createAgentTeamAutopilot(runtime.ctx, runtime.store, options.ready ?? pendingReady(), runtime.authorizationProvider, options.schedulerOptions)
  return { autopilot, runtime }
}

function goalEffects(runtime) {
  return runtime.effects.map(effect => effect.type)
}

function assertStoppedWithoutGoalMutation(runtime) {
  assert.deepEqual(runtime.effects.filter(effect => effect.type === 'edit' || effect.type === 'resume'), [])
  assert.equal(runtime.attempts.edit, 0)
  assert.equal(runtime.attempts.resume, 0)
}

test('a trusted default-on Save binds the first team only inside the exact direct-human Goal turn', async () => {
  const mod = await loadPlugin('direct-human-settings-grant')
  const cwd = path.join(process.cwd(), 'direct-human-autopilot-project')
  const root = { id: 'direct-human-root', session: { header: { cwd } } }
  const goal = {
    id: 'direct-human-goal', revision: 1, objective: 'Continue this exact saved goal safely',
    phase: 'active', activation: 'armed', roundsStarted: 0, maxGoalRounds: 3
  }
  const execution = {
    agent: root,
    turnKey: 'direct-human-settings-turn',
    events: [{ type: 'user/message', data: { source: { kind: 'user' } } }]
  }
  const settings = {
    enabled: true, maxMembers: 4, maxActiveTurns: 4,
    autopilotEnabled: true, autopilotMaxAdditionalRounds: 200
  }
  const proof = autopilotSettingsProof(settings, AUTHORIZATION_EPOCH)
  const ctx = {
    agents: { roots: () => [root] },
    goals: { get: agent => agent === root ? goal : undefined }
  }
  const intent = await mod.exactDirectHumanAutopilotGrantIntent(ctx, {
    async readAutopilotAuthorizationState() {
      return { authorizationEpoch: AUTHORIZATION_EPOCH, autopilotSettingsProof: proof }
    }
  }, execution)
  assert.equal(intent.rootSessionId, root.id)
  assert.equal(intent.goalRound, 0, 'the direct-user creation turn may precede the first automatic round')
  assert.equal(intent.autopilotSettingsHash, proof.settingsHash)

  const routingReceiptId = 'direct-human-routing-receipt'
  const document = {
    settings,
    teams: [],
    routingReceipts: [{
      id: routingReceiptId, rootSessionId: root.id, turnKey: execution.turnKey, projectKey: projectKey(cwd),
      level: 'level3', outcome: 'recorded', establishmentAuthority: 'direct_human'
    }]
  }
  const grant = mod.agentTeamAutopilotGrantForCreation(document, root, goal, {
    directHumanGrantIntent: intent, routingReceiptId
  })
  assert.equal(grant.status, 'pending_plan')
  assert.equal(grant.authority, 'direct_human')
  assert.equal(grant.authorizationEpoch, AUTHORIZATION_EPOCH)
  assert.equal(grant.goalId, goal.id)
  assert.equal(grant.maxAdditionalRounds, 200)

  assert.equal(mod.agentTeamAutopilotGrantForCreation(document, root, goal, { routingReceiptId }), undefined, 'the selected preference alone is not Goal authority')
  assert.equal(mod.agentTeamAutopilotGrantForCreation({ ...document, settings: { ...settings, autopilotMaxAdditionalRounds: 199 } }, root, goal, {
    directHumanGrantIntent: intent, routingReceiptId
  }), undefined, 'changing the saved settings hash invalidates the exact intent')
  assert.equal(mod.agentTeamAutopilotGrantForCreation({ ...document, routingReceipts: [{ ...document.routingReceipts[0], turnKey: 'other-turn' }] }, root, goal, {
    directHumanGrantIntent: intent, routingReceiptId
  }), undefined, 'a different direct-human turn cannot reuse the intent')

  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /const directHumanGrantIntent = !directHuman \|\| !store\.autopilotPolicy\(\)\.enabled \? undefined : await exactDirectHumanAutopilotGrantIntent\(ctx, authorizationProvider, execution\)/u)
  assert.equal((source.match(/autopilotGoal: ctx\.goals\?\.get\?\.\(execution\.agent\), directHumanGrantIntent, goalRoundGrantIntent/gu) || []).length, 2, 'team_start and team_bootstrap both carry the exact direct-human intent internally')
})

test('explicitly disabled, legacy, and missing-grant stores never acquire automatic goal authority', async t => {
  const mod = await loadPlugin('no-implicit-grant')
  const cases = [
    ['explicitly disabled v8', fixture({ withGrant: false, autopilotEnabled: false })],
    ['legacy v7 without autopilot fields', fixture({ version: 7, withGrant: false, includeAutopilotSettings: false })],
    ['Host preference on but no exact grant', fixture({ withGrant: false, autopilotEnabled: true })]
  ]
  for (const [label, value] of cases) await t.test(label, async () => {
    const { autopilot, runtime } = startAutopilot(mod, value)
    try {
      const submitted = submitTask(runtime.store.snapshot())
      runtime.store.publish(submitted)
      await autopilot.flush()
      assertStoppedWithoutGoalMutation(runtime)
      assert.equal(runtime.store.snapshot().teams[0].autopilot, undefined)
    } finally {
      autopilot.close()
    }
  })
})

test('missing and revoked grants never manufacture scheduler wakes from ordinary Goal rounds or progress projections', async t => {
  const mod = await loadPlugin('missing-revoked-not-a-wake')
  for (const mode of ['missing', 'revoked']) await t.test(mode, async () => {
    const value = fixture({
      withGrant: mode === 'revoked',
      goalOverrides: { roundsStarted: 10, maxGoalRounds: 44 }
    })
    if (mode === 'revoked') {
      value.document.teams[0].autopilot.status = 'revoked'
      value.document.teams[0].autopilot.revokedAt = NOW
      value.document.teams[0].autopilot.revokeReason = 'prior automatic-continuation authority was revoked'
    }
    const { autopilot, runtime } = startAutopilot(mod, value)
    try {
      for (let round = 10; round <= 18; round += 1) {
        runtime.setGoal({ roundsStarted: round, maxGoalRounds: 44, phase: 'active', activation: 'armed' })
        const projection = runtime.store.snapshot()
        projection.teams[0].messages.push({
          id: `progress-${round}`, fromSessionId: value.root.id, toSessionId: 'worker-1',
          body: `coordinator progress ${round}`, status: 'delivered', createdAt: NOW, deliveredAt: NOW
        })
        runtime.store.publish(projection)
        autopilot.onStatus({ agent: value.root, status: 'idle' })
        await autopilot.flush()
      }
      assert.deepEqual(runtime.effects, [], 'without a live grant the scheduler neither resumes nor parks an ordinary armed Goal')
      assert.equal(runtime.attempts.revoke, 0)
      const grant = runtime.store.snapshot().teams[0].autopilot
      if (mode === 'missing') assert.equal(grant, undefined)
      else {
        assert.equal(grant.status, 'revoked')
        assert.deepEqual(grant.wakes, [])
        assert.equal(grant.lastStateHash, undefined)
      }
    } finally {
      autopilot.close()
    }
  })
})

test('a safe live grant parks once across advancing milliseconds and duplicate publications stay pre-mutation no-ops', async () => {
  const mod = await loadPlugin('park-live-grant')
  const value = fixture()
  const clock = advancingClock(3)
  assert.equal(mod.rootCanAutonomouslyWait(value.document, value.root), true)
  const markersAtDisarm = []
  const ledgerBefore = structuredClone(value.document.teams[0].tasks[0].lifecycleLedger)
  const { autopilot, runtime } = startAutopilot(mod, value, {
    maxMutationNotifications: 25,
    schedulerOptions: { now: clock },
    onDisarm(document) { markersAtDisarm.push(document.teams[0].autopilot.parkedGoalRevision) }
  })
  try {
    await autopilot.flush()
    assert.deepEqual(goalEffects(runtime), ['disarm'])
    assert.deepEqual(markersAtDisarm, [undefined], 'the process-local Goal is synchronously disarmed before any durable parked marker')
    assert.equal(runtime.getGoal().activation, 'disarmed')
    const firstPark = runtime.store.snapshot()
    const parked = firstPark.teams[0].autopilot
    assert.equal(parked.status, 'active')
    assert.equal(parked.parkedGoalRevision, value.goal.revision)
    assert.match(parked.parkedStateHash, /^[a-f0-9]{64}$/)
    assert.equal(parked.parkedAt, '2026-09-01T00:00:00.003Z')
    assert.equal(firstPark.teams[0].updatedAt, parked.parkedAt)
    assert.deepEqual(firstPark.teams[0].tasks[0].lifecycleLedger, ledgerBefore)
    assert.deepEqual(
      [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()],
      [1, 1, 1, 1],
      'the initial park produces one disarm, one durable write, and one publication'
    )

    for (let index = 0; index < 20; index += 1) {
      autopilot.onDocument(runtime.store.snapshot())
      await autopilot.flush()
    }
    const duplicatePark = runtime.store.snapshot()
    assert.deepEqual(goalEffects(runtime), ['disarm'], 'the parked projection is not disarmed twice')
    assert.deepEqual(
      [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()],
      [1, 1, 1, 1],
      'twenty duplicate reconcile attempts return before store.mutate and publish nothing'
    )
    assert.equal(duplicatePark.teams[0].revision, firstPark.teams[0].revision)
    assert.equal(duplicatePark.teams[0].updatedAt, firstPark.teams[0].updatedAt)
    assert.equal(duplicatePark.teams[0].autopilot.parkedAt, parked.parkedAt)
    assert.equal(duplicatePark.teams[0].autopilot.parkedStateHash, parked.parkedStateHash)
    assert.deepEqual(duplicatePark.teams[0].tasks[0].lifecycleLedger, ledgerBefore)
  } finally {
    autopilot.close()
  }
})

test('one- and two-team parked groups stay write-free under twenty duplicate 7 MiB history projections', async t => {
  const mod = await loadPlugin('large-history-park-noop')
  const prewriteSamples = []
  const duplicateSamples = []
  for (const teamCount of [1, 2]) await t.test(`${teamCount} active team${teamCount === 1 ? '' : 's'}`, async () => {
    const value = fixture({ teamCount })
    addClosedHistoryBallast(value.document)
    assert.doesNotThrow(() => mod.validateStoreDocument(structuredClone(value.document)), 'the large closed-history fixture remains a valid durable document')
    const clock = advancingClock(teamCount === 1 ? 2 : 5)
    const { autopilot, runtime } = startAutopilot(mod, value, {
      maxMutationNotifications: 25,
      schedulerOptions: { now: clock }
    })
    try {
      const prewriteWallStarted = performance.now()
      const prewriteCpuStarted = process.cpuUsage()
      await autopilot.flush()
      const prewriteCpu = process.cpuUsage(prewriteCpuStarted)
      prewriteSamples.push({
        cpu: (prewriteCpu.user + prewriteCpu.system) / 1_000,
        wall: performance.now() - prewriteWallStarted
      })
      const firstPark = runtime.store.snapshot()
      const activeTeams = firstPark.teams.filter(team => team.autopilot?.status === 'active')
      assert.equal(activeTeams.length, teamCount)
      assert.equal(new Set(activeTeams.map(team => team.autopilot.parkedStateHash)).size, 1)
      assert.equal(new Set(activeTeams.map(team => team.autopilot.parkedAt)).size, 1)
      assert.deepEqual(
        [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, runtime.store.publications, clock.calls()],
        [1, 1, 1, 1, 1],
        'the first group park is one atomic changed publication'
      )

      const duplicateCpuDurations = []
      const duplicateSnapshotCounts = []
      const eventLoopLags = []
      for (let attempt = 0; attempt < 20; attempt += 1) {
        // Build the 7 MiB fixture projection outside the product-side timing.
        const projection = runtime.store.snapshot()
        const productSnapshotStarted = runtime.store.snapshotCalls
        const turnWallStarted = performance.now()
        const turnCpuStarted = process.cpuUsage()
        const eventLoopTurn = new Promise(resolve => setImmediate(() => resolve(performance.now() - turnWallStarted)))
        autopilot.onDocument(projection)
        await autopilot.flush()
        const turnCpu = process.cpuUsage(turnCpuStarted)
        duplicateCpuDurations.push((turnCpu.user + turnCpu.system) / 1_000)
        duplicateSnapshotCounts.push(runtime.store.snapshotCalls - productSnapshotStarted)
        eventLoopLags.push(await eventLoopTurn)
      }
      const duplicatePark = runtime.store.snapshot()
      const sortedCpuDurations = [...duplicateCpuDurations].sort((left, right) => left - right)
      const p95CpuDuration = sortedCpuDurations[Math.ceil(sortedCpuDurations.length * 0.95) - 1]
      const p95EventLoopLag = [...eventLoopLags].sort((left, right) => left - right)[Math.ceil(eventLoopLags.length * 0.95) - 1]
      duplicateSamples.push({ teamCount, p95CpuDuration, p95EventLoopLag, maxSnapshotCount: Math.max(...duplicateSnapshotCounts) })
      // Wall-clock setImmediate delay includes time this process was descheduled by
      // parallel test workers. Current-process CPU keeps the product stall gate
      // strict without making unrelated suite scheduling a source of failures.
      assert.ok(p95CpuDuration < 100, `duplicate projection product CPU p95 must stay below 100 ms; observed ${p95CpuDuration.toFixed(1)} ms CPU (${p95EventLoopLag.toFixed(1)} ms wall-clock event-loop delay)`)
      assert.equal(duplicateCpuDurations.some((duration, index) => duration > 100 && duplicateCpuDurations[index - 1] > 100), false, 'duplicate projections never sustain consecutive >100 ms product-side stalls')
      assert.equal(duplicateSnapshotCounts.every(count => count <= 2), true, 'each duplicate reuses its committed observed projection instead of cloning the full history at root reconciliation entry')
      assert.deepEqual(
        [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, runtime.store.publications, clock.calls()],
        [1, 1, 1, 1, 1],
        'twenty large duplicate attempts perform zero additional mutations, writes, or publications'
      )
      for (let index = 0; index < teamCount; index += 1) {
        assert.equal(duplicatePark.teams[index].revision, firstPark.teams[index].revision)
        assert.equal(duplicatePark.teams[index].updatedAt, firstPark.teams[index].updatedAt)
        assert.equal(duplicatePark.teams[index].autopilot.parkedAt, firstPark.teams[index].autopilot.parkedAt)
        assert.equal(duplicatePark.teams[index].autopilot.parkedStateHash, firstPark.teams[index].autopilot.parkedStateHash)
        assert.deepEqual(duplicatePark.teams[index].tasks[0].lifecycleLedger, value.document.teams[index].tasks[0].lifecycleLedger)
      }
    } finally {
      autopilot.close()
    }
  })
  const sortedPrewriteCpu = prewriteSamples.map(sample => sample.cpu).sort((left, right) => left - right)
  const p95PrewriteCpu = sortedPrewriteCpu[Math.ceil(sortedPrewriteCpu.length * 0.95) - 1]
  const maxPrewriteWall = Math.max(...prewriteSamples.map(sample => sample.wall))
  if (process.env.DSH_TEST_PERF_DIAGNOSTICS === '1') {
    t.diagnostic(`large-history park samples: ${JSON.stringify({ duplicateSamples, prewriteSamples, p95PrewriteCpu, maxPrewriteWall })}`)
  }
  assert.ok(p95PrewriteCpu < 400, `large-document pre-write current-process CPU p95 must stay below 400 ms; observed ${p95PrewriteCpu.toFixed(1)} ms CPU (${maxPrewriteWall.toFixed(1)} ms maximum wall time)`)
})

test('park fingerprint advances once for ownership, claim, lease, dependency, member, action, group, and Goal transitions', async () => {
  const mod = await loadPlugin('park-transition-fingerprint')
  const value = fixture({ teamCount: 2 })
  const clock = advancingClock(3)
  const originalLedgerHead = structuredClone(value.document.teams[0].tasks[0].lifecycleLedger[0])
  const { autopilot, runtime } = startAutopilot(mod, value, {
    maxMutationNotifications: 25,
    schedulerOptions: { now: clock }
  })
  try {
    await autopilot.flush()
    let parkedDocument = runtime.store.snapshot()
    let parkedHash = parkedDocument.teams[0].autopilot.parkedStateHash
    let parkedAt = parkedDocument.teams[0].autopilot.parkedAt

    const orderingCounters = [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()]
    const reordered = runtime.store.snapshot()
    reordered.teams.reverse()
    for (const team of reordered.teams) {
      team.tasks.reverse()
      team.members.reverse()
      for (const task of team.tasks) task.externalEffects.reverse()
    }
    runtime.store.publish(reordered)
    await autopilot.flush()
    assert.deepEqual(
      [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()],
      orderingCounters,
      'storage order alone does not change the canonical parked-state fingerprint'
    )
    parkedDocument = runtime.store.snapshot()
    assert.equal(parkedDocument.teams.find(team => team.id === 'team-1').autopilot.parkedStateHash, parkedHash)
    parkedDocument.teams.sort((left, right) => left.id.localeCompare(right.id))
    runtime.store.publish(parkedDocument)
    await autopilot.flush()
    assert.deepEqual(
      [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()],
      orderingCounters,
      'restoring canonical storage order is also a parked-state no-op'
    )

    const applyDurableTransition = async (label, mutateDocument) => {
      const beforeCounters = [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()]
      const next = runtime.store.snapshot()
      mutateDocument(next)
      assert.doesNotThrow(() => mod.validateStoreDocument(structuredClone(next)), `${label} keeps the durable store valid`)
      runtime.store.publish(next)
      await autopilot.flush()
      parkedDocument = runtime.store.snapshot()
      const liveGrants = parkedDocument.teams.filter(team => team.state !== 'closed' && team.autopilot?.status === 'active')
      const nextHash = liveGrants[0].autopilot.parkedStateHash
      const nextParkedAt = liveGrants[0].autopilot.parkedAt
      assert.notEqual(nextHash, parkedHash, `${label} changes the semantic parked-state fingerprint`)
      assert.notEqual(nextParkedAt, parkedAt, `${label} refreshes the parked timestamp exactly once`)
      assert.equal(new Set(liveGrants.map(team => team.autopilot.parkedStateHash)).size, 1, `${label} is atomic across the live grant group`)
      assert.deepEqual(
        [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()],
        beforeCounters.map(value => value + 1),
        `${label} performs one parked-state mutation and publication`
      )
      const stableCounters = [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()]
      autopilot.onDocument(runtime.store.snapshot())
      await autopilot.flush()
      const stableDocument = runtime.store.snapshot()
      const stableGrant = stableDocument.teams.find(team => team.state !== 'closed' && team.autopilot?.status === 'active').autopilot
      assert.deepEqual(
        [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()],
        stableCounters,
        `${label} stabilizes before store.mutate on its duplicate projection`
      )
      assert.equal(stableGrant.parkedStateHash, nextHash)
      assert.equal(stableGrant.parkedAt, nextParkedAt)
      parkedDocument = stableDocument
      parkedHash = nextHash
      parkedAt = nextParkedAt
    }

    await applyDurableTransition('worker ownership and claim', document => {
      const team = document.teams[0]
      const task = team.tasks[0]
      const sessionId = 'worker-1-replacement'
      team.members.push({
        id: 'worker-record-1-replacement', sessionId, name: 'Replacement', role: 'worker', kind: 'worker',
        state: 'running', runId: 'run-1-replacement', createdAt: NOW, updatedAt: NOW, publishedAt: NOW
      })
      task.assigneeSessionId = sessionId
      task.attempt += 1
      task.claimId = 'claim-1-replacement'
      task.claimedAt = NOW
      task.attemptHistory.push({ kind: 'claimed', at: NOW, attempt: task.attempt, claimId: task.claimId, leaseEpoch: task.leaseEpoch })
      task.lifecycleLedger.push({
        kind: 'claim', sequence: task.lifecycleLedger.length + 1, at: NOW, attempt: task.attempt,
        claimId: task.claimId, leaseEpoch: task.leaseEpoch, actorId: sessionId
      })
      task.revision += 1
      team.revision += 1
    })

    await applyDurableTransition('claim lease and pause epoch', document => {
      const team = document.teams[0]
      const task = team.tasks[0]
      team.pauseEpoch += 1
      team.autopilot.pauseEpochAtGrant = team.pauseEpoch
      task.attempt += 1
      task.claimId = 'claim-1-lease-1'
      task.leaseEpoch = team.pauseEpoch
      task.claimedAt = NOW
      task.attemptHistory.push({ kind: 'claimed', at: NOW, attempt: task.attempt, claimId: task.claimId, leaseEpoch: task.leaseEpoch })
      task.lifecycleLedger.push({
        kind: 'claim', sequence: task.lifecycleLedger.length + 1, at: NOW, attempt: task.attempt,
        claimId: task.claimId, leaseEpoch: task.leaseEpoch, actorId: task.assigneeSessionId
      })
      task.revision += 1
      team.revision += 1
    })

    await applyDurableTransition('cross-team dependency and plan hash', document => {
      const team = document.teams[0]
      team.tasks[0].crossTeamDependsOn = [{ teamId: document.teams[1].id, taskId: document.teams[1].tasks[0].id }]
      team.tasks[0].revision += 1
      team.plan.revision += 1
      team.autopilot.planHashAtGrant = refreshPlan(team)
      team.revision += 1
    })

    await applyDurableTransition('member attention action and reason', document => {
      const team = document.teams[0]
      team.members.find(member => member.sessionId === team.tasks[0].assigneeSessionId).state = 'ready'
      team.revision += 1
    })

    await applyDurableTransition('member-attention action state hash', document => {
      const team = document.teams[0]
      team.members.find(member => member.sessionId === team.tasks[0].assigneeSessionId).runId = 'run-1-replacement-restarted'
      team.revision += 1
    })

    await applyDurableTransition('return to producer-owned waiting', document => {
      const team = document.teams[0]
      team.members.find(member => member.sessionId === team.tasks[0].assigneeSessionId).state = 'running'
      team.revision += 1
    })

    await applyDurableTransition('ordered live grant group membership', document => {
      const team = document.teams[1]
      team.state = 'closed'
      team.autopilot.status = 'revoked'
      team.autopilot.revokedAt = '2026-09-01T00:00:01.000Z'
      team.autopilot.revokeReason = 'fixture group transition'
      team.autopilot.parkedGoalRevision = undefined
      team.autopilot.parkedStateHash = undefined
      team.autopilot.parkedAt = undefined
      team.closure = {
        outcome: 'forced', attemptedAt: '2026-09-01T00:00:01.000Z', closedAt: '2026-09-01T00:00:01.000Z',
        reason: 'fixture group transition', forced: true, cancelledTaskIds: [], failures: []
      }
      team.updatedAt = '2026-09-01T00:00:01.000Z'
      team.revision += 1
    })

    const beforeGoalCounters = [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()]
    const priorGoalHash = parkedHash
    runtime.setGoal({ activation: 'armed' })
    autopilot.onStatus({ agent: value.root, status: 'idle' })
    await autopilot.flush()
    const goalPark = runtime.store.snapshot().teams[0].autopilot
    assert.notEqual(goalPark.parkedStateHash, priorGoalHash, 'the Goal revision participates in the park fingerprint')
    assert.deepEqual(
      [runtime.store.mutateCalls, runtime.store.changedWrites, runtime.store.mutationPublications, clock.calls()],
      beforeGoalCounters.map(value => value + 1),
      'a real Goal revision is parked once'
    )
    assert.equal(runtime.attempts.disarm, 2)
    assert.deepEqual(runtime.store.snapshot().teams[0].tasks[0].lifecycleLedger[0], originalLedgerHead, 'immutable lifecycle history is preserved')
    assert.equal(runtime.store.snapshot().teams[0].tasks[0].lifecycleLedger.length, 3, 'real claims append rather than rewrite lifecycle history')
    assert.deepEqual(runtime.store.snapshot().teams[0].autopilot.wakes, [], 'park transitions do not rewrite the wake audit ledger')
  } finally {
    autopilot.close()
  }
})

test('ordinary member waiting stays parked until an eligible durable event arrives', async () => {
  const mod = await loadPlugin('park-ordinary-ready-transition')
  const value = fixture()
  const { autopilot, runtime } = startAutopilot(mod, value)
  try {
    await autopilot.flush()
    const waiting = runtime.store.snapshot()
    waiting.teams[0].members[1].state = 'ready'
    runtime.store.publish(waiting)
    await autopilot.flush()
    assert.deepEqual(goalEffects(runtime), ['disarm'])
    assert.equal(runtime.getGoal().roundsStarted, value.goal.roundsStarted, 'parking and no-op readiness do not consume a Goal round')
    assert.deepEqual(runtime.store.snapshot().teams[0].autopilot.wakes, [])
  } finally {
    autopilot.close()
  }
})

test('one exhausted-cap submission edits and resumes exactly one round and replicates a durable wake to both teams', async () => {
  const mod = await loadPlugin('two-team-wake')
  const value = fixture({
    teamCount: 2,
    goalOverrides: { phase: 'blocked', activation: 'disarmed', blockedReason: { code: 'round-limit', message: 'slice exhausted' } }
  })
  const { autopilot, runtime } = startAutopilot(mod, value)
  try {
    runtime.store.publish(submitTask(runtime.store.snapshot(), 0))
    await autopilot.flush()

    assert.deepEqual(runtime.effects, [{ type: 'edit', target: 5 }, { type: 'resume' }])
    assert.equal(runtime.getGoal().maxGoalRounds, 5)
    assert.equal(runtime.getGoal().activation, 'armed')
    const grants = runtime.store.snapshot().teams.map(team => team.autopilot)
    assert.deepEqual(grants.map(grant => [grant.additionalRoundsGranted, grant.expectedMaxGoalRounds]), [[1, 5], [1, 5]])
    assert.deepEqual(grants.map(grant => grant.wakes.length), [1, 1])
    assert.deepEqual(grants.map(grant => grant.wakes[0].status), ['delivered', 'delivered'])
    const copies = grants.map(grant => structuredClone(grant.wakes[0]))
    for (const copy of copies) delete copy.teamRevision
    assert.deepEqual(copies[0], copies[1], 'the root-wide durable wake is copied identically apart from local team revision provenance')

    runtime.store.publish(runtime.store.snapshot())
    await autopilot.flush()
    assert.deepEqual(runtime.effects, [{ type: 'edit', target: 5 }, { type: 'resume' }], 'the delivery projection does not disarm the just-resumed Goal')
    assert.deepEqual(runtime.store.snapshot().teams.map(team => team.autopilot.wakes.length), [1, 1])

    runtime.setGoal({ roundsStarted: 5, phase: 'active', activation: 'armed' })
    runtime.store.publish(touchSubmittedProjection(runtime.store.snapshot()))
    await autopilot.flush()
    assert.deepEqual(runtime.effects, [{ type: 'edit', target: 5 }, { type: 'resume' }, { type: 'disarm' }], 'the consumed round is parked instead of polling the same durable action')
    assert.deepEqual(runtime.store.snapshot().teams.map(team => team.autopilot.wakes.length), [1, 1], 'audit-only revision changes do not allocate a second wake')
  } finally {
    autopilot.close()
  }
})

test('the first durable expansion proposal gets one review wake whose hash ignores later task and member projections', async () => {
  const mod = await loadPlugin('expansion-review-wake')
  const value = fixture({
    goalOverrides: { phase: 'blocked', activation: 'disarmed', blockedReason: { code: 'round-limit', message: 'slice exhausted' } }
  })
  const { autopilot, runtime } = startAutopilot(mod, value)
  try {
    const proposed = runtime.store.snapshot()
    proposed.teams[0].messages.push({
      id: 'expansion:' + 'd'.repeat(64), fromSessionId: proposed.teams[0].members[1].sessionId, toSessionId: value.root.id,
      body: 'durable structured expansion request', status: 'queued', queuedAt: NOW, createdAt: NOW,
      kind: 'expansion_request', dedupeKey: 'd'.repeat(64), expansionRequest: { id: 'expansion:' + 'd'.repeat(64) }
    })
    runtime.store.publish(proposed)
    const changedWhilePending = runtime.store.snapshot()
    changedWhilePending.teams[0].tasks[0].revision += 1
    changedWhilePending.teams[0].members[1].updatedAt = '2026-09-01T00:00:00.500Z'
    changedWhilePending.teams[0].revision += 1
    runtime.store.publish(changedWhilePending)
    await autopilot.flush()
    assert.deepEqual(runtime.effects, [{ type: 'edit', target: 5 }, { type: 'resume' }])
    let team = runtime.store.snapshot().teams[0]
    assert.equal(team.autopilot.wakes.length, 1)
    assert.equal(team.autopilot.wakes[0].kind, 'review_expansion')
    assert.equal(team.autopilot.wakes[0].status, 'delivered')
    assert.equal(typeof team.messages.at(-1).expansionWakeDeliveredAt, 'string', 'delivery consumes the one-shot structural wake marker immediately')
    const joinedReview = runtime.store.snapshot()
    joinedReview.teams[0].messages.push({
      id: 'expansion:' + 'e'.repeat(64), fromSessionId: 'worker-1', toSessionId: value.root.id,
      body: 'second structural proposal before the admitted turn', status: 'queued', queuedAt: '2026-09-01T00:00:00.750Z', createdAt: '2026-09-01T00:00:00.750Z',
      kind: 'expansion_request', dedupeKey: 'e'.repeat(64), expansionRequest: { id: 'expansion:' + 'e'.repeat(64) }
    })
    runtime.store.publish(joinedReview)
    await autopilot.flush()
    team = runtime.store.snapshot().teams[0]
    assert.equal(typeof team.messages.at(-1).expansionWakeDeliveredAt, 'string', 'a proposal arriving before the admitted turn joins that review round')
    assert.equal(team.autopilot.wakes.length, 1)
    assert.deepEqual(runtime.effects, [{ type: 'edit', target: 5 }, { type: 'resume' }])

    runtime.setGoal({ roundsStarted: 5, phase: 'active', activation: 'armed' })
    const projectionOnly = runtime.store.snapshot()
    projectionOnly.teams[0].tasks[0].revision += 1
    projectionOnly.teams[0].members[1].updatedAt = '2026-09-01T00:00:01.000Z'
    projectionOnly.teams[0].revision += 1
    runtime.store.publish(projectionOnly)
    autopilot.onStatus({ agent: value.root, status: 'idle' })
    await autopilot.flush()
    team = runtime.store.snapshot().teams[0]
    assert.deepEqual(runtime.effects, [{ type: 'edit', target: 5 }, { type: 'resume' }, { type: 'disarm' }], 'the consumed round parks once; later task/member projections do not create an empty expansion round')
    assert.equal(team.autopilot.wakes.length, 1)
  } finally {
    autopilot.close()
  }
})

test('a prepared two-team wake survives one pre-mutation goal edit failure and flush retries it once', async () => {
  const mod = await loadPlugin('prepared-retry')
  const value = fixture({
    teamCount: 2,
    goalOverrides: { phase: 'blocked', activation: 'disarmed', blockedReason: { code: 'round-limit', message: 'slice exhausted' } }
  })
  const { autopilot, runtime } = startAutopilot(mod, value, { editFailures: 1, notifyMutations: false })
  try {
    runtime.store.publish(submitTask(runtime.store.snapshot(), 0))
    await waitFor(() => runtime.attempts.edit === 1 && runtime.warnings.length === 1, 'first edit attempt did not fail after the durable prepare commit')
    const prepared = runtime.store.snapshot().teams.map(team => team.autopilot)
    assert.deepEqual(prepared.map(grant => grant.wakes[0]?.status), ['prepared', 'prepared'])
    assert.deepEqual(prepared.map(grant => [grant.additionalRoundsGranted, grant.expectedMaxGoalRounds]), [[1, 5], [1, 5]])
    assert.equal(runtime.getGoal().maxGoalRounds, 4, 'the injected exception occurred before the Host goal mutation')

    await autopilot.flush()
    assert.equal(runtime.attempts.edit, 2, 'there is one failed pre-effect attempt and one successful retry')
    assert.equal(runtime.attempts.resume, 1)
    assert.deepEqual(runtime.effects, [{ type: 'edit', target: 5 }, { type: 'resume' }])
    assert.deepEqual(runtime.store.snapshot().teams.map(team => team.autopilot.wakes[0]?.status), ['delivered', 'delivered'])
    assert.deepEqual(runtime.store.snapshot().teams.map(team => team.autopilot.wakes[0]?.targetMaxGoalRounds), [5, 5])
  } finally {
    autopilot.close()
  }
})

test('an unrelated goal blocker revokes the grant and never edits or resumes the goal', async () => {
  const mod = await loadPlugin('non-round-blocker')
  const value = fixture({
    goalOverrides: { phase: 'blocked', activation: 'disarmed', blockedReason: { code: 'approval', message: 'requires a person' } }
  })
  const { autopilot, runtime } = startAutopilot(mod, value)
  try {
    await autopilot.flush()
    assertStoppedWithoutGoalMutation(runtime)
    const grant = runtime.store.snapshot().teams[0].autopilot
    assert.equal(grant.status, 'revoked')
    assert.match(grant.revokeReason, /goal entered blocked/u)
  } finally {
    autopilot.close()
  }
})

test('a finite Host budget N never raises the cap by more than N and becomes exhausted', async () => {
  const mod = await loadPlugin('bounded-budget')
  const value = fixture({
    budget: 2,
    goalOverrides: { phase: 'blocked', activation: 'disarmed', blockedReason: { code: 'round-limit', message: 'slice exhausted' } }
  })
  const { autopilot, runtime } = startAutopilot(mod, value)
  try {
    runtime.store.publish(submitTask(runtime.store.snapshot()))
    await autopilot.flush()
    assert.equal(runtime.getGoal().maxGoalRounds, 5)

    runtime.setGoal({ roundsStarted: 5, phase: 'active', activation: 'armed', blockedReason: undefined })
    runtime.store.publish(returnTaskToProducer(runtime.store.snapshot()))
    await autopilot.flush()
    assert.equal(runtime.getGoal().maxGoalRounds, 5, 'a real producer-owned wait clears the prior action without spending budget')

    runtime.setGoal({
      phase: 'blocked',
      activation: 'disarmed',
      blockedReason: { code: 'round-limit', message: 'second slice exhausted' }
    })
    runtime.store.publish(submitTask(runtime.store.snapshot()))
    await autopilot.flush()
    assert.equal(runtime.getGoal().maxGoalRounds, 6, 're-entering the action after a real wait may grant one new round')

    runtime.setGoal({
      roundsStarted: 6,
      phase: 'blocked',
      activation: 'disarmed',
      blockedReason: { code: 'round-limit', message: 'budget exhausted' }
    })
    runtime.emit('agent/status', { agent: value.root, status: 'idle' })
    await autopilot.flush()

    assert.deepEqual(runtime.effects.filter(effect => effect.type === 'edit').map(effect => effect.target), [5, 6])
    assert.equal(runtime.attempts.resume, 2)
    assert.equal(runtime.getGoal().maxGoalRounds, 6, 'base cap 4 plus budget 2 is a hard upper bound')
    const grant = runtime.store.snapshot().teams[0].autopilot
    assert.equal(grant.status, 'exhausted')
    assert.equal(grant.additionalRoundsGranted, 2)
    assert.equal(grant.expectedMaxGoalRounds, 6)
    assert.match(grant.revokeReason, /budget exhausted/u)
  } finally {
    autopilot.close()
  }
})

test('a non-admitted automatic recommit is side-effect free and the next exact Goal round reuses the intact grant and wake', async () => {
  const mod = await loadPlugin('non-admitted-recommit-preserves-grant')
  const value = fixture({ rootStatus: 'running', budget: 2 })
  value.root.session.events = [
    { type: 'turn/start', id: 'member-relay-turn', time: NOW, data: {} },
    { type: 'user/message', data: { source: { kind: 'agent-message', form: 'relay' } } }
  ]
  const runtime = fakeRuntime(value.root, value.document, value.goal)
  const draft = runtime.store.snapshot()
  const team = draft.teams[0]
  const originalGrantId = team.autopilot.grantId
  const originalPlanHash = team.autopilot.planHashAtGrant
  const deliveredWake = {
    key: 'preserved-goal-wake',
    kind: 'dispatch_work',
    status: 'delivered',
    stateHash: 'b'.repeat(64),
    teamRevision: team.revision,
    goalRevision: value.goal.revision,
    roundsStarted: value.goal.roundsStarted,
    targetMaxGoalRounds: value.goal.maxGoalRounds,
    preparedAt: NOW,
    deliveredAt: NOW
  }
  team.autopilot.wakes.push(deliveredWake)
  team.autopilot.lastStateHash = deliveredWake.stateHash
  team.objective = 'Deliver the safely redrafted workstream after the admitted wake'
  team.plan.phase = 'draft'
  team.plan.revision += 1
  team.plan.hash = planHash(team)
  delete team.plan.committedAt
  delete team.plan.activatedAt
  delete team.plan.authorization
  runtime.store.publish(draft)

  const beforeRejectedAttempt = runtime.store.snapshot()
  await assert.rejects(
    mod.commitTeamPlan(runtime.ctx, runtime.store, value.root, {
      teamId: team.id,
      expectedRevision: team.plan.revision,
      confirmedPlanHash: team.plan.hash,
      automaticContinuation: true,
      automaticGoalRoundAuthority: undefined,
      authorizationProvider: runtime.authorizationProvider
    }),
    error => error?.code === 'AGENT_TEAMS_DIRECT_HUMAN_REQUIRED'
  )
  assert.deepEqual(runtime.store.snapshot(), beforeRejectedAttempt, 'missing admission must not write any durable state')
  assert.deepEqual(runtime.effects, [], 'missing admission must not disarm, edit, or resume the Goal')
  assert.equal(runtime.attempts.revoke, 0, 'missing admission must not rotate Host authorization')

  value.root.session.events.push(
    { type: 'turn/end', data: {} },
    { type: 'turn/start', id: 'next-exact-goal-turn', time: NOW, data: {} },
    { type: 'user/message', data: { source: { kind: 'goal', goalId: value.goal.id, revision: value.goal.revision, round: value.goal.roundsStarted } } }
  )
  const authority = mod.exactGoalRoundRootAuthority(runtime.ctx, { agent: value.root, turnKey: 'next-exact-goal-turn-key' })
  assert.ok(authority)
  const committed = await mod.commitTeamPlan(runtime.ctx, runtime.store, value.root, {
    teamId: team.id,
    expectedRevision: team.plan.revision,
    confirmedPlanHash: team.plan.hash,
    automaticContinuation: true,
    automaticGoalRoundAuthority: authority,
    authorizationProvider: runtime.authorizationProvider
  })
  const rebound = runtime.store.snapshot().teams[0]
  assert.equal(committed.plan.phase, 'active')
  assert.equal(rebound.autopilot.status, 'active')
  assert.equal(rebound.autopilot.grantId, originalGrantId, 'recommit reuses rather than widens the standing grant')
  assert.notEqual(rebound.autopilot.planHashAtGrant, originalPlanHash)
  assert.equal(rebound.autopilot.planHashAtGrant, committed.plan.hash)
  assert.deepEqual(rebound.autopilot.wakes, [deliveredWake], 'the already-admitted wake survives the rejected ordinary turn')
})

test('admitted recommit safety failures still revoke live grants for scope Stop capability and effect risks', async t => {
  const mod = await loadPlugin('admitted-recommit-revocation-boundaries')
  const cases = [
    ['project scope changed', ({ value }) => { value.root.session.header.cwd = path.join(value.root.session.header.cwd, 'other-project') }, 'AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN'],
    ['Stop pause state', ({ draft }) => { draft.teams[0].state = 'paused' }, 'AGENT_TEAMS_PAUSED'],
    ['pause epoch changed', ({ draft }) => { draft.teams[0].pauseEpoch += 1 }, 'AGENT_TEAMS_AUTOPILOT_SCOPE_CHANGED'],
    ['capability became unknown', ({ draft }) => { draft.teams[0].tasks[0].capabilities.push({ name: 'extra-workspace', status: 'unknown', source: 'not provided by Host' }) }, 'AGENT_TEAMS_CAPABILITY_UNKNOWN'],
    ['effect requires confirmation', ({ draft }) => { draft.teams[0].tasks[0].externalEffects[0].policy = 'confirm_each' }, 'AGENT_TEAMS_EXTERNAL_EFFECT_CONFIRMATION_REQUIRED']
  ]
  for (const [name, mutateRisk, expectedCode] of cases) await t.test(name, async () => {
    const value = fixture({ rootStatus: 'running', budget: 2 })
    const runtime = fakeRuntime(value.root, value.document, value.goal)
    const authority = mod.exactGoalRoundRootAuthority(runtime.ctx, { agent: value.root, turnKey: `risk-${name}` })
    assert.ok(authority)
    const draft = runtime.store.snapshot()
    const team = draft.teams[0]
    team.objective = `Redraft before ${name}`
    team.plan.phase = 'draft'
    team.plan.revision += 1
    delete team.plan.committedAt
    delete team.plan.activatedAt
    delete team.plan.authorization
    mutateRisk({ value, draft })
    team.plan.hash = planHash(team)
    runtime.store.publish(draft)

    await assert.rejects(
      mod.commitTeamPlan(runtime.ctx, runtime.store, value.root, {
        teamId: team.id,
        expectedRevision: team.plan.revision,
        confirmedPlanHash: team.plan.hash,
        automaticContinuation: true,
        automaticGoalRoundAuthority: authority,
        authorizationProvider: runtime.authorizationProvider
      }),
      error => error?.code === expectedCode
    )
    assert.equal(runtime.store.snapshot().teams[0].autopilot.status, 'revoked')
    assert.equal(runtime.attempts.revoke, 1, 'a genuine admitted-round safety failure still rotates Host authorization')
    assert.equal(runtime.getGoal().activation, 'disarmed')
  })
})

test('an exact automatic Goal-round recommit atomically rebinds the grant and the scheduler completes the next worker wake', async () => {
  const mod = await loadPlugin('automatic-recommit-scheduler')
  const value = fixture({ rootStatus: 'running', budget: 2 })
  const runtime = fakeRuntime(value.root, value.document, value.goal)
  const draft = runtime.store.snapshot()
  const team = draft.teams[0]
  const oldPlanHash = team.autopilot.planHashAtGrant
  team.objective = 'Deliver the safely recommitted workstream'
  team.plan.phase = 'draft'
  team.plan.revision += 1
  team.plan.hash = planHash(team)
  delete team.plan.committedAt
  delete team.plan.activatedAt
  delete team.plan.authorization
  runtime.store.publish(draft)
  const execution = { agent: value.root, events: value.root.session.events, turnKey: 'exact-automatic-recommit-turn' }
  const authority = mod.exactGoalRoundRootAuthority(runtime.ctx, execution)
  assert.ok(authority)

  const committed = await mod.commitTeamPlan(runtime.ctx, runtime.store, value.root, {
    teamId: team.id,
    expectedRevision: team.plan.revision,
    confirmedPlanHash: team.plan.hash,
    automaticContinuation: true,
    automaticGoalRoundAuthority: authority,
    authorizationProvider: runtime.authorizationProvider
  })
  const rebound = runtime.store.snapshot().teams[0]
  assert.equal(committed.plan.phase, 'active')
  assert.notEqual(committed.plan.hash, oldPlanHash)
  assert.equal(rebound.autopilot.status, 'active')
  assert.equal(rebound.autopilot.planHashAtGrant, committed.plan.hash, 'the exact new plan and grant bind in one store transaction')
  assert.equal(rebound.autopilot.lastStateHash, undefined)

  value.root.status = 'idle'
  const autopilot = mod.createAgentTeamAutopilot(runtime.ctx, runtime.store, pendingReady(), runtime.authorizationProvider)
  try {
    await autopilot.flush()
    assert.equal(runtime.getGoal().activation, 'disarmed', 'safe producer-owned work parks without asking the user to continue')
    assert.equal(runtime.store.snapshot().teams[0].autopilot.status, 'active')

    runtime.setGoal({
      phase: 'blocked', activation: 'disarmed', roundsStarted: 4,
      blockedReason: { code: 'round-limit', message: 'recommitted slice exhausted' }
    })
    runtime.store.publish(submitTask(runtime.store.snapshot()))
    await autopilot.flush()
    assert.deepEqual(runtime.effects.filter(effect => ['edit', 'resume'].includes(effect.type)), [{ type: 'edit', target: 5 }, { type: 'resume' }])
    assert.equal(runtime.store.snapshot().teams[0].autopilot.status, 'active', 'the next reconcile uses the rebound hash instead of revoking it')
    assert.equal(runtime.store.snapshot().teams[0].autopilot.wakes.at(-1).status, 'delivered')
  } finally {
    autopilot.close()
  }
})

test('settings, Stop, scope, goal, plan, and safety changes revoke before any automatic goal effect', async t => {
  const mod = await loadPlugin('revocation-boundaries')
  const cases = [
    ['Host setting disabled', ({ document }) => { document.settings.autopilotEnabled = false }],
    ['Host budget lowered', ({ document }) => { document.settings.autopilotMaxAdditionalRounds = 1 }],
    ['Host authorization epoch changed', ({ runtime }) => { runtime.setAuthorizationEpoch('b'.repeat(32)) }],
    ['legacy grant lacks a Host authorization epoch', ({ document }) => { delete document.teams[0].autopilot.authorizationEpoch }],
    ['team Stop state', ({ document }) => { document.teams[0].state = 'paused' }],
    ['pause epoch advanced', ({ document }) => { document.teams[0].pauseEpoch += 1 }],
    ['project scope changed', ({ root }) => { root.session.header.cwd = path.resolve('C:/workspace/another-project') }],
    ['goal identity changed', ({ runtime }) => { runtime.setGoal({ id: 'another-goal' }) }],
    ['goal objective changed', ({ runtime }) => { runtime.setGoal({ objective: 'A materially different objective' }) }],
    ['goal cap lowered outside the grant', ({ runtime }) => { runtime.setGoal({ maxGoalRounds: 3, roundsStarted: 3 }) }],
    ['plan changed', ({ document }) => {
      document.teams[0].objective = 'A changed team plan'
      refreshPlan(document.teams[0])
    }],
    ['safety outcome became unknown', ({ document }) => {
      document.teams[0].tasks[0].externalEffects[0].outcome = 'outcome_unknown'
    }]
  ]
  for (const [label, mutate] of cases) await t.test(label, async () => {
    const value = fixture({ budget: 2 })
    const { autopilot, runtime } = startAutopilot(mod, value)
    try {
      const document = runtime.store.snapshot()
      mutate({ document, root: value.root, runtime })
      if (JSON.stringify(document) !== JSON.stringify(runtime.store.snapshot())) runtime.store.publish(document)
      await autopilot.flush()
      assertStoppedWithoutGoalMutation(runtime)
      const grant = runtime.store.snapshot().teams[0].autopilot
      assert.equal(grant.status, 'revoked')
      assert.equal(typeof grant.revokeReason, 'string')
      if (label === 'Host setting disabled' || label === 'plan changed') {
        assert.equal(runtime.getGoal().activation, 'disarmed', `${label} must remove the exact armed Goal authority before durable revocation`)
        assert.equal(runtime.attempts.disarm, 1)
      }
    } finally {
      autopilot.close()
    }
  })
})

test('Stop and shutdown disarm the exact bound Goal before revoking authority or changing team state', async t => {
  const mod = await loadPlugin('deactivate-before-close')
  for (const operation of ['Stop', 'shutdown']) await t.test(operation, async () => {
    const value = fixture()
    const observations = []
    const runtime = fakeRuntime(value.root, value.document, value.goal, {
      onDisarm(document, goal) {
        observations.push({ teamState: document.teams[0].state, grantStatus: document.teams[0].autopilot.status, goalActivation: goal.activation })
      }
    })
    if (operation === 'Stop') {
      await mod.pauseTeamsForUserStop(runtime.ctx, runtime.store, value.root, [{ teamId: value.document.teams[0].id, childIds: ['worker-1'] }], NOW, runtime.authorizationProvider)
      assert.equal(runtime.store.snapshot().teams[0].state, 'paused')
    } else {
      const result = await mod.shutdownTeam(runtime.ctx, runtime.store, undefined, value.root, { teamId: value.document.teams[0].id, force: true }, undefined, runtime.authorizationProvider)
      assert.equal(result.team.state, 'closed')
    }
    assert.deepEqual(observations, [{ teamState: 'active', grantStatus: 'active', goalActivation: 'armed' }])
    assert.equal(runtime.getGoal().activation, 'disarmed')
    assert.equal(runtime.attempts.revoke, 1, 'Desktop Host authorization epoch is rotated after Goal deactivation')
    assert.equal(runtime.store.snapshot().teams[0].autopilot.status, 'revoked')
  })
})

test('plugin lifecycle revokes persisted live grants locally while the global proof survives for a later direct-human boundary', async () => {
  const mod = await loadPlugin('lifecycle-revoke')
  const value = fixture({ teamCount: 2 })
  for (const team of value.document.teams) {
    team.autopilot.baseMaxGoalRounds = 3
    team.autopilot.additionalRoundsGranted = 1
  }
  const runtime = fakeRuntime(value.root, value.document, value.goal)
  const autopilot = mod.createAgentTeamAutopilot(runtime.ctx, runtime.store, Promise.resolve(runtime.store.snapshot()), runtime.authorizationProvider)
  try {
    await waitFor(() => runtime.store.snapshot().teams.every(team => team.autopilot.status === 'revoked'), 'lifecycle initialization did not revoke persisted grants')
    await autopilot.flush()
    assertStoppedWithoutGoalMutation(runtime)
    assert.equal(runtime.getGoal().activation, 'disarmed', 'lifecycle restart cannot leave the persisted grant Goal armed')
    assert.equal(runtime.attempts.disarm, 1)
    assert.equal(runtime.attempts.revoke, 0, 'lifecycle cleanup must not erase the durable global settings proof')
    for (const team of runtime.store.snapshot().teams) {
      assert.match(team.autopilot.revokeReason, /lifecycle restart/u)
    }

    runtime.setGoal({ phase: 'active', activation: 'armed' })
    value.root.session.events = [
      { type: 'turn/start', id: 'post-lifecycle-direct-human-turn', time: NOW, data: {} },
      { type: 'user/message', data: { source: { kind: 'user' } } }
    ]
    const intent = await mod.exactDirectHumanAutopilotGrantIntent(runtime.ctx, runtime.authorizationProvider, { agent: value.root, events: value.root.session.events })
    assert.ok(intent, 'the persisted global Host proof must remain readable after lifecycle cleanup')
    const selected = runtime.store.snapshot().teams[0]
    await mod.commitTeamPlan(runtime.ctx, runtime.store, value.root, {
      teamId: selected.id,
      expectedRevision: selected.plan.revision,
      confirmedPlanHash: selected.plan.hash,
      automaticContinuation: false,
      autopilotGoal: runtime.getGoal(),
      directHumanGrantIntent: intent,
      authorizationProvider: runtime.authorizationProvider
    })
    assert.deepEqual(runtime.store.snapshot().teams.map(team => ({ status: team.autopilot.status, reason: team.autopilot.revokeReason })), [{ status: 'active', reason: undefined }, { status: 'active', reason: undefined }])
    assert.equal(new Set(runtime.store.snapshot().teams.map(team => team.autopilot.authorizationEpoch)).size, 1)
    assert.deepEqual(runtime.store.snapshot().teams.map(team => team.autopilot.additionalRoundsGranted), [1, 1], 'lifecycle re-derivation preserves the fixed per-Goal budget already consumed')
    assert.deepEqual(runtime.store.snapshot().teams.map(team => team.autopilot.baseMaxGoalRounds), [3, 3])
    assert.equal(runtime.attempts.revoke, 0)
  } finally {
    autopilot.close()
  }
})

test('direct-human team creation repairs a complete safe lifecycle-revoked root group from the global proof', async () => {
  const mod = await loadPlugin('direct-human-creation-group-repair')
  const value = fixture({ teamCount: 2, rootStatus: 'running' })
  value.root.session.events = [
    { type: 'turn/start', id: 'direct-human-create-after-restart', time: NOW, data: {} },
    { type: 'user/message', data: { source: { kind: 'user' } } }
  ]
  const runtime = fakeRuntime(value.root, value.document, value.goal)
  const intent = await mod.exactDirectHumanAutopilotGrantIntent(runtime.ctx, runtime.authorizationProvider, { agent: value.root, events: value.root.session.events })
  assert.ok(intent)
  for (const team of runtime.store.document.teams) {
    team.autopilot.status = 'revoked'
    team.autopilot.revokedAt = NOW
    team.autopilot.revokeReason = 'plugin or session lifecycle restart requires fresh direct-human continuation authority'
  }
  const routingReceiptId = 'direct-human-create-after-restart-receipt'
  runtime.store.document.routingReceipts.push({
    id: routingReceiptId,
    rootSessionId: value.root.id,
    turnKey: intent.turnKey,
    projectKey: projectKey(value.root.session.header.cwd),
    level: 'level3',
    reasonCategory: 'explicit_user_team_request',
    explicitUserTeamRequest: true,
    candidateWorkstreams: 2,
    creationPath: 'team_start',
    outcome: 'recorded',
    decisionAuthority: 'model_declared',
    establishmentAuthority: 'direct_human',
    createdAt: NOW
  })
  const created = await mod.createTeam(runtime.store, value.root, {
    requestId: 'create-after-lifecycle',
    objective: 'Create another safe workstream',
    routingReceiptId,
    autopilotGoal: runtime.getGoal(),
    directHumanGrantIntent: intent
  })
  const teams = runtime.store.snapshot().teams
  assert.equal(created.id, teams[2].id)
  assert.deepEqual(teams.map(team => team.autopilot.status), ['active', 'active', 'pending_plan'])
  assert.deepEqual(teams.map(team => team.autopilot.authorizationEpoch), [AUTHORIZATION_EPOCH, AUTHORIZATION_EPOCH, AUTHORIZATION_EPOCH])
  assert.equal(teams[2].autopilot.routingReceiptId, routingReceiptId)
  assert.equal(new Set(teams.map(team => team.autopilot.grantId)).size, 3)
})

test('an incomplete or divergent multi-team wake ledger fails closed', async t => {
  const mod = await loadPlugin('wake-ledger-fail-closed')
  for (const mode of ['missing-copy', 'divergent-copy']) await t.test(mode, async () => {
    const value = fixture({
      teamCount: 2,
      goalOverrides: { phase: 'blocked', activation: 'disarmed', blockedReason: { code: 'round-limit', message: 'slice exhausted' } }
    })
    submitTask(value.document, 0)
    const wakeKey = hash(['wake', mode])
    const wake = {
      key: wakeKey,
      kind: 'review_submission',
      stateHash: 'a'.repeat(64),
      roundsStarted: 4,
      status: 'prepared',
      teamRevision: value.document.teams[0].revision,
      targetMaxGoalRounds: 5,
      createdAt: NOW
    }
    for (const team of value.document.teams) {
      team.autopilot.additionalRoundsGranted = 1
      team.autopilot.expectedMaxGoalRounds = 5
      team.autopilot.wakes = [structuredClone(wake)]
    }
    value.document.teams[1].autopilot.wakes[0].teamRevision = value.document.teams[1].revision
    if (mode === 'missing-copy') value.document.teams[1].autopilot.wakes = []
    else value.document.teams[1].autopilot.wakes[0].stateHash = 'b'.repeat(64)

    const { autopilot, runtime } = startAutopilot(mod, value)
    try {
      await autopilot.flush()
      assertStoppedWithoutGoalMutation(runtime)
      const grants = runtime.store.snapshot().teams.map(team => team.autopilot)
      assert.deepEqual(grants.map(grant => grant.status), ['revoked', 'revoked'])
      assert.equal(new Set(grants.map(grant => grant.revokeReason)).size, 1, 'the whole fixed-root grant group shares one fail-closed outcome')
      assert.match(grants[0].revokeReason, mode === 'missing-copy' ? /grant group|wake ledger/u : /wake ledger/u)
      assert.ok(grants.flatMap(grant => grant.wakes).every(entry => entry.status === 'cancelled'))
    } finally {
      autopilot.close()
    }
  })
})

test('missing trusted Host budget metadata can only revoke and can never edit the goal cap', async () => {
  const mod = await loadPlugin('missing-trusted-budget')
  const value = fixture({
    goalOverrides: { phase: 'blocked', activation: 'disarmed', blockedReason: { code: 'round-limit', message: 'slice exhausted' } }
  })
  delete value.document.settings.autopilotMaxAdditionalRounds
  submitTask(value.document)
  const { autopilot, runtime } = startAutopilot(mod, value)
  try {
    await autopilot.flush()
    assertStoppedWithoutGoalMutation(runtime)
    assert.equal(runtime.getGoal().maxGoalRounds, 4)
    assert.equal(runtime.store.snapshot().teams[0].autopilot.status, 'revoked')
  } finally {
    autopilot.close()
  }
})

test('wake classification remains transition-based and ignores checkpoints or duplicate projections', async () => {
  const mod = await loadPlugin('wake-classification')
  const baseline = fixture()
  const checkpoint = structuredClone(baseline.document)
  checkpoint.teams[0].tasks[0].checkpoint = {
    text: 'progress only', reportedAt: NOW, reportedBy: checkpoint.teams[0].tasks[0].assigneeSessionId,
    verified: false, claimId: checkpoint.teams[0].tasks[0].claimId, leaseEpoch: 0
  }
  assert.deepEqual(mod.agentTeamAutopilotWakeRoots(baseline.document, checkpoint), [])

  const expansion = structuredClone(baseline.document)
  expansion.teams[0].messages.push({
    id: 'expansion:' + 'e'.repeat(64), fromSessionId: expansion.teams[0].members[1].sessionId, toSessionId: baseline.root.id,
    body: 'structured expansion proposal', status: 'queued', queuedAt: NOW, createdAt: NOW,
    kind: 'expansion_request', dedupeKey: 'e'.repeat(64), expansionRequest: { id: 'expansion:' + 'e'.repeat(64) }
  })
  assert.deepEqual(mod.agentTeamAutopilotWakeRoots(baseline.document, expansion), [baseline.root.id], 'the first canonical proposal wakes the exact fixed root')
  const duplicateExpansion = structuredClone(expansion)
  duplicateExpansion.teams[0].messages.push({
    ...structuredClone(expansion.teams[0].messages.at(-1)), id: 'expansion-duplicate', expansionRequest: { id: 'expansion-duplicate' }
  })
  assert.deepEqual(mod.agentTeamAutopilotWakeRoots(expansion, duplicateExpansion), [], 'the same canonical proposal identity spends zero additional Goal rounds')

  const submitted = submitTask(structuredClone(baseline.document))
  assert.deepEqual(mod.agentTeamAutopilotWakeRoots(baseline.document, submitted), [baseline.root.id])
  assert.deepEqual(mod.agentTeamAutopilotWakeRoots(submitted, structuredClone(submitted)), [])

  const rootSubmitted = structuredClone(submitted)
  rootSubmitted.teams[0].tasks[0].submission.submittedBy = baseline.root.id
  assert.deepEqual(mod.agentTeamAutopilotWakeRoots(baseline.document, rootSubmitted), [], 'the exact root already owns its own submission result')

  const released = structuredClone(baseline.document)
  released.teams[0].tasks[0].state = 'pending'
  delete released.teams[0].tasks[0].claimId
  delete released.teams[0].tasks[0].claimedAt
  released.teams[0].members[1].state = 'ready'
  assert.deepEqual(mod.agentTeamAutopilotWakeRoots(baseline.document, released), [], 'release and ordinary ready/idle transitions do not spend a root round')

  const failed = structuredClone(baseline.document)
  failed.teams[0].members[1].state = 'failed'
  assert.deepEqual(mod.agentTeamAutopilotWakeRoots(baseline.document, failed), [baseline.root.id], 'a durable member failure wakes the exact fixed root')

  const blocked = submitTask(structuredClone(baseline.document))
  const dependent = makeTask(2, blocked.teams[0].members[1].sessionId, { state: 'pending' })
  dependent.dependsOn = [blocked.teams[0].tasks[0].id]
  blocked.teams[0].tasks.push(dependent)
  const dependencyChanged = structuredClone(blocked)
  const blocker = dependencyChanged.teams[0].tasks[0]
  blocker.state = 'completed'
  blocker.acceptance = { taskId: blocker.id, claimId: blocker.claimId, leaseEpoch: blocker.leaseEpoch, acceptedAt: NOW, acceptedBy: baseline.root.id }
  assert.deepEqual(mod.agentTeamAutopilotWakeRoots(blocked, dependencyChanged), [baseline.root.id], 'a durable dependency transition wakes the dependent root')
})

test('one global Host proof lets a direct-human plan commit rebind the complete live root group', async () => {
  const mod = await loadPlugin('direct-human-group-rebind')
  const value = fixture({ teamCount: 2, rootStatus: 'running', budget: 2 })
  value.root.session.events = [
    { type: 'turn/start', id: 'direct-human-plan-turn', time: NOW, data: {} },
    { type: 'user/message', data: { source: { kind: 'user' } } }
  ]
  const runtime = fakeRuntime(value.root, value.document, value.goal)
  const draft = runtime.store.snapshot()
  const selected = draft.teams[0]
  const grantIds = draft.teams.map(team => team.autopilot.grantId)
  for (const team of draft.teams) team.autopilot.lastStateHash = 'c'.repeat(64)
  selected.objective = 'Commit the safe direct-human revision without another settings Save'
  selected.plan.phase = 'draft'
  selected.plan.revision += 1
  selected.plan.hash = planHash(selected)
  delete selected.plan.committedAt
  delete selected.plan.activatedAt
  delete selected.plan.authorization
  runtime.store.publish(draft)
  const execution = { agent: value.root, events: value.root.session.events }
  const intent = await mod.exactDirectHumanAutopilotGrantIntent(runtime.ctx, runtime.authorizationProvider, execution)
  assert.ok(intent)

  const committed = await mod.commitTeamPlan(runtime.ctx, runtime.store, value.root, {
    teamId: selected.id,
    expectedRevision: selected.plan.revision,
    confirmedPlanHash: selected.plan.hash,
    automaticContinuation: false,
    autopilotGoal: runtime.getGoal(),
    directHumanGrantIntent: intent,
    authorizationProvider: runtime.authorizationProvider
  })
  const rebound = runtime.store.snapshot().teams
  assert.equal(committed.plan.phase, 'active')
  assert.deepEqual(rebound.map(team => team.autopilot.grantId), grantIds, 'a safe recommit preserves rather than widens live grants')
  assert.deepEqual(rebound.map(team => team.autopilot.status), ['active', 'active'])
  assert.equal(rebound[0].autopilot.planHashAtGrant, committed.plan.hash)
  assert.equal(rebound[1].autopilot.planHashAtGrant, rebound[1].plan.hash)
  assert.deepEqual(rebound.map(team => team.autopilot.lastStateHash), [undefined, undefined], 'the whole root group resets one shared action boundary')
  assert.equal(runtime.attempts.revoke, 0)
})

test('a direct-human plan boundary derives missing safe root grants but never revives a terminal safety grant', async t => {
  const mod = await loadPlugin('direct-human-global-default')
  for (const mode of ['missing', 'revoked', 'stale-agent-message']) await t.test(mode, async () => {
    const value = fixture({ teamCount: 2, rootStatus: 'running', withGrant: mode === 'revoked', budget: 2 })
    value.root.session.events = [
      { type: 'turn/start', id: `direct-human-${mode}-turn`, time: NOW, data: {} },
      { type: 'user/message', data: { source: { kind: 'user' } } }
    ]
    if (mode === 'revoked') for (const team of value.document.teams) {
      team.autopilot.status = 'revoked'
      team.autopilot.revokedAt = NOW
      team.autopilot.revokeReason = 'trusted Host autopilot authorization epoch changed'
    }
    const runtime = fakeRuntime(value.root, value.document, value.goal)
    const execution = { agent: value.root, events: value.root.session.events }
    const intent = await mod.exactDirectHumanAutopilotGrantIntent(runtime.ctx, runtime.authorizationProvider, execution)
    if (mode === 'stale-agent-message') value.root.session.events = [
      { type: 'turn/start', id: 'later-agent-message-turn', time: NOW, data: {} },
      { type: 'user/message', data: { source: { kind: 'agent' } } }
    ]
    const selected = runtime.store.snapshot().teams[0]
    await mod.commitTeamPlan(runtime.ctx, runtime.store, value.root, {
      teamId: selected.id,
      expectedRevision: selected.plan.revision,
      confirmedPlanHash: selected.plan.hash,
      automaticContinuation: false,
      autopilotGoal: runtime.getGoal(),
      directHumanGrantIntent: intent,
      authorizationProvider: runtime.authorizationProvider
    })
    const grants = runtime.store.snapshot().teams.map(team => team.autopilot)
    if (mode === 'missing') {
      assert.deepEqual(grants.map(grant => grant.status), ['active', 'active'])
      assert.equal(new Set(grants.map(grant => grant.authorizationEpoch)).size, 1)
      assert.equal(new Set(grants.map(grant => grant.grantId)).size, 2)
      assert.deepEqual(grants.map(grant => grant.planHashAtGrant), runtime.store.snapshot().teams.map(team => team.plan.hash))
    } else if (mode === 'revoked') {
      assert.deepEqual(grants.map(grant => grant.status), ['revoked', 'revoked'], 'a current Host proof does not erase a true terminal revocation at plan commit')
      assert.deepEqual(grants.map(grant => grant.revokeReason), ['trusted Host autopilot authorization epoch changed', 'trusted Host autopilot authorization epoch changed'])
    } else {
      assert.deepEqual(grants, [undefined, undefined], 'a stale intent cannot cross into a later agent-message turn')
    }
    assert.equal(runtime.attempts.revoke, 0)
  })
})

test('two-phase direct-human Resume may derive the stopped team only from the current global Host proof', async () => {
  const mod = await loadPlugin('direct-human-resume-derivation')
  const value = fixture({ rootStatus: 'running', budget: 2 })
  value.root.session.events = [
    { type: 'turn/start', id: 'direct-human-resume-turn', time: NOW, data: {} },
    { type: 'user/message', data: { source: { kind: 'user' } } }
  ]
  const stopped = value.document.teams[0]
  const oldGrantId = stopped.autopilot.grantId
  stopped.state = 'paused'
  stopped.pauseEpoch = 1
  stopped.members[1].state = 'ready'
  stopped.autopilot.status = 'revoked'
  stopped.autopilot.baseMaxGoalRounds = 3
  stopped.autopilot.additionalRoundsGranted = 1
  stopped.autopilot.revokedAt = NOW
  stopped.autopilot.revokeReason = 'explicit user Stop requires fresh direct-human continuation authority'
  const resumedAuthorizationEpoch = 'r'.repeat(32)
  const runtime = fakeRuntime(value.root, value.document, value.goal, { authorizationEpoch: resumedAuthorizationEpoch })
  const execution = { agent: value.root, events: value.root.session.events }
  const intent = await mod.exactDirectHumanAutopilotGrantIntent(runtime.ctx, runtime.authorizationProvider, execution)
  assert.ok(intent)
  const preview = await mod.resumePausedTeam(runtime.ctx, runtime.store, value.root, { teamId: stopped.id, requestId: 'resume-global-default' })
  const committed = await mod.resumePausedTeam(runtime.ctx, runtime.store, value.root, {
    teamId: stopped.id,
    requestId: preview.preview.requestId,
    commit: true,
    previewId: preview.preview.previewId,
    expectedPauseEpoch: preview.preview.pauseEpoch,
    expectedTeamRevision: preview.preview.teamRevision,
    autopilotGoal: runtime.getGoal(),
    directHumanGrantIntent: intent
  })
  const resumed = runtime.store.snapshot().teams[0]
  assert.equal(committed.phase, 'active')
  assert.equal(resumed.autopilot.status, 'active')
  assert.notEqual(resumed.autopilot.grantId, oldGrantId)
  assert.equal(resumed.autopilot.authorizationEpoch, resumedAuthorizationEpoch)
  assert.equal(resumed.autopilot.additionalRoundsGranted, 1, 'Stop recovery cannot reset the fixed per-Goal budget')
  assert.equal(resumed.autopilot.baseMaxGoalRounds, 3)
  assert.equal(resumed.autopilot.pauseEpochAtGrant, 1)
  assert.equal(resumed.autopilot.planHashAtGrant, resumed.plan.hash)
  assert.equal(resumed.autopilot.revokeReason, undefined)
  assert.deepEqual(runtime.effects, [], 'team Resume never manufactures a Goal wake')
})

test('model contract describes Host-bounded event-driven waiting without asking for continue', async () => {
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /Agent Team waiting is event-driven/u)
  assert.match(source, /trusted Host automatic-continuation preference is ON/u)
  assert.match(source, /without asking the user to send ‘continue’/u)
  assert.match(source, /parks normal waiting; it is not a blocked Goal outcome/u)
  assert.match(source, /Only a new claim-bound durable task submission, a worker transition to failed, or a durable dependency\/reference\/satisfaction change wakes/u)
  assert.match(source, /Worker release, ready\/idle transitions, checkpoints, and duplicate projections do not spend a round/u)
  assert.match(source, /grants exactly one additional round for that durable transition/u)
  assert.match(source, /real safety blockers, permission anomalies.*require manual recovery/u)
  assert.match(source, /finite budget remain stopped/u)
})
