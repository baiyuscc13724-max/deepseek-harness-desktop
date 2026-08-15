const ACTION_SPECS = Object.freeze({
  idle: { atlas: 'idle', fps: 8, loop: true },
  'prepare-walk': { atlas: 'idle', fps: 8, loop: false, frames: [18, 19, 20, 21, 22, 23] },
  settle: { atlas: 'idle', fps: 8, loop: false, frames: [24, 25, 26, 27, 28, 29, 30, 31] },
  yawn: { atlas: 'sleeping', fps: 8, loop: false, frames: [0, 1, 2, 3, 4, 5, 6, 7] },
  wink: { atlas: 'idle', fps: 8, loop: false, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] },
  petting: { atlas: 'idle', fps: 10, loop: true, frames: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1] },
  stretch: { atlas: 'idle', fps: 8, loop: false, frames: [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31] },
  groom: { atlas: 'celebrate', fps: 8, loop: false, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] },
  'look-around': { atlas: 'idle', fps: 7, loop: false, frames: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1] },
  'tail-flick': { atlas: 'idle', fps: 9, loop: false, frames: [18, 19, 20, 21, 22, 23, 22, 21, 20, 19, 18] },
  nap: { atlas: 'sleeping', fps: 7, loop: true, frames: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31] },
  gaming: { atlas: 'working', fps: 10, loop: true, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] },
  'desk-work': { atlas: 'working', fps: 8, loop: true, frames: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] },
  working: { atlas: 'working', fps: 10, loop: true },
  'needs-input': { atlas: 'working', fps: 8, loop: true, frames: [6, 7, 8, 9, 10, 11, 10, 9] },
  blocked: { atlas: 'working', fps: 6, loop: true, frames: [6, 7, 8, 9, 10, 9, 8, 7] },
  hungry: { atlas: 'feeding', fps: 6, loop: true, frames: [0, 1, 2, 3, 4, 5, 4, 3] },
  sleeping: { atlas: 'sleeping', fps: 8, loop: true },
  sit: { atlas: 'sleeping', fps: 7, loop: true, frames: [8, 9, 10, 11, 12, 13, 14, 15] },
  walk: { atlas: 'walk', fps: 12, loop: true },
  climb: { atlas: 'climb', fps: 10, loop: true },
  ceiling: { atlas: 'climb', fps: 9, loop: true },
  perch: { atlas: 'sleeping', fps: 7, loop: true, frames: [8, 9, 10, 11, 12, 13, 14, 15] },
  drag: { atlas: 'physics', fps: 8, loop: true, frames: [0, 1, 2, 3, 4, 5, 6, 7] },
  fall: { atlas: 'physics', fps: 10, loop: true, frames: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] },
  land: { atlas: 'physics', fps: 10, loop: false, frames: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31] },
  feeding: { atlas: 'feeding', fps: 10, loop: false },
  ready: { atlas: 'celebrate', fps: 10, loop: false },
  celebrating: { atlas: 'celebrate', fps: 10, loop: true },
  wave: { atlas: 'celebrate', fps: 10, loop: false, frames: [18, 19, 20, 21, 22, 23, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47] }
})

const DEFAULT_HIT_PROFILE = Object.freeze({ left: 0.13, top: 0.08, right: 0.87, bottom: 0.99 })
const ACTION_HIT_PROFILES = Object.freeze({
  drag: { left: 0.08, top: 0.08, right: 0.92, bottom: 0.95 },
  fall: { left: 0.04, top: 0.08, right: 0.96, bottom: 0.95 },
  land: { left: 0.08, top: 0.16, right: 0.92, bottom: 0.99 },
  sit: { left: 0.1, top: 0.18, right: 0.9, bottom: 0.99 },
  sleeping: { left: 0.06, top: 0.28, right: 0.94, bottom: 0.99 },
  perch: { left: 0.1, top: 0.18, right: 0.9, bottom: 0.99 },
  ceiling: { left: 0.08, top: 0.02, right: 0.92, bottom: 0.99 },
  feeding: { left: 0.06, top: 0.1, right: 0.94, bottom: 0.99 },
  celebrating: { left: 0.02, top: 0.04, right: 0.98, bottom: 0.99 },
  wave: { left: 0.02, top: 0.06, right: 0.98, bottom: 0.99 },
  working: { left: 0.02, top: 0.1, right: 0.98, bottom: 0.99 },
  gaming: { left: 0.02, top: 0.1, right: 0.98, bottom: 0.99 },
  'desk-work': { left: 0.02, top: 0.1, right: 0.98, bottom: 0.99 }
})

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'sync'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`无法加载桌宠动画：${url}`))
    image.src = url
  })
}

