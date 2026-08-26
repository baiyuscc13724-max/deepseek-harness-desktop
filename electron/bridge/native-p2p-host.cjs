const { EventEmitter } = require('node:events')
const path = require('node:path')

const COMMAND_CHANNEL = 'native-p2p:command'
const EVENT_CHANNEL = 'native-p2p:event'
const MAX_PENDING_COMMANDS = 64
const MAX_PACKET_BASE64_CHARS = Math.ceil((64 * 1024 + 64) * 4 / 3) + 4

function validPeerId(value) { return /^[a-f0-9]{16}$/.test(String(value || '')) }
function validBase64(value, maxLength) { return typeof value === 'string' && value.length <= maxLength && /^[A-Za-z0-9+/]*={0,2}$/.test(value) }
function validBase64Url(value, bytes) { return typeof value === 'string' && value.length <= Math.ceil(bytes * 4 / 3) && /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, 'base64url').length === bytes }

class NativeP2pHost extends EventEmitter {
  constructor({
    BrowserWindow,
    ipcMain,
    rendererFile = path.join(__dirname, '..', '..', 'renderer', 'native-p2p.html'),
    preloadFile = path.join(__dirname, '..', '..', 'renderer', 'native-p2p.js')
  }) {
    super()
    if (typeof BrowserWindow !== 'function' || !ipcMain?.on) throw new Error('Native P2P requires Electron BrowserWindow and ipcMain.')
    this.BrowserWindow = BrowserWindow
    this.ipcMain = ipcMain
    this.rendererFile = rendererFile
    this.preloadFile = preloadFile
    this.window = null
    this.ready = false
    this.pending = []
    this.onRendererEvent = (event, payload) => {
      if (!this.window || this.window.isDestroyed() || event.sender !== this.window.webContents) return
      const type = String(payload?.type || '')
      if (!['ready', 'relay-ready', 'packet', 'path', 'peer-left', 'session', 'stream-failed', 'error', 'closed'].includes(type)) return
      if (['packet', 'path', 'peer-left', 'session', 'stream-failed'].includes(type) && !validPeerId(payload?.peerId)) return
      if (type === 'packet' && (!validBase64(payload?.data, MAX_PACKET_BASE64_CHARS) || !['direct', 'relay'].includes(payload?.path))) return
      if (type === 'path' && !['direct', 'negotiating', 'relay'].includes(payload?.path)) return
      if (type === 'session' && (!validBase64Url(payload?.desktopNonce, 32) || !validBase64Url(payload?.mobileNonce, 32) || !validBase64Url(payload?.sessionId, 16))) return
      if (type === 'stream-failed' && (!Number.isSafeInteger(payload?.streamId) || payload.streamId < 0 || payload.streamId > 0xffffffff || !['direct', 'relay'].includes(payload?.path))) return
      if (type === 'error') payload = { type, message: String(payload?.message || '').slice(0, 512) }
      this.emit(type, payload)
    }
    this.ipcMain.on(EVENT_CHANNEL, this.onRendererEvent)
  }

  async start(config) {
    if (!this.window || this.window.isDestroyed()) await this.#createWindow()
    this.send('start', config)
  }

  async #createWindow() {
    this.ready = false
    const window = new this.BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      webPreferences: {
        preload: this.preloadFile,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    this.window = window
    window.setMenuBarVisibility?.(false)
    window.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.once('closed', () => {
      if (this.window === window) this.window = null
      this.ready = false
      this.emit('closed', { type: 'closed' })
    })
    let cancelReady = () => {}
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('Native P2P renderer did not become ready.')) }, 10_000)
      timer.unref?.()
      const onReady = () => { cleanup(); resolve() }
      const onClosed = () => { cleanup(); reject(new Error('Native P2P renderer closed during startup.')) }
      const cleanup = () => {
        clearTimeout(timer)
        this.removeListener('ready', onReady)
        window.removeListener('closed', onClosed)
      }
      cancelReady = () => { cleanup(); resolve() }
      this.once('ready', onReady)
      window.once('closed', onClosed)
    })
    try {
      await window.loadFile(this.rendererFile)
      await ready
    } catch (error) {
      cancelReady()
      if (!window.isDestroyed()) window.destroy()
      throw error
    }
    this.ready = true
    for (const command of this.pending.splice(0)) window.webContents.send(COMMAND_CHANNEL, command)
  }

  send(type, payload = {}) {
    const command = { type, payload }
    if (!this.window || this.window.isDestroyed() || !this.ready) {
      if (this.pending.length >= MAX_PENDING_COMMANDS) return false
      this.pending.push(command)
      return false
    }
    this.window.webContents.send(COMMAND_CHANNEL, command)
    return true
  }

  sendPacket(peerId, packet, path = 'relay', streamId = 0) {
    const value = Buffer.from(packet)
    if (!validPeerId(peerId) || value.length < 1 || value.length > 64 * 1024 + 64 || !['direct', 'relay'].includes(path)) return false
    return this.send('packet', { peerId, data: value.toString('base64'), path, streamId })
  }

  async stop() {
    this.pending = []
    const window = this.window
    this.window = null
    this.ready = false
    if (window && !window.isDestroyed()) {
      window.webContents.send(COMMAND_CHANNEL, { type: 'stop', payload: {} })
      window.destroy()
    }
  }

  dispose() {
    this.stop().catch(() => {})
    this.ipcMain.removeListener(EVENT_CHANNEL, this.onRendererEvent)
    this.removeAllListeners()
  }
}

module.exports = { COMMAND_CHANNEL, EVENT_CHANNEL, NativeP2pHost }
