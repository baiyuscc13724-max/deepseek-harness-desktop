const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'official-core-ports.js')).href
const canonicalProjectKey = 'a'.repeat(64)

async function subject() { return import(moduleUrl) }
function adapters(overrides = {}) {
  return {
    projectIdentity: {
      open: async () => {
        const execution = Object.freeze(Object.create(null))
        const context = Object.create(null)
        Object.defineProperties(context, {
          projectRef: { value: 'project_local', enumerable: false },
          databasePath: { value: 'D:\\private\\tasks.sqlite', enumerable: false },
          execution: { value: execution, enumerable: false },
          actorResolver: { value: candidate => { if (candidate !== execution) throw new Error('stale') }, enumerable: false },
          keyProvider: { value: () => Buffer.alloc(32, 7), enumerable: false },
          dispose: { value: () => true, enumerable: false },
        })
        return Object.freeze(context)
      },
      webEntry: () => ({ localProjectCollaborationContext() {} }),
    },
    task: { bind: input => ({ kind: 'task', input }) },
    collaboration: { bind: input => ({ kind: 'collaboration', input }) },
    projection: { createWebRuntime: input => ({ kind: 'projection', input }) },
    recovery: {
      continueRoot: input => input.operation(),
      recoverMember: input => input.operation(),
      reconcileMember: input => input.operation(),
    },
    ...overrides,
  }
}

async function customProvider(overrides = {}) {
  const { createCustomOfficialCoreProvider } = await subject()
  return createCustomOfficialCoreProvider(adapters(overrides))
}

test('pins alpha.2 only as source evidence and keeps custom as the sole primary', async () => {
  const { OFFICIAL_CORE_BASELINE, createOfficialCorePorts } = await subject()
  assert.deepEqual(OFFICIAL_CORE_BASELINE, {
    tag: 'dsh-v0.1.2-alpha.2',
    commit: '0a53fb55bea101816fa226bb964ae2bed71c343b',
    license: 'MIT',
    runtimeEquivalent: false,
  })
  const ports = createOfficialCorePorts({ providers: [await customProvider()] })
  assert.equal(ports.provider.kind, 'custom')
  assert.equal(ports.provider.role, 'primary')
  assert.equal(ports.provider.schemaVersion, 12)
  assert.equal(ports.provider.storageMode, 'sqlite-wal')
})

test('fails closed for undeclared, accessor-backed, incomplete, official, and multiple primary providers', async () => {
  const { createOfficialCorePorts, createCustomOfficialCoreProvider } = await subject()
  assert.throws(() => createOfficialCorePorts({ providers: [] }), { code: 'OFFICIAL_CORE_PRIMARY_REQUIRED' })
  assert.throws(() => createOfficialCorePorts({ providers: [{}] }), { code: 'OFFICIAL_CORE_PROVIDER_UNDECLARED' })
  let getterRan = false
  const malicious = {}
  Object.defineProperty(malicious, 'kind', { enumerable: true, get() { getterRan = true; return 'custom' } })
  assert.throws(() => createOfficialCorePorts({ providers: [malicious] }), { code: 'OFFICIAL_CORE_PROVIDER_DESCRIPTOR_INVALID' })
  assert.equal(getterRan, false)
  assert.throws(() => createCustomOfficialCoreProvider({ ...adapters(), task: {} }), { code: 'OFFICIAL_CORE_PROVIDER_INCOMPLETE' })
  assert.throws(() => createOfficialCorePorts({ providers: [{
    id: 'official-alpha2', kind: 'official', role: 'primary', schemaVersion: 12, storageMode: 'sqlite-wal',
    baseline: { tag: 'dsh-v0.1.2-alpha.2', commit: '0a53fb55bea101816fa226bb964ae2bed71c343b', license: 'MIT', runtimeEquivalent: true },
    capabilities: { projectIdentity: true, task: true, collaboration: true, projection: true, recovery: true },
    adapters: adapters(),
  }] }), { code: 'OFFICIAL_CORE_OFFICIAL_RUNTIME_UNVERIFIED' })
  const firstPrimary = await customProvider()
  const secondPrimary = await customProvider()
  assert.throws(() => createOfficialCorePorts({ providers: [firstPrimary, secondPrimary] }), { code: 'OFFICIAL_CORE_MULTIPLE_PRIMARY' })
})

