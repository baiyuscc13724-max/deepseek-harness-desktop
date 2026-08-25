const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const domainUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-automation-domain.js')).href
const stateUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-state-store.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-automation-store.js')).href
const projectRef = `project_${'M'.repeat(24)}`
const otherProjectRef = `project_${'N'.repeat(24)}`
const owner = { actorRef: 'human_owner', kind: 'human', role: 'owner' }
const maintainer = { actorRef: 'human_maintainer', kind: 'human', role: 'maintainer' }
function definition(overrides = {}) { return { schemaVersion: 1, definitionRef: 'definition_A', revision: 1, status: 'enabled', name: 'Move task', trigger: { kind: 'manual' }, steps: [{ stepRef: 'step_A', order: 0, kind: 'project_task.transition', taskRef: 'task_A', targetStatus: 'in_progress', approvalPolicy: { kind: 'one_of_roles', roles: ['owner', 'maintainer'] } }], ...overrides } }
function command(type, commandId, payload, expectedRunRevision) { return { commandId, type, ...(expectedRunRevision === undefined ? {} : { expectedRunRevision }), payload } }
function manual(commandId, runRef, overrides = {}) { return command('manual_run', commandId, { definitionRef: 'definition_A', definitionRevision: 1, triggerRef: `trigger_${runRef}`, runRef, taskRef: 'task_A', expectedTaskRevision: 7, ...overrides }) }
function decide(type, commandId, run, approvalRef) { return command(type, commandId, { runRef: run.runRef, approvalRef }, run.revision) }
async function fixture(options = {}) { const [domainMod, stateMod, storeMod] = await Promise.all([import(domainUrl), import(stateUrl), import(storeUrl)]); const root = await mkdtemp(path.join(os.tmpdir(), 'automation-store-')); const filePath = path.join(root, 'automation.enc'); const key = randomBytes(32); const store = new storeMod.ProjectAutomationStore({ projectRef, filePath, encryptionKey: key, ...options }); return { domainMod, stateMod, storeMod, root, filePath, key, store } }
async function usingFixture(run) { const state = await fixture(); try { await run(state) } finally { await state.store.close().catch(() => {}); await rm(state.root, { recursive: true, force: true }) } }
async function seed(state) { return state.store.saveDefinition({ definition: definition(), commandId: 'definition_create_A', expectedRevision: 0, completedAt: '2026-08-24T00:00:00.000Z' }) }
async function createRun(state, runRef, commandId, expectedRevision) { await state.store.executeCommand({ command: manual(commandId, runRef), expectedRevision, completedAt: '2026-08-24T00:01:00.000Z' }); return (await state.store.load()).document.runs.find(run => run.runRef === runRef) }
async function approve(state, run, commandId, approvalRef, expectedRevision, actor = owner) { await state.store.executeCommand({ command: decide('approve', commandId, run, approvalRef), trustedActor: actor, expectedRevision, completedAt: '2026-08-24T00:02:00.000Z' }); return (await state.store.load()).document.runs.find(item => item.runRef === run.runRef) }

test('uses an independent 32-byte key and stores only encrypted six-field documents', async () => usingFixture(async state => {
  assert.deepEqual(await state.store.load(), { revision: 0, document: { definitions: [], runs: [], approvals: [], commandReceipts: [], ledger: [], nextLedgerSequence: 1 } })
  const saved = await seed(state)
  assert.equal(saved.receipt.type, 'definition.create')
  const replay = await state.store.saveDefinition({ definition: definition(), commandId: 'definition_create_A', expectedRevision: 999, completedAt: '2026-08-24T01:00:00.000Z' })
  assert.equal(replay.duplicate, true)
  const updated = await state.store.saveDefinition({ definition: definition({ revision: 2, name: 'Updated task move' }), commandId: 'definition_update_A', expectedRevision: 1, completedAt: '2026-08-24T00:00:30.000Z' })
  assert.equal(updated.receipt.type, 'definition.update')
  assert.equal(updated.receipt.resultRevision, 2)
  const lateCreateReplay = await state.store.saveDefinition({ definition: definition(), commandId: 'definition_create_A', expectedRevision: 999, completedAt: '2026-08-24T02:00:00.000Z' })
  assert.equal(lateCreateReplay.duplicate, true)
  assert.equal(lateCreateReplay.receipt.resultRevision, 1)
  const rawStore = new state.stateMod.EncryptedProjectStateStore(state.filePath, { projectRef, encryptionKey: state.key })
  const plaintext = (await rawStore.load()).state
  assert.deepEqual(Object.keys(plaintext).sort(), ['approvals', 'commandReceipts', 'definitions', 'ledger', 'nextLedgerSequence', 'projectRef', 'runs'])
  assert.equal(Object.hasOwn(plaintext, 'automation'), false)
  await rawStore.close()
  const raw = await readFile(state.filePath, 'utf8')
  for (const secret of ['Move task', 'task_A', 'definitions', 'definition_create_A']) assert.equal(raw.includes(secret), false)
  assert.throws(() => new state.storeMod.ProjectAutomationStore({ projectRef, filePath: `${state.filePath}.bad`, encryptionKey: Buffer.alloc(31) }), /32 bytes/u)
  assert.throws(() => new state.storeMod.ProjectAutomationStore({ projectRef, filePath: `${state.filePath}.bad`, encryptionKey: state.key.toString('base64url') }), /32 bytes/u)
}))

