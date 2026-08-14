const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { THEME_CATALOG } = require('../../renderer/theme-catalog.js')

const VALID_THEME_IDS = new Set(THEME_CATALOG.map(theme => theme.id))
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const DEFAULT_THEME_ID = 'porcelain-mist'

function normalizeCustomTheme(value = {}) {
  return {
    mode: value.mode === 'light' ? 'light' : 'dark',
    accent: HEX_COLOR.test(value.accent) ? value.accent.toLowerCase() : '#6f8cff',
    surface: HEX_COLOR.test(value.surface) ? value.surface.toLowerCase() : '#171b29',
    text: HEX_COLOR.test(value.text) ? value.text.toLowerCase() : '#f4f7ff',
    backgroundFile: /^custom-background\.(?:png|jpe?g|webp)$/i.test(value.backgroundFile || '')
      ? value.backgroundFile
      : null
  }
}

const DEFAULT_STATE = Object.freeze({
  schemaVersion: 3,
  updates: { checkOnStartup: true, channel: 'stable', lastCheckedAt: null, skippedVersion: null },
  appearance: {
    themeId: DEFAULT_THEME_ID,
    customTheme: normalizeCustomTheme()
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
    schemaVersion: 3,
    updates: {
      checkOnStartup: value.updates?.checkOnStartup !== false,
      channel: value.updates?.channel === 'prerelease' ? 'prerelease' : 'stable',
      lastCheckedAt: value.updates?.lastCheckedAt || null,
      skippedVersion: value.updates?.skippedVersion || null
    },
    appearance: {
      themeId,
      customTheme: normalizeCustomTheme(value.appearance?.customTheme)
    }
  }
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
}

module.exports = { AppStateStore, DEFAULT_STATE, DEFAULT_THEME_ID, VALID_THEME_IDS, normalizeState }
