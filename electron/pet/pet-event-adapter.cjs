const { randomUUID } = require('node:crypto')
const WebSocket = require('ws')
const { runtimeWebSocketOptions } = require('../bridge/runtime-session-auth.cjs')

const PET_UNARY_ENDPOINTS = new Set(['$events/result', 'session/list', 'session/modelCatalog'])
const PET_EVENT_ALLOWLIST = new Set([
  'api-session/activity',
  'api-session/added',
  'api-session/error',
  'api-session/removed',
  'api-session/status',
  'approval/request',
  'user-questions/request'
])

function normalizeRuntimeUrl(value) {
  const target = new URL(value)
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('宠物事件适配器只允许连接本机 Harness runtime。')
  target.pathname = '/'
  target.search = ''
  target.hash = ''
  return target
}

function selectedModel(item, fallback = '') {
  const projection = item?.projections?.values?.modelSelection
  return projection?.next?.model || projection?.lastUsed?.model || fallback
}

class PetEventAdapter {
  constructor({ fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket, cookieProvider = async () => '', onEvent = () => {}, onDiagnostic = () => {} } = {}) {
    if (typeof cookieProvider !== 'function') throw new Error('PetEventAdapter requires cookieProvider for runtime authentication.')
    this.fetchImpl = fetchImpl
    this.WebSocketImpl = WebSocketImpl
    this.cookieProvider = cookieProvider
    this.onEvent = onEvent
    this.onDiagnostic = onDiagnostic
    this.baseUrl = null
    this.socket = null
    this.reconnectTimer = null
    this.stopped = true
    this.defaultModel = ''
    this.eventClientId = ''
    this.eventStreamId = ''
    this.controlStreamId = ''
  }

  async call(method, payload) {
    if (!PET_UNARY_ENDPOINTS.has(method)) throw new Error('宠物事件适配器拒绝未知 runtime endpoint。')
    const rpcId = randomUUID()
    const response = await this.fetchImpl(new URL(`/api/${method}`, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload })
    })
    if (!response.ok) throw new Error(`${method} HTTP ${response.status}`)
    const envelope = await response.json()
    if (envelope?.type !== 'server-response' || envelope.rpcId !== rpcId) throw new Error(`${method} rpcId 不匹配`)
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
    await this.openStreams()
  }

  async refreshBaseline() {
    const [catalog, sessions] = await Promise.all([
      this.call('session/modelCatalog', { args: {} }),
      this.call('session/list', { args: { _request: {} } })
    ])
    this.defaultModel = catalog?.default?.model || ''
    if (!Array.isArray(sessions?.items)) throw new Error('session/list baseline invalid')
    for (const item of sessions.items) {
      this.onEvent({
        type: 'baseline',
        sessionId: item.sessionId,
        parentSessionId: item.parentSessionId,
        running: item.running,
        updatedAt: item.updatedAt,
        tokenUsage: item.projections?.values?.tokenUsage,
        model: selectedModel(item, this.defaultModel)
      })
    }
  }

  async openStreams() {
    if (this.stopped) return
    const baseUrl = this.baseUrl
    const cookieHeader = await this.cookieProvider(baseUrl.origin)
    if (this.stopped || this.baseUrl !== baseUrl) return
    const url = new URL('/api/remote.mux', baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new this.WebSocketImpl(url.toString(), runtimeWebSocketOptions(cookieHeader))
    this.socket = socket
    this.eventClientId = ''
    this.eventStreamId = `events-${randomUUID()}`
    this.controlStreamId = `control-${randomUUID()}`
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'open', streamId: this.eventStreamId, endpoint: '$events', payload: { args: {} } }))
      socket.send(JSON.stringify({ type: 'open', streamId: this.controlStreamId, endpoint: 'session/control', payload: { args: {} } }))
    })
    socket.on('message', raw => this.handleStreamMessage(raw))
    socket.on('error', error => this.onDiagnostic(`/api/remote.mux 连接错误：${error.message}`))
    socket.on('close', () => { if (this.socket === socket) this.socket = null; this.scheduleReconnect() })
  }

  handleStreamMessage(raw) {
    let frame
    try { frame = JSON.parse(String(raw)) } catch (error) { this.onDiagnostic(`丢弃无法解析的 /api/remote.mux 事件：${error.message}`); return }
    if (frame?.type !== 'item' || typeof frame.streamId !== 'string') return
    if (frame.streamId === this.eventStreamId) this.handleRemoteEvent(frame.value)
    else if (frame.streamId === this.controlStreamId) this.handleControlFrame(frame.value)
  }

  handleRemoteEvent(frame) {
    if (frame?.type === 'ready' && typeof frame.clientId === 'string' && frame.clientId) { this.eventClientId = frame.clientId; return }
    if (!PET_EVENT_ALLOWLIST.has(frame?.event)) return
    if (frame.type === 'waterfall') {
      this.onEvent({ type: 'needs-input', sessionId: frame.agentId })
      if (this.eventClientId && typeof frame.eventId === 'string' && frame.eventId) void this.call('$events/result', { args: { clientId: this.eventClientId, eventId: frame.eventId, outcome: { kind: 'next' } } }).catch(error => this.onDiagnostic(`waterfall 旁路失败：${error.message}`))
      return
    }
    if (frame.type !== 'emit' || !Array.isArray(frame.args)) return
    const value = frame.args[0] || {}
    if (frame.event === 'api-session/added') this.onEvent({ type: 'session-added', sessionId: value.sessionId })
    else if (frame.event === 'api-session/removed') this.onEvent({ type: 'session-removed', sessionId: value.sessionId })
    else if (frame.event === 'api-session/status') this.onEvent({ type: 'session-status', sessionId: value.sessionId, running: value.running })
    else if (frame.event === 'api-session/error') this.onEvent({ type: 'agent-error', sessionId: value.sessionId })
  }

  handleControlFrame(frame) {
    if (frame?.type === 'baseline') {
      for (const [sessionId, projection] of Object.entries(frame.value?.projections || {})) this.emitProjection(sessionId, 'modelSelection', projection?.values?.modelSelection)
      return
    }
    if (frame?.type === 'projection') this.emitProjection(frame.sessionId, frame.key, frame.value)
  }

  emitProjection(sessionId, key, value) {
    if (key === 'tokenUsage') this.onEvent({ type: 'token-usage', sessionId, value })
    else if (key === 'modelSelection') this.onEvent({ type: 'model', sessionId, model: value?.next?.model || value?.lastUsed?.model || this.defaultModel })
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (this.stopped) return
      try { await this.refreshBaseline(); await this.openStreams() }
      catch (error) { this.onDiagnostic(`宠物事件重新连接失败：${error.message}`); this.scheduleReconnect() }
    }, 1500)
    this.reconnectTimer.unref?.()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    socket?.removeAllListeners?.()
    socket?.close()
  }
}

module.exports = { PET_EVENT_ALLOWLIST, PetEventAdapter, normalizeRuntimeUrl, selectedModel }
