const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { buildRuntimeProxyEnv, hasExplicitProxy, proxyFromElectronRules } = require('../electron/bridge/runtime-proxy.cjs')

test('desktop runtime never opens a duplicate external Web window', () => {
  const main = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /\[\.\.\.resolved\.argsPrefix, 'web', '--port', '0', '--no-open'\]/)
})

test('inherits explicit proxy variables and enables native Node proxy support', () => {
  const env = buildRuntimeProxyEnv({ HTTPS_PROXY: 'http://127.0.0.1:7897', NO_PROXY: 'example.test' })
  assert.equal(env.NODE_USE_ENV_PROXY, '1')
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7897')
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7897')
  assert.match(env.NO_PROXY, /example\.test/)
  assert.match(env.NO_PROXY, /localhost/)
  assert.equal(hasExplicitProxy({ https_proxy: 'http://proxy.test:8080' }), true)
})

test('converts an Electron system proxy rule for the child runtime', () => {
  assert.equal(proxyFromElectronRules('PROXY 127.0.0.1:7897; DIRECT'), 'http://127.0.0.1:7897')
  const env = buildRuntimeProxyEnv({}, 'HTTPS proxy.example:8443; DIRECT')
  assert.equal(env.HTTP_PROXY, 'http://proxy.example:8443')
  assert.equal(env.HTTPS_PROXY, 'http://proxy.example:8443')
})

test('keeps direct users direct while bypassing the local Harness server', () => {
  const env = buildRuntimeProxyEnv({}, 'DIRECT')
  assert.equal(env.NODE_USE_ENV_PROXY, '1')
  assert.equal(env.HTTP_PROXY, undefined)
  assert.equal(env.HTTPS_PROXY, undefined)
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1,::1')
})
