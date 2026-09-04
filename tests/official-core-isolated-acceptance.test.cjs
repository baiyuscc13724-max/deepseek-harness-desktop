const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, readdir, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const lib = name => pathToFileURL(path.join(root, 'plugins', 'dsh-agent-teams', 'lib', name)).href
const canonicalProjectKey = 'a'.repeat(64)
const projectA = `project_${'A'.repeat(24)}`
const projectB = `project_${'B'.repeat(24)}`

async function portsModule() { return import(lib('official-core-ports.js')) }
function adapters(overrides = {}) {
  return {
    projectIdentity: {
      open: async () => {
        const execution = Object.freeze(Object.create(null))
        const context = Object.create(null)
        Object.defineProperties(context, {
          projectRef: { value: projectA },
          databasePath: { value: 'D:\\isolated\\tasks.sqlite' },
          execution: { value: execution },
          actorResolver: { value: candidate => candidate === execution ? { projectRef: projectA, actorRef: 'human_owner', kind: 'human', role: 'owner' } : undefined },
          keyProvider: { value: () => Buffer.alloc(32, 3) },
          dispose: { value: () => undefined },
        })
        return Object.freeze(context)
      },
      webEntry: () => ({ localProjectTaskContext() {} }),
    },
    task: { bind: value => value },
    collaboration: { bind: value => value },
    projection: { createWebRuntime: value => value },
    recovery: {
      continueRoot: input => input.operation(),
      recoverMember: input => input.operation(),
      reconcileMember: input => input.operation(),
    },
    ...overrides,
  }
}
async function realPorts(overrides = {}) {
  const { createCustomOfficialCoreProvider, createOfficialCorePorts } = await portsModule()
  return createOfficialCorePorts({ providers: [createCustomOfficialCoreProvider(adapters(overrides))] })
}
function fakeProvider(overrides = {}) {
  return {
    id: 'malicious-provider', kind: 'custom', role: 'primary', schemaVersion: 12, storageMode: 'sqlite-wal',
    baseline: { tag: 'dsh-v0.1.2-alpha.5', commit: 'db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5', license: 'MIT', runtimeEquivalent: false },
    capabilities: { projectIdentity: true, task: true, collaboration: true, projection: true, recovery: true },
    adapters: adapters(),
    ...overrides,
  }
}

function assertCode(operation, code) { assert.throws(operation, error => error?.code === code, code) }

async function rejectContext(context, code) {
  const { createCustomOfficialCoreProvider, createOfficialCorePorts } = await portsModule()
  const provider = createCustomOfficialCoreProvider(adapters({ projectIdentity: { open: async () => context, webEntry: () => ({}) } }))
  await assert.rejects(createOfficialCorePorts({ providers: [provider] }).projectIdentity.open({ canonicalProjectKey }), error => error?.code === code)
}

test('malicious provider doubles cannot displace the sole branded custom primary', async () => {
  const { createOfficialCorePorts, createCustomOfficialCoreProvider, isOfficialCorePorts } = await portsModule()
  assertCode(() => createOfficialCorePorts({ providers: [fakeProvider({ kind: 'unknown' })] }), 'OFFICIAL_CORE_PROVIDER_UNDECLARED')
  assertCode(() => createOfficialCorePorts({ providers: [fakeProvider({ kind: 'official', role: 'shadow' })] }), 'OFFICIAL_CORE_OFFICIAL_RUNTIME_UNVERIFIED')
  assertCode(() => createOfficialCorePorts({ providers: [fakeProvider({ role: 'shadow' })] }), 'OFFICIAL_CORE_PRIMARY_REQUIRED')
  const custom = createCustomOfficialCoreProvider(adapters())
  assertCode(() => createOfficialCorePorts({ providers: [custom, custom] }), 'OFFICIAL_CORE_MULTIPLE_PRIMARY')
  assert.equal(isOfficialCorePorts({ provider: { kind: 'custom', role: 'primary' }, projectIdentity: {}, task: {}, collaboration: {}, projection: {}, recovery: {} }), false)

  let getters = 0
  for (const field of ['id', 'role', 'schemaVersion', 'storageMode', 'baseline', 'capabilities', 'adapters']) {
    const malicious = fakeProvider()
    Object.defineProperty(malicious, field, { enumerable: true, get() { getters += 1; return field } })
    assertCode(() => createOfficialCorePorts({ providers: [malicious] }), 'OFFICIAL_CORE_PROVIDER_DESCRIPTOR_INVALID')
  }
  assert.equal(getters, 0)
})

