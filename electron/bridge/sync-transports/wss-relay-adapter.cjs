const { EventEmitter } = require('node:events')
const net = require('node:net')
const { FRAME_TYPES, RELAY_MAX_PAYLOAD_BYTES, RelayTunnelCodec } = require('../relay-tunnel-codec.cjs')

const DESKTOP_PEER_ID = Buffer.alloc(8)
const MAX_SOCKET_BUFFER_BYTES = 4 * 1024 * 1024

function safeRelayUrl(value) {
  const url = new URL(String(value || '').trim())
  if (url.protocol !== 'wss:' || (url.port && url.port !== '443') || url.username || url.password || url.hash) throw new Error('WSS relay URL must use credential-free wss:// on port 443.')
  return url.toString()
}

function peerBuffer(value) {
  const peer = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'hex')
  if (peer.length !== 8) throw new Error('WSS relay peer id is invalid.')
  return peer
}

function streamKey(peer, streamId) {
  return `${peer.toString('hex')}:${streamId}`
}

class WssRelayAdapter extends EventEmitter {
  constructor({ relayUrl, WebSocketImpl, connectImpl = net.connect, readyTimeoutMs = 15_000 }) {
    super()
    this.id = 'wss-relay'
    this.relayUrl = relayUrl ? safeRelayUrl(relayUrl) : ''
    this.WebSocketImpl = WebSocketImpl
    this.connectImpl = connectImpl
    this.readyTimeoutMs = readyTimeoutMs
    this.socket = null
    this.context = null
    this.codec = null
    this.streams = new Map()
    this.status = 'stopped'
    this.detail = this.relayUrl ? 'WSS/443 通道待命' : '未配置 WSS/443 中继'
    this.lastError = null
  }

  available() {
    return Boolean(this.relayUrl && typeof this.WebSocketImpl === 'function')
  }

  state() {
    return {
      id: this.id,
      available: this.available(),
      status: this.status,
      detail: this.detail,
      error: this.lastError
    }
  }

