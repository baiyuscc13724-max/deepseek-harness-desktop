const path = require('node:path')

class PetWindowController {
  constructor({ BrowserWindow, screen, appRoot, preload, getPreferences, updatePreferences, onFocusMain, getMainBounds }) {
    this.BrowserWindow = BrowserWindow
    this.screen = screen
    this.appRoot = appRoot
    this.preload = preload
    this.getPreferences = getPreferences
    this.updatePreferences = updatePreferences
    this.onFocusMain = onFocusMain
    this.getMainBounds = getMainBounds
    this.window = null
    this.lastState = null
    this.movingTimer = null
    this.quitting = false
    this.interactive = false
    this.transientRegions = []
    this.hitProfile = { left: 0.17, top: 0.49, right: 0.83, bottom: 0.97 }
  }

  displayKey(display) {
    return String(display.id)
  }

  defaultBounds() {
    const display = this.screen.getPrimaryDisplay()
    const area = display.workArea
    return { x: area.x + area.width - 286, y: area.y + area.height - 346, width: 270, height: 320 }
  }

  restoredBounds() {
    const fallback = this.defaultBounds()
    if (!this.appRoot.includes('app.asar') && process.env.HARNESS_PET_PREVIEW_ACTION) return fallback
    const preferences = this.getPreferences()
    const displays = this.screen.getAllDisplays()
    for (const display of displays) {
      const saved = preferences.positionByDisplay?.[this.displayKey(display)]
      if (!saved) continue
      const area = display.workArea
      const x = Math.max(area.x, Math.min(saved.x, area.x + area.width - fallback.width))
      const minimumY = area.y - fallback.height + 34
      const y = Math.max(minimumY, Math.min(saved.y, area.y + area.height - fallback.height))
      return { ...fallback, x, y }
    }
    return fallback
  }

  environment() {
    const window = this.ensure()
    const bounds = window.getBounds()
    const display = this.screen.getDisplayMatching(bounds)
    const mainBounds = this.getMainBounds?.() || null
    const surfaces = mainBounds ? [{ id: 'workbench', kind: 'application-window', bounds: mainBounds }] : []
    return { bounds, workArea: display.workArea, scaleFactor: display.scaleFactor || 1, mainBounds, surfaces }
  }

  moveTo(x, y) {
    const window = this.ensure()
    const current = window.getBounds()
    const point = {
      x: Math.round(Number.isFinite(Number(x)) ? Number(x) + current.width / 2 : current.x + current.width / 2),
      y: Math.round(Number.isFinite(Number(y)) ? Number(y) + current.height / 2 : current.y + current.height / 2)
    }
    const display = this.screen.getDisplayNearestPoint(point)
    const area = display.workArea
    const nextX = Math.max(area.x, Math.min(Math.round(Number(x) || 0), area.x + area.width - current.width))
    // Desktop pets need to be able to climb above the visible work area and
    // sit on windows whose title bar is close to the top of the screen. Keep
    // a small recovery strip visible so the pet can never become unreachable.
    const minimumY = area.y - current.height + 34
    const nextY = Math.max(minimumY, Math.min(Math.round(Number(y) || 0), area.y + area.height - current.height))
    window.setPosition(nextX, nextY, false)
    const bounds = window.getBounds()
    const mainBounds = this.getMainBounds?.() || null
    const surfaces = mainBounds ? [{ id: 'workbench', kind: 'application-window', bounds: mainBounds }] : []
    return {
      bounds,
      workArea: area,
      mainBounds,
      surfaces,
      collisions: {
        left: bounds.x <= area.x,
        right: bounds.x + bounds.width >= area.x + area.width,
        top: bounds.y <= minimumY,
        bottom: bounds.y + bounds.height >= area.y + area.height
      }
    }
  }

  setInteractive(value) {
    if (!this.window || this.window.isDestroyed()) return
    const payload = value && typeof value === 'object' ? value : { interactive: Boolean(value), regions: [] }
    this.interactive = Boolean(payload.interactive)
    this.transientRegions = Array.isArray(payload.regions)
      ? payload.regions.map(region => this.sanitizeRegion(region)).filter(Boolean)
      : []
    this.applyShape()
  }