test('leaky execution and accessor contexts fail closed with exactly-once cleanup', async () => {
  let disposed = 0
  const leaky = Object.create(null)
  const execution = Object.create(null)
  Object.defineProperty(execution, 'secret', { value: 'must-not-serialize', enumerable: false })
  Object.freeze(execution)
  Object.defineProperties(leaky, {
    projectRef: { value: projectA }, databasePath: { value: 'D:\\isolated\\tasks.sqlite' }, execution: { value: execution },
    actorResolver: { value: () => ({}) }, keyProvider: { value: () => Buffer.alloc(32) }, dispose: { value: () => { disposed += 1 } },
  })
  await rejectContext(leaky, 'OFFICIAL_CORE_EXECUTION_SERIALIZABLE')
  assert.equal(disposed, 1)

  let getterCalls = 0
  const accessor = Object.create(null)
  Object.defineProperties(accessor, {
    projectRef: { value: projectA }, databasePath: { value: 'D:\\isolated\\tasks.sqlite' }, execution: { value: Object.freeze(Object.create(null)) },
    actorResolver: { get() { getterCalls += 1; return () => ({}) } }, keyProvider: { value: () => Buffer.alloc(32) }, dispose: { value: () => { disposed += 1 } },
  })
  await rejectContext(accessor, 'OFFICIAL_CORE_PROJECT_CONTEXT_INVALID')
  assert.equal(getterCalls, 0)
  assert.equal(disposed, 2)
})

test('Host context constructor failure leaves no database side effect and disposes once', async () => {
  const host = await import(lib('index.js'))
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'official-core-isolated-constructor-'))
  const capability = Object.freeze(Object.create(null))
  let disposed = 0
  const projectEntry = {
    async localProjectTaskContext() {
      const context = Object.create(null)
      Object.defineProperties(context, {
        projectRef: { value: projectA }, databasePath: { value: '' }, execution: { value: capability },
        actorResolver: { value: () => ({}) }, keyProvider: { value: () => Buffer.alloc(32) }, dispose: { value: () => { disposed += 1 } },
      })
      return Object.freeze(context)
    },
  }
  try {
    await assert.rejects(host.withProjectCollaborationContext(projectEntry, { agent: { id: 'isolated-root' } }, async () => true), /filePath must be a non-empty string/u)
    assert.equal(disposed, 1)
    assert.deepEqual(await readdir(temporary), [])
  } finally { await rm(temporary, { recursive: true, force: true }) }
})

