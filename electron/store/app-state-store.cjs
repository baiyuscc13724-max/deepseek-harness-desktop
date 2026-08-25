const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { THEME_CATALOG } = require('../../renderer/theme-catalog.js')

const VALID_THEME_IDS = new Set(THEME_CATALOG.map(theme => theme.id))
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const DEFAULT_THEME_ID = 'porcelain-mist'
const VALID_UI_MODES = new Set(['official', 'aurora', 'spatial', 'tactile'])
const CURRENT_SCHEMA_VERSION = 9
const MAX_WALLPAPER_LIBRARY_ITEMS = 48
const WALLPAPER_ID = /^[a-z0-9][a-z0-9-]{0,79}$/
const WALLPAPER_FILE = /^(?:custom-background|wallpaper-[a-z0-9-]{1,80})\.(?:png|jpe?g|webp|gif|apng|mp4|webm)$/i

function hasOwn(value, key) {
  return !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
}

function boundedInteger(value, minimum, maximum, fallback) {
  if (value === null || value === '' || typeof value === 'boolean') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(number)))
}

// Bound Wallpaper Engine project directory for one-click import/sync. Only
// absolute local paths are accepted; the value is trimmed of trailing
// separators and capped in length to keep the state file small.
function normalizeWallpaperEngineProject(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/[\\/]+$/g, '')
  if (!trimmed || trimmed.length > 4096) return null
  const absolute = /^[a-zA-Z]:[\\/]/.test(trimmed) || /^\\\\/.test(trimmed) || /^\//.test(trimmed)
  return absolute ? trimmed : null
}

const WALLPAPER_ENGINE_SIGNATURE = /^[\d.:-]{1,200}$/

function normalizeCustomTheme(value = {}) {
  return {
    mode: value.mode === 'light' ? 'light' : 'dark',
    accent: HEX_COLOR.test(value.accent) ? value.accent.toLowerCase() : '#6f8cff',
    surface: HEX_COLOR.test(value.surface) ? value.surface.toLowerCase() : '#171b29',
    text: HEX_COLOR.test(value.text) ? value.text.toLowerCase() : '#f4f7ff',
    wallpaperBrightness: boundedInteger(value.wallpaperBrightness, 40, 140, 82),
    wallpaperBlur: boundedInteger(value.wallpaperBlur, 0, 24, 2),
    glassTransparency: boundedInteger(value.glassTransparency, 0, 100, 32),
    borderStrength: boundedInteger(value.borderStrength, 0, 100, 48),
    readabilityStrength: boundedInteger(value.readabilityStrength, 0, 100, 72),
    backgroundFile: WALLPAPER_FILE.test(value.backgroundFile || '')
      ? value.backgroundFile
      : null,
    wallpaperEngineProject: normalizeWallpaperEngineProject(value.wallpaperEngineProject),
    wallpaperEngineSignature: WALLPAPER_ENGINE_SIGNATURE.test(String(value.wallpaperEngineSignature || ''))
      ? String(value.wallpaperEngineSignature)
      : null
  }
}

const DEFAULT_STATE = Object.freeze({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  updates: {
    checkOnStartup: true,
    channel: 'stable',
    lastCheckedAt: null,
    skippedVersion: null,
    previewEnabled: false,
    lastPreviewSequence: 0,
    lastPreviewHeadSha: null
  },
  appearance: {
    themeId: DEFAULT_THEME_ID,
    customTheme: normalizeCustomTheme(),
    wallpaperLibrary: { activeId: null, items: [] },
    uiMode: 'official',
    reducedMotion: false,
    lowPerformance: false
  },
  pet: {
    enabled: true,
    awake: false,
    alwaysOnTop: true,
    autoFeed: true,
    proactive: true,
    companionStyle: 'warm',
    motion: 'system',
    muted: true,
    positionByDisplay: {}
  },
  memory: {
    enabled: true,
    sensitivityMode: 'reject',
    autoRecall: true,
    autoCapture: true
  }
})

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE))
}

