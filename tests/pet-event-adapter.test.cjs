const assert = require('node:assert/strict')
const test = require('node:test')

const { PetEventAdapter, normalizeRuntimeUrl } = require('../electron/pet/pet-event-adapter.cjs')

test('pet adapter accepts loopback runtime URLs only', () => {
  assert.equal(normalizeRuntimeUrl('http://127.0.0.1:3080/path').origin, 'http://127.0.0.1:3080')
  assert.throws(() => normalizeRuntimeUrl('https://example.com'), /只允许连接本机/)
})

test('pet adapter maps host and mux frames without retaining content', () => {
  const events = []
  const adapter = new PetEventAdapter({ onEvent: event => events.push(event) })
  adapter.handleHostFrame({ type: 'host/session-status', sessionId: 's1', running: true })
  adapter.handleHostFrame({ type: 'host/agent-error', sessionId: 's1', message: 'private error details' })
  adapter.handleMuxFrame({ type: 'approval/requested', sessionId: 's1', reason: 'private prompt' })
  adapter.handleMuxFrame({ type: 'session/projection', sessionId: 's1', key: 'tokenUsage', value: { outputTokens: 600 } })
  assert.deepEqual(events.slice(0, 4), [
    { type: 'session-status', sessionId: 's1', running: true },
    { type: 'agent-error', sessionId: 's1' },
    { type: 'needs-input', sessionId: 's1' },
    { type: 'token-usage', sessionId: 's1', value: { outputTokens: 600 } }
  ])
})
