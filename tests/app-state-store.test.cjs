const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
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
    readabilityStrength: 88, backgroundFile: 'custom-background.gif',
    wallpaperEngineProject: null, wallpaperEngineSignature: null
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
      readabilityStrength: 72, backgroundFile: null,
      wallpaperEngineProject: null, wallpaperEngineSignature: null
    },
    wallpaperLibrary: { activeId: null, items: [] },
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
  assert.equal(migrated.schemaVersion, 9)
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

test('new profiles enable bounded automatic local memory and preserve explicit controls', () => {
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

test('memory migration defaults missing preferences on without overriding an explicit saved false', () => {
  const missing = normalizeState({ schemaVersion: 8 })
  assert.equal(missing.schemaVersion, 9)
  assert.deepEqual(missing.memory, { enabled: true, sensitivityMode: 'reject', autoRecall: true, autoCapture: true })

  const disabled = normalizeState({ schemaVersion: 8, memory: { enabled: false, autoRecall: true, autoCapture: true } })
  assert.deepEqual(disabled.memory, { enabled: false, sensitivityMode: 'reject', autoRecall: false, autoCapture: false })

  const partiallyConfigured = normalizeState({ schemaVersion: 8, memory: { enabled: true, autoRecall: false } })
  assert.deepEqual(partiallyConfigured.memory, { enabled: true, sensitivityMode: 'reject', autoRecall: false, autoCapture: true })

  const legacyDisabled = normalizeState({ schemaVersion: 6, memory: { enabled: false } })
  assert.deepEqual(legacyDisabled.memory, { enabled: false, sensitivityMode: 'reject', autoRecall: false, autoCapture: false })
})

test('explicit memory disable survives migration and later unrelated persistence', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-memory-disabled-migration-'))
  const file = path.join(dir, 'app-state.json')
  writeFileSync(file, JSON.stringify({ schemaVersion: 8, memory: { enabled: false, autoRecall: false, autoCapture: false } }))

  const store = new AppStateStore(file)
  assert.equal(store.get().memory.enabled, false)
  store.updatePreferences({ checkOnStartup: false })

  const persisted = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(persisted.schemaVersion, 9)
  assert.deepEqual(persisted.memory, { enabled: false, sensitivityMode: 'reject', autoRecall: false, autoCapture: false })
  assert.equal(new AppStateStore(file).get().memory.enabled, false)
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
  assert.equal(state.appearance.customTheme.glassTransparency, 100)
  assert.equal(state.appearance.customTheme.borderStrength, 100)
  assert.equal(state.appearance.customTheme.readabilityStrength, 0)
})

test('wallpaper library migrates the former single wallpaper and bounds persisted card fields', () => {
  const projectDir = process.platform === 'win32' ? 'C:\\Steam\\wallpapers\\42' : '/Steam/wallpapers/42'
  const legacy = normalizeState({ appearance: { customTheme: {
    backgroundFile: 'custom-background.webp',
    wallpaperEngineProject: projectDir,
    wallpaperEngineSignature: '1:2:3:4'
  } } })
  assert.equal(legacy.appearance.wallpaperLibrary.activeId, 'legacy-background')
  assert.deepEqual(legacy.appearance.wallpaperLibrary.items[0], {
    id: 'legacy-background', title: '42', kind: 'image', source: 'wallpaper-engine',
    cachedFile: 'custom-background.webp', projectDir, signature: '1:2:3:4',
    sourceStatus: 'ready', lastSyncedAt: null, addedAt: null
  })

  const normalized = normalizeState({ appearance: {
    customTheme: { backgroundFile: 'wallpaper-good-id.mp4' },
    wallpaperLibrary: { activeId: 'good-id', items: [
      { id: 'good-id', title: `  Demo\u0000 ${'x'.repeat(220)}  `, cachedFile: 'wallpaper-good-id.mp4', kind: 'video', source: 'local', projectDir: '../../escape', token: 'discard' },
      { id: '../escape', title: 'bad', cachedFile: '../../secret.png', kind: 'image' },
      { id: 'duplicate-file', title: 'duplicate', cachedFile: 'wallpaper-good-id.mp4', kind: 'video' }
    ] }
  } })
  assert.equal(normalized.appearance.wallpaperLibrary.activeId, 'good-id')
  assert.equal(normalized.appearance.wallpaperLibrary.items.length, 1)
  assert.equal(normalized.appearance.wallpaperLibrary.items[0].title.length, 160)
  assert.equal(normalized.appearance.wallpaperLibrary.items[0].projectDir, null)
  assert.equal('token' in normalized.appearance.wallpaperLibrary.items[0], false)

  const bounded = normalizeState({ appearance: { wallpaperLibrary: { items: Array.from({ length: 80 }, (_, index) => ({
    id: `card-${index}`, title: `Card ${index}`, cachedFile: `wallpaper-card-${index}.webp`, kind: 'image'
  })) } } })
  assert.equal(bounded.appearance.wallpaperLibrary.items.length, 48)
})

test('normalizeState discards unknown mutable fields', () => {
  const state = normalizeState({ onboarding: { completed: 1, evil: true }, updates: { channel: 'oops', checkOnStartup: 0 }, secret: 'nope' })
  assert.equal('onboarding' in state, false)
  assert.equal(state.updates.channel, 'stable')
  assert.equal(state.updates.checkOnStartup, true)
  assert.equal('secret' in state, false)
  assert.equal(state.appearance.themeId, 'porcelain-mist')
})
