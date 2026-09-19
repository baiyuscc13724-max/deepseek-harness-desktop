'use strict'

// Main-process internal surface, not a browser action or authorization provider.
// No saved frames, user-window activation, page cloning, CDP screenshot fallback,
// credential/profile copying, renderer-supplied code, or shared GPU textures.
const { randomUUID } = require('node:crypto')

function surfaceError(code, message) {
  return Object.assign(new Error(message), { code })
}
const stale = () => surfaceError('browser-reference-stale', '离屏截图所属页面、视口或控制请求已改变。')
const cancelled = () => surfaceError('browser-action-cancelled', '离屏截图已取消。')

function checkedBounds(bounds) {
  if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(bounds[key]))) throw new TypeError('Offscreen bounds require integer x/y/width/height')
  if (bounds.width < 1 || bounds.height < 1 || bounds.width > 2048 || bounds.height > 2048) throw new RangeError('Offscreen viewport exceeds 2048x2048 limit')
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
}

// inspect() is a required trusted Host callback: it must check BOTH sensitive
// inputs and visible sensitive text, then supply this bounded viewport/crop.
// No caller-defined source is executed here. Never pass this API through IPC.
function checkedInspection(value) {
  const v = value?.viewport, r = value?.rect
  if (!v || !r || !['width', 'height', 'scrollX', 'scrollY', 'devicePixelRatio'].every(key => Number.isFinite(v[key]))) throw new TypeError('Offscreen inspection requires finite viewport geometry')
  if (v.width <= 0 || v.height <= 0 || v.width > 8192 || v.height > 8192 || v.devicePixelRatio <= 0 || v.devicePixelRatio > 8) throw new RangeError('Unsupported offscreen viewport')
  if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(r[key])) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > v.width || r.y + r.height > v.height) throw new RangeError('Offscreen crop must lie entirely in the inspected viewport')
  return {
    viewport: { width: v.width, height: v.height, scrollX: v.scrollX, scrollY: v.scrollY, devicePixelRatio: v.devicePixelRatio },
    rect: { x: r.x, y: r.y, width: r.width, height: r.height }
  }
}

