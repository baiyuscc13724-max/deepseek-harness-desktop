const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { AppStateStore, normalizeState } = require('../electron/store/app-state-store.cjs')

test('AppStateStore persists update preferences', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-state-'))
  const file = path.join(dir, 'app-state.json')
  const store = new AppStateStore(file)
  store.updatePreferences({ checkOnStartup: false, channel: 'prerelease' })
  const restored = new AppStateStore(file).get()
  assert.equal(restored.updates.checkOnStartup, false)
  assert.equal(restored.updates.channel, 'prerelease')
})

test('normalizeState discards unknown mutable fields', () => {
  const state = normalizeState({ onboarding: { completed: 1, evil: true }, updates: { channel: 'oops', checkOnStartup: 0 }, secret: 'nope' })
  assert.equal('onboarding' in state, false)
  assert.equal(state.updates.channel, 'stable')
  assert.equal(state.updates.checkOnStartup, true)
  assert.equal('secret' in state, false)
})
