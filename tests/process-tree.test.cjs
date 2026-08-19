const test = require('node:test')
const assert = require('node:assert/strict')
const { terminateProcessTree } = require('../electron/bridge/process-tree.cjs')

test('Windows runtime shutdown delegates to taskkill process-tree termination', () => {
  const calls = []
  const child = { pid: 1234, exitCode: null }
  assert.equal(terminateProcessTree(child, {
    platform: 'win32',
    spawnImpl: (...args) => calls.push(args)
  }), true)
  assert.deepEqual(calls[0][0], 'taskkill')
  assert.deepEqual(calls[0][1], ['/pid', '1234', '/t', '/f'])
})

test('macOS runtime shutdown signals the detached process group then escalates', () => {
  const signals = []
  let escalation
  const child = { pid: 4321, exitCode: null, kill: signal => signals.push(['child', signal]) }
  terminateProcessTree(child, {
    platform: 'darwin',
    killImpl: (pid, signal) => signals.push([pid, signal]),
    setTimeoutImpl: callback => { escalation = callback; return { unref() {} } }
  })
  assert.deepEqual(signals, [[-4321, 'SIGTERM']])
  escalation()
  assert.deepEqual(signals, [[-4321, 'SIGTERM'], [-4321, 'SIGKILL']])
})
