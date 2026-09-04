const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { performance } = require('node:perf_hooks')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')

async function plugin() {
  return import(`${pathToFileURL(pluginFile).href}?performance=${Date.now()}-${Math.random()}`)
}

function fixture({ sessions = 12, teamsPerRoot = 4, workers = 6, tasks = 250, messages = 500 } = {}) {
  const timestamp = index => new Date(Date.parse('2026-01-01T00:00:00.000Z') + index).toISOString()
  const teams = []
  for (let rootIndex = 0; rootIndex < sessions; rootIndex += 1) {
    const root = `root-${rootIndex}`
    for (let teamIndex = 0; teamIndex < teamsPerRoot; teamIndex += 1) {
      const teamId = `team-${rootIndex}-${teamIndex}`
      const members = [{ id: `lead:${root}`, sessionId: root, name: 'Lead', role: 'root lead', modelTier: 'main', inheritsMain: true, routeSource: 'main', kind: 'lead', state: 'running', createdAt: timestamp(0), updatedAt: timestamp(1) }]
      for (let memberIndex = 0; memberIndex < workers; memberIndex += 1) {
        members.push({ id: `${teamId}-member-${memberIndex}`, sessionId: `${teamId}-child-${memberIndex}`, name: `Worker ${memberIndex}`, role: `stream ${memberIndex}`, modelTier: 'subagent', inheritsMain: false, routeSource: 'subagent', kind: 'worker', state: memberIndex % 2 ? 'ready' : 'running', createdAt: timestamp(memberIndex), updatedAt: timestamp(memberIndex + 1) })
      }
      teams.push({
        id: teamId,
        rootLeadSessionId: root,
        name: `Team ${rootIndex}-${teamIndex}`,
        objective: `Concurrent objective ${rootIndex}-${teamIndex}`,
        revision: 1,
        state: 'active',
        createdAt: timestamp(0),
        updatedAt: timestamp(tasks + messages),
        members,
        tasks: Array.from({ length: tasks }, (_, taskIndex) => ({ id: `${teamId}-task-${taskIndex}`, title: `Task ${taskIndex}`, description: `Private description ${taskIndex}`, state: taskIndex % 3 === 0 ? 'completed' : taskIndex % 3 === 1 ? 'in_progress' : 'pending', dependsOn: [], crossTeamDependsOn: [], files: [`src/${taskIndex}.js`], assigneeSessionId: `${teamId}-child-${taskIndex % workers}`, createdAt: timestamp(taskIndex), updatedAt: timestamp(taskIndex + 1) })),
        messages: Array.from({ length: messages }, (_, messageIndex) => ({ id: `${teamId}-message-${messageIndex}`, fromSessionId: `${teamId}-child-${messageIndex % workers}`, toSessionId: root, body: `Private durable message ${messageIndex}`, status: 'delivered', createdAt: timestamp(messageIndex), deliveredAt: timestamp(messageIndex + 1) }))
      })
    }
  }
  return { version: 2, settings: { enabled: true, maxMembers: 8, maxActiveTurns: 8 }, teams }
}

class FakeResponse extends EventEmitter {
  constructor({ blockFirst = false } = {}) {
    super()
    this.blockFirst = blockFirst
    this.writes = []
    this.ended = false
  }
  write(payload) {
    this.writes.push(String(payload))
    if (this.blockFirst) { this.blockFirst = false; return false }
    return true
  }
  end() { this.ended = true }
}

test('UI projection remains bounded for twelve busy roots and selects one detailed team', async () => {
  const { teamSnapshot, UI_MAX_EVENTS_PER_TEAM, UI_MAX_TASKS_PER_TEAM } = await plugin()
  const document = fixture()
  const selectedTeamId = 'team-0-2'
  const snapshot = teamSnapshot(document, 'root-0', selectedTeamId)
  assert.equal(snapshot.teams.length, 4)
  assert.ok(snapshot.teams.every(team => team.tasks === undefined && team.messages === undefined && team.members === undefined))
  assert.equal(snapshot.team.id, selectedTeamId)
  assert.ok(snapshot.team.tasks.length <= UI_MAX_TASKS_PER_TEAM)
  assert.ok(snapshot.team.messages.length <= UI_MAX_EVENTS_PER_TEAM)
  assert.equal(snapshot.team.taskCount, 250)
  assert.equal(snapshot.team.projection.tasksTruncated, true)
  const encoded = JSON.stringify(snapshot)
  assert.ok(Buffer.byteLength(encoded) < 256 * 1024, `bounded UI snapshot grew to ${Buffer.byteLength(encoded)} bytes`)
  assert.doesNotMatch(encoded, /Private durable message|Private description/u)
})

