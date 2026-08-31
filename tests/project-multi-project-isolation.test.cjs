const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash, createHmac, randomBytes } = require('node:crypto')
const { mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { createAgentTeamsSessionLaunchService, projectKeyForWorkspace, CALLER_SALT_ENV } = require('../electron/bridge/agent-teams-session-launch-service.cjs')

const indexUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href
const registryUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-entry-registry.js')).href
const launchUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-session-launch.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')).href
const webUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-web.js')).href
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const canonicalFor = root => { const normalized = root.session.header.cwd.trim().replace(/\\/gu, '/').replace(/\/+$/u, '').normalize('NFKC'); return createHash('sha256').update(JSON.stringify(['agent-teams-project-v1', process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized])).digest('hex') }

function baseProjectEntry(root) {
  const key = Buffer.alloc(32, 37), internal = Object.freeze(Object.create(null)), projectRef = 'project_base_authority_registry_01'
  return {
    key,
    async localProjectTaskContext() {
      let disposed = false
      const context = { projectRef, databasePath: path.join(root, 'storages', 'agent_project_tasks.sqlite') }
      Object.defineProperties(context, {
        execution: { value: internal },
        actorResolver: { value: (candidate, requested) => { if (disposed || candidate !== internal || requested !== projectRef) throw Object.assign(new Error('stale'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_INVALID' }); return { projectRef, actorRef: 'collaborator_base_authority_registry_01', kind: 'human', role: 'owner' } } },
        keyProvider: { value: requested => { if (disposed || requested !== projectRef) throw new Error('stale'); return Buffer.from(key) } },
        dispose: { value: () => { disposed = true } },
      })
      return Object.freeze(context)
    },
  }
}

function rootAgent(index, cwd) {
  return { id: `canonical-root-${index}`, status: 'running', session: { header: { cwd }, events: [{ type: 'turn/start', id: `turn-${index}`, time: index + 1 }, { type: 'user/message', data: { source: { kind: 'user' } } }] } }
}

test('registered project tools isolate 16 canonical roots with identical model ids and independent slow/fast SQLite lanes', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'canonical-project-tools-'))
  const base = baseProjectEntry(temporary)
  const [{ ProjectEntryRegistry }, mod, { ProjectTaskWebRuntime }] = await Promise.all([import(`${registryUrl}?lanes=${Date.now()}`), import(`${indexUrl}?lanes=${Date.now()}`), import(webUrl)])
  const registry = new ProjectEntryRegistry({ projectEntry: base, dshHome: temporary })
  const roots = Array.from({ length: 16 }, (_, index) => rootAgent(index, path.join(temporary, `workspace-${index}`)))
  const tools = new Map(); let current = roots[0]
  const ctx = { agents: { roots: () => roots, get: id => roots.find(root => root.id === id), currentInitiator: () => current }, tools: { register: tool => { tools.set(tool.name, tool) } }, systemPrompt: { section: () => {} } }
  mod.registerProjectCollaborationTools(ctx, registry, { redeemAdoption: async () => { throw new Error('unused') } })
  const invoke = (root, name, args) => { current = root; return tools.get(name).execute(args, { agent: root }) }
  let fallbackRuntime, sessionRuntimeResolver
  try {
    const initialized = []
    for (const root of roots) initialized.push(await invoke(root, 'project_collaboration', { action: 'initialize', payload: { title: 'Same title' } }))
    assert.ok(initialized.every(result => result.ok === true), JSON.stringify(initialized))
    const created = []
    for (const root of roots) created.push(await invoke(root, 'project_task', { action: 'create', request_id: 'same-request-id', payload: { title: 'Same task', requirements: { acceptance: 'isolated' }, fileScope: ['src/same.js'] } }))
    assert.ok(created.every(result => result.ok === true))
    const taskRefs = created.map(result => result.task.taskRef)
    assert.equal(new Set(taskRefs).size, 16)

    fallbackRuntime = new ProjectTaskWebRuntime({ projectEntry: base })
    sessionRuntimeResolver = mod.createProjectTaskSessionRuntimeResolver(ctx, registry, fallbackRuntime, async () => false)
    assert.equal((await fallbackRuntime.state()).projectCollaboration.available, false, 'the device-global legacy store must not satisfy a canonical project panel')
    const scopedRuntime = sessionRuntimeResolver(roots[0].id)
    const scopedBeforeGit = await scopedRuntime.state()
    assert.equal(scopedBeforeGit.projectCollaboration.available, true)
    assert.equal(scopedBeforeGit.projectCollaboration.sections.tasks.some(task => task.taskRef === taskRefs[0]), true)
    const keyBeforeGit = canonicalFor(roots[0])
    await mkdir(path.join(roots[0].session.header.cwd, '.git'), { recursive: true })
    assert.equal(canonicalFor(roots[0]), keyBeforeGit, 'creating .git must not change the canonical workspace lane')
    assert.equal(sessionRuntimeResolver(roots[0].id), scopedRuntime)
    assert.equal((await sessionRuntimeResolver(roots[0].id).state()).projectCollaboration.available, true)

    const original = registry.localProjectCollaborationContext.bind(registry)
    const slowKey = canonicalFor(roots[0])
    registry.localProjectCollaborationContext = async options => { if (options.canonicalProjectKey === slowKey) await delay(180); return original(options) }
    const order = []
    const slow = invoke(roots[0], 'project_task', { action: 'list', payload: {} }).then(() => order.push('slow'))
    await delay(10)
    const fast = invoke(roots[1], 'project_task', { action: 'list', payload: {} }).then(() => order.push('fast'))
    await Promise.all([slow, fast])
    assert.deepEqual(order, ['fast', 'slow'])

    const laneDirs = (await readdir(path.join(temporary, 'storages', 'project_lanes'), { withFileTypes: true })).filter(entry => entry.isDirectory())
    assert.equal(laneDirs.length, 16)
    const serializedResults = JSON.stringify([...initialized, ...created])
    for (const root of roots) {
      const canonical = canonicalFor(root)
      assert.equal(serializedResults.includes(canonical), false)
      assert.equal(serializedResults.includes(root.session.header.cwd), false)
    }
  } finally { base.key.fill(0); await sessionRuntimeResolver?.close(); await fallbackRuntime?.close(); await registry.close(); await rm(temporary, { recursive: true, force: true }) }
})

test('legacy WAL snapshot binds only lane A, lane B stays independent, and copying-phase crash resumes atomically', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'canonical-project-legacy-')), storages = path.join(temporary, 'storages')
  await mkdir(storages, { recursive: true })
  const legacyPath = path.join(storages, 'agent_project_tasks.sqlite'), base = baseProjectEntry(temporary)
  const [{ ProjectEntryRegistry }, { ProjectTaskStore }] = await Promise.all([import(`${registryUrl}?legacy=${Date.now()}`), import(`${storeUrl}?legacy=${Date.now()}`)])
  const source = new ProjectTaskStore({ filePath: legacyPath, keyProvider: requested => { assert.equal(requested, 'project_base_authority_registry_01'); return Buffer.from(base.key) } })
  source.initialize()
  source.createCollaborationBoard({ projectRef: 'project_base_authority_registry_01', coordinatorActorRef: 'collaborator_legacy_owner_0000000001', title: 'Legacy board in WAL', createdAt: 1 })
  assert.equal(await readFile(`${legacyPath}-wal`).then(value => value.length > 0), true)
  const canonicalProjectKey = 'a'.repeat(64), otherProjectKey = 'b'.repeat(64)
  const staleLockPath = path.join(storages, 'project_lanes', 'legacy-task-binding.lock')
  await mkdir(path.dirname(staleLockPath), { recursive: true }); await writeFile(staleLockPath, 'dead-owner-from-prior-process')
  let registry = new ProjectEntryRegistry({ projectEntry: base, dshHome: temporary })
  try {
    await assert.rejects(registry.localProjectTaskContext({ canonicalProjectKey }), error => error.code === 'PROJECT_ENTRY_LEGACY_BINDING_REQUIRED')
    const contextA = await registry.bindLegacyProjectTaskContext({ canonicalProjectKey })
    assert.equal(contextA.projectRef, 'project_base_authority_registry_01')
    let migrated = new ProjectTaskStore({ filePath: contextA.databasePath, keyProvider: contextA.keyProvider })
    migrated.initialize()
    assert.equal(migrated.readCollaborationSnapshot({ projectRef: contextA.projectRef }).title, 'Legacy board in WAL')
    migrated.close(); contextA.dispose()

    const contextB = await registry.localProjectTaskContext({ canonicalProjectKey: otherProjectKey })
    assert.notEqual(contextB.projectRef, 'project_base_authority_registry_01')
    assert.notEqual(contextB.databasePath, contextA.databasePath)
    const independent = new ProjectTaskStore({ filePath: contextB.databasePath, keyProvider: contextB.keyProvider })
    independent.initialize()
    assert.equal(independent.readCollaborationSnapshot({ projectRef: contextB.projectRef }), undefined)
    independent.close(); contextB.dispose()
    registry.migrationChain = delay(180)
    const fastStarted = Date.now(), fastReplay = await registry.localProjectTaskContext({ canonicalProjectKey: otherProjectKey })
    assert.equal(Date.now() - fastStarted < 80, true, 'known independent lane must bypass unrelated migration work')
    fastReplay.dispose()
    await assert.rejects(registry.bindLegacyProjectTaskContext({ canonicalProjectKey: otherProjectKey }), error => error.code === 'PROJECT_ENTRY_LEGACY_BINDING_CONFLICT')

    const markerPath = path.join(storages, 'project_lanes', 'legacy-task-binding.json'), marker = JSON.parse(await readFile(markerPath, 'utf8'))
    const targetPath = path.join(storages, 'project_lanes', marker.laneRef, 'tasks.sqlite')
    await writeFile(markerPath, `${JSON.stringify({ ...marker, phase: 'copying' })}\n`)
    await writeFile(targetPath, 'incomplete-copy')
    await writeFile(`${targetPath}.legacy-migration.tmp`, 'incomplete-temp')
    await registry.close()
    registry = new ProjectEntryRegistry({ projectEntry: base, dshHome: temporary })
    const resumed = await registry.localProjectTaskContext({ canonicalProjectKey })
    migrated = new ProjectTaskStore({ filePath: resumed.databasePath, keyProvider: resumed.keyProvider })
    migrated.initialize()
    assert.equal(migrated.readCollaborationSnapshot({ projectRef: resumed.projectRef }).title, 'Legacy board in WAL')
    migrated.close(); resumed.dispose()
    assert.equal(JSON.parse(await readFile(markerPath, 'utf8')).phase, 'complete')
    assert.equal(await readFile(`${targetPath}.legacy-migration.tmp`).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false)
    assert.equal(source.readCollaborationSnapshot({ projectRef: 'project_base_authority_registry_01' }).revision, 1)
    assert.equal((await readFile(markerPath, 'utf8')).includes(canonicalProjectKey), false)
    assert.equal((await readFile(markerPath, 'utf8')).includes(legacyPath), false)
  } finally { source.close(); base.key.fill(0); await registry.close(); await delay(100); await rm(temporary, { recursive: true, force: true }) }
})

