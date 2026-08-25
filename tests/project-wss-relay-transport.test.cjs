const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { once } = require('node:events')
const WebSocket = require('ws')
const { pathToFileURL } = require('node:url')
const { createHealthServer, createRelayRouter } = require('../services/wss-relay/server.cjs')

const transportUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-wss-relay-transport.js')).href
const channelUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-secure-channel.js')).href
const PROJECT = `project_${'R'.repeat(26)}`
const AUTHORITY = `device_${'S'.repeat(26)}`
const COLLABORATOR = `device_${'T'.repeat(26)}`
const ROOM = Buffer.alloc(32, 19).toString('base64url')

async function waitFor(predicate) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('condition was not reached')
}

test('project relay URLs require credential-free WSS/443 and explicit enablement', async () => {
  const mod = await import(transportUrl)
  assert.equal(mod.safeRelayUrl('wss://relay.example.com/project'), 'wss://relay.example.com/project')
  for (const value of ['ws://relay.example.com', 'wss://relay.example.com:8443', 'wss://user:pass@relay.example.com']) assert.throws(() => mod.safeRelayUrl(value), /credential-free wss/u)
  class UnusedSocket {}
  const disabled = new mod.ProjectWssRelayTransport({
    enabled: false, projectRef: PROJECT, role: 'authority', roomRef: ROOM, relayUrl: 'wss://relay.example.com',
    WebSocketImpl: UnusedSocket, resolveChannel: () => undefined, onDelivery: () => undefined
  })
  await assert.rejects(disabled.start(), /explicit enabled policy/u)
  const projection = JSON.stringify(disabled)
  assert.equal(projection.includes(ROOM), false)
  assert.equal(projection.includes('relay.example.com'), false)
})

