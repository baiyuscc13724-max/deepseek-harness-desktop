const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-business-sync-store.js')).href
const stateUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-state-store.js')).href
const projectRef = `project_${'S'.repeat(24)}`
const sentAt = '2026-08-24T02:00:00.000Z'
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value }
function wireHash(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex') }
function base(type, messageRef) { return { version: 1, type, messageRef, sentAt } }
function task(index = 0, overrides = {}) { return { taskRef: `task_${index}`, title: `Task ${index}`, status: 'in_progress', revision: 3, requirementsRevision: 2, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:30:00.000Z', hasAssignee: true, blockedByCount: 0, ...overrides } }
function definition(index = 0) { return { definitionRef: `definition_${index}`, revision: 1, status: 'enabled', name: `Automation ${index}`, taskRef: `task_${index}`, targetStatus: 'in_progress' } }
function run(index = 0) { return { runRef: `run_${index}`, definitionRef: `definition_${index}`, revision: 2, status: 'queued', createdAt: '2026-08-24T00:00:00.000Z' } }
function ledger(sequence = 1) { return { sequence, type: 'run.queued', occurredAt: sentAt, runRef: 'run_0', definitionRef: 'definition_0', status: 'queued' } }
function capability(messageRef = 'capability_A', overrides = {}) { return { ...base('capability', messageRef), writable: true, taskCommands: ['claim', 'transition'], automationCommands: ['approve', 'reject'], maxPageSize: 100, maxInflight: 4, currentCursors: { task: 200, automation: 300 }, resetToken: 'reset_A', ...overrides } }
function receipt(commandId = 'command_A', requestDigest = 'a'.repeat(64), overrides = {}) { return { ...base('task.receipt', `receipt_${commandId}`), replyTo: `request_${commandId}`, commandId, requestDigest, outcome: 'accepted', completedAt: sentAt, task: task(0), ...overrides } }
function taskPage(cursor, index = cursor) { return { ...base('event.page', `task_page_${cursor}`), stream: 'task', afterCursor: cursor - 1, nextCursor: cursor, hasMore: false, events: [{ cursor, type: 'task.transitioned', occurredAt: sentAt, task: task(index) }] } }
function automationPage(cursor) { return { ...base('event.page', `automation_page_${cursor}`), stream: 'automation', afterCursor: cursor - 1, nextCursor: cursor, hasMore: false, events: [{ cursor, type: 'run.queued', occurredAt: sentAt, ledger: ledger(cursor) }] } }
function resetPage({ stream = 'task', offset = 0, count = 100, totalItems = 150, cursor = 9, resetToken = 'reset_A', afterCursor = 0 } = {}) { const nextOffset = offset + count; const items = Array.from({ length: count }, (_, index) => stream === 'task' ? { task: task(offset + index) } : (offset + index) % 3 === 0 ? { definition: definition(offset + index) } : (offset + index) % 3 === 1 ? { run: run(offset + index) } : { ledger: ledger(offset + index + 1) }); return { ...base('event.page', `reset_${stream}_${offset}`), stream, afterCursor, nextCursor: cursor, hasMore: nextOffset < totalItems, resetToken, snapshot: { cursor, offset, nextOffset, totalItems, items } } }
function wireMessage(messageRef = 'outbox_A') { return { ...base('event.pull', messageRef), stream: 'task', cursor: 0, limit: 100 } }
function receiptAck(messageRef = 'outbox_A', digest = 'b'.repeat(64)) { return { ...base('ack', `ack_${messageRef}`), replyTo: messageRef, kind: 'receipt', ackDigest: digest } }
function taskCommand(commandId = 'command_A', overrides = {}) { return { ...base('task.command', `request_${commandId}`), commandId, resource: 'task', action: 'claim', taskRef: 'task_1', expectedRevision: 1, payload: {}, ...overrides } }
function rejectedReceipt(commandId, requestDigest, replyTo) { return { ...base('task.receipt', `receipt_${commandId}`), replyTo, commandId, requestDigest, outcome: 'rejected', completedAt: sentAt, code: 'PROJECT_BUSINESS_SYNC_CONFLICT', retryable: false } }
async function fixture({ mode = 'collaborator', authorityEpoch = 1, minimumRevision = 0 } = {}) { const [storeMod, stateMod] = await Promise.all([import(storeUrl), import(stateUrl)]); const root = await mkdtemp(path.join(os.tmpdir(), 'business-sync-store-')), filePath = path.join(root, 'sync.enc'), key = randomBytes(32), store = new storeMod.ProjectBusinessSyncStore({ projectRef, filePath, encryptionKey: key, mode, authorityEpoch, minimumRevision }); return { storeMod, stateMod, root, filePath, key, store, mode, authorityEpoch } }
async function usingFixture(options, run) { const state = await fixture(options); try { await run(state) } finally { await state.store.close().catch(() => {}); await rm(state.root, { recursive: true, force: true }) } }
async function initPeer(state, expectedRevision = 0, peerDeviceRef = 'device_A') { return state.store.updateCapability({ peerDeviceRef, capability: capability(), expectedRevision, updatedAt: sentAt }) }

test('uses an independent encrypted exact-schema state and fixed mode', async () => usingFixture({}, async state => {
  const loaded = await state.store.load(); assert.equal(loaded.revision, 0); const diagnostic = JSON.stringify(state.store); for (const secret of ['encryptionKey', 'filePath', 'actorRef', 'requirements', 'fileScope', 'comment', 'body']) assert.equal(diagnostic.includes(secret), false); assert.deepEqual(Object.keys(loaded.state).sort(), ['authorityEpoch', 'businessReceipts', 'controlReceipts', 'mode', 'outbox', 'peerCursors', 'pendingReset', 'projectRef', 'resetGeneration', 'safeCache', 'schemaVersion'])
  await initPeer(state)
  const rawText = await readFile(state.filePath, 'utf8'); for (const text of ['device_A', 'reset_A', 'peerCursors']) assert.equal(rawText.includes(text), false)
  const raw = new state.stateMod.EncryptedProjectStateStore(state.filePath, { projectRef, encryptionKey: state.key }); const plaintext = (await raw.load()).state; assert.equal(plaintext.mode, 'collaborator'); assert.equal(Object.hasOwn(plaintext, 'revision'), false); await raw.close()
  await assert.rejects(new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: state.filePath, encryptionKey: state.key, mode: 'authority', authorityEpoch: 1 }).load(), error => error.code === 'PROJECT_BUSINESS_SYNC_STATE_MISMATCH')
  assert.throws(() => new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: `${state.filePath}.bad`, encryptionKey: Buffer.alloc(31), mode: 'collaborator', authorityEpoch: 1 }), /32 bytes/u)
}))

