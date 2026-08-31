const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHmac, randomBytes } = require('node:crypto')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const indexUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')).href

function root(id, cwd) {
  return { id, status: 'running', session: { header: { cwd }, events: [{ type: 'turn/start', id: `turn-${id}`, time: 1 }, { type: 'user/message', data: { source: { kind: 'user' } } }] } }
}

async function registeredFixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'continuous-root-'))
  const projectRef = 'project_continuous_real_roots_01'
  const databasePath = path.join(temporary, 'tasks.sqlite')
  const key = randomBytes(32)
  const internal = Object.freeze(Object.create(null))
  const roots = ['fast', 'slow-a', 'slow-b'].map(id => root(`continuous-${id}`, path.join(temporary, id)))
  let current = roots[0]
  const tools = new Map()
  const projectEntry = { localProjectCollaborationContext: async () => {
    let disposed = false
    const context = { projectRef, databasePath }
    Object.defineProperties(context, {
      execution: { value: internal },
      actorResolver: { value: (candidate, requested) => { if (disposed || candidate !== internal || requested !== projectRef) throw new Error('stale context'); return { projectRef, actorRef: 'authority_owner', kind: 'human', role: 'owner' } } },
      keyProvider: { value: requested => { if (disposed || requested !== projectRef) throw new Error('stale key'); return Buffer.from(key) } },
      dispose: { value: () => { disposed = true } },
    })
    return Object.freeze(context)
  } }
  const ctx = { agents: { roots: () => roots, get: id => roots.find(value => value.id === id), currentInitiator: () => current }, tools: { register: tool => tools.set(tool.name, tool) }, systemPrompt: { section: () => {} } }
  const mod = await import(`${indexUrl}?continuous=${Date.now()}-${Math.random()}`)
  mod.registerProjectCollaborationTools(ctx, projectEntry, { redeemAdoption: async () => { throw new Error('unused') } })
  const invoke = (agent, name, args) => { current = agent; return tools.get(name).execute(args, { agent }) }
  return { temporary, projectRef, databasePath, key, roots, invoke, cleanup: async () => { key.fill(0); await rm(temporary, { recursive: true, force: true }) } }
}

test('three registered top-level roots continuously claim ten tasks; the fast root takes the fourth while every root remains single-flight', async () => {
  const fx = await registeredFixture()
  try {
    const [fast, slowA, slowB] = fx.roots
    assert.equal((await fx.invoke(fast, 'project_collaboration', { action: 'initialize', payload: { title: 'Continuous queue' } })).ok, true)
    for (let index = 0; index < 10; index += 1) {
      const created = await fx.invoke(fast, 'project_task', { action: 'create', request_id: `create-${index}`, payload: { title: `Unequal task ${index}`, fileScope: [`src/${index}.js`] } })
      assert.equal(created.ok, true, JSON.stringify(created))
    }

    let request = 0
    const claim = agent => fx.invoke(agent, 'project_task', { action: 'claim_next', request_id: `claim-${request++}`, payload: {} })
    const cancel = (agent, result, suffix) => fx.invoke(agent, 'project_task', { action: 'transition', request_id: `cancel-${suffix}`, task_ref: result.task.taskRef, expected_revision: result.task.revision, payload: { to: 'canceled' } })
    const first = [await claim(fast), await claim(slowA), await claim(slowB)]
    assert.deepEqual(first.map(value => value.status), ['claimed', 'claimed', 'claimed'])
    assert.equal(new Set(first.map(value => value.task.taskRef)).size, 3)
    for (const [agent, value] of [[fast, first[0]], [slowA, first[1]], [slowB, first[2]]]) {
      const occupied = await claim(agent)
      assert.equal(occupied.status, 'temporarily_empty')
      assert.equal(occupied.task.taskRef, value.task.taskRef)
    }

    assert.equal((await cancel(fast, first[0], 'fast-0')).task.status, 'canceled')
    const fourth = await claim(fast)
    assert.equal(fourth.status, 'claimed')
    assert.notEqual(fourth.task.taskRef, first[0].task.taskRef)
    assert.equal((await claim(fast)).status, 'temporarily_empty', 'the fast root may continue but never hoard two in-progress tasks')

    const claimed = [...first.map(value => value.task.taskRef), fourth.task.taskRef]
    let active = fourth
    while (claimed.length < 10) {
      assert.equal((await cancel(fast, active, `fast-${claimed.length}`)).task.status, 'canceled')
      active = await claim(fast)
      assert.equal(active.status, 'claimed')
      assert.equal(claimed.includes(active.task.taskRef), false)
      claimed.push(active.task.taskRef)
    }
    assert.equal((await cancel(fast, active, 'fast-final')).task.status, 'canceled')
    assert.equal((await cancel(fast, first[1], 'slow-a')).task.status, 'canceled')
    assert.equal((await cancel(fast, first[2], 'slow-b')).task.status, 'canceled')
    assert.equal(new Set(claimed).size, 10)
    const terminal = [await claim(fast), await claim(slowA), await claim(slowB)]
    assert.deepEqual(terminal.map(value => value.status), ['all_terminal', 'all_terminal', 'all_terminal'])
  } finally { await fx.cleanup() }
})

