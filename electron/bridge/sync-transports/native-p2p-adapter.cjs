const { EventEmitter } = require('node:events')
const net = require('node:net')
const { FRAME_TYPES, NATIVE_P2P_DIRECTION, NativeP2pSessionCodec, RELAY_MAX_PACKET_BYTES, RELAY_MAX_PAYLOAD_BYTES, RelayTunnelCodec, deriveNativeP2pSession } = require('../relay-tunnel-codec.cjs')
const { MAX_SOCKET_BUFFER_BYTES, peerBuffer, safeRelayUrl, streamKey } = require('./wss-relay-adapter.cjs')

const NATIVE_P2P_PROTOCOL_VERSION = 1
const MAX_PEERS = 32
const MAX_STREAMS_PER_PEER = 64
const MAX_TOTAL_STREAMS = 256
const DEFAULT_STUN_URL = 'stun:stun.cloudflare.com:3478'
const DIRECT_PATH = 'direct'
const NEGOTIATING_PATH = 'negotiating'
const RELAY_PATH = 'relay'

class NativeP2pAdapter extends EventEmitter {
  constructor({ relayUrl, host, connectImpl = net.connect, readyTimeoutMs = 15_000 }) {
    super()
    this.id = 'native-p2p'
    this.relayUrl = relayUrl ? safeRelayUrl(relayUrl) : ''
    this.host = host
    this.connectImpl = connectImpl
    this.readyTimeoutMs = readyTimeoutMs
    this.context = null
    this.codec = null
    this.streams = new Map()
    this.sessions = new Map()
    this.peerPaths = new Map()
    this.status = 'stopped'
    this.path = null
    this.detail = this.relayUrl ? '原生直连待命（WSS 兜底）' : '未配置个人 WSS 信令/中继'
    this.lastError = null
    this.bound = false
  }

  available() { return Boolean(this.relayUrl && this.host) }

  configureRelayUrl(value) {
    if (this.status === 'connecting' || this.status === 'connected') throw new Error('Stop native P2P before changing its relay URL.')
    this.relayUrl = value ? safeRelayUrl(value) : ''
    this.status = 'stopped'
    this.path = null
    this.lastError = null
    this.detail = this.relayUrl ? '原生直连待命（WSS 兜底）' : '未配置个人 WSS 信令/中继'
    this.emit('state', this.state())
    return this.state()
  }

  state() {
    const directPeers = [...this.peerPaths.values()].filter(value => value === DIRECT_PATH).length
    const negotiatingPeers = [...this.peerPaths.values()].filter(value => value === NEGOTIATING_PATH).length
    return {
      id: this.id,
      available: this.available(),
      relayUrl: this.relayUrl,
      status: this.status,
      path: this.path,
      directPeers,
      negotiatingPeers,
      sessionPeers: this.sessions.size,
      peerCount: this.peerPaths.size,
      detail: this.detail,
      error: this.lastError
    }
  }

