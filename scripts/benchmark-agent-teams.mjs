import { performance } from 'node:perf_hooks'
import { teamSnapshot } from '../plugins/dsh-agent-teams/lib/index.js'

function positiveInteger(value, fallback, maximum = 10_000) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback
}

function option(name, fallback, maximum) {
  const index = process.argv.indexOf(`--${name}`)
  return positiveInteger(index >= 0 ? process.argv[index + 1] : undefined, fallback, maximum)
}

const requestedRoots = option('sessions', 6, 128)
const sessionCounts = process.argv.includes('--matrix') ? [6, 12, 24] : [requestedRoots]
const teamsPerRoot = option('teams', 2, 8)
const workersPerTeam = option('members', 4, 8)
const tasksPerTeam = option('tasks', 50, 1_000)
const messagesPerTeam = option('messages', 100, 500)
const iterations = option('iterations', 10, 1_000)
const baseTime = Date.parse('2026-01-01T00:00:00.000Z')
const iso = offset => new Date(baseTime + offset).toISOString()

function buildDocument(roots) {
  const teams = []
  for (let rootIndex = 0; rootIndex < roots; rootIndex += 1) {
    const rootSessionId = `root-${rootIndex}`
    for (let teamIndex = 0; teamIndex < teamsPerRoot; teamIndex += 1) {
      const teamId = `team-${rootIndex}-${teamIndex}`
      const members = [{
        id: `lead:${rootSessionId}`,
        sessionId: rootSessionId,
        name: `Lead ${rootIndex}`,
        role: 'root lead and coordinator',
        modelTier: 'main',
        inheritsMain: true,
        routeSource: 'main',
        kind: 'lead',
        state: 'running',
        createdAt: iso(rootIndex),
        updatedAt: iso(rootIndex)
      }]
      for (let memberIndex = 0; memberIndex < workersPerTeam; memberIndex += 1) {
        members.push({
          id: `member-${rootIndex}-${teamIndex}-${memberIndex}`,
          sessionId: `child-${rootIndex}-${teamIndex}-${memberIndex}`,
          name: `Worker ${memberIndex}`,
          role: `workstream ${memberIndex}`,
          modelTier: 'subagent',
          inheritsMain: false,
          routeSource: 'subagent',
          kind: 'worker',
          state: memberIndex % 2 === 0 ? 'running' : 'ready',
          createdAt: iso(memberIndex),
          updatedAt: iso(memberIndex + tasksPerTeam)
        })
      }
      const tasks = Array.from({ length: tasksPerTeam }, (_, taskIndex) => ({
        id: `task-${rootIndex}-${teamIndex}-${taskIndex}`,
        title: `Task ${taskIndex}`,
        description: `Bounded task description ${taskIndex}`,
        state: taskIndex % 3 === 0 ? 'completed' : taskIndex % 3 === 1 ? 'in_progress' : 'pending',
        dependsOn: [],
        crossTeamDependsOn: [],
        files: [`src/workstream-${taskIndex % workersPerTeam}/file-${taskIndex}.js`],
        assigneeSessionId: `child-${rootIndex}-${teamIndex}-${taskIndex % workersPerTeam}`,
        createdAt: iso(taskIndex),
        updatedAt: iso(taskIndex + 1),
        ...(taskIndex % 3 === 0 ? { completedAt: iso(taskIndex + 2) } : {})
      }))
      const messages = Array.from({ length: messagesPerTeam }, (_, messageIndex) => ({
        id: `message-${rootIndex}-${teamIndex}-${messageIndex}`,
        fromSessionId: `child-${rootIndex}-${teamIndex}-${messageIndex % workersPerTeam}`,
        toSessionId: rootSessionId,
        body: `Private durable message body ${messageIndex}`,
        status: 'delivered',
        createdAt: iso(messageIndex),
        deliveredAt: iso(messageIndex + 1)
      }))
      teams.push({
        id: teamId,
        rootLeadSessionId: rootSessionId,
        name: `Team ${rootIndex}-${teamIndex}`,
        objective: `Concurrent objective ${rootIndex}-${teamIndex}`,
        revision: tasksPerTeam + messagesPerTeam,
        state: 'active',
        createdAt: iso(teamIndex),
        updatedAt: iso(tasksPerTeam + messagesPerTeam),
        members,
        tasks,
        messages
      })
    }
  }
  return { version: 2, settings: { enabled: true, maxMembers: 8, maxActiveTurns: 8 }, teams }
}

function runScenario(roots) {
  const document = buildDocument(roots)
  const sessions = Array.from({ length: roots }, (_, index) => `root-${index}`)
  for (const sessionId of sessions) teamSnapshot(document, sessionId)

  const samples = []
  let encodedBytes = 0
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const sessionId of sessions) {
      const startedAt = performance.now()
      const snapshot = teamSnapshot(document, sessionId)
      encodedBytes += Buffer.byteLength(JSON.stringify(snapshot))
      samples.push(performance.now() - startedAt)
    }
  }
  samples.sort((left, right) => left - right)
  const totalMs = samples.reduce((sum, value) => sum + value, 0)
  const percentile = value => samples[Math.min(samples.length - 1, Math.floor(samples.length * value))]
  return {
    fixture: {
      sessions: roots,
      teams: document.teams.length,
      members: document.teams.length * (workersPerTeam + 1),
      tasks: document.teams.length * tasksPerTeam,
      messages: document.teams.length * messagesPerTeam,
      iterations,
      snapshots: samples.length
    },
    projection: {
      totalMs: Number(totalMs.toFixed(2)),
      averageMs: Number((totalMs / samples.length).toFixed(3)),
      p95Ms: Number(percentile(0.95).toFixed(3)),
      maximumMs: Number(samples.at(-1).toFixed(3)),
      averagePayloadKiB: Number((encodedBytes / samples.length / 1024).toFixed(2)),
      throughputPerSecond: Number((samples.length / (totalMs / 1000)).toFixed(1))
    }
  }
}

const scenarios = sessionCounts.map(runScenario)
console.log(JSON.stringify(scenarios.length === 1 ? scenarios[0] : { scenarios }, null, 2))
