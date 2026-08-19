const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadMobileRelayConfig, validateRelayUrl } = require('../electron/bridge/mobile-relay-config.cjs')

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
})
