const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = readFileSync(path.resolve(__dirname, '..', 'renderer', 'model-routing-integration.js'), 'utf8')

test('official Models DOM invalidations refresh the desktop catalog without observing its own panel', () => {
  assert.match(source, /new MutationObserver\(records =>/u)
  assert.match(source, /officialModelsChanged\(records\)/u)
  assert.match(source, /insideRoutingPanel\(record\.target\)/u)
  assert.match(source, /request\('refresh-model-routing'\)/u)
  assert.match(source, /characterData: true/u)
  assert.doesNotMatch(source, /scheduleProviderRefresh[\s\S]*?request\('save-model-routing'/u)
})

test('installation carries the safe route selector into the isolated official WebView', async () => {
  const sandbox = { window: {} }
  vm.runInNewContext(source, sandbox)
  let installed = ''
  await sandbox.window.harnessModelRoutingIntegration.install({
    executeJavaScript(script) {
      installed = script
      return Promise.resolve()
    }
  })

  assert.match(installed, /guestModelRoutingBootstrap/u)
  assert.match(installed, /selectInitialRoute/u)
  assert.match(installed, /state\.configured === true/u)
})
