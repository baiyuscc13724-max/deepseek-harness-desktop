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
  const seal = (payload, createdAt = 80_000_000) => channelMod.sealProjectPacket({
    projectRef: PROJECT, authorityEpoch: 1, senderDeviceRef: SENDER, targetDeviceRef: TARGET, transport: 'lan_mtls',
    payload, senderSigningPrivateKey: sender.signing.privateKey,
    recipientEncryptionPublicKey: recipient.encryption.publicKey, createdAt, expiresAt: createdAt + 60_000
  })
  return { channel, packet, seal, sender, recipient, channelMod }
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

test('persistent authority binding supports coalesced frames, non-await callbacks, sends, and bounded backpressure', async () => {
  const mod = await import(transportUrl)
  const tls = fakeTls()
  const state = await packetFixture()
  const delivered = []
  const never = new Promise(() => {})
  const transport = new mod.LanProjectTransport(options(mod, tls, {
    resolveChannel: target => target === TARGET ? state.channel : undefined,
    onDelivery: opened => { delivered.push(opened); return never },
    maxBufferedBytes: 1024 * 1024
  }))
  await transport.start()
  const socket = new FakeSocket()
  tls.server.accept(socket)
  const second = state.seal({ type: 'task.upsert', taskRef: 'second_frame' }, 80_000_001)
  socket.emit('data', Buffer.from(`${JSON.stringify(state.packet)}\n${JSON.stringify(second)}\n`))
  assert.equal(delivered.length, 2, 'callback promises are not awaited before the next frame')
  assert.equal(socket.writes.length, 2, 'both ACKs are immediate')
  assert.equal(transport.canSend(SENDER), true)

  const collaboratorChannel = new state.channelMod.ProjectSecureChannel({
    projectRef: PROJECT, authorityEpoch: 1, targetDeviceRef: SENDER,
    recipientEncryptionPrivateKey: state.sender.encryption.privateKey,
    resolveSenderSigningKey: () => state.recipient.signing.publicKey,
    verifyTlsPeer: peer => peer?.authorized === true && peer?.protocol === 'dsh-project/1',
    now: () => 80_000_000
  })
  const response = state.channelMod.sealProjectPacket({
    projectRef: PROJECT, authorityEpoch: 1, senderDeviceRef: TARGET, targetDeviceRef: SENDER, transport: 'lan_mtls',
    payload: { type: 'review.submit', reviewRef: 'authority_reply' }, senderSigningPrivateKey: state.recipient.signing.privateKey,
    recipientEncryptionPublicKey: state.sender.encryption.publicKey, createdAt: 80_000_000, expiresAt: 80_060_000
  })
  const queued = transport.send(response)
  assert.equal(queued.queued, true)
  const outbound = JSON.parse(socket.writes[2])
  assert.equal(collaboratorChannel.open(outbound, { tlsPeer: { authorized: true, protocol: 'dsh-project/1', certificateRef: 'cert_test' } }).payload.reviewRef, 'authority_reply')
  socket.writableLength = 1024 * 1024
  assert.throws(() => transport.send(response), /backpressure/u)
  await transport.stop()
})

