const api = window.desktopHarness
const startupSplash = document.querySelector('#startupSplash')
const startupPath = document.querySelector('#startupSplash .startup-mark path')
const runtimeView = document.querySelector('#runtimeView')
const runtimeStatus = document.querySelector('#runtimeStatus')
const runtimeStatusTitle = document.querySelector('#runtimeStatusTitle')
const runtimeStatusDetail = document.querySelector('#runtimeStatusDetail')
const retryRuntime = document.querySelector('#retryRuntime')
const terminalPanel = document.querySelector('#terminalPanel')
const terminalResizeHandle = document.querySelector('#terminalResizeHandle')
const terminalHost = document.querySelector('#terminalHost')
const terminalEmpty = document.querySelector('#terminalEmpty')
const terminalShellBadge = document.querySelector('#terminalShellBadge')
const terminalWorkspace = document.querySelector('#terminalWorkspace')
const terminalStatus = document.querySelector('#terminalStatus')
const terminalStartButton = document.querySelector('#terminalStart')
const terminalInterruptButton = document.querySelector('#terminalInterrupt')
const terminalStopButton = document.querySelector('#terminalStop')
const terminalClearButton = document.querySelector('#terminalClear')
const terminalCloseButton = document.querySelector('#terminalClose')
const petQuickButton = document.querySelector('#petQuickButton')
const petPanel = document.querySelector('#petPanel')
const closePetPanelButton = document.querySelector('#closePetPanel')
const petPanelStatus = document.querySelector('#petPanelStatus')
const petFullness = document.querySelector('#petFullness')
const petFullnessText = document.querySelector('#petFullnessText')
const petEnergy = document.querySelector('#petEnergy')
const petEnergyText = document.querySelector('#petEnergyText')
const petMood = document.querySelector('#petMood')
const petMoodText = document.querySelector('#petMoodText')
const petBondTitle = document.querySelector('#petBondTitle')
const petBondLevel = document.querySelector('#petBondLevel')
const petBondProgress = document.querySelector('#petBondProgress')
const petBondSummary = document.querySelector('#petBondSummary')
const petRefinedCount = document.querySelector('#petRefinedCount')
const petStandardCount = document.querySelector('#petStandardCount')
const petFragmentCount = document.querySelector('#petFragmentCount')
const petAwakeToggle = document.querySelector('#petAwakeToggle')
const petFeedButton = document.querySelector('#petFeedButton')
const petAutoFeed = document.querySelector('#petAutoFeed')
const petAlwaysOnTop = document.querySelector('#petAlwaysOnTop')
const petProactive = document.querySelector('#petProactive')
const petCompanionStyle = document.querySelector('#petCompanionStyle')
const skinQuickButton = document.querySelector('#skinQuickButton')
const skinPickerOverlay = document.querySelector('#skinPickerOverlay')
const skinPickerGrid = document.querySelector('#skinPickerGrid')
const skinThemeTab = document.querySelector('#skinThemeTab')
const skinWallpaperTab = document.querySelector('#skinWallpaperTab')
const skinModeTab = document.querySelector('#skinModeTab')
const skinThemePane = document.querySelector('#skinThemePane')
const skinWallpaperPane = document.querySelector('#skinWallpaperPane')
const skinModePane = document.querySelector('#skinModePane')
const skinModeGrid = document.querySelector('#skinModeGrid')
const skinModeCurrent = document.querySelector('#skinModeCurrent')
const skinReducedMotion = document.querySelector('#skinReducedMotion')
const skinLowPerformance = document.querySelector('#skinLowPerformance')
const closeSkinPickerButton = document.querySelector('#closeSkinPicker')
const restoreOfficialThemeButton = document.querySelector('#restoreOfficialTheme')
const skinChooseBackgroundButton = document.querySelector('#skinChooseBackground')
const skinChooseWallpaperEngineButton = document.querySelector('#skinChooseWallpaperEngine')
const skinBrowseWallpaperEngineButton = document.querySelector('#skinBrowseWallpaperEngine')
const skinClearBackgroundButton = document.querySelector('#skinClearBackground')
const skinApplyCustomButton = document.querySelector('#skinApplyCustom')
const skinBackgroundState = document.querySelector('#skinBackgroundState')
const skinWallpaperEngineSync = document.querySelector('#skinWallpaperEngineSync')
const skinWallpaperEnginePicker = document.querySelector('#skinWallpaperEnginePicker')
const skinWallpaperEngineStatus = document.querySelector('#skinWallpaperEngineStatus')
const skinWallpaperEngineItems = document.querySelector('#skinWallpaperEngineItems')
const skinWallpaperEngineSearch = document.querySelector('#skinWallpaperEngineSearch')
const skinWallpaperEngineSearchClear = document.querySelector('#skinWallpaperEngineSearchClear')
const skinWallpaperEngineEmpty = document.querySelector('#skinWallpaperEngineEmpty')
const skinWallpaperEngineRescan = document.querySelector('#skinWallpaperEngineRescan')
const skinWallpaperEngineManual = document.querySelector('#skinWallpaperEngineManual')
const skinWallpaperEngineClose = document.querySelector('#skinWallpaperEngineClose')
const skinWallpaperLibraryItems = document.querySelector('#skinWallpaperLibraryItems')
const skinWallpaperLibraryEmpty = document.querySelector('#skinWallpaperLibraryEmpty')
const skinWallpaperLibraryMessage = document.querySelector('#skinWallpaperLibraryMessage')
const skinApplyWallpaperAppearance = document.querySelector('#skinApplyWallpaperAppearance')
const skinResetWallpaperAppearance = document.querySelector('#skinResetWallpaperAppearance')
const modelRoutingOverlay = document.querySelector('#modelRoutingOverlay')
const closeModelRoutingButton = document.querySelector('#closeModelRouting')
const modelRoutingMainProvider = document.querySelector('#modelRoutingMainProvider')
const modelRoutingMainModel = document.querySelector('#modelRoutingMainModel')
const modelRoutingSubInherit = document.querySelector('#modelRoutingSubInherit')
const modelRoutingSubIndependent = document.querySelector('#modelRoutingSubIndependent')
const modelRoutingSubSummary = document.querySelector('#modelRoutingSubSummary')
const modelRoutingSubProvider = document.querySelector('#modelRoutingSubProvider')
const modelRoutingSubModel = document.querySelector('#modelRoutingSubModel')
const modelRoutingRefreshMeters = document.querySelector('#modelRoutingRefreshMeters')
const modelRoutingMeters = document.querySelector('#modelRoutingMeters')
const modelRoutingStatus = document.querySelector('#modelRoutingStatus')
const modelRoutingSave = document.querySelector('#modelRoutingSave')
const mobileSyncOverlay = document.querySelector('#mobileSyncOverlay')
const closeMobileSyncButton = document.querySelector('#closeMobileSync')
const mobileSyncToggle = document.querySelector('#mobileSyncToggle')
const mobileSyncHeadline = document.querySelector('#mobileSyncHeadline')
const mobileSyncDetail = document.querySelector('#mobileSyncDetail')
const mobileSyncEnabledContent = document.querySelector('#mobileSyncEnabledContent')
const mobileSyncPairCard = document.querySelector('#mobileSyncPairCard')
const mobileRemoteToggle = document.querySelector('#mobileRemoteToggle')
const mobileRemoteStatus = document.querySelector('#mobileRemoteStatus')
const mobileTransportPreference = document.querySelector('#mobileTransportPreference')
const mobileRelayUrlInput = document.querySelector('#mobileRelayUrl')
const mobileRelaySave = document.querySelector('#mobileRelaySave')
const mobileRelayClear = document.querySelector('#mobileRelayClear')
const mobileRelayStatus = document.querySelector('#mobileRelayStatus')
const mobileRelayMessage = document.querySelector('#mobileRelayMessage')
const mobileSyncQr = document.querySelector('#mobileSyncQr')
const mobileSyncQrPlaceholder = document.querySelector('#mobileSyncQrPlaceholder')
const mobileSyncUrl = document.querySelector('#mobileSyncUrl')
const copyMobileSyncUrl = document.querySelector('#copyMobileSyncUrl')
const refreshMobilePairing = document.querySelector('#refreshMobilePairing')
const mobileSyncPairExpiry = document.querySelector('#mobileSyncPairExpiry')
const mobileSyncDeviceCount = document.querySelector('#mobileSyncDeviceCount')
const mobileSyncDeviceList = document.querySelector('#mobileSyncDeviceList')
const mobileControlSummary = document.querySelector('#mobileControlSummary')
const mobileControlDeviceList = document.querySelector('#mobileControlDeviceList')
const stopMobileControl = document.querySelector('#stopMobileControl')
const mobileSyncError = document.querySelector('#mobileSyncError')
const updateReadyOverlay = document.querySelector('#updateReadyOverlay')
const updateReadyTitle = document.querySelector('#updateReadyTitle')
const updateReadyNote = document.querySelector('.update-ready-note')
const updateReadyDetail = document.querySelector('#updateReadyDetail')
const updateLaterButton = document.querySelector('#updateLaterButton')
const updateNowButton = document.querySelector('#updateNowButton')
const updateLaunchError = document.querySelector('#updateLaunchError')
const updateNoticeOverlay = document.querySelector('#updateNoticeOverlay')
const updateNoticeTitle = document.querySelector('#updateNoticeTitle')
const updateNoticeSummary = document.querySelector('#updateNoticeSummary')
const updateNoticeNotes = document.querySelector('#updateNoticeNotes')
const updateNoticeLater = document.querySelector('#updateNoticeLater')
const updateNoticeRelease = document.querySelector('#updateNoticeRelease')
const updateNoticeInstall = document.querySelector('#updateNoticeInstall')

let pendingUpdateKind = 'installer'
let pendingComponentUpdate = null
let prPreviewState = { enabled: true, configured: false, checking: false, changing: false, available: false, candidate: null, error: '' }
let gitRuntimeState = {
  loading: true, authenticating: false, preparing: false, message: '',
  git: { available: false, source: null, version: null },
  gcm: { available: false, source: null, version: null },
  sshAgent: { available: false, running: false }
}
let updateState = {
  displayVersion: '当前版本',
  pendingCount: 0,
  items: [],
  checking: false,
  installing: false,
  installProgress: null,
  installError: '',
  app: null,
  harness: null,
  preferences: { checkOnStartup: true, channel: 'stable', previewEnabled: true, lastCheckedAt: null }
}
let terminalPreferences = { shellId: null, workspace: '' }
let terminalCapabilities = { pty: false, backend: 'loading', defaultShellId: null, shells: [] }
let terminalSession = null
let terminalEmulator = null
let terminalFitAddon = null
let terminalStarting = false
let terminalResizeFrame = 0
let terminalWriteErrorShown = false
const terminalEventBacklog = []
let distributionState = {
  channel: 'direct', store: false, appUpdatesManagedByStore: false,
  nonCommercialContentAvailable: true, desktopPetAvailable: true, links: {}
}
let appearanceState = { themeId: 'porcelain-mist', customTheme: {}, wallpaperLibrary: { activeId: null, items: [] }, customBackgroundDataUrl: null, uiMode: 'official', reducedMotion: false, lowPerformance: false }
let petState = {
  status: 'idle', fullness: 80, energy: 78, mood: 72, inventory: { refined: 0, standard: 0, fragments: 0 },
  relationship: { level: 1, title: '初见', progress: 0, taskStreak: 0 },
  companion: { daily: { completed: 0, tasks: 0 } },
  preferences: { enabled: true, awake: false, alwaysOnTop: true, autoFeed: true, proactive: true, companionStyle: 'warm' }
}
let modelRoutingState = { main: {}, subagent: { inheritMain: true }, providers: [], meters: { snapshots: [], loading: false, error: '' }, saving: false, saved: false, error: '' }
let mobileSyncState = {
  enabled: false,
  running: false,
  targetReady: false,
  origins: [],
  devices: [],
  pairing: null,
  control: { protocolVersion: 1, devices: [] },
  remote: { enabled: true, preference: 'auto', status: 'disabled', active: null, adapters: {} }
}
let computerUsePluginState = { loading: true, notice: '', error: '', session: null }
let computerUsePluginMutationPending = false
let relayTesting = false
let themeCatalog = []
let selectedWallpaperId = null
let wallpaperEngineLibrary = null
let wallpaperEngineReason = ''
let startupRuntimeReady = false
let startupWebviewReady = false
let startupFailed = false
let startupProgress = 0
let startupStartedAt = 0
let startupRuntimeReadyAt = 0
let startupLastFrameAt = 0
let startupFinishStartedAt = 0
let startupFinishStartProgress = 0
let startupReducedMotion = false
let updateNoticeShownVersion = null
const themeIntegration = window.harnessThemeIntegration
const modelRoutingIntegration = window.harnessModelRoutingIntegration
const workspaceLinksIntegration = window.HarnessDesktopWorkspaceLinks
const skinPickerHost = themeIntegration.createSkinPickerHost({
  overlay: skinPickerOverlay,
  trigger: skinQuickButton,
  closeSettingsDialog: () => themeIntegration.closeDesktopSettingsDialog(runtimeView)
})

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character])

const uiModeCatalog = Object.freeze([
  { id: 'official', name: '官方经典', description: '保持官方材质与层级，作为随时可恢复的稳定基线。' },
  { id: 'aurora', name: '极光玻璃', description: '低透明玻璃、柔和渐变光影与清晰细边框。' },
  { id: 'spatial', name: '空间专注', description: '突出当前会话，辅助区域仅做轻度视觉降噪。' },
  { id: 'tactile', name: '触感实体', description: '在主要按钮和输入区增加克制的高光与按压反馈。' }
])

const customThemeDefaults = Object.freeze({
  mode: 'dark', accent: '#6f8cff', surface: '#171b29', text: '#f4f7ff',
  wallpaperBrightness: 82, wallpaperBlur: 2, glassTransparency: 32, borderStrength: 48, readabilityStrength: 72
})

const customThemeRangeFields = Object.freeze({
  wallpaperBrightness: { input: '#skinWallpaperBrightness', output: '#skinBrightnessValue', suffix: '%' },
  wallpaperBlur: { input: '#skinWallpaperBlur', output: '#skinBlurValue', suffix: 'px' },
  glassTransparency: { input: '#skinGlassTransparency', output: '#skinGlassValue', suffix: '%' },
  borderStrength: { input: '#skinBorderStrength', output: '#skinBorderValue', suffix: '%' },
  readabilityStrength: { input: '#skinReadabilityStrength', output: '#skinReadabilityValue', suffix: '%' }
})

function shellColorWithOpacity(hex, opacity) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return hex
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255).toString(16).padStart(2, '0')
  return `${hex}${alpha}`
}

function shellReadableTextShadow(text, strength) {
  const match = /^#([0-9a-f]{6})$/i.exec(text || '')
  const rgb = match ? [0, 2, 4].map(offset => Number.parseInt(match[1].slice(offset, offset + 2), 16)) : [255, 255, 255]
  const shadow = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 >= 150 ? '0,0,0' : '255,255,255'
  const amount = Math.min(1, Math.max(0, Number(strength) / 100))
  if (amount === 0) return 'none'
  return `0 1px 2px rgba(${shadow},${(amount * .76).toFixed(2)}),0 0 12px rgba(${shadow},${(amount * .30).toFixed(2)})`
}

function readShellCustomTheme() {
  const values = {
    mode: document.querySelector('#skinCustomMode').value,
    accent: document.querySelector('#skinCustomAccent').value,
    surface: document.querySelector('#skinCustomSurface').value,
    text: document.querySelector('#skinCustomText').value
  }
  for (const [name, field] of Object.entries(customThemeRangeFields)) values[name] = Number(document.querySelector(field.input).value)
  return values
}

function startupIsResolved() {
  return startupFailed || (startupRuntimeReady && startupWebviewReady)
}

function renderStartupProgress(value) {
  startupProgress = Math.max(startupProgress, Math.min(1, value))
  if (startupPath) startupPath.style.strokeDashoffset = String(1 - startupProgress)
  if (startupProgress >= 0.62) startupSplash?.classList.add('show-wordmark')
}

function completeStartup() {
  renderStartupProgress(1)
  startupSplash.classList.add('is-complete')
  startupSplash.setAttribute('aria-hidden', 'true')
}

function drawStartupFrame(now) {
  if (!startupSplash || startupSplash.classList.contains('is-complete')) return
  if (!startupStartedAt) startupStartedAt = now
  const elapsed = now - startupStartedAt
  const frameDelta = startupLastFrameAt ? Math.min(80, now - startupLastFrameAt) : 16
  startupLastFrameAt = now

  if (startupReducedMotion) {
    renderStartupProgress(1)
    if (startupIsResolved()) completeStartup()
    else requestAnimationFrame(drawStartupFrame)
    return
  }

  if (startupIsResolved()) {
    if (!startupFinishStartedAt) {
      startupFinishStartedAt = now
      startupFinishStartProgress = startupProgress
    }
    const remaining = 1 - startupFinishStartProgress
    const duration = Math.min(720, Math.max(280, 280 + remaining * 440))
    const ratio = Math.min(1, (now - startupFinishStartedAt) / duration)
    const eased = 1 - Math.pow(1 - ratio, 3)
    renderStartupProgress(startupFinishStartProgress + remaining * eased)
    if (ratio >= 1) completeStartup()
    else requestAnimationFrame(drawStartupFrame)
    return
  }

  let target = 0.62 * (1 - Math.exp(-elapsed / 1600))
  if (startupRuntimeReady) {
    const phaseElapsed = Math.max(0, now - startupRuntimeReadyAt)
    target = Math.max(target, 0.68 + 0.22 * (1 - Math.exp(-phaseElapsed / 700)))
  }
  const follow = 1 - Math.exp(-frameDelta / 180)
  renderStartupProgress(startupProgress + Math.max(0, target - startupProgress) * follow)
  requestAnimationFrame(drawStartupFrame)
}

function playStartupAnimation() {
  if (!startupSplash) return
  startupReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  startupSplash.classList.add('is-running')
  renderStartupProgress(0)
  requestAnimationFrame(drawStartupFrame)
}

function themePreview(theme) {
  if (theme.id === 'maid-atelier' && theme.assets?.day) return `linear-gradient(rgba(5,31,59,.08),rgba(5,31,59,.28)),url("${theme.assets.day}") center/cover`
  if (theme.id === 'custom' && appearanceState.customBackgroundDataUrl) {
    const custom = { ...customThemeDefaults, ...(appearanceState.customTheme || {}) }
    const readability = custom.readabilityStrength / 100
    const overlay = shellColorWithOpacity(custom.surface, readability * (custom.mode === 'dark' ? .40 : .33))
    const image = `url("${appearanceState.customBackgroundDataUrl}")`
    return `linear-gradient(${overlay},${overlay}),${image} center/contain no-repeat,${image} center/cover no-repeat`
  }
  return theme.preview
}

function applyShellUiMode() {
  const root = document.documentElement
  const mode = uiModeCatalog.some(entry => entry.id === appearanceState.uiMode) ? appearanceState.uiMode : 'official'
  root.dataset.shellUiMode = mode
  root.dataset.shellReducedMotion = String(appearanceState.reducedMotion === true)
  root.dataset.shellLowPerformance = String(appearanceState.lowPerformance === true)
}

function applyShellTheme() {
  const theme = themeCatalog.find(entry => entry.id === appearanceState.themeId)
  const root = document.documentElement
  if (!theme || theme.id === 'official') {
    root.removeAttribute('data-shell-theme')
    root.style.removeProperty('color-scheme')
    root.style.removeProperty('--shell-workbench-background')
    for (const name of ['--shell-surface', '--shell-layer', '--shell-layer-2', '--shell-text', '--shell-text-secondary', '--shell-text-tertiary', '--shell-border', '--shell-hover', '--shell-accent', '--shell-overlay', '--shell-text-shadow']) root.style.removeProperty(name)
    return
  }
  const custom = { ...customThemeDefaults, ...(appearanceState.customTheme || {}) }
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches
  const mode = theme.id === 'custom' ? custom.mode : theme.mode === 'adaptive' ? (prefersDark ? 'dark' : 'light') : theme.mode
  const glassOpacity = 1 - custom.glassTransparency / 100
  const vars = theme.id === 'custom'
    ? {
        '--dsw-alias-bg-base': shellColorWithOpacity(custom.surface, glassOpacity),
        '--dsw-alias-bg-layer-1': shellColorWithOpacity(custom.surface, Math.min(1, glassOpacity * 1.08)),
        '--dsw-alias-bg-layer-2': shellColorWithOpacity(custom.surface, Math.min(1, glassOpacity * 1.16)),
        '--dsw-alias-label-primary': custom.text,
        '--dsw-alias-label-secondary': custom.text,
        '--dsw-alias-border-l2': shellColorWithOpacity(custom.text, custom.borderStrength / 100 * .34),
        '--dsw-alias-brand-primary': custom.accent
      }
    : { ...theme.vars, ...(theme.mode === 'adaptive' && mode === 'dark' ? theme.darkVars : {}) }
  root.dataset.shellTheme = theme.id
  root.style.colorScheme = mode === 'light' ? 'light' : 'dark'
  root.style.setProperty('--shell-workbench-background', themePreview(theme))
  root.style.setProperty('--shell-surface', vars['--dsw-alias-bg-base'] || vars['--dsw-alias-bg-layer-1'] || '#181a1f')
  root.style.setProperty('--shell-layer', vars['--dsw-alias-bg-layer-1'] || vars['--dsw-alias-bg-base'] || '#202228')
  root.style.setProperty('--shell-layer-2', vars['--dsw-alias-bg-layer-2'] || vars['--dsw-alias-bg-layer-1'] || '#2a2d34')
  root.style.setProperty('--shell-text', vars['--dsw-alias-label-primary'] || '#eef0f4')
  root.style.setProperty('--shell-text-secondary', vars['--dsw-alias-label-secondary'] || vars['--dsw-alias-label-primary'] || '#a5a9b2')
  root.style.setProperty('--shell-text-tertiary', vars['--dsw-alias-label-tertiary'] || vars['--dsw-alias-label-secondary'] || '#8c929d')
  root.style.setProperty('--shell-border', vars['--dsw-alias-border-l2'] || 'rgba(210,215,225,.18)')
  root.style.setProperty('--shell-hover', vars['--dsw-alias-interactive-bg-hover'] || 'rgba(255,255,255,.08)')
  root.style.setProperty('--shell-accent', vars['--dsw-alias-brand-primary'] || '#8ba5ff')
  root.style.setProperty('--shell-overlay', mode === 'light' ? 'rgba(15,23,42,.32)' : 'rgba(2,6,16,.58)')
  root.style.setProperty('--shell-text-shadow', theme.id === 'custom' ? shellReadableTextShadow(custom.text, custom.readabilityStrength) : 'none')
}