test('empty or no-board legacy SQLite does not require or consume a human binding', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'canonical-project-empty-legacy-')), storages = path.join(temporary, 'storages')
  await mkdir(storages, { recursive: true })
  const base = baseProjectEntry(temporary), [{ ProjectEntryRegistry }, { ProjectTaskStore }] = await Promise.all([import(`${registryUrl}?empty=${Date.now()}`), import(`${storeUrl}?empty=${Date.now()}`)])
  const empty = new ProjectTaskStore({ filePath: path.join(storages, 'agent_project_tasks.sqlite'), keyProvider: () => Buffer.from(base.key) }); empty.initialize()
  const registry = new ProjectEntryRegistry({ projectEntry: base, dshHome: temporary })
  try {
    const context = await registry.localProjectTaskContext({ canonicalProjectKey: 'c'.repeat(64) })
    assert.notEqual(context.projectRef, 'project_base_authority_registry_01')
    context.dispose()
    assert.equal(await readFile(path.join(storages, 'project_lanes', 'legacy-task-binding.json')).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false)
  } finally { empty.close(); base.key.fill(0); await registry.close(); await rm(temporary, { recursive: true, force: true }) }
})

test('explicit legacy bind preserves a pre-existing fresh lane database and fails closed', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'canonical-project-bind-conflict-')), storages = path.join(temporary, 'storages')
  await mkdir(storages, { recursive: true })
  const base = baseProjectEntry(temporary), [{ ProjectEntryRegistry }, { ProjectTaskStore }] = await Promise.all([import(`${registryUrl}?conflict=${Date.now()}`), import(`${storeUrl}?conflict=${Date.now()}`)])
  const legacy = new ProjectTaskStore({ filePath: path.join(storages, 'agent_project_tasks.sqlite'), keyProvider: () => Buffer.from(base.key) })
  legacy.initialize(); legacy.createCollaborationBoard({ projectRef: 'project_base_authority_registry_01', coordinatorActorRef: 'collaborator_legacy_conflict_0000001', title: 'Legacy must not overwrite', createdAt: 1 })
  const canonicalProjectKey = 'd'.repeat(64)
  const laneRef = `lane_${createHmac('sha256', base.key).update('dsh-agent-teams/canonical-project-lane/v1').update('\0').update(JSON.stringify([canonicalProjectKey])).digest('base64url')}`
  const projectRef = `project_${createHmac('sha256', base.key).update('dsh-agent-teams/canonical-project-ref/v1').update('\0').update(JSON.stringify([laneRef])).digest('base64url')}`
  const laneKey = createHmac('sha256', base.key).update('dsh-agent-teams/canonical-project-task-key/v1').update('\0').update(laneRef).update('\0').update(projectRef).digest()
  const lanePath = path.join(storages, 'project_lanes', laneRef, 'tasks.sqlite')
  const fresh = new ProjectTaskStore({ filePath: lanePath, keyProvider: requested => { assert.equal(requested, projectRef); return Buffer.from(laneKey) } })
  fresh.initialize(); fresh.createCollaborationBoard({ projectRef, coordinatorActorRef: 'collaborator_fresh_conflict_00000001', title: 'Fresh lane data survives', createdAt: 2 }); fresh.close()
  const registry = new ProjectEntryRegistry({ projectEntry: base, dshHome: temporary })
  try {
    await assert.rejects(registry.bindLegacyProjectTaskContext({ canonicalProjectKey }), error => error.code === 'PROJECT_ENTRY_LEGACY_BINDING_CONFLICT')
    const reopened = new ProjectTaskStore({ filePath: lanePath, keyProvider: () => Buffer.from(laneKey) }); reopened.initialize()
    assert.equal(reopened.readCollaborationSnapshot({ projectRef }).title, 'Fresh lane data survives'); reopened.close()
    assert.equal(await readFile(path.join(storages, 'project_lanes', 'legacy-task-binding.json')).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false)
  } finally { laneKey.fill(0); legacy.close(); base.key.fill(0); await registry.close(); await rm(temporary, { recursive: true, force: true }) }
})