test('Host-only collaborator capability is safe, durable, and reset-aware', async () => usingFixture({}, async state => {
  assert.deepEqual(await state.store.getCollaboratorCapability(), { revision: 0, capability: undefined })
  await initPeer(state)
  const first = await state.store.getCollaboratorCapability()
  assert.deepEqual(first.capability, { writable: true, taskCommands: ['claim', 'transition'], automationCommands: ['approve', 'reject'], maxPageSize: 100, maxInflight: 4, currentCursors: { task: 200, automation: 300 }, resetToken: 'reset_A' })
  for (const privateField of ['device_A', 'messageRef', 'digest', 'peerDeviceRef']) assert.equal(JSON.stringify(first.capability).includes(privateField), false)
  await state.store.close()
  const reopened = new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: state.filePath, encryptionKey: state.key, mode: 'collaborator', authorityEpoch: 1 })
  try {
    assert.deepEqual((await reopened.getCollaboratorCapability()).capability, first.capability)
    const loaded = await reopened.load()
    await reopened.updateCapability({ peerDeviceRef: 'device_A', capability: capability('capability_B', { resetToken: 'reset_B', writable: false, taskCommands: [], automationCommands: [], currentCursors: { task: 0, automation: 0 } }), expectedRevision: loaded.revision, updatedAt: '2026-08-24T02:01:00.000Z' })
    assert.deepEqual((await reopened.getCollaboratorCapability()).capability, { writable: false, taskCommands: [], automationCommands: [], maxPageSize: 100, maxInflight: 4, currentCursors: { task: 0, automation: 0 }, resetToken: 'reset_B' })
    const rotated = await reopened.load(); await reopened.rotateAuthorityEpoch({ authorityEpoch: 2, resetToken: 'reset_C', expectedRevision: rotated.revision, updatedAt: '2026-08-24T02:02:00.000Z' })
    assert.equal((await reopened.getCollaboratorCapability()).capability, undefined)
  } finally { await reopened.close() }
}))

test('persisted cache codecs enumerate every status and Automation ledger type', async () => usingFixture({}, async state => {
  const empty = (await state.store.load()).state, context = { projectRef, mode: 'collaborator', authorityEpoch: 1 }
  const corruptions = [
    { tasks: [task(0, { status: 'evil' })] },
    { definitions: [{ ...definition(0), status: 'evil' }] },
    { runs: [{ ...run(0), status: 'evil' }] },
    { ledger: [{ ...ledger(1), type: 'evil.event' }] },
  ]
  for (const patch of corruptions) assert.throws(() => state.storeMod.normalizeBusinessSyncState({ ...empty, safeCache: { ...empty.safeCache, ...patch } }, context), error => error.code === 'PROJECT_BUSINESS_SYNC_STATE_INVALID')
}))

test('business receipts deduplicate the same sender and command across LAN/WSS', async () => usingFixture({}, async state => {
  const requestDigest = 'a'.repeat(64), accepted = receipt('command_A', requestDigest)
  const first = await state.store.recordBusinessReceipt({ senderDeviceRef: 'device_A', commandId: 'command_A', requestDigest, receipt: accepted, expectedRevision: 0 }); assert.equal(first.duplicate, false)
  const replay = await state.store.recordBusinessReceipt({ senderDeviceRef: 'device_A', commandId: 'command_A', requestDigest, receipt: accepted, expectedRevision: 999 }); assert.equal(replay.duplicate, true)
  assert.deepEqual((await state.store.getBusinessReceipt({ senderDeviceRef: 'device_A', commandId: 'command_A', requestDigest })).receipt, accepted)
  await assert.rejects(state.store.recordBusinessReceipt({ senderDeviceRef: 'device_A', commandId: 'command_A', requestDigest: 'c'.repeat(64), receipt: receipt('command_A', 'c'.repeat(64)), expectedRevision: 1 }), error => error.code === 'PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT')
  const otherSender = await state.store.recordBusinessReceipt({ senderDeviceRef: 'device_B', commandId: 'command_A', requestDigest, receipt: accepted, expectedRevision: 1 }); assert.equal(otherSender.duplicate, false)
  assert.equal((await state.store.load()).state.businessReceipts.length, 2)
}))

