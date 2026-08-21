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
    platform: 'android',
    deviceClass: 'phone',
    appVersion: '1.0.20',
    capabilities: ['tap', 'swipe', 'textInput', 'screenshot', 'clearCache']
  })
  return { broker, advance: value => { now += value } }
}

test('control broker negotiates capabilities and returns command receipts', () => {
  const { broker } = readyBroker()
  const command = broker.enqueue('phone-a', { action: 'tap', payload: { x: 24.4, y: 80.9 }, timeoutMs: 2500, retryLimit: 1 })
  assert.equal(command.protocolVersion, 1)
  assert.deepEqual(command.payload, { x: 24, y: 81 })
  const device = broker.state([{ id: 'phone-a', name: 'Pixel' }]).devices[0]
  assert.equal(device.queued, 1)
  assert.equal(device.platform, 'android')
  assert.equal(device.deviceClass, 'phone')
  assert.equal(device.appVersion, '1.0.20')

  const delivery = broker.poll('phone-a', 1)
  assert.equal(delivery.command.id, command.id)
  const result = broker.reportResult('phone-a', { id: command.id, ok: true, code: 'OK', message: 'clicked' })
  assert.equal(result.ok, true)
  assert.equal(broker.result(command.id).action, 'tap')
})

test('control protocol is platform-neutral and gates future iOS clients only by capabilities', () => {
  const broker = new MobileControlBroker({ idFactory: () => '00000000-0000-4000-8000-000000000099' })
  broker.reportStatus('ios-a', {
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    platform: 'ios',
    deviceClass: 'tablet',
    appVersion: '0.1.0',
    enabled: true,
    ready: true,
    capabilities: ['screenshot', 'filePicker']
  })
  const device = broker.state([{ id: 'ios-a', name: 'iPad', platform: 'ios' }]).devices[0]
  assert.equal(device.platform, 'ios')
  assert.equal(device.deviceClass, 'tablet')
  assert.equal(broker.enqueue('ios-a', { action: 'screenshot', payload: { maxWidth: 900 } }).action, 'screenshot')
  assert.throws(() => broker.enqueue('ios-a', { action: 'openApp', payload: { packageName: 'com.example.app' } }), /未上报 openApp/)
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

test('stop immediately terminates queued work that was never delivered', () => {
  const { broker } = readyBroker()
  const command = broker.enqueue('phone-a', { action: 'tap', payload: { x: 1, y: 2 } })
  broker.stop('phone-a')
  assert.equal(broker.result(command.id).code, 'DESKTOP_STOP')
  assert.equal(broker.result(command.id).ok, false)
  assert.equal(broker.poll('phone-a', 1).command.type, 'stop')
  assert.equal(broker.state([{ id: 'phone-a', name: 'Pixel' }]).devices[0].ready, false)
})

test('delivered stop stays pending until the phone reports its real result', () => {
  const { broker } = readyBroker()
  const command = broker.enqueue('phone-a', { action: 'tap', payload: { x: 1, y: 2 } })
  assert.equal(broker.poll('phone-a', 1).command.id, command.id)
  broker.stop('phone-a')
  assert.equal(broker.result(command.id), null)
  assert.equal(broker.poll('phone-a', 1).command.type, 'stop')
  const result = broker.reportResult('phone-a', { id: command.id, ok: true, code: 'OK', message: 'completed before stop' })
  assert.equal(result.code, 'OK')
  assert.equal(result.stopReason, 'DESKTOP_STOP')
  assert.match(result.stopRequestedAt, /^2026-08-18T/)
})

test('cancel immediately terminates queued work but delivered work stays pending', () => {
  const { broker } = readyBroker()
  const queued = broker.enqueue('phone-a', { action: 'tap', payload: { x: 1, y: 2 } })
  assert.equal(broker.cancel(queued.id), true)
  assert.equal(broker.result(queued.id).code, 'USER_CANCELLED')
  assert.equal(broker.poll('phone-a', 1).command, null)

  const delivered = broker.enqueue('phone-a', { action: 'tap', payload: { x: 3, y: 4 } })
  assert.equal(broker.poll('phone-a', 1).command.id, delivered.id)
  assert.equal(broker.cancel(delivered.id), true)
  assert.equal(broker.result(delivered.id), null)
  const directive = broker.poll('phone-a', 1).command
  assert.equal(directive.type, 'cancel')
  assert.equal(directive.payload.commandId, delivered.id)
  const result = broker.reportResult('phone-a', { id: delivered.id, ok: false, code: 'CANCELLED_ON_PHONE' })
  assert.equal(result.code, 'CANCELLED_ON_PHONE')
  assert.equal(result.cancelReason, 'USER_CANCELLED')
  assert.match(result.cancelRequestedAt, /^2026-08-18T/)
})

test('delivered cancel and stop become explicitly unconfirmed only at command TTL', () => {
  const cancelled = readyBroker()
  const cancelCommand = cancelled.broker.enqueue('phone-a', { action: 'tap', payload: { x: 1, y: 2 } })
  cancelled.broker.poll('phone-a', 1)
  cancelled.broker.cancel(cancelCommand.id)
  cancelled.advance(2 * 60_000)
  const cancelResult = cancelled.broker.result(cancelCommand.id)
  assert.equal(cancelResult.code, 'CANCEL_UNCONFIRMED')
  assert.equal(cancelResult.cancelReason, 'USER_CANCELLED')

  const stopped = readyBroker()
  const stopCommand = stopped.broker.enqueue('phone-a', { action: 'tap', payload: { x: 3, y: 4 } })
  stopped.broker.poll('phone-a', 1)
  stopped.broker.stop('phone-a')
  stopped.advance(2 * 60_000)
  const stopResult = stopped.broker.result(stopCommand.id)
  assert.equal(stopResult.code, 'STOP_UNCONFIRMED')
  assert.equal(stopResult.stopReason, 'DESKTOP_STOP')
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
