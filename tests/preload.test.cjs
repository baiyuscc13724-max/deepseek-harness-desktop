const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadBridge() {
  const calls = []
  let exposed = null
  const ipcRenderer = {
    invoke(channel, ...args) { calls.push([channel, ...args]); return Promise.resolve(null) },
    on() {},
    removeListener() {}
  }
  const contextBridge = { exposeInMainWorld(name, value) { exposed = { name, value } } }
  const source = readFileSync(path.resolve(__dirname, '..', 'electron', 'preload.cjs'), 'utf8')
  vm.runInNewContext(source, { require(id) {
    if (id === 'electron') return { contextBridge, ipcRenderer }
    throw new Error(`unexpected require ${id}`)
  } }, { filename: 'preload.cjs' })
  return { calls, exposed }
}

test('preload exposes the unified update API without removing legacy methods', async () => {
  const { calls, exposed } = loadBridge()
  assert.equal(exposed.name, 'desktopHarness')
  const api = exposed.value
  for (const method of [
    'getUnifiedUpdateState', 'checkUnifiedUpdates', 'runUnifiedUpdateAction',
    'checkUpdates', 'installUpdate', 'getComponentUpdateState', 'checkPrPreviewUpdates', 'exitPrPreviewUpdates'
  ]) assert.equal(typeof api[method], 'function', method)
  await api.getUnifiedUpdateState()
  await api.checkUnifiedUpdates()
  assert.deepEqual(calls.slice(0, 2), [['unifiedUpdates:getState'], ['unifiedUpdates:check']])
})

test('preload sends only normalized candidate id and action to unified action IPC', async () => {
  const { calls, exposed } = loadBridge()
  await exposed.value.runUnifiedUpdateAction('pr-safe-id', 'install')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'unifiedUpdates:action')
  assert.equal(calls[0][1].id, 'pr-safe-id')
  assert.equal(calls[0][1].action, 'install')
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ['action', 'id'])
  assert.equal('url' in calls[0][1], false)
  assert.equal('manifest' in calls[0][1], false)
  assert.equal('keyId' in calls[0][1], false)
})