test('six, twelve, and twenty-four concurrent roots stay isolated and bounded', async () => {
  const { teamSnapshot } = await plugin()
  for (const sessions of [6, 12, 24]) {
    const document = fixture({ sessions, teamsPerRoot: 2, workers: 4, tasks: 100, messages: 200 })
    const snapshots = Array.from({ length: sessions }, (_, index) => teamSnapshot(document, `root-${index}`, `team-${index}-1`))
    assert.equal(snapshots.length, sessions)
    assert.deepEqual(new Set(snapshots.map(snapshot => snapshot.team.id)), new Set(Array.from({ length: sessions }, (_, index) => `team-${index}-1`)))
    for (let index = 0; index < snapshots.length; index += 1) {
      const snapshot = snapshots[index]
      assert.equal(snapshot.team.rootLeadSessionId, `root-${index}`)
      assert.equal(snapshot.teams.length, 2)
      assert.ok(snapshot.teams.every(team => team.id.startsWith(`team-${index}-`)))
      assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 256 * 1024)
    }
  }
})

test('twenty-four clients receive one coalesced snapshot for a mutation burst', async () => {
  const { createSseBroadcaster } = await plugin()
  const broadcaster = createSseBroadcaster({ delayMs: 60_000 })
  const document = fixture({ sessions: 24, teamsPerRoot: 2, workers: 4, tasks: 50, messages: 100 })
  const responses = []
  for (let index = 0; index < 24; index += 1) {
    const response = new FakeResponse()
    responses.push(response)
    broadcaster.add(`root-${index}`, `team-${index}-1`, response)
  }
  for (let mutation = 0; mutation < 100; mutation += 1) {
    document.teams[0].revision = mutation + 2
    broadcaster.schedule(document)
  }
  broadcaster.flush()
  assert.ok(responses.every(response => response.writes.length === 1))
  assert.ok(responses.every(response => response.writes[0].startsWith('event: snapshot\ndata: ')))
  broadcaster.close()
  assert.ok(responses.every(response => response.ended))
})

test('SSE fan-out reuses one merged projection for subscribers with the same selection', async () => {
  const { createSseBroadcaster } = await plugin()
  const broadcaster = createSseBroadcaster({ delayMs: 60_000 })
  const document = fixture({ sessions: 6, teamsPerRoot: 2, workers: 4, tasks: 25, messages: 50 })
  const groups = []
  for (let rootIndex = 0; rootIndex < 6; rootIndex += 1) {
    const responses = Array.from({ length: 4 }, () => new FakeResponse())
    for (const response of responses) broadcaster.add(`root-${rootIndex}`, `team-${rootIndex}-1`, response)
    groups.push(responses)
  }
  for (let mutation = 0; mutation < 50; mutation += 1) {
    document.teams[0].revision = mutation + 2
    broadcaster.schedule(document)
  }
  broadcaster.flush()
  for (const responses of groups) {
    assert.ok(responses.every(response => response.writes.length === 1))
    assert.equal(new Set(responses.map(response => response.writes[0])).size, 1)
  }
  assert.equal(broadcaster.clients.size, 6)
  broadcaster.close()
})

