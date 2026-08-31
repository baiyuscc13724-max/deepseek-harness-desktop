const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')).href
const serviceUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-service.js')).href
const projectRef = `project_${'S'.repeat(24)}`
const taskRef = `task_${'T'.repeat(24)}`

async function fixture() {
  const storeMod = await import(storeUrl)
  const serviceMod = await import(serviceUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-service-'))
  const store = new storeMod.ProjectTaskStore({ filePath: path.join(root, 'tasks.sqlite'), keyProvider: () => randomKey })
  store.initialize()
  let clock = 1_800_000_000_000
  const ownerExecution = Object.freeze({ trusted: 'owner' })
  const agentExecution = Object.freeze({ trusted: 'agent' })
  const reviewerExecution = Object.freeze({ trusted: 'reviewer' })
  const otherAgentExecution = Object.freeze({ trusted: 'other-agent' })
  const leadExecution = Object.freeze({ trusted: 'project-lead' })
  const teamExecution = Object.freeze({ trusted: 'team-member' })
  const actors = new Map([
    [ownerExecution, { projectRef, actorRef: 'actor_owner', kind: 'human', role: 'owner' }],
    [agentExecution, { projectRef, actorRef: 'actor_agent', kind: 'agent' }],
    [otherAgentExecution, { projectRef, actorRef: 'actor_other_agent', kind: 'agent' }],
    [reviewerExecution, { projectRef, actorRef: 'actor_reviewer_agent', kind: 'agent', authorities: ['reviewer'] }],
    [leadExecution, { projectRef, actorRef: 'actor_project_lead', kind: 'agent', authorities: ['project_lead'] }],
    [teamExecution, { projectRef, actorRef: 'actor_team_member', kind: 'team' }],
  ])
  const actorResolver = (execution, requestedProjectRef) => {
    const actor = actors.get(execution)
    if (actor?.projectRef !== requestedProjectRef) return undefined
    return actor
  }
  const now = () => ++clock
  const service = new serviceMod.ProjectTaskCommandService({ store, actorResolver, now })
  return { root, store, service, ownerExecution, agentExecution, reviewerExecution, otherAgentExecution, leadExecution, teamExecution, actorResolver, now, storeMod, serviceMod }
}
const randomKey = randomBytes(32)
async function usingFixture(run) {
  const state = await fixture()
  try { await run(state) } finally { state.store.close(); await rm(state.root, { recursive: true, force: true }) }
}
function command(type, expectedRevision, payload = {}, overrides = {}) {
  return {
    projectRef,
    taskRef,
    commandId: `command_${type}_${expectedRevision}`,
    eventRef: `event_${type}_${expectedRevision}`,
    type,
    expectedRevision,
    payload,
    ...overrides,
  }
}

async function createAssigned(fx) {
  const created = fx.service.execute(fx.ownerExecution, command('create', 0, { title: 'Authoritative task', requirements: { acceptance: 'passes' }, fileScope: ['src/a.js'] }))
  const assigned = fx.service.execute(fx.ownerExecution, command('assign', 1), { targetExecution: fx.agentExecution })
  return { created, assigned }
}

test('actor identity comes only from the trusted resolver and command identity claims are rejected', async () => usingFixture(async fx => {
  assert.throws(() => fx.service.execute({ trusted: 'owner' }, command('create', 0, { title: 'forged object identity' })), error => error.code === 'PROJECT_TASK_ACTOR_UNRESOLVED')
  assert.throws(() => fx.service.execute(fx.ownerExecution, { ...command('create', 0, { title: 'x' }), actorRef: 'actor_forged' }), /unsupported fields/u)
  assert.throws(() => fx.service.execute(fx.ownerExecution, command('create', 0, { title: 'x', sessionId: 'session_forged' })), /forbidden identity field/u)
  assert.throws(() => fx.service.execute(fx.ownerExecution, command('create', 0, { title: 'x', authorities: ['project_lead'] })), /forbidden identity field/u)
  const created = fx.service.execute(fx.ownerExecution, command('create', 0, { title: 'trusted' }))
  assert.equal(created.task.ownerActorRef, 'actor_owner')
  assert.deepEqual(fx.store.getActor({ projectRef, actorRef: 'actor_owner' }), { projectRef, actorRef: 'actor_owner', kind: 'human', role: 'owner', authorities: [] })
}))

test('stable request receipts reject payload, actor, event, and assign-target drift', async () => usingFixture(async fx => {
  const createCommand = command('create', 0, { title: 'Stable request' })
  const created = fx.service.executeCommand(fx.ownerExecution, createCommand)
  assert.equal(fx.service.executeCommand(fx.ownerExecution, createCommand).projectRevision, created.projectRevision)
  assert.throws(() => fx.service.executeCommand(fx.ownerExecution, { ...createCommand, payload: { title: 'drifted' } }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
  assert.throws(() => fx.service.executeCommand(fx.reviewerExecution, createCommand), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
  assert.throws(() => fx.service.executeCommand(fx.ownerExecution, { ...createCommand, eventRef: 'event_drifted' }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')

  const assignCommand = command('assign', 1)
  fx.service.executeCommand(fx.ownerExecution, assignCommand, { targetExecution: fx.agentExecution })
  assert.throws(() => fx.service.executeCommand(fx.ownerExecution, assignCommand, { targetExecution: fx.otherAgentExecution }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
}))

test('explicit priority create, change, clear, replay, permission, OCC, and project boundaries are enforced without invalidating work', async () => usingFixture(async fx => {
  const created = fx.service.executeCommand(fx.ownerExecution, command('create', 0, { title: 'Prioritized task', priority: 0 }))
  assert.equal(created.task.priority, 0)
  assert.equal(created.task.requirementsRevision, 1)
  const maximumRef = `task_${'P'.repeat(24)}`
  const maximum = fx.service.executeCommand(fx.ownerExecution, command('create', 0, { title: 'Maximum priority', priority: 1_000_000 }, { taskRef: maximumRef, commandId: 'command_priority_maximum', eventRef: 'event_priority_maximum' }))
  assert.equal(maximum.task.priority, 1_000_000)

  const assigned = fx.service.executeCommand(fx.ownerExecution, command('assign', 1), { targetExecution: fx.agentExecution })
  const claimed = fx.service.executeCommand(fx.agentExecution, command('claim', assigned.task.revision))
  const started = fx.service.executeCommand(fx.agentExecution, command('attempt.start', claimed.task.revision, { attemptRef: 'attempt_priority' }))
  const submitted = fx.service.executeCommand(fx.agentExecution, command('attempt.submit', started.task.revision, { attemptRef: 'attempt_priority' }))
  const reviewing = fx.service.executeCommand(fx.agentExecution, command('transition', submitted.task.revision, { to: 'in_review', attemptRef: 'attempt_priority' }))
  const reviewed = fx.service.executeCommand(fx.reviewerExecution, command('review', reviewing.task.revision, { reviewRef: 'review_priority', attemptRef: 'attempt_priority', verdict: 'approved' }))

  const setCommand = command('edit_requirements', reviewed.task.revision, { priority: 42 }, { commandId: 'command_priority_set', eventRef: 'event_priority_set' })
  const set = fx.service.executeCommand(fx.ownerExecution, setCommand)
  assert.equal(set.task.priority, 42)
  assert.equal(set.task.requirementsRevision, 1)
  assert.equal(fx.store.getAttempt({ projectRef, attemptRef: 'attempt_priority' }).invalidated, false)
  assert.equal(fx.store.getReview({ projectRef, reviewRef: 'review_priority' }).superseded, false)
  assert.equal(fx.service.executeCommand(fx.ownerExecution, setCommand).duplicate, true)
  assert.throws(() => fx.service.executeCommand(fx.ownerExecution, { ...setCommand, payload: { priority: 43 } }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')

  const changed = fx.service.executeCommand(fx.ownerExecution, command('edit_requirements', set.task.revision, { priority: 1_000_000 }, { commandId: 'command_priority_change', eventRef: 'event_priority_change' }))
  assert.equal(changed.task.priority, 1_000_000)
  assert.equal(changed.task.requirementsRevision, 1)
  const cleared = fx.service.executeCommand(fx.ownerExecution, command('edit_requirements', changed.task.revision, { priority: null }, { commandId: 'command_priority_clear', eventRef: 'event_priority_clear' }))
  assert.equal(Object.hasOwn(cleared.task, 'priority'), false)
  assert.equal(cleared.task.requirementsRevision, 1)
  assert.deepEqual(fx.store.listEvents({ projectRef }).filter(event => event.type === 'task.priority_changed').map(event => event.eventRef), ['event_priority_set', 'event_priority_change', 'event_priority_clear'])

  assert.throws(() => fx.service.executeCommand(fx.ownerExecution, command('edit_requirements', changed.task.revision, { priority: 7 }, { commandId: 'command_priority_stale', eventRef: 'event_priority_stale' })), error => error.code === 'PROJECT_TASK_CONFLICT')
  assert.throws(() => fx.service.executeCommand(fx.otherAgentExecution, command('edit_requirements', cleared.task.revision, { priority: 7 }, { commandId: 'command_priority_forbidden', eventRef: 'event_priority_forbidden' })), error => error.code === 'PROJECT_TASK_FORBIDDEN')
  assert.throws(() => fx.service.executeCommand(fx.ownerExecution, command('create', 0, { title: 'Cross project', priority: 7 }, { projectRef: 'project_foreign', taskRef: 'task_foreign', commandId: 'command_priority_foreign', eventRef: 'event_priority_foreign' })), error => error.code === 'PROJECT_TASK_ACTOR_UNRESOLVED')
  for (const [index, priority] of [-1, 1_000_001, 1.5, '7', true, {}, []].entries()) {
    assert.throws(() => fx.service.executeCommand(fx.ownerExecution, command('edit_requirements', cleared.task.revision, { priority }, { commandId: `command_priority_invalid_${index}`, eventRef: `event_priority_invalid_${index}` })), /payload\.priority/u)
  }
  assert.throws(() => fx.service.executeCommand(fx.ownerExecution, command('claim', cleared.task.revision, { priority: 7 }, { commandId: 'command_priority_wrong_action', eventRef: 'event_priority_wrong_action' })), /unsupported fields/u)
}))

test('full command outcome lookup is actor-bound, exact, restart-safe, and has no effect', async () => usingFixture(async fx => {
  const descriptor = Object.getOwnPropertyDescriptor(fx.serviceMod.ProjectTaskCommandService.prototype, 'getCommandOutcome')
  assert.equal(typeof descriptor.value, 'function')
  assert.equal(descriptor.enumerable, false)

  let receiptLookups = 0
  const originalLookup = fx.store.getCommandReceipt.bind(fx.store)
  fx.store.getCommandReceipt = input => { receiptLookups++; return originalLookup(input) }
  const absent = command('claim', 1, {}, { commandId: 'command_absent', eventRef: 'event_absent' })
  assert.throws(() => fx.service.getCommandOutcome(Object.freeze({ forged: true }), absent), error => error.code === 'PROJECT_TASK_ACTOR_UNRESOLVED' && !Object.hasOwn(error, 'receipt'))
  assert.equal(receiptLookups, 0, 'fresh Host actor resolution precedes the first Store lookup')
  assert.throws(() => fx.service.getCommandOutcome(fx.ownerExecution, { ...absent, actorRef: 'actor_forged' }), /unsupported fields/u)
  assert.equal(receiptLookups, 0)
  const revisionBeforeAbsent = fx.store.getProjectRevision(projectRef)
  assert.equal(fx.service.getCommandOutcome(fx.ownerExecution, absent), undefined)
  assert.equal(fx.store.getProjectRevision(projectRef), revisionBeforeAbsent)
  assert.equal(fx.store.listTasks({ projectRef }).length, 0)
  assert.throws(() => fx.service.getCommandOutcome(fx.ownerExecution, command('create', 0, { title: 'not a query' })), /claim or transition command/u)

  await createAssigned(fx)
  const claimCommand = command('claim', 2)
  const accepted = fx.service.executeCommand(fx.agentExecution, claimCommand)
  const revisionBeforeQuery = fx.store.getProjectRevision(projectRef)
  const exact = fx.service.getCommandOutcome(fx.agentExecution, claimCommand)
  assert.deepEqual(exact, { ...accepted, duplicate: true })
  assert.equal(fx.store.getProjectRevision(projectRef), revisionBeforeQuery)
  assert.equal(fx.store.getTask({ projectRef, taskRef }).revision, accepted.task.revision)

  for (const [execution, drift] of [
    [fx.otherAgentExecution, claimCommand],
    [fx.agentExecution, { ...claimCommand, taskRef: `task_${'Z'.repeat(24)}` }],
    [fx.agentExecution, { ...claimCommand, expectedRevision: 3 }],
    [fx.agentExecution, { ...claimCommand, commandId: 'command_claim_drifted' }],
    [fx.agentExecution, { ...claimCommand, eventRef: 'event_claim_drifted' }],
    [fx.agentExecution, { ...claimCommand, type: 'transition', payload: { to: 'blocked', blockReason: 'drift' } }],
  ]) assert.throws(() => fx.service.getCommandOutcome(execution, drift), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')

  const secondTaskRef = `task_${'Q'.repeat(24)}`
  fx.service.executeCommand(fx.ownerExecution, command('create', 0, { title: 'Transition query' }, { taskRef: secondTaskRef, commandId: 'command_create_query', eventRef: 'event_create_query' }))
  const transitionCommand = command('transition', 1, { to: 'in_progress' }, { taskRef: secondTaskRef, commandId: 'command_transition_query', eventRef: 'event_transition_query' })
  const transitioned = fx.service.executeCommand(fx.ownerExecution, transitionCommand)
  assert.deepEqual(fx.service.getCommandOutcome(fx.ownerExecution, transitionCommand), { ...transitioned, duplicate: true })
  assert.throws(() => fx.service.getCommandOutcome(fx.ownerExecution, { ...transitionCommand, payload: { to: 'canceled' } }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')

  const rejectedCommand = command('claim', 3, {}, { commandId: 'command_rejected_no_effect', eventRef: 'event_rejected_no_effect' })
  assert.throws(() => fx.service.executeCommand(fx.otherAgentExecution, rejectedCommand), error => error.code === 'PROJECT_TASK_FORBIDDEN')
  assert.equal(fx.service.getCommandOutcome(fx.otherAgentExecution, rejectedCommand), undefined, 'domain rejection has no durable effect receipt')

  fx.store.close()
  const restartedStore = new fx.storeMod.ProjectTaskStore({ filePath: path.join(fx.root, 'tasks.sqlite'), keyProvider: () => randomKey })
  restartedStore.initialize()
  const restarted = new fx.serviceMod.ProjectTaskCommandService({ store: restartedStore, actorResolver: fx.actorResolver, now: fx.now })
  try {
    assert.deepEqual(restarted.getCommandOutcome(fx.agentExecution, claimCommand), { ...accepted, duplicate: true })
    assert.deepEqual(restarted.getCommandOutcome(fx.ownerExecution, transitionCommand), { ...transitioned, duplicate: true })
    assert.equal(restarted.getCommandOutcome(fx.otherAgentExecution, rejectedCommand), undefined)
  } finally { restartedStore.close() }
}))

test('failed authorization does not register the rejected actor', async () => usingFixture(async fx => {
  await createAssigned(fx)
  assert.throws(() => fx.service.executeCommand(fx.otherAgentExecution, command('claim', 2)), error => error.code === 'PROJECT_TASK_FORBIDDEN')
  assert.equal(fx.store.getActor({ projectRef, actorRef: 'actor_other_agent' }), undefined)
}))

test('commands enforce OCC, assignment, comments, attempts, requirement invalidation, review, and state guards', async () => usingFixture(async fx => {
  await createAssigned(fx)
  assert.throws(() => fx.service.execute(fx.otherAgentExecution, command('claim', 2)), error => error.code === 'PROJECT_TASK_FORBIDDEN')
  const claimed = fx.service.execute(fx.agentExecution, command('claim', 2))
  assert.equal(claimed.task.status, 'in_progress')
  assert.equal(claimed.task.assigneeActorRef, 'actor_agent')
  assert.throws(() => fx.service.execute(fx.agentExecution, command('comment', 2, { commentRef: 'comment_stale', body: 'stale' })), error => error.code === 'PROJECT_TASK_CONFLICT')

  assert.throws(() => fx.service.execute(fx.agentExecution, command('comment', 3, { commentRef: 'comment_bad_kind', kind: { machine: true }, body: 'invalid' }, { commandId: 'command_comment_bad_kind', eventRef: 'event_comment_bad_kind' })), /comment kind/u)
  const commentCommand = command('comment', 3, { commentRef: 'comment_progress', kind: 'progress', body: 'implementation started' })
  const commented = fx.service.execute(fx.agentExecution, commentCommand)
  const replay = fx.service.execute(fx.agentExecution, commentCommand)
  assert.equal(replay.duplicate, true)
  assert.equal(replay.projectRevision, commented.projectRevision)
  assert.equal(fx.store.listComments({ projectRef, taskRef })[0].body, 'implementation started')

  fx.service.execute(fx.agentExecution, command('attempt.start', 4, { attemptRef: 'attempt_first' }))
  const changed = fx.service.execute(fx.ownerExecution, command('edit_requirements', 5, { title: 'Changed authoritative task' }))
  assert.equal(changed.task.requirementsRevision, 2)
  assert.equal(fx.store.getAttempt({ projectRef, attemptRef: 'attempt_first' }).invalidated, true)
  assert.throws(() => fx.service.execute(fx.agentExecution, command('attempt.submit', 6, { attemptRef: 'attempt_first' })), error => error.code === 'PROJECT_TASK_REQUIREMENTS_STALE')

  const startSecond = command('attempt.start', 6, { attemptRef: 'attempt_second' })
  const submitSecond = command('attempt.submit', 7, { attemptRef: 'attempt_second' })
  const reviewCommand = command('review', 9, { reviewRef: 'review_approved', attemptRef: 'attempt_second', verdict: 'approved', body: 'approved by delegated reviewer' })
  const startedSecond = fx.service.executeCommand(fx.agentExecution, startSecond)
  const submittedSecond = fx.service.executeCommand(fx.agentExecution, submitSecond)
  fx.service.executeCommand(fx.agentExecution, command('transition', 8, { to: 'in_review', attemptRef: 'attempt_second' }))
  assert.throws(() => fx.service.executeCommand(fx.agentExecution, command('review', 9, { reviewRef: 'review_self', attemptRef: 'attempt_second', verdict: 'approved' })), error => error.code === 'PROJECT_TASK_SELF_APPROVAL')
  assert.throws(() => fx.service.executeCommand(fx.reviewerExecution, command('review', 9, { reviewRef: 'review_bad_body', attemptRef: 'attempt_second', verdict: 'approved', body: { machine: true } }, { commandId: 'command_review_bad_body', eventRef: 'event_review_bad_body' })), /review body/u)
  const reviewed = fx.service.executeCommand(fx.reviewerExecution, reviewCommand)
  assert.equal(reviewed.task.revision, 10)
  assert.equal(fx.store.getReview({ projectRef, reviewRef: 'review_approved' }).verdict, 'approved')
  const done = fx.service.executeCommand(fx.ownerExecution, command('transition', 10, { to: 'done', attemptRef: 'attempt_second', reviewRef: 'review_approved' }))
  assert.equal(done.task.status, 'done')
  for (const [execution, original, first] of [[fx.agentExecution, startSecond, startedSecond], [fx.agentExecution, submitSecond, submittedSecond], [fx.reviewerExecution, reviewCommand, reviewed]]) {
    const replayed = fx.service.executeCommand(execution, original)
    assert.equal(replayed.duplicate, true)
    assert.equal(replayed.projectRevision, first.projectRevision)
    assert.equal(replayed.task.revision, first.task.revision, 'receipt is historical, not the current done task')
  }
  assert.deepEqual(fx.service.getCommandReceipt(fx.agentExecution, { projectRef, commandId: startSecond.commandId }), { ...startedSecond, duplicate: false })
  assert.deepEqual(fx.service.getCommandReceipt(fx.reviewerExecution, { projectRef, commandId: reviewCommand.commandId }), { ...reviewed, duplicate: false })
  assert.throws(() => fx.service.getCommandReceipt(fx.otherAgentExecution, { projectRef, commandId: reviewCommand.commandId }), error => error.code === 'PROJECT_TASK_FORBIDDEN')
}))

test('a later requirement change invalidates submitted attempts and supersedes existing reviews', async () => usingFixture(async fx => {
  await createAssigned(fx)
  fx.service.execute(fx.agentExecution, command('claim', 2))
  const staleStart = command('attempt.start', 3, { attemptRef: 'attempt_reviewed' })
  const staleSubmit = command('attempt.submit', 4, { attemptRef: 'attempt_reviewed' })
  const staleReview = command('review', 6, { reviewRef: 'review_then_stale', attemptRef: 'attempt_reviewed', verdict: 'approved' })
  fx.service.executeCommand(fx.agentExecution, staleStart)
  fx.service.executeCommand(fx.agentExecution, staleSubmit)
  fx.service.executeCommand(fx.agentExecution, command('transition', 5, { to: 'in_review', attemptRef: 'attempt_reviewed' }))
  fx.service.executeCommand(fx.reviewerExecution, staleReview)
  fx.service.execute(fx.ownerExecution, command('edit_requirements', 7, { requirements: { acceptance: 'new approval required' } }))
  assert.equal(fx.store.getAttempt({ projectRef, attemptRef: 'attempt_reviewed' }).invalidated, true)
  assert.equal(fx.store.getReview({ projectRef, reviewRef: 'review_then_stale' }).superseded, true)
  assert.equal(fx.service.executeCommand(fx.agentExecution, staleStart).duplicate, true)
  assert.equal(fx.service.executeCommand(fx.agentExecution, staleSubmit).duplicate, true)
  assert.equal(fx.service.executeCommand(fx.reviewerExecution, staleReview).duplicate, true)
  assert.throws(() => fx.service.execute(fx.ownerExecution, command('transition', 8, { to: 'done', attemptRef: 'attempt_reviewed', reviewRef: 'review_then_stale' })), error => error.code === 'PROJECT_TASK_ATTEMPT_INVALID' || error.code === 'PROJECT_TASK_REQUIREMENTS_STALE')
}))

test('claim and transition to in_progress derive blockers from persisted block relations', async () => usingFixture(async fx => {
  const blockedTaskRef = `task_${'B'.repeat(24)}`
  fx.service.executeCommand(fx.ownerExecution, command('create', 0, { title: 'Blocker' }))
  fx.service.executeCommand(fx.ownerExecution, command('create', 0, { title: 'Blocked' }, { taskRef: blockedTaskRef, commandId: 'command_create_blocked', eventRef: 'event_create_blocked' }))
  fx.service.executeCommand(fx.ownerExecution, command('relation.add', 1, { relationRef: 'relation_blocks', targetTaskRef: blockedTaskRef, relationType: 'blocks' }))
  const assignBlocked = command('assign', 1, {}, { taskRef: blockedTaskRef, commandId: 'command_assign_blocked', eventRef: 'event_assign_blocked' })
  fx.service.executeCommand(fx.ownerExecution, assignBlocked, { targetExecution: fx.agentExecution })
  assert.throws(() => fx.service.executeCommand(fx.agentExecution, command('claim', 2, {}, { taskRef: blockedTaskRef, commandId: 'command_claim_blocked', eventRef: 'event_claim_blocked' })), error => error.code === 'PROJECT_TASK_DEPENDENCY_BLOCKED' && error.blockedBy.includes(taskRef))
  assert.throws(() => fx.service.executeCommand(fx.ownerExecution, command('transition', 2, { to: 'in_progress' }, { taskRef: blockedTaskRef, commandId: 'command_transition_blocked', eventRef: 'event_transition_blocked' })), error => error.code === 'PROJECT_TASK_DEPENDENCY_BLOCKED' && error.blockedBy.includes(taskRef))
  assert.throws(() => fx.service.executeCommand(fx.ownerExecution, command('transition', 2, { to: 'in_progress', blockedBy: [] }, { taskRef: blockedTaskRef, commandId: 'command_payload_blockers', eventRef: 'event_payload_blockers' })), /unsupported fields/u)
}))

test('relations are persisted atomically and ordering cycles are rejected', async () => usingFixture(async fx => {
  fx.service.execute(fx.ownerExecution, command('create', 0, { title: 'First' }))
  const secondTaskRef = `task_${'U'.repeat(24)}`
  fx.service.execute(fx.ownerExecution, command('create', 0, { title: 'Second' }, { taskRef: secondTaskRef, commandId: 'command_create_second', eventRef: 'event_create_second' }))
  fx.service.execute(fx.ownerExecution, command('relation.add', 1, { relationRef: 'relation_first', targetTaskRef: secondTaskRef, relationType: 'blocks' }))
  assert.equal(fx.store.listRelations({ projectRef }).length, 1)
  assert.throws(() => fx.service.execute(fx.ownerExecution, command('relation.add', 1, { relationRef: 'relation_cycle', targetTaskRef: taskRef, relationType: 'blocks' }, { taskRef: secondTaskRef, commandId: 'command_cycle', eventRef: 'event_cycle' })), error => error.code === 'PROJECT_TASK_RELATION_CYCLE')
  assert.equal(fx.store.listRelations({ projectRef }).length, 1)
}))

test('collaboration service enforces coordinator, owning-root member scope, handoff target, and safe task workflow projection', async () => usingFixture(async fx => {
  const collaboration = new fx.serviceMod.ProjectCollaborationService({ store: fx.store, actorResolver: fx.actorResolver, now: fx.now })
  fx.service.execute(fx.ownerExecution, command('create', 0, { title: 'Shared project task' }))
  fx.service.execute(fx.ownerExecution, command('assign', 1), { targetExecution: fx.agentExecution })
  collaboration.createBoard(fx.ownerExecution, { projectRef, title: 'Shared collaboration' })
  collaboration.upsertSeat(fx.ownerExecution, { projectRef, actorRef: 'actor_owner', expectedRevision: 0, kind: 'root', duty: 'Coordinate', resourceScope: ['src'], phase: 'build', nextStep: 'Review' })
  collaboration.upsertSeat(fx.ownerExecution, { projectRef, actorRef: 'actor_agent', expectedRevision: 0, kind: 'root', duty: 'Implement', resourceScope: ['src/core'], phase: 'build', nextStep: 'Submit' })
  assert.throws(() => collaboration.upsertSeat(fx.agentExecution, { projectRef, actorRef: 'actor_other_agent', expectedRevision: 0, kind: 'member', parentActorRef: 'actor_other_agent', duty: 'Forge', resourceScope: [], phase: 'x', nextStep: 'x' }), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')
  collaboration.acquireLock(fx.agentExecution, { projectRef, resourceRef: 'src/core', taskRef })
  assert.throws(() => collaboration.acquireLock(fx.otherAgentExecution, { projectRef, resourceRef: 'src/core/file.js', taskRef }), error => ['PROJECT_COLLABORATION_FORBIDDEN', 'PROJECT_COLLABORATION_RESOURCE_CONFLICT'].includes(error.code))
  collaboration.addEvidence(fx.agentExecution, { projectRef, evidenceRef: 'evidence_service', taskRef, path: 'tests/core.test.cjs', digest: `sha256:${'f'.repeat(64)}`, summary: 'passed' })
  collaboration.prepareHandoff(fx.agentExecution, { projectRef, handoffRef: 'handoff_service', taskRef, targetActorRef: 'actor_owner', summary: 'ready' })
  assert.throws(() => collaboration.commitHandoff(fx.otherAgentExecution, { projectRef, handoffRef: 'handoff_service' }), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')
  collaboration.commitHandoff(fx.ownerExecution, { projectRef, handoffRef: 'handoff_service' })
  const snapshot = collaboration.snapshot(fx.ownerExecution, { projectRef })
  assert.equal(snapshot.available, true)
  assert.equal(snapshot.tasks[0].collaborationStatus, 'claimed')
  assert.equal(snapshot.totals.tasks, 1)
  assert.equal(snapshot.permissions.canAssign, true)
  assert.equal(snapshot.collaboration.evidence[0].path, 'tests/core.test.cjs')
  assert.throws(() => collaboration.snapshot(fx.ownerExecution, { projectRef: `project_${'X'.repeat(24)}` }), error => error.code === 'PROJECT_TASK_ACTOR_UNRESOLVED')
}))

test('agent project_lead coordinates roots while participants stay task-scoped and Team members fail closed', async () => usingFixture(async fx => {
  const collaboration = new fx.serviceMod.ProjectCollaborationService({ store: fx.store, actorResolver: fx.actorResolver, now: fx.now })
  collaboration.createBoard(fx.leadExecution, { projectRef, title: 'Agent-led project' })
  collaboration.upsertSeat(fx.leadExecution, { projectRef, actorRef: 'actor_project_lead', expectedRevision: 0, kind: 'root', duty: 'Coordinate', resourceScope: ['src'], phase: 'build', nextStep: 'Review' })
  collaboration.upsertSeat(fx.leadExecution, { projectRef, actorRef: 'actor_agent', expectedRevision: 0, kind: 'root', duty: 'Implement', resourceScope: ['src/feature'], phase: 'build', nextStep: 'Submit' })
  collaboration.upsertSeat(fx.leadExecution, { projectRef, actorRef: 'actor_team_member', expectedRevision: 0, kind: 'member', parentActorRef: 'actor_agent', duty: 'Assist', resourceScope: ['src/feature/test'], phase: 'build', nextStep: 'Report' })
  const permissions = collaboration.snapshot(fx.leadExecution, { projectRef }).permissions
  assert.deepEqual({ create: permissions.canCreate, assign: permissions.canAssign, review: permissions.canReview, resolve: permissions.canResolveConflict }, { create: true, assign: true, review: true, resolve: true })
  assert.throws(() => collaboration.upsertSeat(fx.agentExecution, { projectRef, actorRef: 'actor_project_lead', expectedRevision: 1, kind: 'root', duty: 'Take over', resourceScope: ['src'], phase: 'build', nextStep: 'Forge' }), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')
  assert.throws(() => collaboration.snapshot(fx.teamExecution, { projectRef }), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')

  fx.service.execute(fx.leadExecution, command('create', 0, { title: 'Lead-created task' }))
  fx.service.execute(fx.leadExecution, command('assign', 1), { targetExecution: fx.agentExecution })
  assert.throws(() => fx.service.execute(fx.otherAgentExecution, command('edit_requirements', 2, { title: 'foreign edit' })), error => error.code === 'PROJECT_TASK_FORBIDDEN')
  fx.service.execute(fx.agentExecution, command('claim', 2))
  fx.service.execute(fx.agentExecution, command('attempt.start', 3, { attemptRef: 'attempt_lead_review' }))
  fx.service.execute(fx.agentExecution, command('attempt.submit', 4, { attemptRef: 'attempt_lead_review' }))
  fx.service.execute(fx.agentExecution, command('transition', 5, { to: 'in_review', attemptRef: 'attempt_lead_review' }))
  fx.service.execute(fx.leadExecution, command('review', 6, { attemptRef: 'attempt_lead_review', reviewRef: 'review_by_lead', verdict: 'approved' }))
  const done = fx.service.execute(fx.leadExecution, command('transition', 7, { to: 'done', attemptRef: 'attempt_lead_review', reviewRef: 'review_by_lead' }))
  assert.equal(done.task.status, 'done')
  assert.throws(() => fx.service.execute(fx.teamExecution, command('create', 0, { title: 'Team impersonation' }, { taskRef: 'task_team_forbidden', commandId: 'command_team_forbidden', eventRef: 'event_team_forbidden' })), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')
}))

test('collaboration request service derives routes and fences deadline takeover to project_lead', async () => usingFixture(async fx => {
  const collaboration = new fx.serviceMod.ProjectCollaborationService({ store: fx.store, actorResolver: fx.actorResolver, now: fx.now })
  collaboration.createBoard(fx.leadExecution, { projectRef, title: 'Requests' })
  const blockedTaskRef='task_requester_blocked', dependencyTaskRef='task_target_dependency'
  const add=(ref,actor,status,id)=>fx.store.createTask({projectRef,commandId:`command_request_${id}`,eventRef:`event_request_${id}`,actorRef:actor,expectedRevision:0,createdAt:10,task:{taskRef:ref,status,ownerActorRef:actor,assigneeActorRef:actor,title:ref,requirements:{},fileScope:[]},eventPayload:{}})
  add(blockedTaskRef,'actor_agent','blocked','blocked'); add(dependencyTaskRef,'actor_other_agent','todo','dependency')
  fx.store.database.prepare('UPDATE project_tasks SET owner_actor_ref=? WHERE project_ref=? AND task_ref=?').run('actor_dependency_owner',projectRef,dependencyTaskRef)
  fx.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/service-assignee-lock', ownerActorRef: 'actor_other_agent', taskRef: dependencyTaskRef, updatedAt: 10 })
  fx.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/service-owner-lock', ownerActorRef: 'actor_dependency_owner', taskRef: dependencyTaskRef, updatedAt: 10 })
  fx.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/service-unrelated-lock', ownerActorRef: 'actor_team_member', taskRef: dependencyTaskRef, updatedAt: 10 })
  fx.store.database.prepare("INSERT INTO project_task_relations(project_ref,relation_ref,source_task_ref,target_task_ref,type,created_by_actor_ref,created_at) VALUES(?,?,?,?,?,?,?)").run(projectRef,'relation_service_request',dependencyTaskRef,blockedTaskRef,'blocks','actor_project_lead',11)
  const input={projectRef,requestRef:'request_service',requestId:'request_service_id',kind:'release',taskRef:blockedTaskRef,dependencyTaskRef,reason:'blocked by owner',respondByAt:1_900_000_000_000}
  assert.throws(()=>collaboration.requestCollaboration(fx.teamExecution,input),error=>error.code==='PROJECT_COLLABORATION_FORBIDDEN')
  assert.throws(()=>collaboration.requestCollaboration(fx.agentExecution,{...input,targetActorRef:'actor_forged'}),error=>error.code==='PROJECT_COLLABORATION_FORBIDDEN')
  assert.throws(()=>collaboration.requestCollaboration(fx.leadExecution,{...input,requestRef:'request_lead_nonowner',requestId:'request_lead_nonowner_id'}),error=>error.code==='PROJECT_COLLABORATION_FORBIDDEN', 'project_lead authority cannot fabricate another root request')
  const opened=collaboration.requestCollaboration(fx.agentExecution,input)
  assert.equal(opened.request.targetActorRef,'actor_other_agent')
  assert.deepEqual({ mine: opened.request.mine, targetedToMe: opened.request.targetedToMe, escalationEligible: opened.request.escalationEligible }, { mine: true, targetedToMe: false, escalationEligible: false })
  const fullSnapshot = fx.store.readCollaborationSnapshot
  fx.store.readCollaborationSnapshot = () => { throw new Error('request decoration must not materialize the full collaboration snapshot') }
  let targeted, coordinatorView
  try {
    targeted = collaboration.collaborationRequestWindow(fx.otherAgentExecution,{projectRef}).requests.find(request=>request.requestRef===input.requestRef)
    coordinatorView = collaboration.collaborationRequestWindow(fx.leadExecution,{projectRef}).requests.find(request=>request.requestRef===input.requestRef)
  } finally { fx.store.readCollaborationSnapshot = fullSnapshot }
  assert.deepEqual({ mine: targeted.mine, targetedToMe: targeted.targetedToMe, escalationEligible: targeted.escalationEligible }, { mine: false, targetedToMe: true, escalationEligible: false })
  assert.equal(coordinatorView.escalationEligible, false, 'coordinator and effective target lookups remain exact without a full snapshot')
  assert.equal(collaboration.requestCollaboration(fx.agentExecution,{...input,requestRef:'request_service_repeat',requestId:'request_service_repeat_id'}).duplicate,true)
  assert.throws(()=>collaboration.resolveCollaborationRequest(fx.agentExecution,{projectRef,requestRef:input.requestRef,expectedRevision:1,resolution:'steal'}),error=>error.code==='PROJECT_COLLABORATION_FORBIDDEN')
  assert.throws(()=>collaboration.resolveCollaborationRequest(fx.leadExecution,{projectRef,requestRef:input.requestRef,expectedRevision:1,resolution:'too early'}),error=>error.code==='PROJECT_COLLABORATION_DEADLINE_PENDING')
  assert.throws(()=>collaboration.respondCollaborationRequest(fx.agentExecution,{projectRef,requestRef:input.requestRef,expectedRevision:1,action:'release',resolution:'forged response'}),error=>error.code==='PROJECT_COLLABORATION_FORBIDDEN')
  const result=collaboration.respondCollaborationRequest(fx.otherAgentExecution,{projectRef,requestRef:input.requestRef,expectedRevision:1,action:'release',resolution:'released'})
  assert.equal(result.request.state,'resolved')
  assert.equal(fx.store.getTask({projectRef,taskRef:dependencyTaskRef}).ownerActorRef,'actor_agent')
  const responseLockOwners = Object.fromEntries(fx.store.readCollaborationSnapshot({ projectRef }).locks.filter(lock => lock.taskRef === dependencyTaskRef).map(lock => [lock.resourceRef, lock.ownerActorRef]))
  assert.deepEqual(responseLockOwners, { 'src/service-assignee-lock': 'actor_agent', 'src/service-owner-lock': 'actor_agent', 'src/service-unrelated-lock': 'actor_team_member' })
  add('task_lead_blocked','actor_project_lead','blocked','lead_blocked'); add('task_lead_dependency','actor_other_agent','todo','lead_dependency')
  fx.store.database.prepare('UPDATE project_tasks SET owner_actor_ref=? WHERE project_ref=? AND task_ref=?').run('actor_lead_dependency_owner',projectRef,'task_lead_dependency')
  fx.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/service-deadline-assignee-lock', ownerActorRef: 'actor_other_agent', taskRef: 'task_lead_dependency', updatedAt: 12 })
  fx.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/service-deadline-owner-lock', ownerActorRef: 'actor_lead_dependency_owner', taskRef: 'task_lead_dependency', updatedAt: 12 })
  fx.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/service-deadline-unrelated-lock', ownerActorRef: 'actor_team_member', taskRef: 'task_lead_dependency', updatedAt: 12 })
  fx.store.database.prepare("INSERT INTO project_task_relations(project_ref,relation_ref,source_task_ref,target_task_ref,type,created_by_actor_ref,created_at) VALUES(?,?,?,?,?,?,?)").run(projectRef,'relation_lead_waiter','task_lead_dependency','task_lead_blocked','blocks','actor_project_lead',12)
  const leadRequest={projectRef,requestRef:'request_lead_waiter',requestId:'request_lead_waiter_id',kind:'takeover',taskRef:'task_lead_blocked',dependencyTaskRef:'task_lead_dependency',reason:'lead genuinely waits',respondByAt:1_900_000_000_000}
  assert.equal(collaboration.requestCollaboration(fx.leadExecution,leadRequest).request.requesterActorRef,'actor_project_lead')
  assert.throws(()=>collaboration.resolveCollaborationRequest(fx.leadExecution,{projectRef,requestRef:leadRequest.requestRef,expectedRevision:1,resolution:'payload bypass',authorizedEarly:true}),error=>error.code==='PROJECT_COLLABORATION_FORBIDDEN')
  const hostAuthorized = new fx.serviceMod.ProjectCollaborationService({ store: fx.store, actorResolver: fx.actorResolver, now: fx.now, earlyResolutionAuthorizer: ({execution}) => execution === fx.leadExecution })
  const earlyWindow = hostAuthorized.collaborationRequestWindow(fx.leadExecution,{projectRef})
  assert.equal(earlyWindow.requests.find(request=>request.requestRef===leadRequest.requestRef).escalationEligible,true)
  const earlyResolved = hostAuthorized.resolveCollaborationRequest(fx.leadExecution,{projectRef,requestRef:leadRequest.requestRef,expectedRevision:1,resolution:'direct human authorized early'})
  assert.equal(earlyResolved.request.state,'escalated')
  assert.equal(earlyResolved.request.escalationEligible,false)
  const deadlineLockOwners = Object.fromEntries(fx.store.readCollaborationSnapshot({ projectRef }).locks.filter(lock => lock.taskRef === 'task_lead_dependency').map(lock => [lock.resourceRef, lock.ownerActorRef]))
  assert.deepEqual(deadlineLockOwners, { 'src/service-deadline-assignee-lock': 'actor_project_lead', 'src/service-deadline-owner-lock': 'actor_project_lead', 'src/service-deadline-unrelated-lock': 'actor_team_member' })
  assert.equal(collaboration.collaborationRequestWindow(fx.ownerExecution,{projectRef}).totalRequests,2)
}))

test('project_lead reserves seat and task before effects and exact ordinary root adopts with one-time capability', async () => usingFixture(async fx => {
  const collaboration = new fx.serviceMod.ProjectCollaborationService({ store: fx.store, actorResolver: fx.actorResolver, now: fx.now })
  collaboration.createBoard(fx.leadExecution, { projectRef, title: 'Root launch board' })
  const reservation = { projectRef, requestId: 'reserve_root_request', slotActorRef: 'actor_reserved_other_root', slotCapability: 'opaque_slot_capability_abcdefghijklmnopqrstuvwxyz', duty: 'Own feature', resourceScope: ['src/root'], phase: 'queued', nextStep: 'Adopt', task: { taskRef: 'task_reserved_other_root', title: 'Initial root work', requirements: { acceptance: 'pass' }, fileScope: ['src/root'] } }
  assert.throws(() => collaboration.reserveRootSeat(fx.agentExecution, reservation), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')
  const reserved = collaboration.reserveRootSeat(fx.leadExecution, reservation)
  assert.equal(reserved.seat.state, 'reserved')
  assert.equal(reserved.task.assigneeActorRef, reservation.slotActorRef)
  assert.equal(collaboration.reserveRootSeat(fx.leadExecution, reservation).duplicate, true)
  assert.throws(() => collaboration.adoptRootSeat(fx.leadExecution, reservation), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')
  assert.throws(() => collaboration.adoptRootSeat(fx.teamExecution, reservation), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')
  assert.throws(() => collaboration.adoptRootSeat(fx.otherAgentExecution, { ...reservation, slotCapability: 'wrong_capability_abcdefghijklmnopqrstuvwxyz' }), error => error.code === 'PROJECT_COLLABORATION_CAPABILITY_INVALID')
  const adopted = collaboration.adoptRootSeat(fx.otherAgentExecution, reservation)
  assert.equal(adopted.seat.actorRef, 'actor_other_agent')
  assert.equal(adopted.task.ownerActorRef, 'actor_other_agent')
  assert.equal(adopted.task.assigneeActorRef, 'actor_other_agent')
  assert.throws(() => collaboration.adoptRootSeat(fx.agentExecution, reservation), error => error.code === 'PROJECT_COLLABORATION_CAPABILITY_INVALID')
}))

test('root recovery separates the Host-bound launch initiator from the failed beneficiary', async () => usingFixture(async fx => {
  const collaboration=new fx.serviceMod.ProjectCollaborationService({store:fx.store,actorResolver:fx.actorResolver,now:fx.now,rootFailureResolver:({execution,failureRef})=>execution===fx.leadExecution&&failureRef==='host-failure-1'?{failedActorRef:'actor_agent',beneficiaryActorRef:'actor_agent',initiatorAuthorized:true,failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'Host operation one definitively failed'}:undefined})
  collaboration.createBoard(fx.leadExecution,{projectRef,title:'Recovery'})
  collaboration.upsertSeat(fx.leadExecution,{projectRef,actorRef:'actor_agent',expectedRevision:0,kind:'root',state:'active',duty:'Worker',resourceScope:['src/recovery'],phase:'working',nextStep:'Continue'})
  assert.throws(()=>collaboration.prepareRootRecovery(fx.leadExecution,{projectRef,recoveryRef:'recovery_forged',requestId:'recovery_forged',mode:'retry',failureRef:'host-failure-1',failureCode:'FORGED'}),/Host-derived/u)
  assert.throws(()=>collaboration.prepareRootRecovery(fx.agentExecution,{projectRef,recoveryRef:'recovery_wrong_owner',requestId:'recovery_wrong_owner',mode:'retry',failureRef:'host-failure-1'}),error=>error.code==='PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED')
  const prepared=collaboration.prepareRootRecovery(fx.leadExecution,{projectRef,recoveryRef:'recovery_retry',requestId:'recovery_retry_request',mode:'retry',failureRef:'host-failure-1'})
  assert.equal(prepared.recovery.state,'prepared'); assert.equal(prepared.recovery.failedActorRef,'actor_agent'); assert.equal(prepared.recovery.initiatorActorRef,'actor_project_lead'); assert.equal(prepared.recovery.beneficiaryActorRef,'actor_agent')
  assert.throws(()=>collaboration.prepareRootRecovery(fx.leadExecution,{projectRef,recoveryRef:'recovery_missing',requestId:'recovery_missing',mode:'retry',failureRef:'unknown'}),error=>error.code==='PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED')
}))

test('claimNextTask derives the exact root actor, rejects Team members, and prevents active-task hoarding', async () => usingFixture(async fx => {
  fx.service.execute(fx.ownerExecution, command('create', 0, { title: 'Queue one' }, { taskRef: 'task_queue_one', commandId: 'command_queue_one', eventRef: 'event_queue_one' }))
  fx.service.execute(fx.ownerExecution, command('create', 0, { title: 'Queue two' }, { taskRef: 'task_queue_two', commandId: 'command_queue_two', eventRef: 'event_queue_two' }))
  const collaboration = new fx.serviceMod.ProjectCollaborationService({ store: fx.store, actorResolver: fx.actorResolver, now: fx.now })
  assert.throws(() => collaboration.claimNextTask(fx.teamExecution, { projectRef, requestId: 'team-cannot-claim-next' }), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')
  const first = collaboration.claimNextTask(fx.agentExecution, { projectRef, requestId: 'agent-claim-next-1' })
  assert.equal(first.status, 'claimed')
  assert.equal(first.task.assigneeActorRef, 'actor_agent')
  const occupied = collaboration.claimNextTask(fx.agentExecution, { projectRef, requestId: 'agent-claim-next-2' })
  assert.equal(occupied.status, 'temporarily_empty')
  assert.deepEqual(occupied.blockers, [first.task.taskRef])
  const other = collaboration.claimNextTask(fx.otherAgentExecution, { projectRef, requestId: 'other-agent-claim-next' })
  assert.equal(other.status, 'claimed')
  assert.notEqual(other.task.taskRef, first.task.taskRef)
}))

test('manual claim cannot give one root a second in_progress task', async () => usingFixture(async fx => {
  const make = suffix => fx.service.execute(fx.ownerExecution, command('create', 0, { title: `Manual ${suffix}` }, { taskRef: `task_manual_${suffix}`, commandId: `command_manual_create_${suffix}`, eventRef: `event_manual_create_${suffix}` }))
  const first = make('one'), second = make('two')
  const claimed = fx.service.execute(fx.agentExecution, command('claim', first.task.revision, {}, { taskRef: first.task.taskRef, commandId: 'command_manual_claim_one', eventRef: 'event_manual_claim_one' }))
  assert.equal(claimed.task.status, 'in_progress')
  assert.throws(() => fx.service.execute(fx.agentExecution, command('claim', second.task.revision, {}, { taskRef: second.task.taskRef, commandId: 'command_manual_claim_two', eventRef: 'event_manual_claim_two' })), error => error.code === 'PROJECT_TASK_ACTIVE_LIMIT')
  assert.equal(fx.store.getTask({ projectRef, taskRef: second.task.taskRef }).status, 'todo')
}))
