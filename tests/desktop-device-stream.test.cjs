const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { deflateSync } = require('node:zlib')
const { DesktopDeviceProvider, DESKTOP_TARGET_ID } = require('../electron/bridge/desktop-device-stream.cjs')

function fixture(overrides = {}) {
  let now = 1_700_000_000_000
  const calls = {
    desktopShots: 0,
    windowShots: [],
    clicks: [],
    windowClicks: [],
    scrolls: [],
    types: [],
    stops: 0,
    requests: 0,
    previewWrites: 0,
    evidenceWrites: 0,
    fileReads: 0,
    fileDeletes: 0,
    childProcesses: 0
  }
  const state = { available: true, ready: true, enabled: true, unlimited: true, generation: 4, authorization: { scope: 'session', unlimited: true, pending: null }, ...overrides.state }
  const computerUse = {
    setUnlimited: value => { calls.unlimited = value },
    capabilities: () => ({ native: { desktopScreenshot: true, screenshot: true, globalInput: true, input: true, windowEnumeration: true } }),
    desktopBounds: () => ({ x: -100, y: 20, width: 200, height: 100 }),
    windows: async () => [{ hwnd: 7, pid: 42, title: 'Demo', width: 80, height: 60, rect: { left: 5, top: 8, right: 85, bottom: 68 } }],
    desktopScreenshot: async () => {
      calls.desktopShots += 1
      return overrides.desktopShot?.(calls.desktopShots) || { x: -100, y: 20, width: 200, height: 100, bgra: Buffer.alloc(80_000, 1), blank: false }
    },
    screenshot: async hwnd => { calls.windowShots.push(hwnd); return { width: 80, height: 60, bgra: Buffer.alloc(19_200, 2), blank: false } },
    globalClick: async value => calls.clicks.push(value),
    click: async (hwnd, value) => calls.windowClicks.push({ hwnd, value }),
    globalScroll: async value => calls.scrolls.push(value),
    scroll: async (hwnd, value) => calls.scrolls.push({ hwnd, ...value }),
    globalType: async value => calls.types.push(value),
    type: async (hwnd, value) => calls.types.push({ hwnd, ...value })
  }
  const previewStore = { save: async () => `preview-${++calls.previewWrites}.png` }
  const evidenceStore = { save: async () => `evidence-${++calls.evidenceWrites}.png` }
  const provider = new DesktopDeviceProvider({
    computerUse,
    getControlState: () => state,
    requestAuthorization: async () => { calls.requests += 1; return { requested: true } },
    stopControl: async () => { calls.stops += 1; state.enabled = false },
    frameEncoder: overrides.frameEncoder || (async shot => ({ width: shot.width / 2, height: shot.height / 2, png: Buffer.alloc(4096, calls.desktopShots & 0xff) })),
    previewStore,
    evidenceStore,
    now: () => now,
    maxFps: 2
  })
  return { provider, calls, state, advance: value => { now += value }, now: () => now }
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
  const first = await provider.captureFrame({ delivery: 'buffer' })
  assert.equal(first.width, 100)
  assert.equal(first.height, 50)
  assert.equal(first.sourceWidth, 200)
  assert.equal(first.sourceHeight, 100)
  assert.equal(first.coordinateSpace, 'desktop-device-frame-pixels')
  assert.ok(Buffer.isBuffer(first.bytes))
  assert.equal(first.file, undefined)
  assert.equal(first.reused, false)
  advance(100)
  const cached = await provider.captureFrame({ delivery: 'buffer' })
  assert.equal(cached.sequence, first.sequence)
  assert.equal(cached.reused, true)
  assert.equal(calls.desktopShots, 1)
  advance(500)
  const next = await provider.captureFrame()
  assert.equal(next.sequence, 2)
  assert.equal(calls.desktopShots, 2)
  assert.equal(calls.previewWrites, 0)
  assert.equal(calls.evidenceWrites, 0)
  assert.deepEqual(provider.status().previewBuffer, { retainedFrames: 1, retainedBytes: 4096, maxFrames: 1, maxBytes: 12 * 1024 * 1024, transport: 'latest-frame-buffer' })
  await provider.selectTarget('window:7')
  const windowFrame = await provider.captureFrame()
  assert.equal(windowFrame.target.kind, 'window')
  assert.deepEqual(calls.windowShots, [7])
})

test('preview 和 evidence 写入严格分域且只在显式 delivery 时落盘', async () => {
  const { provider, calls } = fixture()
  await provider.targets()
  const live = await provider.captureFrame({ delivery: 'buffer' })
  assert.ok(Buffer.isBuffer(live.bytes))
  assert.equal(calls.previewWrites, 0)
  assert.equal(calls.evidenceWrites, 0)
  const preview = await provider.captureFrame({ delivery: 'preview-file' })
  assert.equal(preview.namespace, 'preview')
  assert.equal(preview.file, 'preview-1.png')
  const samePreview = await provider.captureFrame({ delivery: 'preview-file' })
  assert.equal(samePreview.file, preview.file)
  assert.equal(calls.previewWrites, 1)
  const evidence = await provider.captureFrame({ delivery: 'evidence-file' })
  assert.equal(evidence.namespace, 'evidence')
  assert.equal(evidence.file, 'evidence-1.png')
  assert.equal(calls.evidenceWrites, 1)
  assert.equal(live.data, undefined)
})

