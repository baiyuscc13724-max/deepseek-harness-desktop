const net = require('node:net')
const { randomBytes, timingSafeEqual } = require('node:crypto')
const { rm } = require('node:fs/promises')
const { createLocalIpcEndpoint } = require('./local-ipc-endpoint.cjs')

const ENDPOINT_ENV = 'HARNESS_DESKTOP_SECRET_ENDPOINT'
const TOKEN_ENV = 'HARNESS_DESKTOP_SECRET_TOKEN'
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024
const MAX_PLAINTEXT_BYTES = 1024 * 1024

function serviceError(message, code = 'HOST_SECRET_UNAVAILABLE') {
  const error = new Error(message)
  error.code = code
  return error
}

function boundedString(value, field, max = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw serviceError(`${field} is invalid`, 'HOST_SECRET_REQUEST_INVALID')
  return value
}

function defaultEndpoint() {
  return createLocalIpcEndpoint('ats', { windowsKind: 'agent-teams-secret' })
}

function envelopePlaintext({ purpose, binding, plaintext }) {
  return Buffer.from(JSON.stringify({ version: 1, purpose, binding, plaintext: plaintext.toString('base64') }), 'utf8')
}

function openEnvelope({ purpose, binding, plaintext }) {
  let parsed
  try { parsed = JSON.parse(plaintext.toString('utf8')) } catch { throw serviceError('protected project secret is invalid', 'HOST_SECRET_INVALID') }
  if (parsed?.version !== 1 || parsed.purpose !== purpose || parsed.binding !== binding || typeof parsed.plaintext !== 'string') {
    throw serviceError('protected project secret binding is invalid', 'HOST_SECRET_INVALID')
  }
  const opened = Buffer.from(parsed.plaintext, 'base64')
  if (opened.length > MAX_PLAINTEXT_BYTES || opened.toString('base64') !== parsed.plaintext) {
    opened.fill(0)
    throw serviceError('protected project secret payload is invalid', 'HOST_SECRET_INVALID')
  }
  return opened
}

async function startAgentTeamsSecretService({ isEncryptionAvailable, createService } = {}) {
  let service
  try {
    if (typeof isEncryptionAvailable !== 'function' || typeof createService !== 'function') return null
    if (!isEncryptionAvailable()) return null
    service = createService()
    if (!service || typeof service.start !== 'function' || typeof service.close !== 'function') throw serviceError('Host secret service is invalid')
    await service.start()
    return service
  } catch {
    try { await service?.close?.() } catch {}
    return null
  }
}

function createAgentTeamsSecretService({ protector, endpoint = defaultEndpoint(), token = randomBytes(32), maxMessageBytes = MAX_MESSAGE_BYTES } = {}) {
  if (!protector || typeof protector.protect !== 'function' || typeof protector.unprotect !== 'function') throw new TypeError('protector must provide protect and unprotect')
  if (!Buffer.isBuffer(token) || token.length !== 32) throw new TypeError('token must be a 32-byte Buffer')
  const capabilityToken = Buffer.from(token)
  let server
  let closed = false

  const authorize = value => {
    let supplied
    try { supplied = Buffer.from(boundedString(value, 'token', 128), 'base64url') } catch { return false }
    const valid = supplied.length === capabilityToken.length && timingSafeEqual(supplied, capabilityToken)
    supplied.fill(0)
    return valid
  }

  const handleRequest = async request => {
    if (!request || typeof request !== 'object' || Array.isArray(request) || !authorize(request.token)) throw serviceError('Host secret capability is unavailable')
    const purpose = boundedString(request.purpose, 'purpose', 128)
    const binding = boundedString(request.binding, 'binding', 512)
    if (request.action === 'protect') {
      const plaintext = Buffer.from(boundedString(request.plaintext, 'plaintext', Math.ceil(MAX_PLAINTEXT_BYTES * 4 / 3) + 8), 'base64')
      if (plaintext.length > MAX_PLAINTEXT_BYTES || plaintext.toString('base64') !== request.plaintext) {
        plaintext.fill(0)
        throw serviceError('project secret plaintext is invalid', 'HOST_SECRET_REQUEST_INVALID')
      }
      let wrapped
      try {
        wrapped = envelopePlaintext({ purpose, binding, plaintext })
        const ciphertext = await protector.protect(wrapped)
        if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0 || ciphertext.length > MAX_MESSAGE_BYTES) throw serviceError('Host secret protector returned invalid ciphertext')
        return { sealed: ciphertext.toString('base64') }
      } finally {
        plaintext.fill(0)
        wrapped?.fill(0)
      }
    }
    if (request.action === 'unprotect') {
      const ciphertext = Buffer.from(boundedString(request.sealed, 'sealed', Math.ceil(MAX_MESSAGE_BYTES * 4 / 3) + 8), 'base64')
      if (ciphertext.length === 0 || ciphertext.length > MAX_MESSAGE_BYTES || ciphertext.toString('base64') !== request.sealed) {
        ciphertext.fill(0)
        throw serviceError('protected project secret is invalid', 'HOST_SECRET_INVALID')
      }
      let wrapped
      try {
        wrapped = await protector.unprotect(ciphertext)
        if (!Buffer.isBuffer(wrapped) || wrapped.length === 0 || wrapped.length > MAX_PLAINTEXT_BYTES * 2) throw serviceError('Host secret protector returned invalid plaintext', 'HOST_SECRET_INVALID')
        const plaintext = openEnvelope({ purpose, binding, plaintext: wrapped })
        try { return { plaintext: plaintext.toString('base64') } } finally { plaintext.fill(0) }
      } catch (error) {
        if (error?.code === 'HOST_SECRET_INVALID') throw error
        throw serviceError('protected project secret could not be opened', 'HOST_SECRET_INVALID')
      } finally {
        ciphertext.fill(0)
        wrapped?.fill(0)
      }
    }
    throw serviceError('Host secret action is invalid', 'HOST_SECRET_REQUEST_INVALID')
  }

  const start = async () => {
    if (closed) throw serviceError('Host secret service is closed')
    if (server) return
    if (process.platform !== 'win32') await rm(endpoint, { force: true }).catch(() => undefined)
    server = net.createServer(socket => {
      let bytes = 0
      let text = ''
      socket.setEncoding('utf8')
      socket.on('data', chunk => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > maxMessageBytes) return socket.destroy()
        text += chunk
        const newline = text.indexOf('\n')
        if (newline < 0) return
        socket.pause()
        let request
        try { request = JSON.parse(text.slice(0, newline)) } catch {}
        Promise.resolve(request ? handleRequest(request) : Promise.reject(serviceError('Host secret request is invalid', 'HOST_SECRET_REQUEST_INVALID')))
          .then(result => socket.end(`${JSON.stringify({ ok: true, ...result })}\n`))
          .catch(error => socket.end(`${JSON.stringify({ ok: false, code: error?.code === 'HOST_SECRET_REQUEST_INVALID' ? error.code : error?.code === 'HOST_SECRET_INVALID' ? error.code : 'HOST_SECRET_UNAVAILABLE' })}\n`))
      })
      socket.on('error', () => undefined)
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(endpoint, () => { server.off('error', reject); resolve() })
    })
  }

  const runtimeEnvironment = (env = {}) => {
    if (!server || closed) throw serviceError('Host secret service is not ready')
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

module.exports = { ENDPOINT_ENV, TOKEN_ENV, createAgentTeamsSecretService, startAgentTeamsSecretService }