function normalizeState(input) {
  const base = cloneDefaultState()
  const value = input && typeof input === 'object' ? input : {}
  const memory = value.memory && typeof value.memory === 'object' ? value.memory : null
  // New profiles use bounded automatic local memory. A saved boolean is an
  // explicit user preference, so migrations must never turn a stored `false`
  // back on. Missing fields inherit the new defaults independently, allowing
  // old partial state files to migrate without discarding saved sub-controls.
  const memoryEnabled = hasOwn(memory, 'enabled') ? memory.enabled === true : base.memory.enabled
  const memoryAutoRecall = hasOwn(memory, 'autoRecall') ? memory.autoRecall === true : base.memory.autoRecall
  const memoryAutoCapture = hasOwn(memory, 'autoCapture') ? memory.autoCapture === true : base.memory.autoCapture
  const savedTheme = VALID_THEME_IDS.has(value.appearance?.themeId) ? value.appearance.themeId : DEFAULT_THEME_ID
  const themeId = Number(value.schemaVersion || 0) < 3 && savedTheme === 'official' ? DEFAULT_THEME_ID : savedTheme
  const customTheme = normalizeCustomTheme(value.appearance?.customTheme)
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updates: {
      checkOnStartup: value.updates?.checkOnStartup !== false,
      channel: value.updates?.channel === 'prerelease' ? 'prerelease' : 'stable',
      lastCheckedAt: value.updates?.lastCheckedAt || null,
      skippedVersion: value.updates?.skippedVersion || null,
      previewEnabled: value.updates?.previewEnabled === true,
      lastPreviewSequence: Number.isSafeInteger(value.updates?.lastPreviewSequence) && value.updates.lastPreviewSequence >= 0
        ? value.updates.lastPreviewSequence
        : 0,
      lastPreviewHeadSha: /^[a-f0-9]{40}$/.test(String(value.updates?.lastPreviewHeadSha || ''))
        ? String(value.updates.lastPreviewHeadSha)
        : null
    },
    appearance: {
      themeId,
      customTheme,
      wallpaperLibrary: normalizeWallpaperLibrary(value.appearance?.wallpaperLibrary, customTheme),
      uiMode: VALID_UI_MODES.has(value.appearance?.uiMode) ? value.appearance.uiMode : 'official',
      reducedMotion: value.appearance?.reducedMotion === true,
      lowPerformance: value.appearance?.lowPerformance === true
    },
    pet: {
      enabled: value.pet?.enabled !== false,
      awake: value.pet?.awake === true,
      alwaysOnTop: value.pet?.alwaysOnTop !== false,
      autoFeed: value.pet?.autoFeed !== false,
      proactive: value.pet?.proactive !== false,
      companionStyle: ['calm', 'warm', 'playful'].includes(value.pet?.companionStyle) ? value.pet.companionStyle : 'warm',
      motion: ['system', 'full', 'reduced', 'still'].includes(value.pet?.motion) ? value.pet.motion : 'system',
      muted: value.pet?.muted !== false,
      positionByDisplay: normalizePetPositions(value.pet?.positionByDisplay)
    },
    memory: {
      enabled: memoryEnabled,
      sensitivityMode: memory?.sensitivityMode === 'redact' ? 'redact' : 'reject',
      autoRecall: memoryEnabled && memoryAutoRecall,
      autoCapture: memoryEnabled && memoryAutoCapture
    }
  }
}

function wallpaperFileKind(value) {
  if (!WALLPAPER_FILE.test(value || '')) return null
  return /\.(?:mp4|webm)$/i.test(value) ? 'video' : 'image'
}

function safeWallpaperTitle(value, fallback = '已导入的壁纸') {
  const title = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  return title || fallback
}

function normalizeWallpaperItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = String(value.id || '').toLowerCase()
  const cachedFile = String(value.cachedFile || '')
  const kind = wallpaperFileKind(cachedFile)
  if (!WALLPAPER_ID.test(id) || !kind || (value.kind && value.kind !== kind)) return null
  const source = value.source === 'wallpaper-engine' ? 'wallpaper-engine' : 'local'
  const projectDir = source === 'wallpaper-engine' ? normalizeWallpaperEngineProject(value.projectDir) : null
  return {
    id,
    title: safeWallpaperTitle(value.title),
    kind,
    source,
    cachedFile,
    projectDir,
    signature: projectDir && WALLPAPER_ENGINE_SIGNATURE.test(String(value.signature || '')) ? String(value.signature) : null,
    sourceStatus: projectDir && ['ready', 'unavailable'].includes(value.sourceStatus) ? value.sourceStatus : projectDir ? 'ready' : null,
    lastSyncedAt: projectDir && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(value.lastSyncedAt || '')) ? String(value.lastSyncedAt) : null,
    addedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(value.addedAt || '')) ? String(value.addedAt) : null
  }
}

function legacyWallpaperItem(customTheme) {
  const cachedFile = customTheme?.backgroundFile
  const kind = wallpaperFileKind(cachedFile)
  if (!kind) return null
  const projectDir = normalizeWallpaperEngineProject(customTheme.wallpaperEngineProject)
  return {
    id: 'legacy-background',
    title: projectDir ? safeWallpaperTitle(path.basename(projectDir), 'Wallpaper Engine 壁纸') : '已导入的壁纸',
    kind,
    source: projectDir ? 'wallpaper-engine' : 'local',
    cachedFile,
    projectDir,
    signature: projectDir && WALLPAPER_ENGINE_SIGNATURE.test(String(customTheme.wallpaperEngineSignature || ''))
      ? String(customTheme.wallpaperEngineSignature)
      : null,
    sourceStatus: projectDir ? 'ready' : null,
    lastSyncedAt: null,
    addedAt: null
  }
}