  #bindHost() {
    if (this.bound) return
    this.bound = true
    this.host.on('packet', event => this.#handleEnvelope(event).catch(error => {
      this.lastError = error.message
      this.#closeStreamsForPeer(String(event?.peerId || ''))
      this.emit('state', this.state())
    }))
    this.host.on('path', event => {
      const peerId = String(event?.peerId || '')
      if (/^[a-f0-9]{16}$/.test(peerId)) {
        const path = [DIRECT_PATH, NEGOTIATING_PATH].includes(event.path) ? event.path : RELAY_PATH
        this.peerPaths.set(peerId, path)
      }
      if (event.path !== DIRECT_PATH) this.#closeStreamsForPeer(peerId, DIRECT_PATH)
      this.#refreshPath()
    })
    this.host.on('session', event => {
      try { this.#establishSession(event) }
      catch (error) { this.lastError = error.message; this.emit('state', this.state()) }
    })
    this.host.on('stream-failed', event => {
      const key = streamKey(peerBuffer(event.peerId), event.streamId)
      const record = this.streams.get(key)
      if (record?.path === event.path) record.socket.destroy(new Error(`Native P2P ${event.path} path failed.`))
    })
    this.host.on('peer-left', event => {
      const peerId = String(event?.peerId || '')
      this.peerPaths.delete(peerId)
      this.sessions.delete(peerId)
      this.#closeStreamsForPeer(peerId)
      this.#refreshPath()
    })
    this.host.on('error', event => {
      this.lastError = String(event?.message || '原生直连发生错误，已保留 WSS 兜底。')
      this.#refreshPath()
    })
    this.host.on('closed', () => {
      if (this.status !== 'stopped') this.#fail(new Error('原生 P2P 宿主页意外关闭。'))
    })
  }

  #establishSession(event) {
    if (!this.context || this.sessions.size >= MAX_PEERS && !this.sessions.has(event.peerId)) return
    const derived = deriveNativeP2pSession(this.context.mesh.relayTunnelKey, {
      roomId: this.context.mesh.relayRoomId,
      peerId: event.peerId,
      desktopNonce: event.desktopNonce,
      mobileNonce: event.mobileNonce
    })
    if (derived.sessionId.toString('base64url') !== event.sessionId) throw new Error('Native P2P session id mismatch.')
    const existing = this.sessions.get(event.peerId)
    if (existing?.sessionId.equals(derived.sessionId)) throw new Error('Native P2P duplicate session was rejected.')
    this.#closeStreamsForPeer(event.peerId)
    this.sessions.set(event.peerId, new NativeP2pSessionCodec(derived.sessionKey, {
      sessionId: derived.sessionId,
      peerId: event.peerId,
      sendDirection: NATIVE_P2P_DIRECTION.DESKTOP_TO_MOBILE,
      receiveDirection: NATIVE_P2P_DIRECTION.MOBILE_TO_DESKTOP
    }))
  }

  #closeStreamsForPeer(peerId, path = null) {
    for (const [key, record] of this.streams) {
      if (record.peerId === peerId && (!path || record.path === path)) {
        this.streams.delete(key)
        record.socket.destroy()
      }
    }
  }

  #peerStreamCount(peerId) {
    let count = 0
    for (const record of this.streams.values()) if (record.peerId === peerId) count += 1
    return count
  }

  #refreshPath() {
    if (this.status !== 'connected') return
    const directPeers = [...this.peerPaths.values()].filter(value => value === DIRECT_PATH).length
    const negotiatingPeers = [...this.peerPaths.values()].filter(value => value === NEGOTIATING_PATH).length
    this.path = directPeers > 0 ? DIRECT_PATH : negotiatingPeers > 0 ? NEGOTIATING_PATH : RELAY_PATH
    this.detail = directPeers > 0
      ? `WebRTC 原生直连（${directPeers} 台设备）`
      : negotiatingPeers > 0
        ? `正在协商 WebRTC 直连（${negotiatingPeers} 台设备）`
        : '个人 WSS 加密中继（等待/回退）'
    this.emit('state', this.state())
  }

  async start(context) {
    if (this.status === 'connected') return this.state()
    if (!this.available()) throw new Error('原生 P2P 需要已配置的个人 WSS 信令/中继。')
    if (!context?.mesh?.relayRoomId || !context?.mesh?.relayTunnelKey || !context?.port) throw new Error('Native P2P mesh identity is incomplete.')
    await this.stop()
    this.#bindHost()
    this.context = context
    this.codec = new RelayTunnelCodec(context.mesh.relayTunnelKey)
    this.status = 'connecting'
    this.path = null
    this.detail = '正在建立原生 P2P 信令通道…'
    this.lastError = null
    this.emit('state', this.state())
    let cancelReady = () => {}
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('原生 P2P 信令连接超时。')) }, this.readyTimeoutMs)
      timer.unref?.()
      const onReady = () => { cleanup(); resolve() }
      const onClosed = () => { cleanup(); reject(new Error('原生 P2P 信令连接已关闭。')) }
      const cleanup = () => {
        clearTimeout(timer)
        this.host.removeListener('relay-ready', onReady)
        this.host.removeListener('closed', onClosed)
      }
      cancelReady = () => { cleanup(); resolve() }
      this.host.once('relay-ready', onReady)
      this.host.once('closed', onClosed)
    })
    try {
      await this.host.start({
        relayUrl: this.relayUrl,
        roomId: context.mesh.relayRoomId,
        signalKey: context.mesh.relayTunnelKey,
        protocolVersion: NATIVE_P2P_PROTOCOL_VERSION
      })
      await ready
    } catch (error) {
      cancelReady()
      await this.stop()
      throw error
    }
    this.status = 'connected'
    this.path = RELAY_PATH
    this.detail = '个人 WSS 加密中继（等待 WebRTC 直连）'
    this.emit('state', this.state())
    return this.state()
  }

  pairingConfig() {
    if (this.status !== 'connected' || !this.context) return null
    const common = {
      origin: `http://${this.context.mesh.serviceAddress}:${this.context.port}`,
      relayUrl: this.relayUrl,
      roomId: this.context.mesh.relayRoomId,
      tunnelKey: this.context.mesh.relayTunnelKey,
      secureMode: true
    }
    return [
      {
        id: this.id,
        ...common,
        protocolVersion: NATIVE_P2P_PROTOCOL_VERSION,
        fallbackTransport: 'wss-relay',
        iceServers: [{ urls: [DEFAULT_STUN_URL] }]
      },
      {
        id: 'wss-relay',
        ...common,
        protocolVersion: 1,
        p2p: true,
        signalingVersion: 1,
        stunUrls: [DEFAULT_STUN_URL]
      }
    ]
  }

  #sendRecord(record, type, streamId, payload) {
    if (this.status !== 'connected' || !record?.codec) return false
    const encrypted = record.codec.encode(type, streamId, payload)
    const sent = this.host.sendPacket(record.peerId, encrypted, record.path, streamId)
    if (!sent && record.socket) record.socket.destroy(new Error(`Native P2P ${record.path} backpressure limit exceeded.`))
    return sent
  }

  async #handleEnvelope(event) {
    if (this.status !== 'connected' && this.status !== 'connecting') return
    const peer = peerBuffer(event?.peerId)
    const peerId = peer.toString('hex')
    const encoded = String(event?.data || '')
    if (encoded.length > Math.ceil(RELAY_MAX_PACKET_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Native P2P packet encoding is invalid.')
    const packet = Buffer.from(encoded, 'base64')
    if (!packet.length || packet.length > RELAY_MAX_PACKET_BYTES) throw new Error('Native P2P packet size is invalid.')
    const codec = packet[0] === 2
      ? this.sessions.get(peerId)
      : packet[0] === 1 && event.path === RELAY_PATH && !this.sessions.has(peerId)
        ? this.codec
        : null
    if (!codec) throw new Error('Native P2P packet session or path was rejected.')
    const frame = codec.decode(packet)
    const key = streamKey(peer, frame.streamId)
    if (frame.type === FRAME_TYPES.OPEN) {
      if (this.streams.has(key) || this.streams.size >= MAX_TOTAL_STREAMS || this.#peerStreamCount(peerId) >= MAX_STREAMS_PER_PEER) {
        this.#sendRecord({ peerId, path: event.path, codec }, FRAME_TYPES.RESET, frame.streamId)
        return
      }
      const upstream = this.connectImpl({ host: '127.0.0.1', port: this.context.port })
      const record = { socket: upstream, peerId, path: event.path, codec }
      this.streams.set(key, record)
      upstream.on('data', chunk => {
        for (let offset = 0; offset < chunk.length; offset += RELAY_MAX_PAYLOAD_BYTES) {
          if (!this.#sendRecord(record, FRAME_TYPES.DATA, frame.streamId, chunk.subarray(offset, offset + RELAY_MAX_PAYLOAD_BYTES))) break
        }
      })
      upstream.once('end', () => this.#sendRecord(record, FRAME_TYPES.FIN, frame.streamId))
      upstream.once('error', () => this.#sendRecord(record, FRAME_TYPES.RESET, frame.streamId))
      upstream.once('close', () => this.streams.delete(key))
      return
    }
    const record = this.streams.get(key)
    if (!record) {
      this.#sendRecord({ peerId, path: event.path, codec }, FRAME_TYPES.RESET, frame.streamId)
      return
    }
    if (record.path !== event.path || record.codec !== codec) {
      record.socket.destroy(new Error('Native P2P stream path rebinding was rejected.'))
      return
    }
    const upstream = record.socket
    if (frame.type === FRAME_TYPES.DATA) {
      if (upstream.writableLength + frame.payload.length > MAX_SOCKET_BUFFER_BYTES) {
        upstream.destroy(new Error('Native P2P stream buffer exceeded.'))
        this.#sendRecord(record, FRAME_TYPES.RESET, frame.streamId)
      } else upstream.write(frame.payload)
    } else if (frame.type === FRAME_TYPES.FIN) upstream.end()
    else if (frame.type === FRAME_TYPES.RESET) upstream.destroy()
    else if (frame.type === FRAME_TYPES.PING) this.#sendRecord(record, FRAME_TYPES.PONG, frame.streamId)
  }

  #fail(error) {
    if (this.status === 'stopped') return
    this.lastError = error?.message || '原生 P2P 通道已断开。'
    this.status = 'disconnected'
    this.path = null
    this.detail = '原生 P2P/WSS 通道已断开'
    for (const record of this.streams.values()) record.socket.destroy()
    this.streams.clear()
    this.sessions.clear()
    this.peerPaths.clear()
    this.emit('state', this.state())
    this.emit('disconnect', error)
  }

  async stop() {
    this.status = 'stopped'
    this.path = null
    for (const record of this.streams.values()) record.socket.destroy()
    this.streams.clear()
    this.sessions.clear()
    this.peerPaths.clear()
    this.context = null
    this.codec = null
    await this.host?.stop?.()
    this.lastError = null
    this.detail = this.relayUrl ? '原生直连待命（WSS 兜底）' : '未配置个人 WSS 信令/中继'
    this.emit('state', this.state())
  }
}

function createNativeP2pAdapter(options) { return new NativeP2pAdapter(options) }

module.exports = { DEFAULT_STUN_URL, DIRECT_PATH, NEGOTIATING_PATH, NATIVE_P2P_PROTOCOL_VERSION, NativeP2pAdapter, createNativeP2pAdapter }
