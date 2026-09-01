const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
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
