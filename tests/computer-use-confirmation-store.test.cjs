const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { ComputerUseConfirmationStore, confirmationFingerprint } = require('../electron/bridge/computer-use-confirmation-store.cjs')

function fixture(options = {}) {
  let now = 10_000
  let sequence = 0
  const store = new ComputerUseConfirmationStore({
    now: () => now,
    idFactory: () => `confirm-${++sequence}`,
    ttlMs: 5_000,
    maxPending: 2,
    ...options
  })
  return { store, advance: milliseconds => { now += milliseconds } }
}

test('Computer Use confirmation fingerprints retain no ordinary input text', () => {
  const secretlessText = 'ordinary draft text that should not remain in confirmation memory'
  const fingerprint = confirmationFingerprint('type', { x: 20, y: 60, text: secretlessText })
  assert.match(fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(fingerprint.includes(secretlessText), false)
  const { store } = fixture()
  store.authorize('type', { x: 20, y: 60, text: secretlessText })
  const serialized = JSON.stringify(store.snapshot())
  assert.equal(serialized.includes(secretlessText), false)
  assert.equal(serialized.includes('fingerprint'), false)
})

test('duplicate requests reuse one bounded confirmation and overflow is rejected', () => {
  const { store } = fixture()
  const first = store.authorize('click', { x: 10, y: 40 })
  const duplicate = store.authorize('click', { x: 10, y: 40 })
  assert.equal(duplicate.confirmationId, first.confirmationId)
  assert.equal(store.snapshot().length, 1)
  store.authorize('scroll', { x: 20, y: 80, delta_y: 100 })
  assert.throws(() => store.authorize('click', { x: 11, y: 40 }), error => error.code === 'too-many-confirmations')
})

test('confirmation is bound to the exact action and consumed once', () => {
  const { store } = fixture()
  const request = store.authorize('type', { x: 20, y: 60, text: 'hello' })
  store.confirm(request.confirmationId)
  assert.equal(store.snapshot()[0].confirmed, true)
  assert.throws(() => store.authorize('type', { x: 20, y: 60, text: 'different', confirmation_id: request.confirmationId }), error => error.code === 'confirmation-invalid')
  assert.equal(store.authorize('type', { x: 20, y: 60, text: 'hello', confirmation_id: request.confirmationId }), null)
  assert.equal(store.snapshot().length, 0)
  assert.throws(() => store.authorize('type', { x: 20, y: 60, text: 'hello', confirmation_id: request.confirmationId }), error => error.code === 'confirmation-invalid')
})

test('confirmation becomes invalid when the visible desktop surface changes', () => {
  const { store } = fixture()
  const surface = { generation: 4, width: 1200, height: 800, url: 'file:///desktop/index.html' }
  const request = store.authorize('click', { x: 320, y: 180, surface })
  assert.match(request.summary, /\(320, 180\)/u)
  assert.match(request.summary, /1200×800/u)
  store.confirm(request.confirmationId)
  assert.throws(() => store.authorize('click', {
    x: 320,
    y: 180,
    surface: { ...surface, width: 1000 },
    confirmation_id: request.confirmationId
  }), error => error.code === 'confirmation-invalid')
  assert.equal(store.authorize('click', { x: 320, y: 180, surface, confirmation_id: request.confirmationId }), null)
})

test('cross-application confirmations bind the exact target label and key', () => {
  const { store } = fixture()
  const surface = { generation: 7, width: 900, height: 640, url: 'app://opaque-target-1', label: 'Allowed Editor' }
  const request = store.authorize('keypress', { x: 40, y: 60, key: 'ENTER', surface })
  assert.match(request.summary, /Allowed Editor/u)
  store.confirm(request.confirmationId)
  assert.throws(() => store.authorize('keypress', { x: 40, y: 60, key: 'ESCAPE', surface, confirmation_id: request.confirmationId }), error => error.code === 'confirmation-invalid')
  assert.equal(store.authorize('keypress', { x: 40, y: 60, key: 'ENTER', surface, confirmation_id: request.confirmationId }), null)
})

test('expired confirmations are pruned from state and cannot be confirmed', () => {
  const { store, advance } = fixture()
  const request = store.authorize('click', { x: 1, y: 40 })
  advance(5_000)
  assert.deepEqual(store.snapshot(), [])
  assert.throws(() => store.confirm(request.confirmationId), error => error.code === 'confirmation-invalid')
})

test('main process delegates confirmation state without retaining plaintext fingerprints', async () => {
  const main = await readFile(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /new ComputerUseConfirmationStore\(\)/)
  assert.match(main, /computerUseConfirmations\.authorize\(action, \{ \.\.\.parameters, surface: computerUseSurface\(target\) \}\)/)
  assert.match(main, /await revalidateComputerUseTarget\(target\)/)
  assert.match(main, /sourceX = Math\.max\(0, Math\.min\(sourceWidth - 1/)
  assert.match(main, /target\.fingerprint/)
  assert.match(main, /generation: computerUseSessionGeneration/)
  assert.match(main, /urls = \[mainWindow\.webContents\.getURL\(\)\]/)
  assert.match(main, /runtimeGuest && !runtimeGuest\.isDestroyed\(\)/)
  assert.match(main, /browserContents = browserSidebarVisible \? liveBrowserContents\(\) : null/)
  assert.match(main, /computerUseConfirmations\.snapshot\(\)/)
  assert.match(main, /computerUseConfirmations\.confirm\(id\)/)
  assert.match(main, /computerUseConfirmations\.reject\(id\)/)
  assert.doesNotMatch(main, /fingerprint = JSON\.stringify\(\{ action, x:/)
})
