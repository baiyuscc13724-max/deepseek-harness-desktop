const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto')
const { mkdir, open, readFile, rename, rm } = require('node:fs/promises')

const ENDPOINT_ENV = 'HARNESS_DESKTOP_AUTHORIZATION_ENDPOINT'
const TOKEN_ENV = 'HARNESS_DESKTOP_AUTHORIZATION_TOKEN'
const AUTHORIZATION_VERSION = 1
const RECEIPT_TTL_MS = 60_000
const MAX_RECEIPT_TTL_MS = 2 * 60_000
const DIALOG_TIMEOUT_MS = 2 * 60_000
const MAX_MESSAGE_BYTES = 64 * 1024
const MAX_CONSUMED = 4096
const REQUEST_KEYS = Object.freeze(['authorizationId', 'tool', 'rootSessionId', 'turnKey', 'teamId', 'taskId', 'effectName', 'attemptId', 'outcome', 'pauseEpoch', 'teamRevision', 'canonicalArgumentsHash'])
const OUTCOMES = new Set(['succeeded', 'failed', 'not_started'])

function authorizationError(code = 'HOST_AUTHORIZATION_UNAVAILABLE') {
  const error = new Error('Host authorization was not granted')
  error.code = code
  return error
}
function strictString(value, max = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  return value
}
function canonicalArgumentsHash(value) {
  return createHash('sha256').update(JSON.stringify({ action: 'resolve_unknown', team_id: value.teamId, task_id: value.taskId, effect_name: value.effectName, attempt_id: value.attemptId, outcome: value.outcome })).digest('hex')
}
function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== REQUEST_KEYS.length || Object.keys(value).some(key => !REQUEST_KEYS.includes(key))) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  for (const key of ['authorizationId', 'rootSessionId', 'turnKey', 'teamId', 'taskId', 'effectName', 'attemptId']) strictString(value[key])
  if (value.tool !== 'team_task_external_effect' || !OUTCOMES.has(value.outcome)) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  if (!Number.isSafeInteger(value.pauseEpoch) || value.pauseEpoch < 0 || !Number.isSafeInteger(value.teamRevision) || value.teamRevision <= 0) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  if (!/^[a-f0-9]{64}$/u.test(value.canonicalArgumentsHash) || value.canonicalArgumentsHash !== canonicalArgumentsHash(value)) throw authorizationError('HOST_AUTHORIZATION_INVALID')
  return Object.freeze(Object.fromEntries(REQUEST_KEYS.map(key => [key, value[key]])))
}
function defaultEndpoint() {
  const name = `dsh-agent-teams-authorization-${process.pid}-${randomUUID()}.sock`
  return process.platform === 'win32' ? '\\\\.\\pipe\\' + name : path.join(os.tmpdir(), name)
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

function createAgentTeamsAuthorizationService({ stateFile, showMessageBox, endpoint = defaultEndpoint(), token = randomBytes(32), now = Date.now, dialogTimeoutMs = DIALOG_TIMEOUT_MS, receiptTtlMs = RECEIPT_TTL_MS, maxConsumed = MAX_CONSUMED, lockRetryMs = 10, lockTimeoutMs = 5_000 } = {}) {
  strictString(stateFile, 4096)
  if (typeof showMessageBox !== 'function' || typeof now !== 'function') throw new TypeError('showMessageBox and now are required')
  if (!Buffer.isBuffer(token) || token.length !== 32) throw new TypeError('token must be a 32-byte Buffer')
  if (!Number.isSafeInteger(receiptTtlMs) || receiptTtlMs <= 0 || receiptTtlMs > MAX_RECEIPT_TTL_MS) throw new TypeError('receiptTtlMs is invalid')
  if (!Number.isSafeInteger(maxConsumed) || maxConsumed <= 0 || maxConsumed > MAX_CONSUMED) throw new TypeError('maxConsumed is invalid')
  if (!Number.isSafeInteger(lockRetryMs) || lockRetryMs <= 0 || !Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs <= 0) throw new TypeError('lock timing is invalid')
  const capabilityToken = Buffer.from(token)
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
        const request = message?.action === 'consumeResolveUnknown' && authorizeToken(message.token) ? message.request : undefined
        Promise.resolve(request ? consume(request) : Promise.reject(authorizationError()))
          .then(receipt => socket.end(`${JSON.stringify({ ok: true, receipt })}\n`))
          .catch(error => socket.end(`${JSON.stringify({ ok: false, code: ['HOST_AUTHORIZATION_REPLAY', 'HOST_AUTHORIZATION_DENIED', 'HOST_AUTHORIZATION_INVALID', 'HOST_AUTHORIZATION_STATE_INVALID', 'HOST_AUTHORIZATION_CAPACITY'].includes(error?.code) ? error.code : 'HOST_AUTHORIZATION_UNAVAILABLE' })}\n`))
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
    capabilityToken.fill(0)
    const active = server
    server = undefined
    if (active) await new Promise(resolve => active.close(() => resolve()))
    if (process.platform !== 'win32') await rm(endpoint, { force: true }).catch(() => undefined)
  }
  return Object.freeze({ start, runtimeEnvironment, close, endpoint })
}

module.exports = { ENDPOINT_ENV, TOKEN_ENV, createAgentTeamsAuthorizationService, startAgentTeamsAuthorizationService, validateRequest }