test('recovery getters, hidden controls, auto-retry, and revision races never launch effects', async () => {
  const ports = await realPorts()
  for (const name of ['continueRoot', 'recoverMember', 'reconcileMember']) {
    let getters = 0
    let operations = 0
    const inherited = Object.create({ get confirm() { getters += 1; return true } })
    assertCode(() => ports.recovery[name](inherited), 'OFFICIAL_CORE_RECOVERY_INPUT_INVALID')
    const accessor = {}
    Object.defineProperty(accessor, 'confirm', { enumerable: true, get() { getters += 1; return true } })
    assertCode(() => ports.recovery[name](accessor), 'OFFICIAL_CORE_RECOVERY_INPUT_INVALID')
    const hidden = { expectedRevision: 1, operation: () => { operations += 1 }, ...(name === 'reconcileMember' ? { resolution: 'observed-not-committed' } : {}) }
    Object.defineProperty(hidden, 'confirm', { value: true, enumerable: false })
    assertCode(() => ports.recovery[name](hidden), 'OFFICIAL_CORE_RECOVERY_INPUT_INVALID')
    const retry = { confirm: true, expectedRevision: 1, autoRetryUnknown: true, operation: () => { operations += 1 }, ...(name === 'reconcileMember' ? { resolution: 'observed-not-committed' } : {}) }
    assertCode(() => ports.recovery[name](retry), 'OFFICIAL_CORE_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION')
    assert.equal(getters, 0)
    assert.equal(operations, 0)
  }

  const host = await import(lib('index.js'))
  let launchCalls = 0
  const collaboration = { getRootRecovery: () => ({ recoveryRef: 'recovery_isolated', revision: 12, state: 'reserved', mode: 'retry', launchRef: 'slot_isolated' }) }
  const launch = new Proxy({}, { get: () => async () => { launchCalls += 1; return {} } })
  await assert.rejects(host.continueProjectRootRecovery(launch, {}, {}, projectA, collaboration, 'recovery_isolated', 11), error => error?.code === 'PROJECT_ROOT_RECOVERY_CONFLICT')
  assert.equal(launchCalls, 0)
})

test('raw Host identity and paths, cross-project actors, and executor self-approval fail closed', async () => {
  const ports = await realPorts()
  for (const payload of [
    { actor: 'raw' }, { actorRef: 'raw' }, { authority: 'owner' }, { role: 'owner' }, { project: 'raw' }, { projectRef: projectA },
    { projectKey: canonicalProjectKey }, { canonicalProjectKey }, { session: 'raw' }, { sessionId: 'raw' }, { userId: 'raw' },
    { path: 'C:\\secret' }, { filePath: 'C:\\secret' }, { cwd: 'C:\\secret' }, { rootPath: 'C:\\secret' }, { workspacePath: 'C:\\secret' },
    { nested: { targetExecution: {} } },
  ]) assertCode(() => ports.assertPublicInput(payload), 'OFFICIAL_CORE_RAW_INPUT_FORBIDDEN')

  const [actor, domain] = await Promise.all([import(lib('project-task-actor.js')), import(lib('project-task-domain.js'))])
  assertCode(() => actor.normalizeResolvedActor({ projectRef: projectB, actorRef: 'agent_other', kind: 'agent', authorities: [] }, projectA), 'PROJECT_TASK_ACTOR_UNRESOLVED')
  const task = { taskRef: 'task_review', status: 'in_review', revision: 4, requirementsRevision: 2, ownerActorRef: 'owner', assigneeActorRef: 'executor' }
  const attempt = { attemptRef: 'attempt_review', taskRef: task.taskRef, executorActorRef: 'executor', acceptedRequirementsRevision: 2, state: 'submitted' }
  assertCode(() => domain.createTaskReview(task, attempt, { actorRef: 'executor', kind: 'agent', authorities: ['project_lead'] }, { reviewRef: 'review_self', verdict: 'approved' }), 'PROJECT_TASK_SELF_APPROVAL')
})

test('AEAD task cursors reject cross-project and tampering', async () => {
  const web = await import(lib('project-task-web.js'))
  const key = randomBytes(32)
  try {
    const boundary = { statusRank: 1, priority: 5, updatedAt: 9, createdAt: 8, taskRef: 'task_cursor' }
    const cursor = web.encodeTaskPageCursor(projectA, 7, boundary, key)
    assert.deepEqual(web.decodeTaskPageCursor(projectA, cursor, key), { projectRevision: 7, ...boundary })
    assertCode(() => web.decodeTaskPageCursor(projectB, cursor, key), 'PROJECT_TASK_WEB_CURSOR_INVALID')
    const tampered = `${cursor.slice(0, -2)}${cursor.endsWith('AA') ? 'BB' : 'AA'}`
    assertCode(() => web.decodeTaskPageCursor(projectA, tampered, key), 'PROJECT_TASK_WEB_CURSOR_INVALID')
  } finally { key.fill(0) }
})
