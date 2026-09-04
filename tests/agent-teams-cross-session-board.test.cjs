const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const boardUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-team-board.js')).href
const pluginUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href
const projectA = 'a'.repeat(64)
const projectB = 'b'.repeat(64)
const cursorKey = Buffer.alloc(32, 7)

function iso(value) {
  return new Date(Date.parse('2026-01-01T00:00:00.000Z') + value).toISOString()
}

function team(projectKey, index, taskCount, options = {}) {
  const id = `${options.prefix || 'team'}-${index}`
  const sessionId = `${id}-session`
  return {
    id,
    projectKey,
    rootLeadSessionId: sessionId,
    name: options.name || `Team ${index}`,
    objective: options.objective || `Objective ${index}`,
    revision: options.revision || 1,
    state: options.state || 'active',
    createdAt: iso(index),
    updatedAt: iso(10_000 - index),
    members: [{ id: `lead:${sessionId}`, sessionId, name: `Duty ${index}`, role: 'lead', kind: 'lead', state: 'running', createdAt: iso(0), updatedAt: iso(1) }],
    messages: [],
    plan: { phase: 'active' },
    tasks: Array.from({ length: taskCount }, (_, taskIndex) => ({
      id: `${id}-task-${String(taskIndex).padStart(4, '0')}`,
      title: `Task ${index}/${taskIndex}`,
      state: taskIndex % 5 === 0 ? 'completed' : taskIndex % 5 === 1 ? 'in_progress' : 'pending',
      dependsOn: [],
      crossTeamDependsOn: [],
      capabilities: [],
      externalEffects: [],
      assigneeSessionId: sessionId,
      createdAt: iso(taskIndex),
      updatedAt: iso(20_000 - taskIndex),
    })),
  }
}

async function traverse(mod, projectKey, teams) {
  const pages = []
  let page = mod.createProjectTeamBoard(projectKey, teams, { cursorIntegrityKey: cursorKey })
  while (true) {
    pages.push(page)
    if (!page.page.hasMore) break
    assert.equal(typeof page.page.nextCursor, 'string')
    page = mod.createProjectTeamBoardPage(projectKey, teams, { cursor: page.page.nextCursor, cursorIntegrityKey: cursorKey })
  }
  return pages
}

test('project team board pages preserve complete per-project totals, zero-task teams, and a team spanning 120 tasks', async () => {
  const mod = await import(`${boardUrl}?contract=${Date.now()}-${Math.random()}`)
  const teamsA = [team(projectA, 0, 135, { name: 'Large team' }), team(projectA, 1, 0, { name: 'Zero team' }), ...Array.from({ length: 25 }, (_, index) => team(projectA, index + 2, index % 4))]
  const teamsB = [team(projectB, 0, 3, { prefix: 'other' })]
  const pages = await traverse(mod, projectA, [...teamsA, ...teamsB])
  const expectedTaskIds = teamsA.flatMap((entry) => entry.tasks.map((task) => task.id)).sort()
  const seenTaskIds = pages.flatMap((page) => page.teams.flatMap((entry) => entry.tasks.map((task) => task.id)))
  const seenTeamIds = new Set(pages.flatMap((page) => page.teams.map((entry) => entry.id)))

  assert.equal(pages[0].stats.totalTeams, teamsA.length)
  assert.equal(pages[0].stats.totalTasks, expectedTaskIds.length)
  assert.ok(pages.length > 2, '24 teams and 120 tasks are page budgets, not capacity')
  assert.deepEqual([...seenTaskIds].sort(), expectedTaskIds)
  assert.equal(new Set(seenTaskIds).size, seenTaskIds.length, 'task boundaries must not duplicate entries')
  assert.equal(seenTeamIds.has('team-1'), true, 'zero-task teams remain visible')
  assert.equal(seenTeamIds.has('other-0'), false, 'another canonical project never enters this board')
  for (const page of pages) {
    assert.ok(page.page.includedTeams <= mod.UI_PROJECT_TEAM_BOARD_MAX_TEAMS)
    assert.ok(page.page.includedTasks <= mod.UI_PROJECT_TEAM_BOARD_MAX_TASKS)
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= mod.UI_PROJECT_TEAM_BOARD_MAX_BYTES)
    assert.equal(page.stats.totalTeams, teamsA.length)
    assert.equal(page.stats.totalTasks, expectedTaskIds.length)
  }
})