test('request release atomically migrates owner, assignee and only their locks; stale and replayed races cannot partially write', async () => {
  const { ProjectTaskStore } = await import(`${storeUrl}?request=${Date.now()}-${Math.random()}`)
  const root = await mkdtemp(path.join(os.tmpdir(), 'continuous-request-'))
  const filePath = path.join(root, 'tasks.sqlite'), projectRef = 'project_continuous_request_01', key = randomBytes(32)
  const store = new ProjectTaskStore({ filePath, keyProvider: ref => ref === projectRef ? key : undefined })
  store.initialize()
  try {
    const lead = 'actor_lead', requester = 'actor_requester', owner = 'actor_owner', assignee = 'actor_assignee', third = 'actor_third'
    const create = (taskRef, actorRef, status) => store.createTask({ projectRef, commandId: `command_${taskRef}`, eventRef: `event_${taskRef}`, expectedRevision: 0, actorRef, createdAt: 1, task: { taskRef, status, ownerActorRef: actorRef, assigneeActorRef: actorRef, title: taskRef, requirements: {}, fileScope: [] }, eventPayload: {} })
    create('task_blocked', requester, 'blocked'); create('task_dependency', assignee, 'in_progress')
    store.database.prepare('UPDATE project_tasks SET owner_actor_ref=? WHERE project_ref=? AND task_ref=?').run(owner, projectRef, 'task_dependency')
    store.database.prepare("INSERT INTO project_task_relations(project_ref,relation_ref,source_task_ref,target_task_ref,type,created_by_actor_ref,created_at) VALUES(?,?,?,?,?,?,?)").run(projectRef, 'relation_wait', 'task_dependency', 'task_blocked', 'blocks', lead, 2)
    store.createCollaborationBoard({ projectRef, coordinatorActorRef: lead, title: 'Requests', createdAt: 3 })
    for (const [resourceRef, actorRef] of [['src/owner', owner], ['src/assignee', assignee], ['src/third', third]]) store.acquireCollaborationLock({ projectRef, resourceRef, ownerActorRef: actorRef, taskRef: 'task_dependency', updatedAt: 4 })
    const opened = store.createCollaborationRequest({ projectRef, requestRef: 'request_release', requestId: 'request-release-id', kind: 'takeover', taskRef: 'task_blocked', dependencyTaskRef: 'task_dependency', requesterActorRef: requester, reason: 'blocked', respondByAt: 100, createdAt: 5 })
    assert.equal(opened.request.targetActorRef, assignee)
    assert.throws(() => store.respondCollaborationRequest({ projectRef, requestRef: 'request_release', actorRef: owner, expectedRevision: 1, action: 'release', resolution: 'wrong target', updatedAt: 6 }), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')
    const released = store.respondCollaborationRequest({ projectRef, requestRef: 'request_release', actorRef: assignee, expectedRevision: 1, action: 'release', resolution: 'handoff', updatedAt: 7 })
    assert.equal(released.request.state, 'resolved')
    assert.deepEqual({ owner: store.getTask({ projectRef, taskRef: 'task_dependency' }).ownerActorRef, assignee: store.getTask({ projectRef, taskRef: 'task_dependency' }).assigneeActorRef }, { owner: requester, assignee: requester })
    const locks = Object.fromEntries(store.readCollaborationSnapshot({ projectRef }).locks.map(lock => [lock.resourceRef, lock.ownerActorRef]))
    assert.deepEqual(locks, { 'src/assignee': requester, 'src/owner': requester, 'src/third': third })
    assert.throws(() => store.respondCollaborationRequest({ projectRef, requestRef: 'request_release', actorRef: assignee, expectedRevision: 1, action: 'release', resolution: 'stale', updatedAt: 8 }), error => error.code === 'PROJECT_COLLABORATION_CONFLICT')
  } finally { store.close(); key.fill(0); await rm(root, { recursive: true, force: true }) }
})
