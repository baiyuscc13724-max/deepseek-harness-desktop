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
  const actors = new Map([
    [ownerExecution, { projectRef, actorRef: 'actor_owner', kind: 'human', role: 'owner' }],
    [agentExecution, { projectRef, actorRef: 'actor_agent', kind: 'agent' }],
    [otherAgentExecution, { projectRef, actorRef: 'actor_other_agent', kind: 'agent' }],
    [reviewerExecution, { projectRef, actorRef: 'actor_reviewer_agent', kind: 'agent', authorities: ['reviewer'] }],
  ])
  const actorResolver = (execution, requestedProjectRef) => {
    const actor = actors.get(execution)
    if (actor?.projectRef !== requestedProjectRef) return undefined
    return actor
  }
  const now = () => ++clock
  const service = new serviceMod.ProjectTaskCommandService({ store, actorResolver, now })
  return { root, store, service, ownerExecution, agentExecution, reviewerExecution, otherAgentExecution, actorResolver, now, storeMod, serviceMod }
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
