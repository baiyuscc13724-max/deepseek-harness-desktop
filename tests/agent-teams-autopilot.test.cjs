const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { readFile } = require('node:fs/promises')
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
  const normalized = cwd.trim().replace(/\\/gu, '/').replace(/\/+$/u, '').normalize('NFKC')
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
  constructor(document, { notifyMutations = true } = {}) {
    this.document = structuredClone(document)
    this.listeners = new Set()
    this.notifyMutations = notifyMutations
    this.mutationFailures = []
    this.filePath = `agent-teams-autopilot-fixture-${++fakeStoreIndex}.json`
  }

  snapshot() {
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
    this.#notify()
  }

  failNextMutation(error = new Error('injected durable mutation failure')) {
    this.mutationFailures.push(error)
  }

  async mutate(mutator) {
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
    if (this.notifyMutations) this.#notify()
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
  const store = new FakeStore(document, { notifyMutations })
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

test('default, legacy, opted-out, and missing-grant stores never acquire automatic goal authority', async t => {
  const mod = await loadPlugin('no-implicit-grant')
  const cases = [
    ['default-off v8', fixture({ withGrant: false, autopilotEnabled: false })],
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

test('a safe live grant parks and disarms an exact armed goal while workers own all progress', async () => {
  const mod = await loadPlugin('park-live-grant')
  const value = fixture()
  assert.equal(mod.rootCanAutonomouslyWait(value.document, value.root), true)
  const markersAtDisarm = []
  const { autopilot, runtime } = startAutopilot(mod, value, {
    onDisarm(document) { markersAtDisarm.push(document.teams[0].autopilot.parkedGoalRevision) }
  })
  try {
    await autopilot.flush()
    assert.deepEqual(goalEffects(runtime), ['disarm'])
    assert.deepEqual(markersAtDisarm, [undefined], 'the process-local Goal is synchronously disarmed before any durable parked marker')
    assert.equal(runtime.getGoal().activation, 'disarmed')
    const parked = runtime.store.snapshot().teams[0].autopilot
    assert.equal(parked.status, 'active')
    assert.equal(parked.parkedGoalRevision, value.goal.revision)
    assert.equal(typeof parked.parkedAt, 'string')

    await autopilot.flush()
    assert.deepEqual(goalEffects(runtime), ['disarm'], 'the parked projection is not disarmed twice')
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

test('plugin lifecycle ready revokes every persisted live grant before first reconciliation', async () => {
  const mod = await loadPlugin('lifecycle-revoke')
  const value = fixture({ teamCount: 2 })
  const runtime = fakeRuntime(value.root, value.document, value.goal)
  const autopilot = mod.createAgentTeamAutopilot(runtime.ctx, runtime.store, Promise.resolve(runtime.store.snapshot()), runtime.authorizationProvider)
  try {
    await waitFor(() => runtime.store.snapshot().teams.every(team => team.autopilot.status === 'revoked'), 'lifecycle initialization did not revoke persisted grants')
    await autopilot.flush()
    assertStoppedWithoutGoalMutation(runtime)
    assert.equal(runtime.getGoal().activation, 'disarmed', 'lifecycle restart cannot leave the persisted grant Goal armed')
    assert.equal(runtime.attempts.disarm, 1)
    for (const team of runtime.store.snapshot().teams) {
      assert.match(team.autopilot.revokeReason, /lifecycle restart/u)
    }
  } finally {
    autopilot.close()
  }
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
