const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { generateKeyPairSync } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-collaboration.js')).href

function keys() {
  return generateKeyPairSync('ed25519')
}

async function fixture() {
  const mod = await import(moduleUrl)
  let now = 10_000_000
  const authorityKeys = keys()
  const authority = new mod.ProjectCollaborationAuthority({
    projectIdentity: 'private-project-id',
    secret: 'project-secret-with-at-least-twenty-four-characters',
    authorityPrivateKey: authorityKeys.privateKey,
    now: () => now
  })
  const ownerKeys = keys()
  const owner = authority.registerDevice({
    userHandle: 'private-owner-user', deviceHandle: 'private-owner-device', displayName: 'Owner', role: 'owner', publicKey: ownerKeys.publicKey
  })
  const contributorKeys = keys()
  const contributor = authority.registerDevice({
    actorDeviceRef: owner.member.deviceRef,
    userHandle: 'private-contributor-user', deviceHandle: 'private-contributor-device', displayName: 'Contributor', role: 'contributor', publicKey: contributorKeys.publicKey
  })
  const reviewerKeys = keys()
  const reviewer = authority.registerDevice({
    actorDeviceRef: owner.member.deviceRef,
    userHandle: 'private-reviewer-user', deviceHandle: 'private-reviewer-device', displayName: 'Reviewer', role: 'reviewer', publicKey: reviewerKeys.publicKey
  })
  return {
    mod, authority, authorityKeys, owner, ownerKeys, contributor, contributorKeys, reviewer, reviewerKeys,
    setNow(value) { now = value }, getNow() { return now }
  }
}

test('membership grants expose only opaque references and verify against the authority key', async () => {
  const state = await fixture()
  const { authority, mod, owner, contributor } = state
  assert.match(authority.projectRef, /^project_[A-Za-z0-9_-]+$/u)
  assert.match(owner.member.collaboratorRef, /^collaborator_[A-Za-z0-9_-]+$/u)
  assert.match(owner.member.deviceRef, /^device_[A-Za-z0-9_-]+$/u)
  assert.equal(mod.verifyMembershipGrant(owner.grant, authority.authorityPublicKeyPem(), state.getNow()), true)
  assert.equal(mod.verifyMembershipGrant(contributor.grant, authority.authorityPublicKeyPem(), state.getNow()), true)
  const projected = JSON.stringify({ owner, contributor, authority })
  for (const raw of ['private-project-id', 'private-owner-user', 'private-owner-device', 'private-contributor-user', 'private-contributor-device', 'project-secret-with-at-least-twenty-four-characters']) {
    assert.equal(projected.includes(raw), false)
  }
  assert.equal(Object.hasOwn(owner.grant, 'userId'), false)
  assert.equal(Object.hasOwn(owner.grant, 'deviceId'), false)
})

test('RBAC prevents role escalation and admits only signed permitted event types', async () => {
  const state = await fixture()
  const { authority, mod, owner, contributor, contributorKeys, reviewer, reviewerKeys } = state
  assert.throws(() => authority.registerDevice({
    actorDeviceRef: contributor.member.deviceRef,
    userHandle: 'forbidden-user', deviceHandle: 'forbidden-device', displayName: 'Forbidden', role: 'observer', publicKey: keys().publicKey
  }), /lacks membership permission/u)
  assert.throws(() => authority.nextEvent({ deviceRef: contributor.member.deviceRef, type: 'review.submit', payload: { reviewRef: 'review_1' } }), /cannot emit/u)

  const contribution = authority.nextEvent({
    deviceRef: contributor.member.deviceRef,
    type: 'resource.claim',
    payload: { repoRef: 'repo_public', resourceRef: 'src/example.js', mode: 'write' }
  })
  const signedContribution = mod.signProjectEvent(contribution, contributorKeys.privateKey)
  const admitted = authority.submitEvent({ grant: contributor.grant, event: signedContribution, signature: signedContribution.signature })
  assert.equal(admitted.admitted, true)
  assert.equal(admitted.duplicate, false)
  assert.match(admitted.event.eventRef, /^event_/u)
  assert.equal(admitted.event.issuer, 'device')

  const review = authority.nextEvent({ deviceRef: reviewer.member.deviceRef, type: 'review.submit', payload: { changeSetRef: 'changeset_opaque', verdict: 'approved' } })
  const signedReview = mod.signProjectEvent(review, reviewerKeys.privateKey)
  assert.equal(authority.submitEvent({ grant: reviewer.grant, event: signedReview, signature: signedReview.signature }).admitted, true)
  assert.throws(() => authority.submitEvent({ grant: reviewer.grant, event: signedReview, signature: Buffer.alloc(64).toString('base64url') }), /signature is invalid|sequence/u)
  assert.equal(authority.listMembers(owner.member.deviceRef).length, 3)
})

