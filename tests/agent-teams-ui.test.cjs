const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const clientFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'client.js')

async function clientSource() {
  return readFile(clientFile, 'utf8')
}

test('Agent Teams owns a native conversation view without a duplicate modal or dock', async () => {
  const source = await clientSource()
  assert.match(source, /window\.__ModuleLoader__\.load/u)
  assert.match(source, /ctx\.slots\.inject\("conversation\.view"/u)
  assert.match(source, /name: "conversation\.view", id: "agent-teams"/u)
  assert.doesNotMatch(source, /conversation\.session\.header\.actions/u)
  assert.doesNotMatch(source, /conversation\.input\.dock/u)
  assert.doesNotMatch(source, /dat-overlay|dat-modal|role:\s*["']dialog["']/u)
  assert.match(source, /\/api\/agent-teams\/state/u)
  assert.match(source, /\/api\/agent-teams\/events/u)
  assert.match(source, /x-harness-agent-teams/iu)
  assert.match(source, /title: "代理团队"/u)
  assert.match(source, /settingsTitle: "代理团队"/u)
  assert.match(source, /EventSource/u)
  assert.doesNotMatch(source, /https?:\/\//u)
})

test('Agent Teams coalesces snapshots and recovers SSE without synchronized polling storms', async () => {
  const source = await clientSource()
  assert.match(source, /function teamSnapshotVersion\(snapshot\)/u)
  assert.match(source, /version === versionRef\.current/u)
  assert.match(source, /requestAnimationFrame === "function" \? requestAnimationFrame\(work\) : setTimeout\(work, 16\)/u)
  assert.match(source, /publishFrame = requestFrame\(flushSnapshot\)/u)
  assert.match(source, /startTransition\(function \(\) \{ if \(alive\) \{ setState\(next\); setError\(""\); \} \}\)/u)
  assert.match(source, /document\.visibilityState === "hidden"/u)
  assert.match(source, /addEventListener\("visibilitychange", onVisibilityChange\)/u)
  assert.match(source, /if \(loadPromise\) return loadPromise/u)
  assert.match(source, /Math\.min\(30000, 4000 \* Math\.pow\(2, Math\.min\(pollAttempt, 3\)\)\)/u)
  assert.match(source, /Math\.random\(\) \* 0\.4/u)
  assert.match(source, /Native EventSource keeps reconnecting/u)
  assert.doesNotMatch(source, /setInterval\(/u)
  assert.doesNotMatch(source, /source\.onerror = function \(\) \{[^}]*source\.close\(\)/u)
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
  assert.match(source, /负责人\/大脑始终保持主模型/u)
  assert.match(source, /普通成员默认使用子代理模型来节省消耗/u)
  assert.match(source, /同一负责人创建多个同级团队，并建立跨团队依赖和负责人中继/u)
  assert.match(source, /newPeerTeam: "添加协作团队"/u)
  assert.match(source, /如果现有团队足够，请说明原因且不要创建/u)
  assert.match(source, /负责人始终使用主模型；新成员默认使用子代理模型/u)
  assert.match(source, /research: "调研与核验"/u)
  assert.match(source, /build: "开发与审查"/u)
  assert.match(source, /incident: "问题诊断"/u)
  assert.doesNotMatch(source, /inputActions\.(?:submit|send)|\.click\(\)/u)
  assert.doesNotMatch(source, /postAction\([^\n]+(?:start|spawn|message|member-stop|task-create|task-update|close)/u)
})

test('creation drafts remain in the Teams view until a genuine successful submission', async () => {
  const source = await clientSource()
  assert.match(source, /props\.setDraft\(prompt, \{ creation: true \}\)/u)
  assert.doesNotMatch(source, /!pending && teams\.length === 0/u)
  assert.match(source, /pending && pending\.observedInComposer && previousPhaseRef\.current !== "submitting" && inputPhase === "submitting"/u)
  assert.match(source, /key: "newPeerTeam", creation: true, includeTeams: true/u)
  assert.ok(source.includes('do not ask me to design the team structure.", { creation: true, includeTeams: true }'))
  assert.match(source, /previousPhaseRef\.current === "submitting" && inputPhase === "plain"/u)
  assert.match(source, /inputDraft === "" && inputDraftRev !== pending\.submittedDraftRev/u)
  assert.doesNotMatch(source, /setDraft\(prompt[^\n]+(?:setView|activateChat|sessions\.open)/u)
  assert.match(source, /typeof props\.setView === "function"\) \{[\s\S]*?props\.setView\("chat"\);[\s\S]*?\} else setNotice\(t\("creationSentFallback"\)\)/u)
  assert.match(source, /creationSentFallback: "创建请求已发送。请使用上方“对话”标签查看响应。"/u)
  assert.doesNotMatch(source, /querySelector|\.click\(\)|history\.(?:pushState|replaceState)/u)
  const transition = source.indexOf('previousPhaseRef.current === "submitting" && inputPhase === "plain"')
  const switchView = source.indexOf('props.setView("chat")', transition)
  assert.ok(transition >= 0 && switchView > transition, 'Chat switch must follow successful submission settlement')
  assert.match(source, /创建请求已发送，正在返回对话/u)
})

test('automatic mode needs only a normal goal and uses plain member labels', async () => {
  const source = await clientSource()
  assert.match(source, /启用后，你只需像平常一样描述目标/u)
  assert.match(source, /自动团队已开启/u)
  assert.match(source, /h\(FirstTeamWizard, \{ t: t, setDraft: setDraft, setView: props\.setView, disable: disable, busy: busy \}\)/u)
  assert.match(source, /props\.setView\("chat"\)/u)
  assert.match(source, /simpleMemberName\(member, isLead, t\)/u)
  assert.match(source, /function openAgentCatalog\(\)/u)
  assert.match(source, /使用用户语言的 2–12 字符直白职责名/u)
  assert.match(source, /plain 2–12 character duty name in the user's language/u)
  assert.match(source, /codePoints\.length > 24 \? codePoints\.slice\(0, 23\)\.join\(""\) \+ "…"/u)
})

test('enabled workspaces expose a safe automatic-team disable control', async () => {
  const source = await clientSource()
  assert.match(source, /disable: "关闭自动团队"/u)
  assert.match(source, /disableActiveHint: "存在活动团队时无法关闭自动团队/u)
  assert.match(source, /h\(DisableAutomaticTeams, \{ t: t, labelId: "dat-disable-empty", disable: props\.disable, busy: props\.busy, hasActive: false \}\)/u)
  const intro = source.indexOf('h("div", { className: "dat-empty"')
  const emptyDisable = source.indexOf('h(DisableAutomaticTeams, { t: t, labelId: "dat-disable-empty"')
  const templates = source.indexOf('t("chooseTemplate")', emptyDisable)
  assert.ok(intro >= 0 && emptyDisable > intro && templates > emptyDisable, 'disable control must be above the template wizard fields')
  assert.match(source, /h\(DisableAutomaticTeams, \{ t: t, labelId: "dat-disable-teams", disable: disable, busy: busy, hasActive: hasActiveTeams \}\)/u)
  assert.match(source, /hasActiveTeams = teams\.some\(function \(item\) \{ return String\(item\.status \|\| item\.state \|\| ""\)\.toLowerCase\(\) !== "closed"; \}\)/u)
  assert.match(source, /disabled: props\.busy \|\| props\.hasActive/u)
  const start = source.indexOf('function disable()')
  const end = source.indexOf('var connectionKey', start)
  assert.ok(start >= 0 && end > start, 'missing isolated disable handler')
  const disableBody = source.slice(start, end)
  assert.match(disableBody, /postAction\(props\.sessionId, "settings", \{ enabled: false \}\)/u)
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
  assert.match(source, /role: "complementary"/u)
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
  for (const marker of ['TeamCanvas', 'workMode', 'dat-view-toggle', 'dat-canvas-lines', 'dat-canvas-node', 'relationIds(task.dependsOn)', 'relationIds(task.blockedBy)', 'relationIds(task.conflictsWith)']) {
    assert.ok(source.includes(marker), `missing live canvas marker: ${marker}`)
  }
  assert.match(source, /useState\("canvas"\)/u)
  assert.match(source, /workMode === "canvas" \? h\(TeamCanvas/u)
  assert.match(source, /task\.assigneeSessionId \|\| task\.assigneeId \|\| task\.assignee \|\| task\.memberId/u)
  assert.match(source, /completedTasks\.length\) taskNodes\.push\(\{ id: "__completed__"/u)
  assert.match(source, /markerEnd: "url\(#dat-canvas-arrow\)"/u)
  assert.match(source, /className: "dat-canvas-row dat-canvas-member-row"/u)
  assert.match(source, /className: "dat-canvas-row dat-canvas-task-row"/u)
  assert.match(source, /style: \{ width: width \+ "px", height: height \+ "px" \}/u)
  assert.match(source, /grid-template-rows:82px 104px 82px/u)
  assert.match(source, /\.dat-canvas-node\{position:relative;display:block/u)
  assert.doesNotMatch(source, /className: "dat-canvas-node[^\n]+style: \{ left:/u)
  assert.match(source, /className: "dat-sr"[^\n]+edges\.map/u)
  assert.doesNotMatch(source, /(?:reactflow|d3|dagre|cytoscape)/iu)
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

test('settings restore authoritative state after an active-team disable conflict', async () => {
  const source = await clientSource()
  assert.match(source, /error\.code = data\.code/u)
  assert.match(source, /err && err\.code === "AGENT_TEAMS_CONFLICT" \? t\("settingsCloseTeamsFirst"\)/u)
  assert.match(source, /return fetchState\(sessionId\)\.then\(applyState\)/u)
  assert.match(source, /请先在负责人会话中关闭所有活动团队/u)
})

test('switching conversation views only stops UI subscriptions, never the running team', async () => {
  const source = await clientSource()
  assert.match(source, /if \(source\) source\.close\(\);\s*clearPolling\(\);\s*if \(publishFrame !== null\) cancelFrame\(publishFrame\)/u)
  assert.match(source, /removeEventListener\("visibilitychange", onVisibilityChange\)/u)
  assert.doesNotMatch(source, /sessions\.(?:interrupt|stop)|team_shutdown|member-stop|postAction\([^\n]+["']close["']/u)
  assert.match(source, /Switching teams or views never stops background members/u)
})

test('Agent Teams workspace exposes tasks, events, and one unified agent catalog', async () => {
  const source = await clientSource()
  for (const marker of ['members', 'tasks', 'events', 'blockedBy', 'dependencySources', 'conflictsWith', 'fileScopeProjection', 'lastActivityAt', 'agentCount', 'setSubagentCatalogOpen', 'SUBAGENT_CATALOG_EVENT']) {
    assert.ok(source.includes(marker), `missing Agent Teams workspace marker: ${marker}`)
  }
  for (const label of ['正在启动', '正在停止', '正在关闭', '代理目录', '文件范围已按安全策略隐藏', '协作事件']) {
    assert.ok(source.includes(label), `missing localized UX label: ${label}`)
  }
  assert.match(source, /props\.sessions\.setSubagentCatalogOpen\(team\.leadSessionId, true\)/u)
  assert.match(source, /new window\.CustomEvent\(SUBAGENT_CATALOG_EVENT, \{ detail: \{ parentSessionId: team\.leadSessionId \} \}\)/u)
  assert.match(source, /h\(ActiveTeam, \{ t: t, team: team, teams: teams, closed: closed, paused: paused, setDraft: setDraft, sessions: props\.sessions, connection: live\.connection \}\)/u)
  assert.match(source, /paused: "已由用户停止"|paused: "Stopped by user"/u)
  assert.doesNotMatch(source, /function MemberCard|drawerTab|setDrawerTab|sessions\.openSubagent|openSubagent\(address\)/u)
  assert.match(source, /aria-live/u)
  assert.match(source, /h\("h2", \{ className: "dat-title" \}/u)
  assert.match(source, /@media\(max-width:900px\)/u)
  assert.match(source, /@media\(max-width:620px\)/u)
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
  assert.match(source, /addEdge\(memberLookup\[String\(assigned \|\| ""\)\], target, "assigned", targetState === "in_progress"\)/u)
  assert.match(source, /stateKind === "running" \? " dat-canvas-live" : ""/u)
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
  for (const label of ['组建协作团队', '同一局域网', '不在同一网络', '生成远程邀请', '加入已有团队', '生成加入请求', '批准加入', '完成加入', '端到端通道已就绪', '不广播设备扫描', 'HypoMux 仅用于 Windows 多网卡下载聚合']) {
    assert.ok(source.includes(label), `missing project collaboration label: ${label}`)
  }
  assert.match(source, /h\(ProjectTeamEntry, \{ t: t \}\)/u)
  assert.match(source, /navigator\.clipboard\.writeText\(value\)/u)
  assert.match(source, /readOnly: true, value: inviteCode/u)
  assert.match(source, /x-harness-agent-teams/u)
  assert.match(source, /一次性批准信息会安全携带固定入口和设备凭据/u)
  assert.match(source, /run\("connect-lan", \{ host: lanHost\.trim\(\), port: Number\(lanPort\) \}\)/u)
  assert.doesNotMatch(source, /h\("textarea", \{[^}]*projectLanKey/u, 'the UI must never render a private mTLS key field')
  assert.doesNotMatch(source, /HypoMux.*(?:import|require|script src)/iu)
})

test('task cards and canvas nodes open a live native task detail sidebar with assignee model and relationships', async () => {
  const source = await clientSource()
  for (const marker of ['function TaskDetailSidebar', 'function memberModelText(member, t)', 'dat-task-open', 'dat-canvas-task-open', 'selectedTaskId', 'selectedTask = tasks.filter', 'openTask: openTaskDetail', 'onClick: function (event) { props.openTask(event, task); }', 'props.onOpen(event, task)', 'taskDetailRef', 't("taskDetail")', 't("taskEvents")', 't("taskRef")', 't("taskDependencies")', 'memberModelText(assignee, t)', 'task.fileScopeProjection && task.fileScopeProjection.projected === false']) {
    assert.ok(source.includes(marker), `missing task detail marker: ${marker}`)
  }
  assert.equal((source.match(/role: "complementary"/gu) || []).length, 2, 'activity and task detail inspectors are both complementary sidebars')
  assert.match(source, /memberModel: modelFor, onOpen: openTaskDetail/u)
  assert.match(source, /arrayText\(task\.blockedBy\)\.map\(refTitle\)\.join\(", "\)\)/u)
  assert.match(source, /task\.dependencies\.map\(refTitle\)\.join\(", "\)/u)
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

test('task detail refreshes from the shared SSE snapshot and stays keyboard accessible', async () => {
  const source = await clientSource()
  assert.match(source, /selectedTaskId \? h\(React\.Fragment/u)
  assert.match(source, /if \(event\.key === "Escape"\) \{ if \(drawerOpen\) closePanel\(\); else closeTaskDetail\(\); \}/u)
  assert.match(source, /tabIndex: -1, ref: props\.detailRef/u)
  assert.match(source, /focusTarget = drawerOpen \? drawerRef\.current : taskDetailRef\.current/u)
  assert.match(source, /setDrawerOpen\(false\); setSelectedTaskId\(""\); \}, \[teamId\(team\), props\.closed\]\)/u)
  assert.match(source, /events\.filter\(relevantToTask\)/u)
  assert.match(source, /t\("taskDetailUnavailable"\)/u)
  assert.doesNotMatch(source, /(reactflow|d3|dagre|cytoscape|framer-motion|react-spring|gsap)/iu)
})