function showSkinPickerPane(name) {
  const showWallpapers = name === 'wallpapers'
  const showModes = name === 'modes'
  if (!showWallpapers) disposeWallpaperCardPreviews()
  skinThemeTab.setAttribute('aria-selected', String(!showWallpapers && !showModes))
  skinWallpaperTab.setAttribute('aria-selected', String(showWallpapers))
  skinModeTab.setAttribute('aria-selected', String(showModes))
  skinThemePane.classList.toggle('hidden', showWallpapers || showModes)
  skinWallpaperPane.classList.toggle('hidden', !showWallpapers)
  skinModePane.classList.toggle('hidden', !showModes)
}

function wallpaperLibraryMessage(message = '', error = false) {
  skinWallpaperLibraryMessage.textContent = message
  skinWallpaperLibraryMessage.dataset.error = String(error)
}

async function applySavedWallpaper(id) {
  wallpaperLibraryMessage('正在从本地副本应用壁纸…')
  disposeWallpaperCardPreviews()
  try {
    await skinPickerHost.apply(async () => {
      appearanceState = await api.applyWallpaper(id)
      await publishAppearanceState()
      renderSkinPicker()
    })
  } catch (error) {
    wallpaperLibraryMessage(`应用失败：${error.message}`, true)
  }
}

async function deleteSavedWallpaper(id) {
  const item = appearanceState.wallpaperLibrary?.items?.find(entry => entry.id === id)
  if (!item) return
  if (!window.confirm(`从壁纸库移除“${item.title}”？只会删除 Harness 管理的本地副本，不会修改原始文件。`)) return
  wallpaperLibraryMessage('正在移除壁纸记录…')
  try {
    appearanceState = await api.deleteWallpaper(id)
    if (selectedWallpaperId === id) selectedWallpaperId = null
    await publishAppearanceState()
    renderSkinPicker()
    wallpaperLibraryMessage('已移除壁纸记录。')
  } catch (error) {
    wallpaperLibraryMessage(`移除失败：${error.message}`, true)
  }
}

function selectWallpaperCard(id) {
  selectedWallpaperId = id
  skinWallpaperLibraryItems.querySelectorAll('[data-wallpaper-id]').forEach(card => {
    card.dataset.selected = String(card.dataset.wallpaperId === id)
  })
}

function pauseWallpaperCardPreview(card) {
  const video = card?.querySelector('video[data-wallpaper-preview]')
  if (!video) return
  video.pause()
  try { video.currentTime = 0 } catch {}
}

function disposeWallpaperCardPreview(video) {
  if (!video) return
  video.pause()
  video.removeAttribute('src')
  video.load()
}

function disposeWallpaperCardPreviews(except = null) {
  skinWallpaperLibraryItems.querySelectorAll('video[data-wallpaper-preview]').forEach(video => {
    if (video !== except) disposeWallpaperCardPreview(video)
  })
}

function playWallpaperCardPreview(card) {
  if (document.documentElement.dataset.shellLowPerformance === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const video = card?.querySelector('video[data-wallpaper-preview]')
  if (!video) return
  disposeWallpaperCardPreviews(video)
  if (!video.getAttribute('src')) {
    const source = video.dataset.previewSrc || ''
    if (!source) return
    video.src = source
    video.load()
  }
  video.play().catch(() => {})
}

function renderWallpaperLibrary() {
  const library = appearanceState.wallpaperLibrary || { activeId: null, items: [] }
  const items = Array.isArray(library.items) ? library.items : []
  if (!items.some(item => item.id === selectedWallpaperId)) selectedWallpaperId = library.activeId || items[0]?.id || null
  skinWallpaperLibraryEmpty.classList.toggle('hidden', items.length > 0)
  skinWallpaperLibraryItems.classList.toggle('hidden', items.length === 0)
  disposeWallpaperCardPreviews()
  skinWallpaperLibraryItems.innerHTML = items.map(item => {
    const current = appearanceState.themeId === 'custom' && library.activeId === item.id
    const sourceUnavailable = item.source === 'wallpaper-engine' && item.sourceStatus === 'unavailable'
    const preview = item.available && item.previewUrl
      ? item.kind === 'video'
        ? `<video data-wallpaper-preview data-preview-src="${escapeHtml(item.previewUrl)}" preload="none" muted loop playsinline aria-hidden="true"></video><span class="skin-wallpaper-preview-kind" aria-hidden="true">悬停预览视频</span>`
        : `<img data-wallpaper-preview src="${escapeHtml(item.previewUrl)}" alt="" loading="lazy" decoding="async" />`
      : `<span class="skin-wallpaper-preview-placeholder">${item.available ? (item.kind === 'video' ? '视频预览载入中' : '预览载入中') : '本地副本已失效'}</span>`
    const badge = !item.available
      ? '<span class="skin-wallpaper-badge" data-warning="true">副本失效</span>'
      : current
        ? '<span class="skin-wallpaper-badge" data-active="true">正在使用</span>'
        : sourceUnavailable
          ? '<span class="skin-wallpaper-badge" data-warning="true">源不可同步</span>'
          : '<span class="skin-wallpaper-badge">已保存</span>'
    const sourceText = item.source === 'wallpaper-engine'
      ? sourceUnavailable ? 'Wallpaper Engine · 本地副本仍可使用' : 'Wallpaper Engine · 已复制到本机'
      : '本地导入 · 已复制到本机'
    return `
      <article class="skin-wallpaper-library-card" role="listitem" tabindex="0" data-wallpaper-id="${escapeHtml(item.id)}" data-selected="${item.id === selectedWallpaperId}" data-unavailable="${!item.available}" aria-label="${escapeHtml(item.title)}，${item.kind === 'video' ? '视频' : '图片'}">
        <span class="skin-wallpaper-library-preview" data-kind="${escapeHtml(item.kind)}" data-unavailable="${!item.available}">${preview}</span>
        <div class="skin-wallpaper-library-body">
          <div class="skin-wallpaper-library-title"><strong>${escapeHtml(item.title)}</strong>${badge}</div>
          <div class="skin-wallpaper-library-meta">${item.kind === 'video' ? '视频' : '图片'} · ${sourceText}</div>
          <div class="skin-wallpaper-library-card-actions">
            <button type="button" data-action="apply" ${item.available ? '' : 'disabled'}>${current ? '正在使用' : '使用此壁纸'}</button>
            <button type="button" data-action="delete">${item.available ? '移除' : '移除失效记录'}</button>
          </div>
        </div>
      </article>`
  }).join('')
  skinWallpaperLibraryItems.querySelectorAll('[data-wallpaper-id]').forEach(card => {
    card.addEventListener('click', event => {
      if (!event.target.closest('button')) selectWallpaperCard(card.dataset.wallpaperId)
    })
    card.addEventListener('dblclick', event => {
      if (!event.target.closest('button') && card.dataset.unavailable !== 'true') applySavedWallpaper(card.dataset.wallpaperId)
    })
    card.addEventListener('keydown', event => {
      if (event.target.closest('button') || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      selectWallpaperCard(card.dataset.wallpaperId)
    })
    card.addEventListener('pointerenter', () => playWallpaperCardPreview(card))
    card.addEventListener('pointerleave', () => pauseWallpaperCardPreview(card))
    card.addEventListener('focusin', () => playWallpaperCardPreview(card))
    card.addEventListener('focusout', event => {
      if (!card.contains(event.relatedTarget)) pauseWallpaperCardPreview(card)
    })
    card.querySelector('[data-action="apply"]').addEventListener('click', () => applySavedWallpaper(card.dataset.wallpaperId))
    card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteSavedWallpaper(card.dataset.wallpaperId))
  })
}

function renderUiModePicker() {
  const selectedMode = uiModeCatalog.find(entry => entry.id === appearanceState.uiMode) || uiModeCatalog[0]
  skinModeCurrent.textContent = selectedMode.name
  skinReducedMotion.checked = appearanceState.reducedMotion === true
  skinLowPerformance.checked = appearanceState.lowPerformance === true
  skinModeGrid.innerHTML = uiModeCatalog.map(mode => `
    <button type="button" class="skin-mode-card" data-ui-mode="${mode.id}" data-selected="${mode.id === selectedMode.id}">
      <span class="skin-mode-preview" data-preview="${mode.id}" aria-hidden="true"></span>
      <span class="skin-mode-body"><strong>${mode.name}</strong><span>${mode.description}</span></span>
    </button>`).join('')
  skinModeGrid.querySelectorAll('[data-ui-mode]').forEach(button => button.addEventListener('click', async () => {
    appearanceState = await api.setUiPreferences({ uiMode: button.dataset.uiMode || 'official' })
    await publishAppearanceState()
    renderUiModePicker()
  }))
}

function renderSkinPicker() {
  skinPickerGrid.innerHTML = themeCatalog.map(theme => `
    <article class="skin-picker-card" data-skin-id="${escapeHtml(theme.id)}" data-selected="${theme.id === appearanceState.themeId}" tabindex="0">
      <div class="skin-picker-preview" style="background:${escapeHtml(themePreview(theme))}"></div>
      <div class="skin-picker-body">
        <div class="skin-picker-title"><strong>${escapeHtml(theme.name)}</strong><span class="skin-picker-license" data-nc="${Boolean(theme.nonCommercial)}">${escapeHtml(theme.license)}</span></div>
        <div class="skin-picker-description">${escapeHtml(theme.description)}</div>
        <div class="skin-picker-meta"><span class="skin-picker-author">${escapeHtml(theme.author)}</span><span>${theme.id === appearanceState.themeId ? '当前使用' : '双击使用'}</span>${theme.source ? `<button type="button" class="skin-picker-source" data-source="${escapeHtml(theme.source)}">来源</button>` : ''}</div>
      </div>
    </article>`).join('')
  skinPickerGrid.querySelectorAll('[data-skin-id]').forEach(card => {
    const apply = async () => {
      await skinPickerHost.apply(async () => {
        appearanceState = await api.setTheme(card.dataset.skinId || 'official')
        await publishAppearanceState()
      })
    }
    card.addEventListener('dblclick', event => {
      if (!event.target.closest('[data-source]')) apply().catch(() => {})
    })
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      apply().catch(() => {})
    })
  })
  skinPickerGrid.querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation()
    api.openLink(event.currentTarget.dataset.source || '').catch(() => {})
  }))
  const custom = { ...customThemeDefaults, ...(appearanceState.customTheme || {}) }
  document.querySelector('#skinCustomMode').value = custom.mode
  document.querySelector('#skinCustomAccent').value = custom.accent
  document.querySelector('#skinCustomSurface').value = custom.surface
  document.querySelector('#skinCustomText').value = custom.text
  for (const [name, field] of Object.entries(customThemeRangeFields)) {
    const input = document.querySelector(field.input)
    const output = document.querySelector(field.output)
    input.value = String(custom[name])
    output.textContent = `${custom[name]}${field.suffix}`
  }
  skinClearBackgroundButton.disabled = !appearanceState.customBackgroundDataUrl && !appearanceState.customBackgroundVideoDataUrl
  const backgroundFile = appearanceState.customTheme?.backgroundFile || ''
  const animated = /\.(?:gif|apng)$/i.test(backgroundFile)
  const wallpaperEngineBound = Boolean(appearanceState.customTheme?.wallpaperEngineProject)
  skinWallpaperEngineSync.disabled = !wallpaperEngineBound
  skinChooseWallpaperEngineButton.disabled = false
  skinWallpaperEngineSync.title = wallpaperEngineBound ? '仅在你主动点击时读取项目源并更新受控本地副本' : '当前壁纸不是 Wallpaper Engine 项目'
  const wallpaperPrefix = wallpaperEngineBound ? 'Wallpaper Engine 本地副本；' : ''
  skinBackgroundState.textContent = appearanceState.customBackgroundVideoDataUrl
    ? `${wallpaperPrefix}${appearanceState.themeId === 'custom' ? '视频壁纸正在使用' : '视频壁纸已保存'}`
    : appearanceState.customBackgroundDataUrl
      ? animated ? `${wallpaperPrefix}${appearanceState.themeId === 'custom' ? '动态壁纸正在使用' : '动态壁纸已保存'}` : `${wallpaperPrefix}${appearanceState.themeId === 'custom' ? '图片壁纸正在使用' : '图片壁纸已保存'}`
      : '当前未使用壁纸'
  renderWallpaperLibrary()
  renderUiModePicker()
}

const petStatusLabels = {
  idle: '正在休息',
  working: '正在陪你工作',
  'needs-input': '有任务等待你的决定',
  blocked: '任务遇到问题',
  ready: '任务已完成',
  celebrating: '正在庆祝任务完成',
  sleeping: '正在休息恢复'
}

const petMoodLabels = { happy: '愉快', content: '平稳', sad: '低落' }

function renderPetState(next = petState) {
  petState = next
  const inventory = next.inventory || {}
  const preferences = next.preferences || {}
  petQuickButton.dataset.status = next.status || 'idle'
  petPanelStatus.textContent = petStatusLabels[next.status] || petStatusLabels.idle
  petFullness.value = Math.max(0, Math.min(100, Number(next.fullness) || 0))
  petFullnessText.textContent = `${Math.round(petFullness.value)}%`
  petEnergy.value = Math.max(0, Math.min(100, Number(next.energy) || 0))
  petEnergyText.textContent = `${Math.round(petEnergy.value)}%`
  petMood.value = Math.max(0, Math.min(100, Number(next.mood) || 0))
  petMoodText.textContent = petMoodLabels[next.moodBand] || `${Math.round(petMood.value)}%`
  const relationship = next.relationship || {}
  const daily = next.companion?.daily || {}
  petBondTitle.textContent = relationship.title || '初见'
  petBondLevel.textContent = `Lv.${Math.max(1, Number(relationship.level) || 1)}`
  petBondProgress.value = Math.max(0, Math.min(100, Number(relationship.progress) || 0))
  const completed = Math.max(0, Number(daily.completed) || 0)
  const total = Math.max(completed, Number(daily.tasks) || 0)
  const streak = Math.max(0, Number(relationship.taskStreak) || 0)
  petBondSummary.textContent = total > 0
    ? `今日完成 ${completed}/${total}${streak > 1 ? ` · 连续 ${streak}` : ''}`
    : '今天还没有共同任务'
  petRefinedCount.textContent = inventory.refined || 0
  petStandardCount.textContent = inventory.standard || 0
  petFragmentCount.textContent = inventory.fragments || 0
  petAwakeToggle.classList.toggle('primary', !preferences.awake)
  petAutoFeed.checked = preferences.autoFeed !== false
  petAlwaysOnTop.checked = preferences.alwaysOnTop !== false
  petProactive.checked = preferences.proactive !== false
  petCompanionStyle.value = ['calm', 'warm', 'playful'].includes(preferences.companionStyle) ? preferences.companionStyle : 'warm'
  petFeedButton.disabled = Number(next.fullness) >= 100 || ![inventory.fragments, inventory.standard, inventory.refined].some(value => Number(value) > 0)
  petAwakeToggle.textContent = preferences.awake ? '收起女仆鲸' : '唤醒女仆鲸'
}

function openPetPanel() {
  closeSkinPicker()
  renderPetState()
  petPanel.classList.remove('hidden')
  petPanel.setAttribute('aria-hidden', 'false')
  petQuickButton.setAttribute('aria-expanded', 'true')
  closePetPanelButton.focus()
}

function closePetPanel() {
  petPanel.classList.add('hidden')
  petPanel.setAttribute('aria-hidden', 'true')
  petQuickButton.setAttribute('aria-expanded', 'false')
}

function openSkinPicker({ fromSettings = false } = {}) {
  closePetPanel()
  applyShellTheme()
  applyShellUiMode()
  showSkinPickerPane('themes')
  wallpaperLibraryMessage('')
  renderSkinPicker()
  skinPickerHost.open({ fromSettings })
  closeSkinPickerButton.focus()
}

function closeSkinPicker() {
  disposeWallpaperCardPreviews()
  disposeWallpaperEnginePreviews()
  skinPickerHost.close()
}

function disposeWallpaperEnginePreviews(except = null) {
  skinWallpaperEngineItems.querySelectorAll('video[data-wallpaper-engine-preview]').forEach(video => {
    if (video === except) return
    video.pause()
    video.removeAttribute('src')
    video.load()
  })
}

function wallpaperEngineProjectPreviewUrl(project) {
  const previewUrl = String(project.previewUrl || '').trim()
  return previewUrl.startsWith('harness-wallpaper:') ? previewUrl : ''
}

function playWallpaperEnginePreview(card) {
  if (document.documentElement.dataset.shellLowPerformance === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const video = card.querySelector('video[data-wallpaper-engine-preview]')
  if (!video) return
  disposeWallpaperEnginePreviews(video)
  if (!video.getAttribute('src') && video.dataset.previewSrc) {
    video.src = video.dataset.previewSrc
    video.load()
  }
  video.play().catch(() => {})
}

function openWallpaperEnginePicker() {
  wallpaperEngineLibrary = null
  wallpaperEngineReason = ''
  skinWallpaperEngineSearch.value = ''
  skinWallpaperEngineSearchClear.disabled = true
  skinWallpaperEnginePicker.classList.remove('hidden')
  skinWallpaperEngineStatus.textContent = '正在扫描本机 Steam 库…'
  disposeWallpaperEnginePreviews()
  skinWallpaperEngineItems.innerHTML = ''
  skinWallpaperEngineEmpty.classList.add('hidden')
  skinWallpaperEngineSearch.disabled = true
  skinBrowseWallpaperEngineButton.disabled = true
  api.listWallpaperEngineProjects().then(library => {
    renderWallpaperEnginePicker(library)
  }).catch(error => {
    skinWallpaperEngineStatus.textContent = `扫描失败：${error.message}`
    wallpaperEngineLibrary = null
  }).finally(() => {
    skinBrowseWallpaperEngineButton.disabled = false
    skinWallpaperEngineSearch.disabled = false
  })
}

function renderWallpaperEnginePicker(library, reason = '') {
  wallpaperEngineLibrary = library || wallpaperEngineLibrary
  wallpaperEngineReason = reason || wallpaperEngineReason
  const projects = (wallpaperEngineLibrary && wallpaperEngineLibrary.projects) || []
  const skipped = (wallpaperEngineLibrary && wallpaperEngineLibrary.skipped) || {}
  const query = skinWallpaperEngineSearch.value.trim().toLocaleLowerCase('zh-CN')
  const filtered = projects.filter(project => [project.title, project.directory, project.kind === 'video' ? '视频' : '图片', project.source === 'workshop' ? '创意工坊' : '本地项目']
    .some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(query)))
  const reasonText = {
    'multiple-current': '检测到多个显示器正在使用不同的可导入壁纸，请选择一个。',
    'ambiguous-profile': 'Wallpaper Engine 配置中有多个用户，无法可靠确定当前用户，请选择一个壁纸。',
    'unsupported-current': '当前 Wallpaper Engine 壁纸是暂不支持的 scene、web 或 application 项目，请另选图片或视频项目。',
    'config-unavailable': '无法读取 Wallpaper Engine 当前选择，请从已安装项目中选择一个。',
    'no-current': 'Wallpaper Engine 当前没有已选择的壁纸，请从已安装项目中选择一个。',
    'current-unavailable': '当前壁纸项目已移动或不可读取，请从可用项目中选择一个。'
  }[wallpaperEngineReason] || ''
  skinWallpaperEngineSearchClear.disabled = !query
  skinWallpaperEngineEmpty.classList.toggle('hidden', !query || filtered.length > 0)
  if (!projects.length) {
    skinWallpaperEngineStatus.textContent = `${reasonText ? `${reasonText} ` : ''}未在本机 Steam 库中找到可导入的图片或视频项目；可手动选择项目目录。`
    skinWallpaperEngineItems.innerHTML = ''
    return
  }
  const skippedNote = skipped.unsupported ? `；跳过 ${skipped.unsupported} 个 scene/web 项目` : ''
  const filterNote = query ? `；当前显示 ${filtered.length} 个匹配项` : ''
  skinWallpaperEngineStatus.textContent = `${reasonText ? `${reasonText} ` : ''}找到 ${projects.length} 个项目${skippedNote}${filterNote}；选择后只复制这一项并立即使用。`
  disposeWallpaperEnginePreviews()
  skinWallpaperEngineItems.innerHTML = filtered.map(project => {
    const kindLabel = project.kind === 'video' ? '视频' : '图片'
    const sourceLabel = project.source === 'workshop' ? '创意工坊' : '本地项目'
    const previewUrl = wallpaperEngineProjectPreviewUrl(project)
    const preview = previewUrl
      ? project.kind === 'video'
        ? `<video data-wallpaper-engine-preview data-preview-src="${escapeHtml(previewUrl)}" preload="none" muted loop playsinline aria-hidden="true"></video><span class="skin-wallpaper-preview-kind" aria-hidden="true">悬停预览视频</span>`
        : `<img data-wallpaper-engine-preview src="${escapeHtml(previewUrl)}" alt="" loading="lazy" decoding="async" />`
      : `<span class="skin-wallpaper-preview-placeholder">${kindLabel}预览不可用</span>`
    return `
      <article class="skin-wallpaper-item" role="listitem" data-kind="${escapeHtml(project.kind)}" aria-label="${escapeHtml(project.title)}，${kindLabel}，${sourceLabel}">
        <span class="skin-wallpaper-item-preview">${preview}</span>
        <span class="skin-wallpaper-item-body">
          <span class="skin-wallpaper-item-title">${escapeHtml(project.title)}</span>
          <span class="skin-wallpaper-item-meta">${kindLabel} · ${sourceLabel}${project.current ? ' · 当前显示器正在使用' : ''}</span>
          <span class="skin-wallpaper-item-path" title="${escapeHtml(project.directory)}">${escapeHtml(project.directory)}</span>
          <button type="button" data-import-project="${escapeHtml(project.directory)}" aria-label="选择并使用 ${escapeHtml(project.title)}">选择并使用</button>
        </span>
      </article>`
  }).join('')
  skinWallpaperEngineItems.querySelectorAll('.skin-wallpaper-item').forEach(card => {
    card.addEventListener('pointerenter', () => playWallpaperEnginePreview(card))
    card.addEventListener('pointerleave', () => disposeWallpaperEnginePreviews())
    card.addEventListener('focusin', () => playWallpaperEnginePreview(card))
    card.addEventListener('focusout', event => {
      if (!card.contains(event.relatedTarget)) disposeWallpaperEnginePreviews()
    })
  })
  skinWallpaperEngineItems.querySelectorAll('[data-import-project]').forEach(item => item.addEventListener('click', () => activateWallpaperEngineProject(item.dataset.importProject)))
}

