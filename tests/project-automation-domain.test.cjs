const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-automation-domain.js')).href
const load = () => import(`${moduleUrl}?test=${Date.now()}-${Math.random()}`)

function definition(overrides = {}) {
  return {
    schemaVersion: 1,
    definitionRef: 'automation_definition_A',
    revision: 3,
    status: 'enabled',
    name: 'Move one project task',
    trigger: { kind: 'manual' },
    steps: [{
      stepRef: 'step_transition_A', order: 0, kind: 'project_task.transition', taskRef: 'task_A', targetStatus: 'in_progress',
      approvalPolicy: { kind: 'one_of_roles', roles: ['owner', 'maintainer'] },
    }],
    ...overrides,
  }
}
function triggerInput(overrides = {}) {
  return {
    triggerRef: 'trigger_A', commandId: 'command_manual_A', requestedAt: '2026-08-23T22:00:00.000Z',
    input: { taskRef: 'task_A', expectedTaskRevision: 7 }, ...overrides,
  }
}
async function awaitingRun(mod, overrides = {}) {
  const def = definition()
  const trigger = mod.createManualTrigger(def, triggerInput())
  return mod.createManualRun(def, trigger, { runRef: 'run_A', createdAt: '2026-08-23T22:01:00.000Z', ...overrides })
}
const owner = { actorRef: 'human_owner', kind: 'human', role: 'owner' }
const maintainer = { actorRef: 'human_maintainer', kind: 'human', role: 'maintainer' }
function approvalInput(run, overrides = {}) {
  return { approvalRef: 'approval_A', commandId: 'command_approve_A', expectedRunRevision: run.revision, decidedAt: '2026-08-23T22:02:00.000Z', ...overrides }
}
function effectReceipt(run, overrides = {}) {
  return { effectKey: run.steps[0].effectKey, taskCommandId: run.steps[0].taskCommandId, ...overrides }
}

function assertNoUndefined(value) {
  if (Array.isArray(value)) return value.forEach(assertNoUndefined)
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    assert.notEqual(child, undefined, `${key} must not be persisted as undefined`)
    assertNoUndefined(child)
  }
}

test('v1 definitions are enabled or disabled and allow only manual plus one approved task transition', async () => {
  const mod = await load()
  const normalized = mod.normalizeAutomationDefinition(definition())
  assert.equal(mod.AUTOMATION_SCHEMA_VERSION, 1)
  assert.deepEqual(mod.DEFINITION_STATUSES, ['enabled', 'disabled'])
  assert.deepEqual(mod.TRIGGER_KINDS, ['manual'])
  assert.deepEqual(mod.STEP_KINDS, ['project_task.transition'])
  assert.deepEqual(normalized.steps[0].approvalPolicy, { kind: 'one_of_roles', roles: ['owner', 'maintainer'] })
  assert.ok(Object.isFrozen(normalized.steps[0].approvalPolicy.roles))
  assert.throws(() => mod.normalizeAutomationDefinition(definition({ schemaVersion: 2 })), error => error.code === 'PROJECT_AUTOMATION_VERSION_UNSUPPORTED')
  assert.throws(() => mod.normalizeAutomationDefinition(definition({ trigger: { kind: 'schedule' } })), error => error.code === 'PROJECT_AUTOMATION_TRIGGER_UNSUPPORTED')
  assert.throws(() => mod.normalizeAutomationDefinition(definition({ steps: [] })), error => error.code === 'PROJECT_AUTOMATION_STEP_COUNT')
  assert.throws(() => mod.normalizeAutomationDefinition(definition({ steps: [definition().steps[0], { ...definition().steps[0], stepRef: 'step_B' }] })), error => error.code === 'PROJECT_AUTOMATION_STEP_COUNT')
  assert.throws(() => mod.normalizeAutomationDefinition(definition({ steps: [{ ...definition().steps[0], kind: 'http.request' }] })), error => error.code === 'PROJECT_AUTOMATION_STEP_UNSUPPORTED')
  assert.throws(() => mod.normalizeAutomationDefinition(definition({ steps: [{ ...definition().steps[0], approvalPolicy: { kind: 'none', roles: [] } }] })), error => error.code === 'PROJECT_AUTOMATION_APPROVAL_REQUIRED')
  for (const targetStatus of ['in_review', 'done']) assert.throws(
    () => mod.normalizeAutomationDefinition(definition({ steps: [{ ...definition().steps[0], targetStatus }] })),
    error => error.code === 'PROJECT_AUTOMATION_TARGET_UNSUPPORTED'
  )
  for (const targetStatus of ['backlog', 'todo', 'in_progress', 'canceled']) assert.doesNotThrow(() => mod.normalizeAutomationDefinition(definition({ steps: [{ ...definition().steps[0], targetStatus }] })))
  assert.doesNotThrow(() => mod.normalizeAutomationDefinition(definition({ steps: [{ ...definition().steps[0], targetStatus: 'blocked', blockReason: 'Waiting for dependency' }] })))
  assert.throws(() => mod.createManualTrigger(definition({ status: 'disabled' }), triggerInput()), error => error.code === 'PROJECT_AUTOMATION_DEFINITION_DISABLED')
})

