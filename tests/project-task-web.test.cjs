const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const webUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-web.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')).href
const projectRef = `project_${'W'.repeat(24)}`

function coded(code, message = code) {
  const error = new Error(message)
  error.code = code
  return error
}
function taskContext({ databasePath, key, validity = () => true, actorResolver, dispose } = {}) {
  const execution = Object.freeze(Object.create(null))
  const actor = Object.freeze({ projectRef, actorRef: `actor_${'O'.repeat(24)}`, kind: 'human', role: 'owner' })
  const assertCurrent = () => { if (!validity()) throw coded('PROJECT_ENTRY_TASK_CONTEXT_INVALID') }
  const context = { projectRef, databasePath }
  Object.defineProperties(context, {
    execution: { value: execution, enumerable: false },
    keyProvider: { value: ref => { assert.equal(ref, projectRef); assertCurrent(); return Buffer.from(key) }, enumerable: false },
    actorResolver: { value: actorResolver || ((candidate, ref) => { assert.equal(candidate, execution); assert.equal(ref, projectRef); assertCurrent(); return actor }), enumerable: false },
    ...(dispose === undefined ? {} : { dispose: { value: dispose, enumerable: false } }),
  })
  return Object.freeze(context)
}
async function fixture(options = {}) {
  const mod = await import(webUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-web-'))
  const databasePath = path.join(root, 'tasks.sqlite')
  const key = randomBytes(32)
  const context = options.context || taskContext({ databasePath, key, dispose: options.dispose })
  const projectEntry = options.projectEntry || {
    localProjectTaskContext: async () => context,
    status: async () => ({ project: { role: 'owner' } }),
  }
  const runtime = new mod.ProjectTaskWebRuntime({
    projectEntry,
    legacySummaryProvider: options.legacySummaryProvider,
    now: (() => { let clock = 1_900_000_000_000; return () => ++clock })(),
  })
  return { mod, root, databasePath, key, context, projectEntry, runtime }
}
async function usingFixture(run, options) {
  const state = await fixture(options)
  try { await run(state) } finally { await state.runtime.close(); await rm(state.root, { recursive: true, force: true }) }
}
function createCommand(suffix = 'A', overrides = {}) {
  return {
    commandId: `command_create_${suffix}`,
    type: 'create',
    expectedRevision: 0,
    payload: { title: `Task ${suffix}` },
    ...overrides,
  }
}

// The browser contract rejects identity and project routing data at every depth.
test('normalizer injects deterministic refs and rejects forged identity, event, project, assign, depth, and oversized bodies', async () => {
  const mod = await import(webUrl)
  const first = mod.normalizeWebCommand(createCommand('deterministic'))
  const second = mod.normalizeWebCommand(createCommand('deterministic'))
  assert.equal(first.taskRef, second.taskRef)
  assert.equal(first.eventRef, second.eventRef)
  assert.match(first.taskRef, /^task_web_/u)
  assert.match(first.eventRef, /^event_web_/u)
  for (const forged of [
    { projectRef }, { eventRef: 'event_forged' }, { sessionId: 'session_forged' }, { actorRef: 'actor_forged' }, { role: 'owner' }, { authority: 'owner' },
  ]) assert.throws(() => mod.normalizeWebCommand({ ...createCommand('forged'), ...forged }), error => error.code === 'PROJECT_TASK_WEB_INVALID_REQUEST')
  for (const key of ['project_ref', 'event-ref', 'session_id', 'actor_ref', 'role', 'authorities']) {
    assert.throws(() => mod.normalizeWebCommand(createCommand(`nested-${key}`, { payload: { title: 'x', nested: { [key]: 'forged' } } })), error => error.code === 'PROJECT_TASK_WEB_INVALID_REQUEST')
  }
  assert.throws(() => mod.normalizeWebCommand({ commandId: 'command_assign', type: 'assign', taskRef: 'task_x', expectedRevision: 1, payload: {} }), error => error.code === 'PROJECT_TASK_WEB_ACTION_UNAVAILABLE')
  assert.throws(() => mod.normalizeWebCommand(createCommand('browser-task-ref', { taskRef: 'task_browser_chosen' })), /assigned by the Host/u)
  let nested = { value: true }
  for (let index = 0; index < 18; index += 1) nested = { nested }
  assert.throws(() => mod.normalizeWebCommand(createCommand('deep', { payload: { title: 'x', nested } })), /depth/u)
  assert.throws(() => mod.normalizeWebCommand(createCommand('large', { payload: { title: 'x'.repeat(70 * 1024) } })), error => error.code === 'PROJECT_TASK_WEB_BODY_TOO_LARGE')
  assert.throws(() => mod.normalizeWebCommand({ ...createCommand('revision'), expectedRevision: 1 }), /expectedRevision/u)
})

test('normalizer accepts only plain lossless JSON without invoking accessors', async () => {
  const mod = await import(webUrl)
  const rejects = []
  rejects.push(createCommand('negative-zero', { payload: { title: 'x', value: -0 } }))
  rejects.push(createCommand('date', { payload: { title: 'x', value: new Date(0) } }))
  const inherited = Object.create({ inherited: true }); inherited.title = 'x'
  rejects.push(createCommand('prototype', { payload: inherited }))
  const symbol = { title: 'x' }; symbol[Symbol('secret')] = true
  rejects.push(createCommand('symbol', { payload: symbol }))
  const hidden = { title: 'x' }; Object.defineProperty(hidden, 'secret', { value: true, enumerable: false })
  rejects.push(createCommand('hidden', { payload: hidden }))
  const accessor = { title: 'x' }; let getterCalls = 0; Object.defineProperty(accessor, 'secret', { enumerable: true, get() { getterCalls += 1; return true } })
  rejects.push(createCommand('accessor', { payload: accessor }))
  rejects.push(createCommand('undefined', { payload: { title: 'x', value: undefined } }))
  rejects.push(createCommand('function', { payload: { title: 'x', value() {} } }))
  rejects.push(createCommand('sparse', { payload: { title: 'x', values: new Array(2) } }))
  const customArray = [1]; customArray.extra = 2
  rejects.push(createCommand('custom-array', { payload: { title: 'x', values: customArray } }))
  const cyclic = { title: 'x' }; cyclic.self = cyclic
  rejects.push(createCommand('cycle', { payload: cyclic }))
  for (const command of rejects) assert.throws(() => mod.normalizeWebCommand(command), error => error.code === 'PROJECT_TASK_WEB_INVALID_REQUEST')
  assert.equal(getterCalls, 0)
  const nullPrototype = Object.create(null); nullPrototype.title = 'accepted plain record'
  assert.equal(mod.normalizeWebCommand(createCommand('null-prototype', { payload: nullPrototype })).payload.title, 'accepted plain record')
  let inheritedHookRuns = 0
  Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { inheritedHookRuns += 1; throw new Error('must not execute') } })
  try { assert.equal(mod.normalizeWebCommand(createCommand('inherited-hook')).payload.title, 'Task inherited-hook'); assert.equal(inheritedHookRuns, 0) } finally { delete Object.prototype.toJSON }
})