test('host board includes different roots in the same canonical project and strictly excludes every foreign project', async () => {
  const mod = await import(`${pluginUrl}?isolation=${Date.now()}-${Math.random()}`)
  const caller = team(projectA, 10, 2, { prefix: 'caller' })
  const sameProjectOtherRoot = team(projectA, 11, 3, { prefix: 'peer-root' })
  const foreignProjectRoot = team(projectB, 12, 4, { prefix: 'foreign-root' })
  assert.notEqual(caller.rootLeadSessionId, sameProjectOtherRoot.rootLeadSessionId)

  const document = { teams: [foreignProjectRoot, sameProjectOtherRoot, caller] }
  const pages = []
  let page = mod.projectTeamBoardPage(document, caller.members[0].sessionId, caller.id)
  while (true) {
    pages.push(page)
    if (!page.page.hasMore) break
    page = mod.projectTeamBoardPage(document, caller.members[0].sessionId, caller.id, page.page.nextCursor)
  }
  const visibleTeams = new Set(pages.flatMap((entry) => entry.teams.map((candidate) => candidate.id)))
  const visibleTasks = new Set(pages.flatMap((entry) => entry.teams.flatMap((candidate) => candidate.tasks.map((task) => task.id))))
  assert.equal(visibleTeams.has(caller.id), true)
  assert.equal(visibleTeams.has(sameProjectOtherRoot.id), true, 'same project is visible across root sessions')
  assert.equal(visibleTeams.has(foreignProjectRoot.id), false, 'foreign project team is excluded')
  assert.equal([...foreignProjectRoot.tasks].some((task) => visibleTasks.has(task.id)), false, 'foreign project tasks are excluded')
  assert.equal(pages[0].stats.totalTeams, 2)
  assert.equal(pages[0].stats.totalTasks, caller.tasks.length + sameProjectOtherRoot.tasks.length)
  assert.throws(() => mod.projectTeamBoardPage(document, caller.members[0].sessionId, sameProjectOtherRoot.id), (error) => error.code === 'AGENT_TEAMS_PROJECT_BOARD_FORBIDDEN')
})

test('project team board excludes archived teams and tasks from every page, exact total, remaining count, revision, and live snapshot cursor', async () => {
  const mod = await import(`${pluginUrl}?archived=${Date.now()}-${Math.random()}`)
  const active = team(projectA, 20, 125, { prefix: 'active' })
  const paused = team(projectA, 21, 3, { prefix: 'paused', state: 'paused' })
  const archived = team(projectA, 22, 131, { prefix: 'archived', state: 'closed' })
  const foreign = team(projectB, 23, 7, { prefix: 'foreign' })
  const settings = { enabled: true, maxMembers: 8, maxActiveTurns: 8 }
  const document = { version: 6, settings, teams: [archived, foreign, paused, active] }
  const archivedTaskIds = new Set(archived.tasks.map((task) => task.id))
  const visibleTaskIds = [...active.tasks, ...paused.tasks].map((task) => task.id).sort()
  const pages = []
  let page = mod.projectTeamBoardPage(document, active.members[0].sessionId, active.id)
  let loadedTasks = 0
  while (true) {
    pages.push(page)
    loadedTasks += page.page.includedTasks
    assert.equal(page.stats.totalTeams, 2)
    assert.equal(page.stats.totalTasks, visibleTaskIds.length)
    assert.equal(page.stats.totalTasks - loadedTasks, visibleTaskIds.length - loadedTasks, 'remaining is derived only from visible tasks')
    if (!page.page.hasMore) break
    page = mod.projectTeamBoardPage(document, active.members[0].sessionId, active.id, page.page.nextCursor)
  }

  const seenTeams = new Set(pages.flatMap((entry) => entry.teams.map((candidate) => candidate.id)))
  const seenTasks = pages.flatMap((entry) => entry.teams.flatMap((candidate) => candidate.tasks.map((task) => task.id)))
  assert.deepEqual([...seenTasks].sort(), visibleTaskIds)
  assert.equal(seenTeams.has(active.id), true)
  assert.equal(seenTeams.has(paused.id), true, 'paused teams remain visible')
  const pausedSummary = pages.flatMap((entry) => entry.teams).find((candidate) => candidate.id === paused.id)
  assert.equal(pausedSummary.liveStatus.kind, 'paused', 'Stop/pause authority outranks stale member running state')
  assert.equal(seenTeams.has(archived.id), false, 'closed teams never enter the first or a cursor page')
  assert.equal(seenTasks.some((taskId) => archivedTaskIds.has(taskId)), false, 'closed-team tasks never enter the first or a cursor page')
  assert.equal(loadedTasks, visibleTaskIds.length)

  const withoutArchived = mod.projectTeamBoardPage({ teams: [foreign, paused, active] }, active.members[0].sessionId, active.id)
  const changedArchived = { ...archived, revision: 99, name: 'Changed archived history', updatedAt: iso(99_000), tasks: [...archived.tasks, { ...archived.tasks[0], id: 'archived-extra-task', title: 'Archived-only mutation' }] }
  const changedDocument = { version: 6, settings, teams: [changedArchived, foreign, paused, active] }
  const changedBoard = mod.projectTeamBoardPage(changedDocument, active.members[0].sessionId, active.id)
  assert.equal(pages[0].cursor, withoutArchived.cursor, 'closed teams do not participate in the board revision')
  assert.equal(changedBoard.cursor, withoutArchived.cursor, 'closed-team revisions and tasks do not participate in the board revision')
  assert.equal(mod.teamSnapshot(document, active.members[0].sessionId, active.id).cursor, mod.teamSnapshot(changedDocument, active.members[0].sessionId, active.id).cursor, 'closed-only changes do not advance the live snapshot/SSE cursor')
})

