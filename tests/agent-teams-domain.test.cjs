const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
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

test('v1 store migration performs crash reconciliation in the same initialization', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-v1-migration-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const mod = await plugin()
  const timestamp = new Date().toISOString()
  const legacy = {
    version: 1,
    settings: { enabled: true, maxMembers: 4, maxActiveTurns: 3 },
    teams: [{
      id: 'legacy-team', rootLeadSessionId: 'legacy-lead', name: 'Legacy', objective: 'Preserve every record', revision: 7,
      state: 'active', createdAt: timestamp, updatedAt: timestamp,
      members: [
        { id: 'legacy-lead-id', sessionId: 'legacy-lead', name: 'Lead', role: 'root lead and coordinator', kind: 'lead', state: 'running', createdAt: timestamp, updatedAt: timestamp },
        { id: 'legacy-worker-id', sessionId: 'legacy-worker', name: 'Worker', role: 'legacy worker', kind: 'worker', state: 'idle', runId: 'legacy-run', createdAt: timestamp, updatedAt: timestamp }
      ],
      tasks: [{ id: 'legacy-task', title: 'Done', description: 'durable detail', state: 'completed', dependsOn: [], files: ['src/legacy.js'], assigneeSessionId: 'legacy-lead', createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp }],
      messages: [{ id: 'legacy-message', fromSessionId: 'legacy-lead', toSessionId: 'legacy-worker', body: 'pending durable body', status: 'pending', createdAt: timestamp }]
    }]
  }
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
    const store = new mod.AgentTeamsStore(file)
    await store.init()
    const migrated = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(migrated.version, 2)
    assert.deepEqual(migrated.settings, legacy.settings)
    const migratedTeam = migrated.teams[0]
    assert.equal(migratedTeam.members.find(member => member.sessionId === 'legacy-lead').state, 'ready')
    assert.equal(migratedTeam.members.find(member => member.sessionId === 'legacy-worker').state, 'ready')
    assert.equal(migratedTeam.members.find(member => member.sessionId === 'legacy-worker').runId, undefined)
    assert.equal(migratedTeam.messages[0].status, 'failed')
    assert.match(migratedTeam.messages[0].deliveryError, /retry manually/u)
    assert.deepEqual(migratedTeam.tasks, legacy.teams[0].tasks)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('persisted team and task records reject unsupported fields', async () => {
  const fx = await fixture()
  try {
    await fx.store.mutate(document => { document.settings.enabled = true })
    const team = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Strict records' })
    const rawTeam = fx.store.snapshot().teams.find(candidate => candidate.id === team.id)
    assert.throws(() => fx.mod.validateTeam({ ...rawTeam, injected: 'unsafe' }), /unsupported fields/u)
    const timestamp = new Date().toISOString()
    assert.throws(() => fx.mod.validateTask({
      id: 'strict-task', title: 'Strict', state: 'pending', dependsOn: [], files: [], createdAt: timestamp, updatedAt: timestamp, injected: 'unsafe'
    }), /unsupported fields/u)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('one fixed root lead may own multiple peer teams with explicit selection', async () => {
  const fx = await fixture()
  try {
    await fx.store.mutate(document => { document.settings.enabled = true })
    const first = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Team one' })
    const second = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Team two' })
    assert.notEqual(first.id, second.id)
    await assert.rejects(
      fx.mod.createTask(fx.store, { id: 'lead-session' }, { title: 'Ambiguous' }),
      error => error && error.code === 'AGENT_TEAMS_TEAM_REQUIRED'
    )
    const firstTask = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: first.id, title: 'First task' })).task
    const secondTask = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, {
      teamId: second.id, title: 'Second task', crossTeamDependsOn: [`${first.id}:${firstTask.id}`]
    })).task
    assert.deepEqual(secondTask.blockedBy, [`${first.id}:${firstTask.id}`])
    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: second.id, taskId: secondTask.id, action: 'claim' }),
      error => error && error.code === 'AGENT_TEAMS_TASK_BLOCKED'
    )
    await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: first.id, taskId: firstTask.id, action: 'claim' })
    await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: first.id, taskId: firstTask.id, action: 'complete' })
    const claimed = (await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: second.id, taskId: secondTask.id, action: 'claim' })).task
    assert.deepEqual(claimed.blockedBy, [])
    assert.deepEqual(claimed.dependencySources, [{ teamId: first.id, teamName: 'Team one', teamStatus: 'active' }])
    await fx.store.mutate(document => { document.teams.find(team => team.id === first.id).state = 'closed' })
    const afterCompletedSourceClosed = fx.mod.teamSnapshot(fx.store.snapshot(), 'lead-session', second.id).team.tasks.find(task => task.id === secondTask.id)
    assert.deepEqual(afterCompletedSourceClosed.blockedBy, [])
    assert.deepEqual(afterCompletedSourceClosed.dependencySources, [{ teamId: first.id, teamName: 'Team one', teamStatus: 'closed' }])
    assert.equal(JSON.stringify(afterCompletedSourceClosed).includes('src/'), false)

    const closingSource = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Closing source' })
    const incomplete = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: closingSource.id, title: 'Never completed' })).task
    const blockedAfterClose = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, {
      teamId: second.id, title: 'Blocked after source closes', crossTeamDependsOn: [`${closingSource.id}:${incomplete.id}`]
    })).task
    await fx.store.mutate(document => { document.teams.find(team => team.id === closingSource.id).state = 'closed' })
    const blockedProjection = fx.mod.teamSnapshot(fx.store.snapshot(), 'lead-session', second.id).team.tasks.find(task => task.id === blockedAfterClose.id)
    assert.deepEqual(blockedProjection.blockedBy, [`${closingSource.id}:${incomplete.id}`])
    assert.equal(blockedProjection.dependencySources[0].teamStatus, 'closed')
    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: second.id, taskId: blockedAfterClose.id, action: 'claim' }),
      error => error && error.code === 'AGENT_TEAMS_TASK_BLOCKED'
    )

    const foreign = await fx.mod.createTeam(fx.store, { id: 'foreign-lead' }, { objective: 'Foreign team' })
    const foreignTask = (await fx.mod.createTask(fx.store, { id: 'foreign-lead' }, { teamId: foreign.id, title: 'Foreign task' })).task
    await assert.rejects(
      fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: second.id, title: 'Forbidden dependency', crossTeamDependsOn: [`${foreign.id}:${foreignTask.id}`] }),
      error => error && error.code === 'AGENT_TEAMS_CROSS_TEAM_FORBIDDEN'
    )
    const snapshot = fx.mod.teamSnapshot(fx.store.snapshot(), 'lead-session')
    assert.equal(snapshot.teams.length, 3)
    assert.deepEqual(new Set(snapshot.teams.map(team => team.id)), new Set([first.id, second.id, closingSource.id]))
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('reopen and complete preserve dependency consistency', async () => {
  const fx = await fixture()
  try {
    await fx.store.mutate(document => { document.settings.enabled = true })
    const team = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Dependency consistency' })
    const prerequisite = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: team.id, title: 'Prerequisite' })).task
    const dependent = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: team.id, title: 'Dependent', dependsOn: [prerequisite.id] })).task
    await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: prerequisite.id, action: 'claim' })
    await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: prerequisite.id, action: 'complete' })
    await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: dependent.id, action: 'claim' })
    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: prerequisite.id, action: 'reopen' }),
      error => error && error.code === 'AGENT_TEAMS_TASK_CONFLICT'
    )
    await fx.store.mutate(document => { document.teams[0].tasks.find(task => task.id === prerequisite.id).state = 'pending' })
    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: dependent.id, action: 'complete' }),
      error => error && error.code === 'AGENT_TEAMS_TASK_BLOCKED'
    )
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('one root has an atomic hard limit of eight unclosed peer teams', async () => {
  const fx = await fixture()
  try {
    await fx.store.mutate(document => { document.settings.enabled = true })
    const created = []
    for (let index = 0; index < fx.mod.HARD_MAX_TEAMS_PER_ROOT - 1; index += 1) {
      created.push(await fx.mod.createTeam(fx.store, { id: 'bounded-lead' }, { objective: `Bounded team ${index + 1}` }))
    }
    const boundary = await Promise.allSettled([
      fx.mod.createTeam(fx.store, { id: 'bounded-lead' }, { objective: 'Boundary winner A' }),
      fx.mod.createTeam(fx.store, { id: 'bounded-lead' }, { objective: 'Boundary winner B' })
    ])
    assert.equal(boundary.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(boundary.filter(result => result.status === 'rejected' && result.reason?.code === 'AGENT_TEAMS_TEAM_LIMIT').length, 1)
    assert.equal(fx.store.snapshot().teams.filter(team => team.rootLeadSessionId === 'bounded-lead' && team.state !== 'closed').length, 8)
    await fx.store.mutate(document => { document.teams.find(team => team.id === created[0].id).state = 'closed' })
    await fx.mod.createTeam(fx.store, { id: 'bounded-lead' }, { objective: 'Replacement after close' })
    assert.equal(fx.store.snapshot().teams.filter(team => team.rootLeadSessionId === 'bounded-lead' && team.state !== 'closed').length, 8)
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('cross-team prerequisite completion and claim remain atomic across stores', async () => {
  const fx = await fixture()
  try {
    await fx.store.mutate(document => { document.settings.enabled = true })
    const source = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Atomic source' })
    const target = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Atomic target' })
    const prerequisite = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: source.id, title: 'Prerequisite' })).task
    await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: source.id, taskId: prerequisite.id, action: 'claim' })
    const dependent = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, {
      teamId: target.id, title: 'Dependent', crossTeamDependsOn: [`${source.id}:${prerequisite.id}`]
    })).task
    const peer = new fx.mod.AgentTeamsStore(fx.file)
    await peer.init()
    let unsafePublication = false
    fx.store.subscribe(document => {
      const sourceTask = document.teams.find(team => team.id === source.id)?.tasks.find(task => task.id === prerequisite.id)
      const targetTask = document.teams.find(team => team.id === target.id)?.tasks.find(task => task.id === dependent.id)
      if (targetTask?.state === 'in_progress' && sourceTask?.state !== 'completed') unsafePublication = true
    })
    const results = await Promise.allSettled([
      fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: target.id, taskId: dependent.id, action: 'claim' }),
      fx.mod.updateTask(peer, { id: 'lead-session' }, { teamId: source.id, taskId: prerequisite.id, action: 'complete' })
    ])
    assert.equal(results[1].status, 'fulfilled')
    assert.equal(unsafePublication, false)
    if (results[0].status === 'rejected') {
      assert.equal(results[0].reason.code, 'AGENT_TEAMS_TASK_BLOCKED')
      await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: target.id, taskId: dependent.id, action: 'claim' })
    }
    const final = await fx.store.read(document => ({
      source: document.teams.find(team => team.id === source.id).tasks.find(task => task.id === prerequisite.id).state,
      target: document.teams.find(team => team.id === target.id).tasks.find(task => task.id === dependent.id).state
    }))
    assert.deepEqual(final, { source: 'completed', target: 'in_progress' })
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('concurrent store instances serialize mutations without lost updates', async () => {
  const fx = await fixture()
  try {
    await fx.store.mutate(document => { document.settings.enabled = true })
    const team = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Shared disk race' })
    const peer = new fx.mod.AgentTeamsStore(fx.file)
    await peer.init()
    let observedTaskCount = 0
    fx.store.subscribe(document => { observedTaskCount = document.teams[0]?.tasks.length ?? 0 })
    await Promise.all([
      fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: team.id, title: 'Writer one' }),
      fx.mod.createTask(peer, { id: 'lead-session' }, { teamId: team.id, title: 'Writer two' })
    ])
    assert.equal((await fx.store.read(document => document.teams[0].tasks)).length, 2)
    assert.equal((await peer.read(document => document.teams[0].tasks)).length, 2)
    assert.equal(observedTaskCount, 2)
    const racingInit = new fx.mod.AgentTeamsStore(fx.file)
    await Promise.all([
      racingInit.init(),
      fx.mod.createTask(peer, { id: 'lead-session' }, { teamId: team.id, title: 'Writer during init' })
    ])
    assert.deepEqual(
      new Set((await fx.store.read(document => document.teams[0].tasks)).map(task => task.title)),
      new Set(['Writer one', 'Writer two', 'Writer during init'])
    )
    const order = []
    let enterFirst
    let releaseFirst
    const enteredFirst = new Promise(resolve => { enterFirst = resolve })
    const firstGate = new Promise(resolve => { releaseFirst = resolve })
    const firstOperation = fx.store.runOperation(async () => { order.push('first'); enterFirst(); await firstGate; order.push('first-done') })
    await enteredFirst
    const secondOperation = peer.runOperation(async () => { order.push('second') })
    await Promise.resolve()
    assert.deepEqual(order, ['first'])
    releaseFirst()
    await Promise.all([firstOperation, secondOperation])
    assert.deepEqual(order, ['first', 'first-done', 'second'])
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('persisted teams reject worker-to-root nesting across teams', async () => {
  const mod = await plugin()
  const timestamp = new Date().toISOString()
  const team = (id, rootLeadSessionId, members) => ({
    id, rootLeadSessionId, name: id, state: 'active', createdAt: timestamp, updatedAt: timestamp,
    members, tasks: [], messages: []
  })
  const lead = id => ({ id: `lead-${id}`, sessionId: id, name: `Lead ${id}`, role: 'root lead and coordinator', kind: 'lead', state: 'running', createdAt: timestamp, updatedAt: timestamp })
  const nested = {
    version: 2, settings: { enabled: true, maxMembers: 4, maxActiveTurns: 4 },
    teams: [
      team('outer', 'outer-root', [lead('outer-root'), worker('nested-session', 'Nested worker')]),
      team('nested', 'nested-session', [lead('nested-session')])
    ]
  }
  assert.throws(() => mod.validateStoreDocument(nested), /nested teams are forbidden/u)
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

test('task updates distinguish invalid state from caller permission failures', async () => {
  const fx = await fixture()
  try {
    await fx.store.mutate(document => { document.settings.enabled = true })
    const team = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Return actionable task errors' })
    await fx.store.mutate(document => { document.teams[0].members.push(worker('worker-a', 'Alpha')) })
    const task = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, {
      teamId: team.id, title: 'Lead-owned task', assigneeSessionId: 'lead-session'
    })).task

    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: task.id, action: 'complete' }),
      error => error?.code === 'AGENT_TEAMS_TASK_CONFLICT' && /pending/u.test(error.message)
    )
    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: task.id, action: 'claim' }),
      error => error?.code === 'AGENT_TEAMS_UNAUTHORIZED' && /assigned to another/u.test(error.message)
    )
    await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: task.id, action: 'claim' })
    for (const action of ['complete', 'release']) {
      await assert.rejects(
        fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: task.id, action }),
        error => error?.code === 'AGENT_TEAMS_UNAUTHORIZED' && /claimant or team lead/u.test(error.message)
      )
    }
    // Re-claiming by the same claimant is a safe no-op instead of a conflict.
    const replayed = (await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: task.id, action: 'claim' })).task
    assert.equal(replayed.status, 'in_progress')
    assert.equal(replayed.assignee, 'lead-session')
    // A different member still conflicts with the held claim.
    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: task.id, action: 'claim' }),
      error => error?.code === 'AGENT_TEAMS_TASK_CONFLICT' && /in_progress/u.test(error.message)
    )
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('repeated claim and assign are idempotent while different members still conflict', async () => {
  const fx = await fixture()
  try {
    await fx.store.mutate(document => { document.settings.enabled = true })
    const team = await fx.mod.createTeam(fx.store, { id: 'lead-session' }, { objective: 'Idempotent task handoff' })
    await fx.store.mutate(document => {
      const current = document.teams.find(item => item.id === team.id)
      current.members.push(worker('worker-a', 'Alpha'), worker('worker-b', 'Beta'))
    })
    const storedTask = id => fx.store.snapshot().teams.find(item => item.id === team.id).tasks.find(candidate => candidate.id === id)

    const task = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: team.id, title: 'Handoff', files: ['src/handoff.js'] })).task
    const claimed = (await fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: task.id, action: 'claim' })).task
    assert.equal(claimed.status, 'in_progress')
    assert.equal(claimed.assignee, 'worker-a')

    // A retried claim by the same claimant leaves the record byte-identical.
    const beforeReplay = storedTask(task.id)
    const replayed = (await fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: task.id, action: 'claim' })).task
    assert.equal(replayed.status, 'in_progress')
    assert.equal(replayed.assignee, 'worker-a')
    assert.equal(JSON.stringify(storedTask(task.id)), JSON.stringify(beforeReplay))

    // A different member still conflicts with the held claim.
    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'worker-b' }, { teamId: team.id, taskId: task.id, action: 'claim' }),
      error => error?.code === 'AGENT_TEAMS_TASK_CONFLICT' && /in_progress/u.test(error.message)
    )

    // The lead re-assigning the current in-progress assignee is a safe no-op.
    const beforeReassign = storedTask(task.id)
    const reassigned = (await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: task.id, action: 'assign', assigneeSessionId: 'worker-a' })).task
    assert.equal(reassigned.status, 'in_progress')
    assert.equal(reassigned.assignee, 'worker-a')
    assert.equal(JSON.stringify(storedTask(task.id)), JSON.stringify(beforeReassign))

    // Assigning a different member while the task is in progress stays a conflict.
    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: task.id, action: 'assign', assigneeSessionId: 'worker-b' }),
      error => error?.code === 'AGENT_TEAMS_TASK_CONFLICT' && /in_progress/u.test(error.message)
    )
    // Non-lead members can never assign, even idempotently.
    await assert.rejects(
      fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: task.id, action: 'assign', assigneeSessionId: 'worker-a' }),
      error => error?.code === 'AGENT_TEAMS_UNAUTHORIZED'
    )

    // Re-assigning the same pending assignee is also a safe no-op.
    const assigned = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: team.id, title: 'Preassigned', assigneeSessionId: 'worker-b' })).task
    const beforePendingReassign = storedTask(assigned.id)
    const reassignedPending = (await fx.mod.updateTask(fx.store, { id: 'lead-session' }, { teamId: team.id, taskId: assigned.id, action: 'assign', assigneeSessionId: 'worker-b' })).task
    assert.equal(reassignedPending.status, 'pending')
    assert.equal(reassignedPending.assignee, 'worker-b')
    assert.equal(JSON.stringify(storedTask(assigned.id)), JSON.stringify(beforePendingReassign))

    // Races still admit exactly one claimant: the replay fulfils while the other member stays rejected.
    const target = (await fx.mod.createTask(fx.store, { id: 'lead-session' }, { teamId: team.id, title: 'Raced' })).task
    await fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: target.id, action: 'claim' })
    const outcomes = await Promise.allSettled([
      fx.mod.updateTask(fx.store, { id: 'worker-a' }, { teamId: team.id, taskId: target.id, action: 'claim' }),
      fx.mod.updateTask(fx.store, { id: 'worker-b' }, { teamId: team.id, taskId: target.id, action: 'claim' })
    ])
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1)
    assert.equal(storedTask(target.id).assigneeSessionId, 'worker-a')
    assert.equal(storedTask(target.id).state, 'in_progress')
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