test('manual trigger is an immutable fact and Run pins definition snapshot plus task revision', async () => {
  const mod = await load()
  const def = definition()
  const trigger = mod.createManualTrigger(def, triggerInput())
  assert.equal(trigger.kind, 'manual')
  assert.equal('status' in trigger, false, 'trigger is an immutable fact, not a running state machine')
  assert.match(trigger.inputHash, /^[a-f0-9]{64}$/u)
  const run = mod.createManualRun(def, trigger, { runRef: 'run_A', createdAt: '2026-08-23T22:01:00.000Z' })
  assert.equal(run.status, 'awaiting_approval')
  assert.equal(run.definitionRevision, 3)
  assert.deepEqual(run.definitionSnapshot, mod.normalizeAutomationDefinition(def))
  assert.equal(run.steps[0].expectedTaskRevision, 7)
  assert.equal(run.steps[0].status, 'awaiting_approval')
  assert.equal(run.steps[0].taskCommandId, run.steps[0].effectKey)
  assert.throws(() => mod.createManualRun({ ...def, revision: 4 }, trigger, { runRef: 'run_B', createdAt: '2026-08-23T22:01:00.000Z' }), error => error.code === 'PROJECT_AUTOMATION_DEFINITION_STALE')
  assert.throws(() => mod.createManualTrigger(def, triggerInput({ input: { taskRef: 'task_B', expectedTaskRevision: 7 } })), error => error.code === 'PROJECT_AUTOMATION_INPUT_INVALID')
  assert.deepEqual(mod.normalizeManualTrigger(def, trigger), trigger)
  for (const forged of [
    { ...trigger, extra: true },
    { ...trigger, kind: 'schedule' },
    { ...trigger, definitionRef: 'definition_other' },
    { ...trigger, definitionRevision: 2 },
    { ...trigger, input: { ...trigger.input, taskRef: 'task_B' } },
    { ...trigger, input: { ...trigger.input, expectedTaskRevision: 0 } },
    { ...trigger, inputHash: '0'.repeat(64) },
  ]) assert.throws(() => mod.createManualRun(def, forged, { runRef: 'run_forged', createdAt: '2026-08-23T22:01:00.000Z' }))
})

