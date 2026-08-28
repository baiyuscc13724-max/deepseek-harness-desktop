'use strict'

const DESKTOP_TARGET_ID = 'desktop'
const COORDINATE_SPACE = 'desktop-device-frame-pixels'
const DEFAULT_MAX_FPS = 2

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function positiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Math.trunc(Number(value))
  return Number.isSafeInteger(number) && number >= minimum ? Math.min(number, maximum) : fallback
}

function targetIdForWindow(window) {
  const hwnd = Number(window?.hwnd)
  if (!Number.isSafeInteger(hwnd) || hwnd <= 0) return null
  return `window:${hwnd}`
}

function authorizationError(state) {
  const scope = state?.authorization?.scope || 'none'
  const locked = state?.ready === false
  const error = new Error(locked
    ? '计算机锁定或挂起期间不能使用桌面设备控制。'
    : scope === 'none'
      ? '桌面设备控制需要复用 Computer Use 授权。'
      : 'Computer Use 控制会话尚未开启。')
  error.code = locked ? 'computer-use-locked' : scope === 'none' ? 'computer-use-authorization-required' : 'computer-use-disabled'
  error.activationRequired = scope === 'none'
  return error
}

function capabilitySnapshot(computerUse) {
  const capabilities = computerUse?.capabilities?.() || {}
  const native = capabilities.native || null
  return {
    native,
    desktopCapture: native?.desktopScreenshot === true,
    windowCapture: native?.screenshot === true,
    pointer: native?.globalInput === true || native?.input === true,
    keyboard: native?.globalInput === true || native?.input === true,
    windowEnumeration: native?.windowEnumeration === true
  }
}

function publicTarget(target) {
  return {
    id: target.id,
    kind: target.kind,
    label: target.label,
    bounds: target.bounds ? { ...target.bounds } : null,
    pid: target.pid || null,
    title: target.title || '',
    selected: target.selected === true
  }
}

class DesktopDeviceProvider {
  constructor(options = {}) {
    if (!options.computerUse) throw new Error('桌面设备 provider 需要 WindowsComputerUse。')
    if (typeof options.getControlState !== 'function') throw new Error('桌面设备 provider 需要共享 Computer Use 状态读取器。')
    this.computerUse = options.computerUse
    this.getControlState = options.getControlState
    this.requestAuthorization = typeof options.requestAuthorization === 'function' ? options.requestAuthorization : null
    this.enableControl = typeof options.enableControl === 'function' ? options.enableControl : null
    this.stopControl = typeof options.stopControl === 'function' ? options.stopControl : null
    this.frameEncoder = typeof options.frameEncoder === 'function' ? options.frameEncoder : null
    this.frameStore = options.frameStore || null
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    this.minimumFrameIntervalMs = Math.ceil(1000 / positiveInteger(options.maxFps, DEFAULT_MAX_FPS, 1, 5))
    this.selectedTargetId = DESKTOP_TARGET_ID
    this.targetCache = new Map()
    this.lastFrame = null
    this.sequence = 0
    this.stopped = false
  }

  controlState() {
    const state = this.getControlState() || {}
    return {
      available: state.available !== false,
      ready: state.ready !== false,
      enabled: state.enabled === true,
      unlimited: state.unlimited === true,
      activationRequired: state.activationRequired === true || state.authorization?.scope === 'none',
      authorization: state.authorization || { scope: 'none', unlimited: false, pending: null },
      generation: finiteNumber(state.generation, 0)
    }
  }

  status() {
    const state = this.controlState()
    const capability = capabilitySnapshot(this.computerUse)
    return {
      provider: 'windows-desktop',
      connected: state.available && Boolean(capability.native),
      ready: state.ready && state.enabled,
      streaming: !this.stopped && state.enabled,
      selectedTargetId: this.selectedTargetId,
      frameRateLimit: Math.round(1000 / this.minimumFrameIntervalMs),
      capability,
      control: state
    }
  }

