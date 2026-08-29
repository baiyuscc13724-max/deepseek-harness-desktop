const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')

async function loadPlugin(label) {
  return import(`${pathToFileURL(pluginFile).href}?${label}=${Date.now()}-${Math.random()}`)
}

function timestamp(offset = 0) {
  return new Date(Date.parse('2026-08-27T12:00:00.000Z') + offset).toISOString()
}

function legacyTeam({ id, state = 'active', tasks = [] }) {
  return {
    id,
    rootLeadSessionId: `${id}-lead`,
    name: id,
    objective: `Preserve ${id}`,
    revision: 9,
    state,
    createdAt: timestamp(),
    updatedAt: timestamp(1_000),
    members: [{
      id: `${id}-lead-record`,
      sessionId: `${id}-lead`,
      name: 'Lead',
      role: 'root lead and coordinator',
      kind: 'lead',
      state: state === 'closed' ? 'retired' : 'ready',
      createdAt: timestamp(),
      updatedAt: timestamp(1_000)
    }],
    tasks,
    messages: []
  }
}

function legacyTask(id, state, extras = {}) {
  return {
    id,
    title: id,
    state,
    dependsOn: [],
    files: [`src/${id}.js`],
    createdAt: timestamp(),
    updatedAt: timestamp(1_000),
    ...(state === 'in_progress' ? { assigneeSessionId: 'active-lead', claimedAt: timestamp(500) } : {}),
    ...(state === 'completed' ? { completedAt: timestamp(800) } : {}),
    ...(state === 'cancelled' ? { cancelledAt: timestamp(800), cancellationReason: 'legacy cancellation' } : {}),
    ...extras
  }
}

test('v4 migration preserves empty and active teams while adding conservative planning defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-plan-migration-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const mod = await loadPlugin('planning-migration')
  const originalTasks = [
    legacyTask('pending', 'pending'),
    legacyTask('running', 'in_progress', { assigneeSessionId: 'active-lead' }),
    legacyTask('done', 'completed'),
    legacyTask('cancelled', 'cancelled')
  ]
  const legacy = {
    version: 4,
    settings: { enabled: true, maxMembers: 4, maxActiveTurns: 3 },
    teams: [legacyTeam({ id: 'empty' }), legacyTeam({ id: 'active', tasks: originalTasks })]
  }
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
    const store = new mod.AgentTeamsStore(file)
    await store.init()
    const migrated = JSON.parse(await readFile(file, 'utf8'))

    assert.equal(migrated.version, 6)
    assert.deepEqual(migrated.teams.map(team => team.id), ['empty', 'active'])
    assert.deepEqual(migrated.teams[1].tasks.map(task => [task.id, task.state]), originalTasks.map(task => [task.id, task.state]))
    for (const team of migrated.teams) {
      assert.equal(team.pauseEpoch, 0)
      assert.equal(team.plan.revision, 1)
      assert.match(team.plan.hash, /^[a-f0-9]{64}$/u)
    }
    assert.equal(migrated.teams[0].plan.phase, 'draft')
    assert.equal(migrated.teams[0].plan.migrationState, 'legacy_unplanned')
    assert.equal(migrated.teams[0].plan.authorization, undefined)
    assert.equal(migrated.teams[1].plan.phase, 'active', 'legacy in-flight work is not interrupted by migration')
    assert.equal(migrated.teams[1].plan.migrationState, 'legacy_active_gate')
    assert.equal(migrated.teams[1].plan.authorization.source, 'unknown')
    assert.deepEqual(
      [migrated.teams[1].plan.authorization.permissions, migrated.teams[1].plan.authorization.files, migrated.teams[1].plan.authorization.cost, migrated.teams[1].plan.authorization.externalSideEffects],
      ['unknown', 'unknown', 'unknown', 'unknown']
    )
    const active = migrated.teams[1]
    const running = active.tasks.find(task => task.id === 'running')
    assert.equal(running.attempt, 1)
    assert.equal(running.leaseEpoch, 0)
    assert.equal(running.claimId, 'migrated:running:1')
    assert.equal(running.attemptHistory.at(-1).kind, 'migrated_claim')
    for (const task of active.tasks) {
      assert.deepEqual(task.capabilities, [])
      assert.deepEqual(task.externalEffects, [])
      assert.deepEqual(task.interruptionHistory, [])
    }

    const beforeReplay = JSON.stringify(migrated)
    const reopened = new mod.AgentTeamsStore(file)
    await reopened.init()
    assert.equal(JSON.stringify(JSON.parse(await readFile(file, 'utf8'))), beforeReplay, 'migration replay must be byte-semantically stable')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy plan hash is canonical over preserved objective and task contract fields', async () => {
  const mod = await loadPlugin('planning-hash')
  const team = legacyTeam({ id: 'hash-team', tasks: [legacyTask('one', 'pending')] })
  const document = { version: 4, settings: { enabled: true, maxMembers: 4, maxActiveTurns: 4 }, teams: [team] }
  mod.validateStoreDocument(document)
  const expectedMaterial = {
    objective: team.objective,
    tasks: [{
      id: 'one', title: 'one', description: undefined, dependsOn: [], crossTeamDependsOn: [], files: ['src/one.js'], capabilities: [], externalEffects: []
    }]
  }
  assert.equal(document.teams[0].plan.hash, createHash('sha256').update(JSON.stringify(expectedMaterial)).digest('hex'))
})