test('persists command receipts, approval, running, and terminal effect projection atomically', async () => usingFixture(async state => {
  await seed(state)
  const manualCommand = manual('manual_A', 'run_A')
  const createdReceipt = await state.store.executeCommand({ command: manualCommand, expectedRevision: 1, completedAt: '2026-08-24T00:01:00.000Z' })
  assert.equal(createdReceipt.receipt.resultRevision, 1)
  assert.equal((await state.store.executeCommand({ command: manualCommand, expectedRevision: 999, completedAt: '2026-08-24T01:00:00.000Z' })).duplicate, true)
  await assert.rejects(state.store.executeCommand({ command: manual('manual_A', 'run_drift'), expectedRevision: 2, completedAt: '2026-08-24T00:01:00.000Z' }), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  let run = (await state.store.load()).document.runs[0]
  await state.store.executeCommand({ command: decide('approve', 'approve_A', run, 'approval_A'), trustedActor: owner, expectedRevision: 2, completedAt: '2026-08-24T00:02:00.000Z' })
  run = (await state.store.load()).document.runs[0]
  assert.equal(run.status, 'queued')
  const running = await state.store.startRun({ runRef: run.runRef, expectedRunRevision: run.revision, expectedRevision: 3, startedAt: '2026-08-24T00:03:00.000Z' })
  run = running.run
  const unknown = await state.store.reconcileEffectReceipt({ runRef: run.runRef, receipt: { effectKey: run.steps[0].effectKey, taskCommandId: run.steps[0].taskCommandId, status: 'unknown' }, expectedRevision: 4 })
  assert.equal(unknown.revision, 4)
  assert.equal(unknown.committed, false)
  const receipt = { effectKey: run.steps[0].effectKey, taskCommandId: run.steps[0].taskCommandId, status: 'succeeded', resultReceiptRef: 'task_receipt_A', finishedAt: '2026-08-24T00:04:00.000Z' }
  const terminal = await state.store.reconcileEffectReceipt({ runRef: run.runRef, receipt, expectedRevision: 4 })
  assert.equal(terminal.run.status, 'succeeded')
  assert.equal((await state.store.reconcileEffectReceipt({ runRef: run.runRef, receipt, expectedRevision: 999 })).duplicate, true)
  const snapshot = await state.store.load()
  assert.equal(snapshot.document.commandReceipts.some(item => item.type === 'effect'), false)
  assert.ok(snapshot.document.ledger.some(item => item.type === 'step.effect_committed' && item.taskCommandId === run.steps[0].taskCommandId && item.resultReceiptRef === 'task_receipt_A'))
  assert.equal(state.domainMod.verifyLedgerChain(snapshot.document.ledger), true)
  const lateReplay = await state.store.executeCommand({ command: manualCommand, expectedRevision: 999, completedAt: '2026-08-24T02:00:00.000Z' })
  assert.equal(lateReplay.duplicate, true)
  assert.deepEqual(lateReplay.receipt, createdReceipt.receipt)
}))

test('receipt-confirmed not_committed atomically closes a cancel-requested run', async () => usingFixture(async state => {
  await seed(state)
  let run = await createRun(state, 'run_cancel_receipt', 'manual_cancel_receipt', 1)
  run = await approve(state, run, 'approve_cancel_receipt', 'approval_cancel_receipt', 2)
  await state.store.startRun({ runRef: run.runRef, expectedRunRevision: run.revision, expectedRevision: 3, startedAt: '2026-08-24T00:03:00.000Z' })
  run = (await state.store.load()).document.runs[0]
  await state.store.executeCommand({ command: command('cancel', 'cancel_receipt', { runRef: run.runRef }, run.revision), trustedActor: owner, expectedRevision: 4, completedAt: '2026-08-24T00:04:00.000Z' })
  run = (await state.store.load()).document.runs[0]
  const receipt = { effectKey: run.steps[0].effectKey, taskCommandId: run.steps[0].taskCommandId, status: 'not_committed', finishedAt: '2026-08-24T00:05:00.000Z' }
  const canceled = await state.store.reconcileEffectReceipt({ runRef: run.runRef, receipt, expectedRevision: 5 })
  assert.equal(canceled.run.status, 'canceled')
  assert.equal((await state.store.reconcileEffectReceipt({ runRef: run.runRef, receipt, expectedRevision: 999 })).duplicate, true)
  assert.ok((await state.store.load()).document.ledger.some(entry => entry.type === 'step.canceled' && entry.taskCommandId === receipt.taskCommandId))
}))

test('trusted approval is checked before receipt or run lookup and leaves no failed side effects', async () => usingFixture(async state => {
  await seed(state)
  const before = await state.store.load()
  const forged = command('approve', 'approve_missing', { runRef: 'missing_run', approvalRef: 'missing_approval' }, 1)
  await assert.rejects(state.store.executeCommand({ command: forged, trustedActor: { actorRef: 'agent_A', kind: 'agent' }, expectedRevision: 1, completedAt: '2026-08-24T00:02:00.000Z' }), error => error.code === 'PROJECT_AUTOMATION_APPROVAL_FORBIDDEN')
  assert.deepEqual(await state.store.load(), before)
}))

test('accepted receipts bind the Host-provided actor-aware input hash', async () => usingFixture(async state => {
  const definitionHash = 'a'.repeat(64), commandHash = 'd'.repeat(64)
  const created = await state.store.saveDefinition({ definition: definition(), commandId: 'definition_actor_bound', inputHash: definitionHash, expectedRevision: 0, completedAt: '2026-08-24T00:00:00.000Z' })
  assert.equal(created.receipt.inputHash, definitionHash)
  assert.equal((await state.store.saveDefinition({ definition: definition(), commandId: 'definition_actor_bound', inputHash: definitionHash, expectedRevision: 999, completedAt: '2026-08-24T00:00:00.000Z' })).duplicate, true)
  await assert.rejects(state.store.saveDefinition({ definition: definition(), commandId: 'definition_actor_bound', inputHash: 'e'.repeat(64), expectedRevision: 1, completedAt: '2026-08-24T00:00:00.000Z' }), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  const executed = await state.store.executeCommand({ command: manual('manual_actor_bound', 'run_actor_bound'), inputHash: commandHash, expectedRevision: 1, completedAt: '2026-08-24T00:01:00.000Z' })
  assert.equal(executed.receipt.inputHash, commandHash)
  const snapshot = await state.store.load()
  assert.ok(snapshot.document.ledger.some(entry => entry.commandId === 'manual_actor_bound' && entry.inputHash === commandHash))
  assert.equal((await state.store.executeCommand({ command: manual('manual_actor_bound', 'run_actor_bound'), inputHash: commandHash, expectedRevision: 999, completedAt: '2026-08-24T00:01:00.000Z' })).duplicate, true)
  await assert.rejects(state.store.executeCommand({ command: manual('manual_actor_bound', 'run_actor_bound'), inputHash: 'f'.repeat(64), expectedRevision: 2, completedAt: '2026-08-24T00:01:00.000Z' }), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  await assert.rejects(state.store.executeCommand({ command: manual('bad_hash', 'run_bad_hash'), inputHash: 'A'.repeat(64), expectedRevision: 2, completedAt: '2026-08-24T00:01:00.000Z' }), /lowercase SHA-256/u)
  assert.deepEqual(await state.store.load(), snapshot)
}))

test('deterministic rejected command receipts persist without mutating domain state', async () => usingFixture(async state => {
  const rejected = {
    commandId: 'manual_rejected_A', inputHash: 'b'.repeat(64), type: 'manual_run', outcome: 'rejected',
    definitionRef: 'definition_missing', completedAt: '2026-08-24T00:01:00.000Z', errorCode: 'PROJECT_AUTOMATION_DEFINITION_NOT_FOUND',
  }
  const saved = await state.store.saveRejectedCommandReceipt({ receipt: rejected, expectedRevision: 0 })
  assert.equal(saved.duplicate, false)
  assert.equal(saved.revision, 1)
  const snapshot = await state.store.load()
  assert.deepEqual(snapshot.document.definitions, [])
  assert.deepEqual(snapshot.document.runs, [])
  assert.deepEqual(snapshot.document.ledger, [])
  assert.deepEqual(snapshot.document.commandReceipts, [rejected])
  const replay = await state.store.saveRejectedCommandReceipt({ receipt: rejected, expectedRevision: 999 })
  assert.equal(replay.duplicate, true)
  assert.deepEqual(replay.receipt, rejected)
  await assert.rejects(state.store.saveRejectedCommandReceipt({ receipt: { ...rejected, inputHash: 'c'.repeat(64) }, expectedRevision: 1 }), error => error.code === 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')
  await assert.rejects(state.store.saveRejectedCommandReceipt({ receipt: { commandId: rejected.commandId, inputHash: rejected.inputHash, type: 'manual_run', outcome: 'accepted', definitionRef: rejected.definitionRef, runRef: 'run_A', resultRevision: 1, completedAt: rejected.completedAt }, expectedRevision: 1 }), /requires a rejected receipt/u)
  assert.deepEqual(await state.store.load(), snapshot)
}))

test('retry, cancellation, and four crash-recoverable nonterminal states survive reopen', async () => usingFixture(async state => {
  await seed(state); let revision = 1
  const awaiting = await createRun(state, 'run_awaiting', 'manual_awaiting', revision++)
  let queued = await createRun(state, 'run_queued', 'manual_queued', revision++); queued = await approve(state, queued, 'approve_queued', 'approval_queued', revision++)
  let running = await createRun(state, 'run_running', 'manual_running', revision++); running = await approve(state, running, 'approve_running', 'approval_running', revision++, maintainer); await state.store.startRun({ runRef: running.runRef, expectedRunRevision: running.revision, expectedRevision: revision++, startedAt: '2026-08-24T00:03:00.000Z' }); running = (await state.store.load()).document.runs.find(run => run.runRef === running.runRef)
  let cancel = await createRun(state, 'run_cancel', 'manual_cancel', revision++); cancel = await approve(state, cancel, 'approve_cancel', 'approval_cancel', revision++); await state.store.startRun({ runRef: cancel.runRef, expectedRunRevision: cancel.revision, expectedRevision: revision++, startedAt: '2026-08-24T00:03:00.000Z' }); cancel = (await state.store.load()).document.runs.find(run => run.runRef === cancel.runRef); await state.store.executeCommand({ command: command('cancel', 'cancel_running', { runRef: cancel.runRef, reasonCode: 'user_request' }, cancel.revision), trustedActor: owner, expectedRevision: revision++, completedAt: '2026-08-24T00:04:00.000Z' })
  let retry = await createRun(state, 'run_retry', 'manual_retry', revision++); retry = await approve(state, retry, 'approve_retry', 'approval_retry', revision++); await state.store.startRun({ runRef: retry.runRef, expectedRunRevision: retry.revision, expectedRevision: revision++, startedAt: '2026-08-24T00:03:00.000Z' }); retry = (await state.store.load()).document.runs.find(run => run.runRef === retry.runRef); await state.store.failRun({ runRef: retry.runRef, expectedRunRevision: retry.revision, expectedRevision: revision++, errorCode: 'PROVIDER_TEMPORARY', retryable: true, finishedAt: '2026-08-24T00:04:00.000Z' }); retry = (await state.store.load()).document.runs.find(run => run.runRef === retry.runRef); await state.store.executeCommand({ command: command('retry', 'retry_A', { runRef: retry.runRef, reasonCode: 'temporary' }, retry.revision), trustedActor: owner, expectedRevision: revision++, completedAt: '2026-08-24T00:05:00.000Z' })
  const reopened = new state.storeMod.ProjectAutomationStore({ projectRef, filePath: state.filePath, encryptionKey: state.key }); const snapshot = await reopened.load(); const statuses = new Map(snapshot.document.runs.map(run => [run.runRef, run.status])); assert.equal(statuses.get(awaiting.runRef), 'awaiting_approval'); assert.equal(statuses.get(queued.runRef), 'queued'); assert.equal(statuses.get(running.runRef), 'running'); assert.equal(statuses.get(cancel.runRef), 'cancel_requested'); assert.equal(statuses.get(retry.runRef), 'queued'); assert.equal(Object.isFrozen(snapshot.document.runs[0].triggerSnapshot.input), true); await reopened.close()
}))

test('wrong key, project AAD, rollback floor, and all ledger tamper forms fail closed', async () => usingFixture(async state => {
  await seed(state); await createRun(state, 'run_A', 'manual_A', 1)
  await assert.rejects(new state.storeMod.ProjectAutomationStore({ projectRef, filePath: state.filePath, encryptionKey: randomBytes(32) }).load(), /authentication or decryption failed/u)
  await assert.rejects(new state.storeMod.ProjectAutomationStore({ projectRef: otherProjectRef, filePath: state.filePath, encryptionKey: state.key }).load(), /another project/u)
  await assert.rejects(new state.storeMod.ProjectAutomationStore({ projectRef, filePath: state.filePath, encryptionKey: state.key, minimumRevision: 3 }).load(), /rollback/u)
  const pristine = await readFile(state.filePath, 'utf8')
  await state.store.saveDefinition({ definition: definition({ revision: 2 }), commandId: 'definition_revision_two', expectedRevision: 2, completedAt: '2026-08-24T00:02:00.000Z' })
  await writeFile(state.filePath, pristine, 'utf8')
  await assert.rejects(state.store.load(), /rollback/u)
  for (const mutate of [doc => { doc.ledger[0].occurredAt = '2026-08-24T02:00:00.000Z' }, doc => { doc.ledger.pop() }, doc => { doc.ledger[0].sequence = 2 }, doc => { doc.ledger[1].previousHash = 'A'.repeat(43) }]) {
    await writeFile(state.filePath, pristine, 'utf8'); const raw = new state.stateMod.EncryptedProjectStateStore(state.filePath, { projectRef, encryptionKey: state.key }); const loaded = await raw.load(); mutate(loaded.state); await raw.save(loaded.state, { expectedRevision: loaded.revision }); const reopened = new state.storeMod.ProjectAutomationStore({ projectRef, filePath: state.filePath, encryptionKey: state.key }); await assert.rejects(reopened.load()); await reopened.close()
  }
}))

test('outer CAS serializes store instances and mutation failures roll back the whole document', async () => usingFixture(async state => {
  await seed(state); const second = new state.storeMod.ProjectAutomationStore({ projectRef, filePath: state.filePath, encryptionKey: state.key })
  const results = await Promise.allSettled([state.store.executeCommand({ command: manual('first', 'run_first'), expectedRevision: 1, completedAt: '2026-08-24T00:01:00.000Z' }), second.executeCommand({ command: manual('second', 'run_second'), expectedRevision: 1, completedAt: '2026-08-24T00:01:00.000Z' })])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PROJECT_AUTOMATION_STORE_CONFLICT')
  const before = await state.store.load(); await assert.rejects(state.store.executeCommand({ command: manual('invalid', 'run_invalid', { taskRef: 'wrong_task' }), expectedRevision: before.revision, completedAt: '2026-08-24T00:02:00.000Z' })); assert.deepEqual(await state.store.load(), before); await second.close()
}))

test('count and 16 MiB limits reject instead of silently trimming', async () => usingFixture(async state => {
  const empty = { definitions: [], runs: [], approvals: [], commandReceipts: [], ledger: [], nextLedgerSequence: 1 }
  assert.throws(() => state.storeMod.validateAutomationDocument({ ...empty, definitions: Array.from({ length: 101 }, (_, index) => definition({ definitionRef: `definition_${index}` })) }), error => error.code === 'PROJECT_AUTOMATION_LIMIT_EXCEEDED')
  assert.throws(() => state.storeMod.validateAutomationDocument({ ...empty, runs: Array(1001).fill({}) }), error => error.code === 'PROJECT_AUTOMATION_LIMIT_EXCEEDED')
  assert.throws(() => state.storeMod.validateAutomationDocument({ ...empty, ledger: Array(10001).fill({}) }), error => error.code === 'PROJECT_AUTOMATION_LIMIT_EXCEEDED')
  const raw = new state.stateMod.EncryptedProjectStateStore(state.filePath, { projectRef, encryptionKey: state.key }); await raw.save({ projectRef, oversized: 'x'.repeat(state.storeMod.MAX_AUTOMATION_PLAINTEXT_BYTES + 1) }, { expectedRevision: 0 }); await assert.rejects(state.store.load(), error => error.code === 'PROJECT_AUTOMATION_LIMIT_EXCEEDED' && error.field === 'plaintext'); await raw.close()
}))

test('close drains accepted mutations, is idempotent, and rejects new work', async () => usingFixture(async state => {
  const accepted = state.store.saveDefinition({ definition: definition(), commandId: 'definition_close', expectedRevision: 0, completedAt: '2026-08-24T00:00:00.000Z' })
  const closeA = state.store.close(), closeB = state.store.close(); assert.equal(closeA, closeB); assert.equal((await accepted).revision, 1); await closeA
  await assert.rejects(state.store.load(), error => error.code === 'PROJECT_STATE_CLOSED')
  await assert.rejects(state.store.saveDefinition({ definition: definition({ definitionRef: 'later' }), commandId: 'later', expectedRevision: 1, completedAt: '2026-08-24T00:01:00.000Z' }), error => error.code === 'PROJECT_STATE_CLOSED')
}))
