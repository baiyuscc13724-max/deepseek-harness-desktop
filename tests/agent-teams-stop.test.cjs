const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
let pluginPromise
function plugin() {
  pluginPromise ||= import(`${pathToFileURL(pluginFile).href}?legacy-stop=${Date.now()}`)
  return pluginPromise
}

function planHash(team) {
  const material = {
    objective: team.objective,
    tasks: team.tasks.map(task => ({
      id: task.id, title: task.title, description: task.description, dependsOn: task.dependsOn,
      crossTeamDependsOn: task.crossTeamDependsOn || [], files: task.files || [], capabilities: task.capabilities || [],
      externalEffects: (task.externalEffects || []).map(effect => ({ name: effect.name, policy: effect.policy, idempotencyKey: effect.idempotencyKey }))
    }))
  }
  return createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

function legacyPausedFixture() {
  const timestamp = '2026-08-29T15:36:46.796Z'
  const rootLeadSessionId = 'session-c9eee12b-7939-404a-9969-0089d4f52e2a'
  const workerSessionId = '4a2be382-a728-4974-9554-54de182dc5ec'
  const acceptedTask = {
    id: '60641b10-2d44-4c76-8e8e-94571ed10885', title: 'Completed before explicit Stop', state: 'completed', dependsOn: [], files: [],
    assigneeSessionId: workerSessionId, createdAt: timestamp, updatedAt: timestamp, claimedAt: timestamp, completedAt: timestamp,
    attempt: 1, claimId: '0069f04a-c9fd-49e0-a4e0-623d26112a43', leaseEpoch: 0, attemptHistory: [], interruptionHistory: [], capabilities: [], externalEffects: [],
    submission: { taskId: '60641b10-2d44-4c76-8e8e-94571ed10885', claimId: '0069f04a-c9fd-49e0-a4e0-623d26112a43', leaseEpoch: 0, submittedAt: timestamp, submittedBy: workerSessionId, source: 'explicit_complete' },
    acceptance: { taskId: '60641b10-2d44-4c76-8e8e-94571ed10885', claimId: '0069f04a-c9fd-49e0-a4e0-623d26112a43', leaseEpoch: 0, acceptedAt: timestamp, acceptedBy: rootLeadSessionId }
  }
  const releasedTask = {
    id: 'pending-after-stop', title: 'Claim again only after resume', state: 'pending', dependsOn: [], files: [], assigneeSessionId: workerSessionId,
    createdAt: timestamp, updatedAt: timestamp, attempt: 1, leaseEpoch: 1,
    attemptHistory: [{ kind: 'claimed', at: timestamp, attempt: 1, claimId: 'pre-stop-claim', leaseEpoch: 0 }],
    interruptionHistory: [{ kind: 'user_stop', at: timestamp, attempt: 1, claimId: 'pre-stop-claim', leaseEpoch: 0 }], capabilities: [], externalEffects: []
  }
  const team = {
    id: 'de76491f-187d-47c1-8a83-d5a7f57202f0', rootLeadSessionId, name: 'Legacy paused team', objective: 'Recover the real stopped team without weakening claim fences', revision: 32,
    state: 'paused', pauseEpoch: 1, projectKey: '1909b4344b1632941419131a9e37a0e9ac1158d2e150ba21a710702d8d02b893', ownershipHistory: [],
    createdAt: timestamp, updatedAt: timestamp,
    members: [
      { id: `lead:${rootLeadSessionId}`, sessionId: rootLeadSessionId, name: 'Lead', role: 'root lead and coordinator', kind: 'lead', state: 'ready', createdAt: timestamp, updatedAt: timestamp },
      { id: 'legacy-worker-member', sessionId: workerSessionId, name: 'Worker', role: 'legacy worker', kind: 'worker', state: 'ready', createdAt: timestamp, updatedAt: timestamp }
    ], tasks: [acceptedTask, releasedTask], messages: []
  }
  const hash = planHash(team)
  team.plan = {
    phase: 'active', revision: 17, hash, committedAt: timestamp, activatedAt: timestamp, migrationState: 'ready',
    authorization: { source: 'human_attested', attestedAt: timestamp, confirmedPlanHash: hash, permissions: 'human_attested', files: 'human_attested', cost: 'human_attested', externalSideEffects: 'human_attested' }
  }
  return { version: 6, settings: { enabled: true, maxMembers: 8, maxActiveTurns: 8 }, teams: [team] }
}

test('real legacy paused fixture resumes in two phases and preserves claim fencing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-legacy-stop-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const mod = await plugin()
  const document = legacyPausedFixture()
  const lead = { id: document.teams[0].rootLeadSessionId }
  const worker = { id: document.teams[0].members[1].sessionId }
  const ctx = { agents: { get: id => id === lead.id ? lead : undefined, roots: () => [lead] } }
  let store
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    store = new mod.AgentTeamsStore(file)
    await store.init()

    let durable = store.snapshot().teams[0]
    assert.equal(durable.tasks[0].acceptance.ownerEpoch, 0)
    assert.equal(durable.state, 'paused')

    const preview = await mod.resumePausedTeam(ctx, store, lead, { teamId: durable.id, requestId: 'resume-real-legacy-fixture' })
    assert.equal(preview.phase, 'preview')
    assert.equal(preview.preview.pauseEpoch, 1)
    const resumed = await mod.resumePausedTeam(ctx, store, lead, {
      teamId: durable.id, requestId: preview.preview.requestId, commit: true, previewId: preview.preview.previewId,
      expectedPauseEpoch: preview.preview.pauseEpoch, expectedTeamRevision: preview.preview.teamRevision
    })
    assert.equal(resumed.phase, 'active')
    assert.equal(resumed.team.status, 'active')

    const claimed = (await mod.updateTask(store, worker, { teamId: durable.id, taskId: 'pending-after-stop', action: 'claim' })).task
    assert.equal(claimed.attempt, 2)
    assert.equal(claimed.leaseEpoch, 1)
    assert.notEqual(claimed.claimId, 'pre-stop-claim')
    await assert.rejects(
      mod.updateTask(store, worker, { teamId: durable.id, taskId: 'pending-after-stop', action: 'complete', claimId: 'pre-stop-claim', leaseEpoch: 0 }),
      error => error?.code === 'AGENT_TEAMS_STALE_CLAIM' || error?.code === 'AGENT_TEAMS_STALE_LEASE'
    )
    durable = store.snapshot().teams[0]
    assert.equal(durable.tasks[0].acceptance.ownerEpoch, 0, 'resume never rewrites historical acceptance')
    assert.equal(durable.tasks[1].claimId, claimed.claimId)
  } finally {
    store?.close()
    await rm(root, { recursive: true, force: true })
  }
})
