const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { mkdtempSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { SyncTransportManager } = require('../electron/bridge/sync-transport-manager.cjs')
const { WssRelayAdapter } = require('../electron/bridge/sync-transports/wss-relay-adapter.cjs')
const { MobileSyncStore } = require('../electron/store/mobile-sync-store.cjs')

class FakeAdapter extends EventEmitter {
  constructor(id, { available = true, fail = false } = {}) {
    super()
    this.id = id
    this.ready = available
    this.fail = fail
    this.running = false
    this.starts = 0
  }

  available() { return this.ready }
  state() { return { id: this.id, available: this.ready, status: this.running ? 'connected' : this.ready ? 'ready' : 'unavailable' } }
  async start(context) {
    this.starts += 1
    this.context = context
    if (this.fail) throw new Error(`${this.id} unavailable`)
    this.running = true
  }
  async stop() { this.running = false }
  configureRelayUrl(value) {
    this.relayUrl = String(value || '')
    this.ready = Boolean(this.relayUrl)
    return this.state()
  }
  pairingConfig() { return this.running ? { id: this.id, origin: `http://${this.context.mesh.serviceAddress}:${this.context.port}` } : null }
}

function secretAdapter() {
  const transform = value => Buffer.from(value).map(byte => byte ^ 0xa5)
  return {
    protect: plaintext => transform(Buffer.from(String(plaintext), 'utf8')),
    unprotect: ciphertext => transform(Buffer.from(ciphertext)).toString('utf8')
  }
}

function createStore() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-transport-'))
  return new MobileSyncStore(path.join(directory, 'mobile-sync.json'), secretAdapter())
}

async function waitFor(predicate, timeout = 1000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting for transport state')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('auto mode prefers native P2P and flattens its legacy WSS pairing fallback', async t => {
  const store = createStore()
  const native = new FakeAdapter('native-p2p')
  native.pairingConfig = () => native.running ? [
    { id: 'native-p2p', protocolVersion: 1 },
    { id: 'wss-relay', protocolVersion: 1 }
  ] : null
  const relay = new FakeAdapter('wss-relay')
  const easytier = new FakeAdapter('easytier')
  const manager = new SyncTransportManager({ store, adapters: [easytier, relay, native] })
  t.after(() => manager.stop())
  await manager.start({ port: 3081, stateDir: os.tmpdir() })
  assert.equal(manager.state().active, 'native-p2p')
  assert.equal(easytier.starts, 1)
  assert.deepEqual(manager.pairingTransports().map(config => config.id), ['native-p2p', 'wss-relay', 'easytier'])
})

test('remote transport falls back without changing the saved pairing identity', async () => {
  const store = createStore()
  const easytier = new FakeAdapter('easytier')
  const tailscale = new FakeAdapter('tailscale')
  const manager = new SyncTransportManager({ store, adapters: [easytier, tailscale] })
  const first = await manager.start({ port: 3081, stateDir: os.tmpdir() })
  const mesh = store.get().mesh
  assert.equal(first.active, 'easytier')
  assert.equal(manager.pairingTransports()[0].id, 'easytier')

  easytier.emit('disconnect', new Error('network changed'))
  await waitFor(() => manager.state().active === 'tailscale')
  assert.equal(manager.state().status, 'connected')
  assert.deepEqual(store.get().mesh, mesh)
  assert.equal(tailscale.context.mesh.networkSecret, mesh.networkSecret)
})

test('preferred provider is attempted first and unavailable cores degrade safely', async t => {
  const store = createStore()
  store.setTransportPreference('tailscale')
  const easytier = new FakeAdapter('easytier', { available: false })
  const tailscale = new FakeAdapter('tailscale', { fail: true })
  const manager = new SyncTransportManager({ store, adapters: [easytier, tailscale] })
  t.after(() => manager.stop())
  const state = await manager.start({ port: 3081, stateDir: os.tmpdir() })
  assert.equal(tailscale.starts, 1)
  assert.equal(easytier.starts, 0)
  assert.equal(state.status, 'unavailable')
  assert.match(state.error, /tailscale unavailable/)
  assert.equal(manager.state().status, 'reconnecting')
  assert.ok(manager.state().reconnectAt)
})

