const test = require('node:test')
const assert = require('node:assert/strict')

const { BrowserOperationCoordinator } = require('../electron/bridge/browser-operation-coordinator.cjs')

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
