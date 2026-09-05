const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const { createHash } = require('node:crypto')
const path = require('node:path')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const vm = require('node:vm')

const clientFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'client.js')
const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
const boardFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-team-board.js')

async function clientSource() {
  return readFile(clientFile, 'utf8')
}

async function clientLiveTestModule(React, extras = {}) {
  const source = await clientSource()
  const injection = '    exports.__liveTest = { teamSnapshotVersion, teamSnapshotClock, olderTeamSnapshot, safeTeamLiveStatus, useTeamState };\n    exports.apply = apply;'
  const instrumented = source.replace('    exports.apply = apply;', injection)
  assert.notEqual(instrumented, source, 'client test seam must inject exactly once')
  let exports
  const window = extras.window || {}
  window.__ModuleLoader__ = { load(definition) { exports = definition.factory((name) => { if (name === 'react') return React; throw new Error(`unexpected module ${name}`) }) } }
  const context = vm.createContext(Object.assign({ window, document: extras.document, EventSource: extras.EventSource, fetch: extras.fetch, requestAnimationFrame: extras.requestAnimationFrame, cancelAnimationFrame: extras.cancelAnimationFrame, setTimeout: extras.setTimeout || setTimeout, clearTimeout: extras.clearTimeout || clearTimeout, console, URL, URLSearchParams }, extras.globals || {}))
  vm.runInContext(instrumented, context, { filename: clientFile })
  return { hooks: exports.__liveTest, window, context }
}

test('Agent Teams owns a native conversation view without a duplicate modal or dock', async () => {
  const source = await clientSource()
  assert.match(source, /window\.__ModuleLoader__\.load/u)
  assert.match(source, /ctx\.slots\.inject\("conversation\.view"/u)
  assert.match(source, /name: "conversation\.view", id: "agent-teams"/u)
  assert.doesNotMatch(source, /conversation\.session\.header\.actions/u)
  assert.doesNotMatch(source, /conversation\.input\.dock/u)
  assert.doesNotMatch(source, /dat-overlay|dat-modal/u)
  assert.match(source, /role: props\.modal \? "dialog" : "complementary"/u)
  assert.match(source, /\/api\/agent-teams\/state/u)
  assert.match(source, /\/api\/agent-teams\/events/u)
  assert.match(source, /x-harness-agent-teams/iu)
  assert.match(source, /title: "代理团队"/u)
  assert.match(source, /settingsTitle: "代理团队"/u)
  assert.match(source, /EventSource/u)
  assert.doesNotMatch(source, /https?:\/\//u)
})

test('Project Task mutations expose only explicit create and allowed transition intents', async () => {
  const source = await clientSource()
  assert.match(source, /function ProjectTasksWorkspace\(props\)/u)
  assert.match(source, /function newProjectTaskCommandId\(\)/u)
  assert.match(source, /Object\.keys\(body\)\.every\(function \(key\) \{ return \["commandId", "type", "taskRef", "expectedRevision", "payload"\]\.indexOf\(key\) >= 0; \}\)/u)
  assert.doesNotMatch(source, /ProjectTasksWorkspace[\s\S]*?function [^(]+\([^)]*\)[\s\S]*?inputActions\.(?:submit|send)/u)
  assert.ok(source.includes('projectTasksExplicitOnly: "只执行你明确点击的创建或状态变更；不会自动审批、发送消息或改写冲突。"'))
  assert.ok(source.includes('projectTasksExplicitOnly: "Only the create or status change you explicitly select is run. Nothing is auto-approved, messaged, or rewritten after a conflict."'))
  assert.ok(source.includes('projectTasksCreateUnavailable: "当前项目任务只可查看，不能在这台电脑创建。"'))
  assert.ok(source.includes('projectTasksPage: "本页 {page} · 已加载 {loaded}/{total} · 剩余 {remaining}"'))
  assert.ok(source.includes('projectTasksPage: "{page} this page · {loaded}/{total} loaded · {remaining} remaining"'))
  assert.ok(source.includes('projectTasksLoadMore: "加载更多"'))
  assert.ok(source.includes('projectTasksLoadMore: "Load more"'))
  assert.doesNotMatch(source, /projectTasksHasMore|latest 500|最近 500/u)
  assert.ok(source.includes('projectTasksChangedError: "任务状态已经变化。请刷新后核对最新版本，再明确选择操作。"'))
  assert.doesNotMatch(source, /projectTaskErrorSummary[^]*return error\.message/u)
})

test('Project Automation stays manual, reviewable, and separate from session reminders', async () => {
  const source = await clientSource()
  assert.ok(source.includes('projectAutomationApprovalBoundary: "批准只会把运行放入队列；按钮请求不会直接执行任务。"'))
  assert.ok(source.includes('projectAutomationSeparate: "项目自动化使用独立项目存储和审计历史；左侧提醒仍只属于当前会话，两者不会互相触发或合并记录。"'))
  assert.ok(source.includes('projectAutomationApprovalBoundary: "Approval only queues the run; the button request does not execute the task directly."'))
  assert.match(source, /function ProjectAutomationPanel\(props\)/u)
  assert.doesNotMatch(source, /ProjectAutomationPanel[\s\S]*?function [^(]+\([^)]*\)[\s\S]*?inputActions\.(?:submit|send)/u)
})

test('M4 collaborator workspaces explain safe sync, offline receipts, and permission loss without private fields', async () => {
  const source = await clientSource()
  for (const text of [
    '已从主设备安全同步。这里只显示允许共享的任务摘要。',
    'Securely synced from the primary desktop. Only task summaries approved for sharing are shown.',
    '本机已安全同步 {loaded} 项 · 完整列表与分页请在项目 authority 设备查看',
    '{loaded} safely synced on this desktop · use the project authority desktop for the complete list and pagination',
    '已从主设备安全同步自动化摘要。这里只显示允许共享的数据。',
    'Automation summaries were synced securely from the primary desktop. Only approved shared data is shown.'
  ]) assert.ok(source.includes(text), `missing collaborator guidance: ${text}`)
  assert.equal(source.includes('当前版本只能在项目所有者所在电脑管理项目任务'), false)
  assert.equal(source.includes('Collaborator desktops can currently view connection status only'), false)
  const taskStart = source.indexOf('    function normalizeProjectTasksState(input)')
  const taskEnd = source.indexOf('    function useProjectTasksState(projectScope)', taskStart)
  const automationStart = source.indexOf('    function normalizeProjectAutomationsState(input)')
  const automationEnd = source.indexOf('    function projectAutomationActionBody(', automationStart)
  const projections = source.slice(taskStart, taskEnd) + source.slice(automationStart, automationEnd)
  for (const privateName of ['deviceRef', 'actorRef', 'messageRef', 'requestDigest', 'resetToken', 'fileScope', 'requirementsRevision', 'commentBody', 'reviewBody', 'effectKey']) assert.equal(projections.includes(privateName), false, `private field entered UI projection: ${privateName}`)
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|\.innerHTML/u)
})

test('M5 foundation status uses human next steps and never exposes implementation evidence', async () => {
  const source = await clientSource()
  for (const text of ['项目基础状态', 'Project foundation status', '可以安全落地', 'Ready to land safely', '由主设备负责', 'Managed by the primary desktop', '源目录不可用', 'Source unavailable', '合并冲突需要处理', 'Merge conflicts need attention', '等待可信质量运行器', 'Waiting for a trusted quality runner']) assert.ok(source.includes(text), `missing M5 copy: ${text}`)
  const start = source.indexOf('    function normalizeProjectFoundationsState(input)')
  const end = source.indexOf('    function ProjectFoundationStatusCard(props)', start)
  const foundationSource = source.slice(start, end)
  for (const privateName of ['commit', 'digest', 'messageRef', 'taskRef', 'fileScope', 'actorRef', 'runnerKey', 'evidence', 'credential']) assert.equal(foundationSource.includes(`state.${privateName}`), false, `foundation card renders private field: ${privateName}`)
  assert.match(foundationSource, /attentionTokens = \["connector_credentials_unavailable", "connector_disabled", "git_unavailable", "merge_conflict", "merge_queue_empty", "root_unavailable", "runner_unavailable", "source_dirty", "source_invalid", "status_unavailable"\]/u)
  assert.doesNotMatch(foundationSource, /dangerouslySetInnerHTML|\.innerHTML/u)
})

test('Agent Teams coalesces monotonic snapshots and recovers one SSE subscription without polling storms', async () => {
  const source = await clientSource()
  assert.match(source, /function teamSnapshotVersion\(snapshot\)/u)
  assert.match(source, /board\.cursor \|\| ""/u)
  assert.match(source, /function teamSnapshotClock\(snapshot, selectedTeamId, stream\)/u)
  assert.match(source, /function teamScopedSemanticMarker\(fullTeam, boardTeam\) \{\s*return JSON\.stringify\(\[fullTeam \?\? null, boardTeam \?\? null\]\);\s*\}/u)
  assert.match(source, /semanticMarker: teamScopedSemanticMarker\(fullTeam, boardTeam\)/u)
  assert.match(source, /taskClocks\[id\] = \{ revision: safeLiveInteger\(task\.revision\), eventSequence: safeLiveInteger\(task\.eventSequence\) \}/u)
  assert.match(source, /function olderTeamSnapshot\(next, current\)/u)
  assert.match(source, /next\.semanticMarker !== current\.semanticMarker\) return true/u)
  assert.match(source, /next\.pauseEpoch < current\.pauseEpoch/u)
  assert.match(source, /next\.revision < current\.revision/u)
  assert.match(source, /nextTasks\[id\]\.revision < currentTasks\[id\]\.revision/u)
  assert.match(source, /nextTasks\[id\]\.eventSequence < currentTasks\[id\]\.eventSequence/u)
  assert.match(source, /olderTeamSnapshot\(nextClock, pendingClock \|\| clockRef\.current\)/u)
  assert.match(source, /version === versionRef\.current/u)
  assert.match(source, /requestAnimationFrame === "function" \? requestAnimationFrame\(work\) : setTimeout\(work, 16\)/u)
  assert.match(source, /publishFrame = requestFrame\(flushSnapshot\)/u)
  assert.match(source, /startTransition\(function \(\) \{ if \(alive\) \{ setState\(next\); setError\(""\); \} \}\)/u)
  assert.match(source, /document\.visibilityState === "hidden"/u)
  assert.match(source, /addEventListener\("visibilitychange", onVisibilityChange\)/u)
  assert.match(source, /if \(hidden\(\)\) \{ closeSource\(true\); return; \}/u)
  assert.match(source, /if \(!hidden\(\)\) \{ openSource\(\); if \(!source\) load\(false, streamEpoch\)/u)
  assert.match(source, /current\.onopen = null;[\s\S]*current\.onmessage = null;[\s\S]*current\.onerror = null;[\s\S]*removeEventListener\(name, sourceUpdate\)[\s\S]*current\.close\(\)/u)
  assert.match(source, /generation === loadGeneration && \(expectedStreamEpoch === undefined \|\| streamEpoch === expectedStreamEpoch\)/u)
  assert.match(source, /streamEpoch \+= 1; streamNeedsSnapshot = false; clearSnapshotFallback\(\); setConnection\("live"\); queueSnapshot/u)
  assert.match(source, /isAuthoritativeSnapshot = event\.type === "snapshot"/u)
  assert.match(source, /streamNeedsSnapshot && !isAuthoritativeSnapshot/u)
  assert.match(source, /snapshotFallbackTimer = setTimeout/u)
  assert.match(source, /typeof current\.addEventListener !== "function" \|\| typeof current\.close !== "function"/u)
  assert.match(source, /if \(current && typeof current\.close === "function"\) current\.close\(\)/u)
  assert.match(source, /if \(!alive \|\| hidden\(\) \|\| sourceOpen \|\| pollTimer\) return/u)
  assert.match(source, /if \(!alive \|\| hidden\(\) \|\| source\) return/u)
  assert.match(source, /if \(loadPromise\) return loadPromise/u)
  assert.match(source, /Math\.min\(60000, 15000 \* Math\.pow\(2, Math\.min\(pollAttempt, 2\)\)\)/u)
  assert.match(source, /Math\.random\(\) \* 0\.4/u)
  assert.match(source, /Native EventSource reconnects while visible/u)
  assert.doesNotMatch(source, /setInterval\(/u)
  assert.doesNotMatch(source, /source\.onerror = function \(\) \{[^}]*source\.close\(\)/u)

  const taskDetailStart = source.indexOf('    function useTaskDetailState(')
  const taskDetailEnd = source.indexOf('    function projectTaskResponseError(', taskDetailStart)
  const taskDetail = source.slice(taskDetailStart, taskDetailEnd)
  assert.doesNotMatch(taskDetail, /EventSource|setTimeout|setInterval/u, 'task detail reuses shared snapshot refreshes instead of opening another subscription/timer')
  assert.match(taskDetail, /snapshotVersion/u)
})

test('live status is sanitized, accessible, bounded, and labels historical chat separately', async () => {
  const source = await clientSource()
  for (const marker of ['注册中', '排队中', '执行中', '可续用', '提交待验收', '容量背压', '提供方暂时异常', '生命周期超时', '结果待核对', '发送时快照', '未采信', '查看实时状态']) assert.ok(source.includes(marker), `missing live status copy: ${marker}`)
  assert.match(source, /TEAM_LIVE_STATUS_EVENT = "harness-desktop:agent-team-live-status"/u)
  assert.match(source, /publishSafeTeamLiveStatus\(next, selectedTeamId\)/u)
  assert.match(source, /publishSafeTeamLiveStatus\(null, selectedTeamId\)/u)
  assert.match(source, /window\.__DSH_AGENT_TEAM_LIVE_STATUS__ = detail/u)
  assert.match(source, /new window\.CustomEvent\(TEAM_LIVE_STATUS_EVENT, \{ detail: detail \}\)/u)
  assert.match(source, /role: "status", "aria-live": "polite", "aria-atomic": "true"/u)
  assert.match(source, /className: "dat-live-status"/u)
  assert.match(source, /\.dat-live-status \.dat-btn\{min-width:44px;min-height:44px\}/u)
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)[^\n]*\.dat-live-status \*/u)
  assert.match(source, /\.slice\(0, 48\)/u)
  const safeStart = source.indexOf('    function safeTeamLiveStatus(')
  const safeEnd = source.indexOf('    function publishSafeTeamLiveStatus(', safeStart)
  const safeProjection = source.slice(safeStart, safeEnd)
  assert.match(safeProjection, /fallbackWorkers = \(team\.members \|\| \[\]\)\.filter\(function \(member\) \{ return member\.kind === "worker"; \}\)/u)
  assert.match(safeProjection, /\(member\.mode === void 0 \|\| member\.mode === "continuable"\)/u)
  for (const forbidden of ['sessionId', 'runId', 'claimId', 'path', 'stack', 'provider', 'prompt', 'output', 'lastAssistantMessage']) assert.doesNotMatch(safeProjection, new RegExp(`(?:source|team|rawDiagnostic)\\.${forbidden}\\b|["']${forbidden}["']\\s*:`, 'u'), `live status reads forbidden field: ${forbidden}`)
  const { hooks } = await clientLiveTestModule({})
  const queued = hooks.safeTeamLiveStatus({ team: { id: 'team-queued', status: 'active', revision: 2, pauseEpoch: 0, updatedAt: '2026-01-01T00:00:00.000Z', members: [{ id: 'worker-queued', name: 'Queue', kind: 'worker', state: 'provisioning' }], tasks: [], provisioningQueue: [{ name: 'Queue', status: 'queued' }] } }, 'team-queued')
  assert.equal(queued.kind, 'queued')
  assert.equal(queued.counts.queued, 1)
  assert.equal(queued.counts.registering, 0, 'queued placeholders are not double-counted as registering')
  const leadOnly = hooks.safeTeamLiveStatus({ team: { id: 'team-lead-only', status: 'active', revision: 1, pauseEpoch: 0, updatedAt: '2026-01-01T00:00:00.000Z', members: [{ id: 'lead', kind: 'lead', state: 'ready' }], tasks: [] } }, 'team-lead-only')
  assert.equal(leadOnly.kind, 'idle', 'full-team fallback never exposes the root lead as a continuable subagent')
  assert.equal(leadOnly.counts.running, 0)
  assert.equal(leadOnly.counts.continuable, 0)
  const modeBoundary = hooks.safeTeamLiveStatus({ team: { id: 'team-mode-boundary', status: 'active', revision: 1, pauseEpoch: 0, updatedAt: '2026-01-01T00:00:00.000Z', members: [{ id: 'lead', kind: 'lead', state: 'ready', mode: 'continuable' }, { id: 'implicit', kind: 'worker', state: 'ready' }, { id: 'continuable', kind: 'worker', state: 'idle', mode: 'continuable' }, { id: 'one-shot', kind: 'worker', state: 'ready', mode: 'one-shot' }], tasks: [] } }, 'team-mode-boundary')
  assert.equal(modeBoundary.kind, 'continuable')
  assert.equal(modeBoundary.counts.continuable, 2, 'fallback matches Host: only ready/idle workers with omitted or continuable mode count; one-shot and lead do not')
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|\.innerHTML/u)
})

