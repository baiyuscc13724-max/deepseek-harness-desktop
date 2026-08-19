(() => {
  const api = window.desktopHarness
  const quickButton = document.querySelector('#browserQuickButton')
  const sidebar = document.querySelector('#browserSidebar')
  if (!api || !quickButton || !sidebar) return

  const closeButton = document.querySelector('#closeBrowserSidebar')
  const profileButton = document.querySelector('#browserProfileButton')
  const profilePanel = document.querySelector('#browserProfilePanel')
  const closeProfile = document.querySelector('#closeBrowserProfile')
  const backButton = document.querySelector('#browserBack')
  const forwardButton = document.querySelector('#browserForward')
  const reloadButton = document.querySelector('#browserReload')
  const stopButton = document.querySelector('#browserStop')
  const addressForm = document.querySelector('#browserAddressForm')
  const address = document.querySelector('#browserAddress')
  const goButton = document.querySelector('#browserGo')
  const loading = document.querySelector('#browserLoading')
  const statusText = document.querySelector('#browserStatusText')
  const profileOrigin = document.querySelector('#browserProfileOrigin')
  const loginState = document.querySelector('#browserLoginState')
  const grantCurrent = document.querySelector('#browserGrantCurrent')
  const revokeCurrent = document.querySelector('#browserRevokeCurrent')
  const resumeModel = document.querySelector('#browserResumeModel')
  const pendingActions = document.querySelector('#browserPendingActions')
  const computerUseToggle = document.querySelector('#computerUseToggle')
  const computerUsePending = document.querySelector('#computerUsePending')
  const clearSiteConfirm = document.querySelector('#browserClearSiteConfirm')
  const clearSite = document.querySelector('#browserClearSite')
  const clearAllConfirm = document.querySelector('#browserClearAllConfirm')
  const privacySummary = document.querySelector('#browserPrivacySummary')
  const clearAll = document.querySelector('#browserClearAll')
  let state = { visible: false, loading: false, url: '', origin: '', canGoBack: false, canGoForward: false, hasSiteData: false }

  const modalOverlays = [
    '#storageOverlay', '#memoryOverlay', '#mobileSyncOverlay', '#skinPickerOverlay',
    '#updateReadyOverlay', '#updateNoticeOverlay'
  ].map(selector => document.querySelector(selector)).filter(Boolean)

  function anotherOverlayVisible() {
    return modalOverlays.some(element => !element.classList.contains('hidden'))
  }

  async function syncNativeVisibility() {
    if (!state.visible) return
    const showPage = profilePanel.classList.contains('hidden') && !anotherOverlayVisible()
    await api.setBrowserContentVisible(showPage).catch(() => {})
  }

  function renderComputerUse(value) {
    computerUseToggle.textContent = value.enabled ? '停止并由用户接管' : '开启本次控制'
    computerUsePending.replaceChildren()
    for (const item of value.pending || []) {
      const row = document.createElement('div'); const text = document.createElement('span'); text.textContent = item.summary
      if (item.confirmed) { const mark = document.createElement('strong'); mark.textContent = '已允许'; row.append(text, mark) }
      else {
        const allow = document.createElement('button'); allow.textContent = '本次允许'; allow.addEventListener('click', async () => renderComputerUse(await api.confirmComputerUseAction(item.id)))
        const reject = document.createElement('button'); reject.textContent = '拒绝'; reject.addEventListener('click', async () => renderComputerUse(await api.rejectComputerUseAction(item.id)))
        row.append(text, allow, reject)
      }
      computerUsePending.append(row)
    }
  }

  function render(next) {
    state = { ...state, ...next }
    const visible = state.visible === true
    const resetting = state.profileResetting === true
    sidebar.classList.toggle('hidden', !visible)
    sidebar.setAttribute('aria-hidden', String(!visible))
    quickButton.setAttribute('aria-expanded', String(visible))
    document.body.classList.toggle('browser-sidebar-open', visible)
    loading.classList.toggle('is-loading', state.loading === true)
    backButton.disabled = resetting || !state.canGoBack
    forwardButton.disabled = resetting || !state.canGoForward
    reloadButton.disabled = resetting
    stopButton.disabled = resetting
    address.disabled = resetting
    goButton.disabled = resetting
    grantCurrent.disabled = resetting
    revokeCurrent.disabled = resetting
    resumeModel.disabled = resetting
    clearSiteConfirm.disabled = resetting
    clearAllConfirm.disabled = resetting
    clearSite.disabled = resetting || !clearSiteConfirm.checked
    clearAll.disabled = resetting || !clearAllConfirm.checked
    for (const checkbox of document.querySelectorAll('.browser-model-permissions input[type="checkbox"]')) checkbox.disabled = resetting
    reloadButton.textContent = state.loading ? '×' : '↻'
    reloadButton.setAttribute('aria-label', state.loading ? '停止加载' : '刷新')
    if (document.activeElement !== address && state.url) address.value = state.url
    profileOrigin.textContent = state.origin || '尚未打开站点'
    loginState.textContent = state.hasSiteData ? '本站会话数据已保存在独立 Profile' : '未检测到本站 Cookie'
    const currentAuth = state.authorizations?.entries?.find(entry => entry.origin === state.origin)
    for (const checkbox of document.querySelectorAll('.browser-model-permissions input[type="checkbox"]')) checkbox.checked = currentAuth?.actions?.includes(checkbox.value) || checkbox.value === 'read' && !currentAuth
    revokeCurrent.disabled = resetting || !currentAuth
    const authorizationCount = Number(state.authorizations?.count) || 0
    const auditCount = Number(state.audit?.count) || 0
    privacySummary.textContent = `已保存 ${authorizationCount} 个模型站点授权；本次运行保留 ${auditCount} 条脱敏审计元数据。`
    resumeModel.disabled = resetting || !state.modelControlStopped
    pendingActions.replaceChildren()
    for (const pending of state.pendingConfirmations || []) {
      const row = document.createElement('div')
      const text = document.createElement('span')
      text.textContent = `${pending.action} · ${pending.summary || pending.origin}`
      if (pending.confirmed) {
        const allowed = document.createElement('strong')
        allowed.textContent = '已允许，等待模型继续'
        row.append(text, allowed)
      } else {
        const confirm = document.createElement('button')
        confirm.textContent = '本次允许'
        confirm.addEventListener('click', async () => { await api.confirmBrowserModelAction(pending.id); render(await api.getBrowserState()) })
        const reject = document.createElement('button')
        reject.textContent = '拒绝'
        reject.addEventListener('click', async () => { await api.rejectBrowserModelAction(pending.id); render(await api.getBrowserState()) })
        row.append(text, confirm, reject)
      }
      pendingActions.append(row)
    }
    statusText.textContent = resetting ? '正在安全重置独立 Profile，浏览与模型操作已暂停…' : state.error || (state.title ? `${state.title} · 独立 Profile` : '独立 Profile · 用户可直接登录')
  }

  async function open() {
    try {
      render(await api.setBrowserVisible(true))
      await syncNativeVisibility()
      address.focus()
      address.select()
    } catch (error) {
      statusText.textContent = error.message || String(error)
    }
  }

  async function close() {
    profilePanel.classList.add('hidden')
    render(await api.setBrowserVisible(false).catch(() => ({ visible: false })))
    quickButton.focus()
  }

  async function navigate() {
    const value = address.value.trim()
    if (!value) return
    goButton.disabled = true
    statusText.textContent = '正在打开…'
    try { render(await api.navigateBrowser(value)) }
    catch (error) { statusText.textContent = error.message || String(error) }
    finally { goButton.disabled = false }
  }

  quickButton.addEventListener('click', () => state.visible ? close() : open())
  closeButton.addEventListener('click', close)
  addressForm.addEventListener('submit', event => { event.preventDefault(); navigate() })
  goButton.addEventListener('click', navigate)
  backButton.addEventListener('click', async () => render(await api.browserBack()))
  forwardButton.addEventListener('click', async () => render(await api.browserForward()))
  reloadButton.addEventListener('click', async () => render(state.loading ? await api.stopBrowser() : await api.reloadBrowser()))
  stopButton.addEventListener('click', async () => render(await api.stopBrowser()))
  profileButton.addEventListener('click', async () => {
    profilePanel.classList.remove('hidden')
    clearSiteConfirm.checked = false
    clearAllConfirm.checked = false
    clearSite.disabled = true
    clearAll.disabled = true
    await syncNativeVisibility()
    renderComputerUse(await api.getComputerUseState())
    closeProfile.focus()
  })
  closeProfile.addEventListener('click', async () => {
    profilePanel.classList.add('hidden')
    await syncNativeVisibility()
    profileButton.focus()
  })
  computerUseToggle.addEventListener('click', async () => {
    const current = await api.getComputerUseState()
    renderComputerUse(await api.setComputerUseEnabled(!current.enabled))
    statusText.textContent = current.enabled ? 'Computer Use 已停止，控制权已交还用户。' : 'Computer Use 已开启；每个输入动作仍需确认。'
  })
  grantCurrent.addEventListener('click', async () => {
    const actions = [...document.querySelectorAll('.browser-model-permissions input[type="checkbox"]:checked')].map(input => input.value)
    try { render(await api.grantCurrentBrowserOrigin(actions)); statusText.textContent = '当前站点模型权限已授权 2 小时。' }
    catch (error) { statusText.textContent = error.message || String(error) }
  })
  revokeCurrent.addEventListener('click', async () => {
    render(await api.revokeCurrentBrowserOrigin())
    statusText.textContent = '当前站点模型权限已撤销。'
  })
  resumeModel.addEventListener('click', async () => {
    render(await api.resumeBrowserModelControl())
    statusText.textContent = '模型浏览器控制已恢复；仍需按站点授权。'
  })
  clearSiteConfirm.addEventListener('change', () => { clearSite.disabled = state.profileResetting === true || !clearSiteConfirm.checked })
  clearAllConfirm.addEventListener('change', () => { clearAll.disabled = state.profileResetting === true || !clearAllConfirm.checked })
  clearSite.addEventListener('click', async () => {
    if (!clearSiteConfirm.checked) return
    clearSite.disabled = true
    try {
      render(await api.clearBrowserSiteData({ confirmed: true }))
      clearSiteConfirm.checked = false
      statusText.textContent = '已清除当前站点登录数据。'
    } catch (error) {
      statusText.textContent = error.message || String(error)
      clearSite.disabled = !clearSiteConfirm.checked
    }
  })
  clearAll.addEventListener('click', async () => {
    if (!clearAllConfirm.checked) return
    clearAll.disabled = true
    try {
      render(await api.clearAllBrowserData({ confirmed: true }))
      clearAllConfirm.checked = false
      statusText.textContent = '独立浏览器 Profile 已重置。'
    } catch (error) {
      statusText.textContent = error.message || String(error)
      clearAll.disabled = !clearAllConfirm.checked
    }
  })

  for (const element of modalOverlays) {
    new MutationObserver(syncNativeVisibility).observe(element, { attributes: true, attributeFilter: ['class'] })
  }
  api.onBrowserState(render)
  api.getBrowserState().then(render).catch(() => {})

  window.harnessDesktopBrowserSidebar = Object.freeze({ open, close })
})()
