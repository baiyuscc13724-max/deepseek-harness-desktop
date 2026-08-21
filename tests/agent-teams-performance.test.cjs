const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')
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
