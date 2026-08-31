const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')

async function loadPlugin(label) {
  return import(`${pathToFileURL(pluginFile).href}?cross-goal=${label}-${Date.now()}-${Math.random()}`)
}

function lead(id = 'root-lead') {
  return { id, options: { provider: 'test-provider', model: 'test-model' } }
}

test('unrelated second goal gets an independent peer team and does not enter the old backlog', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-cross-goal-'))
  const mod = await loadPlugin('isolation')
  const store = new mod.AgentTeamsStore(path.join(root, 'agent-teams.json'), { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
  try {
    await store.init()
    const owner = lead()
    const oldTeam = await mod.createTeam(store, owner, { objective: 'Old objective' })
    const newTeam = await mod.createTeam(store, owner, { objective: 'Unrelated new objective' })
    assert.notEqual(oldTeam.id, newTeam.id)
    const task = await mod.createTask(store, owner, { teamId: newTeam.id, title: 'New objective task', files: ['new/stream.js'] })
    const snapshot = store.snapshot()
    assert.deepEqual(snapshot.teams.map(team => team.objective), ['Old objective', 'Unrelated new objective'])
    assert.deepEqual(snapshot.teams.find(team => team.id === oldTeam.id).tasks, [])
    assert.equal(snapshot.teams.find(team => team.id === newTeam.id).tasks[0].id, task.task.id)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('root peer-team ceiling is explicit and fail-closed at eight open teams', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-cross-goal-limit-'))
  const mod = await loadPlugin('limit')
  const store = new mod.AgentTeamsStore(path.join(root, 'agent-teams.json'), { enabled: true, maxMembers: 4, maxActiveTurns: 4 })
  try {
    await store.init()
    const owner = lead('limit-root')
    for (let index = 0; index < mod.HARD_MAX_TEAMS_PER_ROOT; index += 1) {
      await mod.createTeam(store, owner, { objective: `Goal ${index}` })
    }
    await assert.rejects(
      mod.createTeam(store, owner, { objective: 'Ninth unrelated goal' }),
      error => error?.code === 'AGENT_TEAMS_TEAM_LIMIT'
    )
    assert.equal(store.snapshot().teams.length, mod.HARD_MAX_TEAMS_PER_ROOT)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('negative routing contracts preserve explicit team selection and shared root capacity', async () => {
  const source = require('node:fs').readFileSync(pluginFile, 'utf8')
  assert.match(source, /resolveUniqueLeadTeam\(document, undefined, lead\.id, \(candidate\) => candidate\.state === "active"\)/u)
  assert.match(source, /team_id is required when more than one team matches/u)
  assert.match(source, /function activeWorkerTurnsForLead\(document, rootLeadSessionId\)[\s\S]*?team\.rootLeadSessionId === rootLeadSessionId && team\.state !== "closed"/u)
  assert.match(source, /public spawn requires a non-empty task_ids binding/u)
  assert.match(source, /MANAGED_MEMBER_DENIED_TOOLS/u)
  assert.match(source, /nested teams are forbidden/u)
})
