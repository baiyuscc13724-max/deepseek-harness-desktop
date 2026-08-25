const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const serviceUrl = pathToFileURL(path.join(root, 'plugins', 'dsh-agent-teams', 'lib', 'project-automation-service.js')).href
const storeUrl = pathToFileURL(path.join(root, 'plugins', 'dsh-agent-teams', 'lib', 'project-automation-store.js')).href
const projectRef = `project_${'S'.repeat(24)}`
const owner = { actorRef: 'human_owner', kind: 'human', role: 'owner' }
const maintainer = { actorRef: 'human_maintainer', kind: 'human', role: 'maintainer' }
const systemExecution = Object.freeze({ capability: 'trusted-system-task-execution' })

function clock(start = Date.parse('2026-08-24T01:00:00.000Z')) {
  let tick = start
  return () => new Date(tick++).toISOString()
}
function refs(kind, commandId) { return `${kind}_${commandId}` }
async function fixture(run) {
  const [{ ProjectAutomationCommandService, ProjectAutomationRunner }, { ProjectAutomationStore }] = await Promise.all([import(serviceUrl), import(storeUrl)])
  const dir = await mkdtemp(path.join(os.tmpdir(), 'automation-service-'))
  const filePath = path.join(dir, 'automation.enc')
  const encryptionKey = randomBytes(32)
  const store = new ProjectAutomationStore({ projectRef, filePath, encryptionKey })
  const now = clock()
  const service = new ProjectAutomationCommandService({ store, projectRef, actorResolver: execution => execution.actor, refFactory: refs, now })
  try { await run({ store, service, now, ProjectAutomationRunner, ProjectAutomationCommandService, ProjectAutomationStore, filePath, encryptionKey }) }
  finally { await store.close().catch(() => {}); await rm(dir, { recursive: true, force: true }) }
}
function create(commandId = 'create_A', taskRef = 'task_A') {
  return { commandId, type: 'definition.create', expectedRevision: 0, payload: { name: 'Move task', taskRef, targetStatus: 'in_progress' } }
}
function manual(commandId, definitionRef = 'definition_create_A', expectedRevision = 1, expectedTaskRevision = 7) {
  return { commandId, type: 'manual_run', definitionRef, expectedRevision, payload: { expectedTaskRevision } }
}
function runCommand(type, commandId, run, payload = {}) {
  return { commandId, type, runRef: run.runRef, expectedRevision: run.revision, payload }
}
async function seedRun(state, suffix = 'A') {
  await state.service.executeCommand({ actor: owner }, create(`create_${suffix}`, `task_${suffix}`))
  return (await state.service.executeCommand({ actor: owner }, manual(`manual_${suffix}`, `definition_create_${suffix}`))).run
}
class FakeTaskService {
  constructor() { this.receipts = new Map(); this.executions = []; this.queryError = undefined; this.effectError = undefined; this.gate = undefined }
  getCommandReceipt(execution, { commandId }) {
    assert.equal(execution, systemExecution)
    if (this.queryError) throw this.queryError
    return this.receipts.get(commandId)
  }
  async executeCommand(execution, command) {
    assert.equal(execution, systemExecution)
    this.executions.push(command)
    if (this.gate) await this.gate
    if (this.effectError) throw this.effectError
    const receipt = { duplicate: false, projectRevision: 19, task: { taskRef: command.taskRef, status: command.payload.to } }
    this.receipts.set(command.commandId, receipt)
    return receipt
  }
}

function completeFakeStore() {
  let loads = 0
  let writes = 0
  const store = { projectRef, load: async () => { loads++; return { revision: 0, document: { definitions: [], runs: [], approvals: [], commandReceipts: [] } } } }
  for (const name of ['saveDefinition', 'executeCommand', 'saveRejectedCommandReceipt', 'startRun', 'failRun', 'reconcileEffectReceipt']) store[name] = async () => { writes++ }
  store.close = async () => {}
  return { store, get loads() { return loads }, get writes() { return writes } }
}

test('strict normalization precedes Host auth, and auth precedes every receipt/object lookup', async () => {
  const { ProjectAutomationCommandService } = await import(serviceUrl)
  const fake = completeFakeStore()
  let actorCalls = 0
  const service = new ProjectAutomationCommandService({ store: fake.store, projectRef, actorResolver: () => { actorCalls++; return { actorRef: 'collab', kind: 'human', role: 'collaborator' } } })
  await assert.rejects(service.executeCommand({}, create('bad_extra', 'task_A', { nope: true })), /owner or maintainer/u)
  assert.equal(actorCalls, 1)
  assert.equal(fake.loads, 0)
  await assert.rejects(service.executeCommand({}, { ...create('forged'), projectRef }), error => error.code === 'PROJECT_AUTOMATION_FORBIDDEN_INPUT')
  assert.equal(actorCalls, 1, 'strict input rejection happens before actor resolution')
  assert.equal(fake.loads, 0)
})