test('a disconnected sole transport is retried with backoff and recovers', async t => {
  const store = createStore()
  const relay = new FakeAdapter('wss-relay')
  const manager = new SyncTransportManager({
    store,
    adapters: [relay],
    reconnectBaseMs: 5,
    reconnectMaxMs: 10,
    random: () => 0.5
  })
  t.after(() => manager.stop())
  await manager.start({ port: 3081, stateDir: os.tmpdir() })
  relay.fail = true
  relay.emit('disconnect', new Error('network changed'))
  await waitFor(() => manager.state().status === 'reconnecting')
  relay.fail = false
  await waitFor(() => manager.state().active === 'wss-relay')
  assert.equal(manager.state().status, 'connected')
  assert.ok(relay.starts >= 2)
  assert.equal(manager.state().reconnectAt, null)
})

test('disabling during disconnect cleanup cannot restart a fallback transport', async () => {
  const store = createStore()
  const primary = new FakeAdapter('wss-relay')
  const fallback = new FakeAdapter('easytier')
  const manager = new SyncTransportManager({ store, adapters: [primary, fallback] })
  await manager.start({ port: 3081, stateDir: os.tmpdir() })
  assert.equal(manager.state().active, 'wss-relay')

  let stopCalls = 0
  let releaseDisconnectStop
  primary.stop = async () => {
    primary.running = false
    stopCalls += 1
    if (stopCalls === 1) await new Promise(resolve => { releaseDisconnectStop = resolve })
  }
  primary.emit('disconnect', new Error('network changed'))
  await waitFor(() => typeof releaseDisconnectStop === 'function')
  const stopping = manager.stop({ persist: true })
  releaseDisconnectStop()
  await stopping
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(manager.state().status, 'disabled')
  assert.equal(manager.state().active, null)
  assert.equal(fallback.starts, 0)
  assert.equal(fallback.running, false)
})

test('WSS adapter accepts validated runtime configuration only while stopped', () => {
  const adapter = new WssRelayAdapter({ relayUrl: '', WebSocketImpl: class {} })
  assert.equal(adapter.configureRelayUrl('wss://relay.example/').available, true)
  assert.equal(adapter.relayUrl, 'wss://relay.example/')
  assert.equal(adapter.state().relayUrl, 'wss://relay.example/')
  assert.throws(() => adapter.configureRelayUrl('ws://relay.example/'), /wss/)
  adapter.socket = { readyState: 1 }
  assert.throws(() => adapter.configureRelayUrl('wss://other.example/'), /Stop/)
})

test('runtime WSS relay changes preserve mesh identity and clear falls back safely', async t => {
  const store = createStore()
  const relay = new FakeAdapter('wss-relay')
  relay.relayUrl = 'wss://first.example/'
  const easytier = new FakeAdapter('easytier')
  const manager = new SyncTransportManager({ store, adapters: [relay, easytier] })
  t.after(() => manager.stop())
  await manager.start({ port: 3081, stateDir: os.tmpdir() })
  const mesh = store.get().mesh
  assert.equal(manager.state().active, 'wss-relay')

  await manager.configureWssRelay('wss://second.example/')
  assert.equal(manager.state().active, 'wss-relay')
  assert.equal(relay.relayUrl, 'wss://second.example/')
  assert.deepEqual(store.get().mesh, mesh)

  await manager.configureWssRelay('')
  assert.equal(manager.state().active, 'easytier')
  assert.equal(relay.ready, false)
  assert.deepEqual(store.get().mesh, mesh)
})

test('stopping remote sync cancels scheduled reconnects', async () => {
  const store = createStore()
  const relay = new FakeAdapter('wss-relay', { fail: true })
  const manager = new SyncTransportManager({
    store,
    adapters: [relay],
    reconnectBaseMs: 30,
    reconnectMaxMs: 30,
    random: () => 0.5
  })
  await manager.start({ port: 3081, stateDir: os.tmpdir() })
  const starts = relay.starts
  await manager.stop({ persist: true })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(relay.starts, starts)
  assert.equal(manager.state().status, 'disabled')
  assert.equal(manager.state().reconnectAt, null)
})