test('600 秒等价 2fps 预览只保留 latest frame 且文件/子进程 I/O 为零', async t => {
  const { provider, calls, advance, now } = fixture()
  await provider.targets()
  const samples = []
  const hashes = new Set()
  let previousAt = null
  for (let index = 0; index < 1_200; index += 1) {
    const next = await provider.captureFrame({ delivery: 'buffer' })
    assert.equal(next.width, 100)
    assert.equal(next.height, 50)
    assert.equal(next.sourceWidth, 200)
    assert.equal(next.sourceHeight, 100)
    if (previousAt !== null) assert.equal(Date.parse(next.capturedAt) - previousAt, 500)
    previousAt = Date.parse(next.capturedAt)
    hashes.add(createHash('sha256').update(next.bytes).digest('hex'))
    if (index % 20 === 0) samples.push({ virtualAt: now(), ...provider.status().previewBuffer })
    advance(500)
  }
  assert.equal(calls.desktopShots, 1_200)
  assert.equal(calls.previewWrites, 0)
  assert.equal(calls.evidenceWrites, 0)
  assert.equal(calls.fileReads, 0)
  assert.equal(calls.fileDeletes, 0)
  assert.equal(calls.childProcesses, 0)
  assert.equal(samples.length, 60)
  assert.ok(samples.every(sample => sample.retainedFrames === 1 && sample.retainedBytes === 4096))
  assert.ok(hashes.size >= 30)
  assert.equal(now(), 1_700_000_600_000)
  t.diagnostic(`virtualDurationMs=600000 frames=1200 samples=${samples.length} hashes=${hashes.size} previewWrites=0 previewReads=0 previewDeletes=0 retainedFrames=1 retainedBytes=4096`)
})

test('32 样本 1280x720 编码/坐标 microbench 保持有界 RSS 与映射', async t => {
  const pixels = Buffer.alloc(1280 * 720 * 4, 7)
  const { provider, calls, advance } = fixture({
    desktopShot: sequence => {
      pixels[0] = sequence & 0xff
      return { x: -100, y: 20, width: 1280, height: 720, bgra: pixels, blank: false }
    },
    frameEncoder: async shot => ({ width: 1280, height: 720, png: Buffer.concat([Buffer.from('PNG'), deflateSync(shot.bgra, { level: 1 })]) })
  })
  await provider.targets()
  const rss = []
  const hashes = new Set()
  for (let index = 0; index < 32; index += 1) {
    const frame = await provider.captureFrame({ delivery: 'buffer' })
    assert.equal(frame.width, 1280)
    assert.equal(frame.height, 720)
    hashes.add(createHash('sha256').update(frame.bytes).digest('hex'))
    await provider.pointer('click', { x: 640, y: 360 })
    rss.push(process.memoryUsage().rss)
    advance(500)
  }
  const rssDrift = Math.max(...rss) - Math.min(...rss)
  assert.equal(rss.length, 32)
  assert.ok(hashes.size >= 30)
  assert.equal(calls.clicks.length, 32)
  assert.equal(calls.previewWrites, 0)
  assert.equal(calls.evidenceWrites, 0)
  assert.equal(provider.status().previewBuffer.retainedFrames, 1)
  assert.ok(rssDrift < 128 * 1024 * 1024, `RSS drift unexpectedly high: ${rssDrift}`)
  t.diagnostic(`samples=${rss.length} resolution=1280x720 hashes=${hashes.size} rssMin=${Math.min(...rss)} rssMax=${Math.max(...rss)} rssDrift=${rssDrift}`)
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

test('Stop/revoke generation change fences an in-flight frame before fallback or retention', async () => {
  let releaseEncoder
  let encoderStarted
  const started = new Promise(resolve => { encoderStarted = resolve })
  const encoded = new Promise(resolve => { releaseEncoder = resolve })
  const { provider, calls, state } = fixture({
    frameEncoder: async () => {
      encoderStarted()
      return encoded
    }
  })
  await provider.targets()
  const pending = provider.captureFrame({ delivery: 'preview-file' })
  await started
  state.enabled = false
  state.generation += 1
  releaseEncoder({ width: 100, height: 50, png: Buffer.alloc(4096, 4) })
  await assert.rejects(pending, error => error.code === 'computer-use-disabled')
  assert.equal(calls.previewWrites, 0)
  assert.equal(provider.status().previewBuffer.retainedFrames, 0)
})

test('provider stop 复用共享安全停止并清除视觉帧', async () => {
  const { provider, calls } = fixture()
  await provider.targets()
  await provider.captureFrame()
  const stopped = await provider.stop()
  assert.equal(calls.stops, 1)
  assert.equal(stopped.ready, false)
  assert.equal(stopped.previewBuffer.retainedFrames, 0)
  assert.equal(stopped.previewBuffer.retainedBytes, 0)
  await assert.rejects(provider.pointer('click', { x: 1, y: 1 }), error => error.code === 'computer-use-disabled')
})