test('public planning tools expose every persisted safety precondition instead of dropping fields', async () => {
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /name: "team_plan_commit"[\s\S]*?expected_revision:[\s\S]*?commitTeamPlan/u)
  assert.match(source, /name: "team_spawn"[\s\S]*?task_ids:[\s\S]*?taskIds: args\.task_ids/u)
  assert.match(source, /name: "team_task_create"[\s\S]*?capabilities:[\s\S]*?external_effects:[\s\S]*?capabilities: args\.capabilities[\s\S]*?externalEffects: \(args\.external_effects/u)
  assert.match(source, /name: "team_task_update"[\s\S]*?claim_id:[\s\S]*?lease_epoch:[\s\S]*?claimId: args\.claim_id[\s\S]*?leaseEpoch: args\.lease_epoch/u)
  assert.match(source, /name: "team_task_checkpoint"[\s\S]*?claim_id:[\s\S]*?lease_epoch:[\s\S]*?checkpoint:[\s\S]*?next_step:[\s\S]*?claimId: args\.claim_id[\s\S]*?leaseEpoch: args\.lease_epoch[\s\S]*?checkpoint: args\.checkpoint[\s\S]*?nextStep: args\.next_step/u)
  assert.match(source, /name: "team_resume"[\s\S]*?commit:[\s\S]*?preview_id:[\s\S]*?expected_pause_epoch:[\s\S]*?expected_team_revision:[\s\S]*?previewId: args\.preview_id[\s\S]*?expectedPauseEpoch: args\.expected_pause_epoch[\s\S]*?expectedTeamRevision: args\.expected_team_revision/u)
})

test('handoff and adoption are direct-user, same-project, token-bound operations that retain audit identity', async () => {
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /function projectScopeForRoot\(root\)[\s\S]*?AGENT_TEAMS_PROJECT_SCOPE_UNKNOWN/u)
  assert.match(source, /function projectKeyForRoot[\s\S]*?sourceProjectKey !== targetProjectKey[\s\S]*?AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN/u)
  assert.match(source, /team\.state !== "paused"[\s\S]*?AGENT_TEAMS_HANDOFF_REQUIRES_PAUSE/u)
  assert.match(source, /const tokenHash = createHash\("sha256"\)\.update\(token\)\.digest\("hex"\)/u)
  assert.match(source, /function adoptTeamHandoff[\s\S]*?handoff\.targetRootSessionId !== target\.id[\s\S]*?Date\.parse\(handoff\.expiresAt\) <= Date\.now\(\)[\s\S]*?AGENT_TEAMS_HANDOFF_INVALID/u)
  assert.match(source, /sourceLead\.role = "former root lead retained for durable audit references"/u)
  assert.match(source, /name: "team_handoff"[\s\S]*?requireDirectHumanRoot/u)
  assert.match(source, /name: "team_adopt"[\s\S]*?requireDirectHumanRoot/u)
})

