const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const lib = (...parts) => pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', ...parts)).href
const projectRef = `project_${'R'.repeat(24)}`
const authorityDeviceRef = `device_${'A'.repeat(26)}`
const collaboratorDeviceRef = `device_${'C'.repeat(26)}`
const at = '2026-08-24T03:00:00.000Z'
const atMs = Date.parse(at)

async function waitFor(predicate, message = 'condition was not reached') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await predicate()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  assert.fail(message)
}

class FakeNetwork {
  constructor() { this.entries = new Map(); this.connected = true; this.deliveries = true; this.sent = [] }
  add(entry) { this.entries.set(entry.deviceRef, entry) }
  send(sender, targetDeviceRef, message) {
    if (!this.connected) { const error = new Error('offline'); error.code = 'PROJECT_TRANSPORT_UNAVAILABLE'; throw error }
    const target = this.entries.get(targetDeviceRef)
    if (!target) { const error = new Error('wrong target'); error.code = 'PROJECT_TRANSPORT_UNAVAILABLE'; throw error }
    this.sent.push({ sender: sender.deviceRef, targetDeviceRef, message: structuredClone(message) })
    if (this.deliveries) queueMicrotask(() => target.deliver({ senderDeviceRef: sender.deviceRef, authorityEpoch: 1, payload: message }))
    return { queued: true, packetRef: message.messageRef, targetDeviceRef, transport: 'remote_wss' }
  }
}