test('atomic receipt/outbox APIs close authority and collaborator crash windows', async () => usingFixture({}, async state => {
  const accepted = receipt('atomic_command', 'a'.repeat(64)), wireDigest = wireHash(accepted)
  const saved = await state.store.recordBusinessReceiptAndEnqueueOutbox({ senderDeviceRef: 'device_A', targetDeviceRef: 'device_A', commandId: accepted.commandId, requestDigest: accepted.requestDigest, receipt: accepted, digest: wireDigest, expectedRevision: 0, queuedAt: sentAt }); assert.equal(saved.revision, 1); let loaded = await state.store.load(); assert.equal(loaded.state.businessReceipts.length, 1); assert.equal(loaded.state.outbox[0].messageRef, accepted.messageRef)
  assert.equal((await state.store.recordBusinessReceiptAndEnqueueOutbox({ senderDeviceRef: 'device_A', targetDeviceRef: 'device_A', commandId: accepted.commandId, requestDigest: accepted.requestDigest, receipt: accepted, digest: wireDigest, expectedRevision: 999, queuedAt: sentAt })).duplicate, true)
}))

test('inbound receipt atomically records result, removes command, and enqueues ack', async () => usingFixture({}, async state => {
  const message = { ...base('task.command', 'request_atomic'), commandId: 'atomic_command', resource: 'task', action: 'claim', taskRef: 'task_1', expectedRevision: 1, payload: {} }, requestDigest = 'a'.repeat(64), accepted = receipt('atomic_command', requestDigest, { replyTo: message.messageRef }), receiptDigest = wireHash(accepted), ack = receiptAck(accepted.messageRef, receiptDigest)
  await state.store.enqueueOutbox({ targetDeviceRef: 'authority_A', message, digest: requestDigest, expectedRevision: 0, queuedAt: sentAt }); const completed = await state.store.recordInboundReceiptAndCompleteOutbox({ senderDeviceRef: 'authority_A', targetDeviceRef: 'authority_A', receipt: accepted, ack, receiptDigest, ackDigest: wireHash(ack), expectedRevision: 1, queuedAt: sentAt }); assert.equal(completed.revision, 2)
  const loaded = await state.store.load(); assert.equal(loaded.state.businessReceipts.length, 1); assert.equal(loaded.state.outbox.length, 1); assert.equal(loaded.state.outbox[0].messageRef, ack.messageRef); assert.equal(loaded.state.outbox.some(item => item.messageRef === message.messageRef), false)
}))

