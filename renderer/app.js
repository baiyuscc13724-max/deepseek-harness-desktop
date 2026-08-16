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
const closeSkinPickerButton = document.querySelector('#closeSkinPicker')
const restoreOfficialThemeButton = document.querySelector('#restoreOfficialTheme')
const skinChooseBackgroundButton = document.querySelector('#skinChooseBackground')
const skinApplyCustomButton = document.querySelector('#skinApplyCustom')
const skinBackgroundState = document.querySelector('#skinBackgroundState')
const updateReadyOverlay = document.querySelector('#updateReadyOverlay')
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
let appearanceState = { themeId: 'porcelain-mist', customTheme: {}, customBackgroundDataUrl: null }
let petState = {
  status: 'idle', fullness: 80, inventory: { refined: 0, standard: 0, fragments: 0 },
  preferences: { enabled: true, awake: false, alwaysOnTop: true, autoFeed: true }
}
let modelRoutingState = { main: {}, subagent: { inheritMain: true }, providers: [], saving: false, saved: false, error: '' }
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
  if (theme.id === 'custom' && appearanceState.customBackgroundDataUrl) return `url("${appearanceState.customBackgroundDataUrl}") center/cover`
  return theme.preview
}

function applyShellTheme() {
  const theme = themeCatalog.find(entry => entry.id === appearanceState.themeId)
  const root = document.documentElement
  if (!theme || theme.id === 'official') {
    root.removeAttribute('data-shell-theme')
    root.style.removeProperty('color-scheme')
    for (const name of ['--shell-surface', '--shell-layer', '--shell-layer-2', '--shell-text', '--shell-text-secondary', '--shell-text-tertiary', '--shell-border', '--shell-hover', '--shell-accent', '--shell-overlay']) root.style.removeProperty(name)
    return
  }
  const custom = appearanceState.customTheme || {}
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches
  const mode = theme.id === 'custom' ? custom.mode : theme.mode === 'adaptive' ? (prefersDark ? 'dark' : 'light') : theme.mode
  const vars = theme.id === 'custom'
    ? {
        '--dsw-alias-bg-base': custom.surface,
        '--dsw-alias-bg-layer-1': custom.surface,
        '--dsw-alias-bg-layer-2': custom.surface,
        '--dsw-alias-label-primary': custom.text,
        '--dsw-alias-label-secondary': custom.text,
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
  const custom = appearanceState.customTheme || {}
  document.querySelector('#skinCustomMode').value = custom.mode || 'dark'
  document.querySelector('#skinCustomAccent').value = custom.accent || '#6f8cff'
  document.querySelector('#skinCustomSurface').value = custom.surface || '#171b29'
  document.querySelector('#skinCustomText').value = custom.text || '#f4f7ff'
  skinBackgroundState.textContent = appearanceState.customBackgroundDataUrl ? '已选择本地背景图' : '未选择背景图，将使用渐变背景'
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

function showUpdateReady(version) {
  applyShellTheme()
  updateReadyDetail.textContent = `Harness Desktop ${version || '新版本'} 已经下载并通过安全校验。`
  updateLaunchError.textContent = ''
  updateNowButton.disabled = false
  updateNowButton.textContent = '立即安装'
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
  `
  document.head.appendChild(style)

  const versionText = result => {
    if (!result) return '等待首次检查'
    if (result.storeManaged) return `${result.currentVersion || '当前版本'}（由 Microsoft Store 管理）`
    if (result.error) return `检查失败：${result.error}`
    const current = result.currentVersion || '未知'
    const latest = result.latestVersion || current
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
    const hasUpdate = Boolean(state.app?.updateAvailable || state.harness?.updateAvailable)
    const failed = Boolean(state.app?.error || state.harness?.error)
    const checked = state.preferences?.lastCheckedAt
    const progress = state.installProgress
    const percent = progress?.total ? Math.min(100, Math.round(progress.received * 100 / progress.total)) : 0
    const status = state.app?.storeManaged && !state.installing && !state.installError
      ? state.checking ? '正在检查官方 Harness 更新…' : '桌面应用更新由 Microsoft Store 管理'
      : progress?.phase === 'ready'
        ? '更新已在后台下载完成，等待安装确认'
        : state.installing
      ? progress?.phase === 'checksum'
        ? '正在验证桌面版更新…'
        : progress?.phase === 'launch'
          ? '校验完成，正在启动中文升级程序…'
          : `正在下载桌面版更新${percent ? `：${percent}%` : '…'}`
      : state.installError
        ? `桌面版更新失败：${state.installError}`
        : state.checking
          ? '正在检查桌面版和官方 Harness…'
          : hasUpdate
            ? '检测到新版本'
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
    if (existing) return
    const label = document.createElement('span')
    label.className = 'hd-subagent-detail-label'
    label.textContent = '子代理详情 · 实时会话'
    label.title = '这里显示子代理正在执行的完整过程；点击左侧上级会话可返回。'
    hierarchy.insertAdjacentElement('afterend', label)
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

async function publishAppearanceState() {
  applyShellTheme()
  await themeIntegration.publish(runtimeView, appearanceState, themeCatalog).catch(() => {})
}

async function publishModelRoutingState() {
  await modelRoutingIntegration.publish(runtimeView, modelRoutingState).catch(() => {})
}

async function checkUpdates({ forceNotice = false } = {}) {
  updateState = { ...updateState, checking: true }
  await publishUpdateState()
  try {
    const result = await api.checkUpdates()
    updateState = { ...updateState, ...result, checking: false }
    showUpdateNotice(result.app, { force: forceNotice })
  } catch (error) {
    updateState = { ...updateState, checking: false, app: { error: error.message }, harness: updateState.harness }
  }
  await publishUpdateState()
}

async function installUpdate() {
  updateState = { ...updateState, installing: true, installError: '', installProgress: { phase: 'checksum' } }
  await publishUpdateState()
  try {
    const result = await api.installUpdate()
    if (result?.ready) {
      updateState = { ...updateState, installing: false, installProgress: { phase: 'ready', version: result.version } }
      await publishUpdateState()
      showUpdateReady(result.version)
    }
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
  } else if (target.hostname === 'refresh-model-routing') {
    api.getModelRouting().then(state => {
      modelRoutingState = { ...state, saving: false, saved: false, error: '' }
      publishModelRoutingState()
    }).catch(error => {
      modelRoutingState = { ...modelRoutingState, saving: false, saved: false, error: error.message }
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
      modelRoutingState = { ...state, saving: false, saved: true, error: '' }
      publishModelRoutingState()
    }).catch(error => {
      modelRoutingState = { ...modelRoutingState, saving: false, saved: false, error: error.message }
      publishModelRoutingState()
    })
  } else if (target.hostname === 'set-theme') {
    api.setTheme(target.searchParams.get('id') || 'official').then(state => {
      appearanceState = state
      publishAppearanceState()
    })
  } else if (target.hostname === 'save-custom-theme') {
    api.saveCustomTheme(Object.fromEntries(['mode', 'accent', 'surface', 'text'].map(name => [name, target.searchParams.get(name)]))).then(state => {
      appearanceState = state
      publishAppearanceState()
    })
  } else if (target.hostname === 'choose-theme-background') {
    api.chooseThemeBackground().then(state => {
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
    await api.launchReadyUpdate()
  } catch (error) {
    updateNowButton.disabled = false
    updateNowButton.textContent = '立即安装'
    updateLaterButton.disabled = false
    updateLaunchError.textContent = error.message
  }
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !petPanel.classList.contains('hidden')) closePetPanel()
  if (event.key === 'Escape' && !skinPickerOverlay.classList.contains('hidden')) closeSkinPicker()
  if (event.key === 'Escape' && !updateReadyOverlay.classList.contains('hidden')) closeUpdateReady()
  if (event.key === 'Escape' && !updateNoticeOverlay.classList.contains('hidden')) closeUpdateNotice()
})
restoreOfficialThemeButton.addEventListener('click', async () => {
  appearanceState = await api.setTheme('official')
  await publishAppearanceState()
  closeSkinPicker()
})
skinChooseBackgroundButton.addEventListener('click', async () => {
  appearanceState = await api.chooseThemeBackground()
  await publishAppearanceState()
  renderSkinPicker()
})
skinApplyCustomButton.addEventListener('click', async () => {
  appearanceState = await api.saveCustomTheme({
    mode: document.querySelector('#skinCustomMode').value,
    accent: document.querySelector('#skinCustomAccent').value,
    surface: document.querySelector('#skinCustomSurface').value,
    text: document.querySelector('#skinCustomText').value
  })
  await publishAppearanceState()
  closeSkinPicker()
})

api.onRuntimeState(renderRuntimeState)
api.onPetState(renderPetState)
api.onUpdateResult(result => {
  updateState = { ...updateState, ...result, checking: false }
  publishUpdateState()
  showUpdateNotice(result.app)
})
api.onUpdateInstallProgress(progress => {
  updateState = { ...updateState, installing: progress?.phase !== 'ready', installError: '', installProgress: progress }
  publishUpdateState()
})

async function startOfficialWorkspace() {
  distributionState = await api.getDistribution()
  updateState = { ...updateState, preferences: await api.getUpdatePreferences(), distribution: distributionState }
  appearanceState = await api.getAppearance()
  petState = await api.getPetState()
  modelRoutingState = { ...await api.getModelRouting(), saving: false, saved: false, error: '' }
  const themeAssets = await api.getThemeAssets()
  themeCatalog = themeIntegration.prepareCatalog(window.harnessDesktopThemes || [], themeAssets)
    .filter(theme => distributionState.nonCommercialContentAvailable || !theme.nonCommercial)
  petQuickButton.hidden = !distributionState.desktopPetAvailable
  if (!distributionState.desktopPetAvailable) petPanel.classList.add('hidden')
  applyShellTheme()
  renderPetState()
  renderSkinPicker()
  const initial = await api.getRuntimeState()
  renderRuntimeState(initial)
  if (initial.status !== 'ready') renderRuntimeState(await api.startRuntime({}))
}

playStartupAnimation()
startOfficialWorkspace().catch(error => renderRuntimeState({ status: 'error', detail: error.message }))
