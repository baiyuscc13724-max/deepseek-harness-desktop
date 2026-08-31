const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-domain.js')).href
const load = () => import(moduleUrl)

function task(overrides = {}) {
  return {
    taskRef: 'task_AAAAAAAAAAAAAAAAAAAAAAAA',
    status: 'todo',
    ownerActorRef: 'actor_owner',
    assigneeActorRef: 'actor_agent',
    revision: 4,
    requirementsRevision: 2,
    ...overrides,
  }
}

const transitionCases = {
  backlog: new Set(['todo', 'canceled']),
  todo: new Set(['backlog', 'in_progress', 'blocked', 'canceled']),
  in_progress: new Set(['todo', 'in_review', 'blocked', 'canceled']),
  in_review: new Set(['in_progress', 'blocked', 'done', 'canceled']),
  blocked: new Set(['todo', 'in_progress', 'canceled']),
  done: new Set(['todo']),
  canceled: new Set(['backlog']),
}

test('the seven-state graph admits only the declared transitions', async () => {
  const mod = await load()
  assert.deepEqual(mod.TASK_STATES, ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled'])
  for (const from of mod.TASK_STATES) {
    for (const to of mod.TASK_STATES) {
      assert.equal(mod.canTransition(from, to), transitionCases[from].has(to), `${from} -> ${to}`)
    }
  }
  assert.throws(() => mod.canTransition('unknown', 'todo'), /unsupported task status/u)
})

test('transition guards require blockers, clear dependencies, current submitted attempts, and approval', async () => {
  const mod = await load()
  assert.throws(() => mod.assertTaskTransition(task(), 'blocked'), /block reason/u)
  assert.doesNotThrow(() => mod.assertTaskTransition(task(), 'blocked', { blockReason: 'Waiting for API' }))
  assert.throws(() => mod.assertTaskTransition(task(), 'in_progress', { blockedBy: ['task_dependency'] }), /unresolved dependencies/u)

  const running = task({ status: 'in_progress' })
  const attempt = mod.createExecutionAttempt(running, { attemptRef: 'attempt_AAAAAAAAAAAAAAAAAAAA', executorActorRef: 'actor_agent' })
  assert.throws(() => mod.assertTaskTransition(running, 'in_review', { attempt }), /submitted attempt/u)
  const submitted = mod.submitExecutionAttempt(running, attempt)
  assert.doesNotThrow(() => mod.assertTaskTransition(running, 'in_review', { attempt: submitted }))

  const reviewing = task({ status: 'in_review' })
  assert.throws(() => mod.assertTaskTransition(reviewing, 'done', { attempt: submitted }), /current approved review/u)
  const approved = { reviewRef: 'review_A', attemptRef: submitted.attemptRef, verdict: 'approved', requirementsRevision: reviewing.requirementsRevision }
  assert.doesNotThrow(() => mod.assertTaskTransition(reviewing, 'done', { attempt: submitted, review: approved }))
  assert.throws(() => mod.assertTaskTransition(reviewing, 'done', { attempt: submitted, review: { ...approved, requirementsRevision: 1 } }), /current approved review/u)
})

test('RBAC distinguishes human roles and scoped agent authority', async () => {
  const mod = await load()
  const owner = { actorRef: 'actor_owner', kind: 'human', role: 'owner' }
  const maintainer = { actorRef: 'actor_maintainer', kind: 'human', role: 'maintainer' }
  const contributor = { actorRef: 'actor_contributor', kind: 'human', role: 'contributor' }
  const reviewer = { actorRef: 'actor_reviewer', kind: 'human', role: 'reviewer' }
  const observer = { actorRef: 'actor_observer', kind: 'human', role: 'observer' }
  const agent = { actorRef: 'actor_agent', kind: 'agent', role: 'contributor' }
  const otherAgent = { actorRef: 'actor_other_agent', kind: 'agent', role: 'contributor' }
  const leadAgent = { actorRef: 'actor_lead_agent', kind: 'agent', authorities: ['project_lead'] }
  const reviewerTeam = { actorRef: 'actor_reviewer_team', kind: 'team', authorities: ['reviewer'] }
  const target = task()

  assert.equal(mod.canActorPerform(owner, 'edit_requirements', target), true)
  assert.equal(mod.canActorPerform(maintainer, 'assign', target), true)
  assert.equal(mod.canActorPerform(contributor, 'claim', { ...target, assigneeActorRef: undefined }), true)
  assert.equal(mod.canActorPerform(reviewer, 'approve_review', target), true)
  assert.equal(mod.canActorPerform(observer, 'comment', target), false)
  assert.equal(mod.canActorPerform(observer, 'read', target), true)
  assert.equal(mod.canActorPerform(agent, 'submit_review', target), true)
  assert.equal(mod.canActorPerform(agent, 'edit_requirements', target), false)
  assert.equal(mod.canActorPerform(agent, 'approve_review', target), false)
  assert.equal(mod.canActorPerform(leadAgent, 'approve_review', target), true)
  assert.equal(mod.canActorPerform(leadAgent, 'create'), true)
  assert.equal(mod.canActorPerform(leadAgent, 'edit_requirements', target), true)
  assert.equal(mod.canActorPerform(leadAgent, 'assign', target), true)
  assert.equal(mod.canActorPerform(leadAgent, 'cancel', target), true)
  assert.equal(mod.canActorPerform(reviewerTeam, 'approve_review', target), true)
  assert.equal(mod.canActorPerform(otherAgent, 'comment', target), false, 'agents are scoped to their assigned task')
  assert.throws(() => mod.assertActorCan(observer, 'assign', target), error => error.code === 'PROJECT_TASK_FORBIDDEN')
})

test('revision conflicts fail closed and requirements changes advance both counters', async () => {
  const mod = await load()
  const current = task()
  assert.doesNotThrow(() => mod.assertExpectedRevision(current, 4))
  assert.throws(() => mod.assertExpectedRevision(current, 3), error => error.code === 'PROJECT_TASK_CONFLICT' && error.currentRevision === 4)
  assert.deepEqual(mod.advanceTaskRevision(current), { ...current, revision: 5 })
  assert.deepEqual(mod.advanceTaskRevision(current, { requirementsChanged: true }), { ...current, revision: 5, requirementsRevision: 3 })
  assert.equal(current.revision, 4, 'pure revision helpers do not mutate their input')
})

test('requirements changes stale attempts until the executor acknowledges the new revision', async () => {
  const mod = await load()
  const running = task({ status: 'in_progress' })
  const attempt = mod.createExecutionAttempt(running, { attemptRef: 'attempt_BBBBBBBBBBBBBBBBBBBB', executorActorRef: 'actor_agent' })
  const changed = mod.advanceTaskRevision(running, { requirementsChanged: true })
  assert.throws(() => mod.submitExecutionAttempt(changed, attempt), error => error.code === 'PROJECT_TASK_REQUIREMENTS_STALE')
  const acknowledged = mod.acknowledgeAttemptRequirements(changed, attempt, 'actor_agent')
  assert.equal(acknowledged.acceptedRequirementsRevision, changed.requirementsRevision)
  assert.equal(mod.submitExecutionAttempt(changed, acknowledged).state, 'submitted')
  assert.throws(() => mod.acknowledgeAttemptRequirements(changed, attempt, 'actor_other'), /attempt executor/u)
})

test('reviews bind current requirements and allow only explicit review authority without self approval', async () => {
  const mod = await load()
  const reviewing = task({ status: 'in_review' })
  const submitted = {
    attemptRef: 'attempt_CCCCCCCCCCCCCCCCCCCC',
    taskRef: reviewing.taskRef,
    executorActorRef: 'actor_agent',
    acceptedRequirementsRevision: reviewing.requirementsRevision,
    state: 'submitted',
  }
  const humanReviewer = { actorRef: 'actor_reviewer', kind: 'human', role: 'reviewer' }
  const executorHuman = { actorRef: 'actor_agent', kind: 'human', role: 'reviewer' }
  const ordinaryAgent = { actorRef: 'actor_reviewer_agent', kind: 'agent', role: 'reviewer' }
  const leadAgent = { actorRef: 'actor_lead_agent', kind: 'agent', authorities: ['project_lead'] }
  const reviewerTeam = { actorRef: 'actor_reviewer_team', kind: 'team', authorities: ['reviewer'] }
  const selfApprovingLead = { actorRef: 'actor_agent', kind: 'agent', authorities: ['project_lead'] }
  const approved = mod.createTaskReview(reviewing, submitted, humanReviewer, { reviewRef: 'review_B', verdict: 'approved' })
  assert.equal(approved.requirementsRevision, reviewing.requirementsRevision)
  assert.equal(mod.createTaskReview(reviewing, submitted, leadAgent, { reviewRef: 'review_lead', verdict: 'approved' }).verdict, 'approved')
  assert.equal(mod.createTaskReview(reviewing, submitted, reviewerTeam, { reviewRef: 'review_team', verdict: 'approved' }).verdict, 'approved')
  assert.throws(() => mod.createTaskReview(reviewing, submitted, executorHuman, { reviewRef: 'review_C', verdict: 'approved' }), error => error.code === 'PROJECT_TASK_SELF_APPROVAL')
  assert.throws(() => mod.createTaskReview(reviewing, submitted, selfApprovingLead, { reviewRef: 'review_self_agent', verdict: 'approved' }), error => error.code === 'PROJECT_TASK_SELF_APPROVAL')
  assert.throws(() => mod.createTaskReview(reviewing, submitted, ordinaryAgent, { reviewRef: 'review_D', verdict: 'approved' }), error => error.code === 'PROJECT_TASK_FORBIDDEN')
  assert.equal(mod.createTaskReview(reviewing, submitted, executorHuman, { reviewRef: 'review_E', verdict: 'changes_requested' }).verdict, 'changes_requested')
})

test('dependency and parent relations reject cycles while related links do not create ordering edges', async () => {
  const mod = await load()
  const acyclic = [
    { sourceTaskRef: 'task_B', targetTaskRef: 'task_A', type: 'blocks' },
    { sourceTaskRef: 'task_C', targetTaskRef: 'task_B', type: 'parent' },
    { sourceTaskRef: 'task_A', targetTaskRef: 'task_C', type: 'related' },
  ]
  assert.equal(mod.findTaskRelationCycle(acyclic), undefined)
  assert.doesNotThrow(() => mod.assertAcyclicTaskRelations(acyclic))
  const cyclic = [...acyclic, { sourceTaskRef: 'task_A', targetTaskRef: 'task_C', type: 'blocks' }]
  assert.deepEqual(mod.findTaskRelationCycle(cyclic), ['task_B', 'task_A', 'task_C', 'task_B'])
  assert.throws(() => mod.assertAcyclicTaskRelations(cyclic), error => error.code === 'PROJECT_TASK_RELATION_CYCLE')
  assert.throws(() => mod.assertAcyclicTaskRelations([{ sourceTaskRef: 'task_A', targetTaskRef: 'task_A', type: 'blocks' }]), /cannot relate a task to itself/u)
})

test('command normalization is allowlisted, bounded, and never accepts identity claims', async () => {
  const mod = await load()
  assert.deepEqual(mod.normalizeTaskCommand({
    commandId: 'command_AAAAAAAAAAAAAAAAAAAA',
    type: 'transition',
    taskRef: 'task_AAAAAAAAAAAAAAAAAAAAAAAA',
    expectedRevision: 4,
    payload: { to: 'blocked', blockReason: 'External dependency' },
  }), {
    commandId: 'command_AAAAAAAAAAAAAAAAAAAA',
    type: 'transition',
    taskRef: 'task_AAAAAAAAAAAAAAAAAAAAAAAA',
    expectedRevision: 4,
    payload: { to: 'blocked', blockReason: 'External dependency' },
  })
  assert.equal(mod.normalizeTaskCommand({ commandId: 'command_create', type: 'create', taskRef: 'task_new', expectedRevision: 0, payload: {} }).expectedRevision, 0)
  assert.throws(() => mod.normalizeTaskCommand({ commandId: 'command_create', type: 'create', taskRef: 'task_new', expectedRevision: 1, payload: {} }), /expectedRevision.*0/u)
  assert.throws(() => mod.normalizeTaskCommand({ commandId: 'command_transition', type: 'transition', taskRef: 'task_existing', expectedRevision: 0, payload: {} }), /positive safe integer/u)
  assert.throws(() => mod.normalizeTaskCommand({ commandId: 'command_AAAAAAAAAAAAAAAAAAAA', type: 'transition', taskRef: 'task_AAAAAAAAAAAAAAAAAAAAAAAA', expectedRevision: 4, actorRef: 'forged', payload: {} }), /unsupported fields/u)
  assert.throws(() => mod.normalizeTaskCommand({ commandId: 'command_AAAAAAAAAAAAAAAAAAAA', type: 'transition', taskRef: 'task_AAAAAAAAAAAAAAAAAAAAAAAA', expectedRevision: 4, payload: { sessionId: 'forged' } }), /forbidden identity field/u)
  assert.throws(() => mod.normalizeTaskCommand({ commandId: 'command_AAAAAAAAAAAAAAAAAAAA', type: 'transition', taskRef: 'task_AAAAAAAAAAAAAAAAAAAAAAAA', expectedRevision: 4, payload: { authorities: ['project_lead'] } }), /forbidden identity field/u)
  for (const type of ['create', 'edit_requirements', 'assign', 'claim', 'transition', 'comment', 'relation.add', 'dependency.add', 'dependency.remove', 'attempt.start', 'attempt.submit', 'review']) assert.equal(mod.COMMAND_TYPES.includes(type), true, type)
  let nested = { value: true }
  for (let index = 0; index < 20; index += 1) nested = { nested }
  assert.throws(() => mod.normalizeTaskCommand({ commandId: 'command_deep', type: 'comment', taskRef: 'task_deep', expectedRevision: 1, payload: nested }), /depth/u)
  assert.throws(() => mod.normalizeTaskCommand({ commandId: 'command_large', type: 'comment', taskRef: 'task_large', expectedRevision: 1, payload: { body: 'x'.repeat(70 * 1024) } }), /exceeds 65536 bytes/u)
})