test('draft plans reject task execution until the current hash and revision are active', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-plan-gate-'))
  const mod = await loadPlugin('planning-gate')
  const store = new mod.AgentTeamsStore(path.join(root, 'storages', 'agent_teams.json'), { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
  try {
    await store.init()
    const lead = { id: 'plan-lead', options: { provider: 'test', model: 'test' } }
    const team = await mod.createTeam(store, lead, { objective: 'Plan before executing' })
    assert.equal(store.snapshot().teams[0].plan.phase, 'draft')
    const created = await mod.createTask(store, lead, { teamId: team.id, title: 'Persisted before execution' })
    const draft = store.snapshot().teams[0].plan
    assert.equal(draft.phase, 'draft')
    assert.equal(draft.revision, 2)
    await assert.rejects(
      mod.updateTask(store, lead, { teamId: team.id, taskId: created.task.id, action: 'claim' }),
      error => error?.code === 'AGENT_TEAMS_PLAN_NOT_ACTIVE'
    )
    const after = store.snapshot().teams[0]
    assert.equal(after.tasks[0].state, 'pending')
    assert.equal(after.tasks[0].attempt, 0)
    assert.equal(after.tasks[0].claimId, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('claim and lease fencing reject stale worker completion while current tokens succeed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-claim-fence-'))
  const mod = await loadPlugin('claim-fence')
  const store = new mod.AgentTeamsStore(path.join(root, 'storages', 'agent_teams.json'), { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
  try {
    await store.init()
    const lead = { id: 'fence-lead', options: { provider: 'test', model: 'test' } }
    const team = await mod.createTeam(store, lead, { objective: 'Fence stale writes' })
    const created = await mod.createTask(store, lead, { teamId: team.id, title: 'Fenced task' })
    await store.mutate(document => {
      const durable = document.teams[0]
      const at = timestamp(2_000)
      durable.members.push({ id: 'worker-record', sessionId: 'worker-session', name: 'Test', role: 'test worker', kind: 'worker', state: 'ready', createdAt: at, updatedAt: at })
      durable.plan.phase = 'active'
      durable.plan.committedAt = at
      durable.plan.activatedAt = at
      durable.plan.authorization = { source: 'direct_user', attestedAt: at, permissions: 'verified', files: 'verified', cost: 'verified', externalSideEffects: 'verified' }
    })
    const worker = { id: 'worker-session' }
    const claimed = (await mod.updateTask(store, worker, { teamId: team.id, taskId: created.task.id, action: 'claim' })).task
    assert.equal(claimed.attempt, 1)
    assert.match(claimed.claimId, /^[0-9a-f-]{36}$/u)
    assert.equal(claimed.leaseEpoch, 0)
    await assert.rejects(
      mod.updateTask(store, worker, { teamId: team.id, taskId: created.task.id, action: 'complete', claimId: 'stale-claim', leaseEpoch: claimed.leaseEpoch }),
      error => error?.code === 'AGENT_TEAMS_STALE_CLAIM'
    )
    await assert.rejects(
      mod.updateTask(store, worker, { teamId: team.id, taskId: created.task.id, action: 'complete', claimId: claimed.claimId, leaseEpoch: claimed.leaseEpoch + 1 }),
      error => error?.code === 'AGENT_TEAMS_STALE_LEASE'
    )
    const completed = (await mod.updateTask(store, worker, { teamId: team.id, taskId: created.task.id, action: 'complete', claimId: claimed.claimId, leaseEpoch: claimed.leaseEpoch })).task
    assert.equal(completed.state, 'completed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unknown capabilities and uncertain external outcomes block automatic execution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-preflight-'))
  const mod = await loadPlugin('preflight')
  const store = new mod.AgentTeamsStore(path.join(root, 'storages', 'agent_teams.json'), { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
  try {
    await store.init()
    const lead = { id: 'preflight-lead', options: { provider: 'test', model: 'test' } }
    const team = await mod.createTeam(store, lead, { objective: 'Fail closed on unknown facts' })
    const unknownCapability = await mod.createTask(store, lead, { teamId: team.id, title: 'Unknown permission', capabilities: ['desktop-control'] })
    const unknownOutcome = await mod.createTask(store, lead, { teamId: team.id, title: 'Unknown external effect', externalEffects: [{ name: 'external UI action', policy: 'confirm_each', outcome: 'outcome_unknown' }] })
    await store.mutate(document => {
      const durable = document.teams[0]
      const at = timestamp(2_000)
      durable.plan.phase = 'active'
      durable.plan.committedAt = at
      durable.plan.activatedAt = at
      durable.plan.authorization = { source: 'direct_user', attestedAt: at, permissions: 'verified', files: 'verified', cost: 'verified', externalSideEffects: 'verified' }
    })
    await assert.rejects(
      mod.updateTask(store, lead, { teamId: team.id, taskId: unknownCapability.task.id, action: 'claim' }),
      error => error?.code === 'AGENT_TEAMS_CAPABILITY_UNKNOWN'
    )
    await assert.rejects(
      mod.updateTask(store, lead, { teamId: team.id, taskId: unknownOutcome.task.id, action: 'claim' }),
      error => error?.code === 'AGENT_TEAMS_OUTCOME_UNKNOWN'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unverified checkpoints reject Host-authority and sensitive-field injection', async () => {
  const mod = await loadPlugin('checkpoint-boundary')
  const base = legacyTask('checkpointed', 'pending', {
    attempt: 1,
    leaseEpoch: 2,
    attemptHistory: [],
    interruptionHistory: [],
    capabilities: [],
    externalEffects: [],
    checkpoint: {
      text: 'Member reports a partial result.',
      reportedAt: timestamp(1_000),
      reportedBy: 'member-a',
      verified: false,
      claimId: 'claim-a',
      leaseEpoch: 2
    }
  })
  assert.doesNotThrow(() => mod.validateTask(structuredClone(base)))

  const verified = structuredClone(base)
  verified.checkpoint.verified = true
  assert.throws(() => mod.validateTask(verified), /verified must be false/u)

  for (const [field, value] of [
    ['permission', 'verified'],
    ['outcome', 'succeeded'],
    ['credential', 'secret'],
    ['path', 'C:\\private\\file'],
    ['messageBody', 'raw coordinator message'],
    ['progressPercent', 100]
  ]) {
    const injected = structuredClone(base)
    injected.checkpoint[field] = value
    assert.throws(() => mod.validateTask(injected), /unsupported fields/u, `checkpoint must reject injected ${field}`)
  }
})

test('the latest unverified checkpoint survives release, a new claim, and Stop reset code paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-checkpoint-recovery-'))
  const mod = await loadPlugin('checkpoint-recovery')
  const store = new mod.AgentTeamsStore(path.join(root, 'storages', 'agent_teams.json'), { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
  const lead = { id: 'checkpoint-lead', options: { provider: 'test', model: 'test' } }
  const ctx = { agents: { get: id => id === lead.id ? lead : undefined, roots: () => [lead] } }
  try {
    await store.init()
    const team = await mod.createTeam(store, lead, { objective: 'Retain bounded recovery context' })
    const created = await mod.createTask(store, lead, { teamId: team.id, title: 'Interrupted work' })
    const draft = store.snapshot().teams[0].plan
    await mod.commitTeamPlan(ctx, store, lead, {
      teamId: team.id, expectedRevision: draft.revision, confirmedPlanHash: draft.hash,
      permissionsVerified: true, filesVerified: true, costVerified: true, externalSideEffectsVerified: true
    })
    const firstClaim = (await mod.updateTask(store, lead, { teamId: team.id, taskId: created.task.id, action: 'claim' })).task
    await mod.updateTaskCheckpoint(store, lead, {
      teamId: team.id, taskId: created.task.id, claimId: firstClaim.claimId, leaseEpoch: firstClaim.leaseEpoch,
      checkpoint: 'Member reports the parser is implemented.', nextStep: 'Member suggests running the focused contract test.'
    })
    const original = structuredClone(store.snapshot().teams[0].tasks[0])
    assert.equal(original.checkpoint.verified, false)
    assert.equal(original.nextStep.verified, false)

    await mod.updateTask(store, lead, {
      teamId: team.id, taskId: created.task.id, action: 'release', claimId: firstClaim.claimId, leaseEpoch: firstClaim.leaseEpoch
    })
    const released = store.snapshot().teams[0].tasks[0]
    assert.deepEqual(released.checkpoint, original.checkpoint)
    assert.deepEqual(released.nextStep, original.nextStep)

    const secondClaim = (await mod.updateTask(store, lead, { teamId: team.id, taskId: created.task.id, action: 'claim' })).task
    assert.notEqual(secondClaim.claimId, firstClaim.claimId)
    assert.deepEqual(secondClaim.checkpoint, original.checkpoint, 'old claim metadata stays visible only as unverified audit context')
    assert.deepEqual(secondClaim.nextStep, original.nextStep)

    const source = await readFile(pluginFile, 'utf8')
    const stopReset = source.slice(source.indexOf('function resetTaskStoppedAfter'), source.indexOf('async function pauseTeamsForUserStop'))
    assert.doesNotMatch(stopReset, /task\.(?:checkpoint|nextStep)\s*=\s*undefined/u, 'Stop must not erase recovery context')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('model booleans can only human-attest the exact plan hash and never upgrade capabilities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-authorization-'))
  const mod = await loadPlugin('authorization-lattice')
  const store = new mod.AgentTeamsStore(path.join(root, 'storages', 'agent_teams.json'), { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
  const lead = { id: 'authorization-lead', options: { provider: 'test', model: 'test' } }
  const ctx = { agents: { get: id => id === lead.id ? lead : undefined, roots: () => [lead] } }
  try {
    await store.init()
    const team = await mod.createTeam(store, lead, { objective: 'Never confuse model assertions with Host proof' })
    const created = await mod.createTask(store, lead, { teamId: team.id, title: 'No protected capability' })
    const draft = store.snapshot().teams[0].plan
    const beforeWrongHash = JSON.stringify(store.snapshot())
    await assert.rejects(
      mod.commitTeamPlan(ctx, store, lead, { teamId: team.id, expectedRevision: draft.revision, permissionsVerified: true, filesVerified: true, costVerified: true, externalSideEffectsVerified: true }),
      error => error instanceof TypeError || error?.code === 'AGENT_TEAMS_PLAN_CAS_REQUIRED'
    )
    assert.equal(JSON.stringify(store.snapshot()), beforeWrongHash, 'missing exact plan hash must not authorize the current projection implicitly')
    await assert.rejects(
      mod.commitTeamPlan(ctx, store, lead, { teamId: team.id, expectedRevision: draft.revision, confirmedPlanHash: '0'.repeat(64), permissionsVerified: true, filesVerified: true, costVerified: true, externalSideEffectsVerified: true }),
      error => error?.code === 'AGENT_TEAMS_STALE_PLAN'
    )
    assert.equal(JSON.stringify(store.snapshot()), beforeWrongHash, 'wrong hash must not mutate authorization or plan phase')
    const commitInput = {
      teamId: team.id, expectedRevision: draft.revision, confirmedPlanHash: draft.hash,
      permissionsVerified: true, filesVerified: true, costVerified: true, externalSideEffectsVerified: true
    }
    const committed = await mod.commitTeamPlan(ctx, store, lead, commitInput)
    assert.equal(committed.plan.phase, 'committed', 'a plan without an established worker must expose its committed phase')
    assert.equal(committed.plan.authorization.source, 'human_attested')
    assert.deepEqual(
      [committed.plan.authorization.permissions, committed.plan.authorization.files, committed.plan.authorization.cost, committed.plan.authorization.externalSideEffects],
      ['human_attested', 'human_attested', 'human_attested', 'human_attested']
    )
    assert.equal(JSON.stringify(committed).includes('host_verified'), false)
    const replay = await mod.commitTeamPlan(ctx, store, lead, commitInput)
    assert.equal(replay.reused, true)
    assert.equal(replay.plan.phase, 'committed', 'matching committed-plan CAS replay must not fabricate activation')
    const claimed = await mod.updateTask(store, lead, { teamId: team.id, taskId: created.task.id, action: 'claim' })
    assert.equal(claimed.task.state, 'in_progress')
    assert.equal(store.snapshot().teams[0].plan.phase, 'active', 'the first successful claim activates the committed plan')
    const source = await readFile(pluginFile, 'utf8')
    const tool = source.slice(source.indexOf('name: "team_plan_commit"'), source.indexOf('name: "team_task_create"'))
    assert.doesNotMatch(tool, /hostVerification|verifiedByHost/u, 'public model tool must not forward a Host-private verifier record')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Host derives external effect identity and outcome_unknown blocks stale or unauthorized resolution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-effects-'))
  const mod = await loadPlugin('external-effect-fence')
  const store = new mod.AgentTeamsStore(path.join(root, 'storages', 'agent_teams.json'), { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
  const lead = { id: 'effects-lead', options: { provider: 'test', model: 'test' } }
  try {
    await store.init()
    const team = await mod.createTeam(store, lead, { objective: 'Fence uncertain external effects' })
    const created = await mod.createTask(store, lead, {
      teamId: team.id,
      title: 'Participating receipt protocol only',
      externalEffects: [{ name: 'publish-once', policy: 'idempotent', outcome: 'not_started', idempotencyKey: 'f'.repeat(64) }]
    })
    const durableEffect = store.snapshot().teams[0].tasks[0].externalEffects[0]
    assert.match(durableEffect.idempotencyKey, /^[a-f0-9]{64}$/u)
    assert.notEqual(durableEffect.idempotencyKey, 'f'.repeat(64), 'model-supplied idempotency key is not authoritative')
    const snapshot = store.snapshot().teams[0]
    snapshot.plan.phase = 'active'
    snapshot.plan.migrationState = 'ready'
    snapshot.plan.authorization = { source: 'human_attested', attestedAt: timestamp(2_000), confirmedPlanHash: snapshot.plan.hash, permissions: 'unknown', files: 'human_attested', cost: 'human_attested', externalSideEffects: 'human_attested' }
    await store.mutate(document => { document.teams[0] = snapshot })
    const claim = (await mod.updateTask(store, lead, { teamId: team.id, taskId: created.task.id, action: 'claim' })).task
    const prepared = await mod.updateTaskExternalEffect(store, lead, { teamId: team.id, taskId: created.task.id, effectName: 'publish-once', action: 'prepare', claimId: claim.claimId, leaseEpoch: claim.leaseEpoch })
    assert.equal(prepared.effect.outcome, 'outcome_unknown')
    assert.equal(prepared.deliveryGuarantee, 'host_effect_key_available_no_exactly_once_claim')
    await assert.rejects(
      mod.updateTaskExternalEffect(store, { id: 'other-worker' }, { teamId: team.id, taskId: created.task.id, effectName: 'publish-once', action: 'resolve_unknown', outcome: 'not_started' }),
      error => ['AGENT_TEAMS_UNAUTHORIZED', 'AGENT_TEAMS_EXTERNAL_EFFECT_CONFIRMATION_REQUIRED'].includes(error?.code)
    )
    await assert.rejects(
      mod.updateTaskExternalEffect(store, lead, { teamId: team.id, taskId: created.task.id, effectName: 'publish-once', action: 'succeeded', attemptId: 'stale', claimId: claim.claimId, leaseEpoch: claim.leaseEpoch }),
      error => error?.code === 'AGENT_TEAMS_STALE_EXTERNAL_EFFECT'
    )
    assert.equal(store.snapshot().teams[0].tasks[0].externalEffects[0].outcome, 'outcome_unknown')
    const source = await readFile(pluginFile, 'utf8')
    assert.match(source, /name: "team_task_external_effect"[\s\S]*?requireDirectHumanRoot[\s\S]*?resolve_unknown/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resume receipt binds request identity and lifecycle exposes committed before active', async () => {
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /PLAN_PHASES = Object\.freeze\(\["draft", "committed", "active"\]\)/u)
  assert.match(source, /phase: "committed"|plan\.phase = "committed"/u, 'committed must be a real lifecycle state, not an unused enum member')
  assert.match(source, /team\.resume\?\.status === "committed"[\s\S]*?requestedRequestId === team\.resume\.requestId/u, 'resume receipt replay must bind the exact request id')
  assert.match(source, /name: "team_resume"[\s\S]*?request_id:[\s\S]*?requestId: args\.request_id/u)
})

test('canonical project ownership and adoption revoke every old worker lease without reparenting', async () => {
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /function projectKeyForRoot[\s\S]*?createHash\("sha256"\)/u)
  assert.match(source, /team\.ownershipHistory[\s\S]*?handoff_prepared[\s\S]*?handoff_adopted/u)
  assert.match(source, /function adoptTeamHandoff[\s\S]*?team\.pauseEpoch = \(team\.pauseEpoch \?\? 0\) \+ 1[\s\S]*?member\.state = "retired"[\s\S]*?task\.state = "pending"[\s\S]*?task\.claimId = undefined/u)
  assert.doesNotMatch(source.slice(source.indexOf('async function adoptTeamHandoff'), source.indexOf('function assertTaskExecutionPreflight')), /reparent|sendMessage|createContinuableChild/u)
  assert.match(source, /name: "team_handoff"[\s\S]*?requireDirectHumanRoot/u)
  assert.match(source, /name: "team_adopt"[\s\S]*?requireDirectHumanRoot/u)
})

test('the selected-team UI projection bounds ownership history and exposes only safe lifecycle facts', async () => {
  const source = await readFile(pluginFile, 'utf8')
  const start = source.indexOf('function projectTeamForUi(')
  const end = source.indexOf('function projectTeamSummary(', start)
  assert.ok(start >= 0 && end > start)
  const projection = source.slice(start, end)
  const historyStart = projection.indexOf('const ownershipHistory =')
  const historyEnd = projection.indexOf('  return {', historyStart)
  assert.ok(historyStart >= 0 && historyEnd > historyStart)
  const historyMapping = projection.slice(historyStart, historyEnd)

  assert.match(source, /const UI_MAX_OWNERSHIP_EVENTS = 8/u)
  assert.match(historyMapping, /slice\(-UI_MAX_OWNERSHIP_EVENTS\)[\s\S]*?kind: entry\.kind[\s\S]*?at: entry\.at[\s\S]*?pauseEpoch: entry\.pauseEpoch/u)
  assert.doesNotMatch(historyMapping, /sourceRootSessionId|targetRootSessionId|projectKey|tokenHash|claimId/u)
  assert.match(projection, /ownershipHistoryTruncated: ownershipHistory\.length < \(team\.ownershipHistory \?\? \[\]\)\.length/u)
})

test('same-project adoption retains private audit hashes without exposing them in public results', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-handoff-projection-'))
  const mod = await loadPlugin('handoff-projection')
  const store = new mod.AgentTeamsStore(path.join(root, 'storages', 'agent_teams.json'), { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
  const sourceLead = { id: 'handoff-source', options: { provider: 'test', model: 'test' }, session: { header: { cwd: root } } }
  const targetLead = { id: 'handoff-target', options: { provider: 'test', model: 'test' }, session: { header: { cwd: root } } }
  const roots = [sourceLead, targetLead]
  const ctx = { agents: { get: id => roots.find(agent => agent.id === id), roots: () => roots } }
  try {
    await store.init()
    const team = await mod.createTeam(store, sourceLead, { objective: 'Transfer ownership without leaking project identity' })
    const created = await mod.createTask(store, sourceLead, { teamId: team.id, title: 'Retain recovery audit' })
    const draft = store.snapshot().teams[0].plan
    await mod.commitTeamPlan(ctx, store, sourceLead, {
      teamId: team.id, expectedRevision: draft.revision, confirmedPlanHash: draft.hash,
      permissionsVerified: true, filesVerified: true, costVerified: true, externalSideEffectsVerified: true
    })
    const claimed = (await mod.updateTask(store, sourceLead, { teamId: team.id, taskId: created.task.id, action: 'claim' })).task
    await mod.updateTaskCheckpoint(store, sourceLead, {
      teamId: team.id, taskId: created.task.id, claimId: claimed.claimId, leaseEpoch: claimed.leaseEpoch,
      checkpoint: 'Member reports the durable state is saved.', nextStep: 'Member suggests adoption review.'
    })
    const checkpoint = structuredClone(store.snapshot().teams[0].tasks[0].checkpoint)
    await store.mutate(document => {
      const durable = document.teams[0]
      durable.state = 'paused'
    })

    const prepared = await mod.prepareTeamHandoff(ctx, store, sourceLead, { teamId: team.id, targetRootSessionId: targetLead.id })
    assert.match(prepared.handoffToken, /^[0-9a-f-]{36}$/u)
    assert.equal(Object.hasOwn(prepared, 'projectKey'), false, 'the handoff capability result must not disclose canonical project identity')
    assert.doesNotMatch(JSON.stringify(prepared), /tokenHash|projectKey/u)

    const adopted = await mod.adoptTeamHandoff(ctx, store, targetLead, { teamId: team.id, handoffToken: prepared.handoffToken, leadName: 'NewLead' })
    const publicJson = JSON.stringify(adopted)
    assert.doesNotMatch(publicJson, /tokenHash|projectKey/u, 'public team projection must redact private identity and token hashes')
    assert.equal(adopted.team.tasks[0].state, 'pending')
    assert.deepEqual(adopted.team.tasks[0].checkpoint, checkpoint)
    assert.deepEqual(adopted.team.ownershipHistory.map(entry => entry.kind), ['handoff_prepared', 'handoff_adopted'])

    const durable = store.snapshot().teams[0]
    assert.match(durable.projectKey, /^[a-f0-9]{64}$/u)
    assert.equal(durable.ownershipHistory.every(entry => typeof entry.projectKey === 'string'), true)
    assert.equal(durable.ownershipHistory.slice(1).every(entry => typeof entry.tokenHash === 'string'), true)
    assert.deepEqual(durable.tasks[0].checkpoint, checkpoint)
    assert.equal(durable.tasks[0].claimId, undefined)
    assert.equal(durable.tasks[0].leaseEpoch, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