test('event admission is idempotent and enforces per-device sequence and hash chains', async () => {
  const state = await fixture()
  const { authority, mod, contributor, contributorKeys } = state
  const first = authority.nextEvent({ deviceRef: contributor.member.deviceRef, type: 'task.upsert', payload: { taskRef: 'task_1', state: 'in_progress' } })
  const signedFirst = mod.signProjectEvent(first, contributorKeys.privateKey)
  const admitted = authority.submitEvent({ grant: contributor.grant, event: signedFirst, signature: signedFirst.signature })
  const duplicate = authority.submitEvent({ grant: contributor.grant, event: signedFirst, signature: signedFirst.signature })
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.event.eventRef, admitted.event.eventRef)

  const second = authority.nextEvent({ deviceRef: contributor.member.deviceRef, type: 'task.upsert', payload: { taskRef: 'task_1', state: 'completed' } })
  assert.equal(second.sequence, 2)
  assert.equal(second.prevDigest, admitted.event.eventRef)
  const stale = { ...second, sequence: 3 }
  const signedStale = mod.signProjectEvent(stale, contributorKeys.privateKey)
  assert.throws(() => authority.submitEvent({ grant: contributor.grant, event: signedStale, signature: signedStale.signature }), /sequence or hash chain is stale/u)
})

test('payload validation rejects raw identities, non-lossless data, and unsupported broadcasts', async () => {
  const state = await fixture()
  const { authority, contributor } = state
  assert.throws(() => authority.nextEvent({ deviceRef: contributor.member.deviceRef, type: 'handoff.request', payload: { targetSessionId: 'raw-session' } }), /forbidden raw identity field/u)
  assert.throws(() => authority.nextEvent({ deviceRef: contributor.member.deviceRef, type: 'task.upsert', payload: { score: Number.NaN } }), /non-finite/u)
  assert.throws(() => authority.nextEvent({ deviceRef: contributor.member.deviceRef, type: 'broadcast.all', payload: {} }), /unsupported project event type/u)
})

