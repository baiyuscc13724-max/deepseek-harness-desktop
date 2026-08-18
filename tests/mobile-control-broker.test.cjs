const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CONTROL_PROTOCOL_VERSION,
  MobileControlBroker,
  isLoopbackAddress,
  normalizePayload
} = require('../electron/bridge/mobile-control-broker.cjs')

function readyBroker() {
  let sequence = 0
  let now = Date.parse('2026-08-18T00:00:00.000Z')
  const broker = new MobileControlBroker({ now: () => now, idFactory: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` })
  broker.reportStatus('phone-a', {
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    enabled: true,
    ready: true,
    accessibility: true,
    capabilities: ['tap', 'swipe', 'textInput', 'screenshot', 'clearCache']
  })
  return { broker, advance: value => { now += value } }
}

test('control broker negotiates capabilities and returns command receipts', () => {
  const { broker } = readyBroker()
  const command = broker.enqueue('phone-a', { action: 'tap', payload: { x: 24.4, y: 80.9 }, timeoutMs: 2500, retryLimit: 1 })
  assert.equal(command.protocolVersion, 1)
  assert.deepEqual(command.payload, { x: 24, y: 81 })
  assert.equal(broker.state([{ id: 'phone-a', name: 'Pixel' }]).devices[0].queued, 1)

  const delivery = broker.poll('phone-a', 1)
  assert.equal(delivery.command.id, command.id)
  const result = broker.reportResult('phone-a', { id: command.id, ok: true, code: 'OK', message: 'clicked' })
  assert.equal(result.ok, true)
  assert.equal(broker.result(command.id).action, 'tap')
})

test('control broker rejects unsupported and forbidden operations', () => {
  const { broker } = readyBroker()
  assert.throws(() => broker.enqueue('phone-a', { action: 'shell', payload: { command: 'rm -rf /' } }), /拒绝/)
  assert.throws(() => broker.enqueue('phone-a', { action: 'openApp', payload: { packageName: 'com.example.app' } }), /未上报 openApp/)
  assert.throws(() => normalizePayload('openUri', { uri: 'javascript:alert(1)' }), /只允许/)
  assert.throws(() => normalizePayload('clearCache', { packageName: 'bad package' }), /有效/)
})

test('sensitive actions always request phone-side confirmation', () => {
  const { broker } = readyBroker()
  const text = broker.enqueue('phone-a', { action: 'textInput', payload: { text: 'hello' } })
  const cache = broker.enqueue('phone-a', { action: 'clearCache', payload: { packageName: 'com.example.app' } })
  assert.equal(text.requiresConfirmation, true)
  assert.equal(cache.requiresConfirmation, true)
  assert.equal(cache.payload.neverClearData, true)
})

test('stop clears work and delivers an immediate stop directive', () => {
  const { broker } = readyBroker()
  broker.enqueue('phone-a', { action: 'tap', payload: { x: 1, y: 2 } })
  broker.stop('phone-a')
  const delivery = broker.poll('phone-a', 1)
  assert.equal(delivery.command.type, 'stop')
  assert.equal(broker.state([{ id: 'phone-a', name: 'Pixel' }]).devices[0].ready, false)
})

test('protocol mismatch never dispatches queued actions', () => {
  const { broker } = readyBroker()
  broker.enqueue('phone-a', { action: 'tap', payload: { x: 1, y: 2 } })
  const result = broker.poll('phone-a', 99)
  assert.equal(result.error.code, 'PROTOCOL_MISMATCH')
  assert.equal(broker.state([{ id: 'phone-a', name: 'Pixel' }]).devices[0].queued, 1)
})

test('desktop command endpoints can be restricted to loopback', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('192.168.1.9'), false)
})