test('state and action expose only safe task fields while legacy tasks remain a separate aggregate', async () => usingFixture(async ({ runtime }) => {
  const writes = { legacy: 0 }
  runtime.legacySummaryProvider = async () => ({ detected: true, mutate: () => { writes.legacy += 1 } })
  const created = await runtime.action(createCommand('safe', {
    payload: { title: 'Visible title', requirements: { acceptance: 'secret acceptance' }, fileScope: ['private/source/file.js'] },
  }))
  assert.equal(created.ok, true)
  assert.equal(created.receipt.duplicate, false)
  assert.equal(created.task.title, 'Visible title')
  assert.deepEqual(created.task.allowedTransitions, ['backlog', 'in_progress', 'canceled'])
  const snapshot = await runtime.state()
  assert.deepEqual({
    available: snapshot.capability.available,
    writable: snapshot.capability.writable,
    canCreate: snapshot.capability.canCreate,
    kind: snapshot.capability.kind,
  }, { available: true, writable: true, canCreate: true, kind: 'authority' })
  assert.deepEqual(snapshot.capability.legacyTeamTasks, { detected: true, mode: 'separate', importAvailable: false })
  assert.equal(snapshot.tasks.length, 1)
  assert.equal(writes.legacy, 0)
  const encoded = JSON.stringify({ created, snapshot })
  for (const secret of [projectRef, 'secret acceptance', 'private/source/file.js', `actor_${'O'.repeat(24)}`, '"requirements":', '"fileScope":', 'ownerActorRef', 'assigneeActorRef']) assert.equal(encoded.includes(secret), false, secret)
  assert.deepEqual(Object.keys(snapshot.tasks[0]).sort(), ['allowedTransitions', 'createdAt', 'hasAssignee', 'hasFileScope', 'requirementsRevision', 'revision', 'status', 'taskRef', 'title', 'updatedAt'].sort())
}))

