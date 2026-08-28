const http = require('node:http')
const { createHash, randomBytes } = require('node:crypto')
const { mkdir, readdir, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')

const MAX_BODY_BYTES = 64 * 1024
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
const CONTROL_SCOPES = new Set(['browser', 'computer', 'memory'])
const MAX_RECENT_REQUESTS = 512
const REPLAY_ACTIONS = Object.freeze({
  // Emergency stop must never be rejected by replay-cache capacity or wait on
  // an earlier request identity. The stop path is intentionally idempotent.
  browser: new Set(['navigate', 'back', 'forward', 'reload', 'click', 'type', 'scroll', 'hover', 'keypress', 'select', 'tabOpen', 'tabSwitch', 'tabClose', 'download', 'upload', 'dialog']),
  computer: new Set(),
  memory: new Set()
})

function controlError(code, message, statusCode = 400) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function requestFingerprint(body, scope) {
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).sort().filter(key => key !== 'request_id').map(key => [key, normalize(value[key])]))
  }
  const canonical = JSON.stringify(normalize({ ...body, scope }))
  return createHash('sha256').update(canonical).digest('base64url')
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

class BrowserControlServer {
  constructor({ stateFile, handler }) {
    if (!stateFile || typeof handler !== 'function') throw new Error('浏览器控制服务配置无效。')
    this.stateFile = path.resolve(stateFile)
    this.handler = handler
    this.server = null
    this.token = ''
    this.origin = ''
    this.generation = 0
    this.sockets = new Set()
    this.activeRequests = new Map()
    this.scopeTails = new Map()
    this.unknownOutcomes = new Map()
    this.stopEpochs = new Map([...CONTROL_SCOPES].map(scope => [scope, 0]))
    this.stoppedScopes = new Set()
    this.recentRequests = new Map()
    this.startPromise = null
    this.stopPromise = null
  }