test('graceful lifecycle waits release their waiter on cancellation and timeout', async () => {
  const mod = await plugin()
  for (const scenario of ['abort', 'timeout']) {
    let cancelled = false
    const waiter = { promise: new Promise(() => {}), cancel: () => { cancelled = true } }
    const controller = new AbortController()
    const waiting = mod.waitForGracefulLifecycle(waiter, controller.signal, scenario === 'timeout' ? 5 : 60_000)
    if (scenario === 'abort') controller.abort(new Error('user cancelled'))
    await assert.rejects(waiting, error => scenario === 'abort'
      ? error?.message === 'user cancelled'
      : error?.code === 'AGENT_TEAMS_LIFECYCLE_TIMEOUT')
    assert.equal(cancelled, true)
  }
})

test('subagent lifecycle bursts reconcile in one bounded store mutation', async () => {
  const mod = await plugin()
  const now = new Date().toISOString()
  const members = Array.from({ length: 24 }, (_, index) => worker(`child-${index}`, `Worker ${index}`))
  const document = { teams: [{ id: 'team', state: 'active', updatedAt: now, members }] }
  let mutations = 0
  const warnings = []
  const store = {
    hasManagedMember: id => members.some(member => member.sessionId === id),
    mutate: async mutate => { mutations += 1; return mutate(document) }
  }
  const reconciler = mod.createSubagentEventReconciler({ logger: { warn: warning => warnings.push(warning) } }, store, Promise.resolve(), 60_000)
  const events = []
  for (let index = 0; index < members.length; index += 1) {
    events.push(reconciler.enqueue('start', { id: `child-${index}`, runId: `run-${index}` }))
    events.push(reconciler.enqueue('end', { id: `child-${index}`, runId: `run-${index}`, stopReason: 'completed' }))
  }
  await reconciler.flush()
  await Promise.all(events)
  assert.equal(mutations, 1)
  assert.equal(warnings.length, 0)
  assert.ok(members.every(member => member.state === 'ready' && member.runId === undefined))
  reconciler.close()
})

