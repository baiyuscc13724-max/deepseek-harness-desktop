const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const serviceUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'collaboration-service.js')).href

async function load() {
  return import(serviceUrl)
}

function iso(ms) {
  return new Date(ms).toISOString()
}

function member(sessionId, name, kind, state, now) {
  return { id: `member:${sessionId}`, sessionId, name, kind, state, createdAt: iso(now), updatedAt: iso(now) }
}

function task(id, title, state, assigneeSessionId, now, overrides = {}) {
  return { id, title, state, assigneeSessionId, dependsOn: [], crossTeamDependsOn: [], files: [], createdAt: iso(now), updatedAt: iso(now), ...overrides }
}

function document(now, overrides = {}) {
  const teamA = {
    id: 'team-a',
    rootLeadSessionId: 'root-private',
    name: 'Team A',
    objective: 'Coordinate implementation',
    revision: 1,
    state: 'active',
    createdAt: iso(now),
    updatedAt: iso(now),
    members: [
      member('root-private', 'Lead', 'lead', 'running', now),
      member('sender-private', 'Sender', 'worker', 'ready', now),
      member('target-private', 'Target', 'worker', 'ready', now)
    ],
    tasks: [
      task('source-done', 'Source work', 'completed', 'sender-private', now, { files: ['src/source.js'] }),
      task('target-owned', 'Owned work', 'in_progress', 'target-private', now, { files: ['src/owned.js'], dependsOn: ['source-done'] }),
      task('sender-blocked', 'Blocked work', 'in_progress', 'sender-private', now, { files: ['src/sender.js'], dependsOn: ['target-owned'] })
    ],
    messages: []
  }
  return { version: 2, settings: { enabled: true, maxMembers: 4, maxActiveTurns: 4 }, teams: [teamA], ...overrides }
}

async function withService(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'collaboration-service-'))
  const filePath = path.join(root, 'storages', 'agent_collaboration.json')
  try { await run({ root, filePath }) } finally { await rm(root, { recursive: true, force: true }) }
}

test('team presence persists opaque routes and discovery never exposes raw session ids', async () => withService(async ({ filePath }) => {
  const { AgentCollaborationService } = await load()
  let now = 1_000_000
  const service = new AgentCollaborationService(filePath, { now: () => now })
  const teams = document(now)
  await service.syncTeams(teams)

  const candidates = service.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned.js' })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].displayName, 'Target')
  assert.match(candidates[0].routeRef, /^route_[A-Za-z0-9_-]+$/u)
  assert.equal(JSON.stringify(candidates).includes('target-private'), false)
  assert.equal(JSON.stringify(candidates).includes('root-private'), false)

  now += 120_000
  await service.syncTeams(teams)
  const refreshed = service.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned.js' })
  assert.equal(refreshed[0].freshness, 'fresh', 'Host observation refreshes stable continuable presence')

  const persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.version, 2)
  assert.equal(persisted.presence.length, 3)
  assert.equal(persisted.secrets.directory.length >= 24, true)
}))

test('presence sync bursts are single-flight and retain only the latest complete snapshot', async () => withService(async ({ filePath }) => {
  const { AgentCollaborationService } = await load()
  let now = 1_500_000
  const service = new AgentCollaborationService(filePath, { now: () => now })
  const originalMutate = service.store.mutate.bind(service.store)
  let releaseFirst
  let firstEntered
  let writes = 0
  const entered = new Promise(resolve => { firstEntered = resolve })
  const gate = new Promise(resolve => { releaseFirst = resolve })
  service.store.mutate = async mutator => {
    writes += 1
    if (writes === 1) {
      firstEntered()
      await gate
    }
    return originalMutate(mutator)
  }

  const first = service.syncTeams(document(now))
  await entered
  const burst = []
  for (let index = 1; index <= 24; index += 1) {
    now += 1
    const snapshot = document(now)
    snapshot.teams[0].members[2].state = index === 24 ? 'running' : 'ready'
    burst.push(service.syncTeams(snapshot))
  }
  releaseFirst()
  await Promise.all([first, ...burst])

  assert.equal(writes, 2, 'one active write plus one latest-only reconciliation')
  const persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.presence.find(record => record.sessionId === 'target-private').activity, 'running')
  await service.close()
  await service.syncTeams(document(now + 1))
  assert.equal(writes, 2, 'closed services ignore late sync requests')
}))

