const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const webUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-web.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')).href
const projectRef = `project_${'W'.repeat(24)}`

function coded(code, message = code) {
  const error = new Error(message)
  error.code = code
  return error
}
function taskContext({ databasePath, key, project = projectRef, validity = () => true, actorResolver, dispose } = {}) {
  const execution = Object.freeze(Object.create(null))
  const actor = Object.freeze({ projectRef: project, actorRef: `actor_${'O'.repeat(24)}`, kind: 'human', role: 'owner' })
  const assertCurrent = () => { if (!validity()) throw coded('PROJECT_ENTRY_TASK_CONTEXT_INVALID') }
  const context = { projectRef: project, databasePath }
  Object.defineProperties(context, {
    execution: { value: execution, enumerable: false },
    keyProvider: { value: ref => { assert.equal(ref, project); assertCurrent(); return Buffer.from(key) }, enumerable: false },
    actorResolver: { value: actorResolver || ((candidate, ref) => { assert.equal(candidate, execution); assert.equal(ref, project); assertCurrent(); return actor }), enumerable: false },
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
    wakeScheduler: options.wakeScheduler,
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

test('successful Web task mutations schedule one Host wake pump while durable replay does not', async () => {
  const scheduled = []
  await usingFixture(async ({ runtime }) => {
    const input = createCommand('wake-scheduler')
    assert.equal((await runtime.action(input)).ok, true)
    assert.deepEqual(scheduled, [{ projectRef }])
    await runtime.action(input)
    assert.deepEqual(scheduled, [{ projectRef }])
  }, { wakeScheduler: (signal) => scheduled.push(signal) })
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
  assert.deepEqual(Object.keys(snapshot.tasks[0]).sort(), ['allowedTransitions', 'blockedByCount', 'createdAt', 'hasAssignee', 'hasFileScope', 'requirementsRevision', 'revision', 'status', 'statusGroup', 'taskRef', 'title', 'updatedAt'].sort())
  assert.equal(snapshot.tasks[0].blockedByCount, 0)
  assert.deepEqual(snapshot.groupTotals, { in_progress: 0, in_review: 0, blocked: 0, pending: 1, completed: 0, canceled: 0 })
}))

test('authority pagination traverses 601 identical timestamps with exact totals, byte bounds, AEAD isolation, and stale rejection', async () => {
  const [mod, storeMod] = await Promise.all([import(webUrl), import(storeUrl)])
  assert.equal(mod.MAX_WEB_TASKS, 120)
  assert.equal(mod.MAX_WEB_TASK_PAGE_BYTES, 128 * 1024)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-web-page-'))
  const databasePath = path.join(root, 'tasks.sqlite')
  const key = randomBytes(32)
  const cursorKey = Buffer.alloc(32, 3)
  const store = new storeMod.ProjectTaskStore({ filePath: databasePath, keyProvider: ref => ref === projectRef ? key : undefined })
  store.initialize()
  try {
    for (let index = 0; index < 601; index += 1) {
      const suffix = String(index).padStart(4, '0')
      store.createTask({
        projectRef,
        commandId: `command_seed_${suffix}`,
        eventRef: `event_seed_${suffix}`,
        expectedRevision: 0,
        actorRef: `actor_${'O'.repeat(24)}`,
        createdAt: 2_000_000_000_000,
        task: { taskRef: `task_seed_${suffix}`, status: 'todo', ownerActorRef: `actor_${'O'.repeat(24)}`, title: `${'Seed '.repeat(40)}${suffix}`, requirements: {}, fileScope: [] },
        eventPayload: {},
      })
    }
  } finally { store.close() }
  const context = taskContext({ databasePath, key })
  const runtime = new mod.ProjectTaskWebRuntime({ projectEntry: { localProjectTaskContext: async () => context }, randomBytesImpl: () => cursorKey })
  try {
    let snapshot = await runtime.state()
    const firstCursor = snapshot.page.nextCursor
    const seen = []
    let pages = 0
    while (true) {
      pages += 1
      assert.equal(snapshot.totalExact, true)
      assert.equal(snapshot.totalTasks, 601)
      assert.equal(snapshot.projectRevision, 601)
      assert.ok(snapshot.page.includedTasks <= 120)
      assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 128 * 1024)
      assert.equal(JSON.stringify(snapshot).includes(projectRef), false)
      seen.push(...snapshot.tasks.map((task) => task.taskRef))
      if (!snapshot.page.hasMore) break
      snapshot = await runtime.page(snapshot.page.nextCursor)
    }
    assert.equal(pages, 6)
    assert.equal(seen.length, 601)
    assert.equal(new Set(seen).size, 601)
    assert.deepEqual(seen, Array.from({ length: 601 }, (_, index) => `task_seed_${String(index).padStart(4, '0')}`))

    const tamperIndex = firstCursor.indexOf('.') + 8
    const tampered = `${firstCursor.slice(0, tamperIndex)}${firstCursor[tamperIndex] === 'A' ? 'B' : 'A'}${firstCursor.slice(tamperIndex + 1)}`
    await assert.rejects(runtime.page(tampered), (error) => error.code === 'PROJECT_TASK_WEB_CURSOR_INVALID')
    const otherProjectRef = `project_${'X'.repeat(24)}`
    const other = new mod.ProjectTaskWebRuntime({ projectEntry: { localProjectTaskContext: async () => taskContext({ databasePath, key: randomBytes(32), project: otherProjectRef }) }, randomBytesImpl: () => cursorKey })
    try { await assert.rejects(other.page(firstCursor), (error) => error.code === 'PROJECT_TASK_WEB_CURSOR_INVALID') } finally { await other.close() }

    await runtime.action(createCommand('stale-after-page'))
    await assert.rejects(runtime.page(firstCursor), (error) => error.code === 'PROJECT_TASK_WEB_CURSOR_STALE' && error.currentRevision === 602)
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }) }
})

