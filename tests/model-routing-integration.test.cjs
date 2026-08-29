const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = readFileSync(path.resolve(__dirname, '..', 'renderer', 'model-routing-integration.js'), 'utf8')

test('official Models DOM invalidations refresh the desktop catalog without observing its own panel', () => {
  assert.match(source, /new MutationObserver\(records =>/u)
  assert.match(source, /officialModelsChanged\(records\)/u)
  assert.match(source, /if \(!mutationTouchesSettingsDialog\(records\)\) return/u)
  assert.match(source, /insideRoutingPanel\(record\.target\)/u)
  assert.match(source, /request\('refresh-model-routing'\)/u)
  assert.match(source, /characterData: true/u)
  assert.doesNotMatch(source, /scheduleProviderRefresh[\s\S]*?request\('save-model-routing'/u)
})

test('model routing ignores unrelated streaming mutations but keeps settings lifecycle changes', () => {
  const sandbox = { window: {} }
  vm.runInNewContext(source, sandbox)
  const touches = sandbox.window.harnessModelRoutingIntegration.mutationTouchesSettingsDialog
  const dialog = {}
  const outside = { nodeType: 1, matches: () => false, closest: () => null, querySelector: () => null }
  const inside = { nodeType: 1, matches: () => false, closest: () => dialog, querySelector: () => null }
  const wrapper = { nodeType: 1, matches: () => false, closest: () => null, querySelector: () => dialog }
  const removedDialog = { nodeType: 1, matches: () => true, closest: () => null, querySelector: () => null }
  const text = { nodeType: 3, parentElement: outside }

  assert.equal(touches([{ target: outside, addedNodes: [text], removedNodes: [] }]), false)
  assert.equal(touches([{ target: inside, addedNodes: [], removedNodes: [] }]), true)
  assert.equal(touches([{ target: outside, addedNodes: [wrapper], removedNodes: [] }]), true)
  assert.equal(touches([{ target: outside, addedNodes: [], removedNodes: [removedDialog] }]), true)
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
  assert.match(installed, /resolveSubagentDisplay/u)
  assert.match(installed, /mutationTouchesSettingsDialog/u)
  assert.match(installed, /select\.disabled = inherited/u)
  assert.match(installed, /state\.configured === true/u)
})
