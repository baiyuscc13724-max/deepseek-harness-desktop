const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const registryUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-entry-registry.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')).href
const webUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-web.js')).href
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function baseProjectEntry(home) {
  const projectRef = 'project_authority_multi_project_01', key = randomBytes(32), internal = Object.freeze(Object.create(null))
  return { key, async localProjectTaskContext() {
    let disposed = false
    const context = { projectRef, databasePath: path.join(home, 'storages', 'agent_project_tasks.sqlite') }
    Object.defineProperties(context, {
      execution: { value: internal },
      actorResolver: { value: (candidate, requested) => { if (disposed || candidate !== internal || requested !== projectRef) throw new Error('stale authority'); return { projectRef, actorRef: 'authority_actor', kind: 'human', role: 'owner' } } },
      keyProvider: { value: requested => { if (disposed || requested !== projectRef) throw new Error('stale key'); return Buffer.from(key) } },
      dispose: { value: () => { disposed = true } },
    })
    return Object.freeze(context)
  } }
}

function fixedEntry(registry, canonicalProjectKey) {
  return { localProjectTaskContext: () => registry.localProjectTaskContext({ canonicalProjectKey }) }
}

test('sixteen canonical projects keep SQLite, keys, cursors, caches and SSE queues isolated while slow work cannot stall a fast lane', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'multi-project-qa-'))
  const base = baseProjectEntry(root)
  const [{ ProjectEntryRegistry }, { ProjectTaskStore }, { ProjectTaskWebRuntime, MAX_WEB_TASKS, MAX_WEB_TASK_PAGE_BYTES }] = await Promise.all([
    import(`${registryUrl}?multi=${Date.now()}-${Math.random()}`),
    import(`${storeUrl}?multi=${Date.now()}-${Math.random()}`),
    import(`${webUrl}?multi=${Date.now()}-${Math.random()}`),
  ])
  const registry = new ProjectEntryRegistry({ projectEntry: base, dshHome: root })
  const projects = Array.from({ length: 16 }, (_, index) => index.toString(16).repeat(64))
  const observed = []
  try {
    for (let projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
      const context = await registry.localProjectTaskContext({ canonicalProjectKey: projects[projectIndex] })
      observed.push({ projectRef: context.projectRef, databasePath: context.databasePath })
      const store = new ProjectTaskStore({ filePath: context.databasePath, keyProvider: context.keyProvider })
      store.initialize()
      try {
        const count = projectIndex === 0 ? 131 : 1
        for (let index = 0; index < count; index += 1) store.createTask({ projectRef: context.projectRef, commandId: `command_${projectIndex}_${index}`, eventRef: `event_${projectIndex}_${index}`, expectedRevision: 0, actorRef: `actor_${projectIndex}`, createdAt: 1_900_000_000_000, task: { taskRef: `task_${projectIndex}_${String(index).padStart(4, '0')}`, status: 'todo', ownerActorRef: `actor_${projectIndex}`, title: `${'大数据页'.repeat(120)} ${projectIndex}/${index}`, requirements: {}, fileScope: [] }, eventPayload: {} })
      } finally { store.close(); context.dispose() }
    }
    assert.equal(new Set(observed.map(value => value.projectRef)).size, 16)
    assert.equal(new Set(observed.map(value => value.databasePath)).size, 16)
    assert.equal((await readdir(path.join(root, 'storages', 'project_lanes'), { withFileTypes: true })).filter(entry => entry.isDirectory()).length, 16)

    const original = registry.localProjectTaskContext.bind(registry)
    registry.localProjectTaskContext = async options => { if (options.canonicalProjectKey === projects[0]) await delay(160); return original(options) }
    const completion = []
    const slow = registry.localProjectTaskContext({ canonicalProjectKey: projects[0] }).then(context => { completion.push('slow'); context.dispose() })
    await delay(5)
    const fast = registry.localProjectTaskContext({ canonicalProjectKey: projects[1] }).then(context => { completion.push('fast'); context.dispose() })
    await Promise.all([slow, fast])
    assert.deepEqual(completion, ['fast', 'slow'])

    const cursorKey = Buffer.alloc(32, 29)
    const firstRuntime = new ProjectTaskWebRuntime({ projectEntry: fixedEntry(registry, projects[0]), randomBytesImpl: () => cursorKey })
    const secondRuntime = new ProjectTaskWebRuntime({ projectEntry: fixedEntry(registry, projects[1]), randomBytesImpl: () => cursorKey })
    const firstEvents = [], secondEvents = []
    const unsubscribeA = firstRuntime.subscribe(event => firstEvents.push(event))
    const unsubscribeB = secondRuntime.subscribe(event => secondEvents.push(event))
    try {
      let page = await firstRuntime.state(), firstCursor = page.page.nextCursor, count = 0, ids = []
      assert.equal(MAX_WEB_TASKS, 120)
      assert.equal(MAX_WEB_TASK_PAGE_BYTES, 128 * 1024)
      do {
        assert.equal(page.totalExact, true)
        assert.equal(page.totalTasks, 131)
        assert.ok(page.page.includedTasks <= 120, '120 is a page budget, never a project capacity')
        const pageBytes = Buffer.byteLength(JSON.stringify(page))
        assert.ok(pageBytes <= 128 * 1024, `browser state page is ${pageBytes} bytes, exceeding the 131072-byte transfer budget`)
        ids.push(...page.tasks.map(task => task.taskRef)); count += page.tasks.length
        page = page.page.hasMore ? await firstRuntime.page(page.page.nextCursor) : null
      } while (page)
      assert.equal(count, 131)
      assert.equal(new Set(ids).size, 131)
      await assert.rejects(secondRuntime.page(firstCursor), error => error.code === 'PROJECT_TASK_WEB_CURSOR_INVALID')
      const secondState = await secondRuntime.state()
      assert.equal(secondState.totalTasks, 1)
      assert.equal(secondState.tasks.some(task => task.taskRef.startsWith('task_0_')), false)

      await firstRuntime.action({ commandId: 'command_sse_lane_a', type: 'create', expectedRevision: 0, payload: { title: 'SSE only A' } })
      await delay(40)
      assert.ok(firstEvents.length > 0)
      assert.equal(secondEvents.length, 0, 'a foreign project mutation cannot enter this runtime subscription queue')
      const serialized = JSON.stringify({ observed: await firstRuntime.state(), secondState })
      for (const value of [...projects, ...observed.map(item => item.databasePath), ...observed.map(item => item.projectRef)]) assert.equal(serialized.includes(value), false)
      const laneFiles = await Promise.all(observed.map(item => readFile(item.databasePath)))
      assert.equal(laneFiles.every((bytes, index) => !bytes.includes(Buffer.from(`task_${(index + 1) % 16}_0000`))), true, 'raw plaintext from another lane never appears in a SQLite file')
    } finally { unsubscribeA(); unsubscribeB(); await Promise.all([firstRuntime.close(), secondRuntime.close()]) }
  } finally { base.key.fill(0); await registry.close(); await rm(root, { recursive: true, force: true }) }
})