test('user-aborted root turns synchronously clear queued wakeups and interrupt only owned team members', async () => {
  const mod = await plugin()
  const handlers = {}
  const cancelCalls = []
  const interrupts = []
  const session = { id: 'stopped-root' }
  const lead = { id: session.id, session, cancel: function () { cancelCalls.push([...arguments]) } }
  const ctx = {
    on: (name, handler) => { handlers[name] = handler },
    agents: { get: id => id === lead.id ? lead : undefined },
    subagents: { interrupt: (id, authority) => interrupts.push([id, authority]) },
    logger: { warn: () => {} }
  }
  const store = { activeTeamsForRoot: () => [{ teamId: 'stopped-team', childIds: ['child-a', 'child-b'] }] }
  mod.observeUserStops(ctx, store, new Promise(() => {}))
  handlers['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  assert.deepEqual(cancelCalls, [[{ kind: 'user' }]])
  assert.deepEqual(interrupts.map(([id]) => id), ['child-a', 'child-b'])
  assert.ok(interrupts.every(([, authority]) => authority.kind === 'ancestor' && authority.agent === lead))
})

test('explicit user stop pauses the team, drains members, and rolls active work back to pending', async () => {
  const fx = await fixture()
  const timestamp = new Date().toISOString()
  const stoppedAt = new Date(Date.parse(timestamp) + 1000).toISOString()
  const lead = { id: 'lead-session' }
  const team = {
    id: 'paused-team', rootLeadSessionId: lead.id, name: 'Paused', objective: 'Stop means stop', revision: 1,
    state: 'active', createdAt: timestamp, updatedAt: timestamp,
    members: [
      { id: 'lead', sessionId: lead.id, name: 'Lead', role: 'root lead and coordinator', kind: 'lead', state: 'running', createdAt: timestamp, updatedAt: timestamp },
      worker('child-session', 'Worker')
    ],
    tasks: [{ id: 'task', title: 'Work', state: 'in_progress', dependsOn: [], files: [], assigneeSessionId: 'child-session', createdAt: timestamp, updatedAt: timestamp, claimedAt: timestamp }],
    messages: []
  }
  const drained = []
  const ctx = {
    agents: { get: id => id === lead.id ? lead : undefined, roots: () => [lead] },
    subagents: { drainContinuableChildren: async (_lead, ids) => { drained.push(...ids) } }
  }
  try {
    await fx.store.mutate(document => { document.settings.enabled = true; document.teams.push(team) })
    await fx.mod.pauseTeamsForUserStop(ctx, fx.store, lead, [{ teamId: team.id, childIds: ['child-session'] }], stoppedAt)
    let snapshot = fx.store.snapshot().teams[0]
    assert.equal(snapshot.state, 'paused')
    assert.equal(snapshot.tasks[0].state, 'pending')
    assert.equal(snapshot.tasks[0].claimedAt, undefined)
    assert.equal(snapshot.members[1].state, 'ready')
    assert.deepEqual(drained, ['child-session'])
    await assert.rejects(fx.mod.updateTask(fx.store, { id: 'child-session' }, { teamId: team.id, taskId: 'task', action: 'claim' }), error => error?.code === 'AGENT_TEAMS_PAUSED')
    await fx.mod.resumePausedTeam(ctx, fx.store, lead, { teamId: team.id })
    snapshot = fx.store.snapshot().teams[0]
    assert.equal(snapshot.state, 'active')
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('v1.0.27 persisted names remain readable across ZWJ and normalized collisions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-legacy-name-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const mod = await plugin()
  const now = new Date().toISOString()
  const team = {
    id: 'legacy-team', rootLeadSessionId: 'lead-session', name: 'Legacy team', objective: 'Upgrade safely', revision: 1,
    state: 'active', createdAt: now, updatedAt: now,
    members: [
      { id: 'lead', sessionId: 'lead-session', name: 'Lead', role: 'root lead and coordinator', kind: 'lead', state: 'running', createdAt: now, updatedAt: now },
      { id: 'emoji', sessionId: 'emoji-session', name: '👩‍💻', role: 'legacy emoji member', kind: 'worker', state: 'ready', createdAt: now, updatedAt: now },
      { id: 'wide', sessionId: 'wide-session', name: 'Ｒｅｖｉｅｗｅｒ', role: 'legacy full-width member', kind: 'worker', state: 'retired', createdAt: now, updatedAt: now },
      { id: 'plain', sessionId: 'plain-session', name: 'reviewer', role: 'legacy normalized collision', kind: 'worker', state: 'retired', createdAt: now, updatedAt: now },
      { id: 'long', sessionId: 'long-session', name: 'Legacy Worker Name Far Beyond New Limits', role: 'legacy long member name', kind: 'worker', state: 'retired', createdAt: now, updatedAt: now }
    ],
    tasks: [], messages: []
  }
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify({ version: 1, settings: { enabled: true, maxMembers: 4, maxActiveTurns: 4 }, teams: [team] }, null, 2)}\n`, 'utf8')
    const store = new mod.AgentTeamsStore(file)
    await store.init()
    const projected = mod.teamSnapshot(store.snapshot(), 'lead-session').team
    assert.equal(projected.members.find(member => member.id === 'emoji').displayName, '👩‍💻')
    assert.equal(projected.members.find(member => member.id === 'wide').displayName, 'Reviewer')
    assert.equal(projected.members.find(member => member.id === 'long').displayName, 'Legacy Worker Name Far Beyond New Limits')
    assert.equal(projected.status, 'active')
  } finally { await rm(root, { recursive: true, force: true }) }
})