test('offline cursors are authenticated, paginated, and scoped to active project members', async () => {
  const state = await fixture()
  const { authority, mod, owner, contributor, contributorKeys } = state
  const cursor = authority.cursorAtEnd(owner.member.deviceRef)
  for (let index = 0; index < 3; index += 1) {
    const event = authority.nextEvent({ deviceRef: contributor.member.deviceRef, type: 'presence.update', payload: { activity: `step-${index}` } })
    const signed = mod.signProjectEvent(event, contributorKeys.privateKey)
    authority.submitEvent({ grant: contributor.grant, event: signed, signature: signed.signature })
  }
  const first = authority.replay({ requesterDeviceRef: owner.member.deviceRef, cursor, limit: 2 })
  assert.equal(first.events.length, 2)
  assert.equal(first.hasMore, true)
  const second = authority.replay({ requesterDeviceRef: owner.member.deviceRef, cursor: first.nextCursor, limit: 2 })
  assert.equal(second.events.length, 1)
  assert.equal(second.hasMore, false)
  const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`
  assert.throws(() => authority.replay({ requesterDeviceRef: owner.member.deviceRef, cursor: tampered }), /cursor signature is invalid/u)
})

test('revocation and device-key rotation invalidate stale grants and signatures', async () => {
  const state = await fixture()
  const { authority, mod, owner, ownerKeys, contributor, contributorKeys } = state
  const replacementKeys = keys()
  const rotationProof = mod.createDeviceKeyRotationProof({
    projectRef: authority.projectRef,
    authorityEpoch: authority.authorityEpoch,
    deviceRef: contributor.member.deviceRef,
    grantVersion: contributor.member.grantVersion,
    newPublicKey: replacementKeys.publicKey
  }, contributorKeys.privateKey)
  const rotated = authority.rotateDeviceKey({
    actorDeviceRef: contributor.member.deviceRef,
    deviceRef: contributor.member.deviceRef,
    newPublicKey: replacementKeys.publicKey,
    proof: rotationProof
  })
  const next = authority.nextEvent({ deviceRef: contributor.member.deviceRef, type: 'presence.update', payload: { activity: 'rotated' } })
  const oldSignature = mod.signProjectEvent(next, contributorKeys.privateKey)
  assert.throws(() => authority.submitEvent({ grant: rotated.grant, event: oldSignature, signature: oldSignature.signature }), /signature is invalid/u)
  const newSignature = mod.signProjectEvent(next, replacementKeys.privateKey)
  assert.equal(authority.submitEvent({ grant: rotated.grant, event: newSignature, signature: newSignature.signature }).admitted, true)
  assert.throws(() => authority.submitEvent({ grant: contributor.grant, event: newSignature, signature: newSignature.signature }), /grant is stale|grant signature/u)

  authority.revokeDevice({ actorDeviceRef: owner.member.deviceRef, targetDeviceRef: contributor.member.deviceRef, reason: 'access removed' })
  assert.throws(() => authority.nextEvent({ deviceRef: contributor.member.deviceRef, type: 'presence.update', payload: {} }), /unavailable or revoked/u)
  assert.throws(() => authority.revokeDevice({ actorDeviceRef: owner.member.deviceRef, targetDeviceRef: owner.member.deviceRef }), /cannot revoke its own/u)
  assert.equal(mod.verifyMembershipGrant(owner.grant, authority.authorityPublicKeyPem(), state.getNow()), true)
  assert.ok(ownerKeys.privateKey)
})

test('encrypted-store Host snapshots restore sequence state without retaining raw handles', async () => {
  const state = await fixture()
  const { authority, mod, owner, ownerKeys } = state
  const first = authority.nextEvent({ deviceRef: owner.member.deviceRef, type: 'task.upsert', payload: { taskRef: 'task_before_restart' } })
  const signedFirst = mod.signProjectEvent(first, ownerKeys.privateKey)
  const admitted = authority.submitEvent({ grant: owner.grant, event: signedFirst, signature: signedFirst.signature }).event
  admitted.payload.taskRef = 'tampered'
  assert.equal(admitted.payload.taskRef, 'task_before_restart')
  const hostState = authority.exportHostState()
  const serialized = JSON.stringify(hostState)
  for (const raw of ['private-project-id', 'private-owner-user', 'private-owner-device', 'private-contributor-user', 'private-contributor-device']) assert.equal(serialized.includes(raw), false)
  const restored = mod.ProjectCollaborationAuthority.restore(hostState, { now: () => state.getNow() })
  assert.equal(restored.projectRef, authority.projectRef)
  assert.equal(restored.listMembers(owner.member.deviceRef).length, 3)
  const renewed = restored.renewGrant({ actorDeviceRef: owner.member.deviceRef, deviceRef: owner.member.deviceRef })
  const second = restored.nextEvent({ deviceRef: owner.member.deviceRef, type: 'task.upsert', payload: { taskRef: 'task_after_restart' } })
  assert.equal(second.sequence, 2)
  assert.equal(second.prevDigest, admitted.eventRef)
  const signedSecond = mod.signProjectEvent(second, ownerKeys.privateKey)
  assert.equal(restored.submitEvent({ grant: renewed, event: signedSecond, signature: signedSecond.signature }).admitted, true)
  assert.throws(() => mod.ProjectCollaborationAuthority.restore({ ...hostState, projectRef: 'project_AAAAAAAAAAAAAAAAAAAAAAAA' }), /does not match its identity seed/u)
})

test('authority epoch transition is dual-signed and requires reissued grants', async () => {
  const state = await fixture()
  const { authority, mod, owner, ownerKeys } = state
  const oldAuthorityPublicKey = authority.authorityPublicKeyPem()
  const nextAuthorityKeys = keys()
  const transition = authority.advanceAuthorityEpoch({ newAuthorityPrivateKey: nextAuthorityKeys.privateKey })
  assert.equal(mod.verifyAuthorityTransition(transition.transition, oldAuthorityPublicKey, authority.authorityPublicKeyPem()), true)
  assert.equal(authority.authorityEpoch, 2)
  assert.equal(mod.verifyMembershipGrant(owner.grant, authority.authorityPublicKeyPem(), state.getNow()), false)
  const renewed = authority.renewGrant({ actorDeviceRef: owner.member.deviceRef, deviceRef: owner.member.deviceRef })
  assert.equal(mod.verifyMembershipGrant(renewed, authority.authorityPublicKeyPem(), state.getNow()), true)
  const event = authority.nextEvent({ deviceRef: owner.member.deviceRef, type: 'task.upsert', payload: { taskRef: 'post-failover' } })
  const signed = mod.signProjectEvent(event, ownerKeys.privateKey)
  assert.equal(authority.submitEvent({ grant: renewed, event: signed, signature: signed.signature }).admitted, true)
})
