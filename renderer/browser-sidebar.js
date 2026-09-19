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
  const computerUseAuthorizationOverlay = document.querySelector('#computerUseAuthorizationOverlay')
  const computerUseAuthorizationClose = document.querySelector('#computerUseAuthorizationClose')
  const computerUseAuthorizationSession = document.querySelector('#computerUseAuthorizationSession')
  const computerUseAuthorizationForever = document.querySelector('#computerUseAuthorizationForever')
  const computerUseAuthorizationDecline = document.querySelector('#computerUseAuthorizationDecline')
  const computerUseAuthorizationStatus = document.querySelector('#computerUseAuthorizationStatus')
  const computerUseAuthorizationRefocus = document.querySelector('#computerUseAuthorizationRefocus')
  const clearSiteConfirm = document.querySelector('#browserClearSiteConfirm')
  const clearSite = document.querySelector('#browserClearSite')
  const clearAllConfirm = document.querySelector('#browserClearAllConfirm')
  const privacySummary = document.querySelector('#browserPrivacySummary')
  const clearAll = document.querySelector('#browserClearAll')
  let state = { visible: false, loading: false, url: '', origin: '', canGoBack: false, canGoForward: false, hasSiteData: false }

  let commandSequence = 0
  let pendingCommand = null
  const pendingResolutions = new Set()
  let commandError = ''
  let commandErrorKey = ''
  let addressComposing = false
  let addressDirty = false
  let tabsSignature = ''

  // Keep layout changes local: native page bounds rely on the existing toolbar heights.
  const interactionStyle = document.createElement('style')
  interactionStyle.textContent = `
    #browserTabs .browser-tab { flex-shrink:0; }
    #browserTabs .browser-tab:focus-visible { outline:2px solid var(--shell-accent); outline-offset:-2px; }
    #browserAddressForm { min-width:0; }
    #browserAddress { box-sizing:border-box; min-width:0; }
    #browserStatusText { min-width:0; }
    #browserSidebar .browser-toolbar button,#browserStop { flex-shrink:0; }
    #browserSidebar button:disabled { cursor:not-allowed; opacity:.5; }
    @media (prefers-reduced-motion:reduce) { #browserLoading.is-loading { animation:none; } }
  `
  document.head.append(interactionStyle)
  address.setAttribute('aria-describedby', 'browserStatusText')
  tabs.setAttribute('aria-label', '浏览器标签页')
  profileButton.setAttribute('aria-controls', 'browserProfilePanel')
  profileButton.setAttribute('aria-expanded', 'false')

  function displayAddress() {
    return state.url && state.url !== 'about:blank' ? state.url : ''
  }

  function errorMessage(error) {
    const message = String(error?.message || error || '')
    // Do not expose IPC stacks or echo a rejected address/search (it may contain secrets).
    if (/outcome-unknown|结果未知/i.test(message)) return '操作结果尚不确定，请先检查状态，不要重复提交。'
    if (/reference-stale|binding-stale/i.test(message)) return '页面引用已过期，请重新观察页面；不会重放旧操作。'
    if (/tab-unavailable|页面进程已停止|标签页不存在/i.test(message)) return '标签页已失效，请手动刷新或切换其他标签页。'
    if (/control-stopped|模型控制已停止/i.test(message)) return '模型控制已停止，不会自动恢复。'
    if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NETWORK/i.test(message)) return '网页连接失败，请检查网络或网址后重试。'
    if (/ERR_ABORTED|aborted|cancelled/i.test(message)) return '本次加载已取消，可重新输入网址或刷新。'
    if (/授权|authorization|grant/i.test(message)) return '控制授权不可用，请通过共享授权卡处理；不会自动重新授权。'
    if (/reset|重置/i.test(message)) return '浏览器正在重置，请完成后再试。'
    if (/scope|上下文/i.test(message)) return '当前控制上下文不可用，请返回会话检查状态；未执行恢复或重试。'
    if (/协议|网址|URL|navigate|navigation/i.test(message)) return '无法打开该地址，请检查网址；仅支持允许的网页地址。'
    return '操作未完成，请检查浏览器状态后重试。'
  }

  const independentActions = new Set()
  const independentSequences = { geometry: 0, history: 0 }
  async function runIndependentAction(key, label, action) {
    if (state.profileResetting || independentActions.has(key)) return false
    const group = key === 'clear-history' ? 'history' : 'geometry'
    const sequence = ++independentSequences[group]
    independentActions.add(key)
    if (!pendingCommand && !state.loading) setBrowserStatus(label)
    try {
      const next = stateFromResult(await action())
      if (sequence !== independentSequences[group] || state.profileResetting) return false
      // A width/history response may contain an old page snapshot. Never replay it.
      const patch = {}
      for (const field of group === 'geometry' ? ['panelWidth', 'wideMode'] : ['history']) {
        if (Object.prototype.hasOwnProperty.call(next, field)) patch[field] = next[field]
      }
      render(patch)
      return true
    } catch (error) {
      if (sequence === independentSequences[group]) setBrowserStatus(errorMessage(error), { error: true })
      return false
    } finally { independentActions.delete(key) }
  }

  async function runBrowserAction(key, label, action) {
    if (['wide-mode', 'resize', 'clear-history'].includes(key)) return runIndependentAction(key, label, action)
    if (state.profileResetting || pendingCommand?.key === key) return false
    const token = ++commandSequence
    pendingCommand = { key, label, token }
    commandError = ''
    commandErrorKey = ''
    render({})
    try {
      const result = await action()
      // A newer user action (especially Stop or tab switch) owns the visible result.
      if (token !== commandSequence) return false
      pendingCommand = null
      render(stateFromResult(result), { preserveAddressDraft: key === 'navigate' })
      return true
    } catch (error) {
      if (token === commandSequence) {
        pendingCommand = null
        commandError = errorMessage(error)
        commandErrorKey = key
        render({})
      }
      return false
    }
  }

  // 浏览器状态行：error → role=alert 播报；普通状态 → role=status。
  // 所有状态写入都必须走本函数，确保一次错误后普通成功不会残留 role=alert。
  function setBrowserStatus(text, { error = false } = {}) {
    statusText.setAttribute('role', error ? 'alert' : 'status')
    if (statusText.textContent !== (text || '')) statusText.textContent = text || ''
    statusText.title = text || ''
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
    await api.setBrowserContentVisible(showPage).catch(error => setBrowserStatus(errorMessage(error), { error: true }))
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

  let panelSequence = 0
  let historySequence = 0
  async function searchHistory() {
    const sequence = ++historySequence
    const query = historySearch.value
    try {
      const result = await api.searchBrowserHistory(query)
      if (sequence === historySequence && query === historySearch.value) renderHistory(result.entries || [])
    } catch (error) {
      if (sequence === historySequence) setBrowserStatus(errorMessage(error), { error: true })
    }
  }

  async function showPanel(panel) {
    const sequence = ++panelSequence
    const opening = panel.classList.contains('hidden')
    for (const item of utilityPanels) item.classList.add('hidden')
    if (opening) panel.classList.remove('hidden')
    historyButton.setAttribute('aria-expanded', String(opening && panel === historyPanel))
    downloadsButton.setAttribute('aria-expanded', String(opening && panel === downloadsPanel))
    profileButton.setAttribute('aria-expanded', String(opening && panel === profilePanel))
    await syncNativeVisibility()
    if (sequence !== panelSequence || anotherOverlayVisible()) return
    if (!opening) {
      const trigger = panel === historyPanel ? historyButton : panel === downloadsPanel ? downloadsButton : profileButton
      trigger.focus()
      return
    }
    if (panel === historyPanel) { historySearch.focus(); await searchHistory() }
    else if (panel === downloadsPanel) { renderDownloads(state.downloads || []); closeDownloads.focus() }
  }

  function focusTab(id = state.activeTabId) {
    const tab = [...tabs.children].find(element => element.dataset.tabId === id)
    if (tab) { tab.focus(); tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }
    else newTabButton.focus()
  }

  function renderTabs(items = []) {
    const signature = JSON.stringify([state.activeTabId, state.profileResetting, items.map(item => [item.id, item.title, item.url, item.loading])])
    if (signature === tabsSignature) return
    tabsSignature = signature
    const focused = document.activeElement
    const focusedTab = focused?.closest?.('.browser-tab')
    const focusedId = focusedTab?.dataset.tabId
    const focusedClose = focused?.classList?.contains('browser-tab-close')
    tabs.replaceChildren()
    for (const item of items) {
      const selected = item.id === state.activeTabId
      const tab = document.createElement('div')
      tab.className = 'browser-tab'
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(selected))
      tab.setAttribute('aria-label', `${item.title || '新标签页'}${item.loading ? '，加载中' : ''}`)
      tab.setAttribute('aria-disabled', String(state.profileResetting === true))
      tab.tabIndex = selected ? 0 : -1
      tab.dataset.tabId = item.id
      const activate = () => runBrowserAction('switch-tab', '正在切换标签页…', () => api.switchBrowserTab(item.id))
      const closeTab = () => runBrowserAction('close-tab', '正在关闭标签页…', () => api.closeBrowserTab(item.id))
      tab.addEventListener('click', activate)
      tab.addEventListener('keydown', event => {
        if (event.target !== tab || event.isComposing) return
        const index = items.findIndex(entry => entry.id === item.id)
        let target = null
        if (event.key === 'ArrowRight') target = items[(index + 1) % items.length]
        if (event.key === 'ArrowLeft') target = items[(index + items.length - 1) % items.length]
        if (event.key === 'Home') target = items[0]
        if (event.key === 'End') target = items.at(-1)
        if (target) { event.preventDefault(); focusTab(target.id) }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() }
        else if (event.key === 'Delete') { event.preventDefault(); closeTab() }
      })
      const title = document.createElement('span')
      title.className = 'browser-tab-title'
      title.textContent = item.title || '新标签页'
      title.title = item.url || item.title || '新标签页'
      const close = document.createElement('button')
      close.className = 'browser-tab-close'
      close.type = 'button'
      close.textContent = '×'
      close.disabled = state.profileResetting === true
      close.tabIndex = selected ? 0 : -1
      close.setAttribute('aria-label', `关闭 ${item.title || '标签页'}`)
      close.addEventListener('click', event => { event.stopPropagation(); closeTab() })
      tab.append(title, close)
      tabs.append(tab)
    }
    // Streaming titles/downloads must not drop keyboard focus onto the document body.
    if (focusedId) {
      const replacement = [...tabs.children].find(tab => tab.dataset.tabId === focusedId)
      if (replacement) (focusedClose ? replacement.querySelector('button') : replacement).focus()
      else focusTab()
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
      reopen.addEventListener('click', async () => {
        if (await runBrowserAction('history-open', '正在打开历史网页…', () => api.openBrowserHistory(entry.id))) {
          if (!historyPanel.classList.contains('hidden')) await showPanel(historyPanel)
        }
      })
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'
      remove.addEventListener('click', async () => {
        remove.disabled = true
        try { await api.removeBrowserHistory(entry.id); await searchHistory() }
        catch (error) { setBrowserStatus(errorMessage(error), { error: true }); remove.disabled = false }
      })
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

  function renderComputerUse(value) {
    renderComputerUseAuthorization(value)
  }

  async function resolveComputerUseAuthorization(scope) {
    setComputerUseAuthorizationBusy(true)
    computerUseAuthorizationStatus.textContent = scope === 'forever' ? '正在保存永久授权…' : '正在开启本次授权…'
    try {
      renderComputerUse(await api.authorizeComputerUse(scope))
      setBrowserStatus(scope === 'forever'
        ? '浏览器控制与 Computer Use 已永久开启；重启后会自动恢复共享控制。'
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

  function render(next, { preserveAddressDraft = false } = {}) {
    const hadAttention = state.attentionRequired === true
    const previousTabId = state.activeTabId
    const previousUrl = state.url
    state = { ...state, ...next }
    // The active tab snapshot wins over sticky aggregate URL/title/loading values.
    const activeTab = state.tabs?.find(tab => tab.id === state.activeTabId)
    if (Array.isArray(next?.tabs) && activeTab) {
      state.url = activeTab.url || ''
      state.title = activeTab.title || ''
      state.loading = activeTab.loading === true
    }
    if (state.profileResetting && pendingCommand) { ++commandSequence; pendingCommand = null }
    const initializingAddressNavigation = !previousTabId && pendingCommand?.key === 'navigate'
    if (state.profileResetting || (previousTabId !== state.activeTabId && !initializingAddressNavigation && !preserveAddressDraft)) addressDirty = false
    if (previousTabId !== state.activeTabId || previousUrl !== state.url) { commandError = ''; commandErrorKey = '' }
    const visible = state.visible === true
    const resetting = state.profileResetting === true
    const workspace = window.harnessDesktopRightWorkspace
    if (workspace) {
      workspace.syncBrowserState(state)
      if (!hadAttention && state.attentionRequired === true) workspace.openMode('browser', { nativeAlreadyVisible: true }).catch(() => {})
    } else {
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
    const busy = state.loading === true || pendingCommand?.key === 'navigate'
    loading.classList.toggle('is-loading', busy)
    addressForm.setAttribute('aria-busy', String(busy))
    backButton.disabled = resetting || !state.canGoBack
    forwardButton.disabled = resetting || !state.canGoForward
    reloadButton.disabled = resetting || (!state.activeTabId && !busy)
    stopButton.disabled = resetting || !busy
    stopButton.textContent = '停止加载'
    stopButton.title = '仅停止网页加载；不撤销共享控制授权'
    address.disabled = resetting
    goButton.disabled = resetting || pendingCommand?.key === 'navigate'
    newTabButton.disabled = resetting || pendingCommand?.key === 'new-tab'
    clearSiteConfirm.disabled = resetting
    clearAllConfirm.disabled = resetting
    clearSite.disabled = resetting || !clearSiteConfirm.checked
    clearAll.disabled = resetting || !clearAllConfirm.checked
    reloadButton.textContent = busy ? '×' : '↻'
    reloadButton.setAttribute('aria-label', busy ? '停止加载' : state.error || commandError ? '重试加载' : '刷新')
    reloadButton.title = reloadButton.getAttribute('aria-label')
    if (!addressDirty && !addressComposing) address.value = displayAddress()
    profileOrigin.textContent = state.origin || '尚未打开站点'
    loginState.textContent = state.hasSiteData ? '本站会话数据已保存在独立 Profile' : '未检测到本站 Cookie'
    const auditCount = Number(state.audit?.count) || 0
    const control = state.control || {}
    const sharedState = control.active
      ? `共享控制已开启（${control.scope === 'forever' ? '永久授权' : '本次授权'}）`
      : control.granted
        ? '共享控制已停止，授权仍有效'
        : '等待共享 Computer Use 授权'
    const browserSessionState = state.session?.surface === 'background'
      ? '浏览器会话正在后台运行（CDP/DOM 结构化通道）'
      : state.session?.surface === 'visible'
        ? '浏览器会话正在右栏预览（CDP/DOM 结构化通道）'
        : state.session?.surface === 'unavailable'
          ? '浏览器标签已失效，需要用户刷新或新建标签页'
          : '浏览器会话将在首次模型导航时后台启动'
    const attention = state.attentionRequired ? '；有关键动作等待本次允许或拒绝' : ''
    privacySummary.textContent = `${sharedState}；公网普通浏览动作无需按域名授权；${browserSessionState}；本次运行保留 ${auditCount} 条脱敏审计元数据${attention}。`
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
        const reject = document.createElement('button')
        reject.textContent = '拒绝'
        confirm.disabled = reject.disabled = pendingResolutions.has(pending.id)
        const resolve = async allowed => {
          if (pendingResolutions.has(pending.id)) return
          pendingResolutions.add(pending.id)
          confirm.disabled = reject.disabled = true
          let failure = ''
          let refreshed = null
          try {
            if (allowed) await api.confirmBrowserModelAction(pending.id)
            else await api.rejectBrowserModelAction(pending.id)
            refreshed = await api.getBrowserState()
          } catch (error) { failure = errorMessage(error) }
          finally {
            pendingResolutions.delete(pending.id)
            render(refreshed ? { pendingConfirmations: refreshed.pendingConfirmations } : {})
            if (failure) setBrowserStatus(failure, { error: true })
          }
        }
        confirm.addEventListener('click', () => resolve(true))
        reject.addEventListener('click', () => resolve(false))
        row.append(text, confirm, reject)
      }
      pendingActions.append(row)
    }
    const recovery = state.recovery || state.session?.recovery
    const recoveryLabels = {
      unavailable: '浏览器控制暂不可用，请检查会话状态。',
      'authorization-required': '模型控制等待共享授权；请使用共享授权卡。',
      stopped: '模型控制已停止，不会自动恢复；手动浏览仍可使用。',
      'not-started': '尚未打开网页，输入网址或新建标签页。',
      blank: '空白标签页，输入网址或搜索内容。',
      'tab-unavailable': '标签页已失效，请手动刷新或切换其他标签页。'
    }
    const hasPageError = Boolean(state.error)
    const failure = commandError || (hasPageError ? errorMessage(state.error) : '')
    const idle = recoveryLabels[recovery?.state] || (!displayAddress()
      ? '空白标签页，输入网址或搜索内容。'
      : `${state.title || '网页'} · ${state.session?.surface === 'background' ? '后台运行' : '独立 Profile'}`)
    const message = resetting ? '正在安全重置独立 Profile，浏览与模型操作已暂停…'
      : pendingCommand?.label || (busy ? '网页加载中，可停止加载或切换标签页…' : failure || idle)
    setBrowserStatus(message, { error: !resetting && !pendingCommand && !busy && Boolean(failure) })
  }

  async function open() {
    try {
      const workspace = window.harnessDesktopRightWorkspace
      if (workspace) {
        await workspace.openMode('browser')
        render(await api.getBrowserState())
      } else render(await api.setBrowserVisible(true))
      await syncNativeVisibility()
      if (!anotherOverlayVisible() && !activeUtilityPanel()) { address.focus(); address.select() }
    } catch (error) {
      setBrowserStatus(errorMessage(error), { error: true })
    }
  }

  async function close() {
    ++commandSequence
    pendingCommand = null
    ++panelSequence
    for (const panel of utilityPanels) panel.classList.add('hidden')
    historyButton.setAttribute('aria-expanded', 'false')
    downloadsButton.setAttribute('aria-expanded', 'false')
    profileButton.setAttribute('aria-expanded', 'false')
    try {
      const workspace = window.harnessDesktopRightWorkspace
      if (workspace) await workspace.close('browser-close')
      else render(await api.setBrowserVisible(false))
      quickButton.focus()
    } catch (error) { setBrowserStatus(errorMessage(error), { error: true }) }
  }

  async function navigate() {
    if (addressComposing || state.profileResetting || pendingCommand?.key === 'navigate') return
    const value = address.value.trim()
    if (!value) { address.focus(); setBrowserStatus('请输入网址或搜索内容。'); return }
    const opened = await runBrowserAction('navigate', '正在打开网页…', () => api.navigateBrowser(value))
    if (opened && address.value.trim() === value) {
      addressDirty = false
      address.value = displayAddress()
    }
    // Never type into the native page or refocus it after navigation; edited drafts stay local.
  }

  quickButton.addEventListener('click', () => {
    const workspace = window.harnessDesktopRightWorkspace
    if (!workspace) return open()
    if (workspace.controller?.isOpen()) return close()
    return workspace.openHome?.() || open()
  })
  if (!window.harnessDesktopRightWorkspace) closeButton.addEventListener('click', close)
  newTabButton.addEventListener('click', async () => {
    if (!await runBrowserAction('new-tab', '正在新建标签页…', () => api.newBrowserTab(''))) return
    addressDirty = false
    address.value = displayAddress()
    if (state.visible && !anotherOverlayVisible()) { address.focus(); address.select() }
  })
  wideModeButton.addEventListener('click', () => runBrowserAction('wide-mode', '正在调整预览宽度…', () => api.setBrowserWideMode(!state.wideMode)))
  historyButton.addEventListener('click', () => showPanel(historyPanel))
  downloadsButton.addEventListener('click', () => showPanel(downloadsPanel))
  closeHistory.addEventListener('click', () => showPanel(historyPanel))
  closeDownloads.addEventListener('click', () => showPanel(downloadsPanel))
  historySearchForm.addEventListener('submit', event => {
    event.preventDefault()
    searchHistory()
  })
  historyClearConfirm.addEventListener('change', () => { historyClear.disabled = !historyClearConfirm.checked })
  historyClear.addEventListener('click', async () => {
    if (!historyClearConfirm.checked) return
    if (!await runBrowserAction('clear-history', '正在清空浏览历史…', () => api.clearBrowserHistory({ confirmed: true }))) return
    ++historySequence
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
    await runBrowserAction('resize', '正在调整预览宽度…', () => api.setBrowserPanelWidth(window.innerWidth - event.clientX))
  })
  resizeHandle.addEventListener('pointercancel', () => { resizing = false; render({}) })
  resizeHandle.addEventListener('lostpointercapture', () => { resizing = false })
  resizeHandle.addEventListener('keydown', async event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? 24 : -24
    await runBrowserAction('resize', '正在调整预览宽度…', () => api.setBrowserPanelWidth((Number(state.panelWidth) || 640) + delta))
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !computerUseAuthorizationOverlay.classList.contains('hidden')) {
      event.preventDefault()
      declineComputerUseAuthorization()
      return
    }
    const browserFocused = state.visible && sidebar.contains(document.activeElement)
    if (!event.defaultPrevented && !anotherOverlayVisible() && browserFocused) {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault(); address.focus(); address.select(); return
      }
      if (event.key === 'Escape' && activeUtilityPanel()) {
        event.preventDefault(); showPanel(activeUtilityPanel()); return
      }
    }
    if (!(event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'b')) return
    event.preventDefault()
    const workspace = window.harnessDesktopRightWorkspace
    if (workspace?.controller?.isOpen() && workspace.controller.getActiveModeId() === 'browser') close()
    else open()
  })
  address.addEventListener('input', () => { addressDirty = true })
  address.addEventListener('compositionstart', () => { addressComposing = true })
  address.addEventListener('compositionend', () => { addressComposing = false })
  address.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || addressComposing || event.keyCode === 229)) event.preventDefault()
    if (event.key === 'Escape' && !event.isComposing && !addressComposing) {
      event.preventDefault()
      addressDirty = false
      address.value = displayAddress()
      address.select()
    }
  })
  addressForm.addEventListener('submit', event => { event.preventDefault(); if (!event.isComposing) navigate() })
  goButton.addEventListener('click', navigate)
  backButton.addEventListener('click', () => {
    if (!backButton.disabled) { addressDirty = false; runBrowserAction('back', '正在返回上一页…', () => api.browserBack()) }
  })
  forwardButton.addEventListener('click', () => {
    if (!forwardButton.disabled) { addressDirty = false; runBrowserAction('forward', '正在前往下一页…', () => api.browserForward()) }
  })
  const stopLoading = () => runBrowserAction('stop-loading', '正在停止网页加载…', () => api.stopBrowser())
  reloadButton.addEventListener('click', () => {
    if (reloadButton.disabled) return
    if (state.loading || pendingCommand?.key === 'navigate') return stopLoading()
    if (commandError && commandErrorKey === 'navigate' && addressDirty) return navigate()
    addressDirty = false
    return runBrowserAction('reload', '正在重新加载网页…', () => api.reloadBrowser())
  })
  stopButton.addEventListener('click', () => { if (!stopButton.disabled) stopLoading() })
  profileButton.addEventListener('click', async () => {
    await showPanel(profilePanel)
    if (profilePanel.classList.contains('hidden')) return profileButton.focus()
    clearSiteConfirm.checked = false
    clearAllConfirm.checked = false
    clearSite.disabled = true
    clearAll.disabled = true
    closeProfile.focus()
  })
  closeProfile.addEventListener('click', async () => {
    await showPanel(profilePanel)
    profileButton.focus()
  })
  computerUseAuthorizationSession.addEventListener('click', () => resolveComputerUseAuthorization('session'))
  computerUseAuthorizationForever.addEventListener('click', () => resolveComputerUseAuthorization('forever'))
  computerUseAuthorizationDecline.addEventListener('click', declineComputerUseAuthorization)
  computerUseAuthorizationClose.addEventListener('click', declineComputerUseAuthorization)
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
