const api = window.desktopHarness
const startupSplash = document.querySelector('#startupSplash')
const startupPath = document.querySelector('#startupSplash .startup-mark path')
const runtimeView = document.querySelector('#runtimeView')
const runtimeStatus = document.querySelector('#runtimeStatus')
const runtimeStatusTitle = document.querySelector('#runtimeStatusTitle')
const runtimeStatusDetail = document.querySelector('#runtimeStatusDetail')
const retryRuntime = document.querySelector('#retryRuntime')
const petQuickButton = document.querySelector('#petQuickButton')
const petPanel = document.querySelector('#petPanel')
const closePetPanelButton = document.querySelector('#closePetPanel')
const petPanelStatus = document.querySelector('#petPanelStatus')
const petFullness = document.querySelector('#petFullness')
const petFullnessText = document.querySelector('#petFullnessText')
const petRefinedCount = document.querySelector('#petRefinedCount')
const petStandardCount = document.querySelector('#petStandardCount')
const petFragmentCount = document.querySelector('#petFragmentCount')
const petAwakeToggle = document.querySelector('#petAwakeToggle')
const petFeedButton = document.querySelector('#petFeedButton')
const petAutoFeed = document.querySelector('#petAutoFeed')
const petAlwaysOnTop = document.querySelector('#petAlwaysOnTop')
const skinQuickButton = document.querySelector('#skinQuickButton')
const skinPickerOverlay = document.querySelector('#skinPickerOverlay')
const skinPickerGrid = document.querySelector('#skinPickerGrid')
const skinThemeTab = document.querySelector('#skinThemeTab')
const skinModeTab = document.querySelector('#skinModeTab')
const skinThemePane = document.querySelector('#skinThemePane')
const skinModePane = document.querySelector('#skinModePane')
const skinModeGrid = document.querySelector('#skinModeGrid')
const skinModeCurrent = document.querySelector('#skinModeCurrent')
const skinReducedMotion = document.querySelector('#skinReducedMotion')
const skinLowPerformance = document.querySelector('#skinLowPerformance')
const closeSkinPickerButton = document.querySelector('#closeSkinPicker')
const restoreOfficialThemeButton = document.querySelector('#restoreOfficialTheme')
const skinChooseBackgroundButton = document.querySelector('#skinChooseBackground')
const skinClearBackgroundButton = document.querySelector('#skinClearBackground')
const skinApplyCustomButton = document.querySelector('#skinApplyCustom')
const skinBackgroundState = document.querySelector('#skinBackgroundState')
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
let updateState = {
  checking: false,
  installing: false,
  installProgress: null,
  installError: '',
  app: null,
  harness: null,
  preferences: { checkOnStartup: true, channel: 'stable', lastCheckedAt: null }
}
let distributionState = {
  channel: 'direct', store: false, appUpdatesManagedByStore: false,
  nonCommercialContentAvailable: true, desktopPetAvailable: true, links: {}
}
let appearanceState = { themeId: 'porcelain-mist', customTheme: {}, customBackgroundDataUrl: null, uiMode: 'official', reducedMotion: false, lowPerformance: false }
let petState = {
  status: 'idle', fullness: 80, inventory: { refined: 0, standard: 0, fragments: 0 },
  preferences: { enabled: true, awake: false, alwaysOnTop: true, autoFeed: true }
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
let themeCatalog = []
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
  return `0 1px 2px rgba(${shadow},${(.18 + amount * .58).toFixed(2)}),0 0 12px rgba(${shadow},${(.06 + amount * .24).toFixed(2)})`
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
    const overlay = shellColorWithOpacity(custom.surface, .06 + readability * (custom.mode === 'dark' ? .34 : .27))
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
    for (const name of ['--shell-surface', '--shell-layer', '--shell-layer-2', '--shell-text', '--shell-text-secondary', '--shell-text-tertiary', '--shell-border', '--shell-hover', '--shell-accent', '--shell-overlay', '--shell-text-shadow']) root.style.removeProperty(name)
    return
  }
  const custom = { ...customThemeDefaults, ...(appearanceState.customTheme || {}) }
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches
  const mode = theme.id === 'custom' ? custom.mode : theme.mode === 'adaptive' ? (prefersDark ? 'dark' : 'light') : theme.mode
  const glassOpacity = 1 - custom.glassTransparency / 100
  const vars = theme.id === 'custom'
    ? {
        '--dsw-alias-bg-base': shellColorWithOpacity(custom.surface, Math.max(.08, glassOpacity)),
        '--dsw-alias-bg-layer-1': shellColorWithOpacity(custom.surface, Math.min(1, glassOpacity + .08)),
        '--dsw-alias-bg-layer-2': shellColorWithOpacity(custom.surface, Math.min(1, glassOpacity + .16)),
        '--dsw-alias-label-primary': custom.text,
        '--dsw-alias-label-secondary': custom.text,
        '--dsw-alias-border-l2': shellColorWithOpacity(custom.text, custom.borderStrength / 100 * .34),
        '--dsw-alias-brand-primary': custom.accent
      }
    : { ...theme.vars, ...(theme.mode === 'adaptive' && mode === 'dark' ? theme.darkVars : {}) }
  root.dataset.shellTheme = theme.id
  root.style.colorScheme = mode === 'light' ? 'light' : 'dark'
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
  const showModes = name === 'modes'
  skinThemeTab.setAttribute('aria-selected', String(!showModes))
  skinModeTab.setAttribute('aria-selected', String(showModes))
  skinThemePane.classList.toggle('hidden', showModes)
  skinModePane.classList.toggle('hidden', !showModes)
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
      appearanceState = await api.setTheme(card.dataset.skinId || 'official')
      await publishAppearanceState()
      closeSkinPicker()
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
    api.openExternal(event.currentTarget.dataset.source || '').catch(() => {})
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
  skinClearBackgroundButton.disabled = !appearanceState.customBackgroundDataUrl
  const backgroundFile = appearanceState.customTheme?.backgroundFile || ''
  const animated = /\.(?:gif|apng)$/i.test(backgroundFile)
  skinBackgroundState.textContent = appearanceState.customBackgroundDataUrl
    ? animated ? '动态壁纸已启用' : '本地壁纸已启用（兼容动态 WebP）'
    : '当前使用渐变背景'
  renderUiModePicker()
}

