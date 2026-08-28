'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  PROTOCOL_NAME, PROTOCOL_VERSION, MAX_FRAME_BYTES,
  encodeFrame, decodeFrame, PairingSession, CapabilityAuthority, GuestBridge
} = require('../guest-bridge/index.cjs')

function request(id, action, params = {}) {
  return { protocol: PROTOCOL_NAME, version: PROTOCOL_VERSION, type: 'request', id, action, params }
}

test('protocol accepts bounded known requests and rejects ambiguous or oversized frames', () => {
  const frame = request('req-1', 'file.stat', { path: '/safe/item' })
  assert.deepEqual(decodeFrame(encodeFrame(frame)), frame)
  assert.throws(() => decodeFrame('{'), error => error.code === 'invalid-json')
  assert.throws(() => encodeFrame({ ...frame, version: 99 }), error => error.code === 'unsupported-protocol')
  assert.throws(() => encodeFrame({ ...frame, action: 'shell.exec' }), error => error.code === 'unsupported-action')
  assert.throws(() => decodeFrame(' '.repeat(MAX_FRAME_BYTES + 1)), error => error.code === 'frame-too-large')
  assert.throws(() => encodeFrame({ ...frame, id: '../request' }), error => error.code === 'invalid-frame')
})

test('pairing is time-bounded, peer-bound, attempt-limited, and does not put the user code in the offer', () => {
  let now = 1000
  let counter = 1
  const pairing = new PairingSession({
    clock: () => now,
    ttlMs: 100,
    maxAttempts: 2,
    randomBytes(size) { const value = Buffer.alloc(size); value.writeUInt32BE(counter++, 0); return value }
  })
  const first = pairing.create('peer-A')
  assert.match(first.userCode, /^\d{6}$/u)
  assert.equal(JSON.stringify(first.offer).includes(first.userCode), false)
  assert.throws(() => pairing.confirm({ pairingId: first.offer.pairingId, peerFingerprint: 'peer-B', userCode: first.userCode }), error => error.code === 'peer-mismatch')
  assert.throws(() => pairing.confirm({ pairingId: first.offer.pairingId, peerFingerprint: 'peer-A', userCode: '999999' }), error => error.code === 'pairing-code-invalid')
  assert.throws(() => pairing.confirm({ pairingId: first.offer.pairingId, peerFingerprint: 'peer-A', userCode: '999998' }), error => error.code === 'pairing-code-invalid')
  assert.throws(() => pairing.confirm({ pairingId: first.offer.pairingId, peerFingerprint: 'peer-A', userCode: first.userCode }), error => error.code === 'pairing-not-found')

  const second = pairing.create('peer-A')
  now += 101
  assert.throws(() => pairing.confirm({ pairingId: second.offer.pairingId, peerFingerprint: 'peer-A', userCode: second.userCode }), error => error.code === 'pairing-expired')
})

test('capabilities are least-privilege, expiring, peer-bound, revocable, and stop revokes all', async () => {
  let now = 10
  const authority = new CapabilityAuthority({ clock: () => now, defaultTtlMs: 20 })
  const bridge = new GuestBridge({ platform: 'linux', authority, fileRoots: ['/safe'], adapters: { file: { stat: async path => ({ path }) } } })
  const token = authority.grant({ peerFingerprint: 'peer-A', actions: ['file.stat'] })
  const response = await bridge.handle(request('one', 'file.stat', { path: '/safe/a' }), { token, peerFingerprint: 'peer-A' })
  assert.equal(response.ok, true)
  assert.equal(response.result.path, '/safe/a')
  await assert.rejects(() => bridge.handle(request('two', 'log.read'), { token, peerFingerprint: 'peer-A' }), error => error.code === 'capability-denied')
  await assert.rejects(() => bridge.handle(request('three', 'file.stat', { path: '/safe/a' }), { token, peerFingerprint: 'peer-B' }), error => error.code === 'peer-mismatch')
  now += 21
  await assert.rejects(() => bridge.handle(request('four', 'file.stat', { path: '/safe/a' }), { token, peerFingerprint: 'peer-A' }), error => error.code === 'authorization-expired')

  const token2 = authority.grant({ peerFingerprint: 'peer-A', actions: ['file.stat'] })
  assert.equal(bridge.stop(), 1)
  await assert.rejects(() => bridge.handle(request('five', 'file.stat', { path: '/safe/a' }), { token: token2, peerFingerprint: 'peer-A' }), error => error.code === 'stopped')
})

test('restricted interfaces confine paths, processes, logs and structured UI operations', async () => {
  const calls = []
  const bridge = new GuestBridge({
    platform: 'linux', fileRoots: ['/allowed'],
    uiStatus: { available: true, platform: 'linux', backend: 'AT-SPI' },
    adapters: {
      file: { read: async (path, limits) => { calls.push({ path, limits }); return 'hello' }, list: async () => [], stat: async () => ({}) },
      process: { list: async () => [{ pid: 7, name: 'worker', commandLine: '--secret' }], signal: async (pid, signal) => ({ pid, signal }) },
      log: { read: async () => ['ok', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890'] },
      ui: { snapshot: async () => ({ root: 'r' }), query: async value => value, invoke: async value => value, setValue: async value => value }
    }
  })
  const actions = ['file.read', 'file.list', 'file.stat', 'process.list', 'process.signal', 'log.read', 'ui.snapshot', 'ui.query', 'ui.invoke', 'ui.setValue']
  const token = bridge.authority.grant({ peerFingerprint: 'peer', actions })
  const context = { token, peerFingerprint: 'peer' }

  assert.equal((await bridge.handle(request('r1', 'file.read', { path: '/allowed/a' }), context)).result, 'hello')
  assert.equal(calls[0].limits.followSymlinks, false)
  assert.equal((await bridge.handle(request('r2', 'file.read', { path: '/allowed/../outside' }), context)).error.code, 'path-denied')
  assert.equal((await bridge.handle(request('r3', 'process.signal', { pid: 7, signal: 'SIGKILL' }), context)).error.code, 'signal-denied')
  const listed = await bridge.handle(request('r4', 'process.list'), context)
  assert.deepEqual(listed.result, [{ pid: 7, name: 'worker' }])
  const logs = await bridge.handle(request('r5', 'log.read', { lines: 50 }), context)
  assert.equal(JSON.stringify(logs.result).toLowerCase().includes('bearer abc'), false)
  assert.equal((await bridge.handle(request('r6', 'ui.invoke', { elementId: 'button', x: 10 }), context)).error.code, 'unstructured-ui-denied')
  assert.equal((await bridge.handle(request('r7', 'ui.setValue', { elementId: 'field', value: 'x', metadata: { role: 'password' } }), context)).error.code, 'sensitive-field')
  assert.equal((await bridge.handle(request('r8', 'ui.setValue', { elementId: 'field', value: 'normal', metadata: { role: 'textbox' } }), context)).ok, true)
})
