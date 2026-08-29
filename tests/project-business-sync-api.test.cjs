const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { createProjectSecretCapability } = require('./fixtures/project-secret-capability.cjs')

const lib = name => pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', name)).href
const taskStatePath = '/api/agent-teams/project/tasks/state'
const taskEventsPath = '/api/agent-teams/project/tasks/events'
const taskStreamPath = '/api/agent-teams/project/tasks/stream'
const taskActionPath = '/api/agent-teams/project/tasks/action'
const automationStatePath = '/api/agent-teams/project/automations/state'
const automationStreamPath = '/api/agent-teams/project/automations/stream'
const automationActionPath = '/api/agent-teams/project/automations/action'

function request(method, url, body, headers = {}) {
  const req = body === undefined ? new EventEmitter() : Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:9945', origin: 'http://127.0.0.1:9945', ...(method === 'POST' ? { 'x-harness-agent-teams': '1', 'content-type': 'application/json' } : {}), ...headers }
  return req
}
function response() {
  const res = new EventEmitter()
  return Object.assign(res, {
    status: 0, headers: {}, chunks: [], ended: false,
    writeHead(status, headers) { this.status = status; this.headers = headers || {} },
    flushHeaders() {}, write(chunk) { this.chunks.push(String(chunk)); return true },
    end(chunk = '') { if (chunk) this.chunks.push(String(chunk)); this.ended = true }
  })
}
function apiHarness(routes, cleanups) {
  return {
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
    effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) }
  }
}
async function invoke(routes, routePath, method = 'GET', url = routePath, body, headers) {
  const req = request(method, url, body, headers)
  const res = response()
  await routes.get(routePath).handler(req, res)
  return { req, res, data: res.chunks.length === 0 ? undefined : JSON.parse(res.chunks.join('')) }
}
async function closeAll(items) {
  const failures = []
  for (const [label, item] of items) {
    let timer
    try {
      await Promise.race([Promise.resolve(item?.close?.()), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} close timed out`)), 5_000) })])
    } catch (error) { failures.push(error) }
    finally { clearTimeout(timer) }
  }
  if (failures.length) throw new AggregateError(failures)
}
async function recoverBoth(authority, collaborator, rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.allSettled([authority.recover(), collaborator.recover()])
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function fixture() {
  const [entryMod, taskWebMod, automationWebMod, businessMod, indexMod] = await Promise.all([
    import(`${lib('project-entry-service.js')}?api=${Date.now()}-${Math.random()}`),
    import(lib('project-task-web.js')),
    import(lib('project-automation-web.js')),
    import(lib('project-business-sync-runtime.js')),
    import(`${lib('index.js')}?api=${Date.now()}-${Math.random()}`)
  ])
  const authorityHome = await mkdtemp(path.join(os.tmpdir(), 'business-api-authority-'))
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'business-api-collaborator-'))
  const secretCapability = createProjectSecretCapability()
  const now = Date.now()
  const authorityEntry = new entryMod.ProjectEntryService({ dshHome: authorityHome, secretCapability, now: () => now })
  const collaboratorEntry = new entryMod.ProjectEntryService({ dshHome: collaboratorHome, secretCapability, now: () => now })
  await authorityEntry.createProject({ projectName: 'Business API', displayName: 'Owner' })
  await authorityEntry.startLan({ host: '127.0.0.1' })
  const invite = await authorityEntry.createInvite({ displayName: 'Contributor', role: 'contributor' })
  const join = await collaboratorEntry.createJoinRequest({ inviteCode: invite.inviteCode, displayName: 'Contributor' })
  const approval = await authorityEntry.approveJoinRequest({ joinRequest: join.joinRequest })
  await collaboratorEntry.completeJoinRequest({ joinResponse: approval.joinResponse })
  await collaboratorEntry.connectLan()

  const authorityTasks = new taskWebMod.ProjectTaskWebRuntime({ projectEntry: authorityEntry })
  const authorityAutomations = new automationWebMod.ProjectAutomationWebRuntime({ projectEntry: authorityEntry })
  const collaboratorTasks = new taskWebMod.ProjectTaskWebRuntime({ projectEntry: collaboratorEntry })
  const collaboratorAutomations = new automationWebMod.ProjectAutomationWebRuntime({ projectEntry: collaboratorEntry })
  const delegates = (tasks, automations) => ({ taskDelegate: { state: () => tasks.state(), action: input => tasks.action(input) }, automationDelegate: { state: () => automations.state(), action: input => automations.action(input) } })
  const authorityBusiness = new businessMod.ProjectBusinessSyncRuntime({ projectEntry: authorityEntry, ...delegates(authorityTasks, authorityAutomations), refreshMs: 60_000 })
  let collaboratorBusiness = new businessMod.ProjectBusinessSyncRuntime({ projectEntry: collaboratorEntry, ...delegates(collaboratorTasks, collaboratorAutomations), refreshMs: 60_000 })
  await authorityBusiness.initialize()
  await collaboratorBusiness.initialize()

  const createTask = async (commandId, title) => (await authorityTasks.action({ commandId, type: 'create', expectedRevision: 0, payload: { title } })).task
  const firstTask = await createTask('business_api_task', 'Remote task')
  await recoverBoth(authorityBusiness, collaboratorBusiness)

  const routes = new Map(), cleanups = []
  const register = business => {
    const scopedRoutes = new Map(), scopedCleanups = []
    const ctx = apiHarness(scopedRoutes, scopedCleanups)
    indexMod.registerProjectTaskApi(ctx, collaboratorTasks, business)
    indexMod.registerProjectAutomationApi(ctx, collaboratorAutomations, business)
    return { routes: scopedRoutes, cleanups: scopedCleanups }
  }
  const initial = register(collaboratorBusiness)
  for (const [key, value] of initial.routes) routes.set(key, value)
  cleanups.push(...initial.cleanups)
  return {
    indexMod, authorityHome, collaboratorHome, authorityEntry, collaboratorEntry,
    authorityTasks, authorityAutomations, collaboratorTasks, collaboratorAutomations,
    authorityBusiness, get collaboratorBusiness() { return collaboratorBusiness }, set collaboratorBusiness(value) { collaboratorBusiness = value },
    routes, cleanups, firstTask, createTask, register,
    async close() {
      for (const cleanup of cleanups.reverse()) await cleanup()
      await closeAll([['collaborator business', collaboratorBusiness], ['authority business', authorityBusiness], ['collaborator automation', collaboratorAutomations], ['collaborator tasks', collaboratorTasks], ['authority automation', authorityAutomations], ['authority tasks', authorityTasks], ['collaborator entry', collaboratorEntry], ['authority entry', authorityEntry]])
      await rm(authorityHome, { recursive: true, force: true }); await rm(collaboratorHome, { recursive: true, force: true })
    }
  }
}

test('M4 collaborator API exposes safe cache, exact remote writes, fixed denials, revocation safety, and refetch-only SSE', async () => {
  const fx = await fixture()
  let streamRequest, streamResponse
  try {
    const state = await invoke(fx.routes, taskStatePath)
    assert.equal(state.res.status, 200)
    assert.equal(state.data.capability.mode, 'collaborator')
    assert.equal(state.data.capability.available, true)
    assert.equal(state.data.tasks.some(task => task.taskRef === fx.firstTask.taskRef), true)
    const encodedState = JSON.stringify(state.data)
    for (const forbidden of ['projectRef', 'actorRef', 'sessionId', 'deviceRef', 'transport', 'path', 'messageRef', 'effectKey', 'approvalRef']) assert.equal(encodedState.includes(forbidden), false, forbidden)

    const events = await invoke(fx.routes, taskEventsPath, 'GET', `${taskEventsPath}?afterRevision=0&limit=10`)
    assert.deepEqual(events.data.events, [])
    assert.equal(events.data.reset, true)
    const automation = await invoke(fx.routes, automationStatePath)
    assert.equal(automation.data.capability.mode, 'collaborator')
    assert.equal(JSON.stringify(automation.data).includes('approvalRef'), false)

    const forged = await invoke(fx.routes, taskActionPath, 'POST', taskActionPath, { commandId: 'forged_target', type: 'claim', taskRef: fx.firstTask.taskRef, expectedRevision: fx.firstTask.revision, payload: {}, targetDeviceRef: fx.authorityEntry.device.device.deviceRef })
    assert.equal(forged.res.status, 400)
    assert.deepEqual(Object.keys(forged.data.error).sort(), ['code', 'action', 'retryable'].sort())
    assert.equal(JSON.stringify(forged.data).includes(fx.authorityHome), false)

    const liveLan = fx.collaboratorEntry.lanClient, claimInput = { commandId: 'remote_api_claim', type: 'claim', taskRef: fx.firstTask.taskRef, expectedRevision: fx.firstTask.revision, payload: {} }
    let queued, exactRetry, drift
    try { fx.collaboratorEntry.lanClient = { canSend: () => false }; queued = await invoke(fx.routes, taskActionPath, 'POST', taskActionPath, claimInput); exactRetry = await invoke(fx.routes, taskActionPath, 'POST', taskActionPath, claimInput); drift = await invoke(fx.routes, taskActionPath, 'POST', taskActionPath, { ...claimInput, type: 'transition', payload: { to: 'in_progress' } }) }
    finally { fx.collaboratorEntry.lanClient = liveLan }
    assert.equal(queued.res.status, 200); assert.deepEqual(queued.data, { queued: true, commandId: 'remote_api_claim', resource: 'task' }); assert.deepEqual(exactRetry.data, queued.data, 'an offline exact retry reuses the durable command'); assert.equal(drift.res.status, 409); assert.equal(drift.data.error.code, 'PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT')
    let completed
    for (let attempt = 0; attempt < 12; attempt += 1) { await recoverBoth(fx.authorityBusiness, fx.collaboratorBusiness, 2); completed = await invoke(fx.routes, taskActionPath, 'POST', taskActionPath, claimInput); if (completed.res.status === 200 && completed.data.queued === false) break }
    assert.equal(completed.res.status, 200); assert.equal(completed.data.queued, false); assert.equal(completed.data.result.outcome, 'accepted'); assert.equal(completed.data.result.task.taskRef, fx.firstTask.taskRef)
    for (const hidden of ['messageRef', 'requestDigest', 'actorRef', 'deviceRef']) assert.equal(JSON.stringify(completed.data).includes(hidden), false)
    let claimedState
    for (let attempt = 0; attempt < 12; attempt += 1) { await recoverBoth(fx.authorityBusiness, fx.collaboratorBusiness, 2); claimedState = await invoke(fx.routes, taskStatePath); if (claimedState.data.tasks.find(task => task.taskRef === fx.firstTask.taskRef).hasAssignee) break }
    assert.equal(claimedState.data.tasks.find(task => task.taskRef === fx.firstTask.taskRef).hasAssignee, true)

    const stale = await invoke(fx.routes, taskActionPath, 'POST', taskActionPath, { commandId: 'stale_revision', type: 'claim', taskRef: fx.firstTask.taskRef, expectedRevision: fx.firstTask.revision + 1, payload: {} })
    assert.equal(stale.res.status, 409)
    assert.equal(stale.data.error.code, 'PROJECT_BUSINESS_SYNC_CONFLICT')
    const unsupported = await invoke(fx.routes, taskActionPath, 'POST', taskActionPath, { commandId: 'remote_comment', type: 'comment', taskRef: fx.firstTask.taskRef, expectedRevision: fx.firstTask.revision, payload: { body: 'forbidden' } })
    assert.equal(unsupported.res.status, 403)
    const forgedApproval = await invoke(fx.routes, automationActionPath, 'POST', automationActionPath, { commandId: 'forged_approval', type: 'approve', runRef: 'run_forged', expectedRevision: 1, payload: {}, approvalRef: 'approval_forged' })
    assert.equal(forgedApproval.res.status, 400)

    streamRequest = request('GET', taskStreamPath)
    streamResponse = response()
    await fx.routes.get(taskStreamPath).handler(streamRequest, streamResponse)
    assert.match(streamResponse.chunks.join(''), /event: reset/u)
    assert.equal(streamResponse.chunks.join('').includes(fx.firstTask.taskRef), false)

    await fx.authorityEntry.persisted.mutate('revokeDevice', { actorDeviceRef: fx.authorityEntry.device.device.deviceRef, targetDeviceRef: fx.collaboratorEntry.device.device.deviceRef, reason: 'API revocation' })
    await fx.createTask('business_api_post_revoke', 'Post-revocation task')
    await recoverBoth(fx.authorityBusiness, fx.collaboratorBusiness, 6)
    const afterRevocation = await invoke(fx.routes, taskStatePath)
    assert.equal(afterRevocation.data.tasks.some(task => task.title === 'Post-revocation task'), false, 'revoked connected peer receives no new authority cache data')
    const revokedTransition = await invoke(fx.routes, taskActionPath, 'POST', taskActionPath, { commandId: 'revoked_transition', type: 'transition', taskRef: fx.firstTask.taskRef, expectedRevision: completed.data.result.task.revision, payload: { to: 'canceled' } }); assert.equal(revokedTransition.res.status, 200); assert.equal(revokedTransition.data.queued, true)
    await recoverBoth(fx.authorityBusiness, fx.collaboratorBusiness, 6)
    const authorityStateAfterRevocation = await fx.authorityTasks.state(); assert.equal(authorityStateAfterRevocation.tasks.find(task => task.taskRef === fx.firstTask.taskRef).status, completed.data.result.task.status, 'revoked peer cannot produce a post-revocation Task effect')

    const ssePayload = streamResponse.chunks.join('')
    assert.equal(ssePayload.includes('messageRef'), false)
    assert.equal(ssePayload.includes('taskRef'), false)
  } finally {
    let closeTimer
    try { await Promise.race([fx.close(), new Promise((_, reject) => { closeTimer = setTimeout(() => reject(new Error('fixture close timed out')), 3_000) })]) }
    catch (error) {
      fx.collaboratorEntry.lanClient?.socket?.destroy?.()
      for (const socket of fx.authorityEntry.lanTransport?.socketByDevice?.values?.() ?? []) socket.destroy?.()
      fx.authorityEntry.lanTransport?.server?.close?.()
      throw error
    } finally { clearTimeout(closeTimer) }
    assert.equal(streamResponse?.ended ?? true, true, 'plugin/API disposal ends surviving SSE clients')
  }
})