  async start(context) {
    if (this.socket && this.status === 'connected') return this.state()
    if (!this.available()) throw new Error('WSS/443 中继尚未配置。')
    if (!context?.mesh?.relayRoomId || !context?.mesh?.relayTunnelKey || !context?.port) throw new Error('WSS relay mesh identity is incomplete.')
    await this.stop()
    this.context = context
    this.codec = new RelayTunnelCodec(context.mesh.relayTunnelKey)
    this.status = 'connecting'
    this.detail = '正在连接 WSS/443 中继…'
    this.lastError = null
    this.emit('state', this.state())

    const socket = new this.WebSocketImpl(this.relayUrl, { perMessageDeflate: false, handshakeTimeout: this.readyTimeoutMs })
    this.socket = socket
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WSS/443 中继连接超时。')), this.readyTimeoutMs)
      const cleanup = () => clearTimeout(timer)
      socket.once('open', () => {
        socket.send(JSON.stringify({ type: 'hello', version: 1, role: 'desktop', roomId: context.mesh.relayRoomId }))
      })
      socket.on('message', (data, binary) => {
        if (binary) {
          this.#handlePacket(Buffer.from(data)).catch(error => this.#disconnect(error))
          return
        }
        let message
        try { message = JSON.parse(String(data)) } catch { return }
        if (message.type === 'welcome' && message.role === 'desktop') {
          cleanup()
          resolve()
        } else if (message.type === 'error') {
          cleanup()
          reject(new Error(String(message.message || 'WSS relay rejected connection.')))
        }
      })
      socket.once('error', error => { cleanup(); reject(error) })
      socket.once('close', () => {
        if (this.socket === socket && this.status === 'connecting') {
          cleanup()
          reject(new Error('WSS relay closed before it became ready.'))
        }
      })
    }).catch(async error => {
      await this.stop()
      throw error
    })
    this.status = 'connected'
    this.detail = 'WSS/443 加密中继已连接'
    socket.once('close', () => this.#disconnect(new Error('WSS/443 中继连接已断开。')))
    socket.once('error', error => this.#disconnect(error))
    this.emit('state', this.state())
    return this.state()
  }

  pairingConfig() {
    if (this.status !== 'connected' || !this.context) return null
    return {
      id: this.id,
      origin: `http://${this.context.mesh.serviceAddress}:${this.context.port}`,
      relayUrl: this.relayUrl,
      roomId: this.context.mesh.relayRoomId,
      tunnelKey: this.context.mesh.relayTunnelKey,
      protocolVersion: 1,
      secureMode: true
    }
  }

  #send(peer, type, streamId, payload) {
    if (!this.socket || this.status !== 'connected' || this.socket.readyState !== this.WebSocketImpl.OPEN) return false
    const encrypted = this.codec.encode(type, streamId, payload)
    if (this.socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) return false
    this.socket.send(Buffer.concat([peerBuffer(peer), encrypted]), { binary: true })
    return true
  }

  async #handlePacket(packet) {
    if (packet.length < 8) throw new Error('WSS relay envelope is truncated.')
    const peer = packet.subarray(0, 8)
    if (peer.equals(DESKTOP_PEER_ID)) throw new Error('WSS relay desktop received an invalid sender id.')
    const frame = this.codec.decode(packet.subarray(8))
    const key = streamKey(peer, frame.streamId)
    if (frame.type === FRAME_TYPES.OPEN) {
      if (this.streams.has(key)) throw new Error('WSS relay stream id was reused.')
      const upstream = this.connectImpl({ host: '127.0.0.1', port: this.context.port })
      this.streams.set(key, upstream)
      upstream.on('data', chunk => {
        for (let offset = 0; offset < chunk.length; offset += RELAY_MAX_PAYLOAD_BYTES) {
          if (!this.#send(peer, FRAME_TYPES.DATA, frame.streamId, chunk.subarray(offset, offset + RELAY_MAX_PAYLOAD_BYTES))) {
            upstream.destroy(new Error('WSS relay backpressure limit exceeded.'))
            break
          }
        }
      })
      upstream.once('end', () => this.#send(peer, FRAME_TYPES.FIN, frame.streamId))
      upstream.once('error', () => this.#send(peer, FRAME_TYPES.RESET, frame.streamId))
      upstream.once('close', () => this.streams.delete(key))
      return
    }
    const upstream = this.streams.get(key)
    if (!upstream) {
      this.#send(peer, FRAME_TYPES.RESET, frame.streamId)
      return
    }
    if (frame.type === FRAME_TYPES.DATA) {
      if (upstream.writableLength + frame.payload.length > MAX_SOCKET_BUFFER_BYTES) {
        upstream.destroy(new Error('WSS relay stream buffer exceeded.'))
        this.#send(peer, FRAME_TYPES.RESET, frame.streamId)
      } else upstream.write(frame.payload)
    } else if (frame.type === FRAME_TYPES.FIN) upstream.end()
    else if (frame.type === FRAME_TYPES.RESET) upstream.destroy()
    else if (frame.type === FRAME_TYPES.PING) this.#send(peer, FRAME_TYPES.PONG, frame.streamId)
  }

  #disconnect(error) {
    if (this.status === 'stopped') return
    this.lastError = error?.message || 'WSS/443 中继连接已断开。'
    this.status = 'disconnected'
    this.detail = 'WSS/443 中继已断开'
    for (const socket of this.streams.values()) socket.destroy()
    this.streams.clear()
    this.socket = null
    this.emit('state', this.state())
    this.emit('disconnect', error)
  }

  async stop() {
    const socket = this.socket
    this.socket = null
    this.context = null
    this.codec = null
    for (const stream of this.streams.values()) stream.destroy()
    this.streams.clear()
    if (socket && socket.readyState < this.WebSocketImpl.CLOSING) socket.close(1000, 'desktop stopping')
    this.status = 'stopped'
    this.detail = this.available() ? 'WSS/443 通道待命' : '未配置 WSS/443 中继'
    this.emit('state', this.state())
  }
}

function createWssRelayAdapter(options) {
  return new WssRelayAdapter(options)
}

module.exports = {
  DESKTOP_PEER_ID,
  MAX_SOCKET_BUFFER_BYTES,
  WssRelayAdapter,
  createWssRelayAdapter,
  peerBuffer,
  safeRelayUrl,
  streamKey
}