  async start() {
    if (this.startPromise) return this.startPromise
    if (this.server?.listening) return this.state()
    this.startPromise = this.#start().finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async #start() {
    if (this.stopPromise) await this.stopPromise
    await this.#removeStateFiles()
    const generation = this.generation + 1
    this.generation = generation
    this.token = randomBytes(32).toString('base64url')
    const server = http.createServer((request, response) => this.#request(request, response, generation))
    this.server = server
    server.on('connection', socket => {
      this.sockets.add(socket)
      socket.once('close', () => this.sockets.delete(socket))
    })
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error) }
        const onListening = () => { server.off('error', onError); resolve() }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(0, '127.0.0.1')
      })
      server.on('error', () => { if (this.server === server) this.stop().catch(() => {}) })
      if (generation !== this.generation || this.server !== server) throw new Error('浏览器控制服务启动已取消。')
      const address = server.address()
      this.origin = `http://127.0.0.1:${address.port}`
      await this.#writeState()
      return this.state()
    } catch (error) {
      if (this.server === server) this.server = null
      this.generation += 1
      this.token = ''
      this.origin = ''
      await this.#closeServer(server)
      await this.#removeStateFiles()
      throw error
    }
  }

  state() {
    return { running: Boolean(this.server?.listening), origin: this.origin, stateFile: this.stateFile }
  }

  resumeScope(scope) {
    const normalized = String(scope || '')
    if (!CONTROL_SCOPES.has(normalized)) throw controlError('browser-request-scope-invalid', '桌面模型操作 scope 无效。')
    this.stopEpochs.set(normalized, (this.stopEpochs.get(normalized) || 0) + 1)
    this.stoppedScopes.delete(normalized)
    this.unknownOutcomes.delete(normalized)
    return { scope: normalized, stopped: false, epoch: this.stopEpochs.get(normalized) }
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise
    this.stopPromise = this.#stop().finally(() => { this.stopPromise = null })
    return this.stopPromise
  }

  async #stop() {
    const server = this.server
    this.server = null
    this.generation += 1
    this.token = ''
    this.origin = ''
    for (const controller of this.activeRequests.keys()) controller.abort()
    this.activeRequests.clear()
    // A handler is required to cooperate with AbortSignal, but a stale or
    // broken handler must not keep the next server generation behind its tail.
    this.scopeTails.clear()
    this.unknownOutcomes.clear()
    this.recentRequests.clear()
    await this.#closeServer(server)
    await this.#removeStateFiles()
  }

  async #closeServer(server) {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (!server?.listening) return
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(() => resolve()))
  }

  async #removeStateFiles() {
    const directory = path.dirname(this.stateFile)
    const base = path.basename(this.stateFile)
    await rm(this.stateFile, { force: true }).catch(() => {})
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error))
    const temporaryPattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+\\.\\d+\\.tmp$`)
    await Promise.all(entries
      .filter(entry => entry.isFile() && temporaryPattern.test(entry.name))
      .map(entry => rm(path.join(directory, entry.name), { force: true })))
  }

  async #writeState() {
    await mkdir(path.dirname(this.stateFile), { recursive: true, mode: 0o700 })
    const temporary = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify({ origin: this.origin, token: this.token })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporary, this.stateFile)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
  }

  #send(response, status, payload) {
    if (response.destroyed || response.writableEnded) return
    const data = Buffer.from(JSON.stringify(payload))
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    response.end(data)
  }

  #isMutation(scope, action) {
    return REPLAY_ACTIONS[scope]?.has(String(action || '')) === true
  }

  #markUnknownOutcome(context, action) {
    if (!this.#isMutation(context.scope, action)) return
    this.unknownOutcomes.set(context.scope, { action: String(action || ''), at: Date.now() })
  }

  #runHandler(body, context) {
    const action = String(body?.action || '')
    if (context.signal.aborted) return Promise.reject(controlError('browser-action-cancelled', '浏览器操作已取消。', 499))
    const operation = Promise.resolve().then(() => this.handler(body, {
      signal: context.signal,
      requestId: context.requestId,
      scope: context.scope
    }))
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        context.signal.removeEventListener('abort', onAbort)
        callback(value)
      }
      const onAbort = () => {
        this.#markUnknownOutcome(context, action)
        finish(reject, controlError('browser-action-cancelled', '浏览器操作已取消。', 499))
      }
      context.signal.addEventListener('abort', onAbort, { once: true })
      if (context.signal.aborted) onAbort()
      operation.then(
        value => finish(resolve, value),
        error => {
          if (error?.code === 'browser-outcome-unknown') this.#markUnknownOutcome(context, action)
          finish(reject, error)
        }
      )
    })
  }

  async #dispatch(body, context) {
    const action = String(body?.action || '')
    const execute = () => this.#runHandler(body, context)
    if (action === 'stop') {
      this.stopEpochs.set(context.scope, (this.stopEpochs.get(context.scope) || 0) + 1)
      if (context.scope === 'browser') this.stoppedScopes.add(context.scope)
      for (const [controller, scope] of this.activeRequests) {
        if (controller !== context.controller && scope === context.scope) controller.abort()
      }
      return execute()
    }
    if (action === 'status') return execute()
    if (this.#isMutation(context.scope, action) && this.unknownOutcomes.has(context.scope)) {
      throw controlError(
        'browser-outcome-unknown',
        '上一次浏览器状态变更在连接中断时未能确认结果。为避免重复副作用，新的状态变更已阻止；可以继续 status、observe、console 等只读诊断，或先停止并恢复控制会话。',
        409
      )
    }
    const tail = this.scopeTails.get(context.scope) || Promise.resolve()
    const pending = tail.then(execute, execute)
    this.scopeTails.set(context.scope, pending.then(() => undefined, () => undefined))
    return pending
  }

  #deduplicatedDispatch(body, context) {
    if (!REPLAY_ACTIONS[context.scope]?.has(String(body?.action || ''))) return this.#dispatch(body, context)
    const fingerprint = requestFingerprint(body, context.scope)
    const existing = this.recentRequests.get(context.requestId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw controlError('browser-request-id-conflict', '同一 request_id 不能用于不同的桌面模型操作。', 409)
      }
      return existing.promise
    }
    if (this.recentRequests.size >= MAX_RECENT_REQUESTS) {
      const settled = [...this.recentRequests].find(([, entry]) => entry.settled)
      if (!settled) throw controlError('browser-request-capacity', '正在处理的桌面模型操作过多。', 429)
      this.recentRequests.delete(settled[0])
    }
    const entry = { fingerprint, promise: null, settled: false }
    entry.promise = this.#dispatch(body, context)
    entry.promise.then(() => { entry.settled = true }, () => { entry.settled = true })
    this.recentRequests.set(context.requestId, entry)
    return entry.promise
  }

  async #request(request, response, generation) {
    const controller = new AbortController()
    const arrivalEpochs = new Map(this.stopEpochs)
    this.activeRequests.set(controller, null)
    const abort = () => controller.abort()
    const abortIfIncomplete = () => { if (!response.writableEnded) abort() }
    request.once('aborted', abort)
    response.once('close', abortIfIncomplete)
    try {
      if (generation !== this.generation || !this.server) return this.#send(response, 503, { ok: false, error: '浏览器控制服务已停止。' })
      if (!isLoopback(request.socket.remoteAddress)) return this.#send(response, 403, { ok: false, error: '仅允许本机访问。' })
      if (request.method !== 'POST' || request.url !== '/action') return this.#send(response, 404, { ok: false, error: '接口不存在。' })
      if (request.headers.authorization !== `Bearer ${this.token}`) return this.#send(response, 401, { ok: false, error: '浏览器控制凭证无效。' })
      const chunks = []
      let bytes = 0
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('请求内容过大。'), { statusCode: 413 })
        chunks.push(chunk)
      }
      if (generation !== this.generation || !this.server) return this.#send(response, 503, { ok: false, error: '浏览器控制服务已停止。' })
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
      catch { return this.#send(response, 400, { ok: false, error: '请求 JSON 无效。' }) }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw controlError('browser-request-invalid', '浏览器操作请求必须是对象。')
      const scope = body.scope == null || body.scope === '' ? 'browser' : String(body.scope)
      if (!CONTROL_SCOPES.has(scope)) throw controlError('browser-request-scope-invalid', '桌面模型操作 scope 无效。')
      this.activeRequests.set(controller, scope)
      const action = String(body.action || '')
      if (action !== 'status' && action !== 'stop') {
        if (arrivalEpochs.get(scope) !== this.stopEpochs.get(scope)) {
          throw controlError('browser-action-cancelled', '该操作早于最近一次停止或恢复边界，已取消。', 499)
        }
        if (this.stoppedScopes.has(scope)) throw controlError('stopped', '浏览器模型控制已停止。', 409)
      }
      const suppliedRequestId = body.request_id == null ? '' : String(body.request_id)
      if (suppliedRequestId && !REQUEST_ID_PATTERN.test(suppliedRequestId)) throw controlError('browser-request-id-invalid', '浏览器操作 request_id 无效。')
      const requestId = suppliedRequestId || randomBytes(16).toString('hex')
      const result = await this.#deduplicatedDispatch(body, { controller, signal: controller.signal, requestId, scope })
      if (generation !== this.generation || !this.server) return
      this.#send(response, 200, { ok: true, requestId, result })
    } catch (error) {
      const cancelled = error?.code === 'browser-action-cancelled' || error?.name === 'AbortError'
      const statusCode = Number(error?.statusCode) || (cancelled ? 499 : 400)
      const code = error?.code || (cancelled ? 'browser-action-cancelled' : 'browser-control-error')
      this.#send(response, statusCode, { ok: false, error: error.message || '浏览器操作失败。', code })
    } finally {
      request.off('aborted', abort)
      response.off('close', abortIfIncomplete)
      this.activeRequests.delete(controller)
    }
  }
}

module.exports = { BrowserControlServer, CONTROL_SCOPES, MAX_BODY_BYTES, MAX_RECENT_REQUESTS, REPLAY_ACTIONS, REQUEST_ID_PATTERN, isLoopback, requestFingerprint }