test('authority pages keep reverse-seeded status groups, explicit priority, Unicode, and stable ties globally ordered', async () => {
  const [mod, storeMod] = await Promise.all([import(webUrl), import(storeUrl)])
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-web-ranked-')), databasePath = path.join(root, 'tasks.sqlite'), key = randomBytes(32), cursorKey = Buffer.alloc(32, 9)
  const store = new storeMod.ProjectTaskStore({ filePath: databasePath, keyProvider: ref => ref === projectRef ? key : undefined })
  store.initialize()
  const seedGroups = [['canceled', 5], ['done', 4], ['todo', 3], ['blocked', 2], ['in_review', 1], ['in_progress', 0]], expected = []
  try {
    for (const [status, rank] of seedGroups) for (let index = 0; index < 22; index += 1) {
      const taskRef = `task_web_rank_${rank}_${String(index).padStart(3, '0')}`, priority = index % 3, createdAt = 50_000 + (index % 5)
      store.createTask({ projectRef, commandId: `command_web_rank_${rank}_${index}`, eventRef: `event_web_rank_${rank}_${index}`, expectedRevision: 0, actorRef: `actor_${'O'.repeat(24)}`, createdAt, task: { taskRef, status, priority, ownerActorRef: `actor_${'O'.repeat(24)}`, title: `${'跨页界'.repeat(50)} ${status} ${index}`, requirements: {}, fileScope: [] }, eventPayload: {} })
      expected.push({ taskRef, rank, priority, createdAt })
    }
  } finally { store.close() }
  expected.sort((left, right) => left.rank - right.rank || right.priority - left.priority || right.createdAt - left.createdAt || left.taskRef.localeCompare(right.taskRef))
  const runtime = new mod.ProjectTaskWebRuntime({ projectEntry: { localProjectTaskContext: async () => taskContext({ databasePath, key }) }, randomBytesImpl: () => cursorKey })
  try {
    let page = await runtime.state(), firstCursor = page.page.nextCursor, seen = []
    assert.deepEqual(page.groupTotals, { in_progress: 22, in_review: 22, blocked: 22, pending: 22, completed: 22, canceled: 22 })
    assert.match(firstCursor, /^ptw4\./u)
    do {
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= mod.MAX_WEB_TASK_PAGE_BYTES)
      seen.push(...page.tasks.map(task => task.taskRef))
      assert.equal(page.tasks.every(task => task.statusGroup && (task.priority === undefined || Number.isSafeInteger(task.priority))), true)
      page = page.page.hasMore ? await runtime.page(page.page.nextCursor) : null
    } while (page)
    assert.deepEqual(seen, expected.map(item => item.taskRef))
    assert.equal(new Set(seen).size, 132)
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

test('collaboration projection is current-project-only, opaque, exactly counted, AEAD-sealed, stale-aware, bounded, and debounced', async () => {
  const mod = await import(webUrl)
  const { ProjectTaskStore } = await import(storeUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-collaboration-web-'))
  const databasePath = path.join(root, 'tasks.sqlite')
  const key = randomBytes(32)
  const cursorKey = Buffer.alloc(32, 7)
  const context = taskContext({ databasePath, key })
  const runtime = new mod.ProjectTaskWebRuntime({ projectEntry: { localProjectTaskContext: async () => context }, randomBytesImpl: () => cursorKey })
  const rawActor = `actor_${'S'.repeat(24)}`
  const rawPath = 'private/source/credential.txt'
  const rawNextStep = 'Read the full secret body and token'
  const rawSummary = 'sensitive evidence body'
  let writer
  try {
    const created = await runtime.action(createCommand('collaboration', { payload: { title: '联'.repeat(240) } }))
    const unicode = await runtime.action(createCommand('unicode', { payload: { title: '任'.repeat(240) } }))
    writer = new ProjectTaskStore({ filePath: databasePath, keyProvider: ref => { assert.equal(ref, projectRef); return Buffer.from(key) } })
    writer.initialize()
    const expectedTaskRefs = [created.task.taskRef, unicode.task.taskRef]
    for (let index = 0; index < 129; index += 1) {
      const suffix = String(index).padStart(3, '0'), taskRef = `task_combined_${suffix}`
      writer.createTask({ projectRef, commandId: `command_combined_${suffix}`, eventRef: `event_combined_${suffix}`, expectedRevision: 0, actorRef: rawActor, createdAt: 2_100_000_000_000, task: { taskRef, status: 'todo', ownerActorRef: rawActor, title: `${'合'.repeat(237)}${suffix}`, requirements: {}, fileScope: [] }, eventPayload: {} })
      expectedTaskRefs.push(taskRef)
    }
    writer.createCollaborationBoard({ projectRef, coordinatorActorRef: rawActor, title: 'Private board title', createdAt: 10 })
    writer.upsertCollaborationSeat({ projectRef, actorRef: rawActor, changedByActorRef: rawActor, duty: '接口', resourceScope: [rawPath], phase: 'running', nextStep: rawNextStep, updatedAt: 11 })
    writer.acquireCollaborationLock({ projectRef, resourceRef: rawPath, ownerActorRef: rawActor, taskRef: created.task.taskRef, updatedAt: 12 })
    writer.addCollaborationEvidence({ projectRef, evidenceRef: 'evidence_private', taskRef: created.task.taskRef, actorRef: rawActor, path: rawPath, digest: `sha256:${'a'.repeat(64)}`, summary: rawSummary, createdAt: 13 })
    writer.prepareRootRecovery({projectRef,recoveryRef:'recovery_private',requestId:'recovery_private_request',mode:'retry',failedActorRef:rawActor,requesterActorRef:rawActor,failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'private Host diagnostic and raw session identity',createdAt:14})
    writer.prepareCollaborationHandoff({ projectRef, handoffRef: `handoff_${'交'.repeat(248)}`, taskRef: created.task.taskRef, sourceActorRef: rawActor, targetActorRef: `actor_${'T'.repeat(24)}`, summary: '移'.repeat(2000), updatedAt: 15 })
    for (let index = 0; index < 125; index += 1) writer.upsertCollaborationSeat({
      projectRef, actorRef: `actor_page_${index}`, changedByActorRef: rawActor, duty: index === 124 ? '席'.repeat(160) : `Duty ${index}`, resourceScope: [index === 124 ? `最大/${'界'.repeat(2044)}0` : `src/${index}.js`], phase: 'running', nextStep: index === 124 ? '步'.repeat(2000) : `Private body ${index}`, updatedAt: 20 + index,
    })
    const insertRequest = writer.database.prepare(`INSERT INTO project_collaboration_requests(project_ref,request_ref,request_id,identity_digest,request_digest,kind,task_ref,dependency_task_ref,requester_actor_ref,target_actor_ref,state,revision,respond_by_at,reason_cipher,resolution_cipher,created_at,updated_at) VALUES(?,?,?,?,?,'handoff',?,NULL,?,?,'accepted',2,?,?,?,?,?)`)
    for (let index = 0; index < 30; index += 1) {
      const requestRef = `request_large_${String(index).padStart(3, '0')}`, reason = `reason-${index}-` + '界'.repeat(3900), resolution = `resolution-${index}-` + '测'.repeat(3900)
      insertRequest.run(projectRef, requestRef, `request_id_${index}`, `sha256:${String(index).padStart(64, '0')}`, `sha256:${String(index + 100).padStart(64, '0')}`, created.task.taskRef, rawActor, `actor_target_${index}`, 9999, writer.cipher.seal(projectRef, `collaboration/request/${requestRef}/reason`, reason), writer.cipher.seal(projectRef, `collaboration/request/${requestRef}/resolution`, resolution), index, index)
    }
    for (let index = 0; index < 10; index += 1) writer.acquireCollaborationLock({
      projectRef, resourceRef: `最大/${'界'.repeat(2044)}${index}`, ownerActorRef: rawActor, taskRef: created.task.taskRef, updatedAt: 100 + index,
    })

    const state = await runtime.state()
    const first = state.projectCollaboration
    assert.equal(first.mode, 'current-project')
    assert.equal(first.totalExact, true)
    assert.equal(first.totals.seats, 126)
    assert.equal(first.totals.tasks, 131)
    assert.deepEqual(first.taskGroupTotals, { in_progress: 0, in_review: 0, blocked: 0, pending: 131, completed: 0, canceled: 0 })
    assert.equal(first.totals.locks, 11)
    assert.equal(first.totals.handoffs, 1)
    assert.equal(first.totals.recoveries, 1)
    assert.equal(first.totals.evidence, 1)
    assert.equal(first.page.includedItems > 0 && first.page.includedItems <= mod.MAX_WEB_COLLABORATION_ITEMS, true)
    assert.equal(first.page.hasMore, true)
    assert.equal(first.sectionPages.seats.hasMore, true)
    assert.equal(first.sectionPages.tasks.hasMore, true)
    assert.equal(first.totals.requests, 30)
    assert.equal(first.sectionPages.requests.includedItems < 8, true, 'initial page adaptively trims maximum-Unicode request projections')
    assert.equal(first.sectionPages.requests.hasMore, true)
    for (const section of ['seats', 'tasks', 'locks', 'handoffs', 'recoveries', 'evidence', 'history', 'requests']) {
      assert.equal(first.totals[section] === 0 ? first.sectionPages[section].includedItems === 0 : first.sectionPages[section].includedItems >= 1, true, `${section} initial page preserves one row whenever its exact total is nonzero`)
    }
    assert.equal(first.sections.seats.some(seat => seat.duty === '席'.repeat(160)), true, 'maximum legal Unicode seat label is represented in the initial one-per-section budget proof')
    assert.equal(first.sections.tasks.some(task => [...task.title].length === 240), true, 'a maximum-Unicode task title survives the safe initial projection')
    const lockCursor = first.sectionPages.locks.nextCursor
    assert.equal(lockCursor.length > 2_048 && lockCursor.length <= mod.WEB_PAGE_CURSOR_MAX_CHARS, true, 'maximum-Unicode resource boundary uses the independent cursor budget')
    const lockPage = await runtime.collaborationPage(lockCursor)
    assert.equal(lockPage.page.section, 'locks')
    assert.equal(lockPage.sections.locks.length > 0, true, 'server can parse and continue its own long cursor')
    const lockRefs = [...first.sections.locks, ...lockPage.sections.locks].map(lock => lock.lockRef)
    assert.equal(lockRefs.length, 11)
    assert.equal(new Set(lockRefs).size, 11, 'long lock cursor continuation neither skips nor duplicates rows')
    const requestPage = await runtime.collaborationPage(first.sectionPages.requests.nextCursor)
    assert.equal(requestPage.page.section, 'requests')
    assert.equal(requestPage.page.includedItems < mod.MAX_WEB_COLLABORATION_SECTION_ITEMS, true, 'UTF-8 byte budget trims the fetched row window')
    assert.equal(requestPage.page.hasMore, true)
    assert.equal(Buffer.byteLength(JSON.stringify(requestPage)) <= mod.MAX_WEB_COLLABORATION_PAGE_BYTES, true)
    const requestRefs = [...first.sections.requests, ...requestPage.sections.requests].map(request => request.requestRef)
    let requestCursor = requestPage.sectionPages.requests.nextCursor
    while (requestCursor) {
      const next = await runtime.collaborationPage(requestCursor)
      requestRefs.push(...next.sections.requests.map(request => request.requestRef))
      requestCursor = next.sectionPages.requests.nextCursor
    }
    assert.equal(requestRefs.length, 30, 'initial trimming resumes after the last actually emitted request')
    assert.equal(new Set(requestRefs).size, 30, 'adaptive initial and continuation pages neither skip nor duplicate requests')
    assert.equal(Buffer.byteLength(JSON.stringify(first), 'utf8') <= mod.MAX_WEB_COLLABORATION_PAGE_BYTES, true)
    assert.equal(Buffer.byteLength(JSON.stringify(state), 'utf8') <= mod.MAX_WEB_TASK_PAGE_BYTES, true, 'combined state response remains within the strict UTF-8 budget')
    const authorityRefs = state.tasks.map(task => task.taskRef)
    let authorityCursor = state.page.nextCursor
    while (authorityCursor) {
      const next = await runtime.page(authorityCursor)
      assert.equal(Buffer.byteLength(JSON.stringify(next), 'utf8') <= mod.MAX_WEB_TASK_PAGE_BYTES, true)
      authorityRefs.push(...next.tasks.map(task => task.taskRef))
      authorityCursor = next.page.nextCursor
    }
    assert.equal(authorityRefs.length, 131, 'combined trimming resumes authority after the last emitted task')
    assert.equal(new Set(authorityRefs).size, 131, 'combined authority pages are exact and unique')
    assert.deepEqual(new Set(authorityRefs), new Set(expectedTaskRefs))
    const collaborationTaskRefs = first.sections.tasks.map(task => task.taskRef)
    let collaborationTaskCursor = first.sectionPages.tasks.nextCursor
    while (collaborationTaskCursor) {
      const next = await runtime.collaborationPage(collaborationTaskCursor)
      assert.equal(Buffer.byteLength(JSON.stringify(next), 'utf8') <= mod.MAX_WEB_COLLABORATION_PAGE_BYTES, true)
      collaborationTaskRefs.push(...next.sections.tasks.map(task => task.taskRef))
      collaborationTaskCursor = next.sectionPages.tasks.nextCursor
    }
    assert.equal(collaborationTaskRefs.length, 131, 'combined trimming resumes collaboration tasks after the last emitted task')
    assert.equal(new Set(collaborationTaskRefs).size, 131, 'combined collaboration task pages are exact and unique')
    assert.deepEqual(new Set(collaborationTaskRefs), new Set(expectedTaskRefs))
    const standaloneCollaboration = await runtime.collaborationPage()
    assert.equal(Buffer.byteLength(JSON.stringify(standaloneCollaboration), 'utf8') <= mod.MAX_WEB_COLLABORATION_PAGE_BYTES, true, 'standalone collaboration budget remains independent')
    const encoded = JSON.stringify(first)
    for (const secret of [projectRef, rawActor, rawPath, rawNextStep, rawSummary, `sha256:${'a'.repeat(64)}`, 'Private board title']) assert.equal(encoded.includes(secret), false, secret)
    assert.match(first.sections.seats[0].actorRef, /^actor_/u)
    assert.match(first.sections.seats[0].slotRef, /^slot_/u)

    const cursor = first.sectionPages.seats.nextCursor
    const rawSeatBoundary = `actor_page_${125 - first.sectionPages.seats.includedItems}`
    assert.equal(cursor.includes(rawSeatBoundary), false)
    assert.equal(Buffer.from(cursor.split('.')[1], 'base64url').toString('utf8').includes(rawSeatBoundary), false, 'AEAD ciphertext never exposes the actual raw keyset boundary')
    const restarted = new mod.ProjectTaskWebRuntime({ projectEntry: { localProjectTaskContext: async () => taskContext({ databasePath, key }) } })
    try { await assert.rejects(restarted.collaborationPage(cursor), error => error.code === 'PROJECT_TASK_WEB_CURSOR_INVALID') }
    finally { await restarted.close() }
    let second = await runtime.collaborationPage(cursor)
    assert.equal(second.totalExact, true)
    assert.equal(second.totals.seats, 126)
    assert.equal(second.page.section, 'seats')
    assert.equal(second.page.includedItems > 0, true)
    assert.deepEqual(second.sections.tasks, [], 'loading seats never overwrites another section')
    while (!second.sections.seats.some(seat => seat.duty === '接口') && second.sectionPages.seats.nextCursor) second = await runtime.collaborationPage(second.sectionPages.seats.nextCursor)
    assert.equal(second.sections.seats.some(seat => seat.duty === '接口'), true)
    const recoveryPage=first
    assert.equal(recoveryPage.sections.recoveries.length,1)
    assert.deepEqual(Object.keys(recoveryPage.sections.recoveries[0]).sort(),['canRequestTakeover','canRetry','failedSeatMine','failureCode','mine','mode','recoveryRef','requiresConfirmation','revision','state','updatedAt'].sort())
    assert.equal(recoveryPage.sections.recoveries[0].canRetry,false,'another browser authority cannot retry the failed root'); assert.equal(recoveryPage.sections.recoveries[0].requiresConfirmation,true)
    assert.equal(JSON.stringify(recoveryPage).includes('private Host diagnostic'),false)
    const tamperIndex = cursor.indexOf('.') + 8
    const tampered = `${cursor.slice(0, tamperIndex)}${cursor[tamperIndex] === 'A' ? 'B' : 'A'}${cursor.slice(tamperIndex + 1)}`
    await assert.rejects(runtime.collaborationPage(tampered), error => error.code === 'PROJECT_TASK_WEB_CURSOR_INVALID')

    const otherRoot = await mkdtemp(path.join(os.tmpdir(), 'project-collaboration-other-'))
    const otherProject = `project_${'Z'.repeat(24)}`
    const otherContext = taskContext({ databasePath: path.join(otherRoot, 'tasks.sqlite'), key: randomBytes(32), project: otherProject })
    const other = new mod.ProjectTaskWebRuntime({ projectEntry: { localProjectTaskContext: async () => otherContext }, randomBytesImpl: () => cursorKey })
    try { await assert.rejects(other.collaborationPage(cursor), error => error.code === 'PROJECT_TASK_WEB_CURSOR_INVALID') }
    finally { await other.close(); await rm(otherRoot, { recursive: true, force: true }) }

    const updates = []
    runtime.subscribe(update => updates.push(update))
    writer.upsertCollaborationSeat({ projectRef, actorRef: rawActor, changedByActorRef: rawActor, expectedRevision: 2, duty: '接口', resourceScope: [rawPath], phase: 'paused', nextStep: rawNextStep, updatedAt: 200 })
    await assert.rejects(runtime.collaborationPage(cursor), error => error.code === 'PROJECT_TASK_WEB_CURSOR_STALE')
    await runtime.refreshCollaboration()
    writer.upsertCollaborationSeat({ projectRef, actorRef: rawActor, changedByActorRef: rawActor, expectedRevision: 3, duty: '接口', resourceScope: [rawPath], phase: 'running', nextStep: rawNextStep, updatedAt: 201 })
    await runtime.refreshCollaboration()
    await new Promise(resolve => setTimeout(resolve, 70))
    const deltas = updates.filter(update => update.event?.type === 'collaboration.changed')
    assert.equal(deltas.length, 1)
    assert.equal(deltas[0].event.projectRevision, (await runtime.collaborationPage()).revision)
  } finally {
    writer?.close()
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('combined state fails closed when both nonempty surfaces fit alone but their minimum progress cannot fit together', async () => usingFixture(async ({ mod, runtime, databasePath, key }) => {
  const { ProjectTaskStore } = await import(storeUrl)
  const created = await runtime.action(createCommand('minimum-progress'))
  const writer = new ProjectTaskStore({ filePath: databasePath, keyProvider: ref => { assert.equal(ref, projectRef); return Buffer.from(key) } })
  writer.initialize()
  try {
    writer.createCollaborationBoard({ projectRef, coordinatorActorRef: `actor_${'S'.repeat(24)}`, title: 'Minimum progress board', createdAt: 10 })
    const oversizedLegacyTitle = '界'.repeat(21_800)
    const sealed = writer.cipher.seal(projectRef, `tasks/${created.task.taskRef}/title`, oversizedLegacyTitle)
    writer.database.prepare('UPDATE project_tasks SET title_cipher = ? WHERE project_ref = ? AND task_ref = ?').run(sealed, projectRef, created.task.taskRef)
    const standaloneCollaboration = await runtime.collaborationPage()
    assert.equal(standaloneCollaboration.sections.tasks.length, 1)
    assert.equal(Buffer.byteLength(JSON.stringify(standaloneCollaboration), 'utf8') <= mod.MAX_WEB_COLLABORATION_PAGE_BYTES, true)
    await assert.rejects(runtime.state(), error => error.code === 'PROJECT_TASK_WEB_PAGE_TOO_LARGE')
  } finally { writer.close() }
}))

test('collaboration web source has no legacy full-materialization paging path', async () => {
  const source = await readFile(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-web.js'), 'utf8')
  assert.doesNotMatch(source, /legacyCollaboration(?:Snapshot|Page)/u)
  assert.doesNotMatch(source, /while \(requestWindow\.hasMore|while \(Number\.isSafeInteger\(beforeRevision\)|while \(initial\.available/u)
  assert.match(source, /sectionWindow/u)
  assert.match(source, /minimumCounts[\s\S]*snapshot\.totals\[section\] > 0 \? 1 : 0/u)
  assert.doesNotMatch(source, /count === 0 \? \{\}/u)
  assert.match(source, /createCipheriv\("aes-256-gcm"/u)
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
