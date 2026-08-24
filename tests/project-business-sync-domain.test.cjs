const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-business-sync-domain.js')).href
const sentAt = '2026-08-24T01:00:00.000Z'
function base(type, messageRef = `message_${type.replace('.', '_')}`) { return { version: 1, type, messageRef, sentAt } }
function task(overrides = {}) { return { taskRef: 'task_A', title: 'Move task', status: 'in_progress', revision: 3, requirementsRevision: 2, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:30:00.000Z', hasAssignee: true, blockedByCount: 0, ...overrides } }
function definition(overrides = {}) { return { definitionRef: 'definition_A', revision: 2, status: 'enabled', name: 'Move task automatically', taskRef: 'task_A', targetStatus: 'in_progress', ...overrides } }
function run(overrides = {}) { return { runRef: 'run_A', definitionRef: 'definition_A', revision: 4, status: 'succeeded', createdAt: '2026-08-24T00:00:00.000Z', startedAt: '2026-08-24T00:01:00.000Z', finishedAt: '2026-08-24T00:02:00.000Z', ...overrides } }
function ledger(overrides = {}) { return { sequence: 7, type: 'run.succeeded', occurredAt: '2026-08-24T00:02:00.000Z', runRef: 'run_A', definitionRef: 'definition_A', status: 'succeeded', ...overrides } }
function command(overrides = {}) { return { ...base('task.command'), commandId: 'command_A', resource: 'task', action: 'transition', taskRef: 'task_A', expectedRevision: 3, payload: { to: 'canceled' }, ...overrides } }
function receiptAck(overrides = {}) { return { ...base('ack', 'ack_receipt'), replyTo: 'receipt_A', kind: 'receipt', ackDigest: 'a'.repeat(64), ...overrides } }
function pageAck(overrides = {}) { return { ...base('ack', 'ack_page'), replyTo: 'page_A', kind: 'page', stream: 'task', cursor: 7, resetToken: 'reset_A', ...overrides } }
function eventFor(stream, cursor = 7) { return stream === 'task' ? { cursor, type: 'task.changed', occurredAt: sentAt, task: task() } : { cursor, type: 'automation.changed', occurredAt: sentAt, ledger: ledger({ sequence: cursor }) } }
function normalPage(stream = 'task', overrides = {}) { return { ...base('event.page', `page_${stream}`), stream, afterCursor: 6, nextCursor: 7, hasMore: false, events: [eventFor(stream)], ...overrides } }
function itemFor(stream, index) { return stream === 'task' ? { task: task({ taskRef: `task_${index}`, title: `Task ${index}` }) } : index % 3 === 0 ? { definition: definition({ definitionRef: `definition_${index}` }) } : index % 3 === 1 ? { run: run({ runRef: `run_${index}` }) } : { ledger: ledger({ sequence: index + 1 }) } }
function resetPage(stream = 'task', { offset = 0, count = 1, totalItems = count, cursor = 9, afterCursor = 2, resetToken = 'reset_A', ...overrides } = {}) { const nextOffset = offset + count; return { ...base('event.page', `reset_${stream}_${offset}`), stream, afterCursor, nextCursor: cursor, hasMore: nextOffset < totalItems, resetToken, snapshot: { cursor, offset, nextOffset, totalItems, items: Array.from({ length: count }, (_, index) => itemFor(stream, offset + index)) }, ...overrides } }
async function mod() { return import(moduleUrl) }
function validMessages() { return [
  { ...base('hello'), supportedVersions: [1], cursors: { task: 7, automation: 11 }, resetToken: 'reset_A' },
  { ...base('capability'), writable: true, taskCommands: ['transition', 'claim'], automationCommands: ['reject', 'approve'], maxPageSize: 100, maxInflight: 8, currentCursors: { task: 8, automation: 12 }, resetToken: 'reset_A' },
  command(),
  { ...base('task.receipt'), replyTo: 'message_task_command', commandId: 'command_A', requestDigest: 'b'.repeat(64), outcome: 'accepted', completedAt: sentAt, task: task() },
  { ...base('event.pull'), stream: 'task', cursor: 7, limit: 100 },
  normalPage(),
  receiptAck(),
] }

test('all seven v1 message types round-trip with independent stream cursors', async () => {
  const api = await mod()
  for (const input of validMessages()) { const normalized = api.normalizeBusinessSyncMessage(input), reopened = api.normalizeBusinessSyncMessage(JSON.parse(JSON.stringify(normalized))); assert.deepEqual(reopened, normalized); assert.equal(Object.isFrozen(normalized), true) }
  const hello = api.normalizeBusinessSyncMessage(validMessages()[0]); assert.deepEqual(hello.cursors, { task: 7, automation: 11 }); assert.equal(Object.isFrozen(hello.cursors), true)
  const capability = api.normalizeBusinessSyncMessage(validMessages()[1]); assert.deepEqual(capability.currentCursors, { task: 8, automation: 12 }); assert.deepEqual(capability.taskCommands, ['claim', 'transition']); assert.throws(() => api.normalizeBusinessSyncMessage({ ...validMessages()[1], maxInflight: 9 })); assert.throws(() => api.normalizeBusinessSyncMessage({ ...validMessages()[0], cursors: { task: 7 } }))
})

test('every message rejects extra, missing, cross-type, identity, and content fields', async () => {
  const api = await mod(), messages = validMessages(), required = ['supportedVersions', 'writable', 'commandId', 'requestDigest', 'cursor', 'afterCursor', 'ackDigest']
  for (let index = 0; index < messages.length; index += 1) { assert.throws(() => api.normalizeBusinessSyncMessage({ ...messages[index], unexpected: true })); const missing = { ...messages[index] }; delete missing[required[index]]; assert.throws(() => api.normalizeBusinessSyncMessage(missing)); const cross = ['task.command', 'task.receipt'].includes(messages[index].type) ? { events: [] } : { commandId: 'cross' }; assert.throws(() => api.normalizeBusinessSyncMessage({ ...messages[index], ...cross })) }
  for (const mutation of [value => { value.eventRef = 'event_A' }, value => { value.approvalRef = 'approval_A' }, value => { value.actorRef = 'human_A' }, value => { value.projectRef = 'project_A' }, value => { value.payload.blockReason = 'detail' }, value => { value.payload.comment = 'body' }, value => { value.payload.requirements = 'body' }, value => { value.payload.fileScope = ['x'] }]) { const value = command(); mutation(value); assert.throws(() => api.normalizeBusinessSyncMessage(value)) }
})

test('wire commands remain narrow for Task and Automation', async () => {
  const api = await mod(); assert.deepEqual(api.normalizeBusinessSyncMessage({ ...command(), action: 'claim', payload: {} }).payload, {})
  for (const to of api.BUSINESS_SYNC_TRANSITION_TARGETS) assert.equal(api.normalizeBusinessSyncMessage({ ...command(), payload: { to } }).payload.to, to)
  // Remote v1 cannot safely block because the wire deliberately carries no private block reason.
  for (const to of ['blocked', 'in_review', 'done', 'ready']) assert.throws(() => api.normalizeBusinessSyncMessage({ ...command(), payload: { to } }))
  const automation = api.normalizeBusinessSyncMessage({ ...base('task.command', 'automation_A'), commandId: 'approve_A', resource: 'automation', action: 'approve', runRef: 'run_A', expectedRevision: 4, payload: { reasonCode: 'checked' } }); assert.deepEqual(automation.payload, { reasonCode: 'checked' }); assert.throws(() => api.normalizeBusinessSyncMessage({ ...automation, taskRef: 'task_A' })); assert.throws(() => api.normalizeBusinessSyncMessage({ ...command(), runRef: 'run_A' }))
})

test('receipts expose fixed safe results and ack kinds forbid cross fields', async () => {
  const api = await mod(), taskReceipt = api.normalizeBusinessSyncMessage(validMessages()[3]); assert.deepEqual(Object.keys(taskReceipt.task).sort(), ['blockedByCount', 'createdAt', 'hasAssignee', 'requirementsRevision', 'revision', 'status', 'taskRef', 'title', 'updatedAt'])
  const automationReceipt = api.normalizeBusinessSyncMessage({ ...base('task.receipt', 'receipt_run'), commandId: 'approve_A', requestDigest: 'c'.repeat(64), outcome: 'accepted', completedAt: sentAt, run: run(), approval: { decision: 'approved', decidedAt: sentAt } }); assert.deepEqual(automationReceipt.approval, { decision: 'approved', decidedAt: sentAt })
  const rejected = api.normalizeBusinessSyncMessage({ ...base('task.receipt', 'receipt_rejected'), commandId: 'command_A', requestDigest: 'd'.repeat(64), outcome: 'rejected', completedAt: sentAt, code: 'PROJECT_BUSINESS_SYNC_CONFLICT', retryable: true }); assert.equal(Object.hasOwn(rejected, 'message'), false)
  assert.ok(api.BUSINESS_SYNC_REJECTION_CODES.includes(rejected.code))
  assert.throws(() => api.normalizeBusinessSyncMessage({ ...rejected, code: 'SECRET_DETAILS_IN_ERROR_CODE' }), /fixed public allowlist/u)
  assert.equal(api.normalizeBusinessSyncMessage(receiptAck()).kind, 'receipt'); assert.equal(api.normalizeBusinessSyncMessage(pageAck()).kind, 'page'); assert.throws(() => api.normalizeBusinessSyncMessage({ ...receiptAck(), stream: 'task', cursor: 7, resetToken: 'reset_A' })); assert.throws(() => api.normalizeBusinessSyncMessage({ ...pageAck(), ackDigest: 'a'.repeat(64) }))
})

test('lossless gate rejects descriptors, exotic values, cycles, depth, and -0 before access', async () => {
  const api = await mod(), mutations = [value => { value.expectedRevision = -0 }, value => { value.expectedRevision = Infinity }, value => { value.payload.to = undefined }, value => { value.payload.to = () => {} }, value => { value.payload = new Date() }, value => { Object.setPrototypeOf(value.payload, { inherited: true }) }, value => { value.payload = []; value.payload.length = 1 }, value => { value.payload = []; value.payload.push('x'); value.payload.extra = true }, value => { Object.defineProperty(value, 'hidden', { value: true, enumerable: false }) }, value => { value[Symbol('identity')] = 'x' }, value => { value.payload.self = value.payload }]
  for (const mutate of mutations) { const value = command(); mutate(value); assert.throws(() => api.normalizeBusinessSyncMessage(value)) }
  let getterRuns = 0; const getter = command(); Object.defineProperty(getter, 'actorRef', { enumerable: true, get() { getterRuns += 1; return 'human_A' } }); assert.throws(() => api.normalizeBusinessSyncMessage(getter)); assert.equal(getterRuns, 0)
  const deep = command(); let cursor = deep.payload; for (let index = 0; index < api.BUSINESS_SYNC_MAX_DEPTH + 2; index += 1) cursor = cursor.child = {}; assert.throws(() => api.normalizeBusinessSyncMessage(deep), /depth/u)
  const shared = task(), sharedPage = resetPage('task', { count: 2, totalItems: 2 }); sharedPage.snapshot.items = [{ task: shared }, { task: shared }]; assert.equal(api.normalizeBusinessSyncMessage(sharedPage).snapshot.items.length, 2)
})

test('normal pages are stream-specific and enforce contiguous independent cursors', async () => {
  const api = await mod(); assert.equal(api.normalizeBusinessSyncMessage(normalPage('task')).stream, 'task'); assert.equal(api.normalizeBusinessSyncMessage(normalPage('automation')).stream, 'automation')
  const combined = api.normalizeBusinessSyncMessage(normalPage('automation', { events: [{ ...eventFor('automation'), run: run() }] })); assert.equal(combined.events[0].run.runRef, 'run_A'); assert.equal(combined.events[0].ledger.sequence, 7)
  assert.throws(() => api.normalizeBusinessSyncMessage(normalPage('automation', { events: [{ ...eventFor('automation'), ledger: undefined, run: run() }] }))); assert.throws(() => api.normalizeBusinessSyncMessage(normalPage('automation', { events: [{ ...eventFor('automation'), definition: definition(), run: run() }] })))
  assert.throws(() => api.normalizeBusinessSyncMessage(normalPage('task', { events: [eventFor('automation')] }))); assert.throws(() => api.normalizeBusinessSyncMessage(normalPage('automation', { events: [eventFor('task')] }))); assert.throws(() => api.normalizeBusinessSyncMessage(normalPage('automation', { events: [{ ...eventFor('automation'), ledger: ledger({ sequence: 8 }) }] })), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.CURSOR_CONFLICT)
  assert.throws(() => api.normalizeBusinessSyncMessage(normalPage('task', { events: [{ ...eventFor('task'), cursor: 8 }], nextCursor: 8 })), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.EVENT_GAP); assert.throws(() => api.normalizeBusinessSyncMessage(normalPage('task', { nextCursor: 8 })), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.CURSOR_CONFLICT)
  assert.deepEqual(api.applyBusinessEventPageCursor({ cursor: 6, pendingReset: null }, normalPage('task')), { cursor: 7, pendingReset: null })
})

test('reset snapshots paginate beyond 100 and commit cursor only on final page', async () => {
  const api = await mod(), first = resetPage('task', { offset: 0, count: 100, totalItems: 150 }), second = resetPage('task', { offset: 100, count: 50, totalItems: 150 })
  const firstNormalized = api.normalizeBusinessSyncMessage(first); assert.equal(firstNormalized.snapshot.items.length, 100); assert.equal(firstNormalized.hasMore, true)
  const pending = api.applyBusinessEventPageCursor({ cursor: 2, pendingReset: null }, first, { resetToken: 'reset_A' }); assert.equal(pending.cursor, 2); assert.equal(pending.pendingReset.nextOffset, 100)
  const complete = api.applyBusinessEventPageCursor(pending, second, { resetToken: 'reset_A' }); assert.deepEqual(complete, { cursor: 9, pendingReset: null })
  assert.throws(() => api.applyBusinessEventPageCursor(pending, resetPage('task', { offset: 101, count: 49, totalItems: 150 }), { resetToken: 'reset_A' }), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.EVENT_GAP); assert.throws(() => api.applyBusinessEventPageCursor(pending, resetPage('automation', { offset: 100, count: 50, totalItems: 150 }), { resetToken: 'reset_A' }), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.EVENT_GAP); assert.throws(() => api.applyBusinessEventPageCursor({ cursor: 2, pendingReset: null }, first), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.RESET_REQUIRED)
  assert.throws(() => api.normalizeBusinessSyncMessage(resetPage('task', { offset: 0, count: 101, totalItems: 101 })), /100/u); assert.throws(() => api.normalizeBusinessSyncMessage(resetPage('task', { offset: 0, count: 0, totalItems: 1 })), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.EVENT_GAP); const wrongMore = resetPage('task', { offset: 0, count: 1, totalItems: 2 }); wrongMore.hasMore = false; assert.throws(() => api.normalizeBusinessSyncMessage(wrongMore), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.CURSOR_CONFLICT)
  const large = resetPage('task', { offset: 0, count: 100, totalItems: 100 }); for (const item of large.snapshot.items) item.task.title = '界'.repeat(500); assert.throws(() => api.normalizeBusinessSyncMessage(large), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.TOO_LARGE)
})

test('reset pulls carry stream, token, and offset as an exact pair', async () => {
  const api = await mod(), pull = api.normalizeBusinessSyncMessage({ ...base('event.pull'), stream: 'automation', cursor: 11, limit: 50, resetToken: 'reset_A', offset: 100 }); assert.equal(pull.offset, 100)
  const noOffset = { ...pull }; delete noOffset.offset; assert.throws(() => api.normalizeBusinessSyncMessage(noOffset)); const noToken = { ...pull }; delete noToken.resetToken; assert.throws(() => api.normalizeBusinessSyncMessage(noToken)); assert.throws(() => api.normalizeBusinessSyncMessage({ ...pull, stream: 'both' }))
})

test('request digest binds trusted sender/epoch and replay is exact', async () => {
  const api = await mod(), message = command(), digestA = api.businessRequestDigest(message, { senderDeviceRef: 'device_A', authorityEpoch: 1 }); assert.equal(digestA.length, 64); assert.equal(api.businessRequestDigest(JSON.parse(JSON.stringify(message)), { senderDeviceRef: 'device_A', authorityEpoch: 1 }), digestA); assert.notEqual(api.businessRequestDigest(message, { senderDeviceRef: 'device_B', authorityEpoch: 1 }), digestA); assert.notEqual(api.businessRequestDigest(message, { senderDeviceRef: 'device_A', authorityEpoch: 2 }), digestA); assert.equal(api.assertBusinessRequestReplay({ commandId: message.commandId, requestDigest: digestA }, { commandId: message.commandId, requestDigest: digestA }), true); assert.throws(() => api.assertBusinessRequestReplay({ commandId: message.commandId, requestDigest: digestA }, { commandId: message.commandId, requestDigest: 'e'.repeat(64) }), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.REPLAY_CONFLICT)
})

test('ack monotonic rules are scoped by kind, stream, and reset token', async () => {
  const api = await mod(); assert.equal(api.assertMonotonicBusinessAck(receiptAck(), receiptAck()).kind, 'receipt'); assert.throws(() => api.assertMonotonicBusinessAck(receiptAck(), receiptAck({ ackDigest: 'b'.repeat(64) })), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.REPLAY_CONFLICT); assert.throws(() => api.assertMonotonicBusinessAck(receiptAck(), receiptAck({ replyTo: 'other' })), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.REPLAY_CONFLICT)
  assert.equal(api.assertMonotonicBusinessAck(pageAck(), pageAck({ cursor: 8 })).cursor, 8); assert.throws(() => api.assertMonotonicBusinessAck(pageAck(), pageAck({ cursor: 6 })), error => error.code === api.BUSINESS_SYNC_ERROR_CODES.CURSOR_CONFLICT); assert.equal(api.assertMonotonicBusinessAck(pageAck(), pageAck({ stream: 'automation', cursor: 1 })).cursor, 1); assert.equal(api.assertMonotonicBusinessAck(pageAck(), pageAck({ resetToken: 'reset_B', cursor: 1 })).cursor, 1)
})

test('safe projections copy only approved fields and never reuse secrets or hashes', async () => {
  const api = await mod(), safeTask = api.projectSafeBusinessTask({ ...task(), requirements: 'secret', fileScope: ['C:/secret'], assigneeRef: 'human_A', blockedBy: ['task_B'] }); assert.deepEqual(safeTask, task())
  let getterRuns = 0; const unsafeStep = { targetStatus: 'blocked' }; Object.defineProperty(unsafeStep, 'taskRef', { enumerable: true, get() { getterRuns += 1; return 'task_A' } }); assert.throws(() => api.projectSafeBusinessDefinition({ definitionRef: 'definition_A', revision: 1, status: 'enabled', name: 'Auto', steps: [unsafeStep] })); assert.equal(getterRuns, 0)
  const outputs = [safeTask, api.projectSafeBusinessDefinition({ definitionRef: 'definition_A', revision: 1, status: 'enabled', name: 'Auto', definitionSnapshot: { secret: true }, steps: [{ taskRef: 'task_A', targetStatus: 'blocked', blockReason: 'waiting' }] }), api.projectSafeBusinessRun({ ...run(), definitionSnapshot: {}, triggerSnapshot: {}, effectKey: 'effect', taskCommandId: 'command', resultReceiptRef: 'receipt', actorRef: 'human_A' }), api.projectSafeBusinessLedgerEntry({ ...ledger(), entryHash: 'hash', previousHash: 'hash', actorRef: 'human_A', taskCommandId: 'command', inputHash: 'secret' })]
  for (const output of outputs) { const json = JSON.stringify(output); for (const secret of ['"requirements":', '"fileScope":', '"actorRef":', '"definitionSnapshot":', '"effectKey":', '"taskCommandId":', '"entryHash":', '"previousHash":']) assert.equal(json.includes(secret), false) }
})