test('state returns at most 500 tasks and reports the 501st through hasMore', async () => {
  const [mod, storeMod] = await Promise.all([import(webUrl), import(storeUrl)])
  assert.equal(mod.MAX_WEB_TASKS, 500)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-web-page-'))
  const databasePath = path.join(root, 'tasks.sqlite')
  const key = randomBytes(32)
  const store = new storeMod.ProjectTaskStore({ filePath: databasePath, keyProvider: ref => ref === projectRef ? key : undefined })
  store.initialize()
  try {
    for (let index = 0; index < 501; index += 1) store.createTask({
      projectRef,
      commandId: `command_seed_${index}`,
      eventRef: `event_seed_${index}`,
      expectedRevision: 0,
      actorRef: `actor_${'O'.repeat(24)}`,
      createdAt: 2_000_000_000_000 + index,
      task: { taskRef: `task_seed_${index}`, status: 'todo', ownerActorRef: `actor_${'O'.repeat(24)}`, title: `Seed ${index}`, requirements: {}, fileScope: [] },
      eventPayload: {},
    })
  } finally { store.close() }
  const context = taskContext({ databasePath, key })
  const runtime = new mod.ProjectTaskWebRuntime({ projectEntry: { localProjectTaskContext: async () => context } })
  try {
    const snapshot = await runtime.state()
    assert.equal(snapshot.tasks.length, 500)
    assert.equal(snapshot.hasMore, true)
    assert.equal(snapshot.projectRevision, 501)
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }) }
})

test('comment bodies and raw event identity or payload never enter action, subscription, or delta projections', async () => usingFixture(async ({ runtime }) => {
  const updates = []
  const unsubscribe = runtime.subscribe(update => updates.push(update))
  const created = await runtime.action(createCommand('comment'))
  const body = 'private comment body that must never be projected'
  const commented = await runtime.action({
    commandId: 'command_comment_safe', type: 'comment', taskRef: created.task.taskRef, expectedRevision: 1,
    payload: { commentRef: 'comment_safe', kind: 'discussion', body },
  })
  unsubscribe()
  assert.equal(commented.task.revision, 2)
  const delta = await runtime.events({ afterRevision: 0, limit: 10 })
  assert.equal(delta.events.length, 2)
  assert.equal(delta.reset, false)
  const encoded = JSON.stringify({ commented, delta, updates })
  for (const secret of [body, projectRef, `actor_${'O'.repeat(24)}`, 'actorRef', 'payload']) assert.equal(encoded.includes(secret), false, secret)
  assert.equal(JSON.stringify({ delta, updates }).includes('commandId'), false)
  assert.deepEqual(Object.keys(delta.events[0]).sort(), ['createdAt', 'eventRef', 'projectRevision', 'taskRef', 'type'].sort())
}))

