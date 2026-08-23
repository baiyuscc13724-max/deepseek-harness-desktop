const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { generateKeyPairSync } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { once } = require('node:events')
const WebSocket = require('ws')
const { createHealthServer, createRelayRouter } = require('../services/wss-relay/server.cjs')

const serviceUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-entry-service.js')).href

async function usingService(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-entry-'))
  let now = 80_000_000
  const { ProjectEntryService } = await import(`${serviceUrl}?test=${Date.now()}-${Math.random()}`)
  const service = new ProjectEntryService({ dshHome: root, now: () => now })
  try {
    await run({ root, service, setNow: value => { now = value }, ProjectEntryService })
  } finally {
    await service.close()
    await rm(root, { recursive: true, force: true })
  }
}

test('project entry reports honest LAN and remote capability before project creation', async () => usingService(async ({ service }) => {
  const status = await service.status()
  assert.equal(status.project, null)
  assert.deepEqual(status.lan.autoDiscovery, {
    implemented: false,
    reason: 'LAN discovery is not broadcast; the one-time pairing response carries the pinned endpoint and mTLS credential.'
  })
  assert.equal(status.lan.implemented, true)
  assert.equal(status.lan.listening, false)
  assert.equal(status.relay.enabled, false)
  assert.equal(status.relay.connected, false)
  assert.equal(status.relay.channelReady, false)
}))

test('project creation persists one owner and reopens without exposing private material in status', async () => usingService(async ({ root, service, ProjectEntryService }) => {
  const created = await service.createProject({ projectName: 'Private Release', displayName: 'Owner' })
  assert.equal(created.existing, false)
  assert.match(created.status.project.projectRef, /^project_[A-Za-z0-9_-]{20,64}$/u)
  assert.equal(created.status.project.memberCount, 1)
  assert.equal(created.status.project.revision, 2)
  assert.equal(created.status.project.ownerDisplayName, 'Owner')
  assert.equal(JSON.stringify(created.status).includes('Private Release'), false)
  assert.equal(JSON.stringify(created.status).includes('PrivateKey'), false)

  const duplicate = await service.createProject({ projectName: 'Ignored', displayName: 'Ignored' })
  assert.equal(duplicate.existing, true)
  assert.equal(duplicate.status.project.projectRef, created.status.project.projectRef)

  const reopened = new ProjectEntryService({ dshHome: root, now: () => 80_000_000 })
  try {
    const restored = await reopened.status()
    assert.equal(restored.project.projectRef, created.status.project.projectRef)
    assert.equal(restored.project.memberCount, 1)
    assert.equal(restored.project.ownerDisplayName, 'Owner')
  } finally {
    await reopened.close()
  }

  const device = JSON.parse(await readFile(path.join(root, 'storages', 'agent_project_device.json'), 'utf8'))
  assert.match(device.device.signingPrivateKey, /^[A-Za-z0-9_-]+$/u)
  assert.match(device.device.encryptionPrivateKey, /^[A-Za-z0-9_-]+$/u)
  assert.equal(JSON.stringify(device).includes('Private Release'), false)
}))

test('remote invitations are bounded, one-time, signed, expiring, and redeem to a persisted member grant', async () => usingService(async ({ root, service, setNow }) => {
  await service.createProject({ projectName: 'Remote Project', displayName: 'Owner' })
  const invite = await service.createInvite({ displayName: 'Reviewer', role: 'reviewer', expiresAtMs: 80_010_000 })
  assert.match(invite.inviteCode, /^invite_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u)
  assert.match(invite.roomRef, /^[A-Za-z0-9_-]{43}$/u)
  assert.equal(invite.role, 'reviewer')
  assert.equal(invite.expiresAt, new Date(80_010_000).toISOString())
  const storedInvites = await readFile(path.join(root, 'storages', 'agent_project_invites.json'), 'utf8')
  assert.equal(storedInvites.includes(invite.inviteCode), false, 'the reusable invitation credential must not be stored in plaintext')

  const collaborator = generateKeyPairSync('ed25519')
  const redeemed = await service.redeemInvite({ inviteCode: invite.inviteCode, displayName: 'Reviewer', publicKey: collaborator.publicKey })
  assert.equal(redeemed.member.role, 'reviewer')
  assert.match(redeemed.member.deviceRef, /^device_[A-Za-z0-9_-]{20,64}$/u)
  assert.equal(typeof redeemed.grant.signature, 'string')
  assert.equal((await service.status()).project.memberCount, 2)
  await assert.rejects(service.redeemInvite({ inviteCode: invite.inviteCode, displayName: 'Replay', publicKey: collaborator.publicKey }), error => error?.code === 'PROJECT_ENTRY_INVITE_INVALID')

  const tampered = `${invite.inviteCode.slice(0, -1)}${invite.inviteCode.endsWith('A') ? 'B' : 'A'}`
  await assert.rejects(service.redeemInvite({ inviteCode: tampered, displayName: 'Bad', publicKey: collaborator.publicKey }), error => error?.code === 'PROJECT_ENTRY_INVITE_INVALID')
  const expiring = await service.createInvite({ displayName: 'Late', role: 'observer', expiresAtMs: 80_015_000 })
  setNow(80_020_000)
  await assert.rejects(service.redeemInvite({ inviteCode: expiring.inviteCode, displayName: 'Late', publicKey: collaborator.publicKey }), error => error?.code === 'PROJECT_ENTRY_INVITE_EXPIRED')
}))

