const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { EventEmitter } = require('node:events')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } = require('node:fs/promises')
const { ensureDesktopAndroidPlugin } = require('../electron/bridge/desktop-android-plugin-service.cjs')

const bundledRoot = path.resolve(__dirname, '..', 'plugins', 'dsh-android')
let moduleNonce = 0

async function withAndroidHome(prefix, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  const prior = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    moduleNonce += 1
    const access = await import(`${pathToFileURL(path.join(bundledRoot, 'lib', 'stream-access.js')).href}?gc-test=${moduleNonce}`)
    await run(root, access)
  } finally {
    if (prior === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prior
    await rm(root, { recursive: true, force: true })
  }
}

async function walk(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await walk(target))
    else if (entry.isFile()) files.push(target)
  }
  return files
}

function deterministicPng(sequence, width = 1080, height = 2400) {
  const png = Buffer.alloc(61)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0)
  png.writeUInt32BE(13, 8)
  png.write('IHDR', 12, 'ascii')
  png.writeUInt32BE(width, 16)
  png.writeUInt32BE(height, 20)
  png[24] = 8
  png[25] = 6
  png.writeUInt32BE(4, 33)
  png.write('tEXt', 37, 'ascii')
  png.writeUInt32BE(sequence, 41)
  png.writeUInt32BE(0, 49)
  png.write('IEND', 53, 'ascii')
  return png
}

function fakePersistentChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.kill = () => { child.exitCode = 0 }
  return child
}