test('terminal lifecycle mutation reaches the Host board and safe realtime card exactly once, then recovered state wins', async () => {
  const source = await clientSource()
  assert.match(source, /var liveStatus = safeTeamLiveStatus\(snapshot, team && teamId\(team\)\);[\s\S]*h\(LiveTeamStatusCard, \{ t: t, status: liveStatus,/u)
  const mod = await import(`${pathToFileURL(pluginFile).href}?terminal-live-boundary=${Date.now()}`)
  const { hooks } = await clientLiveTestModule({})
  const timestamp = '2026-01-01T00:00:00.000Z'
  const worker = { id: 'worker-id', sessionId: 'worker-session', name: 'Worker', role: 'work', kind: 'worker', state: 'running', runId: 'run-1', createdAt: timestamp, updatedAt: timestamp }
  const message = { id: 'message-id', fromSessionId: 'worker-session', toSessionId: 'lead', status: 'queued', body: 'Immutable sent-time prose.', createdAt: timestamp, queuedAt: timestamp }
  const team = {
    id: 'team-live-boundary', rootLeadSessionId: 'lead', name: 'Team', objective: 'Boundary', projectKey: 'c'.repeat(64), state: 'active', revision: 1, pauseEpoch: 0,
    createdAt: timestamp, updatedAt: timestamp,
    members: [{ id: 'lead:lead', sessionId: 'lead', name: 'Lead', role: 'root lead and coordinator', kind: 'lead', state: 'ready', createdAt: timestamp, updatedAt: timestamp }, worker],
    tasks: [{ id: 'task-id', title: 'Current work', state: 'in_progress', assigneeSessionId: worker.sessionId, revision: 1, dependsOn: [], lifecycleLedger: [], interruptionHistory: [], externalEffects: [], createdAt: timestamp, updatedAt: timestamp }], messages: [message]
  }
  const document = { teams: [team] }, hostPushes = []
  const store = {
    hasManagedMember: id => id === worker.sessionId,
    async mutate(change) {
      const before = JSON.stringify(document)
      const result = change(document)
      if (JSON.stringify(document) !== before) {
        team.revision += 1
        const board = mod.decorateProjectTeamBoardRecovery(mod.createProjectTeamBoard(team.projectKey, [team]), [team], 'lead')
        hostPushes.push({ enabled: true, team, teams: [team], projectTeamBoard: board })
      }
      return result
    }
  }
  const reconciler = mod.createSubagentEventReconciler({ logger: { warn: assert.fail } }, store, Promise.resolve(), 60_000)
  const rawDiagnostic = {
    code: 'PI_AI_ERROR', message: 'Not Found: raw provider detail', retryable: true, partialOutputPresent: true,
    provider: 'secret-provider', sessionId: 'secret-session', runId: 'secret-run', claimId: 'secret-claim', path: 'C:\\secret', stack: 'secret-stack', output: 'secret-output'
  }
  try {
    const failure = reconciler.enqueue('end', { id: worker.sessionId, runId: 'run-1', stopReason: 'error', terminalDiagnostic: rawDiagnostic, lastAssistantMessage: [{ type: 'text', text: 'secret partial output' }] })
    const duplicate = reconciler.enqueue('end', { id: worker.sessionId, runId: 'run-1', stopReason: 'error', terminalDiagnostic: rawDiagnostic })
    await reconciler.flush(); await Promise.all([failure, duplicate])
    assert.equal(hostPushes.length, 1)
    assert.equal(team.revision, 2)
    assert.equal(worker.state, 'failed')
    assert.equal(worker.terminalDiagnostic.category, 'provider_transient')
    assert.equal(hostPushes[0].projectTeamBoard.teams[0].liveStatus.kind, 'provider_transient')
    const failedLive = hooks.safeTeamLiveStatus(hostPushes[0], team.id)
    assert.equal(failedLive.kind, 'provider_transient')
    assert.deepEqual(JSON.parse(JSON.stringify(failedLive.diagnostic)), { errorCode: 'PI_AI_ERROR', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: true, nextAction: 'retry_current_task' })
    assert.doesNotMatch(JSON.stringify(hostPushes[0].projectTeamBoard), /secret-provider|secret-session|secret-run|secret-claim|secret-stack|secret-output|secret partial output/u)
    assert.equal(message.body, 'Immutable sent-time prose.')

    const repeated = reconciler.enqueue('end', { id: worker.sessionId, runId: 'run-1', stopReason: 'error', terminalDiagnostic: rawDiagnostic })
    await reconciler.flush(); await repeated
    assert.equal(hostPushes.length, 1, 'a terminal semantic no-op performs no Host publication')

    const recovery = reconciler.enqueue('start', { id: worker.sessionId, runId: 'run-2' })
    await reconciler.flush(); await recovery
    assert.equal(hostPushes.length, 2)
    assert.equal(team.revision, 3)
    const recoveredLive = hooks.safeTeamLiveStatus(hostPushes[1], team.id)
    assert.equal(recoveredLive.kind, 'running')
    assert.equal(recoveredLive.diagnostic, null)
    assert.equal(message.body, 'Immutable sent-time prose.', 'historical sent prose remains unchanged after recovery')

    const stale = reconciler.enqueue('end', { id: worker.sessionId, runId: 'run-1', stopReason: 'error', terminalDiagnostic: rawDiagnostic })
    await reconciler.flush(); await stale
    assert.equal(hostPushes.length, 2, 'a stale prior-run failure cannot publish over recovered live state')
  } finally {
    reconciler.close()
  }
})

test('decorated root live status keeps only unresolved taskless diagnostics across the safe client bridge', async () => {
  const board = await import(`${pathToFileURL(boardFile).href}?unresolved-live=${Date.now()}-${Math.random()}`)
  const { hooks } = await clientLiveTestModule({ useState() { throw new Error('unused') }, useEffect() {}, useRef() { return { current: null } }, startTransition(work) { work() } })
  const failedAt = '2026-01-01T00:00:05.000Z'
  const failedWorker = { id: 'worker', sessionId: 'worker-session', name: 'Worker', role: 'work', kind: 'worker', state: 'failed', updatedAt: failedAt, terminalDiagnostic: { errorCode: 'PI_AI_ERROR', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: true, nextAction: 'retry_current_task', provider: 'secret-provider', output: 'secret-output' } }
  const taskless = { id: 'taskless-live', rootLeadSessionId: 'lead', name: 'Taskless', objective: 'Diagnostic boundary', projectKey: 'd'.repeat(64), state: 'active', revision: 1, pauseEpoch: 0, createdAt: failedAt, updatedAt: failedAt, plan: { phase: 'active' }, members: [{ id: 'lead:lead', sessionId: 'lead', name: 'Lead', role: 'lead', kind: 'lead', state: 'ready', createdAt: failedAt, updatedAt: failedAt }, failedWorker], tasks: [], messages: [], memberRecoveries: [] }
  const safeProjection = value => {
    const projectTeamBoard = board.decorateProjectTeamBoardRecovery(board.createProjectTeamBoard(value.projectKey, [value]), [value], value.rootLeadSessionId)
    return hooks.safeTeamLiveStatus({ team: value, teams: [value], projectTeamBoard }, value.id)
  }

  const unresolved = safeProjection(taskless)
  assert.equal(unresolved.kind, 'provider_transient')
  assert.deepEqual(JSON.parse(JSON.stringify(unresolved.diagnostic)), { errorCode: 'PI_AI_ERROR', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: true, nextAction: 'retry_current_task' }, 'unrecovered failure keeps only the bounded current diagnostic')
  assert.doesNotMatch(JSON.stringify(unresolved), /secret-provider|secret-output/u)

  const delivered = structuredClone(taskless)
  delivered.revision = 2
  delivered.updatedAt = '2026-01-01T00:00:06.000Z'
  delivered.memberRecoveries = [{ requestId: 'delivered-recovery', action: 'retry', phase: 'followup_returned', status: 'delivered', memberId: failedWorker.id, updatedAt: failedAt }]
  const deliveredLive = safeProjection(delivered)
  assert.equal(deliveredLive.kind, 'idle')
  assert.equal(deliveredLive.diagnostic, null, 'delivered taskless failure cannot be reinserted by root decoration')

  const retired = structuredClone(taskless)
  retired.revision = 2
  retired.updatedAt = '2026-01-01T00:00:06.000Z'
  retired.members.find(member => member.id === failedWorker.id).state = 'retired'
  delete retired.members.find(member => member.id === failedWorker.id).terminalDiagnostic
  const retiredLive = safeProjection(retired)
  assert.equal(retiredLive.kind, 'idle')
  assert.equal(retiredLive.diagnostic, null, 'retired-and-cleared taskless failure stays only in durable lifecycle history')
})

test('fake push accepts bumped restart reconciliation, rejects stale/duplicate state, gates reconnect, and fully cleans up', async () => {
  const states = [], stateSets = [], refs = [], effects = []
  let stateIndex = 0, refIndex = 0
  const React = {
    createElement() {},
    useState(initial) {
      const index = stateIndex++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      stateSets[index] ||= 0
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; stateSets[index] += 1 }]
    },
    useRef(initial) { const index = refIndex++; refs[index] ||= { current: initial }; return refs[index] },
    useEffect(effect) { effects.push(effect) },
    startTransition(work) { work() }
  }
  const instances = []
  class FakeEventSource {
    constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; instances.push(this) }
    addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(listener) }
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener) }
    close() { this.closed = true }
    emit(name, data, lastEventId = '') { const event = { type: name, data: JSON.stringify(data), lastEventId }; for (const listener of this.listeners.get(name) || []) listener(event); if (name === 'message' && this.onmessage) this.onmessage(event) }
  }
  let nextTimer = 1, nextFrame = 1
  const timers = new Map(), frames = new Map(), windowEvents = [], documentListeners = new Map()
  const fakeWindow = {
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail } },
    dispatchEvent(event) { windowEvents.push(event); return true }
  }
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener(name, listener) { documentListeners.set(name, listener) },
    removeEventListener(name, listener) { if (documentListeners.get(name) === listener) documentListeners.delete(name) }
  }
  const { hooks } = await clientLiveTestModule(React, {
    window: fakeWindow,
    document: fakeDocument,
    EventSource: FakeEventSource,
    fetch: () => new Promise(() => {}),
    requestAnimationFrame: (work) => { const id = nextFrame++; frames.set(id, work); return id },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (work, delay) => { const id = nextTimer++; timers.set(id, { work, delay }); return id },
    clearTimeout: (id) => timers.delete(id)
  })
  function snapshot(revision, taskRevision, sequence, extra = {}) {
    const task = { id: 'task-live', state: revision >= 3 ? 'in_progress' : 'pending', revision: taskRevision, eventSequence: sequence, updatedAt: `2026-01-01T00:00:0${revision}.000Z` }
    const team = { id: 'team-live', state: 'active', revision, pauseEpoch: 0, eventSequence: sequence, updatedAt: task.updatedAt, plan: { phase: 'active', hash: `plan-${revision}`, authorization: { state: 'human_attested' } }, members: [{ id: 'worker', kind: 'worker', state: 'running' }], tasks: [task] }
    const summary = { id: team.id, status: 'active', revision, pauseEpoch: 0, eventSequence: sequence, updatedAt: team.updatedAt, tasks: [{ id: task.id, status: task.state, revision: taskRevision, eventSequence: sequence, updatedAt: task.updatedAt }], liveStatus: Object.assign({ kind: 'running', counts: { running: 1 }, revision, pauseEpoch: 0, eventSequence: sequence, updatedAt: team.updatedAt }, extra) }
    return { enabled: true, cursor: `state-${revision}-${sequence}`, team, teams: [team], projectTeamBoard: { cursor: `board-${revision}-${sequence}`, teams: [summary] } }
  }

  const mixedCurrent = hooks.teamSnapshotClock(snapshot(5, 8, 8), 'team-live')
  const mixedStale = hooks.teamSnapshotClock({ ...snapshot(5, 9, 9), team: { ...snapshot(5, 9, 9).team, tasks: [{ id: 'task-live', revision: 7, eventSequence: 10 }] }, teams: [{ ...snapshot(5, 9, 9).team, tasks: [{ id: 'task-live', revision: 7, eventSequence: 10 }] }] }, 'team-live')
  assert.equal(hooks.olderTeamSnapshot(mixedStale, mixedCurrent), true, 'a newer aggregate cannot hide one task revision regression')
  const equalRevisionState = snapshot(5, 5, 5)
  const equalRevisionCurrent = hooks.teamSnapshotClock(equalRevisionState, 'team-live', { streamId: 'old-stream', sequence: 9 })
  const equalRevisionRewrite = structuredClone(equalRevisionState)
  equalRevisionRewrite.team.members[0].state = 'ready'; equalRevisionRewrite.team.updatedAt = '2026-01-01T00:00:09.000Z'; equalRevisionRewrite.teams[0] = equalRevisionRewrite.team
  equalRevisionRewrite.projectTeamBoard.teams[0].updatedAt = equalRevisionRewrite.team.updatedAt; equalRevisionRewrite.projectTeamBoard.teams[0].liveStatus.kind = 'continuable'; equalRevisionRewrite.projectTeamBoard.teams[0].liveStatus.updatedAt = equalRevisionRewrite.team.updatedAt
  assert.equal(hooks.olderTeamSnapshot(hooks.teamSnapshotClock(equalRevisionRewrite, 'team-live', { streamId: 'new-stream', sequence: 1 }), equalRevisionCurrent), true, 'equal team revision rejects a selected-team semantic rewrite even on a new stream')
  assert.equal(hooks.olderTeamSnapshot(hooks.teamSnapshotClock(snapshot(5, 6, 6), 'team-live', { streamId: 'new-stream', sequence: 1 }), equalRevisionCurrent), true, 'task advancement without its required team revision bump is rejected')
  const genuineRevisionAdvance = structuredClone(equalRevisionState)
  genuineRevisionAdvance.team.revision = 6; genuineRevisionAdvance.team.updatedAt = '2026-01-01T00:00:06.000Z'; genuineRevisionAdvance.team.messages = [{ id: 'authorized-message', body: 'revision-bound update' }]; genuineRevisionAdvance.teams[0] = genuineRevisionAdvance.team
  genuineRevisionAdvance.projectTeamBoard.teams[0].revision = 6; genuineRevisionAdvance.projectTeamBoard.teams[0].liveStatus.revision = 6; genuineRevisionAdvance.projectTeamBoard.teams[0].updatedAt = genuineRevisionAdvance.team.updatedAt
  assert.equal(hooks.olderTeamSnapshot(hooks.teamSnapshotClock(genuineRevisionAdvance, 'team-live', { streamId: 'new-stream', sequence: 1 }), equalRevisionCurrent), false, 'a genuine team revision bump authorizes the complete selected-team projection change')
  const configOnly = structuredClone(equalRevisionState); configOnly.config = { maxMembers: 7 }
  assert.equal(hooks.olderTeamSnapshot(hooks.teamSnapshotClock(configOnly, 'team-live', { streamId: 'new-stream', sequence: 1 }), equalRevisionCurrent), false, 'a new-stream global configuration change does not regress the selected team')
  const otherTeamOnly = structuredClone(configOnly); otherTeamOnly.teams.push({ id: 'other-team', state: 'active', revision: 2, pauseEpoch: 0, updatedAt: '2026-01-01T00:00:10.000Z', members: [], tasks: [] }); otherTeamOnly.projectTeamBoard.teams.push({ id: 'other-team', status: 'active', revision: 2, pauseEpoch: 0, updatedAt: '2026-01-01T00:00:10.000Z', tasks: [] })
  assert.equal(hooks.olderTeamSnapshot(hooks.teamSnapshotClock(otherTeamOnly, 'team-live', { streamId: 'new-stream', sequence: 2 }), equalRevisionCurrent), false, 'another team may advance on a new stream while the selected team remains identical')

  hooks.useTeamState('root-session', 'team-live')
  assert.equal(effects.length, 1)
  const cleanup = effects[0]()
  assert.equal(instances.length, 1, 'team state opens exactly one EventSource')
  const stream = instances[0]
  stream.onopen()
  const first = snapshot(2, 2, 2, { diagnostic: { errorCode: 'PI_AI_ERROR', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: true, nextAction: 'retry_current_task', sessionId: 'secret-session', provider: 'secret-provider', output: 'secret-output' } })
  stream.emit('snapshot', first)
  assert.equal(frames.size, 1)
  for (const work of [...frames.values()]) work(); frames.clear()
  assert.equal(stateSets[0], 1)
  assert.equal(states[0].team.revision, 2)
  const firstLiveEvent = windowEvents.find((event) => event.type === 'harness-desktop:agent-team-live-status' && event.detail)
  assert.ok(firstLiveEvent)
  assert.deepEqual(JSON.parse(JSON.stringify(firstLiveEvent.detail.diagnostic)), { errorCode: 'PI_AI_ERROR', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: true, nextAction: 'retry_current_task' })
  assert.doesNotMatch(JSON.stringify(firstLiveEvent.detail), /secret-session|secret-provider|secret-output/u)

  stream.emit('snapshot', first)
  for (const work of [...frames.values()]) work(); frames.clear()
  assert.equal(stateSets[0], 1, 'semantic duplicate causes zero render')
  stream.emit('snapshot', snapshot(3, 3, 3))
  stream.emit('snapshot', snapshot(2, 2, 2))
  for (const work of [...frames.values()]) work(); frames.clear()
  assert.equal(stateSets[0], 2)
  assert.equal(states[0].team.revision, 3, 'out-of-order stale snapshot cannot overwrite pending newer state')

  stream.onerror()
  stream.onopen()
  stream.emit('update', snapshot(4, 4, 4))
  assert.equal(frames.size, 0, 'reconnect rejects updates until an authoritative snapshot arrives')
  stream.emit('snapshot', snapshot(4, 4, 4))
  for (const work of [...frames.values()]) work(); frames.clear()
  assert.equal(states[0].team.revision, 4)
  const reconciledAfterRestart = snapshot(5, 5, 5)
  reconciledAfterRestart.team.members[0].state = 'ready'
  reconciledAfterRestart.teams[0] = reconciledAfterRestart.team
  reconciledAfterRestart.projectTeamBoard.teams[0].revision = 5
  reconciledAfterRestart.projectTeamBoard.teams[0].liveStatus.revision = 5
  stream.emit('snapshot', reconciledAfterRestart)
  for (const work of [...frames.values()]) work(); frames.clear()
  assert.equal(states[0].team.revision, 5, 'the already-mounted client accepts Host restart reconciliation only through its bumped authoritative revision')
  assert.equal(states[0].team.members[0].state, 'ready')
  const rendersAtRevisionFive = stateSets[0]
  const sameRevisionRewrites = [
    ['member name and role', draft => { draft.team.members[0].name = 'Forged name'; draft.team.members[0].role = 'Forged role'; draft.teams[0] = draft.team }],
    ['task title/result/submission', draft => { draft.team.tasks[0].title = 'Forged title'; draft.team.tasks[0].result = { summary: 'forged result' }; draft.team.tasks[0].submission = { submittedAt: '2026-01-01T00:00:09.000Z', summary: 'forged submission' }; draft.teams[0] = draft.team }],
    ['plan and authorization', draft => { draft.team.plan.hash = 'forged-plan-hash'; draft.team.plan.authorization = { state: 'forged' }; draft.team.autopilot = { status: 'forged' }; draft.teams[0] = draft.team }],
    ['messages events and recovery', draft => { draft.team.messages = [{ id: 'forged-message', body: 'forged body', status: 'delivered' }]; draft.team.tasks[0].lifecycleLedger = [{ kind: 'forged-event', sequence: 5 }]; draft.team.memberRecoveries = [{ requestId: 'forged-recovery', status: 'delivered' }]; draft.teams[0] = draft.team }],
    ['board task title and result', draft => { draft.projectTeamBoard.teams[0].tasks[0].title = 'Forged board title'; draft.projectTeamBoard.teams[0].tasks[0].result = { summary: 'forged board result' } }],
    ['board recovery and attention', draft => { draft.projectTeamBoard.teams[0].memberRecovery = { teamId: 'team-live', members: [{ id: 'forged-worker', name: 'Forged' }] }; draft.projectTeamBoard.teams[0].attention = { required: true, codes: ['forged'] } }]
  ]
  sameRevisionRewrites.forEach(([label, mutate], index) => {
    const draft = structuredClone(reconciledAfterRestart)
    draft.cursor = `equal-revision-${index}`; draft.projectTeamBoard.cursor = `equal-revision-board-${index}`
    mutate(draft)
    stream.emit('snapshot', { state: draft, live: { streamId: `rewrite-stream-${index}`, sequence: 1 } })
    for (const work of [...frames.values()]) work(); frames.clear()
    assert.equal(stateSets[0], rendersAtRevisionFive, `same-revision ${label} rewrite is rejected with zero render`)
  })
  assert.equal(states[0].team.members[0].state, 'ready')
  const configAdvance = structuredClone(reconciledAfterRestart)
  configAdvance.cursor = 'config-advance'; configAdvance.config = { maxMembers: 7, maxActiveTurns: 4 }
  stream.emit('snapshot', { state: configAdvance, live: { streamId: 'new-stream', sequence: 2 } })
  for (const work of [...frames.values()]) work(); frames.clear()
  assert.equal(stateSets[0], rendersAtRevisionFive + 1, 'new-stream global config advances without changing selected-team revision')
  assert.equal(states[0].config.maxMembers, 7)
  const otherTeamAdvance = structuredClone(configAdvance)
  otherTeamAdvance.cursor = 'other-team-advance'; otherTeamAdvance.teams.push({ id: 'other-team', state: 'active', revision: 2, pauseEpoch: 0, updatedAt: '2026-01-01T00:00:10.000Z', members: [], tasks: [] }); otherTeamAdvance.projectTeamBoard.cursor = 'other-team-board-advance'; otherTeamAdvance.projectTeamBoard.teams.push({ id: 'other-team', status: 'active', revision: 2, pauseEpoch: 0, updatedAt: '2026-01-01T00:00:10.000Z', tasks: [] })
  stream.emit('snapshot', { state: otherTeamAdvance, live: { streamId: 'new-stream', sequence: 3 } })
  for (const work of [...frames.values()]) work(); frames.clear()
  assert.equal(stateSets[0], rendersAtRevisionFive + 2, 'another team may advance on the new stream while the selected team stays byte-equivalent')
  assert.equal(states[0].teams.length, 2)
  stream.emit('snapshot', snapshot(4, 4, 4))
  for (const work of [...frames.values()]) work(); frames.clear()
  assert.equal(states[0].team.revision, 5, 'an old pre-restart revision arriving later cannot regress the reconciled snapshot')
  const stopped = snapshot(6, 6, 6)
  stopped.team.state = 'paused'; stopped.team.pauseEpoch = 2
  stopped.teams[0] = stopped.team
  stopped.projectTeamBoard.teams[0].status = 'paused'; stopped.projectTeamBoard.teams[0].pauseEpoch = 2; stopped.projectTeamBoard.teams[0].liveStatus.kind = 'paused'; stopped.projectTeamBoard.teams[0].liveStatus.pauseEpoch = 2
  stream.emit('snapshot', stopped)
  for (const work of [...frames.values()]) work(); frames.clear()
  assert.equal(states[0].team.state, 'paused')
  const preStop = snapshot(99, 99, 99)
  stream.emit('snapshot', preStop)
  for (const work of [...frames.values()]) work(); frames.clear()
  assert.equal(states[0].team.state, 'paused', 'a pre-Stop/revoked epoch cannot overwrite the authoritative paused state even with a larger revision')
  cleanup()
  assert.equal(stream.closed, true)
  assert.equal([...stream.listeners.values()].reduce((count, set) => count + set.size, 0), 0)
  assert.equal(frames.size, 0)
  assert.equal(timers.size, 0)
  assert.equal(documentListeners.size, 0)
  assert.equal(windowEvents.at(-1).detail, null, 'session/HMR cleanup clears the shared safe status')
})

