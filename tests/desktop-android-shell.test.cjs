const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')
const { ANDROID_STREAM_FAILURE_LIMIT, DESKTOP_POLL_MS, binaryFrameBytes, isDesktopFrameTransferFailure, previewTickDelay } = require('../renderer/device-workspace.js')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')

test('Android device view stays inside the native right workspace without a close/reopen handoff', async () => {
  const [main, preload, integration, workspace] = await Promise.all([
    source('electron/main.cjs'),
    source('electron/preload.cjs'),
    source('renderer/right-workspace-integration.js'),
    source('renderer/device-workspace.js')
  ])
  assert.match(main, /ipcMain\.handle\('desktopAndroid:action'/u)
  assert.match(main, /DESKTOP_ANDROID_ROUTES/u)
  assert.match(preload, /desktopAndroidAction/u)
  assert.doesNotMatch(preload, /openAndroidDevicePanel/u)
  assert.doesNotMatch(integration, /openAndroidDevicePanel|android-device/u)
  assert.match(workspace, /activeSource = source/u)
  assert.match(workspace, /desktopAndroidAction/u)
  assert.match(workspace, /switchDevice/u)
  assert.match(workspace, /setAndroidPreview\(switched\.streamUrl, 'stream'\)/u)
  assert.match(workspace, /previewTickDelay\(activeSource, androidLegacyActive\(\)\)/u)
  // Preview payload and stale-response safety are executed against the actual functions below.
  assert.doesNotMatch(workspace, /else if \(androidSerial\) await captureAndroid/u)
  assert.match(workspace, /right-workspace-android-frame/u)
})

test('Android shell bridge validates bounded controls and only local plugin routes', async () => {
  const main = await source('electron/main.cjs')
  for (const route of ['/devices', '/status', '/switch-device', '/capture', '/control', '/device-action']) {
    assert.match(main, new RegExp(`/_dsh/dsh-android${route.replace('/', '\\/')}`))
  }
  assert.match(main, /x < 0 \|\| x > 1 \|\| y < 0 \|\| y > 1/u)
  assert.match(main, /text\.length > 4_000/u)
  assert.match(main, /isLocalRuntimeUrl\(runtimeState\.url\)/u)
  assert.match(main, /http\.request\(url/u)
  assert.match(main, /'sec-fetch-site': 'same-origin'/u)
  assert.match(main, /HARNESS_DESKTOP_ANDROID_LEGACY_CAPTURE_POLL/u)
  assert.match(main, /previewTransport = DESKTOP_ANDROID_LEGACY_CAPTURE_POLL \? 'legacy-capture-poll' : 'persistent-stream'/u)
  assert.match(main, /payload\.preview === true \? \{ purpose: 'preview' \}/u)
  assert.match(main, /action === 'capture'[\s\S]{0,1200}body\.data/u)
})

test('desktop legacy fallback is restricted to explicit transfer failures', () => {
  const backing = new Uint8Array([0, 1, 2, 3])
  const exact = binaryFrameBytes(backing.subarray(1, 3))
  assert.equal(exact.byteLength, 2)
  assert.deepEqual([...new Uint8Array(exact)], [1, 2])
  assert.equal(isDesktopFrameTransferFailure(new Error('An object could not be cloned')), true)
  assert.equal(isDesktopFrameTransferFailure({ code: 'desktop-frame-transfer-failed' }), true)
  assert.equal(isDesktopFrameTransferFailure(new Error('桌面设备返回空白或受保护画面。')), false)
  assert.equal(isDesktopFrameTransferFailure({ code: 'computer-use-disabled' }), false)
})

test('preview safe-GC rollback is one exact default-on flag and never targets evidence or legacy', async () => {
  const [access, support, main] = await Promise.all([
    source('plugins/dsh-android/lib/stream-access.js'),
    source('plugins/dsh-android/lib/tool-support.js'),
    source('electron/main.cjs')
  ])
  assert.match(access, /SCREENSHOT_GC_FLAG = 'HARNESS_DESKTOP_PREVIEW_SAFE_GC'/u)
  assert.match(access, /value !== '0' && value !== 'false' && value !== 'off'/u)
  assert.match(access, /this\.root !== resolve\(previewScreenshotDir\(\)\)/u)
  assert.match(access, /shadowReason: loaded\.missing \? 'index-rebuilt' : 'restart-revalidation'/u)
  assert.match(access, /if \(!enabled\)[\s\S]{0,80}featureDisabled: true/u)
  assert.match(access, /now - observed\.firstSeenAt >= this\.tokenTtlMs \+ this\.safetyMs/u)
  assert.match(access, /verifiedRuntimeId/u)
  assert.match(support, /authoritative: true/u)
  assert.match(support, /Evidence remains authoritative and non-GC/u)
  assert.match(support, /requested === resolve\(join\(tmpdir\(\), 'dsh-android'\)\) \? resolve\(screenshotDir\(\)\)/u)
  assert.match(main, /HARNESS_DESKTOP_ANDROID_LEGACY_CAPTURE_POLL/u)
  assert.match(main, /HARNESS_DESKTOP_DEVICE_LEGACY_FILE_POLL/u)
})

function productionSection(text, start, end) {
  const begin = text.indexOf(start)
  const finish = text.indexOf(end, begin + start.length)
  assert.ok(begin >= 0 && finish > begin, `missing actual production section ${start}`)
  return text.slice(begin, finish)
}

async function androidPreviewFixture() {
  const vm = require('node:vm')
  const text = await source('renderer/device-workspace.js')
  const calls = [], frames = [], timers = []
  const context = vm.createContext({
    androidGeneration: 1, androidSerial: 'fixture-A', androidRequestSerial: 0,
    androidBusy: false, active: true, disposed: false, activeSource: 'android',
    androidTransport: 'stream', androidStreamUrl: 'fixture-stream', legacy: false, timer: 0,
    androidAction: async (action, payload) => { calls.push({ action, payload: { ...payload } }); return { data: 'fixture-frame' } },
    setAndroidPreview: (...args) => frames.push(args), render() {}, showError() {},
    androidLegacyActive: () => context.legacy, previewTickDelay,
    refreshAndroid: async options => calls.push({ action: 'refreshAndroid', options: { ...options } }),
    refreshDesktop: async options => calls.push({ action: 'refreshDesktop', options: { ...options } }),
    window: { clearTimeout() {}, setTimeout(_fn, delay) { timers.push(delay); return timers.length } }
  })
  const current = text.match(/^\s*const currentAndroid =[^\n]+/m)
  assert.ok(current)
  vm.runInContext(current[0] + '\n' +
    productionSection(text, '    async function invokeAndroid(', '    async function refreshDesktop(') +
    productionSection(text, '    async function captureAndroid(', '    async function connectAndroid(') +
    productionSection(text, '    function scheduleTick(', '    function scheduleAndroidReconnect(') +
    productionSection(text, '    async function tick()', '    async function setSource(') +
    ';globalThis.api={captureAndroid,tick}', context)
  return { context, calls, frames, timers }
}

test('actual Android preview capture marks preview purpose and rejects missing, failed and stale replies', async () => {
  const f = await androidPreviewFixture()
  assert.equal(await f.context.api.captureAndroid(), true)
  assert.deepEqual(f.calls, [{ action: 'capture', payload: { device: 'fixture-A', preview: true } }])
  assert.deepEqual(f.frames, [['fixture-frame', 'legacy']])
  for (const condition of ['no-device', 'inactive', 'disposed', 'other-source']) {
    const fresh = await androidPreviewFixture()
    if (condition === 'no-device') fresh.context.androidSerial = ''
    if (condition === 'inactive') fresh.context.active = false
    if (condition === 'disposed') fresh.context.disposed = true
    if (condition === 'other-source') fresh.context.activeSource = 'computer'
    assert.equal(await fresh.context.api.captureAndroid(), false)
    assert.equal(fresh.calls.length, 0)
  }
  for (const change of ['generation', 'device', 'stop', 'empty', 'failure']) {
    const fresh = await androidPreviewFixture()
    let finish, fail
    fresh.context.androidAction = () => new Promise((resolve, reject) => { finish = resolve; fail = reject })
    const pending = fresh.context.api.captureAndroid()
    if (change === 'generation') fresh.context.androidGeneration++
    if (change === 'device') fresh.context.androidSerial = 'fixture-B'
    if (change === 'stop') fresh.context.active = false
    if (change === 'failure') fail(new Error('synthetic capture failure'))
    else finish(change === 'empty' ? {} : { data: 'late-A-frame' })
    assert.equal(await pending, false, change)
    assert.equal(fresh.frames.length, 0, change)
  }
})

test('actual preview tick leaves persistent Android stream unpolled and gates fallback by state', async t => {
  assert.equal(previewTickDelay('computer', false), DESKTOP_POLL_MS)
  assert.equal(previewTickDelay('android', false), null)
  assert.equal(previewTickDelay('android', true), 1_000)
  assert.equal(ANDROID_STREAM_FAILURE_LIMIT, 3)
  const f = await androidPreviewFixture()
  for (let tick = 0; tick < 1_200; tick++) await f.context.api.tick()
  assert.equal(f.calls.length, 0)
  assert.equal(f.timers.length, 0)
  f.context.legacy = true
  await f.context.api.tick()
  assert.deepEqual(f.calls.pop(), { action: 'refreshAndroid', options: { quiet: true } })
  assert.equal(f.timers.pop(), 1_000)
  f.context.legacy = false
  f.context.androidStreamUrl = ''
  await f.context.api.tick()
  assert.deepEqual(f.calls.pop(), { action: 'refreshAndroid', options: { forceStream: true, quiet: true } })
  f.context.activeSource = 'computer'
  await f.context.api.tick()
  assert.deepEqual(f.calls.pop(), { action: 'refreshDesktop', options: { quiet: true } })
  assert.equal(f.timers.pop(), DESKTOP_POLL_MS)
  f.context.active = false
  await f.context.api.tick()
  assert.equal(f.calls.length, 0)
  t.diagnostic('1200 direct production tick calls; not elapsed-time, native child-count, frame-retention or memory evidence')
})
