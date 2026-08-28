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
    this.selectedTargetId = DESKTOP_TARGET_ID
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
    const targets = await this.provider.targets()
    if (!targets.some(target => target.id === this.selectedTargetId)) this.selectedTargetId = DESKTOP_TARGET_ID
    return targets.map(target => ({ ...target, selected: target.id === this.selectedTargetId }))
  }

  async selectTarget(targetId) {
    const selected = await this.provider.selectTarget(targetId)
    this.selectedTargetId = selected.id
    this.refs.clear()
    return selected
  }

  async observe(options = {}) {
    const targets = await this.targets()
    const target = targets.find(entry => entry.id === this.selectedTargetId) || targets[0]
    this.generation += 1
    this.refs.clear()
    let rawTree = null
    if (this.controlSource?.observe) rawTree = await this.controlSource.observe(target, { maxNodes: Math.min(MAX_TREE_NODES, Math.max(1, Number(options.maxNodes) || MAX_TREE_NODES)) })
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
    const entry = this.refs.get(String(ref || ''))
    if (!entry) throw Object.assign(new Error('桌面 UI ref 已失效；请重新 observe。'), { code: 'desktop-ui-ref-stale' })
    const { raw, ...node } = entry
    return node
  }

  async #entry(ref, action) {
    const entry = this.refs.get(String(ref || ''))
    if (!entry) throw Object.assign(new Error('桌面 UI ref 已失效；请重新 observe。'), { code: 'desktop-ui-ref-stale' })
    if (!entry.enabled) throw Object.assign(new Error('桌面 UI 控件已禁用。'), { code: 'desktop-ui-disabled' })
    if (action === 'type' && entry.sensitive === true) throw Object.assign(new Error('桌面结构化控制不会向密码或敏感输入控件写入内容。'), { code: 'desktop-ui-sensitive-input' })
    if (browserLike(entry) && this.browserControlAvailable() === true) throw browserPreferredError()
    if (entry.targetId && entry.targetId !== this.selectedTargetId) await this.selectTarget(entry.targetId)
    if (this.controlSource?.perform) {
      const result = await this.controlSource.perform(action, entry.raw, entry)
      if (result?.handled === true) return { entry, result }
    }
    return { entry, result: null }
  }

  async click(ref) {
    const { entry, result } = await this.#entry(ref, 'click')
    if (result) return result
    if (!entry.bounds) throw Object.assign(new Error('该桌面 UI ref 没有可操作边界。'), { code: 'desktop-ui-bounds-unavailable' })
    await this.provider.captureFrame()
    return this.provider.pointer('click', { x: entry.bounds.x + Math.floor(entry.bounds.width / 2), y: entry.bounds.y + Math.floor(entry.bounds.height / 2) })
  }

  async type(ref, text) {
    const { result } = await this.#entry(ref, 'type')
    if (result) return result
    return this.provider.keyboard(text)
  }

  async scroll(ref, deltaY) {
    const { entry, result } = await this.#entry(ref, 'scroll')
    if (result) return result
    if (!entry.bounds) throw Object.assign(new Error('该桌面 UI ref 没有可操作边界。'), { code: 'desktop-ui-bounds-unavailable' })
    await this.provider.captureFrame()
    return this.provider.pointer('scroll', { x: entry.bounds.x + Math.floor(entry.bounds.width / 2), y: entry.bounds.y + Math.floor(entry.bounds.height / 2), deltaY })
  }

  async action(input = {}) {
    const action = safeText(input.action, 40)
    const payload = input.payload && typeof input.payload === 'object' ? input.payload : input
    if (action === 'status') return this.status()
    if (action === 'targets') return { targets: await this.targets() }
    if (action === 'selectTarget') return this.selectTarget(payload.target_id || payload.targetId)
    if (action === 'observe') return this.observe(payload)
    if (action === 'inspect') return this.inspect(payload.ref)
    if (action === 'click') return payload.ref ? this.click(payload.ref) : this.provider.pointer('click', payload)
    if (action === 'type') return payload.ref ? this.type(payload.ref, payload.text) : this.provider.keyboard(payload.text)
    if (action === 'scroll') return payload.ref ? this.scroll(payload.ref, payload.delta_y ?? payload.deltaY) : this.provider.pointer('scroll', payload)
    if (action === 'screenshot') return this.provider.captureFrame({ force: payload.force === true })
    if (action === 'requestAuthorization') return this.provider.authorize()
    if (action === 'stop') return this.provider.stop()
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