test('plugin launch registry uses separate redacted ledgers and rejects cross-lane batch lookup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canonical-plugin-launch-')), { ProjectSessionLaunchRegistry, ProjectSessionLaunchRuntime } = await import(`${launchUrl}?registry=${Date.now()}`)
  const originalInit = ProjectSessionLaunchRuntime.prototype.init
  let initCalls = 0
  ProjectSessionLaunchRuntime.prototype.init = async function (...args) { if (this.document === undefined && this.initPromise === undefined) initCalls += 1; await delay(35); return originalInit.apply(this, args) }
  const provider = {
    callerRootRef: (canonicalProjectKey, rootId) => createHmac('sha256', Buffer.alloc(32, 19)).update(JSON.stringify([canonicalProjectKey, rootId])).digest('hex'),
    resolveProject: async (_execution, request) => ({ projectRef: `project_${request.canonicalProjectKey.slice(0, 20)}`, boardRef: `board_${request.canonicalProjectKey.slice(0, 20)}`, rootSessionRef: `root_${request.callerRootRef.slice(0, 20)}`, projectTicket: `ticket_${request.callerRootRef}`, maxSessions: 8 }),
    reserveAdoption: async () => { throw new Error('unused') }, launch: async () => { throw new Error('unused') }, reconcile: async () => { throw new Error('unused') }, cancel: async () => ({ cancelled: true }), redeemAdoption: async () => { throw new Error('unused') },
  }
  let registry = new ProjectSessionLaunchRegistry({ rootPath: path.join(root, 'lanes'), provider })
  const bindings = ['a', 'b'].map((char, index) => ({ canonicalProjectKey: char.repeat(64), workspacePath: path.join(root, `workspace-${index}`), callerRootId: `root-${index}` }))
  try {
    await registry.init()
    await Promise.all(Array.from({ length: 12 }, () => registry.preflight({}, { totalSessions: 2, projectBinding: bindings[0] })))
    assert.equal(registry.safeState().laneCount, 1)
    assert.equal(initCalls, 1, 'same-lane callers must share one initialization')
    const batches = []
    for (const binding of bindings) batches.push(await registry.prepareStart({}, { requestId: 'same-request', totalSessions: 2, slots: [{ title: 'same', role: 'same', resources: ['src/same'], task: 'same' }], projectBinding: binding }))
    assert.notEqual(batches[0].batchRef, batches[1].batchRef)
    const dirs = (await readdir(path.join(root, 'lanes'), { withFileTypes: true })).filter(entry => entry.isDirectory())
    assert.equal(dirs.length, 2)
    for (const dir of dirs) {
      const ledger = await readFile(path.join(root, 'lanes', dir.name, 'launch.json'), 'utf8')
      for (const binding of bindings) { assert.equal(ledger.includes(binding.canonicalProjectKey), false); assert.equal(ledger.includes(binding.workspacePath), false) }
    }
    await assert.rejects(registry.status({}, { batchRef: batches[0].batchRef, projectBinding: bindings[1] }), error => error.code === 'PROJECT_SESSION_LAUNCH_NOT_FOUND')
    await registry.close()
    registry = new ProjectSessionLaunchRegistry({ rootPath: path.join(root, 'lanes'), provider })
    await registry.init()
    assert.equal((await registry.status({}, { batchRef: batches[0].batchRef, projectBinding: bindings[0] })).batchRef, batches[0].batchRef)
    const retryBinding = { canonicalProjectKey: 'c'.repeat(64), workspacePath: path.join(root, 'workspace-retry'), callerRootId: 'root-retry' }
    const retryLaneRef = provider.callerRootRef(retryBinding.canonicalProjectKey, 'project-session-launch-lane'), retryFile = path.join(root, 'lanes', `lane_${retryLaneRef}`, 'launch.json')
    await mkdir(path.dirname(retryFile), { recursive: true }); await writeFile(retryFile, 'invalid-ledger')
    const failed = await Promise.allSettled([registry.preflight({}, { totalSessions: 2, projectBinding: retryBinding }), registry.preflight({}, { totalSessions: 2, projectBinding: retryBinding })])
    assert.equal(failed.every(result => result.status === 'rejected'), true)
    await rm(retryFile, { force: true })
    assert.equal((await registry.preflight({}, { totalSessions: 2, projectBinding: retryBinding })).project.projectRef.startsWith('project_'), true, 'failed same-lane init must be evicted for retry')
  } finally { ProjectSessionLaunchRuntime.prototype.init = originalInit; await registry.close(); await rm(root, { recursive: true, force: true }) }
})

