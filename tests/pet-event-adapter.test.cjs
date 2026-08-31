const assert = require('node:assert/strict')
const test = require('node:test')

const { PetEventAdapter, normalizeRuntimeUrl } = require('../electron/pet/pet-event-adapter.cjs')

test('pet adapter accepts loopback runtime URLs only', () => {
  assert.equal(normalizeRuntimeUrl('http://127.0.0.1:3080/path').origin, 'http://127.0.0.1:3080')
  assert.throws(() => normalizeRuntimeUrl('https://example.com'), /只允许连接本机/)
})

test('pet adapter maps the fixed alpha.2 event/control projections without retaining content', async () => {
  const events = [], calls = []
  const adapter = new PetEventAdapter({
    fetchImpl: async (url, init) => { const request = JSON.parse(init.body); calls.push([url.toString(), request]); return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: {} } }), { status: 200 }) },
    onEvent: event => events.push(event)
  })
  adapter.baseUrl = new URL('http://127.0.0.1:3080')
  adapter.handleRemoteEvent({ type: 'ready', clientId: 'event-client', host: { home: '/private' } })
  adapter.handleRemoteEvent({ type: 'emit', event: 'api-session/status', args: [{ sessionId: 's1', running: true, private: 'drop' }] })
  adapter.handleRemoteEvent({ type: 'emit', event: 'api-session/error', args: [{ sessionId: 's1', message: 'private error details' }] })
  adapter.handleRemoteEvent({ type: 'waterfall', event: 'approval/request', eventId: 'approval-1', agentId: 's1', request: { reason: 'private prompt' } })
  adapter.handleControlFrame({ type: 'projection', sessionId: 's1', key: 'tokenUsage', value: { outputTokens: 600 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, [
    { type: 'session-status', sessionId: 's1', running: true },
    { type: 'agent-error', sessionId: 's1' },
    { type: 'needs-input', sessionId: 's1' },
    { type: 'token-usage', sessionId: 's1', value: { outputTokens: 600 } }
  ])
  assert.equal(calls[0][0], 'http://127.0.0.1:3080/api/$events/result')
  assert.deepEqual(calls[0][1].payload, { args: { clientId: 'event-client', eventId: 'approval-1', outcome: { kind: 'next' } } })
})