class BrowserOffscreenSurface {
  constructor({ WebContentsView, webPreferences, bounds = { x: 0, y: 0, width: 1024, height: 768 }, frameRate = 15, timeoutMs = 2500, maxPixels = 8_388_608 } = {}) {
    if (typeof WebContentsView !== 'function') throw new TypeError('A main-process WebContentsView constructor is required')
    // The Host must supply its already-authorized partition/session and preload.
    // Do not silently create a different profile or adopt/clone an existing tab.
    if (!webPreferences || (!webPreferences.session && (typeof webPreferences.partition !== 'string' || !webPreferences.partition))) throw new TypeError('The existing browser partition/session is required')
    this.bounds = checkedBounds(bounds)
    if (!Number.isSafeInteger(frameRate) || frameRate < 1 || frameRate > 30) throw new RangeError('Offscreen frameRate must be 1..30')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) throw new RangeError('Offscreen timeout must be 100..5000ms')
    if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > 8_388_608) throw new RangeError('Offscreen pixel budget exceeds 32MiB')
    this.timeoutMs = timeoutMs
    this.maxPixels = maxPixels
    this.frameRate = frameRate
    this.generation = 0
    this.sequence = 0
    this.active = null
    this.disposed = false
    this.parent = null
    this.view = new WebContentsView({ webPreferences: {
      ...webPreferences,
      offscreen: { useSharedTexture: false },
      backgroundThrottling: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    } })
    this.webContents = this.view.webContents
    const wc = this.webContents
    if (!wc.isOffscreen()) {
      wc.close({ waitForBeforeUnload: false })
      throw surfaceError('browser-capture-unavailable', 'Electron没有创建离屏渲染视图。')
    }
    this.view.setBounds(this.bounds)
    wc.setFrameRate(frameRate)
    wc.stopPainting()
    this.onNavigation = (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame !== false) this.invalidateRequests('navigation') }
    this.onGone = () => this.invalidateRequests('renderer-gone')
    this.onDestroyed = () => { this.invalidateRequests('destroyed'); this.disposed = true }
    wc.on('did-start-navigation', this.onNavigation)
    wc.on('did-navigate-in-page', this.onNavigation)
    wc.on('render-process-gone', this.onGone)
    wc.on('destroyed', this.onDestroyed)
  }

  attach(contentView) {
    if (this.disposed || this.webContents.isDestroyed()) throw stale()
    if (!contentView || typeof contentView.addChildView !== 'function' || typeof contentView.removeChildView !== 'function') throw new TypeError('A native parent contentView is required')
    if (this.parent === contentView) return
    this.detach()
    contentView.addChildView(this.view)
    this.parent = contentView
  }

  detach() {
    this.invalidateRequests('detached')
    const parent = this.parent
    this.parent = null
    if (parent) parent.removeChildView(this.view)
  }

  setBounds(bounds) {
    const next = checkedBounds(bounds)
    if (Object.keys(next).every(key => next[key] === this.bounds[key])) return
    if (this.disposed || this.webContents.isDestroyed()) throw stale()
    this.invalidateRequests('resized')
    this.bounds = next
    this.view.setBounds(next)
  }

  // Host MUST call this on Stop, tab-switch, Profile reset, zoom/layout changes.
  // Native navigation/destruction also invalidate automatically. This grants no
  // ability to resume control: every capture still needs its exact Host guard.
  invalidateRequests(reason = 'invalidated') {
    this.generation += 1
    if (this.active) this.active.cancel(surfaceError('browser-reference-stale', `离屏请求已失效：${String(reason).slice(0, 80)}`))
  }

  capture(options = {}) {
    return this._capture(options, false)
  }

  // Separate fixed-shell-only lane. Never route this method from browser tools,
  // action strings, renderer-selected lane flags, or model attachment handling.
  // Human presentation must not blank ordinary password/account pages merely
  // because the model is forbidden to capture their pixels.
  captureForPresentation({ assertPresented, inspectViewport, signal = null } = {}) {
    if (typeof assertPresented !== 'function' || typeof inspectViewport !== 'function') return Promise.reject(new TypeError('Presentation requires fixed-shell identity and viewport callbacks'))
    return this._capture({ assertCurrent: assertPresented, signal, inspect: async () => {
      const viewport = await inspectViewport()
      return { viewport, rect: { x: 0, y: 0, width: viewport?.width, height: viewport?.height } }
    } }, true)
  }

  _capture({ assertCurrent, inspect, signal = null } = {}, presentation = false) {
    if (typeof assertCurrent !== 'function' || typeof inspect !== 'function') return Promise.reject(new TypeError('Offscreen capture requires exact Host identity and sensitive-content guards'))
    if (signal?.aborted) return Promise.reject(cancelled())
    if (this.disposed || this.webContents.isDestroyed()) return Promise.reject(stale())
    if (this.active) return Promise.reject(surfaceError('browser-capture-busy', '上一个离屏请求尚未终止；不排队或自动重试。'))
    const wc = this.webContents
    const frame = wc.mainFrame
    const token = { id: randomUUID(), generation: this.generation, url: wc.getURL(), frame, frameProcessId: frame.processId, frameRoutingId: frame.routingId, dead: false, cleanups: [] }
    this.active = token
    let resolve, reject
    const result = new Promise((yes, no) => { resolve = yes; reject = no })
    let settled = false
    const cleanup = () => {
      for (const fn of token.cleanups.splice(0)) { try { fn() } catch {} }
      try { if (!wc.isDestroyed()) wc.stopPainting() } catch {}
    }
    const finish = (error, value) => {
      if (settled) return
      settled = true
      cleanup()
      error ? reject(error) : resolve(value)
    }
    token.cancel = error => {
      token.dead = true
      token.rejectPaint?.(error)
      finish(error)
    }
    const timer = setTimeout(() => token.cancel(surfaceError('browser-operation-timeout', '离屏绘制或安全检查等待超时。')), this.timeoutMs)
    token.cleanups.push(() => clearTimeout(timer))
    const onAbort = () => token.cancel(cancelled())
    signal?.addEventListener('abort', onAbort, { once: true })
    token.cleanups.push(() => signal?.removeEventListener('abort', onAbort))
    const guard = () => {
      if (token.dead || signal?.aborted) throw cancelled()
      if (this.disposed || this.active !== token || token.generation !== this.generation || wc.isDestroyed() || wc.getURL() !== token.url || wc.mainFrame !== frame || frame.detached || frame.processId !== token.frameProcessId || frame.routingId !== token.frameRoutingId) throw stale()
      const answer = assertCurrent()
      if (answer && typeof answer.then === 'function') throw new TypeError('assertCurrent must be synchronous; use inspect for awaited checks')
      if (answer === false) throw stale()
    }
    const work = async () => {
      guard()
      const before = checkedInspection(await inspect())
      guard()
      const painted = await this.nextPaint(token, guard, before.viewport)
      token.hasFrame = true
      guard()
      // Re-run full Host input/text masking AFTER the actual frame await, not
      // just a cached preflight or input-only postcheck.
      const after = checkedInspection(await inspect())
      guard()
      if (JSON.stringify(before) !== JSON.stringify(after)) throw stale()
      const size = painted.image.getSize()
      const scales = painted.image.getScaleFactors()
      const scale = Math.max(1, ...scales)
      if (!Number.isFinite(scale) || size.width * size.height * scale * scale > this.maxPixels) throw surfaceError('browser-capture-too-large', '离屏图像超出像素预算。')
      // NativeImage geometry, not guessed DPR: emulated DPR2 can still paint
      // an 800x600 NativeImage for an 800x600 CSS viewport.
      const sx = size.width / before.viewport.width, sy = size.height / before.viewport.height
      if (Math.abs(sx / sy - 1) > 0.02) throw stale()
      const r = before.rect
      // Inward rounding cannot include pixels outside the authorized crop.
      const x = Math.ceil(r.x * sx), y = Math.ceil(r.y * sy)
      const width = Math.floor((r.x + r.width) * sx) - x, height = Math.floor((r.y + r.height) * sy) - y
      if (width < 1 || height < 1) throw surfaceError('browser-capture-unavailable', '离屏裁剪区域过小。')
      const image = painted.image.crop({ x, y, width, height })
      if (image.isEmpty()) throw surfaceError('browser-capture-unavailable', '离屏裁剪返回空图像。')
      guard()
      return { image, captureEngine: 'offscreen-paint', captureLane: presentation ? 'presentation' : 'model', requestId: token.id, frameSequence: painted.sequence, viewGeneration: token.generation, viewport: before.viewport, rect: before.rect }
    }
    // A timed-out non-cancellable inspect carrier retains this ONE busy slot
    // until it really settles; retries cannot accumulate unresolved carriers.
    const settleWork = (error, value) => {
      cleanup()
      token.hasFrame = false
      if (this.active === token) this.active = null
      finish(error, value)
    }
    work().then(value => settleWork(null, value), error => settleWork(error))
    return result
  }

  nextPaint(token, guard, viewport) {
    const wc = this.webContents
    return new Promise((resolve, reject) => {
      token.rejectPaint = reject
      let phase = 0
      let repaintTimer = null
      let completed = false
      const requestPaint = () => {
        if (completed || token.dead) return
        try { guard(); wc.invalidate() } catch (error) { completed = true; reject(error) }
      }
      const schedulePaint = () => {
        if (repaintTimer || completed) return
        repaintTimer = setTimeout(() => { repaintTimer = null; if (phase === 1) phase = 2; requestPaint() }, Math.ceil(1000 / this.frameRate))
      }
      const onPaint = (_event, _dirty, image) => {
        if (completed) return
        try {
          guard()
          this.sequence += 1
          if (!image || image.isEmpty()) { schedulePaint(); return }
          const size = image.getSize(), scale = Math.max(1, ...image.getScaleFactors())
          if (size.width < 1 || size.height < 1 || !Number.isFinite(scale) || size.width * size.height * scale * scale > this.maxPixels) throw surfaceError('browser-capture-too-large', '离屏帧超出像素预算。')
          // A pending resize can deliver a previous-size surface first. Never
          // crop it against new geometry; request a matching frame within the
          // same deadline, with all identity/content checks still mandatory.
          if (Math.abs((size.width / viewport.width) / (size.height / viewport.height) - 1) > 0.02) { schedulePaint(); return }
          // Drain the first valid paint after resume, then explicitly invalidate
          // again. No earlier/background frame is cached or used for a request.
          if (phase !== 2) { phase = 1; schedulePaint(); return }
          completed = true
          wc.stopPainting()
          resolve({ image, sequence: this.sequence })
        } catch (error) { completed = true; reject(error) }
      }
      wc.on('paint', onPaint)
      token.cleanups.push(() => { completed = true; clearTimeout(repaintTimer); wc.removeListener('paint', onPaint); token.rejectPaint = null })
      try { guard(); wc.setFrameRate(this.frameRate); wc.startPainting(); requestPaint() } catch (error) { reject(error) }
    })
  }

  state() {
    return { disposed: this.disposed, busy: this.active !== null, generation: this.generation, frameSequence: this.sequence, retainedFrames: this.active?.hasFrame ? 1 : 0, queuedRequests: 0 }
  }

  dispose() {
    if (this.disposed) return
    this.invalidateRequests('disposed')
    this.detach()
    this.disposed = true
    const wc = this.webContents
    wc.removeListener('did-start-navigation', this.onNavigation)
    wc.removeListener('did-navigate-in-page', this.onNavigation)
    wc.removeListener('render-process-gone', this.onGone)
    wc.removeListener('destroyed', this.onDestroyed)
    if (!wc.isDestroyed()) {
      wc.stopPainting()
      wc.close({ waitForBeforeUnload: false })
    }
  }
}

function createBrowserOffscreenSurface(options) { return new BrowserOffscreenSurface(options) }
module.exports = { BrowserOffscreenSurface, createBrowserOffscreenSurface }
