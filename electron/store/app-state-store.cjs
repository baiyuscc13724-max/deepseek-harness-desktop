const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { THEME_CATALOG } = require('../../renderer/theme-catalog.js')

const VALID_THEME_IDS = new Set(THEME_CATALOG.map(theme => theme.id))
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const DEFAULT_THEME_ID = 'porcelain-mist'

function boundedInteger(value, minimum, maximum, fallback) {
  if (value === null || value === '' || typeof value === 'boolean') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(number)))
}

function normalizeCustomTheme(value = {}) {
  return {
    mode: value.mode === 'light' ? 'light' : 'dark',
    accent: HEX_COLOR.test(value.accent) ? value.accent.toLowerCase() : '#6f8cff',
    surface: HEX_COLOR.test(value.surface) ? value.surface.toLowerCase() : '#171b29',
    text: HEX_COLOR.test(value.text) ? value.text.toLowerCase() : '#f4f7ff',
    wallpaperBrightness: boundedInteger(value.wallpaperBrightness, 40, 140, 82),
    wallpaperBlur: boundedInteger(value.wallpaperBlur, 0, 24, 2),
    glassTransparency: boundedInteger(value.glassTransparency, 0, 75, 32),
    borderStrength: boundedInteger(value.borderStrength, 0, 100, 48),
    backgroundFile: /^custom-background\.(?:png|jpe?g|webp)$/i.test(value.backgroundFile || '')
      ? value.backgroundFile
      : null
  }
}

const DEFAULT_STATE = Object.freeze({
  schemaVersion: 5,
  updates: { checkOnStartup: true, channel: 'stable', lastCheckedAt: null, skippedVersion: null },
  appearance: {
    themeId: DEFAULT_THEME_ID,
    customTheme: normalizeCustomTheme()
  },
  pet: {
    enabled: true,
    awake: false,
    alwaysOnTop: true,
    autoFeed: true,
    motion: 'system',
    muted: true,
    positionByDisplay: {}
  },
  memory: {
    enabled: false,
    sensitivityMode: 'reject',
    autoRecall: false
  }
})

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE))
}

function normalizeState(input) {
  const base = cloneDefaultState()
  const value = input && typeof input === 'object' ? input : {}
  const savedTheme = VALID_THEME_IDS.has(value.appearance?.themeId) ? value.appearance.themeId : DEFAULT_THEME_ID
  const themeId = Number(value.schemaVersion || 0) < 3 && savedTheme === 'official' ? DEFAULT_THEME_ID : savedTheme
  return {
    schemaVersion: 5,
    updates: {
      checkOnStartup: value.updates?.checkOnStartup !== false,
      channel: value.updates?.channel === 'prerelease' ? 'prerelease' : 'stable',
      lastCheckedAt: value.updates?.lastCheckedAt || null,
      skippedVersion: value.updates?.skippedVersion || null
    },
    appearance: {
      themeId,
      customTheme: normalizeCustomTheme(value.appearance?.customTheme)
    },
    pet: {
      enabled: value.pet?.enabled !== false,
      awake: value.pet?.awake === true,
      alwaysOnTop: value.pet?.alwaysOnTop !== false,
      autoFeed: value.pet?.autoFeed !== false,
      motion: ['system', 'full', 'reduced', 'still'].includes(value.pet?.motion) ? value.pet.motion : 'system',
      muted: value.pet?.muted !== false,
      positionByDisplay: normalizePetPositions(value.pet?.positionByDisplay)
    },
    memory: {
      enabled: value.memory?.enabled === true,
      sensitivityMode: value.memory?.sensitivityMode === 'redact' ? 'redact' : 'reject',
      autoRecall: value.memory?.autoRecall === true
    }
  }
}

function normalizePetPositions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value).slice(0, 16).flatMap(([displayId, position]) => {
    const x = Number(position?.x)
    const y = Number(position?.y)
    if (!/^[\w.-]{1,80}$/.test(displayId) || !Number.isFinite(x) || !Number.isFinite(y)) return []
    return [[displayId, { x: Math.round(x), y: Math.round(y) }]]
  })
  return Object.fromEntries(entries)
}

class AppStateStore {
  constructor(file) {
    this.file = file
    this.state = this.#load()
  }

  #load() {
    try { return normalizeState(JSON.parse(readFileSync(this.file, 'utf8'))) }
    catch { return cloneDefaultState() }
  }

  #persist() {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, this.file)
  }

  get() {
    return JSON.parse(JSON.stringify(this.state))
  }

  updatePreferences(patch = {}) {
    if (Object.prototype.hasOwnProperty.call(patch, 'checkOnStartup')) {
      this.state.updates.checkOnStartup = Boolean(patch.checkOnStartup)
    }
    if (patch.channel) this.state.updates.channel = patch.channel === 'prerelease' ? 'prerelease' : 'stable'
    if (Object.prototype.hasOwnProperty.call(patch, 'skippedVersion')) this.state.updates.skippedVersion = patch.skippedVersion || null
    this.#persist()
    return this.get()
  }

  markUpdateChecked(date = new Date()) {
    this.state.updates.lastCheckedAt = date.toISOString()
    this.#persist()
    return this.get()
  }

  updateAppearance(patch = {}) {
    if (Object.prototype.hasOwnProperty.call(patch, 'themeId')) {
      this.state.appearance.themeId = VALID_THEME_IDS.has(patch.themeId) ? patch.themeId : DEFAULT_THEME_ID
    }
    if (patch.customTheme && typeof patch.customTheme === 'object') {
      this.state.appearance.customTheme = normalizeCustomTheme({
        ...this.state.appearance.customTheme,
        ...patch.customTheme
      })
    }
    this.#persist()
    return this.get()
  }

  updatePet(patch = {}) {
    for (const key of ['enabled', 'awake', 'alwaysOnTop', 'autoFeed', 'muted']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) this.state.pet[key] = Boolean(patch[key])
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'motion')) {
      this.state.pet.motion = ['system', 'full', 'reduced', 'still'].includes(patch.motion) ? patch.motion : 'system'
    }
    if (patch.positionByDisplay && typeof patch.positionByDisplay === 'object') {
      this.state.pet.positionByDisplay = normalizePetPositions({
        ...this.state.pet.positionByDisplay,
        ...patch.positionByDisplay
      })
    }
    this.#persist()
    return this.get()
  }

  updateMemory(patch = {}) {
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) this.state.memory.enabled = Boolean(patch.enabled)
    if (Object.prototype.hasOwnProperty.call(patch, 'sensitivityMode')) {
      this.state.memory.sensitivityMode = patch.sensitivityMode === 'redact' ? 'redact' : 'reject'
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'autoRecall')) this.state.memory.autoRecall = Boolean(patch.autoRecall)
    this.#persist()
    return this.get()
  }
}

module.exports = { AppStateStore, DEFAULT_STATE, DEFAULT_THEME_ID, VALID_THEME_IDS, normalizeState, normalizePetPositions }
