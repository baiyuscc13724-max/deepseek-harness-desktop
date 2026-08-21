const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { pathToFileURL } = require('node:url')

const transportUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-lan-transport.js')).href
const channelUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-secure-channel.js')).href
const PROJECT = `project_${'L'.repeat(26)}`
const SENDER = `device_${'M'.repeat(26)}`
const TARGET = `device_${'N'.repeat(26)}`
const ENDPOINT = `endpoint_${'P'.repeat(26)}`

class FakeServer extends EventEmitter {
  constructor(options, accept) {
    super()
    this.options = options
    this.accept = accept
    this.closed = false
  }
  listen(options) {
    this.listenOptions = options
    queueMicrotask(() => this.emit('listening'))
  }
  address() { return { address: this.listenOptions.host, port: this.listenOptions.port || 43123 } }
  close(callback) { this.closed = true; callback?.() }
}
class FakeSocket extends EventEmitter {
  constructor({ authorized = true, alpnProtocol = 'dsh-project/1', raw = Buffer.from('peer-certificate') } = {}) {
    super()
    this.authorized = authorized
    this.alpnProtocol = alpnProtocol
    this.raw = raw
    this.destroyed = false
    this.writable = true
    this.writes = []
  }
  getPeerCertificate() { return { raw: this.raw } }
  setTimeout(value, callback) { this.timeout = value; this.timeoutCallback = callback }
  write(value) { this.writes.push(String(value)); return true }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.writable = false; this.emit('close') }
}
function fakeTls() {
  const state = { createCount: 0, server: undefined }
  state.module = {
    createServer(options, accept) {
      state.createCount += 1
      state.server = new FakeServer(options, accept)
      return state.server
    }
  }
  return state
}
async function flush() {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}
async function packetFixture() {
  const channelMod = await import(channelUrl)
  const sender = channelMod.generateProjectTransportKeys()
  const recipient = channelMod.generateProjectTransportKeys()
  const channel = new channelMod.ProjectSecureChannel({
    projectRef: PROJECT,
    authorityEpoch: 1,
    targetDeviceRef: TARGET,
    recipientEncryptionPrivateKey: recipient.encryption.privateKey,
    resolveSenderSigningKey: () => sender.signing.publicKey,
    verifyTlsPeer: peer => peer?.authorized === true && peer?.protocol === 'dsh-project/1' && /^cert_/u.test(peer.certificateRef),
    now: () => 80_000_000
  })
  const packet = channelMod.sealProjectPacket({
    projectRef: PROJECT, authorityEpoch: 1, senderDeviceRef: SENDER, targetDeviceRef: TARGET, transport: 'lan_mtls',
    payload: { type: 'task.upsert', taskRef: 'task_from_lan' }, senderSigningPrivateKey: sender.signing.privateKey,
    recipientEncryptionPublicKey: recipient.encryption.publicKey, createdAt: 80_000_000, expiresAt: 80_060_000
  })
  return { channel, packet }
}
function options(mod, tls, extra = {}) {
  return {
    enabled: true,
    endpointRef: ENDPOINT,
    host: '192.168.1.10',
    port: 0,
    cert: 'test-cert',
    key: 'test-key',
    ca: 'test-ca',
    resolveChannel: () => ({ open() { throw new Error('unused') } }),
    onDelivery: () => undefined,
    tlsModule: tls.module,
    ...extra
  }
}

test('LAN listener is off by default and rejects wildcard, DNS, and public binds', async () => {
  const mod = await import(transportUrl)
  const tls = fakeTls()
  const disabled = new mod.LanProjectTransport({ ...options(mod, tls), enabled: false })
  await assert.rejects(disabled.start(), /requires an explicit enabled policy/u)
  assert.equal(tls.createCount, 0)
  for (const host of ['0.0.0.0', '::', 'project-host.local', '8.8.8.8']) {
    assert.throws(() => new mod.LanProjectTransport({ ...options(mod, tls), host }), /explicit loopback|IP literal/u)
  }
})

test('explicit listener hardens TLS 1.3 mutual authentication and hides bind credentials', async () => {
  const mod = await import(transportUrl)
  const tls = fakeTls()
  const transport = new mod.LanProjectTransport(options(mod, tls))
  const started = await transport.start()
  assert.equal(started.listening, true)
  assert.deepEqual(tls.server.options.ALPNProtocols, ['dsh-project/1'])
  assert.equal(tls.server.options.requestCert, true)
  assert.equal(tls.server.options.rejectUnauthorized, true)
  assert.equal(tls.server.options.minVersion, 'TLSv1.3')
  assert.deepEqual(tls.server.listenOptions, { host: '192.168.1.10', port: 0, exclusive: true })
  const projection = JSON.stringify(transport)
  for (const secret of ['192.168.1.10', '43123', 'test-cert', 'test-key', 'test-ca']) assert.equal(projection.includes(secret), false)
  await transport.stop()
  assert.equal(tls.server.closed, true)
})

test('authorized ALPN peers deliver only packets admitted by the pinned mTLS E2EE channel', async () => {
  const mod = await import(transportUrl)
  const tls = fakeTls()
  const state = await packetFixture()
  const delivered = []
  const transport = new mod.LanProjectTransport(options(mod, tls, {
    resolveChannel: target => target === TARGET ? state.channel : undefined,
    onDelivery: opened => { delivered.push(opened) }
  }))
  await transport.start()
  const socket = new FakeSocket()
  tls.server.accept(socket)
  socket.emit('data', Buffer.from(`${JSON.stringify(state.packet)}\n`))
  await flush()
  assert.equal(delivered.length, 1)
  assert.deepEqual(delivered[0].payload, { type: 'task.upsert', taskRef: 'task_from_lan' })
  assert.equal(socket.writes.length, 1)
  const acknowledgment = JSON.parse(socket.writes[0])
  assert.deepEqual(acknowledgment, { ok: true, packetRef: state.packet.packetRef, status: 'delivered' })
  assert.equal(socket.writes[0].includes('task_from_lan'), false)
  await transport.stop()
})

test('unauthorized, wrong-ALPN, excess, invalid, and oversized peers fail closed', async () => {
  const mod = await import(transportUrl)
  const tls = fakeTls()
  const transport = new mod.LanProjectTransport(options(mod, tls, { maxConnections: 1, maxFrameBytes: 128 }))
  await transport.start()
  const unauthorized = new FakeSocket({ authorized: false })
  tls.server.accept(unauthorized)
  assert.equal(unauthorized.destroyed, true)
  const wrongProtocol = new FakeSocket({ alpnProtocol: 'http/1.1' })
  tls.server.accept(wrongProtocol)
  assert.equal(wrongProtocol.destroyed, true)
  const accepted = new FakeSocket()
  tls.server.accept(accepted)
  const excess = new FakeSocket()
  tls.server.accept(excess)
  assert.equal(excess.destroyed, true)
  accepted.emit('data', Buffer.from('{not-json}\n'))
  await flush()
  assert.deepEqual(JSON.parse(accepted.writes[0]), { ok: false, code: 'REJECTED' })
  const oversized = new FakeSocket()
  accepted.destroy()
  tls.server.accept(oversized)
  oversized.emit('data', Buffer.alloc(129, 0x41))
  assert.equal(oversized.destroyed, true)
  assert.deepEqual(JSON.parse(oversized.writes[0]), { ok: false, code: 'REJECTED' })
  await transport.stop()
})
