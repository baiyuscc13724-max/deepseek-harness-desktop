const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { MobileSyncStore, normalizeState, DEFAULT_SERVICE_ADDRESS } = require('../electron/store/mobile-sync-store.cjs')

test('MobileSyncStore persists only safe pairing records', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-store-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file)
  store.setEnabled(true)
  store.setRemoteEnabled(false)
  store.setTransportPreference('tailscale')
  store.setPreferredPort(4567)
  const mesh = store.ensureMesh(() => ({
    networkName: 'harness-0123456789abcdef',
    networkSecret: 'a'.repeat(43),
    desktopAddress: '10.254.77.1',
    serviceAddress: DEFAULT_SERVICE_ADDRESS
  }))
  store.addDevice({
    id: '0123456789abcdef',
    secretHash: 'a'.repeat(64),
    name: ' Pixel 9\u0000 ',
    createdAt: '2026-08-17T01:02:03.000Z',
    lastSeenAt: null
  })
  const restored = new MobileSyncStore(file).get()
  assert.equal(restored.enabled, true)
  assert.equal(restored.remoteEnabled, false)
  assert.equal(restored.transportPreference, 'tailscale')
  assert.equal(restored.preferredPort, 4567)
  assert.deepEqual(restored.mesh, mesh)
  assert.deepEqual(restored.devices[0], {
    id: '0123456789abcdef',
    secretHash: 'a'.repeat(64),
    name: 'Pixel 9',
    createdAt: '2026-08-17T01:02:03.000Z',
    lastSeenAt: null
  })
})

test('normalizeState migrates the legacy mapped service address out of the node subnet', () => {
  const state = normalizeState({
    mesh: {
      networkName: 'harness-0123456789abcdef',
      networkSecret: 'a'.repeat(43),
      desktopAddress: '10.254.77.1',
      serviceAddress: '10.254.77.254'
    }
  })
  assert.equal(state.mesh.serviceAddress, DEFAULT_SERVICE_ADDRESS)
})

test('normalizeState drops malformed secrets and invalid ports', () => {
  const state = normalizeState({
    enabled: 1,
    preferredPort: 80,
    devices: [
      { id: '../../escape', secretHash: 'bad' },
      { id: 'fedcba9876543210', secretHash: 'b'.repeat(64), name: 'OK' }
    ]
  })
  assert.equal(state.enabled, false)
  assert.equal(state.preferredPort, 3081)
  assert.equal(state.devices.length, 1)
  assert.equal(state.devices[0].name, 'OK')
  assert.equal(state.remoteEnabled, true)
  assert.equal(state.transportPreference, 'auto')
})
