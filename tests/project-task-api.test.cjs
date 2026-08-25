const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
const runtimeFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-web.js')

function request(method, url, body, headers = {}) {
  const req = body === undefined ? new EventEmitter() : Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = {
    host: '127.0.0.1:9945',
    origin: 'http://127.0.0.1:9945',
    ...(method === 'POST' ? { 'x-harness-agent-teams': '1', 'content-type': 'application/json' } : {}),
    ...headers,
  }
  return req
}
function response() {
  const res = new EventEmitter()
  Object.assign(res, {
    status: 0,
    headers: {},
    headersSent: false,
    chunks: [],
    ended: false,
    writeHead(status, headers) { this.status = status; this.headers = headers || {}; this.headersSent = true },
    flushHeaders() {},
    write(chunk) { this.chunks.push(String(chunk)); return true },
    end(chunk = '') { if (chunk) this.chunks.push(String(chunk)); this.ended = true },
  })
  return res
}
function body(res) {
  return JSON.parse(res.chunks.join(''))
}
function harness(routes, cleanups) {
  return {
    logger: { info() {}, warn() {}, error() {} },
    agents: { get() { return undefined } },
    subagents: { interrupt() {} },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
    effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    on() { return () => {} },
  }
}
async function invoke(routes, routePath, method = 'GET', url = routePath, requestBody, headers) {
  const route = routes.get(routePath)
  assert.ok(route, routePath)
  const req = request(method, url, requestBody, headers)
  const res = response()
  await route.handler(req, res)
  return { req, res, data: res.chunks.length === 0 ? undefined : body(res) }
}
async function cleanupAll(cleanups) {
  for (const cleanup of cleanups.reverse()) await cleanup()
}
async function setupApply({ seedLegacy = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-api-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-api=${Date.now()}-${Math.random()}`)
  let legacyStore
  if (seedLegacy) {
    legacyStore = new mod.AgentTeamsStore(path.join(root, 'storages', 'agent_teams.json'), { enabled: true, maxMembers: 8, maxActiveTurns: 8 })
    await legacyStore.init()
    const lead = { id: 'legacy-lead', options: { provider: 'test', model: 'test' } }
    const team = await mod.createTeam(legacyStore, lead, { objective: 'Legacy task stays separate' })
    await mod.createTask(legacyStore, lead, { teamId: team.id, title: 'Legacy task' })
  }
  const routes = new Map()
  const cleanups = []
  mod.apply(harness(routes, cleanups), { enabled: true, maxMembers: 8, maxActiveTurns: 8 })
  return { root, previousHome, mod, routes, cleanups, legacyStore }
}
async function teardownApply(state) {
  try { await cleanupAll(state.cleanups) }
  finally {
    if (state.previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = state.previousHome
    await rm(state.root, { recursive: true, force: true })
  }
}

const statePath = '/api/agent-teams/project/tasks/state'
const eventsPath = '/api/agent-teams/project/tasks/events'
const streamPath = '/api/agent-teams/project/tasks/stream'
const actionPath = '/api/agent-teams/project/tasks/action'
const projectActionPath = '/api/agent-teams/project/action'
const automationStatePath = '/api/agent-teams/project/automations/state'
const automationStreamPath = '/api/agent-teams/project/automations/stream'
const automationActionPath = '/api/agent-teams/project/automations/action'

test('exact project task routes expose honest no-project capability and nested safe failures', async () => {
  const state = await setupApply()
  try {
    for (const pathName of [statePath, eventsPath, streamPath, actionPath, automationStatePath, automationStreamPath, automationActionPath]) assert.ok(state.routes.has(pathName), pathName)
    const emptyAutomation = await invoke(state.routes, automationStatePath)
    assert.equal(emptyAutomation.res.status, 200)
    assert.equal(emptyAutomation.data.capability.kind, 'no-project')
    assert.equal(JSON.stringify(emptyAutomation.data).includes('projectRef'), false)
    const forgedAutomationQuery = await invoke(state.routes, automationStatePath, 'GET', `${automationStatePath}?projectRef=forged`)
    assert.equal(forgedAutomationQuery.res.status, 400)
    assert.equal(forgedAutomationQuery.data.error.code, 'PROJECT_AUTOMATION_WEB_INVALID_REQUEST')
    const automationWrongMethod = await invoke(state.routes, automationStatePath, 'POST', automationStatePath, {})
    assert.equal(automationWrongMethod.res.status, 405)
    const automationMissingHeader = await invoke(state.routes, automationActionPath, 'POST', automationActionPath, { commandId: 'denied', type: 'approve', runRef: 'run_denied', expectedRevision: 1, payload: {} }, { 'x-harness-agent-teams': undefined })
    assert.equal(automationMissingHeader.res.status, 403)
    assert.equal(automationMissingHeader.data.error.code, 'PROJECT_AUTOMATION_WEB_FORBIDDEN')
    const empty = await invoke(state.routes, statePath)
    assert.equal(empty.res.status, 200)
    assert.equal(empty.data.capability.kind, 'no-project')
    assert.equal(Object.hasOwn(empty.data, 'tasks'), false)
    assert.equal(JSON.stringify(empty.data).includes('projectRef'), false)

    const forgedQuery = await invoke(state.routes, statePath, 'GET', `${statePath}?sessionId=forged`)
    assert.equal(forgedQuery.res.status, 400)
    assert.equal(forgedQuery.data.ok, false)
    assert.equal(forgedQuery.data.error.code, 'PROJECT_TASK_WEB_INVALID_REQUEST')
    assert.equal(typeof forgedQuery.data.error.nextAction, 'string')
    assert.deepEqual(forgedQuery.data.error.safeDetails, {})

    const wrongMethod = await invoke(state.routes, statePath, 'POST', statePath, {})
    assert.equal(wrongMethod.res.status, 405)
    assert.equal(wrongMethod.data.error.code, 'PROJECT_TASK_WEB_METHOD_NOT_ALLOWED')
    const hostile = await invoke(state.routes, statePath, 'GET', statePath, undefined, { origin: 'http://example.test' })
    assert.equal(hostile.res.status, 403)
    assert.equal(hostile.data.error.code, 'PROJECT_TASK_WEB_FORBIDDEN')
    const missingHeader = await invoke(state.routes, actionPath, 'POST', actionPath, { commandId: 'command_denied', type: 'create', expectedRevision: 0, payload: { title: 'Denied' } }, { 'x-harness-agent-teams': undefined })
    assert.equal(missingHeader.res.status, 403)
    assert.equal(missingHeader.data.error.code, 'PROJECT_TASK_WEB_FORBIDDEN')
    for (const encoded of [JSON.stringify(forgedQuery.data), JSON.stringify(wrongMethod.data), JSON.stringify(hostile.data)]) {
      assert.equal(encoded.includes('\\private\\'), false)
      assert.equal(encoded.includes('stack'), false)
    }
  } finally { await teardownApply(state) }
})

test('Host HTTP command bus enforces identity, idempotency, OCC, bounded events, and legacy single-write separation', async () => {
  const state = await setupApply({ seedLegacy: true })
  try {
    const legacyBefore = state.legacyStore.snapshot().teams.map(team => team.tasks.map(task => ({ id: task.id, state: task.state, revision: task.revision })))
    const createdProject = await invoke(state.routes, projectActionPath, 'POST', projectActionPath, {
      action: 'create-project', payload: { projectName: 'API Project', displayName: 'Owner' },
    })
    assert.equal(createdProject.res.status, 200, JSON.stringify(createdProject.data))

    const initial = await invoke(state.routes, statePath)
    assert.equal(initial.data.capability.kind, 'authority')
    assert.equal(initial.data.capability.canCreate, true)
    assert.equal(initial.data.capability.legacyTeamTasks.detected, true)

    const create = { commandId: 'command_api_create', type: 'create', expectedRevision: 0, payload: { title: 'API task', requirements: { secret: 'hidden requirement' }, fileScope: ['private/path.js'] } }
    const first = await invoke(state.routes, actionPath, 'POST', actionPath, create)
    assert.equal(first.res.status, 200)
    assert.equal(first.data.receipt.duplicate, false)
    assert.equal(first.data.task.revision, 1)
    const taskRef = first.data.task.taskRef
    const replay = await invoke(state.routes, actionPath, 'POST', actionPath, create)
    assert.equal(replay.data.receipt.duplicate, true)
    assert.equal(replay.data.receipt.eventRef, first.data.receipt.eventRef)

    const drift = await invoke(state.routes, actionPath, 'POST', actionPath, { ...create, payload: { title: 'Changed intent' } })
    assert.equal(drift.res.status, 409)
    assert.equal(drift.data.error.code, 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
    assert.equal(drift.data.error.nextAction, 'start_new_action')

    const transitioned = await invoke(state.routes, actionPath, 'POST', actionPath, {
      commandId: 'command_api_transition', type: 'transition', taskRef, expectedRevision: 1, payload: { to: 'backlog' },
    })
    assert.equal(transitioned.res.status, 200)
    assert.equal(transitioned.data.task.revision, 2)
    const stale = await invoke(state.routes, actionPath, 'POST', actionPath, {
      commandId: 'command_api_stale', type: 'transition', taskRef, expectedRevision: 1, payload: { to: 'in_progress' },
    })
    assert.equal(stale.res.status, 409)
    assert.equal(stale.data.error.code, 'PROJECT_TASK_CONFLICT')
    assert.deepEqual(stale.data.error.safeDetails, { currentRevision: 2 })

    for (const forged of [
      { projectRef: 'project_forged' }, { eventRef: 'event_forged' }, { sessionId: 'session_forged' }, { actorRef: 'actor_forged' }, { role: 'owner' }, { authority: 'owner' },
    ]) {
      const rejected = await invoke(state.routes, actionPath, 'POST', actionPath, { ...create, commandId: `command_forged_${Object.keys(forged)[0]}`, ...forged })
      assert.equal(rejected.res.status, 400)
      assert.equal(rejected.data.error.code, 'PROJECT_TASK_WEB_INVALID_REQUEST')
    }
    const nested = await invoke(state.routes, actionPath, 'POST', actionPath, { ...create, commandId: 'command_nested_forged', payload: { title: 'x', nested: { actor_ref: 'forged' } } })
    assert.equal(nested.res.status, 400)
    const forgedActionQuery = await invoke(state.routes, actionPath, 'POST', `${actionPath}?projectRef=forged`, create)
    assert.equal(forgedActionQuery.res.status, 400)
    assert.equal(forgedActionQuery.data.error.code, 'PROJECT_TASK_WEB_INVALID_REQUEST')

    const delta = await invoke(state.routes, eventsPath, 'GET', `${eventsPath}?afterRevision=0&limit=1`)
    assert.equal(delta.res.status, 200)
    assert.equal(delta.data.events.length, 1)
    assert.equal(delta.data.hasMore, true)
    assert.equal(JSON.stringify(delta.data).includes('actorRef'), false)
    assert.equal(JSON.stringify(delta.data).includes('payload'), false)
    const reset = await invoke(state.routes, eventsPath, 'GET', `${eventsPath}?afterRevision=99&limit=100`)
    assert.equal(reset.data.reset, true)
    const overLimit = await invoke(state.routes, eventsPath, 'GET', `${eventsPath}?limit=101`)
    assert.equal(overLimit.res.status, 400)
    const forgedEvents = await invoke(state.routes, eventsPath, 'GET', `${eventsPath}?projectRef=forged`)
    assert.equal(forgedEvents.res.status, 400)

    const finalState = await invoke(state.routes, statePath)
    assert.equal(finalState.data.projectRevision, 2)
    const encoded = JSON.stringify({ first: first.data, finalState: finalState.data })
    for (const secret of ['hidden requirement', 'private/path.js', 'ownerActorRef', 'assigneeActorRef', 'projectRef']) assert.equal(encoded.includes(secret), false, secret)
    assert.deepEqual(state.legacyStore.snapshot().teams.map(team => team.tasks.map(task => ({ id: task.id, state: task.state, revision: task.revision }))), legacyBefore)
  } finally { await teardownApply(state) }
})

test('Automation HTTP bus queues approval, runs independently, replays exactly, and streams refetch-only wakes', async () => {
  const state = await setupApply()
  let streamRequest
  let streamResponse
  try {
    await invoke(state.routes, projectActionPath, 'POST', projectActionPath, { action: 'create-project', payload: { projectName: 'Automation API', displayName: 'Owner' } })
    const task = await invoke(state.routes, actionPath, 'POST', actionPath, { commandId: 'automation_task_create', type: 'create', expectedRevision: 0, payload: { title: 'Automated task', requirements: { private: 'never expose' }, fileScope: ['private/automation.js'] } })
    assert.equal(task.res.status, 200)
    streamRequest = request('GET', automationStreamPath)
    streamResponse = response()
    await state.routes.get(automationStreamPath).handler(streamRequest, streamResponse)
    assert.equal(streamResponse.status, 200)
    assert.match(streamResponse.chunks[0], /event: reset/u)
    assert.equal(streamResponse.chunks[0].includes('projectRef'), false)

    const createCommand = { commandId: 'automation_definition_create', type: 'definition.create', expectedRevision: 0, payload: { name: 'Move task', taskRef: task.data.task.taskRef, targetStatus: 'in_progress' } }
    const definition = await invoke(state.routes, automationActionPath, 'POST', automationActionPath, createCommand)
    assert.equal(definition.res.status, 200, JSON.stringify(definition.data))
    assert.equal(definition.data.definition.status, 'enabled')
    const definitionRef = definition.data.definition.definitionRef
    const replay = await invoke(state.routes, automationActionPath, 'POST', automationActionPath, createCommand)
    assert.equal(replay.data.duplicate, true)
    const drift = await invoke(state.routes, automationActionPath, 'POST', automationActionPath, { ...createCommand, payload: { ...createCommand.payload, name: 'Changed' } })
    assert.equal(drift.res.status, 409)
    assert.equal(drift.data.error.code, 'PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT')

    const manual = await invoke(state.routes, automationActionPath, 'POST', automationActionPath, { commandId: 'automation_manual_run', type: 'manual_run', definitionRef, expectedRevision: 1, payload: { taskRevision: task.data.task.revision } })
    assert.equal(manual.data.run.status, 'awaiting_approval')
    const approve = await invoke(state.routes, automationActionPath, 'POST', automationActionPath, { commandId: 'automation_approve', type: 'approve', runRef: manual.data.run.runRef, expectedRevision: 1, payload: {} })
    assert.equal(approve.data.run.status, 'queued', 'approval must return before the background Task effect')
    let automationState
    for (let attempt = 0; attempt < 50; attempt += 1) {
      automationState = (await invoke(state.routes, automationStatePath)).data
      if (automationState.runs[0]?.status === 'succeeded') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(automationState.runs[0].status, 'succeeded')
    assert.equal((await invoke(state.routes, statePath)).data.tasks[0].status, 'in_progress')
    assert.ok(streamResponse.chunks.some(chunk => /event: automation/u.test(chunk)))
    const encodedStream = streamResponse.chunks.join('')
    for (const forbidden of ['commandId', 'actorRef', 'effectKey', 'taskCommandId', 'projectRef', 'private/automation.js', 'never expose']) assert.equal(encodedStream.includes(forbidden), false, forbidden)
    const encodedState = JSON.stringify(automationState)
    for (const forbidden of ['actorRef', 'commandId', 'inputHash', 'effectKey', 'taskCommandId', 'approvalRef', 'fileScope', 'requirements', 'projectRef']) assert.equal(encodedState.includes(forbidden), false, forbidden)
    const forgedActionQuery = await invoke(state.routes, automationActionPath, 'POST', `${automationActionPath}?actorRef=forged`, createCommand)
    assert.equal(forgedActionQuery.res.status, 400)
  } finally { await teardownApply(state) }
})

test('SSE sends reset then safe task wake, cleans disconnects, and plugin disposal ends live clients', async () => {
  const state = await setupApply()
  let firstRequest
  let firstResponse
  let secondResponse
  try {
    await invoke(state.routes, projectActionPath, 'POST', projectActionPath, {
      action: 'create-project', payload: { projectName: 'SSE Project', displayName: 'Owner' },
    })
    firstRequest = request('GET', streamPath)
    firstResponse = response()
    await state.routes.get(streamPath).handler(firstRequest, firstResponse)
    assert.equal(firstResponse.status, 200)
    assert.match(firstResponse.headers['content-type'], /^text\/event-stream/u)
    assert.equal(firstResponse.headers['cache-control'], 'no-cache, no-transform')
    assert.equal(firstResponse.headers['x-content-type-options'], 'nosniff')
    assert.equal(firstResponse.chunks.length, 1)
    assert.match(firstResponse.chunks[0], /event: reset/u)
    assert.equal(firstResponse.chunks[0].includes('projectRef'), false)

    const sseCreate = await invoke(state.routes, actionPath, 'POST', actionPath, { commandId: 'command_sse_create', type: 'create', expectedRevision: 0, payload: { title: 'SSE task' } })
    assert.equal(sseCreate.res.status, 200, JSON.stringify(sseCreate.data))
    assert.equal(firstResponse.chunks.length, 2)
    assert.match(firstResponse.chunks[1], /^id: 1\nevent: task/u)
    assert.equal(firstResponse.chunks[1].includes('commandId'), false)
    assert.equal(firstResponse.chunks[1].includes('actorRef'), false)
    const disconnectedAt = firstResponse.chunks.length
    firstRequest.emit('aborted')
    await invoke(state.routes, actionPath, 'POST', actionPath, { commandId: 'command_sse_second', type: 'create', expectedRevision: 0, payload: { title: 'Second' } })
    assert.equal(firstResponse.chunks.length, disconnectedAt)

    const secondRequest = request('GET', streamPath)
    secondResponse = response()
    await state.routes.get(streamPath).handler(secondRequest, secondResponse)
    assert.equal(secondResponse.ended, false)
    await cleanupAll(state.cleanups)
    state.cleanups.length = 0
    assert.equal(secondResponse.ended, true)
    assert.equal(state.routes.has(streamPath), false)
  } finally { await teardownApply(state) }
})

test('SSE keepalive is bounded and bridge close clears timers and listeners', async () => {
  const [{ createProjectTaskSseBridge }, { ProjectTaskWebRuntime }] = await Promise.all([
    import(`${pathToFileURL(pluginFile).href}?bridge=${Date.now()}`),
    import(pathToFileURL(runtimeFile).href),
  ])
  const runtime = new ProjectTaskWebRuntime({ projectEntry: { localProjectTaskContext: async () => { throw Object.assign(new Error('none'), { code: 'PROJECT_ENTRY_NOT_CREATED' }) } } })
  const bridge = createProjectTaskSseBridge(runtime, { keepaliveMs: 5 })
  const req = request('GET', streamPath)
  const res = response()
  bridge.add(req, res)
  await new Promise(resolve => setTimeout(resolve, 18))
  assert.equal(res.chunks[0].includes('event: reset'), true)
  assert.equal(res.chunks.filter(chunk => chunk === ': keepalive\n\n').length >= 1, true)
  assert.equal(bridge.clients.size, 1)
  res.emit('close')
  assert.equal(bridge.clients.size, 0)
  const blockedRequest = request('GET', streamPath)
  const blockedResponse = response()
  blockedResponse.write = function (chunk) { this.chunks.push(String(chunk)); return false }
  bridge.add(blockedRequest, blockedResponse)
  assert.equal(bridge.clients.size, 0)
  assert.equal(blockedResponse.ended, true)
  bridge.close()
  assert.equal(bridge.clients.size, 0)
  await runtime.close()
})