test('receipt query authorizes before store and an absent full intent is strictly read-only', async () => {
  const { ProjectAutomationCommandService } = await import(serviceUrl)
  const descriptor = Object.getOwnPropertyDescriptor(ProjectAutomationCommandService.prototype, 'getCommandReceipt')
  assert.equal(typeof descriptor.value, 'function')
  assert.equal(descriptor.enumerable, false)
  const command = { commandId: 'approve_absent', type: 'approve', runRef: 'run_absent', expectedRevision: 1, payload: {} }
  const deniedStore = completeFakeStore()
  let actorCalls = 0
  const denied = new ProjectAutomationCommandService({ store: deniedStore.store, projectRef, actorResolver: () => { actorCalls++; return { actorRef: 'collab', kind: 'human', role: 'collaborator' } } })
  await assert.rejects(denied.getCommandReceipt({}, command), error => /owner or maintainer/u.test(error.message) && !Object.hasOwn(error, 'receipt') && !Object.hasOwn(error, 'inputHash'))
  assert.equal(actorCalls, 1)
  assert.equal(deniedStore.loads, 0)
  assert.equal(deniedStore.writes, 0)
  await assert.rejects(denied.getCommandReceipt({}, { ...command, actorRef: owner.actorRef }), error => error.code === 'PROJECT_AUTOMATION_FORBIDDEN_INPUT')
  assert.equal(actorCalls, 1, 'invalid intent is rejected before resolving the Host actor')
  assert.equal(deniedStore.loads, 0)

  const emptyStore = completeFakeStore()
  const allowed = new ProjectAutomationCommandService({ store: emptyStore.store, projectRef, actorResolver: execution => execution.actor })
  assert.equal(await allowed.getCommandReceipt({ actor: owner }, command), undefined)
  assert.equal(emptyStore.loads, 1)
  assert.equal(emptyStore.writes, 0, 'an absent query cannot persist a rejection or create a run')
  await assert.rejects(allowed.getCommandReceipt({ actor: owner }, create('not_approval')), /approve or reject command/u)
  assert.equal(emptyStore.loads, 1)
})