  sanitizeRegion(region = {}) {
    const x = Math.max(0, Math.min(269, Math.floor(Number(region.x) || 0)))
    const y = Math.max(0, Math.min(319, Math.floor(Number(region.y) || 0)))
    const width = Math.max(1, Math.min(270 - x, Math.ceil(Number(region.width) || 0)))
    const height = Math.max(1, Math.min(320 - y, Math.ceil(Number(region.height) || 0)))
    if (width <= 1 || height <= 1) return null
    return { x, y, width, height }
  }

  applyShape() {
    if (!this.window || this.window.isDestroyed()) return
    // Keep the pet immediately clickable. A shaped window lets transparent
    // pixels fall through without the first-hover race caused by
    // setIgnoreMouseEvents(true). Speech and menus contribute only their own
    // small rectangles instead of turning the whole transparent window into
    // an invisible input-blocking box.
    this.window.setIgnoreMouseEvents(false)
    if (process.platform === 'win32' && typeof this.window.setShape === 'function') {
      this.window.setShape([this.profileRectangle(), ...this.transientRegions])
    }
  }

  profileRectangle() {
    const value = this.hitProfile || {}
    const left = Math.max(0, Math.min(1, Number(value.left) || 0))
    const top = Math.max(0, Math.min(1, Number(value.top) || 0))
    const right = Math.max(left + 0.05, Math.min(1, Number(value.right) || 1))
    const bottom = Math.max(top + 0.05, Math.min(1, Number(value.bottom) || 1))
    return {
      x: Math.round(75 + left * 120),
      y: Math.round(top * 320),
      width: Math.max(6, Math.round((right - left) * 120)),
      height: Math.max(6, Math.round((bottom - top) * 320))
    }
  }

  setHitProfile(profile = {}) {
    this.hitProfile = {
      left: profile.left,
      top: profile.top,
      right: profile.right,
      bottom: profile.bottom
    }
    this.applyShape()
  }

  ensure() {
    if (this.window && !this.window.isDestroyed()) return this.window
    const preferences = this.getPreferences()
    this.window = new this.BrowserWindow({
      ...this.restoredBounds(),
      transparent: true,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: preferences.alwaysOnTop !== false,
      title: '女仆鲸',
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.window.setAlwaysOnTop(preferences.alwaysOnTop !== false, 'floating')
    const previewAction = !this.appRoot.includes('app.asar') && process.env.HARNESS_PET_PREVIEW_ACTION
    const loadOptions = previewAction ? { query: { rigAction: previewAction } } : undefined
    this.window.loadFile(path.join(this.appRoot, 'renderer', 'pet', 'index.html'), loadOptions)
    this.window.webContents.on('did-finish-load', () => {
      this.setInteractive(false)
      if (this.lastState) this.window.webContents.send('pet:state', this.lastState)
    })
    this.window.on('move', () => this.schedulePositionSave())
    this.window.on('close', event => {
      if (this.quitting) return
      event.preventDefault()
      this.updatePreferences({ awake: false })
      this.window.hide()
    })
    this.window.on('closed', () => { this.window = null })
    return this.window
  }

  schedulePositionSave() {
    clearTimeout(this.movingTimer)
    this.movingTimer = setTimeout(() => {
      if (!this.window || this.window.isDestroyed()) return
      const bounds = this.window.getBounds()
      const display = this.screen.getDisplayMatching(bounds)
      this.updatePreferences({ positionByDisplay: { [this.displayKey(display)]: { x: bounds.x, y: bounds.y } } })
    }, 180)
    this.movingTimer.unref?.()
  }

  syncPreferences(preferences) {
    if (!preferences.enabled || !preferences.awake) {
      this.window?.hide()
      return
    }
    const window = this.ensure()
    window.setAlwaysOnTop(preferences.alwaysOnTop !== false, 'floating')
    if (!window.isVisible()) window.showInactive()
  }

  publish(state) {
    this.lastState = state
    if (this.window && !this.window.isDestroyed() && this.window.webContents.isLoading() === false) {
      this.window.webContents.send('pet:state', state)
    }
  }

  focusMain(sessionId) {
    this.onFocusMain(sessionId)
  }

  dispose() {
    this.quitting = true
    clearTimeout(this.movingTimer)
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }
}

module.exports = { PetWindowController }