class FakeEntry {
  constructor({ network, deviceRef, context, taskContext, automationContext }) { this.network = network; this.deviceRef = deviceRef; this.context = context; this.taskContext = taskContext; this.automationContext = automationContext; this.listeners = new Set(); this.deliveryCount = 0; network.add(this) }
  async localProjectBusinessSyncContext() { this.lastContext = this.context(); return this.lastContext }
  async localProjectTaskContext() { if (!this.taskContext) throw Object.assign(new Error('forbidden'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN' }); return this.taskContext() }
  async localProjectAutomationContext() { if (!this.automationContext) throw Object.assign(new Error('forbidden'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN' }); return this.automationContext() }
  subscribeProjectBusinessDelivery(listener) { this.listeners.add(listener); let active = true; return () => { if (!active) return false; active = false; this.listeners.delete(listener); return true } }
  sendProjectBusinessMessage({ targetDeviceRef, message }) { return Promise.resolve(this.network.send(this, targetDeviceRef, message)) }
  deliver(delivery) { this.deliveryCount += 1; for (const listener of [...this.listeners]) listener(delivery) }
}

function syncContext({ root, mode, localDeviceRef, peerDeviceRef, key, authorityEpoch = 1, contextProjectRef = projectRef, peerAvailable = () => true }) {
  let disposed = false
  const context = { projectRef: contextProjectRef, mode }
  Object.defineProperties(context, {
    authorityEpoch: { value: authorityEpoch }, localDeviceRef: { value: localDeviceRef }, filePath: { value: path.join(root, `${mode}-${contextProjectRef}.enc`) },
    keyProvider: { value: requested => { if (disposed || requested !== contextProjectRef) throw Object.assign(new Error('stale'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_INVALID' }); return Buffer.from(key) } },
    peerResolver: { value: async ({ senderDeviceRef, authorityEpoch }) => { if (disposed) throw Object.assign(new Error('stale'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_INVALID' }); if (!peerAvailable() || senderDeviceRef !== peerDeviceRef || authorityEpoch !== context.authorityEpoch) throw Object.assign(new Error('forbidden'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN' }); return Object.freeze({ deviceRef: senderDeviceRef, collaboratorRef: mode === 'authority' ? 'collaborator_remote' : 'authority_owner', role: mode === 'authority' ? 'maintainer' : 'owner', permissions: Object.freeze(['task', 'review']) }) } },
    peerDeviceRefs: { value: async () => { if (disposed) throw Object.assign(new Error('stale'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_INVALID' }); return Object.freeze(peerAvailable() ? [peerDeviceRef] : []) } },
    dispose: { value: () => { if (disposed) return false; disposed = true; return true } },
  })
  return Object.freeze(context)
}

async function fixture({ taskCount = 1, automationRun = false, pumpLimit = 100 } = {}) {
  const [{ ProjectBusinessSyncRuntime }, { ProjectTaskStore }, { ProjectTaskCommandService }, { ProjectAutomationStore }, { ProjectAutomationCommandService }] = await Promise.all([
    import(lib('project-business-sync-runtime.js')), import(lib('project-task-store.js')), import(lib('project-task-service.js')), import(lib('project-automation-store.js')), import(lib('project-automation-service.js')),
  ])
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-sync-runtime-')), network = new FakeNetwork(), taskKey = randomBytes(32), automationKey = randomBytes(32), authoritySyncKey = randomBytes(32), collaboratorSyncKey = randomBytes(32)
  const taskFile = path.join(root, 'tasks.sqlite'), automationFile = path.join(root, 'automation.enc'), ownerExecution = Object.freeze(Object.create(null))
  const taskContext = () => {
    let disposed = false
    return Object.freeze({ projectRef, databasePath: taskFile, execution: ownerExecution, keyProvider(requested) { if (disposed || requested !== projectRef) throw Object.assign(new Error('stale'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_INVALID' }); return Buffer.from(taskKey) }, actorResolver(execution, requested) { if (disposed || execution !== ownerExecution || requested !== projectRef) throw Object.assign(new Error('stale'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_INVALID' }); return { projectRef, actorRef: 'authority_owner', kind: 'human', role: 'owner', authorities: [] } }, dispose() { if (disposed) return false; disposed = true; return true } })
  }
  const automationExecution = Object.freeze(Object.create(null))
  const automationContext = () => {
    let disposed = false
    return Object.freeze({ projectRef, filePath: automationFile, execution: automationExecution, keyProvider(requested) { if (disposed || requested !== projectRef) throw Object.assign(new Error('stale'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_INVALID' }); return Buffer.from(automationKey) }, actorResolver(execution, requested) { if (disposed || execution !== automationExecution || requested !== projectRef) throw Object.assign(new Error('stale'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_INVALID' }); return { actorRef: 'authority_owner', actorRole: 'owner' } }, dispose() { if (disposed) return false; disposed = true; return true } })
  }

  const bootstrapContext = taskContext(), bootstrapStore = new ProjectTaskStore({ filePath: taskFile, keyProvider: bootstrapContext.keyProvider }); bootstrapStore.initialize()
  const bootstrapService = new ProjectTaskCommandService({ store: bootstrapStore, actorResolver: bootstrapContext.actorResolver, now: () => atMs })
  for (let index = 1; index <= taskCount; index += 1) bootstrapService.executeCommand(ownerExecution, { projectRef, commandId: `command_create_runtime_task_${index}`, eventRef: `event_create_runtime_task_${index}`, type: 'create', taskRef: `task_runtime_${index}`, expectedRevision: 0, payload: { title: `Runtime task ${index}`, requirements: {}, fileScope: [] } })
  bootstrapStore.close(); bootstrapContext.dispose()
  let seededRun, rejectedRun
  if (automationRun) {
    const store = new ProjectAutomationStore({ projectRef, filePath: automationFile, encryptionKey: automationKey }), execution = Object.freeze(Object.create(null))
    const service = new ProjectAutomationCommandService({ store, projectRef, actorResolver(candidate) { assert.equal(candidate, execution); return { actorRef: 'authority_owner', kind: 'human', role: 'owner' } }, refFactory(kind, commandId) { return `runtime_${kind}_${commandId}` }, now: () => atMs })
    const created = await service.executeCommand(execution, { commandId: 'runtime_definition_create', type: 'definition.create', expectedRevision: 0, payload: { name: 'Runtime automation', taskRef: 'task_runtime_1', targetStatus: 'in_progress' } })
    seededRun = (await service.executeCommand(execution, { commandId: 'runtime_manual_run', type: 'manual_run', definitionRef: created.definition.definitionRef, expectedRevision: 1, payload: { expectedTaskRevision: 1 } })).run
    rejectedRun = (await service.executeCommand(execution, { commandId: 'runtime_manual_reject', type: 'manual_run', definitionRef: created.definition.definitionRef, expectedRevision: 1, payload: { expectedTaskRevision: 1 } })).run
    await store.close()
  }

  let collaboratorProjectRef = projectRef, collaboratorPeerAvailable = true
  const authorityEntry = new FakeEntry({ network, deviceRef: authorityDeviceRef, context: () => syncContext({ root, mode: 'authority', localDeviceRef: authorityDeviceRef, peerDeviceRef: collaboratorDeviceRef, key: authoritySyncKey }), taskContext, automationContext })
  const collaboratorEntry = new FakeEntry({ network, deviceRef: collaboratorDeviceRef, context: () => syncContext({ root, mode: 'collaborator', localDeviceRef: collaboratorDeviceRef, peerDeviceRef: authorityDeviceRef, key: collaboratorSyncKey, contextProjectRef: collaboratorProjectRef, peerAvailable: () => collaboratorPeerAvailable }) })
  let currentTime = atMs
  const runtimeOptions = { clock: () => currentTime, pumpLimit, refreshMs: 60_000, scheduler(callback, delay) { const timer = setTimeout(callback, delay); timer.unref(); return timer } }
  const authority = new ProjectBusinessSyncRuntime({ projectEntry: authorityEntry, ...runtimeOptions }), collaborator = new ProjectBusinessSyncRuntime({ projectEntry: collaboratorEntry, ...runtimeOptions })
  return { root, network, authority, collaborator, seededRun, rejectedRun, keys: [taskKey, automationKey, authoritySyncKey, collaboratorSyncKey], advance(milliseconds) { currentTime += milliseconds }, setCollaboratorProjectRef(value) { collaboratorProjectRef = value }, setCollaboratorPeerAvailable(value) { collaboratorPeerAvailable = value }, async restartCollaborator() { await this.collaborator.close(); this.collaborator = new ProjectBusinessSyncRuntime({ projectEntry: collaboratorEntry, ...runtimeOptions }); return this.collaborator }, async taskRevision() { const context = taskContext(), store = new ProjectTaskStore({ filePath: taskFile, keyProvider: context.keyProvider }); store.initialize(); try { return store.getProjectRevision(projectRef) } finally { store.close(); context.dispose() } }, async close() { await Promise.allSettled([this.collaborator.close(), this.authority.close()]); for (const key of this.keys) key.fill(0); await rm(root, { recursive: true, force: true }) } }
}

async function synchronize(fx, taskCount = 1) {
  await fx.authority.initialize(); await fx.collaborator.initialize()
  for (let round = 0; round < 4; round += 1) { await fx.authority.recover(); await fx.collaborator.recover() }
  return waitFor(async () => { const state = await fx.collaborator.taskState(); return state.tasks.length === taskCount && state.capability.available ? state : undefined }, 'collaborator did not bootstrap the complete task cache')
}

test('runtime bootstraps multi-page cache, retains offline outbox, and executes each command once', async t => {
  const fx = await fixture({ taskCount: 105 }); t.after(() => fx.close())
  const state = await synchronize(fx, 105)
  assert.equal(state.capability.mode, 'collaborator')
  assert.deepEqual(state.capability.taskCommands, ['claim', 'transition'])
  assert.equal(state.tasks.some(task => task.taskRef === 'task_runtime_1'), true)
  const safeStateJson = JSON.stringify(state)
  for (const privateValue of ['device_', 'actorRef']) assert.equal(safeStateJson.includes(privateValue), false)
  for (const task of state.tasks) for (const privateField of ['requirements', 'fileScope', 'assigneeActorRef', 'blockedBy']) assert.equal(Object.hasOwn(task, privateField), false)

  const signals = []
  const unsubscribe = fx.collaborator.subscribe(signal => signals.push(signal))
  fx.network.connected = false
  const queued = await fx.collaborator.taskAction({ commandId: 'remote_claim_1', type: 'claim', taskRef: 'task_runtime_1', expectedRevision: 1, payload: {} })
  assert.deepEqual(queued, { queued: true, commandId: 'remote_claim_1', resource: 'task' })
  await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(fx.network.sent.some(item => item.message.type === 'task.command'), false, 'offline transport keeps command only in durable outbox')
  fx.network.connected = true
  await fx.collaborator.recover()
  await waitFor(() => fx.network.sent.some(item => item.message.type === 'task.receipt'), 'authority did not execute remote claim')
  assert.equal(signals.every(signal => JSON.stringify(signal) === '{"type":"refetch"}'), true)
  assert.equal(unsubscribe(), true); assert.equal(unsubscribe(), false)
  await fx.collaborator.close(); await fx.authority.close()
  assert.equal(await fx.taskRevision(), 106, 'durable command replay changes the Task domain exactly once')
})

test('close drains an already accepted inbound command before releasing stores and Entry context', async t => {
  const fx = await fixture(); t.after(() => fx.close()); await fx.authority.initialize(); fx.network.sent.length = 0; fx.network.deliveries = false
  fx.network.entries.get(authorityDeviceRef).deliver({ senderDeviceRef: collaboratorDeviceRef, authorityEpoch: 1, payload: { version: 1, type: 'task.command', messageRef: 'sync_request_close_drain_00000001', sentAt: new Date(atMs).toISOString(), commandId: 'close_drain_claim_1', resource: 'task', action: 'claim', taskRef: 'task_runtime_1', expectedRevision: 1, payload: {} } })
  const closing = fx.authority.close(); assert.equal(fx.authority.close(), closing); await closing
  assert.equal(await fx.taskRevision(), 2); assert.equal(fx.network.sent.some(item => item.message.type === 'task.receipt' && item.message.commandId === 'close_drain_claim_1'), true)
})

test('runtime rejects cache-forged actions, rebinds one stale context, and closes exactly', async t => {
  const fx = await fixture(); t.after(() => fx.close())
  await synchronize(fx)
  await assert.rejects(fx.collaborator.taskAction({ commandId: 'forged_1', type: 'claim', taskRef: 'task_unknown', expectedRevision: 1, payload: {} }), error => error?.code === 'PROJECT_BUSINESS_SYNC_CONFLICT')
  await assert.rejects(fx.collaborator.taskAction({ commandId: 'forged_2', type: 'claim', taskRef: 'task_runtime_1', expectedRevision: 99, payload: {} }), error => error?.code === 'PROJECT_BUSINESS_SYNC_CONFLICT')
  fx.network.entries.get(collaboratorDeviceRef).lastContext.dispose()
  const [rebound, concurrent] = await Promise.all([fx.collaborator.taskState(), fx.collaborator.taskState()])
  assert.equal(rebound.tasks.length, 1, 'a stale Host context is released and rebound exactly once')
  assert.equal(concurrent.tasks.length, 1)
  assert.equal(fx.network.entries.get(collaboratorDeviceRef).listeners.size, 1)
  const closing = fx.collaborator.close(); assert.equal(fx.collaborator.close(), closing); await closing
  assert.equal(fx.network.entries.get(collaboratorDeviceRef).listeners.size, 0)
  await assert.rejects(fx.collaborator.taskState(), error => error?.code === 'PROJECT_BUSINESS_SYNC_RUNTIME_CLOSED')
})

test('fresh peer revocation immediately removes writable capability without trusting persisted cache', async t => {
  const fx = await fixture(); t.after(() => fx.close()); await synchronize(fx); fx.setCollaboratorPeerAvailable(false)
  const state = await fx.collaborator.taskState(); assert.equal(state.tasks.length, 1); assert.deepEqual(state.capability, { available: false, mode: 'collaborator', writable: false, taskCommands: [], automationCommands: [] }); assert.deepEqual(state.tasks[0].allowedActions, [])
  await assert.rejects(fx.collaborator.taskAction({ commandId: 'revoked_claim_1', type: 'claim', taskRef: 'task_runtime_1', expectedRevision: 1, payload: {} }), error => error?.code === 'PROJECT_BUSINESS_SYNC_RUNTIME_UNAVAILABLE')
})

test('stale rebind never replays an old project entry through a changed project context', async t => {
  const fx = await fixture(); t.after(() => fx.close()); await synchronize(fx); fx.network.sent.length = 0; fx.network.entries.get(collaboratorDeviceRef).lastContext.dispose(); fx.setCollaboratorProjectRef(`project_${'X'.repeat(24)}`)
  await assert.rejects(fx.collaborator.taskState(), error => error?.code === 'PROJECT_BUSINESS_SYNC_CONTEXT_CHANGED')
  assert.equal(fx.network.sent.some(item => item.sender === collaboratorDeviceRef), false)
})

test('collaborator restart preserves the encrypted outbox until authenticated receipt', async t => {
  const fx = await fixture(); t.after(() => fx.close())
  await synchronize(fx)
  fx.network.connected = false
  await fx.collaborator.taskAction({ commandId: 'restart_claim_1', type: 'claim', taskRef: 'task_runtime_1', expectedRevision: 1, payload: {} })
  await fx.restartCollaborator(); await fx.collaborator.initialize()
  assert.equal(fx.network.sent.some(item => item.message.commandId === 'restart_claim_1'), false)
  fx.network.connected = true
  for (let round = 0; round < 3; round += 1) { await fx.collaborator.recover(); await fx.authority.recover() }
  await waitFor(() => fx.network.sent.some(item => item.message.type === 'task.receipt' && item.message.commandId === 'restart_claim_1'))
  await fx.collaborator.close(); await fx.authority.close()
  assert.equal(await fx.taskRevision(), 2)
})

test('offline restart restores only persisted safe capability and rejects private Task targets', async t => {
  const fx = await fixture(); t.after(() => fx.close())
  await synchronize(fx)
  await assert.rejects(fx.collaborator.taskAction({ commandId: 'private_blocked', type: 'transition', taskRef: 'task_runtime_1', expectedRevision: 1, payload: { to: 'blocked' } }), error => error?.code === 'PROJECT_BUSINESS_SYNC_FORBIDDEN')
  await assert.rejects(fx.collaborator.taskAction({ commandId: 'private_review', type: 'transition', taskRef: 'task_runtime_1', expectedRevision: 1, payload: { to: 'in_review' } }), error => error?.code === 'PROJECT_BUSINESS_SYNC_FORBIDDEN')
  await fx.restartCollaborator(); fx.network.connected = false; await fx.collaborator.initialize()
  const state = await fx.collaborator.taskState()
  assert.equal(state.capability.available, true)
  assert.deepEqual(Object.keys(state.capability).sort(), ['automationCommands', 'available', 'mode', 'taskCommands', 'writable'])
  assert.equal(JSON.stringify(state.capability).includes('reset'), false)
  assert.equal(state.tasks.length, 1)
})

test('pending command retries byte-for-byte across restart and terminal receipt ACK is not leaked', async t => {
  const fx = await fixture(); t.after(() => fx.close())
  await synchronize(fx); fx.network.sent.length = 0; fx.network.deliveries = false
  const original = { commandId: 'byte_claim_1', type: 'claim', taskRef: 'task_runtime_1', expectedRevision: 1, payload: {} }
  await fx.collaborator.taskAction(original)
  await fx.collaborator.recover()
  const first = fx.network.sent.find(item => item.message.commandId === 'byte_claim_1')?.message
  assert.ok(first)
  await fx.restartCollaborator(); await fx.collaborator.initialize()
  await assert.rejects(fx.collaborator.taskAction({ commandId: 'byte_claim_1', type: 'transition', taskRef: 'task_forged', expectedRevision: 99, payload: { to: 'todo' } }), error => error?.code === 'PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT')
  assert.deepEqual(await fx.collaborator.taskAction(original), { queued: true, commandId: 'byte_claim_1', resource: 'task' })
  await fx.collaborator.recover()
  const copies = fx.network.sent.filter(item => item.message.commandId === 'byte_claim_1').map(item => item.message)
  assert.ok(copies.length >= 2)
  assert.equal(copies.every(message => JSON.stringify(message) === JSON.stringify(first)), true)
  fx.network.deliveries = true
  for (let round = 0; round < 4; round += 1) { await fx.collaborator.recover(); await fx.authority.recover() }
  await waitFor(() => fx.network.sent.some(item => item.message.type === 'ack' && item.message.kind === 'receipt'))
  const ackCount = fx.network.sent.filter(item => item.message.type === 'ack' && item.message.kind === 'receipt').length
  for (let round = 0; round < 3; round += 1) { await fx.collaborator.recover(); await fx.authority.recover() }
  assert.equal(fx.network.sent.filter(item => item.message.type === 'ack' && item.message.kind === 'receipt').length, ackCount)
  const completed = await fx.collaborator.taskAction(original), serialized = JSON.stringify(completed)
  assert.equal(completed.queued, false); assert.equal(completed.result.outcome, 'accepted'); assert.equal(completed.result.task.taskRef, 'task_runtime_1')
  for (const privateField of ['messageRef', 'replyTo', 'requestDigest']) assert.equal(serialized.includes(privateField), false)
  await fx.collaborator.close(); await fx.authority.close(); assert.equal(await fx.taskRevision(), 2)
})

test('bounded pump scans past a backed-off first batch without starving later commands', async t => {
  const fx = await fixture({ taskCount: 5, pumpLimit: 2 }); t.after(() => fx.close()); await synchronize(fx, 5); fx.network.connected = false; fx.network.sent.length = 0
  for (let index = 1; index <= 5; index += 1) await fx.collaborator.taskAction({ commandId: `starvation_claim_${index}`, type: 'claim', taskRef: `task_runtime_${index}`, expectedRevision: 1, payload: {} })
  await fx.collaborator.recover(); fx.advance(2_000); fx.network.connected = true; fx.network.deliveries = false; await fx.collaborator.recover()
  await waitFor(() => new Set(fx.network.sent.filter(item => item.message.commandId?.startsWith('starvation_claim_')).map(item => item.message.commandId)).size === 5, 'later durable commands were starved behind a retry-delayed first batch')
})

test('Automation normal events include the current run and accepted/rejected decisions survive sync', async t => {
  const fx = await fixture({ automationRun: true }); t.after(() => fx.close())
  await synchronize(fx)
  let state = await waitFor(async () => { const value = await fx.collaborator.automationState(); return value.runs.length === 2 && value.capability.automationCommands.length === 2 ? value : undefined })
  assert.equal(state.definitions.length, 1)
  assert.equal(state.runs.every(run => run.status === 'awaiting_approval'), true)
  await fx.collaborator.automationAction({ commandId: 'remote_approve_runtime', type: 'approve', runRef: fx.seededRun.runRef, expectedRevision: fx.seededRun.revision, payload: {} })
  await fx.collaborator.automationAction({ commandId: 'remote_reject_runtime', type: 'reject', runRef: fx.rejectedRun.runRef, expectedRevision: fx.rejectedRun.revision, payload: { reasonCode: 'not_now' } })
  for (let round = 0; round < 8; round += 1) { await fx.authority.recover(); await fx.collaborator.recover() }
  state = await waitFor(async () => { const value = await fx.collaborator.automationState(), statuses = new Set(value.runs.map(run => run.status)); return statuses.has('succeeded') && statuses.has('canceled') ? value : undefined }, 'Automation current entities did not advance with their ledger events')
  assert.equal(state.recentLedger.length > 4, true)
  assert.equal(JSON.stringify(state).includes('actorRef'), false)
  assert.equal(JSON.stringify(state).includes('inputHash'), false)
  assert.equal(fx.network.sent.some(item => item.message.type === 'task.receipt' && item.message.commandId === 'remote_approve_runtime' && item.message.outcome === 'accepted'), true)
  assert.equal(fx.network.sent.some(item => item.message.type === 'task.receipt' && item.message.commandId === 'remote_reject_runtime' && item.message.outcome === 'accepted'), true)
})

test('runtime requires exact nonce and reference-key widths and clears every obtained key', async () => {
  const { ProjectBusinessSyncRuntime } = await import(lib('project-business-sync-runtime.js'))
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-sync-runtime-keys-')), obtained = [], listeners = new Set()
  let disposed = 0
  const entry = { async localProjectBusinessSyncContext() { return Object.freeze({ projectRef, mode: 'collaborator', authorityEpoch: 1, localDeviceRef: collaboratorDeviceRef, filePath: path.join(root, 'sync.enc'), keyProvider() { const key = Buffer.alloc(obtained.length === 0 ? 32 : 31, 7); obtained.push(key); return key }, peerResolver: async () => ({ deviceRef: authorityDeviceRef, collaboratorRef: 'owner', role: 'owner', permissions: [] }), peerDeviceRefs: async () => [], dispose() { disposed += 1 } }) }, subscribeProjectBusinessDelivery(listener) { listeners.add(listener); return () => listeners.delete(listener) }, async sendProjectBusinessMessage() { throw new Error('unexpected send') } }
  const runtime = new ProjectBusinessSyncRuntime({ projectEntry: entry, randomBytesImpl: () => Buffer.alloc(16, 1) })
  try { await assert.rejects(runtime.initialize(), /exactly 32 bytes/); assert.equal(obtained.length, 2); assert.equal(obtained.every(key => key.every(byte => byte === 0)), true); assert.equal(disposed, 1) } finally { await runtime.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
  obtained.length = 0
  const badNonce = new ProjectBusinessSyncRuntime({ projectEntry: entry, randomBytesImpl: () => Buffer.alloc(15) })
  try { await assert.rejects(badNonce.initialize(), /exactly 16 bytes/) } finally { await badNonce.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
  const firstKey = Buffer.alloc(31, 9); let firstDisposed = 0
  const badFirstEntry = { async localProjectBusinessSyncContext() { return Object.freeze({ projectRef, mode: 'collaborator', authorityEpoch: 1, localDeviceRef: collaboratorDeviceRef, filePath: path.join(root, 'bad-first.enc'), keyProvider() { return firstKey }, peerResolver: async () => ({}), peerDeviceRefs: async () => [], dispose() { firstDisposed += 1 } }) }, subscribeProjectBusinessDelivery() { return () => {} }, async sendProjectBusinessMessage() {} }
  const badFirst = new ProjectBusinessSyncRuntime({ projectEntry: badFirstEntry })
  try { await assert.rejects(badFirst.initialize(), /exactly 32 bytes/); assert.equal(firstKey.every(byte => byte === 0), true); assert.equal(firstDisposed, 1) } finally { await badFirst.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
})

test('synchronous microtask scheduling failure rejects initialization and never hangs close', async () => {
  const { ProjectBusinessSyncRuntime } = await import(lib('project-business-sync-runtime.js')); const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-sync-runtime-queue-')); let disposed = 0
  const entry = { async localProjectBusinessSyncContext() { return Object.freeze({ projectRef, mode: 'collaborator', authorityEpoch: 1, localDeviceRef: collaboratorDeviceRef, filePath: path.join(root, 'sync.enc'), keyProvider() { return Buffer.alloc(32, 4) }, peerResolver: async () => ({}), peerDeviceRefs: async () => [], dispose() { disposed += 1 } }) }, subscribeProjectBusinessDelivery() { return () => {} }, async sendProjectBusinessMessage() {} }
  const runtime = new ProjectBusinessSyncRuntime({ projectEntry: entry, queueMicrotaskImpl() { throw new Error('microtask unavailable') }, scheduler() { return { cancel() {}, unref() {} } } })
  try { await assert.rejects(runtime.initialize(), /microtask unavailable/); await Promise.race([runtime.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('close hung')), 250))]); assert.equal(disposed, 1) } finally { await runtime.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
})
