const net = require('node:net')
const path = require('node:path')
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto')
const { mkdir, open, readFile, rename, rm } = require('node:fs/promises')
const { createLocalIpcEndpoint } = require('./local-ipc-endpoint.cjs')

const ENDPOINT_ENV = 'HARNESS_DESKTOP_AUTHORIZATION_ENDPOINT'
const TOKEN_ENV = 'HARNESS_DESKTOP_AUTHORIZATION_TOKEN'
const AUTHORIZATION_VERSION = 1
const RECEIPT_TTL_MS = 60_000
const MAX_RECEIPT_TTL_MS = 2 * 60_000
const AUTOPILOT_RECEIPT_TTL_MS = 15_000
const MAX_AUTOPILOT_RECEIPT_TTL_MS = 30_000
const DIALOG_TIMEOUT_MS = 2 * 60_000
const MAX_MESSAGE_BYTES = 64 * 1024
const MAX_CONSUMED = 4096
const MAX_PENDING_AUTOPILOT = 256
const REQUEST_KEYS = Object.freeze(['authorizationId', 'tool', 'rootSessionId', 'turnKey', 'teamId', 'taskId', 'effectName', 'attemptId', 'outcome', 'pauseEpoch', 'teamRevision', 'canonicalArgumentsHash'])
const AUTOPILOT_ISSUE_KEYS = Object.freeze(['action', 'sessionId', 'enabled', 'maxMembers', 'maxActiveTurns', 'autopilotEnabled', 'autopilotMaxAdditionalRounds', 'hostAuthorization'])
const AUTOPILOT_UNSCOPED_ISSUE_KEYS = Object.freeze(AUTOPILOT_ISSUE_KEYS.filter(key => key !== 'hostAuthorization'))
const AUTOPILOT_SCOPE_KEYS = Object.freeze(['rootSessionId', 'projectKey', 'goalId', 'teamId', 'pauseEpoch', 'teamScopeHash'])
const AUTOPILOT_REQUEST_KEYS = Object.freeze(['authorizationId', 'sessionId', 'settings', 'hostAuthorization'])
const AUTOPILOT_SETTINGS_KEYS = Object.freeze(['enabled', 'maxMembers', 'maxActiveTurns', 'autopilotEnabled', 'autopilotMaxAdditionalRounds'])
const AUTOPILOT_DESKTOP_BINDING_KEYS = Object.freeze(['senderWebContentsId', 'ownerWindowWebContentsId', 'runtimeOrigin'])
const AUTOPILOT_REVOKE_KEYS = Object.freeze(['authorizationEpoch', 'reason'])
const OUTCOMES = new Set(['succeeded', 'failed', 'not_started'])
const PUBLIC_ERROR_CODES = new Set([
  'HOST_AUTHORIZATION_REPLAY',
  'HOST_AUTHORIZATION_DENIED',
  'HOST_AUTHORIZATION_INVALID',
  'HOST_AUTHORIZATION_STATE_INVALID',
  'HOST_AUTHORIZATION_CAPACITY',
  'HOST_AUTHORIZATION_EXPIRED',
  'HOST_AUTHORIZATION_REVOKED',
  'HOST_AUTHORIZATION_MISMATCH'
])

