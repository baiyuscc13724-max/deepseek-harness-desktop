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
  assert.match(source, /isLead \? t\("leadRole"\) : member\.role/u)
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
  const end = source.indexOf('function addressFor', start)
  assert.ok(start >= 0 && end > start, 'missing isolated disable handler')
  const disableBody = source.slice(start, end)
  assert.match(disableBody, /postAction\(props\.sessionId, "settings", \{ enabled: false \}\)/u)
  assert.match(disableBody, /setActionError/u)
  assert.match(disableBody, /fetchState\(props\.sessionId\)\.then\(function \(state\) \{ live\.setState\(state\); \}\)/u)
  assert.doesNotMatch(disableBody, /setDraft|setView|inputActions|model|submit/u)
})

test('one lead can inspect and switch among multiple team projections', async () => {
  const source = await clientSource()
  for (const marker of ['teamsFromSnapshot', 'snapshot.teams', 'snapshot.relatedTeams', 'snapshot.teamHistory', 'TeamOverview', 'selectedTeamId', 'crossEvents', 'setSelectedId']) {
    assert.ok(source.includes(marker), `missing multi-team workspace marker: ${marker}`)
  }
  for (const label of ['团队总览', '跨团队动态', '切换团队或页面不会停止后台成员']) {
    assert.ok(source.includes(label), `missing multi-team localized label: ${label}`)
  }
  assert.match(source, /event\.toTeamId && event\.toTeamId !== \(event\.fromTeamId \|\| teamId\(team\)\)/u)
  assert.match(source, /目标团队：.*team_id:/u)
  assert.match(source, /crossDelivery/u)
  assert.match(source, /event\.toTeamId === teamId\(team\)/u)
  assert.match(source, /h\("ul", \{ className: "dat-team-list" \}/u)
  assert.doesNotMatch(source, /role: "listitem"/u)
  assert.match(source, /aria-current/u)
})

test('inbound cross-team delivery metadata is merged without duplicate cards', async () => {
  const source = await clientSource()
  for (const marker of ['inboundEvents', 'eventIdentity', 'pushUniqueEvent', 'seenCrossEvents', 'seenEvents']) {
    assert.ok(source.includes(marker), `missing inbound event deduplication marker: ${marker}`)
  }
  assert.match(source, /\(team\.inboundEvents \|\| \[\]\)\.forEach/u)
  assert.match(source, /if \(seen\[key\]\) return;/u)
  assert.match(source, /key: eventIdentity\(event, teamId\(team\)\)/u)
  assert.match(source, /event\.fromTeamName \|\| teamName\(teamsById\[event\.fromTeamId\], t\)/u)
  assert.match(source, /event\.toTeamName \|\| teamName\(teamsById\[event\.toTeamId\], t\)/u)
  assert.match(source, /teamsById: teamsById/u)
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
  assert.match(source, /if \(source\) source\.close\(\); if \(poll\) clearInterval\(poll\)/u)
  assert.doesNotMatch(source, /sessions\.(?:interrupt|stop)|team_shutdown|member-stop|postAction\([^\n]+["']close["']/u)
  assert.match(source, /Switching teams or views never stops background members/u)
})

test('Agent Teams workspace exposes localized members, tasks, events, and live handoff', async () => {
  const source = await clientSource()
  for (const marker of ['members', 'tasks', 'events', 'blockedBy', 'dependencySources', 'conflictsWith', 'fileScopeProjection', 'lastActivityAt', 'currentTaskFor', 'sessions.subagentAddress', 'sessions.openSubagent']) {
    assert.ok(source.includes(marker), `missing Agent Teams workspace marker: ${marker}`)
  }
  for (const label of ['正在启动', '正在停止', '正在关闭', '查看实时工作', '主模型', '子代理模型', '文件范围已按安全策略隐藏', '协作事件']) {
    assert.ok(source.includes(label), `missing localized UX label: ${label}`)
  }
  assert.match(source, /\[member\.provider, member\.model\]/u)
  assert.match(source, /member\.modelTier === "main" \|\| isLead/u)
  assert.match(source, /member\.kind === "lead"/u)
  assert.match(source, /child\.indexOf\("provisioning:"\) !== 0/u)
  assert.match(source, /openSubagent\(address\)/u)
  assert.doesNotMatch(source, /openSubagent\(\{\s*parentSessionId/u)
  assert.match(source, /aria-live/u)
  assert.match(source, /h\("h2", \{ className: "dat-title" \}/u)
  assert.match(source, /@media\(max-width:900px\)/u)
  assert.match(source, /@media\(max-width:620px\)/u)
})
