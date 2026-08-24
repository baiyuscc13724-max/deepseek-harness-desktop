const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { MobileRelayConfigStore, loadMobileRelayConfig, normalizeRelayUrl, probeMobileRelay, validateRelayUrl } = require('../electron/bridge/mobile-relay-config.cjs')

test('packaged relay configuration is disabled by default and ignores environment injection', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-relay-config-'))
  const file = path.join(directory, 'relay.json')
  writeFileSync(file, '{"enabled":false,"relayUrl":""}')
  assert.deepEqual(loadMobileRelayConfig({ file, env: { HARNESS_MOBILE_RELAY_URL: 'wss://attacker.example' } }), { enabled: false, relayUrl: '' })
})

test('reviewed or explicit development relay configuration requires credential-free WSS', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-relay-config-'))
  const file = path.join(directory, 'relay.json')
  writeFileSync(file, '{"enabled":true,"relayUrl":"wss://relay.example.com/tunnel"}')
  assert.equal(loadMobileRelayConfig({ file }).relayUrl, 'wss://relay.example.com/tunnel')
  assert.equal(loadMobileRelayConfig({ file, env: { HARNESS_MOBILE_RELAY_URL: 'wss://dev.example' }, allowEnvironmentOverride: true }).relayUrl, 'wss://dev.example/')
  assert.throws(() => validateRelayUrl('ws://relay.example.com'), /wss/)
  assert.throws(() => validateRelayUrl('wss://relay.example.com:8443'), /443/)
  assert.throws(() => validateRelayUrl('wss://user:pass@relay.example.com'), /credential/)
  assert.throws(() => validateRelayUrl('wss://relay.example.com/tunnel?token=secret'), /query/)
  assert.equal(normalizeRelayUrl('relay.example.com/tunnel', { allowBareHost: true }), 'wss://relay.example.com/tunnel')
})

class HealthyWebSocket extends EventEmitter {
  static OPEN = 1
  static CLOSING = 2
  constructor(url, options) {
    super()
    this.url = url
    this.options = options
    this.readyState = 0
    queueMicrotask(() => {
      this.readyState = HealthyWebSocket.OPEN
      this.emit('open')
    })
  }
  send(payload) {
    const hello = JSON.parse(payload)
    assert.equal(hello.type, 'hello')
    assert.equal(hello.role, 'desktop')
    queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'welcome', role: 'desktop' })))
  }
  close() { this.readyState = HealthyWebSocket.CLOSING }
}

class FailedWebSocket extends EventEmitter {
  static CLOSING = 2
  constructor() {
    super()
    this.readyState = 0
    queueMicrotask(() => this.emit('error', new Error('connection refused')))
  }
  close() { this.readyState = FailedWebSocket.CLOSING }
}

test('user relay is detected before atomic persistence and clear restores the disabled packaged default', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-user-relay-'))
  const packagedFile = path.join(directory, 'packaged.json')
  const userFile = path.join(directory, 'user.json')
  writeFileSync(packagedFile, '{"enabled":false,"relayUrl":""}')
  const store = new MobileRelayConfigStore({ file: userFile, packagedFile, WebSocketImpl: HealthyWebSocket, probeTimeoutMs: 500 })
  assert.deepEqual(store.get(), { enabled: false, relayUrl: '', source: 'disabled', checkedAt: null })
  const saved = await store.set('relay.example.com/tunnel')
  assert.equal(saved.enabled, true)
  assert.equal(saved.relayUrl, 'wss://relay.example.com/tunnel')
  assert.equal(saved.source, 'user')
  assert.ok(Number.isFinite(Date.parse(saved.checkedAt)))
  const document = JSON.parse(readFileSync(userFile, 'utf8'))
  assert.deepEqual(Object.keys(document).sort(), ['checkedAt', 'enabled', 'relayUrl', 'version'])
  assert.equal(store.clear().enabled, false)
  assert.equal(existsSync(userFile), false)
})

test('failed health detection never replaces an existing user relay', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-user-relay-fail-'))
  const packagedFile = path.join(directory, 'packaged.json')
  const userFile = path.join(directory, 'user.json')
  writeFileSync(packagedFile, '{"enabled":false,"relayUrl":""}')
  const healthy = new MobileRelayConfigStore({ file: userFile, packagedFile, WebSocketImpl: HealthyWebSocket, probeTimeoutMs: 500 })
  await healthy.set('first.example.com')
  const before = readFileSync(userFile, 'utf8')
  const failed = new MobileRelayConfigStore({ file: userFile, packagedFile, WebSocketImpl: FailedWebSocket, probeTimeoutMs: 500 })
  await assert.rejects(failed.set('second.example.com'), /connection refused/)
  assert.equal(readFileSync(userFile, 'utf8'), before)
})

test('relay health probe exposes no credentials and returns the normalized endpoint', async () => {
  const result = await probeMobileRelay('relay.example.com', { WebSocketImpl: HealthyWebSocket, timeoutMs: 500 })
  assert.equal(result.ok, true)
  assert.equal(result.relayUrl, 'wss://relay.example.com/')
})
