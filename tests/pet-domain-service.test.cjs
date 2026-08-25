const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdtempSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { PetDomainService, qualityFor, quantityFor } = require('../electron/pet/pet-domain-service.cjs')
const { PetStateStore } = require('../electron/pet/pet-state-store.cjs')

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-pet-domain-'))
  const store = new PetStateStore(path.join(dir, 'pet-state.json'))
  const published = []
  const domain = new PetDomainService({ store, getPreferences: () => ({ autoFeed: false }), onChange: state => published.push(state) })
  return { domain, store, published }
}

test('task completion settles cumulative output only once', () => {
  const { domain, store } = fixture()
  domain.ingestBaseline({ sessionId: 's1', running: false, tokenUsage: { outputTokens: 100 }, model: 'gpt-5.6-sol' })
  domain.ingest({ type: 'session-status', sessionId: 's1', running: true })
  domain.ingest({ type: 'token-usage', sessionId: 's1', value: { outputTokens: 1124 } })
  domain.ingest({ type: 'session-status', sessionId: 's1', running: false })
  const first = store.get()
  assert.equal(first.inventory.refined, 4)
  assert.equal(first.lifetime.tokensObserved, 1024)
  domain.ingest({ type: 'session-status', sessionId: 's1', running: false })
  assert.deepEqual(store.get(), first)
  domain.dispose()
})

test('needs-input outranks blocked, ready and working sessions', () => {
  const { domain } = fixture()
  for (const id of ['running', 'blocked', 'input']) domain.ingestBaseline({ sessionId: id, tokenUsage: { outputTokens: 0 } })
  domain.ingest({ type: 'session-status', sessionId: 'running', running: true })
  domain.ingest({ type: 'agent-error', sessionId: 'blocked' })
  domain.ingest({ type: 'needs-input', sessionId: 'input' })
  assert.equal(domain.getState().status, 'needs-input')
  assert.equal(domain.getState().focusSessionId, 'input')
  domain.dispose()
})

test('parent and subagent share the TOK cap but count as one companionship task', () => {
  const { domain, store } = fixture()
  domain.ingestBaseline({ sessionId: 'parent', tokenUsage: { outputTokens: 0 }, model: 'gpt-5.6-sol' })
  domain.ingestBaseline({ sessionId: 'child', parentSessionId: 'parent', tokenUsage: { outputTokens: 0 }, model: 'gpt-5.6-sol' })
  domain.ingest({ type: 'session-status', sessionId: 'parent', running: true })
  domain.ingest({ type: 'session-status', sessionId: 'child', running: true })
  domain.ingest({ type: 'token-usage', sessionId: 'child', value: { outputTokens: 6000 } })
  domain.ingest({ type: 'session-status', sessionId: 'child', running: false })
  const whileParentRuns = domain.getState()
  assert.equal(whileParentRuns.status, 'working')
  assert.equal(whileParentRuns.activity.ready, 0)
  domain.ingest({ type: 'token-usage', sessionId: 'parent', value: { outputTokens: 6000 } })
  domain.ingest({ type: 'session-status', sessionId: 'parent', running: false })
  const persisted = store.get()
  assert.equal(persisted.lifetime.tokProduced, 12)
  assert.equal(persisted.lifetime.tasksCompleted, 1)
  assert.equal(persisted.companion.daily.tasks, 1)
  assert.equal(persisted.companion.daily.completed, 1)
  assert.equal(persisted.companion.taskStreak, 1)
  assert.equal(persisted.affection, 1)
  assert.equal(persisted.energy, 77)
  assert.equal(persisted.mood, 76)
  domain.dispose()
})

test('a failed subagent clears stale input and does not cover its still-running parent task', () => {
  const { domain } = fixture()
  domain.ingestBaseline({ sessionId: 'parent', tokenUsage: { outputTokens: 0 } })
  domain.ingestBaseline({ sessionId: 'child', parentSessionId: 'parent', tokenUsage: { outputTokens: 0 } })
  domain.ingest({ type: 'session-status', sessionId: 'parent', running: true })
  domain.ingest({ type: 'session-status', sessionId: 'child', running: true })
  domain.ingest({ type: 'needs-input', sessionId: 'child' })
  assert.equal(domain.getState().status, 'needs-input')
  domain.ingest({ type: 'agent-error', sessionId: 'child' })
  const state = domain.getState()
  assert.equal(state.status, 'working')
  assert.equal(state.focusSessionId, 'parent')
  assert.equal(state.activity.blocked, 0)
  domain.dispose()
})

test('TOK helpers keep model influence bounded and quantity capped', () => {
  assert.equal(qualityFor({ model: 'gpt-5.6-sol', completed: true, blocked: false }), 'refined')
  assert.equal(qualityFor({ model: 'some-flash', completed: true, blocked: false }), 'standard')
  assert.equal(qualityFor({ model: 'gpt-5.6-sol', completed: false, blocked: true }), 'fragments')
  assert.equal(quantityFor(50000, true), 12)
})