test('slow SSE clients retain only the newest complete snapshot under backpressure', async () => {
  const { createSseBroadcaster, teamSnapshot } = await plugin()
  const broadcaster = createSseBroadcaster({ delayMs: 60_000 })
  const response = new FakeResponse({ blockFirst: true })
  const client = broadcaster.add('root-0', 'team-0-0', response)
  const document = fixture({ sessions: 1, teamsPerRoot: 1, workers: 2, tasks: 5, messages: 5 })
  broadcaster.send(client, teamSnapshot(document, 'root-0', 'team-0-0'))
  document.teams[0].revision = 2
  const second = teamSnapshot(document, 'root-0', 'team-0-0')
  broadcaster.send(client, second)
  document.teams[0].revision = 3
  const latest = teamSnapshot(document, 'root-0', 'team-0-0')
  broadcaster.send(client, latest)
  assert.equal(response.writes.length, 1)
  response.emit('drain')
  assert.equal(response.writes.length, 2)
  assert.match(response.writes[1], /team-0-0\\",3/u)
  broadcaster.send(client, latest)
  assert.equal(response.writes.length, 2)
  broadcaster.close()
})

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  assert.equal(Object.isFrozen(value), true)
  for (const child of Object.values(value)) assertDeepFrozen(child, seen)
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)]
}

test('projection cache reauthorizes exact session/team/task selection and deep-freezes only the store projection', async () => {
  const { createTeamProjectionCache } = await plugin()
  const document = fixture({ sessions: 2, teamsPerRoot: 2, workers: 2, tasks: 8, messages: 8 })
  const cache = createTeamProjectionCache({ mode: 'enabled' })
  const first = cache.project(document, 'root-0', 'team-0-0', 'task-a')
  const hit = cache.project(document, 'root-0', 'team-0-0', 'task-a')
  assert.strictEqual(hit, first)
  assertDeepFrozen(first)

  const otherTask = cache.project(document, 'root-0', 'team-0-0', 'task-b')
  const otherSelection = cache.project(document, 'root-0', 'team-0-1', 'task-b')
  const otherRoot = cache.project(document, 'root-1', 'team-1-0', 'task-b')
  assert.notStrictEqual(otherTask, first)
  assert.equal(otherSelection.activeTeamId, 'team-0-1')
  assert.equal(otherRoot.activeTeamId, 'team-1-0')
  assert.ok(otherRoot.teams.every(team => team.id.startsWith('team-1-')))

  for (const team of document.teams.filter(team => team.rootLeadSessionId === 'root-0')) {
    team.members = team.members.filter(member => member.sessionId !== 'root-0')
    team.revision += 1
  }
  const revoked = cache.project(document, 'root-0', 'team-0-0', 'task-a')
  assert.equal(revoked.activeTeamId, null, 'fresh authorization runs before lookup and rejects the cached ACL relation')
  assert.equal(revoked.teams.length, 0)
  cache.close()
})

test('projection cache flag rollback is immediate and any shadow mismatch opens the fail-safe circuit', async () => {
  const mod = await plugin()
  assert.equal(mod.projectionCacheMode(null), 'disabled')
  assert.equal(mod.projectionCacheMode('unexpected-mode'), 'disabled')
  const document = fixture({ sessions: 1, teamsPerRoot: 1, workers: 1, tasks: 3, messages: 3 })
  let mode = 'enabled'
  const cache = mod.createTeamProjectionCache({ mode: () => mode })
  const first = cache.project(document, 'root-0', 'team-0-0')
  assert.strictEqual(cache.project(document, 'root-0', 'team-0-0'), first)
  mode = 'disabled'
  const rolledBack = cache.project(document, 'root-0', 'team-0-0')
  assert.notStrictEqual(rolledBack, first)
  assert.equal(cache.stats().entries, 0)
  mode = 'enabled'
  const promotedAgain = cache.project(document, 'root-0', 'team-0-0')
  assert.strictEqual(cache.project(document, 'root-0', 'team-0-0'), promotedAgain)
  assert.notStrictEqual(promotedAgain, first)

  const mismatch = mod.createTeamProjectionCache({
    mode: 'enabled',
    candidateSnapshot: (source, sessionId, selectedTeamId) => ({ ...mod.teamSnapshot(source, sessionId, selectedTeamId), cursor: 'intentional-shadow-mismatch' }),
  })
  const canonical = mismatch.project(document, 'root-0', 'team-0-0')
  assert.notEqual(canonical.cursor, 'intentional-shadow-mismatch')
  assert.equal(mismatch.stats().circuitOpen, true)
  assert.equal(mismatch.stats().mismatches, 1)
  assert.deepEqual(mismatch.project(document, 'root-0', 'team-0-0'), mod.teamSnapshot(document, 'root-0', 'team-0-0'))

  const shadow = mod.createTeamProjectionCache({ mode: 'shadow' })
  const shadowOne = shadow.project(document, 'root-0', 'team-0-0')
  const shadowTwo = shadow.project(document, 'root-0', 'team-0-0')
  assert.deepEqual(shadowTwo, shadowOne)
  assert.notStrictEqual(shadowTwo, shadowOne)
  assert.equal(shadow.stats().shadowMatches, 2)
  assert.equal(shadow.stats().entries, 0)
  assert.equal(shadow.stats().promotions, 0)
  cache.close(); mismatch.close(); shadow.close()
})