  async authorize() {
    const state = this.controlState()
    if (state.authorization.scope !== 'none') {
      if (!state.enabled && this.enableControl) await this.enableControl(true)
      return this.status()
    }
    if (!this.requestAuthorization) throw authorizationError(state)
    return this.requestAuthorization('desktop-device')
  }

  #assertControl() {
    const state = this.controlState()
    if (!state.ready || !state.enabled || state.authorization.scope === 'none') throw authorizationError(state)
    this.computerUse.setUnlimited?.(state.unlimited === true)
    this.stopped = false
    return state
  }

  assertAuthorized() {
    return this.#assertControl()
  }

  async targets() {
    const state = this.#assertControl()
    const targets = []
    let bounds = null
    try {
      const value = this.computerUse.desktopBounds()
      bounds = { x: finiteNumber(value.x), y: finiteNumber(value.y), width: positiveInteger(value.width, 1), height: positiveInteger(value.height, 1) }
    } catch {}
    targets.push({ id: DESKTOP_TARGET_ID, kind: 'desktop', label: '完整 Windows 虚拟桌面', bounds, selected: this.selectedTargetId === DESKTOP_TARGET_ID })
    if (state.ready && capabilitySnapshot(this.computerUse).windowEnumeration) {
      let windows = []
      try { windows = await this.computerUse.windows() } catch {}
      for (const window of windows.slice(0, 128)) {
        const id = targetIdForWindow(window)
        if (!id) continue
        targets.push({
          id,
          kind: 'window',
          label: String(window.title || `窗口 ${window.hwnd}`).slice(0, 160),
          title: String(window.title || '').slice(0, 160),
          hwnd: Number(window.hwnd),
          pid: positiveInteger(window.pid, 0, 0),
          bounds: { x: finiteNumber(window.rect?.left), y: finiteNumber(window.rect?.top), width: positiveInteger(window.width, 1), height: positiveInteger(window.height, 1) },
          window,
          selected: this.selectedTargetId === id
        })
      }
    }
    this.targetCache = new Map(targets.map(target => [target.id, target]))
    if (!this.targetCache.has(this.selectedTargetId)) this.selectedTargetId = DESKTOP_TARGET_ID
    return targets.map(target => publicTarget({ ...target, selected: target.id === this.selectedTargetId }))
  }

  async selectTarget(targetId) {
    await this.targets()
    const target = this.targetCache.get(String(targetId || ''))
    if (!target) throw Object.assign(new Error('桌面设备目标不存在或已经失效。'), { code: 'desktop-target-not-found' })
    this.selectedTargetId = target.id
    this.lastFrame = null
    return publicTarget({ ...target, selected: true })
  }

  async #selectedTarget() {
    if (!this.targetCache.has(this.selectedTargetId)) await this.targets()
    const target = this.targetCache.get(this.selectedTargetId)
    if (!target) throw Object.assign(new Error('桌面设备目标已经失效。'), { code: 'desktop-target-not-found' })
    return target
  }

  async captureFrame(options = {}) {
    const state = this.#assertControl()
    const target = await this.#selectedTarget()
    const now = this.now()
    if (options.force !== true && this.lastFrame && this.lastFrame.target.id === target.id && this.lastFrame.controlGeneration === state.generation && now - this.lastFrame.capturedAtMs < this.minimumFrameIntervalMs) {
      return { ...this.lastFrame.public, reused: true }
    }
    const shot = target.kind === 'desktop'
      ? await this.computerUse.desktopScreenshot()
      : await this.computerUse.screenshot(target.hwnd, null, target.window)
    if (shot?.blank === true) throw Object.assign(new Error('桌面设备返回空白或受保护画面。'), { code: 'screenshot-protected' })
    const sourceWidth = positiveInteger(shot?.width, 1)
    const sourceHeight = positiveInteger(shot?.height, 1)
    const encoded = this.frameEncoder ? await this.frameEncoder(shot, target) : null
    const width = positiveInteger(encoded?.width, sourceWidth)
    const height = positiveInteger(encoded?.height, sourceHeight)
    let file = encoded?.file || null
    if (!file && encoded?.png && this.frameStore?.save) file = await this.frameStore.save(encoded.png)
    const publicFrame = {
      sequence: ++this.sequence,
      capturedAt: new Date(now).toISOString(),
      target: publicTarget({ ...target, selected: true }),
      width,
      height,
      sourceWidth,
      sourceHeight,
      originX: target.kind === 'desktop' ? finiteNumber(shot.x, target.bounds?.x || 0) : 0,
      originY: target.kind === 'desktop' ? finiteNumber(shot.y, target.bounds?.y || 0) : 0,
      coordinateSpace: COORDINATE_SPACE,
      inputBounds: { xMin: 0, yMin: 0, xMaxExclusive: width, yMaxExclusive: height },
      file,
      ...(encoded?.data ? { data: encoded.data } : {}),
      reused: false
    }
    this.lastFrame = { public: publicFrame, target, capturedAtMs: now, controlGeneration: state.generation }
    return publicFrame
  }

  #mapPoint(parameters, target) {
    const frame = this.lastFrame?.public
    if (!frame || frame.target.id !== target.id) throw Object.assign(new Error('指针操作前必须先获取当前目标的视觉帧。'), { code: 'desktop-frame-required' })
    const x = Math.round(Number(parameters?.x))
    const y = Math.round(Number(parameters?.y))
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
      throw Object.assign(new Error('指针坐标超出最新桌面设备帧。'), { code: 'desktop-coordinate-out-of-bounds', inputBounds: frame.inputBounds })
    }
    const sourceX = Math.max(0, Math.min(frame.sourceWidth - 1, Math.round(x * frame.sourceWidth / frame.width)))
    const sourceY = Math.max(0, Math.min(frame.sourceHeight - 1, Math.round(y * frame.sourceHeight / frame.height)))
    return { x, y, sourceX, sourceY }
  }

  async pointer(action, parameters = {}) {
    this.#assertControl()
    const target = await this.#selectedTarget()
    const point = this.#mapPoint(parameters, target)
    if (action === 'click') {
      if (target.kind === 'desktop') await this.computerUse.globalClick({ x: this.lastFrame.public.originX + point.sourceX, y: this.lastFrame.public.originY + point.sourceY, button: parameters.button || 'left' })
      else await this.computerUse.click(target.hwnd, { x: point.sourceX, y: point.sourceY, button: parameters.button || 'left' }, null, target.window)
    } else if (action === 'scroll') {
      const deltaY = Math.max(-800, Math.min(800, Math.round(Number(parameters.deltaY ?? parameters.delta_y) || 0)))
      if (target.kind === 'desktop') await this.computerUse.globalScroll({ x: this.lastFrame.public.originX + point.sourceX, y: this.lastFrame.public.originY + point.sourceY, deltaY })
      else await this.computerUse.scroll(target.hwnd, { x: point.sourceX, y: point.sourceY, deltaY }, null, target.window)
    } else {
      throw Object.assign(new Error('桌面设备不支持该指针动作。'), { code: 'desktop-action-unsupported' })
    }
    return { completed: true, action, targetId: target.id, x: point.x, y: point.y, coordinateSpace: COORDINATE_SPACE }
  }

  async keyboard(text) {
    this.#assertControl()
    const target = await this.#selectedTarget()
    const value = String(text || '').slice(0, 500)
    if (target.kind === 'desktop') await this.computerUse.globalType({ text: value })
    else await this.computerUse.type(target.hwnd, { text: value }, null, target.window)
    return { completed: true, action: 'type', targetId: target.id, characters: Array.from(value).length }
  }

  async stop() {
    this.stopped = true
    this.lastFrame = null
    if (this.stopControl) await this.stopControl()
    else if (this.enableControl) await this.enableControl(false)
    return this.status()
  }
}

module.exports = {
  COORDINATE_SPACE,
  DEFAULT_MAX_FPS,
  DESKTOP_TARGET_ID,
  DesktopDeviceProvider,
  authorizationError,
  capabilitySnapshot,
  targetIdForWindow
}
