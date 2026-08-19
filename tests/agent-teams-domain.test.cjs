const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, rm, stat } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
let pluginPromise
function plugin() {
  pluginPromise ||= import(`${pathToFileURL(pluginFile).href}?test=${Date.now()}`)
  return pluginPromise
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-domain-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const mod = await plugin()
  const store = new mod.AgentTeamsStore(file)
  await store.init()
  return { root, file, mod, store }
}

function worker(id, name) {
  const timestamp = new Date().toISOString()
  return { id: `member-${id}`, sessionId: id, name, role: 'test worker', kind: 'worker', state: 'ready', createdAt: timestamp, updatedAt: timestamp }
}

test('disabled Agent Teams initialization creates no storage file', async () => {
  const fx = await fixture()
  try {
    assert.equal(fx.store.snapshot().settings.enabled, false)
    await fx.store.mutate(() => undefined)
    await assert.rejects(stat(fx.file), error => error && error.code === 'ENOENT')
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('shared tasks enforce dependencies and exactly one concurrent claimant', async () => {
  const fx = await fixture()
  try {
    await fx.store.mutate(document => { document.settings.enabled = true })
    const team = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Ship one verified feature' })
    await fx.store.mutate(document => {
      const current = document.teams.find(item => item.id === team.id)
      current.members.push(worker('worker-a', 'Alpha'), worker('worker-b', 'Beta'))
    })

    const base = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: team.id, title: 'Foundation', files: ['src/shared.js'] })).task
    const dependent = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: team.id, title: 'Integration', dependsOn: [base.id], files: ['src/shared.js'] })).task

    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: dependent.id, action: 'claim' }),
      error => error && error.code === 'AGENT_TEAMS_TASK_BLOCKED'
    )
    await fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: base.id, action: 'claim' })
    await fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: base.id, action: 'complete' })

    const claims = await Promise.allSettled([
      fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: dependent.id, action: 'claim' }),
      fx.mod.updateTask(fx.store, { id: 'worker-b' }, { teamId: team.id, taskId: dependent.id, action: 'claim' })
    ])
    assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(claims.filter(result => result.status === 'rejected').length, 1)

    const snapshot = fx.mod.teamSnapshot(fx.store.snapshot(), 'lead-session')
    const target = snapshot.team.tasks.find(task => task.id === dependent.id)
    assert.deepEqual(target.blockedBy, [])
    assert.equal(target.status, 'in_progress')
    assert.ok(['worker-a', 'worker-b'].includes(target.assignee))

    const assigned = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: team.id, title: 'Assignable', assigneeSessionId: 'worker-a' })).task
    const unassigned = (await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: assigned.id, action: 'unassign' })).task
    assert.equal(unassigned.assigneeSessionId, undefined)

    await fx.store.mutate(document => { document.teams.find(item => item.id === team.id).state = 'closed' })
    await assert.rejects(
      fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: team.id, title: 'Archived mutation' }),
      error => error && error.code === 'AGENT_TEAMS_CLOSING'
    )
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('restart reconciles transient members and uncertain outbox messages', async () => {
  const fx = await fixture()
  try {
    await fx.store.mutate(document => { document.settings.enabled = true })
    const team = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Recover safely' })
    await fx.store.mutate(document => {
      const current = document.teams.find(item => item.id === team.id)
      const member = worker('worker-a', 'Alpha')
      member.state = 'running'
      current.members.push(member)
      current.messages.push({
        id: 'message-pending', fromSessionId: 'lead-session', toSessionId: 'worker-a', body: 'once only', status: 'pending', createdAt: new Date().toISOString()
      })
    })

    const restored = new fx.mod.AgentTeamsStore(fx.file)
    await restored.init()
    const state = restored.snapshot().teams.find(item => item.id === team.id)
    assert.equal(state.members.find(member => member.sessionId === 'worker-a').state, 'ready')
    const message = state.messages.find(item => item.id === 'message-pending')
    assert.equal(message.status, 'failed')
    assert.match(message.deliveryError, /retry manually/u)
    const uiMessage = fx.mod.teamSnapshot(restored.snapshot(), 'lead-session').team.messages.find(item => item.id === 'message-pending')
    assert.equal(uiMessage.body, undefined)
    assert.equal(uiMessage.text, undefined)
    assert.equal(uiMessage.deliveryError, undefined)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('active tasks expose overlapping file conflict warnings', async () => {
  const fx = await fixture()
  try {
    const now = new Date().toISOString()
    const tasks = [
      { id: 'a', title: 'A', state: 'in_progress', dependsOn: [], files: ['src/shared.js'], assigneeSessionId: 'worker-a', createdAt: now, updatedAt: now },
      { id: 'b', title: 'B', state: 'in_progress', dependsOn: [], files: ['src/shared.js'], assigneeSessionId: 'worker-b', createdAt: now, updatedAt: now }
    ]
    assert.deepEqual(fx.mod.deriveTask(tasks[0], tasks).conflictsWith, ['b'])
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})