test('same command replays exactly once, changed reuse conflicts, and stale OCC returns safe next action', async () => usingFixture(async ({ mod, runtime }) => {
  const command = createCommand('idempotent')
  const first = await runtime.action(command)
  const replay = await runtime.action(command)
  assert.equal(replay.receipt.duplicate, true)
  assert.equal(replay.receipt.projectRevision, first.receipt.projectRevision)
  await assert.rejects(runtime.action({ ...command, payload: { title: 'changed intent' } }), error => {
    const mapped = mod.projectTaskWebError(error)
    assert.equal(mapped.status, 409)
    assert.equal(mapped.body.error.code, 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
    assert.equal(mapped.body.error.nextAction, 'start_new_action')
    return true
  })
  await assert.rejects(runtime.action({
    commandId: 'command_stale_occ', type: 'transition', taskRef: first.task.taskRef, expectedRevision: 9, payload: { to: 'backlog' },
  }), error => {
    const mapped = mod.projectTaskWebError(error)
    assert.deepEqual(mapped.body.error.safeDetails, { currentRevision: 1 })
    assert.equal(mapped.body.error.nextAction, 'refresh_and_retry')
    assert.equal(JSON.stringify(mapped).includes(projectRef), false)
    return true
  })
}))

test('context invalidation rebinds and replays one stable command and event identity', async () => {
  const mod = await import(webUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-web-rebind-'))
  const databasePath = path.join(root, 'tasks.sqlite')
  const key = randomBytes(32)
  let contexts = 0
  let firstActorCalls = 0
  const first = taskContext({
    databasePath, key,
    actorResolver: (candidate, ref) => {
      firstActorCalls += 1
      if (firstActorCalls >= 2) throw coded('PROJECT_ENTRY_TASK_CONTEXT_INVALID')
      assert.equal(ref, projectRef)
      return { projectRef, actorRef: `actor_${'O'.repeat(24)}`, kind: 'human', role: 'owner' }
    },
  })
  const second = taskContext({ databasePath, key })
  const runtime = new mod.ProjectTaskWebRuntime({
    projectEntry: { localProjectTaskContext: async () => (++contexts === 1 ? first : second) },
  })
  try {
    const result = await runtime.action(createCommand('rebind'))
    assert.equal(result.receipt.duplicate, false)
    assert.equal(result.receipt.eventRef, mod.normalizeWebCommand(createCommand('rebind')).eventRef)
    assert.equal(contexts, 2)
    assert.equal((await runtime.state()).projectRevision, 1)
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }) }
})

