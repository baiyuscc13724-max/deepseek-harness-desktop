const http = require('node:http')
const { randomBytes } = require('node:crypto')
const { mkdir, readdir, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')

const MAX_BODY_BYTES = 64 * 1024

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

  async #request(request, response, generation) {
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
      const result = await this.handler(body || {})
      if (generation !== this.generation || !this.server) return
      this.#send(response, 200, { ok: true, result })
    } catch (error) {
      this.#send(response, Number(error.statusCode) || 400, { ok: false, error: error.message || '浏览器操作失败。', code: error.code || 'browser-control-error' })
    }
  }
}

module.exports = { BrowserControlServer, MAX_BODY_BYTES, isLoopback }