test('opens a non-serializable Host capability and routes every production port through the primary', async () => {
  const { createOfficialCorePorts } = await subject()
  const ports = createOfficialCorePorts({ providers: [await customProvider()] })
  const context = await ports.projectIdentity.open({ canonicalProjectKey })
  assert.equal(JSON.stringify(context), '{}')
  assert.equal(JSON.stringify(context.execution), '{}')
  assert.equal(Object.keys(context).length, 0)
  assert.equal(Object.getPrototypeOf(context.execution), null)
  assert.equal(Object.isFrozen(context.execution), true)
  assert.deepEqual(Reflect.ownKeys(context.execution), [])
  assert.equal(ports.task.bind({ store: {}, actorResolver() {} }).kind, 'task')
  assert.equal(ports.collaboration.bind({ store: {}, actorResolver() {} }).kind, 'collaboration')
  assert.equal(ports.projection.createWebRuntime({ projectEntry: {} }).kind, 'projection')
})

test('rejects raw public identity/path inputs and keeps recovery confirm-first and separate from task writes', async () => {
  const { createOfficialCorePorts } = await subject()
  const ports = createOfficialCorePorts({ providers: [await customProvider()] })
  for (const payload of [
    { actorRef: 'actor_raw' }, { projectRef: 'project_raw' }, { sessionId: 'session_raw' },
    { canonicalProjectKey }, { projectKey: canonicalProjectKey }, { cwd: 'D:\\secret' }, { rootCwd: 'D:\\secret' },
    { rootPath: 'D:\\secret' }, { nested: { filePath: 'D:\\secret' } }, { execution: {} },
  ]) assert.throws(() => ports.assertPublicInput(payload), { code: 'OFFICIAL_CORE_RAW_INPUT_FORBIDDEN' })
  assert.doesNotThrow(() => ports.assertPublicInput({ requestId: 'request_1', expectedRevision: 3, payload: { title: 'safe' } }))
  let taskCalls = 0
  let recoveryCalls = 0
  const task = ports.task.bind({ store: {}, actorResolver() { taskCalls += 1 } })
  assert.equal(task.kind, 'task')
  assert.equal(taskCalls, 0)
  assert.throws(() => ports.recovery.continueRoot({ confirm: false, expectedRevision: 1, operation: async () => true }), { code: 'OFFICIAL_CORE_RECOVERY_CONFIRMATION_REQUIRED' })
  assert.throws(() => ports.recovery.recoverMember({ confirm: true, expectedRevision: 1, outcome: 'outcome_unknown', operation: async () => { recoveryCalls += 1 } }), { code: 'OFFICIAL_CORE_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION' })
  assert.equal(recoveryCalls, 0)
  assert.equal(await ports.recovery.continueRoot({ confirm: true, expectedRevision: 1, operation: async () => { recoveryCalls += 1; return 'root-ok' } }), 'root-ok')
  assert.throws(() => ports.recovery.reconcileMember({ confirm: true, expectedRevision: 2, autoRetryUnknown: true, resolution: 'delivered', operation: async () => { recoveryCalls += 1 } }), { code: 'OFFICIAL_CORE_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION' })
  assert.throws(() => ports.recovery.reconcileMember({ confirm: true, expectedRevision: 2, operation: async () => { recoveryCalls += 1 } }), { code: 'OFFICIAL_CORE_RECOVERY_RESOLUTION_REQUIRED' })
  assert.equal(recoveryCalls, 1)
  assert.equal(await ports.recovery.reconcileMember({ confirm: true, expectedRevision: 2, resolution: 'delivered', operation: async () => { recoveryCalls += 1; return 'member-ok' } }), 'member-ok')
  assert.equal(recoveryCalls, 2)
})

