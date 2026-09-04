const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { createHash, createHmac, randomBytes } = require('node:crypto')
const { EventEmitter } = require('node:events')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createAgentTeamsSessionLaunchService, projectKeyForWorkspace } = require('../electron/bridge/agent-teams-session-launch-service.cjs')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-session-launch.js')).href
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const requestOf = payload => payload?.args?.request
async function waitFor(read, predicate, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await delay(10) }
  throw new Error('timed out waiting for session launch state')
}
function binding(projectRef = 'project_A', rootSessionRef = 'root_A') { return { projectRef, boardRef: `board_${projectRef}`, rootSessionRef, projectTicket: `ticket_${projectRef}_${rootSessionRef}`, maxSessions: 8, seatAdoption: true } }
function projectBinding(execution, callerRootId = execution.rootSessionRef) { return { canonicalProjectKey: execution.projectRef === 'project_B' ? 'b'.repeat(64) : 'a'.repeat(64), workspacePath: `/workspace/${execution.projectRef}`, callerRootId } }
function slots(count) { return Array.from({ length: count }, (_, index) => ({ title: `Root ${index + 2}`, role: `Role ${index + 2}`, resources: [`src/area-${index + 2}`], task: `Task ${index + 2}` })) }

async function fixture(provider, options = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'project-session-launch-'))
  const mod = await import(`${moduleUrl}?test=${Date.now()}-${Math.random()}`)
  const runtime = new mod.ProjectSessionLaunchRuntime({ filePath: path.join(temporary, 'launch.json'), provider, ...options })
  await runtime.init()
  const start = runtime.start.bind(runtime)
  runtime.start = async (execution, input) => { const preparedBatch = await runtime.prepareStart(execution, input); if (!preparedBatch.noHostEffects) return start(execution, { batchRef: preparedBatch.batchRef, projectBinding: input.projectBinding }); const adoptions = await runtime.prepareAdoptions(execution, { batchRef: preparedBatch.batchRef, projectBinding: input.projectBinding }); return start(execution, { batchRef: preparedBatch.batchRef, projectBinding: input.projectBinding, reservations: (input.slots ?? []).map((_, index) => ({ slotActorRef: `actor_reserved_${String(index).padStart(20, '0')}`, taskRef: `task_reserved_${String(index).padStart(20, '0')}`, slotRef: adoptions.prepared[index].slotRef, operationRef: adoptions.prepared[index].operationRef })) }) }
  return { runtime, file: path.join(temporary, 'launch.json'), close: async () => { await runtime.close(); await rm(temporary, { recursive: true, force: true }) } }
}