function authorizationError(code = 'HOST_AUTHORIZATION_UNAVAILABLE') {
  const error = new Error('Host authorization was not granted')
  error.code = code
  return error
}
function strictString(value, max = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  return value
}
function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  return value
}
function canonicalArgumentsHash(value) {
  return createHash('sha256').update(JSON.stringify({ action: 'resolve_unknown', team_id: value.teamId, task_id: value.taskId, effect_name: value.effectName, attempt_id: value.attemptId, outcome: value.outcome })).digest('hex')
}
function validateRequest(value) {
  exactObject(value, REQUEST_KEYS)
  for (const key of ['authorizationId', 'rootSessionId', 'turnKey', 'teamId', 'taskId', 'effectName', 'attemptId']) strictString(value[key])
  if (value.tool !== 'team_task_external_effect' || !OUTCOMES.has(value.outcome)) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  if (!Number.isSafeInteger(value.pauseEpoch) || value.pauseEpoch < 0 || !Number.isSafeInteger(value.teamRevision) || value.teamRevision <= 0) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  if (!/^[a-f0-9]{64}$/u.test(value.canonicalArgumentsHash) || value.canonicalArgumentsHash !== canonicalArgumentsHash(value)) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  return Object.freeze(Object.fromEntries(REQUEST_KEYS.map(key => [key, value[key]])))
}
function validateAutopilotSettings(value) {
  exactObject(value, AUTOPILOT_SETTINGS_KEYS)
  if (typeof value.enabled !== 'boolean' || typeof value.autopilotEnabled !== 'boolean') throw authorizationError('HOST_AUTHORIZATION_INVALID')
  if (!Number.isSafeInteger(value.maxMembers) || value.maxMembers < 1 || value.maxMembers > 8) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  if (!Number.isSafeInteger(value.maxActiveTurns) || value.maxActiveTurns < 1 || value.maxActiveTurns > 8) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  if (!Number.isSafeInteger(value.autopilotMaxAdditionalRounds) || value.autopilotMaxAdditionalRounds < 1 || value.autopilotMaxAdditionalRounds > 200) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  return Object.freeze(Object.fromEntries(AUTOPILOT_SETTINGS_KEYS.map(key => [key, value[key]])))
}
function validateAutopilotScope(value) {
  exactObject(value, AUTOPILOT_SCOPE_KEYS)
  for (const key of ['rootSessionId', 'goalId', 'teamId']) strictString(value[key])
  if (!/^[a-f0-9]{64}$/u.test(strictString(value.projectKey, 64)) || !/^[a-f0-9]{64}$/u.test(strictString(value.teamScopeHash, 64))) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  if (!Number.isSafeInteger(value.pauseEpoch) || value.pauseEpoch < 0) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  return Object.freeze(Object.fromEntries(AUTOPILOT_SCOPE_KEYS.map(key => [key, value[key]])))
}
function validateAutopilotIssue(value) {
  const hasScope = Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'hostAuthorization'))
  exactObject(value, hasScope ? AUTOPILOT_ISSUE_KEYS : AUTOPILOT_UNSCOPED_ISSUE_KEYS)
  if (value.action !== 'settings') throw authorizationError('HOST_AUTHORIZATION_INVALID')
  const sessionId = strictString(value.sessionId)
  const settings = validateAutopilotSettings(Object.fromEntries(AUTOPILOT_SETTINGS_KEYS.map(key => [key, value[key]])))
  if (!hasScope) {
    // A trusted user-activated Save may persist the default-on preference before
    // any team exists. The null scope deliberately carries no Goal authority.
    return Object.freeze({ sessionId, settings, hostAuthorization: null })
  }
  const scope = validateAutopilotScope(value.hostAuthorization)
  if (sessionId !== scope.rootSessionId) throw authorizationError('HOST_AUTHORIZATION_MISMATCH')
  return Object.freeze({ sessionId, settings, hostAuthorization: scope })
}
function validateAutopilotRequest(value) {
  exactObject(value, AUTOPILOT_REQUEST_KEYS)
  const authorizationId = strictString(value.authorizationId)
  const sessionId = strictString(value.sessionId)
  const settings = validateAutopilotSettings(value.settings)
  const hostAuthorization = value.hostAuthorization === null ? null : validateAutopilotScope(value.hostAuthorization)
  if (hostAuthorization !== null && sessionId !== hostAuthorization.rootSessionId) throw authorizationError('HOST_AUTHORIZATION_MISMATCH')
  return Object.freeze({ authorizationId, sessionId, settings, hostAuthorization })
}
function validateDesktopBinding(value) {
  exactObject(value, AUTOPILOT_DESKTOP_BINDING_KEYS)
  if (!Number.isSafeInteger(value.senderWebContentsId) || value.senderWebContentsId <= 0
    || !Number.isSafeInteger(value.ownerWindowWebContentsId) || value.ownerWindowWebContentsId <= 0) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  const runtimeOrigin = strictString(value.runtimeOrigin, 2048)
  let parsed
  try { parsed = new URL(runtimeOrigin) } catch { throw authorizationError('HOST_AUTHORIZATION_INVALID') }
  if (parsed.origin !== runtimeOrigin || parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname.toLowerCase())) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  return Object.freeze({ senderWebContentsId: value.senderWebContentsId, ownerWindowWebContentsId: value.ownerWindowWebContentsId, runtimeOrigin })
}
function validateAuthorizationEpoch(value) {
  const epoch = strictString(value, 128)
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(epoch)) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  return epoch
}
function validateAutopilotRevoke(value) {
  exactObject(value, AUTOPILOT_REVOKE_KEYS)
  return Object.freeze({ authorizationEpoch: validateAuthorizationEpoch(value.authorizationEpoch), reason: strictString(value.reason, 256) })
}
function autopilotBindingHash(value) {
  return createHash('sha256').update(JSON.stringify([value.sessionId, value.hostAuthorization, AUTOPILOT_SETTINGS_KEYS.map(key => value.settings[key])])).digest('hex')
}
function autopilotSettingsHash(settings) {
  return createHash('sha256').update(JSON.stringify(['agent-teams-autopilot-settings-v1', AUTOPILOT_SETTINGS_KEYS.map(key => settings[key])])).digest('hex')
}
function desktopBindingHash(value) {
  return createHash('sha256').update(JSON.stringify(AUTOPILOT_DESKTOP_BINDING_KEYS.map(key => value[key]))).digest('hex')
}
function defaultEndpoint() {
  return createLocalIpcEndpoint('ata', { windowsKind: 'agent-teams-authorization' })
}
async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8'); await handle.sync() }
  finally { await handle.close() }
  try { await rename(temporary, file) } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error }
}
async function readState(file, maxConsumed = MAX_CONSUMED) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    if (parsed?.version !== AUTHORIZATION_VERSION || !Array.isArray(parsed.consumed) || parsed.consumed.length > maxConsumed) throw new Error('invalid')
    const consumed = new Map()
    for (const row of parsed.consumed) {
      if (typeof row?.authorizationId !== 'string' || !/^[a-f0-9]{64}$/u.test(row.requestHash) || !Number.isSafeInteger(row.consumedAt) || consumed.has(row.authorizationId)) throw new Error('invalid')
      consumed.set(row.authorizationId, row)
    }
    return consumed
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map()
    throw authorizationError('HOST_AUTHORIZATION_STATE_INVALID')
  }
}
async function withStateLock(stateFile, operation, { retryMs = 10, timeoutMs = 5_000 } = {}) {
  const lockFile = `${stateFile}.lock`
  await mkdir(path.dirname(lockFile), { recursive: true })
  const deadline = Date.now() + timeoutMs
  let handle
  for (;;) {
    try { handle = await open(lockFile, 'wx', 0o600); break }
    catch (error) {
      if (error?.code !== 'EEXIST' || Date.now() >= deadline) throw authorizationError()
      await new Promise(resolve => setTimeout(resolve, retryMs))
    }
  }
  try { return await operation() }
  finally {
    try { await handle.close() } catch {}
    await rm(lockFile, { force: true }).catch(() => undefined)
  }
}
function requestHash(request) { return createHash('sha256').update(JSON.stringify(REQUEST_KEYS.map(key => request[key]))).digest('hex') }
function dialogOptions(request) {
  return {
    type: 'warning',
    buttons: ['确认本次处理', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: '确认处理未知外部操作结果',
    message: '仅在你已独立核实该外部操作结果时确认。',
    detail: [`团队：${request.teamId}`, `任务：${request.taskId}`, `外部操作：${request.effectName}`, `尝试：${request.attemptId}`, `拟记录结果：${request.outcome}`].join('\n')
  }
}

async function startAgentTeamsAuthorizationService({ createService } = {}) {
  let service
  try {
    if (typeof createService !== 'function') return null
    service = createService()
    if (!service || typeof service.start !== 'function' || typeof service.close !== 'function') throw authorizationError()
    await service.start()
    return service
  } catch {
    try { await service?.close?.() } catch {}
    return null
  }
}

function createAgentTeamsAuthorizationService({
  stateFile,
  showMessageBox,
  endpoint = defaultEndpoint(),
  token = randomBytes(32),
  now = Date.now,
  dialogTimeoutMs = DIALOG_TIMEOUT_MS,
  receiptTtlMs = RECEIPT_TTL_MS,
  autopilotReceiptTtlMs = AUTOPILOT_RECEIPT_TTL_MS,
  maxConsumed = MAX_CONSUMED,
  maxPendingAutopilot = MAX_PENDING_AUTOPILOT,
  createAutopilotEpoch = () => randomBytes(16).toString('hex'),
  lockRetryMs = 10,
  lockTimeoutMs = 5_000
} = {}) {
  strictString(stateFile, 4096)
  if (typeof showMessageBox !== 'function' || typeof now !== 'function' || typeof createAutopilotEpoch !== 'function') throw new TypeError('showMessageBox, now and createAutopilotEpoch are required')
  if (!Buffer.isBuffer(token) || token.length !== 32) throw new TypeError('token must be a 32-byte Buffer')
  if (!Number.isSafeInteger(receiptTtlMs) || receiptTtlMs <= 0 || receiptTtlMs > MAX_RECEIPT_TTL_MS) throw new TypeError('receiptTtlMs is invalid')
  if (!Number.isSafeInteger(autopilotReceiptTtlMs) || autopilotReceiptTtlMs <= 0 || autopilotReceiptTtlMs > MAX_AUTOPILOT_RECEIPT_TTL_MS) throw new TypeError('autopilotReceiptTtlMs is invalid')
  if (!Number.isSafeInteger(maxConsumed) || maxConsumed <= 0 || maxConsumed > MAX_CONSUMED) throw new TypeError('maxConsumed is invalid')
  if (!Number.isSafeInteger(maxPendingAutopilot) || maxPendingAutopilot <= 0 || maxPendingAutopilot > MAX_PENDING_AUTOPILOT) throw new TypeError('maxPendingAutopilot is invalid')
  if (!Number.isSafeInteger(lockRetryMs) || lockRetryMs <= 0 || !Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs <= 0) throw new TypeError('lock timing is invalid')
  const capabilityToken = Buffer.from(token)
  const pendingAutopilot = new Map()
  const autopilotTombstones = new Map()
  const maxAutopilotTombstones = maxPendingAutopilot * 4
  let authorizationEpoch = validateAuthorizationEpoch(createAutopilotEpoch())
  let autopilotSettingsProof = null
  let server
  let consumed
  let closed = false
  let queue = Promise.resolve()

  const authorizeToken = value => {
    let supplied
    try { supplied = Buffer.from(strictString(value, 128), 'base64url') } catch { return false }
    const ok = supplied.length === capabilityToken.length && timingSafeEqual(supplied, capabilityToken)
    supplied.fill(0)
    return ok
  }
  const rememberAutopilotTombstone = (authorizationId, code) => {
    autopilotTombstones.delete(authorizationId)
    autopilotTombstones.set(authorizationId, code)
    while (autopilotTombstones.size > maxAutopilotTombstones) autopilotTombstones.delete(autopilotTombstones.keys().next().value)
  }
  const purgeExpiredAutopilot = current => {
    for (const [authorizationId, pending] of pendingAutopilot) {
      if (pending.expiresAt > current) continue
      pendingAutopilot.delete(authorizationId)
      rememberAutopilotTombstone(authorizationId, 'HOST_AUTHORIZATION_EXPIRED')
    }
  }
  const consume = request => {
    const operation = queue.then(async () => {
      const normalized = validateRequest(request)
      return withStateLock(stateFile, async () => {
        consumed = await readState(stateFile, maxConsumed)
        if (consumed.has(normalized.authorizationId)) throw authorizationError('HOST_AUTHORIZATION_REPLAY')
        if (consumed.size >= maxConsumed) throw authorizationError('HOST_AUTHORIZATION_CAPACITY')
        const decision = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(false), dialogTimeoutMs)
          Promise.resolve().then(() => showMessageBox(dialogOptions(normalized))).then(
            result => { clearTimeout(timer); resolve(result?.response === 0) },
            error => { clearTimeout(timer); reject(error) }
          )
        })
        if (!decision) throw authorizationError('HOST_AUTHORIZATION_DENIED')
        const consumedAt = now()
        const row = { authorizationId: normalized.authorizationId, requestHash: requestHash(normalized), consumedAt }
        const nextRows = [...consumed.values(), row]
        await atomicWriteJson(stateFile, { version: AUTHORIZATION_VERSION, consumed: nextRows })
        consumed = new Map(nextRows.map(item => [item.authorizationId, item]))
        return { ...normalized, expiresAt: consumedAt + receiptTtlMs }
      }, { retryMs: lockRetryMs, timeoutMs: lockTimeoutMs })
    })
    queue = operation.catch(() => undefined)
    return operation
  }
  const issueAutopilotAuthorization = (value, desktopContext) => {
    if (closed || !server) throw authorizationError()
    const binding = validateAutopilotIssue(value)
    const desktopBinding = validateDesktopBinding(desktopContext)
    const issuedAt = now()
    if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) throw authorizationError()
    purgeExpiredAutopilot(issuedAt)
    if (pendingAutopilot.size >= maxPendingAutopilot) throw authorizationError('HOST_AUTHORIZATION_CAPACITY')
    // A newer explicit save invalidates older unsubmitted capabilities, but the
    // live authority epoch advances only when the Runtime consumes an exact,
    // sender-bound request after its own durable preflight.
    for (const pendingId of pendingAutopilot.keys()) rememberAutopilotTombstone(pendingId, 'HOST_AUTHORIZATION_REVOKED')
    pendingAutopilot.clear()
    let authorizationId
    do { authorizationId = randomUUID() } while (pendingAutopilot.has(authorizationId) || autopilotTombstones.has(authorizationId))
    const expiresAt = issuedAt + autopilotReceiptTtlMs
    pendingAutopilot.set(authorizationId, { ...binding, bindingHash: autopilotBindingHash(binding), desktopBindingHash: desktopBindingHash(desktopBinding), authorizationEpoch, issuedAt, expiresAt, webRequestClaimed: false })
    return Object.freeze({ authorizationId, authorizationEpoch, expiresAt })
  }
  const claimAutopilotWebRequest = (authorizationIdValue, value, desktopContext, requestOriginValue) => {
    if (closed || !server) throw authorizationError()
    const authorizationId = strictString(authorizationIdValue)
    const current = now()
    purgeExpiredAutopilot(current)
    const tombstone = autopilotTombstones.get(authorizationId)
    if (tombstone) throw authorizationError(tombstone)
    const pending = pendingAutopilot.get(authorizationId)
    if (!pending) throw authorizationError('HOST_AUTHORIZATION_INVALID')
    let request
    let desktopBinding
    let requestOrigin
    try {
      request = validateAutopilotIssue(value)
      desktopBinding = validateDesktopBinding(desktopContext)
      requestOrigin = strictString(requestOriginValue, 2048)
      if (new URL(requestOrigin).origin !== requestOrigin || requestOrigin !== desktopBinding.runtimeOrigin) throw authorizationError('HOST_AUTHORIZATION_MISMATCH')
    } catch {
      pendingAutopilot.delete(authorizationId)
      rememberAutopilotTombstone(authorizationId, 'HOST_AUTHORIZATION_MISMATCH')
      throw authorizationError('HOST_AUTHORIZATION_MISMATCH')
    }
    if (pending.webRequestClaimed || pending.authorizationEpoch !== authorizationEpoch
      || pending.bindingHash !== autopilotBindingHash(request)
      || pending.desktopBindingHash !== desktopBindingHash(desktopBinding)) {
      pendingAutopilot.delete(authorizationId)
      const code = pending.webRequestClaimed ? 'HOST_AUTHORIZATION_REPLAY' : 'HOST_AUTHORIZATION_MISMATCH'
      rememberAutopilotTombstone(authorizationId, code)
      throw authorizationError(code)
    }
    pending.webRequestClaimed = true
    return true
  }
  const consumeAutopilotAuthorization = value => {
    if (closed || !server) throw authorizationError()
    const request = validateAutopilotRequest(value)
    const current = now()
    if (!Number.isSafeInteger(current) || current < 0) throw authorizationError()
    purgeExpiredAutopilot(current)
    const tombstone = autopilotTombstones.get(request.authorizationId)
    if (tombstone) throw authorizationError(tombstone)
    const pending = pendingAutopilot.get(request.authorizationId)
    if (!pending) throw authorizationError('HOST_AUTHORIZATION_INVALID')
    pendingAutopilot.delete(request.authorizationId)
    if (pending.expiresAt <= current) {
      rememberAutopilotTombstone(request.authorizationId, 'HOST_AUTHORIZATION_EXPIRED')
      throw authorizationError('HOST_AUTHORIZATION_EXPIRED')
    }
    if (pending.authorizationEpoch !== authorizationEpoch) {
      rememberAutopilotTombstone(request.authorizationId, 'HOST_AUTHORIZATION_REVOKED')
      throw authorizationError('HOST_AUTHORIZATION_REVOKED')
    }
    rememberAutopilotTombstone(request.authorizationId, 'HOST_AUTHORIZATION_REPLAY')
    if (!pending.webRequestClaimed || pending.bindingHash !== autopilotBindingHash(request)) throw authorizationError('HOST_AUTHORIZATION_MISMATCH')
    for (const pendingId of pendingAutopilot.keys()) rememberAutopilotTombstone(pendingId, 'HOST_AUTHORIZATION_REVOKED')
    pendingAutopilot.clear()
    authorizationEpoch = validateAuthorizationEpoch(createAutopilotEpoch())
    autopilotSettingsProof = Object.freeze({
      version: 1,
      settingsHash: autopilotSettingsHash(request.settings),
      enabled: request.settings.enabled,
      autopilotEnabled: request.settings.autopilotEnabled,
      authorizationEpoch,
      authorizedAt: current
    })
    return Object.freeze({ ...request, tool: 'team_autopilot', desktopBindingHash: pending.desktopBindingHash, authorizationEpoch, autopilotSettingsProof, issuedAt: pending.issuedAt, expiresAt: pending.expiresAt })
  }
  const readAutopilotAuthorizationState = () => {
    if (closed || !server) throw authorizationError()
    return Object.freeze({ authorizationEpoch, autopilotSettingsProof })
  }
  const revokeAutopilotAuthorizations = (reason = 'Host revoked automatic continuation authority') => {
    if (closed || !server) throw authorizationError()
    strictString(reason, 256)
    for (const authorizationId of pendingAutopilot.keys()) rememberAutopilotTombstone(authorizationId, 'HOST_AUTHORIZATION_REVOKED')
    pendingAutopilot.clear()
    authorizationEpoch = validateAuthorizationEpoch(createAutopilotEpoch())
    autopilotSettingsProof = null
    return Object.freeze({ authorizationEpoch, autopilotSettingsProof })
  }
  const revokeAutopilotFromCapability = value => {
    const request = validateAutopilotRevoke(value)
    if (request.authorizationEpoch !== authorizationEpoch) throw authorizationError('HOST_AUTHORIZATION_MISMATCH')
    return revokeAutopilotAuthorizations(request.reason)
  }
  const executeMessage = message => {
    if (!authorizeToken(message?.token)) throw authorizationError()
    if (message.action === 'consumeResolveUnknown') return Promise.resolve(consume(message.request)).then(receipt => ({ receipt }))
    if (message.action === 'consumeAutopilotAuthorization') return Promise.resolve(consumeAutopilotAuthorization(message.request)).then(receipt => ({ receipt }))
    if (message.action === 'readAutopilotAuthorizationState') return Promise.resolve({ state: readAutopilotAuthorizationState() })
    if (message.action === 'revokeAutopilotAuthorizations') return Promise.resolve({ state: revokeAutopilotFromCapability(message.request) })
    throw authorizationError()
  }
  const start = async () => {
    if (closed) throw authorizationError()
    if (server) return
    consumed = await readState(stateFile, maxConsumed)
    if (process.platform !== 'win32') await rm(endpoint, { force: true }).catch(() => undefined)
    server = net.createServer(socket => {
      let bytes = 0
      let text = ''
      socket.setEncoding('utf8')
      socket.on('data', chunk => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_MESSAGE_BYTES) return socket.destroy()
        text += chunk
        const newline = text.indexOf('\n')
        if (newline < 0) return
        socket.pause()
        let message
        try { message = JSON.parse(text.slice(0, newline)) } catch {}
        Promise.resolve().then(() => executeMessage(message))
          .then(result => socket.end(`${JSON.stringify({ ok: true, ...result })}\n`))
          .catch(error => socket.end(`${JSON.stringify({ ok: false, code: PUBLIC_ERROR_CODES.has(error?.code) ? error.code : 'HOST_AUTHORIZATION_UNAVAILABLE' })}\n`))
      })
      socket.on('error', () => undefined)
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, () => { server.off('error', reject); resolve() }) })
  }
  const runtimeEnvironment = (env = {}) => {
    if (!server || closed) throw authorizationError()
    return { ...env, [ENDPOINT_ENV]: endpoint, [TOKEN_ENV]: capabilityToken.toString('base64url') }
  }
  const close = async () => {
    if (closed) return
    closed = true
    for (const authorizationId of pendingAutopilot.keys()) rememberAutopilotTombstone(authorizationId, 'HOST_AUTHORIZATION_REVOKED')
    pendingAutopilot.clear()
    autopilotSettingsProof = null
    capabilityToken.fill(0)
    const active = server
    server = undefined
    if (active) await new Promise(resolve => active.close(() => resolve()))
    if (process.platform !== 'win32') await rm(endpoint, { force: true }).catch(() => undefined)
  }
  return Object.freeze({
    start,
    runtimeEnvironment,
    close,
    endpoint,
    issueAutopilotAuthorization,
    claimAutopilotWebRequest,
    readAutopilotAuthorizationState,
    revokeAutopilotAuthorizations
  })
}

module.exports = {
  ENDPOINT_ENV,
  TOKEN_ENV,
  AUTOPILOT_RECEIPT_TTL_MS,
  createAgentTeamsAuthorizationService,
  startAgentTeamsAuthorizationService,
  validateRequest,
  validateAutopilotIssue,
  validateAutopilotRequest,
  autopilotSettingsHash
}