test('binding initialization disposes an acquired context exactly once when actor validation fails', async () => {
  const mod = await import(webUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-web-invalid-bind-'))
  const databasePath = path.join(root, 'tasks.sqlite')
  const key = randomBytes(32)
  let disposals = 0
  const context = taskContext({
    databasePath,
    key,
    actorResolver: () => { throw coded('PROJECT_ENTRY_TASK_CONTEXT_INVALID') },
    dispose: () => { disposals += 1 },
  })
  const runtime = new mod.ProjectTaskWebRuntime({ projectEntry: { localProjectTaskContext: async () => context } })
  try {
    await assert.rejects(runtime.state(), error => error.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
    assert.equal(disposals, 1)
  } finally {
    await runtime.close()
    assert.equal(disposals, 1)
    await rm(root, { recursive: true, force: true })
  }
})

test('no-project and collaborator capability projections omit tasks and revisions honestly', async () => {
  const mod = await import(webUrl)
  const noProject = new mod.ProjectTaskWebRuntime({
    projectEntry: { localProjectTaskContext: async () => { throw coded('PROJECT_ENTRY_NOT_CREATED') } },
  })
  const collaborator = new mod.ProjectTaskWebRuntime({
    projectEntry: {
      localProjectTaskContext: async () => { throw coded('PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN') },
      status: async () => ({ project: { role: 'contributor', projectRef } }),
    },
  })
  try {
    const none = await noProject.state()
    assert.deepEqual(none.capability, {
      available: false, writable: false, canCreate: false, kind: 'no-project', mode: 'none', reason: 'no_project', nextAction: 'create_or_join_project',
      legacyTeamTasks: { detected: false, mode: 'separate', importAvailable: false },
    })
    assert.equal(Object.hasOwn(none, 'tasks'), false)
    assert.equal(Object.hasOwn(none, 'projectRevision'), false)
    const remote = await collaborator.state()
    assert.equal(remote.capability.kind, 'collaborator')
    assert.equal(remote.capability.mode, 'collaborator')
    assert.equal(remote.capability.available, false)
    assert.equal(remote.capability.canCreate, false)
    assert.equal(remote.capability.nextAction, 'open_authority_desktop')
    assert.equal(JSON.stringify(remote).includes(projectRef), false)
  } finally { await noProject.close(); await collaborator.close() }
})

test('bounded deltas expose hasMore and reset without leaking raw event fields', async () => usingFixture(async ({ runtime }) => {
  await runtime.action(createCommand('delta-1'))
  await runtime.action(createCommand('delta-2'))
  await runtime.action(createCommand('delta-3'))
  const first = await runtime.events({ afterRevision: 0, limit: 2 })
  assert.equal(first.events.length, 2)
  assert.equal(first.hasMore, true)
  assert.equal(first.nextAfterRevision, 2)
  const second = await runtime.events({ afterRevision: first.nextAfterRevision, limit: 2 })
  assert.equal(second.events.length, 1)
  assert.equal(second.hasMore, false)
  const reset = await runtime.events({ afterRevision: 99, limit: 2 })
  assert.deepEqual(reset.events, [])
  assert.equal(reset.reset, true)
  assert.equal(reset.nextAfterRevision, 3)
  await assert.rejects(runtime.events({ afterRevision: 0, limit: 101 }), /limit/u)
  await assert.rejects(runtime.events({ afterRevision: 0, projectRef }), error => error.code === 'PROJECT_TASK_WEB_INVALID_REQUEST')
  await assert.rejects(runtime.events({ afterRevision: 0, sessionId: 'session_forged' }), error => error.code === 'PROJECT_TASK_WEB_INVALID_REQUEST')
}))

test('error projection is fixed, bounded, and excludes stack, paths, and actor data', async () => {
  const mod = await import(webUrl)
  const error = coded('PROJECT_TASK_DEPENDENCY_BLOCKED')
  error.blockedBy = Array.from({ length: 60 }, (_, index) => `task_${index}`)
  error.stack = 'C:\\private\\source\\secret.js actor_secret'
  const mapped = mod.projectTaskWebError(error)
  assert.equal(mapped.status, 409)
  assert.equal(mapped.body.error.nextAction, 'resolve_dependencies')
  assert.equal(mapped.body.error.safeDetails.blockedBy.length, 50)
  assert.equal(JSON.stringify(mapped).includes('private'), false)
  assert.equal(JSON.stringify(mapped).includes('actor_secret'), false)
})

test('close is idempotent, waits for queued work, rejects new work, stops subscriptions, and swallows context disposal errors', async () => {
  let disposals = 0
  const state = await fixture({ dispose: () => { disposals += 1; throw new Error('cleanup-only failure') } })
  const updates = []
  state.runtime.subscribe(update => updates.push(update))
  const pending = state.runtime.action(createCommand('close'))
  const firstClose = state.runtime.close()
  assert.equal(state.runtime.close(), firstClose)
  await assert.rejects(state.runtime.state(), error => error.code === 'PROJECT_TASK_WEB_CLOSED')
  assert.equal((await pending).ok, true)
  await firstClose
  assert.throws(() => state.runtime.subscribe(() => {}), error => error.code === 'PROJECT_TASK_WEB_CLOSED')
  assert.equal(updates.length, 1)
  assert.equal(disposals, 1)
  await rm(state.root, { recursive: true, force: true })
})
