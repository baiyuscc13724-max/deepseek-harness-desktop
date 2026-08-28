const test = require('node:test')
const assert = require('node:assert/strict')

const { BrowserOperationCoordinator, runBrowserOperation } = require('../electron/bridge/browser-operation-coordinator.cjs')

test('Profile reset invalidates in-flight browser tickets and blocks reentry', () => {
  const coordinator = new BrowserOperationCoordinator()
  const before = coordinator.ticket()
  const resetGeneration = coordinator.beginReset()
  assert.equal(coordinator.snapshot().resetting, true)
  assert.throws(() => coordinator.ticket(), error => error.code === 'profile-resetting')
  assert.throws(() => coordinator.assert(before), error => error.code === 'profile-resetting')
  assert.throws(() => coordinator.beginReset(), error => error.code === 'profile-resetting')
  coordinator.finishReset(resetGeneration)
  assert.equal(coordinator.snapshot().resetting, false)
  const after = coordinator.ticket()
  assert.notEqual(after, before)
  assert.throws(() => coordinator.assert(before), error => error.code === 'profile-resetting')
  assert.equal(coordinator.assert(after), true)
})

test('a mismatched reset generation cannot unlock the coordinator', () => {
  const coordinator = new BrowserOperationCoordinator()
  const generation = coordinator.beginReset()
  assert.throws(() => coordinator.finishReset(generation + 1), error => error.code === 'reset-generation-mismatch')
  assert.equal(coordinator.snapshot().resetting, true)
  coordinator.finishReset(generation)
  assert.equal(coordinator.snapshot().resetting, false)
})

test('model cancellation invalidates only model tickets', () => {
  const coordinator = new BrowserOperationCoordinator()
  const userTicket = coordinator.ticket()
  const modelTicket = coordinator.modelTicket()

  coordinator.cancelModelActions()

  assert.equal(coordinator.assert(userTicket), true)
  assert.throws(() => coordinator.assert(modelTicket), error => error.code === 'browser-action-cancelled')
  assert.equal(coordinator.assert(coordinator.modelTicket()), true)
})

test('an aborted request signal cannot start or continue a model action', () => {
  const coordinator = new BrowserOperationCoordinator()
  const active = new AbortController()
  const ticket = coordinator.modelTicket(active.signal)
  active.abort()
  assert.throws(() => coordinator.assert(ticket), error => error.code === 'browser-action-cancelled')

  const alreadyAborted = new AbortController()
  alreadyAborted.abort()
  assert.throws(() => coordinator.modelTicket(alreadyAborted.signal), error => error.code === 'browser-action-cancelled')
})

test('browser operations reject a non-responsive transport at a bounded deadline', async () => {
  await assert.rejects(
    runBrowserOperation(() => new Promise(() => {}), {
      timeoutMs: 20,
      timeoutCode: 'browser-outcome-unknown',
      timeoutMessage: 'outcome unknown'
    }),
    error => error.code === 'browser-outcome-unknown' && error.statusCode === 504 && error.message === 'outcome unknown'
  )
})

test('browser operations stop waiting when their request is aborted', async () => {
  const controller = new AbortController()
  const pending = runBrowserOperation(() => new Promise(() => {}), { signal: controller.signal, timeoutMs: 1_000 })
  controller.abort()
  await assert.rejects(pending, error => error.code === 'browser-action-cancelled' && error.statusCode === 499)
})

test('browser operations preserve successful values before the deadline', async () => {
  assert.deepEqual(
    await runBrowserOperation(async () => ({ completed: true }), { timeoutMs: 100 }),
    { completed: true }
  )
})