test('outbound task command wire and final result survive offline completion and restart exactly', async () => usingFixture({}, async state => {
  const target = 'authority_A', acceptedCommand = taskCommand('durable_accepted', { action: 'transition', payload: { to: 'in_progress' } }), acceptedDigest = 'a'.repeat(64)
  await state.store.enqueueOutbox({ targetDeviceRef: target, message: acceptedCommand, digest: acceptedDigest, expectedRevision: 0, queuedAt: sentAt })
  assert.deepEqual(await state.store.getOutboundCommand({ targetDeviceRef: target, commandId: acceptedCommand.commandId }), { revision: 1, status: 'pending', message: acceptedCommand, digest: acceptedDigest })
  for (const drift of [
    taskCommand('durable_accepted', { messageRef: 'request_drift_action' }),
    taskCommand('durable_accepted', { messageRef: 'request_drift_revision', action: 'transition', expectedRevision: 2, payload: { to: 'in_progress' } }),
    taskCommand('durable_accepted', { messageRef: 'request_drift_payload', action: 'transition', payload: { to: 'todo' } }),
  ]) await assert.rejects(state.store.enqueueOutbox({ targetDeviceRef: target, message: drift, digest: 'b'.repeat(64), expectedRevision: 1, queuedAt: sentAt }), error => error.code === 'PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT')
  await assert.rejects(state.store.getOutboundCommand({ targetDeviceRef: 'authority_B', commandId: acceptedCommand.commandId }), error => error.code === 'PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT')
  const accepted = receipt(acceptedCommand.commandId, acceptedDigest, { replyTo: acceptedCommand.messageRef }), acceptedWireDigest = wireHash(accepted), acceptedAck = receiptAck(accepted.messageRef, acceptedWireDigest)
  await assert.rejects(state.store.recordInboundReceiptAndCompleteOutbox({ senderDeviceRef: 'authority_B', targetDeviceRef: 'authority_B', receipt: accepted, ack: acceptedAck, receiptDigest: acceptedWireDigest, ackDigest: wireHash(acceptedAck), expectedRevision: 1, queuedAt: sentAt }), error => error.code === 'PROJECT_BUSINESS_SYNC_ACK_INVALID')
  assert.equal((await state.store.getOutboundCommand({ targetDeviceRef: target, commandId: acceptedCommand.commandId })).status, 'pending')
  await state.store.recordInboundReceiptAndCompleteOutbox({ senderDeviceRef: target, targetDeviceRef: target, receipt: accepted, ack: acceptedAck, receiptDigest: acceptedWireDigest, ackDigest: wireHash(acceptedAck), expectedRevision: 1, queuedAt: sentAt })
  let completed = await state.store.getOutboundCommand({ targetDeviceRef: target, commandId: acceptedCommand.commandId })
  assert.equal(completed.status, 'completed'); assert.deepEqual(completed.message, acceptedCommand); assert.equal(completed.digest, acceptedDigest); assert.deepEqual(completed.result, accepted)

  const rejectedCommand = taskCommand('durable_rejected'), rejectedDigest = 'c'.repeat(64), loaded = await state.store.load()
  await state.store.enqueueOutbox({ targetDeviceRef: target, message: rejectedCommand, digest: rejectedDigest, expectedRevision: loaded.revision, queuedAt: sentAt })
  const rejected = rejectedReceipt(rejectedCommand.commandId, rejectedDigest, rejectedCommand.messageRef), rejectedWireDigest = wireHash(rejected), rejectedAck = receiptAck(rejected.messageRef, rejectedWireDigest), queued = await state.store.load()
  await state.store.recordInboundReceiptAndCompleteOutbox({ senderDeviceRef: target, targetDeviceRef: target, receipt: rejected, ack: rejectedAck, receiptDigest: rejectedWireDigest, ackDigest: wireHash(rejectedAck), expectedRevision: queued.revision, queuedAt: sentAt })
  completed = await state.store.getOutboundCommand({ targetDeviceRef: target, commandId: rejectedCommand.commandId }); assert.deepEqual(completed.message, rejectedCommand); assert.equal(completed.digest, rejectedDigest); assert.deepEqual(completed.result, rejected)
  const persistedRevision = completed.revision
  await state.store.close()
  const reopened = new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: state.filePath, encryptionKey: state.key, mode: 'collaborator', authorityEpoch: 1 })
  try {
    const acceptedAfterRestart = await reopened.getOutboundCommand({ targetDeviceRef: target, commandId: acceptedCommand.commandId }); assert.equal(acceptedAfterRestart.revision, persistedRevision); assert.deepEqual(acceptedAfterRestart.message, acceptedCommand); assert.deepEqual(acceptedAfterRestart.result, accepted)
    const rejectedAfterRestart = await reopened.getOutboundCommand({ targetDeviceRef: target, commandId: rejectedCommand.commandId }); assert.deepEqual(rejectedAfterRestart.message, rejectedCommand); assert.deepEqual(rejectedAfterRestart.result, rejected)
    const snapshot = await reopened.load(); const bound = snapshot.state.businessReceipts.filter(item => item.outboundCommand); assert.equal(bound.length, 2); assert.ok(bound.every(item => item.receipt.replyTo === item.outboundCommand.messageRef && item.requestDigest === item.outboundCommand.requestDigest))
  } finally { await reopened.close() }
}))

test('outbox replay is exact and only matching authority receipt ack deletes', async () => usingFixture({ mode: 'authority' }, async state => {
  const message = receipt('outbox_command'), digest = wireHash(message); const queued = await state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message, digest, expectedRevision: 0, queuedAt: sentAt }); assert.equal(queued.duplicate, false)
  assert.equal((await state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message, digest, expectedRevision: 999, queuedAt: sentAt })).duplicate, true)
  const changed = { ...message, task: { ...message.task, title: 'Changed' } }; await assert.rejects(state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message: changed, digest: wireHash(changed), expectedRevision: 1, queuedAt: sentAt }), error => error.code === 'PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT')
  const pageAck = { ...base('ack', 'page_ack'), replyTo: message.messageRef, kind: 'page', stream: 'task', cursor: 1, resetToken: 'reset_A' }; await assert.rejects(state.store.acknowledgeOutbox({ peerDeviceRef: 'device_A', ack: pageAck, expectedRevision: 1 }), error => error.code === 'PROJECT_BUSINESS_SYNC_ACK_INVALID')
  await assert.rejects(state.store.acknowledgeOutbox({ peerDeviceRef: 'device_A', ack: receiptAck(message.messageRef, 'd'.repeat(64)), expectedRevision: 1 }), error => error.code === 'PROJECT_BUSINESS_SYNC_ACK_INVALID')
  await assert.rejects(state.store.acknowledgeOutbox({ peerDeviceRef: 'device_B', ack: receiptAck(message.messageRef, digest), expectedRevision: 1 }), error => error.code === 'PROJECT_BUSINESS_SYNC_ACK_INVALID')
  assert.equal((await state.store.acknowledgeOutbox({ peerDeviceRef: 'device_A', ack: receiptAck(message.messageRef, digest), expectedRevision: 1 })).removed, true); assert.equal((await state.store.load()).state.outbox.length, 0)
}))