function provider(overrides = {}) {
  return {
    callerRootRef: (canonicalProjectKey, rootId) => createHash('sha256').update(`${canonicalProjectKey}\0${rootId}`).digest('hex'),
    resolveProject: async (execution, request) => binding(execution.projectRef, request.callerRootRef),
    launch: async (_execution, request) => ({ projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' }),
    retry: async (_execution, request) => ({ projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' }),
    resolveUnknown: async (_execution, request) => ({ projectRef: request.projectRef, operationRef: request.operationRef, state: request.decision === 'delivered' ? 'ready' : 'failed', revision: request.expectedRevision + 1 }),
    reconcile: async (_execution, request) => ({ projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' }),
    cancel: async () => ({ cancelled: true }),
    reserveAdoption: async (_execution, request) => ({ projectRef: request.projectRef, operationRef: request.operationRef, adoptionCapability: `adoption-${request.operationRef}` }),
    redeemAdoption: async (_execution, request) => ({ projectRef: request.projectRef, operationRef: request.operationRef, adoptionCapability: `adoption-${request.operationRef}` }),
    ...overrides,
  }
}

test('consumes the Desktop loopback capability once and speaks the bounded plain-data protocol', async () => {
  const mod = await import(`${moduleUrl}?capability=${Date.now()}`)
  const token = Buffer.alloc(32, 7).toString('base64url'), callerSalt = Buffer.alloc(32, 9).toString('base64url')
  const env = { [mod.ENDPOINT_ENV]: '/tmp/dsh-atsl-test.sock', [mod.TOKEN_ENV]: token, [mod.CALLER_SALT_ENV]: callerSalt }
  const requests = []
  const connect = () => {
    const socket = new EventEmitter()
    socket.setEncoding = () => undefined
    socket.write = body => {
      const request = JSON.parse(body.trim()); requests.push(request)
      queueMicrotask(() => { socket.emit('data', `${JSON.stringify({ ok: true, result: request.action === 'resolveProject' ? binding() : { projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' } })}\n`); socket.emit('end') })
    }
    socket.destroy = error => queueMicrotask(() => socket.emit('error', error))
    queueMicrotask(() => socket.emit('connect'))
    return socket
  }
  const capability = mod.consumeDesktopProjectSessionLaunchCapability({ env, connect, platform: 'linux', timeoutMs: 1000 })
  assert.equal(env[mod.ENDPOINT_ENV], undefined)
  assert.equal(env[mod.TOKEN_ENV], undefined)
  assert.equal(env[mod.CALLER_SALT_ENV], undefined)
  assert.deepEqual(await capability.resolveProject({ ignored: true }, { canonicalProjectKey: 'a'.repeat(64), workspacePath: '/workspace/project_A', callerRootRef: 'caller_opaque' }), binding())
  const launched = await capability.launch({}, { projectRef: 'project_A', boardRef: 'board_project_A', projectTicket: 'ticket_project_A_root_A', callerRootRef: 'caller_opaque', batchRef: 'batch_x', slotRef: 'slot_x', operationRef: 'operation_x', title: 'Root 2', role: 'Role 2', resources: ['src/a'], task: 'Task 2', initialization: 'Read board first.' })
  assert.equal(launched.state, 'ready')
  assert.deepEqual(requests.map(request => request.action), ['resolveProject', 'launch'])
  assert.ok(requests.every(request => request.token === token))
  assert.ok(requests.every(request => !('sessionId' in request) && !('workspaceId' in request) && !('path' in request)))
  capability.dispose()
})

test('integrates the real Host private reserve-launch-redeem capability protocol', async () => {
  const mod = await import(`${moduleUrl}?host-integration=${Date.now()}`)
  const root = await mkdtemp(path.join(os.tmpdir(), 'atsl-plugin-host-')), project = path.join(root, 'project，lane'), asciiSibling = path.join(root, 'project,lane'), token = randomBytes(32), calls = [], sessions = new Set(), hostFile = path.join(root, 'host.json'), pluginFile = path.join(root, 'plugin.json')
  await Promise.all([mkdir(project), mkdir(asciiSibling)])
  const rpc = async (method, payload) => {
    calls.push([method, structuredClone(payload)])
    if (method === 'workspace/create') return { workspace: { workspaceId: 'workspace-real', path: requestOf(payload).path } }
    if (method === 'session/create') { sessions.add(requestOf(payload).sessionId); return { sessionId: requestOf(payload).sessionId } }
    if (method === 'session/rename') return { title: requestOf(payload).title, seq: 1 }
    if (method === 'session/prompt') return { accepted: true }
    if (method === 'session/list') return { items: [...sessions].map(sessionId => ({ sessionId })) }
    throw new Error(method)
  }
  const createHost = () => createAgentTeamsSessionLaunchService({ stateFile: hostFile, token, callRuntimeRpc: rpc })
  let host = createHost(), runtime
  try {
    await host.start()
    runtime = new mod.ProjectSessionLaunchRuntime({ filePath: pluginFile, provider: mod.consumeDesktopProjectSessionLaunchCapability({ env: host.runtimeEnvironment({}) }) })
    await runtime.init()
    const canonicalProjectKey = projectKeyForWorkspace(project), workspacePath = path.resolve(project), parentBinding = { canonicalProjectKey, workspacePath, callerRootId: 'parent-session' }, launchSlots = slots(1)
    assert.notEqual(canonicalProjectKey, projectKeyForWorkspace(asciiSibling), 'full-width comma project must not collide with its ASCII sibling')
    await assert.rejects(runtime.preflight({}, { totalSessions: 2, projectBinding: { ...parentBinding, workspacePath: asciiSibling } }), error => error.code === 'PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH')
    const preparedBatch = await runtime.prepareStart({}, { requestId: 'real-host-reserve', totalSessions: 2, slots: launchSlots, projectBinding: parentBinding })
    assert.equal(preparedBatch.state, 'reserving'); assert.equal(preparedBatch.noHostEffects, true)
    const adoptions = await runtime.prepareAdoptions({}, { batchRef: preparedBatch.batchRef, projectBinding: parentBinding })
    const reservations = [{ slotActorRef: 'actor_reserved_real_host_0000000000000000', taskRef: 'task_reserved_real_host_00000000000000000', slotRef: adoptions.prepared[0].slotRef, operationRef: adoptions.prepared[0].operationRef }]
    const started = await runtime.activatePreparedBatch({}, { batchRef: preparedBatch.batchRef, reservations, projectBinding: parentBinding })
    const ready = await waitFor(() => runtime.status({}, { batchRef: started.batchRef, projectBinding: parentBinding }), value => value.state === 'ready')
    assert.equal(requestOf(calls.find(([method]) => method === 'workspace/create')[1]).path, workspacePath)
    const hostState = JSON.parse(await readFile(hostFile, 'utf8')), childSessionId = hostState.operations[0].sessionId, equivalentWorkspacePath = process.platform === 'win32' ? workspacePath.replace(/\\/gu, '/').toLocaleUpperCase('en-US') : `${workspacePath}${path.sep}`, childBinding = { canonicalProjectKey, workspacePath: equivalentWorkspacePath, callerRootId: childSessionId }
    const redeemed = await runtime.redeemAdoption({}, { slotRef: ready.slots[0].slotRef, projectBinding: childBinding })
    assert.equal(redeemed.slotActorRef, reservations[0].slotActorRef)
    assert.equal(redeemed.slotCapability, adoptions.prepared[0].adoptionCapability)
    assert.notEqual(redeemed.slotCapability, adoptions.prepared[0].slotRef)
    const indexUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href, indexMod = await import(`${indexUrl}?agent-error-e2e=${Date.now()}`), projectKey = randomBytes(32), hostProjectRef = hostState.bindings[0].projectRef
    const adoptedActorRef = `actor_${createHmac('sha256', projectKey).update('dsh-agent-teams/project-root-actor/v1').update('\0').update(hostProjectRef).update('\0').update(JSON.stringify([childSessionId])).digest('base64url')}`
    assert.deepEqual(await runtime.recordAdoption({}, { slotRef: ready.slots[0].slotRef, adoptedActorRef, projectBinding: childBinding }), { recorded: true })
    await runtime.close(); runtime = undefined; await host.close(); host = createHost(); await host.start()
    runtime = new mod.ProjectSessionLaunchRuntime({ filePath: pluginFile, provider: mod.consumeDesktopProjectSessionLaunchCapability({ env: host.runtimeEnvironment({}) }) }); await runtime.init()
    await assert.rejects(runtime.recordAdoptedActorFailure({}, { adoptedActorRef: 'actor_wrong_root_000000000000000000000', projectBinding: { canonicalProjectKey, workspacePath, callerRootId: childSessionId } }), error => error.code === 'PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED')
    await assert.rejects(runtime.recordAdoptedActorFailure({}, { adoptedActorRef, projectBinding: parentBinding }), error => error.code === 'PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED')
    await assert.rejects(runtime.recordAdoptedActorFailure({}, { adoptedActorRef, projectBinding: { canonicalProjectKey: projectKeyForWorkspace(asciiSibling), workspacePath: asciiSibling, callerRootId: childSessionId } }), error => error.code === 'PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED')
    const failedAgent = { id: childSessionId, status: 'running', session: { header: { cwd: project }, events: [] } }, listeners = new Map(), internalExecution = Object.freeze({})
    const ctx = { agents: { get: id => id === failedAgent.id ? failedAgent : undefined, roots: () => [failedAgent] }, on: (name, listener) => { listeners.set(name, listener) }, logger: { warn: () => {} } }, projectEntry = { localProjectCollaborationContext: async () => { const context = { projectRef: hostProjectRef, databasePath: path.join(root, 'observer.sqlite') }; Object.defineProperties(context, { execution: { value: internalExecution }, actorResolver: { value: (candidate, requested) => { if (candidate !== internalExecution || requested !== hostProjectRef) throw new Error('context mismatch'); return { projectRef: requested } } }, keyProvider: { value: requested => { if (requested !== hostProjectRef) throw new Error('key mismatch'); return Buffer.from(projectKey) } }, dispose: { value: () => {} } }); return Object.freeze(context) } }
    let observerPromise; const originalRecord = runtime.recordAdoptedActorFailure.bind(runtime); runtime.recordAdoptedActorFailure = (...args) => (observerPromise = originalRecord(...args)); indexMod.observeProjectRootFailures(ctx, projectEntry, runtime, Promise.resolve()); listeners.get('agent/error')({ agent: failedAgent, error: new Error('private lifecycle detail') }); for (let i = 0; i < 20 && observerPromise === undefined; i += 1) await delay(5); await observerPromise
    const failedAfterAdoption = await waitFor(() => runtime.status({}, { batchRef: ready.batchRef, projectBinding: parentBinding }), value => value.slots[0].state === 'failed')
    assert.equal(failedAfterAdoption.slots[0].state, 'failed'); const failedRevision = failedAfterAdoption.slots[0].hostRevision
    observerPromise = undefined; listeners.get('agent/error')({ agent: failedAgent, error: new Error('duplicate private detail') }); for (let i = 0; i < 20 && observerPromise === undefined; i += 1) await delay(5); await observerPromise; assert.equal((await runtime.status({}, { batchRef: ready.batchRef, projectBinding: parentBinding })).slots[0].hostRevision, failedRevision); projectKey.fill(0)
    const laterEvidence = await runtime.rootFailureEvidence({}, { failureRef: ready.slots[0].slotRef, projectBinding: parentBinding })
    assert.equal(laterEvidence.failedActorRef, adoptedActorRef); assert.equal(laterEvidence.beneficiaryActorRef, adoptedActorRef); assert.equal(laterEvidence.initiatorAuthorized, true)
    const pluginState = await readFile(pluginFile, 'utf8'), finalHostState = JSON.parse(await readFile(hostFile, 'utf8')), promptPayloads = calls.filter(([method]) => method === 'session/prompt').map(([, payload]) => JSON.stringify(payload))
    assert.equal(pluginState.includes(redeemed.slotCapability), false)
    assert.equal(JSON.stringify(finalHostState).includes(redeemed.slotCapability), false)
    assert.equal(finalHostState.operations[0].adoptedActorRef, adoptedActorRef)
    assert.equal(promptPayloads.some(value => value.includes(redeemed.slotCapability)), false)
    assert.equal(promptPayloads.some(value => value.includes(adoptions.prepared[0].slotRef)), true)
    assert.equal(promptPayloads.some(value => value.includes(reservations[0].slotActorRef) || value.includes(reservations[0].taskRef)), false)
  } finally {
    await runtime?.close().catch(() => undefined)
    await host.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('persists exactly N-1 board slots before launching and replays idempotently', async () => {
  let persistedBeforeLaunch = false
  let launches = 0
  const initializations = []
  let fx
  const host = provider({ launch: async (_execution, request) => {
    launches += 1
    initializations.push(request.initialization)
    const stored = JSON.parse(await readFile(fx.file, 'utf8'))
    const slot = stored.batches[0].slots.find(item => item.operationRef === request.operationRef)
    assert.equal(Object.hasOwn(stored.batches[0], 'rootSessionId'), false)
    assert.doesNotMatch(JSON.stringify(stored), /raw-root-internal/u)
    persistedBeforeLaunch = stored.batches[0].slots.length === 2 && slot.state === 'starting' && stored.batches[0].boardRef === 'board_project_A'
    return { projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' }
  } })
  fx = await fixture(host)
  try {
    const execution = { projectRef: 'project_A', rootSessionRef: 'root_A' }
    const input = { requestId: 'confirmed-total-3', totalSessions: 3, projectBinding: projectBinding(execution, 'raw-root-internal'), slots: slots(2) }
    const first = await fx.runtime.start(execution, input)
    assert.equal(first.slots.length, 2)
    const ready = await waitFor(() => fx.runtime.status(execution, { batchRef: first.batchRef, projectBinding: input.projectBinding }), value => value.state === 'ready')
    assert.equal(ready.createdSessionCount, 2)
    const replay = await fx.runtime.start(execution, input)
    assert.equal(replay.batchRef, first.batchRef)
    await delay(30)
    assert.equal(launches, 2)
    assert.equal(persistedBeforeLaunch, true)
    assert.ok(initializations.every(value => Buffer.byteLength(value, 'utf8') <= 8 * 1024 && /adopt reserved slot/u.test(value) && /Duty: Role/u.test(value) && /Resource scope: src\/area-/u.test(value) && /Initial task: Task/u.test(value)))
    assert.match(initializations[0], /Role 2[\s\S]*src\/area-2[\s\S]*Task 2/u)
    assert.doesNotMatch(initializations[0], /Role 3|src\/area-3|Task 3/u)
    assert.match(initializations[1], /Role 3[\s\S]*src\/area-3[\s\S]*Task 3/u)
    assert.doesNotMatch(initializations[1], /Role 2|src\/area-2|Task 2/u)
    assert.ok(initializations.every(value => !/history|other team|projectRef|callerRootRef|projectTicket/iu.test(value)))
    await assert.rejects(() => fx.runtime.start(execution, { ...input, totalSessions: 2, slots: slots(1) }), error => error.code === 'PROJECT_SESSION_LAUNCH_IDEMPOTENCY_CONFLICT')
  } finally { await fx.close() }
})

test('persists reservation failure with zero Host effects and resumes the same prepared batch idempotently', async () => {
  let launches = 0
  const fx = await fixture(provider({ launch: async (_execution, request) => { launches += 1; return { projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' } } }))
  try {
    const execution = { projectRef: 'project_A', rootSessionRef: 'root_A' }, ownBinding = projectBinding(execution), input = { requestId: 'two-phase-resume', totalSessions: 3, projectBinding: ownBinding, slots: slots(2) }
    const prepared = await fx.runtime.prepareStart(execution, input)
    assert.deepEqual({ state: prepared.state, reservedCount: prepared.reservedCount, total: prepared.total, noHostEffects: prepared.noHostEffects, launches }, { state: 'reserving', reservedCount: 0, total: 2, noHostEffects: true, launches: 0 })
    const adoptions = await fx.runtime.prepareAdoptions(execution, { batchRef: prepared.batchRef, projectBinding: ownBinding })
    const first = { slotActorRef: 'actor_reserved_resume_000000000000000000', taskRef: 'task_reserved_resume_0000000000000000000', slotRef: adoptions.prepared[0].slotRef, operationRef: adoptions.prepared[0].operationRef }
    const failed = await fx.runtime.recordReservationFailure(execution, { batchRef: prepared.batchRef, reservations: [first], failedIndex: 1, errorCode: 'PROJECT_COLLABORATION_CONFLICT', projectBinding: ownBinding })
    assert.deepEqual({ batchRef: failed.batchRef, state: failed.state, reservedCount: failed.reservedCount, total: failed.total, noHostEffects: failed.noHostEffects, launches }, { batchRef: prepared.batchRef, state: 'reservation_failed', reservedCount: 1, total: 2, noHostEffects: true, launches: 0 })
    const stored = JSON.parse(await readFile(fx.file, 'utf8'))
    assert.equal(stored.batches[0].state, 'reservation_failed'); assert.equal(stored.batches[0].noHostEffects, true)
    const resumed = await fx.runtime.prepareStart(execution, input)
    assert.equal(resumed.batchRef, prepared.batchRef); assert.equal(resumed.state, 'reserving'); assert.equal(resumed.reservedCount, 1); assert.equal(launches, 0)
    const retryAdoptions = await fx.runtime.prepareAdoptions(execution, { batchRef: resumed.batchRef, projectBinding: ownBinding })
    const reservations = retryAdoptions.prepared.map((item, index) => ({ slotActorRef: index === 0 ? first.slotActorRef : 'actor_reserved_resume_111111111111111111', taskRef: index === 0 ? first.taskRef : 'task_reserved_resume_1111111111111111111', slotRef: item.slotRef, operationRef: item.operationRef }))
    const activated = await fx.runtime.activatePreparedBatch(execution, { batchRef: resumed.batchRef, reservations, projectBinding: ownBinding })
    assert.equal(activated.noHostEffects, false)
    const ready = await waitFor(() => fx.runtime.status(execution, { batchRef: resumed.batchRef, projectBinding: ownBinding }), value => value.state === 'ready')
    assert.equal(ready.createdSessionCount, 2); assert.equal(launches, 2)
  } finally { await fx.close() }
})

test('fails closed for unavailable Host capability, capacity excess, and cross-project batch access', async () => {
  const unavailable = await fixture(undefined)
  try {
    await assert.rejects(() => unavailable.runtime.start({}, { requestId: 'x', totalSessions: 2, projectBinding: projectBinding({ projectRef: 'project_A', rootSessionRef: 'root_A' }), slots: slots(1) }), error => error.code === 'PROJECT_SESSION_LAUNCH_HOST_UNAVAILABLE')
  } finally { await unavailable.close() }
  const fx = await fixture(provider())
  try {
    const execution = { projectRef: 'project_A', rootSessionRef: 'root_A' }
    const ownBinding = projectBinding(execution, 'r')
    const tooManyResources = [{ ...slots(1)[0], resources: Array.from({ length: 65 }, (_, index) => `src/r-${index}`) }]
    await assert.rejects(() => fx.runtime.start(execution, { requestId: 'resource-count', totalSessions: 2, projectBinding: ownBinding, slots: tooManyResources }), /at most 64/u)
    const oversizedResources = [{ ...slots(1)[0], resources: Array.from({ length: 64 }, (_, index) => `r/${String(index).padStart(2, '0')}-${'x'.repeat(251)}`) }]
    await assert.rejects(() => fx.runtime.start(execution, { requestId: 'resource-bytes', totalSessions: 2, projectBinding: ownBinding, slots: oversizedResources }), /16 KiB total/u)
    await assert.rejects(() => fx.runtime.start(execution, { requestId: 'requirements-bytes', totalSessions: 2, projectBinding: ownBinding, slots: [{ ...slots(1)[0], task: 'x'.repeat(65_536) }] }), /canonical JSON exceeds 65536/u)
    assert.equal(fx.runtime.validateSlots(2, [{ ...slots(1)[0], task: 'x'.repeat(65_534) }])[0].task.length, 65_534)
    await assert.rejects(() => fx.runtime.start(execution, { requestId: 'too-many', totalSessions: 9, projectBinding: ownBinding, slots: slots(8) }), error => error.code === 'PROJECT_SESSION_LAUNCH_CAPACITY' && /maximum feasible total is 8/u.test(error.message))
    const batch = await fx.runtime.start(execution, { requestId: 'bound', totalSessions: 2, projectBinding: ownBinding, slots: slots(1) })
    const other = { projectRef: 'project_B', rootSessionRef: 'root_B' }
    await assert.rejects(() => fx.runtime.status(other, { batchRef: batch.batchRef, projectBinding: projectBinding(other) }), error => error.code === 'PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH')
  } finally { await fx.close() }
})

test('keeps ambiguous outcomes fenced until status reconciliation and never blind-retries', async () => {
  let launches = 0
  let reconciliations = 0
  const fx = await fixture(provider({
    launch: async () => { launches += 1; const error = new Error('transport ended after dispatch'); error.code = 'RPC_DISCONNECTED'; throw error },
    reconcile: async (_execution, request) => { reconciliations += 1; return { projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' } },
  }))
  try {
    const execution = { projectRef: 'project_A', rootSessionRef: 'root_A' }
    const ownBinding = projectBinding(execution, 'r')
    const batch = await fx.runtime.start(execution, { requestId: 'unknown', totalSessions: 2, projectBinding: ownBinding, slots: slots(1) })
    await waitFor(async () => JSON.parse(await readFile(fx.file, 'utf8')), value => value.batches[0].slots[0].state === 'outcome_unknown')
    assert.equal(launches, 1)
    const reconciled = await fx.runtime.status(execution, { batchRef: batch.batchRef, projectBinding: ownBinding })
    assert.equal(reconciled.state, 'ready')
    assert.equal(reconciliations, 1)
    assert.equal(launches, 1)
  } finally { await fx.close() }
})

test('explicit failed-slot retry reuses the exact operation and refuses outcome-unknown blind retry', async () => {
  let retries=0
  const fx=await fixture(provider({launch:async()=>{ const error=new Error('definitive'); error.code='HOST_SESSION_CREATE_FAILED'; error.definitive=true; throw error },retry:async(_execution,request)=>{retries+=1; return {projectRef:request.projectRef,operationRef:request.operationRef,state:'ready'} }}))
  try {
    const execution={projectRef:'project_A',rootSessionRef:'root_A'}, ownBinding=projectBinding(execution,'retry-root')
    const batch=await fx.runtime.start(execution,{requestId:'retry-exact',totalSessions:2,projectBinding:ownBinding,slots:slots(1)})
    const failed=await waitFor(()=>fx.runtime.status(execution,{batchRef:batch.batchRef,projectBinding:ownBinding}),value=>value.state==='failed')
    const ready=await fx.runtime.retryFailedSlot(execution,{slotRef:failed.slots[0].slotRef,projectBinding:ownBinding}); assert.equal(ready.state,'ready'); assert.equal(retries,1)
    assert.equal((await fx.runtime.retryFailedSlot(execution,{slotRef:failed.slots[0].slotRef,projectBinding:ownBinding})).state,'ready'); assert.equal(retries,1)
    const stored=JSON.parse(await readFile(fx.file,'utf8')); stored.batches[0].slots[0].state='outcome_unknown'; stored.batches[0].state='outcome_unknown'; await writeFile(fx.file,JSON.stringify(stored),'utf8')
  } finally { await fx.close() }
})

test('Host-derived root failure evidence is exact, persistent, and project-bound', async () => {
  const fx=await fixture(provider({launch:async()=>{const error=new Error('failed');error.code='HOST_SESSION_CREATE_FAILED';error.definitive=true;throw error}}))
  try {const a={projectRef:'project_A',rootSessionRef:'root_A'},bindingA=projectBinding(a,'evidence-a'),batch=await fx.runtime.start(a,{requestId:'evidence',totalSessions:2,projectBinding:bindingA,slots:slots(1)}),failed=await waitFor(()=>fx.runtime.status(a,{batchRef:batch.batchRef,projectBinding:bindingA}),value=>value.state==='failed'),evidence=await fx.runtime.rootFailureEvidence(a,{failureRef:failed.slots[0].slotRef,projectBinding:bindingA});assert.equal(evidence.failureCode,'HOST_SESSION_CREATE_FAILED');assert.equal(evidence.taskRef,failed.slots[0].taskRef);const b={projectRef:'project_B',rootSessionRef:'root_B'},bindingB=projectBinding(b,'evidence-b');await assert.rejects(fx.runtime.rootFailureEvidence(b,{failureRef:failed.slots[0].slotRef,projectBinding:bindingB}),error=>error.code==='PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH');await assert.rejects(fx.runtime.rootFailureEvidence(a,{failureRef:'slot_missing',projectBinding:bindingA}),error=>error.code==='PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED')}finally{await fx.close()}
})

test('outer runtime retries unknown only after Host not-delivered reconciliation', async () => {
  let retries=0,receipt
  const fx=await fixture(provider({launch:async(_execution,request)=>({projectRef:request.projectRef,operationRef:request.operationRef,state:'outcome_unknown',revision:1,errorCode:'HOST_SESSION_LAUNCH_OUTCOME_UNKNOWN'}),reconcile:async(_execution,request)=>({projectRef:request.projectRef,operationRef:request.operationRef,state:'outcome_unknown',revision:1}),resolveUnknown:async(_execution,request)=>{if(receipt){if(receipt.requestId===request.requestId&&receipt.decision===request.decision)return receipt.result;const error=new Error(receipt.requestId===request.requestId?'drift':'terminal');error.code=receipt.requestId===request.requestId?'HOST_SESSION_LAUNCH_IDEMPOTENCY_CONFLICT':'HOST_SESSION_LAUNCH_RECONCILIATION_FORBIDDEN';error.definitive=true;throw error}const result={projectRef:request.projectRef,operationRef:request.operationRef,state:'failed',revision:2,errorCode:'HOST_SESSION_PROMPT_NOT_DELIVERED'};receipt={requestId:request.requestId,decision:request.decision,result};return result},retry:async(_execution,request)=>{retries+=1;return {projectRef:request.projectRef,operationRef:request.operationRef,state:'ready',revision:2}}}))
  try { const execution={projectRef:'project_A',rootSessionRef:'root_A'},project=projectBinding(execution,'resolve-root'),batch=await fx.runtime.start(execution,{requestId:'resolve-unknown',totalSessions:2,projectBinding:project,slots:slots(1)}),unknown=await waitFor(()=>fx.runtime.status(execution,{batchRef:batch.batchRef,projectBinding:project}),value=>value.state==='outcome_unknown');assert.equal(unknown.slots[0].reconciliationRevision,1);assert.equal(JSON.parse(await readFile(fx.file,'utf8')).batches[0].slots[0].hostRevision,1);await assert.rejects(fx.runtime.rootFailureEvidence(execution,{failureRef:unknown.slots[0].slotRef,projectBinding:project}),error=>error.code==='PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED');const input={slotRef:unknown.slots[0].slotRef,requestId:'human-not-delivered',decision:'not_delivered',expectedRevision:1,projectBinding:project};await assert.rejects(fx.runtime.retryFailedSlot(execution,{slotRef:unknown.slots[0].slotRef,projectBinding:project}),error=>error.code==='PROJECT_SESSION_LAUNCH_RETRY_FORBIDDEN');const failed=await fx.runtime.resolveUnknownSlot(execution,input);assert.equal(failed.slots[0].state,'failed');assert.equal(failed.slots[0].reconciliationRevision,2);assert.equal((await fx.runtime.resolveUnknownSlot(execution,input)).slots[0].state,'failed');await assert.rejects(fx.runtime.resolveUnknownSlot(execution,{...input,decision:'delivered'}),error=>error.code==='HOST_SESSION_LAUNCH_IDEMPOTENCY_CONFLICT');await assert.rejects(fx.runtime.resolveUnknownSlot(execution,{...input,requestId:'new-terminal',expectedRevision:2}),error=>error.code==='HOST_SESSION_LAUNCH_RECONCILIATION_FORBIDDEN');const ready=await fx.runtime.retryFailedSlot(execution,{slotRef:unknown.slots[0].slotRef,projectBinding:project});assert.equal(ready.slots[0].state,'ready');assert.equal(retries,1) } finally { await fx.close() }
})

test('uses bounded fair project scheduling and exposes partial failure', async () => {
  const order = []
  const releases = []
  const host = provider({ launch: async (execution, request) => {
    order.push(`${execution.projectRef}:${request.title}`)
    await new Promise(resolve => releases.push(resolve))
    if (request.title === 'Root 3') { const error = new Error('rejected'); error.code = 'HOST_REJECTED'; error.definitive = true; throw error }
    return { projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' }
  } })
  const fx = await fixture(host, { maxConcurrent: 1, maxConcurrentPerProject: 1 })
  try {
    const a = { projectRef: 'project_A', rootSessionRef: 'root_A' }, b = { projectRef: 'project_B', rootSessionRef: 'root_B' }
    const bindingA = projectBinding(a, 'ra'), bindingB = projectBinding(b, 'rb')
    const batchA = await fx.runtime.start(a, { requestId: 'a', totalSessions: 3, projectBinding: bindingA, slots: slots(2) })
    await waitFor(() => Promise.resolve(order), value => value.length === 1)
    const batchB = await fx.runtime.start(b, { requestId: 'b', totalSessions: 2, projectBinding: bindingB, slots: slots(1) })
    releases.shift()()
    await waitFor(() => Promise.resolve(order), value => value.length === 2)
    releases.shift()()
    await waitFor(() => Promise.resolve(order), value => value.length === 3)
    releases.shift()()
    const resultA = await waitFor(() => fx.runtime.status(a, { batchRef: batchA.batchRef, projectBinding: bindingA }), value => ['partial', 'ready', 'failed'].includes(value.state))
    const resultB = await waitFor(() => fx.runtime.status(b, { batchRef: batchB.batchRef, projectBinding: bindingB }), value => value.state === 'ready')
    assert.deepEqual(order, ['project_A:Root 2', 'project_B:Root 2', 'project_A:Root 3'])
    assert.equal(resultA.state, 'partial')
    assert.deepEqual(resultA.slots.map(slot => slot.state), ['ready', 'failed'])
    assert.equal(resultB.state, 'ready')
  } finally { await fx.close() }
})

test('activation replay recovers exact persisted reservation after Host restart without a second launch', async () => {
  const temporary=await mkdtemp(path.join(os.tmpdir(),'project-session-recovery-replay-')),file=path.join(temporary,'launch.json'),execution={projectRef:'project_A',rootSessionRef:'root_A'},ownBinding=projectBinding(execution,'replay-root')
  let launches=0
  const host=provider({launch:async(_execution,request)=>{launches+=1;return {projectRef:request.projectRef,operationRef:request.operationRef,state:'ready'}}})
  const mod=await import(`${moduleUrl}?recovery-replay=${Date.now()}`)
  let runtime=new mod.ProjectSessionLaunchRuntime({filePath:file,provider:host}); await runtime.init()
  try {
    const prepared=await runtime.prepareStart(execution,{requestId:'recovery-replay',totalSessions:2,projectBinding:ownBinding,slots:slots(1)}),adoptions=await runtime.prepareAdoptions(execution,{batchRef:prepared.batchRef,projectBinding:ownBinding}),adoption=adoptions.prepared[0],reservation={slotActorRef:'actor_recovery_replay_slot_0000000001',taskRef:'task_recovery_replay_000000000001',slotRef:adoption.slotRef,operationRef:adoption.operationRef}
    const ready=await runtime.activatePreparedBatch(execution,{batchRef:prepared.batchRef,reservations:[reservation],projectBinding:ownBinding}); await waitFor(()=>runtime.status(execution,{batchRef:prepared.batchRef,projectBinding:ownBinding}),value=>value.state==='ready')
    assert.equal(ready.batchRef,prepared.batchRef); assert.equal(launches,1)
    await runtime.close(); runtime=new mod.ProjectSessionLaunchRuntime({filePath:file,provider:host}); await runtime.init()
    const recovered=await runtime.recoveryReservation(execution,{batchRef:prepared.batchRef,projectBinding:ownBinding})
    assert.deepEqual({slotRef:recovered.slotRef,operationRef:recovered.operationRef},{slotRef:adoption.slotRef,operationRef:adoption.operationRef})
    const replay=await runtime.activatePreparedBatch(execution,{batchRef:prepared.batchRef,reservations:[reservation],projectBinding:ownBinding})
    assert.equal(replay.state,'ready'); assert.equal(launches,1)
  } finally { await runtime.close(); await rm(temporary,{recursive:true,force:true}) }
})

test('status after restart resumes queued slots without requiring another activation command', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'project-session-status-restart-'))
  const file = path.join(temporary, 'launch.json')
  const execution = { projectRef: 'project_A', rootSessionRef: 'root_A' }
  const ownBinding = projectBinding(execution, 'status-restart-root')
  let launches = 0
  const host = provider({ launch: async (_execution, request) => { launches += 1; return { projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' } } })
  const mod = await import(`${moduleUrl}?status-restart=${Date.now()}`)
  let runtime = new mod.ProjectSessionLaunchRuntime({ filePath: file, provider: host })
  await runtime.init()
  try {
    const prepared = await runtime.prepareStart(execution, { requestId: 'status-restart', totalSessions: 2, projectBinding: ownBinding, slots: slots(1) })
    const adoptions = await runtime.prepareAdoptions(execution, { batchRef: prepared.batchRef, projectBinding: ownBinding })
    const stored = JSON.parse(await readFile(file, 'utf8'))
    Object.assign(stored.batches[0], { noHostEffects: false, state: 'queued' })
    Object.assign(stored.batches[0].slots[0], { slotActorRef: 'actor_status_restart_000000000000000001', taskRef: 'task_status_restart_0000000000000000001', state: 'queued' })
    await writeFile(file, JSON.stringify(stored), 'utf8')
    await runtime.close()

    runtime = new mod.ProjectSessionLaunchRuntime({ filePath: file, provider: host })
    await runtime.init()
    const ready = await waitFor(() => runtime.status(execution, { batchRef: prepared.batchRef, projectBinding: ownBinding }), value => value.state === 'ready')
    assert.equal(ready.createdSessionCount, 1)
    assert.equal(launches, 1)
    assert.equal(ready.slots[0].slotRef, adoptions.prepared[0].slotRef)
  } finally { await runtime.close(); await rm(temporary, { recursive: true, force: true }) }
})

test('Stop cancels queued slots durably without launching them', async () => {
  let launches = 0
  let release
  const fx = await fixture(provider({ launch: async (_execution, request) => { launches += 1; await new Promise(resolve => { release = resolve }); return { projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' } } }), { maxConcurrent: 1 })
  try {
    const execution = { projectRef: 'project_A', rootSessionRef: 'root_A' }, ownBinding = projectBinding(execution, 'raw-root')
    const batch = await fx.runtime.start(execution, { requestId: 'stop', totalSessions: 3, projectBinding: ownBinding, slots: slots(2) })
    await waitFor(() => Promise.resolve(launches), value => value === 1)
    await fx.runtime.stopForRoot('raw-root')
    release()
    const stopped = await waitFor(() => fx.runtime.status(execution, { batchRef: batch.batchRef, projectBinding: ownBinding }), value => value.slots.some(slot => slot.state === 'cancelled'))
    assert.equal(launches, 1)
    assert.equal(stopped.slots[1].state, 'cancelled')
  } finally { await fx.close() }
})

test('initialization migrates legacy raw root ids into opaque caller indexes and removes them durably', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'project-session-launch-legacy-'))
  const file = path.join(temporary, 'launch.json')
  const createdAt = new Date().toISOString()
  const legacy = {
    version: 1,
    secret: Buffer.alloc(32, 13).toString('base64url'),
    batches: [{
      batchRef: 'batch_legacy', projectRef: 'project_A', boardRef: 'board_project_A', rootSessionRef: 'root_ref_opaque', rootSessionId: 'raw-root-legacy', callerRootRef: 'caller_root_opaque',
      projectTicket: 'ticket_opaque', canonicalProjectKey: 'a'.repeat(64), workspacePath: '/workspace/project_A', requestId: 'legacy-request', inputDigest: 'a'.repeat(64), totalSessions: 2,
      state: 'queued', stopRequested: false, createdAt, updatedAt: createdAt,
      slots: [{ title: 'Root 2', role: 'Role 2', resources: ['src/a'], task: 'Task 2', slotRef: 'slot_legacy', slotActorRef: 'actor_reserved_legacy_00000000000000000000', taskRef: 'task_reserved_legacy_00000000000000000000', operationRef: 'operation_legacy', state: 'queued', attempt: 0, createdAt, updatedAt: createdAt }],
    }],
  }
  await writeFile(file, JSON.stringify(legacy), 'utf8')
  const mod = await import(`${moduleUrl}?legacy=${Date.now()}`)
  const runtime = new mod.ProjectSessionLaunchRuntime({ filePath: file, provider: undefined })
  try {
    const initialized = await runtime.init()
    assert.equal(initialized.queued, 1)
    let persisted = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(Object.hasOwn(persisted.batches[0], 'rootSessionId'), false)
    assert.doesNotMatch(JSON.stringify(persisted), /raw-root-legacy/u)
    assert.match(persisted.batches[0].callerStopRef, /^caller-stop_/u)
    await runtime.stopForRoot('raw-root-legacy')
    persisted = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(persisted.batches[0].slots[0].state, 'cancelled')
    assert.equal(persisted.batches[0].state, 'stopped')
  } finally {
    await runtime.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('request lookup and fair pump use rebuilt incremental indexes instead of scanning batch history', async () => {
  const source = await readFile(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-session-launch.js'), 'utf8')
  const start = source.slice(source.indexOf('  async prepareStart('), source.indexOf('  async prepareAdoptions('))
  const pump = source.slice(source.indexOf('  async #pump()'), source.indexOf('  async #run('))
  assert.match(source, /this\.batchByRef = new Map\(\)[\s\S]*this\.batchByProjectRequest = new Map\(\)[\s\S]*this\.batchRefsByCallerRoot = new Map\(\)[\s\S]*this\.queuedByProject = new Map\(\)/u)
  assert.match(source, /#rebuildIndexes\(\)[\s\S]*for \(const batch of this\.document\.batches\) this\.#indexBatch\(batch\)/u)
  assert.match(start, /this\.batchByProjectRequest\.get/u)
  assert.doesNotMatch(start, /this\.document\.batches\.(?:find|filter|flatMap)|for \(const batch of this\.document\.batches\)/u)
  assert.match(pump, /this\.#takeQueued\(projectRef\)/u)
  assert.doesNotMatch(pump, /this\.document\.batches|\.find\(\(candidate\)/u)
})