test('projection cache LRU accounts frozen JSON plus SSE encoding and never exceeds 32 MiB', async () => {
  const { createTeamProjectionCache, TEAM_PROJECTION_CACHE_MAX_BYTES } = await plugin()
  assert.equal(TEAM_PROJECTION_CACHE_MAX_BYTES, 32 * 1024 * 1024)
  const cache = createTeamProjectionCache({ mode: 'enabled', maxBytes: 256 * 1024 })
  const document = fixture({ sessions: 8, teamsPerRoot: 2, workers: 2, tasks: 12, messages: 12 })
  for (let index = 0; index < 80; index += 1) cache.project(document, `root-${index % 8}`, `team-${index % 8}-${index % 2}`, `selection-${index}`)
  const stats = cache.stats()
  assert.ok(stats.bytes <= stats.maxBytes)
  assert.ok(stats.entries > 0)
  assert.ok(stats.evictions > 0)
  cache.close()
  assert.equal(cache.stats().bytes, 0)
})

test('SSE broadcaster keeps no document or timers at zero clients and releases closed/error/backpressure clients', async () => {
  const { createSseBroadcaster } = await plugin()
  let renders = 0
  const broadcaster = createSseBroadcaster({ delayMs: 60_000, keepaliveMs: 60_000, snapshot: () => { renders += 1; return { renders } } })
  const document = fixture({ sessions: 1, teamsPerRoot: 1, workers: 1, tasks: 1, messages: 1 })
  broadcaster.schedule(document)
  broadcaster.flush()
  assert.equal(renders, 0)
  assert.deepEqual(broadcaster.stats(), { clients: 0, pendingDocument: false, timer: false, keepaliveTimer: false })

  const response = new FakeResponse()
  const request = new EventEmitter()
  const client = broadcaster.add('root-0', 'team-0-0', response, undefined, request)
  assert.equal(request.listenerCount('close'), 1)
  broadcaster.schedule(document)
  assert.equal(broadcaster.stats().pendingDocument, true)
  broadcaster.remove(client)
  assert.equal(client.response, undefined)
  assert.equal(client.request, undefined)
  assert.equal(request.listenerCount('close'), 0)
  assert.equal(client.pendingPayload, undefined)
  assert.deepEqual(broadcaster.stats(), { clients: 0, pendingDocument: false, timer: false, keepaliveTimer: false })
  broadcaster.flush()
  assert.equal(renders, 0)

  const throwing = new FakeResponse(); throwing.write = () => { throw new Error('socket write failed') }
  const failed = broadcaster.add('root-0', 'team-0-0', throwing)
  broadcaster.send(failed, { value: 1 })
  assert.equal(failed.closed, true)
  assert.equal(failed.response, undefined)
  assert.equal(broadcaster.stats().clients, 0)

  const blockedResponse = new FakeResponse({ blockFirst: true })
  const blocked = broadcaster.add('root-0', 'team-0-0', blockedResponse)
  broadcaster.send(blocked, { value: 1 })
  broadcaster.send(blocked, { value: 2 })
  assert.equal(blocked.pendingPayload.includes('"value":2'), true)
  blockedResponse.emit('close')
  assert.equal(blocked.response, undefined)
  assert.equal(blocked.pendingPayload, undefined)
  assert.equal(broadcaster.stats().clients, 0)

  const revertedResponse = new FakeResponse({ blockFirst: true })
  const reverted = broadcaster.add('root-0', 'team-0-0', revertedResponse)
  broadcaster.send(reverted, { value: 1 })
  broadcaster.send(reverted, { value: 2 })
  broadcaster.send(reverted, { value: 1 })
  assert.equal(reverted.pendingPayload, undefined, 'a newest no-op state discards an older queued divergence')
  revertedResponse.emit('drain')
  assert.equal(revertedResponse.writes.length, 1)
  broadcaster.remove(reverted)
  broadcaster.close()
})

