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
      wallpaperBrightness: 118, wallpaperBlur: 9, glassTransparency: 86, borderStrength: 71,
      readabilityStrength: 88, backgroundFile: 'custom-background.gif'
    }
  })
  const restored = new AppStateStore(file).get().appearance
  assert.equal(restored.themeId, 'tokyo-night')
  assert.deepEqual(restored.customTheme, {
    mode: 'light', accent: '#aabbcc', surface: '#112233', text: '#f0f0f0',
    wallpaperBrightness: 118, wallpaperBlur: 9, glassTransparency: 86, borderStrength: 71,
    readabilityStrength: 88, backgroundFile: 'custom-background.gif'
  })
})

test('AppStateStore persists only validated interface mode preferences', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-ui-mode-state-'))
  const file = path.join(dir, 'app-state.json')
  const store = new AppStateStore(file)
  store.updateAppearance({ uiMode: 'spatial', reducedMotion: true, lowPerformance: true, token: 'discard-me' })
  assert.deepEqual(new AppStateStore(file).get().appearance, {
    themeId: 'porcelain-mist',
    customTheme: {
      mode: 'dark', accent: '#6f8cff', surface: '#171b29', text: '#f4f7ff',
      wallpaperBrightness: 82, wallpaperBlur: 2, glassTransparency: 32, borderStrength: 48,
      readabilityStrength: 72, backgroundFile: null
    },
    uiMode: 'spatial', reducedMotion: true, lowPerformance: true
  })
  assert.equal('token' in new AppStateStore(file).get().appearance, false)
  assert.equal(normalizeState({ appearance: { uiMode: '../../bad', reducedMotion: 1, lowPerformance: 'yes' } }).appearance.uiMode, 'official')
  assert.equal(normalizeState({ appearance: { reducedMotion: 1, lowPerformance: 'yes' } }).appearance.reducedMotion, false)
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
  assert.equal(migrated.schemaVersion, 7)
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

test('local memory defaults to safe automatic use and preserves explicit controls', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-memory-preferences-'))
  const file = path.join(dir, 'app-state.json')
  const store = new AppStateStore(file)
  assert.deepEqual(store.get().memory, { enabled: true, sensitivityMode: 'reject', autoRecall: true, autoCapture: true })
  store.updateMemory({ enabled: true, sensitivityMode: 'redact', autoRecall: false, autoCapture: false, dbPath: '../../escape', token: 'nope' })
  const restored = new AppStateStore(file).get()
  assert.deepEqual(restored.memory, { enabled: true, sensitivityMode: 'redact', autoRecall: false, autoCapture: false })
  assert.equal('dbPath' in restored.memory, false)
  assert.equal('token' in restored.memory, false)
  store.updateMemory({ enabled: false, autoRecall: true, autoCapture: true })
  assert.deepEqual(store.get().memory, { enabled: false, sensitivityMode: 'redact', autoRecall: false, autoCapture: false })
})

test('schema 6 memory preferences migrate once to safe automatic local defaults', () => {
  const migrated = normalizeState({ schemaVersion: 6, memory: { enabled: false, sensitivityMode: 'reject', autoRecall: false } })
  assert.deepEqual(migrated.memory, { enabled: true, sensitivityMode: 'reject', autoRecall: true, autoCapture: true })
  const explicitDisabled = normalizeState({ schemaVersion: 7, memory: { enabled: false, autoRecall: true, autoCapture: true } })
  assert.deepEqual(explicitDisabled.memory, { enabled: false, sensitivityMode: 'reject', autoRecall: false, autoCapture: false })
})

test('AppStateStore rejects unknown themes and unsafe custom values', () => {
  const state = normalizeState({ appearance: {
    themeId: '../../escape',
    customTheme: {
      accent: 'url(file:///secret)', surface: '#123', text: 'red', backgroundFile: '../../secret.txt',
      wallpaperBrightness: 999, wallpaperBlur: -8, glassTransparency: 999, borderStrength: 140,
      readabilityStrength: -8
    }
  } })
  assert.equal(state.appearance.themeId, 'porcelain-mist')
  assert.equal(state.appearance.customTheme.accent, '#6f8cff')
  assert.equal(state.appearance.customTheme.backgroundFile, null)
  assert.equal(state.appearance.customTheme.wallpaperBrightness, 140)
  assert.equal(state.appearance.customTheme.wallpaperBlur, 0)
  assert.equal(state.appearance.customTheme.glassTransparency, 92)
  assert.equal(state.appearance.customTheme.borderStrength, 100)
  assert.equal(state.appearance.customTheme.readabilityStrength, 0)
})

test('normalizeState discards unknown mutable fields', () => {
  const state = normalizeState({ onboarding: { completed: 1, evil: true }, updates: { channel: 'oops', checkOnStartup: 0 }, secret: 'nope' })
  assert.equal('onboarding' in state, false)
  assert.equal(state.updates.channel, 'stable')
  assert.equal(state.updates.checkOnStartup, true)
  assert.equal('secret' in state, false)
  assert.equal(state.appearance.themeId, 'porcelain-mist')
})
