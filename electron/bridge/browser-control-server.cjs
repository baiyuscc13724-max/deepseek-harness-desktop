const http = require('node:http')
const { randomBytes } = require('node:crypto')
const { mkdir, rename, rm, writeFile } = require('node:fs/promises')
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
  }

  async start() {
    if (this.server) return this.state()
    this.token = randomBytes(32).toString('base64url')
    this.server = http.createServer((request, response) => this.#request(request, response))
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', resolve)
    })
    const address = this.server.address()
    this.origin = `http://127.0.0.1:${address.port}`
    await this.#writeState()
    return this.state()
  }

  state() {
    return { running: Boolean(this.server), origin: this.origin, stateFile: this.stateFile }
  }

  async stop() {
    const server = this.server
    this.server = null
    this.token = ''
    this.origin = ''
    if (server) await new Promise(resolve => server.close(resolve))
    await rm(this.stateFile, { force: true }).catch(() => {})
  }

  async #writeState() {
    await mkdir(path.dirname(this.stateFile), { recursive: true, mode: 0o700 })
    const temporary = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, `${JSON.stringify({ origin: this.origin, token: this.token })}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.stateFile)
  }

  #send(response, status, payload) {
    const data = Buffer.from(JSON.stringify(payload))
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    response.end(data)
  }

  async #request(request, response) {
    try {
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
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
      catch { return this.#send(response, 400, { ok: false, error: '请求 JSON 无效。' }) }
      const result = await this.handler(body || {})
      this.#send(response, 200, { ok: true, result })
    } catch (error) {
      this.#send(response, Number(error.statusCode) || 400, { ok: false, error: error.message || '浏览器操作失败。', code: error.code || 'browser-control-error' })
    }
  }
}

module.exports = { BrowserControlServer, MAX_BODY_BYTES, isLoopback }
