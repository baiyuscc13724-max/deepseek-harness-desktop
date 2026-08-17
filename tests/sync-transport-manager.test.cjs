const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { mkdtempSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { SyncTransportManager } = require('../electron/bridge/sync-transport-manager.cjs')
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
  pairingConfig() { return this.running ? { id: this.id, origin: `http://10.254.77.${this.id === 'easytier' ? 1 : 2}:${this.context.port}` } : null }
}

function createStore() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-transport-'))
  return new MobileSyncStore(path.join(directory, 'mobile-sync.json'))
}

async function waitFor(predicate, timeout = 1000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting for transport state')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

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

test('preferred provider is attempted first and unavailable cores degrade safely', async () => {
  const store = createStore()
  store.setTransportPreference('tailscale')
  const easytier = new FakeAdapter('easytier', { available: false })
  const tailscale = new FakeAdapter('tailscale', { fail: true })
  const manager = new SyncTransportManager({ store, adapters: [easytier, tailscale] })
  const state = await manager.start({ port: 3081, stateDir: os.tmpdir() })
  assert.equal(tailscale.starts, 1)
  assert.equal(easytier.starts, 0)
  assert.equal(state.status, 'unavailable')
  assert.match(state.error, /tailscale unavailable/)
})