test('recovery controls reject inherited, accessor, and non-enumerable fields without getters or operations', async () => {
  const { createOfficialCorePorts } = await subject()
  const ports = createOfficialCorePorts({ providers: [await customProvider()] })
  for (const [name, invoke] of [
    ['continueRoot', input => ports.recovery.continueRoot(input)],
    ['recoverMember', input => ports.recovery.recoverMember(input)],
    ['reconcileMember', input => ports.recovery.reconcileMember(input)],
  ]) {
    let getters = 0
    let operations = 0
    const inherited = Object.create({
      get confirm() { getters += 1; return true },
      get expectedRevision() { getters += 1; return 1 },
      get operation() { getters += 1; return () => { operations += 1 } },
      get autoRetryUnknown() { getters += 1; return false },
      get resolution() { getters += 1; return 'delivered' },
    })
    assert.throws(() => invoke(inherited), { code: 'OFFICIAL_CORE_RECOVERY_INPUT_INVALID' }, name)
    const accessor = {}
    for (const key of ['confirm', 'expectedRevision', 'operation', 'autoRetryUnknown', 'resolution']) Object.defineProperty(accessor, key, { enumerable: true, get() { getters += 1; return key === 'operation' ? () => { operations += 1 } : key === 'confirm' ? true : key === 'expectedRevision' ? 1 : key === 'resolution' ? 'delivered' : false } })
    assert.throws(() => invoke(accessor), { code: 'OFFICIAL_CORE_RECOVERY_INPUT_INVALID' }, name)
    const hidden = { expectedRevision: 1, operation: () => { operations += 1 }, ...(name === 'reconcileMember' ? { resolution: 'delivered' } : {}) }
    Object.defineProperty(hidden, 'confirm', { value: true, enumerable: false })
    assert.throws(() => invoke(hidden), { code: 'OFFICIAL_CORE_RECOVERY_INPUT_INVALID' }, name)
    assert.equal(getters, 0, name)
    assert.equal(operations, 0, name)
  }
})

test('rejects bare dual-write declarations and unknown mutation auto-retry', async () => {
  const { createOfficialCorePorts, createCustomOfficialCoreProvider } = await subject()
  assert.throws(() => createCustomOfficialCoreProvider({ ...adapters(), writeMode: 'dual-write' }), { code: 'OFFICIAL_CORE_BARE_DUAL_WRITE_FORBIDDEN' })
  const ports = createOfficialCorePorts({ providers: [await customProvider()] })
  assert.throws(() => ports.recovery.continueRoot({ confirm: true, expectedRevision: 1, autoRetryUnknown: true, operation: async () => true }), { code: 'OFFICIAL_CORE_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION' })
})

