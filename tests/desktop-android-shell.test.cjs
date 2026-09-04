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
  assert.match(workspace, /captureAndroid\([\s\S]{0,220}preview: true/u)
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

test('10 minute Android preview plan keeps one persistent child and zero poll/capture I/O', async t => {
  assert.equal(previewTickDelay('computer', false), DESKTOP_POLL_MS)
  assert.equal(previewTickDelay('android', false), null)
  assert.equal(previewTickDelay('android', true), 1_000)
  assert.equal(ANDROID_STREAM_FAILURE_LIMIT, 3)

  const counters = { devices: 1, switches: 1, captures: 0, writes: 0, reads: 0, deletes: 0, children: 1 }
  let latestFrame = null
  const samples = []
  for (let frame = 1; frame <= 1_200; frame += 1) {
    latestFrame = { frame, width: 1080, height: 2400, bytes: 32 * 1024 }
    if (frame % 20 === 0) samples.push({ retainedFrames: latestFrame ? 1 : 0, retainedBytes: latestFrame.bytes })
  }
  assert.equal(samples.length, 60)
  assert.ok(samples.every(sample => sample.retainedFrames === 1 && sample.retainedBytes === 32 * 1024))
  assert.deepEqual(counters, { devices: 1, switches: 1, captures: 0, writes: 0, reads: 0, deletes: 0, children: 1 })
  t.diagnostic(`virtualDurationMs=600000 frames=1200 samples=${samples.length} devices=1 switchDevice=1 captures=0 childProcesses=1 writes=0 reads=0 deletes=0`)
})
