const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { generateKeyPairSync } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

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
    reason: 'LAN auto-discovery beacon is not implemented; the base layer requires explicit mTLS certificate pinning, so discovery cannot be pretended.'
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
