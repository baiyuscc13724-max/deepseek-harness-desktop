const DEFAULT_ACCELERATOR = 'Esc'

const COMPUTER_USE_DESKTOP_OVERLAY_HTML = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;pointer-events:none}
  body::before{content:"";position:fixed;inset:0;box-sizing:border-box;border:3px solid rgba(72,166,255,.82);background:rgba(24,132,255,.10);box-shadow:inset 0 0 52px rgba(62,166,255,.24),inset 0 0 150px rgba(38,137,255,.17)}
  body::after{content:"Computer Use 控制整个桌面  ·  Esc 退出";position:fixed;top:12px;left:50%;max-width:calc(100vw - 120px);overflow:hidden;border:1px solid rgba(126,202,255,.82);border-radius:999px;padding:7px 14px;color:#f7fbff;background:rgba(18,89,188,.90);box-shadow:0 8px 28px rgba(8,69,160,.3),inset 0 1px rgba(255,255,255,.22);font:600 12px/1.25 "Segoe UI","Microsoft YaHei UI",sans-serif;letter-spacing:.02em;text-overflow:ellipsis;white-space:nowrap;transform:translateX(-50%)}
</style></head><body></body></html>`

const COMPUTER_USE_INDICATOR_CSS = String.raw`
:root::before {
  content: "" !important;
  position: fixed !important;
  z-index: 2147483646 !important;
  inset: 0 !important;
  display: block !important;
  border: 2px solid rgba(72, 166, 255, .72) !important;
  background:
    radial-gradient(circle at 50% 44%, rgba(24, 132, 255, .025), rgba(24, 132, 255, .12) 72%, rgba(18, 111, 238, .18)) !important;
  box-shadow:
    inset 0 0 42px rgba(62, 166, 255, .22),
    inset 0 0 132px rgba(38, 137, 255, .2),
    0 0 30px rgba(47, 145, 255, .38) !important;
  pointer-events: none !important;
}

:root::after {
  content: "Computer Use 控制中  ·  Esc 退出" !important;
  position: fixed !important;
  z-index: 2147483647 !important;
  top: 12px !important;
  left: 50% !important;
  display: block !important;
  max-width: calc(100vw - 120px) !important;
  overflow: hidden !important;
  border: 1px solid rgba(126, 202, 255, .78) !important;
  border-radius: 999px !important;
  padding: 7px 14px !important;
  color: #f7fbff !important;
  background: rgba(18, 89, 188, .88) !important;
  box-shadow: 0 8px 28px rgba(8, 69, 160, .3), inset 0 1px rgba(255, 255, 255, .22) !important;
  font: 600 12px/1.25 "Segoe UI", "Microsoft YaHei UI", sans-serif !important;
  letter-spacing: .02em !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  transform: translateX(-50%) !important;
  pointer-events: none !important;
}

:root,
:root body,
:root body * {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Ccircle cx='14' cy='14' r='8' fill='none' stroke='%23ffffff' stroke-width='4' opacity='.95'/%3E%3Ccircle cx='14' cy='14' r='8' fill='none' stroke='%230a84ff' stroke-width='2'/%3E%3Cpath d='M14 2v5M14 21v5M2 14h5M21 14h5' stroke='%230a84ff' stroke-width='2' stroke-linecap='round'/%3E%3Ccircle cx='14' cy='14' r='2.5' fill='%230a84ff'/%3E%3C/svg%3E") 14 14, crosshair !important;
}

`

const COMPUTER_USE_SURFACE_INDICATOR_CSS = `${COMPUTER_USE_INDICATOR_CSS}\n:root::after { display: none !important; }`
const COMPUTER_USE_CURSOR_ONLY_CSS = `${COMPUTER_USE_INDICATOR_CSS}\n:root::before, :root::after { display: none !important; }`

function shouldShowComputerUseIndicator(control, target) {
  return control?.active === true && target?.kind === 'desktop'
}

class ComputerUseDesktopOverlayController {
  constructor({ BrowserWindow, screen, html = COMPUTER_USE_DESKTOP_OVERLAY_HTML } = {}) {
    if (typeof BrowserWindow !== 'function') throw new TypeError('ComputerUseDesktopOverlayController requires Electron BrowserWindow')
    if (!screen || typeof screen.getAllDisplays !== 'function') throw new TypeError('ComputerUseDesktopOverlayController requires Electron screen')
    this.BrowserWindow = BrowserWindow
    this.screen = screen
    this.url = `data:text/html;charset=utf-8,${encodeURIComponent(String(html || COMPUTER_USE_DESKTOP_OVERLAY_HTML))}`
    this.active = false
    this.disposed = false
    this.entries = new Map()
    this.transition = Promise.resolve()
  }

  displayKey(display) {
    return String(display?.id ?? `${display?.bounds?.x || 0}:${display?.bounds?.y || 0}`)
  }

  boundsFor(display) {
    const bounds = display?.bounds || {}
    return {
      x: Math.round(Number(bounds.x) || 0),
      y: Math.round(Number(bounds.y) || 0),
      width: Math.max(1, Math.round(Number(bounds.width) || 1)),
      height: Math.max(1, Math.round(Number(bounds.height) || 1))
    }
  }

  createEntry(display) {
    const overlay = new this.BrowserWindow({
      ...this.boundsFor(display),
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false }
    })
    overlay.setIgnoreMouseEvents?.(true, { forward: true })
    overlay.setAlwaysOnTop?.(true, 'screen-saver')
    overlay.setContentProtection?.(true)
    overlay.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true })
    const entry = { overlay, ready: false }
    overlay.once?.('closed', () => {
      const key = this.displayKey(display)
      if (this.entries.get(key) === entry) this.entries.delete(key)
    })
    entry.loading = Promise.resolve(overlay.loadURL(this.url)).then(() => {
      entry.ready = true
      if (this.active && !this.disposed && !overlay.isDestroyed?.()) overlay.showInactive?.()
    }).catch(() => {})
    return entry
  }

  async sync() {
    if (this.disposed || (!this.active && this.entries.size === 0)) return
    const displays = this.screen.getAllDisplays()
    const current = new Set()
    for (const display of displays) {
      const key = this.displayKey(display)
      current.add(key)
      let entry = this.entries.get(key)
      if (!entry || entry.overlay.isDestroyed?.()) {
        entry = this.createEntry(display)
        this.entries.set(key, entry)
      } else {
        entry.overlay.setBounds?.(this.boundsFor(display), false)
      }
      await entry.loading
      if (entry.overlay.isDestroyed?.()) continue
      if (this.active) entry.overlay.showInactive?.()
      else entry.overlay.hide?.()
    }
    for (const [key, entry] of [...this.entries]) {
      if (current.has(key)) continue
      this.entries.delete(key)
      if (!entry.overlay.isDestroyed?.()) entry.overlay.destroy?.()
    }
  }

  setActive(active) {
    this.active = active === true
    this.transition = this.transition.then(() => this.sync(), () => this.sync())
    return this.transition.then(() => ({ active: this.active, displays: this.entries.size }))
  }

  refresh() {
    return this.setActive(this.active)
  }

  async dispose() {
    if (this.disposed) return
    this.active = false
    await this.transition.catch(() => {})
    for (const entry of this.entries.values()) {
      if (!entry.overlay.isDestroyed?.()) entry.overlay.destroy?.()
    }
    this.entries.clear()
    this.disposed = true
  }
}

class ComputerUseIndicatorController {
  constructor({
    globalShortcut,
    onStop,
    css = COMPUTER_USE_INDICATOR_CSS,
    surfaceCss = COMPUTER_USE_SURFACE_INDICATOR_CSS,
    cursorCss = COMPUTER_USE_CURSOR_ONLY_CSS,
    accelerator = DEFAULT_ACCELERATOR,
    desktopOverlay = null
  } = {}) {
    if (!globalShortcut || typeof globalShortcut.register !== 'function' || typeof globalShortcut.unregister !== 'function') {
      throw new TypeError('ComputerUseIndicatorController requires Electron globalShortcut')
    }
    if (typeof onStop !== 'function') throw new TypeError('ComputerUseIndicatorController requires onStop')
    this.globalShortcut = globalShortcut
    this.onStop = onStop
    this.css = String(css || COMPUTER_USE_INDICATOR_CSS)
    this.surfaceCss = String(surfaceCss || COMPUTER_USE_SURFACE_INDICATOR_CSS)
    this.cursorCss = String(cursorCss || COMPUTER_USE_CURSOR_ONLY_CSS)
    this.accelerator = String(accelerator || DEFAULT_ACCELERATOR)
    this.desktopOverlay = desktopOverlay && typeof desktopOverlay.setActive === 'function' ? desktopOverlay : null
    this.active = false
    this.shortcutRegistered = false
    this.entries = new Map()
    this.disposed = false
  }

  track(contents, { mode = 'primary' } = {}) {
    if (this.disposed || !contents || typeof contents.insertCSS !== 'function' || contents.isDestroyed?.()) return () => {}
    if (this.entries.has(contents)) return () => this.untrack(contents)
    const css = mode === 'cursor' ? this.cursorCss : mode === 'surface' ? this.surfaceCss : this.css
    const entry = { contents, css, cssKey: null, generation: 0, onDomReady: null, onDestroyed: null, onBeforeInput: null }
    entry.onDomReady = () => { this.syncEntry(entry, { force: true }).catch(() => {}) }
    entry.onDestroyed = () => { this.untrack(contents, { destroyed: true }).catch(() => {}) }
    entry.onBeforeInput = (event, input = {}) => {
      if (!this.active || input.type !== 'keyDown' || !['Esc', 'Escape'].includes(input.key)) return
      event.preventDefault?.()
      this.requestStop()
    }
    contents.on?.('dom-ready', entry.onDomReady)
    contents.on?.('before-input-event', entry.onBeforeInput)
    contents.once?.('destroyed', entry.onDestroyed)
    this.entries.set(contents, entry)
    this.syncEntry(entry).catch(() => {})
    return () => this.untrack(contents)
  }

  async untrack(contents, { destroyed = false } = {}) {
    const entry = this.entries.get(contents)
    if (!entry) return false
    this.entries.delete(contents)
    entry.generation += 1
    contents.removeListener?.('dom-ready', entry.onDomReady)
    contents.removeListener?.('before-input-event', entry.onBeforeInput)
    contents.removeListener?.('destroyed', entry.onDestroyed)
    const key = entry.cssKey
    entry.cssKey = null
    if (!destroyed && key && !contents.isDestroyed?.()) {
      await contents.removeInsertedCSS?.(key).catch(() => {})
    }
    return true
  }

  async syncEntry(entry, { force = false } = {}) {
    if (this.disposed || !this.entries.has(entry.contents) || entry.contents.isDestroyed?.()) return
    const generation = ++entry.generation
    const previousKey = entry.cssKey
    if (!this.active) {
      entry.cssKey = null
      if (previousKey) await entry.contents.removeInsertedCSS?.(previousKey).catch(() => {})
      return
    }
    if (previousKey && !force) return
    let nextKey = null
    try {
      nextKey = await entry.contents.insertCSS(entry.css)
    } catch {
      return
    }
    if (generation !== entry.generation || this.disposed || !this.active || entry.contents.isDestroyed?.()) {
      if (nextKey) await entry.contents.removeInsertedCSS?.(nextKey).catch(() => {})
      return
    }
    if (!nextKey) return
    entry.cssKey = nextKey
    if (previousKey && previousKey !== nextKey) await entry.contents.removeInsertedCSS?.(previousKey).catch(() => {})
  }

  requestStop() {
    return Promise.resolve(this.onStop()).catch(() => {})
  }

  syncShortcut() {
    if (this.active && !this.shortcutRegistered) {
      this.shortcutRegistered = this.globalShortcut.register(this.accelerator, () => this.requestStop()) === true
    } else if (!this.active && this.shortcutRegistered) {
      this.globalShortcut.unregister(this.accelerator)
      this.shortcutRegistered = false
    }
  }

  async setActive(active) {
    if (this.disposed) return { active: false, accelerator: this.accelerator, shortcutRegistered: false }
    const next = active === true
    if (next === this.active) {
      this.syncShortcut()
      if (this.desktopOverlay) await this.desktopOverlay.setActive(next).catch(() => {})
      return { active: this.active, accelerator: this.accelerator, shortcutRegistered: this.shortcutRegistered }
    }
    this.active = next
    this.syncShortcut()
    await Promise.allSettled([
      ...[...this.entries.values()].map(entry => this.syncEntry(entry)),
      this.desktopOverlay?.setActive(next)
    ].filter(Boolean))
    return { active: this.active, accelerator: this.accelerator, shortcutRegistered: this.shortcutRegistered }
  }

  async dispose() {
    if (this.disposed) return
    this.active = false
    this.syncShortcut()
    const entries = [...this.entries.keys()]
    await Promise.allSettled([
      ...entries.map(contents => this.untrack(contents)),
      this.desktopOverlay?.dispose?.()
    ].filter(Boolean))
    this.disposed = true
  }
}

module.exports = {
  COMPUTER_USE_CURSOR_ONLY_CSS,
  COMPUTER_USE_DESKTOP_OVERLAY_HTML,
  COMPUTER_USE_INDICATOR_CSS,
  COMPUTER_USE_SURFACE_INDICATOR_CSS,
  ComputerUseDesktopOverlayController,
  ComputerUseIndicatorController,
  DEFAULT_ACCELERATOR,
  shouldShowComputerUseIndicator
}
