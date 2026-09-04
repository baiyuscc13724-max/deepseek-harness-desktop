(() => {
  'use strict'

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function mapFramePoint(event, image, frame) {
    if (!image || !frame?.width || !frame?.height) return null
    const bounds = image.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return null
    return {
      x: clamp(Math.floor((event.clientX - bounds.left) * frame.width / bounds.width), 0, frame.width - 1),
      y: clamp(Math.floor((event.clientY - bounds.top) * frame.height / bounds.height), 0, frame.height - 1)
    }
  }

  function mapNormalizedPoint(event, image) {
    const bounds = image?.getBoundingClientRect?.()
    if (!bounds?.width || !bounds?.height) return null
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
    }
  }

  const DESKTOP_POLL_MS = 700
  const ANDROID_LEGACY_POLL_MS = 1_000
  const ANDROID_STREAM_FALLBACK_MS = 10_000
  const ANDROID_STREAM_FAILURE_LIMIT = 3

  function previewTickDelay(source, legacyAndroid) {
    if (source === 'computer') return DESKTOP_POLL_MS
    return legacyAndroid ? ANDROID_LEGACY_POLL_MS : null
  }

  function binaryFrameBytes(value) {
    if (value instanceof ArrayBuffer) return value
    if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    return null
  }

  function isDesktopFrameTransferFailure(reason) {
    const code = String(reason?.code || '')
    const message = String(reason?.message || reason || '')
    return code === 'desktop-frame-transfer-failed' || /arraybuffer|data.?clone|could not be cloned|serializ|transfer/i.test(message)
  }

  function create({ api } = {}) {
    if (!api?.desktopDeviceAction || typeof document === 'undefined') throw new Error('desktop device API is unavailable')
    const el = (tag, className, text) => {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }
    const button = (label, className, handler) => {
      const node = el('button', className, label)
      node.type = 'button'
      if (handler) node.addEventListener('click', handler)
      return node
    }
    const desktopAction = (name, payload = {}) => api.desktopDeviceAction({ action: name, payload })
    const androidAction = (name, payload = {}) => {
      if (!api.desktopAndroidAction) return Promise.reject(new Error('Android 右栏接口不可用，请重启源码实例。'))
      return api.desktopAndroidAction({ action: name, payload })
    }

    const view = el('section', 'right-workspace-pane right-workspace-device-pane')
    view.id = 'rightWorkspaceDevicesPane'
    view.setAttribute('aria-labelledby', 'rightWorkspaceDevicesHeading')

    const heading = el('div', 'right-workspace-device-heading')
    const headingCopy = el('div', '')
    const title = el('h2', '', '设备')
    title.id = 'rightWorkspaceDevicesHeading'
    headingCopy.append(title, el('p', '', '在宿主右侧栏中直接预览和操作本机电脑与 Android 设备。'))
    const status = el('span', 'right-workspace-device-status', '正在读取状态…')
    status.setAttribute('role', 'status')
    heading.append(headingCopy, status)

    const sourceCards = el('div', 'right-workspace-device-sources')
    const computerCard = button('', 'right-workspace-device-source')
    computerCard.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span><strong>本机电脑</strong><small>实时画面与结构化控制</small></span>'
    const androidCard = button('', 'right-workspace-device-source')
    androidCard.setAttribute('aria-label', '在右侧栏打开 Android 设备')
    androidCard.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M10 5h4M11 19h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span><strong>Android 设备</strong><small>ADB 真机与已有模拟器</small></span>'
    sourceCards.append(computerCard, androidCard)
    const controlsToggle = button('', 'right-workspace-device-controls-toggle', () => setControlsOpen(!controlsOpen))
    controlsToggle.setAttribute('aria-label', '显示设备控制')
    controlsToggle.setAttribute('aria-expanded', 'false')
    controlsToggle.title = '设备控制'
    controlsToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'

    const computerView = el('div', 'right-workspace-device-source-view')
    computerView.dataset.deviceSourceView = 'computer'
    const toolbar = el('div', 'right-workspace-device-toolbar')
    const targetField = el('label', 'right-workspace-device-field')
    targetField.append(el('span', '', '画面目标'))
    const targetSelect = el('select', 'right-workspace-device-select')
    targetSelect.setAttribute('aria-label', '选择桌面或窗口')
    targetField.append(targetSelect)
    const refreshButton = button('刷新', 'right-workspace-device-button', () => refreshDesktop({ force: true }))
    const controlButton = button('授权并开始', 'right-workspace-device-button primary', () => toggleControl())
    toolbar.append(targetField, refreshButton, controlButton)

    const monitor = el('div', 'right-workspace-monitor')
    const screen = el('div', 'right-workspace-device-screen right-workspace-monitor-screen')
    const empty = el('div', 'right-workspace-device-empty', '开启 Computer Use 后在这里显示所选桌面或窗口。')
    const image = el('img', 'right-workspace-device-frame right-workspace-monitor-frame')
    image.alt = '当前电脑目标的完整画面'
    image.draggable = false
    image.tabIndex = 0
    image.hidden = true
    screen.append(empty, image)
    monitor.append(screen)
    const help = el('p', 'right-workspace-device-help', '建议选择要调试的应用或虚拟机窗口，避免捕获 Harness 自身形成递归画面。单击画面执行左键，右键菜单执行右键，滚轮直接传递。')
    const compose = el('div', 'right-workspace-device-compose')
    const inputField = el('label', 'right-workspace-device-field')
    inputField.append(el('span', '', '向当前目标输入文本'))
    const input = el('input', 'right-workspace-device-input')
    input.type = 'text'
    input.maxLength = 500
    input.placeholder = '输入后发送到当前焦点'
    inputField.append(input)
    const sendButton = button('发送', 'right-workspace-device-button primary', () => sendDesktopText())
    compose.append(inputField, sendButton)
    computerView.append(toolbar, monitor, help, compose)

    const androidView = el('div', 'right-workspace-device-source-view')
    androidView.dataset.deviceSourceView = 'android'
    androidView.hidden = true
    const androidToolbar = el('div', 'right-workspace-device-toolbar')
    const androidTargetField = el('label', 'right-workspace-device-field')
    androidTargetField.append(el('span', '', 'ADB 设备'))
    const androidSelect = el('select', 'right-workspace-device-select')
    androidSelect.setAttribute('aria-label', '选择 Android 真机或模拟器')
    androidTargetField.append(androidSelect)
    const androidRefresh = button('刷新', 'right-workspace-device-button', () => manualRefreshAndroid())
    androidToolbar.append(androidTargetField, androidRefresh)

    const androidScreen = el('div', 'right-workspace-android-stage')
    const phoneFrame = el('div', 'right-workspace-phone-frame')
    const androidEmpty = el('div', 'right-workspace-device-empty right-workspace-phone-empty', '正在查找 ADB 设备…')
    const androidImage = el('img', 'right-workspace-device-frame right-workspace-android-frame')
    androidImage.alt = '当前 Android 设备的完整手机画面'
    androidImage.draggable = false
    androidImage.tabIndex = 0
    androidImage.hidden = true
    phoneFrame.append(androidEmpty, androidImage)
    androidScreen.append(phoneFrame)

    const androidButtons = el('div', 'right-workspace-device-nav')
    const androidControlButton = (label, name) => button(label, 'right-workspace-device-button', () => sendAndroidControl({ kind: 'button', name }))
    androidButtons.append(
      androidControlButton('返回', 'back'),
      androidControlButton('主页', 'home'),
      androidControlButton('最近任务', 'recents'),
      button('旋转', 'right-workspace-device-button', () => sendAndroidControl({ kind: 'rotate' }))
    )
    const androidHelp = el('p', 'right-workspace-device-help', '画面直接显示在当前右侧栏内。单击为轻触，按住拖动为滑动；设备、ADB、Android SDK 与模拟器仍由用户自行安装和管理。')
    const androidCompose = el('div', 'right-workspace-device-compose')
    const androidInputField = el('label', 'right-workspace-device-field')
    androidInputField.append(el('span', '', '向 Android 输入文本'))
    const androidInput = el('input', 'right-workspace-device-input')
    androidInput.type = 'text'
    androidInput.maxLength = 500
    androidInput.placeholder = '输入后发送到设备当前焦点'
    androidInputField.append(androidInput)
    const androidSend = button('发送', 'right-workspace-device-button primary', () => sendAndroidText())
    androidCompose.append(androidInputField, androidSend)
    androidView.append(androidToolbar, androidScreen, androidButtons, androidHelp, androidCompose)

    const error = el('p', 'right-workspace-device-error')
    error.setAttribute('role', 'alert')
    error.hidden = true
    view.append(heading, sourceCards, computerView, androidView, error, controlsToggle)

    let active = false
    let controlsOpen = false
    let activeSource = 'computer'
    let disposed = false
    let timer = 0
    let androidReconnectTimer = 0
    let busy = false
    let snapshot = null
    let frame = null
    let desktopFrameObjectUrl = ''
    let desktopLegacyFallbackUntil = 0
    let targets = []
    let androidBusy = false
    let androidDevices = []
    let androidAvds = []
    let androidSerial = ''
    let androidStreamUrl = ''
    let androidTransport = ''
    let androidLegacyForced = false
    let androidLegacyFallbackUntil = 0
    let androidStreamFailures = 0
    let androidPointerStart = null

    function showError(reason) {
      error.textContent = reason ? (reason.message || String(reason)) : ''
      error.hidden = !error.textContent
    }

    function clearDesktopFrame() {
      frame = null
      image.removeAttribute('src')
      if (desktopFrameObjectUrl) window.URL.revokeObjectURL(desktopFrameObjectUrl)
      desktopFrameObjectUrl = ''
    }

    function applyDesktopFrame(captured) {
      if (typeof captured?.data === 'string' && captured.data.startsWith('data:image/')) {
        if (desktopFrameObjectUrl) window.URL.revokeObjectURL(desktopFrameObjectUrl)
        desktopFrameObjectUrl = ''
        frame = captured
        return true
      }
      const bytes = binaryFrameBytes(captured?.bytes)
      if (!bytes || typeof window.Blob !== 'function' || typeof window.URL?.createObjectURL !== 'function') return false
      const nextUrl = window.URL.createObjectURL(new window.Blob([bytes], { type: captured.mimeType || 'image/png' }))
      const previousUrl = desktopFrameObjectUrl
      desktopFrameObjectUrl = nextUrl
      const { bytes: _releasedBytes, ...metadata } = captured
      frame = { ...metadata, data: nextUrl }
      if (previousUrl) window.URL.revokeObjectURL(previousUrl)
      return true
    }

    function androidLegacyActive(now = Date.now()) {
      return androidLegacyForced || androidLegacyFallbackUntil > now
    }

    function setAndroidPreview(url, transport) {
      androidStreamUrl = String(url || '')
      androidTransport = androidStreamUrl ? transport : ''
      if (!androidStreamUrl) androidImage.removeAttribute('src')
      else if (androidImage.src !== androidStreamUrl) androidImage.src = androidStreamUrl
    }

    function clearAndroidPreview() {
      androidStreamUrl = ''
      androidTransport = ''
      androidImage.removeAttribute('src')
    }

    function setControlsOpen(open) {
      controlsOpen = Boolean(open)
      view.classList.toggle('is-controls-open', controlsOpen)
      controlsToggle.setAttribute('aria-expanded', String(controlsOpen))
      controlsToggle.setAttribute('aria-label', controlsOpen ? '隐藏设备控制' : '显示设备控制')
    }

    function renderSources() {
      const computer = activeSource === 'computer'
      computerCard.classList.toggle('is-active', computer)
      androidCard.classList.toggle('is-active', !computer)
      computerCard.setAttribute('aria-pressed', String(computer))
      androidCard.setAttribute('aria-pressed', String(!computer))
      computerView.hidden = !computer
      androidView.hidden = computer
    }

    function renderDesktop() {
      const ready = snapshot?.ready === true
      if (activeSource === 'computer') {
        status.textContent = ready ? '控制中' : (snapshot?.connected ? '可用' : '未开启')
        status.dataset.state = ready ? 'live' : (snapshot?.connected ? 'ready' : 'off')
      }
      targetSelect.disabled = !ready || busy
      refreshButton.disabled = !ready || busy
      input.disabled = !ready || busy
      sendButton.disabled = !ready || busy || !input.value
      controlButton.disabled = busy || snapshot?.control?.ready === false
      controlButton.textContent = ready ? '停止' : '授权并开始'
      controlButton.classList.toggle('primary', !ready)
      const selected = targets.find(target => target.selected)?.id || snapshot?.selectedTargetId || 'desktop'
      const prior = targetSelect.value
      targetSelect.replaceChildren(...targets.map(target => {
        const option = document.createElement('option')
        option.value = target.id
        option.textContent = target.kind === 'desktop' ? `整个桌面 · ${target.label}` : target.label
        return option
      }))
      if (targets.some(target => target.id === selected)) targetSelect.value = selected
      else if (targets.some(target => target.id === prior)) targetSelect.value = prior
      image.hidden = !frame?.data
      empty.hidden = Boolean(frame?.data)
      if (frame?.data && image.src !== frame.data) image.src = frame.data
    }

    function renderAndroid() {
      const online = androidDevices.filter(device => device.state === 'device')
      if (activeSource === 'android') {
        const previewStatus = androidTransport === 'stream' ? '实时' : '兼容预览'
        status.textContent = androidBusy ? '正在连接' : (androidStreamUrl ? previewStatus : (online.length ? '可用' : '未连接'))
        status.dataset.state = androidStreamUrl ? 'live' : (online.length ? 'ready' : 'off')
      }
      const prior = androidSelect.value
      androidSelect.replaceChildren(...androidDevices.map(device => {
        const option = document.createElement('option')
        option.value = device.serial
        option.disabled = device.state !== 'device'
        const kind = device.kind === 'emulator' ? '模拟器' : '真机'
        const identity = device.model && device.model !== device.serial ? `${device.model} · ${device.serial}` : device.serial
        option.textContent = `${identity} · ${kind}${device.state === 'device' ? '' : ` · ${device.state}`}`
        return option
      }))
      if (androidDevices.some(device => device.serial === androidSerial)) androidSelect.value = androidSerial
      else if (androidDevices.some(device => device.serial === prior)) androidSelect.value = prior
      androidSelect.disabled = androidBusy || !androidDevices.length
      androidRefresh.disabled = androidBusy
      androidInput.disabled = androidBusy || !androidSerial
      androidSend.disabled = androidBusy || !androidSerial || !androidInput.value
      for (const node of androidButtons.querySelectorAll('button')) node.disabled = androidBusy || !androidSerial
      androidImage.hidden = !androidStreamUrl
      androidEmpty.hidden = Boolean(androidStreamUrl)
      if (!androidStreamUrl) {
        androidEmpty.textContent = online.length
          ? '选择在线设备后将在这里显示实时画面。'
          : `未发现在线 ADB 设备。${androidAvds.length ? `已有 AVD：${androidAvds.join('、')}；请先用现有 Android 工具启动。` : ''}`
      }
    }

    function render() {
      renderSources()
      renderDesktop()
      renderAndroid()
    }

    async function invokeDesktop(name, payload = {}, { quiet = false, throwOnError = false } = {}) {
      if (!quiet) { busy = true; showError(null); render() }
      try { return await desktopAction(name, payload) }
      catch (reason) {
        if (throwOnError) throw reason
        if (!quiet) showError(reason)
        return null
      }
      finally { if (!quiet) { busy = false; render() } }
    }

    async function invokeAndroid(name, payload = {}, { quiet = false } = {}) {
      if (!quiet) { androidBusy = true; showError(null); render() }
      try { return await androidAction(name, payload) }
      catch (reason) { if (!quiet) showError(reason); return null }
      finally { if (!quiet) { androidBusy = false; render() } }
    }

    async function refreshDesktop({ force = false, quiet = false } = {}) {
      const next = await invokeDesktop('status', {}, { quiet })
      if (!next || disposed) return
      snapshot = next
      if (!next.ready) {
        targets = []
        desktopLegacyFallbackUntil = 0
        clearDesktopFrame()
        render()
        return
      }
      const listed = await invokeDesktop('targets', {}, { quiet: true })
      if (listed?.targets) targets = listed.targets
      const screenshotPayload = { force }
      if (desktopLegacyFallbackUntil > Date.now()) screenshotPayload.fallbackReason = 'transfer-unavailable'
      let captured = null
      let captureError = null
      try { captured = await invokeDesktop('screenshot', screenshotPayload, { quiet, throwOnError: true }) }
      catch (reason) { captureError = reason }
      let applied = applyDesktopFrame(captured)
      const transferFailed = captured?.transport === 'array-buffer' || isDesktopFrameTransferFailure(captureError)
      if (!applied && transferFailed && screenshotPayload.fallbackReason !== 'transfer-unavailable' && snapshot?.ready) {
        desktopLegacyFallbackUntil = Date.now() + 5_000
        captured = await invokeDesktop('screenshot', { force: true, fallbackReason: 'transfer-unavailable' }, { quiet: true })
        applied = applyDesktopFrame(captured)
      }
      if (applied) showError(null)
      if (applied && captured?.transport === 'array-buffer') desktopLegacyFallbackUntil = 0
      if (!applied && !quiet) showError(captureError || new Error('桌面预览传输不可用。'))
      render()
    }

    async function captureAndroid({ quiet = true } = {}) {
      if (!androidSerial) return false
      const captured = await invokeAndroid('capture', { device: androidSerial, preview: true }, { quiet })
      if (!captured?.data) return false
      setAndroidPreview(captured.data, 'legacy')
      render()
      return true
    }

    async function connectAndroid(serial, { quiet = false } = {}) {
      if (!serial) return false
      const switched = await invokeAndroid('switchDevice', { device: serial }, { quiet })
      if (!switched?.device) return false
      androidSerial = switched.device || serial
      androidLegacyForced = switched.previewTransport === 'legacy-capture-poll'
      if (androidLegacyActive()) return captureAndroid({ quiet })
      if (!switched.streamUrl) return false
      setAndroidPreview(switched.streamUrl, 'stream')
      render()
      return true
    }

    async function refreshAndroid({ selectFirst = false, forceStream = false, quiet = false } = {}) {
      const listing = await invokeAndroid('devices', {}, { quiet })
      if (!listing || disposed) return false
      androidLegacyForced = listing.previewTransport === 'legacy-capture-poll'
      androidDevices = Array.isArray(listing.devices) ? listing.devices : []
      androidAvds = Array.isArray(listing.avds) ? listing.avds : []
      const online = androidDevices.filter(device => device.state === 'device')
      if (!online.some(device => device.serial === androidSerial)) {
        androidSerial = online.find(device => device.streaming)?.serial || (selectFirst ? online[0]?.serial : '') || ''
        clearAndroidPreview()
      }
      render()
      if (!androidSerial) return false
      if (forceStream || !androidStreamUrl || (androidTransport === 'legacy' && !androidLegacyActive())) {
        return connectAndroid(androidSerial, { quiet })
      }
      if (androidLegacyActive()) return captureAndroid({ quiet: true })
      return true
    }

    function scheduleTick(delay) {
      window.clearTimeout(timer)
      timer = 0
      if (active && !disposed && Number.isFinite(delay)) timer = window.setTimeout(tick, delay)
    }

    function scheduleAndroidReconnect() {
      window.clearTimeout(androidReconnectTimer)
      if (!active || disposed || activeSource !== 'android' || androidLegacyActive()) return
      const delay = Math.min(2_000, 250 * (2 ** Math.max(0, androidStreamFailures - 1)))
      androidReconnectTimer = window.setTimeout(async () => {
        androidReconnectTimer = 0
        const connected = await refreshAndroid({ forceStream: true, quiet: true })
        if (!connected && active && !disposed && activeSource === 'android') {
          androidStreamFailures += 1
          if (androidStreamFailures >= ANDROID_STREAM_FAILURE_LIMIT) {
            androidLegacyFallbackUntil = Date.now() + ANDROID_STREAM_FALLBACK_MS
            await captureAndroid({ quiet: true })
            scheduleTick(ANDROID_LEGACY_POLL_MS)
          } else scheduleAndroidReconnect()
        }
      }, delay)
    }

    async function tick() {
      if (!active || disposed) return
      if (activeSource === 'computer') {
        await refreshDesktop({ quiet: true })
      } else if (androidLegacyActive()) {
        await refreshAndroid({ quiet: true })
      } else if (androidTransport === 'legacy' || !androidStreamUrl) {
        await refreshAndroid({ forceStream: true, quiet: true })
      }
      scheduleTick(previewTickDelay(activeSource, androidLegacyActive()))
    }

    async function setSource(source) {
      setControlsOpen(false)
      if (source === activeSource) return
      activeSource = source
      window.clearTimeout(timer)
      window.clearTimeout(androidReconnectTimer)
      if (source === 'android') clearDesktopFrame()
      else clearAndroidPreview()
      showError(null)
      render()
      if (source === 'android') await refreshAndroid({ selectFirst: true, forceStream: true })
      else await refreshDesktop({ force: true, quiet: true })
      scheduleTick(previewTickDelay(source, androidLegacyActive()))
    }

    async function manualRefreshAndroid() {
      androidLegacyFallbackUntil = 0
      androidStreamFailures = 0
      window.clearTimeout(androidReconnectTimer)
      await refreshAndroid({ selectFirst: true, forceStream: true })
      scheduleTick(previewTickDelay('android', androidLegacyActive()))
    }

    async function toggleControl() {
      if (snapshot?.ready) await invokeDesktop('stop')
      else await invokeDesktop('requestAuthorization')
      await refreshDesktop({ force: true, quiet: true })
    }

    async function sendDesktopText() {
      const text = input.value
      if (!text) return
      await invokeDesktop('type', { text })
      input.value = ''
      render()
      await refreshDesktop({ force: true, quiet: true })
    }

    async function pointer(event, buttonName) {
      const point = mapFramePoint(event, image, frame)
      if (!point) return
      await invokeDesktop('click', { ...point, button: buttonName })
      await refreshDesktop({ force: true, quiet: true })
    }

    async function sendAndroidControl(control, { quiet = false } = {}) {
      if (!androidSerial) return null
      return invokeAndroid('control', { device: androidSerial, control }, { quiet })
    }

    async function sendAndroidText() {
      const text = androidInput.value
      if (!text || !androidSerial) return
      const result = await sendAndroidControl({ kind: 'type', text })
      if (result) androidInput.value = ''
      render()
    }

    computerCard.addEventListener('click', () => setSource('computer'))
    androidCard.addEventListener('click', () => setSource('android'))
    image.addEventListener('click', event => pointer(event, 'left'))
    image.addEventListener('contextmenu', event => { event.preventDefault(); pointer(event, 'right') })
    image.addEventListener('wheel', async event => {
      event.preventDefault()
      const point = mapFramePoint(event, image, frame)
      if (!point) return
      await invokeDesktop('scroll', { ...point, delta_y: clamp(Math.round(event.deltaY), -800, 800) }, { quiet: true })
      await refreshDesktop({ force: true, quiet: true })
    }, { passive: false })
    input.addEventListener('input', render)
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); sendDesktopText() }
    })
    targetSelect.addEventListener('change', async () => {
      await invokeDesktop('selectTarget', { target_id: targetSelect.value })
      clearDesktopFrame()
      await refreshDesktop({ force: true, quiet: true })
    })
    androidSelect.addEventListener('change', () => {
      androidLegacyFallbackUntil = 0
      androidStreamFailures = 0
      window.clearTimeout(androidReconnectTimer)
      connectAndroid(androidSelect.value).then(() => scheduleTick(previewTickDelay('android', androidLegacyActive())))
    })
    androidInput.addEventListener('input', render)
    androidInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); sendAndroidText() }
    })
    androidImage.addEventListener('load', () => {
      if (androidTransport !== 'stream') return
      androidStreamFailures = 0
      androidLegacyFallbackUntil = 0
      window.clearTimeout(androidReconnectTimer)
      render()
    })
    androidImage.addEventListener('error', async () => {
      const failedTransport = androidTransport
      clearAndroidPreview()
      if (failedTransport !== 'stream' || !active || disposed || activeSource !== 'android') {
        scheduleTick(previewTickDelay(activeSource, androidLegacyActive()))
        return
      }
      androidStreamFailures += 1
      if (androidStreamFailures >= ANDROID_STREAM_FAILURE_LIMIT) {
        androidLegacyFallbackUntil = Date.now() + ANDROID_STREAM_FALLBACK_MS
        await captureAndroid({ quiet: true })
        scheduleTick(ANDROID_LEGACY_POLL_MS)
      } else scheduleAndroidReconnect()
      render()
    })
    androidImage.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !androidSerial) return
      androidPointerStart = { point: mapNormalizedPoint(event, androidImage), at: Date.now() }
      androidImage.setPointerCapture?.(event.pointerId)
    })
    androidImage.addEventListener('pointerup', async event => {
      if (!androidPointerStart || event.button !== 0) return
      const start = androidPointerStart
      androidPointerStart = null
      const end = mapNormalizedPoint(event, androidImage)
      if (!start.point || !end) return
      const distance = Math.abs(end.x - start.point.x) + Math.abs(end.y - start.point.y)
      if (distance < 0.015) await sendAndroidControl({ kind: 'tap', x: end.x, y: end.y })
      else await sendAndroidControl({ kind: 'drag', fromX: start.point.x, fromY: start.point.y, toX: end.x, toY: end.y, durationMs: clamp(Date.now() - start.at, 100, 2_000) })
    })
    androidImage.addEventListener('pointercancel', () => { androidPointerStart = null })

    render()
    return {
      view,
      activate() {
        if (disposed || active) return
        active = true
        scheduleTick(0)
      },
      deactivate() {
        active = false
        window.clearTimeout(timer)
        window.clearTimeout(androidReconnectTimer)
        clearDesktopFrame()
        clearAndroidPreview()
      },
      dispose() {
        active = false
        disposed = true
        window.clearTimeout(timer)
        window.clearTimeout(androidReconnectTimer)
        clearDesktopFrame()
        clearAndroidPreview()
      },
      refresh() {
        return activeSource === 'computer' ? refreshDesktop({ force: true }) : manualRefreshAndroid()
      }
    }
  }

  const exported = {
    ANDROID_LEGACY_POLL_MS,
    ANDROID_STREAM_FAILURE_LIMIT,
    ANDROID_STREAM_FALLBACK_MS,
    DESKTOP_POLL_MS,
    binaryFrameBytes,
    clamp,
    create,
    isDesktopFrameTransferFailure,
    mapFramePoint,
    mapNormalizedPoint,
    previewTickDelay
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = exported
  if (typeof window !== 'undefined') window.HarnessDeviceWorkspace = Object.freeze(exported)
})()
