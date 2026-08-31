const net = require('node:net')
const path = require('node:path')
const { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto')
const { mkdir, open, readFile, rename, rm } = require('node:fs/promises')
const { createLocalIpcEndpoint } = require('./local-ipc-endpoint.cjs')

const ENDPOINT_ENV = 'HARNESS_DESKTOP_SESSION_LAUNCH_ENDPOINT'
const TOKEN_ENV = 'HARNESS_DESKTOP_SESSION_LAUNCH_TOKEN'
const CALLER_SALT_ENV = 'DSH_AGENT_TEAMS_SESSION_LAUNCH_CALLER_SALT'
const VERSION = 3
const MAX_MESSAGE_BYTES = 64 * 1024
const MAX_TERMINAL_RECORDS = 4096
const MAX_INITIALIZATION_CHARS = 8 * 1024
const MAX_RESOURCES = 32
const MAX_RESOURCE_CHARS = 8 * 1024
const REQUEST_KEYS = new Set(['action', 'token', 'canonicalProjectKey', 'workspacePath', 'callerRootRef', 'projectTicket', 'projectRef', 'boardRef', 'batchRef', 'slotRef', 'operationRef', 'title', 'role', 'resources', 'task', 'initialization', 'requestId', 'decision', 'expectedRevision', 'adoptedActorRef', 'errorCode'])
const TERMINAL = new Set(['ready', 'failed', 'cancelled'])

function serviceError(message, code = 'HOST_SESSION_LAUNCH_UNAVAILABLE', definitive = false) { const error = new Error(message); error.code = code; if (definitive) error.definitive = true; return error }
function text(value, field, max = 512) { if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw serviceError(`${field} is invalid`, 'HOST_SESSION_LAUNCH_INVALID', true); return value }
function exactRequest(value) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !REQUEST_KEYS.has(key))) throw serviceError('request is invalid', 'HOST_SESSION_LAUNCH_INVALID', true); return value }
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function hmac(key, value, encoding = 'base64url') { return createHmac('sha256', key).update(JSON.stringify(value)).digest(encoding) }
function opaque(secret, kind, ...parts) { return `${kind}_${createHash('sha256').update(secret).update('\0').update(kind).update('\0').update(JSON.stringify(parts)).digest('base64url').slice(0, 32)}` }
function defaultEndpoint() { return createLocalIpcEndpoint('atsl', { windowsKind: 'agent-teams-session-launch' }) }
function normalizedScope(value) { const raw = text(value, 'workspacePath', 4096); if (!path.isAbsolute(raw)) throw serviceError('workspacePath is invalid', 'HOST_SESSION_LAUNCH_INVALID', true); const normalized = raw.trim().replace(/\\/gu, '/').replace(/\/+$/u, '').normalize('NFKC'); return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized }
function projectKeyForWorkspace(workspacePath) { return fingerprint(['agent-teams-project-v1', normalizedScope(workspacePath)]) }
function canonicalPath(value) { const resolved = path.resolve(text(value, 'workspacePath', 4096)); return process.platform === 'win32' ? resolved.toLowerCase() : resolved }
function boundedResources(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RESOURCES) throw serviceError('resources invalid', 'HOST_SESSION_LAUNCH_INVALID', true)
  const resources = value.map(item => text(item, 'resource', 1024))
  if (new Set(resources).size !== resources.length || resources.reduce((sum, item) => sum + item.length, 0) > MAX_RESOURCE_CHARS) throw serviceError('resources invalid', 'HOST_SESSION_LAUNCH_INVALID', true)
  return resources
}
function slotInitialization({ boardRef, slotRef, role, resources, task }) {
  const adoptionPayload = JSON.stringify({ slot_ref: slotRef })
  const prompt = [
    `Project board: ${boardRef}`,
    `Assigned seat: ${slotRef}`,
    `Before any project work, call project_collaboration with action "adopt_slot" and payload ${adoptionPayload}.`,
    'Then read the adopted assigned project task before claiming or changing any other task.',
    `Duty: ${role}`,
    'Assigned resources:',
    ...resources.map(resource => `- ${resource}`),
    `Initial project task: ${task}`,
    'Rules:',
    '- You are one real top-level root representing only this assigned seat.',
    '- At adoption and every project-task boundary, call project_collaboration read_requests and answer rows with targetedToMe=true before unrelated work.',
    '- Request kinds are dependency_unblock, release, handoff, and takeover; target responses are accept, reject, or release.',
    '- Respect respondByAt. Use audit_resolve_request only when escalationEligible=true; an early deadline requires explicit direct-user authorization in this root turn, verified by the Host.',
    '- Requests are durable and no-wake: do not poll or wake stopped roots.',
    '- You may manage a private Agent Team only for the current claimed project task and provide it bounded task context.',
    '- Agent Team members must not use project board tools.',
    '- Reconcile Team deliverables yourself into explicit evidence and status for the project; a Team report or completion is not project evidence.',
    '- After submitting the current project task, call project_task claim_next with a new stable request_id and continue one task at a time.',
    '- If blocked, create one durable collaboration request, then seek other eligible work.',
    '- Stop only when claim_next reports all_terminal, or every remaining blocker has a recorded durable request.'
  ].join('\n')
  if (prompt.length > MAX_INITIALIZATION_CHARS) throw serviceError('slot initialization exceeds the Host bound', 'HOST_SESSION_LAUNCH_INVALID', true)
  return prompt
}
function publicOperation(binding, operation) { return { projectRef: binding.projectRef, operationRef: operation.operationRef, state: operation.state, revision: Number.isSafeInteger(operation.revision) ? operation.revision : 1, ...(operation.errorCode ? { errorCode: operation.errorCode } : {}) } }
async function atomicWriteJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`; const handle = await open(temporary, 'wx', 0o600); try { await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8'); await handle.sync() } finally { await handle.close() }; try { await rename(temporary, file) } finally { await rm(temporary, { force: true }).catch(() => undefined) } }
async function startAgentTeamsSessionLaunchService({ createService } = {}) { let service; try { if (typeof createService !== 'function') return null; service = createService(); if (!service || typeof service.start !== 'function' || typeof service.close !== 'function') throw serviceError('invalid service'); await service.start(); return service } catch { try { await service?.close?.() } catch {}; return null } }

function createAgentTeamsSessionLaunchService({ stateFile, callRuntimeRpc, inspectRuntimePrompt = async () => null, endpoint = defaultEndpoint(), token = randomBytes(32), maxMessageBytes = MAX_MESSAGE_BYTES, maxTerminalRecords = MAX_TERMINAL_RECORDS, maxConcurrent = 2, maxConcurrentPerProject = 1, maxSessionsPerBatch = 8 } = {}) {
  text(stateFile, 'stateFile', 4096)
  if (typeof callRuntimeRpc !== 'function') throw new TypeError('callRuntimeRpc is required')
  if (typeof inspectRuntimePrompt !== 'function') throw new TypeError('inspectRuntimePrompt must be a function')
  if (!Buffer.isBuffer(token) || token.length !== 32) throw new TypeError('token must be a 32-byte Buffer')
  for (const [name, value, maximum] of [['maxMessageBytes', maxMessageBytes, MAX_MESSAGE_BYTES], ['maxTerminalRecords', maxTerminalRecords, MAX_TERMINAL_RECORDS], ['maxConcurrent', maxConcurrent, 8], ['maxConcurrentPerProject', maxConcurrentPerProject, 8], ['maxSessionsPerBatch', maxSessionsPerBatch, 64]]) if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError(`${name} is invalid`)
  if (maxConcurrentPerProject > maxConcurrent) throw new TypeError('maxConcurrentPerProject exceeds maxConcurrent')
  const capabilityToken = Buffer.from(token)
  let document, server, callerSalt, closed = false, writeChain = Promise.resolve(), running = 0, projectCursor = 0, pumpScheduled = false
  const runningByProject = new Map(), queues = new Map(), pendingByOperation = new Map(), projectOrder = [], activeJobs = new Set()
  const bindingsByCaller = new Map(), bindingsByTicket = new Map(), operationsByRef = new Map(), operationsBySlot = new Map()
  const laneRefFor = canonicalProjectKey => opaque(document.secret, 'lane', canonicalProjectKey)
  const callerBindingKey = (laneRef, callerRootRef) => `${laneRef}\0${callerRootRef}`
  const ticketBindingKey = (laneRef, callerRootRef, projectTicket) => `${laneRef}\0${callerRootRef}\0${projectTicket}`
  const operationSlotKey = (laneRef, batchRef, slotRef, operationRef) => `${laneRef}\0${batchRef}\0${slotRef}\0${operationRef}`
  const operationRefKey = (laneRef, operationRef) => `${laneRef}\0${operationRef}`
  const expectedCallerRootRef = (canonicalProjectKey, sessionId) => hmac(callerSalt, ['agent-teams-caller-root-v1', canonicalProjectKey, sessionId], 'hex')
  const adoptionCapability = (canonicalProjectKey, parentCallerRootRef, batchRef, slotRef, operationRef) => `adoption_${hmac(Buffer.from(document.secret, 'base64url'), ['agent-teams-adoption-v1', canonicalProjectKey, parentCallerRootRef, batchRef, slotRef, operationRef])}`
  const rebuildIndexes = () => {
    bindingsByCaller.clear(); bindingsByTicket.clear(); operationsByRef.clear(); operationsBySlot.clear()
    for (const binding of document.bindings) {
      bindingsByCaller.set(callerBindingKey(binding.laneRef, binding.callerRootRef), binding)
      bindingsByTicket.set(ticketBindingKey(binding.laneRef, binding.callerRootRef, binding.projectTicket), binding)
    }
    for (const operation of document.operations) {
      operationsByRef.set(operationRefKey(operation.laneRef, operation.operationRef), operation)
      operationsBySlot.set(operationSlotKey(operation.laneRef, operation.batchRef, operation.slotRef, operation.operationRef), operation)
    }
  }
  const authorize = value => { let supplied; try { supplied = Buffer.from(text(value, 'token', 128), 'base64url') } catch { return false }; const valid = supplied.length === capabilityToken.length && timingSafeEqual(supplied, capabilityToken); supplied.fill(0); return valid }
  const compact = () => { const active = document.operations.filter(row => !TERMINAL.has(row.state)); const terminal = document.operations.filter(row => TERMINAL.has(row.state)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxTerminalRecords); document.operations = [...active, ...terminal]; rebuildIndexes() }
  const persist = (shouldCompact = false) => { if (shouldCompact) compact(); const snapshot = { version: VERSION, secret: document.secret, bindings: document.bindings.map(({ canonicalProjectKey, workspacePath, ...binding }) => binding), operations: document.operations.map(({ canonicalProjectKey, workspacePath, ...operation }) => operation) }; writeChain = writeChain.then(() => atomicWriteJson(stateFile, snapshot)); return writeChain }
  const resolveBinding = async request => {
    if (Object.keys(request).some(key => !['action', 'token', 'canonicalProjectKey', 'workspacePath', 'callerRootRef'].includes(key))) throw serviceError('resolveProject request is invalid', 'HOST_SESSION_LAUNCH_INVALID', true)
    const canonicalProjectKey = text(request.canonicalProjectKey, 'canonicalProjectKey', 64), callerRootRef = text(request.callerRootRef, 'callerRootRef', 128)
    if (!/^[a-f0-9]{64}$/u.test(canonicalProjectKey) || !/^[a-f0-9]{64}$/u.test(callerRootRef) || projectKeyForWorkspace(request.workspacePath) !== canonicalProjectKey) throw serviceError('canonical project binding is invalid', 'HOST_SESSION_LAUNCH_PROJECT_MISMATCH', true)
    const workspacePath = path.resolve(request.workspacePath), laneRef = laneRefFor(canonicalProjectKey)
    let binding = bindingsByCaller.get(callerBindingKey(laneRef, callerRootRef))
    if (!binding) { binding = { laneRef, canonicalProjectKey, workspacePath, callerRootRef, projectRef: opaque(document.secret, 'project', laneRef), boardRef: opaque(document.secret, 'board', laneRef), rootSessionRef: opaque(document.secret, 'root', laneRef, callerRootRef), projectTicket: opaque(document.secret, 'ticket', laneRef, callerRootRef), createdAt: Date.now() }; document.bindings.push(binding); bindingsByCaller.set(callerBindingKey(laneRef, callerRootRef), binding); bindingsByTicket.set(ticketBindingKey(laneRef, callerRootRef, binding.projectTicket), binding); await persist() }
    else { if (binding.workspacePath !== undefined && canonicalPath(binding.workspacePath) !== canonicalPath(workspacePath)) throw serviceError('canonical project binding conflicts with path', 'HOST_SESSION_LAUNCH_PROJECT_MISMATCH', true); binding.canonicalProjectKey = canonicalProjectKey; binding.workspacePath = workspacePath }
    return binding
  }
  const boundProject = request => { const canonicalProjectKey = text(request.canonicalProjectKey, 'canonicalProjectKey', 64), laneRef = laneRefFor(canonicalProjectKey); const binding = bindingsByTicket.get(ticketBindingKey(laneRef, request.callerRootRef, request.projectTicket)); if (!binding || request.projectRef !== binding.projectRef || request.boardRef !== binding.boardRef || binding.canonicalProjectKey !== canonicalProjectKey) throw serviceError('project ticket mismatch', 'HOST_SESSION_LAUNCH_PROJECT_MISMATCH', true); return binding }
  const lookup = (binding, request) => { const operation = operationsByRef.get(operationRefKey(binding.laneRef, text(request.operationRef, 'operationRef', 128))); if (!operation) throw serviceError('operation not found', 'HOST_SESSION_LAUNCH_NOT_FOUND', true); if (operation.laneRef !== binding.laneRef || operation.callerRootRef !== binding.callerRootRef) throw serviceError('operation binding mismatch', 'HOST_SESSION_LAUNCH_PROJECT_MISMATCH', true); return operation }
  const lookupAdopted = (binding, request) => { const operation = operationsByRef.get(operationRefKey(binding.laneRef, text(request.operationRef, 'operationRef', 128))); if (!operation || operation.batchRef !== text(request.batchRef, 'batchRef', 128) || operation.slotRef !== text(request.slotRef, 'slotRef', 128)) throw serviceError('adoption operation not found', 'HOST_SESSION_ADOPTION_FORBIDDEN', true); const childRef=expectedCallerRootRef(binding.canonicalProjectKey, operation.sessionId); if(binding.callerRootRef!==childRef) throw serviceError('adoption operation belongs to another root', 'HOST_SESSION_ADOPTION_FORBIDDEN', true); return operation }
  const cleanupLane = key => { if (queues.has(key) || runningByProject.has(key)) return; const index = projectOrder.indexOf(key); if (index >= 0) projectOrder.splice(index, 1); projectCursor = projectOrder.length ? projectCursor % projectOrder.length : 0 }
  const schedulePump = () => { if (closed || pumpScheduled) return; pumpScheduled = true; queueMicrotask(() => { pumpScheduled = false; void pump() }) }
  const enqueue = (binding, operation) => { const pendingKey = operationRefKey(binding.laneRef, operation.operationRef), old = pendingByOperation.get(pendingKey); if (old) return old; const pending = new Promise((resolve, reject) => { const queue = queues.get(binding.laneRef) || []; queue.push({ binding, operation, resolve, reject }); queues.set(binding.laneRef, queue); if (!projectOrder.includes(binding.laneRef)) projectOrder.push(binding.laneRef); schedulePump() }).finally(() => pendingByOperation.delete(pendingKey)); pendingByOperation.set(pendingKey, pending); return pending }
  const pump = async () => { while (!closed && running < maxConcurrent) { let selected; for (let offset = 0; offset < projectOrder.length; offset += 1) { const index = (projectCursor + offset) % projectOrder.length, key = projectOrder[index]; if ((runningByProject.get(key) || 0) >= maxConcurrentPerProject) continue; const queue = queues.get(key); if (queue?.length) { selected = queue.shift(); if (!queue.length) queues.delete(key); projectCursor = projectOrder.length ? (index + 1) % projectOrder.length : 0; break } } if (!selected) return; const key = selected.binding.laneRef; running += 1; runningByProject.set(key, (runningByProject.get(key) || 0) + 1); const job = executeLaunch(selected.binding, selected.operation).then(selected.resolve, selected.reject).finally(() => { activeJobs.delete(job); running -= 1; const left = (runningByProject.get(key) || 1) - 1; if (left) runningByProject.set(key, left); else runningByProject.delete(key); cleanupLane(key); schedulePump() }); activeJobs.add(job) } }
  const executeLaunch = async (binding, operation) => {
    if (operation.state === 'cancelled') return publicOperation(binding, operation)
    operation.state = 'starting'; operation.updatedAt = Date.now(); await persist()
    try {
      if (!operation.workspaceId) {
        operation.phase = 'workspace_dispatched'; operation.updatedAt = Date.now(); await persist()
        const workspace = await callRuntimeRpc('workspace/create', { args: { request: { path: binding.workspacePath } } })
        operation.workspaceId = text(workspace?.workspace?.workspaceId, 'workspaceId', 512)
        if (canonicalPath(workspace.workspace.path) !== canonicalPath(binding.workspacePath)) throw serviceError('workspace mismatch', 'HOST_SESSION_LAUNCH_PROVIDER_MISMATCH', true)
      }
      if (['workspace_dispatched', 'session_dispatched'].includes(operation.phase)) {
        operation.phase = 'session_dispatched'; operation.updatedAt = Date.now(); await persist()
        const observed = await callRuntimeRpc('session/list', { args: { _request: {} } })
        if (!observed || !Array.isArray(observed.items)) throw serviceError('session/list shape invalid')
        if (!observed.items.some(row => row?.sessionId === operation.sessionId)) {
          const created = await callRuntimeRpc('session/create', { args: { request: { workspaceId: operation.workspaceId, sessionId: operation.sessionId } } })
          if (created?.sessionId !== operation.sessionId) throw serviceError('session mismatch', 'HOST_SESSION_LAUNCH_PROVIDER_MISMATCH', true)
        }
        operation.phase = 'session_ready'; operation.updatedAt = Date.now(); await persist()
      }
      if (operation.phase === 'session_ready') {
        const renamed = await callRuntimeRpc('session/rename', { args: { request: { sessionId: operation.sessionId, title: operation.title } } })
        if (renamed?.title !== operation.title || !Number.isSafeInteger(renamed?.seq) || renamed.seq < 0) throw serviceError('session rename receipt invalid', 'HOST_SESSION_LAUNCH_PROVIDER_MISMATCH', true)
        operation.renameSeq = renamed.seq; operation.phase = 'renamed'; operation.updatedAt = Date.now(); await persist()
      }
      if (operation.phase === 'renamed') {
        if (!operation.promptRequestId) { operation.promptRequestId = opaque(document.secret, 'prompt', operation.laneRef, operation.operationRef); operation.updatedAt = Date.now(); await persist() }
        operation.phase = 'prompt_dispatched'; operation.updatedAt = Date.now(); await persist()
        const prompted = await callRuntimeRpc('session/prompt', { args: { request: { requestId: operation.promptRequestId, sessionId: operation.sessionId, mode: 'queue', content: [{ type: 'text', text: operation.initialization }] } } })
        if (prompted?.accepted !== true) throw serviceError('session prompt receipt invalid', 'HOST_SESSION_LAUNCH_PROVIDER_MISMATCH', true)
        operation.phase = 'prompted'; operation.state = 'ready'; delete operation.errorCode
      } else if (operation.phase === 'prompted') { operation.state = 'ready'; delete operation.errorCode }
      else if (operation.phase === 'prompt_dispatched') throw serviceError('prompt dispatch outcome requires explicit reconciliation', 'HOST_SESSION_LAUNCH_OUTCOME_UNKNOWN')
    } catch (error) {
      operation.state = operation.phase === 'prompt_dispatched' || error?.definitive !== true ? 'outcome_unknown' : 'failed'
      operation.errorCode = error?.code || 'HOST_SESSION_LAUNCH_OUTCOME_UNKNOWN'
    }
    operation.updatedAt = Date.now(); await persist(TERMINAL.has(operation.state)); return publicOperation(binding, operation)
  }
  const reconcile = async (binding, operation) => {
    if (operation.state === 'queued' || operation.state === 'ready' || operation.state === 'failed' || operation.state === 'cancelled') return publicOperation(binding, operation)
    try {
      const sessions = await callRuntimeRpc('session/list', { args: { _request: {} } })
      if (!sessions || !Array.isArray(sessions.items)) throw serviceError('session/list shape invalid')
      const exists = sessions.items.some(row => row?.sessionId === operation.sessionId)
      if (exists && operation.phase === 'session_dispatched') { operation.phase = 'session_ready'; operation.updatedAt = Date.now(); await persist() }
      if (operation.phase === 'prompted') { operation.state = 'ready'; delete operation.errorCode; operation.updatedAt = Date.now(); await persist(true) }
    } catch { operation.state = 'outcome_unknown'; operation.errorCode = 'HOST_SESSION_LAUNCH_OUTCOME_UNKNOWN'; operation.updatedAt = Date.now(); await persist() }
    return publicOperation(binding, operation)
  }
  const resolveUnknown = async (binding, operation, request) => {
    const requestId = text(request.requestId, 'requestId', 256), decision = text(request.decision, 'decision', 32)
    if (!['delivered', 'not_delivered'].includes(decision) || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) throw serviceError('reconciliation input is invalid', 'HOST_SESSION_LAUNCH_INVALID', true)
    const digest = fingerprint({ laneRef: binding.laneRef, callerRootRef: binding.callerRootRef, operationRef: operation.operationRef, decision })
    if (operation.reconciliation?.requestId === requestId) { if (operation.reconciliation.digest !== digest) throw serviceError('reconciliation request conflict', 'HOST_SESSION_LAUNCH_IDEMPOTENCY_CONFLICT', true); return publicOperation(binding, operation) }
    const revision = Number.isSafeInteger(operation.revision) ? operation.revision : 1
    if (request.expectedRevision !== revision) throw serviceError('reconciliation revision conflict', 'HOST_SESSION_LAUNCH_CONFLICT', true)
    if (operation.state !== 'outcome_unknown' || operation.phase !== 'prompt_dispatched') throw serviceError('only an uncertain prompt dispatch may be reconciled', 'HOST_SESSION_LAUNCH_RECONCILIATION_FORBIDDEN', true)
    const evidence = await inspectRuntimePrompt({ sessionId: operation.sessionId, requestId: operation.promptRequestId, decision })
    const expectedDelivered = decision === 'delivered'
    if (!evidence || evidence.rpcId !== operation.promptRequestId || evidence.delivered !== expectedDelivered || !['session/control', 'session/follow'].includes(evidence.source)) throw serviceError('exact durable prompt evidence is unavailable', 'HOST_SESSION_LAUNCH_RECONCILIATION_FORBIDDEN', true)
    if (decision === 'delivered') { operation.phase = 'prompted'; operation.state = 'ready'; delete operation.errorCode }
    else { operation.phase = 'renamed'; operation.state = 'failed'; operation.errorCode = 'HOST_SESSION_PROMPT_NOT_DELIVERED' }
    operation.revision = revision + 1; operation.reconciliation = { requestId, digest, decision, source: evidence.source, rpcId: evidence.rpcId, resolvedAt: Date.now() }; operation.updatedAt = operation.reconciliation.resolvedAt
    await persist(true); return publicOperation(binding, operation)
  }
  const handleRequest = async raw => { const request = exactRequest(raw); if (!authorize(request.token) || closed) throw serviceError('Host session launch capability is unavailable'); if (request.action === 'resolveProject') { const binding = await resolveBinding(request); return { projectRef: binding.projectRef, boardRef: binding.boardRef, rootSessionRef: binding.rootSessionRef, projectTicket: binding.projectTicket, maxSessions: maxSessionsPerBatch } } const binding = boundProject(request); if (request.action === 'reserveAdoption') { const batchRef = text(request.batchRef, 'batchRef', 128), slotRef = text(request.slotRef, 'slotRef', 128), operationRef = text(request.operationRef, 'operationRef', 128); const existing = operationsBySlot.get(operationSlotKey(binding.laneRef, batchRef, slotRef, operationRef)); if (existing && existing.callerRootRef !== binding.callerRootRef) throw serviceError('adoption reservation is unavailable', 'HOST_SESSION_ADOPTION_FORBIDDEN', true); return { projectRef: binding.projectRef, operationRef, adoptionCapability: adoptionCapability(binding.laneRef, binding.callerRootRef, batchRef, slotRef, operationRef) } } if (request.action === 'recordAdoption') { const operation=lookupAdopted(binding,request),adoptedActorRef=text(request.adoptedActorRef,'adoptedActorRef',256); if(operation.state!=='ready') throw serviceError('only a ready exact child may record adoption','HOST_SESSION_ADOPTION_FORBIDDEN',true); if(operation.adoptedCallerRootRef!==undefined&&(operation.adoptedCallerRootRef!==binding.callerRootRef||operation.adoptedActorRef!==adoptedActorRef)) throw serviceError('adoption binding changed','HOST_SESSION_ADOPTION_FORBIDDEN',true); operation.adoptedCallerRootRef=binding.callerRootRef; operation.adoptedActorRef=adoptedActorRef; operation.updatedAt=Date.now(); await persist(true); return publicOperation(binding,operation) } if (request.action === 'recordFailure') { const operation=lookupAdopted(binding,request); if(operation.adoptedCallerRootRef!==binding.callerRootRef||typeof operation.adoptedActorRef!=='string') throw serviceError('adopted root binding is unavailable','HOST_SESSION_ADOPTION_FORBIDDEN',true); if(operation.state==='failed') return publicOperation(binding,operation); if(operation.state!=='ready') throw serviceError('only a ready adopted root may record lifecycle failure','HOST_SESSION_LAUNCH_RECONCILIATION_FORBIDDEN',true); operation.state='failed'; operation.errorCode='HOST_SESSION_LIFECYCLE_FAILED'; operation.revision=(Number.isSafeInteger(operation.revision)?operation.revision:1)+1; operation.updatedAt=Date.now(); await persist(true); return publicOperation(binding,operation) } if (request.action === 'resolveUnknown') { return resolveUnknown(binding, lookup(binding, request), request) } if (request.action === 'retry') { const operation = lookup(binding, request); if (operation.state === 'outcome_unknown' && operation.phase === 'prompt_dispatched') throw serviceError('prompt dispatch outcome requires explicit Host reconciliation', 'HOST_SESSION_LAUNCH_OUTCOME_UNKNOWN', true); if (operation.state === 'ready' || operation.state === 'starting' || operation.state === 'queued') return publicOperation(binding, operation); if (!['failed', 'outcome_unknown'].includes(operation.state)) throw serviceError('only a failed or explicitly reconciled resumable launch may retry', 'HOST_SESSION_LAUNCH_RETRY_FORBIDDEN', true); operation.state = 'queued'; delete operation.errorCode; operation.updatedAt = Date.now(); await persist(); return enqueue(binding, operation) } if (request.action === 'launch') { const material = { laneRef: binding.laneRef, callerRootRef: binding.callerRootRef, projectRef: binding.projectRef, boardRef: binding.boardRef, batchRef: text(request.batchRef, 'batchRef', 128), slotRef: text(request.slotRef, 'slotRef', 128), operationRef: text(request.operationRef, 'operationRef', 128), title: text(request.title, 'title', 200), role: text(request.role, 'role', 1000), resources: boundedResources(request.resources), task: text(request.task, 'task', 4000) }; material.initialization = slotInitialization(material); const intentHash = fingerprint(material); let operation = operationsByRef.get(operationRefKey(binding.laneRef, material.operationRef)); if (operation) { if (operation.intentHash !== intentHash || operation.laneRef !== binding.laneRef || operation.callerRootRef !== binding.callerRootRef) throw serviceError('idempotency conflict', 'HOST_SESSION_LAUNCH_IDEMPOTENCY_CONFLICT', true); return operation.state === 'queued' ? enqueue(binding, operation) : publicOperation(binding, operation) } compact(); operation = { ...material, intentHash, sessionId: randomUUID(), state: 'queued', phase: 'reserved', createdAt: Date.now(), updatedAt: Date.now() }; document.operations.push(operation); operationsByRef.set(operationRefKey(operation.laneRef, operation.operationRef), operation); operationsBySlot.set(operationSlotKey(operation.canonicalProjectKey, operation.batchRef, operation.slotRef, operation.operationRef), operation); await persist(); return enqueue(binding, operation) } if (request.action === 'redeemAdoption') { const batchRef = text(request.batchRef, 'batchRef', 128), slotRef = text(request.slotRef, 'slotRef', 128), operationRef = text(request.operationRef, 'operationRef', 128); const operation = operationsBySlot.get(operationSlotKey(binding.laneRef, batchRef, slotRef, operationRef)); if (!operation || operation.state !== 'ready' || operation.callerRootRef === binding.callerRootRef || request.callerRootRef !== expectedCallerRootRef(binding.canonicalProjectKey, operation.sessionId)) throw serviceError('adoption capability is unavailable', 'HOST_SESSION_ADOPTION_FORBIDDEN', true); return { projectRef: binding.projectRef, operationRef, adoptionCapability: adoptionCapability(binding.laneRef, operation.callerRootRef, batchRef, slotRef, operationRef) } } const operation = lookup(binding, request); if (request.action === 'reconcile') return reconcile(binding, operation); if (request.action === 'cancel') { if (operation.state !== 'queued') return { ...publicOperation(binding, operation), cancelled: false }; operation.state = 'cancelled'; operation.phase = 'cancelled'; operation.updatedAt = Date.now(); const queue = queues.get(binding.laneRef) || []; for (const item of queue.filter(row => row.operation === operation)) item.resolve(publicOperation(binding, operation)); const left = queue.filter(row => row.operation !== operation); if (left.length) queues.set(binding.laneRef, left); else queues.delete(binding.laneRef); cleanupLane(binding.laneRef); await persist(true); return { ...publicOperation(binding, operation), cancelled: true } } throw serviceError('action invalid', 'HOST_SESSION_LAUNCH_INVALID', true) }
  const start = async () => { if (closed) throw serviceError('closed'); if (server) return; try { document = JSON.parse(await readFile(stateFile, 'utf8')); if (![2, VERSION].includes(document?.version) || typeof document.secret !== 'string' || !Array.isArray(document.bindings) || !Array.isArray(document.operations)) throw new Error('invalid') } catch (error) { if (error?.code !== 'ENOENT') throw serviceError('state invalid', 'HOST_SESSION_LAUNCH_STATE_INVALID'); document = { version: VERSION, secret: randomBytes(32).toString('base64url'), bindings: [], operations: [] } } if (document.version === 2) { for (const binding of document.bindings) { binding.laneRef = opaque(document.secret, 'lane', binding.canonicalProjectKey) } for (const operation of document.operations) { operation.laneRef = opaque(document.secret, 'lane', operation.canonicalProjectKey); operation.intentHash = fingerprint({ laneRef: operation.laneRef, callerRootRef: operation.callerRootRef, projectRef: operation.projectRef, boardRef: operation.boardRef, batchRef: operation.batchRef, slotRef: operation.slotRef, operationRef: operation.operationRef, title: operation.title, role: operation.role, resources: operation.resources, task: operation.task, initialization: operation.initialization }) } document.version = VERSION } callerSalt = createHmac('sha256', Buffer.from(document.secret, 'base64url')).update('agent-teams-caller-salt-v1').digest(); rebuildIndexes(); for (const operation of document.operations) if (!Number.isSafeInteger(operation.revision)) operation.revision = 1; for (const operation of document.operations) if (operation.state === 'starting') { operation.state = 'outcome_unknown'; operation.errorCode = 'HOST_SESSION_LAUNCH_OUTCOME_UNKNOWN' } await persist(true); if (process.platform !== 'win32') await rm(endpoint, { force: true }).catch(() => undefined); server = net.createServer(socket => { let bytes = 0, body = ''; socket.setEncoding('utf8'); socket.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > maxMessageBytes) return socket.destroy(); body += chunk; const newline = body.indexOf('\n'); if (newline < 0) return; socket.pause(); let request; try { request = JSON.parse(body.slice(0, newline)) } catch {}; Promise.resolve(request ? handleRequest(request) : Promise.reject(serviceError('invalid', 'HOST_SESSION_LAUNCH_INVALID', true))).then(result => socket.end(`${JSON.stringify({ ok: true, result })}\n`)).catch(error => socket.end(`${JSON.stringify({ ok: false, code: error?.code || 'HOST_SESSION_LAUNCH_UNAVAILABLE', definitive: error?.definitive === true })}\n`)) }); socket.on('error', () => undefined) }); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, () => { server.off('error', reject); resolve() }) }) }
  const runtimeEnvironment = (env = {}) => { if (!server || closed) throw serviceError('not ready'); return { ...env, [ENDPOINT_ENV]: endpoint, [TOKEN_ENV]: capabilityToken.toString('base64url'), [CALLER_SALT_ENV]: callerSalt.toString('base64url') } }
  const close = async () => { if (closed) return; closed = true; capabilityToken.fill(0); callerSalt?.fill(0); for (const queue of queues.values()) for (const item of queue) { item.operation.state = 'cancelled'; item.resolve(publicOperation(item.binding, item.operation)) } queues.clear(); projectOrder.length = 0; await persist(true).catch(() => undefined); const active = server; server = undefined; if (active) await new Promise(resolve => active.close(resolve)); await Promise.allSettled([...activeJobs]); await writeChain.catch(() => undefined); if (process.platform !== 'win32') await rm(endpoint, { force: true }).catch(() => undefined) }
  const diagnostics = () => ({ running, queued: [...queues.values()].reduce((sum, queue) => sum + queue.length, 0), activeProjectLanes: projectOrder.length, records: document?.operations.length || 0, terminalRecords: document?.operations.filter(row => TERMINAL.has(row.state)).length || 0, bindingIndexSize: bindingsByCaller.size, ticketIndexSize: bindingsByTicket.size, operationIndexSize: operationsByRef.size, operationSlotIndexSize: operationsBySlot.size })
  return Object.freeze({ start, runtimeEnvironment, close, endpoint, handleRequest, diagnostics })
}
module.exports = { ENDPOINT_ENV, TOKEN_ENV, CALLER_SALT_ENV, createAgentTeamsSessionLaunchService, startAgentTeamsSessionLaunchService, projectKeyForWorkspace }