test('linear hot/cold generations reuse unaffected roots while rollback branches never reuse an older cache entry', async () => {
  const mod = await plugin()
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-team-projection-branch-'))
  const file = path.join(root, 'teams.json')
  await writeFile(file, JSON.stringify(fixture({ sessions: 2, teamsPerRoot: 1, workers: 1, tasks: 3, messages: 3 })))
  const store = new mod.AgentTeamsStore(file, { hotColdStore: true })
  const cache = mod.createTeamProjectionCache({ mode: 'enabled' })
  try {
    await store.init()
    const beforeRoot0 = cache.project(store.view(), 'root-0', 'team-0-0')
    const beforeRoot1 = cache.project(store.view(), 'root-1', 'team-1-0')
    await store.mutate(document => { document.teams.find(team => team.id === 'team-0-0').objective = 'generation two objective' })
    const generationTwoRoot0 = cache.project(store.view(), 'root-0', 'team-0-0')
    const generationTwoRoot1 = cache.project(store.view(), 'root-1', 'team-1-0')
    assert.notStrictEqual(generationTwoRoot0, beforeRoot0)
    assert.strictEqual(generationTwoRoot1, beforeRoot1, 'the unchanged root is reused only across a verified linear successor')
    await store.mutate(document => { document.teams.find(team => team.id === 'team-0-0').objective = 'generation three objective' })
    cache.project(store.view(), 'root-0', 'team-0-0')
    const missesBeforeRollback = cache.stats().misses
    await store.rollbackHotColdManifest()
    const rolledBack = cache.project(store.view(), 'root-0', 'team-0-0')
    assert.notStrictEqual(rolledBack, generationTwoRoot0, 'rollback publication serial and branch lineage forbid an old exact hit')
    assert.equal(cache.stats().misses, missesBeforeRollback + 1)
  } finally {
    cache.close(); store.close(); await rm(root, { recursive: true, force: true })
  }
})

test('legacy publications reuse only verified local successors and reject external rollback reuse', async () => {
  const mod = await plugin()
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-team-projection-legacy-branch-'))
  const file = path.join(root, 'teams.json')
  await writeFile(file, JSON.stringify(fixture({ sessions: 2, teamsPerRoot: 1, workers: 1, tasks: 3, messages: 3 })))
  const generationOne = await readFile(file)
  const store = new mod.AgentTeamsStore(file, { hotColdStore: false })
  const cache = mod.createTeamProjectionCache({ mode: 'enabled' })
  try {
    await store.init()
    const detached = store.snapshot()
    assert.equal(cache.project(detached, 'root-0', 'team-0-0').activeTeamId, 'team-0-0')
    detached.teams.find(team => team.id === 'team-0-0').members = []
    assert.equal(cache.project(detached, 'root-0', 'team-0-0').activeTeamId, null, 'mutable detached Store snapshots use fresh content identity')
    cache.project(store.view(), 'root-0', 'team-0-0')
    const beforeRoot1 = cache.project(store.view(), 'root-1', 'team-1-0')
    await store.mutate(document => { document.teams.find(team => team.id === 'team-0-0').objective = 'a deliberately longer generation two objective' })
    const generationTwoRoot1 = cache.project(store.view(), 'root-1', 'team-1-0')
    assert.strictEqual(generationTwoRoot1, beforeRoot1)
    await writeFile(file, generationOne)
    await store.read()
    const missesBeforeRollback = cache.stats().misses
    const rolledBackRoot1 = cache.project(store.view(), 'root-1', 'team-1-0')
    assert.notStrictEqual(rolledBackRoot1, generationTwoRoot1)
    assert.equal(cache.stats().misses, missesBeforeRollback + 1)
  } finally {
    cache.close(); store.close(); await rm(root, { recursive: true, force: true })
  }
})

