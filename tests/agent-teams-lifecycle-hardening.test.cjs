const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
let pluginPromise
function plugin() {
  pluginPromise ||= import(`${pathToFileURL(pluginFile).href}?legacy-owner-epoch=${Date.now()}`)
  return pluginPromise
}

const timestamp = '2026-08-29T15:36:46.796Z'
const projectKey = '1909b4344b1632941419131a9e37a0e9ac1158d2e150ba21a710702d8d02b893'

function oldAcceptedDocument(overrides = {}) {
  const rootLeadSessionId = 'session-c9eee12b-7939-404a-9969-0089d4f52e2a'
  const task = {
    id: '60641b10-2d44-4c76-8e8e-94571ed10885', title: 'Legacy accepted task', state: 'completed', dependsOn: [], files: [],
    assigneeSessionId: 'legacy-worker', createdAt: timestamp, updatedAt: timestamp, claimedAt: timestamp, completedAt: timestamp,
    attempt: 1, claimId: '0069f04a-c9fd-49e0-a4e0-623d26112a43', leaseEpoch: 0, attemptHistory: [], interruptionHistory: [], capabilities: [], externalEffects: [],
    submission: { taskId: '60641b10-2d44-4c76-8e8e-94571ed10885', claimId: '0069f04a-c9fd-49e0-a4e0-623d26112a43', leaseEpoch: 0, submittedAt: timestamp, submittedBy: 'legacy-worker', source: 'explicit_complete' },
    acceptance: { taskId: '60641b10-2d44-4c76-8e8e-94571ed10885', claimId: '0069f04a-c9fd-49e0-a4e0-623d26112a43', leaseEpoch: 0, acceptedAt: timestamp, acceptedBy: rootLeadSessionId }
  }
  const team = {
    id: 'de76491f-187d-47c1-8a83-d5a7f57202f0', rootLeadSessionId, name: 'Legacy paused team', objective: 'Resume without rewriting accepted delivery', revision: 32,
    state: 'paused', pauseEpoch: 1, projectKey, ownershipHistory: [], createdAt: timestamp, updatedAt: timestamp,
    members: [
      { id: `lead:${rootLeadSessionId}`, sessionId: rootLeadSessionId, name: 'Lead', role: 'root lead and coordinator', kind: 'lead', state: 'ready', createdAt: timestamp, updatedAt: timestamp },
      { id: 'legacy-member', sessionId: 'legacy-worker', name: 'Worker', role: 'legacy worker', kind: 'worker', state: 'ready', createdAt: timestamp, updatedAt: timestamp }
    ],
    tasks: [task], messages: []
  }
  Object.assign(team, overrides.team)
  Object.assign(task, overrides.task)
  if (overrides.acceptance) Object.assign(task.acceptance, overrides.acceptance)
  return { version: 6, settings: { enabled: true, maxMembers: 8, maxActiveTurns: 8 }, teams: [team] }
}

test('legacy acceptance without ownerEpoch is normalized only for the provable fixed root and claim lease epoch', async () => {
  const mod = await plugin()
  const document = oldAcceptedDocument()
  assert.doesNotThrow(() => mod.validateStoreDocument(document))
  assert.equal(document.teams[0].tasks[0].acceptance.ownerEpoch, 0)
  assert.equal(document.teams[0].pauseEpoch, 1, 'normalization does not rewrite the stop epoch')
})

test('foreign, handoff-ambiguous, cross-project, and mismatched legacy acceptance fail closed', async () => {
  const mod = await plugin()
  const cases = [
    oldAcceptedDocument({ acceptance: { acceptedBy: 'foreign-root' } }),
    oldAcceptedDocument({ team: { handoff: { tokenHash: 'a'.repeat(64), sourceRootSessionId: 'session-c9eee12b-7939-404a-9969-0089d4f52e2a', targetRootSessionId: 'new-root', projectKey, createdAt: timestamp, expiresAt: '2026-08-29T16:36:46.796Z' } } }),
    oldAcceptedDocument({ team: { projectKey: undefined } }),
    oldAcceptedDocument({ task: { leaseEpoch: 1 } }),
    oldAcceptedDocument({ acceptance: { ownerEpoch: 2 } })
  ]
  for (const document of cases) {
    assert.throws(() => mod.validateStoreDocument(document), /ownerEpoch|root owner|current lease/u)
  }
})

