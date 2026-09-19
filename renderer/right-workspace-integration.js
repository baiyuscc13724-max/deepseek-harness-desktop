(() => {
  'use strict'

  const api = window.desktopHarness
  const factory = window.HarnessRightWorkspace
  const deviceFactory = window.HarnessDeviceWorkspace
  const host = document.querySelector('#browserSidebar')
  const slot = document.querySelector('#rightWorkspaceSlot')
  const runtimeView = document.querySelector('#runtimeView')
  if (!api || !factory || !host || !slot || !runtimeView) return

  const title = document.querySelector('#rightWorkspaceTitle')
  const back = document.querySelector('#rightWorkspaceBack')
  const close = document.querySelector('#closeBrowserSidebar')
  const quickButton = document.querySelector('#browserQuickButton')
  const modeButtons = [...document.querySelectorAll('[data-right-workspace-mode]')]
  const browserOnly = [...document.querySelectorAll('.right-workspace-browser-only')]
  let context = { sessionId: '' }
  let filesQuery = ''
  let schedulesQuery = ''
  let filesSnapshot = null
  let filesSnapshotSessionId = ''
  let filesRequestRevision = 0
  let schedulesSnapshot = null
  let schedulesValidator = null
  let schedulesRequestRevision = 0
  let requestedBrowserContentVisible = null
  let requestedBrowserVisible = null
  let browserVisibilityRequest = Promise.resolve()
  // One revision for close, mode and document intents: an old IPC/resource
  // completion may finish, but must never mutate the newer workspace state.
  let workspaceIntentRevision = 0
  let browserRestorePending = true
  let browserIntentLane = Promise.resolve()
  let browserIntentReadyTimer = 0
  // Only successful HTML presentation metadata survives close, never a pending
  // request or an executing iframe. Reopening creates a fresh sandbox context.
  let documentAppSnapshot = null
  let suspendedDocumentApp = null
  const quickButtonDefaultTitle = quickButton?.getAttribute('title') || '切换右侧工作区'

  function setBrowserContentVisible(visible) {
    const next = Boolean(visible)
    if (requestedBrowserContentVisible === next) return
    requestedBrowserContentVisible = next
    api.setBrowserContentVisible(next).catch(() => {
      if (requestedBrowserContentVisible === next) requestedBrowserContentVisible = null
    })
  }

  function setBrowserVisible(visible) {
    const next = Boolean(visible)
    if (requestedBrowserVisible === next) return browserVisibilityRequest
    requestedBrowserVisible = next
    // Coalesce only an in-flight duplicate. Later explicit intents still
    // reconcile native state, which may have changed outside this controller.
    const request = api.setBrowserVisible(next).catch(() => null).finally(() => {
      if (browserVisibilityRequest === request) requestedBrowserVisible = null
    })
    browserVisibilityRequest = request
    return request
  }

  function element(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function button(text, className, onClick) {
    const node = element('button', className, text)
    node.type = 'button'
    if (onClick) node.addEventListener('click', onClick)
    return node
  }

  function homeIcon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('right-workspace-home-icon')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('aria-hidden', 'true')
    const shape = (tag, attributes) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
      svg.append(node)
    }
    if (kind === 'files') {
      shape('path', { d: 'M1.75 4.5c0-.69.56-1.25 1.25-1.25h2.9l1.4 1.5H13c.69 0 1.25.56 1.25 1.25v5.25c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25V4.5Z', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' })
    } else if (kind === 'browser') {
      shape('circle', { cx: '8', cy: '8', r: '6', stroke: 'currentColor', 'stroke-width': '1.2' })
      shape('path', { d: 'M2.15 8h11.7M8 2c1.65 1.62 2.48 3.62 2.48 6S9.65 12.38 8 14C6.35 12.38 5.52 10.38 5.52 8S6.35 3.62 8 2Z', stroke: 'currentColor', 'stroke-width': '1.05' })
    } else if (kind === 'devices') {
      shape('rect', { x: '1.5', y: '2.5', width: '9', height: '7', rx: '1.2', stroke: 'currentColor', 'stroke-width': '1.2' })
      shape('path', { d: 'M4.5 13h3M6 9.5V13', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' })
      shape('rect', { x: '11.5', y: '5', width: '3', height: '7.5', rx: '0.8', stroke: 'currentColor', 'stroke-width': '1.1' })
    } else {
      shape('circle', { cx: '8', cy: '8', r: '6', stroke: 'currentColor', 'stroke-width': '1.2' })
      shape('path', { d: 'M8 4.35v3.9l2.65 1.55', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
    }
    return svg
  }

  function createHomeView() {
    const view = element('section', 'right-workspace-pane right-workspace-home')
    view.id = 'rightWorkspaceHomePane'
    view.setAttribute('aria-label', '右侧工作区首页')
    view.append(element('h2', 'visually-hidden', '打开工作区工具'))
    const actions = element('div', 'right-workspace-home-actions')
    const primaryKey = /mac/i.test(navigator.platform || '') ? '⌘' : 'Ctrl'
    const items = [
      { id: 'files', label: '文件', icon: 'files', shortcut: `${primaryKey}+P`, ariaShortcut: 'Control+P Meta+P' },
      { id: 'browser', label: '浏览器', icon: 'browser', shortcut: `${primaryKey}+T`, ariaShortcut: 'Control+T Meta+T' },
      { id: 'schedules', label: '已安排', icon: 'schedules', shortcut: `${primaryKey}+Shift+A`, ariaShortcut: 'Control+Shift+A Meta+Shift+A' },
      { id: 'devices', label: '设备', icon: 'devices', shortcut: `${primaryKey}+Shift+D`, ariaShortcut: 'Control+Shift+D Meta+Shift+D' }
    ]
    for (const item of items) {
      const action = button(undefined, 'right-workspace-home-action', () => openMode(item.id, { push: true }))
      action.dataset.rightWorkspaceHomeAction = item.id
      action.setAttribute('aria-keyshortcuts', item.ariaShortcut)
      action.append(homeIcon(item.icon), element('span', 'right-workspace-home-label', item.label), element('kbd', 'right-workspace-home-shortcut', item.shortcut))
      actions.append(action)
    }
    view.append(actions)
    return view
  }

  function statusPanel(text, error = false) {
    const node = element('div', `right-workspace-status${error ? ' is-error' : ''}`, text)
    node.setAttribute(error ? 'role' : 'aria-live', error ? 'alert' : 'polite')
    return node
  }

  function createBrowserView() {
    const view = element('section', 'right-workspace-pane right-workspace-browser-pane')
    view.id = 'rightWorkspaceBrowserPane'
    view.setAttribute('aria-label', '浏览器')
    const children = [
      document.querySelector('.browser-tab-strip'),
      document.querySelector('.browser-toolbar'),
      document.querySelector('#browserHistoryPanel'),
      document.querySelector('#browserDownloadsPanel'),
      document.querySelector('#browserProfilePanel'),
      document.querySelector('.browser-sidebar-footer')
    ]
    for (const child of children) if (child) view.append(child)
    return view
  }

  const homeView = createHomeView()
  const filesView = element('section', 'right-workspace-pane right-workspace-data-pane')
  filesView.id = 'rightWorkspaceFilesPane'
  filesView.setAttribute('aria-labelledby', 'rightWorkspaceFilesHeading')
  const schedulesView = element('section', 'right-workspace-pane right-workspace-data-pane')
  schedulesView.id = 'rightWorkspaceSchedulesPane'
  schedulesView.setAttribute('aria-labelledby', 'rightWorkspaceSchedulesHeading')
  const documentView = element('section', 'right-workspace-pane right-workspace-document-pane')
  documentView.id = 'rightWorkspaceDocumentPane'
  documentView.setAttribute('aria-label', '文档预览')
  const browserView = createBrowserView()
  const deviceWorkspace = deviceFactory?.create({ api })
  const devicesView = deviceWorkspace?.view || statusPanel('设备面板未能加载。', true)

  const controller = factory.create({
    host,
    slotEl: slot,
    titleEl: title,
    backEl: back,
    closeEl: close,
    focusReturnEl: quickButton,
    mount: false,
    bindShortcut: true,
    closeOnEscape: true,
    ariaLabel: '右侧工作区'
  })
  controller.registerMode({ id: 'home', title: '工作区', view: homeView })
  controller.registerMode({ id: 'browser', title: '浏览器', view: browserView })
  controller.registerMode({ id: 'files', title: '文件', view: filesView })
  controller.registerMode({ id: 'schedules', title: '已安排', view: schedulesView })
  controller.registerMode({ id: 'devices', title: '设备', view: devicesView })
  controller.registerMode({ id: 'document', title: '文档预览', view: documentView })
  controller.replace('browser')
  controller.close()

  function formatSize(value) {
    const bytes = Number(value) || 0
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  function formatDate(value) {
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) } catch { return String(value || '') }
  }

  function activeSessionId() {
    return typeof context.sessionId === 'string' ? context.sessionId : ''
  }

  // Preserve the pane's vertical reading position across filter/refresh
  // re-renders. Capture only while a real, scrollable list is on screen (an
  // active same-view re-render); never on empty, first render, or mode switch.
  const pendingDataScroll = { files: null, schedules: null }

  function dataScrollView(kind) {
    return kind === 'schedules' ? schedulesView : filesView
  }

  function captureDataScroll(kind) {
    const view = dataScrollView(kind)
    pendingDataScroll[kind] = view.scrollHeight > view.clientHeight ? view.scrollTop : null
  }

  // Apply (and clear) a previously preserved scrollTop only when a list was
  // actually rendered; empty/loading/error/first-render states fall back to 0.
  function applyDataScroll(kind, hasList) {
    const view = dataScrollView(kind)
    const pending = pendingDataScroll[kind]
    pendingDataScroll[kind] = null
    view.scrollTop = hasList && pending !== null ? Math.min(pending, Math.max(0, view.scrollHeight - view.clientHeight)) : 0
  }

  async function resource(kind, payload = {}, sessionId = activeSessionId()) {
    if (!sessionId) throw Object.assign(new Error('打开或继续一个会话后即可使用此面板。'), { code: 'RIGHT_WORKSPACE_NO_SESSION' })
    return api.getRightWorkspaceResource(kind, { ...payload, sessionId })
  }

  function dataHeader(id, titleText, hint, query, onQuery, onRefresh) {
    const fragment = document.createDocumentFragment()
    const heading = element('div', 'right-workspace-data-heading')
    const copy = element('div')
    copy.append(element('h2', '', titleText), element('p', '', hint))
    const refresh = button('刷新', 'right-workspace-secondary', onRefresh)
    heading.append(copy, refresh)
    const search = element('label', 'right-workspace-search')
    const searchText = element('span', 'visually-hidden', `搜索${titleText}`)
    const input = element('input')
    input.id = id
    input.type = 'search'
    input.maxLength = 200
    input.placeholder = `搜索${titleText}`
    input.value = query
    input.addEventListener('input', event => onQuery(event.target.value))
    search.append(searchText, input)
    fragment.append(heading, search)
    return fragment
  }

  function renderFiles(opts = {}) {
    if (opts.preserve) captureDataScroll('files')
    filesView.replaceChildren()
    filesView.append(dataHeader('rightWorkspaceFilesSearch', '文件', '查看当前会话工作区中的上传文件；文本和常用媒体可预览，自包含 HTML 可隔离试玩，其余类型可下载或用系统应用打开。', filesQuery, value => {
      filesQuery = value
      renderFiles({ preserve: true })
      document.querySelector('#rightWorkspaceFilesSearch')?.focus({ preventScroll: true })
    }, () => loadFiles({ preserve: true })))
    if (!activeSessionId()) {
      filesView.append(statusPanel('尚未识别到当前会话。请先打开或继续一个会话。'))
      applyDataScroll('files', false)
      return
    }
    if (!filesSnapshot) {
      filesView.append(statusPanel('正在读取文件…'))
      applyDataScroll('files', false)
      return
    }
    if (filesSnapshot.error) {
      filesView.append(statusPanel(filesSnapshot.error, true))
      applyDataScroll('files', false)
      return
    }
    // Row actions retain the provenance of the rendered snapshot, not whatever
    // conversation happens to be active when a delayed click/response runs.
    const sourceSessionId = filesSnapshotSessionId
    const needle = filesQuery.trim().toLocaleLowerCase()
    const rows = (filesSnapshot.files || []).filter(file => !needle || String(file.path || '').toLocaleLowerCase().includes(needle))
    if (!rows.length) {
      filesView.append(statusPanel(needle ? '没有匹配的文件。' : '还没有上传文件。可使用对话输入区的回形针添加文件。'))
      applyDataScroll('files', false)
      return
    }
    const list = element('div', 'right-workspace-list')
    for (const file of rows) {
      const row = element('article', 'right-workspace-row')
      const open = button(file.name || file.path, 'right-workspace-row-main', () => openDocument(file.path, sourceSessionId))
      const meta = element('span', 'right-workspace-row-meta', `${formatSize(file.size)} · ${formatDate(file.modifiedAt)}`)
      open.prepend(element('span', 'right-workspace-file-mark', '▤'))
      const body = element('div', 'right-workspace-row-copy')
      body.append(open, meta)
      row.append(body, button('预览', 'right-workspace-secondary', () => openDocument(file.path, sourceSessionId)))
      list.append(row)
    }
    filesView.append(list)
    applyDataScroll('files', true)
  }

  async function loadFiles(opts = {}) {
    const revision = ++filesRequestRevision
    const sessionId = activeSessionId()
    // On a preserve refresh keep the current list on screen until the request
    // resolves; only a fresh entry (mode switch / hydration) shows the loading
    // state so the final data render can capture the still-visible old scrollTop.
    if (!opts.preserve) {
      filesSnapshot = null
      renderFiles()
    }
    let snapshot
    try { snapshot = await resource('files', {}, sessionId) }
    catch (error) { snapshot = { error: error.message || String(error), files: [] } }
    if (revision !== filesRequestRevision || sessionId !== activeSessionId()) return
    filesSnapshot = snapshot
    filesSnapshotSessionId = sessionId
    renderFiles(opts.preserve ? { preserve: true } : {})
  }

  function safePreviewSource(file) {
    const value = String(file.contentUrl || file.dataUrl || '')
    if (file.previewKind === 'image' && /^data:image\/(?:avif|bmp|gif|jpeg|png|webp|x-icon);base64,/iu.test(value)) return value
    try {
      const parsed = new URL(value)
      if (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname.toLowerCase())) return parsed.toString()
    } catch {}
    return ''
  }

  function documentOpenAction(file, fallbackPath, source) {
    if (!file.openable && !file.contentUrl) return null
    const local = source.local === true && !file.contentUrl && typeof file.path === 'string' && file.path
    const action = button('使用系统应用打开或显示', 'right-workspace-secondary')
    action.setAttribute('aria-live', 'polite')
    action.addEventListener('click', async () => {
      const original = action.textContent
      action.disabled = true
      action.setAttribute('aria-busy', 'true')
      action.textContent = '正在安全处理…'
      try {
        const result = local
          ? await api.openLocal(file.path)
          : await api.openRightWorkspaceFile(source.sourceKind === 'workspace-link'
            ? { target: file.path || fallbackPath, sessionId: source.sessionId, sourceKind: source.sourceKind }
            : { target: file.path || fallbackPath, sessionId: source.sessionId, path: file.path || fallbackPath, name: file.name || 'workspace-file' })
        action.textContent = String(result?.action || '').startsWith('reveal') ? '已在文件夹中显示' : '已打开'
      } catch (error) {
        action.textContent = error?.message || '打开失败'
        action.classList.add('is-error')
      } finally {
        action.setAttribute('aria-busy', 'false')
        setTimeout(() => {
          action.disabled = false
          action.textContent = original
          action.classList.remove('is-error')
        }, 2400)
      }
    })
    return action
  }

  function renderDocument(file, fallbackPath, provenance) {
    documentAppSnapshot = null
    suspendedDocumentApp = null
    documentView.classList.remove('is-interactive')
    documentView.replaceChildren()
    const header = element('header', 'right-workspace-document-header')
    const identity = element('div', 'right-workspace-document-identity')
    identity.append(element('strong', '', file.path || fallbackPath), element('span', '', formatSize(file.size)))
    const actions = element('div', 'right-workspace-document-actions')
    const openAction = documentOpenAction(file, fallbackPath, provenance)
    if (openAction) actions.append(openAction)
    header.append(identity, actions)
    documentView.append(header)

    const previewKind = file.previewKind || (file.previewable ? 'text' : '')
    const source = safePreviewSource({ ...file, previewKind })
    if (file.previewable && source && previewKind === 'image') {
      const image = element('img', 'right-workspace-document-image')
      image.src = source
      image.alt = file.name || '图片预览'
      image.addEventListener('error', () => image.replaceWith(statusPanel('图片解码失败；可使用系统应用打开。')), { once: true })
      documentView.append(image)
      return
    }
    if (file.previewable && source && previewKind === 'audio') {
      const audio = element('audio', 'right-workspace-document-audio')
      audio.src = source
      audio.controls = true
      audio.preload = 'metadata'
      documentView.append(audio)
      return
    }
    if (file.previewable && source && previewKind === 'video') {
      const video = element('video', 'right-workspace-document-video')
      video.src = source
      video.controls = true
      video.preload = 'metadata'
      documentView.append(video)
      return
    }
    if (file.previewable && source && previewKind === 'html-app') {
      documentAppSnapshot = { file: { ...file }, fallbackPath, provenance: { ...provenance } }
      documentView.classList.add('is-interactive')
      const stage = element('div', 'right-workspace-document-app-stage')
      const state = element('div', 'right-workspace-document-app-status', '隔离试玩：脚本可运行；网络、表单和宿主文件访问已禁用。')
      state.setAttribute('aria-live', 'polite')
      const frame = element('iframe', 'right-workspace-document-app')
      frame.title = `${file.name || 'HTML'} 隔离试玩`
      frame.referrerPolicy = 'no-referrer'
      frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock')
      frame.setAttribute('allow', 'fullscreen')
      frame.setAttribute('allowfullscreen', '')
      frame.addEventListener('load', () => {
        state.textContent = '试玩已载入；单击画面即可操作，重新加载可恢复初始状态。'
      })
      frame.addEventListener('error', () => {
        state.textContent = '试玩载入失败；可重新加载或使用系统浏览器打开。'
        state.classList.add('is-error')
      })
      const reload = button('重新加载', 'right-workspace-secondary', () => {
        state.textContent = '正在重新加载隔离试玩…'
        state.classList.remove('is-error')
        frame.src = source
        frame.focus({ preventScroll: true })
      })
      actions.prepend(reload)
      stage.append(state, frame)
      documentView.append(stage)
      frame.src = source
      return
    }
    if (file.previewable && source && previewKind === 'pdf') {
      const frame = element('iframe', 'right-workspace-document-pdf')
      frame.src = source
      frame.title = `${file.name || 'PDF'} 预览`
      frame.referrerPolicy = 'no-referrer'
      documentView.append(frame)
      return
    }
    if (!file.previewable) {
      const reasons = {
        external: '此文件类型可交给系统应用打开；安装包、脚本等主动内容只会在文件夹中显示。',
        unsupported: '此文件类型可交给系统应用打开；主动内容不会直接执行。',
        'too-large': '文件超过内嵌预览上限，可交给系统应用打开或显示。',
        binary: '文件包含二进制内容，可交给系统应用打开或显示。'
      }
      documentView.append(statusPanel(reasons[file.reason] || '无法安全内嵌预览；可交给系统应用打开或显示。'))
      return
    }
    const pre = element('pre', 'right-workspace-document-text')
    pre.textContent = file.text || ''
    pre.tabIndex = 0
    documentView.append(pre)
  }

  function suspendDocumentApp() {
    if (!documentView.querySelector('iframe.right-workspace-document-app')) return
    suspendedDocumentApp = documentAppSnapshot
    // Hiding the host leaves scripts/timers alive. Removing the iframe destroys
    // its browsing context; no message filtering can substitute for this step.
    documentView.replaceChildren(statusPanel('试玩已关闭；可重新打开面板，或从来源重新预览。'))
    documentView.classList.remove('is-interactive')
  }

  function resumeDocumentApp() {
    if (!suspendedDocumentApp || !controller.isOpen() || controller.getActiveModeId() !== 'document') return
    const snapshot = suspendedDocumentApp
    renderDocument(snapshot.file, snapshot.fallbackPath, snapshot.provenance)
    close?.focus({ preventScroll: true })
  }

  function beginDocumentRequest(message) {
    documentAppSnapshot = null
    suspendedDocumentApp = null
    browserRestorePending = false
    documentView.replaceChildren(statusPanel(message))
    controller.push('document')
    controller.open()
    host.classList.remove('hidden')
    syncChrome()
    setBrowserVisible(false)
    close?.focus({ preventScroll: true })
    return ++workspaceIntentRevision
  }

  function isCurrentDocumentRequest(revision) {
    return revision === workspaceIntentRevision && controller.isOpen() && controller.getActiveModeId() === 'document'
  }

  async function openDocument(path, sessionId) {
    const source = Object.freeze({ sessionId })
    const revision = beginDocumentRequest('正在打开文档…')
    try {
      const result = await resource('filePreview', { path }, source.sessionId)
      if (!isCurrentDocumentRequest(revision)) return false
      renderDocument(result.file || {}, path, source)
      return true
    } catch (error) {
      if (isCurrentDocumentRequest(revision)) documentView.replaceChildren(statusPanel(error.message || String(error), true))
      return false
    }
  }

  async function openLocalDocument(target, options = {}) {
    options = options && typeof options === 'object' ? options : { sourceKind: 'invalid' }
    // Provenance comes from the clicked link, never the current conversation.
    // In particular, missing workspace-link provenance cannot fall through to
    // an absolute local file or another session's project root.
    const source = Object.freeze(options.sourceKind === 'workspace-link'
      ? { sourceKind: 'workspace-link', sessionId: typeof options.sessionId === 'string' ? options.sessionId : '' }
      : { local: true })
    const revision = beginDocumentRequest('正在安全读取文档…')
    try {
      if (source.sourceKind === 'workspace-link') {
        if (!source.sessionId || source.sessionId.length > 256 || source.sessionId.trim() !== source.sessionId) {
          throw new Error('无法确定链接所属会话，已停止预览；请从来源会话重新打开。')
        }
      } else if (Object.hasOwn(options, 'sourceKind') || Object.hasOwn(options, 'sessionId') || !factory.isExplicitLocalTarget(target)) {
        throw new Error('缺少文档来源，不能猜测当前项目或本机路径。')
      }
      const result = await api.previewRightWorkspaceLocal(source.local
        ? { target }
        : { target, sessionId: source.sessionId, sourceKind: source.sourceKind })
      if (!isCurrentDocumentRequest(revision)) return false
      renderDocument(result.file || {}, target, source)
      return true
    } catch (error) {
      if (isCurrentDocumentRequest(revision)) documentView.replaceChildren(statusPanel(error.message || String(error), true))
      return false
    }
  }

  function scheduleDraft(mode, prompt, value) {
    if (mode === 'after') return `请在当前会话创建一个定时任务：${JSON.stringify(prompt)}，在 ${value} 秒后提醒。创建后告诉我任务 ID。`
    if (mode === 'every') return `请在当前会话创建一个固定频率定时任务：${JSON.stringify(prompt)}，每 ${value} 秒提醒一次。创建后告诉我任务 ID。`
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    return `请在当前会话创建一个定时任务：${JSON.stringify(prompt)}，在本地时间 ${value}（时区 ${zone}）提醒一次。创建后告诉我任务 ID。`
  }

  function sendDraft(text, messageNode) {
    const sessionId = activeSessionId()
    if (!sessionId || !text) {
      messageNode.textContent = '当前会话输入框不可用。'
      messageNode.classList.add('is-error')
      return false
    }
    runtimeView.send('right-workspace:command', { type: 'set-draft', sessionId, text })
    messageNode.textContent = '请求已放入输入框；请检查后手动发送。'
    messageNode.classList.remove('is-error')
    runtimeView.focus()
    return true
  }

  function renderSchedules(opts = {}) {
    if (opts.preserve) captureDataScroll('schedules')
    schedulesView.replaceChildren()
    schedulesView.append(dataHeader('rightWorkspaceSchedulesSearch', '已安排', '会话级提醒只在本会话运行时触发；任何变更都会先进入输入框。', schedulesQuery, value => {
      schedulesQuery = value
      renderSchedules({ preserve: true })
      document.querySelector('#rightWorkspaceSchedulesSearch')?.focus({ preventScroll: true })
    }, () => loadSchedules({ preserve: true })))

    const form = element('form', 'right-workspace-schedule-form')
    const prompt = element('input')
    prompt.type = 'text'
    prompt.maxLength = 4096
    prompt.placeholder = '提醒内容'
    const mode = element('select')
    for (const [value, label] of [['after', '延时一次'], ['at', '指定时间'], ['every', '固定频率']]) {
      const option = element('option', '', label)
      option.value = value
      mode.append(option)
    }
    const time = element('input')
    time.type = 'number'
    time.min = '1'
    time.step = '1'
    time.placeholder = '秒数'
    mode.addEventListener('change', () => {
      time.value = ''
      time.type = mode.value === 'at' ? 'datetime-local' : 'number'
      time.min = mode.value === 'every' ? '300' : '1'
      time.placeholder = mode.value === 'at' ? '' : mode.value === 'every' ? '至少 300 秒' : '秒数'
    })
    const note = element('p', 'right-workspace-inline-status')
    const submit = button('放入输入框', 'right-workspace-primary')
    submit.type = 'submit'
    form.append(prompt, mode, time, submit)
    form.addEventListener('submit', event => {
      event.preventDefault()
      const seconds = Number(time.value)
      const valid = prompt.value.trim() && (mode.value === 'at' ? time.value : Number.isSafeInteger(seconds) && seconds > 0 && (mode.value !== 'every' || seconds >= 300))
      if (!valid) {
        note.textContent = '请填写提醒内容和有效时间；固定频率至少为 300 秒。'
        note.classList.add('is-error')
        return
      }
      sendDraft(scheduleDraft(mode.value, prompt.value.trim(), time.value), note)
    })
    schedulesView.append(form, note)

    const suggestions = element('div', 'right-workspace-suggestions')
    suggestions.append(element('span', '', '建议'))
    for (const item of [
      ['每日简报', '每天早上提醒我整理今日重点'],
      ['每周回顾', '每周提醒我整理本周工作进展'],
      ['跟进监控', '提醒我检查最近的构建与部署状态']
    ]) suggestions.append(button(item[0], 'right-workspace-chip', () => { prompt.value = item[1]; prompt.focus() }))
    schedulesView.append(suggestions)

    if (!activeSessionId()) {
      schedulesView.append(statusPanel('尚未识别到当前会话。请先打开或继续一个会话。'))
      applyDataScroll('schedules', false)
      return
    }
    if (!schedulesSnapshot) {
      schedulesView.append(statusPanel('正在读取已安排任务…'))
      applyDataScroll('schedules', false)
      return
    }
    if (schedulesSnapshot.error) {
      schedulesView.append(statusPanel(schedulesSnapshot.error, true))
      applyDataScroll('schedules', false)
      return
    }
    const needle = schedulesQuery.trim().toLocaleLowerCase()
    const rows = (schedulesSnapshot.schedules || []).filter(item => !needle || `${item.prompt} ${item.id} ${item.kind}`.toLocaleLowerCase().includes(needle))
    const hasScheduleList = rows.length > 0
    if (!hasScheduleList) {
      schedulesView.append(statusPanel(needle ? '没有匹配的任务。' : '当前会话还没有已安排任务。'))
    } else {
      const list = element('div', 'right-workspace-list')
      for (const item of rows) {
        const row = element('article', 'right-workspace-row')
        const copy = element('div', 'right-workspace-row-copy')
        copy.append(element('strong', '', item.prompt), element('span', 'right-workspace-row-meta', `${item.state === 'overdue' ? '已逾期' : '等待中'} · ${formatDate(item.scheduledAt)} · ${item.id}`))
        const stop = button('准备停用', 'right-workspace-secondary', () => sendDraft(`请删除当前会话中任务 ID 为 ${JSON.stringify(item.id)} 的定时任务，并告诉我结果。`, note))
        row.append(copy, stop)
        list.append(row)
      }
      schedulesView.append(list)
    }
    const recent = (schedulesSnapshot.history || []).filter(item => !needle || `${item.prompt || ''} ${item.id} ${item.operation}`.toLocaleLowerCase().includes(needle)).slice(0, 5)
    if (recent.length) {
      schedulesView.append(element('h3', 'right-workspace-subheading', '最近活动'))
      const history = element('div', 'right-workspace-list')
      const labels = { created: '已创建', deleted: '已停用', dispatched: '已触发' }
      for (const item of recent) {
        const row = element('article', 'right-workspace-row')
        const copy = element('div', 'right-workspace-row-copy')
        copy.append(element('strong', '', item.prompt || item.id), element('span', 'right-workspace-row-meta', `${labels[item.operation] || item.operation} · ${item.occurredAt ? formatDate(item.occurredAt) : item.id}`))
        row.append(copy)
        history.append(row)
      }
      schedulesView.append(history)
    }
    // Clamp only after the optional history has joined the DOM; otherwise a
    // reader positioned in that section would be restored too high.
    applyDataScroll('schedules', hasScheduleList)
  }

  function scheduleValidatorsEnabled() {
    return window.__DSH_DESKTOP_SCHEDULES_VALIDATORS__ !== false
  }

  function validScheduleValidator(value) {
    return Boolean(value) && typeof value.etag === 'string' && value.etag.length <= 256 &&
      Number.isSafeInteger(value.cursor) && value.cursor >= -1 && typeof value.generation === 'string' &&
      value.generation.length > 0 && value.generation.length <= 128
  }

  function scheduleValidatorFrom(result, sessionId) {
    if (!scheduleValidatorsEnabled() || result?.body?.projection?.cacheable === false) return null
    const candidate = { sessionId, etag: result?.etag, cursor: result?.cursor, generation: result?.generation }
    return validScheduleValidator(candidate) ? candidate : null
  }

  function invalidScheduleDelta(result, previous) {
    const projection = result?.body?.projection
    if (!projection || projection.mode !== 'delta') return false
    return !validScheduleValidator(previous) || projection.generation !== previous.generation ||
      projection.since !== previous.cursor || !Number.isSafeInteger(projection.cursor) || projection.cursor < previous.cursor
  }

  function invalidScheduleResponse(result, sessionId) {
    const body = result?.body && typeof result.body === 'object' ? result.body : result
    if (!body || typeof body !== 'object' || (body.sessionId !== undefined && body.sessionId !== sessionId)) return true
    const projection = body.projection
    return Boolean(projection && result?.cursor !== undefined &&
      (projection.cursor !== result.cursor || projection.generation !== result.generation))
  }

  async function scheduleResource(sessionId, previous) {
    const conditional = scheduleValidatorsEnabled() && validScheduleValidator(previous) && previous.sessionId === sessionId
    const payload = conditional
      ? { etag: previous.etag, since: previous.cursor, generation: previous.generation }
      : { validator: false }
    let result = await resource('schedules', payload)
    const invalid304 = result?.notModified && (!conditional || !validScheduleValidator({ etag: result.etag, cursor: result.cursor, generation: result.generation }) || result.generation !== previous.generation || result.cursor < previous.cursor)
    if (invalid304 || invalidScheduleDelta(result, conditional ? previous : null) || (!result?.notModified && invalidScheduleResponse(result, sessionId))) {
      result = await resource('schedules', { validator: false })
      if (result?.notModified || invalidScheduleDelta(result, null) || invalidScheduleResponse(result, sessionId)) throw new Error('Schedule full fallback was not authoritative')
    }
    return result
  }

  async function loadSchedules(opts = {}) {
    const sessionId = activeSessionId()
    const revision = ++schedulesRequestRevision
    const preserve = Boolean(opts.preserve || schedulesSnapshot)
    if (!preserve) {
      schedulesSnapshot = null
      renderSchedules()
    }
    try {
      const result = await scheduleResource(sessionId, schedulesValidator)
      if (revision !== schedulesRequestRevision || sessionId !== activeSessionId()) return
      if (result?.notModified) {
        schedulesValidator = scheduleValidatorFrom(result, sessionId) || schedulesValidator
        return
      }
      schedulesSnapshot = result?.body && typeof result.body === 'object' ? result.body : result
      schedulesValidator = scheduleValidatorFrom(result, sessionId)
    } catch (error) {
      if (revision !== schedulesRequestRevision || sessionId !== activeSessionId()) return
      schedulesValidator = null
      schedulesSnapshot = { error: error.message || String(error), schedules: [] }
    }
    renderSchedules(preserve ? { preserve: true } : {})
  }

  let chromeState = null
  function syncChrome() {
    const active = controller.getActiveModeId()
    const open = controller.isOpen()
    const browser = active === 'browser'
    const dockWidth = active === 'home' ? 320 : controller.getWidth()
    const browserContentVisible = open && browser
    const previous = chromeState
    chromeState = { active, open, dockWidth, browserContentVisible }
    if (!previous || previous.dockWidth !== dockWidth) {
      document.documentElement.style.setProperty('--dsh-right-workspace-dock-width', `${dockWidth}px`)
    }
    if (!previous || previous.active !== active) {
      host.classList.toggle('is-home', active === 'home')
      for (const node of browserOnly) node.classList.toggle('hidden', !browser)
      for (const node of modeButtons) node.setAttribute('aria-pressed', String(node.dataset.rightWorkspaceMode === active))
    }
    if (!previous || previous.open !== open) {
      document.body.classList.toggle('dsh-right-workspace-docked', open)
      quickButton?.setAttribute('aria-expanded', String(open))
      document.body.classList.toggle('browser-sidebar-open', open)
    }
    if (!previous || previous.browserContentVisible !== browserContentVisible) setBrowserContentVisible(browserContentVisible)
  }

  async function openMode(id, options = {}) {
    if (!controller.hasMode(id)) return false
    browserRestorePending = false
    if (options.push) controller.push(id)
    else controller.replace(id)
    controller.open()
    host.classList.remove('hidden')
    const revision = ++workspaceIntentRevision
    if (id === 'browser') {
      // During renderer hydration Electron already owns the visible browser;
      // avoid echoing the same visibility command back into the state stream.
      if (options.nativeAlreadyVisible !== true) await setBrowserVisible(true)
    } else {
      // A non-browser pane is an explicit user intent. Keep the native state
      // aligned so later title/loading events cannot carry stale visible=true.
      await setBrowserVisible(false)
    }
    if (revision !== workspaceIntentRevision || !controller.isOpen() || controller.getActiveModeId() !== id) return false
    if (id === 'devices') deviceWorkspace?.activate()
    else deviceWorkspace?.deactivate()
    syncChrome()
    if (id === 'files') loadFiles()
    if (id === 'schedules') loadSchedules()
    if (id === 'browser') {
      const address = document.querySelector('#browserAddress')
      address?.focus()
      address?.select()
    } else {
      close?.focus({ preventScroll: true })
    }
    return true
  }

  function setBrowserIntentBridgeState(state) {
    runtimeView.dataset.browserIntentBridge = state
    if (quickButton) {
      quickButton.dataset.browserIntentBridge = state
      quickButton.title = state === 'unavailable'
        ? '自动打开未就绪；仍可点击打开右侧工作区'
        : quickButtonDefaultTitle
    }
  }

  function expectBrowserIntentBridge() {
    if (browserIntentReadyTimer) clearTimeout(browserIntentReadyTimer)
    setBrowserIntentBridgeState('pending')
    browserIntentReadyTimer = setTimeout(() => {
      browserIntentReadyTimer = 0
      if (runtimeView.dataset.browserIntentBridge === 'ready') return
      setBrowserIntentBridgeState('unavailable')
      console.warn('browser intent bridge unavailable; right workspace button remains available')
    }, 12_000)
  }

  function markBrowserIntentBridgeReady() {
    if (browserIntentReadyTimer) clearTimeout(browserIntentReadyTimer)
    browserIntentReadyTimer = 0
    setBrowserIntentBridgeState('ready')
  }

  function handleBrowserOpenIntent(value) {
    const intent = factory.normalizeBrowserOpenIntent(value)
    if (!intent) return false
    if (intent.action === 'bridge-ready') {
      markBrowserIntentBridgeReady()
      return true
    }
    browserIntentLane = browserIntentLane.catch(() => {}).then(async () => {
      if (intent.action === 'show-browser') {
        await openMode('browser')
        window.harnessDesktopBrowserSidebar?.setStatus?.('已按明确指令打开右侧浏览器。')
        return
      }
      const result = await api.getBrowserState().catch(() => null)
      const snapshot = result?.state || result || {}
      const action = factory.browserIntentTabAction({ currentUrl: snapshot.url, targetUrl: intent.url })
      if (action === 'navigate-current') await api.navigateBrowser(intent.url)
      else if (action === 'open-new-tab') await api.newBrowserTab(intent.url)
      window.harnessDesktopBrowserSidebar?.setStatus?.('已在后台浏览器打开明确网址；需要预览时可手动打开右侧工作区。')
    }).catch(error => {
      console.warn('browser auto-open intent failed', error)
      window.harnessDesktopBrowserSidebar?.setStatus?.(error?.message || String(error), { error: true })
    })
    return true
  }

  async function openHome() {
    const opened = await openMode('home')
    if (opened) homeView.querySelector('[data-right-workspace-home-action]')?.focus()
    return opened
  }

  function onHomeShortcut(event) {
    if (event.defaultPrevented || event.repeat || event.altKey || !(event.ctrlKey || event.metaKey)) return
    if (!controller.isOpen() || controller.getActiveModeId() !== 'home') return
    const key = String(event.key || '').toLowerCase()
    const mode = !event.shiftKey && key === 'p'
      ? 'files'
      : !event.shiftKey && key === 't'
        ? 'browser'
        : event.shiftKey && key === 'a'
          ? 'schedules'
          : event.shiftKey && key === 'd'
            ? 'devices'
            : ''
    if (!mode) return
    event.preventDefault()
    openMode(mode, { push: true })
  }

  async function closeWorkspace(reason = 'api') {
    browserRestorePending = false
    controller.setOpen(false, reason)
    deviceWorkspace?.deactivate()
    syncChrome()
    // The close event hides synchronously. Never hide again after its IPC:
    // a newer open may already own the panel while that reply was pending.
    await setBrowserVisible(false)
  }

  function setContext(value) {
    const sessionId = typeof value?.sessionId === 'string' && value.sessionId.length <= 256 && value.sessionId.trim() === value.sessionId ? value.sessionId : ''
    if (sessionId === context.sessionId) return
    context = { sessionId }
    documentAppSnapshot = null
    suspendedDocumentApp = null
    workspaceIntentRevision += 1
    filesRequestRevision += 1
    filesSnapshotSessionId = ''
    filesSnapshot = null
    schedulesSnapshot = null
    schedulesValidator = null
    schedulesRequestRevision += 1
    if (!controller.isOpen()) return
    if (controller.getActiveModeId() === 'files') loadFiles()
    if (controller.getActiveModeId() === 'schedules') loadSchedules()
  }

  modeButtons.forEach(node => node.addEventListener('click', () => openMode(node.dataset.rightWorkspaceMode)))
  window.addEventListener('keydown', onHomeShortcut)
  controller.on('modechange', () => {
    workspaceIntentRevision += 1
    syncChrome()
    const activeMode = controller.getActiveModeId()
    if (activeMode !== 'browser') setBrowserVisible(false)
    if (activeMode === 'devices') deviceWorkspace?.activate()
    else deviceWorkspace?.deactivate()
  })
  controller.on('push', syncChrome)
  controller.on('replace', syncChrome)
  controller.on('statechange', resumeDocumentApp)
  controller.on('open', () => {
    if (controller.getActiveModeId() !== 'document') return
    // The controller shortcut can reopen without passing through openMode.
    host.classList.remove('hidden')
    resumeDocumentApp()
    syncChrome()
    close?.focus({ preventScroll: true })
  })
  controller.on('close', () => {
    workspaceIntentRevision += 1
    suspendDocumentApp()
    browserRestorePending = false
    deviceWorkspace?.deactivate()
    syncChrome()
    setBrowserContentVisible(false)
    setBrowserVisible(false)
    host.classList.add('hidden')
  })
  controller.on('resize', ({ width }) => {
    document.documentElement.style.setProperty('--browser-panel-width', `${width}px`)
    syncChrome()
  })

  setBrowserIntentBridgeState('pending')
  runtimeView.addEventListener('did-start-loading', expectBrowserIntentBridge)
  runtimeView.addEventListener('ipc-message', event => {
    if (event.channel === 'right-workspace:context') setContext(event.args?.[0])
    else if (event.channel === 'right-workspace:intent') handleBrowserOpenIntent(event.args?.[0])
  })
  api.onPreviewRightWorkspaceLocal?.(value => {
    if (typeof value === 'string') return openLocalDocument(value)
    return openLocalDocument(value?.target, { sessionId: value?.sessionId, sourceKind: value?.sourceKind })
  })

  let modelPreview = null
  function observeModelPreview(nonce) {
    const p = modelPreview
    if (!p || p.nonce !== nonce || !isCurrentDocumentRequest(p.revision)) return { state: 'superseded' }
    const rect = documentView.getBoundingClientRect()
    const panel = host.getBoundingClientRect()
    const left = Math.max(rect.left, panel.left, 0), top = Math.max(rect.top, panel.top, 0)
    const right = Math.min(rect.right, panel.right, innerWidth), bottom = Math.min(rect.bottom, panel.bottom, innerHeight)
    const style = getComputedStyle(documentView)
    const visible = !document.hidden && !host.classList.contains('hidden') && style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0 && right - left > 2 && bottom - top > 2
    const base = { nonce, path: p.path, sourceSessionId: p.sourceSessionId, revision: p.revision }
    if (!visible || !p.loaded) return { ...base, state: 'not-visible' }
    // Transparent/fading document paint could expose the conversation underneath.
    // Do not change the theme to obtain a screenshot: refuse unsafe composition.
    if (!/^(?:rgb|color)\([^/)]+\)$/u.test(style.backgroundColor)) return { ...base, state: 'not-visible' }
    for (let ancestor = documentView; ancestor; ancestor = ancestor.parentElement) {
      const paint = getComputedStyle(ancestor)
      if (Number(paint.opacity) !== 1 || paint.visibility !== 'visible' || paint.display === 'none') return { ...base, state: 'not-visible' }
    }
    // Refuse a DOM dialog overlay covering the crop; never include another
    // pane merely because its geometry intersects this one.
    for (const [x, y] of [[left + 1, top + 1], [right - 1, top + 1], [left + 1, bottom - 1], [right - 1, bottom - 1], [(left + right) / 2, (top + bottom) / 2]]) {
      const hit = document.elementFromPoint(x, y)
      if (!hit || !documentView.contains(hit)) return { ...base, state: 'not-visible' }
    }
    const text = documentView.querySelector('.right-workspace-document-text')?.textContent || ''
    const viewport = window.visualViewport
    return { ...base, state: 'rendered', contentKind: p.contentKind,
      rect: { x: left, y: top, width: right - left, height: bottom - top },
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scale: viewport?.scale ?? 1, offsetX: viewport?.offsetLeft ?? 0, offsetY: viewport?.offsetTop ?? 0 },
      textExcerpt: text.slice(0, 12_000), truncated: text.length > 12_000 }
  }
  api.onModelWorkspacePreview?.(async value => {
    if (!value || typeof value.nonce !== 'string' || value.nonce.length > 64 || typeof value.path !== 'string' || typeof value.sourceSessionId !== 'string' || value.file?.sourceSessionId !== value.sourceSessionId) return
    const revision = beginDocumentRequest('正在观察当前成果…')
    const p = { nonce: value.nonce, path: value.path, sourceSessionId: value.sourceSessionId, revision, contentKind: value.file.previewKind, loaded: false }
    modelPreview = p
    try {
      renderDocument(value.file, value.path, { sourceKind: 'workspace-link', sessionId: value.sourceSessionId })
      const media = documentView.querySelector('iframe,img,video,audio')
      let loadError = false
      const loaded = () => { p.loaded = true }
      const failed = () => { loadError = true }
      const event = media?.tagName === 'VIDEO' || media?.tagName === 'AUDIO' ? 'loadedmetadata' : 'load'
      p.loaded = !media || (media.tagName === 'IMG' && media.complete && media.naturalWidth > 0) || ((media.tagName === 'VIDEO' || media.tagName === 'AUDIO') && media.readyState >= 1)
      media?.addEventListener(event, loaded)
      media?.addEventListener('error', failed)
      const deadline = Date.now() + 10_000
      let observed
      try {
        await browserVisibilityRequest
        do {
          observed = observeModelPreview(p.nonce)
          if (observed.state === 'rendered' || observed.state === 'superseded' || loadError || document.hidden) break
          await new Promise(resolve => setTimeout(resolve, 40))
        } while (Date.now() < deadline)
      } finally {
        media?.removeEventListener(event, loaded)
        media?.removeEventListener('error', failed)
      }
      await api.replyModelWorkspacePreview({ ...p, state: loadError ? 'failed' : observed.state })
    } catch {
      await api.replyModelWorkspacePreview({ ...p, state: 'failed' }).catch(() => {})
    }
  })
  api.onModelWorkspacePreviewCancel?.(value => { if (modelPreview?.nonce === value?.nonce) modelPreview = null })
  window.addEventListener('beforeunload', () => { modelPreview = null })

  window.harnessDesktopRightWorkspace = Object.freeze({
    controller,
    observeModelPreview,
    openHome,
    openMode,
    openLocalDocument,
    handleBrowserOpenIntent,
    close: closeWorkspace,
    setContext,
    getContext: () => ({ ...context }),
    syncBrowserState(next) {
      const action = factory.browserStateModeAction({
        restorePending: browserRestorePending,
        nativeVisible: next?.visible === true,
        workspaceOpen: controller.isOpen(),
        activeModeId: controller.getActiveModeId()
      })
      browserRestorePending = false
      if (action === 'restore-browser') openMode('browser', { nativeAlreadyVisible: true })
      syncChrome()
    }
  })
  renderFiles()
  renderSchedules()
  syncChrome()
})()