test('adapted Android plugin installs into the scoped DSH Web profile package', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-android-plugin-'))
  try {
    const result = await ensureDesktopAndroidPlugin({ dshHome: root, bundledRoot })
    assert.equal(result.version, '0.1.0-rc.4')
    assert.equal(result.patchChanged, true)
    const profile = path.join(root, 'profiles', 'web')
    const patch = await readFile(path.join(profile, 'cordis.patch.yml'), 'utf8')
    const installed = path.join(profile, 'node_modules', '@zseven-w', 'dsh-android')
    const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'))
    const host = await readFile(path.join(installed, 'lib', 'index.js'), 'utf8')
    const client = await readFile(path.join(installed, 'lib', 'client.js'), 'utf8')
    assert.equal(manifest.name, '@zseven-w/dsh-android')
    assert.match(patch, /id: dsh-android/u)
    assert.match(patch, /name: ["']@zseven-w\/dsh-android["']/u)
    assert.match(host, /android_devices/u)
    assert.match(host, /android_ui_tree/u)
    assert.match(host, /android_logs/u)
    assert.match(client, /openInPanel/u)
    assert.match(client, /data-android-panel/u)
    assert.doesNotMatch(client, /root\.style\.marginRight\s*=\s*dockWidth/u, 'Android panel must overlay the right edge instead of shrinking the conversation workspace')
    const repeated = await ensureDesktopAndroidPlugin({ dshHome: root, bundledRoot })
    assert.equal(repeated.patchChanged, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Android preview stream and explicit screenshot stores are separated by contract', async () => {
  const [routes, accessSource, support, frameSource] = await Promise.all([
    readFile(path.join(bundledRoot, 'lib', 'stream-routes.js'), 'utf8'),
    readFile(path.join(bundledRoot, 'lib', 'stream-access.js'), 'utf8'),
    readFile(path.join(bundledRoot, 'lib', 'tool-support.js'), 'utf8'),
    readFile(path.join(bundledRoot, 'lib', 'frame-source.js'), 'utf8')
  ])
  assert.match(routes, /ANDROID_STREAM_FRAME_RATE = 2/u)
  assert.match(routes, /ANDROID_STREAM_TRANSPORT = 'multipart-latest-frame'/u)
  assert.match(routes, /stream: \{ transport: ANDROID_STREAM_TRANSPORT, frameRate: ANDROID_STREAM_FRAME_RATE, persistent: true \}/u)
  assert.match(routes, /nextCapturePath\(serial, namespace = 'evidence'\)/u)
  assert.match(routes, /value\.purpose === undefined \|\| value\.purpose === 'evidence'/u)
  assert.match(routes, /PREVIEW_CAPTURE_SLOTS = 2/u)
  assert.match(accessSource, /join\(stateRoot\(\), 'evidence', 'screenshots'\)/u)
  assert.match(accessSource, /join\(stateRoot\(\), 'preview', 'screenshots'\)/u)
  assert.match(accessSource, /legacyScreenshotDir/u)
  assert.match(accessSource, /screenshotNamespaceOf/u)
  assert.match(support, /Live preview never writes here/u)
  assert.match(frameSource, /if \(this\.running \|\| this\.#stopped\)[\s\S]{0,40}return/u)
  assert.match(frameSource, /spawnExecOut\(this\.serial, \['while :; do screencap -p; sleep 0\.5; done'\]\)/u)
})

test('600 second Android frame loop fixture keeps one child and one latest frame', async t => {
  const frameModule = await import(pathToFileURL(path.join(bundledRoot, 'lib', 'frame-source.js')).href)
  const child = fakePersistentChild()
  const counters = { childProcesses: 0, fileWrites: 0, fileReads: 0, fileDeletes: 0 }
  const hashes = new Set()
  const samples = []
  const rss = []
  const loop = new frameModule.AdbFrameLoop('emulator-5554', {
    spawnExecOut(serial, command) {
      counters.childProcesses += 1
      assert.equal(serial, 'emulator-5554')
      assert.deepEqual(command, ['while :; do screencap -p; sleep 0.5; done'])
      return child
    }
  }, {
    onFrame(frame) {
      hashes.add(createHash('sha256').update(frame.png).digest('hex'))
      if (frame.sequence % 20 === 0) {
        samples.push({ sequence: frame.sequence, retainedFrames: loop.latestFrame ? 1 : 0, retainedBytes: loop.latestFrame?.png.length || 0 })
        rss.push(process.memoryUsage().rss)
      }
    }
  })
  loop.start()
  loop.start()
  for (let sequence = 1; sequence <= 1_200; sequence += 1) child.stdout.emit('data', deterministicPng(sequence))
  assert.equal(loop.latestFrame.sequence, 1_200)
  assert.equal(loop.latestFrame.width, 1080)
  assert.equal(loop.latestFrame.height, 2400)
  assert.equal(counters.childProcesses, 1)
  assert.equal(counters.fileWrites, 0)
  assert.equal(counters.fileReads, 0)
  assert.equal(counters.fileDeletes, 0)
  assert.equal(samples.length, 60)
  assert.ok(samples.every(sample => sample.retainedFrames === 1 && sample.retainedBytes === 61))
  assert.equal(hashes.size, 1_200)
  const rssDrift = Math.max(...rss) - Math.min(...rss)
  assert.ok(rssDrift < 64 * 1024 * 1024, `RSS drift unexpectedly high: ${rssDrift}`)
  loop.stop()
  t.diagnostic(`virtualDurationMs=600000 frames=1200 samples=${samples.length} hashes=${hashes.size} childProcesses=1 writes=0 reads=0 deletes=0 retainedFrames=1 rssDrift=${rssDrift}`)
})

test('Android preview GC is staged, flag-gated, and restores every late reference from isolated fixtures', { concurrency: false }, () => withAndroidHome('android-preview-gc-', async (_root, access) => {
  assert.equal(access.SCREENSHOT_GC_FLAG, 'HARNESS_DESKTOP_PREVIEW_SAFE_GC')
  assert.equal(access.screenshotGcEnabled({}), true)
  for (const value of ['0', 'false', 'off', 'OFF']) assert.equal(access.screenshotGcEnabled({ HARNESS_DESKTOP_PREVIEW_SAFE_GC: value }), false)

  let now = 1700000000000
  let enabled = true
  const preview = access.previewScreenshotDir()
  await mkdir(preview, { recursive: true })
  for (let index = 0; index < 4; index += 1) await writeFile(path.join(preview, `preview-device-${index}.png`), Buffer.from(`frame-${index}`))
  const gc = new access.AndroidPreviewScreenshotGc({ now: () => now, enabled: () => enabled, runtimeId: 'android-a', maxFiles: 1, tokenTtlMs: 1, safetyMs: 1, quarantineDelayMs: 5 })
  const shadow = await gc.collect()
  assert.equal(shadow.shadowReason, 'index-rebuilt')
  assert.equal((await readdir(preview)).length, 4)
  now += 3
  const moved = await gc.collect()
  assert.equal(moved.quarantinedFiles, 3)
  const quarantineRoot = access.previewQuarantineDir()
  let held = (await readdir(quarantineRoot)).filter(name => name.endsWith('.quarantine'))
  assert.equal(held.length, 3)

  enabled = false
  now += 100
  assert.equal((await gc.collect()).featureDisabled, true)
  assert.equal((await readdir(quarantineRoot)).filter(name => name.endsWith('.quarantine')).length, 3)
  const restoreNames = held.slice(0, 2).map(name => name.replace(/\.\d{13}\.quarantine$/, ''))
  for (let index = 0; index < restoreNames.length; index += 1) {
    const original = path.join(preview, restoreNames[index])
    await gc.recordReference(original, { kind: 'history', id: `late-${index}` }, { now })
    assert.ok(await gc.readablePath(original))
  }
  assert.equal((await gc.collect()).featureDisabled, true)
  assert.equal((await readdir(preview)).length, 1, 'feature-off performs no restore')

  enabled = true
  const verified = await gc.collect()
  assert.equal(verified.deletedFiles, 1, 'only the already-verified unreferenced item may delete on a later pass')
  assert.equal(verified.restoredFiles, 0)
  const restored = await gc.collect()
  assert.equal(restored.restoredFiles, 2)
  assert.equal((await readdir(preview)).filter(name => name.endsWith('.png')).length, 3)
  assert.deepEqual((await readdir(quarantineRoot)).filter(name => name.endsWith('.quarantine')), [])
}))

test('Android token expiry, restart, rollback, corruption, and scan budgets fail closed', { concurrency: false }, () => withAndroidHome('android-preview-token-', async (root, access) => {
  let now = 1700000000000
  const preview = access.previewScreenshotDir()
  await mkdir(preview, { recursive: true })
  const older = path.join(preview, 'preview-token-old.png')
  await writeFile(older, Buffer.from('old-token-frame'))
  await writeFile(path.join(preview, 'preview-token-new.png'), Buffer.from('new-frame'))
  const gc = new access.AndroidPreviewScreenshotGc({ now: () => now, runtimeId: 'token-boot', maxFiles: 1, tokenTtlMs: 10, safetyMs: 10, quarantineDelayMs: 100 })
  await assert.rejects(() => gc.recordReference(older, { kind: 'unknown', id: 'bad' }, { now }), /unknown screenshot reference kind/)
  await gc.rebuild([], { now })
  const controller = new access.StreamAccessController(async () => Buffer.alloc(32, 7), { screenshotGc: gc, now: () => now })
  const first = await controller.signScreenshotToken(older, { ttlMs: 10 })
  assert.equal(first.expiresAt, now + 10)
  now += 19
  assert.equal((await gc.collect()).quarantinedFiles, 0)
  await controller.signScreenshotToken(older, { ttlMs: 10 })
  now += 19
  assert.equal((await gc.collect()).quarantinedFiles, 0, 'renewal extends expiry plus safety')
  now += 1
  assert.equal((await gc.collect()).quarantinedFiles, 1)
  assert.equal((await access.openVerifiedScreenshot(older)).bytes.toString(), 'old-token-frame')
  await controller.signScreenshotToken(older, { ttlMs: 10 })
  const heldTokenFile = (await readdir(access.previewQuarantineDir())).find(name => name.endsWith('.quarantine'))
  await unlink(path.join(access.previewQuarantineDir(), heldTokenFile))
  const dangling = await gc.collect()
  assert.equal(dangling.referenceViewInvalid, true)
  assert.equal(dangling.danglingTokens, 1)

  await rm(path.join(root, 'cache', 'dsh-android'), { recursive: true, force: true })
  await mkdir(preview, { recursive: true })
  await writeFile(path.join(preview, 'restart-old.png'), 'old')
  await writeFile(path.join(preview, 'restart-new.png'), 'new')
  now = 1700000100000
  const bootA = new access.AndroidPreviewScreenshotGc({ now: () => now, runtimeId: 'boot-a', maxFiles: 1, tokenTtlMs: 10, safetyMs: 10 })
  await bootA.rebuild([], { now })
  now += 100
  const bootB = new access.AndroidPreviewScreenshotGc({ now: () => now, runtimeId: 'boot-b', maxFiles: 1, tokenTtlMs: 10, safetyMs: 10 })
  assert.equal((await bootB.collect()).shadowReason, 'restart-revalidation')
  now += 19
  assert.equal((await bootB.collect()).quarantinedFiles, 0)
  now += 1
  assert.equal((await bootB.collect()).quarantinedFiles, 1)
  now += 100
  const bootC = new access.AndroidPreviewScreenshotGc({ now: () => now, runtimeId: 'boot-c', maxFiles: 1, tokenTtlMs: 10, safetyMs: 10 })
  assert.equal((await bootC.collect()).shadowReason, 'restart-revalidation')
  const restartedIndex = JSON.parse(await readFile(access.screenshotReferenceIndexPath(), 'utf8'))
  const restartedQuarantinePath = path.join(preview, Object.keys(restartedIndex.quarantine)[0])
  assert.ok(Object.values(restartedIndex.quarantine)[0].safeDeleteAfter >= now + 20)
  now += 19
  assert.equal((await bootC.collect()).deletedFiles, 0, 'quarantine files receive the same full restart hold')
  const beforeRollback = (await readdir(access.previewQuarantineDir())).sort()
  now -= 1
  assert.equal((await bootC.collect()).clockRollback, true)
  assert.equal((await bootC.recordReference(restartedQuarantinePath, { kind: 'history', id: 'rollback-ref' }, { now })).clockRollback, true)
  assert.deepEqual((await readdir(access.previewQuarantineDir())).sort(), beforeRollback)

  await writeFile(access.screenshotReferenceIndexPath(), '{broken')
  assert.equal((await bootC.collect()).indexInvalid, true)
  assert.deepEqual((await readdir(access.previewQuarantineDir())).sort(), beforeRollback)
  const blockedController = new access.StreamAccessController(async () => Buffer.alloc(32, 8), { screenshotGc: bootC, now: () => now })
  const remainingPreview = path.join(preview, (await readdir(preview)).find(name => name.endsWith('.png')))
  await assert.rejects(() => blockedController.signScreenshotToken(remainingPreview), /strict reference index/)
  await unlink(access.screenshotReferenceIndexPath())
  assert.equal((await bootC.collect()).shadowReason, 'index-rebuilt')

  await rm(path.join(root, 'cache', 'dsh-android'), { recursive: true, force: true })
  await mkdir(preview, { recursive: true })
  await writeFile(path.join(preview, 'budget-a.png'), 'a')
  await writeFile(path.join(preview, 'budget-b.png'), 'b')
  const bounded = new access.AndroidPreviewScreenshotGc({ now: () => now, runtimeId: 'budget', maxFiles: 1, tokenTtlMs: 1, safetyMs: 1, scanMaxEntries: 1 })
  assert.equal((await bounded.collect()).scanBudgetExceeded, true)
  assert.equal((await readdir(preview)).length, 2)
  assert.throws(() => new access.AndroidPreviewScreenshotGc({ root: access.screenshotDir() }), /normalized preview namespace/)
}))

test('Android explicit screenshot evidence has a strict recomputable authoritative index and is never GC input', { concurrency: false }, () => withAndroidHome('android-evidence-index-', async (_root, access) => {
  moduleNonce += 1
  const support = await import(`${pathToFileURL(path.join(bundledRoot, 'lib', 'tool-support.js')).href}?evidence-test=${moduleNonce}`)
  assert.equal(new support.ScreenshotStore(path.join(os.tmpdir(), 'dsh-android')).root, access.screenshotDir(), 'legacy default is redirected without scanning or mutating it')
  const store = new support.ScreenshotStore(access.screenshotDir())
  const host = { screenshot: async () => ({ png: deterministicPng(1), width: 1080, height: 2400 }) }
  const device = { serial: 'fixture-device' }
  const summary = { serial: 'fixture-device', name: 'Fixture', androidVersion: '14', state: 'device' }
  const first = await support.captureScreenshot(host, store, 'android_screenshot', device, summary, undefined)
  let status = store.referenceStatus()
  assert.equal(status.authoritative, true)
  assert.equal(status.files, 1)
  assert.equal(status.references, 1)
  assert.equal(status.danglingReferences, 0)

  const rebuilt = store.rebuildReferenceIndex([{ path: first.path, kind: 'history', id: 'history-card-1' }])
  assert.deepEqual({ references: rebuilt.references, dangling: rebuilt.danglingReferences }, { references: 1, dangling: 0 })
  assert.throws(() => store.rebuildReferenceIndex([{ path: path.join(access.screenshotDir(), 'screenshot-missing-99.png'), kind: 'history', id: 'missing' }]), /dangling evidence reference/)

  await writeFile(path.join(path.dirname(access.screenshotDir()), 'reference-index.json'), '{broken')
  await support.captureScreenshot(host, store, 'android_screenshot', device, summary, undefined)
  assert.equal((await readdir(access.screenshotDir())).filter(name => name.endsWith('.png')).length, 2, 'corrupt index cannot delete or block authoritative evidence')
  const gc = new access.AndroidPreviewScreenshotGc({ runtimeId: 'evidence-fence' })
  await gc.collect()
  assert.equal((await readdir(access.screenshotDir())).filter(name => name.endsWith('.png')).length, 2)
}))

test('bundled Android source preserves the adapted package without heavy Android runtimes', async () => {
  const manifest = JSON.parse(await readFile(path.join(bundledRoot, 'package.json'), 'utf8'))
  const license = await readFile(path.join(bundledRoot, 'LICENSE'), 'utf8')
  const notices = await readFile(path.join(bundledRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  assert.equal(manifest.name, '@zseven-w/dsh-android')
  assert.equal(manifest.version, '0.1.0-rc.4')
  assert.match(String(manifest.repository?.url), /ZSeven-W\/dsh-android/u)
  assert.match(license, /MIT License/u)
  assert.ok(notices.length > 100)

  const files = await walk(bundledRoot)
  const forbidden = /(?:^|[\\/])(?:platforms?|system-images?|avd|sdk|jre|jdk)(?:[\\/]|$)|\.(?:img|iso|qcow2|vdi|vmdk)$|(?:^|[\\/])(?:adb|emulator|qemu-system[^\\/]*)\.exe$/iu
  assert.deepEqual(files.filter(file => forbidden.test(file)), [])
  const bytes = (await Promise.all(files.map(file => stat(file)))).reduce((sum, value) => sum + value.size, 0)
  assert.ok(bytes < 4 * 1024 * 1024, `adapted plugin source unexpectedly grew to ${bytes} bytes`)
})