test('a project containing only archived teams returns an empty board without deleting Team Store history', async () => {
  const mod = await import(`${pluginUrl}?archived-only=${Date.now()}-${Math.random()}`)
  const archived = team(projectA, 30, 4, { prefix: 'history', state: 'closed' })
  const document = { version: 6, settings: { enabled: true, maxMembers: 8, maxActiveTurns: 8 }, teams: [archived] }
  const board = mod.projectTeamBoardPage(document, archived.members[0].sessionId, archived.id)
  assert.equal(board.available, true)
  assert.deepEqual(board.teams, [])
  assert.deepEqual(board.stats, { totalTeams: 0, includedTeams: 0, totalTasks: 0, includedTasks: 0, pendingTasks: 0, inProgressTasks: 0, submittedTasks: 0, acceptanceRequiredTasks: 0, completedTasks: 0, cancelledTasks: 0, blockedTasks: 0, attentionTasks: 0, attentionTeams: 0 })
  assert.deepEqual(board.page, { includedTeams: 0, includedTasks: 0, hasMore: false, nextCursor: null })

  const snapshot = mod.teamSnapshot(document, archived.members[0].sessionId, archived.id)
  assert.equal(document.teams[0], archived, 'board projection must not mutate or delete durable history')
  assert.equal(snapshot.teams.some((candidate) => candidate.id === archived.id), true, 'the authorized Team Store snapshot retains the archived team')
  assert.equal(snapshot.team.id, archived.id)
})

test('closing the last visible team invalidates an older pagination cursor', async () => {
  const mod = await import(`${boardUrl}?archive-stale=${Date.now()}-${Math.random()}`)
  const visible = team(projectA, 40, 121, { prefix: 'last-visible' })
  const first = mod.createProjectTeamBoard(projectA, [visible], { cursorIntegrityKey: cursorKey })
  assert.equal(first.page.hasMore, true)
  const archived = { ...visible, state: 'closed', revision: visible.revision + 1, updatedAt: iso(80_000) }
  assert.throws(() => mod.createProjectTeamBoardPage(projectA, [archived], { cursor: first.page.nextCursor, cursorIntegrityKey: cursorKey }), (error) => error.code === 'AGENT_TEAMS_PROJECT_BOARD_CURSOR_STALE' && error.stale === true)
})

test('submitted work requires acceptance and an unrelated later delivery cannot clear failed-delivery attention', async () => {
  const mod = await import(`${boardUrl}?acceptance=${Date.now()}-${Math.random()}`)
  const current = team(projectA, 45, 1, { prefix: 'acceptance' })
  current.tasks[0].state = 'submitted'
  current.messages.push(
    { id: 'old-failure', fromSessionId: current.rootLeadSessionId, toSessionId: 'recipient', status: 'failed', createdAt: iso(100) },
    { id: 'later-success', fromSessionId: current.rootLeadSessionId, toSessionId: 'recipient', status: 'delivered', createdAt: iso(200), deliveredAt: iso(300) }
  )
  const board = mod.createProjectTeamBoard(projectA, [current], { cursorIntegrityKey: cursorKey })
  assert.equal(board.stats.submittedTasks, 1)
  assert.equal(board.stats.acceptanceRequiredTasks, 1)
  assert.equal(board.stats.attentionTasks, 1)
  assert.equal(board.teams[0].taskStats.submitted, 1)
  assert.equal(board.teams[0].taskStats.acceptanceRequired, 1)
  assert.ok(board.teams[0].attention.codes.includes('acceptance_required'))
  assert.ok(board.teams[0].attention.codes.includes('failed_delivery'))
  assert.equal(current.messages[0].status, 'failed', 'durable failure history remains unchanged for audit')
})