test('remote relay stays disabled until a credential-free WSS endpoint and room exist', async () => usingService(async ({ service }) => {
  await service.createProject({ projectName: 'Relay Project', displayName: 'Owner' })
  await assert.rejects(service.connectRemote(), error => error?.code === 'PROJECT_ENTRY_RELAY_NOT_CONFIGURED')
  await assert.rejects(service.setRelay({ relayUrl: 'ws://relay.example.com' }), /credential-free wss/u)
  await assert.rejects(service.setRelay({ relayUrl: 'wss://user:secret@relay.example.com' }), /credential-free wss/u)

  const configured = await service.setRelay({ relayUrl: 'wss://relay.example.com' })
  assert.equal(configured.enabled, true)
  assert.equal(configured.relayUrl, 'wss://relay.example.com/')
  await assert.rejects(service.connectRemote(), error => error?.code === 'PROJECT_ENTRY_RELAY_ROOM_MISSING')

  await service.createInvite({ displayName: 'Contributor', role: 'contributor' })
  await assert.rejects(service.connectRemote(), error => error?.code === 'PROJECT_ENTRY_RELAY_WEBSOCKET_UNAVAILABLE')
  const status = await service.status()
  assert.equal(status.relay.enabled, true)
  assert.equal(status.relay.connected, false)
  assert.equal(status.relay.channelReady, false)
}))