export class MaidWhaleSpriteRig {
  constructor({ host, atlases }) {
    this.host = host
    this.atlases = atlases
    this.viewport = null
    this.sheet = null
    this.context = null
    this.images = new Map()
    this.currentUrl = null
    this.action = 'idle'
    this.direction = 1
    this.frame = -1
    this.startedAt = performance.now()
    this.frameHandle = null
    this.preloadPromises = new Map()
    this.gazeTarget = { x: 0, y: 0 }
    this.gazeCurrent = { x: 0, y: 0 }
  }

  async load() {
    await Promise.all(Object.keys(this.atlases).map(name => this.#preloadAtlas(name)))
    this.viewport = document.createElement('span')
    this.viewport.className = 'sprite-viewport'
    this.sheet = document.createElement('canvas')
    this.sheet.className = 'sprite-sheet'
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    this.sheet.width = Math.round(120 * ratio)
    this.sheet.height = Math.round(320 * ratio)
    this.context = this.sheet.getContext('2d', { alpha: true })
    this.context.imageSmoothingEnabled = true
    this.context.imageSmoothingQuality = 'high'
    this.viewport.append(this.sheet)
    this.host.replaceChildren(this.viewport)
    this.host.dataset.rigStage = 'ready'
    this.host.dataset.rigFormat = 'complete-frame-2d-sprites'
    this.setAction('idle', { immediate: true })
    this.#renderFrame(performance.now())
    return this
  }

  #preloadAtlas(name) {
    if (!this.preloadPromises.has(name)) {
      const frames = this.atlases[name] || []
      this.preloadPromises.set(name, Promise.all(frames.map(async url => {
        if (this.images.has(url)) return this.images.get(url)
        const image = await loadImage(url)
        this.images.set(url, image)
        return image
      })).then(() => undefined))
    }
    return this.preloadPromises.get(name)
  }

  #renderFrame = now => {
    if (!this.host?.isConnected || !this.sheet) return
    const spec = ACTION_SPECS[this.action] || ACTION_SPECS.idle
    const frames = spec.frames || this.atlases[spec.atlas].map((_, index) => index)
    const elapsed = Math.max(0, now - this.startedAt) / 1000
    const rawIndex = Math.floor(elapsed * spec.fps)
    const frameIndex = spec.loop ? rawIndex % frames.length : Math.min(frames.length - 1, rawIndex)
    const frame = frames[frameIndex]
    if (frame !== this.frame) {
      this.frame = frame
      this.#showFrame(this.atlases[spec.atlas][frame])
      this.host.dataset.rigFrame = String(frame)
    }
    this.#updateGaze()
    this.frameHandle = requestAnimationFrame(this.#renderFrame)
  }

  #updateGaze() {
    if (!this.viewport) return
    this.gazeCurrent.x += (this.gazeTarget.x - this.gazeCurrent.x) * 0.11
    this.gazeCurrent.y += (this.gazeTarget.y - this.gazeCurrent.y) * 0.11
    const x = this.gazeCurrent.x * 1.8
    const y = this.gazeCurrent.y * 0.9
    this.viewport.style.transform = `translateX(-50%) translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
  }

  #showFrame(url) {
    if (!this.context || !this.sheet || this.currentUrl === url) return
    const image = this.images.get(url)
    if (!image) return
    const canvasWidth = this.sheet.width
    const canvasHeight = this.sheet.height
    const scale = Math.min(canvasWidth / image.naturalWidth, canvasHeight / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    this.context.clearRect(0, 0, canvasWidth, canvasHeight)
    this.context.drawImage(image, (canvasWidth - width) / 2, canvasHeight - height, width, height)
    this.currentUrl = url
    this.sheet.dataset.src = url
  }

  setAction(name, { direction = this.direction } = {}) {
    this.action = ACTION_SPECS[name] ? name : 'idle'
    this.direction = direction < 0 ? -1 : 1
    const spec = ACTION_SPECS[this.action]
    this.#preloadAtlas(spec.atlas).catch(() => {})
    this.startedAt = performance.now()
    this.frame = -1
    this.currentUrl = null
    const firstFrame = spec.frames?.[0] ?? 0
    const directional = this.action === 'walk' || this.action === 'climb'
    const transform = directional && this.direction > 0 ? 'scaleX(-1)' : 'scaleX(1)'
    this.sheet.style.transform = transform
    this.#showFrame(this.atlases[spec.atlas][firstFrame])
    this.viewport.dataset.action = this.action
    this.host.dataset.rigAction = this.action
  }

  setGaze(x = 0, y = 0) {
    this.gazeTarget.x = Math.max(-1, Math.min(1, Number(x) || 0))
    this.gazeTarget.y = Math.max(-1, Math.min(1, Number(y) || 0))
  }

  hitProfile(action = this.action) {
    return { ...DEFAULT_HIT_PROFILE, ...(ACTION_HIT_PROFILES[action] || {}) }
  }
}