test('collaborator receipt ACK cannot complete its task command outbox', async () => usingFixture({}, async state => {
  const message = { ...base('task.command', 'collaborator_command'), commandId: 'collaborator_command', resource: 'task', action: 'claim', taskRef: 'task_1', expectedRevision: 1, payload: {} }, requestDigest = 'a'.repeat(64); await state.store.enqueueOutbox({ targetDeviceRef: 'authority_A', message, digest: requestDigest, expectedRevision: 0, queuedAt: sentAt }); const loaded = await state.store.load(), entry = loaded.state.outbox[0]; await assert.rejects(state.store.acknowledgeOutbox({ peerDeviceRef: 'authority_A', ack: receiptAck(message.messageRef, entry.digest), expectedRevision: loaded.revision }), error => error.code === 'PROJECT_BUSINESS_SYNC_MODE_INVALID'); assert.equal((await state.store.load()).state.outbox[0].messageRef, message.messageRef)
}))

test('normal Task and Automation streams advance independently without cache mixing', async () => usingFixture({}, async state => {
  await initPeer(state); await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: taskPage(1), expectedRevision: 1, updatedAt: sentAt }); let snapshot = await state.store.load(); assert.equal(snapshot.state.peerCursors[0].taskCursor, 1); assert.equal(snapshot.state.peerCursors[0].automationCursor, 0); assert.equal(snapshot.state.safeCache.tasks.length, 1); assert.equal(snapshot.state.safeCache.ledger.length, 0)
  await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: automationPage(1), expectedRevision: 2, updatedAt: sentAt }); snapshot = await state.store.load(); assert.equal(snapshot.state.peerCursors[0].taskCursor, 1); assert.equal(snapshot.state.peerCursors[0].automationCursor, 1); assert.equal(snapshot.state.safeCache.tasks.length, 1); assert.equal(snapshot.state.safeCache.ledger.length, 1)
  await assert.rejects(state.store.applyEventPage({ peerDeviceRef: 'device_A', page: taskPage(3), expectedRevision: 3, updatedAt: sentAt }), error => error.code === 'PROJECT_BUSINESS_SYNC_EVENT_GAP')
  const mismatches = [
    { ...taskPage(2), events: [{ ...taskPage(2).events[0], type: 'run.queued' }] },
    { ...automationPage(2), events: [{ ...automationPage(2).events[0], type: 'run.started' }] },
    { ...automationPage(2), events: [{ cursor: 2, type: 'run.queued', occurredAt: sentAt, definition: definition(0) }] },
    { ...automationPage(2), events: [{ cursor: 2, type: 'definition.updated', occurredAt: sentAt, run: run(0) }] },
  ]
  for (const page of mismatches) await assert.rejects(state.store.applyEventPage({ peerDeviceRef: 'device_A', page, expectedRevision: 3, updatedAt: sentAt }), error => ['PROJECT_BUSINESS_SYNC_EVENT_INVALID', 'PROJECT_BUSINESS_SYNC_INVALID'].includes(error.code))
}))

test('combined Automation normal events atomically upsert ledger and current entity across restart', async () => usingFixture({}, async state => {
  await initPeer(state); const currentDefinition = definition(7), firstRun = run(7), first = { ...base('event.page', 'combined_1'), stream: 'automation', afterCursor: 0, nextCursor: 2, hasMore: false, events: [{ cursor: 1, type: 'definition.created', occurredAt: sentAt, ledger: { sequence: 1, type: 'definition.created', occurredAt: sentAt, definitionRef: currentDefinition.definitionRef, status: 'enabled' }, definition: currentDefinition }, { cursor: 2, type: 'run.queued', occurredAt: sentAt, ledger: { ...ledger(2), runRef: firstRun.runRef, definitionRef: firstRun.definitionRef }, run: firstRun }] }
  await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: first, expectedRevision: 1, updatedAt: sentAt }); const running = { ...firstRun, revision: 3, status: 'running', startedAt: sentAt }, second = { ...base('event.page', 'combined_2'), stream: 'automation', afterCursor: 2, nextCursor: 3, hasMore: false, events: [{ cursor: 3, type: 'run.started', occurredAt: sentAt, ledger: { sequence: 3, type: 'run.started', occurredAt: sentAt, runRef: running.runRef, definitionRef: running.definitionRef, status: 'running' }, run: running }] }
  await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: second, expectedRevision: 2, updatedAt: sentAt }); await state.store.close(); const reopened = new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: state.filePath, encryptionKey: state.key, mode: 'collaborator', authorityEpoch: 1 }); try { const loaded = await reopened.load(); assert.equal(loaded.state.safeCache.ledger.length, 3); assert.equal(loaded.state.safeCache.definitions.length, 1); assert.equal(loaded.state.safeCache.runs.length, 1); assert.equal(loaded.state.safeCache.runs[0].status, 'running'); assert.equal(loaded.state.safeCache.runs[0].revision, 3); assert.equal(loaded.state.peerCursors[0].automationCursor, 3) } finally { await reopened.close() }
}))

