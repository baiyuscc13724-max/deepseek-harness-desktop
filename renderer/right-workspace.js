/*!
 * right-workspace.js — Desktop 自有「右侧工作区」统一控制器骨架。
 *
 * 无框架、可测试：核心逻辑（面板栈、宽度边界、序列化）与 DOM 解耦，
 * 可用 Node 直接加载做纯逻辑测试（module.exports），也可在浏览器中
 * 通过 window.HarnessRightWorkspace.create(options) 挂载。
 *
 * 不控制 Electron / 网络 / 文件：本文件不引用 preload 的 desktopHarness，
 * 也不做任何 IPC、fetch 或磁盘 IO。所有持久化能力都是可选的
 * Web Storage 适配器（默认关闭），由接线方决定是否启用。
 *
 * 接入方式（不复制内容）：
 *  - host：可传入现有容器元素（或其 CSS 选择器）。若 host 内已存在
 *    dsh-right-workspace 骨架，则直接复用其中的 title/back/close/handle/slot；
 *    否则自动生成骨架并挂到 options.container ?? document.body。
 *  - slot：承载「当前模式视图」的容器。模式注册时传入的 view 是现有 DOM
 *    节点，激活时以 append 方式移入 slot（同一节点对象，从不 clone）。
 *  - 现有快捷按钮：通过 options.toggleEl 传入，控制器会同步
 *    aria-expanded / aria-controls，并把点击接到 toggle()。
 *
 * 快捷键：
 *  - Escape：工作区打开时关闭（不抢占 app.js 中各 overlay 的 Escape）。
 *  - Ctrl/Cmd+Shift+]：切换开合。当前 renderer 无此组合冲突，默认自动绑定；
 *    若接线方在别处占用，可设 options.bindShortcut = false，
 *    并自行调用 controller.handleShortcut(event) 仅暴露 key handler。
 *
 * 断点（与 right-workspace.css 一致）：
 *  - 默认（>900px）：桌面右侧分栏，宽度 = --dsh-right-workspace-width。
 *  - ≤900px：近全宽覆盖层（calc(100vw - 48px)），is-overlay = true。
 *  - ≤620px：全宽覆盖层（100vw）。
 */
