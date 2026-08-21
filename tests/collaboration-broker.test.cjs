const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'collaboration-broker.js')).href
const SECRET = 'directory-secret-32-bytes-minimum'
const BROKER_SECRET = 'broker-secret-value-32-bytes-min'

async function load() {
  return import(moduleUrl)
}

function presence(sessionId, displayName, updatedAt, overrides = {}) {
  return {
    sessionId,
    scopeRef: 'scope:project-alpha',
    projectRef: 'project:alpha',
    displayName,
    activity: 'running',
    repoRefs: ['repo:alpha'],
    taskRefs: [`task:${sessionId}`],
    resourceRefs: [`resource:${sessionId}`],
    capabilities: ['code'],
    updatedAt,
    ...overrides
  }
}

async function fixture(options = {}) {
  const { CollaborationDirectory, CollaborationBroker } = await load()
  let now = options.now ?? 10_000
  const clock = () => now
  const directory = new CollaborationDirectory({ secret: SECRET, now: clock, maxFreshnessMs: 5_000 })
  const sender = directory.upsert(presence('session-sender-private', 'Sender', now))
  const target = directory.upsert(presence('session-target-private', 'Target', now, { resourceRefs: ['resource:owned'] }))
  let authorized = true
  let reasonVerified = true
  let wakeGranted = false
  const broker = new CollaborationBroker({
    directory,
    secret: BROKER_SECRET,
    now: clock,
    maxFreshnessMs: 5_000,
    cooldownMs: 2_000,
    admissionTtlMs: 1_000,
    authorize: () => authorized,
    verifyReason: () => reasonVerified,
    hasWakeGrant: () => wakeGranted
  })
  return {
    directory,
    broker,
    sender,
    target,
    setNow(value) { now = value },
    policy: {
      setAuthorized(value) { authorized = value },
      setReasonVerified(value) { reasonVerified = value },
      setWakeGranted(value) { wakeGranted = value }
    }
  }
}

function intent(routeRef, overrides = {}) {
  return {
    routeRef,
    reason: 'UNIQUE_OWNER',
    evidence: { resourceRef: 'resource:owned' },
    ...overrides
  }
}

function context(overrides = {}) {
  return {
    senderSessionId: 'session-sender-private',
    scopeRef: 'scope:project-alpha',
    projectRef: 'project:alpha',
    transport: 'local',
    fanoutUsed: 0,
    chain: [],
    ...overrides
  }
}

test('directory exposes stable opaque routes and only authorized minimal presence', async () => {
  const { CollaborationDirectory } = await load()
  let now = 1_000
  const directory = new CollaborationDirectory({ secret: SECRET, now: () => now, maxFreshnessMs: 1_000 })
  const first = directory.upsert(presence('raw-session-id-must-not-leak', 'Owner', now, { taskRefs: ['task:owner'], resourceRefs: ['resource:owner'], userRef: 'user-private', deviceRef: 'device-private' }))
  now += 100
  const second = directory.upsert(presence('raw-session-id-must-not-leak', 'Owner', now, { activity: 'idle', taskRefs: ['task:owner'], resourceRefs: ['resource:owner'], userRef: 'user-private', deviceRef: 'device-private' }))

  assert.equal(first.routeRef, second.routeRef, 'presence refresh preserves the opaque route')
  assert.match(first.routeRef, /^route_[A-Za-z0-9_-]+$/u)
  const encoded = JSON.stringify(second)
  for (const privateValue of ['raw-session-id-must-not-leak', 'user-private', 'device-private']) assert.equal(encoded.includes(privateValue), false)
  assert.deepEqual(directory.discover({ scopeRef: 'scope:project-alpha' }, { requesterSessionId: 'requester', authorize: () => false }), [])

  let authorizationTarget
  const visible = directory.discover({ scopeRef: 'scope:project-alpha', repoRef: 'repo:alpha' }, {
    requesterSessionId: 'requester',
    authorize(info) { authorizationTarget = info.targetSessionId; return true }
  })
  assert.equal(authorizationTarget, 'raw-session-id-must-not-leak', 'only the Host authorization callback sees the private target')
  assert.equal(visible.length, 1)
  assert.equal(visible[0].displayName, 'Owner')
  assert.equal(JSON.stringify(visible).includes('raw-session-id-must-not-leak'), false)
  assert.deepEqual(directory.discover({ scopeRef: 'scope:project-alpha', resourceRef: 'missing' }, { requesterSessionId: 'requester', authorize: () => true }), [])

  now += 4_001
  assert.equal(directory.prune({ staleAfterMs: 4_000 }), 1)
  assert.equal(directory.resolve(first.routeRef), undefined)
})