test('domain exposes energy and mood bands and throttles repeated petting', () => {
  const { domain, store } = fixture()
  const first = domain.interact('petting')
  const second = domain.interact('petting')
  assert.equal(first.moodBand, 'happy')
  assert.equal(first.energyBand, 'lively')
  assert.equal(store.get().affection, 1)
  assert.equal(second.affection, 1)
  domain.dispose()
})

test('automatic TOK feeding publishes a visible feeding event', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-pet-domain-'))
  const store = new PetStateStore(path.join(dir, 'pet-state.json'))
  for (let index = 0; index < 6; index += 1) store.tickActive(60)
  store.settleTask({ sessionId: 'snack', outputTokens: 512, observedTokens: 512, quality: 'standard', quantity: 1, completed: false })
  const domain = new PetDomainService({ store, getPreferences: () => ({ autoFeed: true }) })
  domain.maybeAutoFeed()
  const state = domain.getState()
  assert.equal(state.inventory.standard, 0)
  assert.equal(state.fullness, 66)
  assert.equal(state.lastAutoFeed.kind, 'standard')
  assert.equal(state.lastAutoFeed.quantity, 1)
  domain.dispose()
})

test('domain publishes context-aware companion cues for task transitions', () => {
  const { domain } = fixture()
  domain.ingestBaseline({ sessionId: 'smart', tokenUsage: { outputTokens: 0 }, model: 'gpt-5.6-sol' })
  domain.ingest({ type: 'session-status', sessionId: 'smart', running: true })
  assert.equal(domain.getState().companionCue.kind, 'task-started')
  domain.ingest({ type: 'needs-input', sessionId: 'smart' })
  assert.equal(domain.getState().companionCue.kind, 'needs-input')
  assert.match(domain.getState().companionCue.message, /点我|决定/u)
  domain.ingest({ type: 'input-resolved', sessionId: 'smart' })
  assert.equal(domain.getState().companionCue.kind, 'input-resolved')
  domain.ingest({ type: 'token-usage', sessionId: 'smart', value: { outputTokens: 1024 } })
  domain.ingest({ type: 'session-status', sessionId: 'smart', running: false })
  const completed = domain.getState()
  assert.equal(completed.companionCue.kind, 'task-completed')
  assert.equal(completed.relationship.taskStreak, 1)
  assert.equal(completed.companion.daily.completed, 1)
  domain.dispose()
})

test('long-running tasks receive one rate-limited proactive cue at the milestone', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-pet-domain-'))
  const store = new PetStateStore(path.join(dir, 'pet-state.json'))
  let now = Date.parse('2026-08-24T00:00:00Z')
  const domain = new PetDomainService({
    store,
    now: () => new Date(now),
    getPreferences: () => ({ autoFeed: false, proactive: true, companionStyle: 'warm' })
  })
  domain.ingestBaseline({ sessionId: 'long', tokenUsage: { outputTokens: 0 } })
  domain.ingest({ type: 'session-status', sessionId: 'long', running: true })
  now += 25 * 60_000
  domain.tickActive(1)
  const first = domain.getState().companionCue
  assert.equal(first.kind, 'long-running')
  assert.match(first.message, /25 分钟/u)
  domain.tickActive(1)
  assert.equal(domain.getState().companionCue.id, first.id)
  domain.dispose()
})

test('a delayed long-running cue reports actual elapsed time after proactivity is enabled', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-pet-domain-'))
  const store = new PetStateStore(path.join(dir, 'pet-state.json'))
  let now = Date.parse('2026-08-24T00:00:00Z')
  let proactive = false
  const domain = new PetDomainService({
    store,
    now: () => new Date(now),
    getPreferences: () => ({ autoFeed: false, proactive, companionStyle: 'warm' })
  })
  domain.ingestBaseline({ sessionId: 'delayed', tokenUsage: { outputTokens: 0 } })
  domain.ingest({ type: 'session-status', sessionId: 'delayed', running: true })
  now += 40 * 60_000
  domain.tickActive(1)
  assert.equal(domain.getState().companionCue, null)
  proactive = true
  domain.tickActive(1)
  assert.match(domain.getState().companionCue.message, /40 分钟/u)
  domain.dispose()
})

test('awakening preserves a local companionship session without conversation fields', () => {
  const { domain } = fixture()
  const state = domain.awaken({ announce: true })
  assert.equal(state.companion.sessionsTogether, 1)
  assert.equal(state.companionCue.kind, 'awakening')
  assert.equal('messages' in state.companion, false)
  assert.equal('prompt' in state, false)
  domain.dispose()
})