test('invalid raw-looking routes are rejected without entering route audit fields', async () => withService(async ({ filePath }) => {
  const { AgentCollaborationService } = await load()
  const now = 1_500_000
  const service = new AgentCollaborationService(filePath, { now: () => now })
  await service.syncTeams(document(now))
  const rejected = await service.submitIntent({
    callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', routeRef: 'target-private',
    reason: 'UNIQUE_OWNER', evidence: { resourceRef: 'src/owned.js' }, message: 'Must not resolve a raw identity.'
  })
  assert.equal(rejected.admitted, false)
  assert.equal(rejected.code, 'INVALID_ROUTE_REF')
  const persisted = JSON.parse(await readFile(filePath, 'utf8'))
  const event = persisted.audit.at(-1)
  assert.equal(Object.hasOwn(event, 'targetRouteRef'), false)
  assert.equal(event.decisionCode, 'INVALID_ROUTE_REF')
}))

test('evidence-backed intent enters a durable no-wake inbox and can be acknowledged only by its target', async () => withService(async ({ filePath }) => {
  const { AgentCollaborationService } = await load()
  let now = 2_000_000
  const teams = document(now)
  const service = new AgentCollaborationService(filePath, { now: () => now })
  await service.syncTeams(teams)
  const [target] = service.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned.js' })

  const admitted = await service.submitIntent({
    callerSessionId: 'sender-private',
    rootLeadSessionId: 'root-private',
    routeRef: target.routeRef,
    reason: 'UNIQUE_OWNER',
    evidence: { resourceRef: 'src/owned.js' },
    message: 'Please confirm the owner-only change before I continue.',
    wakeLevel: 2
  })
  assert.equal(admitted.admitted, true)
  assert.equal(admitted.code, 'ADMITTED_WAKE_DOWNGRADED')
  assert.equal(admitted.deliveryMode, 'inbox')
  assert.equal(admitted.wakeLevel, 1)
  assert.equal(Object.hasOwn(admitted, 'admissionRef'), false)
  assert.equal(JSON.stringify(admitted).includes('target-private'), false)
  assert.deepEqual(await service.listInbox({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private' }), [])

  const inbox = await service.listInbox({ callerSessionId: 'target-private', rootLeadSessionId: 'root-private' })
  assert.equal(inbox.length, 1)
  assert.equal(inbox[0].message, 'Please confirm the owner-only change before I continue.')
  assert.equal(inbox[0].status, 'delivered')
  assert.deepEqual(await service.acknowledgeInbox({ callerSessionId: 'target-private', rootLeadSessionId: 'root-private', itemRef: inbox[0].itemRef }), { itemRef: inbox[0].itemRef, status: 'acknowledged' })
  assert.deepEqual(await service.listInbox({ callerSessionId: 'target-private', rootLeadSessionId: 'root-private' }), [])

  const persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.inbox[0].status, 'acknowledged')
  assert.deepEqual(persisted.audit.map(event => event.type), ['intent-admitted', 'inbox-delivered', 'inbox-acknowledged'])
}))

test('persistent cooldown survives service restart and invalid reasons never create inbox work', async () => withService(async ({ filePath }) => {
  const { AgentCollaborationService } = await load()
  let now = 3_000_000
  const teams = document(now)
  const first = new AgentCollaborationService(filePath, { now: () => now })
  await first.syncTeams(teams)
  const [target] = first.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned.js' })
  const request = {
    callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', routeRef: target.routeRef,
    reason: 'UNIQUE_OWNER', evidence: { resourceRef: 'src/owned.js' }, message: 'Owner decision required.'
  }
  assert.equal((await first.submitIntent(request)).admitted, true)

  now += 1_000
  const restartedModule = await import(`${serviceUrl}?restart=${now}`)
  const second = new restartedModule.AgentCollaborationService(filePath, { now: () => now })
  await second.syncTeams(document(now))
  const duplicate = await second.submitIntent(request)
  assert.equal(duplicate.admitted, false)
  assert.equal(duplicate.code, 'COOLDOWN')

  const rejected = await second.submitIntent({ ...request, reason: 'RESOURCE_CONFLICT', evidence: { resourceRef: 'src/owned.js' }, message: 'This is not actually a conflict.' })
  assert.equal(rejected.admitted, false)
  assert.equal(rejected.code, 'REASON_NOT_VERIFIED')
  const persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.inbox.length, 1)
  assert.equal(persisted.audit.filter(event => event.type === 'intent-rejected').length, 2)
}))

test('formal handoff verifies completed source ownership and an exact dependent target task', async () => withService(async ({ filePath }) => {
  const { AgentCollaborationService } = await load()
  const now = 4_000_000
  const teams = document(now)
  const service = new AgentCollaborationService(filePath, { now: () => now })
  await service.syncTeams(teams)
  const [target] = service.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', taskRef: 'team-a:target-owned' })
  const admitted = await service.submitIntent({
    callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', routeRef: target.routeRef,
    reason: 'FORMAL_HANDOFF', evidence: { handoffRef: 'team-a:target-owned', sourceTaskRef: 'team-a:source-done' },
    message: 'The completed source task is ready for your dependent task.'
  })
  assert.equal(admitted.admitted, true)
}))

test('pause epoch supersedes old inbox work and paused targets only receive deferred non-waking records', async () => withService(async ({ filePath }) => {
  const { AgentCollaborationService } = await load()
  let now = 5_000_000
  const service = new AgentCollaborationService(filePath, { now: () => now })
  const initial = document(now)
  await service.syncTeams(initial)
  const [target] = service.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned.js' })
  await service.submitIntent({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', routeRef: target.routeRef, reason: 'UNIQUE_OWNER', evidence: { resourceRef: 'src/owned.js' }, message: 'Pre-stop request.' })

  now += 1_000
  const pausedSameTeam = document(now)
  pausedSameTeam.teams[0].state = 'paused'
  pausedSameTeam.teams[0].revision = 2
  await service.syncTeams(pausedSameTeam)
  assert.deepEqual(await service.listInbox({ callerSessionId: 'target-private', rootLeadSessionId: 'root-private' }), [])

  now += 1_000
  const peer = document(now)
  peer.teams[0].members = peer.teams[0].members.filter(entry => entry.sessionId !== 'target-private')
  peer.teams[0].tasks = peer.teams[0].tasks.filter(entry => entry.assigneeSessionId !== 'target-private')
  const pausedTargetTeam = {
    id: 'team-b', rootLeadSessionId: 'root-private', name: 'Team B', objective: 'Paused target', revision: 2, state: 'paused',
    createdAt: iso(now), updatedAt: iso(now),
    members: [member('root-private', 'Lead', 'lead', 'running', now), member('target-private', 'Target', 'worker', 'ready', now)],
    tasks: [task('target-owned-b', 'Owned paused work', 'in_progress', 'target-private', now, { files: ['src/paused-owned.js'] })], messages: []
  }
  peer.teams.push(pausedTargetTeam)
  await service.syncTeams(peer)
  const [pausedTarget] = service.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/paused-owned.js' })
  const deferred = await service.submitIntent({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', routeRef: pausedTarget.routeRef, reason: 'UNIQUE_OWNER', evidence: { resourceRef: 'src/paused-owned.js' }, message: 'Wait until explicit resume.', wakeLevel: 2 })
  assert.equal(deferred.admitted, true)
  assert.equal(deferred.deliveryMode, 'deferred')
  assert.equal(deferred.wakeLevel, 0)

  now += 1_000
  pausedTargetTeam.state = 'active'
  pausedTargetTeam.revision = 3
  pausedTargetTeam.updatedAt = iso(now)
  await service.syncTeams(peer)
  assert.deepEqual(await service.listInbox({ callerSessionId: 'target-private', rootLeadSessionId: 'root-private' }), [])
  const persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.inbox.every(item => item.status === 'superseded'), true)
}))

test('concurrent service instances share secrets and preserve both inbox mutations', async () => withService(async ({ filePath }) => {
  const { AgentCollaborationService, validateCollaborationState } = await load()
  const now = 6_000_000
  const teams = document(now)
  teams.teams[0].members.push(member('target-two-private', 'Target Two', 'worker', 'ready', now))
  teams.teams[0].tasks.push(task('target-two-owned', 'Second owned work', 'in_progress', 'target-two-private', now, { files: ['src/owned-two.js'] }))
  const first = new AgentCollaborationService(filePath, { now: () => now })
  const second = new AgentCollaborationService(filePath, { now: () => now })
  await Promise.all([first.syncTeams(teams), second.syncTeams(teams)])
  const firstTarget = first.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned.js' })[0]
  const sameTarget = second.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned.js' })[0]
  const secondTarget = second.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned-two.js' })[0]
  assert.equal(firstTarget.routeRef, sameTarget.routeRef)
  const results = await Promise.all([
    first.submitIntent({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', routeRef: firstTarget.routeRef, reason: 'UNIQUE_OWNER', evidence: { resourceRef: 'src/owned.js' }, message: 'First concurrent intent.' }),
    second.submitIntent({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', routeRef: secondTarget.routeRef, reason: 'UNIQUE_OWNER', evidence: { resourceRef: 'src/owned-two.js' }, message: 'Second concurrent intent.' })
  ])
  assert.equal(results.every(result => result.admitted), true)
  const persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.inbox.length, 2)
  assert.equal(persisted.audit.length, 2)
  assert.doesNotThrow(() => validateCollaborationState(persisted))
  const tampered = structuredClone(persisted)
  tampered.audit[0].decisionCode = 'TAMPERED'
  assert.throws(() => validateCollaborationState(tampered), /audit chain is invalid/u)
}))

test('same dedupe key is admitted once across isolated service instances and becomes eligible after TTL', async () => withService(async ({ filePath }) => {
  let now = 6_500_000
  const firstModule = await import(`${serviceUrl}?dedupe-instance=first`)
  const secondModule = await import(`${serviceUrl}?dedupe-instance=second`)
  const first = new firstModule.AgentCollaborationService(filePath, { now: () => now })
  const second = new secondModule.AgentCollaborationService(filePath, { now: () => now })
  const teams = document(now)
  await Promise.all([first.syncTeams(teams), second.syncTeams(teams)])
  const firstTarget = first.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned.js' })[0]
  const secondTarget = second.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned.js' })[0]
  assert.equal(firstTarget.routeRef, secondTarget.routeRef)
  const request = routeRef => ({
    callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', routeRef,
    reason: 'UNIQUE_OWNER', evidence: { resourceRef: 'src/owned.js' }, message: 'Exactly one durable inbox record.'
  })
  const results = await Promise.all([first.submitIntent(request(firstTarget.routeRef)), second.submitIntent(request(secondTarget.routeRef))])
  assert.deepEqual(results.map(result => result.admitted).sort(), [false, true])
  assert.equal(results.find(result => !result.admitted).code, 'COOLDOWN')
  let persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.inbox.length, 1)
  assert.equal(persisted.audit.filter(event => event.type === 'intent-admitted').length, 1)
  assert.equal(persisted.audit.filter(event => event.decisionCode === 'COOLDOWN').length, 1)

  now += 90_000
  await second.syncTeams(document(now))
  const refreshedTarget = second.discover({ callerSessionId: 'sender-private', rootLeadSessionId: 'root-private', resourceRef: 'src/owned.js' })[0]
  const afterTtl = await second.submitIntent(request(refreshedTarget.routeRef))
  assert.equal(afterTtl.admitted, true)
  persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.inbox.length, 2, 'expired cooldown changes eligibility without deleting retained inbox history')
}))

test('state validation migrates legacy state and rejects unsupported persisted fields', async () => {
  const { validateCollaborationState } = await load()
  const legacy = { version: 1, secrets: { directory: 'a'.repeat(24), broker: 'b'.repeat(24), scope: 'c'.repeat(24) }, presence: [], inbox: [], audit: [] }
  const migrated = validateCollaborationState(legacy)
  assert.equal(migrated.version, 2)
  assert.equal(migrated.auditAnchor, 'audit_genesis_v1')
  assert.throws(() => validateCollaborationState({ ...legacy, injected: true }), /unsupported fields/u)
})
