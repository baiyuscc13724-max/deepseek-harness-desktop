const test = require('node:test')
const assert = require('node:assert/strict')

const {
  AUDIT_CAPACITY,
  CAPABILITY_WHITELIST,
  CapabilityBroker,
  SENSITIVE_ACTIONS,
  generateToken,
  isLoopbackAddress,
  validateSource
} = require('../electron/bridge/capability-broker.cjs')

function makeBroker() {
  let sequence = 0
  let now = Date.parse('2026-08-18T00:00:00.000Z')
  const broker = new CapabilityBroker({
    now: () => now,
    idFactory: () => `req-${String(++sequence).padStart(4, '0')}`,
    token: 'test-token-ABCDEFGHIJKLMNOP'
  })
  return { broker, advance: value => { now += value } }
}

test('whitelist is fixed and only known actions resolve to capabilities', () => {
  assert.ok(Object.isFrozen(CAPABILITY_WHITELIST))
  assert.equal(CAPABILITY_WHITELIST.storageScan, 'storageScan')
  assert.equal(CAPABILITY_WHITELIST.storageCleanupPreview, 'storageCleanupPreview')
  assert.equal(CAPABILITY_WHITELIST.storageCleanupApply, 'storageCleanupApply')
  // 只有真正执行删除的动作敏感；预览保持只读。
  assert.equal(SENSITIVE_ACTIONS.has('storageCleanupPreview'), false)
  assert.equal(SENSITIVE_ACTIONS.has('storageCleanupApply'), true)
})

test('each broker startup issues a unique random token', () => {
  const a = new CapabilityBroker()
  const b = new CapabilityBroker()
  assert.ok(a.currentToken())
  assert.notEqual(a.currentToken(), b.currentToken())
  assert.match(a.currentToken(), /^[A-Za-z0-9_-]{16,96}$/)
})

test('generateToken produces URL-safe random strings', () => {
  const t = generateToken()
  assert.match(t, /^[A-Za-z0-9_-]+$/)
  assert.equal(t.length, 32) // 24 bytes -> base64url
})

test('loopback and source validation', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('localhost'), true)
  assert.equal(isLoopbackAddress('192.168.1.9'), false)

  assert.deepEqual(validateSource('127.0.0.1'), { ok: true, reason: null })
  assert.equal(validateSource('10.0.0.5').ok, false)
  assert.deepEqual(validateSource('10.0.0.5', { allowLoopback: false, allowSources: ['10.0.0.*'] }), { ok: true, reason: null })
  assert.equal(validateSource('10.0.0.50', { allowLoopback: false, allowSources: ['10.0.0.5'] }).ok, false)
})

test('accept requires valid token and whitelisted action', () => {
  const { broker } = makeBroker()
  assert.throws(() => broker.accept({ action: 'storageScan', token: 'wrong-token' }), /令牌/)
  assert.throws(() => broker.accept({ action: 'notInWhiteList', token: broker.currentToken() }), /白名单/)
  const req = broker.accept({ action: 'storageScan', token: broker.currentToken(), source: '127.0.0.1' })
  assert.equal(req.capability, 'storageScan')
  assert.equal(req.sensitive, false)
  assert.equal(req.confirmationPolicy.required, false)
})

test('non-loopback source is rejected unless allowed', () => {
  const { broker } = makeBroker()
  assert.throws(
    () => broker.accept({ action: 'storageScan', token: broker.currentToken(), source: '203.0.113.9' }),
    /来源校验/
  )
  const ok = broker.accept({
    action: 'storageScan',
    token: broker.currentToken(),
    source: '203.0.113.9',
    sourcePolicy: { allowSources: ['203.0.113.*'] }
  })
  assert.equal(ok.source, '203.0.113.9')
})

test('per-capability queue limit is enforced', () => {
  const { broker } = makeBroker()
  broker.setQueueLimit('storageScan', 2)
  broker.accept({ action: 'storageScan', token: broker.currentToken() })
  broker.accept({ action: 'storageScan', token: broker.currentToken() })
  assert.throws(() => broker.accept({ action: 'storageScan', token: broker.currentToken() }), /队列已满/)
})