test('multi-page reset persists pending state and commits cache plus cursor only on final page after reopen', async () => usingFixture({}, async state => {
  await initPeer(state); const first = resetPage({ offset: 0, count: 100, totalItems: 150 }), second = resetPage({ offset: 100, count: 50, totalItems: 150 })
  const pending = await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: first, expectedRevision: 1, updatedAt: sentAt }); assert.equal(pending.result.cursor, 0); assert.equal(pending.result.pendingReset, true)
  let snapshot = await state.store.load(); assert.equal(snapshot.state.peerCursors[0].taskCursor, 0); assert.equal(snapshot.state.safeCache.tasks.length, 0); assert.equal(snapshot.state.pendingReset[0].items.length, 100)
  const reopened = new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: state.filePath, encryptionKey: state.key, mode: 'collaborator', authorityEpoch: 1 }); const complete = await reopened.applyEventPage({ peerDeviceRef: 'device_A', page: second, expectedRevision: 2, updatedAt: sentAt }); assert.equal(complete.result.cursor, 9); assert.equal(complete.result.pendingReset, false)
  snapshot = await reopened.load(); assert.equal(snapshot.state.peerCursors[0].taskCursor, 9); assert.equal(snapshot.state.safeCache.tasks.length, 150); assert.equal(snapshot.state.pendingReset.length, 0)
  await reopened.close()
}))

test('one peer can persist and finish Task and Automation resets independently', async () => usingFixture({}, async state => {
  await initPeer(state)
  await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: resetPage({ stream: 'task', offset: 0, count: 100, totalItems: 150 }), expectedRevision: 1, updatedAt: sentAt })
  await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: resetPage({ stream: 'automation', offset: 0, count: 100, totalItems: 150 }), expectedRevision: 2, updatedAt: sentAt })
  let snapshot = await state.store.load(); assert.equal(snapshot.state.pendingReset.length, 2); assert.deepEqual(snapshot.state.pendingReset.map(item => item.stream).sort(), ['automation', 'task']); assert.equal(snapshot.state.peerCursors[0].taskCursor, 0); assert.equal(snapshot.state.peerCursors[0].automationCursor, 0)
  await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: resetPage({ stream: 'task', offset: 100, count: 50, totalItems: 150 }), expectedRevision: 3, updatedAt: sentAt })
  snapshot = await state.store.load(); assert.equal(snapshot.state.pendingReset.length, 1); assert.equal(snapshot.state.pendingReset[0].stream, 'automation'); assert.equal(snapshot.state.peerCursors[0].taskCursor, 9); assert.equal(snapshot.state.peerCursors[0].automationCursor, 0); assert.equal(snapshot.state.safeCache.tasks.length, 150); assert.equal(snapshot.state.safeCache.runs.length, 0)
  await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: resetPage({ stream: 'automation', offset: 100, count: 50, totalItems: 150 }), expectedRevision: 4, updatedAt: sentAt })
  snapshot = await state.store.load(); assert.equal(snapshot.state.pendingReset.length, 0); assert.equal(snapshot.state.peerCursors[0].automationCursor, 9); assert.equal(snapshot.state.safeCache.tasks.length, 150); assert.equal(snapshot.state.safeCache.definitions.length + snapshot.state.safeCache.runs.length + snapshot.state.safeCache.ledger.length, 150)
}))

test('reset continuation rejects wrong offset, token, total, and stream atomically', async () => usingFixture({}, async state => {
  await initPeer(state); await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: resetPage({ offset: 0, count: 100, totalItems: 150 }), expectedRevision: 1, updatedAt: sentAt }); const before = await state.store.load()
  const invalid = [resetPage({ offset: 101, count: 49, totalItems: 150 }), resetPage({ offset: 100, count: 50, totalItems: 151 }), resetPage({ offset: 100, count: 50, totalItems: 150, resetToken: 'reset_B' }), resetPage({ stream: 'automation', offset: 100, count: 50, totalItems: 150 })]
  for (const page of invalid) { await assert.rejects(state.store.applyEventPage({ peerDeviceRef: 'device_A', page, expectedRevision: before.revision, updatedAt: sentAt })); assert.deepEqual(await state.store.load(), before) }
}))

test('authority page ack removes only its exact durable page outbox', async () => usingFixture({ mode: 'authority' }, async state => {
  await initPeer(state); const page = taskPage(1), pageDigest = wireHash(page); await state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message: page, digest: pageDigest, expectedRevision: 1, queuedAt: sentAt }); const ack = { ...base('ack', 'page_ack_exact'), replyTo: page.messageRef, kind: 'page', stream: 'task', cursor: 1, resetToken: 'reset_A' }
  const advanced = await state.store.advancePeerAck({ peerDeviceRef: 'device_A', ack, expectedRevision: 2, updatedAt: sentAt }); assert.equal(advanced.removed, true); const loaded = await state.store.load(); assert.equal(loaded.state.outbox.length, 0); assert.equal(loaded.state.peerCursors[0].taskCursor, 1)
}))