test('Agent Teams prompts through the official composer and never auto-sends', async () => {
  const source = await clientSource()
  assert.match(source, /inputActions\.setDraft\(prompt\)/u)
  assert.match(source, /不会自动发送/u)
  assert.match(source, /FirstTeamWizard/u)
  assert.doesNotMatch(source, /AddMemberForm|dat-member-name|dat-member-role/u)
  assert.match(source, /custom: "自定义团队"/u)
  assert.match(source, /useState\("custom"\)/u)
  for (const id of ['research', 'build', 'incident', 'custom']) {
    assert.match(source, new RegExp(`\\{ id: "${id}"`, 'u'), `missing team template: ${id}`)
  }
  assert.equal((source.match(/\{ id: "(?:research|build|incident|custom)"/gu) || []).length, 4)
  assert.match(source, /不要让用户设计团队结构/u)
  assert.match(source, /如果不需要，请说明原因且不要扩员/u)
  assert.match(source, /负责人承担最终交付/u)
  assert.match(source, /优先使用成本较低的成员模型/u)
  assert.match(source, /由同一负责人协调的其他团队/u)
  assert.match(source, /newPeerTeam: "评估是否需要新团队"/u)
  assert.match(source, /如果现有团队足够，请说明原因且不要创建/u)
  assert.match(source, /新成员优先使用成本较低的成员模型/u)
  assert.match(source, /research: "调研与核验"/u)
  assert.match(source, /build: "开发与审查"/u)
  assert.match(source, /incident: "问题诊断"/u)
  assert.doesNotMatch(source, /inputActions\.(?:submit|send)|\.click\(\)/u)
  assert.doesNotMatch(source, /postAction\([^\n]+(?:start|spawn|message|member-stop|task-create|task-update|close)/u)
})

test('draft actions return to Chat while preserving explicit user submission', async () => {
  const source = await clientSource()
  assert.match(source, /props\.setDraft\(prompt, \{ creation: true \}\)/u)
  assert.match(source, /key: "newPeerTeam", creation: true, includeTeams: true/u)
  assert.ok(source.includes('do not ask me to design the team structure.", { creation: true, includeTeams: true }'))
  assert.match(source, /var setView = typeof props\.setView === "function" \? props\.setView : typeof props\.openView === "function" \? function \(view\) \{ props\.openView\(view\); \} : undefined;/u)
  assert.match(source, /inputActions\.setDraft\(prompt\);[\s\S]*?if \(typeof props\.setView === "function"\) props\.setView\("chat"\);/u)
  assert.doesNotMatch(source, /creationRef|observedInComposer|submittedDraftRev/u)
  assert.doesNotMatch(source, /document\.querySelector(?:All)?|\.click\(\)|history\.(?:pushState|replaceState)/u)
  const writeDraft = source.indexOf('props.inputActions.setDraft(prompt)')
  const switchView = source.indexOf('props.setView("chat")', writeDraft)
  assert.ok(writeDraft >= 0 && switchView > writeDraft, 'the draft must be stored before returning to Chat')
})

test('human-readable notices provide a safe next step without bypassing the composer', async () => {
  const source = await clientSource()
  assert.match(source, /draftOnly: "操作会写入对话输入框并切回对话，不会自动发送。"/u)
  assert.match(source, /draftSet: "已放入对话输入框。请切换到“对话”检查并发送；系统不会自动发送。"/u)
  assert.match(source, /draftOnly: "Actions write to the Chat composer and return to Chat without sending."/u)
  assert.match(source, /draftSet: "Added to the Chat composer. Switch to Chat to review and send; it will not be sent automatically."/u)
  assert.match(source, /continueTeam: "生成继续请求"/u)
  assert.match(source, /continueTeam: "Prepare continue request"/u)
  assert.match(source, /failedNext: "有成员未能完成工作。请打开成员列表查看详情，再让负责人处理未完成任务。"/u)
  assert.match(source, /failedNext: "A member could not finish its work. Open the member list for details, then ask the lead to handle unfinished tasks."/u)
  assert.match(source, /failedMembers = currentMembers\.filter\(function \(member\) \{ return memberStateKind\(member\) === "failed"/u)
  assert.match(source, /prompt\(isChinese\(\) \? "请恢复这个团队。恢复后请先检查未完成任务和成员状态，再继续工作。"/u)
  assert.match(source, /notice \? h\("div", \{ className: "dat-board-note", role: "status", "aria-live": "polite" \}/u)
  assert.match(source, /操作没有完成。请按页面提示处理后重试/u)
  assert.match(source, /The action did not finish. Follow the guidance on this page, then try again/u)
  assert.doesNotMatch(source, /postAction\([^\n]+(?:resume|team_resume)/u)
})

test('automatic mode needs only a normal goal and uses plain member labels', async () => {
  const source = await clientSource()
  assert.match(source, /启用后，你只需像平常一样描述目标/u)
  assert.match(source, /自动团队已开启/u)
  assert.match(source, /h\(EmptyTaskBoardWorkspace, \{ t: t, setDraft: setDraft, setView: props\.setView, disable: disable, busy: busy \}\)/u)
  assert.match(source, /h\(FirstTeamWizard, \{ t: t, setDraft: props\.setDraft, setView: props\.setView, disable: props\.disable, busy: props\.busy \}\)/u)
  assert.match(source, /props\.setView\("chat"\)/u)
  assert.match(source, /simpleMemberName\(member, isLead, t\)/u)
  assert.match(source, /function openAgentCatalog\(\)/u)
  assert.match(source, /成员使用“界面、测试、安全、文档”这类简短职责名/u)
  assert.match(source, /Use short duty names such as UI, Test, Security, and Docs/u)
  assert.match(source, /codePoints\.length > 24 \? codePoints\.slice\(0, 23\)\.join\(""\) \+ "…"/u)
})

test('enabled workspaces expose a safe automatic-team disable control', async () => {
  const source = await clientSource()
  assert.match(source, /disable: "关闭自动团队"/u)
  assert.match(source, /disableActiveHint: "存在活动团队时无法关闭自动团队/u)
  assert.match(source, /className: "dat-team-mode-switch"/u)
  assert.match(source, /type: "checkbox", role: "switch", checked: true, disabled: props\.busy/u)
  assert.match(source, /if \(!event\.target\.checked\) props\.disable\(\)/u)
  assert.match(source, /h\("details", \{ className: "dat-onboarding-details" \}/u)
  assert.doesNotMatch(source, /h\("details", \{ className: "dat-onboarding-details", open:/u)
  assert.match(source, /h\(DisableAutomaticTeams, \{ t: t, labelId: "dat-disable-teams", disable: disable, busy: busy, hasActive: hasActiveTeams \}\)/u)
  assert.match(source, /hasActiveTeams = teams\.some\(function \(item\) \{ return String\(item\.status \|\| item\.state \|\| ""\)\.toLowerCase\(\) !== "closed"; \}\)/u)
  assert.match(source, /disabled: props\.busy \|\| props\.hasActive/u)
  const start = source.indexOf('function disable()')
  const end = source.indexOf('var connectionKey', start)
  assert.ok(start >= 0 && end > start, 'missing isolated disable handler')
  const disableBody = source.slice(start, end)
  assert.match(disableBody, /postAuthorizedSettings\(props\.sessionId, payload\)/u)
  assert.match(disableBody, /autopilotMaxAdditionalRounds: Number\(config\.autopilotMaxAdditionalRounds\) \|\| 200/u)
  assert.match(disableBody, /setActionError/u)
  assert.match(disableBody, /fetchState\(props\.sessionId\)\.then\(function \(state\) \{ live\.setState\(state\); \}\)/u)
  assert.doesNotMatch(disableBody, /setDraft|setView|inputActions|model|submit/u)
})

test('one lead switches active teams while closed teams stay in history', async () => {
  const source = await clientSource()
  for (const marker of ['teamsFromSnapshot', 'snapshot.teams', 'snapshot.relatedTeams', 'snapshot.teamHistory', 'TeamOverview', 'activeTeams', 'archivedTeams', 'setSelectedId']) {
    assert.ok(source.includes(marker), `missing multi-team workspace marker: ${marker}`)
  }
  for (const label of ['进行中的团队', '历史团队', '切换团队或页面不会停止后台成员']) {
    assert.ok(source.includes(label), `missing multi-team localized label: ${label}`)
  }
  assert.match(source, /archivedTeams\.length \? h\("details", \{ className: "dat-disclosure" \}/u)
  assert.match(source, /目标团队：.*team_id:/u)
  assert.match(source, /event\.toTeamId === teamId\(team\)/u)
  assert.match(source, /aria-current/u)
  assert.doesNotMatch(source, /dat-cross-list|seenCrossEvents/u)
})

test('inbound cross-team delivery metadata is deduplicated in the on-demand activity sidebar', async () => {
  const source = await clientSource()
  for (const marker of ['inboundEvents', 'eventIdentity', 'pushUniqueEvent', 'seenEvents', 'drawerOpen', 'openActivityPanel']) {
    assert.ok(source.includes(marker), `missing activity sidebar marker: ${marker}`)
  }
  assert.match(source, /\(team\.inboundEvents \|\| \[\]\)\.forEach/u)
  assert.match(source, /if \(seen\[key\]\) return;/u)
  assert.match(source, /key: eventIdentity\(event, teamId\(team\)\)/u)
  assert.match(source, /event\.fromTeamName \|\| teamName\(teamsById\[event\.fromTeamId\], t\)/u)
  assert.match(source, /event\.toTeamName \|\| teamName\(teamsById\[event\.toTeamId\], t\)/u)
  assert.match(source, /role: inspectorModal \? "dialog" : "complementary"/u)
  assert.match(source, /event\.key === "Escape"/u)
})

test('workspace uses progressive disclosure instead of a permanent three-column card wall', async () => {
  const source = await clientSource()
  for (const marker of ['activeTasks', 'completedTasks', 'historyOpen', 'historyLimit', 'dat-history-list', 'dat-inspector', 'dat-inspector-open', 'actionsOpen']) {
    assert.ok(source.includes(marker), `missing progressive disclosure marker: ${marker}`)
  }
  for (const label of ['当前工作', '任务历史', '完成的任务会自动移到这里', '代理目录', '协作动态', '更多操作']) {
    assert.ok(source.includes(label), `missing progressive disclosure label: ${label}`)
  }
  assert.match(source, /toLowerCase\(\) !== "completed"/u)
  assert.match(source, /toLowerCase\(\) === "completed"/u)
  assert.match(source, /drawerOpen \? h\(React\.Fragment/u)
  assert.match(source, /actionsOpen && !props\.closed/u)
  assert.match(source, /completedTasks\.slice\(0, historyLimit\)/u)
  assert.match(source, /setHistoryLimit\(historyLimit \+ 40\)/u)
  assert.match(source, /h\("details", \{ className: "dat-disclosure dat-settings-disclosure" \}/u)
  assert.doesNotMatch(source, /dat-columns/u)
})

test('live canvas derives accessible member, task, and relationship nodes without dependencies', async () => {
  const source = await clientSource()
  for (const marker of ['TeamCanvas', 'workMode', 'dat-view-toggle', 'dat-canvas-lines', 'dat-canvas-node', 'eachBoundedRelation(task.dependsOn', 'eachBoundedRelation(task.blockedBy', 'eachBoundedRelation(task.conflictsWith']) {
    assert.ok(source.includes(marker), `missing live canvas marker: ${marker}`)
  }
  assert.match(source, /useState\("canvas"\)/u)
  assert.match(source, /useRef\(\{ scale: 1, mode: "manual", offsetX: 12, offsetY: 12 \}\)/u)
  assert.match(source, /workMode === "canvas" \? h\(TeamCanvas/u)
  assert.match(source, /task\.assigneeSessionId \|\| task\.assigneeId \|\| task\.assignee \|\| task\.memberId/u)
  assert.match(source, /completedTasks\.length\) taskNodes\.push\(\{ id: "__completed__"/u)
  assert.match(source, /markerEnd: "url\(#dat-canvas-arrow\)"/u)
  assert.match(source, /className: "dat-canvas-row dat-canvas-member-row"/u)
  assert.match(source, /className: "dat-canvas-row dat-canvas-task-row"/u)
  assert.match(source, /function buildCanvasLayout\(members, taskNodes, viewportWidth, viewportHeight\)/u)
  assert.match(source, /new ResizeObserver\(measure\)/u)
  assert.match(source, /world\.style\.transform = scale === 1 \? "" : "scale\(" \+ scale \+ "\)"/u)
  assert.match(source, /fitScale >= CANVAS_FIT_NATIVE_THRESHOLD \? 1 : fitScale/u)
  assert.match(source, /Math\.round\(\(stageWidth - scaledWidth\) \/ 2\)/u)
  assert.doesNotMatch(source, /will-change:transform/u)
  assert.match(source, /\.dat-canvas \.dat-canvas-node\{height:92px\}/u)
  assert.match(source, /\.dat-canvas-node \.dat-card-title\{font-size:14px;line-height:1\.35;font-weight:700/u)
  assert.match(source, /\.dat-canvas-node \.dat-canvas-time,\.dat-canvas-node \.dat-canvas-model\{font-size:12px;line-height:1\.35;color:var\(--dsw-alias-label-secondary\)\}/u)
  assert.match(source, /className: "dat-canvas-stage", ref: stageRef/u)
  assert.match(source, /gridTemplateColumns: "repeat\(" \+ layout\.taskColumns/u)
  assert.match(source, /role: "region", "aria-label": t\("canvasViewport"\)/u)
  assert.match(source, /role: "group", "aria-label": t\("canvasControls"\)/u)
  assert.match(source, /className: "dat-sr"[^\n]+edges\.map/u)
  assert.doesNotMatch(source, /(?:reactflow|d3|dagre|cytoscape)/iu)

  const layoutStart = source.indexOf('var CANVAS_NODE_WIDTH')
  const layoutEnd = source.indexOf('function TeamCanvas(props)', layoutStart)
  assert.ok(layoutStart >= 0 && layoutEnd > layoutStart, 'adaptive canvas helpers must precede TeamCanvas')
  const helpers = Function(`function memberId(member) { return member.id; }\nfunction taskId(task) { return task.id; }\n${source.slice(layoutStart, layoutEnd)}\nreturn { buildCanvasLayout, clampCanvasZoom, canvasEdgePoints };`)()
  const members = [{ id: 'lead' }]
  const tasks = Array.from({ length: 35 }, (_, index) => ({ id: `task-${index}` }))
  const layout = helpers.buildCanvasLayout(members, tasks, 920, 500)
  assert.equal(layout.columns, 7)
  assert.equal(Math.ceil(tasks.length / layout.taskColumns), 5)
  assert.ok(layout.width < 1500, '35 tasks should wrap instead of creating a 6k-wide row')
  assert.ok(layout.height > 326, 'world height should grow with wrapped rows')
  const positions = Object.values(layout.positions)
  assert.equal(new Set(positions.map((position) => `${position.x}:${position.y}`)).size, positions.length)
  assert.ok(positions.every((position) => position.x >= 0 && position.y >= 0 && position.x + 152 <= layout.width && position.y + 92 <= layout.height))
  const large = helpers.buildCanvasLayout(Array.from({ length: 8 }, (_, index) => ({ id: `member-${index}` })), Array.from({ length: 200 }, (_, index) => ({ id: `task-${index}` })), 900, 500)
  assert.ok(large.columns >= 10 && large.columns <= 20)
  assert.equal(Object.keys(large.positions).length, 208)
  assert.equal(helpers.clampCanvasZoom(0.01), 0.1)
  assert.equal(helpers.clampCanvasZoom(3), 2)
})

test('canvas preserves responsive, reduced-motion, history, settings, and member ordering safeguards', async () => {
  const source = await clientSource()
  assert.match(source, /function sortMembersByActivity\(members\)/u)
  assert.match(source, /memberActivityValue\(right\) - memberActivityValue\(left\)/u)
  assert.match(source, /currentMembers = sortMembersByActivity/u)
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)/u)
  assert.match(source, /@media\(max-width:900px\)/u)
  assert.match(source, /@media\(max-width:620px\)/u)
  assert.match(source, /completedTasks\.slice\(0, historyLimit\)/u)
  assert.match(source, /dat-settings-disclosure/u)
  assert.match(source, /role: "group", "aria-label": t\("currentWork"\)/u)
  assert.match(source, /onClick: props\.openMembers/u)

  const helperStart = source.indexOf('function memberActivityValue(member)')
  const helperEnd = source.indexOf('function relationIds(value)', helperStart)
  const sortMembersByActivity = Function(`function memberId(member) { return member.id; }\n${source.slice(helperStart, helperEnd)}\nreturn sortMembersByActivity`)()
  const sorted = sortMembersByActivity([
    { id: 'idle-old', state: 'idle', lastActivityAt: '2026-01-01T00:00:00Z' },
    { id: 'running-old', state: 'running', lastActivityAt: '2026-01-01T00:00:00Z' },
    { id: 'failed-new', state: 'failed', lastActivityAt: '2026-01-03T00:00:00Z' },
    { id: 'starting-new', state: 'provisioning', lastActivityAt: '2026-01-03T00:00:00Z' },
    { id: 'running-new', state: 'running', lastActivityAt: '2026-01-02T00:00:00Z' },
    { id: 'idle-new', state: 'idle', lastActivityAt: '2026-01-02T00:00:00Z' }
  ])
  assert.deepEqual(sorted.map((member) => member.id), ['starting-new', 'running-new', 'running-old', 'failed-new', 'idle-new', 'idle-old'])
})

test('settings start with automatic continuation selected and save without a pre-existing team scope', async () => {
  const source = await clientSource()
  assert.match(source, /useState\(\{ enabled: false, maxMembers: 4, maxActiveTurns: 4, autopilotEnabled: true, autopilotMaxAdditionalRounds: 200 \}\)/u)
  assert.match(source, /committedAutopilotEnabled = useRef\(true\)/u)
  assert.match(source, /budget = Number\(config\.autopilotMaxAdditionalRounds\) \|\| 200/u)
  assert.match(source, /committedAutopilotEnabled\.current = autopilotEnabled; committedAutopilotBudget\.current = budget/u)
  assert.match(source, /autopilotEnabled: autopilotEnabled, autopilotMaxAdditionalRounds: budget/u)
  assert.match(source, /settingsMaxMembers: "每个团队的成员上限"/u)
  assert.match(source, /settingsMaxActiveTurns: "同时工作的成员上限（所有团队合计）"/u)
  assert.match(source, /两项数值都是上限，不是要求 AI 固定凑满的人数/u)
  assert.match(source, /若希望最多 8 名成员同时启动，请将两项都设为 8/u)
  assert.match(source, /settingsAutopilotEnabled: "全局自动接力，不用发送“继续”"/u)
  assert.match(source, /settingsAutopilotMaxAdditionalRounds: "每个目标最多自动多做几轮"/u)
  assert.match(source, /这是全局默认/u)
  assert.match(source, /无需为每个团队重复保存/u)
  assert.match(source, /直接创建团队、提交计划或确认两阶段恢复时继承精确授权/u)
  assert.match(source, /普通 Goal 轮、状态读取和进度消息不能恢复/u)
  assert.match(source, /This is a global default/u)
  assert.match(source, /not once per team/u)
  assert.match(source, /directly create a team, commit its plan, or confirm two-phase Resume/u)
  assert.match(source, /Normal member waiting is parked; only a durable task submission, member failure, or dependency change wakes the lead/u)
  assert.match(source, /setHostAuthorization\(state\.autopilotAuthorization \|\| null\)/u)
  assert.match(source, /authorization\.pauseEpoch, authorization\.teamScopeHash/u)
  assert.match(source, /trustedAutopilotSaved = useRef\(false\)/u)
  assert.match(source, /trustedAutopilotSaved\.current = false; setLoading\(true\)/u)
  assert.match(source, /var autopilotChanged = !!values\.autopilotEnabled !== committedAutopilotEnabled\.current \|\| budget !== committedAutopilotBudget\.current/u)
  assert.match(source, /var authorizationRequired = autopilotChanged \|\| !!values\.autopilotEnabled && !trustedAutopilotSaved\.current/u)
  assert.match(source, /var payload = \{ enabled: !!values\.enabled, maxMembers: Number\(values\.maxMembers\), maxActiveTurns: Number\(values\.maxActiveTurns\) \}/u)
  assert.match(source, /if \(authorizationRequired\) \{ payload\.autopilotEnabled = !!values\.autopilotEnabled; payload\.autopilotMaxAdditionalRounds = budget; \}/u)
  assert.doesNotMatch(source, /if \(authorizationRequired && values\.autopilotEnabled && !hostAuthorization\)/u)
  assert.match(source, /if \(authorizationRequired && hostAuthorization\) payload\.hostAuthorization = hostAuthorization/u)
  assert.match(source, /settingsPromise = authorizationRequired \? postAuthorizedSettings\(sessionId, payload\) : postAction\(sessionId, "settings", payload\)/u)
  assert.match(source, /trustedAutopilotSaved\.current = !!values\.autopilotEnabled; setSaved\(true\)/u)
  assert.match(source, /hostAuthorizationCapability: authorization\.authorizationId/u)
  assert.match(source, /valid\(values\.autopilotMaxAdditionalRounds, 200\)/u)
  assert.match(source, /numberField\("dat-autopilot-max-rounds", t\("settingsAutopilotMaxAdditionalRounds"\), "autopilotMaxAdditionalRounds", 200\)/u)
  assert.match(source, /自动接力轮数请输入 1 到 200/u)
  assert.match(source, /Enter 1 to 8 for member limits and 1 to 200 for automatic continuation rounds\./u)
})

test('settings restore authoritative state after an active-team disable conflict', async () => {
  const source = await clientSource()
  assert.match(source, /error\.code = data\.code/u)
  assert.match(source, /err && err\.code === "AGENT_TEAMS_CONFLICT" \? t\("settingsCloseTeamsFirst"\)/u)
  assert.match(source, /return fetchState\(sessionId\)\.then\(applyState\)/u)
  assert.match(source, /请先在负责人会话中关闭所有活动团队/u)
})

test('switching conversation views only stops UI subscriptions, never the running team', async () => {
  const source = await clientSource()
  assert.match(source, /alive = false;\s*acceptRef\.current = function \(\) \{\};\s*closeSource\(true\);\s*pendingSnapshot = null;\s*pendingClock = null;\s*clockRef\.current = null;\s*if \(publishFrame !== null\) cancelFrame\(publishFrame\)/u)
  assert.match(source, /removeEventListener\("visibilitychange", onVisibilityChange\)/u)
  assert.doesNotMatch(source, /sessions\.(?:interrupt|stop)|team_shutdown|member-stop|postAction\([^\n]+["']close["']/u)
  assert.match(source, /Switching teams or views never stops background members/u)
})

test('Agent Teams workspace exposes tasks, events, and one unified agent catalog', async () => {
  const source = await clientSource()
  for (const marker of ['members', 'tasks', 'events', 'blockedBy', 'failedBy', 'dependencySources', 'conflictsWith', 'fileScopeProjection', 'lastActivityAt', 'agentCount', 'setSubagentCatalogOpen', 'SUBAGENT_CATALOG_EVENT']) {
    assert.ok(source.includes(marker), `missing Agent Teams workspace marker: ${marker}`)
  }
  for (const label of ['正在启动', '正在停止', '正在关闭', '代理目录', '为保护工作区信息，此页面不显示文件路径', '协作事件', '已取消']) {
    assert.ok(source.includes(label), `missing localized UX label: ${label}`)
  }
  assert.match(source, /props\.sessions\.setSubagentCatalogOpen\(team\.leadSessionId, true\)/u)
  assert.match(source, /new window\.CustomEvent\(SUBAGENT_CATALOG_EVENT, \{ detail: \{ parentSessionId: team\.leadSessionId \} \}\)/u)
  assert.match(source, /h\(ActiveTeam, \{ t: t, team: team, teams: teams, closed: closed, paused: paused, setDraft: setDraft, sessions: props\.sessions, connection: live\.connection, canRecover:/u)
  assert.match(source, /paused: "已由用户停止"|paused: "Stopped by user"/u)
  assert.doesNotMatch(source, /function MemberCard|drawerTab|setDrawerTab|sessions\.openSubagent|openSubagent\(address\)/u)
  assert.match(source, /aria-live/u)
  assert.match(source, /h\("h2", \{ className: "dat-title" \}/u)
  assert.match(source, /@media\(max-width:900px\)/u)
  assert.match(source, /@media\(max-width:620px\)/u)
})

test('failed-member recovery is automatic when safe, root-only, accessible, responsive, and never shown for normal members', async () => {
  const source = await clientSource()
  const panel = source.slice(source.indexOf('function MemberRecoveryPanel(props)'), source.indexOf('function MemberRecoveryReconcilePanel(props)'))
  assert.match(source, /function MemberRecoveryPanel\(props\)/u)
  assert.match(source, /function MemberRecoveryReconcilePanel\(props\)/u)
  assert.match(source, /recoveryRetry: "重试成员"/u)
  assert.match(source, /recoveryReplace: "替换成员"/u)
  assert.match(source, /安全且结果明确的失败会自动重试或替换，无需再次同意/u)
  assert.match(source, /safe definitive failures are retried or replaced automatically without another approval/u)
  assert.match(source, /props\.sessionId === team\.leadSessionId/u)
  assert.match(source, /memberStateKind\(member\) === "failed"/u)
  assert.doesNotMatch(panel, /role: "alertdialog"|confirmation|confirmButtonRef|event\.key === "Escape"/u)
  assert.match(panel, /"aria-busy": !!busy/u)
  assert.match(panel, /role: "status", "aria-live": "polite"/u)
  assert.match(source, /\.dat-member-recovery-actions \.dat-btn\{min-height:44px\}/u)
  assert.match(source, /\.dat-member-recovery-actions\{display:grid;grid-template-columns:1fr\}/u)
  assert.match(panel, /if \(busy \|\| requestRef\.current\) return/u)
  assert.match(panel, /requestRef\.current = requestId; setBusy\(busyKey\)/u)
  assert.match(source, /member-replace" : "member-retry"/u)
  assert.match(source, /recoveryTeams = typeof props\.onRecover === "function"/u)
  assert.match(source, /projectTeamBoard: snapshot && snapshot\.projectTeamBoard, onRecover: recoverProjectMember, onReconcile: reconcileProjectMember/u)
  assert.match(source, /team\.memberRecovery\.members/u)
  assert.match(source, /team\.memberRecovery\.unresolved/u)
  assert.match(source, /paused: team\.memberRecovery\.paused === true/u)
  assert.match(source, /props\.paused \? null : h\(Button/u)
  assert.match(source, /"member-reconcile"/u)
  assert.match(source, /requestId: receipt\.requestId/u)
  assert.match(source, /recoveryMarkDelivered: "确认已送达"/u)
  assert.match(source, /recoveryMarkNotDelivered: "Confirm not delivered"/u)
  assert.match(source, /confirm: true/u)
  assert.match(source, /failedMembers\.length && props\.canRecover \? h\(MemberRecoveryPanel/u)
  assert.doesNotMatch(source, /memberStateKind\(member\) === "(?:running|idle|ready|retired|completed)"\s*&& props\.canRecover/u)
})

test('task board keeps cancellation in history and exposes only four truthful active columns', async () => {
  const source = await clientSource()
  assert.match(source, /boardCancelled: "已取消"/u)
  assert.match(source, /if \(status === "cancelled"\) return "cancelled"/u)
  assert.match(source, /cancelledTasks\.length \? h\("details", \{ className: "dat-board-history" \}/u)
  assert.match(source, /var columns = \[\s*\{ id: "ready"[\s\S]*?\{ id: "running"[\s\S]*?\{ id: "attention"[\s\S]*?\{ id: "done"[\s\S]*?\];/u)
  assert.match(source, /repeat\(4,minmax\(0,1fr\)\)/u)
})

test('canvas exposes canonical member and task state kinds for complete status presentation', async () => {
  const source = await clientSource()
  for (const marker of ['function normalizeState(value)', 'function memberStateKind(member)', 'function taskStateKind(task)', 'data-state']) {
    assert.ok(source.includes(marker), `missing canvas state-kind marker: ${marker}`)
  }
  const helperStart = source.indexOf('function relationIds(value)')
  const helperEnd = source.indexOf('function TeamCanvas(props)')
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'canvas helpers must sit between relationIds and TeamCanvas')
  const helpers = Function(`${source.slice(helperStart, helperEnd)}\nreturn { normalizeState, memberStateKind, taskStateKind };`)()
  assert.equal(helpers.normalizeState('in-progress'), 'in_progress')
  assert.equal(helpers.normalizeState('working'), 'running')
  assert.equal(helpers.normalizeState('shutting-down'), 'shutting_down')
  assert.equal(helpers.normalizeState(''), '')
  assert.equal(helpers.memberStateKind({ state: 'working' }), 'running')
  assert.equal(helpers.memberStateKind({ status: 'provisioning' }), 'provisioning')
  assert.equal(helpers.memberStateKind({ state: 'idle' }), 'idle')
  assert.equal(helpers.memberStateKind({ state: 'retired' }), 'retired')
  assert.equal(helpers.memberStateKind({ state: 'failed' }), 'failed')
  assert.equal(helpers.memberStateKind({}), 'unknown')
  assert.equal(helpers.taskStateKind({ status: 'completed' }), 'completed')
  assert.equal(helpers.taskStateKind({ status: 'in_progress', blockedBy: ['task-2'] }), 'blocked')
  assert.equal(helpers.taskStateKind({ status: 'in_progress', blockedBy: [] }), 'in_progress')
  assert.equal(helpers.taskStateKind({ status: 'pending' }), 'pending')
  assert.equal(helpers.taskStateKind({ completedAggregate: true }), 'completed')
  assert.equal(helpers.taskStateKind({}), 'pending')
  assert.match(source, /task\.status \|\| task\.state \|\| "pending"\)\.toLowerCase\(\) !== "completed"/u)
  assert.match(source, /statesByKey\[key\] = taskStateKind\(task\)/u)
})

test('canvas animates only genuine running and transfer states and honors reduced motion', async () => {
  const source = await clientSource()
  for (const marker of ['"data-state": stateKind', 'stateKind = taskStateKind(task)', 'dat-canvas-line-flow', 'dat-canvas-live', 'dat-canvas-live-paused', 'dat-canvas-swatch', '@keyframes dat-canvas-flow', '@keyframes dat-canvas-pulse']) {
    assert.ok(source.includes(marker), `missing canvas motion marker: ${marker}`)
  }
  assert.match(source, /addEdge\(memberLookup\[String\(assigned \|\| ""\)\], target, "assigned", \(statesByKey\[target\] \|\| ""\) === "in_progress"\)/u)
  assert.match(source, /className: "dat-canvas-node dat-canvas-member", "data-state": stateKind/u)
  assert.match(source, /edge\.flow \? " dat-canvas-line-flow" : ""/u)
  assert.match(source, /\.dat-canvas-task\[data-state=in_progress\]\{/u)
  assert.match(source, /\.dat-canvas-task\[data-state=blocked\]\{/u)
  assert.match(source, /\.dat-canvas-node\[data-state=failed\] \.dat-canvas-dot\{/u)
  assert.match(source, /\.dat-canvas-node\[data-state=retired\]\{opacity:\.55\}/u)
  assert.match(source, /\.dat-canvas-node\[data-state=running\] \.dat-canvas-dot::after\{/u)
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)\{\.dat-canvas-node\{transition:none\}\.dat-canvas-member:hover\{transform:none\}\.dat-canvas-line-flow,\.dat-canvas-node\[data-state=running\] \.dat-canvas-dot::after\{animation:none\}\}/u)
  assert.match(source, /prefers-reduced-motion/u)
  assert.doesNotMatch(source, /(reactflow|d3|dagre|cytoscape|framer-motion|react-spring|gsap)/iu)
})

test('native team page pairs two desktops before enabling the real remote E2EE channel', async () => {
  const source = await clientSource()
  for (const marker of ['ProjectTeamEntry', '/api/agent-teams/project/status', '/api/agent-teams/project/action', 'create-project', 'create-invite', 'prepare-join', 'approve-join', 'complete-join', 'lan-status', 'start-lan', 'connect-lan', 'stop-lan', 'set-relay', 'connect-remote', 'disconnect-remote']) {
    assert.ok(source.includes(marker), `missing project collaboration entry marker: ${marker}`)
  }
  for (const label of ['多人连接（预览）', '仅连接预览', '同一局域网', '不在同一网络', '生成远程邀请', '加入已有团队', '生成加入请求', '批准加入', '完成加入', '端到端通道已就绪', '不会广播扫描其他设备', '本功能不会使用下载加速通道同步协作内容']) {
    assert.ok(source.includes(label), `missing project collaboration label: ${label}`)
  }
  assert.match(source, /h\(ProjectTeamEntry, \{ t: t \}\)/u)
  assert.match(source, /navigator\.clipboard\.writeText\(value\)/u)
  assert.match(source, /readOnly: true, value: inviteCode/u)
  assert.match(source, /x-harness-agent-teams/u)
  assert.match(source, /不会广播扫描其他设备；一次性批准信息会安全携带固定入口和设备凭据/u)
  assert.match(source, /中转服务只能转发加密数据，不能读取内容/u)
  assert.match(source, /The relay can forward encrypted data but cannot read its contents/u)
  assert.match(source, /run\("connect-lan", \{ host: lanHost\.trim\(\), port: Number\(lanPort\) \}\)/u)
  assert.ok(source.includes('如果负责人稍后才设置远程连接，请粘贴其提供的同一个连接地址；已经完成的配对不会丢失'), 'collaborators need an honest recovery path when relay setup follows approval')
  assert.match(source, /h\("label", \{ className: "dat-project-span" \}, h\("span", \{ className: "dat-label" \}, t\("projectRelayUrl"\)\)/u)
  assert.doesNotMatch(source, /project\.role === "owner" \? h\("label", \{ className: "dat-project-span" \}, h\("span", \{ className: "dat-label" \}, t\("projectRelayUrl"\)\)/u, 'the relay URL field must remain visible to a paired collaborator')
  assert.doesNotMatch(source, /project\.role === "owner" \? h\(Button, \{ small: true,[^\n]*run\("set-relay"/u, 'paired collaborators must be able to save a relay URL')
  assert.doesNotMatch(source, /h\("textarea", \{[^}]*projectLanKey/u, 'the UI must never render a private mTLS key field')
  assert.doesNotMatch(source, /HypoMux.*(?:import|require|script src)/iu)
})

test('task-board cards open a focused live detail while canvas nodes retain their native sidebar', async () => {
  const source = await clientSource()
  for (const marker of ['function TaskDetailFocus', 'function TaskWorkflow', 'function TaskDetailSidebar', 'function memberModelText(member, t)', 'dat-task-focus', 'dat-task-open', 'dat-canvas-task-open', 'selectedTaskId', 'selectedTask = tasks.filter', 'openTask: openTaskDetail', 'onClick: function (event) { props.openTask(event, task); }', 'props.onOpen(event, task)', 'taskDetailRef', 't("taskDetail")', 't("taskEvents")', 't("taskRef")', 't("taskDependencies")', 'memberModelText(assignee, t)', 'task.fileScopeProjection && task.fileScopeProjection.projected === false']) {
    assert.ok(source.includes(marker), `missing task detail marker: ${marker}`)
  }
  assert.match(source, /role: props\.modal \? "dialog" : "complementary"/u)
  assert.match(source, /role: inspectorModal \? "dialog" : "complementary"/u)
  assert.match(source, /"aria-modal": props\.modal \? true : undefined/u)
  assert.match(source, /hidden: !!selectedTaskId, "aria-hidden": selectedTaskId \? true : undefined, inert: selectedTaskId \? "" : undefined/u)
  assert.match(source, /inert: inspectorModal \? "" : undefined/u)
  assert.match(source, /selectedTaskId \? h\(TaskDetailFocus, \{[\s\S]*connection: props\.connection/u)
  assert.doesNotMatch(source, /dat-board-shell\.dat-inspector-open\{display:grid/u)
  assert.match(source, /memberModel: modelFor, onOpen: openTaskDetail/u)
  assert.match(source, /detail\.blockedBy\.map\(refTitle\)\.join\(", "\)/u)
  assert.match(source, /detail\.dependencies\.map\(refTitle\)\.join\(", "\)/u)
  assert.match(source, /setSelectedTaskId\(taskId\(task\)\)/u)
  assert.match(source, /setSelectedTaskId\(""\)/u)
  assert.match(source, /dat-task-events/u)
  const modelStart = source.indexOf('function memberModelText(member, t)')
  const modelEnd = source.indexOf('function taskId(task)', modelStart)
  assert.ok(modelStart >= 0 && modelEnd > modelStart, 'memberModelText must be a standalone pure helper')
  const memberModelText = Function(`${source.slice(modelStart, modelEnd)}\nreturn memberModelText`)()
  const identity = (key) => key
  const mainText = memberModelText({ model: 'gpt-4.1', modelTier: 'main', inheritsMain: true }, identity)
  assert.ok(mainText.includes('gpt-4.1') && mainText.includes('mainModel') && mainText.includes('inheritsMain'), `unexpected model text: ${mainText}`)
  assert.equal(memberModelText({ modelTier: 'subagent' }, identity), 'subagentModel')
  assert.equal(memberModelText({}, identity), '')
})

test('completed task cards and detail surfaces show the member result to the user', async () => {
  const source = await clientSource()
  for (const marker of ['function visibleTaskResult(task)', 'function taskResultPreviewText(result, limit)', 'dat-task-result-preview', 'dat-board-card-result', 'dat-task-result-text', 't("taskResult")', 't("taskResultPreview")', 'taskResult: "成员成果"', 'taskResultPreview: "已提交成果"', 'taskResult: "Member result"']) {
    assert.ok(source.includes(marker), `missing member result marker: ${marker}`)
  }
  assert.match(source, /visibleTaskResult\(runtimeDetail\) \|\| visibleTaskResult\(task\)/u)
  assert.match(source, /taskResult \? h\("section", \{ className: "dat-task-focus-surface dat-task-result"/u)
  assert.match(source, /visibleTaskResult\(task\) \? h\("div", \{ className: "dat-board-card-result"/u)
  const helperStart = source.indexOf('    function visibleTaskResult(task)')
  const helperEnd = source.indexOf('    function TaskCard(props)', helperStart)
  const helpers = Function(`${source.slice(helperStart, helperEnd)}\nreturn { visibleTaskResult, taskResultPreviewText }`)()
  assert.equal(helpers.visibleTaskResult({ result: { text: 'Visible result', truncated: false } }).text, 'Visible result')
  assert.equal(helpers.visibleTaskResult({ result: { text: '   ' } }), null)
  assert.equal(helpers.taskResultPreviewText({ text: '123456' }, 4), '1234…')
})

test('responsibility and closure projections never infer delivery or success from assignment and closed state', async () => {
  const source = await clientSource()
  const helperStart = source.indexOf('    function taskResponsibilityProjection(task)')
  const helperEnd = source.indexOf('    function TaskCard(props)', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'truthful responsibility helpers must remain independently testable')
  const helpers = Function(`function normalizeState(value) { return String(value || '').toLowerCase().replace(/-/g, '_'); }\nfunction visibleTaskResult(task) { var result = task && task.result; return result && typeof result.text === 'string' && result.text.trim() ? result : null; }\n${source.slice(helperStart, helperEnd)}\nreturn { taskResponsibilityProjection, teamClosureProjection };`)()

  const unsubmitted = helpers.taskResponsibilityProjection({
    id: 'task', status: 'completed', assigneeSessionId: 'assigned-worker'
  })
  assert.equal(unsubmitted.assignedId, 'assigned-worker')
  assert.equal(unsubmitted.executorId, '', 'the original assignee is not evidence of actual execution')
  assert.equal(unsubmitted.deliveryKind, 'missing_completed')
  assert.equal(unsubmitted.acceptanceKind, 'missing_completed')

  const delivered = helpers.taskResponsibilityProjection({
    id: 'task', status: 'completed', assigneeSessionId: 'assigned-worker',
    submission: { submittedBy: 'actual-worker', source: 'explicit_complete' },
    acceptance: { acceptedBy: 'lead' }
  })
  assert.equal(delivered.executorId, 'actual-worker')
  assert.equal(delivered.takeover, true)
  assert.equal(delivered.deliveryKind, 'submitted')
  assert.equal(delivered.acceptanceKind, 'accepted')

  const legacy = helpers.taskResponsibilityProjection({
    id: 'legacy-task', status: 'completed', assigneeSessionId: 'legacy-assignee',
    submission: { submittedBy: 'legacy-assignee', source: 'legacy_migration' },
    acceptance: { acceptedBy: 'lead' }, result: { text: 'legacy text', reportedBy: 'legacy-assignee' }
  })
  assert.equal(legacy.legacy, true)
  assert.equal(legacy.executorId, '', 'legacy assignee and synthesized receipts are not current execution proof')
  assert.equal(legacy.takeover, false)
  assert.equal(legacy.deliveryKind, 'legacy')
  assert.equal(legacy.acceptanceKind, 'legacy')

  const released = helpers.taskResponsibilityProjection({
    id: 'released-task', status: 'pending', assigneeSessionId: 'former-assignee',
    releasedAt: '2026-08-28T15:00:00.000Z', releaseReason: 'Host released stale ownership'
  })
  assert.equal(released.release.at, '2026-08-28T15:00:00.000Z')
  assert.equal(released.release.reason, 'Host released stale ownership')
  assert.equal(released.executorId, '', 'release history must not promote the former assignee to actual executor')
  assert.equal(released.takeover, false, 'release alone is not a successful takeover or delivery')
  assert.equal(released.deliveryKind, 'missing')
  assert.equal(released.acceptanceKind, 'not_applicable')

  const cancelled = helpers.taskResponsibilityProjection({
    id: 'cancelled-task', status: 'cancelled', assigneeSessionId: 'former-assignee',
    cancelledAt: '2026-08-28T15:05:00.000Z', cancellationReason: 'Lead cancelled the objective'
  })
  assert.deepEqual(cancelled.cancellation, { at: '2026-08-28T15:05:00.000Z', reason: 'Lead cancelled the objective' })
  assert.equal(cancelled.cancelled, true)
  assert.equal(cancelled.executorId, '', 'cancellation must not infer execution from assignment')
  assert.equal(cancelled.takeover, false)
  assert.equal(cancelled.deliveryKind, 'missing')
  assert.equal(cancelled.acceptanceKind, 'not_applicable')

  assert.deepEqual(helpers.teamClosureProjection({ status: 'closed', closure: { outcome: 'cancelled', cancelledTaskIds: ['a', 'b'], failures: [] } }), {
    closure: { outcome: 'cancelled', cancelledTaskIds: ['a', 'b'], failures: [] }, outcome: 'cancelled', cancelledCount: 2, failureCount: 0
  })
  assert.equal(helpers.teamClosureProjection({ status: 'closed' }).outcome, 'unknown', 'closed alone must never be projected as succeeded')
  assert.equal(helpers.teamClosureProjection({ status: 'closed', closureOutcome: 'succeeded' }).outcome, 'unknown', 'closureOutcome without a complete receipt is not success proof')
  assert.equal(helpers.teamClosureProjection({ status: 'closed', taskCount: 0, tasks: [], closure: { outcome: 'succeeded', cancelledTaskIds: [], failures: [] } }).outcome, 'unknown', 'an empty team cannot be presented as successful objective delivery')
  assert.ok(source.includes('h(ResponsibilityPanel, { t: t, task: task, members: props.members'))
  assert.match(source, /closed \? h\(TeamClosureBanner/u)
  assert.match(source, /data-outcome": truth\.outcome/u)
  assert.ok(source.includes('className: "dat-legacy-record", role: "note", "data-provenance": "legacy_migration"'))
  assert.ok(source.includes('"data-provenance": truth.legacy ? "legacy_migration" : "current"'))
  assert.ok(source.includes('actualExecutorLegacy'))
  assert.ok(source.includes('legacyRecordTitle: "旧迁移记录（未经当前证明）"'))
  assert.match(source, /className: "dat-responsibility-event", "data-kind": "released"[\s\S]*releaseReasonLabel[\s\S]*dateTime: String\(truth\.release\.at\)/u)
  assert.match(source, /className: "dat-responsibility-event", "data-kind": "cancelled"[\s\S]*cancellationReasonLabel[\s\S]*dateTime: String\(truth\.cancellation\.at\)/u)
  assert.match(source, /className: "dat-board-card-facts", role: "note", "data-kind": "released"[\s\S]*truth\.release\.reason/u)
  assert.match(source, /className: "dat-board-card-facts", role: "note", "data-kind": "cancelled"[\s\S]*truth\.cancellation/u)
  assert.ok(source.includes('releaseReasonLabel: "释放原因"'))
  assert.ok(source.includes('releasedAtLabel: "释放时间"'))
  assert.ok(source.includes('cancellationReasonLabel: "取消原因"'))
  assert.ok(source.includes('cancelledAtLabel: "取消时间"'))
  assert.ok(source.includes('团队已关闭，但结果是取消，不等同于成功。'))
  assert.ok(source.includes('The team is closed, but its outcome is cancellation—not success.'))
  assert.ok(source.includes('团队被强制关闭；未完成工作不得视为成功。'))
  assert.ok(source.includes('The team was force closed. Unfinished work must not be treated as success.'))
  assert.ok(source.includes('团队没有任何任务交付，成功 receipt 不会在此显示为目标交付成功。'))
  assert.ok(source.includes('The team has no task delivery, so a success receipt is not presented as successful objective delivery here.'))
  assert.ok(source.includes('合成验收也不是当前负责人审查证据'))
  assert.ok(source.includes('synthesized acceptance is not evidence of current lead review'))
  assert.match(source, /var closed = !!\(team && String\(team\.status \|\| team\.state \|\| ""\)\.toLowerCase\(\) === "closed"\)/u)
  assert.match(source, /!props\.closed && team\.closure \? h\(TeamClosureBanner, \{ t: t, team: team \}\) : null/u)
  assert.match(source, /props\.closed \? h\(TeamClosureBanner, \{ t: t, team: team \}/u)
})

test('client cancellation copy and rendering stay generic instead of inventing a lead-specific actor', async () => {
  const source = await clientSource()
  assert.equal(source.includes('taskCancelledByLead'), false)
  assert.ok(source.includes('taskCancelled: "任务已取消；这不是成功完成"'))
  assert.ok(source.includes('taskCancelled: "Task cancelled; this is not successful completion"'))
  assert.ok(source.includes('responsibilityFacts: "责任事实"'))
  assert.ok(source.includes('responsibilityFacts: "Responsibility facts"'))

  const responsibilityStart = source.indexOf('    function ResponsibilityPanel(props)')
  const responsibilityEnd = source.indexOf('    function teamExplicitlyEmpty(team)', responsibilityStart)
  const responsibilitySource = source.slice(responsibilityStart, responsibilityEnd)
  assert.match(responsibilitySource, /truth\.cancelled \? h\("p", \{ className: "dat-responsibility-alert", role: "note" \}, t\("taskCancelled"\)\) : null/u)
  assert.doesNotMatch(responsibilitySource, /truth\.cancelled[^\n]+leadSessionId|leadSessionId[^\n]+truth\.cancelled/u)

  const boardStart = source.indexOf('    function BoardTaskCard(props)')
  const boardEnd = source.indexOf('    function cancelledHistoryProjection(t)', boardStart)
  const boardSource = source.slice(boardStart, boardEnd)
  assert.match(boardSource, /truth\.cancelled \? h\("div", \{ className: "dat-board-card-facts", role: "note", "data-kind": "cancelled" \}, h\("strong", null, t\("taskCancelled"\)\)/u)
  assert.doesNotMatch(boardSource, /truth\.cancelled[^\n]+leadSessionId|leadSessionId[^\n]+truth\.cancelled/u)
})

test('legacy storage migration reaches the client without inventing an executor or current lead review', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-legacy-ui-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const timestamp = new Date().toISOString()
  const legacy = {
    version: 5,
    settings: { enabled: true, maxMembers: 4, maxActiveTurns: 4 },
    teams: [{
      id: 'legacy-ui-team', rootLeadSessionId: 'legacy-lead', name: 'Legacy UI', objective: 'Preserve history without inventing proof', revision: 1,
      state: 'closed', createdAt: timestamp, updatedAt: timestamp,
      members: [
        { id: 'legacy-lead-id', sessionId: 'legacy-lead', name: 'Lead', role: 'root lead and coordinator', kind: 'lead', state: 'ready', createdAt: timestamp, updatedAt: timestamp },
        { id: 'legacy-worker-id', sessionId: 'legacy-worker', name: 'Worker', role: 'legacy worker', kind: 'worker', state: 'retired', createdAt: timestamp, updatedAt: timestamp }
      ],
      tasks: [{
        id: 'legacy-ui-task', title: 'Legacy completed task', state: 'completed', dependsOn: [], files: [],
        assigneeSessionId: 'legacy-worker', createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp
      }],
      messages: []
    }]
  }
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
    const mod = await import(`${pathToFileURL(pluginFile).href}?legacy-ui=${Date.now()}-${Math.random()}`)
    const store = new mod.AgentTeamsStore(file)
    await store.init()
    const snapshot = store.snapshot()
    const migratedTeam = snapshot.teams[0]
    const migratedTask = migratedTeam.tasks[0]
    assert.equal(migratedTask.state, 'cancelled')
    assert.equal(migratedTask.submission, undefined, 'closed projection does not masquerade as accepted delivery')
    assert.equal(migratedTask.acceptance, undefined, 'migration must not invent Host acceptance')
    assert.equal(migratedTask.lifecycleLedger.some(event => event.kind === 'submission' && event.actorId === 'legacy-worker'), true)
    assert.equal(migratedTeam.closure.outcome, 'forced')
    assert.equal(migratedTeam.closure.forced, true)
    assert.match(migratedTeam.closure.reason, /unverified legacy completion/u)
    assert.deepEqual(migratedTeam.closure.cancelledTaskIds, ['legacy-ui-task'])
    assert.deepEqual(migratedTeam.closure.failures, [])

    const hostProjectedTask = mod.teamSnapshot(snapshot, 'legacy-lead', 'legacy-ui-team').team.tasks[0]
    assert.equal(hostProjectedTask.lifecycleLedger.some(event => event.kind === 'submission'), true)
    const source = await clientSource()
    const helperStart = source.indexOf('    function taskResponsibilityProjection(task)')
    const helperEnd = source.indexOf('    function TaskCard(props)', helperStart)
    const helpers = Function(`function normalizeState(value) { return String(value || '').toLowerCase().replace(/-/g, '_'); }\nfunction visibleTaskResult(task) { var result = task && task.result; return result && typeof result.text === 'string' && result.text.trim() ? result : null; }\n${source.slice(helperStart, helperEnd)}\nreturn { taskResponsibilityProjection };`)()
    const truth = helpers.taskResponsibilityProjection(hostProjectedTask)
    assert.equal(truth.legacy, false)
    assert.equal(truth.assignedId, '', 'terminal cancellation projection does not retain a current claimant')
    assert.equal(truth.executorId, '', 'migrated assignee is not actual executor evidence')
    assert.equal(truth.takeover, false)
    assert.equal(truth.deliveryKind, 'missing')
    assert.equal(truth.acceptance, null, 'client projection must not expose acceptance or review proof')
    assert.equal(truth.acceptanceKind, 'not_applicable')
    assert.equal(truth.cancelled, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('submitted and immutable lifecycle history are accessible in task detail', async () => {
  const source = await clientSource()
  assert.match(source, /submitted: "Awaiting lead acceptance"/u)
  assert.match(source, /lifecycleHistory: "Immutable lifecycle history"/u)
  assert.match(source, /Array\.isArray\(task\.lifecycleLedger\)/u)
  assert.match(source, /h\("details", \{ className: "dat-lifecycle-history" \}/u)
  assert.match(source, /h\("time", \{ dateTime: event\.at \}/u)
})

test('real cancel and release transitions survive Host projection and drive client responsibility truth', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-markers-ui-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const lead = { id: 'marker-ui-lead' }
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?marker-ui=${Date.now()}-${Math.random()}`)
    const store = new mod.AgentTeamsStore(file)
    await store.init()
    await store.mutate(document => { document.settings.enabled = true })
    const team = await mod.createTeam(store, lead, { objective: 'Project real cancellation and release markers' })
    const releaseTask = (await mod.createTask(store, lead, { teamId: team.id, title: 'Release through the Host' })).task
    const cancelTask = (await mod.createTask(store, lead, { teamId: team.id, title: 'Cancel through the Host' })).task
    await store.mutate(document => {
      const current = document.teams.find(candidate => candidate.id === team.id)
      const timestamp = new Date().toISOString()
      current.members.push(
        { id: 'marker-worker-id', sessionId: 'marker-worker', name: 'Former', role: 'marker audit', kind: 'worker', state: 'ready', createdAt: timestamp, updatedAt: timestamp },
        { id: 'marker-next-id', sessionId: 'marker-next', name: 'Next', role: 'completion audit', kind: 'worker', state: 'ready', createdAt: timestamp, updatedAt: timestamp }
      )
      const material = {
        objective: current.objective,
        tasks: current.tasks.map(task => ({
          id: task.id, title: task.title, description: task.description, dependsOn: task.dependsOn,
          crossTeamDependsOn: task.crossTeamDependsOn || [], files: task.files || [], capabilities: task.capabilities || [],
          externalEffects: (task.externalEffects || []).map(effect => ({ name: effect.name, policy: effect.policy, idempotencyKey: effect.idempotencyKey }))
        }))
      }
      const hash = createHash('sha256').update(JSON.stringify(material)).digest('hex')
      current.plan = {
        phase: 'active', revision: current.plan?.revision || 1, hash, committedAt: timestamp, activatedAt: timestamp, migrationState: 'ready',
        authorization: { source: 'human_attested', attestedAt: timestamp, confirmedPlanHash: hash, permissions: 'unknown', files: 'unknown', cost: 'unknown', externalSideEffects: 'unknown' }
      }
      current.updatedAt = timestamp
    })

    const claim = (await mod.updateTask(store, { id: 'marker-worker' }, { teamId: team.id, taskId: releaseTask.id, action: 'claim' })).task
    const released = (await mod.updateTask(store, { id: 'marker-worker' }, { teamId: team.id, taskId: releaseTask.id, action: 'release', claimId: claim.claimId, leaseEpoch: claim.leaseEpoch })).task
    await mod.updateTask(store, lead, { teamId: team.id, taskId: releaseTask.id, action: 'assign', assigneeSessionId: 'marker-next' })
    const beforeNextClaim = mod.teamSnapshot(store.snapshot(), lead.id, team.id).team
    assert.equal(beforeNextClaim.attention.codes.includes('released_task'), false)
    assert.equal(beforeNextClaim.attention.required, false)
    const nextClaim = (await mod.updateTask(store, { id: 'marker-next' }, { teamId: team.id, taskId: releaseTask.id, action: 'claim' })).task
    const completed = (await mod.updateTask(store, { id: 'marker-next' }, { teamId: team.id, taskId: releaseTask.id, action: 'complete', claimId: nextClaim.claimId, leaseEpoch: nextClaim.leaseEpoch })).task
    assert.equal(completed.acceptance, undefined)
    await mod.updateTask(store, lead, { teamId: team.id, taskId: releaseTask.id, action: 'accept' })
    await mod.updateTask(store, lead, { teamId: team.id, taskId: cancelTask.id, action: 'cancel' })

    const source = await clientSource()
    const helperStart = source.indexOf('    function taskResponsibilityProjection(task)')
    const helperEnd = source.indexOf('    function TaskCard(props)', helperStart)
    function h(type, props, ...children) {
      if (typeof type === 'function') return type({ ...(props || {}), children })
      return { type, props: props || {}, children }
    }
    const helpers = Function('h', `function normalizeState(value) { return String(value || '').toLowerCase().replace(/-/g, '_'); }\nfunction visibleTaskResult() { return null; }\nfunction memberSession(member) { return member && member.sessionId || ''; }\nfunction memberId(member) { return member && member.id || ''; }\nfunction simpleMemberName(member) { return member && (member.displayName || member.name) || ''; }\nfunction formatTime(value) { return String(value || ''); }\n${source.slice(helperStart, helperEnd)}\nreturn { taskResponsibilityProjection, ResponsibilityPanel };`)(h)
    const beforeNextClaimTask = beforeNextClaim.tasks.find(task => task.id === releaseTask.id)
    const beforePanel = helpers.ResponsibilityPanel({ task: beforeNextClaimTask, members: beforeNextClaim.members, leadSessionId: lead.id, t: key => key })
    const panelNodes = []
    ;(function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; panelNodes.push(node); visit(node.children) })(beforePanel)
    assert.equal(beforePanel.props['data-status'], 'pending', 'release audit plus a new assignment must not render as current attention before claim')
    assert.ok(panelNodes.some(node => node.props && node.props['data-kind'] === 'released'), 'release audit remains rendered')

    const acceptedSnapshot = mod.teamSnapshot(store.snapshot(), lead.id, team.id).team
    assert.equal(acceptedSnapshot.attention.codes.includes('released_task'), false)
    assert.equal(acceptedSnapshot.attention.required, false)
    let hostTasks = acceptedSnapshot.tasks
    const projectedRelease = hostTasks.find(task => task.id === releaseTask.id)
    const releaseHistory = projectedRelease.interruptionHistory.filter(entry => entry.kind === 'released')
    assert.equal(releaseHistory.at(-1).at, released.releasedAt)
    assert.equal(projectedRelease.releasedAt, released.releasedAt)
    assert.equal(projectedRelease.releaseReason, released.releaseReason)
    assert.equal(projectedRelease.assigneeSessionId, 'marker-next')
    assert.equal(projectedRelease.submission.submittedBy, 'marker-next')
    assert.equal(projectedRelease.acceptance.acceptedBy, lead.id)
    const releaseTruth = helpers.taskResponsibilityProjection(projectedRelease)
    assert.deepEqual(releaseTruth.release, { at: released.releasedAt, reason: released.releaseReason })
    assert.equal(releaseTruth.executorId, 'marker-next')
    assert.equal(releaseTruth.executorId === 'marker-worker', false, 'the former assignee is not treated as the actual executor')
    assert.equal(releaseTruth.takeover, false)
    assert.equal(releaseTruth.acceptanceKind, 'accepted')
    const acceptedPanel = helpers.ResponsibilityPanel({ task: projectedRelease, members: acceptedSnapshot.members, leadSessionId: lead.id, t: key => key })
    assert.equal(acceptedPanel.props['data-status'], 'accepted')

    const projectedCancellation = hostTasks.find(task => task.id === cancelTask.id)
    const cancellationTruth = helpers.taskResponsibilityProjection(projectedCancellation)
    assert.equal(cancellationTruth.cancelled, true)
    assert.deepEqual(cancellationTruth.cancellation, { at: projectedCancellation.cancelledAt, reason: 'cancelled explicitly by the team lead' })
    await mod.updateTask(store, lead, { teamId: team.id, taskId: cancelTask.id, action: 'reopen' })
    hostTasks = mod.teamSnapshot(store.snapshot(), lead.id, team.id).team.tasks
    const reopened = hostTasks.find(task => task.id === cancelTask.id)
    assert.equal(reopened.cancelledAt, undefined)
    assert.equal(reopened.cancellationReason, undefined)
    assert.equal(helpers.taskResponsibilityProjection(reopened).cancellation, null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('real failed shutdown receipt reaches the client as an open failed closure, never forced success', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-failed-ui-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const lead = { id: 'failed-ui-lead' }
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?failed-ui=${Date.now()}-${Math.random()}`)
    const store = new mod.AgentTeamsStore(file)
    await store.init()
    await store.mutate(document => { document.settings.enabled = true })
    const team = await mod.createTeam(store, lead, { objective: 'Project a real failed shutdown receipt' })
    const timestamp = new Date().toISOString()
    await store.mutate(document => {
      document.teams.find(candidate => candidate.id === team.id).members.push({
        id: 'failed-ui-worker-id', sessionId: 'failed-ui-worker', name: 'Worker', role: 'refusal audit',
        kind: 'worker', state: 'ready', createdAt: timestamp, updatedAt: timestamp
      })
    })
    const ctx = {
      agents: { get: id => id === lead.id ? lead : undefined, roots: () => [lead] },
      subagents: { followup: async () => { throw new Error('worker refusal') } }
    }
    const admission = { run: async (_lead, _childId, _signal, operation) => operation() }
    const shutdown = await mod.shutdownTeam(ctx, store, admission, lead, { teamId: team.id }, new AbortController().signal)
    assert.equal(shutdown.team.state, 'active')
    assert.equal(shutdown.team.closure.outcome, 'failed')
    assert.equal(shutdown.team.closure.closedAt, undefined)
    assert.equal(shutdown.failures.length, 1)

    const hostTeam = mod.teamSnapshot(store.snapshot(), lead.id, team.id).team
    assert.equal(hostTeam.status, 'active')
    assert.equal(hostTeam.closure.outcome, 'failed')
    const source = await clientSource()
    const helperStart = source.indexOf('    function taskResponsibilityProjection(task)')
    const helperEnd = source.indexOf('    function TaskCard(props)', helperStart)
    const helpers = Function(`function normalizeState(value) { return String(value || '').toLowerCase().replace(/-/g, '_'); }\nfunction visibleTaskResult() { return null; }\n${source.slice(helperStart, helperEnd)}\nreturn { teamClosureProjection };`)()
    const truth = helpers.teamClosureProjection(hostTeam)
    assert.equal(truth.outcome, 'failed')
    assert.equal(truth.failureCount, 1)
    assert.equal(truth.closure.closedAt, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('blocked task detail tolerates real dependency data and stale selections without blanking the workspace', async () => {
  const source = await clientSource()
  const helperStart = source.indexOf('    function arrayText(value)')
  const helperEnd = source.indexOf('    var CANVAS_NODE_WIDTH', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'task detail safety helpers must remain independently testable')
  const helpers = Function(`${source.slice(helperStart, helperEnd)}\nreturn { safeTaskDetail, taskWorkflowProjection }`)()
  const safeTaskDetail = helpers.safeTaskDetail
  const blocked = {
    id: '264a877c-f00a-48b1-a045-857f4ce06b06',
    title: '修复堵塞任务点击白屏',
    status: 'in_progress',
    blockedBy: [{ taskId: 'daa0a1b3-d9ac-4481-b5a1-a335c10ed469' }, 'd0df54d7-1fb7-4879-be9b-00447f4cb54d'],
    dependencies: ['daa0a1b3-d9ac-4481-b5a1-a335c10ed469'],
    dependencySources: [{ teamId: 'peer-team', teamStatus: 'active' }],
    assigneeSessionId: 'member-ui',
    attention: { kind: 'blocked' }
  }
  assert.deepEqual(safeTaskDetail(blocked), {
    task: blocked,
    stateKind: 'blocked',
    filesText: '',
    blockedBy: ['daa0a1b3-d9ac-4481-b5a1-a335c10ed469', 'd0df54d7-1fb7-4879-be9b-00447f4cb54d'],
    failedBy: [],
    conflicts: [],
    dependencies: ['daa0a1b3-d9ac-4481-b5a1-a335c10ed469'],
    reason: ''
  })
  assert.doesNotThrow(() => safeTaskDetail({ id: 'partial', status: 'in_progress', blockedBy: [null, { id: 'dependency' }], dependencies: 'dependency', dependencySources: null }))
  assert.equal(safeTaskDetail(null), null)
  assert.equal(safeTaskDetail({ id: 'waiting', status: 'pending', blockedBy: ['dependency'] }).stateKind, 'blocked')
  const blockedWorkflow = helpers.taskWorkflowProjection({ ...blocked, createdAt: '2026-08-24T09:00:00Z', claimedAt: '2026-08-24T09:05:00Z', updatedAt: '2026-08-24T09:10:00Z' })
  assert.equal(blockedWorkflow.currentState, 'blocked')
  assert.equal(blockedWorkflow.nextKey, 'blockedTaskNext')
  assert.deepEqual(blockedWorkflow.stages.map((stage) => stage.state), ['reached', 'current', 'upcoming'])
  const completedWorkflow = helpers.taskWorkflowProjection({ id: 'done', status: 'completed', createdAt: '2026-08-24T09:00:00Z', completedAt: '2026-08-24T09:20:00Z' })
  assert.deepEqual(completedWorkflow.stages.map((stage) => stage.state), ['reached', 'unknown', 'current'])
  assert.equal(completedWorkflow.nextKey, 'taskNextCompleted')
  assert.match(source, /var t = props\.t, detail = safeTaskDetail\(props\.task\), task = detail && detail\.task/u)
  assert.match(source, /if \(selectedTaskId && !selectedTask\) \{ setSelectedTaskId\(""\); set(?:Task)?SelectionNotice\(t\("taskSelectionExpired"\)\); \}/u)
  assert.match(source, /stateKind === "blocked"[\s\S]*t\("blockedTaskReason"\)[\s\S]*t\("blockedTaskNext"\)/u)
  assert.ok(source.includes('任务信息刚刚更新，原详情已关闭。请从当前任务列表重新选择。'))
})

test('task detail refreshes from the shared SSE snapshot and stays keyboard accessible', async () => {
  const source = await clientSource()
  const focusedStart = source.indexOf('    function TaskDetailFocus(')
  const focused = source.slice(focusedStart, source.indexOf('    function WorkspaceNav(', focusedStart))
  const boardStart = source.indexOf('    function TaskBoardWorkspace(')
  const board = source.slice(boardStart, source.indexOf('    function EmptyTaskBoardWorkspace(', boardStart))
  assert.match(source, /selectedTaskId \? h\(React\.Fragment/u)
  assert.match(focused, /role: "region", tabIndex: -1/u)
  assert.match(focused, /events\.slice\(0, eventLimit\)/u)
  assert.match(focused, /eventLimit = 30/u)
  assert.match(focused, /t\("taskLiveEvents"\)/u)
  assert.match(board, /var onKey = function \(event\) \{ if \(event\.key === "Escape"\)/u)
  assert.match(board, /restoreFocusRef\.current = true; setSelectedTaskId\(""\)/u)
  assert.match(source, /if \(event\.key === "Escape"\) \{ event\.preventDefault\(\); event\.stopPropagation\(\); if \(drawerOpen\) closePanel\(\); else closeTaskDetail\(\); \}/u)
  assert.match(source, /tabIndex: -1, ref: props\.detailRef/u)
  assert.match(source, /focusTarget = drawerOpen \? drawerRef\.current : taskDetailRef\.current/u)
  assert.match(source, /function trapInspectorTab\(event, element\)/u)
  assert.match(source, /function useInspectorModal\(elementRef, open\)/u)
  assert.match(source, /style\.position !== "fixed"/u)
  assert.match(source, /!element\.contains\(active\)/u)
  assert.match(source, /else trapInspectorTab\(event, focusTarget\)/u)
  assert.match(source, /"aria-labelledby": "dat-task-detail-title"/u)
  assert.match(source, /setDrawerOpen\(false\); setSelectedTaskId\(""\); setTaskSelectionNotice\(""\); \}, \[teamId\(team\), props\.closed\]\)/u)
  assert.match(source, /events\.filter\(function \(event\) \{ return eventRelatesToTask\(event, selectedTask\); \}\)/u)
  assert.match(source, /function eventRelatesToTask\(event, task\)/u)
  assert.match(source, /t\("taskDetailUnavailable"\)/u)
  assert.doesNotMatch(source, /(reactflow|d3|dagre|cytoscape|framer-motion|react-spring|gsap)/iu)
})

test('fixed inspectors contain keyboard focus while sticky desktop sidebars stay non-modal', async () => {
  const source = await clientSource()
  const start = source.indexOf('    function trapInspectorTab(event, element)')
  const end = source.indexOf('    function useInspectorModal(elementRef, open)', start)
  assert.ok(start >= 0 && end > start, 'focus helper must remain independently testable')

  let active
  const first = { hidden: false, closest: () => null, focus: () => { active = first } }
  const last = { hidden: false, closest: () => null, focus: () => { active = last } }
  const outside = {}
  const element = {
    ownerDocument: { get activeElement() { return active } },
    querySelectorAll: () => [first, last],
    contains: (node) => node === element || node === first || node === last,
    focus: () => { active = element }
  }
  const fakeWindow = { getComputedStyle: (node) => node === element ? { position: 'fixed', display: 'block', visibility: 'visible' } : { display: 'block', visibility: 'visible' } }
  const trapInspectorTab = Function('window', `${source.slice(start, end)}\nreturn trapInspectorTab`)(fakeWindow)
  const key = (shiftKey = false) => ({ key: 'Tab', shiftKey, prevented: false, preventDefault() { this.prevented = true } })

  active = outside
  const fromOutside = key()
  trapInspectorTab(fromOutside, element)
  assert.equal(fromOutside.prevented, true)
  assert.equal(active, first)

  active = last
  const wrapsForward = key()
  trapInspectorTab(wrapsForward, element)
  assert.equal(wrapsForward.prevented, true)
  assert.equal(active, first)

  active = first
  const wrapsBackward = key(true)
  trapInspectorTab(wrapsBackward, element)
  assert.equal(wrapsBackward.prevented, true)
  assert.equal(active, last)

  fakeWindow.getComputedStyle = () => ({ position: 'sticky', display: 'block', visibility: 'visible' })
  active = outside
  const desktopTab = key()
  trapInspectorTab(desktopTab, element)
  assert.equal(desktopTab.prevented, false)
  assert.equal(active, outside)
})