test('sensitive actions require confirmation before dispatch', () => {
  const { broker } = makeBroker()
  const req = broker.accept({ action: 'storageCleanupApply', token: broker.currentToken() })
  assert.equal(req.sensitive, true)
  assert.equal(req.confirmationPolicy.required, true)
  // 未确认时不派发。
  assert.equal(broker.next('storageCleanupApply'), null)
  // 确认后派发。
  const confirmed = broker.next('storageCleanupApply', { confirm: true })
  assert.ok(confirmed)
  assert.equal(confirmed.confirmed, true)
})

test('confirm endpoint marks sensitive request confirmed by id', () => {
  const { broker } = makeBroker()
  const req = broker.accept({ action: 'storageCleanupApply', token: broker.currentToken(), requiresConfirmation: true })
  assert.equal(broker.confirm(req.id, { yes: true }), true)
  const dispatched = broker.next('storageCleanupApply')
  assert.ok(dispatched)
})

test('cancel removes a queued request', () => {
  const { broker } = makeBroker()
  broker.accept({ action: 'storageScan', token: broker.currentToken() })
  const req = broker.accept({ action: 'storageScan', token: broker.currentToken() })
  assert.equal(broker.cancel(req.id), true)
  assert.equal(broker.next('storageScan').id === req.id, false)
})

test('stop clears all queued work', () => {
  const { broker } = makeBroker()
  broker.accept({ action: 'storageScan', token: broker.currentToken() })
  broker.accept({ action: 'storageCleanupApply', token: broker.currentToken() })
  const stopped = broker.stop()
  assert.equal(stopped, 2)
  assert.equal(broker.next('storageScan'), null)
  assert.equal(broker.next('storageCleanupApply'), null)
})

test('requests expire after TTL', () => {
  const { broker, advance } = makeBroker()
  const req = broker.accept({ action: 'storageScan', token: broker.currentToken(), ttlMs: 1000 })
  advance(2000)
  assert.equal(broker.next('storageScan'), null)
  assert.equal(broker.snapshot().capabilities.storageScan.queued, 0)
  assert.equal(req.state, 'expired')
})

test('audit log is bounded and never records tokens or bodies', () => {
  let now = 0
  const broker = new CapabilityBroker({
    now: () => now,
    idFactory: (() => { let i = 0; return () => `req-${++i}` })(),
    token: 'tok-AAAAAAAAAAAAAAAA'
  })
  // 制造远超容量的动作。
  for (let index = 0; index < AUDIT_CAPACITY + 50; index += 1) {
    now += 1
    broker.accept({ action: 'storageScan', token: broker.currentToken(), payload: { secretBody: `body-${index}` } })
    broker.next('storageScan')
  }
  const log = broker.auditLog()
  assert.equal(log.length, AUDIT_CAPACITY)
  const serialized = JSON.stringify(log)
  assert.ok(!serialized.includes('tok-AAA'), 'audit must not contain the token')
  assert.ok(!serialized.includes('secretBody'), 'audit must not contain request bodies')
})

test('payload is returned once on dispatch and never exposed through snapshots', () => {
  const { broker } = makeBroker()
  const payload = { path: 'runtime/old-version', preview: true }
  broker.accept({ action: 'storageScan', token: broker.currentToken(), payload })
  assert.ok(!JSON.stringify(broker.snapshot()).includes('old-version'))
  assert.deepEqual(broker.next('storageScan').payload, payload)
  assert.equal(broker.next('storageScan'), null)
})

test('snapshot reports queue depth and limits but no bodies or tokens', () => {
  const { broker } = makeBroker()
  broker.accept({ action: 'storageScan', token: broker.currentToken(), payload: { body: 'x' } })
  const snap = broker.snapshot()
  assert.equal(snap.tokenIssued, true)
  assert.equal(snap.token, undefined)
  assert.equal(snap.capabilities.storageScan.queued, 1)
  assert.ok(!JSON.stringify(snap).includes('"body"'))
})