test('authority page acknowledgements are monotonic per stream and token', async () => usingFixture({ mode: 'authority' }, async state => {
  await initPeer(state); const ack = (stream, cursor, resetToken = 'reset_A') => ({ ...base('ack', `ack_${stream}_${cursor}`), replyTo: `page_${stream}_${cursor}`, kind: 'page', stream, cursor, resetToken })
  await state.store.advancePeerAck({ peerDeviceRef: 'device_A', ack: ack('task', 5), expectedRevision: 1, updatedAt: sentAt }); assert.equal((await state.store.advancePeerAck({ peerDeviceRef: 'device_A', ack: ack('task', 5), expectedRevision: 999, updatedAt: sentAt })).duplicate, true); await state.store.advancePeerAck({ peerDeviceRef: 'device_A', ack: ack('automation', 2), expectedRevision: 2, updatedAt: sentAt }); const before = await state.store.load(); assert.equal(before.state.peerCursors[0].taskCursor, 5); assert.equal(before.state.peerCursors[0].automationCursor, 2)
  await assert.rejects(state.store.advancePeerAck({ peerDeviceRef: 'device_A', ack: ack('task', 4), expectedRevision: 3, updatedAt: sentAt }), error => error.code === 'PROJECT_BUSINESS_SYNC_CURSOR_CONFLICT'); await assert.rejects(state.store.advancePeerAck({ peerDeviceRef: 'device_A', ack: ack('task', 6, 'stale'), expectedRevision: 3, updatedAt: sentAt }), error => error.code === 'PROJECT_BUSINESS_SYNC_ACK_INVALID')
}))

test('capability token changes and epoch rotation invalidate old cursor, cache, and pending reset', async () => usingFixture({}, async state => {
  await initPeer(state); await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: taskPage(1), expectedRevision: 1, updatedAt: sentAt }); await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: resetPage({ offset: 0, count: 100, totalItems: 150, afterCursor: 1 }), expectedRevision: 2, updatedAt: sentAt })
  const oldPull = wireMessage('old_control_pull'), commandWire = { ...base('task.command', 'preserved_command'), commandId: 'preserved_command', resource: 'task', action: 'claim', taskRef: 'task_1', expectedRevision: 1, payload: {} }, preservedAck = receiptAck('preserved_receipt', 'd'.repeat(64)), preservedReceipt = receipt('preserved_business', 'e'.repeat(64)); await state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message: oldPull, digest: wireHash(oldPull), expectedRevision: 3, queuedAt: sentAt }); await state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message: commandWire, digest: 'b'.repeat(64), expectedRevision: 4, queuedAt: sentAt }); await state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message: preservedAck, digest: wireHash(preservedAck), expectedRevision: 5, queuedAt: sentAt }); await state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message: preservedReceipt, digest: wireHash(preservedReceipt), expectedRevision: 6, queuedAt: sentAt })
  await state.store.updateCapability({ peerDeviceRef: 'device_A', capability: capability('capability_B', { resetToken: 'reset_B' }), expectedRevision: 7, updatedAt: sentAt }); let snapshot = await state.store.load(); assert.equal(snapshot.state.peerCursors[0].taskCursor, 0); assert.equal(snapshot.state.pendingReset.length, 0); assert.equal(snapshot.state.safeCache.tasks.length, 0); assert.deepEqual(snapshot.state.outbox.map(entry => entry.message.type).sort(), ['ack', 'task.command', 'task.receipt'])
  const rotated = await state.store.rotateAuthorityEpoch({ authorityEpoch: 2, resetToken: 'reset_C', expectedRevision: 8, updatedAt: sentAt }); assert.equal(rotated.authorityEpoch, 2); snapshot = await state.store.load(); assert.equal(snapshot.state.authorityEpoch, 2); assert.equal(snapshot.state.resetGeneration, 2); assert.equal(snapshot.state.peerCursors[0].resetToken, 'reset_C')
  const reopened = new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: state.filePath, encryptionKey: state.key, mode: 'collaborator', authorityEpoch: 2 }); assert.equal((await reopened.load()).state.authorityEpoch, 2); await reopened.close()
}))

test('persisted outbox wire digest and pending reset total limits are strict', async () => usingFixture({}, async state => {
  const message = wireMessage('digest_bound'); await state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message, digest: wireHash(message), expectedRevision: 0, queuedAt: sentAt }); let loaded = await state.store.load(), tampered = structuredClone(loaded.state); tampered.outbox[0].digest = '0'.repeat(64); assert.throws(() => state.storeMod.normalizeBusinessSyncState(tampered, { projectRef, mode: 'collaborator', authorityEpoch: 1 }), error => error.code === 'PROJECT_BUSINESS_SYNC_STATE_INVALID')
}))

test('pending reset totalItems cannot exceed its stream cache capacity', async () => usingFixture({}, async state => {
  await initPeer(state); await state.store.applyEventPage({ peerDeviceRef: 'device_A', page: resetPage({ offset: 0, count: 1, totalItems: 2 }), expectedRevision: 1, updatedAt: sentAt }); const loaded = await state.store.load(), tampered = structuredClone(loaded.state); tampered.pendingReset[0].totalItems = state.storeMod.BUSINESS_SYNC_STORE_LIMITS.tasks + 1; assert.throws(() => state.storeMod.normalizeBusinessSyncState(tampered, { projectRef, mode: 'collaborator', authorityEpoch: 1 }), error => error.code === 'PROJECT_BUSINESS_SYNC_STATE_INVALID')
}))