test('existing blind relay transports authenticated project packets without plaintext or broad routing', async t => {
  const transportMod = await import(transportUrl)
  const channelMod = await import(channelUrl)
  const server = createHealthServer()
  const router = createRelayRouter({ server })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const localUrl = `ws://127.0.0.1:${server.address().port}`
  class LocalRelaySocket extends WebSocket {
    constructor(_publicUrl, options) { super(localUrl, options) }
  }
  t.after(async () => {
    for (const client of router.wss.clients) client.terminate()
    await router.close().catch(() => {})
    await new Promise(resolve => server.close(resolve))
  })

  const authorityKeys = channelMod.generateProjectTransportKeys()
  const collaboratorKeys = channelMod.generateProjectTransportKeys()
  const authorityChannel = new channelMod.ProjectSecureChannel({
    projectRef: PROJECT, authorityEpoch: 1, targetDeviceRef: AUTHORITY,
    recipientEncryptionPrivateKey: authorityKeys.encryption.privateKey,
    resolveSenderSigningKey: deviceRef => deviceRef === COLLABORATOR ? collaboratorKeys.signing.publicKey : undefined,
    now: () => 90_000_000
  })
  const collaboratorChannel = new channelMod.ProjectSecureChannel({
    projectRef: PROJECT, authorityEpoch: 1, targetDeviceRef: COLLABORATOR,
    recipientEncryptionPrivateKey: collaboratorKeys.encryption.privateKey,
    resolveSenderSigningKey: deviceRef => deviceRef === AUTHORITY ? authorityKeys.signing.publicKey : undefined,
    now: () => 90_000_000
  })
  const authorityDeliveries = []
  const collaboratorDeliveries = []
  const common = { enabled: true, projectRef: PROJECT, roomRef: ROOM, relayUrl: 'wss://relay.example.com/project', WebSocketImpl: LocalRelaySocket }
  const authority = new transportMod.ProjectWssRelayTransport({
    ...common, role: 'authority', resolveChannel: target => target === AUTHORITY ? authorityChannel : undefined,
    onDelivery: opened => { authorityDeliveries.push(opened); return new Promise(() => {}) }
  })
  const collaborator = new transportMod.ProjectWssRelayTransport({
    ...common, role: 'collaborator', resolveChannel: target => target === COLLABORATOR ? collaboratorChannel : undefined,
    onDelivery: opened => { collaboratorDeliveries.push(opened) }
  })
  t.after(async () => { await collaborator.stop(); await authority.stop() })
  await authority.start()
  await collaborator.start()

  const request = channelMod.sealProjectPacket({
    projectRef: PROJECT, authorityEpoch: 1, senderDeviceRef: COLLABORATOR, targetDeviceRef: AUTHORITY, transport: 'remote_wss',
    payload: { type: 'task.upsert', taskRef: 'remote_secret_task' }, senderSigningPrivateKey: collaboratorKeys.signing.privateKey,
    recipientEncryptionPublicKey: authorityKeys.encryption.publicKey, createdAt: 90_000_000, expiresAt: 90_060_000
  })
  assert.equal(JSON.stringify(request).includes('remote_secret_task'), false)
  collaborator.send(request)
  await waitFor(() => authorityDeliveries.length === 1)
  assert.equal(authorityDeliveries[0].payload.taskRef, 'remote_secret_task')
  assert.equal(authority.toJSON().connectedPeerCount, 1)
  assert.equal(authority.canSend(COLLABORATOR), true)
  assert.equal(authority.canSend(`device_${'U'.repeat(26)}`), false)
  assert.equal(collaborator.canSend(AUTHORITY), true)
  const secondRequest = channelMod.sealProjectPacket({
    projectRef: PROJECT, authorityEpoch: 1, senderDeviceRef: COLLABORATOR, targetDeviceRef: AUTHORITY, transport: 'remote_wss',
    payload: { type: 'task.upsert', taskRef: 'second_remote_task' }, senderSigningPrivateKey: collaboratorKeys.signing.privateKey,
    recipientEncryptionPublicKey: authorityKeys.encryption.publicKey, createdAt: 90_000_001, expiresAt: 90_060_001
  })
  collaborator.send(secondRequest)
  await waitFor(() => authorityDeliveries.length === 2)
  assert.equal(authorityDeliveries[1].payload.taskRef, 'second_remote_task', 'never-settling delivery promises do not block later frames')

  const response = channelMod.sealProjectPacket({
    projectRef: PROJECT, authorityEpoch: 1, senderDeviceRef: AUTHORITY, targetDeviceRef: COLLABORATOR, transport: 'remote_wss',
    payload: { type: 'review.submit', reviewRef: 'review_remote' }, senderSigningPrivateKey: authorityKeys.signing.privateKey,
    recipientEncryptionPublicKey: collaboratorKeys.encryption.publicKey, createdAt: 90_000_000, expiresAt: 90_060_000
  })
  authority.send(response)
  await waitFor(() => collaboratorDeliveries.length === 1)
  assert.equal(collaboratorDeliveries[0].payload.reviewRef, 'review_remote')

  collaborator.send(request)
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(authorityChannel.toJSON().replayCount, 2)
  assert.equal(authorityDeliveries.length, 2, 'replayed ciphertext must not be delivered twice')
  await collaborator.stop()
  await waitFor(() => authority.toJSON().connectedPeerCount === 0)
  assert.throws(() => authority.send(response), /target project device is not present/u)
})

test('relay rejects plaintext, LAN packets, and packets above its bounded frame', async () => {
  const mod = await import(transportUrl)
  class OpenSocket {
    static OPEN = 1
    static CLOSING = 2
  }
  const transport = new mod.ProjectWssRelayTransport({
    enabled: true, projectRef: PROJECT, role: 'authority', roomRef: ROOM, relayUrl: 'wss://relay.example.com',
    WebSocketImpl: OpenSocket, resolveChannel: () => undefined, onDelivery: () => undefined
  })
  transport.status = 'connected'
  transport.socket = { readyState: 1, bufferedAmount: 0, send() {} }
  assert.throws(() => transport.send({ transport: 'lan_mtls', targetDeviceRef: COLLABORATOR }), /remote_wss/u)
  const oversized = { transport: 'remote_wss', targetDeviceRef: COLLABORATOR, packetRef: 'packet_test', ciphertext: 'A'.repeat(mod.MAX_RELAY_PACKET_BYTES) }
  transport.peerByDevice.set(COLLABORATOR, Buffer.alloc(8, 1))
  assert.throws(() => transport.send(oversized), /exceeds the limit/u)
})