test('live status exposes only bounded root diagnostics and historical failures cannot outrank recovered state', async () => {
  const mod = await import(`${boardUrl}?live-security=${Date.now()}-${Math.random()}`)
  const current = team(projectA, 46, 1, { prefix: 'live-security' })
  const worker = {
    id: 'safe-worker', sessionId: 'secret-session-id', name: 'Test', role: 'worker', kind: 'worker', state: 'failed', updatedAt: iso(500),
    terminalDiagnostic: {
      code: 'PI_AI_ERROR', message: 'Not Found: raw upstream provider-name', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: true, nextAction: 'retry_current_task',
      runId: 'secret-run-id', claimId: 'secret-claim-id', path: 'C:\\secret\\runtime', stack: 'secret-stack', provider: 'raw-provider', prompt: 'secret-prompt', output: 'secret-output'
    }
  }
  current.members.push(worker, { id: 'queued-worker', sessionId: 'secret-queued-placeholder', name: 'Queue', role: 'worker', kind: 'worker', state: 'provisioning', updatedAt: iso(500) })
  current.tasks[0].state = 'pending'
  current.tasks[0].assigneeSessionId = worker.sessionId
  current.tasks[0].revision = 7
  current.tasks[0].lifecycleLedger = [{ kind: 'claim', sequence: 11, at: iso(400), claimId: 'secret-ledger-claim' }]
  current.tasks[0].interruptionHistory = [{ at: iso(100), admission: { active: 1, queued: 7, quarantined: 0, limit: 8, waitMs: 8 } }]
  current.provisioningQueue = [{ status: 'queued', memberId: 'queued-worker', updatedAt: iso(500), admission: { active: 8, queued: 2, quarantined: 1, limit: 8, waitMs: 900 }, sessionId: 'secret-queue-session' }]
  const sentBody = 'Sent-time snapshot stays immutable.'
  current.messages.push({ id: 'sent-snapshot', fromSessionId: current.rootLeadSessionId, toSessionId: worker.sessionId, body: sentBody, status: 'delivered', createdAt: iso(450), deliveredAt: iso(460) })

  const base = mod.createProjectTeamBoard(projectA, [current], { cursorIntegrityKey: cursorKey })
  assert.equal(base.teams[0].revision, current.revision)
  assert.equal(base.teams[0].tasks[0].revision, 7)
  assert.equal(base.teams[0].tasks[0].eventSequence, 11)
  assert.equal(base.teams[0].liveStatus.kind, 'provider_transient')
  assert.equal(base.teams[0].liveStatus.counts.queued, 1)
  assert.equal(base.teams[0].liveStatus.counts.registering, 0, 'a queued placeholder is not double-counted as registering')
  assert.equal('diagnostic' in base.teams[0].liveStatus, false, 'ordinary/cross-root summaries contain no diagnostic detail')
  assert.equal('admission' in base.teams[0].liveStatus, false, 'ordinary/cross-root summaries contain no admission detail')

  const taskless = structuredClone(current)
  taskless.tasks = []
  taskless.provisioningQueue = []
  taskless.members = taskless.members.filter((member) => member.id !== 'queued-worker')
  const decorateTaskless = value => mod.decorateProjectTeamBoardRecovery(mod.createProjectTeamBoard(projectA, [value], { cursorIntegrityKey: cursorKey }), [value], value.rootLeadSessionId)
  const unresolvedTaskless = decorateTaskless(taskless)
  assert.equal(unresolvedTaskless.teams[0].liveStatus.kind, 'provider_transient', 'a failed worker without a task remains unresolved')
  assert.deepEqual(unresolvedTaskless.teams[0].liveStatus.diagnostic, { errorCode: 'PI_AI_ERROR', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: true, nextAction: 'retry_current_task' }, 'an unresolved taskless failure keeps its bounded root diagnostic')
  assert.deepEqual(unresolvedTaskless.teams[0].memberRecovery.members, [{ id: worker.id, name: worker.name }], 'an unresolved taskless failure exposes the root recovery operation')
  assert.equal(unresolvedTaskless.teams[0].memberRecovery.membersTruncated, false)
  taskless.memberRecoveries = [{ requestId: 'older-recovery', action: 'retry', phase: 'followup_returned', status: 'delivered', memberId: worker.id, updatedAt: iso(499) }]
  const olderTaskless = decorateTaskless(taskless)
  assert.equal(olderTaskless.teams[0].liveStatus.kind, 'provider_transient', 'a delivery older than the failure cannot resolve it')
  assert.deepEqual(olderTaskless.teams[0].memberRecovery.members, [{ id: worker.id, name: worker.name }])
  taskless.memberRecoveries[0].updatedAt = iso(500)
  const deliveredTaskless = decorateTaskless(taskless)
  assert.equal(deliveredTaskless.teams[0].liveStatus.kind, 'idle', 'a durable delivered recovery no earlier than the failure moves it to history')
  assert.equal('diagnostic' in deliveredTaskless.teams[0].liveStatus, false, 'delivered historical failure is not reinserted into root live status')
  assert.equal('memberRecovery' in deliveredTaskless.teams[0], false, 'delivered taskless failure no longer exposes a current recovery operation')
  const retired = structuredClone(taskless)
  retired.memberRecoveries = []
  retired.members.find((member) => member.id === worker.id).state = 'retired'
  delete retired.members.find((member) => member.id === worker.id).terminalDiagnostic
  const retiredTaskless = decorateTaskless(retired)
  assert.equal(retiredTaskless.teams[0].liveStatus.kind, 'idle', 'a durable retired-and-cleared worker is historical without a recovery receipt')
  assert.equal('diagnostic' in retiredTaskless.teams[0].liveStatus, false, 'retired history cannot masquerade as a current root diagnostic')
  assert.equal('memberRecovery' in retiredTaskless.teams[0], false, 'retired-and-cleared worker has no current recovery operation')

  const foreign = mod.decorateProjectTeamBoardRecovery(base, [current], 'foreign-root')
  assert.deepEqual(foreign, base)
  const root = mod.decorateProjectTeamBoardRecovery(base, [current], current.rootLeadSessionId)
  assert.deepEqual(root.teams[0].liveStatus.diagnostic, { errorCode: 'PI_AI_ERROR', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: true, nextAction: 'retry_current_task' })
  assert.deepEqual(root.teams[0].liveStatus.admission, { active: 8, queued: 2, quarantined: 1, limit: 8, waitMs: 900 })
  const serialized = JSON.stringify(root)
  for (const secret of ['secret-session-id', 'secret-queued-placeholder', 'secret-run-id', 'secret-claim-id', 'secret-ledger-claim', 'secret-queue-session', 'C:\\\\secret', 'secret-stack', 'raw-provider', 'secret-prompt', 'secret-output', 'Not Found']) assert.equal(serialized.includes(secret), false, `must not serialize ${secret}`)
  assert.ok(Buffer.byteLength(serialized) <= mod.UI_PROJECT_TEAM_BOARD_MAX_BYTES)

  const replacement = { id: 'replacement-worker', sessionId: 'replacement-session', name: 'Retry', role: 'worker', kind: 'worker', state: 'running', updatedAt: iso(600) }
  current.members = current.members.filter((member) => member.id !== 'queued-worker')
  current.members.push(replacement)
  current.tasks[0].state = 'in_progress'
  current.tasks[0].assigneeSessionId = replacement.sessionId
  current.tasks[0].revision += 1
  current.revision += 1
  current.updatedAt = iso(600)
  current.provisioningQueue = []
  current.memberRecoveries = [{ requestId: 'delivered-replacement', action: 'replace', phase: 'followup_returned', status: 'delivered', memberId: worker.id, replacementMemberId: replacement.id, replacementSessionId: replacement.sessionId, taskIds: [current.tasks[0].id], updatedAt: iso(600) }]
  const recoveredBase = mod.createProjectTeamBoard(projectA, [current], { cursorIntegrityKey: cursorKey })
  const recovered = mod.decorateProjectTeamBoardRecovery(recoveredBase, [current], current.rootLeadSessionId)
  assert.equal(recovered.teams[0].liveStatus.kind, 'running', 'a replacement/retry running now outranks an archived failed member')
  assert.equal(recovered.teams[0].liveStatus.counts.providerTransient, 0)
  assert.equal('diagnostic' in recovered.teams[0].liveStatus, false, 'historical failure never reappears in current root live status')
  assert.deepEqual(recovered.teams[0].liveStatus.admission, { active: 0, queued: 0, quarantined: 0, limit: 0, waitMs: 0 }, 'historical task interruption and delivered recovery cannot keep live admission/backpressure stuck')

  replacement.state = 'ready'
  replacement.updatedAt = iso(700)
  current.tasks[0].state = 'submitted'
  current.tasks[0].revision += 1
  current.revision += 1
  current.updatedAt = iso(700)
  const submittedBase = mod.createProjectTeamBoard(projectA, [current], { cursorIntegrityKey: cursorKey })
  const submitted = mod.decorateProjectTeamBoardRecovery(submittedBase, [current], current.rootLeadSessionId)
  assert.equal(submitted.teams[0].liveStatus.kind, 'submitted', 'a current submission awaiting acceptance outranks historical failure')
  assert.equal(submitted.teams[0].liveStatus.counts.providerTransient, 0)
  assert.equal('diagnostic' in submitted.teams[0].liveStatus, false)

  current.tasks[0].state = 'completed'
  current.tasks[0].revision += 1
  current.revision += 1
  current.updatedAt = iso(800)
  const acceptedBase = mod.createProjectTeamBoard(projectA, [current], { cursorIntegrityKey: cursorKey })
  const accepted = mod.decorateProjectTeamBoardRecovery(acceptedBase, [current], current.rootLeadSessionId)
  assert.equal(accepted.teams[0].liveStatus.kind, 'continuable', 'accepted recovery remains current while historical failure stays only in durable lifecycle history')
  assert.equal(accepted.teams[0].liveStatus.counts.providerTransient, 0)
  assert.equal('diagnostic' in accepted.teams[0].liveStatus, false)

  worker.shutdownUnconfirmed = true
  const unconfirmed = mod.createProjectTeamBoard(projectA, [current], { cursorIntegrityKey: cursorKey })
  assert.equal(unconfirmed.teams[0].liveStatus.kind, 'provider_transient', 'an unconfirmed shutdown keeps the failure current even after task acceptance')
  delete worker.shutdownUnconfirmed
  current.memberRecoveries.push({ requestId: 'unknown-recovery', action: 'replace', phase: 'start_dispatched', status: 'outcome_unknown', memberId: worker.id, updatedAt: iso(900) })
  const unknown = mod.createProjectTeamBoard(projectA, [current], { cursorIntegrityKey: cursorKey })
  assert.equal(unknown.teams[0].liveStatus.kind, 'outcome_unknown', 'an unresolved recovery outcome remains a current primary state')
  current.memberRecoveries.at(-1).status = 'delivered'
  const resolved = mod.createProjectTeamBoard(projectA, [current], { cursorIntegrityKey: cursorKey })
  assert.equal(resolved.teams[0].liveStatus.kind, 'continuable', 'resolving the unknown outcome restores the accepted current state')
  assert.equal(current.messages.find(message => message.id === 'sent-snapshot').body, sentBody, 'live projection never rewrites sent-time chat prose')
})

