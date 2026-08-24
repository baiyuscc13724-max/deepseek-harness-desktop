(() => {
  'use strict'

  const api = window.desktopHarness
  const factory = window.HarnessRightWorkspace
  const host = document.querySelector('#browserSidebar')
  const slot = document.querySelector('#rightWorkspaceSlot')
  const runtimeView = document.querySelector('#runtimeView')
  if (!api || !factory || !host || !slot || !runtimeView) return

  const title = document.querySelector('#rightWorkspaceTitle')
  const back = document.querySelector('#rightWorkspaceBack')
  const close = document.querySelector('#closeBrowserSidebar')
  const modeButtons = [...document.querySelectorAll('[data-right-workspace-mode]')]
  const browserOnly = [...document.querySelectorAll('.right-workspace-browser-only')]
  let context = { sessionId: '' }
  let filesQuery = ''
  let schedulesQuery = ''
  let filesSnapshot = null
  let schedulesSnapshot = null
  let requestedBrowserContentVisible = null
  let browserRestorePending = true

  function setBrowserContentVisible(visible) {
    const next = Boolean(visible)
    if (requestedBrowserContentVisible === next) return
    requestedBrowserContentVisible = next
    api.setBrowserContentVisible(next).catch(() => {
      if (requestedBrowserContentVisible === next) requestedBrowserContentVisible = null
    })
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

  const controller = factory.create({
    host,
    slotEl: slot,
    titleEl: title,
    backEl: back,
    closeEl: close,
    mount: false,
    bindShortcut: true,
    closeOnEscape: true,
    ariaLabel: '右侧工作区'
  })
  controller.registerMode({ id: 'browser', title: '浏览器', view: browserView })
  controller.registerMode({ id: 'files', title: '文件', view: filesView })
  controller.registerMode({ id: 'schedules', title: '已安排', view: schedulesView })
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

  async function resource(kind, payload = {}) {
    const sessionId = activeSessionId()
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

  function renderFiles() {
    filesView.replaceChildren()
    filesView.append(dataHeader('rightWorkspaceFilesSearch', '文件', '查看当前会话工作区中的上传文件；文本和代码可直接预览。', filesQuery, value => {
      filesQuery = value
      renderFiles()
      document.querySelector('#rightWorkspaceFilesSearch')?.focus()
    }, () => loadFiles()))
    if (!activeSessionId()) {
      filesView.append(statusPanel('尚未识别到当前会话。请先打开或继续一个会话。'))
      return
    }
    if (!filesSnapshot) {
      filesView.append(statusPanel('正在读取文件…'))
      return
    }
    if (filesSnapshot.error) {
      filesView.append(statusPanel(filesSnapshot.error, true))
      return
    }
    const needle = filesQuery.trim().toLocaleLowerCase()
    const rows = (filesSnapshot.files || []).filter(file => !needle || String(file.path || '').toLocaleLowerCase().includes(needle))
    if (!rows.length) {
      filesView.append(statusPanel(needle ? '没有匹配的文件。' : '还没有上传文件。可使用对话输入区的回形针添加文件。'))
      return
    }
    const list = element('div', 'right-workspace-list')
    for (const file of rows) {
      const row = element('article', 'right-workspace-row')
      const open = button(file.name || file.path, 'right-workspace-row-main', () => openDocument(file.path))
      const meta = element('span', 'right-workspace-row-meta', `${formatSize(file.size)} · ${formatDate(file.modifiedAt)}`)
      open.prepend(element('span', 'right-workspace-file-mark', '▤'))
      const body = element('div', 'right-workspace-row-copy')
      body.append(open, meta)
      row.append(body, button('预览', 'right-workspace-secondary', () => openDocument(file.path)))
      list.append(row)
    }
    filesView.append(list)
  }

  async function loadFiles() {
    filesSnapshot = null
    renderFiles()
    try { filesSnapshot = await resource('files') }
    catch (error) { filesSnapshot = { error: error.message || String(error), files: [] } }
    renderFiles()
  }

  function renderDocument(file, fallbackPath) {
    documentView.replaceChildren()
    const header = element('header', 'right-workspace-document-header')
    header.append(element('strong', '', file.path || fallbackPath), element('span', '', formatSize(file.size)))
    documentView.append(header)
    if (!file.previewable) {
      const reasons = { unsupported: '此文件类型不支持内嵌预览。', 'too-large': '文件超过 1 MB 预览上限。', binary: '文件包含二进制内容。' }
      documentView.append(statusPanel(reasons[file.reason] || '无法安全预览此文件。'))
      return
    }
    const pre = element('pre', 'right-workspace-document-text')
    pre.textContent = file.text || ''
    pre.tabIndex = 0
    documentView.append(pre)
  }

  async function openDocument(path) {
    browserRestorePending = false
    documentView.replaceChildren(statusPanel('正在打开文档…'))
    controller.push('document')
    syncChrome()
    try {
      const result = await resource('filePreview', { path })
      renderDocument(result.file || {}, path)
    } catch (error) {
      documentView.replaceChildren(statusPanel(error.message || String(error), true))
    }
  }

  async function openLocalDocument(target) {
    browserRestorePending = false
    documentView.replaceChildren(statusPanel('正在安全读取本机文档…'))
    controller.push('document')
    controller.open()
    host.classList.remove('hidden')
    syncChrome()
    try {
      const result = await resource('filePreview', { path: target })
      renderDocument(result.file || {}, target)
    } catch (error) { documentView.replaceChildren(statusPanel(error.message || String(error), true)) }
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

  function renderSchedules() {
    schedulesView.replaceChildren()
    schedulesView.append(dataHeader('rightWorkspaceSchedulesSearch', '已安排', '会话级提醒只在本会话运行时触发；任何变更都会先进入输入框。', schedulesQuery, value => {
      schedulesQuery = value
      renderSchedules()
      document.querySelector('#rightWorkspaceSchedulesSearch')?.focus()
    }, () => loadSchedules()))

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
      return
    }
    if (!schedulesSnapshot) {
      schedulesView.append(statusPanel('正在读取已安排任务…'))
      return
    }
    if (schedulesSnapshot.error) {
      schedulesView.append(statusPanel(schedulesSnapshot.error, true))
      return
    }
    const needle = schedulesQuery.trim().toLocaleLowerCase()
    const rows = (schedulesSnapshot.schedules || []).filter(item => !needle || `${item.prompt} ${item.id} ${item.kind}`.toLocaleLowerCase().includes(needle))
    if (!rows.length) schedulesView.append(statusPanel(needle ? '没有匹配的任务。' : '当前会话还没有已安排任务。'))
    else {
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
  }

  async function loadSchedules() {
    schedulesSnapshot = null
    renderSchedules()
    try { schedulesSnapshot = await resource('schedules') }
    catch (error) { schedulesSnapshot = { error: error.message || String(error), schedules: [] } }
    renderSchedules()
  }

  function syncChrome() {
    const active = controller.getActiveModeId()
    const browser = active === 'browser'
    for (const node of browserOnly) node.classList.toggle('hidden', !browser)
    for (const node of modeButtons) node.setAttribute('aria-pressed', String(node.dataset.rightWorkspaceMode === active))
    document.body.classList.toggle('browser-sidebar-open', controller.isOpen())
    setBrowserContentVisible(controller.isOpen() && browser)
  }

  async function openMode(id, options = {}) {
    if (!controller.hasMode(id)) return false
    browserRestorePending = false
    if (options.push) controller.push(id)
    else controller.replace(id)
    controller.open()
    host.classList.remove('hidden')
    if (id === 'browser') {
      // During renderer hydration Electron already owns the visible browser;
      // avoid echoing the same visibility command back into the state stream.
      if (options.nativeAlreadyVisible !== true) await api.setBrowserVisible(true).catch(() => null)
    } else {
      // A non-browser pane is an explicit user intent. Keep the native state
      // aligned so later title/loading events cannot carry stale visible=true.
      await api.setBrowserVisible(false).catch(() => null)
    }
    syncChrome()
    if (id === 'files') loadFiles()
    if (id === 'schedules') loadSchedules()
    return true
  }

  async function closeWorkspace(reason = 'api') {
    browserRestorePending = false
    controller.setOpen(false, reason)
    syncChrome()
    await api.setBrowserVisible(false).catch(() => null)
    host.classList.add('hidden')
  }

  function setContext(value) {
    const sessionId = typeof value?.sessionId === 'string' && value.sessionId.length <= 256 && value.sessionId.trim() === value.sessionId ? value.sessionId : ''
    if (sessionId === context.sessionId) return
    context = { sessionId }
    filesSnapshot = null
    schedulesSnapshot = null
    if (controller.getActiveModeId() === 'files') loadFiles()
    if (controller.getActiveModeId() === 'schedules') loadSchedules()
  }

  modeButtons.forEach(node => node.addEventListener('click', () => openMode(node.dataset.rightWorkspaceMode)))
  controller.on('modechange', syncChrome)
  controller.on('push', syncChrome)
  controller.on('replace', syncChrome)
  controller.on('close', () => {
    browserRestorePending = false
    document.body.classList.remove('browser-sidebar-open')
    setBrowserContentVisible(false)
    api.setBrowserVisible(false).catch(() => {})
    host.classList.add('hidden')
  })
  controller.on('resize', ({ width }) => {
    document.documentElement.style.setProperty('--browser-panel-width', `${width}px`)
  })

  runtimeView.addEventListener('ipc-message', event => {
    if (event.channel !== 'right-workspace:context') return
    setContext(event.args?.[0])
  })
  api.onPreviewRightWorkspaceLocal?.(target => openLocalDocument(target))

  window.harnessDesktopRightWorkspace = Object.freeze({
    controller,
    openMode,
    openLocalDocument,
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