test('rejects leaky or accessor-backed provider contexts without invoking getters and disposes exactly once', async () => {
  const { createOfficialCorePorts, createCustomOfficialCoreProvider } = await subject()
  async function rejectContext(context, code) {
    const provider = createCustomOfficialCoreProvider(adapters({ projectIdentity: { open: async () => context, webEntry: () => ({}) } }))
    const ports = createOfficialCorePorts({ providers: [provider] })
    await assert.rejects(ports.projectIdentity.open({ canonicalProjectKey }), { code })
  }

  let leakedDisposed = 0
  const leaked = Object.create(null)
  Object.defineProperties(leaked, {
    projectRef: { value: 'project_local' }, databasePath: { value: 'D:\\private\\tasks.sqlite' },
    execution: { value: { secret: 'LEAK' } }, actorResolver: { value: () => ({}) },
    keyProvider: { value: () => Buffer.alloc(32) }, dispose: { value: () => { leakedDisposed += 1 } },
  })
  await rejectContext(leaked, 'OFFICIAL_CORE_EXECUTION_SERIALIZABLE')
  assert.equal(leakedDisposed, 1)

  let inheritedGetterCalls = 0
  let inheritedDisposed = 0
  const inherited = Object.create({ get execution() { inheritedGetterCalls += 1; return Object.freeze(Object.create(null)) } })
  Object.defineProperties(inherited, {
    projectRef: { value: 'project_local' }, databasePath: { value: 'D:\\private\\tasks.sqlite' },
    actorResolver: { value: () => ({}) }, keyProvider: { value: () => Buffer.alloc(32) },
    dispose: { value: () => { inheritedDisposed += 1 } },
  })
  await rejectContext(inherited, 'OFFICIAL_CORE_PROJECT_CONTEXT_INVALID')
  assert.equal(inheritedGetterCalls, 0)
  assert.equal(inheritedDisposed, 1)

  let ownGetterCalls = 0
  let ownDisposed = 0
  const getterContext = Object.create(null)
  Object.defineProperties(getterContext, {
    projectRef: { value: 'project_local' }, databasePath: { value: 'D:\\private\\tasks.sqlite' },
    execution: { value: Object.freeze(Object.create(null)) }, actorResolver: { value: () => ({}) },
    keyProvider: { get() { ownGetterCalls += 1; return () => Buffer.alloc(32) } },
    dispose: { value: () => { ownDisposed += 1 } },
  })
  await rejectContext(getterContext, 'OFFICIAL_CORE_PROJECT_CONTEXT_INVALID')
  assert.equal(ownGetterCalls, 0)
  assert.equal(ownDisposed, 1)
})

test('public input contract requires plain lossless JSON without accessors, cycles, or sparse arrays', async () => {
  const { createOfficialCorePorts } = await subject()
  const ports = createOfficialCorePorts({ providers: [await customProvider()] })
  const inherited = Object.create({ safe: true }); inherited.value = 1
  const accessor = {}; let getterCalls = 0; Object.defineProperty(accessor, 'title', { get() { getterCalls += 1; return 'unsafe' } })
  const cyclic = {}; cyclic.self = cyclic
  const sparse = []; sparse.length = 1
  const hidden = {}; Object.defineProperty(hidden, 'title', { value: 'lost', enumerable: false })
  const hiddenIndex = []; Object.defineProperty(hiddenIndex, '0', { value: 'lost', enumerable: false }); hiddenIndex.length = 1
  for (const value of [inherited, accessor, cyclic, sparse, hidden, hiddenIndex, { value: undefined }]) assert.throws(() => ports.assertPublicInput(value), { code: 'OFFICIAL_CORE_RAW_INPUT_FORBIDDEN' })
  assert.equal(getterCalls, 0)
  assert.doesNotThrow(() => ports.assertPublicInput({ requestId: 'request-1', payload: ['safe', { title: 'plain' }] }))
})

test('module-private brand rejects duck-typed fake ports and raw entries are wrapped through the custom provider', async () => {
  const [{ isOfficialCorePorts }, host] = await Promise.all([subject(), import(pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href)])
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'official-core-brand-'))
  const internalExecution = Object.freeze(Object.create(null))
  const projectRef = 'project_official_core_brand_01'
  const key = randomBytes(32)
  let fakePortCalls = 0
  const fake = {
    provider: { kind: 'custom' },
    projectIdentity: { open: async () => { fakePortCalls += 1 } },
    task: { bind: () => { fakePortCalls += 1 } }, collaboration: { bind: () => { fakePortCalls += 1 } },
    projection: { createWebRuntime: () => { fakePortCalls += 1 } }, recovery: { continueRoot: () => { fakePortCalls += 1 } },
    async localProjectTaskContext() {
      const context = Object.create(null)
      Object.defineProperties(context, {
        projectRef: { value: projectRef }, databasePath: { value: path.join(temporary, 'tasks.sqlite') }, execution: { value: internalExecution },
        actorResolver: { value: candidate => { if (candidate !== internalExecution) throw new Error('stale'); return { projectRef, actorRef: 'human_official_core_brand_01', kind: 'human', role: 'owner' } } },
        keyProvider: { value: () => Buffer.from(key) }, dispose: { value: () => undefined },
      })
      return Object.freeze(context)
    },
  }
  try {
    assert.equal(isOfficialCorePorts(fake), false)
    const execution = Object.freeze({ agent: Object.freeze({ id: 'root-brand' }) })
    const result = await host.withProjectCollaborationContext(fake, execution, ({ tasks, collaboration }) => ({ tasks: tasks.constructor.name, collaboration: collaboration.constructor.name }))
    assert.deepEqual(result, { tasks: 'ProjectTaskCommandService', collaboration: 'ProjectCollaborationService' })
    assert.equal(fakePortCalls, 0)
  } finally { key.fill(0); await rm(temporary, { recursive: true, force: true }) }
})