test('wrong key/AAD, rollback floor, strict tamper, and concurrent CAS fail closed', async () => usingFixture({}, async state => {
  await initPeer(state); await assert.rejects(new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: state.filePath, encryptionKey: randomBytes(32), mode: 'collaborator', authorityEpoch: 1 }).load(), /authentication|decryption/u); await assert.rejects(new state.storeMod.ProjectBusinessSyncStore({ projectRef: `project_${'T'.repeat(24)}`, filePath: state.filePath, encryptionKey: state.key, mode: 'collaborator', authorityEpoch: 1 }).load()); await assert.rejects(new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: state.filePath, encryptionKey: state.key, mode: 'collaborator', authorityEpoch: 1, minimumRevision: 2 }).load(), /rollback/u)
  const raw = new state.stateMod.EncryptedProjectStateStore(state.filePath, { projectRef, encryptionKey: state.key }); const loaded = await raw.load(); loaded.state.actorRef = 'human_A'; await raw.save(loaded.state, { expectedRevision: loaded.revision }); const tampered = new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: state.filePath, encryptionKey: state.key, mode: 'collaborator', authorityEpoch: 1 }); await assert.rejects(tampered.load(), error => error.code === 'PROJECT_BUSINESS_SYNC_STATE_INVALID'); await tampered.close(); await raw.close()
}))

test('same-file instances serialize outer CAS and never lose updates', async () => usingFixture({}, async state => {
  const second = new state.storeMod.ProjectBusinessSyncStore({ projectRef, filePath: state.filePath, encryptionKey: state.key, mode: 'collaborator', authorityEpoch: 1 }); const results = await Promise.allSettled([state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message: wireMessage('one'), digest: wireHash(wireMessage('one')), expectedRevision: 0, queuedAt: sentAt }), second.enqueueOutbox({ targetDeviceRef: 'device_A', message: wireMessage('two'), digest: wireHash(wireMessage('two')), expectedRevision: 0, queuedAt: sentAt })]); assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PROJECT_BUSINESS_SYNC_STORE_CONFLICT'); assert.equal((await state.store.load()).state.outbox.length, 1); await second.close()
}))

test('all collection and 16 MiB limits reject without truncation or secret projection', async () => usingFixture({}, async state => {
  const empty = (await state.store.load()).state, limits = state.storeMod.BUSINESS_SYNC_STORE_LIMITS
  for (const [field, count] of [['peerCursors', limits.peers + 1], ['businessReceipts', limits.receipts + 1], ['controlReceipts', limits.controlReceipts + 1], ['outbox', limits.outbox + 1], ['pendingReset', limits.pendingResets + 1]]) assert.throws(() => state.storeMod.normalizeBusinessSyncState({ ...empty, [field]: Array(count).fill({}) }, { projectRef, mode: 'collaborator', authorityEpoch: 1 }), error => error.code === 'PROJECT_BUSINESS_SYNC_LIMIT_EXCEEDED')
  for (const [field, count] of [['tasks', limits.tasks + 1], ['definitions', limits.definitions + 1], ['runs', limits.runs + 1], ['ledger', limits.ledger + 1]]) assert.throws(() => state.storeMod.normalizeBusinessSyncState({ ...empty, safeCache: { ...empty.safeCache, [field]: Array(count).fill({}) } }, { projectRef, mode: 'collaborator', authorityEpoch: 1 }), error => error.code === 'PROJECT_BUSINESS_SYNC_LIMIT_EXCEEDED')
  const raw = new state.stateMod.EncryptedProjectStateStore(state.filePath, { projectRef, encryptionKey: state.key }); await raw.save({ projectRef, oversized: 'x'.repeat(state.storeMod.BUSINESS_SYNC_STORE_MAX_PLAINTEXT_BYTES + 1) }, { expectedRevision: 0 }); await assert.rejects(state.store.load(), error => error.code === 'PROJECT_BUSINESS_SYNC_LIMIT_EXCEEDED' && error.field === 'plaintext'); await raw.close()
}))

test('close drains accepted work, is idempotent, and rejects new operations', async () => usingFixture({}, async state => {
  const accepted = state.store.enqueueOutbox({ targetDeviceRef: 'device_A', message: wireMessage(), digest: wireHash(wireMessage()), expectedRevision: 0, queuedAt: sentAt }), closeA = state.store.close(), closeB = state.store.close(); assert.equal(closeA, closeB); assert.equal((await accepted).revision, 1); await closeA; await assert.rejects(state.store.load(), error => error.code === 'PROJECT_STATE_CLOSED'); await assert.rejects(state.store.getBusinessReceipt({ senderDeviceRef: 'device_A', commandId: 'command_A' }), error => error.code === 'PROJECT_STATE_CLOSED')
}))