test('two desktops complete the invitation handshake and exchange authenticated E2EE relay presence', async t => {
  const authorityHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-authority-'))
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-collaborator-'))
  const server = createHealthServer()
  const router = createRelayRouter({ server })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const localUrl = `ws://127.0.0.1:${server.address().port}`
  class LocalRelaySocket extends WebSocket {
    constructor(_publicUrl, options) { super(localUrl, options) }
  }
  const { ProjectEntryService } = await import(`${serviceUrl}?pairing=${Date.now()}-${Math.random()}`)
  const authority = new ProjectEntryService({ dshHome: authorityHome, WebSocketImpl: LocalRelaySocket, now: () => 80_000_000 })
  const collaborator = new ProjectEntryService({ dshHome: collaboratorHome, WebSocketImpl: LocalRelaySocket, now: () => 80_000_000 })
  t.after(async () => {
    await collaborator.close()
    await authority.close()
    for (const client of router.wss.clients) client.terminate()
    await router.close().catch(() => {})
    await new Promise(resolve => server.close(resolve))
    await rm(authorityHome, { recursive: true, force: true })
    await rm(collaboratorHome, { recursive: true, force: true })
  })

  await authority.createProject({ projectName: 'Paired Project', displayName: 'Owner' })
  const invite = await authority.createInvite({ displayName: 'Reviewer', role: 'reviewer' })
  const request = await collaborator.createJoinRequest({ inviteCode: invite.inviteCode, displayName: 'Reviewer' })
  assert.match(request.joinRequest, /^joinreq_[A-Za-z0-9_-]+$/u)
  const pendingJoin = await readFile(path.join(collaboratorHome, 'storages', 'agent_project_pending_join.json'), 'utf8')
  assert.equal(pendingJoin.includes(invite.inviteCode), false, 'the reusable invitation credential must not be persisted with pending device keys')
  assert.equal((await collaborator.status()).pairing.pending, true)
  const approval = await authority.approveJoinRequest({ joinRequest: request.joinRequest })
  assert.match(approval.joinResponse, /^joinack_[A-Za-z0-9_-]+$/u)
  const approvalPayload = JSON.parse(Buffer.from(approval.joinResponse.slice('joinack_'.length), 'base64url').toString('utf8'))
  assert.equal(approvalPayload.lan, undefined)
  assert.equal(approvalPayload.relayUrl, undefined)
  assert.equal(typeof approvalPayload.pairingCipher?.ciphertext, 'string')
  assert.equal(JSON.stringify(approvalPayload).includes('BEGIN PRIVATE KEY'), false)
  const joined = await collaborator.completeJoinRequest({ joinResponse: approval.joinResponse })
  assert.equal(joined.member.role, 'reviewer')
  assert.equal(joined.status.project.role, 'reviewer')
  assert.equal(joined.status.relay.channelReady, true)
  assert.equal(joined.status.relay.enabled, false, 'approval before relay setup must still complete without pretending the relay is configured')
  assert.equal(joined.status.relay.roomRef, invite.roomRef, 'the approved opaque room remains available for later manual relay setup')
  assert.equal((await authority.status()).project.memberCount, 2)

  await authority.setRelay({ relayUrl: 'wss://relay.example.com/project' })
  assert.equal((await collaborator.status()).relay.enabled, false, 'the collaborator does not silently learn a relay URL configured after approval')
  await assert.rejects(collaborator.setRelay({ relayUrl: 'wss://user:secret@relay.example.com/project' }), /credential-free wss/u)
  const rescued = await collaborator.setRelay({ relayUrl: 'wss://relay.example.com/project' })
  assert.equal(rescued.enabled, true)
  assert.equal(rescued.roomRef, invite.roomRef, 'manual setup reuses the authenticated room instead of requiring another invitation')

  await authority.connectRemote()
  await collaborator.connectRemote()
  for (let index = 0; index < 200; index += 1) {
    const [authorityStatus, collaboratorStatus] = await Promise.all([authority.status(), collaborator.status()])
    if (authorityStatus.relay.lastDelivery?.type === 'presence' && collaboratorStatus.relay.lastDelivery?.type === 'presence.ack') return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('paired desktops did not exchange E2EE presence through the relay')
})

test('two paired desktops automatically establish a real LAN mTLS and E2EE connection without exposing PEM fields', async t => {
  const authorityHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-lan-authority-'))
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-lan-collaborator-'))
  const { ProjectEntryService } = await import(`${serviceUrl}?lan-pairing=${Date.now()}-${Math.random()}`)
  const fixedNow = Date.now()
  const authority = new ProjectEntryService({ dshHome: authorityHome, now: () => fixedNow })
  const collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => fixedNow })
  t.after(async () => {
    await collaborator.close()
    await authority.close()
    await rm(authorityHome, { recursive: true, force: true })
    await rm(collaboratorHome, { recursive: true, force: true })
  })

  await authority.createProject({ projectName: 'LAN Project', displayName: 'Owner' })
  const listening = await authority.startLan({ host: '127.0.0.1' })
  assert.equal(listening.listening, true)
  assert.equal(listening.requiresExplicitCertificates, false)
  assert.deepEqual(Object.keys(listening.endpoint).sort(), ['host', 'port'])

  const invite = await authority.createInvite({ displayName: 'LAN Reviewer', role: 'reviewer' })
  const request = await collaborator.createJoinRequest({ inviteCode: invite.inviteCode, displayName: 'LAN Reviewer' })
  const approval = await authority.approveJoinRequest({ joinRequest: request.joinRequest })
  assert.equal(approval.joinResponse.includes('BEGIN PRIVATE KEY'), false, 'the transfer stays encoded instead of rendering PEM in the UI')
  const tamperedApproval = JSON.parse(Buffer.from(approval.joinResponse.slice('joinack_'.length), 'base64url').toString('utf8'))
  tamperedApproval.pairingCipher.ciphertext = `${tamperedApproval.pairingCipher.ciphertext.slice(0, -1)}${tamperedApproval.pairingCipher.ciphertext.endsWith('A') ? 'B' : 'A'}`
  const tamperedJoinResponse = `joinack_${Buffer.from(JSON.stringify(tamperedApproval), 'utf8').toString('base64url')}`
  await assert.rejects(collaborator.completeJoinRequest({ joinResponse: tamperedJoinResponse }), error => error?.code === 'PROJECT_ENTRY_INVITE_INVALID' && /authority signature/u.test(error.message))
  await collaborator.completeJoinRequest({ joinResponse: approval.joinResponse })
  const collaboratorStatus = await collaborator.status()
  assert.deepEqual(collaboratorStatus.lan.endpoint, listening.endpoint)

  let connected
  try { connected = await collaborator.connectLan() }
  catch (error) { assert.fail(`${error?.stack || error}\nserver rejection: ${authority.lanTransport?.lastError?.stack || authority.lanTransport?.lastError}`) }
  assert.equal(connected.connected, true)
  assert.equal((await collaborator.status()).lan.connected, true)
  assert.equal((await authority.status()).relay.lastDelivery.type, 'presence')
})
