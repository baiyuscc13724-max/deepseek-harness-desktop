'use strict'

const { DESKTOP_TARGET_ID } = require('./desktop-device-stream.cjs')

const MAX_TREE_NODES = 500
const BROWSER_EXECUTABLES = new Set(['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe'])
const ACTIONS = Object.freeze(['status', 'targets', 'selectTarget', 'observe', 'inspect', 'click', 'type', 'scroll', 'screenshot', 'requestAuthorization', 'stop'])

function safeText(value, maximum = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximum)
}

function safeBounds(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x ?? value.left)
  const y = Number(value.y ?? value.top)
  const width = Number(value.width ?? (Number(value.right) - x))
  const height = Number(value.height ?? (Number(value.bottom) - y))
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

function browserLike(node) {
  const executable = safeText(node?.executable || node?.exeName, 80).toLowerCase()
  const role = safeText(node?.role, 80).toLowerCase()
  const className = safeText(node?.className, 160).toLowerCase()
  return BROWSER_EXECUTABLES.has(executable) || role === 'browser' || /chrome_widgetwin|mozilla_window_class/.test(className)
}

function browserPreferredError() {
  return Object.assign(new Error('网页界面必须优先使用 browser_control 的 CDP/DOM 结构化通道；桌面 UI 控件树只用于非网页软件或浏览器结构化通道明确不可用时。'), {
    code: 'browser-control-preferred',
    preferredTool: 'browser_control'
  })
}

class WindowsDesktopUi {
  constructor(options = {}) {
    if (!options.provider) throw new Error('WindowsDesktopUi 需要 DesktopDeviceProvider。')
    this.provider = options.provider
    this.controlSource = options.controlSource || null
    this.browserControlAvailable = typeof options.browserControlAvailable === 'function' ? options.browserControlAvailable : () => false
    this.refs = new Map()
    this.generation = 0
    this.selectionGeneration = 0
    this.selectedTargetId = DESKTOP_TARGET_ID
    this.controlGeneration = null
    this.pendingNative = new Set()
  }