(() => {
  'use strict'

  const VERSION = '1.0.0'
  const WIDTH_VAR = '--dsh-right-workspace-width'

  const DEFAULTS = Object.freeze({
    minWidth: 320,
    maxWidth: 1200,
    defaultWidth: 460,
    ariaLabel: '右侧工作区',
    mount: true,
    bindShortcut: true,
    closeOnEscape: true,
    storageKey: null, // 设置为字符串后启用 Web Storage 自动持久化
    overlayQuery: '(max-width: 900px)'
  })

  /* ------------------------------------------------------------------ *
   * 纯核心：不依赖 window / document，可在 Node 中直接测试              *
   * ------------------------------------------------------------------ */
  function createCore(initial = {}) {
    let panes = new Map() // id -> pane spec
    let stack = []
    let activeId = null
    let open = Boolean(initial.open)
    const minWidth = Number.isFinite(Number(initial.minWidth)) ? Number(initial.minWidth) : DEFAULTS.minWidth
    const maxWidth = Math.max(minWidth, Number.isFinite(Number(initial.maxWidth)) ? Number(initial.maxWidth) : DEFAULTS.maxWidth)
    const defaultWidth = Number.isFinite(Number(initial.defaultWidth)) ? Number(initial.defaultWidth) : DEFAULTS.defaultWidth
    let width = normalizeWidth(initial.width ?? defaultWidth)

    function normalizeWidth(value) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return Math.max(minWidth, Math.min(maxWidth, defaultWidth))
      return Math.max(minWidth, Math.min(maxWidth, Math.round(parsed)))
    }

    function emit() {}

    return {
      /* --- 模式注册 --- */
      register(spec) {
        if (!spec || typeof spec.id !== 'string' || !spec.id) {
          throw new TypeError('right-workspace: register 需要 { id }')
        }
        const pane = { ...spec }
        panes.set(pane.id, pane)
        return pane.id
      },
      unregister(id) {
        const gone = panes.delete(id)
        if (stack[stack.length - 1] === id) stack.pop()
        if (activeId === id) activeId = stack[stack.length - 1] || null
        return gone
      },
      has(id) {
        return panes.has(id)
      },
      get(id) {
        return panes.get(id) || null
      },
      ids() {
        return [...panes.keys()]
      },

      /* --- 开合 --- */
      isOpen() {
        return open
      },
      setOpen(next) {
        open = Boolean(next)
        return open
      },

      /* --- 面板栈 --- */
      get activeId() {
        return activeId
      },
      get stack() {
        return [...stack]
      },
      canGoBack() {
        return stack.length > 1
      },
      push(id) {
        if (!panes.has(id)) return false
        stack.push(id)
        activeId = id
        open = true
        return true
      },
      replace(id) {
        if (!panes.has(id)) return false
        if (stack.length === 0) stack.push(id)
        else stack[stack.length - 1] = id
        activeId = id
        open = true
        return true
      },
      back() {
        if (stack.length > 1) {
          stack.pop()
          activeId = stack[stack.length - 1] || null
          return { closed: false, id: activeId }
        }
        if (stack.length === 1) {
          stack.pop()
          activeId = null
          open = false
          return { closed: true, id: null }
        }
        return { closed: false, id: null }
      },

      /* --- 宽度 --- */
      width() {
        return width
      },
      setWidth(value) {
        width = normalizeWidth(value)
        return width
      },

      /* --- 序列化 / 恢复 --- */
      serialize() {
        return {
          version: 1,
          open,
          activeId,
          stack: [...stack],
          width
        }
      },
      restore(state) {
        if (!state || typeof state !== 'object' || state.version !== 1) return false
        const ids = state.stack || []
        const valid = ids.filter(id => panes.has(id))
        if (!valid.length && state.activeId && !panes.has(state.activeId)) return false
        stack = valid.slice(0, 128)
        activeId = panes.has(state.activeId) ? state.activeId : stack[stack.length - 1] || null
        if (activeId && !stack.includes(activeId)) stack.push(activeId)
        width = normalizeWidth(state.width)
        open = state.open === true && Boolean(activeId)
        return true
      },

      emit
    }
  }

  // Native browser events (loading/title/history) carry a visibility snapshot,
  // but they are not navigation intents. The sole exception is the first
  // renderer hydration: if Electron already has the browser sidebar open, the
  // renderer may restore that browser surface. Once the user has selected or
  // closed any workspace mode, restorePending is false and background browser
  // events must never steal the active pane.
  function browserStateModeAction({ restorePending, nativeVisible, workspaceOpen, activeModeId } = {}) {
    const canRestore = restorePending === true
      && nativeVisible === true
      && workspaceOpen !== true
      && (activeModeId == null || activeModeId === 'browser')
    return canRestore ? 'restore-browser' : 'sync-only'
  }

  /* ------------------------------------------------------------------ *
   * DOM 接线层：挂在真实页面上                                          *
   * ------------------------------------------------------------------ */
  function resolveRef(value) {
    if (typeof value === 'string') return document.querySelector(value)
    if (value && typeof value === 'object' && value.nodeType === 1) return value
    return null
  }

  function createWorkspace(options = {}) {
    if (typeof document === 'undefined') {
      throw new Error('right-workspace: 缺少 document，无法创建 DOM 控制器（可用 createCore 做纯逻辑测试）')
    }
    const opts = { ...DEFAULTS, ...options }

    const host = resolveRef(options.host) || document.createElement('aside')
    const hasSkeleton = host.querySelector(':scope > .dsh-right-workspace__header, :scope > .dsh-right-workspace__slot')

    /* --- 元素引用：优先复用现有 DOM，其次生成 --- */
    const build = (className, tag = 'div') => {
      const el = document.createElement(tag)
      el.className = className
      return el
    }
    let handle = resolveRef(options.handleEl)
    let header = resolveRef(options.headerEl)
    let title = resolveRef(options.titleEl)
    let back = resolveRef(options.backEl)
    let closeBtn = resolveRef(options.closeEl)
    let slot = resolveRef(options.slotEl)
    let toggleBtn = resolveRef(options.toggleEl)

    if (!hasSkeleton) {
      host.classList.add('dsh-right-workspace')
      if (!handle) {
        handle = build('dsh-right-workspace__handle', 'div')
        handle.setAttribute('role', 'separator')
        handle.setAttribute('aria-orientation', 'vertical')
        handle.setAttribute('tabindex', '0')
        host.append(handle)
      }
      header = header || build('dsh-right-workspace__header', 'header')
      title = title || build('dsh-right-workspace__title', 'strong')
      back = back || build('dsh-right-workspace__back', 'button')
      back.type = 'button'
      closeBtn = closeBtn || build('dsh-right-workspace__close', 'button')
      closeBtn.type = 'button'
      header.append(back, title, closeBtn)
      host.append(header)
      slot = slot || build('dsh-right-workspace__slot')
      host.append(slot)
    }
    if (!host.getAttribute('role')) host.setAttribute('role', 'complementary')
    if (!host.getAttribute('aria-label')) host.setAttribute('aria-label', opts.ariaLabel)
    if (!slot) slot = host.querySelector(':scope > .dsh-right-workspace__slot') || build('dsh-right-workspace__slot')
    if (!header) header = host.querySelector(':scope > .dsh-right-workspace__header')
    if (!title) title = header?.querySelector(':scope > .dsh-right-workspace__title')
    if (!back) back = header?.querySelector(':scope > .dsh-right-workspace__back')
    if (!closeBtn) closeBtn = header?.querySelector(':scope > .dsh-right-workspace__close')

    if (handle) {
      handle.setAttribute('aria-label', '拖动调整右侧工作区宽度')
      handle.setAttribute('role', 'separator')
      handle.setAttribute('aria-orientation', 'vertical')
    }

    const core = createCore({ open: false, width: opts.defaultWidth, defaultWidth: opts.defaultWidth, minWidth: opts.minWidth, maxWidth: opts.maxWidth })

    /* --- 超窄屏/覆盖状态 --- */
    let overlayQuery = null
    let overlay = false
    if (typeof window.matchMedia === 'function' && opts.overlayQuery) {
      try {
        overlayQuery = window.matchMedia(opts.overlayQuery)
        overlay = overlayQuery.matches
      } catch {
        overlayQuery = null
      }
    }
    function syncOverlay(next) {
      overlay = Boolean(next)
      host.classList.toggle('is-overlay', overlay)
      document.body.classList.toggle('dsh-right-workspace-overlay', overlay)
    }
    syncOverlay(overlay)

    /* --- 事件转发（简单发布/订阅） --- */
    const listeners = new Map()
    function on(type, fn) {
      if (typeof fn !== 'function') throw new TypeError('on(event, fn) 需要函数')
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
      return () => listeners.get(type)?.delete(fn)
    }
    function emit(type, payload) {
      for (const fn of listeners.get(type) || []) {
        try { fn(payload ?? {}) } catch { /* 单监听器异常不阻断其他监听器 */ }
      }
      core.emit(type, payload)
    }

    /* --- 渲染 --- */
    function paneTitle(pane) {
      if (!pane) return ''
      if (typeof pane.title === 'function') {
        const computed = pane.title(controller)
        return computed == null ? '' : String(computed)
      }
      return pane.title ?? ''
    }
    let titleOverride = null
    function renderTitle() {
      if (!title) return
      title.textContent = titleOverride ?? paneTitle(core.get(core.activeId))
      title.setAttribute('aria-live', 'polite')
    }
    function renderPane() {
      const pane = core.get(core.activeId)
      if (!slot) return
      const current = slot.firstElementChild
      if (current && (!pane || pane.view !== current)) current.remove()
      if (pane && pane.view instanceof Node) {
        if (pane.view.parentElement !== slot) slot.append(pane.view) // 移动而非复制
      }
    }
    function renderChrome() {
      const isOpen = core.isOpen()
      const canBack = core.canGoBack()
      host.classList.toggle('is-open', isOpen)
      host.setAttribute('aria-hidden', String(!isOpen))
      back?.classList.toggle('is-visible', canBack)
      if (back) {
        back.disabled = !canBack
        back.setAttribute('aria-label', canBack ? '返回上一个面板' : '没有可返回的面板')
      }
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', String(isOpen))
        if (!toggleBtn.getAttribute('aria-controls')) toggleBtn.setAttribute('aria-controls', host.id || '')
      }
      document.body.classList.toggle('dsh-right-workspace-open', isOpen)
      applyWidth()
      renderTitle()
      renderPane()
    }

    function applyWidth() {
      const px = `${core.width()}px`
      document.documentElement.style.setProperty(WIDTH_VAR, px)
      if (handle) {
        handle.setAttribute('aria-valuenow', String(core.width()))
        handle.setAttribute('aria-valuemin', String(opts.minWidth))
        handle.setAttribute('aria-valuemax', String(opts.maxWidth))
      }
    }

    /* --- 生命周期 --- */
    function open() { return controller.setOpen(true) }
    function close() { return controller.setOpen(false) }
    function toggle() { return controller.setOpen(!core.isOpen()) }

    function setOpen(next, reason = 'api') {
      if (!next) {
        core.setOpen(false)
      } else if (!core.activeId && core.ids().length) {
        core.push(core.ids()[0]) // 没有活动模式时打开首个已注册模式
      } else {
        core.setOpen(true)
      }
      renderChrome()
      emit(next ? 'open' : 'close', { reason })
      emit('statechange', core.serialize())
      if (opts.storageKey) persist()
      return core.isOpen()
    }

    /* --- 持久化：可选 Web Storage 适配器，默认关闭 --- */
    function storage() {
      if (!opts.storageKey) return null
      try {
        const store = opts.storage ?? globalThis.localStorage
        return store && typeof store.getItem === 'function' && typeof store.setItem === 'function' ? store : null
      } catch {
        return null
      }
    }
    function persist() {
      const store = storage()
      if (!store) return false
      try {
        store.setItem(opts.storageKey, JSON.stringify(serialize()))
        return true
      } catch {
        return false
      }
    }
    function loadSavedState() {
      const store = storage()
      if (!store) return false
      try {
        const raw = store.getItem(opts.storageKey)
        if (!raw) return false
        return restore(JSON.parse(raw))
      } catch {
        return false
      }
    }

    /* --- 控制器公开 API --- */
    const controller = {
      version: VERSION,
      host,

      /* 开合 */
      open, close, toggle, isOpen: () => core.isOpen(), setOpen,

      /* 模式注册（browser / files / document / terminal 等） */
      registerMode: (spec) => core.register(spec),
      registerPane: (spec) => core.register(spec), // 别名
      unregisterMode: (id) => core.unregister(id),
      hasMode: (id) => core.has(id),
      getMode: (id) => core.get(id),
      getModes: () => [...core.ids()].map(id => core.get(id)).filter(Boolean),

      /* 面板栈 */
      getActiveModeId: () => core.activeId,
      getActiveMode: () => core.get(core.activeId),
      getStack: () => core.stack,
      canGoBack: () => core.canGoBack(),
      push: (id) => { if (!core.push(id)) return false; renderChrome(); emit('push', { id }); emit('statechange', core.serialize()); return true },
      replace: (id) => { if (!core.replace(id)) return false; renderChrome(); emit('replace', { id }); emit('statechange', core.serialize()); return true },
      back: () => {
        const result = core.back()
        renderChrome()
        emit(result.closed ? 'close' : 'modechange', { id: result.id, closed: result.closed })
        emit('statechange', core.serialize())
        return result
      },

      /* 标题 */
      setTitle: (text) => { titleOverride = text == null ? null : String(text); renderTitle(); emit('titlechange', { title: titleOverride }); return controller },
      getTitle: () => titleOverride ?? paneTitle(core.get(core.activeId)),
      resetTitle: () => { titleOverride = null; renderTitle(); emit('titlechange', { title: controller.getTitle() }); return controller },
      refreshTitle: () => { renderTitle(); emit('titlechange', { title: controller.getTitle() }); return controller },

      /* 宽度 */
      getWidth: () => core.width(),
      setWidth: (value) => { core.setWidth(value); applyWidth(); emit('resize', { width: core.width() }); emit('statechange', core.serialize()); return core.width() },
      resetWidth: () => controller.setWidth(opts.defaultWidth),

      /* 窄屏覆盖状态 */
      isOverlay: () => overlay,
      getOverlayQuery: () => opts.overlayQuery,

      /* 键盘：支持外部转发 / 仅暴露 handler 的场景 */
      handleShortcut: (event) => {
        const key = String(event.key || '').toLowerCase()
        const isBracketShortcut = event && (event.ctrlKey || event.metaKey) && event.shiftKey && (key === ']' || key === '}')
        if (!isBracketShortcut) return false
        event.preventDefault()
        toggle()
        return true
      },
      handleKeyDown: (event) => {
        if (!('key' in event)) return false
        if (opts.closeOnEscape && event.key === 'Escape' && core.isOpen()) {
          event.preventDefault()
          setOpen(false, 'escape')
          return true
        }
        if (opts.bindShortcut && controller.handleShortcut(event)) return true
        return false
      },

      /* 序列化 / 恢复 / 持久化 */
      serialize: () => core.serialize(),
      restore: (state) => {
        const ok = core.restore(state)
        if (ok) {
          renderChrome()
          emit('statechange', core.serialize())
          if (opts.storageKey) persist()
        }
        return ok
      },
      saveState: persist,
      loadSavedState,

      /* 事件 */
      on,

      /* 销毁：解除监听、移除宿主 */
      destroy() {
        for (const set of listeners.values()) set.clear()
        listeners.clear()
        window.removeEventListener('keydown', onGlobalKeyDown)
        overlayQuery?.removeEventListener?.('change', onOverlayChange)
        handle?.removeEventListener?.('pointerdown', onHandleDown)
        handle?.removeEventListener?.('keydown', onHandleKey)
        toggleBtn?.removeEventListener?.('click', onToggleClick)
        back?.removeEventListener?.('click', onBackClick)
        closeBtn?.removeEventListener?.('click', onCloseClick)
        host.classList.remove('is-open', 'is-overlay')
        document.body.classList.remove('dsh-right-workspace-open', 'dsh-right-workspace-overlay')
        host.remove()
      }
    }

    /* --- 全局键盘 --- */
    function onGlobalKeyDown(event) {
      if (controller.handleKeyDown(event)) return
    }
    /* --- 覆盖状态监听 --- */
    function onOverlayChange(event) {
      syncOverlay(event.matches)
      emit('overlaychange', { overlay })
    }
    /* --- 宽度拖动 --- */
    let dragging = false
    function onHandleDown(event) {
      dragging = true
      handle?.setPointerCapture?.(event.pointerId)
      event.preventDefault()
    }
    function onHandleMove(event) {
      if (!dragging || !handle) return
      const desired = Math.max(opts.minWidth, Math.min(opts.maxWidth, Math.round(window.innerWidth - event.clientX)))
      controller.setWidth(desired)
    }
    function onHandleUp(event) {
      if (!dragging) return
      dragging = false
      handle?.releasePointerCapture?.(event.pointerId)
      if (opts.storageKey) persist()
    }
    function onHandleKey(event) {
      if (!(event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return
      event.preventDefault()
      const delta = event.key === 'ArrowLeft' ? 24 : -24
      controller.setWidth(core.width() + delta)
      if (opts.storageKey) persist()
    }
    function onToggleClick(event) {
      event.preventDefault()
      toggle()
    }
    function onBackClick() {
      if (core.canGoBack()) controller.back()
      else if (opts.closeOnEscape) controller.setOpen(false, 'back')
    }
    function onCloseClick(event) {
      event.preventDefault()
      controller.setOpen(false, 'close-button')
    }

    /* --- 绑定 --- */
    if (title) title.setAttribute('aria-live', 'polite')
    if (back) {
      back.textContent = '←'
      back.type = 'button'
    }
    if (closeBtn) {
      closeBtn.textContent = '×'
      closeBtn.type = 'button'
      closeBtn.setAttribute('aria-label', '关闭右侧工作区')
    }
    if (handle) {
      handle.addEventListener('pointerdown', onHandleDown)
      handle.addEventListener('pointermove', onHandleMove)
      handle.addEventListener('pointerup', onHandleUp)
      handle.addEventListener('pointercancel', onHandleUp)
      handle.addEventListener('keydown', onHandleKey)
    }
    back?.addEventListener('click', onBackClick)
    closeBtn?.addEventListener('click', onCloseClick)
    toggleBtn?.addEventListener('click', onToggleClick)
    if (overlayQuery) overlayQuery.addEventListener('change', onOverlayChange)
    if (opts.bindShortcut || opts.closeOnEscape) window.addEventListener('keydown', onGlobalKeyDown)

    if (opts.mount) {
      const container = resolveRef(options.container) || document.body
      if (!host.isConnected) container.append(host)
    }

    /* 初始渲染；若配置了 storageKey 且已有存档则恢复 */
    const restored = opts.storageKey ? loadSavedState() : false
    if (!restored) {
      renderChrome()
      emit('statechange', core.serialize())
    }

    return Object.freeze(controller)
  }

  /* ------------------------------------------------------------------ *
   * 导出                                                               *
   * ------------------------------------------------------------------ */
  const api = Object.freeze({
    version: VERSION,
    DEFAULTS,
    create: createWorkspace,
    createCore, // 纯逻辑核心，Node 测试可直接使用
    browserStateModeAction,
    isShortcutPressed: (event) => {
      const key = String(event?.key || '').toLowerCase()
      return Boolean(event && (event.ctrlKey || event.metaKey) && event.shiftKey && (key === ']' || key === '}'))
    }
  })

  if (typeof window !== 'undefined') {
    window.HarnessRightWorkspace = api
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})()
