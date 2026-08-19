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

test('AppStateStore persists only validated appearance fields', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-theme-state-'))
  const file = path.join(dir, 'app-state.json')
  const store = new AppStateStore(file)
  store.updateAppearance({
    themeId: 'tokyo-night',
    customTheme: {
      mode: 'light', accent: '#AABBCC', surface: '#112233', text: '#F0F0F0',
      wallpaperBrightness: 118, wallpaperBlur: 9, glassTransparency: 46, borderStrength: 71,
      backgroundFile: 'custom-background.webp'
    }
  })
  const restored = new AppStateStore(file).get().appearance
  assert.equal(restored.themeId, 'tokyo-night')
  assert.deepEqual(restored.customTheme, {
    mode: 'light', accent: '#aabbcc', surface: '#112233', text: '#f0f0f0',
    wallpaperBrightness: 118, wallpaperBlur: 9, glassTransparency: 46, borderStrength: 71,
    backgroundFile: 'custom-background.webp'
  })
})

test('custom appearance updates preserve the active catalog theme and use safe defaults for empty ranges', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-theme-merge-'))
  const store = new AppStateStore(path.join(dir, 'app-state.json'))
  store.updateAppearance({ themeId: 'tokyo-night', customTheme: { backgroundFile: 'custom-background.webp' } })
  const restored = store.updateAppearance({ customTheme: { backgroundFile: null, wallpaperBrightness: null } }).appearance
  assert.equal(restored.themeId, 'tokyo-night')
  assert.equal(restored.customTheme.backgroundFile, null)
  assert.equal(restored.customTheme.wallpaperBrightness, 82)
})

test('new installs use Porcelain Mist while preserving an explicitly selected non-default theme', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-default-theme-'))
  const file = path.join(dir, 'app-state.json')
  assert.equal(new AppStateStore(file).get().appearance.themeId, 'porcelain-mist')
  const store = new AppStateStore(file)
  store.updateAppearance({ themeId: 'tokyo-night' })
  assert.equal(new AppStateStore(file).get().appearance.themeId, 'tokyo-night')
})

test('legacy untouched official defaults migrate once to Porcelain Mist', () => {
  const migrated = normalizeState({ schemaVersion: 2, appearance: { themeId: 'official' } })
  assert.equal(migrated.schemaVersion, 5)
  assert.equal(migrated.appearance.themeId, 'porcelain-mist')
  const explicitOfficial = normalizeState({ schemaVersion: 3, appearance: { themeId: 'official' } })
  assert.equal(explicitOfficial.appearance.themeId, 'official')
})

test('AppStateStore persists validated pet preferences and display positions', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-pet-preferences-'))
  const file = path.join(dir, 'app-state.json')
  const store = new AppStateStore(file)
  store.updatePet({ awake: true, autoFeed: false, motion: 'reduced', positionByDisplay: { '123': { x: 40.4, y: 80.8 }, '../bad': { x: 1, y: 2 } } })
  const restored = new AppStateStore(file).get().pet
  assert.equal(restored.awake, true)
  assert.equal(restored.autoFeed, false)
  assert.equal(restored.motion, 'reduced')
  assert.deepEqual(restored.positionByDisplay['123'], { x: 40, y: 81 })
  assert.equal(restored.positionByDisplay['../bad'], undefined)
})

test('local memory remains opt-in and persists only safe preferences', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-memory-preferences-'))
  const file = path.join(dir, 'app-state.json')
  const store = new AppStateStore(file)
  assert.deepEqual(store.get().memory, { enabled: false, sensitivityMode: 'reject', autoRecall: false })
  store.updateMemory({ enabled: true, sensitivityMode: 'redact', autoRecall: true, dbPath: '../../escape', token: 'nope' })
  const restored = new AppStateStore(file).get()
  assert.deepEqual(restored.memory, { enabled: true, sensitivityMode: 'redact', autoRecall: true })
  assert.equal('dbPath' in restored.memory, false)
  assert.equal('token' in restored.memory, false)
})

test('AppStateStore rejects unknown themes and unsafe custom values', () => {
  const state = normalizeState({ appearance: {
    themeId: '../../escape',
    customTheme: {
      accent: 'url(file:///secret)', surface: '#123', text: 'red', backgroundFile: '../../secret.txt',
      wallpaperBrightness: 999, wallpaperBlur: -8, glassTransparency: 'oops', borderStrength: 140
    }
  } })
  assert.equal(state.appearance.themeId, 'porcelain-mist')
  assert.equal(state.appearance.customTheme.accent, '#6f8cff')
  assert.equal(state.appearance.customTheme.backgroundFile, null)
  assert.equal(state.appearance.customTheme.wallpaperBrightness, 140)
  assert.equal(state.appearance.customTheme.wallpaperBlur, 0)
  assert.equal(state.appearance.customTheme.glassTransparency, 32)
  assert.equal(state.appearance.customTheme.borderStrength, 100)
})

test('normalizeState discards unknown mutable fields', () => {
  const state = normalizeState({ onboarding: { completed: 1, evil: true }, updates: { channel: 'oops', checkOnStartup: 0 }, secret: 'nope' })
  assert.equal('onboarding' in state, false)
  assert.equal(state.updates.channel, 'stable')
  assert.equal(state.updates.checkOnStartup, true)
  assert.equal('secret' in state, false)
  assert.equal(state.appearance.themeId, 'porcelain-mist')
})
