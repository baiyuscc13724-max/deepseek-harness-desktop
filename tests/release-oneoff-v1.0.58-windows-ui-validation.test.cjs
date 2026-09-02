'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  EXPECTED_ARTIFACT_NAMES,
  ONEOFF_TAG,
  REMOVAL_MARKER,
  cliOptions,
  isPathInside,
  normalizeIdentity,
  ordinaryLaunchArguments,
  performOneoffWindowsUiValidation,
  uninstallCandidate,
  validateHomepageProof,
} = require('../scripts/release-oneoff-v1.0.58-windows-ui-validation.cjs')

const REVISION = 'a'.repeat(40)
const WORKFLOW_REF = 'baiyuscc13724-max/deepseek-harness-desktop/.github/workflows/release.yml@refs/heads/main'

function validHomepageProof() {
  return {
    shell: {
      readyState: 'complete',
      title: 'Harness Desktop',
      shell: true,
      startupComplete: true,
      runtimeReady: true,
      runtimeUrl: 'http://127.0.0.1:3080/',
    },
    guest: {
      readyState: 'complete',
      title: 'DeepSeek Harness',
      href: 'http://127.0.0.1:3080/',
      origin: 'http://127.0.0.1:3080',
      conversation: true,
      conversationScroll: true,
      composer: true,
      composerVisible: true,
      homeAction: true,
    },
    targets: {
      shell: 'file:///C:/isolated/resources/app.asar/renderer/index.html',
      guest: 'http://127.0.0.1:3080/',
    },
    method: 'cdp-runtime-evaluate',
  }
}

function fixture(t) {
  const runnerTemp = mkdtempSync(path.join(tmpdir(), 'harness-v1.0.58-oneoff-test-'))
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }))
  const artifactRoot = path.join(runnerTemp, 'current-run-artifact')
  mkdirSync(artifactRoot, { recursive: true })
  for (const name of EXPECTED_ARTIFACT_NAMES) writeFileSync(path.join(artifactRoot, name), `formal-current-run:${name}`)
  const reportPath = path.join(runnerTemp, 'evidence.json')
  return {
    tag: ONEOFF_TAG,
    sourceRevision: REVISION,
    githubSha: REVISION,
    runId: '731',
    workflowRef: WORKFLOW_REF,
    workflowName: 'Cloud Build & Release Desktop',
    runnerTemp,
    artifactRoot,
    reportPath,
    platform: 'win32',
    arch: 'x64',
  }
}

function createInstalledFiles(layout) {
  mkdirSync(path.join(layout.installRoot, 'resources'), { recursive: true })
  writeFileSync(path.join(layout.installRoot, 'Harness Desktop.exe'), 'installed ordinary application')
  writeFileSync(path.join(layout.installRoot, 'resources', 'app.asar'), 'installed app archive')
  writeFileSync(path.join(layout.installRoot, 'unins000.exe'), 'installed uninstaller')
}

test('one-off identity is exact v1.0.58, exact source revision, and exact formal workflow', () => {
  const identity = normalizeIdentity({
    tag: ONEOFF_TAG,
    sourceRevision: REVISION,
    githubSha: REVISION,
    runId: '731',
    workflowRef: WORKFLOW_REF,
    workflowName: 'Cloud Build & Release Desktop',
  })
  assert.equal(identity.tag, 'v1.0.58')
  assert.equal(identity.sourceRevision, REVISION)
  assert.equal(identity.githubSha, REVISION)
  assert.equal(identity.runId, '731')
  assert.match(REMOVAL_MARKER, /DELETE.*v1\.0\.58.*after v1\.0\.58 publication/iu)
  assert.throws(() => normalizeIdentity({ ...identity, tag: 'v1.0.59' }), /restricted to v1\.0\.58/iu)
  assert.throws(() => normalizeIdentity({ ...identity, githubSha: 'b'.repeat(40) }), /does not match/iu)
  assert.throws(() => normalizeIdentity({ ...identity, workflowRef: 'owner/repo/.github/workflows/release.yml@refs/heads/retry' }), /main-branch formal/iu)
  assert.throws(() => normalizeIdentity({ ...identity, workflowName: 'Some other workflow' }), /workflow name/iu)
})

