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

test('parent and subagent share the per-task TOK cap', () => {
  const { domain, store } = fixture()
  domain.ingestBaseline({ sessionId: 'parent', tokenUsage: { outputTokens: 0 }, model: 'gpt-5.6-sol' })
  domain.ingestBaseline({ sessionId: 'child', parentSessionId: 'parent', tokenUsage: { outputTokens: 0 }, model: 'gpt-5.6-sol' })
  domain.ingest({ type: 'session-status', sessionId: 'parent', running: true })
  domain.ingest({ type: 'session-status', sessionId: 'child', running: true })
  domain.ingest({ type: 'token-usage', sessionId: 'child', value: { outputTokens: 6000 } })
  domain.ingest({ type: 'session-status', sessionId: 'child', running: false })
  domain.ingest({ type: 'token-usage', sessionId: 'parent', value: { outputTokens: 6000 } })
  domain.ingest({ type: 'session-status', sessionId: 'parent', running: false })
  assert.equal(store.get().lifetime.tokProduced, 12)
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