test('broker admits one exact evidence-backed target and keeps raw identity behind a one-time receipt', async () => {
  const state = await fixture()
  const decision = await state.broker.admit(intent(state.target.routeRef), context())
  assert.equal(decision.admitted, true)
  assert.equal(decision.deliveryMode, 'inbox')
  assert.equal(decision.wakeLevel, 1)
  assert.equal(JSON.stringify(decision).includes('session-target-private'), false)
  assert.equal(Object.hasOwn(decision, 'targetSessionId'), false)

  const internal = state.broker.consume(decision.admissionRef)
  assert.equal(internal.targetSessionId, 'session-target-private')
  assert.equal(internal.targetRouteRef, state.target.routeRef)
  assert.equal(state.broker.consume(decision.admissionRef), undefined, 'admissions are single-use')

  const duplicate = await state.broker.admit(intent(state.target.routeRef), context())
  assert.deepEqual({ admitted: duplicate.admitted, code: duplicate.code }, { admitted: false, code: 'COOLDOWN' })
  state.setNow(12_001)
  state.broker.cleanup()
  const admittedAgain = await state.broker.admit(intent(state.target.routeRef), context())
  assert.equal(admittedAgain.admitted, true)
})

test('broker rejects raw ids, unverifiable reasons, stale targets, loops, fanout, and LAN relays', async () => {
  const state = await fixture()
  const raw = await state.broker.admit({ ...intent(state.target.routeRef), targetSessionId: 'forbidden' }, context())
  assert.equal(raw.code, 'RAW_ID_FORBIDDEN')
  assert.equal((await state.broker.admit(intent('session-target-private'), context())).code, 'INVALID_ROUTE_REF')
  assert.equal((await state.broker.admit({ routeRef: state.target.routeRef, reason: 'UNIQUE_OWNER', evidence: {} }, context())).code, 'EVIDENCE_REQUIRED')
  assert.equal((await state.broker.admit(intent(state.target.routeRef, { reason: 'JUST_SAY_HELLO' }), context())).code, 'UNSUPPORTED_REASON')
  assert.equal((await state.broker.admit(intent(state.target.routeRef, { hop: 1 }), context({ transport: 'lan' }))).code, 'HOP_LIMIT')
  assert.equal((await state.broker.admit(intent(state.target.routeRef), context({ fanoutUsed: 1 }))).code, 'FANOUT_LIMIT')
  assert.equal((await state.broker.admit(intent(state.target.routeRef), context({ chain: [state.target.routeRef] }))).code, 'COLLABORATION_LOOP')

  state.policy.setAuthorized(false)
  assert.equal((await state.broker.admit(intent(state.target.routeRef), context())).code, 'UNAUTHORIZED')
  state.policy.setAuthorized(true)
  state.policy.setReasonVerified(false)
  assert.equal((await state.broker.admit(intent(state.target.routeRef), context())).code, 'REASON_NOT_VERIFIED')
  state.policy.setReasonVerified(true)

  state.directory.upsert(presence('session-sender-private', 'Sender', 10_000, { activity: 'paused' }))
  assert.equal((await state.broker.admit(intent(state.target.routeRef), context())).code, 'SENDER_PAUSED')
  state.setNow(16_000)
  state.directory.upsert(presence('session-sender-private', 'Sender', 16_000))
  assert.equal((await state.broker.admit(intent(state.target.routeRef), context())).code, 'TARGET_STALE')
})

test('wake is policy-bound, while paused targets are always deferred without waking', async () => {
  const state = await fixture()
  const downgraded = await state.broker.admit(intent(state.target.routeRef, { wakeLevel: 2 }), context())
  assert.equal(downgraded.code, 'ADMITTED_WAKE_DOWNGRADED')
  assert.equal(downgraded.deliveryMode, 'inbox')
  assert.equal(downgraded.wakeLevel, 1)

  state.setNow(12_001)
  state.policy.setWakeGranted(true)
  const wake = await state.broker.admit(intent(state.target.routeRef, { wakeLevel: 2, evidence: { resourceRef: 'resource:wake' } }), context())
  assert.equal(wake.code, 'ADMITTED')
  assert.equal(wake.deliveryMode, 'wake')
  assert.equal(wake.wakeLevel, 2)

  state.setNow(14_002)
  state.directory.upsert(presence('session-target-private', 'Target', 14_002, { activity: 'paused', pauseEpoch: 7, resourceRefs: ['resource:owned'] }))
  const paused = await state.broker.admit(intent(state.target.routeRef, { wakeLevel: 2, evidence: { resourceRef: 'resource:paused' } }), context())
  assert.equal(paused.code, 'ADMITTED_WAKE_DOWNGRADED')
  assert.equal(paused.deliveryMode, 'deferred')
  assert.equal(paused.wakeLevel, 0)
  assert.equal(state.broker.consume(paused.admissionRef).targetPauseEpoch, 7)
})

test('expired admission cannot be consumed and L0 remains a non-waking suggestion', async () => {
  const state = await fixture()
  const suggestion = await state.broker.admit(intent(state.target.routeRef, { wakeLevel: 0 }), context())
  assert.equal(suggestion.deliveryMode, 'suggestion')
  assert.equal(suggestion.wakeLevel, 0)
  state.setNow(11_001)
  assert.equal(state.broker.consume(suggestion.admissionRef), undefined)
})