test('ownership history proves former roots only through a continuous same-project adoption chain', async () => {
  const mod = await plugin()
  const source = 'session-c9eee12b-7939-404a-9969-0089d4f52e2a'
  const target = 'new-root'
  const document = oldAcceptedDocument({
    team: {
      rootLeadSessionId: target,
      members: [
        { id: `lead:${target}`, sessionId: target, name: 'NewLead', role: 'root lead and coordinator', kind: 'lead', state: 'ready', createdAt: timestamp, updatedAt: timestamp },
        { id: 'former-root', sessionId: source, name: 'Former', role: 'former root lead retained for durable audit references', kind: 'worker', state: 'retired', createdAt: timestamp, updatedAt: timestamp },
        { id: 'legacy-member', sessionId: 'legacy-worker', name: 'Worker', role: 'legacy worker', kind: 'worker', state: 'ready', createdAt: timestamp, updatedAt: timestamp }
      ],
      ownershipHistory: [{ kind: 'handoff_adopted', sourceRootSessionId: source, targetRootSessionId: target, projectKey, tokenHash: 'b'.repeat(64), at: timestamp, pauseEpoch: 1 }]
    },
    acceptance: { ownerEpoch: 0 }
  })
  assert.doesNotThrow(() => mod.validateStoreDocument(document))

  const foreignProject = structuredClone(document)
  foreignProject.teams[0].ownershipHistory[0].projectKey = 'c'.repeat(64)
  assert.throws(() => mod.validateStoreDocument(foreignProject), /root owner/u)

  const brokenChain = structuredClone(document)
  brokenChain.teams[0].ownershipHistory[0].targetRootSessionId = 'unrelated-root'
  assert.throws(() => mod.validateStoreDocument(brokenChain), /root owner/u)
})

test('legacy completed records without Host acceptance remain explicitly unaccepted', async () => {
  const mod = await plugin()
  const document = oldAcceptedDocument()
  document.version = 5
  delete document.teams[0].tasks[0].acceptance
  assert.doesNotThrow(() => mod.validateStoreDocument(document))
  assert.equal(document.version, 8)
  assert.equal(document.teams[0].tasks[0].state, 'submitted')
  assert.equal(document.teams[0].tasks[0].acceptance, undefined)
  assert.equal(document.teams[0].tasks[0].submission.source, 'explicit_complete')
  assert.equal(document.teams[0].tasks[0].lifecycleLedger.some(event => event.kind === 'submission'), true)
})

test('legacy closed teams with unverified completions remain readable through an auditable forced receipt', async () => {
  const mod = await plugin()
  const document = oldAcceptedDocument()
  const team = document.teams[0]
  document.version = 5
  team.state = 'closed'
  delete team.tasks[0].acceptance
  team.tasks.push({
    id: 'unfinished-legacy-task', title: 'Unfinished legacy task', state: 'pending', dependsOn: [], files: [],
    createdAt: timestamp, updatedAt: timestamp, attempt: 0, leaseEpoch: 0, attemptHistory: [], interruptionHistory: [], capabilities: [], externalEffects: []
  })
  assert.doesNotThrow(() => mod.validateStoreDocument(document))
  assert.equal(team.tasks[0].state, 'cancelled')
  assert.equal(team.tasks[0].acceptance, undefined)
  assert.equal(team.tasks[0].submission, undefined)
  assert.equal(team.tasks[0].lifecycleLedger.some(event => event.kind === 'submission'), true)
  assert.equal(team.tasks[1].state, 'cancelled')
  assert.deepEqual(team.closure, {
    outcome: 'forced', closedAt: timestamp, attemptedAt: timestamp,
    reason: 'legacy closed team migrated with unverified legacy completion and no invented acceptance', forced: true,
    cancelledTaskIds: [team.tasks[0].id, 'unfinished-legacy-task'], failures: []
  })
})

test('legacy closed teams with provable acceptance retain normal succeeded or cancelled receipts', async () => {
  const mod = await plugin()
  const succeeded = oldAcceptedDocument()
  succeeded.version = 5
  succeeded.teams[0].state = 'closed'
  assert.doesNotThrow(() => mod.validateStoreDocument(succeeded))
  assert.equal(succeeded.teams[0].tasks[0].acceptance.ownerEpoch, 0)
  assert.equal(succeeded.teams[0].closure.outcome, 'succeeded')
  assert.equal(succeeded.teams[0].closure.forced, false)

  const cancelled = oldAcceptedDocument()
  cancelled.version = 5
  cancelled.teams[0].state = 'closed'
  cancelled.teams[0].tasks.push({
    id: 'cancel-me', title: 'Cancel legacy unfinished work', state: 'pending', dependsOn: [], files: [],
    createdAt: timestamp, updatedAt: timestamp, attempt: 0, leaseEpoch: 0, attemptHistory: [], interruptionHistory: [], capabilities: [], externalEffects: []
  })
  assert.doesNotThrow(() => mod.validateStoreDocument(cancelled))
  assert.equal(cancelled.teams[0].closure.outcome, 'cancelled')
  assert.equal(cancelled.teams[0].closure.forced, false)
  assert.deepEqual(cancelled.teams[0].closure.cancelledTaskIds, ['cancel-me'])
})