test('successful gate binds the current-run installer, uses isolated ordinary-app data, proves home, stops, and uninstalls', async t => {
  const options = fixture(t)
  const events = []
  let observedLayout
  let observedLaunchArguments
  const result = await performOneoffWindowsUiValidation({
    ...options,
    reservePortImpl: async () => 19333,
    installImpl: async ({ artifact, layout }) => {
      events.push('install')
      observedLayout = layout
      assert.equal(artifact.name, 'Harness-Desktop-1.0.58-win-x64.exe')
      assert.ok(isPathInside(options.runnerTemp, artifact.path))
      createInstalledFiles(layout)
    },
    launchImpl: async ({ layout, cdpPort }) => {
      events.push('launch')
      observedLaunchArguments = ordinaryLaunchArguments({ layout, cdpPort })
      return { pid: 4242, child: { exitCode: null }, cdpPort, args: observedLaunchArguments }
    },
    proveHomepageImpl: async () => {
      events.push('prove-home')
      return validHomepageProof()
    },
    stopImpl: async () => { events.push('stop') },
    uninstallImpl: async ({ layout }) => {
      events.push('uninstall')
      rmSync(layout.installRoot, { recursive: true, force: true })
    },
  })

  assert.deepEqual(events, ['install', 'launch', 'prove-home', 'stop', 'uninstall'])
  assert.equal(result.ok, true)
  assert.equal(result.identity.sourceRevision, REVISION)
  assert.equal(result.identity.runId, '731')
  assert.equal(result.artifact.name, 'Harness-Desktop-1.0.58-win-x64.exe')
  assert.equal(result.artifact.sha256, createHash('sha256').update(readFileSync(path.join(options.artifactRoot, result.artifact.name))).digest('hex'))
  assert.equal(result.launchMode, 'ordinary-application-with-cdp-structure-probe')
  assert.equal(result.homepage.method, 'cdp-runtime-evaluate')
  assert.ok(observedLaunchArguments.includes(`--user-data-dir=${observedLayout.electronUserDataDir}`))
  assert.ok(observedLaunchArguments.includes(`--harness-user-data-dir=${observedLayout.electronUserDataDir}`))
  assert.ok(observedLaunchArguments.includes('--remote-debugging-address=127.0.0.1'))
  assert.ok(observedLaunchArguments.includes('--remote-debugging-port=19333'))
  assert.equal(observedLaunchArguments.some(value => value.startsWith('--self-test')), false)
  assert.ok(isPathInside(options.runnerTemp, observedLayout.installRoot))
  assert.ok(isPathInside(options.runnerTemp, observedLayout.electronUserDataDir))
  assert.ok(isPathInside(options.runnerTemp, observedLayout.harnessUserDataDir))
  assert.notEqual(observedLayout.installRoot, observedLayout.electronUserDataDir)
  assert.notEqual(observedLayout.electronUserDataDir, observedLayout.harnessUserDataDir)
  assert.equal(existsSync(observedLayout.validationRoot), false)
  assert.equal(existsSync(observedLayout.installRoot), false)
  assert.equal(existsSync(result.reportPath), true)
  const persisted = JSON.parse(readFileSync(result.reportPath, 'utf8'))
  assert.equal(persisted.ok, true)
  assert.deepEqual(persisted.launchArguments, observedLaunchArguments)
  assert.deepEqual(result.lifecycle.map(item => item.phase), [
    'same-run-installer-bound',
    'isolated-install-complete',
    'ordinary-application-launched',
    'structured-homepage-proved',
    'application-process-tree-stopped',
    'isolated-install-uninstalled',
    'validation-root-removed',
  ])
})

test('the real uninstaller allows its asynchronous second phase to finish and removes an empty install root', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'harness-v1.0.58-uninstall-grace-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const installRoot = path.join(root, 'installed-app')
  const residual = path.join(installRoot, '_iu-second-phase.tmp')
  mkdirSync(installRoot, { recursive: true })
  writeFileSync(residual, 'temporary Inno Setup second phase')
  let waits = 0

  await uninstallCandidate({
    installed: { uninstallerPath: path.join(root, 'unins000.exe') },
    layout: { installRoot },
    spawnSyncImpl: () => ({ status: 0, stdout: '', stderr: '' }),
    waitImpl: async milliseconds => {
      assert.equal(milliseconds, 500)
      waits += 1
      rmSync(residual, { force: true })
    },
    maxCleanupAttempts: 3,
  })

  assert.equal(waits, 1)
  assert.equal(existsSync(installRoot), false)
})