test('live admission ignores terminal pressure history but retains unresolved task and recovery pressure', async () => {
  const mod = await import(`${boardUrl}?live-admission=${Date.now()}-${Math.random()}`)
  const current = team(projectA, 47, 1, { prefix: 'live-admission' })
  const worker = { id: 'pressure-worker', sessionId: 'pressure-worker-session', name: 'Pressure', role: 'worker', kind: 'worker', state: 'failed', updatedAt: iso(300) }
  current.members.push(worker)
  current.tasks[0].state = 'pending'
  current.tasks[0].assigneeSessionId = worker.sessionId
  current.tasks[0].interruptionHistory = [{ kind: 'capacity_wait', at: iso(200), admission: { active: 8, queued: 2, quarantined: 1, limit: 8, waitMs: 900 } }]
  const project = value => mod.decorateProjectTeamBoardRecovery(mod.createProjectTeamBoard(projectA, [value], { cursorIntegrityKey: cursorKey }), [value], value.rootLeadSessionId)
  const pressured = project(current)
  assert.equal(pressured.teams[0].liveStatus.kind, 'backpressure')
  assert.deepEqual(pressured.teams[0].liveStatus.admission, { active: 8, queued: 2, quarantined: 1, limit: 8, waitMs: 900 })

  worker.state = 'running'
  worker.updatedAt = iso(400)
  current.tasks[0].state = 'in_progress'
  current.memberRecoveries = [{ requestId: 'historical-delivery', action: 'retry', phase: 'followup_returned', status: 'delivered', memberId: worker.id, updatedAt: iso(400), admission: { active: 8, queued: 9, quarantined: 3, limit: 8, waitMs: 1_200 } }]
  current.revision += 1
  current.updatedAt = iso(400)
  const running = project(current)
  assert.equal(running.teams[0].liveStatus.kind, 'running', 'a worker start clears historical backpressure from the live kind')
  assert.deepEqual(running.teams[0].liveStatus.admission, { active: 0, queued: 0, quarantined: 0, limit: 0, waitMs: 0 })

  worker.state = 'ready'
  worker.mode = 'one-shot'
  current.tasks[0].state = 'completed'
  current.revision += 1
  current.updatedAt = iso(500)
  const idle = project(current)
  assert.equal(idle.teams[0].liveStatus.kind, 'idle', 'terminal pressure history cannot outlive the recovered one-shot worker')
  assert.deepEqual(idle.teams[0].liveStatus.admission, { active: 0, queued: 0, quarantined: 0, limit: 0, waitMs: 0 })

  const pending = structuredClone(current)
  pending.tasks[0].state = 'pending'
  delete pending.tasks[0].assigneeSessionId
  pending.revision += 1
  pending.updatedAt = iso(600)
  const pendingProjection = project(pending)
  assert.equal(pendingProjection.teams[0].liveStatus.kind, 'backpressure', 'an unresolved unassigned pending task still projects its current admission pressure')
  assert.deepEqual(pendingProjection.teams[0].liveStatus.admission, { active: 8, queued: 2, quarantined: 1, limit: 8, waitMs: 900 })

  const prepared = structuredClone(current)
  prepared.memberRecoveries = [{ requestId: 'prepared-recovery', action: 'retry', phase: 'retry_awaiting_admission', status: 'prepared', memberId: worker.id, updatedAt: iso(700), admission: { active: 8, queued: 1, quarantined: 0, limit: 8, waitMs: 400 } }]
  prepared.revision += 1
  prepared.updatedAt = iso(700)
  const preparedProjection = project(prepared)
  assert.equal(preparedProjection.teams[0].liveStatus.kind, 'backpressure', 'a prepared recovery remains live admission pressure')
  assert.deepEqual(preparedProjection.teams[0].liveStatus.admission, { active: 8, queued: 1, quarantined: 0, limit: 8, waitMs: 400 })
  prepared.memberRecoveries[0].status = 'outcome_unknown'
  prepared.memberRecoveries[0].phase = 'start_dispatched'
  const unknownProjection = project(prepared)
  assert.equal(unknownProjection.teams[0].liveStatus.kind, 'outcome_unknown', 'an outcome-unknown recovery keeps its stronger live state')
  assert.deepEqual(unknownProjection.teams[0].liveStatus.admission, { active: 8, queued: 1, quarantined: 0, limit: 8, waitMs: 400 })
})