async function importCurrentWallpaperEngineProject() {
  disposeWallpaperEnginePreviews()
  skinWallpaperEnginePicker.classList.add('hidden')
  skinChooseWallpaperEngineButton.disabled = true
  skinChooseWallpaperEngineButton.textContent = '正在识别并复制…'
  wallpaperLibraryMessage('正在读取 Wallpaper Engine 当前选择；只会复制当前的一项壁纸…')
  try {
    const result = await api.importCurrentWallpaperEngine()
    if (result?.status === 'imported' && result.appearance) {
      await skinPickerHost.apply(async () => {
        appearanceState = result.appearance
        await publishAppearanceState()
        renderSkinPicker()
        return true
      })
      return
    }
    skinWallpaperEnginePicker.classList.remove('hidden')
    renderWallpaperEnginePicker(result?.library, result?.reason)
    wallpaperLibraryMessage('未找到唯一且受支持的当前壁纸，请在下方选择一个；扫描不会复制任何文件。')
  } catch (error) {
    wallpaperLibraryMessage(`导入当前壁纸失败：${error.message}`, true)
  } finally {
    skinChooseWallpaperEngineButton.disabled = false
    skinChooseWallpaperEngineButton.textContent = '导入当前 Wallpaper Engine 壁纸'
  }
}

async function activateWallpaperEngineProject(directory) {
  skinWallpaperEngineStatus.textContent = '正在导入并复制到 Harness 本地目录…'
  skinChooseWallpaperEngineButton.disabled = true
  try {
    await skinPickerHost.apply(async () => {
      appearanceState = await api.applyWallpaperEngineProject(directory)
      await publishAppearanceState()
      renderSkinPicker()
    })
  } catch (error) {
    skinWallpaperEngineStatus.textContent = `导入失败：${error.message}`
    skinWallpaperEnginePicker.classList.remove('hidden')
    skinChooseWallpaperEngineButton.disabled = false
  }
}

let modelRoutingDirty = false
let modelRoutingSubDraft = { provider: '', model: '' }

