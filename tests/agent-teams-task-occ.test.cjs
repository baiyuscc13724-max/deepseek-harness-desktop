const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
let importSequence = 0
async function plugin() {
  importSequence += 1
  return import(`${pathToFileURL(pluginFile).href}?task-occ=${Date.now()}-${importSequence}`)
}

async function fixture({ hotColdStore } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-task-occ-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const mod = await plugin()
  const store = new mod.AgentTeamsStore(file, { enabled: true, maxMembers: 4, maxActiveTurns: 4, hotColdStore })
  await store.init()
  const lead = { id: 'occ-lead', options: { provider: 'test', model: 'test' } }
  const team = await mod.createTeam(store, lead, { objective: 'Fence destructive task transitions' })
  const timestamp = new Date().toISOString()
  await store.mutate(document => {
    const durable = document.teams.find(candidate => candidate.id === team.id)
    durable.members.push(
      { id: 'member-occ-worker-a', sessionId: 'occ-worker-a', name: 'Worker A', role: 'test worker', kind: 'worker', state: 'ready', createdAt: timestamp, updatedAt: timestamp },
      { id: 'member-occ-worker-b', sessionId: 'occ-worker-b', name: 'Worker B', role: 'test worker', kind: 'worker', state: 'ready', createdAt: timestamp, updatedAt: timestamp }
    )
  })
  async function createTask(title, extra = {}) {
    const created = await mod.createTask(store, lead, { teamId: team.id, title, ...extra })
    await store.mutate(document => {
      const durable = document.teams.find(candidate => candidate.id === team.id)
      const material = {
        objective: durable.objective,
        tasks: durable.tasks.map(task => ({
          id: task.id, title: task.title, description: task.description, dependsOn: task.dependsOn,
          crossTeamDependsOn: task.crossTeamDependsOn || [], files: task.files || [], capabilities: task.capabilities || [],
          externalEffects: (task.externalEffects || []).map(effect => ({ name: effect.name, policy: effect.policy, idempotencyKey: effect.idempotencyKey }))
        }))
      }
      const hash = createHash('sha256').update(JSON.stringify(material)).digest('hex')
      durable.plan = {
        phase: 'active', revision: durable.plan.revision, hash, committedAt: timestamp, activatedAt: timestamp, migrationState: 'ready',
        authorization: { source: 'human_attested', attestedAt: timestamp, confirmedPlanHash: hash, permissions: 'human_attested', files: 'human_attested', cost: 'human_attested', externalSideEffects: 'human_attested' }
      }
    })
    return created.task
  }
  return { root, file, mod, store, lead, team, createTask }
}

function fenced(input) {
  return { ...input, requireFixedRootCommand: true }
}

function command(task, action, requestId, extra = {}) {
  return fenced({
    teamId: extra.teamId,
    taskId: task.id,
    action,
    requestId,
    expectedTaskRevision: task.revision,
    expectedPauseEpoch: task.leaseEpoch,
    ...extra
  })
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code)
}