test('task revision and event sequence advance the authoritative board cursor without timestamp churn', async () => {
  const mod = await import(`${boardUrl}?live-order=${Date.now()}-${Math.random()}`)
  const current = team(projectA, 47, 1, { prefix: 'live-order' })
  current.tasks[0].revision = 3
  current.tasks[0].lifecycleLedger = [{ kind: 'claim', sequence: 1, at: iso(100) }]
  const first = mod.createProjectTeamBoard(projectA, [current], { cursorIntegrityKey: cursorKey })
  const revisedTask = structuredClone(current)
  revisedTask.tasks[0].revision = 4
  const second = mod.createProjectTeamBoard(projectA, [revisedTask], { cursorIntegrityKey: cursorKey })
  const sequencedTask = structuredClone(revisedTask)
  sequencedTask.tasks[0].lifecycleLedger.push({ kind: 'submission', sequence: 2, at: iso(100) })
  const third = mod.createProjectTeamBoard(projectA, [sequencedTask], { cursorIntegrityKey: cursorKey })
  assert.notEqual(first.cursor, second.cursor)
  assert.notEqual(second.cursor, third.cursor)
  assert.equal(third.teams[0].eventSequence, 2)
  assert.equal(third.teams[0].tasks[0].eventSequence, 2)
})

