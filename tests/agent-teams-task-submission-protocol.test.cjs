const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const plugin = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib')
const indexSource = fs.readFileSync(path.join(plugin, 'index.js'), 'utf8')
const clientSource = fs.readFileSync(path.join(plugin, 'client.js'), 'utf8')
const runtimeSource = fs.readFileSync(path.join(__dirname, 'agent-teams-runtime.test.cjs'), 'utf8')
const webSource = fs.readFileSync(path.join(plugin, 'project-task-web.js'), 'utf8')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.notEqual(from, -1, `missing source marker: ${start}`)
  assert.notEqual(to, -1, `missing source marker: ${end}`)
  return source.slice(from, to)
}

test('completion is claimant-fenced submission and only lead acceptance is authoritative completion', () => {
  const update = between(indexSource, 'async function updateTask(store, caller, input)', 'function markMemberShuttingDown')
  assert.match(update, /action === "complete"[\s\S]*?assertCurrentTaskLease\(team, task, caller, input, \{ leadMayOverride: false \}\)/u)
  assert.match(update, /task\.state = "submitted"[\s\S]*task\.submission = taskSubmission\(task, caller\.id, submittedAt\)/u)
  assert.doesNotMatch(update, /task\.acceptance = isLead \?/u)
  assert.match(update, /action === "accept"[\s\S]*?task\.state = "completed"[\s\S]*?task\.acceptance = \{/u)
  assert.match(update, /acceptance requires a current submitted task-scoped delivery/u)
  assert.match(update, /only the original claimant may replay task submission; the lead must use accept/u)
})

test('unverified checkpoint and coordinator delivery cannot be mistaken for Host quality evidence', () => {
  const checkpoint = between(indexSource, 'async function updateTaskCheckpoint', 'async function updateTaskExternalEffect')
  assert.match(checkpoint, /verified: false/u)
  assert.match(checkpoint, /assertCurrentTaskLease\(team, task, caller, input, \{ leadMayOverride: false \}\)/u)
  assert.match(indexSource, /most recent unverified checkpoint\/next step as bounded recovery/u)
  assert.match(indexSource, /report, message, or successful turn end does not complete a durable team task/u)
  assert.match(runtimeSource, /team_task_update[\s\S]*action: 'complete'[\s\S]*claim_id/u)
  assert.match(indexSource, /team_message.*authenticated coordinator relay/u)
})

test('reopen remains lead-only and establishes a fresh fence on the next claim', () => {
  const update = between(indexSource, 'async function updateTask(store, caller, input)', 'function markMemberShuttingDown')
  assert.match(update, /action === "reopen"[\s\S]*?if \(!isLead\) reject\("only the team lead can reopen/u)
  assert.match(update, /only a completed or cancelled task can be reopened/u)
  assert.match(update, /clearTaskTerminalMetadata\(task\)/u)
  assert.match(update, /task\.claimId = randomUUID\(\)/u)
  assert.match(update, /task\.leaseEpoch = team\.pauseEpoch \?\? 0/u)
})

test('page cursor cryptography and bounded-page guards are independent of submission acceptance', () => {
  assert.match(webSource, /createCipheriv\("aes-256-gcm"/u)
  assert.match(webSource, /cipher\.setAAD\(Buffer\.from\(JSON\.stringify\(\[domain, projectRef\]/u)
  assert.match(webSource, /MAX_WEB_TASK_PAGE_BYTES = 128 \* 1024/u)
  assert.match(webSource, /MAX_WEB_COLLABORATION_PAGE_BYTES = 128 \* 1024/u)
  assert.match(webSource, /WEB_PAGE_CURSOR_MAX_CHARS = 16_384/u)
  assert.match(webSource, /COLLABORATION_SECTIONS = Object\.freeze\(\[[\s\S]*"requests"/u)
})

test('durable validator rejects malformed completion/acceptance bindings', () => {
  assert.match(indexSource, /task\.submission must bind the submitted or accepted task claimant and current lease/u)
  assert.match(indexSource, /task\.acceptance must bind the submitted task claim and current lease/u)
  assert.match(indexSource, /non-forced closure requires every completed task to be accepted/u)
  assert.match(indexSource, /taskSatisfiesDependency\(task\)/u)
})

test('dependency, retirement, and shutdown gates require reviewable acceptance', () => {
  assert.match(indexSource, /blockedBy: task\.dependsOn\.filter\(\(id\) => !taskSatisfiesDependency\(byId\.get\(id\)\)\)/u)
  assert.match(indexSource, /invalidSubmissionTaskIds[\s\S]*AGENT_TEAMS_DELIVERY_REQUIRED/u)
  assert.match(indexSource, /function taskAwaitsAcceptance\(task\) \{[\s\S]*task\?\.state === "submitted"[\s\S]*taskSubmissionMatches\(task\)[\s\S]*task\.acceptance === undefined/u)
  const shutdown = between(indexSource, 'async function shutdownTeam', 'async function recoverOrphanTeams')
  assert.match(shutdown, /unacceptedTaskIds = team\.tasks\.filter\(taskAwaitsAcceptance\)[\s\S]*AGENT_TEAMS_ACCEPTANCE_REQUIRED[\s\S]*unfinishedTaskIds[\s\S]*AGENT_TEAMS_UNFINISHED_TASKS/u)
  const recovery = between(indexSource, 'async function recoverOrphanTeams', 'const TEAM_SNAPSHOT_INDEXES')
  assert.match(recovery, /unacceptedTaskIds = team\.tasks\.filter\(taskAwaitsAcceptance\)[\s\S]*AGENT_TEAMS_ACCEPTANCE_REQUIRED[\s\S]*confirmMemberRetired[\s\S]*closeTeamRecord/u)
  assert.match(indexSource, /non-forced closure requires every completed task to be accepted/u)
})

test('append-only lifecycle ledger survives projection clearing and covers every transition', () => {
  const clear = between(indexSource, 'function clearTaskTerminalMetadata(task)', '/** Return the public task projection')
  assert.match(clear, /task\.submission = undefined/u)
  assert.match(clear, /task\.acceptance = undefined/u)
  assert.doesNotMatch(clear, /lifecycleLedger/u)
  assert.match(indexSource, /const TASK_LIFECYCLE_KINDS = Object\.freeze\(\["claim", "submission", "acceptance", "reopen", "reject", "cancel", "release", "migration"\]\)/u)
  assert.match(indexSource, /function appendTaskLifecycleEvent/u)
  for (const kind of ['claim', 'submission', 'acceptance', 'reopen', 'reject', 'cancel', 'release']) {
    assert.match(indexSource, new RegExp(`appendTaskLifecycleEvent\\(task, \\{ kind: "${kind}"`, 'u'))
  }
  assert.match(indexSource, /const requiredAfter = \(\{ claim: 2, submission: 1, release: 3, reopen: 3, reject: 3 \}\)\[event\.kind\] \?\? 0/u)
  assert.match(indexSource, /task\.lifecycleLedger\.length \+ 1 \+ requiredAfter > MAX_TASK_LIFECYCLE_EVENTS/u)
  assert.match(indexSource, /accept or cancel the current work instead/u)
  assert.doesNotMatch(indexSource, /archive the team before adding another transition/u)
})

test('submitted work is neither dependency-complete nor gracefully retireable', () => {
  assert.match(indexSource, /const TASK_STATES = Object\.freeze\(\["pending", "in_progress", "submitted", "completed", "cancelled"\]\)/u)
  assert.match(indexSource, /return task\?\.state === "completed" && taskAcceptanceMatches\(task\)/u)
  assert.match(indexSource, /unfinishedTaskIds = team\.tasks\.filter\(\(task\) => task\.assigneeSessionId === member\.sessionId && !taskSatisfiesDependency\(task\)/u)
})

test('team relay distinguishes transport-queued from recipient-delivered across failure, Stop, and restart', () => {
  const relay = between(indexSource, 'async function sendTeamMessageUnlocked', 'async function createTask')
  const restart = between(indexSource, '  async init() {', '  snapshot() {')
  const close = between(indexSource, 'function closeTeamRecord', 'async function createTeam')
  assert.match(relay, /const deferToAutopilot = structuredMessage\?\.kind === "expansion_request"[\s\S]*sourceTeam\.autopilot\?\.status === "active"/u)
  assert.match(relay, /status: deferToAutopilot \? "queued" : "pending",\s*\.\.\.\(deferToAutopilot \? \{ queuedAt: createdAt \} : \{\}\),\s*createdAt/u)
  assert.match(relay, /prepared\.reused === true \|\| prepared\.deferToAutopilot === true/u)
  assert.match(relay, /message\.status = "queued"[\s\S]*message\.queuedAt = now\(\)[\s\S]*message\.deliveredAt = undefined/u)
  assert.doesNotMatch(relay, /message\.status = "delivered"/u)
  assert.match(relay, /transport[\s\S]*acceptance only[\s\S]*recipient model[\s\S]*never expose that acknowledgment as delivered/u)
  assert.match(relay, /message\.status = "failed"[\s\S]*message\.queuedAt = undefined[\s\S]*message\.deliveredAt = undefined/u)
  assert.match(indexSource, /assertEnum\(message\.status, \["pending", "queued", "delivered", "failed"\]/u)
  assert.match(indexSource, /queued message requires transport acceptance without claiming recipient delivery/u)
  assert.match(restart, /message\.status !== "pending"[\s\S]*persisted[\s\S]*`queued` message is intentionally left queued\/unconfirmed on restart/u)
  assert.match(close, /message\.status !== "pending"[\s\S]*message\.status = "failed"/u)
  assert.match(runtimeSource, /Race with shutdown'\)\.status, 'queued'/u)
  assert.match(runtimeSource, /restart preserves transport-accepted relay as queued\/unconfirmed/u)
  assert.match(indexSource, /A queued result proves transport acceptance only, not that the recipient model received the body/u)
  assert.match(clientSource, /queued: "已排队（未确认收件）"/u)
  assert.match(clientSource, /queued: "Queued \(recipient delivery unconfirmed\)"/u)
  assert.match(clientSource, /Host transport 已接受；不表示正文已注入或收件模型已读取/u)
  assert.match(clientSource, /Host transport accepted the body; it does not prove recipient injection or that the recipient model read it/u)
  assert.match(clientSource, /eventState === "queued" \? event\.queuedAt[\s\S]*eventState === "queued" \? h\("p", \{ className: "dat-note" \}, t\("queuedHint"\)\)/u)
})