test('claim racing a stale fixed-root cancel fails closed without changing claim or ledger', async () => {
  const fx = await fixture()
  try {
    const pending = await fx.createTask('Claim versus cancel')
    const stale = command(pending, 'cancel', 'cancel-before-claim', { teamId: fx.team.id })
    const claimed = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-a' }, { teamId: fx.team.id, taskId: pending.id, action: 'claim' })).task
    const before = fx.store.snapshot().teams.find(team => team.id === fx.team.id).tasks.find(task => task.id === pending.id)
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, stale), 'AGENT_TEAMS_STALE_TASK_REVISION')
    const after = fx.store.snapshot().teams.find(team => team.id === fx.team.id).tasks.find(task => task.id === pending.id)
    assert.equal(after.state, 'in_progress')
    assert.equal(after.claimId, claimed.claimId)
    assert.equal(after.assigneeSessionId, 'occ-worker-a')
    assert.equal(after.revision, before.revision)
    assert.deepEqual(after.lifecycleLedger, before.lifecycleLedger)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('root release uses task OCC while claimant release keeps its lease fence', async () => {
  const fx = await fixture()
  try {
    let task = await fx.createTask('Root release versus later claimant')
    task = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-a' }, { teamId: fx.team.id, taskId: task.id, action: 'claim' })).task
    const staleRootRelease = command(task, 'release', 'root-release-before-reclaim', { teamId: fx.team.id })
    task = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-a' }, {
      teamId: fx.team.id, taskId: task.id, action: 'release', claimId: task.claimId, leaseEpoch: task.leaseEpoch, requireFixedRootCommand: true
    })).task
    task = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-b' }, { teamId: fx.team.id, taskId: task.id, action: 'claim' })).task
    const before = fx.store.snapshot().teams.find(team => team.id === fx.team.id).tasks.find(candidate => candidate.id === task.id)
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, staleRootRelease), 'AGENT_TEAMS_STALE_TASK_REVISION')
    const after = fx.store.snapshot().teams.find(team => team.id === fx.team.id).tasks.find(candidate => candidate.id === task.id)
    assert.equal(after.state, 'in_progress')
    assert.equal(after.assigneeSessionId, 'occ-worker-b')
    assert.equal(after.claimId, task.claimId)
    assert.equal(after.revision, before.revision)
    assert.deepEqual(after.lifecycleLedger, before.lifecycleLedger)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('external-effect prepare increments revision and fences a stale root cancel', async () => {
  const fx = await fixture()
  try {
    let task = await fx.createTask('External effect versus cancel', { externalEffects: [{ name: 'publish', policy: 'idempotent' }] })
    task = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-a' }, { teamId: fx.team.id, taskId: task.id, action: 'claim' })).task
    const staleCancel = command(task, 'cancel', 'cancel-before-effect-prepare', { teamId: fx.team.id })
    const prepared = await fx.mod.updateTaskExternalEffect(fx.store, { id: 'occ-worker-a' }, {
      teamId: fx.team.id, taskId: task.id, effectName: 'publish', action: 'prepare', claimId: task.claimId, leaseEpoch: task.leaseEpoch
    })
    assert.equal(prepared.task.revision, task.revision + 1)
    assert.equal(prepared.effect.outcome, 'outcome_unknown')
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, staleCancel), 'AGENT_TEAMS_STALE_TASK_REVISION')
    const durable = fx.store.snapshot().teams.find(team => team.id === fx.team.id).tasks.find(candidate => candidate.id === task.id)
    assert.equal(durable.state, 'in_progress')
    assert.equal(durable.externalEffects[0].outcome, 'outcome_unknown')
    assert.equal(durable.claimId, task.claimId)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('hot/cold storage preserves stale-claim fencing, outcome_unknown, acceptance, reopen, and restart', async () => {
  const fx = await fixture({ hotColdStore: true })
  let restarted
  try {
    let effectTask = await fx.createTask('Hot unknown effect', { externalEffects: [{ name: 'publish', policy: 'idempotent' }] })
    effectTask = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-a' }, { teamId: fx.team.id, taskId: effectTask.id, action: 'claim' })).task
    const staleCancel = command(effectTask, 'cancel', 'hot-stale-cancel', { teamId: fx.team.id })
    const prepared = await fx.mod.updateTaskExternalEffect(fx.store, { id: 'occ-worker-a' }, {
      teamId: fx.team.id, taskId: effectTask.id, effectName: 'publish', action: 'prepare', claimId: effectTask.claimId, leaseEpoch: effectTask.leaseEpoch
    })
    assert.equal(prepared.effect.outcome, 'outcome_unknown')
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, staleCancel), 'AGENT_TEAMS_STALE_TASK_REVISION')

    let reviewed = await fx.createTask('Hot accepted then reopened')
    reviewed = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-b' }, { teamId: fx.team.id, taskId: reviewed.id, action: 'claim' })).task
    reviewed = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-b' }, { teamId: fx.team.id, taskId: reviewed.id, action: 'complete', claimId: reviewed.claimId, leaseEpoch: reviewed.leaseEpoch })).task
    reviewed = (await fx.mod.updateTask(fx.store, fx.lead, command(reviewed, 'accept', 'hot-accept', { teamId: fx.team.id }))).task
    reviewed = (await fx.mod.updateTask(fx.store, fx.lead, command(reviewed, 'reopen', 'hot-reopen', { teamId: fx.team.id }))).task
    assert.equal(fx.store.storageDiagnostics().mode, 'hot-cold')
    fx.store.close()

    const restartedMod = await plugin()
    restarted = new restartedMod.AgentTeamsStore(fx.file)
    await restarted.init()
    const durable = restarted.snapshot().teams.find(team => team.id === fx.team.id)
    const durableEffect = durable.tasks.find(task => task.id === effectTask.id)
    const durableReviewed = durable.tasks.find(task => task.id === reviewed.id)
    assert.equal(durableEffect.externalEffects[0].outcome, 'outcome_unknown')
    assert.equal(durableEffect.claimId, effectTask.claimId)
    assert.equal(durableReviewed.state, 'pending')
    assert.ok(durableReviewed.lifecycleLedger.some(event => event.kind === 'acceptance'))
    assert.ok(durableReviewed.lifecycleLedger.some(event => event.kind === 'reopen'))
  } finally {
    restarted?.close()
    fx.store.close()
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('reopen, assign, and unassign use revision CAS rather than updatedAt', async () => {
  const fx = await fixture()
  try {
    let task = await fx.createTask('Assignment OCC')
    const assignA = command(task, 'assign', 'assign-a', { teamId: fx.team.id, assigneeSessionId: 'occ-worker-a' })
    const assignB = command(task, 'assign', 'assign-b', { teamId: fx.team.id, assigneeSessionId: 'occ-worker-b' })
    task = (await fx.mod.updateTask(fx.store, fx.lead, assignA)).task
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, assignB), 'AGENT_TEAMS_STALE_TASK_REVISION')
    const noOpAssign = command(task, 'assign', 'assign-noop', { teamId: fx.team.id, assigneeSessionId: 'occ-worker-a' })
    const noOpResult = await fx.mod.updateTask(fx.store, fx.lead, noOpAssign)
    assert.equal(noOpResult.task.revision, task.revision, 'safe no-op must not fabricate a task revision')
    assert.equal(noOpResult.operation.taskRevisionBefore, task.revision)
    assert.equal(noOpResult.operation.taskRevisionAfter, task.revision)
    assert.equal((await fx.mod.updateTask(fx.store, fx.lead, noOpAssign)).reused, true)
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, { ...noOpAssign, action: 'unassign' }), 'AGENT_TEAMS_TASK_COMMAND_REPLAY_CONFLICT')
    task = noOpResult.task
    const unassign = command(task, 'unassign', 'unassign-a', { teamId: fx.team.id })
    const assigned = command(task, 'assign', 'assign-a-again', { teamId: fx.team.id, assigneeSessionId: 'occ-worker-a' })
    task = (await fx.mod.updateTask(fx.store, fx.lead, unassign)).task
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, assigned), 'AGENT_TEAMS_STALE_TASK_REVISION')

    task = (await fx.mod.updateTask(fx.store, fx.lead, { teamId: fx.team.id, taskId: task.id, action: 'claim' })).task
    task = (await fx.mod.updateTask(fx.store, fx.lead, { teamId: fx.team.id, taskId: task.id, action: 'complete', claimId: task.claimId, leaseEpoch: task.leaseEpoch })).task
    task = (await fx.mod.updateTask(fx.store, fx.lead, command(task, 'accept', 'accept-for-reopen', { teamId: fx.team.id }))).task
    const reopen = command(task, 'reopen', 'reopen-current', { teamId: fx.team.id })
    const staleReopen = { ...reopen, requestId: 'reopen-stale', expectedTaskRevision: task.revision - 1 }
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, staleReopen), 'AGENT_TEAMS_STALE_TASK_REVISION')
    const reopened = (await fx.mod.updateTask(fx.store, fx.lead, reopen)).task
    assert.equal(reopened.state, 'pending')
    assert.equal(reopened.revision, task.revision + 1)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('durable no-op assign replay survives target retirement and cannot mutate after restart', async () => {
  const fx = await fixture()
  try {
    let task = await fx.createTask('Durable no-op assign')
    task = (await fx.mod.updateTask(fx.store, fx.lead, command(task, 'assign', 'initial-assign', { teamId: fx.team.id, assigneeSessionId: 'occ-worker-a' }))).task
    const noOpAssign = command(task, 'assign', 'durable-noop-assign', { teamId: fx.team.id, assigneeSessionId: 'occ-worker-a' })
    const noOp = await fx.mod.updateTask(fx.store, fx.lead, noOpAssign)
    assert.equal(noOp.task.revision, task.revision)
    assert.equal(noOp.operation.taskRevisionAfter, noOp.operation.taskRevisionBefore)

    task = (await fx.mod.updateTask(fx.store, fx.lead, command(noOp.task, 'unassign', 'unassign-after-noop', { teamId: fx.team.id }))).task
    await fx.store.mutate(document => {
      const team = document.teams.find(candidate => candidate.id === fx.team.id)
      team.members.find(member => member.sessionId === 'occ-worker-a').state = 'retired'
    })

    const restartedMod = await plugin()
    const restarted = new restartedMod.AgentTeamsStore(fx.file)
    await restarted.init()
    const replay = await restartedMod.updateTask(restarted, fx.lead, noOpAssign)
    assert.equal(replay.reused, true, 'receipt lookup must precede current assignee validation')
    const durable = restarted.snapshot().teams.find(team => team.id === fx.team.id).tasks.find(candidate => candidate.id === task.id)
    assert.equal(durable.assigneeSessionId, undefined, 'old no-op request must never reassign after state changes')
    assert.equal(durable.revision, task.revision)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('submitted accept and reject are independently fenced and exact command replay is durable', async () => {
  const fx = await fixture()
  try {
    let task = await fx.createTask('Submission review OCC')
    task = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-a' }, { teamId: fx.team.id, taskId: task.id, action: 'claim' })).task
    task = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-a' }, { teamId: fx.team.id, taskId: task.id, action: 'complete', claimId: task.claimId, leaseEpoch: task.leaseEpoch })).task
    const accept = command(task, 'accept', 'review-command', { teamId: fx.team.id })
    const reject = command(task, 'reject', 'reject-command', { teamId: fx.team.id })
    const accepted = await fx.mod.updateTask(fx.store, fx.lead, accept)
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, reject), 'AGENT_TEAMS_STALE_TASK_REVISION')
    const replay = await fx.mod.updateTask(fx.store, fx.lead, accept)
    assert.equal(replay.reused, true)
    assert.deepEqual(replay.operation, accepted.operation)
    const repeatedAcceptance = command(accepted.task, 'accept', 'review-noop-command', { teamId: fx.team.id })
    const acceptanceNoOp = await fx.mod.updateTask(fx.store, fx.lead, repeatedAcceptance)
    assert.equal(acceptanceNoOp.task.revision, accepted.task.revision)
    assert.equal(acceptanceNoOp.operation.taskRevisionAfter, acceptanceNoOp.operation.taskRevisionBefore)

    const restartedMod = await plugin()
    const restarted = new restartedMod.AgentTeamsStore(fx.file)
    await restarted.init()
    const restartReplay = await restartedMod.updateTask(restarted, fx.lead, accept)
    assert.equal(restartReplay.reused, true)
    assert.deepEqual(restartReplay.operation, accepted.operation)
    const restartedNoOpReplay = await restartedMod.updateTask(restarted, fx.lead, repeatedAcceptance)
    assert.equal(restartedNoOpReplay.reused, true)
    assert.deepEqual(restartedNoOpReplay.operation, acceptanceNoOp.operation)
    await expectCode(restartedMod.updateTask(restarted, fx.lead, { ...accept, action: 'reopen' }), 'AGENT_TEAMS_TASK_COMMAND_REPLAY_CONFLICT')
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('current-version stores durably migrate missing task revisions and receipt collections', async () => {
  // This fixture deliberately edits the authoritative v8 document on disk. Keep it
  // in legacy mode even when the outer suite forces hot/cold storage; immutable v8
  // sources are never a writable back door after promotion.
  const fx = await fixture({ hotColdStore: false })
  try {
    const task = await fx.createTask('Additive revision migration')
    const document = JSON.parse(await readFile(fx.file, 'utf8'))
    const team = document.teams.find(candidate => candidate.id === fx.team.id)
    delete team.taskCommandReceipts
    delete team.tasks.find(candidate => candidate.id === task.id).revision
    team.members.find(member => member.kind === 'lead').state = 'ready'
    await writeFile(fx.file, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

    const migratedStore = new fx.mod.AgentTeamsStore(fx.file)
    await migratedStore.init()
    const persisted = JSON.parse(await readFile(fx.file, 'utf8'))
    const migratedTeam = persisted.teams.find(candidate => candidate.id === fx.team.id)
    assert.deepEqual(migratedTeam.taskCommandReceipts, [])
    assert.equal(migratedTeam.tasks.find(candidate => candidate.id === task.id).revision, 1)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('exact durable replay bypasses a later pause while new commands remain gated', async () => {
  const fx = await fixture()
  try {
    const task = await fx.createTask('Replay after pause')
    const assign = command(task, 'assign', 'assign-before-pause', { teamId: fx.team.id, assigneeSessionId: 'occ-worker-a' })
    const assigned = await fx.mod.updateTask(fx.store, fx.lead, assign)
    await fx.store.mutate(document => {
      const team = document.teams.find(candidate => candidate.id === fx.team.id)
      team.state = 'paused'
      team.pauseEpoch += 1
    })
    const beforeReplay = fx.store.snapshot().teams.find(team => team.id === fx.team.id)
    const replay = await fx.mod.updateTask(fx.store, fx.lead, assign)
    assert.equal(replay.reused, true)
    assert.deepEqual(replay.operation, assigned.operation)
    assert.deepEqual(fx.store.snapshot().teams.find(team => team.id === fx.team.id), beforeReplay, 'replay after pause must not mutate durable state')

    await expectCode(fx.mod.updateTask(fx.store, fx.lead, { ...assign, action: 'unassign' }), 'AGENT_TEAMS_TASK_COMMAND_REPLAY_CONFLICT')
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, { ...assign, action: 'unassign', requestId: 'new-command-old-epoch' }), 'AGENT_TEAMS_PAUSED')
    assert.deepEqual(fx.store.snapshot().teams.find(team => team.id === fx.team.id), beforeReplay)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('pause epoch CAS and receipt validation fail closed', async () => {
  // The corruption probe must target the authoritative legacy document itself.
  const fx = await fixture({ hotColdStore: false })
  try {
    const task = await fx.createTask('Pause epoch OCC')
    const stale = command(task, 'cancel', 'pause-stale', { teamId: fx.team.id })
    await fx.store.mutate(document => {
      const team = document.teams.find(candidate => candidate.id === fx.team.id)
      team.pauseEpoch += 1
      team.tasks.find(candidate => candidate.id === task.id).leaseEpoch = team.pauseEpoch
    })
    await expectCode(fx.mod.updateTask(fx.store, fx.lead, stale), 'AGENT_TEAMS_STALE_LEASE')
    const durable = fx.store.snapshot().teams.find(team => team.id === fx.team.id).tasks.find(candidate => candidate.id === task.id)
    assert.equal(durable.state, 'pending')

    const document = JSON.parse(await readFile(fx.file, 'utf8'))
    const team = document.teams.find(candidate => candidate.id === fx.team.id)
    team.taskCommandReceipts = [{ requestId: 'bad', inputHash: 'not-a-hash' }]
    await writeFile(fx.file, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    const invalid = new fx.mod.AgentTeamsStore(fx.file)
    await assert.rejects(invalid.init(), /task command receipt|inputHash|unsupported fields/u)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('public fixed-root updates require explicit action and never reinterpret state-only pending', async () => {
  const fx = await fixture()
  try {
    let task = await fx.createTask('Explicit fixed-root action')
    task = (await fx.mod.updateTask(fx.store, fx.lead, command(task, 'cancel', 'cancel-for-state-only', { teamId: fx.team.id }))).task
    const stateOnly = fenced({
      teamId: fx.team.id, taskId: task.id, state: 'pending', requestId: 'state-only-pending',
      expectedTaskRevision: task.revision, expectedPauseEpoch: task.leaseEpoch
    })
    await assert.rejects(fx.mod.updateTask(fx.store, fx.lead, stateOnly), /explicit action|action is required/u)
    assert.equal(fx.store.snapshot().teams.find(team => team.id === fx.team.id).tasks.find(candidate => candidate.id === task.id).state, 'cancelled')

    task = (await fx.mod.updateTask(fx.store, fx.lead, command(task, 'reopen', 'explicit-reopen', { teamId: fx.team.id }))).task
    task = (await fx.mod.updateTask(fx.store, { id: 'occ-worker-a' }, { teamId: fx.team.id, taskId: task.id, action: 'claim' })).task
    await assert.rejects(fx.mod.updateTask(fx.store, fx.lead, stateOnly), /explicit action|action is required/u)
    const durable = fx.store.snapshot().teams.find(team => team.id === fx.team.id).tasks.find(candidate => candidate.id === task.id)
    assert.equal(durable.state, 'in_progress')
    assert.equal(durable.claimId, task.claimId)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('fixed-root destructive command protocol requires all public fence parameters', async () => {
  const fx = await fixture()
  try {
    const task = await fx.createTask('Protocol required')
    for (const action of ['release', 'accept', 'reject', 'cancel', 'reopen', 'assign', 'unassign']) {
      const input = command(task, action, `missing-request-${action}`, { teamId: fx.team.id, ...(action === 'assign' ? { assigneeSessionId: 'occ-worker-a' } : {}) })
      delete input.requestId
      await assert.rejects(fx.mod.updateTask(fx.store, fx.lead, input), /requestId/u)
    }
    for (const missing of ['requestId', 'expectedTaskRevision', 'expectedPauseEpoch']) {
      const input = command(task, 'cancel', `missing-${missing}`, { teamId: fx.team.id })
      delete input[missing]
      await assert.rejects(fx.mod.updateTask(fx.store, fx.lead, input), /requestId|expectedTaskRevision|expectedPauseEpoch|missing/u)
    }
    const source = await readFile(pluginFile, 'utf8')
    const tool = source.slice(source.indexOf('name: "team_task_update"'), source.indexOf('name: "team_task_checkpoint"'))
    assert.match(tool, /request_id:[\s\S]*expected_task_revision:[\s\S]*expected_pause_epoch:/u)
    assert.match(tool, /action: \{[^}]*required: true/u)
    assert.match(tool, /Fixed-root destructive commands \(release\/accept\/reject\/cancel\/reopen\/assign\/unassign\)/u)
    assert.match(tool, /requireFixedRootCommand: true/u)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})
