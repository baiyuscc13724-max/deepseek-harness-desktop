const test = require('node:test')
const assert = require('node:assert/strict')
const { DesktopDeviceProvider, DESKTOP_TARGET_ID } = require('../electron/bridge/desktop-device-stream.cjs')

function fixture(overrides = {}) {
  let now = 1_700_000_000_000
  const calls = { desktopShots: 0, windowShots: [], clicks: [], windowClicks: [], scrolls: [], types: [], stops: 0, requests: 0 }
  const state = { available: true, ready: true, enabled: true, unlimited: true, generation: 4, authorization: { scope: 'session', unlimited: true, pending: null }, ...overrides.state }
  const computerUse = {
    setUnlimited: value => { calls.unlimited = value },
    capabilities: () => ({ native: { desktopScreenshot: true, screenshot: true, globalInput: true, input: true, windowEnumeration: true } }),
    desktopBounds: () => ({ x: -100, y: 20, width: 200, height: 100 }),
    windows: async () => [{ hwnd: 7, pid: 42, title: 'Demo', width: 80, height: 60, rect: { left: 5, top: 8, right: 85, bottom: 68 } }],
    desktopScreenshot: async () => { calls.desktopShots += 1; return { x: -100, y: 20, width: 200, height: 100, bgra: Buffer.alloc(80_000, 1), blank: false } },
    screenshot: async hwnd => { calls.windowShots.push(hwnd); return { width: 80, height: 60, bgra: Buffer.alloc(19_200, 2), blank: false } },
    globalClick: async value => calls.clicks.push(value),
    click: async (hwnd, value) => calls.windowClicks.push({ hwnd, value }),
    globalScroll: async value => calls.scrolls.push(value),
    scroll: async (hwnd, value) => calls.scrolls.push({ hwnd, ...value }),
    globalType: async value => calls.types.push(value),
    type: async (hwnd, value) => calls.types.push({ hwnd, ...value })
  }
  const provider = new DesktopDeviceProvider({
    computerUse,
    getControlState: () => state,
    requestAuthorization: async () => { calls.requests += 1; return { requested: true } },
    stopControl: async () => { calls.stops += 1; state.enabled = false },
    frameEncoder: async shot => ({ width: shot.width / 2, height: shot.height / 2, data: 'frame' }),
    now: () => now,
    maxFps: 2
  })
  return { provider, calls, state, advance: value => { now += value } }
}

test('provider 复用 Computer Use 授权门并公开设备能力', async () => {
  const { provider, calls, state } = fixture({ state: { enabled: false, unlimited: false, authorization: { scope: 'none' } } })
  assert.equal(provider.status().control.activationRequired, true)
  await assert.rejects(provider.targets(), error => error.code === 'computer-use-authorization-required')
  await assert.rejects(provider.captureFrame(), error => error.code === 'computer-use-authorization-required')
  assert.deepEqual(await provider.authorize(), { requested: true })
  assert.equal(calls.requests, 1)
  state.authorization = { scope: 'session', unlimited: true }
  state.enabled = true
  state.unlimited = true
  assert.equal(provider.status().capability.desktopCapture, true)
})

test('provider 支持完整桌面和窗口目标选择，低帧率拉流复用缓存', async () => {
  const { provider, calls, advance } = fixture()
  const targets = await provider.targets()
  assert.deepEqual(targets.map(target => target.id), [DESKTOP_TARGET_ID, 'window:7'])
  const first = await provider.captureFrame()
  assert.equal(first.width, 100)
  assert.equal(first.height, 50)
  assert.equal(first.reused, false)
  advance(100)
  const cached = await provider.captureFrame()
  assert.equal(cached.sequence, first.sequence)
  assert.equal(cached.reused, true)
  assert.equal(calls.desktopShots, 1)
  advance(500)
  const next = await provider.captureFrame()
  assert.equal(next.sequence, 2)
  assert.equal(calls.desktopShots, 2)
  await provider.selectTarget('window:7')
  const windowFrame = await provider.captureFrame()
  assert.equal(windowFrame.target.kind, 'window')
  assert.deepEqual(calls.windowShots, [7])
})

test('provider 将视觉帧坐标映射到虚拟桌面和窗口输入', async () => {
  const { provider, calls } = fixture()
  await provider.targets()
  await provider.captureFrame()
  await provider.pointer('click', { x: 50, y: 25 })
  assert.deepEqual(calls.clicks, [{ x: 0, y: 70, button: 'left' }])
  await provider.pointer('scroll', { x: 0, y: 0, delta_y: -900 })
  assert.deepEqual(calls.scrolls[0], { x: -100, y: 20, deltaY: -800 })
  await assert.rejects(provider.pointer('click', { x: 100, y: 0 }), error => error.code === 'desktop-coordinate-out-of-bounds')

  await provider.selectTarget('window:7')
  await provider.captureFrame()
  await provider.pointer('click', { x: 20, y: 15, button: 'right' })
  assert.deepEqual(calls.windowClicks, [{ hwnd: 7, value: { x: 40, y: 30, button: 'right' } }])
  await provider.keyboard('hello')
  assert.deepEqual(calls.types.at(-1), { hwnd: 7, text: 'hello' })
})

test('provider stop 复用共享安全停止并清除视觉帧', async () => {
  const { provider, calls } = fixture()
  await provider.targets()
  await provider.captureFrame()
  const stopped = await provider.stop()
  assert.equal(calls.stops, 1)
  assert.equal(stopped.ready, false)
  await assert.rejects(provider.pointer('click', { x: 1, y: 1 }), error => error.code === 'computer-use-disabled')
})
