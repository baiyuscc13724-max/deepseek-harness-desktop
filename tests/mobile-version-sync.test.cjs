const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { readFile } = require('node:fs/promises')
const { readAndroidMobileVersion } = require('../scripts/mobile-release-version.cjs')
const { MobileSyncStore, SYNC_EVENT_LIMIT } = require('../electron/store/mobile-sync-store.cjs')

const root = path.resolve(__dirname, '..')

test('Android and iOS stay unified with the desktop release while keeping platform-compatible build codes', async () => {
  const [pkg, manifest, androidBuild, iosProject] = await Promise.all([
    readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'mobile', 'mobile-app-update.example.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'mobile', 'android', 'app', 'build.gradle.kts'), 'utf8'),
    readFile(path.join(root, 'mobile', 'ios', 'project.yml'), 'utf8')
  ])
  const androidVersion = readAndroidMobileVersion(root)
  const [major, minor, patch] = pkg.version.split('.').map(Number)
  const iosBuild = major * 10000 + minor * 100 + patch

  assert.equal(androidVersion.integrationVersion, pkg.version)
  assert.equal(androidVersion.versionName, pkg.version)
  assert.equal(manifest.platforms.android.version, pkg.version)
  assert.equal(manifest.platforms.android.url, `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v${pkg.version}/Harness-Mobile-${pkg.version}-android-universal.apk`)
  assert.equal(manifest.platforms.ios.version, pkg.version)
  assert.match(androidBuild, /file\("version\.properties"\)/u)
  assert.match(androidBuild, /versionCode = mobileVersionCode/u)
  assert.match(androidBuild, /versionName = mobileVersionName/u)
  assert.match(iosProject, new RegExp(`CURRENT_PROJECT_VERSION: ${iosBuild}\\b`))
  assert.match(iosProject, new RegExp(`MARKETING_VERSION: ${pkg.version.replaceAll('.', '\\.')}`))
})

function syncStoreFixture(name = 'harness-mobile-sync-resilience-') {
  const directory = mkdtempSync(path.join(os.tmpdir(), name))
  const file = path.join(directory, 'mobile-sync.json')
  return { directory, file, store: new MobileSyncStore(file) }
}

test('mobile sync manifest protects the last complete generation from temporary empty and incomplete snapshots', () => {
  const { store } = syncStoreFixture()
  const baseline = store.commitSyncManifest({
    operationId: 'baseline',
    complete: true,
    workspaces: [{ workspaceId: 'workspace-a', title: 'A' }],
    sessions: [{ sessionId: 'session-a', workspaceId: 'workspace-a', title: 'A session' }]
  })
  assert.equal(baseline.applied, true)
  const generation = baseline.generation

  const incomplete = store.commitSyncManifest({
    operationId: 'incomplete-same-generation',
    complete: false,
    workspaces: [{ workspaceId: 'workspace-a', title: 'A updated' }]
  })
  assert.equal(incomplete.applied, true)
  assert.equal(incomplete.generation, generation)
  assert.equal(store.readSyncChanges().snapshot.sessions[0].sessionId, 'session-a')

  const transientEmpty = store.commitSyncManifest({
    operationId: 'temporary-empty',
    complete: true,
    workspaces: [{ workspaceId: 'workspace-a', title: 'A updated' }],
    sessions: []
  })
  assert.equal(transientEmpty.applied, false)
  assert.equal(transientEmpty.protected, true)
  assert.equal(store.readSyncChanges().snapshot.sessions[0].sessionId, 'session-a')
})

test('mobile sync tombstones are the only incremental deletion signal and duplicate/out-of-order reads are idempotent', () => {
  const { store } = syncStoreFixture()
  const baseline = store.commitSyncManifest({
    operationId: 'baseline',
    complete: true,
    workspaces: [{ workspaceId: 'workspace-a' }],
    sessions: [
      { sessionId: 'session-a', workspaceId: 'workspace-a' },
      { sessionId: 'session-b', workspaceId: 'workspace-a' }
    ]
  })
  const cursor = baseline.cursor
  const removed = store.commitSyncManifest({
    operationId: 'delete-session-a',
    complete: false,
    tombstones: [{ kind: 'session', id: 'session-a' }]
  })
  assert.equal(removed.applied, true)
  assert.deepEqual(store.readSyncChanges().snapshot.sessions.map(item => item.sessionId), ['session-b'])
  assert.deepEqual(removed.changes.map(change => change.cursor), [removed.cursor])

  const duplicate = store.commitSyncManifest({
    operationId: 'delete-session-a',
    complete: false,
    tombstones: [{ kind: 'session', id: 'session-a' }]
  })
  assert.equal(duplicate.applied, false)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.cursor, removed.cursor)
  assert.throws(() => store.commitSyncManifest({
    operationId: 'delete-session-a',
    complete: false,
    tombstones: [{ kind: 'session', id: 'session-b' }]
  }), error => error.code === 'MOBILE_SYNC_OPERATION_CONFLICT')

  const resumed = store.readSyncChanges({ snapshotEpoch: baseline.snapshotEpoch, cursor })
  assert.equal(resumed.resetRequired, false)
  assert.equal(resumed.snapshot, null)
  assert.deepEqual(resumed.changes.map(change => change.operationId), ['delete-session-a'])
  const wrongGeneration = store.readSyncChanges({ snapshotEpoch: baseline.snapshotEpoch + 1, cursor })
  assert.equal(wrongGeneration.resetRequired, true)
  assert.notEqual(wrongGeneration.snapshot, null)
})

test('mobile sync persistence bounds journals, migrates schema, fails closed on truncation, and excludes secrets or message bodies', () => {
  const { file, store } = syncStoreFixture()
  const bearer = 'bearer-secret-must-not-persist'
  const privateKey = 'private-key-must-not-persist'
  const body = 'sensitive-message-body-must-not-persist'
  store.commitSyncManifest({
    operationId: 'privacy-baseline',
    complete: true,
    workspaces: [{ workspaceId: 'workspace-a', title: 'A', token: bearer, privateKey, body }],
    sessions: [{ sessionId: 'session-a', workspaceId: 'workspace-a', title: 'S', authorization: bearer, content: body, messages: [body] }]
  })
  for (let index = 0; index < SYNC_EVENT_LIMIT + 5; index++) {
    store.commitSyncManifest({
      operationId: `increment-${index}`,
      complete: false,
      sessions: [{ sessionId: `session-${index}`, workspaceId: 'workspace-a' }]
    })
  }
  const text = readFileSync(file, 'utf8')
  assert.equal(text.includes(bearer), false)
  assert.equal(text.includes(privateKey), false)
  assert.equal(text.includes(body), false)
  assert.equal(store.get().sync.events.length, SYNC_EVENT_LIMIT)

  writeFileSync(file, '{"schemaVersion":', 'utf8')
  assert.throws(() => new MobileSyncStore(file), /missing, unreadable, or invalid/i)
})