const petStatusLabels = {
  idle: '正在休息',
  working: '正在陪你工作',
  'needs-input': '有任务等待你的决定',
  blocked: '任务遇到问题',
  ready: '任务已完成',
  celebrating: '正在庆祝任务完成',
  sleeping: '饿得睡着了'
}

function renderPetState(next = petState) {
  petState = next
  const inventory = next.inventory || {}
  const preferences = next.preferences || {}
  petQuickButton.dataset.status = next.status || 'idle'
  petPanelStatus.textContent = petStatusLabels[next.status] || petStatusLabels.idle
  petFullness.value = Math.max(0, Math.min(100, Number(next.fullness) || 0))
  petFullnessText.textContent = `${Math.round(petFullness.value)}%`
  petRefinedCount.textContent = inventory.refined || 0
  petStandardCount.textContent = inventory.standard || 0
  petFragmentCount.textContent = inventory.fragments || 0
  petAwakeToggle.classList.toggle('primary', !preferences.awake)
  petAutoFeed.checked = preferences.autoFeed !== false
  petAlwaysOnTop.checked = preferences.alwaysOnTop !== false
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

function openSkinPicker() {
  closePetPanel()
  applyShellTheme()
  applyShellUiMode()
  showSkinPickerPane('themes')
  renderSkinPicker()
  skinPickerOverlay.classList.remove('hidden')
  skinPickerOverlay.setAttribute('aria-hidden', 'false')
  closeSkinPickerButton.focus()
}

function closeSkinPicker() {
  skinPickerOverlay.classList.add('hidden')
  skinPickerOverlay.setAttribute('aria-hidden', 'true')
  skinQuickButton.focus()
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

function showComponentUpdateNotice(componentState, { force = false } = {}) {
  const check = componentState?.lastCheck
  if (!componentState?.enabled || check?.mode !== 'components' || !check.releaseVersion) return false
  pendingComponentUpdate = componentState
  const components = Array.isArray(check.components) ? check.components : []
  showUpdateNotice({
    updateAvailable: true,
    latestVersion: check.releaseVersion,
    currentVersion: updateState.app?.currentVersion || '当前组件版本',
    notes: components.map(component => `增量更新 ${component.id} → ${component.version}`).join('\n') || '已发现经过签名的组件增量更新。',
    url: ''
  }, { force })
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
  const adapterLabel = remote.active === 'wss-relay' ? 'WSS/443（通用线路）' : remote.active === 'easytier' ? 'EasyTier' : remote.active === 'tailscale' ? 'Tailscale' : ''
  const remoteStatusText = remote.enabled === false
    ? '远程连接已关闭；同一 Wi-Fi 仍可使用'
    : remote.status === 'connected'
      ? `${adapterLabel || '远程通道'}已连接`
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

function officialSettingsBootstrap() {
  if (window.__HARNESS_DESKTOP_UPDATE_INSTALLED__) return
  window.__HARNESS_DESKTOP_UPDATE_INSTALLED__ = true

  const style = document.createElement('style')
  style.dataset.harnessDesktop = 'updates'
  style.textContent = `
    #harness-desktop-update-row { border-bottom: 1px solid var(--dsw-alias-border-l2); padding: 16px 0; color: var(--dsw-alias-label-primary); }
    #harness-desktop-update-row .hd-update-head { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    #harness-desktop-update-row .hd-update-title { font-size:14px; line-height:22px; }
    #harness-desktop-update-row .hd-update-status { margin-top:4px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
    #harness-desktop-update-row .hd-update-lines { display:grid; gap:6px; margin-top:12px; }
    #harness-desktop-update-row .hd-update-line { display:flex; justify-content:space-between; gap:12px; color:var(--dsw-alias-label-secondary); font-size:12px; }
    #harness-desktop-update-row .hd-update-line strong { color:var(--dsw-alias-label-primary); font-weight:400; text-align:right; }
    #harness-desktop-update-row .hd-update-notes { margin-top:12px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; padding:10px 12px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); font-size:12px; line-height:1.55; }
    #harness-desktop-update-row .hd-update-notes strong { display:block; margin-bottom:5px; color:var(--dsw-alias-label-primary); font-weight:600; }
    #harness-desktop-update-row .hd-update-notes ul { display:grid; gap:4px; margin:0; padding-left:18px; }
    #harness-desktop-update-row .hd-update-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:12px; }
    #harness-desktop-update-row .hd-policy-links { display:flex; flex-wrap:wrap; gap:12px; margin-top:12px; font-size:12px; }
    #harness-desktop-update-row .hd-policy-links a { min-height:auto; padding:0; border-radius:0; color:var(--dsw-alias-label-secondary); background:transparent; text-decoration:underline; }
    #harness-desktop-update-row button, #harness-desktop-update-row a { box-sizing:border-box; min-height:34px; border:0; border-radius:17px; padding:6px 14px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-module-platform); font:inherit; font-size:13px; text-decoration:none; cursor:pointer; }
    #harness-desktop-update-row button:hover, #harness-desktop-update-row a:hover { background:var(--dsw-alias-interactive-bg-hover); }
    #harness-desktop-update-row button:disabled { cursor:default; opacity:.55; }
    #harness-desktop-update-row label { display:flex; align-items:center; gap:7px; margin-left:auto; color:var(--dsw-alias-label-secondary); font-size:12px; cursor:pointer; }
    #harness-desktop-mobile-sync-row { display:flex; align-items:center; justify-content:space-between; gap:18px; border-bottom:1px solid var(--dsw-alias-border-l2); padding:16px 0; color:var(--dsw-alias-label-primary); }
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
  `
  document.head.appendChild(style)

  const versionText = result => {
    if (!result) return '等待首次检查'
    if (result.storeManaged) return `${result.currentVersion || '当前版本'}（由 Microsoft Store 管理）`
    if (result.error) return `检查失败：${result.error}`
    const current = result.currentVersion || '未知'
    const latest = result.latestVersion || current
    if (result.kind === 'harness' && result.updateAvailable && result.updatePolicy === 'desktop-bundled') {
      return `${current} → ${latest}（官方已发布，随桌面兼容版更新）`
    }
    return result.updateAvailable ? `${current} → ${latest}（有新版）` : `${current}（已是最新）`
  }

  const noteLines = value => {
    const lines = String(value || '').replace(/\r/g, '').split('\n')
      .map(line => line.trim().replace(/^[-*+]\s+/, '').replace(/^#{1,6}\s+/, ''))
      .filter(line => line && !/^Full Changelog:/i.test(line) && !/^https?:\/\//i.test(line))
      .slice(0, 6)
    return lines.length ? lines : ['本次更新包含体验优化与问题修复，完整内容可查看发布页。']
  }

  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value
  }

  const request = (action, values = {}) => {
    const query = new URLSearchParams(values).toString()
    location.href = `harness-desktop://${action}/${query ? `?${query}` : ''}`
  }

  const paint = () => {
    const state = window.__HARNESS_DESKTOP_UPDATE_STATE__ || {}
    const row = document.querySelector('#harness-desktop-update-row')
    if (!row) return
    const hasAppUpdate = Boolean(state.app?.updateAvailable)
    const hasHarnessUpdate = Boolean(state.harness?.updateAvailable)
    const failed = Boolean(state.app?.error || state.harness?.error)
    const checked = state.preferences?.lastCheckedAt
    const progress = state.installProgress
    const percent = progress?.total ? Math.min(100, Math.round(progress.received * 100 / progress.total)) : 0
    const status = state.app?.storeManaged && !state.installing && !state.installError
      ? state.checking ? '正在检查官方 Harness 更新…' : '桌面应用更新由 Microsoft Store 管理'
      : progress?.phase === 'current'
        ? '当前桌面版已经是最新版本'
        : progress?.phase === 'ready'
          ? '更新已在后台下载完成，等待安装确认'
        : state.installing
      ? progress?.phase === 'checksum'
        ? '正在验证桌面版更新…'
        : progress?.phase === 'source'
          ? `正在连接下载源 ${progress.attempt || 1}/${progress.totalSources || 1}：${progress.source || '镜像站'}…`
        : progress?.phase === 'launch'
          ? '校验完成，正在启动中文升级程序…'
          : `正在下载桌面版更新${percent ? `：${percent}%` : '…'}`
      : state.installError
        ? `桌面版更新失败：${state.installError}`
        : state.checking
          ? '正在检查桌面版和官方 Harness…'
          : hasAppUpdate
            ? '检测到可下载安装的桌面新版'
            : hasHarnessUpdate
              ? '官方核心有新版；兼容验证后会随桌面版更新'
            : failed
              ? '部分更新源检查失败'
              : checked
                ? `最近检查：${new Date(checked).toLocaleString()}`
                : '启动后会自动检查更新'
    setText(row.querySelector('[data-hd-status]'), status)
    setText(row.querySelector('[data-hd-app]'), versionText(state.app))
    setText(row.querySelector('[data-hd-harness]'), versionText(state.harness))
    const notesBox = row.querySelector('[data-hd-notes]')
    const shouldShowNotes = Boolean(state.app?.updateAvailable)
    notesBox.hidden = !shouldShowNotes
    if (shouldShowNotes) {
      const signature = `${state.app.latestVersion || ''}:${state.app.notes || ''}`
      if (notesBox.dataset.signature !== signature) {
        notesBox.dataset.signature = signature
        notesBox.querySelector('strong').textContent = `${state.app.latestVersion || '新版本'} 更新内容`
        const list = notesBox.querySelector('ul')
        list.replaceChildren(...noteLines(state.app.notes).map(note => {
          const item = document.createElement('li')
          item.textContent = note
          return item
        }))
      }
    }
    const checkButton = row.querySelector('[data-hd-check]')
    const installButton = row.querySelector('[data-hd-install]')
    const autoCheck = row.querySelector('[data-hd-auto]')
    if (checkButton.disabled !== Boolean(state.checking || state.installing)) checkButton.disabled = Boolean(state.checking || state.installing)
    const canInstall = Boolean(state.app?.updateAvailable && state.app?.installer && state.app?.checksums)
    if (installButton.hidden === canInstall) installButton.hidden = !canInstall
    if (installButton.disabled !== Boolean(state.installing)) installButton.disabled = Boolean(state.installing)
    setText(installButton, state.installing ? '正在更新…' : progress?.phase === 'ready' ? '安装已下载的更新' : '下载并安装桌面版更新')
    if (autoCheck.checked !== (state.preferences?.checkOnStartup !== false)) autoCheck.checked = state.preferences?.checkOnStartup !== false
    const release = row.querySelector('[data-hd-release]')
    const releaseHidden = !state.app?.updateAvailable || !state.app?.url || canInstall
    if (release.hidden !== releaseHidden) release.hidden = releaseHidden
    const releaseUrl = state.app?.url || ''
    if (release.dataset.url !== releaseUrl) release.dataset.url = releaseUrl
    const links = state.distribution?.links || {}
    for (const [name, url] of Object.entries({ privacy: links.privacy, aiReport: links.aiReport, pluginPolicy: links.pluginPolicy })) {
      const link = row.querySelector(`[data-hd-policy="${name}"]`)
      if (!link) continue
      link.hidden = !url
      link.dataset.url = url || ''
    }
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
    const remoteLabel = remote.active === 'wss-relay' ? 'WSS/443' : remote.active === 'easytier' ? 'EasyTier' : remote.active === 'tailscale' ? 'Tailscale' : ''
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
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
    if (!dialog) return
    const configButton = [...dialog.querySelectorAll('button')].find(button => /打开配置文件|Open configuration file/i.test(button.textContent || ''))
    if (configButton && !configButton.dataset.hdDesktopOpen) {
      configButton.dataset.hdDesktopOpen = 'true'
      configButton.addEventListener('click', event => {
        event.preventDefault()
        event.stopImmediatePropagation()
        request('open-config-file')
      }, true)
    }
    const general = [...dialog.querySelectorAll('nav button')].find(button => /通用设置|General/i.test(button.textContent || ''))
    if (!general || general.getAttribute('aria-current') !== 'true') return
    const slot = dialog.querySelector('[data-slot="settings.general.item"]')
    const content = dialog.querySelector(':scope > nav + div')
    const options = content?.lastElementChild
    const section = slot?.parentElement || options?.firstElementChild || options
    mountMobile(section)
    if (!section || section.querySelector('#harness-desktop-update-row')) {
      paint()
      return
    }

    const row = document.createElement('div')
    row.id = 'harness-desktop-update-row'
    row.innerHTML = `
      <div class="hd-update-head">
        <div>
          <div class="hd-update-title">桌面版与 Harness 更新</div>
          <div class="hd-update-status" data-hd-status>启动后会自动检查更新</div>
        </div>
      </div>
      <div class="hd-update-lines">
        <div class="hd-update-line"><span>Harness Desktop</span><strong data-hd-app>等待首次检查</strong></div>
        <div class="hd-update-line"><span>DeepSeek Harness 官方核心</span><strong data-hd-harness>等待首次检查</strong></div>
      </div>
      <div class="hd-update-notes" data-hd-notes hidden><strong>新版本更新内容</strong><ul></ul></div>
      <div class="hd-update-actions">
        <button type="button" data-hd-check>立即检查</button>
        <button type="button" data-hd-install hidden>下载并安装桌面版更新</button>
        <a href="#" data-hd-release hidden>打开桌面版下载页</a>
        <label><input type="checkbox" data-hd-auto checked /> 启动时自动检查</label>
      </div>
      <div class="hd-policy-links">
        <a href="#" data-hd-policy="privacy">隐私政策</a>
        <a href="#" data-hd-policy="aiReport">举报不当 AI 内容</a>
        <a href="#" data-hd-policy="pluginPolicy">插件内容规则</a>
      </div>
    `
    row.querySelector('[data-hd-check]').addEventListener('click', () => request('check-updates'))
    row.querySelector('[data-hd-install]').addEventListener('click', () => request('install-update'))
    row.querySelector('[data-hd-release]').addEventListener('click', event => {
      event.preventDefault()
      request('open-release', { url: event.currentTarget.dataset.url || '' })
    })
    row.querySelector('[data-hd-auto]').addEventListener('change', event => request('auto-check', { enabled: event.currentTarget.checked ? '1' : '0' }))
    row.querySelectorAll('[data-hd-policy]').forEach(link => link.addEventListener('click', event => {
      event.preventDefault()
      request('open-external', { url: event.currentTarget.dataset.url || '' })
    }))
    section.appendChild(row)
    paint()
  }

  window.__HARNESS_DESKTOP_RENDER_UPDATES__ = () => {
    mount()
    paint()
    paintMobile()
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

async function publishUpdateState() {
  if (!runtimeView.getURL()) return
  const serialized = JSON.stringify(updateState).replaceAll('<', '\\u003c')
  await runtimeView.executeJavaScript(`window.__HARNESS_DESKTOP_UPDATE_STATE__ = ${serialized}; window.__HARNESS_DESKTOP_RENDER_UPDATES__?.();`, true).catch(() => {})
}

async function publishMobileSyncState() {
  if (!runtimeView.getURL()) return
  const serialized = JSON.stringify(mobileSyncState).replaceAll('<', '\\u003c')
  await runtimeView.executeJavaScript(`window.__HARNESS_DESKTOP_MOBILE_SYNC_STATE__ = ${serialized}; window.__HARNESS_DESKTOP_RENDER_MOBILE_SYNC__?.();`, true).catch(() => {})
}

async function publishAppearanceState() {
  applyShellTheme()
  applyShellUiMode()
  await themeIntegration.publish(runtimeView, appearanceState, themeCatalog).catch(() => {})
}

async function publishModelRoutingState() {
  await modelRoutingIntegration.publish(runtimeView, modelRoutingState).catch(() => {})
}

async function checkUpdates({ forceNotice = false } = {}) {
  updateState = { ...updateState, checking: true, installError: '' }
  await publishUpdateState()
  try {
    const result = await api.checkUpdates()
    const componentState = result.component || null
    updateState = { ...updateState, ...result, checking: false, installError: '' }
    pendingUpdateKind = 'installer'
    pendingComponentUpdate = null
    if (!showComponentUpdateNotice(componentState, { force: forceNotice })) showUpdateNotice(result.app, { force: forceNotice })
  } catch (error) {
    updateState = { ...updateState, checking: false, app: { error: error.message }, harness: updateState.harness }
  }
  await publishUpdateState()
}

async function installUpdate() {
  updateState = { ...updateState, installing: true, installError: '', installProgress: { phase: 'checksum' } }
  await publishUpdateState()
  try {
    const component = pendingUpdateKind === 'components'
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
  await publishMobileSyncState()
  await publishAppearanceState()
  await publishModelRoutingState()
  startupWebviewReady = true
})

runtimeView.addEventListener('will-navigate', event => {
  let target
  try { target = new URL(event.url) } catch { return }
  if (target.protocol !== 'harness-desktop:') return
  event.preventDefault()
  if (target.hostname === 'check-updates') {
    checkUpdates({ forceNotice: true })
  } else if (target.hostname === 'install-update') {
    installUpdate()
  } else if (target.hostname === 'auto-check') {
    const enabled = target.searchParams.get('enabled') !== '0'
    api.setUpdatePreferences({ checkOnStartup: enabled }).then(preferences => {
      updateState = { ...updateState, preferences }
      publishUpdateState()
    })
  } else if (target.hostname === 'open-release') {
    const url = target.searchParams.get('url')
    if (url) api.openExternal(url).catch(() => {})
  } else if (target.hostname === 'open-external') {
    const url = target.searchParams.get('url')
    if (url) api.openExternal(url).catch(() => {})
  } else if (target.hostname === 'open-local') {
    const localPath = target.searchParams.get('path')
    const reveal = target.searchParams.get('reveal') === '1'
    if (localPath) api.openLocal(localPath, { reveal }).catch(() => {})
  } else if (target.hostname === 'open-config-file') {
    api.openHarnessSettings().catch(() => {})
  } else if (target.hostname === 'open-mobile-sync') {
    openMobileSync()
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
    api.saveModelRouting({
      main: {
        provider: target.searchParams.get('mainProvider') || '',
        model: target.searchParams.get('mainModel') || ''
      },
      subagent: {
        inheritMain: target.searchParams.get('subInherit') !== '0',
        provider: target.searchParams.get('subProvider') || '',
        model: target.searchParams.get('subModel') || ''
      },
      basePreset: modelRoutingState.basePreset
    }).then(state => {
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
    const fields = ['mode', 'accent', 'surface', 'text', 'wallpaperBrightness', 'wallpaperBlur', 'glassTransparency', 'borderStrength']
    api.saveCustomTheme(Object.fromEntries(fields.map(name => [name, target.searchParams.get(name)]))).then(state => {
      appearanceState = state
      publishAppearanceState()
    })
  } else if (target.hostname === 'choose-theme-background') {
    api.chooseThemeBackground().then(state => {
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
  if (url) api.openExternal(url).catch(() => {})
})
updateNoticeInstall.addEventListener('click', () => {
  updateNoticeOverlay.classList.add('hidden')
  updateNoticeOverlay.setAttribute('aria-hidden', 'true')
  installUpdate()
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
  if (event.key === 'Escape' && !mobileSyncOverlay.classList.contains('hidden')) closeMobileSync()
  if (event.key === 'Escape' && !updateReadyOverlay.classList.contains('hidden')) closeUpdateReady()
  if (event.key === 'Escape' && !updateNoticeOverlay.classList.contains('hidden')) closeUpdateNotice()
})
restoreOfficialThemeButton.addEventListener('click', async () => {
  appearanceState = await api.setTheme('official')
  appearanceState = await api.setUiPreferences({ uiMode: 'official', reducedMotion: false, lowPerformance: false })
  await publishAppearanceState()
  closeSkinPicker()
})
skinChooseBackgroundButton.addEventListener('click', async () => {
  appearanceState = await api.chooseThemeBackground()
  await publishAppearanceState()
  renderSkinPicker()
})
skinClearBackgroundButton.addEventListener('click', async () => {
  appearanceState = await api.clearThemeBackground()
  await publishAppearanceState()
  renderSkinPicker()
})
for (const field of Object.values(customThemeRangeFields)) {
  const input = document.querySelector(field.input)
  input.addEventListener('input', () => {
    document.querySelector(field.output).textContent = `${input.value}${field.suffix}`
  })
}
skinApplyCustomButton.addEventListener('click', async () => {
  appearanceState = await api.saveCustomTheme(readShellCustomTheme())
  await publishAppearanceState()
  closeSkinPicker()
})

api.onRuntimeState(renderRuntimeState)
api.onMobileSyncState(state => {
  renderMobileSync(state)
  publishMobileSyncState()
})
api.onPetState(renderPetState)
api.onUpdateResult(result => {
  updateState = { ...updateState, ...result, checking: false }
  publishUpdateState()
  pendingUpdateKind = 'installer'
  pendingComponentUpdate = null
  if (!showComponentUpdateNotice(result.component)) showUpdateNotice(result.app)
})
api.onUpdateInstallProgress(progress => {
  updateState = { ...updateState, installing: progress?.phase !== 'ready', installError: '', installProgress: progress }
  publishUpdateState()
})
api.onComponentUpdateProgress(progress => {
  updateState = { ...updateState, installing: true, installError: '', installProgress: { kind: 'components', ...progress } }
  publishUpdateState()
})

async function startOfficialWorkspace() {
  distributionState = await api.getDistribution()
  updateState = { ...updateState, preferences: await api.getUpdatePreferences(), distribution: distributionState }
  appearanceState = await api.getAppearance()
  petState = await api.getPetState()
  const [routing, meters] = await Promise.all([api.getModelRouting(), api.getProviderMeters(false)])
  modelRoutingState = { ...routing, meters: { ...meters, loading: false, error: '' }, saving: false, saved: false, error: '' }
  mobileSyncState = await api.getMobileSyncState()
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
}

playStartupAnimation()
startOfficialWorkspace().catch(error => renderRuntimeState({ status: 'error', detail: error.message }))