test('Store constructor failure disposes the acquired project context exactly once without database side effects', async () => {
  const host = await import(pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href)
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'official-core-constructor-cleanup-'))
  const executionCapability = Object.freeze(Object.create(null))
  let disposed = 0
  const projectEntry = {
    async localProjectTaskContext() {
      const context = Object.create(null)
      Object.defineProperties(context, {
        projectRef: { value: 'project_constructor_cleanup_01' }, databasePath: { value: '' }, execution: { value: executionCapability },
        actorResolver: { value: () => ({}) }, keyProvider: { value: () => Buffer.alloc(32) }, dispose: { value: () => { disposed += 1 } },
      })
      return Object.freeze(context)
    },
  }
  try {
    await assert.rejects(host.withProjectCollaborationContext(projectEntry, { agent: { id: 'root-constructor-cleanup' } }, async () => true), /filePath must be a non-empty string/u)
    assert.equal(disposed, 1)
    assert.deepEqual(await readdir(temporary), [])
  } finally { await rm(temporary, { recursive: true, force: true }) }
})

test('registered project tools reject raw Host identity while allowing normalized project-relative evidence paths', async () => {
  const host = await import(`${pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href}?raw-boundary=${Date.now()}`)
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'official-core-tool-boundary-'))
  const internalExecution = Object.freeze(Object.create(null))
  const projectRef = 'project_official_core_tool_01'
  const key = randomBytes(32)
  const projectEntry = {
    async localProjectTaskContext() {
      const context = Object.create(null)
      Object.defineProperties(context, {
        projectRef: { value: projectRef }, databasePath: { value: path.join(temporary, 'tasks.sqlite') }, execution: { value: internalExecution },
        actorResolver: { value: candidate => { if (candidate !== internalExecution) throw new Error('stale'); return { projectRef, actorRef: 'human_official_core_tool_01', kind: 'human', role: 'owner' } } },
        keyProvider: { value: () => Buffer.from(key) }, dispose: { value: () => undefined },
      })
      return Object.freeze(context)
    },
  }
  const root = { id: 'root-tool-boundary', status: 'running', session: { header: { cwd: temporary }, events: [{ type: 'turn/start', id: 'turn-1', time: 1 }] } }
  const tools = new Map()
  const ctx = { agents: { roots: () => [root], get: id => id === root.id ? root : undefined, currentInitiator: () => root }, tools: { register: tool => tools.set(tool.name, tool) }, systemPrompt: { section: () => undefined } }
  host.registerProjectCollaborationTools(ctx, projectEntry, {})
  const invoke = (name, args) => tools.get(name).execute(args, { agent: root })
  try {
    const initialized = await invoke('project_collaboration', { action: 'initialize', payload: { title: 'Boundary board' } })
    assert.equal(initialized.ok, true, JSON.stringify(initialized))
    const raw = await invoke('project_collaboration', { action: 'initialize', payload: { canonicalProjectKey } })
    assert.deepEqual(raw, { ok: false, error: { code: 'PROJECT_COLLABORATION_INVALID', retryable: false } })
    const created = await invoke('project_task', { action: 'create', request_id: 'create-boundary', payload: { title: 'Evidence task', requirements: 'verify', fileScope: ['src/official'] } })
    assert.equal(created.ok, true)
    const evidence = await invoke('project_collaboration', { action: 'add_evidence', payload: { evidence_ref: 'evidence_boundary_01', task_ref: created.task.taskRef, path: 'src/official/result.txt', digest: `sha256:${'a'.repeat(64)}`, summary: 'safe project-relative path' } })
    assert.equal(evidence.ok, true)
  } finally { key.fill(0); await rm(temporary, { recursive: true, force: true }) }
})

