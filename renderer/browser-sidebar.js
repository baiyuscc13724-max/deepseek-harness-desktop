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
  const computerUseAuthorizationRefocus = document.querySelector('#computerUseAuthorizationRefocus')
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

  // 浏览器状态行：error → role=alert 播报；普通状态 → role=status。
  // 所有状态写入都必须走本函数，确保一次错误后普通成功不会残留 role=alert。
  function setBrowserStatus(text, { error = false } = {}) {
    statusText.textContent = text || ''
    statusText.setAttribute('role', error ? 'alert' : 'status')
  }

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

  // 授权重聚焦守卫：当授权卡显示而窗口处于/重新落入后台时，防止「首个用于重新
  // 激活窗口的鼠标点击」误触「本次授权/永久授权」。此时该次点击仅激活窗口并给出
  // 提示，用户需再次点击才能真正授权。键盘激活（event.detail === 0）始终放行；
  // 「拒绝/关闭」不会被视为授权，永远不会被吞掉。
  let authorizationRefocusArmed = false
  let authorizationRefocusDisarmTimer = 0

  function isRefocusDisarmed() {
    return !authorizationRefocusArmed || computerUseAuthorizationOverlay.classList.contains('hidden')
  }

  function disarmAuthorizationRefocusGuard() {
    if (authorizationRefocusDisarmTimer) { clearTimeout(authorizationRefocusDisarmTimer); authorizationRefocusDisarmTimer = 0 }
    authorizationRefocusArmed = false
    delete computerUseAuthorizationOverlay.dataset.refocus
    if (computerUseAuthorizationRefocus) {
      computerUseAuthorizationRefocus.hidden = true
      computerUseAuthorizationRefocus.textContent = ''
    }
  }

  function armAuthorizationRefocusGuard() {
    if (computerUseAuthorizationOverlay.classList.contains('hidden')) return
    if (authorizationRefocusDisarmTimer) { clearTimeout(authorizationRefocusDisarmTimer); authorizationRefocusDisarmTimer = 0 }
    authorizationRefocusArmed = true
    computerUseAuthorizationOverlay.dataset.refocus = 'true'
    if (computerUseAuthorizationRefocus) {
      computerUseAuthorizationRefocus.hidden = false
      computerUseAuthorizationRefocus.textContent = '窗口此前处于后台：首次点击仅用于重新激活窗口，不会触发授权；您可用键盘 Tab+Enter 直接操作。'
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
      disarmAuthorizationRefocusGuard()
      setComputerUseAuthorizationBusy(false)
    } else if (wasHidden) {
      computerUseAuthorizationStatus.textContent = ''
      // 卡刚显示：按当前窗口焦点状态立即套用守卫；随后窗口 blur 会再次套用。
      if (document.hasFocus()) disarmAuthorizationRefocusGuard()
      else armAuthorizationRefocusGuard()
      setTimeout(() => {
        if (isRefocusDisarmed()) computerUseAuthorizationSession.focus()
      }, 0)
    }
    if (wasHidden !== hidden) syncNativeVisibility().catch(() => {})
  }

  // 授权卡可见时窗口失焦＝用户随后很可能用鼠标点击授权卡来重新激活窗口。
  window.addEventListener('blur', () => {
    if (computerUseAuthorizationOverlay.classList.contains('hidden')) return
    // Re-arm even when already armed so a pending focus timer cannot disarm the
    // guard while the window is back in the background.
    armAuthorizationRefocusGuard()
  })

  // focus 事件本身不能作为安全依据（它早于重聚焦 click 触发），故延迟解除守卫，
  // 使真正来自卡片的重聚焦点击仍能被下方的 click 捕获关卡拦截。
  window.addEventListener('focus', () => {
    if (isRefocusDisarmed()) return
    if (authorizationRefocusDisarmTimer) clearTimeout(authorizationRefocusDisarmTimer)
    authorizationRefocusDisarmTimer = setTimeout(() => {
      authorizationRefocusDisarmTimer = 0
      disarmAuthorizationRefocusGuard()
    }, 400)
  })

  function refocusTargetIsGrantButton(target) {
    if (!target || typeof target.closest !== 'function') return false
    return Boolean(target.closest('#computerUseAuthorizationSession,#computerUseAuthorizationForever'))
  }

  // 捕获阶段 pointerdown：守卫未解除时不阻断事件，仅把窗口带到前台（激活反馈），
  // 实际的点击吞并由下方的 click 捕获关卡决定，避免 pointerdown 单独不足以保证
  // click 不触发。
  computerUseAuthorizationOverlay.addEventListener('pointerdown', event => {
    if (isRefocusDisarmed()) return
    if (event.pointerType && event.pointerType !== 'mouse') return
    if (!refocusTargetIsGrantButton(event.target)) return
    window.focus()
  }, true)

  // 捕获阶段 click：吞掉守卫下「首次鼠标点击授权按钮」的点击（event.detail > 0），
  // 拒绝/关闭不受影响；键盘激活（event.detail === 0）一律放行。
  computerUseAuthorizationOverlay.addEventListener('click', event => {
    if (isRefocusDisarmed()) return
    if (!(event.detail > 0)) return // 键盘（Enter/Space）触发的 click 放行
    if (!refocusTargetIsGrantButton(event.target)) return // 拒绝/关闭不被吞
    event.preventDefault()
    event.stopPropagation()
    disarmAuthorizationRefocusGuard()
    window.focus()
    computerUseAuthorizationStatus.textContent = '窗口已重新激活；请再次点击选择授权方式（键盘 Tab+Enter 可直接操作）。'
  }, true)

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
      ? '停止 AI 控制'
      : authorized
        ? '恢复 AI 控制'
        : ready
          ? '允许 AI 控制'
          : '暂不可开启'
    computerUseToggle.title = enabled
      ? '同时停止右栏浏览器与内置 Computer Use；授权有效期保持不变'
      : authorized
        ? '同一授权已经生效，点击后同时恢复右栏浏览器与内置 Computer Use'
        : '点击后在对话框上方选择本次授权或永久授权；两处共用一次授权'
    computerUseRevokePermanent.classList.toggle('hidden', scope !== 'forever')
    computerUseSessionState.textContent = enabled
      ? unlimited
        ? `会话状态：浏览器控制与无限制 Computer Use 已开启${generation}（${scope === 'forever' ? '永久授权' : '本次授权'}）；浏览器敏感信息硬限制仍保留。`
        : `会话状态：浏览器与受限 Computer Use 已开启${generation}。`
      : ready
        ? authorized
          ? `会话状态：共享控制已停止但授权仍有效（${scope === 'forever' ? '永久授权' : '本次运行'}）；无需再次授权即可恢复。`
          : '会话状态：等待一次共享授权；模型请求浏览器或桌面控制时都会弹出同一张授权卡片。'
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
      setBrowserStatus(scope === 'forever'
        ? '浏览器控制与 Computer Use 已永久授权，应用重启后自动生效。'
        : '浏览器控制与 Computer Use 已完成本次共享授权。')
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
      setBrowserStatus('已拒绝本次 Computer Use 授权请求。')
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
    clearSiteConfirm.disabled = resetting
    clearAllConfirm.disabled = resetting
    clearSite.disabled = resetting || !clearSiteConfirm.checked
    clearAll.disabled = resetting || !clearAllConfirm.checked
    setComputerUsePolicyControlsDisabled(resetting)
    reloadButton.textContent = state.loading ? '×' : '↻'
    reloadButton.setAttribute('aria-label', state.loading ? '停止加载' : '刷新')
    if (document.activeElement !== address && state.url) address.value = state.url
    profileOrigin.textContent = state.origin || '尚未打开站点'
    loginState.textContent = state.hasSiteData ? '本站会话数据已保存在独立 Profile' : '未检测到本站 Cookie'
    const authorizationCount = Number(state.authorizations?.count) || 0
    const auditCount = Number(state.audit?.count) || 0
    const control = state.control || {}
    const sharedState = control.active
      ? `共享控制已开启（${control.scope === 'forever' ? '永久授权' : '本次授权'}）`
      : control.granted
        ? '共享控制已停止，授权仍有效'
        : '等待共享 Computer Use 授权'
    privacySummary.textContent = `${sharedState}；本次运行保留 ${auditCount} 条脱敏审计元数据${authorizationCount ? `；兼容保留 ${authorizationCount} 个旧版站点授权` : ''}。`
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
    setBrowserStatus(resetting ? '正在安全重置独立 Profile，浏览与模型操作已暂停…' : state.error || (state.title ? `${state.title} · 独立 Profile` : '独立 Profile · 用户可直接登录'), { error: !resetting && Boolean(state.error) })
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
      setBrowserStatus(error.message || String(error), { error: true })
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
    setBrowserStatus('正在打开…')
    try { render(await api.navigateBrowser(value)) }
    catch (error) { setBrowserStatus(error.message || String(error), { error: true }) }
    finally { goButton.disabled = false }
  }

  quickButton.addEventListener('click', () => {
    const workspace = window.harnessDesktopRightWorkspace
    if (!workspace) return open()
    if (workspace.controller?.isOpen()) return close()
    return workspace.openHome?.() || open()
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
    setBrowserStatus('浏览历史已清空。')
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
        setBrowserStatus('浏览器控制与 Computer Use 已同时停止；授权有效期保持不变。')
      } else if (current.authorization?.scope && current.authorization.scope !== 'none') {
        renderComputerUse(await api.setComputerUseEnabled(true))
        setBrowserStatus('浏览器控制与 Computer Use 已通过同一授权恢复。')
      } else {
        renderComputerUse(await api.requestComputerUseAuthorization())
        setBrowserStatus('已推送浏览器控制与 Computer Use 共用的授权卡片。')
      }
    } catch (error) {
      setBrowserStatus(error.message || String(error), { error: true })
    }
  })
  computerUseRevokePermanent.addEventListener('click', async () => {
    try {
      renderComputerUse(await api.revokeComputerUsePermanentGrant())
      setBrowserStatus('浏览器控制与 Computer Use 的永久共享授权已撤销，控制会话已停止。')
    } catch (error) {
      setBrowserStatus(error.message || String(error), { error: true })
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
  clearSiteConfirm.addEventListener('change', () => { clearSite.disabled = state.profileResetting === true || !clearSiteConfirm.checked })
  clearAllConfirm.addEventListener('change', () => { clearAll.disabled = state.profileResetting === true || !clearAllConfirm.checked })
  clearSite.addEventListener('click', async () => {
    if (!clearSiteConfirm.checked) return
    clearSite.disabled = true
    try {
      render(await api.clearBrowserSiteData({ confirmed: true }))
      clearSiteConfirm.checked = false
      setBrowserStatus('已清除当前站点登录数据。')
    } catch (error) {
      setBrowserStatus(error.message || String(error), { error: true })
      clearSite.disabled = !clearSiteConfirm.checked
    }
  })
  clearAll.addEventListener('click', async () => {
    if (!clearAllConfirm.checked) return
    clearAll.disabled = true
    try {
      render(await api.clearAllBrowserData({ confirmed: true }))
      clearAllConfirm.checked = false
      setBrowserStatus('独立浏览器 Profile 已重置。')
    } catch (error) {
      setBrowserStatus(error.message || String(error), { error: true })
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

  window.harnessDesktopBrowserSidebar = Object.freeze({ open, close, setStatus: setBrowserStatus })
})()
