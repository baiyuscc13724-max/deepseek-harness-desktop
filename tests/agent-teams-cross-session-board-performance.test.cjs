const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, rm } = require('node:fs/promises')
const { performance } = require('node:perf_hooks')
const { pathToFileURL } = require('node:url')

const boardUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-team-board.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')).href
const projectKey = 'c'.repeat(64)
const cursorKey = Buffer.alloc(32, 11)

function team(index, count) {
  const id = `perf-team-${index}`
  const sessionId = `${id}-lead`
  const timestamp = new Date(Date.parse('2026-02-01T00:00:00.000Z') + index).toISOString()
  return {
    id, projectKey, rootLeadSessionId: sessionId, name: `Performance ${index}`, revision: 1, state: index % 6 === 0 ? 'closed' : 'active', createdAt: timestamp, updatedAt: timestamp,
    members: [{ id: `lead:${sessionId}`, sessionId, name: `Lead ${index}`, role: 'lead', kind: 'lead', state: 'ready', createdAt: timestamp, updatedAt: timestamp }],
    messages: [], plan: { phase: 'active' },
    tasks: Array.from({ length: count }, (_, taskIndex) => ({ id: `${id}-task-${taskIndex}`, title: `${'界面验证'.repeat(40)} ${taskIndex}`, state: taskIndex % 4 === 0 ? 'completed' : 'pending', dependsOn: [], crossTeamDependsOn: [], capabilities: [], externalEffects: [], assigneeSessionId: sessionId, createdAt: timestamp, updatedAt: timestamp })),
  }
}

test('24 busy teams paginate thousands of tasks within bounded pages and practical CPU time', async () => {
  const mod = await import(`${boardUrl}?perf=${Date.now()}-${Math.random()}`)
  const teams = Array.from({ length: 24 }, (_, index) => team(index, 250))
  const started = performance.now()
  let page = mod.createProjectTeamBoard(projectKey, teams, { cursorIntegrityKey: cursorKey })
  let pages = 0
  let tasks = 0
  const ids = new Set()
  do {
    pages += 1
    tasks += page.page.includedTasks
    for (const entry of page.teams) for (const task of entry.tasks) {
      assert.equal(ids.has(task.id), false)
      ids.add(task.id)
    }
    assert.equal(page.stats.totalTeams, 20, 'four closed teams are excluded from the exact visible team total')
    assert.equal(page.stats.totalTasks, 5_000, 'closed-team tasks are excluded from the exact visible task total')
    assert.ok(page.page.includedTasks <= 120)
    assert.ok(page.page.includedTeams <= 24)
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 128 * 1024)
    page = page.page.hasMore ? mod.createProjectTeamBoardPage(projectKey, teams, { cursor: page.page.nextCursor, cursorIntegrityKey: cursorKey }) : null
  } while (page)
  const elapsedMs = performance.now() - started
  assert.equal(tasks, 5_000)
  assert.equal(ids.size, 5_000)
  for (let index = 0; index < 24; index += 6) assert.equal([...ids].some((id) => id.startsWith(`perf-team-${index}-task-`)), false, `closed team ${index} must remain absent from every cursor page`)
  assert.ok(pages >= Math.ceil(5_000 / 120), 'the 120-task page budget remains enforced across all visible tasks')
  assert.ok(elapsedMs < 8_000, `pagination took ${elapsedMs.toFixed(1)}ms`)
})

test('project task status-rank keysets traverse 600 rows in 24-item windows without DOM-scale materialization', async () => {
  const mod = await import(`${storeUrl}?perf=${Date.now()}-${Math.random()}`)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-rank-perf-')), filePath = path.join(root, 'tasks.sqlite'), projectRef = `project_${'P'.repeat(24)}`, key = randomBytes(32)
  const store = new mod.ProjectTaskStore({ filePath, keyProvider: ref => ref === projectRef ? key : undefined })
  store.initialize()
  try {
    const actorRef = `actor_${'R'.repeat(24)}`, groups = ['canceled', 'done', 'todo', 'blocked', 'in_review', 'in_progress']
    store.createCollaborationBoard({ projectRef, coordinatorActorRef: actorRef, title: 'rank performance', createdAt: 1 })
    for (let group = 0; group < groups.length; group += 1) for (let index = 0; index < 100; index += 1) {
      store.createTask({ projectRef, commandId: `command_perf_${group}_${index}`, eventRef: `event_perf_${group}_${index}`, expectedRevision: 0, actorRef, createdAt: 1000 + (index % 10), task: { taskRef: `task_perf_${group}_${String(index).padStart(3, '0')}`, status: groups[group], priority: index % 5, ownerActorRef: actorRef, title: `跨页性能 ${groups[group]} ${index}`, requirements: {}, fileScope: [] }, eventPayload: {} })
    }
    const started = performance.now(), seen = [], ranks = { in_progress: 0, in_review: 1, blocked: 2, pending: 3, completed: 4, canceled: 5 }
    let boundary
    do {
      const page = store.readCollaborationSectionWindow({ projectRef, section: 'tasks', limit: 24, ...(boundary ? { boundary, expectedProjectRevision: store.getProjectRevision(projectRef) } : {}) })
      assert.ok(page.items.length <= 24)
      assert.deepEqual(page.taskGroupTotals, { in_progress: 100, in_review: 100, blocked: 100, pending: 100, completed: 100, canceled: 100 })
      for (const task of page.items) seen.push([task.taskRef, ranks[task.statusGroup]])
      boundary = page.nextBoundary
    } while (boundary)
    const elapsedMs = performance.now() - started
    assert.equal(seen.length, 600)
    assert.equal(new Set(seen.map(item => item[0])).size, 600)
    assert.equal(seen.every((item, index) => index === 0 || seen[index - 1][1] <= item[1]), true)
    assert.ok(elapsedMs < 4_000, `ranked pagination took ${elapsedMs.toFixed(1)}ms`)
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})