test('project team board HMAC cursors reject tamper, cross-project replay, and stale revisions without exposing routing data', async () => {
  const mod = await import(`${boardUrl}?security=${Date.now()}-${Math.random()}`)
  const teams = [team(projectA, 0, 121)]
  const first = mod.createProjectTeamBoard(projectA, teams, { cursorIntegrityKey: cursorKey })
  const cursor = first.page.nextCursor
  assert.ok(cursor)
  assert.equal(cursor.includes(projectA), false)
  assert.equal(cursor.includes('session'), false)
  assert.equal(cursor.includes('path'), false)

  const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`
  assert.throws(() => mod.createProjectTeamBoardPage(projectA, teams, { cursor: tampered, cursorIntegrityKey: cursorKey }), (error) => error.code === 'AGENT_TEAMS_PROJECT_BOARD_CURSOR_INVALID')
  assert.throws(() => mod.createProjectTeamBoardPage(projectB, [team(projectB, 0, 121)], { cursor, cursorIntegrityKey: cursorKey }), (error) => error.code === 'AGENT_TEAMS_PROJECT_BOARD_CURSOR_INVALID')
  const revised = teams.map((entry) => ({ ...entry, revision: entry.revision + 1, updatedAt: iso(30_000) }))
  assert.throws(() => mod.createProjectTeamBoardPage(projectA, revised, { cursor, cursorIntegrityKey: cursorKey }), (error) => error.code === 'AGENT_TEAMS_PROJECT_BOARD_CURSOR_STALE' && error.stale === true)
})

test('root recovery decoration byte-budgets max-length multi-team receipts with progressive reachability', async () => {
  const mod = await import(`${boardUrl}?recovery-bytes=${Date.now()}-${Math.random()}`)
  const rootSessionId = 'recovery-root'
  const teams = Array.from({ length: 24 }, (_, index) => {
    const current = team(projectA, index, 3, { prefix: 'recovery-bytes' })
    current.id = `${String(index).padStart(2, '0')}${'界'.repeat(254)}`
    current.rootLeadSessionId = rootSessionId
    for (const task of current.tasks) task.title = '界'.repeat(240)
    const memberId = `${String(index).padStart(2, '0')}${'员'.repeat(254)}`, memberSessionId = `recovery-worker-${index}`
    current.members.push({ id: memberId, sessionId: memberSessionId, name: '😀'.repeat(80), role: 'recovery', kind: 'worker', state: 'failed', createdAt: iso(index), updatedAt: iso(index + 1) })
    current.tasks[0].assigneeSessionId = memberSessionId
    current.memberRecoveries = [{ requestId: `${String(index).padStart(2, '0')}${'请'.repeat(254)}`, action: 'replace', phase: 'followup_dispatching', status: 'outcome_unknown', memberId }]
    return current
  })
  const base = mod.createProjectTeamBoard(projectA, teams, { cursorIntegrityKey: cursorKey })
  assert.ok(base.teams.length > 1)
  assert.deepEqual(mod.decorateProjectTeamBoardRecovery(base, teams, 'foreign-root'), base, 'foreign roots never receive recovery projection')

  const first = mod.decorateProjectTeamBoardRecovery(base, teams, rootSessionId)
  const firstRecoveries = first.teams.flatMap(entry => entry.memberRecovery?.unresolved || [])
  const firstRemaining = first.teams.reduce((total, entry) => total + (entry.memberRecovery?.unresolvedRemaining || 0), 0)
  assert.ok(firstRecoveries.length > 0)
  assert.ok(firstRemaining > 0, 'byte overflow must be honestly reported instead of exceeding the page budget')
  assert.ok(first.teams.some(entry => entry.memberRecovery?.unresolvedTruncated === true))
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= mod.UI_PROJECT_TEAM_BOARD_MAX_BYTES)
  for (const item of firstRecoveries) assert.equal(item.requestId.length, 256, 'action requestId is preserved whole')

  const visible = new Set(firstRecoveries.map(item => item.requestId))
  const hidden = first.teams.flatMap(entry => {
    const source = teams.find(candidate => candidate.id === entry.id)
    return (source?.memberRecoveries || []).filter(receipt => !visible.has(receipt.requestId)).map(receipt => receipt.requestId)
  })
  assert.ok(hidden.length > 0)
  for (const current of teams) for (const receipt of current.memberRecoveries || []) if (visible.has(receipt.requestId)) receipt.status = 'delivered'
  const next = mod.decorateProjectTeamBoardRecovery(base, teams, rootSessionId)
  const nextVisible = next.teams.flatMap(entry => entry.memberRecovery?.unresolved || []).map(item => item.requestId)
  assert.ok(nextVisible.some(requestId => hidden.includes(requestId)), 'resolving earlier receipts reveals a previously hidden exact request')
  assert.ok(Buffer.byteLength(JSON.stringify(next)) <= mod.UI_PROJECT_TEAM_BOARD_MAX_BYTES)
})

test('host project-board cache is LRU-bounded to prepared plus first page and subsequent pages do not grow it', async () => {
  const mod = await import(`${pluginUrl}?cache=${Date.now()}-${Math.random()}`)
  const projects = Array.from({ length: 18 }, (_, index) => index.toString(16).padStart(64, index.toString(16)))
  const document = { teams: projects.map((projectKey, index) => team(projectKey, index, index === 0 ? 361 : 1, { prefix: 'cache' })) }
  for (let index = 0; index < document.teams.length; index += 1) {
    const current = document.teams[index]
    mod.projectTeamBoardPage(document, current.members[0].sessionId, current.id)
    assert.ok(mod.projectTeamBoardCacheSize(document) <= mod.UI_PROJECT_TEAM_BOARD_CACHE_MAX_PROJECTS)
  }
  assert.equal(mod.projectTeamBoardCacheSize(document), 16)

  const large = document.teams[0]
  let page = mod.projectTeamBoardPage(document, large.members[0].sessionId, large.id)
  let count = 0
  while (true) {
    count += page.page.includedTasks
    if (!page.page.hasMore) break
    page = mod.projectTeamBoardPage(document, large.members[0].sessionId, large.id, page.page.nextCursor)
    assert.equal(mod.projectTeamBoardCacheSize(document), 16, 'cursor pages must not create page-cache entries')
  }
  assert.equal(count, 361)
})

test('Host restart reconciliation bumps each changed team revision once and repeated init is a zero-publication no-op', async () => {
  const mod = await import(`${pluginUrl}?restart-revision=${Date.now()}-${Math.random()}`)
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-team-restart-revision-'))
  const file = path.join(root, 'agent-teams.json')
  const initial = new mod.AgentTeamsStore(file)
  let restored
  try {
    await initial.init()
    await initial.mutate(document => { document.settings.enabled = true })
    const created = await mod.createTeam(initial, { id: 'restart-lead' }, { objective: 'Restart revision boundary' })
    const unchanged = await mod.createTeam(initial, { id: 'restart-lead' }, { objective: 'Unchanged restart control' })
    await initial.mutate(document => {
      document.teams.find(candidate => candidate.id === created.id).members[0].state = 'ready'
      document.teams.find(candidate => candidate.id === unchanged.id).members[0].state = 'ready'
    })
    await initial.init()
    const timestamp = new Date().toISOString()
    await initial.mutate(document => {
      const current = document.teams.find(candidate => candidate.id === created.id)
      current.members.push({ id: 'restart-worker', sessionId: 'restart-worker', name: 'Worker', role: 'work', kind: 'worker', state: 'running', runId: 'run-before-restart', createdAt: timestamp, updatedAt: timestamp })
      current.tasks.push({ id: 'restart-task', title: 'Interrupted work', state: 'in_progress', revision: 1, dependsOn: [], files: [], assigneeSessionId: 'restart-worker', claimedAt: timestamp, attempt: 1, claimId: 'restart-claim', leaseEpoch: 0, attemptHistory: [], interruptionHistory: [], lifecycleLedger: [], capabilities: [], externalEffects: [], createdAt: timestamp, updatedAt: timestamp })
      current.messages.push({ id: 'restart-message', fromSessionId: 'restart-lead', toSessionId: 'restart-worker', body: 'sent-time body', status: 'pending', createdAt: timestamp })
    })
    const beforeDocument = initial.snapshot()
    const before = beforeDocument.teams.find(candidate => candidate.id === created.id)
    const unchangedBeforeRevision = beforeDocument.teams.find(candidate => candidate.id === unchanged.id).revision
    const beforeRevision = before.revision
    initial.close()

    restored = new mod.AgentTeamsStore(file)
    let reconciliationPublications = 0
    const unsubscribeReconciliation = restored.subscribe(() => { reconciliationPublications += 1 })
    await restored.init()
    unsubscribeReconciliation()
    const reconciled = restored.snapshot().teams.find(candidate => candidate.id === created.id)
    assert.equal(reconciled.members.find(member => member.id === 'restart-worker').state, 'failed')
    assert.equal(reconciled.tasks.find(task => task.id === 'restart-task').revision, 2)
    assert.equal(reconciled.tasks.find(task => task.id === 'restart-task').interruptionHistory.at(-1).kind, 'host_restart_during_active_task')
    assert.equal(reconciled.messages.find(message => message.id === 'restart-message').status, 'failed')
    assert.equal(reconciled.revision, beforeRevision + 1, 'all member/task/message restart rewrites advance the containing team clock exactly once')
    assert.equal(restored.snapshot().teams.find(candidate => candidate.id === unchanged.id).revision, unchangedBeforeRevision, 'restart does not bump an unchanged team')
    assert.equal(reconciliationPublications, 1)

    const durableBeforeRepeat = await readFile(file, 'utf8')
    let repeatedPublications = 0
    const unsubscribeRepeated = restored.subscribe(() => { repeatedPublications += 1 })
    await restored.init()
    unsubscribeRepeated()
    assert.equal(restored.snapshot().teams.find(candidate => candidate.id === created.id).revision, reconciled.revision)
    assert.equal(await readFile(file, 'utf8'), durableBeforeRepeat, 'a no-op init performs no durable rewrite')
    assert.equal(repeatedPublications, 0, 'a no-op init performs no Host publication')
  } finally {
    initial.close()
    restored?.close()
    await rm(root, { recursive: true, force: true })
  }
})