function normalizeWallpaperLibrary(value, customTheme = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const seenIds = new Set()
  const seenFiles = new Set()
  const items = []
  for (const candidate of Array.isArray(input.items) ? input.items.slice(0, MAX_WALLPAPER_LIBRARY_ITEMS * 2) : []) {
    const item = normalizeWallpaperItem(candidate)
    if (!item) continue
    const fileKey = item.cachedFile.toLowerCase()
    if (seenIds.has(item.id) || seenFiles.has(fileKey)) continue
    seenIds.add(item.id)
    seenFiles.add(fileKey)
    items.push(item)
    if (items.length >= MAX_WALLPAPER_LIBRARY_ITEMS) break
  }
  const legacy = legacyWallpaperItem(customTheme)
  if (legacy && !seenFiles.has(legacy.cachedFile.toLowerCase()) && items.length < MAX_WALLPAPER_LIBRARY_ITEMS) {
    if (seenIds.has(legacy.id)) legacy.id = 'legacy-background-import'
    items.push(legacy)
  }
  const requestedActiveId = WALLPAPER_ID.test(String(input.activeId || '').toLowerCase()) ? String(input.activeId).toLowerCase() : null
  const byActiveId = items.find(item => item.id === requestedActiveId)
  const byBackgroundFile = items.find(item => item.cachedFile.toLowerCase() === String(customTheme?.backgroundFile || '').toLowerCase())
  return { activeId: (byActiveId || byBackgroundFile)?.id || null, items }
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
    if (Object.prototype.hasOwnProperty.call(patch, 'previewEnabled')) this.state.updates.previewEnabled = patch.previewEnabled === true
    this.#persist()
    return this.get()
  }

  markPreviewCandidate(sequence, headSha) {
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('PR 预览更新序号无效。')
    const normalizedSha = String(headSha || '').trim().toLowerCase()
    if (!/^[a-f0-9]{40}$/.test(normalizedSha)) throw new Error('PR 预览更新 commit 无效。')
    const currentSequence = this.state.updates.lastPreviewSequence || 0
    const currentSha = this.state.updates.lastPreviewHeadSha
    if (sequence < currentSequence) throw new Error('拒绝回退到旧的 PR 预览更新序号。')
    if (sequence === currentSequence && currentSha && currentSha !== normalizedSha) {
      throw new Error('同一 PR 预览更新序号指向了不同 commit。')
    }
    if (sequence === currentSequence && currentSha === normalizedSha) return this.get()
    this.state.updates.lastPreviewSequence = sequence
    this.state.updates.lastPreviewHeadSha = normalizedSha
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
    if (hasOwn(patch, 'wallpaperLibrary')) {
      this.state.appearance.wallpaperLibrary = normalizeWallpaperLibrary(patch.wallpaperLibrary, this.state.appearance.customTheme)
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'uiMode')) {
      this.state.appearance.uiMode = VALID_UI_MODES.has(patch.uiMode) ? patch.uiMode : 'official'
    }
    for (const key of ['reducedMotion', 'lowPerformance']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) this.state.appearance[key] = patch[key] === true
    }
    this.#persist()
    return this.get()
  }

  updatePet(patch = {}) {
    for (const key of ['enabled', 'awake', 'alwaysOnTop', 'autoFeed', 'proactive', 'muted']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) this.state.pet[key] = Boolean(patch[key])
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'motion')) {
      this.state.pet.motion = ['system', 'full', 'reduced', 'still'].includes(patch.motion) ? patch.motion : 'system'
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'companionStyle')) {
      this.state.pet.companionStyle = ['calm', 'warm', 'playful'].includes(patch.companionStyle) ? patch.companionStyle : 'warm'
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
    if (Object.prototype.hasOwnProperty.call(patch, 'autoCapture')) this.state.memory.autoCapture = Boolean(patch.autoCapture)
    if (!this.state.memory.enabled) {
      this.state.memory.autoRecall = false
      this.state.memory.autoCapture = false
    }
    this.#persist()
    return this.get()
  }
}

module.exports = {
  AppStateStore,
  DEFAULT_STATE,
  DEFAULT_THEME_ID,
  MAX_WALLPAPER_LIBRARY_ITEMS,
  VALID_THEME_IDS,
  normalizeState,
  normalizePetPositions,
  normalizeWallpaperItem,
  normalizeWallpaperLibrary
}
