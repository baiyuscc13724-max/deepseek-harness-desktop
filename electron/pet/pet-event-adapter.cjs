const { randomUUID } = require('node:crypto')
const WebSocket = require('ws')

function normalizeRuntimeUrl(value) {
  const target = new URL(value)
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error('宠物事件适配器只允许连接本机 Harness runtime。')
  }
  target.pathname = '/'
  target.search = ''
  target.hash = ''
  return target
}

class PetEventAdapter {
  constructor({ fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket, onEvent = () => {}, onDiagnostic = () => {} } = {}) {
    this.fetchImpl = fetchImpl
    this.WebSocketImpl = WebSocketImpl
    this.onEvent = onEvent
    this.onDiagnostic = onDiagnostic
    this.baseUrl = null
    this.sockets = new Set()
    this.reconnectTimer = null
    this.stopped = true
    this.defaultModel = ''
  }

  async call(method, payload = {}) {
    const rpcId = randomUUID()
    const response = await this.fetchImpl(new URL(`/api/${method}`, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload })
    })
    if (!response.ok) throw new Error(`${method} HTTP ${response.status}`)
    const envelope = await response.json()
    if (envelope.rpcId !== rpcId) throw new Error(`${method} rpcId 不匹配`)
    if (!envelope.result?.ok) throw new Error(envelope.result?.error?.message || `${method} 调用失败`)
    return envelope.result.value
  }

  async start(value) {
    const next = normalizeRuntimeUrl(value)
    if (!this.stopped && this.baseUrl?.origin === next.origin) return
    this.stop()
    this.stopped = false
    this.baseUrl = next
    await this.refreshBaseline()
    this.openStreams()
  }

  async refreshBaseline() {
    const [description, sessions] = await Promise.all([
      this.call('host.describe').catch(() => ({})),
      this.call('session.list')
    ])
    this.defaultModel = description.model || ''
    for (const item of sessions.items || []) {
      this.onEvent({
        type: 'baseline',
        sessionId: item.sessionId,
        parentSessionId: item.parentSessionId,
        running: item.running,
        updatedAt: item.updatedAt,
        tokenUsage: item.projections?.values?.tokenUsage,
        model: this.defaultModel
      })
    }
  }

  openStreams() {
    if (this.stopped) return
    this.openStream('/api/events.host', frame => this.handleHostFrame(frame))
    this.openStream('/api/events.mux', frame => this.handleMuxFrame(frame))
  }

  openStream(pathname, listener) {
    const url = new URL(pathname, this.baseUrl)
    url.protocol = 'ws:'
    const socket = new this.WebSocketImpl(url.toString())
    this.sockets.add(socket)
    socket.on('message', raw => {
      try {
        const envelope = JSON.parse(String(raw))
        if (envelope?.payload) listener(envelope.payload)
      } catch (error) {
        this.onDiagnostic(`丢弃无法解析的 ${pathname} 事件：${error.message}`)
      }
    })
    socket.on('error', error => this.onDiagnostic(`${pathname} 连接错误：${error.message}`))
    socket.on('close', () => {
      this.sockets.delete(socket)
      this.scheduleReconnect()
    })
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return
    for (const socket of this.sockets) socket.close()
    this.sockets.clear()
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (this.stopped) return
      try {
        await this.refreshBaseline()
        this.openStreams()
      } catch (error) {
        this.onDiagnostic(`宠物事件重新连接失败：${error.message}`)
        this.scheduleReconnect()
      }
    }, 1500)
    this.reconnectTimer.unref?.()
  }

  handleHostFrame(frame) {
    if (frame.type === 'host/session-added') {
      this.onEvent({ ...frame, type: 'session-added' })
    } else if (frame.type === 'host/session-removed') {
      this.onEvent({ type: 'session-removed', sessionId: frame.sessionId })
    } else if (frame.type === 'host/session-status') {
      this.onEvent({ type: 'session-status', sessionId: frame.sessionId, running: frame.running })
      if (frame.running) this.readSessionModel(frame.sessionId)
    } else if (frame.type === 'host/agent-error') {
      this.onEvent({ type: 'agent-error', sessionId: frame.sessionId })
    }
  }

  handleMuxFrame(frame) {
    if (frame.type === 'approval/requested' || frame.type === 'question/requested') {
      this.onEvent({ type: 'needs-input', sessionId: frame.sessionId })
      return
    }
    if (frame.type === 'approval/resolved' || frame.type === 'question/resolved') {
      this.onEvent({ type: 'input-resolved', sessionId: frame.sessionId })
      return
    }
    if (frame.type === 'session/projection' && frame.key === 'tokenUsage') {
      this.onEvent({ type: 'token-usage', sessionId: frame.sessionId, value: frame.value })
      return
    }
    if (frame.type !== 'session/event') return
    const event = frame.event
    const usage = event?.data?.usage || (event?.data?.chunk?.type === 'usage' ? event.data.chunk.usage : null)
    if (usage) this.onEvent({ type: 'token-usage', sessionId: frame.sessionId, value: usage })
    if (event?.data?.chunk?.type === 'finish') {
      this.onEvent({ type: 'finish', sessionId: frame.sessionId, kind: event.data.chunk.reason })
    }
  }

  async readSessionModel(sessionId) {
    try {
      const models = await this.call('session.models', { sessionId })
      this.onEvent({ type: 'model', sessionId, model: models.current?.model || this.defaultModel })
    } catch {
      if (this.defaultModel) this.onEvent({ type: 'model', sessionId, model: this.defaultModel })
    }
  }

  stop() {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    for (const socket of this.sockets) {
      socket.removeAllListeners?.()
      socket.close()
    }
    this.sockets.clear()
  }
}

module.exports = { PetEventAdapter, normalizeRuntimeUrl }