test('the real uninstaller still fails closed with bounded residual-entry evidence', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'harness-v1.0.58-uninstall-residual-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const installRoot = path.join(root, 'installed-app')
  mkdirSync(installRoot, { recursive: true })
  writeFileSync(path.join(installRoot, 'unexpected.log'), 'must not be hidden by cleanup')

  await assert.rejects(uninstallCandidate({
    installed: { uninstallerPath: path.join(root, 'unins000.exe') },
    layout: { installRoot },
    spawnSyncImpl: () => ({ status: 0, stdout: '', stderr: '' }),
    waitImpl: async () => {},
    maxCleanupAttempts: 1,
  }), /residual entries.*unexpected\.log/iu)
  assert.equal(existsSync(installRoot), true)
})

test('a missing structured homepage marker fails closed but still stops and uninstalls', async t => {
  const options = fixture(t)
  const events = []
  let validationRoot
  await assert.rejects(
    performOneoffWindowsUiValidation({
      ...options,
      reservePortImpl: async () => 19334,
      installImpl: async ({ layout }) => {
        events.push('install')
        validationRoot = layout.validationRoot
        createInstalledFiles(layout)
      },
      launchImpl: async ({ layout, cdpPort }) => {
        events.push('launch')
        return { pid: 5252, child: { exitCode: null }, cdpPort, args: ordinaryLaunchArguments({ layout, cdpPort }) }
      },
      proveHomepageImpl: async () => {
        events.push('prove-home')
        return { ...validHomepageProof(), guest: { ...validHomepageProof().guest, composer: false, homeAction: false } }
      },
      stopImpl: async () => { events.push('stop') },
      uninstallImpl: async ({ layout }) => {
        events.push('uninstall')
        rmSync(layout.installRoot, { recursive: true, force: true })
      },
    }),
    /pre-Tag installed homepage validation failed.*structured homepage/iu,
  )
  assert.deepEqual(events, ['install', 'launch', 'prove-home', 'stop', 'uninstall'])
  assert.equal(existsSync(validationRoot), false)
  const failure = JSON.parse(readFileSync(options.reportPath, 'utf8'))
  assert.equal(failure.ok, false)
  assert.match(failure.error.message, /structured homepage/iu)
  assert.ok(failure.lifecycle.some(item => item.phase === 'application-process-tree-stopped'))
  assert.ok(failure.lifecycle.some(item => item.phase === 'isolated-install-uninstalled'))
})

test('artifact and report paths cannot escape RUNNER_TEMP and unexpected assets are rejected', async t => {
  const options = fixture(t)
  const outside = mkdtempSync(path.join(tmpdir(), 'harness-v1.0.58-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  await assert.rejects(
    performOneoffWindowsUiValidation({ ...options, artifactRoot: outside }),
    /artifact directory must stay inside RUNNER_TEMP/iu,
  )
  writeFileSync(path.join(options.artifactRoot, 'unexpected.exe'), 'not allowed')
  await assert.rejects(
    performOneoffWindowsUiValidation(options),
    /unexpected file set/iu,
  )
})

test('homepage proof requires the ordinary shell and official workbench structure rather than self-test JSON', () => {
  assert.equal(validateHomepageProof(validHomepageProof()), true)
  assert.throws(
    () => validateHomepageProof({ ...validHomepageProof(), shell: { ...validHomepageProof().shell, startupComplete: false } }),
    /did not finish opening/iu,
  )
  assert.throws(
    () => validateHomepageProof({ ...validHomepageProof(), guest: { ...validHomepageProof().guest, conversationScroll: false } }),
    /structured homepage/iu,
  )
})

test('CLI binds only the workflow-provided current run identity and runner paths', () => {
  const options = cliOptions([], {
    ONEOFF_TAG,
    ONEOFF_SOURCE_REVISION: REVISION,
    GITHUB_SHA: REVISION,
    GITHUB_RUN_ID: '731',
    GITHUB_WORKFLOW_REF: WORKFLOW_REF,
    GITHUB_WORKFLOW: 'Cloud Build & Release Desktop',
    RUNNER_TEMP: 'C:\\runner-temp',
    ONEOFF_ARTIFACT_ROOT: 'C:\\runner-temp\\artifact',
    ONEOFF_REPORT_PATH: 'C:\\runner-temp\\report.json',
  })
  assert.deepEqual(options, {
    tag: ONEOFF_TAG,
    sourceRevision: REVISION,
    githubSha: REVISION,
    runId: '731',
    workflowRef: WORKFLOW_REF,
    workflowName: 'Cloud Build & Release Desktop',
    runnerTemp: 'C:\\runner-temp',
    artifactRoot: 'C:\\runner-temp\\artifact',
    reportPath: 'C:\\runner-temp\\report.json',
  })
})
