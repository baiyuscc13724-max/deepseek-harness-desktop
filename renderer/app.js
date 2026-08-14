const api = window.desktopHarness
const runtimeView = document.querySelector('#runtimeView')
const runtimeStatus = document.querySelector('#runtimeStatus')
const runtimeStatusTitle = document.querySelector('#runtimeStatusTitle')
const runtimeStatusDetail = document.querySelector('#runtimeStatusDetail')
const retryRuntime = document.querySelector('#retryRuntime')

let updateState = {
  checking: false,
  installing: false,
  installProgress: null,
  installError: '',
  app: null,
  harness: null,
  preferences: { checkOnStartup: true, channel: 'stable', lastCheckedAt: null }
}
let appearanceState = { themeId: 'official', customTheme: {}, customBackgroundDataUrl: null }
let themeCatalog = []
const themeIntegration = window.harnessThemeIntegration

function renderRuntimeState(state) {
  if (state?.status === 'ready' && state.url) {
    if (runtimeView.src !== state.url) runtimeView.src = state.url
    runtimeStatus.classList.add('ready')
    retryRuntime.classList.add('hidden')
    return
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
    #harness-desktop-update-row .hd-update-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:12px; }
    #harness-desktop-update-row button, #harness-desktop-update-row a { box-sizing:border-box; min-height:34px; border:0; border-radius:17px; padding:6px 14px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-module-platform); font:inherit; font-size:13px; text-decoration:none; cursor:pointer; }
    #harness-desktop-update-row button:hover, #harness-desktop-update-row a:hover { background:var(--dsw-alias-interactive-bg-hover); }
    #harness-desktop-update-row button:disabled { cursor:default; opacity:.55; }
    #harness-desktop-update-row label { display:flex; align-items:center; gap:7px; margin-left:auto; color:var(--dsw-alias-label-secondary); font-size:12px; cursor:pointer; }
  `
  document.head.appendChild(style)

  const versionText = result => {
    if (!result) return '等待首次检查'
    if (result.error) return `检查失败：${result.error}`
    const current = result.currentVersion || '未知'
    const latest = result.latestVersion || current
    return result.updateAvailable ? `${current} → ${latest}（有新版）` : `${current}（已是最新）`
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
    const status = progress?.phase === 'ready'
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
      <div class="hd-update-actions">
        <button type="button" data-hd-check>立即检查</button>
        <button type="button" data-hd-install hidden>下载并安装桌面版更新</button>
        <a href="#" data-hd-release hidden>打开桌面版下载页</a>
        <label><input type="checkbox" data-hd-auto checked /> 启动时自动检查</label>
      </div>
    `
    row.querySelector('[data-hd-check]').addEventListener('click', () => request('check-updates'))
    row.querySelector('[data-hd-install]').addEventListener('click', () => request('install-update'))
    row.querySelector('[data-hd-release]').addEventListener('click', event => {
      event.preventDefault()
      request('open-release', { url: event.currentTarget.dataset.url || '' })
    })
    row.querySelector('[data-hd-auto]').addEventListener('change', event => request('auto-check', { enabled: event.currentTarget.checked ? '1' : '0' }))
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

async function publishUpdateState() {
  if (!runtimeView.getURL()) return
  const serialized = JSON.stringify(updateState).replaceAll('<', '\\u003c')
  await runtimeView.executeJavaScript(`window.__HARNESS_DESKTOP_UPDATE_STATE__ = ${serialized}; window.__HARNESS_DESKTOP_RENDER_UPDATES__?.();`, true).catch(() => {})
}

async function publishAppearanceState() {
  await themeIntegration.publish(runtimeView, appearanceState, themeCatalog).catch(() => {})
}

async function checkUpdates() {
  updateState = { ...updateState, checking: true }
  await publishUpdateState()
  try {
    const result = await api.checkUpdates()
    updateState = { ...updateState, ...result, checking: false }
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
    if (result?.deferred) {
      updateState = { ...updateState, installing: false, installProgress: { phase: 'ready', version: result.version } }
      await publishUpdateState()
    }
  } catch (error) {
    updateState = { ...updateState, installing: false, installError: error.message, installProgress: null }
    await publishUpdateState()
  }
}

runtimeView.addEventListener('dom-ready', async () => {
  await runtimeView.executeJavaScript(`(${officialSettingsBootstrap.toString()})()`, true).catch(() => {})
  await themeIntegration.install(runtimeView).catch(() => {})
  await publishUpdateState()
  await publishAppearanceState()
})

runtimeView.addEventListener('will-navigate', event => {
  let target
  try { target = new URL(event.url) } catch { return }
  if (target.protocol !== 'harness-desktop:') return
  event.preventDefault()
  if (target.hostname === 'check-updates') {
    checkUpdates()
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
  } else if (target.hostname === 'open-config-file') {
    api.openHarnessSettings().catch(() => {})
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

api.onRuntimeState(renderRuntimeState)
api.onUpdateResult(result => {
  updateState = { ...updateState, ...result, checking: false }
  publishUpdateState()
})
api.onUpdateInstallProgress(progress => {
  updateState = { ...updateState, installing: progress?.phase !== 'ready', installError: '', installProgress: progress }
  publishUpdateState()
})

async function startOfficialWorkspace() {
  updateState = { ...updateState, preferences: await api.getUpdatePreferences() }
  appearanceState = await api.getAppearance()
  const themeAssets = await api.getThemeAssets()
  themeCatalog = themeIntegration.prepareCatalog(window.harnessDesktopThemes || [], themeAssets)
  const initial = await api.getRuntimeState()
  renderRuntimeState(initial)
  if (initial.status !== 'ready') renderRuntimeState(await api.startRuntime({}))
}

startOfficialWorkspace().catch(error => renderRuntimeState({ status: 'error', detail: error.message }))