function shellModelMeterAmount(value, unit) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return `${escapeHtml(value)}${unit ? ` ${escapeHtml(unit)}` : ''}`
  if (/^[A-Z]{3}$/.test(unit || '')) {
    try { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: unit }).format(number) } catch {}
  }
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(number)}${unit ? ` ${escapeHtml(unit)}` : ''}`
}

function shellModelMeterPercent(value) {
  return `${Math.max(0, Math.min(100, Number(value) || 0)).toFixed(0)}%`
}

function shellModelResetText(seconds) {
  if (!seconds) return ''
  const date = new Date(Number(seconds) * 1000)
  return Number.isNaN(date.getTime()) ? '' : `重置：${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)}`
}

function shellModelMeterRow(meter) {
  if (meter.kind === 'balance') return `
    <div class="model-routing-meter-row"><div class="model-routing-meter-row-head"><span>${escapeHtml(meter.label || '余额')}</span><span>${escapeHtml(meter.currency || '')}</span></div>
    <div class="model-routing-meter-value">${shellModelMeterAmount(meter.total, meter.currency)}</div>
    <div class="model-routing-meter-detail">赠送 ${shellModelMeterAmount(meter.granted, meter.currency)} · 充值 ${shellModelMeterAmount(meter.toppedUp, meter.currency)}</div></div>`
  if (meter.kind === 'usage-window') return `
    <div class="model-routing-meter-row"><div class="model-routing-meter-row-head"><span>${escapeHtml(meter.label || '套餐用量')}</span><span>剩余 ${shellModelMeterPercent(meter.remainingPercent)}</span></div>
    <div class="model-routing-meter-bar"><span style="width:${shellModelMeterPercent(meter.usedPercent)}"></span></div>
    <div class="model-routing-meter-detail">已用 ${shellModelMeterPercent(meter.usedPercent)}${shellModelResetText(meter.resetsAt) ? ` · ${escapeHtml(shellModelResetText(meter.resetsAt))}` : ''}</div></div>`
  if (meter.kind === 'spending-budget') return `
    <div class="model-routing-meter-row"><div class="model-routing-meter-row-head"><span>${escapeHtml(meter.label || '消费限额')}</span><span>剩余 ${shellModelMeterPercent(meter.remainingPercent)}</span></div>
    <div class="model-routing-meter-value">${escapeHtml(meter.used)} / ${escapeHtml(meter.limit)}</div>
    <div class="model-routing-meter-detail">${escapeHtml(shellModelResetText(meter.resetsAt))}</div></div>`
  if (meter.kind === 'token-counter') return `
    <div class="model-routing-meter-row"><div class="model-routing-meter-row-head"><span>${escapeHtml(meter.label || '用量')}</span></div><div class="model-routing-meter-value">${shellModelMeterAmount(meter.value, meter.unit)}</div></div>`
  return ''
}

function shellModelMeterStateLabel(snapshot) {
  return ({ ready: snapshot.stale ? '上次结果' : '实时', unsupported: '暂不支持', 'auth-required': '需授权', unavailable: '不可用', error: '刷新失败' })[snapshot.status] || snapshot.status
}

function shellModelFillSelect(select, rows, selected, placeholder) {
  const normalized = rows.map(row => typeof row === 'string' ? { value: row, label: row } : row).filter(row => row.value)
  if (selected && !normalized.some(row => row.value === selected)) normalized.unshift({ value: selected, label: selected })
  const html = `<option value="">${escapeHtml(placeholder)}</option>${normalized.map(row => `<option value="${escapeHtml(row.value)}">${escapeHtml(row.label || row.value)}</option>`).join('')}`
  if (select.innerHTML !== html) select.innerHTML = html
  select.value = selected || ''
}

function setShellModelSubagentMode(inherited) {
  modelRoutingSubInherit.setAttribute('aria-pressed', String(inherited))
  modelRoutingSubIndependent.setAttribute('aria-pressed', String(!inherited))
  for (const select of [modelRoutingSubProvider, modelRoutingSubModel]) {
    select.disabled = inherited
    select.setAttribute('aria-disabled', String(inherited))
  }
}

function renderShellModelMeters() {
  const metersState = modelRoutingState.meters || {}
  const snapshots = metersState.snapshots || []
  modelRoutingMeters.innerHTML = snapshots.length ? snapshots.map(snapshot => `
    <div class="model-routing-meter-provider">
      <div class="model-routing-meter-provider-head"><strong>${escapeHtml(snapshot.provider?.name || snapshot.provider?.id || '服务商')}</strong><span class="model-routing-meter-state">${escapeHtml(shellModelMeterStateLabel(snapshot))}</span></div>
      ${(snapshot.meters || []).map(shellModelMeterRow).join('')}
      ${snapshot.message ? `<div class="model-routing-meter-message">${escapeHtml(snapshot.message)}</div>` : ''}
      ${snapshot.action ? `<a href="#" class="model-routing-meter-action" data-hd-meter-url="${escapeHtml(snapshot.action.url)}">${escapeHtml(snapshot.action.label)}</a>` : ''}
    </div>`).join('') : `<div class="model-routing-meter-message">${metersState.error ? `额度读取失败：${escapeHtml(metersState.error)}` : '没有已配置的服务商。'}</div>`
  modelRoutingMeters.querySelectorAll('[data-hd-meter-url]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault()
    api.openLink(link.dataset.hdMeterUrl || '').catch(() => {})
  }))
  modelRoutingRefreshMeters.disabled = Boolean(metersState.loading)
  modelRoutingRefreshMeters.textContent = metersState.loading ? '刷新中…' : '刷新额度'
}

function renderModelRoutingPage() {
  const state = modelRoutingState
  const providerRows = (state.providers || []).map(row => ({ value: row.id, label: row.name && row.name !== row.id ? `${row.name} (${row.id})` : row.id }))
  const initialMain = (window.harnessModelRoutingIntegration || {}).selectInitialRoute
    ? window.harnessModelRoutingIntegration.selectInitialRoute(state)
    : { provider: state.main?.provider || '', model: state.main?.model || '' }
  const modelsFor = provider => state.providers?.find(row => row.id === provider)?.models || []
  const mainProviderValue = modelRoutingDirty ? modelRoutingMainProvider.value : (initialMain.provider || state.main?.provider || '')
  const mainModelValue = modelRoutingDirty ? modelRoutingMainModel.value : (initialMain.model || state.main?.model || '')
  if (!modelRoutingDirty) {
    modelRoutingSubDraft = {
      provider: (state.subagent?.provider || initialMain.provider) || '',
      model: (state.subagent?.model || initialMain.model) || ''
    }
  }
  shellModelFillSelect(modelRoutingMainProvider, providerRows, mainProviderValue, '选择服务商')
  shellModelFillSelect(modelRoutingMainModel, modelsFor(modelRoutingMainProvider.value).map(value => ({ value, label: value })), mainModelValue, '选择模型')
  const inherited = modelRoutingDirty ? modelRoutingSubInherit.getAttribute('aria-pressed') === 'true' : state.subagent?.inheritMain !== false
  const subProviderValue = inherited ? modelRoutingMainProvider.value : modelRoutingSubDraft.provider
  const subModelValue = inherited ? modelRoutingMainModel.value : modelRoutingSubDraft.model
  shellModelFillSelect(modelRoutingSubProvider, providerRows, subProviderValue, '选择服务商')
  shellModelFillSelect(modelRoutingSubModel, modelsFor(modelRoutingSubProvider.value).map(value => ({ value, label: value })), subModelValue, '选择模型')
  setShellModelSubagentMode(inherited)
  const subRoute = modelRoutingSubProvider.value && modelRoutingSubModel.value
    ? `${modelRoutingSubProvider.value} / ${modelRoutingSubModel.value}`
    : inherited ? '等待主模型选择' : '尚未完整指定'
  modelRoutingSubSummary.textContent = inherited
    ? `跟随主模型：当前同步为 ${subRoute}；切换到“单独指定”即可编辑。`
    : `单独指定：当前为 ${subRoute}；下方服务商和模型可直接编辑。`
  modelRoutingStatus.dataset.error = state.error ? 'true' : 'false'
  modelRoutingStatus.textContent = state.error
    ? `保存失败：${state.error}`
    : state.saved
      ? '已保存；主模型和子代理路由从下一次新建会话起生效。'
      : `当前基于 ${state.basePreset || 'standard'} Agent 预设；配置保存在用户目录，不受官方更新覆盖。`
  modelRoutingSave.disabled = Boolean(state.saving)
  modelRoutingSave.textContent = state.saving ? '正在保存…' : '保存模型路由'
  renderShellModelMeters()
}

function openModelRouting() {
  closePetPanel()
  closeSkinPicker()
  modelRoutingDirty = false
  renderModelRoutingPage()
  modelRoutingOverlay.classList.remove('hidden')
  modelRoutingOverlay.setAttribute('aria-hidden', 'false')
  closeModelRoutingButton.focus()
}

function closeModelRouting() {
  modelRoutingOverlay.classList.add('hidden')
  modelRoutingOverlay.setAttribute('aria-hidden', 'true')
  modelRoutingDirty = false
}

function showUpdateReady(version, kind = 'installer') {
  pendingUpdateKind = kind
  applyShellTheme()
  const component = kind === 'components'
  updateReadyTitle.textContent = component ? '组件更新已准备好' : '更新已准备好'
  updateReadyDetail.textContent = `Harness Desktop ${version || '新版本'} 已经下载并通过安全校验。`
  updateReadyNote.textContent = component
    ? '点击应用后，当前程序将关闭；独立助手会原子切换组件并通过健康检查确认或自动回滚。'
    : '点击安装后，当前程序将关闭，随后打开系统安装流程。'
  updateLaunchError.textContent = ''
  updateNowButton.disabled = false
  updateNowButton.textContent = component ? '重启并应用' : '立即安装'
  updateReadyOverlay.classList.remove('hidden')
  updateReadyOverlay.setAttribute('aria-hidden', 'false')
  updateNowButton.focus()
}

function closeUpdateReady() {
  if (updateNowButton.disabled) return
  updateReadyOverlay.classList.add('hidden')
  updateReadyOverlay.setAttribute('aria-hidden', 'true')
}

function normalizedReleaseNotes(value) {
  const lines = String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim().replace(/^[-*+]\s+/, '').replace(/^#{1,6}\s+/, ''))
    .filter(line => line && !/^Full Changelog:/i.test(line) && !/^https?:\/\//i.test(line))
    .slice(0, 6)
  return lines.length ? lines : ['修复已知问题并改善桌面端使用体验。', '完整改动可以在发布页面查看。']
}

function closeUpdateNotice() {
  if (updateNoticeInstall.disabled) return
  updateNoticeOverlay.classList.add('hidden')
  updateNoticeOverlay.setAttribute('aria-hidden', 'true')
}

function showUpdateNotice(result, { force = false } = {}) {
  if (!result?.updateAvailable || !result.latestVersion) return
  if (!force && updateNoticeShownVersion === result.latestVersion) return
  updateNoticeShownVersion = result.latestVersion
  applyShellTheme()
  updateNoticeTitle.textContent = `Harness Desktop ${result.latestVersion} 可以更新了`
  updateNoticeSummary.textContent = `当前版本 ${result.currentVersion || '未知'}，这次主要更新：`
  updateNoticeNotes.replaceChildren(...normalizedReleaseNotes(result.notes).map(note => {
    const item = document.createElement('li')
    item.textContent = note
    return item
  }))
  updateNoticeRelease.hidden = !result.url
  updateNoticeRelease.dataset.url = result.url || ''
  updateNoticeInstall.disabled = false
  updateNoticeInstall.textContent = '立即更新'
  updateNoticeOverlay.classList.remove('hidden')
  updateNoticeOverlay.setAttribute('aria-hidden', 'false')
  updateNoticeInstall.focus()
}

function showComponentUpdateNotice(componentState) {
  const check = componentState?.lastCheck
  if (!componentState?.enabled || check?.mode !== 'components' || !check.releaseVersion) return false
  const planned = Array.isArray(check.components) ? check.components : []
  // Defense-in-depth: if the last check still lists components that are already
  // active at the same version (and no update is mid-flight), the "update
  // available" notice must not reappear after the update was applied.
  const active = new Map((Array.isArray(componentState?.pointer?.components) ? componentState.pointer.components : []).map(component => [component.id, component]))
  const midFlight = Boolean(componentState?.state?.phase) && !['idle', 'failed'].includes(componentState.state.phase)
  const allAlreadyActive = planned.length > 0 && planned.every(component => {
    const installed = active.get(component.id)
    return installed && installed.version === component.version
  })
  if (allAlreadyActive && !midFlight) return false
  pendingUpdateKind = 'components'
  pendingComponentUpdate = componentState
  return true
}

function renderRuntimeState(state) {
  if (state?.status === 'ready' && state.url) {
    startupRuntimeReady = true
    if (!startupRuntimeReadyAt) startupRuntimeReadyAt = performance.now()
    startupFailed = false
    if (runtimeView.src !== state.url) runtimeView.src = state.url
    runtimeStatus.classList.add('ready')
    retryRuntime.classList.add('hidden')
    return
  }
  if (state?.status === 'error') {
    startupFailed = true
  }
  runtimeStatus.classList.remove('ready')
  runtimeStatusTitle.textContent = state?.status === 'error' ? 'DeepSeek Harness 启动失败' : '正在启动 DeepSeek Harness…'
  runtimeStatusDetail.textContent = state?.detail || '官方工作台准备中'
  retryRuntime.classList.toggle('hidden', state?.status !== 'error')
}

function formatDeviceTime(value) {
  if (!value) return '尚未连接'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return `最近连接 ${date.toLocaleString('zh-CN', { hour12: false })}`
}

// 个人中继（可选）的后端调用集中在这里：若后端最终 API 命名不同，只需改这一处并回报主控协调
const mobileRelayApi = {
  save: url => api.setMobileSyncRelayUrl(String(url || '').trim()),
  clear: () => api.clearMobileSyncRelayUrl()
}
function mobileRelayApiAvailable() {
  return typeof api.setMobileSyncRelayUrl === 'function' && typeof api.clearMobileSyncRelayUrl === 'function'
}

function renderMobileSync(next = mobileSyncState) {
  mobileSyncState = { ...mobileSyncState, ...(next || {}) }
  const running = mobileSyncState.enabled && mobileSyncState.running
  const remote = mobileSyncState.remote || {}
  mobileSyncHeadline.textContent = running ? '手机同步已开启' : '手机同步未开启'
  mobileSyncDetail.textContent = running
    ? mobileSyncState.targetReady ? '电脑工作台已就绪，已配对手机会自动连接。' : '同步服务已开启，正在等待电脑工作台就绪。'
    : '开启后优先局域网直连，离家时由安全远程通道接管。'
  mobileSyncToggle.textContent = running ? '关闭手机同步' : '开启手机同步'
  mobileSyncToggle.classList.toggle('primary', !running)
  mobileSyncEnabledContent.classList.toggle('hidden', !running)
  mobileRemoteToggle.checked = remote.enabled !== false
  mobileRemoteToggle.disabled = !running
  mobileTransportPreference.value = remote.preference || 'auto'
  mobileTransportPreference.disabled = !running || remote.enabled === false
  renderMobileRelayCard(remote)
  const nativeAdapter = (Array.isArray(remote.adapters) ? remote.adapters : []).find(adapter => adapter?.id === 'native-p2p')
  const connectedRemoteText = remote.active === 'native-p2p'
    ? nativeAdapter?.path === 'direct'
      ? '原生 P2P 直连已连接'
      : nativeAdapter?.path === 'negotiating'
        ? '个人 WSS/443 备用线路已连接，正在协商原生 P2P'
        : nativeAdapter?.path === 'relay'
          ? '个人 WSS/443 加密中继已连接（P2P 等待或回退）'
          : '原生 P2P / WSS 安全通道已连接'
    : remote.active === 'wss-relay'
      ? '个人 WSS/443 加密中继已连接'
      : remote.active === 'easytier'
        ? 'EasyTier 已连接'
        : remote.active === 'tailscale'
          ? 'Tailscale 已连接'
          : '远程通道已连接'
  const remoteStatusText = remote.enabled === false
    ? '远程连接已关闭；同一 Wi-Fi 仍可使用'
    : remote.status === 'connected'
      ? connectedRemoteText
      : remote.status === 'connecting'
        ? '正在选择可用的远程通道…'
        : remote.status === 'reconnecting'
          ? '当前通道中断，正在自动切换备用线路…'
          : remote.status === 'unavailable'
            ? '远程组件暂不可用；同一 Wi-Fi 仍可使用'
            : running ? '等待远程通道启动' : '手机同步开启后可用'
  mobileRemoteStatus.textContent = remoteStatusText
  const pairing = mobileSyncState.pairing || {}
  mobileSyncUrl.value = pairing.shareUrl || pairing.appUrl || pairing.url || ''
  mobileSyncPairCard.classList.toggle('hidden', !pairing.qrDataUrl)
  mobileSyncQrPlaceholder.classList.toggle('hidden', Boolean(pairing.qrDataUrl))
  if (pairing.qrDataUrl) mobileSyncQr.src = pairing.qrDataUrl
  else mobileSyncQr.removeAttribute('src')
  if (pairing.expiresAt) {
    const minutes = Math.max(0, Math.ceil((new Date(pairing.expiresAt).getTime() - Date.now()) / 60000))
    mobileSyncPairExpiry.textContent = `${minutes} 分钟内有效`
  } else mobileSyncPairExpiry.textContent = ''
  const devices = Array.isArray(mobileSyncState.devices) ? mobileSyncState.devices : []
  mobileSyncDeviceCount.textContent = `${devices.length} 台`
  mobileSyncDeviceList.innerHTML = devices.length
    ? devices.map(device => `<article class="mobile-sync-device"><div><strong>${escapeHtml(device.name)}</strong><span>${escapeHtml(formatDeviceTime(device.lastSeenAt || device.createdAt))}</span></div><button type="button" data-revoke-mobile-device="${escapeHtml(device.id)}">解除配对</button></article>`).join('')
    : '<div class="mobile-sync-empty">还没有已配对设备。点击“添加手机”生成一次性二维码。</div>'
  mobileSyncDeviceList.querySelectorAll('[data-revoke-mobile-device]').forEach(button => button.addEventListener('click', async () => {
    try {
      mobileSyncError.textContent = ''
      renderMobileSync(await api.revokeMobileDevice(button.dataset.revokeMobileDevice))
    } catch (error) { mobileSyncError.textContent = error.message }
  }))

  const controlDevices = Array.isArray(mobileSyncState.control?.devices) ? mobileSyncState.control.devices : []
  const readyControls = controlDevices.filter(device => device.ready)
  const enabledControls = controlDevices.filter(device => device.enabled)
  mobileControlSummary.textContent = readyControls.length
    ? `${readyControls.length} 台手机已就绪；关闭手机开关或点击停止会立即清空命令。`
    : enabledControls.length
      ? '手机控制已授权，正在等待无障碍服务或控制通道就绪。'
      : '等待手机上报授权状态；默认不会执行任何操作。'
  stopMobileControl.disabled = !enabledControls.length && !controlDevices.some(device => device.queued > 0)
  mobileControlDeviceList.innerHTML = controlDevices.length
    ? controlDevices.map(device => `<article class="mobile-control-device"><div><b>${escapeHtml(device.name || 'Android 手机')} · ${device.ready ? '已就绪' : device.online ? escapeHtml(device.phase || '未就绪') : '离线'}</b><span>${escapeHtml(device.detail || (device.ready ? '可以接收固定动作' : '请在手机设置中完成授权'))}</span><code>${escapeHtml((device.capabilities || []).join(', ') || '尚未上报 capability')}</code></div>${device.enabled || device.queued ? `<button type="button" data-stop-mobile-control="${escapeHtml(device.id)}">停止</button>` : ''}</article>`).join('')
    : '<div class="mobile-sync-empty">已配对手机打开新版 APP 后，这里会显示控制授权和能力状态。</div>'
  mobileControlDeviceList.querySelectorAll('[data-stop-mobile-control]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true
    try {
      const result = await api.stopMobileControl(button.dataset.stopMobileControl)
      renderMobileSync({ control: result.state })
      await publishMobileSyncState()
    } catch (error) { mobileSyncError.textContent = error.message }
    finally { button.disabled = false }
  }))
}

function mobileRelayAdapterState(remote) {
  const adapters = Array.isArray(remote?.adapters) ? remote.adapters : []
  const active = adapters.find(adapter => adapter && adapter.id === remote?.active && ['native-p2p', 'wss-relay'].includes(adapter.id))
  return active
    || adapters.find(adapter => adapter && adapter.id === 'wss-relay' && adapter.status === 'connected')
    || adapters.find(adapter => adapter && adapter.id === 'native-p2p')
    || adapters.find(adapter => adapter && adapter.id === 'wss-relay')
    || null
}

function renderMobileRelayCard(remote = mobileSyncState.remote || {}) {
  const adapter = mobileRelayAdapterState(remote)
  const relay = mobileSyncState.relay || {}
  const savedUrl = String(relay.relayUrl || adapter?.relayUrl || remote?.relayUrl || '').trim()
  if (document.activeElement !== mobileRelayUrlInput) mobileRelayUrlInput.value = savedUrl
  mobileRelayClear.disabled = !savedUrl && relay.source !== 'invalid'
  if (relay.source === 'invalid' && !relayTesting && !mobileRelayMessage.textContent) {
    mobileRelayMessage.textContent = '个人中继配置无法读取，请清除恢复默认或重新保存地址。'
  } else if (relay.requiresDeviceUpdate && !relayTesting && !mobileRelayMessage.textContent) {
    mobileRelayMessage.textContent = '中继地址已变更：请重新生成二维码，并在已配对手机重新扫码更新远程线路。'
  }
  if (relayTesting) mobileRelayStatus.textContent = '检测中…'
  else if (relay.source === 'invalid') mobileRelayStatus.textContent = '配置异常 · 可清除或重新保存'
  else if (!savedUrl) mobileRelayStatus.textContent = '未配置'
  else if (adapter?.status === 'connected') mobileRelayStatus.textContent = '已保存 · WSS/443 中继已连接'
  else if (adapter?.status === 'connecting') mobileRelayStatus.textContent = '已保存 · 正在连接中继…'
  else if (adapter?.status === 'disconnected' || adapter?.error) mobileRelayStatus.textContent = '已保存 · 中继连接异常'
  else mobileRelayStatus.textContent = '已保存'
}

async function generateMobilePairing() {
  refreshMobilePairing.disabled = true
  mobileSyncError.textContent = ''
  mobileSyncQrPlaceholder.textContent = '正在生成二维码…'
  mobileSyncQr.removeAttribute('src')
  try { renderMobileSync(await api.beginMobilePairing()) }
  catch (error) {
    mobileSyncQrPlaceholder.classList.remove('hidden')
    mobileSyncQrPlaceholder.textContent = '暂时无法生成二维码'
    mobileSyncError.textContent = error.message
  } finally { refreshMobilePairing.disabled = false }
}

async function openMobileSync() {
  mobileSyncOverlay.classList.remove('hidden')
  mobileSyncOverlay.setAttribute('aria-hidden', 'false')
  closePetPanel()
  try {
    renderMobileSync(await api.getMobileSyncState())
    if (mobileSyncState.enabled && mobileSyncState.running && !mobileSyncState.devices?.length && !mobileSyncState.pairing?.qrDataUrl) await generateMobilePairing()
  } catch (error) { mobileSyncError.textContent = error.message }
}

function closeMobileSync() {
  mobileSyncOverlay.classList.add('hidden')
  mobileSyncOverlay.setAttribute('aria-hidden', 'true')
  runtimeView.focus()
}

function terminalSelectedShell() {
  const shells = Array.isArray(terminalCapabilities.shells) ? terminalCapabilities.shells : []
  const id = terminalPreferences.shellId || terminalCapabilities.defaultShellId
  return shells.find(shell => shell.id === id) || shells.find(shell => shell.available) || null
}

function updateTerminalControls() {
  const running = terminalSession?.running === true
  terminalStartButton.disabled = terminalStarting || terminalCapabilities.pty !== true
  terminalInterruptButton.disabled = !running
  terminalStopButton.disabled = !running
  const selected = terminalSession || terminalSelectedShell()
  terminalShellBadge.textContent = selected?.shellLabel || selected?.label || (terminalCapabilities.pty ? '未启动' : 'PTY 不可用')
  terminalWorkspace.textContent = terminalSession?.cwd || terminalPreferences.workspace || ''
  terminalWorkspace.title = terminalSession?.cwd || terminalPreferences.workspace || '当前 Harness 工作区'
}

function showTerminalStatus(message, isError = false) {
  terminalStatus.textContent = String(message || '')
  terminalStatus.style.color = isError ? '#e56b6f' : ''
}

function ensureTerminalEmulator() {
  if (terminalEmulator) return true
  const TerminalCtor = window.Terminal
  const FitAddonCtor = window.FitAddon?.FitAddon
  if (typeof TerminalCtor !== 'function' || typeof FitAddonCtor !== 'function') {
    terminalEmpty.classList.remove('hidden')
    terminalEmpty.textContent = '终端显示组件未加载，请重启 Harness Desktop。'
    showTerminalStatus('xterm.js 组件未加载', true)
    terminalStartButton.disabled = true
    return false
  }
  terminalEmulator = new TerminalCtor({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: 'Cascadia Mono, Consolas, ui-monospace, monospace',
    fontSize: 12,
    lineHeight: 1.22,
    scrollback: 8000,
    convertEol: false,
    theme: {
      background: '#111318', foreground: '#e5e7eb', cursor: '#9bb3ff', cursorAccent: '#111318',
      selectionBackground: '#315efb66', black: '#17191f', red: '#e56b6f', green: '#7ccf91', yellow: '#e8c878',
      blue: '#83a8ff', magenta: '#c391f3', cyan: '#78c7d2', white: '#e5e7eb', brightBlack: '#717784'
    }
  })
  terminalFitAddon = new FitAddonCtor()
  terminalEmulator.loadAddon(terminalFitAddon)
  terminalEmulator.open(terminalHost)
  terminalEmulator.onData(data => {
    if (!terminalSession?.running) return
    api.writeTerminal(terminalSession.id, data).catch(error => {
      if (terminalWriteErrorShown) return
      terminalWriteErrorShown = true
      showTerminalStatus(`终端输入失败：${error.message}`, true)
    })
  })
  terminalEmulator.onResize(({ cols, rows }) => {
    if (!terminalSession?.running) return
    api.resizeTerminal(terminalSession.id, cols, rows).catch(() => {})
  })
  return true
}

function fitIntegratedTerminal() {
  if (!terminalEmulator || !document.body.classList.contains('terminal-panel-open')) return
  cancelAnimationFrame(terminalResizeFrame)
  terminalResizeFrame = requestAnimationFrame(() => {
    try { terminalFitAddon?.fit() } catch {}
  })
}

function openIntegratedTerminal({ focus = true } = {}) {
  document.body.classList.add('terminal-panel-open')
  terminalPanel.setAttribute('aria-hidden', 'false')
  ensureTerminalEmulator()
  fitIntegratedTerminal()
  if (focus) requestAnimationFrame(() => terminalEmulator?.focus())
}

function closeIntegratedTerminal() {
  document.body.classList.remove('terminal-panel-open')
  terminalPanel.setAttribute('aria-hidden', 'true')
  runtimeView.focus()
}

function toggleIntegratedTerminal() {
  if (document.body.classList.contains('terminal-panel-open')) closeIntegratedTerminal()
  else openIntegratedTerminal()
}

function applyTerminalEvent(event, allowBuffer = true) {
  if (!event?.terminalId) return
  if (!terminalSession || event.terminalId !== terminalSession.id) {
    if (allowBuffer && terminalStarting) terminalEventBacklog.push(event)
    return
  }
  if (event.stream === 'stdout' || event.stream === 'stderr' || event.stream === 'error') {
    terminalEmulator?.write(String(event.text ?? ''))
    if (event.stream === 'error') showTerminalStatus(String(event.text || '终端进程错误'), true)
    return
  }
  if (event.stream === 'exit') {
    terminalEmulator?.write(String(event.text ?? ''))
    terminalSession = { ...terminalSession, running: false }
    showTerminalStatus(`终端已退出（code=${event.code ?? '-'}）`)
    updateTerminalControls()
  }
}

async function startIntegratedTerminal() {
  openIntegratedTerminal({ focus: false })
  if (!ensureTerminalEmulator() || terminalStarting || terminalCapabilities.pty !== true) return
  terminalStarting = true
  terminalWriteErrorShown = false
  terminalEventBacklog.length = 0
  updateTerminalControls()
  try {
    if (terminalSession?.running) await api.stopTerminal(terminalSession.id).catch(() => {})
    terminalSession = null
    terminalEmulator.reset()
    terminalEmpty.classList.add('hidden')
    fitIntegratedTerminal()
    showTerminalStatus('正在启动终端…')
    const result = await api.startTerminal({
      shellId: terminalPreferences.shellId || undefined,
      cols: terminalEmulator.cols,
      rows: terminalEmulator.rows
    })
    terminalSession = { ...result, running: true }
    showTerminalStatus(`${result.shellLabel} 已在当前工作区启动`)
    updateTerminalControls()
    for (const event of terminalEventBacklog.splice(0)) applyTerminalEvent(event, false)
    requestAnimationFrame(() => terminalEmulator.focus())
  } catch (error) {
    terminalEmpty.classList.remove('hidden')
    terminalEmpty.textContent = `终端启动失败：${error.message}`
    showTerminalStatus(`终端启动失败：${error.message}`, true)
  } finally {
    terminalStarting = false
    updateTerminalControls()
  }
}

async function stopIntegratedTerminal() {
  if (!terminalSession?.running) return
  const current = terminalSession
  try {
    await api.stopTerminal(current.id)
    if (terminalSession?.id === current.id) terminalSession = { ...current, running: false }
    terminalEmulator?.writeln('\r\n[terminal stopped]')
    showTerminalStatus('终端已停止')
  } catch (error) {
    showTerminalStatus(`停止失败：${error.message}`, true)
  }
  updateTerminalControls()
}

function interruptIntegratedTerminal() {
  if (!terminalSession?.running) return
  api.writeTerminal(terminalSession.id, '\x03').catch(error => showTerminalStatus(`中断失败：${error.message}`, true))
  terminalEmulator?.focus()
}

async function hydrateIntegratedTerminal() {
  try {
    const [preferences, capabilities, terminals] = await Promise.all([
      api.getTerminalPreferences(),
      api.getTerminalCapabilities(),
      api.listTerminals()
    ])
    terminalPreferences = { shellId: preferences?.shellId || null, workspace: preferences?.workspace || '' }
    terminalCapabilities = capabilities || terminalCapabilities
    const active = Array.isArray(terminals) ? terminals.find(item => item.running) : null
    if (active) terminalSession = active
    const selected = terminalSelectedShell()
    showTerminalStatus(terminalCapabilities.pty
      ? `${selected?.label || '默认 Shell'} 已就绪`
      : 'PTY 后端不可用，请修复桌面组件', terminalCapabilities.pty !== true)
    updateTerminalControls()
    await publishTerminalSettingsState()
  } catch (error) {
    showTerminalStatus(`终端能力检查失败：${error.message}`, true)
    terminalStartButton.disabled = true
  }
}

function beginTerminalResize(event) {
  if (event.button !== 0 && event.type !== 'keydown') return
  if (event.type === 'keydown') {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const current = terminalPanel.getBoundingClientRect().height
    const next = Math.max(160, Math.min(window.innerHeight * .72, current + (event.key === 'ArrowUp' ? 24 : -24)))
    document.documentElement.style.setProperty('--terminal-panel-height', `${Math.round(next)}px`)
    fitIntegratedTerminal()
    return
  }
  event.preventDefault()
  const startY = event.clientY
  const startHeight = terminalPanel.getBoundingClientRect().height
  const onMove = moveEvent => {
    const next = Math.max(160, Math.min(window.innerHeight * .72, startHeight - (moveEvent.clientY - startY)))
    document.documentElement.style.setProperty('--terminal-panel-height', `${Math.round(next)}px`)
    fitIntegratedTerminal()
  }
  const onUp = () => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
  }
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp, { once: true })
}

function officialSettingsBootstrap() {
  if (window.__HARNESS_DESKTOP_UPDATE_INSTALLED__) return
  window.__HARNESS_DESKTOP_UPDATE_INSTALLED__ = true

  const style = document.createElement('style')
  style.dataset.harnessDesktop = 'updates'
  style.textContent = `
    [role="dialog"][aria-modal="true"][data-hd-settings-layout="true"] { width:min(1120px,calc(100vw - 56px)); height:min(820px,calc(100vh - 48px)); border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 82%,transparent); background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 96%,transparent); box-shadow:0 24px 80px rgba(24,55,66,.18); }
    [data-hd-settings-layout="true"] > nav { width:216px; gap:20px; padding:24px 14px 18px; border-right:1px solid var(--dsw-alias-border-l2); background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 72%,transparent); }
    [data-hd-settings-layout="true"] > nav > :first-child { padding:0 14px 2px; font-size:18px; font-weight:650; letter-spacing:.01em; }
    [data-hd-settings-layout="true"] > nav button { min-height:42px; height:auto; border-radius:12px; padding:10px 14px; }
    [data-hd-settings-layout="true"] > nav button[aria-current="true"] { box-shadow:inset 3px 0 0 color-mix(in srgb,var(--dsw-alias-brand-primary,#178f84) 88%,transparent); }
    [data-hd-settings-layout="true"] [data-hd-settings-content="true"] { background:linear-gradient(145deg,color-mix(in srgb,var(--dsw-alias-bg-layer-2) 96%,#dff8f3 4%),var(--dsw-alias-bg-layer-2) 62%); }
    [data-hd-settings-layout="true"] [data-hd-settings-options="true"] { padding:8px 32px 32px; }
    [data-hd-settings-layout="true"] [data-slot="settings.general.item"] > * { box-sizing:border-box; margin:0 0 10px; padding:16px 18px; border:1px solid var(--dsw-alias-border-l2); border-radius:16px; background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 92%,transparent); box-shadow:0 5px 18px rgba(43,81,91,.045); }
    [data-hd-settings-layout="true"] [data-slot="settings.general.item"] > :last-child { margin-bottom:0; }
    [data-hd-settings-layout="true"] [data-slot="settings.general.item"] > * > :last-child { border-bottom:0; }
    @media (max-width:860px) {
      [role="dialog"][aria-modal="true"][data-hd-settings-layout="true"] { width:calc(100vw - 24px); height:calc(100vh - 24px); border-radius:18px; }
      [data-hd-settings-layout="true"] > nav { width:176px; padding-inline:10px; }
      [data-hd-settings-layout="true"] [data-hd-settings-options="true"] { padding:6px 18px 22px; }
    }
    #harness-desktop-version-button { position:fixed; z-index:9997; right:9px; bottom:1px; display:inline-flex; align-items:center; gap:4px; min-height:22px; border:0; border-radius:4px; padding:2px 4px; color:var(--dsw-alias-label-tertiary,#7b8494); background:transparent; box-shadow:none; font:500 12px/18px ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; cursor:pointer; opacity:.88; }
    #harness-desktop-version-button[data-pending="true"] { color:var(--dsw-alias-brand-primary,#315efb); font-weight:600; opacity:1; }
    #harness-desktop-version-button:hover { color:var(--dsw-alias-brand-primary,#315efb); background:color-mix(in srgb,var(--dsw-alias-brand-primary,#315efb) 7%,transparent); text-decoration:underline; text-underline-offset:2px; }
    #harness-desktop-version-button:focus-visible, #harness-desktop-update-center button:focus-visible { outline:2px solid var(--dsw-alias-brand-primary,#315efb); outline-offset:2px; }
    .hd-update-count[hidden] { display:none; }
    #harness-desktop-update-center { position:fixed; z-index:9998; inset:0; display:grid; place-items:center; box-sizing:border-box; padding:28px; color:var(--dsw-alias-label-primary,#20242b); background:rgba(12,20,28,.38); backdrop-filter:blur(5px); }
    #harness-desktop-update-center[hidden] { display:none; }
    .hd-update-center-dialog { display:flex; flex-direction:column; box-sizing:border-box; width:min(760px,calc(100vw - 40px)); max-height:min(760px,calc(100vh - 40px)); overflow:hidden; border:1px solid var(--dsw-alias-border-l2,#d5d9df); border-radius:18px; background:var(--dsw-alias-bg-layer-2,#f7f8fa); box-shadow:0 24px 70px rgba(0,0,0,.28); }
    .hd-update-center-head { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; padding:20px 22px 16px; border-bottom:1px solid var(--dsw-alias-border-l2,#d5d9df); background:var(--dsw-alias-bg-layer-1,#fff); }
    .hd-update-center-head h2 { margin:0; font-size:20px; line-height:1.3; }
    .hd-update-center-head p { margin:5px 0 0; color:var(--dsw-alias-label-secondary,#667085); font-size:12px; }
    .hd-update-center-head button { flex:none; width:32px; height:32px; border:0; border-radius:8px; padding:0; color:var(--dsw-alias-label-secondary,#667085); background:transparent; font-size:22px; cursor:pointer; }
    .hd-update-center-head button:hover { background:var(--dsw-alias-interactive-bg-hover,#eef1f5); }
    .hd-update-center-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:10px 16px; padding:12px 22px; border-bottom:1px solid var(--dsw-alias-border-l2,#d5d9df); background:var(--dsw-alias-bg-layer-1,#fff); }
    .hd-update-center-toolbar button, .hd-update-item-actions button { min-height:34px; border:1px solid var(--dsw-alias-border-l2,#d5d9df); border-radius:9px; padding:0 13px; color:inherit; background:var(--dsw-alias-bg-layer-2,#f7f8fa); font:inherit; font-size:12px; cursor:pointer; }
    .hd-update-center-toolbar button:hover:not(:disabled), .hd-update-item-actions button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,#eef1f5); }
    .hd-update-center-toolbar button:disabled, .hd-update-item-actions button:disabled { cursor:wait; opacity:.58; }
    .hd-update-items { display:grid; gap:12px; overflow:auto; padding:16px 22px 22px; }
    .hd-update-empty { border:1px dashed var(--dsw-alias-border-l2,#d5d9df); border-radius:12px; padding:28px 18px; color:var(--dsw-alias-label-secondary,#667085); background:var(--dsw-alias-bg-layer-1,#fff); text-align:center; font-size:13px; }
    .hd-update-item { display:grid; gap:9px; border:1px solid var(--dsw-alias-border-l2,#d5d9df); border-radius:13px; padding:14px 15px; background:var(--dsw-alias-bg-layer-1,#fff); }
    .hd-update-item[data-actionable="true"] { border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#315efb) 42%,var(--dsw-alias-border-l2,#d5d9df)); }
    .hd-update-item-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
    .hd-update-item-title { min-width:0; }
    .hd-update-item-title strong { display:block; font-size:14px; line-height:1.45; overflow-wrap:anywhere; }
    .hd-update-item-title span { display:block; margin-top:2px; color:var(--dsw-alias-label-secondary,#667085); font-size:11px; }
    .hd-update-item-badges { display:flex; flex:none; flex-wrap:wrap; justify-content:flex-end; gap:5px; }
    .hd-update-badge { border:1px solid var(--dsw-alias-border-l2,#d5d9df); border-radius:999px; padding:2px 7px; color:var(--dsw-alias-label-secondary,#667085); background:var(--dsw-alias-bg-layer-2,#f7f8fa); font-size:10px; }
    .hd-update-badge[data-signed="true"] { color:#138a57; border-color:color-mix(in srgb,#138a57 45%,transparent); }
    .hd-update-summary { margin:0; color:var(--dsw-alias-label-secondary,#667085); font-size:12px; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; }
    .hd-update-detail-block { display:grid; gap:5px; }
    .hd-update-detail-list { display:grid; gap:5px; margin:0; padding-left:18px; color:var(--dsw-alias-label-primary,#20242b); font-size:12px; line-height:1.55; }
    .hd-update-detail-list li { padding-left:2px; overflow-wrap:anywhere; }
    .hd-update-meta { display:flex; flex-wrap:wrap; gap:6px 14px; color:var(--dsw-alias-label-tertiary,#7b8494); font-size:10px; }
    .hd-update-item-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:8px; }
    .hd-update-item-actions .hd-update-apply { border-color:var(--dsw-alias-brand-primary,#315efb); color:#fff; background:var(--dsw-alias-brand-primary,#315efb); }
    @media (max-width:640px) { #harness-desktop-version-button { right:5px; bottom:1px; } #harness-desktop-update-center { padding:10px; } .hd-update-center-dialog { width:100%; max-height:100%; border-radius:14px; } .hd-update-center-head, .hd-update-center-toolbar, .hd-update-items { padding-left:14px; padding-right:14px; } .hd-update-item-head { flex-direction:column; } .hd-update-item-badges { justify-content:flex-start; } }
    @media (prefers-reduced-motion:reduce) { #harness-desktop-version-button, #harness-desktop-update-center { transition:none; } }
    #harness-desktop-mobile-sync-row { box-sizing:border-box; display:flex; align-items:center; justify-content:space-between; gap:18px; margin-top:10px; padding:16px 18px; border:1px solid var(--dsw-alias-border-l2); border-radius:16px; color:var(--dsw-alias-label-primary); background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 92%,transparent); box-shadow:0 5px 18px rgba(43,81,91,.045); }
    #harness-desktop-mobile-sync-row .hd-mobile-copy { min-width:0; }
    #harness-desktop-mobile-sync-row .hd-mobile-title { font-size:14px; line-height:22px; }
    #harness-desktop-mobile-sync-row .hd-mobile-status { overflow:hidden; margin-top:4px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; text-overflow:ellipsis; white-space:nowrap; }
    #harness-desktop-mobile-sync-row .hd-mobile-actions { display:flex; flex:none; align-items:center; gap:8px; }
    #harness-desktop-mobile-sync-row button { box-sizing:border-box; min-height:34px; border:0; border-radius:17px; padding:6px 14px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-module-platform); font:inherit; font-size:13px; cursor:pointer; }
    #harness-desktop-mobile-sync-row button:hover { background:var(--dsw-alias-interactive-bg-hover); }
    #harness-desktop-mobile-sync-row .hd-mobile-stop { color:#fff; background:#d92d20; }
    #harness-desktop-mobile-sync-row .hd-mobile-stop:hover { background:#b42318; }
    #harness-desktop-mobile-sync-row .hd-mobile-switch { position:relative; width:42px; min-width:42px; height:24px; min-height:24px; border-radius:12px; padding:0; background:var(--dsw-alias-bg-module-platform); }
    #harness-desktop-mobile-sync-row .hd-mobile-switch::after { content:''; position:absolute; left:3px; top:3px; width:18px; height:18px; border-radius:50%; background:var(--dsw-alias-label-tertiary); transition:transform .16s ease,background .16s ease; }
    #harness-desktop-mobile-sync-row .hd-mobile-switch[aria-pressed="true"] { background:var(--dsw-alias-brand-primary,#315efb); }
    #harness-desktop-mobile-sync-row .hd-mobile-switch[aria-pressed="true"]::after { background:#fff; transform:translateX(18px); }
    #harness-desktop-mobile-sync-row .hd-mobile-switch:disabled { cursor:wait; opacity:.6; }
    #harness-desktop-git-row { box-sizing:border-box; margin-top:10px; padding:16px 18px; border:1px solid var(--dsw-alias-border-l2); border-radius:16px; color:var(--dsw-alias-label-primary); background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 92%,transparent); box-shadow:0 5px 18px rgba(43,81,91,.045); }
    #harness-desktop-git-row .hd-git-compact { display:flex; align-items:center; justify-content:space-between; gap:18px; }
    #harness-desktop-git-row .hd-git-copy { min-width:0; }
    #harness-desktop-git-row .hd-git-title { font-size:14px; line-height:22px; }
    #harness-desktop-git-row .hd-git-summary { overflow:hidden; margin-top:4px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; text-overflow:ellipsis; white-space:nowrap; }
    #harness-desktop-git-row button { box-sizing:border-box; min-height:34px; border:0; border-radius:17px; padding:6px 14px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-module-platform); font:inherit; font-size:13px; cursor:pointer; }
    #harness-desktop-git-row button:hover { background:var(--dsw-alias-interactive-bg-hover); }
    #harness-desktop-git-row button:disabled { cursor:wait; opacity:.55; }
    #harness-desktop-git-row .hd-git-switch { position:relative; flex:none; width:42px; min-width:42px; height:24px; min-height:24px; border-radius:12px; padding:0; }
    #harness-desktop-git-row .hd-git-switch::after { content:''; position:absolute; left:3px; top:3px; width:18px; height:18px; border-radius:50%; background:var(--dsw-alias-label-tertiary); transition:transform .16s ease,background .16s ease; }
    #harness-desktop-git-row .hd-git-switch[aria-pressed="true"] { background:var(--dsw-alias-brand-primary,#315efb); }
    #harness-desktop-git-row .hd-git-switch[aria-pressed="true"]::after { background:#fff; transform:translateX(18px); }
    #harness-desktop-git-row .hd-git-details { margin-top:14px; border-top:1px solid var(--dsw-alias-border-l2); padding-top:14px; }
    #harness-desktop-git-row .hd-git-details[hidden] { display:none; }
    #harness-desktop-git-row .hd-git-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
    #harness-desktop-git-row .hd-git-lines { display:grid; gap:6px; }
    #harness-desktop-git-row .hd-git-line { display:flex; justify-content:space-between; gap:12px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
    #harness-desktop-git-row .hd-git-line strong { color:var(--dsw-alias-label-primary); font-weight:400; text-align:right; }
    #harness-desktop-git-row .hd-git-note { margin-top:12px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
    #harness-desktop-terminal-row { box-sizing:border-box; display:flex; align-items:center; justify-content:space-between; gap:24px; margin-top:24px; padding:8px 0; color:var(--dsw-alias-label-primary); }
    #harness-desktop-terminal-row .hd-terminal-copy { min-width:0; }
    #harness-desktop-terminal-row .hd-terminal-title { font-size:14px; line-height:22px; }
    #harness-desktop-terminal-row .hd-terminal-status { overflow:hidden; margin-top:3px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; text-overflow:ellipsis; white-space:nowrap; }
    #harness-desktop-terminal-row select { box-sizing:border-box; flex:none; min-width:184px; min-height:34px; border:1px solid var(--dsw-alias-border-l2); border-radius:7px; padding:0 32px 0 10px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); font:inherit; font-size:13px; cursor:pointer; }
    #harness-desktop-terminal-row select:disabled { cursor:not-allowed; opacity:.55; }
  `
  document.head.appendChild(style)

  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value
  }

  const request = (action, values = {}) => {
    const query = new URLSearchParams(values).toString()
    location.href = `harness-desktop://${action}/${query ? `?${query}` : ''}`
  }

  const createTextNode = (tag, className, text) => {
    const element = document.createElement(tag)
    if (className) element.className = className
    element.textContent = String(text || '')
    return element
  }

  const updateKindLabel = kind => ({ desktop: '桌面版', component: '组件', harness: '组件', pr: 'PR 预览', preview: 'PR 预览', 'pr-preview': 'PR 预览' })[kind] || '更新'
  const updateSourceLabel = source => source === 'github' ? 'GitHub 后备' : source === 'cnb' ? 'CNB 优先' : String(source || '官方来源')
  const updateStatusLabel = status => ({
    available: '可更新', ready: '已准备，等待应用', active: '当前使用中', expired: '已过期',
    disabled: '已停用', 'up-to-date': '已是最新', error: '检查失败', installing: '正在更新',
    current: '已是最新', installed: '已安装', completed: '已完成', invalid: '已失效', unavailable: '不可用'
  })[status] || '状态未知'
  const terminalUpdateStatuses = new Set(['current', 'installed', 'completed', 'expired', 'invalid', 'unavailable', 'disabled', 'up-to-date', 'active'])
  const shouldDisplayUpdateItem = item => item && !(['desktop', 'component', 'harness'].includes(item.kind) && ['up-to-date', 'disabled'].includes(item.status))

  const normalizeUpdateItem = value => {
    if (!value || typeof value !== 'object') return null
    const expiresAt = String(value.expiresAt || '').trim()
    const expires = expiresAt ? Date.parse(expiresAt) : NaN
    const expired = Number.isFinite(expires) && expires <= Date.now()
    const status = expired ? 'expired' : String(value.status || 'available').trim()
    return {
      id: String(value.id || '').trim(),
      kind: String(value.kind || 'component').trim(),
      version: String(value.version || '').trim(),
      title: String(value.title || '').trim(),
      summary: String(value.summary || '').trim(),
      details: Array.isArray(value.details) ? value.details.slice(0, 8).map(detail => String(detail || '').trim().slice(0, 600)).filter(Boolean) : [],
      source: String(value.source || '').trim(),
      signed: value.signed === true,
      actionable: value.actionable === true && !terminalUpdateStatuses.has(status),
      status,
      pr: value.pr && typeof value.pr === 'object' ? {
        number: Number.isFinite(Number(value.pr.number)) ? Number(value.pr.number) : null,
        title: String(value.pr.title || '').trim()
      } : null,
      expiresAt: expiresAt
    }
  }

  const closeUpdateCenter = () => {
    const center = document.querySelector('#harness-desktop-update-center')
    const trigger = document.querySelector('#harness-desktop-version-button')
    if (!center || center.hidden) return
    center.hidden = true
    center.setAttribute('aria-hidden', 'true')
    trigger?.setAttribute('aria-expanded', 'false')
    trigger?.focus()
  }

  const buildUpdateItem = item => {
    const card = document.createElement('article')
    card.className = 'hd-update-item'
    card.dataset.actionable = String(item.actionable)

    const head = document.createElement('div')
    head.className = 'hd-update-item-head'
    const title = document.createElement('div')
    title.className = 'hd-update-item-title'
    title.append(createTextNode('strong', '', item.title || `${updateKindLabel(item.kind)} ${item.version || ''}`.trim()))
    title.append(createTextNode('span', '', [item.version, item.pr?.number ? `PR #${item.pr.number}` : ''].filter(Boolean).join(' · ') || updateKindLabel(item.kind)))
    const badges = document.createElement('div')
    badges.className = 'hd-update-item-badges'
    badges.append(createTextNode('span', 'hd-update-badge', updateKindLabel(item.kind)))
    badges.append(createTextNode('span', 'hd-update-badge', updateSourceLabel(item.source)))
    const signed = createTextNode('span', 'hd-update-badge', item.signed ? '已签名' : '签名未确认')
    signed.dataset.signed = String(item.signed)
    badges.append(signed)
    head.append(title, badges)
    card.append(head)

    if (item.details.length) {
      const detailBlock = document.createElement('div')
      detailBlock.className = 'hd-update-detail-block'
      detailBlock.append(createTextNode('p', 'hd-update-summary', item.summary || '本次更新内容：'))
      const detailList = document.createElement('ul')
      detailList.className = 'hd-update-detail-list'
      detailList.append(...item.details.map(detail => createTextNode('li', '', detail)))
      detailBlock.append(detailList)
      card.append(detailBlock)
    } else if (item.summary) {
      card.append(createTextNode('p', 'hd-update-summary', item.summary))
    }
    const meta = document.createElement('div')
    meta.className = 'hd-update-meta'
    meta.append(createTextNode('span', '', `状态：${updateStatusLabel(item.status)}`))
    if (item.expiresAt) meta.append(createTextNode('span', '', `有效期至：${new Date(item.expiresAt).toLocaleString()}`))
    card.append(meta)

    const action = item.status === 'ready' ? 'apply' : item.status === 'available' ? 'install' : null
    if (action && item.actionable && item.signed && item.id) {
      const actions = document.createElement('div')
      actions.className = 'hd-update-item-actions'
      const apply = createTextNode('button', 'hd-update-apply', action === 'apply' ? '确认应用' : '立即更新')
      apply.type = 'button'
      apply.setAttribute('aria-label', `${action === 'apply' ? '应用' : '更新'} ${item.title || item.version || item.id}`)
      apply.addEventListener('click', () => request('update-action', { id: item.id, action }))
      actions.append(apply)
      card.append(actions)
    }
    return card
  }

  const paint = () => {
    const state = window.__HARNESS_DESKTOP_UPDATE_STATE__ || {}
    const trigger = document.querySelector('#harness-desktop-version-button')
    const center = document.querySelector('#harness-desktop-update-center')
    if (!trigger || !center) return
    const pendingCount = Math.max(0, Number.parseInt(state.pendingCount, 10) || 0)
    const displayVersion = String(state.displayVersion || state.app?.currentVersion || '当前版本')
    const versionLabel = displayVersion === '当前版本' ? displayVersion : `v${displayVersion.replace(/^v/iu, '')}`
    setText(trigger.querySelector('[data-hd-version]'), versionLabel)
    const count = trigger.querySelector('[data-hd-pending-count]')
    setText(count, `(+${pendingCount})`)
    count.hidden = pendingCount < 1
    trigger.dataset.pending = String(pendingCount > 0)
    trigger.setAttribute('aria-label', pendingCount > 0 ? `当前有效版本 ${displayVersion}，有 ${pendingCount} 项待更新` : `当前有效版本 ${displayVersion}，暂无待更新`)

    const items = Array.isArray(state.items) ? state.items.map(normalizeUpdateItem).filter(shouldDisplayUpdateItem) : []
    const list = center.querySelector('[data-hd-update-items]')
    const itemsSignature = JSON.stringify({ checking: state.checking === true, items })
    if (list.dataset.signature !== itemsSignature) {
      list.dataset.signature = itemsSignature
      list.replaceChildren(...(items.length ? items.map(buildUpdateItem) : [createTextNode('div', 'hd-update-empty', state.checking ? '正在检查可用更新…' : '当前已是最新')]))
    }
    const progress = state.installProgress
    const summary = progress?.phase === 'current'
      ? '当前桌面版已经是最新版本'
      : progress?.phase === 'ready'
        ? '更新已准备好，等待安装确认'
        : state.installError
          ? `更新失败：${state.installError}`
          : pendingCount > 0
            ? `${pendingCount} 项待处理；打开中心不会清除提醒。`
            : '桌面版、组件与 PR 候选会统一显示在这里。'
    setText(center.querySelector('[data-hd-update-summary]'), summary)
    const check = center.querySelector('[data-hd-check]')
    check.disabled = Boolean(state.checking || state.installing)
    setText(check, state.checking ? '正在检查…' : '立即检查')
    const activePreview = items.find(item => ['pr', 'preview', 'pr-preview'].includes(item.kind) && item.status === 'active') || null
    const exitPreview = center.querySelector('[data-hd-exit-preview]')
    exitPreview.hidden = !activePreview
    exitPreview.dataset.id = activePreview?.id || ''
  }

  const mountUpdateCenter = () => {
    if (typeof document.querySelectorAll !== 'function' || typeof document.body?.append !== 'function') return
    let trigger = document.querySelector('#harness-desktop-version-button')
    if (!trigger) {
      trigger = document.createElement('button')
      trigger.id = 'harness-desktop-version-button'
      trigger.type = 'button'
      trigger.setAttribute('aria-haspopup', 'dialog')
      trigger.setAttribute('aria-controls', 'harness-desktop-update-center')
      trigger.setAttribute('aria-expanded', 'false')
      const marker = createTextNode('span', 'hd-version-marker', '#')
      marker.setAttribute('aria-hidden', 'true')
      const version = createTextNode('span', '', '当前版本')
      version.dataset.hdVersion = ''
      const count = createTextNode('span', 'hd-update-count', '')
      count.dataset.hdPendingCount = ''
      count.hidden = true
      trigger.append(marker, version, count)
      document.body.append(trigger)
    }
    let center = document.querySelector('#harness-desktop-update-center')
    if (!center) {
      center = document.createElement('section')
      center.id = 'harness-desktop-update-center'
      center.hidden = true
      center.setAttribute('aria-hidden', 'true')
      center.innerHTML = `
        <div class="hd-update-center-dialog" role="dialog" aria-modal="true" aria-labelledby="harnessDesktopUpdateTitle" aria-describedby="harnessDesktopUpdateSummary">
          <header class="hd-update-center-head"><div><h2 id="harnessDesktopUpdateTitle">更新中心</h2><p id="harnessDesktopUpdateSummary" data-hd-update-summary></p></div><button type="button" data-hd-close aria-label="关闭更新中心">×</button></header>
          <div class="hd-update-center-toolbar"><button type="button" data-hd-check>立即检查</button><button type="button" data-hd-exit-preview hidden>退出当前预览</button></div>
          <div class="hd-update-items" data-hd-update-items aria-live="polite"></div>
        </div>`
      document.body.append(center)
      center.querySelector('[data-hd-close]').addEventListener('click', closeUpdateCenter)
      center.querySelector('[data-hd-check]').addEventListener('click', () => request('check-updates'))
      center.querySelector('[data-hd-exit-preview]').addEventListener('click', event => {
        const id = event.currentTarget.dataset.id || ''
        if (id) request('update-action', { id, action: 'exit' })
      })
      center.addEventListener('click', event => { if (event.target === center) closeUpdateCenter() })
    }
    if (!trigger.dataset.hdBound) {
      trigger.dataset.hdBound = 'true'
      trigger.addEventListener('click', () => {
        center.hidden = false
        center.setAttribute('aria-hidden', 'false')
        trigger.setAttribute('aria-expanded', 'true')
        center.querySelector('[data-hd-close]')?.focus()
      })
    }
    paint()
  }

  const paintGit = () => {
    const state = window.__HARNESS_DESKTOP_GIT_STATE__ || {}
    const row = document.querySelector('#harness-desktop-git-row')
    if (!row) return
    const git = state.git || {}
    const gcm = state.gcm || {}
    const github = state.github || {}
    const ssh = state.sshAgent || {}
    const preparation = state.preparation || {}
    const gitSource = git.source === 'bundled' ? '内置 MinGit' : git.source === 'system' ? '系统 Git' : '不可用'
    const ready = Boolean(git.available && gcm.available)
    const canPrepare = preparation.canPrepare === true
    setText(row.querySelector('[data-hd-git-summary]'), state.message || (github.connected ? `GitHub 已连接 · ${gitSource} 可直接使用` : ready ? `${gitSource} 已就绪，可直接在项目中使用` : canPrepare ? '开发环境尚未准备组件，可在此安全安装内置 MinGit' : '未找到可用 Git；Windows 正式包会内置 MinGit'))
    setText(row.querySelector('[data-hd-git-version]'), git.available ? `${gitSource} ${git.version || ''}`.trim() : (state.preparing ? '正在安装…' : '不可用'))
    setText(row.querySelector('[data-hd-gcm-status]'), gcm.available ? `Git Credential Manager ${gcm.version || ''} · Windows 安全凭据` : (state.preparing ? '正在安装…' : '不可用'))
    setText(row.querySelector('[data-hd-ssh-status]'), ssh.available && ssh.clientAvailable ? (ssh.running ? 'Windows OpenSSH + ssh-agent 正在运行' : 'Windows OpenSSH 已就绪，ssh-agent 尚未运行') : 'Windows OpenSSH / ssh-agent 不可用')
    const refresh = row.querySelector('[data-hd-git-refresh]')
    const authenticate = row.querySelector('[data-hd-git-auth]')
    refresh.disabled = Boolean(state.loading || state.authenticating || state.preparing)
    authenticate.disabled = Boolean(state.loading || state.authenticating || state.preparing || (!ready && !canPrepare))
    setText(refresh, state.loading ? '正在检查…' : '刷新状态')
    setText(authenticate, state.preparing ? '正在安装…' : state.authenticating ? '等待浏览器授权…' : ready ? (github.connected ? '重新连接 GitHub' : '连接 GitHub') : '安装内置 Git')
  }

  const mountGit = section => {
    if (!section || section.querySelector('#harness-desktop-git-row')) {
      paintGit()
      return
    }
    const row = document.createElement('div')
    row.id = 'harness-desktop-git-row'
    row.innerHTML = `
      <div class="hd-git-compact">
        <div class="hd-git-copy"><div class="hd-git-title">Git 与仓库连接</div><div class="hd-git-summary" data-hd-git-summary>正在检查 Git 组件…</div></div>
        <button class="hd-git-switch" type="button" role="switch" aria-pressed="false" aria-expanded="false" aria-controls="harness-desktop-git-details" aria-label="显示 Git 详情" title="显示 Git 详情" data-hd-git-toggle><span hidden>显示详情</span></button>
      </div>
      <div id="harness-desktop-git-details" class="hd-git-details" data-hd-git-details hidden>
        <div class="hd-git-lines">
          <div class="hd-git-line"><span>Git</span><strong data-hd-git-version>正在检查…</strong></div>
          <div class="hd-git-line"><span>HTTPS 凭据</span><strong data-hd-gcm-status>正在检查…</strong></div>
          <div class="hd-git-line"><span>GitHub / CNB SSH</span><strong data-hd-ssh-status>正在检查…</strong></div>
        </div>
        <div class="hd-git-note">首次 GitHub 授权会由 GCM 拉起默认浏览器，并通过短期本机回调完成登录；之后由 Windows Credential Manager 复用。授权页与凭据均由 GitHub 和 GCM 处理，Harness 不读取或显示密码、Token、Cookie、验证码或 SSH 私钥。CNB 可使用 Windows ssh-agent。</div>
        <div class="hd-git-actions"><button type="button" data-hd-git-refresh>刷新状态</button><button type="button" data-hd-git-auth>连接 GitHub</button></div>
      </div>
    `
    row.querySelector('[data-hd-git-toggle]').addEventListener('click', event => {
      const expanded = event.currentTarget.getAttribute('aria-pressed') !== 'true'
      event.currentTarget.setAttribute('aria-pressed', String(expanded))
      event.currentTarget.setAttribute('aria-expanded', String(expanded))
      event.currentTarget.setAttribute('aria-label', expanded ? '收起 Git 详情' : '显示 Git 详情')
      event.currentTarget.title = expanded ? '收起 Git 详情' : '显示 Git 详情'
      row.querySelector('[data-hd-git-details]').hidden = !expanded
    })
    row.querySelector('[data-hd-git-refresh]').addEventListener('click', () => request('refresh-git-runtime'))
    row.querySelector('[data-hd-git-auth]').addEventListener('click', () => {
      const state = window.__HARNESS_DESKTOP_GIT_STATE__ || {}
      request(state.preparation?.canPrepare ? 'prepare-git-runtime' : 'authenticate-github')
    })
    section.appendChild(row)
    paintGit()
  }

  const paintTerminal = () => {
    const state = window.__HARNESS_DESKTOP_TERMINAL_STATE__ || {}
    const row = document.querySelector('#harness-desktop-terminal-row')
    if (!row) return
    const preferences = state.preferences || {}
    const capabilities = state.capabilities || {}
    const shells = Array.isArray(capabilities.shells) ? capabilities.shells : []
    const select = row.querySelector('[data-hd-terminal-shell]')
    const signature = shells.map(shell => `${shell.id}:${shell.label}:${shell.available ? 1 : 0}`).join('|')
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature
      select.replaceChildren(...shells.map(shell => {
        const option = document.createElement('option')
        option.value = shell.id
        option.textContent = `${shell.label}${shell.available ? '' : '（不可用）'}`
        option.disabled = !shell.available
        return option
      }))
    }
    const selectedId = preferences.shellId || capabilities.defaultShellId || shells.find(shell => shell.available)?.id || ''
    if (select.value !== selectedId) select.value = selectedId
    select.disabled = capabilities.pty !== true || !shells.some(shell => shell.available)
    const status = capabilities.pty !== true
      ? '集成终端不可用，请重启 Harness Desktop 后重试。'
      : '选择要在集成终端中打开的 Shell。'
    setText(row.querySelector('[data-hd-terminal-status]'), status)
  }

  const mountTerminal = section => {
    if (!section || section.querySelector('#harness-desktop-terminal-row')) {
      paintTerminal()
      return
    }
    const row = document.createElement('div')
    row.id = 'harness-desktop-terminal-row'
    row.innerHTML = `
      <div class="hd-terminal-copy">
        <div class="hd-terminal-title">集成终端 Shell</div>
        <div class="hd-terminal-status" data-hd-terminal-status>正在检查本机 Shell…</div>
      </div>
      <select data-hd-terminal-shell aria-label="集成终端 Shell" disabled></select>
    `
    row.querySelector('[data-hd-terminal-shell]').addEventListener('change', event => {
      event.currentTarget.disabled = true
      request('terminal-shell', { shellId: event.currentTarget.value })
    })
    section.appendChild(row)
    paintTerminal()
  }

  const paintMobile = () => {
    const state = window.__HARNESS_DESKTOP_MOBILE_SYNC_STATE__ || {}
    const row = document.querySelector('#harness-desktop-mobile-sync-row')
    if (!row) return
    const enabled = Boolean(state.enabled && state.running)
    const devices = Array.isArray(state.devices) ? state.devices.length : 0
    const remote = state.remote || {}
    const controlDevices = Array.isArray(state.control?.devices) ? state.control.devices : []
    const controlReady = controlDevices.filter(device => device.ready).length
    const controlActive = controlDevices.some(device => device.enabled || device.queued > 0)
    const nativeAdapter = (Array.isArray(remote.adapters) ? remote.adapters : []).find(adapter => adapter?.id === 'native-p2p')
    const remoteLabel = remote.active === 'native-p2p'
      ? nativeAdapter?.path === 'direct'
        ? '原生 P2P 直连'
        : nativeAdapter?.path === 'negotiating'
          ? 'WSS/443（P2P 协商中）'
          : 'WSS/443 加密中继'
      : remote.active === 'wss-relay' ? 'WSS/443' : remote.active === 'easytier' ? 'EasyTier' : remote.active === 'tailscale' ? 'Tailscale' : ''
    const detail = enabled
      ? remote.status === 'connected'
        ? `${devices} 台设备 · ${remoteLabel || '远程通道'}已连接${controlReady ? ` · ${controlReady} 台控制就绪` : ''}`
        : `${devices} 台设备 · 局域网可用${remote.enabled === false ? '' : '，远程通道准备中'}${controlReady ? ` · ${controlReady} 台控制就绪` : ''}`
      : `${devices} 台已配对设备 · 当前已关闭`
    setText(row.querySelector('[data-hd-mobile-status]'), detail)
    const toggle = row.querySelector('[data-hd-mobile-toggle]')
    toggle.setAttribute('aria-pressed', String(enabled))
    toggle.setAttribute('aria-label', enabled ? '关闭手机同步' : '开启手机同步')
    toggle.title = enabled ? '关闭手机同步' : '开启手机同步'
    toggle.disabled = Boolean(state.changing)
    const stop = row.querySelector('[data-hd-mobile-stop]')
    stop.hidden = !controlActive
    stop.disabled = Boolean(state.controlStopping)
  }

  const mountMobile = section => {
    if (!section || section.querySelector('#harness-desktop-mobile-sync-row')) {
      paintMobile()
      return
    }
    const row = document.createElement('div')
    row.id = 'harness-desktop-mobile-sync-row'
    row.innerHTML = `
      <div class="hd-mobile-copy">
        <div class="hd-mobile-title">手机与远程同步</div>
        <div class="hd-mobile-status" data-hd-mobile-status>首次扫码配对，之后自动连接</div>
      </div>
      <div class="hd-mobile-actions">
        <button class="hd-mobile-stop" type="button" data-hd-mobile-stop hidden>立即停止控制</button>
        <button type="button" data-hd-mobile-manage>管理设备</button>
        <button class="hd-mobile-switch" type="button" role="switch" aria-pressed="false" data-hd-mobile-toggle><span hidden>开关</span></button>
      </div>
    `
    row.querySelector('[data-hd-mobile-manage]').addEventListener('click', () => request('open-mobile-sync'))
    row.querySelector('[data-hd-mobile-stop]').addEventListener('click', () => request('mobile-control-stop'))
    row.querySelector('[data-hd-mobile-toggle]').addEventListener('click', event => {
      const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true'
      event.currentTarget.disabled = true
      request('mobile-sync-toggle', { enabled: enabled ? '1' : '0' })
    })
    section.appendChild(row)
    paintMobile()
  }

  const mount = () => {
    mountUpdateCenter()
    const dialogs = typeof document.querySelectorAll === 'function'
      ? [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      : [document.querySelector('[role="dialog"][aria-modal="true"]')]
    const dialog = dialogs.find(candidate => candidate && candidate.id !== 'harness-desktop-update-center' && (typeof candidate.closest !== 'function' || !candidate.closest('#harness-desktop-update-center')))
    if (!dialog) return
    const settingsNav = dialog.querySelector(':scope > nav')
    const general = settingsNav
      ? [...settingsNav.querySelectorAll('button')].find(button => /通用设置|General/i.test(button.textContent || ''))
      : null
    if (!settingsNav || !general) return
    const content = dialog.querySelector(':scope > nav + div')
    if (!content) return
    const options = content?.lastElementChild
    dialog.dataset.hdSettingsLayout = 'true'
    settingsNav.dataset.hdSettingsNav = 'true'
    content.dataset.hdSettingsContent = 'true'
    if (options) options.dataset.hdSettingsOptions = 'true'
    const configButton = [...dialog.querySelectorAll('button')].find(button => /打开配置文件|Open configuration file/i.test(button.textContent || ''))
    if (configButton && !configButton.dataset.hdDesktopOpen) {
      configButton.dataset.hdDesktopOpen = 'true'
      configButton.addEventListener('click', event => {
        event.preventDefault()
        event.stopImmediatePropagation()
        request('open-config-file')
      }, true)
    }
    if (general.getAttribute('aria-current') !== 'true') return
    const slot = dialog.querySelector('[data-slot="settings.general.item"]')
    const section = slot?.parentElement || options?.firstElementChild || options
    mountTerminal(section)
    mountGit(section)
    mountMobile(section)
    paint()
  }

  window.__HARNESS_DESKTOP_RENDER_UPDATES__ = () => {
    mount()
    paint()
    paintTerminal()
    paintGit()
    paintMobile()
  }
  window.__HARNESS_DESKTOP_RENDER_TERMINAL__ = () => {
    mount()
    paintTerminal()
  }
  window.__HARNESS_DESKTOP_RENDER_GIT__ = () => {
    mount()
    paintGit()
  }
  window.__HARNESS_DESKTOP_RENDER_MOBILE_SYNC__ = () => {
    mount()
    paintMobile()
  }
  let mountScheduled = false
  const scheduleMount = () => {
    if (mountScheduled) return
    mountScheduled = true
    setTimeout(() => {
      mountScheduled = false
      mount()
    }, 80)
  }
  new MutationObserver(scheduleMount).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] })
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeUpdateCenter()
    })
  }
  mount()
}

function officialSubagentEnhancementsBootstrap() {
  if (window.__HARNESS_DESKTOP_SUBAGENT_ENHANCEMENTS__) return
  window.__HARNESS_DESKTOP_SUBAGENT_ENHANCEMENTS__ = true

  const style = document.createElement('style')
  style.dataset.harnessDesktop = 'subagent-enhancements'
  style.textContent = `
    .hd-subagent-panel { box-sizing:border-box!important; width:min(680px,calc(100vw - 32px))!important; min-width:min(680px,calc(100vw - 32px))!important; max-width:calc(100vw - 32px)!important; max-height:min(78vh,820px)!important; overflow:auto!important; }
    [data-hd-subagent-trigger] { position:relative!important; z-index:1!important; min-height:34px!important; cursor:pointer!important; pointer-events:auto!important; }
    .hd-subagent-panel [data-hd-subagent-row] { position:relative!important; box-sizing:border-box!important; min-height:58px!important; padding:8px 128px 8px 38px!important; cursor:pointer!important; pointer-events:auto!important; }
    .hd-subagent-panel [data-hd-subagent-row]:hover { background:color-mix(in srgb,var(--dsw-alias-brand-primary,#6f8cff) 10%,transparent)!important; }
    .hd-subagent-open-detail { position:absolute; right:12px; top:50%; max-width:108px; overflow:hidden; color:var(--dsw-alias-brand-primary,#5877ef); font-size:12px; font-weight:600; white-space:nowrap; text-overflow:ellipsis; transform:translateY(-50%); pointer-events:none; }
    .hd-subagent-running-indicator { position:absolute; left:12px; top:50%; display:flex; align-items:center; gap:2px; width:16px; height:18px; transform:translateY(-50%); pointer-events:none; }
    .hd-subagent-running-indicator i { display:block; width:3px; height:9px; border-radius:2px; background:var(--dsw-alias-brand-primary,#6f8cff); animation:hd-subagent-running 1s ease-in-out infinite; }
    .hd-subagent-running-indicator i:nth-child(2) { animation-delay:.14s; }
    .hd-subagent-running-indicator i:nth-child(3) { animation-delay:.28s; }
    .hd-subagent-detail-label { display:inline-flex; align-items:center; gap:6px; min-height:24px; margin-left:10px; padding:0 9px; border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#6f8cff) 28%,transparent); border-radius:999px; background:color-mix(in srgb,var(--dsw-alias-brand-primary,#6f8cff) 8%,transparent); color:var(--dsw-alias-brand-primary,#5877ef); font-size:12px; font-weight:600; white-space:nowrap; }
    .hd-subagent-detail-label::before { width:7px; height:7px; border-radius:50%; background:#22b573; box-shadow:0 0 0 3px color-mix(in srgb,#22b573 16%,transparent); content:''; }
    .hd-subagent-detail-label.hd-subagent-detail-history { border-color:var(--dsw-alias-border-l2,#ccd2d9); background:var(--dsw-alias-bg-layer-2,#f4f6f8); color:var(--dsw-alias-label-secondary,#5f6b76); }
    .hd-subagent-detail-label.hd-subagent-detail-history::before { background:#89939e; box-shadow:none; }
    @keyframes hd-subagent-running { 0%,100%{height:5px;opacity:.42} 50%{height:15px;opacity:1} }
    @media (prefers-reduced-motion:reduce) { .hd-subagent-running-indicator i { animation:none; height:9px; opacity:.85; } }
  `
  document.head.appendChild(style)

  const visible = element => {
    if (!(element instanceof HTMLElement)) return false
    const rect = element.getBoundingClientRect()
    const computed = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && computed.display !== 'none' && computed.visibility !== 'hidden'
  }

  const isGreen = value => {
    const match = String(value || '').match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
    if (!match) return false
    const [, red, green, blue] = match.map(Number)
    return green >= 100 && green > red * 1.25 && green > blue * 1.08
  }

  const hasRunningSignal = row => {
    if (/运行中|正在|working|running|executing/i.test(row.textContent || '')) return true
    return [...row.querySelectorAll('*')].some(element => {
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.width > 18 || rect.height < 2 || rect.height > 18) return false
      const computed = getComputedStyle(element)
      return isGreen(computed.backgroundColor) || isGreen(computed.color) || isGreen(computed.fill)
    })
  }

  const rowForToken = (node, panel) => {
    let row = node.closest('button,[role="treeitem"],[role="menuitem"],[role="option"],li')
    if (row && panel.contains(row)) return row
    row = node.parentElement
    while (row && row !== panel) {
      const rect = row.getBoundingClientRect()
      if (rect.width >= 220 && rect.height >= 34 && rect.height <= 110) return row
      row = row.parentElement
    }
    return null
  }

  const markPanel = panel => {
    if (!visible(panel)) return
    const tokenNodes = [...panel.querySelectorAll('*')].filter(element => {
      if (element.children.length) return false
      return /\b\d+(?:\.\d+)?\s*[KMG]?\s*tok\b/i.test(element.textContent || '')
    })
    if (!tokenNodes.length) return
    panel.classList.add('hd-subagent-panel')
    if (panel.parentElement?.matches('[data-radix-popper-content-wrapper]')) {
      panel.parentElement.style.setProperty('max-width', 'calc(100vw - 16px)')
    }
    const rows = new Set(tokenNodes.map(node => rowForToken(node, panel)).filter(Boolean))
    rows.forEach(row => {
      row.dataset.hdSubagentRow = 'true'
      if (!row.querySelector(':scope > .hd-subagent-open-detail')) {
        const affordance = document.createElement('span')
        affordance.className = 'hd-subagent-open-detail'
        affordance.textContent = '打开运行详情 →'
        row.append(affordance)
      }
      const marker = row.querySelector(':scope > .hd-subagent-running-indicator')
      if (!hasRunningSignal(row)) {
        marker?.remove()
        return
      }
      if (marker) return
      const indicator = document.createElement('span')
      indicator.className = 'hd-subagent-running-indicator'
      indicator.setAttribute('aria-label', '正在运行')
      indicator.innerHTML = '<i></i><i></i><i></i>'
      row.prepend(indicator)
    })
  }

  const markDetailPage = () => {
    const hierarchy = document.querySelector('nav[aria-label="会话层级"]')
    if (!hierarchy) return
    const buttons = hierarchy.querySelectorAll('button')
    const existing = hierarchy.parentElement?.querySelector(':scope > .hd-subagent-detail-label')
    if (buttons.length < 2) {
      existing?.remove()
      return
    }
    const historyRecord = [...document.querySelectorAll('strong')].some(element => /一次性子代理记录|One-shot subagent record/i.test(element.textContent || ''))
    const label = existing || document.createElement('span')
    label.className = `hd-subagent-detail-label${historyRecord ? ' hd-subagent-detail-history' : ''}`
    label.textContent = historyRecord ? '子代理历史 · 完整记录' : '子代理会话 · 可继续'
    label.title = historyRecord
      ? '这里保留一次性子代理的完整执行记录；点击左侧上级会话可返回。'
      : '这里显示可继续子代理的会话；点击左侧上级会话可返回。'
    if (!existing) hierarchy.insertAdjacentElement('afterend', label)
  }

  const scan = () => {
    document.querySelectorAll('button').forEach(button => {
      if (!/\d+\s*个子代理|\d+\s*subagents?/i.test(button.textContent || '')) return
      button.dataset.hdSubagentTrigger = 'true'
      button.title = '查看子代理运行详情'
      if (button.dataset.hdSubagentBound) return
      button.dataset.hdSubagentBound = 'true'
      button.addEventListener('click', () => [0, 60, 180].forEach(delay => setTimeout(scan, delay)))
    })

    const candidates = [...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],[data-radix-popper-content-wrapper] > *,body > div')]
      .filter(visible)
      .filter(element => {
        const rect = element.getBoundingClientRect()
        if (rect.width > innerWidth * .94 && rect.height > innerHeight * .9) return false
        const text = element.textContent || ''
        return (text.match(/\btok\b/gi) || []).length >= 1
      })
      .sort((left, right) => {
        const a = left.getBoundingClientRect()
        const b = right.getBoundingClientRect()
        return a.width * a.height - b.width * b.height
      })
    if (candidates[0]) markPanel(candidates[0])
    markDetailPage()
  }

  let timer = null
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(scan, 70)
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  addEventListener('resize', schedule)
  scan()
}

function showPrPreviewNotice(candidate) {
  if (!candidate) return false
  pendingUpdateKind = 'preview'
  pendingComponentUpdate = null
  prPreviewState = { ...prPreviewState, available: true, candidate }
  return true
}

async function refreshPrPreviewState({ discover = false } = {}) {
  try {
    const base = await api.getPrPreviewUpdateState()
    prPreviewState = { ...prPreviewState, ...base, checking: false, changing: false, error: '' }
    updateState = {
      ...updateState,
      preferences: { ...(updateState.preferences || {}), previewEnabled: base.enabled === true }
    }
    if (!base.enabled || (!base.configured && !base.ready)) {
      await publishUpdateState()
      return prPreviewState
    }
    if (!discover) {
      if (base.candidate) showPrPreviewNotice(base.candidate)
      await publishUpdateState()
      return prPreviewState
    }
    prPreviewState = { ...prPreviewState, checking: true, available: false, candidate: null }
    await publishUpdateState()
    const result = await api.checkPrPreviewUpdates()
    prPreviewState = { ...prPreviewState, ...result, checking: false, available: result.available === true, candidate: result.candidate || null, error: '' }
    if (result.available && result.candidate) showPrPreviewNotice(result.candidate)
    if (typeof api.getUnifiedUpdateState === 'function') {
      try {
        updateState = { ...updateState, ...(await api.getUnifiedUpdateState()) }
      } catch (error) {
        updateState = { ...updateState, installError: error.message || String(error) }
      }
    }
  } catch (error) {
    prPreviewState = { ...prPreviewState, checking: false, available: false, candidate: null, error: error.message }
  }
  await publishUpdateState()
  return prPreviewState
}

async function setPrPreviewChannelEnabled(enabled) {
  prPreviewState = { ...prPreviewState, changing: true, error: '' }
  await publishUpdateState()
  try {
    const result = await api.setPrPreviewUpdatesEnabled(enabled === true)
    prPreviewState = { ...prPreviewState, ...result, enabled: enabled === true, changing: false, available: false, candidate: null }
    updateState = {
      ...updateState,
      preferences: { ...(updateState.preferences || {}), previewEnabled: enabled === true }
    }
    if (enabled) {
      await refreshPrPreviewState({ discover: true })
    } else {
      if (pendingUpdateKind === 'preview') {
        closeUpdateNotice()
        pendingUpdateKind = 'installer'
      }
      if (typeof api.getUnifiedUpdateState === 'function') {
        updateState = { ...updateState, ...(await api.getUnifiedUpdateState()) }
      }
    }
  } catch (error) {
    prPreviewState = { ...prPreviewState, changing: false, error: error.message }
  }
  await publishUpdateState()
  return prPreviewState
}

async function publishUpdateState() {
  if (!runtimeView.getURL()) return
  const serialized = JSON.stringify({ ...updateState, preview: prPreviewState }).replaceAll('<', '\\u003c')
  await runtimeView.executeJavaScript(`window.__HARNESS_DESKTOP_UPDATE_STATE__ = ${serialized}; window.__HARNESS_DESKTOP_RENDER_UPDATES__?.();`, true).catch(() => {})
}

async function publishGitRuntimeState() {
  if (!runtimeView.getURL()) return
  const serialized = JSON.stringify(gitRuntimeState).replaceAll('<', '\\u003c')
  await runtimeView.executeJavaScript(`window.__HARNESS_DESKTOP_GIT_STATE__ = ${serialized}; window.__HARNESS_DESKTOP_RENDER_GIT__?.();`, true).catch(() => {})
}

async function publishTerminalSettingsState() {
  if (!runtimeView.getURL()) return
  const serialized = JSON.stringify({ preferences: terminalPreferences, capabilities: terminalCapabilities }).replaceAll('<', '\\u003c')
  await runtimeView.executeJavaScript(`window.__HARNESS_DESKTOP_TERMINAL_STATE__ = ${serialized}; window.__HARNESS_DESKTOP_RENDER_TERMINAL__?.();`, true).catch(() => {})
}

async function refreshGitRuntimeStatus() {
  gitRuntimeState = { ...gitRuntimeState, loading: true, message: '' }
  await publishGitRuntimeState()
  try {
    const status = await api.refreshGitRuntimeStatus()
    gitRuntimeState = { ...gitRuntimeState, ...status, loading: false, message: '' }
  } catch (error) {
    gitRuntimeState = { ...gitRuntimeState, loading: false, message: `Git 状态检查失败：${error.message}` }
  }
  await publishGitRuntimeState()
}

async function publishMobileSyncState() {
  if (!runtimeView.getURL()) return
  const serialized = JSON.stringify(mobileSyncState).replaceAll('<', '\\u003c')
  await runtimeView.executeJavaScript(`window.__HARNESS_DESKTOP_MOBILE_SYNC_STATE__ = ${serialized}; window.__HARNESS_DESKTOP_RENDER_MOBILE_SYNC__?.();`, true).catch(() => {})
}

async function publishComputerUsePluginState() {
  if (!runtimeView.getURL()) return
  const serialized = JSON.stringify(computerUsePluginState).replaceAll('<', '\\u003c')
  await runtimeView.executeJavaScript(`(() => { const snapshot = ${serialized}; window.__HARNESS_DESKTOP_COMPUTER_USE_STATE__ = snapshot; window.dispatchEvent(new CustomEvent('harness-desktop:computer-use-state', { detail: snapshot })); })();`, true).catch(() => {})
}

async function refreshComputerUsePluginState({ notice = '', loading = false } = {}) {
  if (computerUsePluginMutationPending) return computerUsePluginState
  if (loading) {
    computerUsePluginState = { ...computerUsePluginState, loading: true, notice: '', error: '' }
    await publishComputerUsePluginState()
  }
  try {
    const session = await api.getComputerUseState()
    if (computerUsePluginMutationPending) return computerUsePluginState
    computerUsePluginState = { loading: false, notice, error: '', session }
  } catch (error) {
    if (computerUsePluginMutationPending) return computerUsePluginState
    computerUsePluginState = { ...computerUsePluginState, loading: false, notice: '', error: error.message || String(error) }
  }
  await publishComputerUsePluginState()
  return computerUsePluginState
}

async function mutateComputerUsePluginState(operation, notice) {
  if (computerUsePluginMutationPending) return computerUsePluginState
  computerUsePluginMutationPending = true
  computerUsePluginState = { ...computerUsePluginState, loading: true, notice: '', error: '' }
  await publishComputerUsePluginState()
  try {
    const session = await operation()
    computerUsePluginState = { loading: false, notice: typeof notice === 'function' ? notice(session) : notice, error: '', session }
  } catch (error) {
    computerUsePluginState = { ...computerUsePluginState, loading: false, notice: '', error: error.message || String(error) }
  } finally {
    computerUsePluginMutationPending = false
  }
  await publishComputerUsePluginState()
  return computerUsePluginState
}

async function publishAppearanceState() {
  applyShellTheme()
  applyShellUiMode()
  await themeIntegration.publish(runtimeView, appearanceState, themeCatalog).catch(() => {})
}

async function publishModelRoutingState() {
  await modelRoutingIntegration.publish(runtimeView, modelRoutingState).catch(() => {})
}

async function checkUpdates() {
  updateState = { ...updateState, checking: true, installError: '' }
  await publishUpdateState()
  try {
    const result = typeof api.checkUnifiedUpdates === 'function'
      ? await api.checkUnifiedUpdates()
      : await api.checkUpdates()
    updateState = { ...updateState, ...result, checking: false, installError: '' }
    pendingUpdateKind = 'installer'
    pendingComponentUpdate = null
  } catch (error) {
    updateState = { ...updateState, checking: false, app: { error: error.message }, harness: updateState.harness }
  }
  await publishUpdateState()
  if (prPreviewState.enabled && (prPreviewState.configured || prPreviewState.ready)) await refreshPrPreviewState({ discover: true })
}

async function runUnifiedUpdateAction(id, action) {
  const allowedActions = new Set(['check', 'install', 'apply', 'exit', 'settings'])
  const safeId = String(id || '').trim()
  if (!safeId || !allowedActions.has(action) || typeof api.runUnifiedUpdateAction !== 'function') return
  const busy = ['install', 'apply'].includes(action)
  if (busy) updateState = { ...updateState, installing: true, installError: '' }
  await publishUpdateState()
  try {
    const result = await api.runUnifiedUpdateAction(safeId, action)
    if (result && typeof result === 'object') updateState = { ...updateState, ...result }
    if (typeof api.getUnifiedUpdateState === 'function') updateState = { ...updateState, ...(await api.getUnifiedUpdateState()) }
    updateState = { ...updateState, installing: false, installError: '' }
  } catch (error) {
    updateState = { ...updateState, installing: false, installError: error.message || String(error) }
  }
  await publishUpdateState()
}

async function installUpdate({ kind = '', id = '' } = {}) {
  const normalizedKind = String(kind || '').toLowerCase()
  if (['pr', 'preview'].includes(normalizedKind)) pendingUpdateKind = 'preview'
  else if (['component', 'components', 'harness'].includes(normalizedKind)) pendingUpdateKind = 'components'
  else if (normalizedKind) pendingUpdateKind = 'installer'
  updateState = { ...updateState, installing: true, installError: '', installProgress: { phase: 'checksum', kind: normalizedKind, id } }
  await publishUpdateState()
  try {
    const preview = pendingUpdateKind === 'preview'
    const component = pendingUpdateKind === 'components'
    if (preview) {
      await api.applyPrPreviewUpdate({ id })
      updateState = { ...updateState, installing: false, installError: '', installProgress: null }
      await refreshPrPreviewState()
      await publishUpdateState()
      return
    }
    const result = component ? await api.stageComponentUpdates() : await api.installUpdate()
    const ready = component ? result?.state?.phase === 'ready' : result?.ready
    const version = component ? result?.state?.pending?.releaseVersion || pendingComponentUpdate?.lastCheck?.releaseVersion : result?.version
    if (!component && result?.upToDate) {
      updateState = { ...updateState, installing: false, installError: '', installProgress: { phase: 'current', version } }
      await publishUpdateState()
      return
    }
    if (ready) {
      updateState = { ...updateState, installing: false, installError: '', installProgress: { phase: 'ready', version } }
      await publishUpdateState()
      showUpdateReady(version, component ? 'components' : 'installer')
      return
    }
    updateState = { ...updateState, installing: false, installError: '', installProgress: null }
    await publishUpdateState()
  } catch (error) {
    updateState = { ...updateState, installing: false, installError: error.message, installProgress: null }
    await publishUpdateState()
  }
}

runtimeView.addEventListener('dom-ready', async () => {
  await runtimeView.executeJavaScript(`(${officialSettingsBootstrap.toString()})()`, true).catch(() => {})
  await runtimeView.executeJavaScript(`(${officialSubagentEnhancementsBootstrap.toString()})()`, true).catch(() => {})
  await themeIntegration.install(runtimeView).catch(() => {})
  await modelRoutingIntegration.install(runtimeView).catch(() => {})
  await workspaceLinksIntegration.install(runtimeView).catch(() => {})
  await publishUpdateState()
  await publishTerminalSettingsState()
  await publishGitRuntimeState()
  await publishMobileSyncState()
  await publishComputerUsePluginState()
  await publishAppearanceState()
  await publishModelRoutingState()
  startupWebviewReady = true
})

runtimeView.addEventListener('will-navigate', event => {
  if (event.isMainFrame === false) return
  let target
  try { target = new URL(event.url) } catch { return }
  if (target.protocol !== 'harness-desktop:') return
  event.preventDefault()
  if (target.hostname === 'check-updates') {
    checkUpdates()
  } else if (target.hostname === 'update-action') {
    const id = target.searchParams.get('id') || ''
    const action = target.searchParams.get('action') || ''
    runUnifiedUpdateAction(id, action)
  } else if (target.hostname === 'install-update') {
    installUpdate({ kind: target.searchParams.get('kind') || '', id: target.searchParams.get('id') || '' })
  } else if (target.hostname === 'auto-check') {
    const enabled = target.searchParams.get('enabled') !== '0'
    api.setUpdatePreferences({ checkOnStartup: enabled }).then(preferences => {
      updateState = { ...updateState, preferences }
      publishUpdateState()
    })
  } else if (target.hostname === 'terminal-shell') {
    const shellId = target.searchParams.get('shellId') || ''
    api.setTerminalPreferences({ shellId }).then(preferences => {
      terminalPreferences = { ...terminalPreferences, ...preferences }
      updateTerminalControls()
      publishTerminalSettingsState()
    }).catch(error => {
      showTerminalStatus(`Shell 设置失败：${error.message}`, true)
      publishTerminalSettingsState()
    })
  } else if (target.hostname === 'preview-updates-toggle') {
    const enabled = target.searchParams.get('enabled') !== '0'
    setPrPreviewChannelEnabled(enabled)
  } else if (target.hostname === 'open-release') {
    const url = target.searchParams.get('url')
    if (url) api.openLink(url).catch(() => {})
  } else if (target.hostname === 'open-external') {
    const url = target.searchParams.get('url')
    if (url) api.openLink(url).catch(() => {})
  } else if (target.hostname === 'copy-session-id') {
    const value = target.searchParams.get('value')
    if (value) api.copyText(value).catch(() => {})
  } else if (target.hostname === 'open-session-window') {
    const sessionId = target.searchParams.get('sessionId')
    if (sessionId) api.openSessionWindow(sessionId).catch(() => {})
  } else if (target.hostname === 'preview-local') {
    const localPath = target.searchParams.get('path')
    if (localPath && window.harnessDesktopRightWorkspace?.openLocalDocument) window.harnessDesktopRightWorkspace.openLocalDocument(localPath)
    else if (localPath) api.openLocal(localPath).catch(() => {})
  } else if (target.hostname === 'open-local') {
    const localPath = target.searchParams.get('path')
    const reveal = target.searchParams.get('reveal') === '1'
    if (localPath) api.openLocal(localPath, { reveal }).catch(() => {})
  } else if (target.hostname === 'open-config-file') {
    api.openHarnessSettings().catch(() => {})
  } else if (target.hostname === 'refresh-git-runtime') {
    refreshGitRuntimeStatus()
  } else if (target.hostname === 'prepare-git-runtime') {
    gitRuntimeState = { ...gitRuntimeState, preparing: true, message: '正在下载并校验官方 MinGit 与 Git Credential Manager…' }
    publishGitRuntimeState()
    api.prepareGitRuntime().then(status => {
      gitRuntimeState = { ...gitRuntimeState, ...status, preparing: false, loading: false, message: '内置 Git 已准备完成；重启 Harness Desktop 后任务进程即可直接使用。' }
      publishGitRuntimeState()
    }).catch(error => {
      gitRuntimeState = { ...gitRuntimeState, preparing: false, message: `内置 Git 安装失败：${error.message}` }
      publishGitRuntimeState()
    })
  } else if (target.hostname === 'authenticate-github') {
    if (gitRuntimeState.authenticating) return
    gitRuntimeState = { ...gitRuntimeState, authenticating: true, message: '正在打开由你亲自操作的 GitHub 登录…' }
    publishGitRuntimeState()
    api.openGitAuthentication('github').then(async result => {
      if (result?.connected) {
        const status = await api.refreshGitRuntimeStatus()
        gitRuntimeState = { ...gitRuntimeState, ...status, authenticating: false, loading: false, message: 'GitHub 授权完成，连接状态已自动刷新。' }
      } else {
        gitRuntimeState = {
          ...gitRuntimeState,
          authenticating: false,
          message: result?.started ? 'GitHub 授权未完成或未写入 Windows 凭据，请重试。' : '未能启动 GitHub 登录，请刷新状态后重试。'
        }
      }
      await publishGitRuntimeState()
    }).catch(error => {
      gitRuntimeState = { ...gitRuntimeState, authenticating: false, message: `GitHub 登录启动失败：${error.message}` }
      publishGitRuntimeState()
    })
  } else if (target.hostname === 'computer-use-refresh') {
    refreshComputerUsePluginState({ notice: 'refreshed', loading: true })
  } else if (target.hostname === 'computer-use-status') {
    refreshComputerUsePluginState()
  } else if (target.hostname === 'computer-use-toggle') {
    const enabled = target.searchParams.get('enabled') !== '0'
    mutateComputerUsePluginState(
      () => api.setComputerUseEnabled(enabled),
      session => enabled ? (session?.authorization?.scope === 'none' ? 'requested' : 'resumed') : 'stopped'
    )
  } else if (target.hostname === 'computer-use-revoke-permanent') {
    mutateComputerUsePluginState(() => api.revokeComputerUsePermanentGrant(), 'revoked')
  } else if (target.hostname === 'open-mobile-sync') {
    openMobileSync()
  } else if (target.hostname === 'open-appearance') {
    openSkinPicker({ fromSettings: target.searchParams.get('source') === 'settings' })
  } else if (target.hostname === 'open-model-routing') {
    openModelRouting()
  } else if (target.hostname === 'mobile-control-stop') {
    api.stopMobileControl(null).then(result => {
      renderMobileSync({ control: result.state })
      publishMobileSyncState()
    }).catch(error => { mobileSyncError.textContent = error.message })
  } else if (target.hostname === 'mobile-sync-toggle') {
    const enabled = target.searchParams.get('enabled') !== '0'
    api.setMobileSyncEnabled(enabled).then(state => {
      renderMobileSync(state)
      publishMobileSyncState()
    }).catch(error => {
      mobileSyncError.textContent = error.message
      publishMobileSyncState()
    })
  } else if (target.hostname === 'refresh-model-routing') {
    modelRoutingState = { ...modelRoutingState, meters: { ...(modelRoutingState.meters || {}), loading: true, error: '' } }
    publishModelRoutingState()
    Promise.all([api.getModelRouting(), api.getProviderMeters(false)]).then(([state, meters]) => {
      modelRoutingState = { ...state, meters: { ...meters, loading: false, error: '' }, saving: false, saved: false, error: '' }
      publishModelRoutingState()
    }).catch(error => {
      modelRoutingState = { ...modelRoutingState, meters: { ...(modelRoutingState.meters || {}), loading: false, error: error.message }, saving: false, saved: false, error: error.message }
      publishModelRoutingState()
    })
  } else if (target.hostname === 'refresh-provider-meters') {
    modelRoutingState = { ...modelRoutingState, meters: { ...(modelRoutingState.meters || {}), loading: true, error: '' } }
    publishModelRoutingState()
    api.getProviderMeters(true).then(meters => {
      modelRoutingState = { ...modelRoutingState, meters: { ...meters, loading: false, error: '' } }
      publishModelRoutingState()
    }).catch(error => {
      modelRoutingState = { ...modelRoutingState, meters: { ...(modelRoutingState.meters || {}), loading: false, error: error.message } }
      publishModelRoutingState()
    })
  } else if (target.hostname === 'save-model-routing') {
    modelRoutingState = { ...modelRoutingState, saving: true, saved: false, error: '' }
    publishModelRoutingState()
    api.saveModelRouting(window.harnessModelRoutingIntegration.createModelRoutingSavePayload({
      mainProvider: target.searchParams.get('mainProvider'),
      mainModel: target.searchParams.get('mainModel'),
      subInherit: target.searchParams.get('subInherit') !== '0',
      subProvider: target.searchParams.get('subProvider'),
      subModel: target.searchParams.get('subModel'),
      basePreset: modelRoutingState.basePreset
    })).then(state => {
      modelRoutingState = { ...state, meters: modelRoutingState.meters, saving: false, saved: true, error: '' }
      publishModelRoutingState()
    }).catch(error => {
      modelRoutingState = { ...modelRoutingState, saving: false, saved: false, error: error.message }
      publishModelRoutingState()
    })
  } else if (target.hostname === 'restore-appearance') {
    api.setTheme('official').then(() => api.setUiPreferences({ uiMode: 'official', reducedMotion: false, lowPerformance: false })).then(state => {
      appearanceState = state
      publishAppearanceState()
    })
  } else if (target.hostname === 'set-theme') {
    api.setTheme(target.searchParams.get('id') || 'official').then(state => {
      appearanceState = state
      publishAppearanceState()
    })
  } else if (target.hostname === 'set-ui-preferences') {
    api.setUiPreferences({
      uiMode: target.searchParams.get('uiMode') || appearanceState.uiMode || 'official',
      reducedMotion: target.searchParams.get('reducedMotion') === '1',
      lowPerformance: target.searchParams.get('lowPerformance') === '1'
    }).then(state => {
      appearanceState = state
      publishAppearanceState()
    })
  } else if (target.hostname === 'save-custom-theme') {
    const fields = ['mode', 'accent', 'surface', 'text', 'wallpaperBrightness', 'wallpaperBlur', 'glassTransparency', 'borderStrength', 'readabilityStrength']
    api.saveCustomTheme(Object.fromEntries(fields.map(name => [name, target.searchParams.get(name)]))).then(state => {
      appearanceState = state
      publishAppearanceState()
    })
  } else if (target.hostname === 'choose-theme-background') {
    api.chooseThemeBackground().then(state => {
      appearanceState = state
      publishAppearanceState()
    })
  } else if (target.hostname === 'choose-wallpaper-engine') {
    api.chooseWallpaperEngine().then(state => {
      appearanceState = state
      publishAppearanceState()
    })
  } else if (target.hostname === 'clear-theme-background') {
    api.clearThemeBackground().then(state => {
      appearanceState = state
      publishAppearanceState()
    })
  }
})

retryRuntime.addEventListener('click', () => {
  renderRuntimeState({ status: 'starting', detail: '正在重新启动官方工作台…' })
  api.startRuntime({}).then(renderRuntimeState).catch(error => renderRuntimeState({ status: 'error', detail: error.message }))
})

skinQuickButton.addEventListener('click', openSkinPicker)
skinThemeTab.addEventListener('click', () => showSkinPickerPane('themes'))
skinWallpaperTab.addEventListener('click', () => { showSkinPickerPane('wallpapers'); renderWallpaperLibrary() })
skinModeTab.addEventListener('click', () => { showSkinPickerPane('modes'); renderUiModePicker() })
skinReducedMotion.addEventListener('change', async () => {
  appearanceState = await api.setUiPreferences({ reducedMotion: skinReducedMotion.checked })
  await publishAppearanceState()
  renderUiModePicker()
})
skinLowPerformance.addEventListener('change', async () => {
  appearanceState = await api.setUiPreferences({ lowPerformance: skinLowPerformance.checked })
  await publishAppearanceState()
  renderUiModePicker()
})
closeMobileSyncButton.addEventListener('click', closeMobileSync)
mobileSyncOverlay.addEventListener('click', event => {
  if (event.target === mobileSyncOverlay) closeMobileSync()
})
mobileSyncToggle.addEventListener('click', async () => {
  mobileSyncToggle.disabled = true
  mobileSyncError.textContent = ''
  try {
    renderMobileSync(await api.setMobileSyncEnabled(!(mobileSyncState.enabled && mobileSyncState.running)))
    await publishMobileSyncState()
    if (mobileSyncState.enabled && mobileSyncState.running && !mobileSyncState.devices?.length) await generateMobilePairing()
  } catch (error) { mobileSyncError.textContent = error.message }
  finally { mobileSyncToggle.disabled = false }
})
refreshMobilePairing.addEventListener('click', generateMobilePairing)
mobileRemoteToggle.addEventListener('change', async () => {
  mobileRemoteToggle.disabled = true
  mobileSyncError.textContent = ''
  try {
    renderMobileSync(await api.setMobileSyncRemoteEnabled(mobileRemoteToggle.checked))
    await publishMobileSyncState()
  } catch (error) {
    mobileSyncError.textContent = error.message
    mobileRemoteToggle.checked = !mobileRemoteToggle.checked
  } finally { mobileRemoteToggle.disabled = false }
})
mobileTransportPreference.addEventListener('change', async () => {
  mobileTransportPreference.disabled = true
  mobileSyncError.textContent = ''
  try {
    renderMobileSync(await api.setMobileSyncTransportPreference(mobileTransportPreference.value))
    await publishMobileSyncState()
  } catch (error) { mobileSyncError.textContent = error.message }
  finally { mobileTransportPreference.disabled = false }
})
mobileRelaySave.addEventListener('click', async () => {
  const value = mobileRelayUrlInput.value.trim()
  if (!value) {
    mobileRelayMessage.textContent = '请先输入中继服务器域名、公网 IP 或 wss:// 地址。'
    mobileRelayUrlInput.focus()
    return
  }
  if (!mobileRelayApiAvailable()) {
    mobileRelayMessage.textContent = '当前版本尚未提供个人中继保存接口，请升级后再试。'
    return
  }
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `wss://${value}`
  relayTesting = true
  mobileRelaySave.disabled = true
  mobileRelayClear.disabled = true
  mobileRelayMessage.textContent = ''
  renderMobileRelayCard()
  try {
    const next = await mobileRelayApi.save(url)
    relayTesting = false
    renderMobileSync(next)
    await publishMobileSyncState()
    mobileRelayMessage.textContent = '已保存。请重新生成二维码，并在已配对手机重新扫码更新远程线路；之后新配对的手机扫码会自动携带该配置。'
  } catch (error) {
    relayTesting = false
    renderMobileRelayCard()
    mobileRelayMessage.textContent = error?.message || '保存或检测失败：请确认地址、443 端口和可信 TLS 证书。'
  } finally { mobileRelaySave.disabled = false }
})
mobileRelayClear.addEventListener('click', async () => {
  if (!mobileRelayApiAvailable()) {
    mobileRelayMessage.textContent = '当前版本尚未提供个人中继清除接口，请升级后再试。'
    return
  }
  mobileRelayClear.disabled = true
  mobileRelayMessage.textContent = ''
  try {
    const next = await mobileRelayApi.clear()
    renderMobileSync(next)
    await publishMobileSyncState()
    mobileRelayMessage.textContent = '已清除并恢复默认。请重新生成二维码，并在已配对手机重新扫码更新远程线路；之后新配对的手机扫码不会再携带个人中继。'
  } catch (error) {
    mobileRelayMessage.textContent = error?.message || '清除失败，请稍后重试。'
  } finally { renderMobileRelayCard() }
})
stopMobileControl.addEventListener('click', async () => {
  stopMobileControl.disabled = true
  mobileSyncError.textContent = ''
  try {
    const result = await api.stopMobileControl(null)
    renderMobileSync({ control: result.state })
    await publishMobileSyncState()
  } catch (error) { mobileSyncError.textContent = error.message }
  finally { stopMobileControl.disabled = false }
})
copyMobileSyncUrl.addEventListener('click', async () => {
  if (!mobileSyncUrl.value) return
  await api.copyMobileSyncText(mobileSyncUrl.value)
  copyMobileSyncUrl.textContent = '已复制'
  setTimeout(() => { copyMobileSyncUrl.textContent = '复制' }, 1200)
})
petQuickButton.addEventListener('click', () => {
  if (petPanel.classList.contains('hidden')) openPetPanel()
  else closePetPanel()
})
closePetPanelButton.addEventListener('click', closePetPanel)
document.addEventListener('pointerdown', event => {
  if (petPanel.classList.contains('hidden')) return
  if (petPanel.contains(event.target) || petQuickButton.contains(event.target)) return
  closePetPanel()
})
runtimeView.addEventListener('focus', closePetPanel)
petAwakeToggle.addEventListener('click', async () => {
  renderPetState(await api.setPetPreferences({ awake: !petState.preferences?.awake }))
})
petFeedButton.addEventListener('click', async () => {
  const inventory = petState.inventory || {}
  const kind = inventory.fragments > 0 ? 'fragments' : inventory.standard > 0 ? 'standard' : 'refined'
  renderPetState(await api.feedPet(kind))
})
petAutoFeed.addEventListener('change', async () => {
  renderPetState(await api.setPetPreferences({ autoFeed: petAutoFeed.checked }))
})
petAlwaysOnTop.addEventListener('change', async () => {
  renderPetState(await api.setPetPreferences({ alwaysOnTop: petAlwaysOnTop.checked }))
})
petProactive.addEventListener('change', async () => {
  renderPetState(await api.setPetPreferences({ proactive: petProactive.checked }))
})
petCompanionStyle.addEventListener('change', async () => {
  renderPetState(await api.setPetPreferences({ companionStyle: petCompanionStyle.value }))
})
closeSkinPickerButton.addEventListener('click', closeSkinPicker)
skinPickerOverlay.addEventListener('click', event => {
  if (event.target === skinPickerOverlay) closeSkinPicker()
})
updateLaterButton.addEventListener('click', closeUpdateReady)
updateReadyOverlay.addEventListener('click', event => {
  if (event.target === updateReadyOverlay) closeUpdateReady()
})
updateNoticeLater.addEventListener('click', closeUpdateNotice)
updateNoticeRelease.addEventListener('click', () => {
  const url = updateNoticeRelease.dataset.url
  if (url) api.openLink(url).catch(() => {})
})
updateNoticeInstall.addEventListener('click', async () => {
  updateNoticeOverlay.classList.add('hidden')
  updateNoticeOverlay.setAttribute('aria-hidden', 'true')
  if (pendingUpdateKind !== 'preview') {
    installUpdate()
    return
  }
  updateNoticeInstall.disabled = true
  updateNoticeInstall.textContent = '正在更新…'
  try {
    await api.applyPrPreviewUpdate()
  } catch (error) {
    prPreviewState = { ...prPreviewState, error: error.message }
    updateNoticeSummary.textContent = `PR 快速预览更新失败：${error.message}`
    updateNoticeInstall.disabled = false
    updateNoticeInstall.textContent = '重试更新'
    updateNoticeOverlay.classList.remove('hidden')
    updateNoticeOverlay.setAttribute('aria-hidden', 'false')
    await publishUpdateState()
  }
})
updateNoticeOverlay.addEventListener('click', event => {
  if (event.target === updateNoticeOverlay) closeUpdateNotice()
})
updateNowButton.addEventListener('click', async () => {
  updateNowButton.disabled = true
  updateNowButton.textContent = '正在退出…'
  updateLaterButton.disabled = true
  updateLaunchError.textContent = ''
  try {
    if (pendingUpdateKind === 'components') await api.applyComponentUpdates()
    else await api.launchReadyUpdate()
  } catch (error) {
    updateNowButton.disabled = false
    updateNowButton.textContent = pendingUpdateKind === 'components' ? '重启并应用' : '立即安装'
    updateLaterButton.disabled = false
    updateLaunchError.textContent = error.message
  }
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !petPanel.classList.contains('hidden')) closePetPanel()
  if (event.key === 'Escape' && !skinPickerOverlay.classList.contains('hidden')) closeSkinPicker()
  if (event.key === 'Escape' && !modelRoutingOverlay.classList.contains('hidden')) closeModelRouting()
  if (event.key === 'Escape' && !mobileSyncOverlay.classList.contains('hidden')) closeMobileSync()
  if (event.key === 'Escape' && !updateReadyOverlay.classList.contains('hidden')) closeUpdateReady()
  if (event.key === 'Escape' && !updateNoticeOverlay.classList.contains('hidden')) closeUpdateNotice()
})
restoreOfficialThemeButton.addEventListener('click', async () => {
  await skinPickerHost.apply(async () => {
    appearanceState = await api.setTheme('official')
    appearanceState = await api.setUiPreferences({ uiMode: 'official', reducedMotion: false, lowPerformance: false })
    await publishAppearanceState()
  })
})
skinChooseBackgroundButton.addEventListener('click', async () => {
  const before = JSON.stringify(appearanceState.wallpaperLibrary || {})
  wallpaperLibraryMessage('请选择要复制到 Harness 壁纸库的图片或视频…')
  try {
    await skinPickerHost.apply(async () => {
      appearanceState = await api.chooseThemeBackground()
      await publishAppearanceState()
      renderSkinPicker()
      const imported = JSON.stringify(appearanceState.wallpaperLibrary || {}) !== before
      if (!imported) wallpaperLibraryMessage('没有导入新壁纸。')
      return imported
    }, Boolean)
  } catch (error) {
    wallpaperLibraryMessage(`导入失败：${error.message}`, true)
  }
})
skinChooseWallpaperEngineButton.addEventListener('click', () => importCurrentWallpaperEngineProject())
skinBrowseWallpaperEngineButton.addEventListener('click', openWallpaperEnginePicker)
skinWallpaperEngineRescan.addEventListener('click', openWallpaperEnginePicker)
skinWallpaperEngineSearch.addEventListener('input', () => renderWallpaperEnginePicker())
skinWallpaperEngineSearchClear.addEventListener('click', () => {
  skinWallpaperEngineSearch.value = ''
  renderWallpaperEnginePicker()
  skinWallpaperEngineSearch.focus()
})
skinWallpaperEngineManual.addEventListener('click', async () => {
  disposeWallpaperEnginePreviews()
  skinWallpaperEnginePicker.classList.add('hidden')
  try {
    const before = JSON.stringify(appearanceState.wallpaperLibrary || {})
    await skinPickerHost.apply(async () => {
      appearanceState = await api.chooseWallpaperEngine()
      await publishAppearanceState()
      renderSkinPicker()
      const imported = JSON.stringify(appearanceState.wallpaperLibrary || {}) !== before
      if (!imported) wallpaperLibraryMessage('没有导入新壁纸。')
      return imported
    }, Boolean)
  } catch (error) {
    wallpaperLibraryMessage(`手动导入失败：${error.message}`, true)
  }
})
skinWallpaperEngineClose.addEventListener('click', () => {
  disposeWallpaperEnginePreviews()
  skinWallpaperEnginePicker.classList.add('hidden')
})
skinWallpaperEngineSync.addEventListener('click', async () => {
  skinWallpaperEngineSync.disabled = true
  skinWallpaperEngineSync.textContent = '正在读取项目源…'
  try {
    appearanceState = await api.syncWallpaperEngine()
    await publishAppearanceState()
    renderSkinPicker()
    const sync = appearanceState.wallpaperEngineSync || {}
    wallpaperLibraryMessage(sync.changed
      ? '已更新受控本地副本并应用最新壁纸。'
      : ['unavailable', 'unreadable', 'source-unavailable'].includes(sync.reason)
        ? '项目源不可同步；已保存的本地副本仍可正常使用。'
        : '本地副本已是最新。', ['unavailable', 'unreadable', 'source-unavailable'].includes(sync.reason))
    skinWallpaperEngineSync.textContent = '同步当前项目源'
  } catch (error) {
    wallpaperLibraryMessage(`同步失败：${error.message}；本地副本不受影响。`, true)
    skinWallpaperEngineSync.textContent = '同步当前项目源'
    skinWallpaperEngineSync.disabled = false
  }
})
skinClearBackgroundButton.addEventListener('click', async () => {
  appearanceState = await api.clearThemeBackground()
  await publishAppearanceState()
  renderSkinPicker()
  wallpaperLibraryMessage('已停用当前壁纸；壁纸卡仍保留在本地库中。')
})
let wallpaperAppearancePreviewFrame = 0
function previewWallpaperAppearance(name, value) {
  appearanceState = {
    ...appearanceState,
    themeId: 'custom',
    customTheme: { ...(appearanceState.customTheme || {}), [name]: value }
  }
  if (wallpaperAppearancePreviewFrame) return
  wallpaperAppearancePreviewFrame = requestAnimationFrame(() => {
    wallpaperAppearancePreviewFrame = 0
    publishAppearanceState().catch(() => {})
  })
}

async function persistWallpaperAppearance() {
  if (wallpaperAppearancePreviewFrame) {
    cancelAnimationFrame(wallpaperAppearancePreviewFrame)
    wallpaperAppearancePreviewFrame = 0
  }
  appearanceState = await api.saveCustomTheme(readShellCustomTheme())
  await publishAppearanceState()
  renderSkinPicker()
  wallpaperLibraryMessage('壁纸显示参数已保存。')
}

for (const [name, field] of Object.entries(customThemeRangeFields)) {
  const input = document.querySelector(field.input)
  input.addEventListener('input', () => {
    document.querySelector(field.output).textContent = `${input.value}${field.suffix}`
    previewWallpaperAppearance(name, Number(input.value))
  })
  input.addEventListener('change', () => persistWallpaperAppearance().catch(error => wallpaperLibraryMessage(`保存显示参数失败：${error.message}`, true)))
}
skinApplyCustomButton.addEventListener('click', async () => {
  await skinPickerHost.apply(async () => {
    appearanceState = await api.saveCustomTheme(readShellCustomTheme())
    await publishAppearanceState()
  })
})
skinApplyWallpaperAppearance.addEventListener('click', async () => {
  await skinPickerHost.apply(async () => {
    await persistWallpaperAppearance()
  })
})
skinResetWallpaperAppearance.addEventListener('click', async () => {
  skinResetWallpaperAppearance.disabled = true
  try {
    const recommended = {}
    for (const [name, field] of Object.entries(customThemeRangeFields)) {
      recommended[name] = customThemeDefaults[name]
      const input = document.querySelector(field.input)
      input.value = String(customThemeDefaults[name])
      document.querySelector(field.output).textContent = `${customThemeDefaults[name]}${field.suffix}`
    }
    appearanceState = {
      ...appearanceState,
      themeId: 'custom',
      customTheme: { ...(appearanceState.customTheme || {}), ...recommended }
    }
    await publishAppearanceState()
    await persistWallpaperAppearance()
    wallpaperLibraryMessage('已恢复推荐显示参数并保存；当前壁纸和主题配色保持不变。')
  } catch (error) {
    wallpaperLibraryMessage(`恢复推荐参数失败：${error.message}`, true)
  } finally {
    skinResetWallpaperAppearance.disabled = false
  }
})
closeModelRoutingButton.addEventListener('click', closeModelRouting)
modelRoutingOverlay.addEventListener('click', event => {
  if (event.target === modelRoutingOverlay) closeModelRouting()
})
modelRoutingMainProvider.addEventListener('change', () => {
  modelRoutingDirty = true
  modelRoutingMainModel.value = ''
  renderModelRoutingPage()
})
modelRoutingMainModel.addEventListener('change', () => { modelRoutingDirty = true; renderModelRoutingPage() })
modelRoutingSubProvider.addEventListener('change', () => {
  modelRoutingDirty = true
  modelRoutingSubDraft = { provider: modelRoutingSubProvider.value, model: '' }
  renderModelRoutingPage()
})
modelRoutingSubModel.addEventListener('change', () => {
  modelRoutingDirty = true
  modelRoutingSubDraft = { provider: modelRoutingSubProvider.value, model: modelRoutingSubModel.value }
  renderModelRoutingPage()
})
modelRoutingSubInherit.addEventListener('click', () => {
  modelRoutingDirty = true
  setShellModelSubagentMode(true)
  renderModelRoutingPage()
})
modelRoutingSubIndependent.addEventListener('click', () => {
  modelRoutingDirty = true
  setShellModelSubagentMode(false)
  renderModelRoutingPage()
})
modelRoutingRefreshMeters.addEventListener('click', async () => {
  modelRoutingState = { ...modelRoutingState, meters: { ...(modelRoutingState.meters || {}), loading: true, error: '' } }
  renderShellModelMeters()
  try {
    const meters = await api.getProviderMeters(true)
    modelRoutingState = { ...modelRoutingState, meters: { ...meters, loading: false, error: '' } }
  } catch (error) {
    modelRoutingState = { ...modelRoutingState, meters: { ...(modelRoutingState.meters || {}), loading: false, error: error.message } }
  }
  renderShellModelMeters()
})
modelRoutingSave.addEventListener('click', async () => {
  modelRoutingState = { ...modelRoutingState, saving: true, saved: false, error: '' }
  renderModelRoutingPage()
  try {
    const saved = await api.saveModelRouting(window.harnessModelRoutingIntegration.createModelRoutingSavePayload({
      mainProvider: modelRoutingMainProvider.value.trim(),
      mainModel: modelRoutingMainModel.value.trim(),
      subInherit: modelRoutingSubInherit.getAttribute('aria-pressed') === 'true',
      subProvider: modelRoutingSubProvider.value.trim(),
      subModel: modelRoutingSubModel.value.trim(),
      basePreset: modelRoutingState.basePreset
    }))
    modelRoutingState = { ...saved, meters: modelRoutingState.meters, saving: false, saved: true, error: '' }
    modelRoutingDirty = false
  } catch (error) {
    modelRoutingState = { ...modelRoutingState, saving: false, saved: false, error: error.message }
  }
  renderModelRoutingPage()
})

terminalCloseButton.addEventListener('click', closeIntegratedTerminal)
terminalStartButton.addEventListener('click', () => startIntegratedTerminal())
terminalInterruptButton.addEventListener('click', interruptIntegratedTerminal)
terminalStopButton.addEventListener('click', () => stopIntegratedTerminal())
terminalClearButton.addEventListener('click', () => {
  terminalEmulator?.clear()
  terminalEmulator?.focus()
})
terminalResizeHandle.addEventListener('pointerdown', beginTerminalResize)
terminalResizeHandle.addEventListener('keydown', beginTerminalResize)
window.addEventListener('resize', fitIntegratedTerminal)
document.addEventListener('keydown', event => {
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === '`') {
    event.preventDefault()
    toggleIntegratedTerminal()
  }
})
api.onTerminalEvent(event => applyTerminalEvent(event))
api.onTerminalToggle(() => toggleIntegratedTerminal())

api.onRuntimeState(renderRuntimeState)
api.onMobileSyncState(state => {
  renderMobileSync(state)
  publishMobileSyncState()
})
api.onComputerUseAuthorization(session => {
  if (computerUsePluginMutationPending) return
  computerUsePluginState = { loading: false, notice: '', error: '', session }
  publishComputerUsePluginState()
})
api.onPetState(renderPetState)
api.onUpdateResult(async result => {
  updateState = { ...updateState, ...result, checking: false }
  pendingUpdateKind = 'installer'
  pendingComponentUpdate = null
  showComponentUpdateNotice(result.component)
  if (typeof api.getUnifiedUpdateState === 'function') {
    try {
      updateState = { ...updateState, ...(await api.getUnifiedUpdateState()) }
    } catch (error) {
      updateState = { ...updateState, installError: error.message || String(error) }
    }
  }
  await publishUpdateState()
})
api.onUpdateInstallProgress(progress => {
  updateState = { ...updateState, installing: progress?.phase !== 'ready', installError: '', installProgress: progress }
  publishUpdateState()
})
api.onComponentUpdateProgress(progress => {
  updateState = { ...updateState, installing: true, installError: '', installProgress: { kind: 'components', ...progress } }
  publishUpdateState()
})
api.onPrPreviewUpdateProgress(progress => {
  prPreviewState = { ...prPreviewState, checking: true, progress, error: '' }
  publishUpdateState()
})

async function startOfficialWorkspace() {
  distributionState = await api.getDistribution()
  updateState = { ...updateState, preferences: await api.getUpdatePreferences(), distribution: distributionState }
  if (typeof api.getUnifiedUpdateState === 'function') {
    try {
      updateState = { ...updateState, ...(await api.getUnifiedUpdateState()) }
    } catch (error) {
      updateState = { ...updateState, installError: error.message || String(error) }
    }
  }
  try {
    prPreviewState = { ...prPreviewState, ...(await api.getPrPreviewUpdateState()), error: '' }
  } catch (error) {
    prPreviewState = { ...prPreviewState, configured: false, error: error.message }
  }
  appearanceState = await api.getAppearance()
  petState = await api.getPetState()
  const [routing, meters, gitStatus] = await Promise.all([api.getModelRouting(), api.getProviderMeters(false), api.getGitRuntimeStatus()])
  modelRoutingState = { ...routing, meters: { ...meters, loading: false, error: '' }, saving: false, saved: false, error: '' }
  gitRuntimeState = { ...gitRuntimeState, ...gitStatus, loading: false }
  mobileSyncState = await api.getMobileSyncState()
  try {
    computerUsePluginState = { loading: false, notice: '', error: '', session: await api.getComputerUseState() }
  } catch (error) {
    computerUsePluginState = { ...computerUsePluginState, loading: false, error: error.message || String(error) }
  }
  await hydrateIntegratedTerminal()
  const themeAssets = await api.getThemeAssets()
  themeCatalog = themeIntegration.prepareCatalog(window.harnessDesktopThemes || [], themeAssets)
    .filter(theme => distributionState.nonCommercialContentAvailable || !theme.nonCommercial)
  petQuickButton.hidden = !distributionState.desktopPetAvailable
  if (!distributionState.desktopPetAvailable) petPanel.classList.add('hidden')
  applyShellTheme()
  applyShellUiMode()
  renderPetState()
  renderMobileSync()
  renderSkinPicker()
  const initial = await api.getRuntimeState()
  renderRuntimeState(initial)
  if (initial.status !== 'ready') renderRuntimeState(await api.startRuntime({}))
  if (prPreviewState.enabled && (prPreviewState.configured || prPreviewState.ready)) refreshPrPreviewState({ discover: true }).catch(() => {})
}

playStartupAnimation()
startOfficialWorkspace().catch(error => renderRuntimeState({ status: 'error', detail: error.message }))
