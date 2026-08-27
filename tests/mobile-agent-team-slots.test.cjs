const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const runtime = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/assets/mobile-runtime.js'), 'utf8')
const iosRuntime = fs.readFileSync(path.join(root, 'mobile/ios/HarnessMobile/Resources/mobile-runtime.js'), 'utf8')
const androidCss = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/assets/mobile-compat.css'), 'utf8')
const iosCss = fs.readFileSync(path.join(root, 'mobile/ios/HarnessMobile/Resources/mobile-compat.css'), 'utf8')
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

test('mobile team source context is explainable and switches through an authoritative session choice', () => {
  assert.match(runtime, /const officialSourceContext = \(\) =>/u)
  assert.match(runtime, /团队属于来源会话，不会因项目名称相同而合并/u)
  assert.match(runtime, /选择其他项目或会话/u)
  assert.match(runtime, /source\?\.scrollIntoView/u)
  assert.doesNotMatch(runtime, /当前项目 · 已绑定/u)
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

test('Android and iOS task hubs expose the same accessible triage without invented percentages', () => {
  for (const source of [runtime, iosRuntime]) {
    assert.match(source, /triage\.dataset\.harnessMobileTaskTriage = 'true'/u)
    assert.match(source, /\['需要确认什么'/u)
    assert.match(source, /\['卡在哪里'/u)
    assert.match(source, /\['下一步做什么'/u)
    assert.match(source, /Host 投影中没有待人工确认项/u)
    assert.match(source, /提交可核对 checkpoint/u)
    assert.match(source, /成员计划里程碑（未验证）/u)
    assert.match(source, /成员建议的下一步（未验证）/u)
    const start = source.indexOf('const taskProjectionState = task =>')
    const end = source.indexOf('const mobileTasksState =', start)
    assert.ok(start >= 0 && end > start)
    assert.doesNotMatch(source.slice(start, end), /progressPercent|\.percent\b|百分比|\+ ['"]%['"]/u)
    assert.match(source, /row\.setAttribute\('aria-label'/u)
  }
  assert.equal(runtime.includes("triage.dataset.harnessMobileTaskTriage = 'true'"), iosRuntime.includes("triage.dataset.harnessMobileTaskTriage = 'true'"))
})

test('mobile task projection treats permission unknown and outcome_unknown as Attention facts', () => {
  for (const source of [runtime, iosRuntime]) {
    const start = source.indexOf('const taskProjectionPermissionAttention = task =>')
    const end = source.indexOf('const taskProjectionAttempt = task =>', start)
    assert.ok(start >= 0 && end > start)
    const helpers = Function(`${source.slice(start, end)}\nreturn { taskProjectionState, taskProjectionFacts };`)()
    const permissionUnknown = { state: 'pending', capabilities: [{ name: 'camera', status: 'unknown', source: 'Host cannot prove it' }] }
    const uncertainEffect = { state: 'pending', externalEffects: [{ name: 'external UI action', policy: 'confirm_each', outcome: 'outcome_unknown' }] }
    assert.equal(helpers.taskProjectionState(permissionUnknown), 'attention')
    assert.equal(helpers.taskProjectionState(uncertainEffect), 'attention')
    assert.ok(helpers.taskProjectionFacts(permissionUnknown).some(value => value.includes('权限')))
    assert.ok(helpers.taskProjectionFacts(uncertainEffect).some(value => value.includes('副作用')))
  }
})

test('mobile task hub retains touch, overflow, and reduced-motion safety on both platforms', () => {
  for (const css of [androidCss, iosCss]) {
    assert.match(css, /html,[\s\S]*?body,[\s\S]*?#root \{[\s\S]*?overflow-x:\s*hidden/iu)
    assert.match(css, /\[data-harness-mobile-task-hub-row\] \{[\s\S]*?min-height:\s*(?:[4-9]\d|\d{3,})px/iu)
    assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/iu)
  }
})