test('root recovery continuation fails exact OCC before any launch effect when revision changes', async () => {
  const host = await import(pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href)
  let launchCalls = 0
  const collaboration = { getRootRecovery: () => ({ recoveryRef: 'recovery_01', revision: 8, state: 'reserved', mode: 'retry', launchRef: 'slot_01' }) }
  const launch = new Proxy({}, { get: () => async () => { launchCalls += 1; return {} } })
  await assert.rejects(host.continueProjectRootRecovery(launch, {}, {}, 'project_01', collaboration, 'recovery_01', 7), { code: 'PROJECT_ROOT_RECOVERY_CONFLICT' })
  assert.equal(launchCalls, 0)
})

test('failed takeover recovery retries the exact reserved Host slot before reporting ready', async () => {
  const host = await import(pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href)
  let current = { recoveryRef: 'recovery_takeover_failed', revision: 5, state: 'failed', mode: 'takeover', launchRef: 'batch_takeover_failed', replacementSlotActorRef: 'actor_replacement', replacementTaskRef: 'task_replacement' }
  const transitions = [], calls = [], events = []
  const collaboration = {
    getRootRecovery: () => ({ ...current }),
    updateRootRecovery: (_execution, input) => {
      assert.equal(input.recoveryRef, current.recoveryRef)
      assert.equal(input.expectedRevision, current.revision)
      current = { ...current, state: input.state, revision: current.revision + 1 }
      transitions.push(input.state)
      events.push(['transition', input.state])
      return { recovery: { ...current } }
    },
    snapshot: () => ({ recovery: { ...current } })
  }
  const launch = {
    recoveryReservation: async (_execution, input) => {
      calls.push(['reservation', input.batchRef])
      events.push(['reservation', input.batchRef])
      return { batchRef: input.batchRef, slotRef: 'slot_takeover_failed', operationRef: 'operation_takeover_failed', slotState: 'failed' }
    },
    retryFailedSlot: async (_execution, input) => {
      calls.push(['retry', input.slotRef])
      events.push(['retry', input.slotRef])
      return { state: 'ready', slots: [{ slotRef: input.slotRef, state: 'ready' }] }
    },
    status: async () => { throw new Error('failed takeover must not use observer-only status as its retry action') }
  }
  const result = await host.continueProjectRootRecovery(launch, {}, { canonicalProjectKey: 'project-key' }, 'project_01', collaboration, current.recoveryRef, current.revision)
  assert.deepEqual(calls, [['reservation', 'batch_takeover_failed'], ['retry', 'slot_takeover_failed']])
  assert.deepEqual(transitions, ['activated', 'ready'])
  assert.deepEqual(events, [['reservation', 'batch_takeover_failed'], ['transition', 'activated'], ['retry', 'slot_takeover_failed'], ['transition', 'ready']], 'the durable activated CAS fences the retry effect')
  assert.equal(result.recovery.state, 'ready')
})

