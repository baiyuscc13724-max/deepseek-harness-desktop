const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { applyUserDataOverride, resolveUserDataOverride } = require('../electron/bridge/user-data-override.cjs')

test('Bootstrap resolves both Chromium and argv user-data overrides before stores open', () => {
  assert.equal(resolveUserDataOverride([], 'D:\\profiles\\test'), path.resolve('D:\\profiles\\test'))
  assert.equal(resolveUserDataOverride(['desktop', '--user-data-dir', 'profiles/test']), path.resolve('profiles/test'))
  assert.equal(resolveUserDataOverride(['desktop', '--user-data-dir=profiles/inline']), path.resolve('profiles/inline'))
  assert.equal(resolveUserDataOverride(['desktop', '--harness-user-data-dir=profiles/local-test']), path.resolve('profiles/local-test'))
})

test('Bootstrap creates and applies the isolated Electron userData path', () => {
  const calls = []
  const app = {
    commandLine: { getSwitchValue: () => 'D:\\profiles\\component-test' },
    setPath: (name, value) => calls.push(['setPath', name, value])
  }
  const resolved = applyUserDataOverride(app, { mkdirImpl: (value, options) => calls.push(['mkdir', value, options]) })
  assert.equal(resolved, path.resolve('D:\\profiles\\component-test'))
  assert.deepEqual(calls[0], ['mkdir', resolved, { recursive: true }])
  assert.deepEqual(calls[1], ['setPath', 'userData', resolved])
})