test('definition commands bind replay to trusted actor and durably replay deterministic rejection', async () => fixture(async state => {
  const accepted = await state.service.executeCommand({ actor: owner }, create())
  assert.equal(accepted.definition.definitionRef, 'definition_create_A')
  assert.equal(accepted.definition.steps[0].stepRef, 'step_create_A')
  assert.equal(accepted.duplicate, false)
  const replay = await state.service.executeCommand({ actor: owner }, create())
  assert.equal(replay.duplicate, true)
  await assert.rejects(state.service.executeCommand({ actor: maintainer }, create()), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  await assert.rejects(state.service.executeCommand({ actor: owner }, { ...create(), payload: { ...create().payload, name: 'Changed' } }), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  const update = { commandId: 'update_A', type: 'definition.update', definitionRef: accepted.definition.definitionRef, expectedRevision: 1, payload: { name: 'Move task safely' } }
  const updated = await state.service.executeCommand({ actor: owner }, update)
  assert.equal(updated.definition.revision, 2)
  assert.equal((await state.service.executeCommand({ actor: owner }, update)).duplicate, true)
  await assert.rejects(state.service.executeCommand({ actor: owner }, { ...update, payload: { name: 'Drifted update' } }), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')

  const missing = { commandId: 'update_missing', type: 'definition.update', definitionRef: 'definition_missing', expectedRevision: 1, payload: { name: 'Nope' } }
  await assert.rejects(state.service.executeCommand({ actor: owner }, missing), error => error.code === 'PROJECT_AUTOMATION_DEFINITION_NOT_FOUND' && error.duplicate === false)
  await assert.rejects(state.service.executeCommand({ actor: owner }, missing), error => error.code === 'PROJECT_AUTOMATION_DEFINITION_NOT_FOUND' && error.duplicate === true)
  const persisted = (await state.store.load()).document.commandReceipts.find(item => item.commandId === missing.commandId)
  assert.equal(persisted.outcome, 'rejected')
}))

test('manual/approve/reject/cancel commands all replay exactly and approval only queues', async () => fixture(async state => {
  let run = await seedRun(state, 'A')
  assert.equal(run.status, 'awaiting_approval')
  assert.equal((await state.service.executeCommand({ actor: owner }, manual('manual_A'))).duplicate, true)
  await assert.rejects(state.service.executeCommand({ actor: owner }, manual('manual_A', 'definition_create_A', 1, 8)), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  const approved = await state.service.executeCommand({ actor: maintainer }, runCommand('approve', 'approve_A', run))
  assert.equal(approved.run.status, 'queued')
  assert.equal((await state.service.executeCommand({ actor: maintainer }, runCommand('approve', 'approve_A', run))).duplicate, true)
  await assert.rejects(state.service.executeCommand({ actor: owner }, runCommand('approve', 'approve_A', run)), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  const canceled = await state.service.executeCommand({ actor: owner }, runCommand('cancel', 'cancel_A', approved.run, { reasonCode: 'operator_request' }))
  assert.equal(canceled.run.status, 'canceled')
  assert.equal((await state.service.executeCommand({ actor: owner }, runCommand('cancel', 'cancel_A', approved.run, { reasonCode: 'operator_request' }))).duplicate, true)
  await assert.rejects(state.service.executeCommand({ actor: owner }, runCommand('cancel', 'cancel_A', approved.run, { reasonCode: 'drift' })), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')

  run = await seedRun(state, 'B')
  const rejectedCommand = runCommand('reject', 'reject_B', run, { reasonCode: 'not_ready' })
  const rejected = await state.service.executeCommand({ actor: owner }, rejectedCommand)
  assert.equal(rejected.run.status, 'canceled')
  assert.equal((await state.service.executeCommand({ actor: owner }, rejectedCommand)).duplicate, true)
}))

test('receipt query replays accepted and rejected approval intents across restart without effects', async () => fixture(async state => {
  let run = await seedRun(state, 'receipt')
  const approve = runCommand('approve', 'approve_receipt', run)
  const accepted = await state.service.executeCommand({ actor: maintainer }, approve)
  const beforeQuery = await state.store.load()
  const queried = await state.service.getCommandReceipt({ actor: maintainer }, approve)
  const afterQuery = await state.store.load()
  assert.equal(queried.duplicate, true)
  assert.equal(queried.receipt.outcome, 'accepted')
  assert.equal(queried.run.runRef, accepted.run.runRef)
  assert.equal(queried.run.status, 'queued')
  assert.equal(queried.approval.approvalRef, queried.receipt.approvalRef)
  assert.equal(queried.approval.actorRef, maintainer.actorRef)
  assert.equal(afterQuery.revision, beforeQuery.revision, 'query does not write or advance the document')
  assert.deepEqual(afterQuery.document.runs, beforeQuery.document.runs)
  await assert.rejects(state.service.getCommandReceipt({ actor: owner }, approve), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  await assert.rejects(state.service.getCommandReceipt({ actor: maintainer }, { ...approve, type: 'reject', payload: { reasonCode: 'changed_type' } }), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  await assert.rejects(state.service.getCommandReceipt({ actor: maintainer }, { ...approve, expectedRevision: approve.expectedRevision + 1 }), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')

  run = await seedRun(state, 'rejected_receipt')
  const rejectedCommand = { ...runCommand('reject', 'reject_receipt', run, { reasonCode: 'policy' }), expectedRevision: run.revision + 1 }
  await assert.rejects(state.service.executeCommand({ actor: owner }, rejectedCommand), error => error.code === 'PROJECT_AUTOMATION_CONFLICT' && error.duplicate === false)
  await assert.rejects(state.service.getCommandReceipt({ actor: owner }, rejectedCommand), error => error.code === 'PROJECT_AUTOMATION_CONFLICT' && error.duplicate === true)
  await assert.rejects(state.service.getCommandReceipt({ actor: owner }, { ...rejectedCommand, payload: { reasonCode: 'payload_drift' } }), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')

  await state.store.close()
  const restartedStore = new state.ProjectAutomationStore({ projectRef, filePath: state.filePath, encryptionKey: Buffer.from(state.encryptionKey) })
  const restarted = new state.ProjectAutomationCommandService({ store: restartedStore, projectRef, actorResolver: execution => execution.actor, refFactory: refs, now: state.now })
  try {
    const replayed = await restarted.getCommandReceipt({ actor: maintainer }, approve)
    assert.equal(replayed.receipt.outcome, 'accepted')
    assert.equal(replayed.run.runRef, accepted.run.runRef)
    assert.equal(replayed.approval.approvalRef, replayed.receipt.approvalRef)
    await assert.rejects(restarted.getCommandReceipt({ actor: owner }, rejectedCommand), error => error.code === 'PROJECT_AUTOMATION_CONFLICT' && error.duplicate === true)
  } finally { await restartedStore.close() }
}))

test('runner is receipt-first and resolves both sides of the cancel race without duplicate effects', async () => fixture(async state => {
  const tasks = new FakeTaskService()
  let run = await seedRun(state, 'A')
  run = (await state.service.executeCommand({ actor: owner }, runCommand('approve', 'approve_A', run))).run
  tasks.receipts.set(run.steps[0].taskCommandId, { duplicate: false, projectRevision: 21, task: { taskRef: 'task_A', status: 'in_progress' } })
  const runner = new state.ProjectAutomationRunner({ store: state.store, taskService: tasks, taskExecution: systemExecution, projectRef, refFactory: refs, now: state.now })
  const receiptFirst = await runner.pump()
  assert.equal(receiptFirst.results[0].status, 'succeeded')
  assert.equal(tasks.executions.length, 0)

  run = await seedRun(state, 'B')
  run = (await state.service.executeCommand({ actor: owner }, runCommand('approve', 'approve_B', run))).run
  let loaded = await state.store.load()
  run = (await state.store.startRun({ runRef: run.runRef, expectedRunRevision: run.revision, expectedRevision: loaded.revision, startedAt: state.now() })).run
  run = (await state.service.executeCommand({ actor: owner }, runCommand('cancel', 'cancel_B', run, { reasonCode: 'stop' }))).run
  assert.equal(run.status, 'cancel_requested')
  await runner.pump()
  loaded = await state.store.load()
  assert.equal(loaded.document.runs.find(item => item.runRef === run.runRef).status, 'canceled')
  assert.equal(tasks.executions.length, 0)

  run = await seedRun(state, 'C')
  run = (await state.service.executeCommand({ actor: owner }, runCommand('approve', 'approve_C', run))).run
  loaded = await state.store.load()
  run = (await state.store.startRun({ runRef: run.runRef, expectedRunRevision: run.revision, expectedRevision: loaded.revision, startedAt: state.now() })).run
  run = (await state.service.executeCommand({ actor: owner }, runCommand('cancel', 'cancel_C', run))).run
  tasks.receipts.set(run.steps[0].taskCommandId, { duplicate: false, projectRevision: 22, task: { taskRef: 'task_C', status: 'in_progress' } })
  await runner.pump()
  assert.equal((await state.store.load()).document.runs.find(item => item.runRef === run.runRef).status, 'succeeded', 'committed Task receipt wins over cancellation')
  await runner.close()
}))

test('runner never treats a malformed or mismatched Task receipt as committed success', async () => fixture(async state => {
  const tasks = new FakeTaskService()
  let run = await seedRun(state, 'A')
  run = (await state.service.executeCommand({ actor: owner }, runCommand('approve', 'approve_A', run))).run
  tasks.receipts.set(run.steps[0].taskCommandId, { projectRevision: 9, task: { taskRef: 'task_other', status: 'in_progress' } })
  const runner = new state.ProjectAutomationRunner({ store: state.store, taskService: tasks, taskExecution: systemExecution, projectRef, refFactory: refs, now: state.now })
  await assert.rejects(runner.pump(), error => error.code === 'PROJECT_AUTOMATION_TASK_RECEIPT_INVALID')
  const running = (await state.store.load()).document.runs.find(item => item.runRef === run.runRef)
  assert.equal(running.status, 'running')
  assert.equal(tasks.executions.length, 0, 'an invalid durable receipt is an unknown outcome, not permission to repeat the effect')
  tasks.receipts.set(run.steps[0].taskCommandId, { projectRevision: 10, task: { taskRef: run.steps[0].taskRef, status: run.steps[0].targetStatus } })
  await runner.recover()
  assert.equal((await state.store.load()).document.runs.find(item => item.runRef === run.runRef).status, 'succeeded')
}))

test('Task commit then Automation save crash recovers exactly from the durable Task receipt', async () => fixture(async state => {
  const tasks = new FakeTaskService()
  let run = await seedRun(state, 'A')
  run = (await state.service.executeCommand({ actor: owner }, runCommand('approve', 'approve_A', run))).run
  let crash = true
  const crashStore = { projectRef: state.store.projectRef }
  for (const name of ['load', 'saveDefinition', 'executeCommand', 'saveRejectedCommandReceipt', 'startRun', 'failRun', 'close']) crashStore[name] = (...args) => state.store[name](...args)
  crashStore.reconcileEffectReceipt = async input => {
    if (crash) throw Object.assign(new Error('simulated save crash'), { code: 'PROJECT_STATE_IO_ERROR' })
    return state.store.reconcileEffectReceipt(input)
  }
  const first = new state.ProjectAutomationRunner({ store: crashStore, taskService: tasks, taskExecution: systemExecution, projectRef, refFactory: refs, now: state.now })
  await assert.rejects(first.pump(), /simulated save crash/u)
  crash = false
  assert.equal(tasks.executions.length, 1)
  assert.equal((await state.store.load()).document.runs.find(item => item.runRef === run.runRef).status, 'running')
  const restarted = new state.ProjectAutomationRunner({ store: state.store, taskService: tasks, taskExecution: systemExecution, projectRef, refFactory: refs, now: state.now })
  await restarted.recover()
  assert.equal(tasks.executions.length, 1, 'recovery reconciles instead of repeating the Task transition')
  assert.equal((await state.store.load()).document.runs.find(item => item.runRef === run.runRef).status, 'succeeded')
}))

test('unknown receipt queries defer, Task errors classify, explicit retry preserves effect identity', async () => fixture(async state => {
  const tasks = new FakeTaskService()
  let run = await seedRun(state, 'A')
  run = (await state.service.executeCommand({ actor: owner }, runCommand('approve', 'approve_A', run))).run
  tasks.queryError = Object.assign(new Error('temporarily unknown'), { code: 'PROJECT_TASK_STORE_CLOSED' })
  const runner = new state.ProjectAutomationRunner({ store: state.store, taskService: tasks, taskExecution: systemExecution, projectRef, refFactory: refs, now: state.now })
  const deferred = await runner.pump()
  assert.equal(deferred.results[0].status, 'deferred')
  assert.equal(tasks.executions.length, 0)
  tasks.queryError = undefined
  tasks.effectError = Object.assign(new Error('busy'), { code: 'PROJECT_TASK_STORE_CLOSED' })
  await runner.pump()
  let failed = (await state.store.load()).document.runs.find(item => item.runRef === run.runRef)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.steps[0].error.retryable, true)
  const identity = { effectKey: failed.steps[0].effectKey, taskCommandId: failed.steps[0].taskCommandId, expectedTaskRevision: failed.steps[0].expectedTaskRevision }
  const retryCommand = runCommand('retry', 'retry_A', failed, { reasonCode: 'transient' })
  const retried = await state.service.executeCommand({ actor: owner }, retryCommand)
  assert.deepEqual({ effectKey: retried.run.steps[0].effectKey, taskCommandId: retried.run.steps[0].taskCommandId, expectedTaskRevision: retried.run.steps[0].expectedTaskRevision }, identity)
  assert.equal((await state.service.executeCommand({ actor: owner }, retryCommand)).duplicate, true)
  await assert.rejects(state.service.executeCommand({ actor: owner }, { ...retryCommand, payload: { reasonCode: 'drift' } }), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  tasks.effectError = Object.assign(new Error('stale'), { code: 'PROJECT_TASK_CONFLICT' })
  await runner.pump()
  failed = (await state.store.load()).document.runs.find(item => item.runRef === run.runRef)
  assert.equal(failed.steps[0].error.retryable, false)
  await assert.rejects(state.service.executeCommand({ actor: owner }, runCommand('retry', 'retry_again', failed)), error => error.code === 'PROJECT_AUTOMATION_RETRY_FORBIDDEN')
}))

test('concurrent pumps serialize, close drains accepted work, and rejects new work', async () => fixture(async state => {
  const tasks = new FakeTaskService()
  let release
  tasks.gate = new Promise(resolve => { release = resolve })
  let run = await seedRun(state, 'A')
  run = (await state.service.executeCommand({ actor: owner }, runCommand('approve', 'approve_A', run))).run
  const runner = new state.ProjectAutomationRunner({ store: state.store, taskService: tasks, taskExecution: systemExecution, projectRef, refFactory: refs, now: state.now })
  const first = runner.pump()
  const second = runner.pump()
  await new Promise(resolve => setImmediate(resolve))
  const closing = runner.close()
  await assert.rejects(runner.pump(), error => error.code === 'PROJECT_AUTOMATION_RUNNER_CLOSED')
  release()
  await Promise.all([first, second, closing])
  assert.equal(tasks.executions.length, 1)
  assert.equal((await state.store.load()).document.runs.find(item => item.runRef === run.runRef).status, 'succeeded')
}))