test('persistent collaborator client pins server certificate, parses partial frames, and schedules bounded reconnect', async () => {
  const mod = await import(transportUrl)
  const state = await packetFixture()
  const serverRaw = Buffer.from('pinned-server-certificate')
  const sockets = []
  const scheduled = []
  const tlsModule = {
    connect(options) {
      const socket = new FakeSocket({ raw: serverRaw })
      socket.connectOptions = options
      sockets.push(socket)
      return socket
    }
  }
  const collaboratorChannel = new state.channelMod.ProjectSecureChannel({
    projectRef: PROJECT, authorityEpoch: 1, targetDeviceRef: SENDER,
    recipientEncryptionPrivateKey: state.sender.encryption.privateKey,
    resolveSenderSigningKey: () => state.recipient.signing.publicKey,
    verifyTlsPeer: peer => peer?.authorized === true && peer?.protocol === 'dsh-project/1',
    now: () => 80_000_000
  })
  const client = new mod.PersistentLanProjectClient({
    host: '192.168.1.10', port: 43123, cert: 'client-cert', key: 'client-key', ca: 'ca',
    serverCertificateRef: mod.safeCertificateRef({ raw: serverRaw }),
    resolveChannel: target => target === SENDER ? collaboratorChannel : undefined,
    onDelivery: () => new Promise(() => {}), tlsModule,
    scheduler(callback, delay) { const handle = { callback, delay, unref() {} }; scheduled.push(handle); return handle },
    cancelScheduler() {}
  })
  assert.throws(() => client.send(state.packet), /unavailable/u)
  const pending = client.start()
  sockets[0].emit('secureConnect')
  await pending
  assert.equal(client.toJSON().connected, true)
  assert.deepEqual(sockets[0].connectOptions.ALPNProtocols, ['dsh-project/1'])
  const request = state.channelMod.sealProjectPacket({
    projectRef: PROJECT, authorityEpoch: 1, senderDeviceRef: TARGET, targetDeviceRef: SENDER, transport: 'lan_mtls',
    payload: { type: 'review.submit', reviewRef: 'partial' }, senderSigningPrivateKey: state.recipient.signing.privateKey,
    recipientEncryptionPublicKey: state.sender.encryption.publicKey, createdAt: 80_000_000, expiresAt: 80_060_000
  })
  const encoded = Buffer.from(`${JSON.stringify(request)}\n`)
  sockets[0].emit('data', encoded.subarray(0, 7)); sockets[0].emit('data', encoded.subarray(7))
  assert.equal(JSON.parse(sockets[0].writes[0]).packetRef, request.packetRef, 'never-settling callback does not delay ACK')
  sockets[0].destroy()
  assert.equal(client.toJSON().reconnecting, true)
  assert.equal(scheduled[0].delay, 1000)
  scheduled[0].callback()
  sockets[1].emit('error', new Error('reconnect failed'))
  await flush()
  assert.equal(scheduled[1].delay, 2000)
  const stopping = client.stop()
  assert.equal(client.stop(), stopping)
  await stopping

  const badSockets = []
  const badClient = new mod.PersistentLanProjectClient({
    host: '192.168.1.10', port: 43123, cert: 'client-cert', key: 'client-key', ca: 'ca',
    serverCertificateRef: mod.safeCertificateRef({ raw: Buffer.from('different-server') }),
    resolveChannel: () => collaboratorChannel, onDelivery: () => undefined,
    tlsModule: { connect() { const socket = new FakeSocket({ raw: serverRaw }); badSockets.push(socket); return socket } }
  })
  const rejected = badClient.start()
  badSockets[0].emit('secureConnect')
  await assert.rejects(rejected, /server identity|ALPN/u)
  assert.equal(badSockets[0].destroyed, true)
  await badClient.stop()
})

test('authenticated LAN sockets cannot change device or certificate binding', async () => {
  const mod = await import(transportUrl)
  const tls = fakeTls()
  const transport = new mod.LanProjectTransport(options(mod, tls, {
    resolveChannel: target => target === TARGET ? { open(packet) { return Object.freeze({ packetRef: packet.packetRef, senderDeviceRef: packet.testSender, authorityEpoch: 1, payload: Object.freeze({ type: 'test' }) }) } } : undefined
  }))
  await transport.start()
  const first = new FakeSocket({ raw: Buffer.from('certificate-one') })
  tls.server.accept(first)
  first.emit('data', Buffer.from(`${JSON.stringify({ transport: 'lan_mtls', targetDeviceRef: TARGET, packetRef: 'packet_one', testSender: SENDER })}\n`))
  assert.equal(transport.canSend(SENDER), true)
  const otherDevice = `device_${'Q'.repeat(26)}`
  first.emit('data', Buffer.from(`${JSON.stringify({ transport: 'lan_mtls', targetDeviceRef: TARGET, packetRef: 'packet_two', testSender: otherDevice })}\n`))
  assert.equal(first.destroyed, true, 'one authenticated socket cannot switch device identity')

  const rebound = new FakeSocket({ raw: Buffer.from('certificate-two') })
  tls.server.accept(rebound)
  rebound.emit('data', Buffer.from(`${JSON.stringify({ transport: 'lan_mtls', targetDeviceRef: TARGET, packetRef: 'packet_three', testSender: SENDER })}\n`))
  assert.equal(rebound.destroyed, true, 'one device cannot switch its pinned client certificate')
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
  assert.equal(accepted.destroyed, true)
  assert.equal(accepted.writes.length, 0, 'malformed frames receive no admission oracle')
  const oversized = new FakeSocket()
  tls.server.accept(oversized)
  oversized.emit('data', Buffer.alloc(129, 0x41))
  assert.equal(oversized.destroyed, true)
  assert.equal(oversized.writes.length, 0, 'oversized frames receive no admission oracle')
  await transport.stop()
})