test('failed recovery persists activated before an uncertain retry and never retries the unknown effect again', async () => {
  const host = await import(pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href)
  let current = { recoveryRef: 'recovery_retry_unknown', revision: 3, state: 'failed', mode: 'retry', launchRef: 'slot_retry_unknown' }
  const events = []
  const collaboration = {
    getRootRecovery: () => ({ ...current }),
    updateRootRecovery: (_execution, input) => {
      assert.equal(input.expectedRevision, current.revision)
      current = { ...current, state: input.state, revision: current.revision + 1 }
      events.push(['transition', input.state])
      return { recovery: { ...current } }
    },
    snapshot: () => ({ recovery: { ...current } })
  }
  const launch = {
    retryFailedSlot: async (_execution, input) => { events.push(['retry', input.slotRef]); return { slots: [{ slotRef: input.slotRef, state: 'outcome_unknown' }] } },
    slotStatus: async (_execution, input) => { events.push(['observe', input.slotRef]); return { slots: [{ slotRef: input.slotRef, state: 'outcome_unknown' }] } }
  }
  await host.continueProjectRootRecovery(launch, {}, {}, 'project_01', collaboration, current.recoveryRef, current.revision)
  assert.deepEqual(events, [['transition', 'activated'], ['retry', 'slot_retry_unknown'], ['observe', 'slot_retry_unknown'], ['transition', 'outcome_unknown']])
  assert.equal(current.state, 'outcome_unknown')
  events.length = 0
  await host.continueProjectRootRecovery(launch, {}, {}, 'project_01', collaboration, current.recoveryRef, current.revision)
  assert.deepEqual(events, [['observe', 'slot_retry_unknown']], 'unknown recovery is observer-only until exact Host evidence changes it')
  assert.equal(current.state, 'outcome_unknown')
})

test('a failed recovery CAS conflict prevents every Host retry effect', async () => {
  const host = await import(pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href)
  const current = { recoveryRef: 'recovery_retry_race', revision: 9, state: 'failed', mode: 'retry', launchRef: 'slot_retry_race' }
  let effects = 0
  const conflict = Object.assign(new Error('lost CAS'), { code: 'PROJECT_ROOT_RECOVERY_CONFLICT' })
  await assert.rejects(host.continueProjectRootRecovery({ retryFailedSlot: async () => { effects += 1 } }, {}, {}, 'project_01', {
    getRootRecovery: () => ({ ...current }), updateRootRecovery: () => { throw conflict }, snapshot: () => ({})
  }, current.recoveryRef, current.revision), error => error === conflict)
  assert.equal(effects, 0)
})

test('a reserved retry recovery CAS conflict prevents every Host retry effect', async () => {
  const host = await import(pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href)
  const current = { recoveryRef: 'recovery_reserved_race', revision: 2, state: 'reserved', mode: 'retry', launchRef: 'slot_reserved_race' }
  let effects = 0
  const conflict = Object.assign(new Error('lost reserved CAS'), { code: 'PROJECT_ROOT_RECOVERY_CONFLICT' })
  await assert.rejects(host.continueProjectRootRecovery({ retryFailedSlot: async () => { effects += 1 } }, {}, {}, 'project_01', {
    getRootRecovery: () => ({ ...current }), updateRootRecovery: () => { throw conflict }, snapshot: () => ({})
  }, current.recoveryRef, current.revision), error => error === conflict)
  assert.equal(effects, 0)
})

test('production Host registration consumes all official-compatible ports instead of declaring an unused interface', async () => {
  const source = await readFile(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js'), 'utf8')
  assert.match(source, /createOfficialCorePorts\(\{ providers: \[createCustomOfficialCoreProvider\(/u)
  assert.match(source, /officialCorePorts\.projectIdentity\.open\(/u)
  assert.match(source, /officialCorePorts\.task\.bind\(/u)
  assert.match(source, /officialCorePorts\.collaboration\.bind\(/u)
  assert.match(source, /officialCorePorts\.projection\.createWebRuntime\(/u)
  assert.match(source, /officialCorePorts\.recovery\.continueRoot\(/u)
  assert.match(source, /officialCorePorts\.recovery\.recoverMember\(/u)
  assert.match(source, /officialCorePorts\.recovery\.reconcileMember\(/u)
  assert.match(source, /if \(isOfficialCorePorts\(projectEntry\)\) return projectEntry/u)
  assert.doesNotMatch(source, /projectEntry\?\.provider\?\.kind === ["']custom["']/u)
  assert.match(source, /current=collaboration\.getRootRecovery[\s\S]*expectedRevision: current\.revision[\s\S]*continueProjectRootRecovery\([^\n]+current\.revision\)/u)
  assert.doesNotMatch(source, /kind:\s*["']official["']\s*,\s*role:\s*["']primary["']/u)
})
