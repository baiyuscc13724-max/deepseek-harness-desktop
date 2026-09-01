const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
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

test('pet runtime websocket receives only the controlled in-memory authentication cookie', async () => {
  const sockets = []
  const cookieCalls = []
  const cookie = 'dsh-auth-authority=v1.c2lnbmVkLWJvZHk.c2lnbmF0dXJl'
  class FakeSocket extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; sockets.push(this) }
    close() {}
  }
  const adapter = new PetEventAdapter({
    WebSocketImpl: FakeSocket,
    cookieProvider: async origin => { cookieCalls.push(origin); return cookie }
  })
  adapter.baseUrl = new URL('http://127.0.0.1:3080')
  adapter.stopped = false
  await adapter.openStreams()
  assert.deepEqual(cookieCalls, ['http://127.0.0.1:3080'])
  assert.equal(sockets[0].url, 'ws://127.0.0.1:3080/api/remote.mux')
  assert.deepEqual(sockets[0].options, { headers: { Cookie: cookie } })
  adapter.stop()
})

test('pet runtime websocket keeps the legacy no-cookie path and rejects untrusted provider output', async () => {
  const sockets = []
  class FakeSocket extends EventEmitter {
    constructor(url, options) { super(); sockets.push({ url, options }) }
    close() {}
  }
  const adapter = new PetEventAdapter({ WebSocketImpl: FakeSocket })
  adapter.baseUrl = new URL('http://localhost:3080')
  adapter.stopped = false
  await adapter.openStreams()
  assert.deepEqual(sockets[0].options, {})
  adapter.cookieProvider = async () => 'attacker=value'
  await assert.rejects(adapter.openStreams(), /authentication cookie is invalid/)
  adapter.stop()
})
