const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const runtime = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/assets/mobile-runtime.js'), 'utf8')
const client = fs.readFileSync(path.join(root, 'plugins/dsh-agent-teams/lib/client.js'), 'utf8')

test('official Agent Teams exposes stable mobile navigation and context slots', () => {
  assert.match(client, /"data-mobile-slot": "agent-teams\.navigation"/u)
  assert.match(client, /item\.id === "projectTasks" \? "navigation\.tasks" : item\.id === "board" \? "navigation\.agents"/u)
  assert.match(client, /"data-mobile-slot": "agent-teams\.workspace"/u)
  assert.match(client, /"data-mobile-slot": "agent-teams\.context"/u)
  assert.match(client, /"data-harness-mobile-session-id": String\(props\.sessionId \|\| ""\)/u)
  assert.match(client, /"data-harness-mobile-team-id": team \? String\(teamId\(team\)\) : undefined/u)
  assert.match(client, /"data-mobile-slot": "agent-teams\.context-switcher"/u)
  assert.match(client, /"data-harness-mobile-team-id": String\(teamId\(team\)\)/u)
})

test('team canvas and durable task details expose authoritative entity identifiers', () => {
  assert.match(client, /"data-mobile-slot": "agent-teams\.canvas"/u)
  assert.match(client, /"data-mobile-slot": "agent-teams\.task-detail"/u)
  assert.match(client, /"data-mobile-slot": "agent-teams\.task-detail\.trigger"/u)
  assert.match(client, /"data-harness-mobile-task-id": String\(taskId\(task\)\)/u)
})

test('project tasks expose project and task references without name guessing', () => {
  assert.match(client, /"data-mobile-slot": "tasks\.workspace"/u)
  assert.match(client, /"data-mobile-slot": "tasks\.context"/u)
  assert.match(client, /"data-harness-mobile-project-bound": "true"/u)
  assert.doesNotMatch(client.slice(client.indexOf('function ProjectTasksWorkspace'), client.indexOf('function normalizeProjectFoundationsState')), /projectRef|sessionId|actorRef/u)
  assert.match(client, /"data-mobile-slot": "tasks\.item"/u)
  assert.match(client, /"data-harness-mobile-task-id": String\(safeTask\.taskRef\)/u)
})

test('mobile Scheduled Tasks opens the authoritative reminders and automation workspace', () => {
  assert.match(runtime, /\{ id: 'tasks', label: '定时任务'/u)
  assert.match(runtime, /if \(domain\.id === 'tasks'\)/u)
  assert.match(runtime, /const agentsDomain = mobileDomains\.find\(item => item\.id === 'agents'\)/u)
  assert.match(runtime, /agentsTarget\.click\(\)/u)
  assert.match(runtime, /const openOfficialScheduledTasks = \(\) =>/u)
  assert.match(runtime, /data-harness-mobile-workspace-view="automation"/u)
  assert.doesNotMatch(runtime, /root\.dataset\.harnessMobileDomain === 'tasks'\) loadMobileTasksHub/u)
})
