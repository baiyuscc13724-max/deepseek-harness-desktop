const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { terminateProcessTree, waitForProcessExit } = require('../electron/bridge/process-tree.cjs')

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

test('runtime retirement waits for the exact child exit event', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 2468, exitCode: null })
  let timerCleared = false
  const waiting = waitForProcessExit(child, {
    setTimeoutImpl: () => ({ unref() {} }),
    clearTimeoutImpl: () => { timerCleared = true }
  })
  child.exitCode = 0
  child.emit('exit', 0, null)
  assert.equal(await waiting, true)
  assert.equal(timerCleared, true)
  assert.equal(child.listenerCount('exit'), 0)
})

test('runtime retirement reports a still-live child after its bounded wait', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 1357, exitCode: null })
  let timeout
  const waiting = waitForProcessExit(child, {
    setTimeoutImpl: callback => { timeout = callback; return { unref() {} } },
    clearTimeoutImpl() {}
  })
  timeout()
  assert.equal(await waiting, false)
  assert.equal(child.listenerCount('exit'), 0)
})