test('legacy launch ledger remains the sole owner and exact-binding fallback survives restart without physical copying', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canonical-launch-legacy-')), { ProjectSessionLaunchRegistry, ProjectSessionLaunchRuntime } = await import(`${launchUrl}?legacyLaunch=${Date.now()}`)
  const legacyFilePath = path.join(root, 'project_session_launch.json'), binding = { canonicalProjectKey: 'd'.repeat(64), workspacePath: path.join(root, 'legacy-workspace'), callerRootId: 'legacy-root' }
  const provider = {
    callerRootRef: (canonicalProjectKey, rootId) => createHmac('sha256', Buffer.alloc(32, 23)).update(JSON.stringify([canonicalProjectKey, rootId])).digest('hex'),
    resolveProject: async (_execution, request) => ({ projectRef: `project_${request.canonicalProjectKey.slice(0, 20)}`, boardRef: `board_${request.canonicalProjectKey.slice(0, 20)}`, rootSessionRef: `root_${request.callerRootRef.slice(0, 20)}`, projectTicket: `ticket_${request.callerRootRef}`, maxSessions: 8 }),
    reserveAdoption: async (_execution, request) => ({ projectRef: request.projectRef, operationRef: request.operationRef, adoptionCapability: `adoption_${request.operationRef}` }),
    launch: async (_execution, request) => ({ projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' }),
    reconcile: async (_execution, request) => ({ projectRef: request.projectRef, operationRef: request.operationRef, state: 'ready' }),
    cancel: async () => ({ cancelled: true }),
    redeemAdoption: async (_execution, request) => ({ projectRef: request.projectRef, operationRef: request.operationRef, adoptionCapability: `adoption_${request.operationRef}` }),
  }
  const legacy = new ProjectSessionLaunchRuntime({ filePath: legacyFilePath, provider, disposeProvider: false })
  await legacy.init()
  const prepared = await legacy.prepareStart({}, { requestId: 'legacy-request', totalSessions: 2, slots: [{ title: 'legacy', role: 'legacy', resources: ['src/legacy'], task: 'legacy' }], projectBinding: binding })
  const adoptions = await legacy.prepareAdoptions({}, { batchRef: prepared.batchRef, projectBinding: binding })
  await legacy.activatePreparedBatch({}, { batchRef: prepared.batchRef, projectBinding: binding, reservations: [{ slotActorRef: 'actor_legacy_reserved_000000000000001', taskRef: 'task_legacy_reserved_0000000000000001', slotRef: adoptions.prepared[0].slotRef, operationRef: adoptions.prepared[0].operationRef }] })
  for (let attempt = 0; attempt < 50; attempt += 1) { if ((await legacy.status({}, { batchRef: prepared.batchRef, projectBinding: binding })).state === 'ready') break; await delay(5) }
  await legacy.close()
  const sourceBefore = await readFile(legacyFilePath, 'utf8'), lanesRoot = path.join(root, 'lanes')
  let registry = new ProjectSessionLaunchRegistry({ rootPath: lanesRoot, legacyFilePath, provider })
  try {
    await registry.init()
    const statuses = await Promise.all(Array.from({ length: 8 }, () => registry.status({}, { batchRef: prepared.batchRef, projectBinding: binding })))
    assert.equal(statuses.every(status => status.batchRef === prepared.batchRef && status.state === 'ready'), true)
    assert.equal((await registry.redeemAdoption({}, { slotRef: adoptions.prepared[0].slotRef, projectBinding: binding })).slotActorRef, 'actor_legacy_reserved_000000000000001')
    assert.equal(await readFile(path.join(lanesRoot, 'legacy-launch-binding.json')).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false)
    assert.equal(await readFile(legacyFilePath, 'utf8'), sourceBefore)
    const laneRef = provider.callerRootRef(binding.canonicalProjectKey, 'project-session-launch-lane'), laneDocument = JSON.parse(await readFile(path.join(lanesRoot, `lane_${laneRef}`, 'launch.json'), 'utf8'))
    assert.equal(laneDocument.batches.length, 0, 'fallback must not create a second owner by copying legacy batches')
    await registry.close()
    registry = new ProjectSessionLaunchRegistry({ rootPath: lanesRoot, legacyFilePath, provider })
    await registry.init()
    assert.equal((await registry.status({}, { batchRef: prepared.batchRef, projectBinding: binding })).batchRef, prepared.batchRef)
    const otherBinding = { canonicalProjectKey: 'e'.repeat(64), workspacePath: path.join(root, 'other-workspace'), callerRootId: 'other-root' }
    await assert.rejects(registry.status({}, { batchRef: prepared.batchRef, projectBinding: otherBinding }), error => error.code === 'PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH')
    await registry.stop({}, { batchRef: prepared.batchRef, projectBinding: binding })
    assert.equal(await readFile(legacyFilePath).then(value => value.length > 0), true)
  } finally { await registry.close(); await rm(root, { recursive: true, force: true }) }
})

test('Host bridge admits 16 canonical lanes with identical batch ids, keeps fast work independent, restarts, and persists no raw binding', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canonical-project-host-'))
  const stateFile = path.join(root, 'host.json'), token = randomBytes(32), projects = Array.from({ length: 16 }, (_, index) => path.join(root, `project-${index}`))
  await Promise.all(projects.map(project => mkdir(project)))
  const completions = [], sessions = new Set()
  const rpc = async (method, payload) => {
    const request = payload?.args?.request
    if (method === 'workspace/create') { const index = projects.indexOf(request.path); await delay(index === 0 ? 180 : 5); completions.push(index); return { workspace: { workspaceId: `workspace-${index}`, path: request.path } } }
    if (method === 'session/create') { sessions.add(request.sessionId); return { sessionId: request.sessionId } }
    if (method === 'session/rename') return { title: request.title, seq: 1 }
    if (method === 'session/prompt') return { accepted: true }
    if (method === 'session/list') return { items: [...sessions].map(sessionId => ({ sessionId })) }
    throw new Error(method)
  }
  let service = createAgentTeamsSessionLaunchService({ stateFile, token, callRuntimeRpc: rpc, maxConcurrent: 4, maxConcurrentPerProject: 1 })
  const auth = token.toString('base64url')
  try {
    await service.start()
    const salt = Buffer.from(service.runtimeEnvironment({})[CALLER_SALT_ENV], 'base64url')
    const bindings = await Promise.all(projects.map((workspacePath, index) => {
      const canonicalProjectKey = projectKeyForWorkspace(workspacePath)
      const callerRootRef = createHmac('sha256', salt).update(JSON.stringify(['agent-teams-caller-root-v1', canonicalProjectKey, `root-${index}`])).digest('hex')
      return service.handleRequest({ action: 'resolveProject', token: auth, canonicalProjectKey, workspacePath, callerRootRef }).then(binding => ({ ...binding, canonicalProjectKey, callerRootRef }))
    }))
    const launches = bindings.map((binding, index) => service.handleRequest({ action: 'launch', token: auth, canonicalProjectKey: binding.canonicalProjectKey, callerRootRef: binding.callerRootRef, projectTicket: binding.projectTicket, projectRef: binding.projectRef, boardRef: binding.boardRef, batchRef: 'batch_same', slotRef: 'slot_same', operationRef: 'operation_same', title: `Lane ${index}`, role: 'role', resources: ['src/same'], task: 'same task', initialization: 'same init' }))
    const firstTwo = await Promise.race([launches[0].then(() => 'slow'), launches[1].then(() => 'fast')])
    assert.equal(firstTwo, 'fast')
    await Promise.all(launches)
    assert.equal(new Set(bindings.map(binding => binding.projectRef)).size, 16)
    const persisted = await readFile(stateFile, 'utf8')
    for (let index = 0; index < projects.length; index += 1) {
      assert.equal(persisted.includes(projects[index]), false)
      assert.equal(persisted.includes(bindings[index].canonicalProjectKey), false)
    }
    assert.equal(JSON.parse(persisted).operations.length, 16)

    const wrong = bindings[1]
    await assert.rejects(service.handleRequest({ action: 'reconcile', token: auth, canonicalProjectKey: wrong.canonicalProjectKey, callerRootRef: wrong.callerRootRef, projectTicket: bindings[0].projectTicket, projectRef: bindings[0].projectRef, boardRef: bindings[0].boardRef, operationRef: 'operation_same' }), error => error.code === 'HOST_SESSION_LAUNCH_PROJECT_MISMATCH')
    await service.close()
    service = createAgentTeamsSessionLaunchService({ stateFile, token: Buffer.from(token), callRuntimeRpc: rpc })
    await service.start()
    const rebound = await service.handleRequest({ action: 'resolveProject', token: auth, canonicalProjectKey: bindings[3].canonicalProjectKey, workspacePath: projects[3], callerRootRef: bindings[3].callerRootRef })
    assert.equal(rebound.projectRef, bindings[3].projectRef)
  } finally { await service.close().catch(() => undefined); token.fill(0); await rm(root, { recursive: true, force: true }) }
})
