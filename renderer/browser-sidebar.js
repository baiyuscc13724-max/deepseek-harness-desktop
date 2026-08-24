(() => {
  const api = window.desktopHarness
  const quickButton = document.querySelector('#browserQuickButton')
  const sidebar = document.querySelector('#browserSidebar')
  if (!api || !quickButton || !sidebar) return

  const closeButton = document.querySelector('#closeBrowserSidebar')
  const tabs = document.querySelector('#browserTabs')
  const newTabButton = document.querySelector('#browserNewTab')
  const resizeHandle = document.querySelector('#browserResizeHandle')
  const wideModeButton = document.querySelector('#browserWideMode')
  const historyButton = document.querySelector('#browserHistoryButton')
  const downloadsButton = document.querySelector('#browserDownloadsButton')
  const profileButton = document.querySelector('#browserProfileButton')
  const profilePanel = document.querySelector('#browserProfilePanel')
  const historyPanel = document.querySelector('#browserHistoryPanel')
  const downloadsPanel = document.querySelector('#browserDownloadsPanel')
  const historySearchForm = document.querySelector('#browserHistorySearchForm')
  const historySearch = document.querySelector('#browserHistorySearch')
  const historyResults = document.querySelector('#browserHistoryResults')
  const historyClearConfirm = document.querySelector('#browserHistoryClearConfirm')
  const historyClear = document.querySelector('#browserHistoryClear')
  const downloadResults = document.querySelector('#browserDownloadResults')
  const closeHistory = document.querySelector('#closeBrowserHistory')
  const closeDownloads = document.querySelector('#closeBrowserDownloads')
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
  const computerUseRevokePermanent = document.querySelector('#computerUseRevokePermanent')
  const computerUseSessionState = document.querySelector('#computerUseSessionState')
  const computerUsePending = document.querySelector('#computerUsePending')
  const computerUseAuthorizationOverlay = document.querySelector('#computerUseAuthorizationOverlay')
  const computerUseAuthorizationClose = document.querySelector('#computerUseAuthorizationClose')
  const computerUseAuthorizationSession = document.querySelector('#computerUseAuthorizationSession')
  const computerUseAuthorizationForever = document.querySelector('#computerUseAuthorizationForever')
  const computerUseAuthorizationDecline = document.querySelector('#computerUseAuthorizationDecline')
  const computerUseAuthorizationStatus = document.querySelector('#computerUseAuthorizationStatus')
  const computerUsePolicyControls = document.querySelector('#computerUsePolicyControls')
  const computerUseDefaultAccess = document.querySelector('#computerUseDefaultAccess')
  const computerUseCurrentTarget = document.querySelector('#computerUseCurrentTarget')
  const computerUseAppList = document.querySelector('#computerUseAppList')
  const computerUsePolicyMessage = document.querySelector('#computerUsePolicyMessage')
  const clearSiteConfirm = document.querySelector('#browserClearSiteConfirm')
  const clearSite = document.querySelector('#browserClearSite')
  const clearAllConfirm = document.querySelector('#browserClearAllConfirm')
  const privacySummary = document.querySelector('#browserPrivacySummary')
  const clearAll = document.querySelector('#browserClearAll')
  let state = { visible: false, loading: false, url: '', origin: '', canGoBack: false, canGoForward: false, hasSiteData: false }

  const modalOverlays = [
    '#storageOverlay', '#memoryOverlay', '#mobileSyncOverlay', '#skinPickerOverlay',
    '#computerUseAuthorizationOverlay', '#updateReadyOverlay', '#updateNoticeOverlay'
  ].map(selector => document.querySelector(selector)).filter(Boolean)

  function anotherOverlayVisible() {
    return modalOverlays.some(element => !element.classList.contains('hidden'))
  }

  const utilityPanels = [profilePanel, historyPanel, downloadsPanel]

  function activeUtilityPanel() {
    return utilityPanels.find(panel => !panel.classList.contains('hidden')) || null
  }

  async function syncNativeVisibility() {
    if (!state.visible) return
    const showPage = !activeUtilityPanel() && !anotherOverlayVisible()
    await api.setBrowserContentVisible(showPage).catch(() => {})
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0)
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  }

  function stateFromResult(result) {
    return result?.state || result || {}
  }

  async function showPanel(panel) {
    const opening = panel.classList.contains('hidden')
    for (const item of utilityPanels) item.classList.add('hidden')
    if (opening) panel.classList.remove('hidden')
    historyButton.setAttribute('aria-expanded', String(opening && panel === historyPanel))
    downloadsButton.setAttribute('aria-expanded', String(opening && panel === downloadsPanel))
    await syncNativeVisibility()
    if (!opening) return
    if (panel === historyPanel) {
      renderHistory((await api.searchBrowserHistory(historySearch.value)).entries || [])
      historySearch.focus()
    } else if (panel === downloadsPanel) {
      renderDownloads(state.downloads || [])
      closeDownloads.focus()
    }
  }

  function renderTabs(items = []) {
    tabs.replaceChildren()
    for (const item of items) {
      const tab = document.createElement('div')
      tab.className = 'browser-tab'
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(item.id === state.activeTabId))
      tab.dataset.tabId = item.id
      const title = document.createElement('span')
      title.className = 'browser-tab-title'
      title.textContent = item.title || '新标签页'
      title.title = item.url || item.title || '新标签页'
      title.addEventListener('click', async () => render(stateFromResult(await api.switchBrowserTab(item.id))))
      const close = document.createElement('button')
      close.className = 'browser-tab-close'
      close.type = 'button'
      close.textContent = '×'
      close.setAttribute('aria-label', `关闭 ${item.title || '标签页'}`)
      close.addEventListener('click', async event => {
        event.stopPropagation()
        render(stateFromResult(await api.closeBrowserTab(item.id)))
      })
      tab.append(title, close)
      tabs.append(tab)
    }
  }

  function renderHistory(entries = []) {
    historyResults.replaceChildren()
    if (!entries.length) {
      const empty = document.createElement('p'); empty.className = 'browser-utility-empty'; empty.textContent = '没有匹配的浏览历史'; historyResults.append(empty); return
    }
    for (const entry of entries) {
      const row = document.createElement('article'); row.className = 'browser-utility-item'
      const title = document.createElement('strong'); title.textContent = entry.title || entry.url
      const url = document.createElement('span'); url.textContent = entry.url; url.title = entry.url
      const actions = document.createElement('div'); actions.className = 'browser-utility-actions'
      const reopen = document.createElement('button'); reopen.type = 'button'; reopen.textContent = '打开'
      reopen.addEventListener('click', async () => { render(stateFromResult(await api.openBrowserHistory(entry.id))); await showPanel(historyPanel) })
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'
      remove.addEventListener('click', async () => renderHistory((await api.removeBrowserHistory(entry.id)).entries || []))
      actions.append(reopen, remove); row.append(title, url, actions); historyResults.append(row)
    }
  }

  function renderDownloads(items = []) {
    downloadResults.replaceChildren()
    if (!items.length) {
      const empty = document.createElement('p'); empty.className = 'browser-utility-empty'; empty.textContent = '本次运行还没有下载'; downloadResults.append(empty); return
    }
    for (const item of [...items].reverse()) {
      const row = document.createElement('article'); row.className = 'browser-utility-item'
      const title = document.createElement('strong'); title.textContent = item.filename || '下载文件'
      const status = document.createElement('small')
      const labels = { progressing: '下载中', completed: '已完成', cancelled: '已取消', interrupted: '已中断' }
      status.textContent = `${labels[item.state] || item.state || '等待中'} · ${formatBytes(item.receivedBytes)}${item.totalBytes ? ` / ${formatBytes(item.totalBytes)}` : ''}${item.modelInitiated ? ' · 模型发起' : ''}`
      row.append(title, status)
      if (item.totalBytes > 0 && item.state === 'progressing') {
        const progress = document.createElement('progress'); progress.max = item.totalBytes; progress.value = Math.min(item.receivedBytes || 0, item.totalBytes); row.append(progress)
      }
      downloadResults.append(row)
    }
  }

  let computerUsePolicyUnavailable = false

  function setComputerUseAuthorizationBusy(busy) {
    for (const button of [computerUseAuthorizationClose, computerUseAuthorizationSession, computerUseAuthorizationForever, computerUseAuthorizationDecline]) {
      if (button) button.disabled = Boolean(busy)
    }
  }

  function renderComputerUseAuthorization(session) {
    const pending = session?.authorization?.pending || null
    const wasHidden = computerUseAuthorizationOverlay.classList.contains('hidden')
    const hidden = !pending
    computerUseAuthorizationOverlay.classList.toggle('hidden', hidden)
    computerUseAuthorizationOverlay.setAttribute('aria-hidden', String(hidden))
    computerUseAuthorizationOverlay.dataset.requestId = pending?.id || ''
    if (hidden) {
      computerUseAuthorizationStatus.textContent = ''
      setComputerUseAuthorizationBusy(false)
    } else if (wasHidden) {
      computerUseAuthorizationStatus.textContent = ''
      setTimeout(() => computerUseAuthorizationSession.focus(), 0)
    }
    if (wasHidden !== hidden) syncNativeVisibility().catch(() => {})
  }

  function renderComputerUseSession(session) {
    const enabled = session?.enabled === true
    const ready = session?.ready !== false
    const unlimited = session?.unlimited === true || session?.authorization?.unlimited === true
    const scope = String(session?.authorization?.scope || 'none')
    const authorized = scope === 'session' || scope === 'forever'
    const generation = session?.generation ? ` · 会话 #${session.generation}` : ''
    computerUseToggle.disabled = !enabled && !ready
    computerUseToggle.dataset.activation = 'approval-card'
    computerUseToggle.textContent = enabled
      ? '停止并由用户接管'
      : authorized
        ? '恢复无限制桌面控制'
        : ready
          ? '请求无限制桌面控制'
          : '暂不可开启'
    computerUseToggle.title = enabled
      ? '立即停止当前桌面控制会话；授权有效期保持不变'
      : authorized
        ? '授权已经生效，点击后无需再次确认即可恢复控制'
        : '点击后在对话框上方选择本次授权或永久授权'
    computerUseRevokePermanent.classList.toggle('hidden', scope !== 'forever')
    computerUseSessionState.textContent = enabled
      ? unlimited
        ? `会话状态：无限制桌面控制已开启${generation}（${scope === 'forever' ? '永久授权' : '本次授权'}）；不再逐次确认，应用策略和原有硬禁令均不拦截。`
        : `会话状态：受限控制已开启${generation}。`
      : ready
        ? authorized
          ? `会话状态：已停止但授权仍有效（${scope === 'forever' ? '永久授权' : '本次运行'}）；模型再次请求时可直接恢复。`
          : '会话状态：等待授权；模型请求控制时将在对话框上方弹出授权卡片。'
        : '会话状态：暂不可开启；请先解锁桌面后重试。'
  }

  function renderComputerUsePending(items = []) {
    computerUsePending.replaceChildren()
    for (const item of items) {
      const row = document.createElement('div')
      const text = document.createElement('span')
      text.textContent = item.summary
      if (item.confirmed) {
        const mark = document.createElement('strong')
        mark.textContent = '已允许'
        row.append(text, mark)
      } else {
        const allow = document.createElement('button')
        allow.textContent = '本次允许'
        allow.addEventListener('click', async () => renderComputerUse(await api.confirmComputerUseAction(item.id)))
        const reject = document.createElement('button')
        reject.textContent = '拒绝'
        reject.addEventListener('click', async () => renderComputerUse(await api.rejectComputerUseAction(item.id)))
        row.append(text, allow, reject)
      }
      computerUsePending.append(row)
    }
  }

  function renderComputerUse(value) {
    renderComputerUseSession(value)
    renderComputerUseAuthorization(value)
    renderComputerUsePending(value?.pending || [])
  }

  async function resolveComputerUseAuthorization(scope) {
    setComputerUseAuthorizationBusy(true)
    computerUseAuthorizationStatus.textContent = scope === 'forever' ? '正在保存永久授权…' : '正在开启本次授权…'
    try {
      renderComputerUse(await api.authorizeComputerUse(scope))
      statusText.textContent = scope === 'forever'
        ? '永久无限制桌面控制已授权，应用重启后自动生效。'
        : '本次运行的无限制桌面控制已授权。'
    } catch (error) {
      computerUseAuthorizationStatus.textContent = error.message || String(error)
    } finally {
      setComputerUseAuthorizationBusy(false)
    }
  }

  async function declineComputerUseAuthorization() {
    setComputerUseAuthorizationBusy(true)
    try {
      renderComputerUse(await api.declineComputerUseAuthorization())
      statusText.textContent = '已拒绝本次 Computer Use 授权请求。'
    } catch (error) {
      computerUseAuthorizationStatus.textContent = error.message || String(error)
    } finally {
      setComputerUseAuthorizationBusy(false)
    }
  }

  function setComputerUsePolicyControlsDisabled(disabled) {
    const effective = disabled || computerUsePolicyUnavailable
    computerUseDefaultAccess.disabled = effective
    for (const control of computerUsePolicyControls.querySelectorAll('select, button')) control.disabled = effective
  }

  function renderComputerUsePolicyUnavailable(reason) {
    computerUsePolicyUnavailable = true
    setComputerUsePolicyControlsDisabled(true)
    computerUseDefaultAccess.value = 'ask'
    computerUseCurrentTarget.textContent = '当前目标：不可用'
    computerUseAppList.replaceChildren()
    const notice = document.createElement('p')
    notice.className = 'computer-use-app-empty'
    notice.textContent = '策略后端未接通：仅显示会话状态，跨应用访问策略编辑暂不可用。'
    computerUseAppList.append(notice)
    computerUsePolicyMessage.textContent = `能力不可用原因：${reason}`
    computerUsePolicyMessage.classList.add('is-error')
  }

  function renderComputerUsePolicy(policy) {
    const state = stateFromResult(policy)
    computerUsePolicyUnavailable = false
    const defaultAccess = ['ask', 'allow', 'deny'].includes(state.defaultAccess) ? state.defaultAccess : 'ask'
    computerUseDefaultAccess.value = defaultAccess
    const target = state.currentTarget
    computerUseCurrentTarget.textContent = target
      ? `当前目标：${target.app || '未知应用'}${target.window ? ` · ${target.window}` : ''}${target.reason ? `（${target.reason}）` : ''}`
      : '当前目标：无（没有应用正在被模型访问）'
    computerUseAppList.replaceChildren()
    for (const app of state.apps || []) {
      const row = document.createElement('article')
      row.className = 'computer-use-app-row'
      const name = document.createElement('strong')
      name.textContent = app.name || app.id || '未知应用'
      const meta = document.createElement('span')
      meta.textContent = app.executable || ''
      const reason = document.createElement('small')
      reason.textContent = app.reason || (app.decision ? '' : '跟随默认应用访问')
      row.append(name, meta)
      if (app.immutable) {
        const lock = document.createElement('span')
        lock.className = 'computer-use-app-lock'
        lock.textContent = '受限模式禁止'
        row.append(lock, reason)
      } else {
        const decision = document.createElement('select')
        for (const [value, label] of [['default', '跟随默认'], ['allow', '始终允许'], ['deny', '始终拒绝']]) {
          const option = document.createElement('option')
          option.value = value
          option.textContent = label
          if (String(app.decision || 'default') === value) option.selected = true
          decision.append(option)
        }
        decision.addEventListener('change', async () => {
          try {
            renderComputerUsePolicy(await api.setComputerUseAppOverride(app.id, decision.value))
            computerUsePolicyMessage.textContent = `已保存 ${name.textContent} 的访问策略。`
            computerUsePolicyMessage.classList.remove('is-error')
          } catch (error) {
            computerUsePolicyMessage.textContent = `保存失败：${error.message || String(error)}`
            computerUsePolicyMessage.classList.add('is-error')
          }
        })
        const revoke = document.createElement('button')
        revoke.type = 'button'
        revoke.textContent = '撤销持久授权'
        revoke.disabled = !app.decision
        revoke.addEventListener('click', async () => {
          try {
            renderComputerUsePolicy(await api.revokeComputerUseAppOverride(app.id))
            computerUsePolicyMessage.textContent = `已撤销 ${name.textContent} 的持久授权，恢复跟随默认。`
            computerUsePolicyMessage.classList.remove('is-error')
          } catch (error) {
            computerUsePolicyMessage.textContent = `撤销失败：${error.message || String(error)}`
            computerUsePolicyMessage.classList.add('is-error')
          }
        })
        row.append(decision, revoke, reason)
      }
      computerUseAppList.append(row)
    }
    if (!(state.apps || []).length) {
      const empty = document.createElement('p')
      empty.className = 'computer-use-app-empty'
      empty.textContent = '还没有任何应用的持久授权记录。'
      computerUseAppList.append(empty)
    }
    const capability = state.capability
    if (capability && capability.available === false) {
      computerUsePolicyMessage.textContent = `能力不可用原因：${capability.reason || '原生跨应用后端不可用'}`
      computerUsePolicyMessage.classList.add('is-error')
    } else {
      computerUsePolicyMessage.classList.remove('is-error')
    }
  }

  async function refreshComputerUsePolicy() {
    if (typeof api.getComputerUsePolicy !== 'function') {
      renderComputerUsePolicyUnavailable('可选 preload 策略 API 尚未接通')
      return
    }
    try {
      renderComputerUsePolicy(await api.getComputerUsePolicy())
    } catch (error) {
      renderComputerUsePolicyUnavailable(error.message || String(error))
    }
  }

  function render(next) {
    state = { ...state, ...next }
    const visible = state.visible === true
    const resetting = state.profileResetting === true
    const workspace = window.harnessDesktopRightWorkspace
    if (workspace) workspace.syncBrowserState(state)
    else {
      sidebar.classList.toggle('hidden', !visible)
      sidebar.setAttribute('aria-hidden', String(!visible))
      quickButton.setAttribute('aria-expanded', String(visible))
      document.body.classList.toggle('browser-sidebar-open', visible)
    }
    if (Number.isFinite(Number(state.panelWidth))) document.documentElement.style.setProperty('--browser-panel-width', `${Number(state.panelWidth)}px`)
    wideModeButton.setAttribute('aria-pressed', String(state.wideMode === true))
    wideModeButton.textContent = state.wideMode ? '▣' : '□'
    wideModeButton.setAttribute('aria-label', state.wideMode ? '退出宽屏验收模式' : '进入宽屏验收模式')
    renderTabs(state.tabs || [])
    renderDownloads(state.downloads || [])
    if (!historyPanel.classList.contains('hidden') && Array.isArray(state.history) && !historySearch.value.trim()) renderHistory(state.history)
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
    setComputerUsePolicyControlsDisabled(resetting)
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
      const workspace = window.harnessDesktopRightWorkspace
      if (workspace) {
        await workspace.openMode('browser')
        render(await api.getBrowserState())
      } else render(await api.setBrowserVisible(true))
      await syncNativeVisibility()
      address.focus()
      address.select()
    } catch (error) {
      statusText.textContent = error.message || String(error)
    }
  }

  async function close() {
    for (const panel of utilityPanels) panel.classList.add('hidden')
    historyButton.setAttribute('aria-expanded', 'false')
    downloadsButton.setAttribute('aria-expanded', 'false')
    const workspace = window.harnessDesktopRightWorkspace
    if (workspace) await workspace.close('browser-close')
    else render(await api.setBrowserVisible(false).catch(() => ({ visible: false })))
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

  quickButton.addEventListener('click', () => {
    const workspace = window.harnessDesktopRightWorkspace
    if (workspace?.controller?.isOpen() && workspace.controller.getActiveModeId() === 'browser') close()
    else open()
  })
  if (!window.harnessDesktopRightWorkspace) closeButton.addEventListener('click', close)
  newTabButton.addEventListener('click', async () => {
    render(stateFromResult(await api.newBrowserTab('')))
    address.focus()
    address.select()
  })
  wideModeButton.addEventListener('click', async () => render(await api.setBrowserWideMode(!state.wideMode)))
  historyButton.addEventListener('click', () => showPanel(historyPanel))
  downloadsButton.addEventListener('click', () => showPanel(downloadsPanel))
  closeHistory.addEventListener('click', () => showPanel(historyPanel))
  closeDownloads.addEventListener('click', () => showPanel(downloadsPanel))
  historySearchForm.addEventListener('submit', async event => {
    event.preventDefault()
    renderHistory((await api.searchBrowserHistory(historySearch.value)).entries || [])
  })
  historyClearConfirm.addEventListener('change', () => { historyClear.disabled = !historyClearConfirm.checked })
  historyClear.addEventListener('click', async () => {
    if (!historyClearConfirm.checked) return
    render(await api.clearBrowserHistory({ confirmed: true }))
    historyClearConfirm.checked = false
    historyClear.disabled = true
    renderHistory([])
    statusText.textContent = '浏览历史已清空。'
  })
  let resizing = false
  resizeHandle.addEventListener('pointerdown', event => {
    resizing = true
    resizeHandle.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  })
  resizeHandle.addEventListener('pointermove', event => {
    if (!resizing) return
    document.documentElement.style.setProperty('--browser-panel-width', `${Math.max(360, Math.min(1200, window.innerWidth - event.clientX))}px`)
  })
  resizeHandle.addEventListener('pointerup', async event => {
    if (!resizing) return
    resizing = false
    resizeHandle.releasePointerCapture?.(event.pointerId)
    render(await api.setBrowserPanelWidth(window.innerWidth - event.clientX))
  })
  resizeHandle.addEventListener('keydown', async event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? 24 : -24
    render(await api.setBrowserPanelWidth((Number(state.panelWidth) || 640) + delta))
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !computerUseAuthorizationOverlay.classList.contains('hidden')) {
      event.preventDefault()
      declineComputerUseAuthorization()
      return
    }
    if (!(event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'b')) return
    event.preventDefault()
    const workspace = window.harnessDesktopRightWorkspace
    if (workspace?.controller?.isOpen() && workspace.controller.getActiveModeId() === 'browser') close()
    else open()
  })
  addressForm.addEventListener('submit', event => { event.preventDefault(); navigate() })
  goButton.addEventListener('click', navigate)
  backButton.addEventListener('click', async () => render(await api.browserBack()))
  forwardButton.addEventListener('click', async () => render(await api.browserForward()))
  reloadButton.addEventListener('click', async () => render(state.loading ? await api.stopBrowser() : await api.reloadBrowser()))
  stopButton.addEventListener('click', async () => render(await api.stopBrowser()))
  profileButton.addEventListener('click', async () => {
    await showPanel(profilePanel)
    if (profilePanel.classList.contains('hidden')) return profileButton.focus()
    clearSiteConfirm.checked = false
    clearAllConfirm.checked = false
    clearSite.disabled = true
    clearAll.disabled = true
    renderComputerUse(await api.getComputerUseState())
    await refreshComputerUsePolicy()
    closeProfile.focus()
  })
  closeProfile.addEventListener('click', async () => {
    await showPanel(profilePanel)
    profileButton.focus()
  })
  computerUseToggle.addEventListener('click', async () => {
    try {
      const current = await api.getComputerUseState()
      if (current.enabled) {
        renderComputerUse(await api.setComputerUseEnabled(false))
        statusText.textContent = 'Computer Use 已停止，控制权已交还用户；授权有效期保持不变。'
      } else if (current.authorization?.scope && current.authorization.scope !== 'none') {
        renderComputerUse(await api.setComputerUseEnabled(true))
        statusText.textContent = '无限制桌面控制已恢复。'
      } else {
        renderComputerUse(await api.requestComputerUseAuthorization())
        statusText.textContent = '已在对话框上方推送 Computer Use 授权卡片。'
      }
    } catch (error) {
      statusText.textContent = error.message || String(error)
    }
  })
  computerUseRevokePermanent.addEventListener('click', async () => {
    try {
      renderComputerUse(await api.revokeComputerUsePermanentGrant())
      statusText.textContent = '永久 Computer Use 授权已撤销，控制会话已停止。'
    } catch (error) {
      statusText.textContent = error.message || String(error)
    }
  })
  computerUseAuthorizationSession.addEventListener('click', () => resolveComputerUseAuthorization('session'))
  computerUseAuthorizationForever.addEventListener('click', () => resolveComputerUseAuthorization('forever'))
  computerUseAuthorizationDecline.addEventListener('click', declineComputerUseAuthorization)
  computerUseAuthorizationClose.addEventListener('click', declineComputerUseAuthorization)
  computerUseDefaultAccess.addEventListener('change', async () => {
    if (typeof api.setComputerUseDefaultAccess !== 'function') {
      computerUsePolicyMessage.textContent = '能力不可用原因：可选 preload 策略 API 尚未接通'
      computerUsePolicyMessage.classList.add('is-error')
      refreshComputerUsePolicy()
      return
    }
    try {
      renderComputerUsePolicy(await api.setComputerUseDefaultAccess(computerUseDefaultAccess.value))
      computerUsePolicyMessage.textContent = '默认应用访问策略已保存。'
      computerUsePolicyMessage.classList.remove('is-error')
    } catch (error) {
      computerUsePolicyMessage.textContent = `保存失败：${error.message || String(error)}`
      computerUsePolicyMessage.classList.add('is-error')
    }
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
  if (typeof api.onComputerUseAuthorization === 'function') api.onComputerUseAuthorization(renderComputerUse)
  api.getComputerUseState().then(renderComputerUse).catch(() => {})
  api.onBrowserState(render)
  api.getBrowserState().then(render).catch(() => {})

  window.harnessDesktopBrowserSidebar = Object.freeze({ open, close })
})()