test('real 65-root store projection meets cold and same-generation cache contracts without monotonic RSS growth', async t => {
  const mod = await plugin()
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-team-projection-perf-'))
  const file = path.join(root, 'teams.json')
  const document = fixture({ sessions: 65, teamsPerRoot: 1, workers: 2, tasks: 12, messages: 12 })
  await writeFile(file, JSON.stringify(document))
  const store = new mod.AgentTeamsStore(file, { hotColdStore: process.env.HARNESS_AGENT_TEAMS_HOT_COLD_STORE === '1' })
  const cache = mod.createTeamProjectionCache({ mode: 'enabled' })
  try {
    await store.init()
    const view = store.view()
    const prewarm = mod.createTeamProjectionCache({ mode: 'enabled' })
    prewarm.project(view, 'root-0', 'team-0-0'); prewarm.close()
    const coldSamples = []
    for (let sample = 0; sample < 5; sample += 1) {
      const coldCache = sample === 0 ? cache : mod.createTeamProjectionCache({ mode: 'enabled' })
      const coldStarted = performance.now()
      for (let index = 0; index < 65; index += 1) coldCache.project(view, `root-${index}`, `team-${index}-0`)
      coldSamples.push(performance.now() - coldStarted)
      if (coldCache !== cache) coldCache.close()
    }
    const coldMs = percentile(coldSamples, 0.5)
    const coldP95 = percentile(coldSamples, 0.95)
    const hotSamples = []
    const rssSamples = []
    for (let sample = 0; sample < 30; sample += 1) {
      const started = performance.now()
      for (let index = 0; index < 65; index += 1) cache.project(view, `root-${index}`, `team-${index}-0`)
      hotSamples.push(performance.now() - started)
      rssSamples.push(process.memoryUsage().rss)
    }
    const singleSamples = []
    for (let sample = 0; sample < 100; sample += 1) {
      const started = performance.now(); cache.project(view, 'root-32', 'team-32-0'); singleSamples.push(performance.now() - started)
    }
    const canonicalSamples = []
    for (let sample = 0; sample < 12; sample += 1) {
      const started = performance.now()
      for (let index = 0; index < 65; index += 1) mod.teamSnapshot(view, `root-${index}`, `team-${index}-0`)
      canonicalSamples.push(performance.now() - started)
    }
    const hotP95 = percentile(hotSamples.slice(5), 0.95)
    const singleP95 = percentile(singleSamples.slice(10), 0.95)
    const canonicalP95 = percentile(canonicalSamples.slice(2), 0.95)
    const rssGrowth = Math.max(...rssSamples.slice(-5)) - Math.min(...rssSamples.slice(0, 5))
    const monotonicSteps = rssSamples.slice(1).filter((value, index) => value > rssSamples[index]).length
    t.diagnostic(`projection raw ${JSON.stringify({ storageMode: store.storageDiagnostics().mode, coldSamples, coldMs, coldP95, hotSamples, singleSamples, canonicalSamples, hotP95, singleP95, canonicalP95, rssSamples, rssGrowth, monotonicSteps, cache: cache.stats() })}`)
    assert.ok(coldMs <= 60, `65-root cold projection median took ${coldMs.toFixed(3)}ms`)
    assert.ok(hotP95 < 5, `same-generation all-65 hot p95 took ${hotP95.toFixed(3)}ms`)
    assert.ok(singleP95 < 1, `same-generation single-root hot p95 took ${singleP95.toFixed(3)}ms`)
    assert.ok(hotP95 <= canonicalP95 * 1.1, `cached p95 regressed more than 10% versus canonical ${canonicalP95.toFixed(3)}ms`)
    assert.ok(cache.stats().bytes <= 32 * 1024 * 1024)
    assert.ok(rssGrowth <= Math.max(16 * 1024 * 1024, rssSamples[0] * 0.1), `RSS grew by ${rssGrowth} bytes`)
    assert.ok(monotonicSteps < rssSamples.length - 1, 'RSS must not increase on every steady-state sample')
  } finally {
    cache.close(); store.close(); await rm(root, { recursive: true, force: true })
  }
})