  #assertControl(expectedGeneration = null) {
    // UIA perform/inspect must not bypass the provider gate merely because they
    // do not use its screenshot or coordinate-input methods.
    if (typeof this.provider.assertAuthorized !== 'function') {
      throw Object.assign(new Error('桌面控制缺少共享授权校验。'), { code: 'desktop-control-unavailable' })
    }
    let state
    try { state = this.provider.assertAuthorized() }
    catch (error) { this.refs.clear(); throw error }
    const generation = state?.generation
    if (!Number.isSafeInteger(generation)) throw Object.assign(new Error('桌面控制会话代际无效。'), { code: 'desktop-control-unavailable' })
    if (this.controlGeneration !== null && this.controlGeneration !== generation) this.refs.clear()
    this.controlGeneration = generation
    if (expectedGeneration !== null && expectedGeneration !== generation) {
      throw Object.assign(new Error('桌面控制会话已变化；请重新 observe。'), { code: 'desktop-ui-ref-stale' })
    }
    return generation
  }

  #register(raw, parentRef = null, depth = 0) {
    if (this.refs.size >= MAX_TREE_NODES) return null
    const ref = `desktop-ui:${this.generation}:${this.refs.size + 1}`
    const bounds = safeBounds(raw?.bounds)
    const node = {
      ref,
      parentRef,
      role: safeText(raw?.role || 'control', 80) || 'control',
      name: safeText(raw?.name || raw?.label || raw?.title, 300),
      value: safeText(raw?.value, 500),
      description: safeText(raw?.description, 500),
      bounds,
      boundsCoordinateSpace: raw?.boundsCoordinateSpace || 'desktop-device-frame-pixels',
      browserContext: browserLike(raw) || this.refs.get(parentRef)?.browserContext === true,
      enabled: raw?.enabled !== false,
      focused: raw?.focused === true,
      selected: raw?.selected === true,
      clickable: raw?.clickable === true,
      editable: raw?.editable === true,
      scrollable: raw?.scrollable === true,
      sensitive: raw?.sensitive === true,
      targetId: safeText(raw?.targetId || this.selectedTargetId, 160),
      executable: safeText(raw?.executable || raw?.exeName, 160),
      className: safeText(raw?.className, 160),
      depth
    }
    this.refs.set(ref, { ...node, raw })
    const children = []
    for (const child of Array.isArray(raw?.children) ? raw.children : []) {
      const registered = this.#register(child, ref, depth + 1)
      if (registered) children.push(registered)
      if (this.refs.size >= MAX_TREE_NODES) break
    }
    return { ...node, children }
  }

  async status() {
    return { ...this.provider.status(), structuredUi: { available: true, actions: ACTIONS, selectedTargetId: this.selectedTargetId, generation: this.generation } }
  }

  async targets() {
    const controlGeneration = this.#assertControl()
    const targets = await this.provider.targets()
    this.#assertControl(controlGeneration)
    if (!targets.some(target => target.id === this.selectedTargetId)) {
      this.selectedTargetId = DESKTOP_TARGET_ID
      this.refs.clear()
    }
    return targets.map(target => ({ ...target, selected: target.id === this.selectedTargetId }))
  }

  async selectTarget(targetId) {
    const controlGeneration = this.#assertControl()
    const selectionGeneration = ++this.selectionGeneration
    const generation = this.generation
    // Invalidate at request admission, not after the native selection await.
    this.refs.clear()
    let selected
    try {
      selected = await this.provider.selectTarget(targetId)
      this.#assertControl(controlGeneration)
      if (selectionGeneration !== this.selectionGeneration || generation !== this.generation) {
        throw Object.assign(new Error('桌面目标选择已被新请求取代；请重新 selectTarget 和 observe。'), { code: 'desktop-ui-ref-stale' })
      }
    } catch (error) {
      // Native selection may already have happened. Do not trust intervening
      // refs or observations still waiting, including on an unknown outcome.
      // Never automatically reselect after an uncertain native completion.
      this.refs.clear()
      this.generation += 1
      throw error
    }
    this.selectedTargetId = selected.id
    this.refs.clear()
    return selected
  }

  async observe(options = {}) {
    const controlGeneration = this.#assertControl()
    const generation = ++this.generation
    const selectionGeneration = this.selectionGeneration
    const targetId = this.selectedTargetId
    this.refs.clear()
    const targets = await this.targets()
    this.#assertControl(controlGeneration)
    if (generation !== this.generation || selectionGeneration !== this.selectionGeneration || targetId !== this.selectedTargetId) throw Object.assign(new Error('桌面观察目标已变化；请重新 observe。'), { code: 'desktop-ui-ref-stale' })
    const selected = targets.find(entry => entry.id === this.selectedTargetId) || targets[0]
    if (!selected) throw Object.assign(new Error('桌面设备目标不存在。'), { code: 'desktop-target-not-found' })
    // Public provider targets intentionally omit native handles. Recover only
    // the handle encoded in the freshly enumerated, Host-owned target ID.
    const target = { ...selected, hwnd: selected.kind === 'window' && /^window:[1-9]\d*$/.test(selected.id) ? Number(selected.id.slice(7)) : 0 }
    let rawTree = null
    if (this.controlSource?.observe) rawTree = await this.controlSource.observe(target, { maxNodes: Math.min(MAX_TREE_NODES, Math.max(1, Number(options.maxNodes) || MAX_TREE_NODES)) })
    this.#assertControl(controlGeneration)
    if (generation !== this.generation || selectionGeneration !== this.selectionGeneration || targetId !== this.selectedTargetId) throw Object.assign(new Error('桌面观察目标已变化；请重新 observe。'), { code: 'desktop-ui-ref-stale' })
    if (!rawTree) {
      if (target.kind === 'desktop') {
        rawTree = {
          role: 'desktop',
          name: target.label,
          bounds: target.bounds,
          targetId: target.id,
          children: targets.filter(entry => entry.kind === 'window').map(entry => ({
            role: 'window', name: entry.label, bounds: entry.bounds, targetId: entry.id, clickable: true, pid: entry.pid
          }))
        }
      } else {
        rawTree = { role: 'window', name: target.label, bounds: { x: 0, y: 0, width: target.bounds?.width || 1, height: target.bounds?.height || 1 }, targetId: target.id, clickable: true }
      }
    }
    const root = this.#register(rawTree)
    return {
      generation: this.generation,
      selectedTargetId: this.selectedTargetId,
      root,
      nodeCount: this.refs.size,
      truncated: this.refs.size >= MAX_TREE_NODES,
      coordinateFallback: 'Use screenshot and pixel coordinates only when no usable structured ref exists.',
      browserPreference: 'Use browser_control for web pages whenever its CDP/DOM channel is available.'
    }
  }

  inspect(ref) {
    this.#assertControl()
    const entry = this.refs.get(String(ref || ''))
    if (!entry) throw Object.assign(new Error('桌面 UI ref 已失效；请重新 observe。'), { code: 'desktop-ui-ref-stale' })
    const { raw, ...node } = entry
    return node
  }

  async #entry(ref, action, signal = null) {
    const controlGeneration = this.#assertControl()
    // Shared authorization alone does not bind this observation or target.
    // Retain the exact Map entry across every await; never borrow a newer ref.
    const generation = this.generation
    const targetId = this.selectedTargetId
    const refKey = String(ref || '')
    const entry = this.refs.get(refKey)
    const assertCurrent = () => {
      this.#assertControl(controlGeneration)
      if (signal?.aborted) throw Object.assign(new Error('桌面模型操作已取消。'), { code: 'browser-action-cancelled' })
      if (!entry || generation !== this.generation || targetId !== this.selectedTargetId || this.refs.get(refKey) !== entry) {
        throw Object.assign(new Error('桌面 UI ref 或目标已变化；禁止使用旧引用，请重新 observe。'), { code: 'desktop-ui-ref-stale' })
      }
    }
    assertCurrent()
    if (!entry.enabled) throw Object.assign(new Error('桌面 UI 控件已禁用。'), { code: 'desktop-ui-disabled' })
    if (action === 'type' && entry.sensitive === true) throw Object.assign(new Error('桌面结构化控制不会向密码或敏感输入控件写入内容。'), { code: 'desktop-ui-sensitive-input' })
    if ((entry.browserContext || browserLike(entry)) && this.browserControlAvailable() === true) throw browserPreferredError()
    if (entry.targetId && entry.targetId !== targetId) {
      throw Object.assign(new Error('此 ref 不属于当前桌面目标；请 selectTarget 后重新 observe。'), { code: 'desktop-ui-ref-stale' })
    }
    assertCurrent()
    if (this.controlSource?.perform) {
      const controller = new AbortController()
      const cancel = () => controller.abort()
      this.pendingNative.add(controller)
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      let result
      try { result = await this.controlSource.perform(action, entry.raw, entry, { signal: controller.signal }) }
      finally { signal?.removeEventListener('abort', cancel); this.pendingNative.delete(controller) }
      assertCurrent()
      if (result?.reason === 'stale') {
        this.refs.clear()
        throw Object.assign(new Error('桌面 UI 目标已失效；禁止回退旧坐标，请重新 observe。'), { code: 'desktop-ui-ref-stale' })
      }
      if (result?.reason === 'disabled') throw Object.assign(new Error('桌面 UI 控件已禁用，请重新 observe。'), { code: 'desktop-ui-disabled' })
      if (result?.reason === 'sensitive' || result?.sensitive === true) throw Object.assign(new Error('桌面 UI 控件已变成敏感输入，禁止继续。'), { code: 'desktop-ui-sensitive-input' })
      if (result?.handled === true) return { entry, result, assertCurrent }
      if (action === 'type' && result?.focused === true) return { entry, result: null, assertCurrent }
    }
    if (action === 'type') throw Object.assign(new Error('未能确认目标输入控件已取得焦点；请重新 observe，禁止向当前未知焦点输入。'), { code: 'desktop-ui-focus-unverified' })
    return { entry, result: null, assertCurrent }
  }

  #framePoint(entry, frame) {
    const bounds = entry.bounds
    if (!bounds) throw Object.assign(new Error('该桌面 UI ref 没有可操作边界。'), { code: 'desktop-ui-bounds-unavailable' })
    let x = bounds.x + Math.floor(bounds.width / 2)
    let y = bounds.y + Math.floor(bounds.height / 2)
    if (entry.boundsCoordinateSpace === 'global-screen-pixels') {
      const originX = frame?.target?.kind === 'window' ? frame.target.bounds?.x : frame?.originX
      const originY = frame?.target?.kind === 'window' ? frame.target.bounds?.y : frame?.originY
      const values = [originX, originY, frame?.sourceWidth, frame?.sourceHeight, frame?.width, frame?.height]
      if (!values.every(Number.isFinite) || values.slice(2).some(value => value <= 0)) throw Object.assign(new Error('桌面 UIA 坐标缺少当前截图映射信息，请重新截图。'), { code: 'desktop-ui-bounds-unavailable' })
      x = Math.round((x - originX) * frame.width / frame.sourceWidth)
      y = Math.round((y - originY) * frame.height / frame.sourceHeight)
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) throw Object.assign(new Error('桌面 UIA 控件已移出当前截图范围，请重新 observe。'), { code: 'desktop-ui-ref-stale' })
    }
    return { x, y }
  }

  async click(ref, signal = null) {
    const { entry, result, assertCurrent } = await this.#entry(ref, 'click', signal)
    assertCurrent()
    if (result) return result
    if (!entry.bounds) throw Object.assign(new Error('该桌面 UI ref 没有可操作边界。'), { code: 'desktop-ui-bounds-unavailable' })
    const frame = await this.provider.captureFrame()
    assertCurrent()
    return this.provider.pointer('click', this.#framePoint(entry, frame))
  }

  async type(ref, text, signal = null) {
    const { result, assertCurrent } = await this.#entry(ref, 'type', signal)
    assertCurrent()
    if (result) return result
    return this.provider.keyboard(text)
  }

  async scroll(ref, deltaY, signal = null) {
    const { entry, result, assertCurrent } = await this.#entry(ref, 'scroll', signal)
    assertCurrent()
    if (result) return result
    if (!entry.bounds) throw Object.assign(new Error('该桌面 UI ref 没有可操作边界。'), { code: 'desktop-ui-bounds-unavailable' })
    const frame = await this.provider.captureFrame()
    assertCurrent()
    return this.provider.pointer('scroll', { ...this.#framePoint(entry, frame), deltaY })
  }

  async action(input = {}, { signal = null } = {}) {
    if (signal?.aborted) throw Object.assign(new Error('桌面模型操作已取消。'), { code: 'browser-action-cancelled' })
    const action = safeText(input.action, 40)
    const payload = input.payload && typeof input.payload === 'object' ? input.payload : input
    if (action === 'status') return this.status()
    if (action === 'targets') return { targets: await this.targets() }
    if (action === 'selectTarget') return this.selectTarget(payload.target_id || payload.targetId)
    if (action === 'observe') return this.observe(payload)
    if (action === 'inspect') return this.inspect(payload.ref)
    if (action === 'click') return payload.ref ? this.click(payload.ref, signal) : this.provider.pointer('click', payload)
    if (action === 'type') return payload.ref ? this.type(payload.ref, payload.text, signal) : this.provider.keyboard(payload.text)
    if (action === 'scroll') return payload.ref ? this.scroll(payload.ref, payload.delta_y ?? payload.deltaY, signal) : this.provider.pointer('scroll', payload)
    if (action === 'screenshot') return this.provider.captureFrame({ force: payload.force === true })
    if (action === 'requestAuthorization') return this.provider.authorize()
    if (action === 'stop') {
      for (const controller of this.pendingNative) controller.abort()
      this.pendingNative.clear()
      this.refs.clear()
      this.generation += 1
      return this.provider.stop()
    }
    throw Object.assign(new Error('不支持的桌面结构化控制动作。'), { code: 'desktop-action-unsupported' })
  }
}

module.exports = {
  ACTIONS,
  BROWSER_EXECUTABLES,
  MAX_TREE_NODES,
  WindowsDesktopUi,
  browserLike,
  browserPreferredError,
  safeBounds,
  safeText
}