test('run and step transition tables include approval, queue, running, terminal, and cancel-requested edges', async () => {
  const mod = await load()
  assert.deepEqual(mod.RUN_STATUSES, ['awaiting_approval', 'queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'canceled'])
  assert.deepEqual(mod.STEP_STATUSES, ['awaiting_approval', 'queued', 'running', 'succeeded', 'failed', 'canceled'])
  assert.deepEqual(mod.RUN_TRANSITIONS.awaiting_approval, ['queued', 'canceled'])
  assert.deepEqual(mod.RUN_TRANSITIONS.queued, ['running', 'canceled'])
  assert.deepEqual(mod.RUN_TRANSITIONS.running, ['succeeded', 'failed', 'cancel_requested'])
  assert.deepEqual(mod.RUN_TRANSITIONS.cancel_requested, ['succeeded', 'failed', 'canceled'])
  assert.deepEqual(mod.STEP_TRANSITIONS.awaiting_approval, ['queued', 'canceled'])
  assert.deepEqual(mod.STEP_TRANSITIONS.running, ['succeeded', 'failed', 'canceled'], 'receipt-confirmed not_committed can cancel a running step')
  assert.deepEqual(mod.STEP_TRANSITIONS.failed, ['queued'])
  assert.deepEqual(mod.APPROVAL_DECISIONS, ['approved', 'rejected'])
})

test('approval is a human decision fact and approved work queues without starting', async () => {
  const mod = await load()
  const run = await awaitingRun(mod)
  const approved = mod.approveRun(run, approvalInput(run), owner)
  assert.equal(approved.approval.decision, 'approved')
  assert.equal(approved.approval.actorRef, owner.actorRef)
  assert.equal(approved.run.status, 'queued')
  assert.equal(approved.run.steps[0].status, 'queued')
  assert.equal(approved.run.startedAt, undefined, 'approval never starts the effect')
  assert.equal(mod.markStepRunning(approved.run, { startedAt: '2026-08-23T22:03:00.000Z' }).status, 'running')
  const rejected = mod.rejectRun(run, approvalInput(run, { commandId: 'command_reject_A' }), maintainer)
  assert.equal(rejected.approval.decision, 'rejected')
  assert.equal(rejected.run.status, 'canceled')
  assert.equal(rejected.run.steps[0].finishedAt, rejected.approval.decidedAt)
  assert.deepEqual(mod.normalizePersistedRun(rejected.run), rejected.run)
  for (const actor of [
    { actorRef: 'human_contributor', kind: 'human', role: 'contributor' },
    { actorRef: 'agent_owner', kind: 'agent', role: 'owner' },
    { actorRef: 'system_owner', kind: 'system', role: 'owner' },
  ]) {
    const terminal = { ...run, status: 'succeeded' }
    const stale = approvalInput(run, { expectedRunRevision: 999 })
    assert.throws(() => mod.approveRun(terminal, stale, actor), error => error.code === 'PROJECT_AUTOMATION_APPROVAL_FORBIDDEN')
    assert.throws(() => mod.rejectRun(terminal, stale, actor), error => error.code === 'PROJECT_AUTOMATION_APPROVAL_FORBIDDEN')
  }
  assert.throws(() => mod.approveRun(run, approvalInput(run, { expectedRunRevision: 99 }), owner), error => error.code === 'PROJECT_AUTOMATION_CONFLICT')
})

test('cancel before execution is terminal while running cancel waits for authoritative receipt', async () => {
  const mod = await load()
  const awaiting = await awaitingRun(mod)
  const canceledEarly = mod.requestRunCancel(awaiting, { commandId: 'command_cancel_early', expectedRunRevision: awaiting.revision, requestedAt: '2026-08-23T22:02:00.000Z' }, owner)
  assert.equal(canceledEarly.status, 'canceled')
  assert.equal(canceledEarly.steps[0].status, 'canceled')
  const queued = mod.approveRun(awaiting, approvalInput(awaiting), owner).run
  assert.equal(mod.requestRunCancel(queued, { commandId: 'command_cancel_queued', expectedRunRevision: queued.revision, requestedAt: '2026-08-23T22:03:00.000Z' }, owner).status, 'canceled')
  const running = mod.markStepRunning(queued, { startedAt: '2026-08-23T22:03:00.000Z' })
  const requested = mod.requestRunCancel(running, { commandId: 'command_cancel_running', expectedRunRevision: running.revision, requestedAt: '2026-08-23T22:04:00.000Z' }, owner)
  assert.equal(requested.status, 'cancel_requested')
  assert.equal(requested.steps[0].status, 'running', 'a running effect is never falsely rolled back')
  for (const actor of [{ actorRef: 'contributor', kind: 'human', role: 'contributor' }, { actorRef: 'agent', kind: 'agent', role: 'owner' }, { actorRef: 'system', kind: 'system', role: 'owner' }]) {
    assert.throws(() => mod.requestRunCancel(running, { commandId: 'unauthorized_cancel', expectedRunRevision: 999, requestedAt: '2026-08-23T22:04:00.000Z' }, actor), error => error.code === 'PROJECT_AUTOMATION_APPROVAL_FORBIDDEN')
  }
  assert.throws(() => mod.requestRunCancel({ ...running, status: 'succeeded' }, { commandId: 'again', expectedRunRevision: running.revision, requestedAt: '2026-08-23T22:04:00.000Z' }, owner), error => error.code === 'PROJECT_AUTOMATION_CANCEL_FORBIDDEN')
})

test('receipt-first reconciliation never repeats unknown effects and committed success beats cancellation', async () => {
  const mod = await load()
  const awaiting = await awaitingRun(mod)
  const queued = mod.approveRun(awaiting, approvalInput(awaiting), owner).run
  const running = mod.markStepRunning(queued, { startedAt: '2026-08-23T22:03:00.000Z' })
  const requested = mod.requestRunCancel(running, { commandId: 'cancel', expectedRunRevision: running.revision, requestedAt: '2026-08-23T22:04:00.000Z' }, owner)
  assert.equal(mod.reconcileRunFromEffectReceipt(requested, effectReceipt(requested, { status: 'unknown' })), requested, 'unknown returns the exact run and schedules no new side effect')
  const committed = mod.reconcileRunFromEffectReceipt(requested, effectReceipt(requested, { status: 'succeeded', resultReceiptRef: 'receipt_A', finishedAt: '2026-08-23T22:05:00.000Z' }))
  assert.equal(committed.status, 'succeeded')
  assert.equal(committed.steps[0].resultReceiptRef, 'receipt_A')
  const uncommitted = mod.reconcileRunFromEffectReceipt(requested, effectReceipt(requested, { status: 'not_committed', finishedAt: '2026-08-23T22:05:00.000Z' }))
  assert.equal(uncommitted.status, 'canceled')
  assert.throws(() => mod.reconcileRunFromEffectReceipt(running, effectReceipt(running, { status: 'not_committed', finishedAt: '2026-08-23T22:05:00.000Z' })), error => error.code === 'PROJECT_AUTOMATION_RECEIPT_INVALID')
  assert.throws(() => mod.reconcileRunFromEffectReceipt(requested, { ...effectReceipt(requested, { status: 'unknown' }), effectKey: 'autoeff_wrong' }), error => error.code === 'PROJECT_AUTOMATION_RECEIPT_CONFLICT')
})

test('retry requires an explicit retryable failure and preserves effectKey, task command, and task revision', async () => {
  const mod = await load()
  const awaiting = await awaitingRun(mod)
  const queued = mod.approveRun(awaiting, approvalInput(awaiting), owner).run
  const running = mod.markStepRunning(queued, { startedAt: '2026-08-23T22:03:00.000Z' })
  const retryable = mod.failStep(running, { errorCode: 'PROVIDER_TEMPORARY', retryable: true, finishedAt: '2026-08-23T22:04:00.000Z' })
  const retried = mod.retryFailedStep(definition(), retryable, { commandId: 'command_retry_A', expectedRunRevision: retryable.revision, requestedAt: '2026-08-23T22:05:00.000Z' }, maintainer)
  assert.equal(retried.status, 'queued')
  assert.equal(retried.steps[0].attempt, retryable.steps[0].attempt + 1)
  assert.equal(retried.steps[0].effectKey, retryable.steps[0].effectKey)
  assert.equal(retried.steps[0].taskCommandId, retryable.steps[0].taskCommandId)
  assert.equal(retried.steps[0].expectedTaskRevision, 7, 'retry never adopts a newer task revision')
  assert.equal(Object.hasOwn(retried, 'startedAt'), false)
  assert.equal(Object.hasOwn(retried, 'cancelRequestedAt'), false)
  assert.equal(Object.hasOwn(retried.steps[0], 'startedAt'), false)
  assertNoUndefined(retried)
  for (const errorCode of [
    'PROJECT_TASK_CONFLICT', 'PROJECT_TASK_INVALID_TRANSITION', 'PROJECT_TASK_FORBIDDEN', 'PROJECT_TASK_REQUIREMENTS_STALE',
    'PROJECT_TASK_NOT_FOUND', 'PROJECT_TASK_PERMISSION_REVOKED', 'PROJECT_TASK_REVIEW_REQUIRED', 'PROJECT_TASK_STATUS_UNSUPPORTED',
    'PROJECT_AUTOMATION_CONTEXT_REVOKED', 'PROJECT_AUTOMATION_INPUT_INVALID', 'project_task_access_denied',
  ]) {
    const failed = mod.failStep(running, { errorCode, retryable: true, finishedAt: '2026-08-23T22:04:00.000Z' })
    assert.equal(failed.error.retryable, false, errorCode)
    assert.throws(() => mod.retryFailedStep(definition(), failed, { commandId: `retry_${errorCode}`, expectedRunRevision: failed.revision, requestedAt: '2026-08-23T22:05:00.000Z' }, owner), error => error.code === 'PROJECT_AUTOMATION_RETRY_FORBIDDEN')
  }
  assert.throws(() => mod.retryFailedStep({ ...definition(), revision: 4 }, retryable, { commandId: 'retry_stale_def', expectedRunRevision: retryable.revision, requestedAt: '2026-08-23T22:05:00.000Z' }, owner), error => error.code === 'PROJECT_AUTOMATION_DEFINITION_STALE')
  assert.throws(
    () => mod.retryFailedStep({ ...definition(), revision: 99 }, { ...retryable, status: 'succeeded' }, { commandId: 'retry_oracle', expectedRunRevision: 999, requestedAt: '2026-08-23T22:05:00.000Z' }, { actorRef: 'agent', kind: 'agent', role: 'owner' }),
    error => error.code === 'PROJECT_AUTOMATION_APPROVAL_FORBIDDEN'
  )
})

test('effect identity excludes attempt and command replay detects input drift', async () => {
  const mod = await load()
  const first = mod.automationEffectKey({ runRef: 'run_A', stepRef: 'step_A' })
  const retry = mod.automationEffectKey({ stepRef: 'step_A', runRef: 'run_A' })
  assert.equal(first, retry)
  assert.match(first, /^autoeff_[a-f0-9]{64}$/u)
  const command = mod.normalizeAutomationCommand({ commandId: 'command_A', type: 'cancel', expectedRunRevision: 2, payload: { runRef: 'run_A', reasonCode: 'user_request' } })
  const replay = mod.normalizeAutomationCommand({ commandId: 'command_A', type: 'cancel', expectedRunRevision: 2, payload: { runRef: 'run_A', reasonCode: 'user_request' } })
  assert.equal(mod.assertCommandReplay(command, replay), true)
  const drifted = mod.normalizeAutomationCommand({ commandId: 'command_A', type: 'cancel', expectedRunRevision: 3, payload: { runRef: 'run_A', reasonCode: 'user_request' } })
  assert.throws(() => mod.assertCommandReplay(command, drifted), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  assert.doesNotThrow(() => mod.normalizeAutomationCommand({ commandId: 'manual', type: 'manual_run', payload: { definitionRef: 'definition_A', definitionRevision: 1, triggerRef: 'trigger_A', runRef: 'run_A', taskRef: 'task_A', expectedTaskRevision: 2 } }))
  for (const type of ['approve', 'reject']) assert.doesNotThrow(() => mod.normalizeAutomationCommand({ commandId: type, type, expectedRunRevision: 2, payload: { runRef: 'run_A', approvalRef: 'approval_A' } }))
  assert.doesNotThrow(() => mod.normalizeAutomationCommand({ commandId: 'reject_reason', type: 'reject', expectedRunRevision: 2, payload: { runRef: 'run_A', approvalRef: 'approval_A', reasonCode: 'not_ready' } }))
  assert.throws(() => mod.normalizeAutomationCommand({ commandId: 'approve_reason', type: 'approve', expectedRunRevision: 2, payload: { runRef: 'run_A', approvalRef: 'approval_A', reasonCode: 'not_needed' } }), /unsupported fields/u)
  assert.doesNotThrow(() => mod.normalizeAutomationCommand({ commandId: 'retry', type: 'retry', expectedRunRevision: 2, payload: { runRef: 'run_A', reasonCode: 'temporary_provider_error' } }))
  assert.throws(() => mod.normalizeAutomationCommand({ commandId: 'manual_bad_cas', type: 'manual_run', expectedRunRevision: 1, payload: { definitionRef: 'definition_A', definitionRevision: 1, triggerRef: 'trigger_A', runRef: 'run_A', taskRef: 'task_A', expectedTaskRevision: 2 } }), error => error.code === 'PROJECT_AUTOMATION_COMMAND_INVALID')
  for (const type of ['approve', 'reject', 'retry', 'cancel']) assert.throws(() => mod.normalizeAutomationCommand({ commandId: `${type}_missing_cas`, type, payload: type === 'approve' || type === 'reject' ? { runRef: 'run_A', approvalRef: 'approval_A' } : { runRef: 'run_A' } }), error => error.code === 'PROJECT_AUTOMATION_COMMAND_INVALID')
  assert.throws(() => mod.normalizeAutomationCommand({ commandId: 'cancel_wrong_payload', type: 'cancel', expectedRunRevision: 2, payload: { runRef: 'run_A', approvalRef: 'approval_A' } }), /unsupported fields/u)
  assert.throws(() => mod.normalizeAutomationCommand({ commandId: 'approve_missing', type: 'approve', expectedRunRevision: 2, payload: { runRef: 'run_A' } }), error => error.code === 'PROJECT_AUTOMATION_COMMAND_INVALID')
})

test('persisted Run codec round-trips every state and rejects snapshot, binding, and status tampering', async () => {
  const mod = await load()
  const awaiting = await awaitingRun(mod)
  const queued = mod.approveRun(awaiting, approvalInput(awaiting), owner).run
  const running = mod.markStepRunning(queued, { startedAt: '2026-08-23T22:03:00.000Z' })
  const cancelRequested = mod.requestRunCancel(running, { commandId: 'cancel', expectedRunRevision: running.revision, requestedAt: '2026-08-23T22:04:00.000Z' }, owner)
  const succeeded = mod.reconcileRunFromEffectReceipt(cancelRequested, effectReceipt(cancelRequested, { status: 'succeeded', resultReceiptRef: 'receipt_A', finishedAt: '2026-08-23T22:05:00.000Z' }))
  const failed = mod.failStep(running, { errorCode: 'PROVIDER_TEMPORARY', retryable: true, finishedAt: '2026-08-23T22:05:00.000Z' })
  const canceled = mod.requestRunCancel(awaiting, { commandId: 'cancel_early', expectedRunRevision: awaiting.revision, requestedAt: '2026-08-23T22:02:00.000Z' }, owner)
  const receiptCanceled = mod.reconcileRunFromEffectReceipt(cancelRequested, effectReceipt(cancelRequested, { status: 'not_committed', finishedAt: '2026-08-23T22:05:00.000Z' }))
  for (const run of [awaiting, queued, running, cancelRequested, succeeded, failed, canceled, receiptCanceled]) {
    const reopened = mod.normalizePersistedRun(JSON.parse(JSON.stringify(run)))
    assert.deepEqual(reopened, run)
    assert.equal(Object.isFrozen(reopened), true)
    assert.equal(Object.isFrozen(reopened.triggerSnapshot), true)
  }
  const variants = []
  variants.push({ ...awaiting, extra: true })
  const noTrigger = JSON.parse(JSON.stringify(awaiting)); delete noTrigger.triggerSnapshot; variants.push(noTrigger)
  variants.push({ ...awaiting, definitionRef: 'definition_other' })
  variants.push({ ...awaiting, triggerSnapshot: { ...awaiting.triggerSnapshot, inputHash: '0'.repeat(64) } })
  variants.push({ ...awaiting, steps: [{ ...awaiting.steps[0], taskRef: 'task_other' }] })
  variants.push({ ...awaiting, steps: [{ ...awaiting.steps[0], expectedTaskRevision: 8 }] })
  variants.push({ ...awaiting, steps: [{ ...awaiting.steps[0], effectKey: 'autoeff_wrong' }] })
  variants.push({ ...awaiting, steps: [{ ...awaiting.steps[0], taskCommandId: 'command_wrong' }] })
  variants.push({ ...awaiting, revision: 0 })
  variants.push({ ...awaiting, steps: [{ ...awaiting.steps[0], status: 'running' }] })
  variants.push({ ...awaiting, startedAt: '2026-08-23T22:09:00.000Z' })
  variants.push({ ...awaiting, approvalRefs: ['approval_too_early'] })
  variants.push({ ...awaiting, finishedAt: '2026-08-23T22:09:00.000Z' })
  variants.push({ ...failed, error: { code: 'PROJECT_TASK_CONFLICT', retryable: true }, steps: [{ ...failed.steps[0], error: { code: 'PROJECT_TASK_CONFLICT', retryable: true } }] })
  variants.push({ ...canceled, startedAt: '2026-08-23T22:03:00.000Z', steps: [{ ...canceled.steps[0], startedAt: '2026-08-23T22:03:00.000Z' }] })
  const noCancelRequest = JSON.parse(JSON.stringify(receiptCanceled)); delete noCancelRequest.cancelRequestedAt; variants.push(noCancelRequest)
  variants.push({ ...receiptCanceled, steps: [{ ...receiptCanceled.steps[0], startedAt: undefined }] })
  variants.push({ ...succeeded, cancelRequestedAt: 'not-a-timestamp' })
  for (const variant of variants) assert.throws(() => mod.normalizePersistedRun(variant))
})

test('Approval and Effect Receipt codecs use strict trusted persistence shapes', async () => {
  const mod = await load()
  const awaiting = await awaitingRun(mod)
  const decision = mod.approveRun(awaiting, approvalInput(awaiting), owner)
  const trusted = mod.assertTrustedAutomationApprover(owner)
  assert.deepEqual(trusted, { actorRef: owner.actorRef, actorRole: 'owner' })
  assert.equal(Object.isFrozen(trusted), true)
  assert.throws(() => mod.assertTrustedAutomationApprover({ actorRef: 'agent_A', kind: 'agent', role: 'owner' }), error => error.code === 'PROJECT_AUTOMATION_APPROVAL_FORBIDDEN')
  assert.equal(mod.normalizePersistedAutomationRun, mod.normalizePersistedRun)
  assert.equal(mod.normalizePersistedAutomationApproval, mod.normalizePersistedApproval)
  assert.equal(mod.normalizePersistedAutomationEffectReceipt, mod.normalizeEffectReceipt)
  assert.equal(mod.normalizePersistedAutomationLedger, mod.normalizeLedgerEntries)
  assert.equal(mod.verifyPersistedLedger, mod.verifyLedgerChain)
  assert.deepEqual(mod.normalizePersistedApproval(JSON.parse(JSON.stringify(decision.approval))), decision.approval)
  for (const invalid of [
    { ...decision.approval, extra: true },
    { ...decision.approval, actorRole: 'contributor' },
    { ...decision.approval, decision: 'pending' },
    { ...decision.approval, expectedRunRevision: 0 },
  ]) assert.throws(() => mod.normalizePersistedApproval(invalid))
  const running = mod.markStepRunning(decision.run, { startedAt: '2026-08-23T22:03:00.000Z' })
  const receipts = [
    effectReceipt(running, { status: 'unknown' }),
    effectReceipt(running, { status: 'succeeded', resultReceiptRef: 'receipt_A', finishedAt: '2026-08-23T22:04:00.000Z' }),
    effectReceipt(running, { status: 'failed', errorCode: 'PROVIDER_TEMPORARY', retryable: true, finishedAt: '2026-08-23T22:04:00.000Z' }),
    effectReceipt(running, { status: 'not_committed', finishedAt: '2026-08-23T22:04:00.000Z' }),
  ]
  for (const receipt of receipts) assert.deepEqual(mod.normalizeEffectReceipt(JSON.parse(JSON.stringify(receipt))), receipt)
  for (const invalid of [
    { ...receipts[0], extra: true },
    { ...receipts[0], finishedAt: '2026-08-23T22:04:00.000Z' },
    { ...receipts[1], errorCode: 'unexpected' },
    { ...receipts[2], retryable: 'yes' },
    { ...receipts[2], errorCode: 'PROJECT_TASK_CONFLICT', retryable: true },
    { ...receipts[3], resultReceiptRef: 'unexpected' },
  ]) assert.throws(() => mod.normalizeEffectReceipt(invalid))
})

test('Command Receipt codec persists only exact replay metadata and outcome-specific references', async () => {
  const mod = await load()
  const base = { commandId: 'command_A', inputHash: 'a'.repeat(64), completedAt: '2026-08-23T22:05:00.000Z' }
  assert.deepEqual(mod.AUTOMATION_COMMAND_RECEIPT_TYPES, ['definition.create', 'definition.update', ...mod.AUTOMATION_COMMAND_TYPES])
  const valid = [
    { ...base, type: 'definition.create', outcome: 'accepted', definitionRef: 'definition_A', resultRevision: 1 },
    { ...base, type: 'definition.update', outcome: 'accepted', definitionRef: 'definition_A', resultRevision: 2 },
    { ...base, type: 'definition.create', outcome: 'rejected', definitionRef: 'definition_A', errorCode: 'PROJECT_AUTOMATION_CONFLICT' },
    { ...base, type: 'definition.update', outcome: 'rejected', definitionRef: 'definition_A', errorCode: 'PROJECT_AUTOMATION_CONFLICT' },
    { ...base, type: 'manual_run', outcome: 'accepted', definitionRef: 'definition_A', runRef: 'run_A', resultRevision: 1 },
    { ...base, type: 'approve', outcome: 'accepted', runRef: 'run_A', approvalRef: 'approval_A', resultRevision: 2 },
    { ...base, type: 'reject', outcome: 'accepted', runRef: 'run_A', approvalRef: 'approval_A', resultRevision: 2 },
    { ...base, type: 'retry', outcome: 'accepted', runRef: 'run_A', resultRevision: 3 },
    { ...base, type: 'cancel', outcome: 'accepted', runRef: 'run_A', resultRevision: 3 },
    { ...base, type: 'manual_run', outcome: 'rejected', definitionRef: 'definition_A', errorCode: 'PROJECT_AUTOMATION_CONFLICT' },
    { ...base, type: 'approve', outcome: 'rejected', runRef: 'run_A', errorCode: 'PROJECT_AUTOMATION_FORBIDDEN' },
  ]
  for (const receipt of valid) assert.deepEqual(mod.normalizeAutomationCommandReceipt(JSON.parse(JSON.stringify(receipt))), receipt)
  for (const invalid of [
    { ...valid[0], result: { arbitrary: true } },
    { ...valid[0], runRef: 'run_A' },
    { ...valid[0], approvalRef: 'approval_A' },
    { ...valid[2], resultRevision: 2 },
    { ...valid[2], runRef: 'run_A' },
    { ...valid[4], approvalRef: 'approval_A' },
    { ...valid[5], definitionRef: 'definition_A' },
    { ...valid[7], approvalRef: 'approval_A' },
    { ...valid[9], runRef: 'run_A' },
    { ...valid[10], resultRevision: 2 },
    { ...valid[10], inputHash: 'not-a-hash' },
  ]) assert.throws(() => mod.normalizeAutomationCommandReceipt(invalid))
})

test('ledger uses null genesis, one base64url encoding, immutable append, and complete event coverage', async () => {
  const mod = await load()
  const firstInput = { entryRef: 'entry_A', ledgerRef: 'ledger_A', runRef: 'run_A', definitionRef: 'definition_A', definitionRevision: 3, triggerRef: 'trigger_A', type: 'run.created', commandId: 'command_A', fromStatus: 'none', toStatus: 'awaiting_approval', occurredAt: '2026-08-23T22:01:00.000Z' }
  const first = mod.appendLedgerEntry([], firstInput)
  const second = mod.appendLedgerEntry(first, { entryRef: 'entry_B', ledgerRef: 'ledger_A', runRef: 'run_A', stepRunRef: 'run_A:step_A', approvalRef: 'approval_A', actorRef: 'human_owner', actorRole: 'owner', type: 'approval.approved', commandId: 'command_B', fromStatus: 'awaiting_approval', toStatus: 'queued', occurredAt: '2026-08-23T22:02:00.000Z' })
  assert.equal(first[0].previousHash, null)
  assert.match(first[0].entryHash, /^[A-Za-z0-9_-]{43}$/u)
  for (const type of ['definition.created', 'definition.updated', 'run.triggered', 'approval.recorded', 'retry.requested', 'cancel.requested', 'step.effect_committed', 'run.recovered']) assert.ok(mod.LEDGER_EVENT_TYPES.includes(type), type)
  const definitionLedger = mod.appendLedgerEntry([], { entryRef: 'definition_entry', ledgerRef: 'project_ledger', definitionRef: 'definition_A', definitionRevision: 1, type: 'definition.created', occurredAt: '2026-08-23T22:00:00.000Z' })
  assert.equal(mod.verifyLedgerChain(definitionLedger), true)
  assert.equal('runRef' in definitionLedger[0], false)
  assert.throws(() => mod.appendLedgerEntry([], { entryRef: 'missing_run', ledgerRef: 'project_ledger', type: 'run.triggered', occurredAt: '2026-08-23T22:00:00.000Z' }), /runRef is required/u)
  const retried = mod.appendLedgerEntry(second, { entryRef: 'entry_C', ledgerRef: 'ledger_A', runRef: 'run_A', stepRunRef: 'run_A:step_A', taskCommandId: 'autoeff_A', attempt: 2, reasonCode: 'temporary_failure', type: 'retry.requested', occurredAt: '2026-08-23T22:03:00.000Z' })
  const cancel = mod.appendLedgerEntry(retried, { entryRef: 'entry_D', ledgerRef: 'ledger_A', runRef: 'run_A', reasonCode: 'user_request', type: 'cancel.requested', occurredAt: '2026-08-23T22:04:00.000Z' })
  const audited = mod.appendLedgerEntry(cancel, { entryRef: 'entry_E', ledgerRef: 'ledger_A', runRef: 'run_A', stepRunRef: 'run_A:step_A', effectKey: 'autoeff_A', taskCommandId: 'autoeff_A', resultReceiptRef: 'receipt_A', attempt: 2, type: 'step.effect_committed', occurredAt: '2026-08-23T22:05:00.000Z' })
  assert.equal(second[1].previousHash, first[0].entryHash)
  assert.equal(second[0], first[0])
  assert.equal(Object.isFrozen(second), true)
  assert.equal(mod.verifyLedgerChain(audited), true)
  assert.deepEqual(mod.normalizeLedgerEntries(JSON.parse(JSON.stringify(audited))), audited)
  const rehash = (entries) => {
    const output = []
    for (const entry of entries) {
      const { entryHash: ignored, ...stored } = entry
      const body = { ...stored, previousHash: output.length === 0 ? null : output.at(-1).entryHash }
      output.push({ ...body, entryHash: createHash('sha256').update(mod.canonicalJson(body)).digest('base64url') })
    }
    return output
  }
  for (const mutate of [
    entries => { delete entries[0].definitionRef },
    entries => { delete entries[1].approvalRef },
    entries => { entries[1].actorRole = 'contributor' },
    entries => { delete entries[2].taskCommandId },
    entries => { delete entries[4].resultReceiptRef },
  ]) {
    const changed = JSON.parse(JSON.stringify(audited)); mutate(changed); const hashValidButShapeInvalid = rehash(changed)
    assert.equal(mod.verifyLedgerChain(hashValidButShapeInvalid), true)
    assert.throws(() => mod.normalizeLedgerEntries(hashValidButShapeInvalid))
  }
  const deterministic = mod.appendLedgerEntry([], { ...firstInput })
  assert.equal(deterministic[0].entryHash, first[0].entryHash)
  const tampered = [{ ...second[0], toStatus: 'running' }, second[1]]
  assert.equal(mod.verifyLedgerChain(tampered), false)
  assert.throws(() => mod.appendLedgerEntry(tampered, { ...firstInput, entryRef: 'entry_C' }), error => error.code === 'PROJECT_AUTOMATION_LEDGER_INVALID')
  assert.throws(() => mod.appendLedgerEntry(second, firstInput), error => error.code === 'PROJECT_AUTOMATION_LEDGER_CONFLICT')
  assert.throws(() => mod.appendLedgerEntry(second, { ...firstInput, entryRef: 'entry_C', ledgerRef: 'ledger_other' }), error => error.code === 'PROJECT_AUTOMATION_LEDGER_CONFLICT')
  assert.throws(() => mod.appendLedgerEntry([], { ...firstInput, entryRef: 'bad_error_event', errorCode: 'UNEXPECTED' }), error => error.code === 'PROJECT_AUTOMATION_LEDGER_INVALID')
  assert.throws(() => mod.appendLedgerEntry([], { ...firstInput, entryRef: 'bad_status', fromStatus: 'invented' }), error => error.code === 'PROJECT_AUTOMATION_LEDGER_INVALID')
  assert.throws(() => mod.appendLedgerEntry([], { entryRef: 'bad_definition', ledgerRef: 'ledger_A', runRef: 'run_A', type: 'definition.created', occurredAt: '2026-08-23T22:00:00.000Z' }), error => error.code === 'PROJECT_AUTOMATION_PERSISTED_INVALID')
  assert.throws(() => mod.appendLedgerEntry([], { entryRef: 'bad_step', ledgerRef: 'ledger_A', runRef: 'run_A', type: 'step.started', occurredAt: '2026-08-23T22:00:00.000Z' }))
})

test('untrusted inputs are allowlisted and recursively reject identity, external, and executable claims', async () => {
  const mod = await load()
  const forbidden = ['actor', 'actorRef', 'session', 'sessionId', 'userId', 'deviceId', 'accountId', 'email', 'role', 'authority', 'authorities', 'projectRef', 'prompt', 'url', 'script', 'path', 'env']
  for (const key of forbidden) {
    assert.throws(() => mod.normalizeAutomationDefinition({ ...definition(), [key]: 'forged' }), error => error.code === 'PROJECT_AUTOMATION_FORBIDDEN_INPUT', `definition ${key}`)
    assert.throws(() => mod.createManualTrigger(definition(), { ...triggerInput(), input: { ...triggerInput().input, nested: { [key]: 'forged' } } }), error => error.code === 'PROJECT_AUTOMATION_FORBIDDEN_INPUT', `trigger ${key}`)
    assert.throws(() => mod.normalizeAutomationCommand({ commandId: 'command_A', type: 'cancel', expectedRunRevision: 1, payload: { nested: { [key]: 'forged' } } }), error => error.code === 'PROJECT_AUTOMATION_FORBIDDEN_INPUT', `command ${key}`)
  }
  for (const key of ['actor_ref', 'Actor-Ref', 'session-id', 'SESSION_ID', 'project_ref', 'project-ref']) {
    assert.throws(() => mod.normalizeAutomationCommand({ commandId: 'command_A', type: 'cancel', expectedRunRevision: 1, payload: { nested: { [key]: 'forged' } } }), error => error.code === 'PROJECT_AUTOMATION_FORBIDDEN_INPUT', key)
  }
  let deep = { reasonCode: 'bottom' }
  for (let index = 0; index < 40; index += 1) deep = { nested: deep }
  assert.throws(() => mod.normalizeAutomationCommand({ commandId: 'command_deep', type: 'cancel', expectedRunRevision: 1, payload: deep }), error => error.code === 'PROJECT_AUTOMATION_INPUT_DEPTH')
  assert.throws(() => mod.normalizeAutomationCommand({ commandId: 'command_date', type: 'cancel', expectedRunRevision: 1, payload: new Date() }), /plain JSON object/u)
  assert.throws(() => mod.hashAutomationInput({ value: -0 }), /lossless JSON number/u)
  const symbolKey = { value: 1 }; symbolKey[Symbol('hidden')] = true
  assert.throws(() => mod.hashAutomationInput(symbolKey), /symbol keys/u)
  assert.throws(() => mod.hashAutomationInput({ values: Array(1) }), /sparse array holes/u)
  const accessor = {}; Object.defineProperty(accessor, 'value', { enumerable: true, get() { return 1 } })
  assert.throws(() => mod.hashAutomationInput(accessor), /JSON data property/u)
  assert.equal('NON_RETRYABLE_EFFECT_ERRORS' in mod, false, 'mutable safety Set is not exported')
  assert.throws(() => mod.normalizeAutomationDefinition({ ...definition(), surprise: true }), /unsupported fields/u)
  assert.throws(() => mod.createManualTrigger(definition(), { ...triggerInput(), surprise: true }), /unsupported fields/u)
  assert.throws(() => mod.appendLedgerEntry([], { entryRef: 'entry_A', ledgerRef: 'ledger_A', runRef: 'run_A', type: 'run.created', occurredAt: '2026-08-23T22:00:00.000Z', extra: true }), /unsupported fields/u)
  assert.throws(() => mod.normalizeAutomationCommand({ commandId: 'command_A', type: 'cancel', expectedRunRevision: 1, payload: { arbitrary: true } }), /unsupported fields/u)
  const modRun = await awaitingRun(mod)
  assertNoUndefined(modRun)
})
