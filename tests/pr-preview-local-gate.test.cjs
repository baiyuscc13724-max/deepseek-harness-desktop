const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash, generateKeyPairSync } = require('node:crypto')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const {
  createComponentZip,
  createSignedComponentDescriptor,
  createSignedReleaseManifest,
  signCanonicalObject
} = require('../electron/bridge/component-update-builder.cjs')
const { applyReadyComponentUpdate } = require('../electron/bridge/component-update-helper.cjs')
const {
  confirmComponentActivation,
  prepareComponentActivation
} = require('../electron/bridge/component-update-health.cjs')
const { ComponentUpdateStore } = require('../electron/bridge/component-update-store.cjs')

const NOW = Date.parse('2026-08-25T12:00:00.000Z')
const HEAD = 'a'.repeat(40)
const PR = 27
const SEQUENCE = 10101
const STABLE = '1.0.44'
const PREVIEW = '1.0.45-pr.101.1'
const RUN_ID = 900
const ATTEMPT = 1
const TAG = `pr-preview-${PR}-${HEAD.slice(0, 12)}-run-${RUN_ID}-${ATTEMPT}`
const ASSET = `desktop-shell-${PREVIEW}-${process.platform}-${process.arch}.zip`
const HEALTHY_SELF_TEST_CHECKS = Object.freeze({
  rendererEntry: true,
  bundledHarness: true,
  runtimeWebBoot: true,
  nodeRuntime: true,
  userData: true,
  desktopMarketplace: true,
  bundledGit: true,
  webCompatibility: true
})

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function loadGate() {
  return import('../scripts/pr-preview-local-gate.mjs')
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-pr-preview-gate-test-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const bundle = path.join(root, 'candidate')
  const input = path.join(root, 'component-input')
  const profile = path.join(root, 'profile')
  const configFile = path.join(root, 'pr-preview-update-sources.json')
  const evidenceFile = path.join(root, 'evidence.json')
  const appExe = path.join(root, 'Harness-Desktop-test.exe')
  await Promise.all([mkdir(bundle), mkdir(input)])
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const keyId = 'harness-preview-local-gate-test'
  const config = {
    enabled: true,
    repository: 'baiyuscc13724-max/deepseek-harness-desktop',
    channelUrls: [
      'https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/git/raw/main/component-feeds/pr-preview/latest.json',
      'https://raw.githubusercontent.com/baiyuscc13724-max/deepseek-harness-desktop/main/component-feeds/pr-preview/latest.json'
    ],
    trustedKeys: { [keyId]: publicKey.export({ type: 'spki', format: 'pem' }) }
  }
  const configBytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`)
  await Promise.all([
    writeFile(configFile, configBytes),
    writeFile(path.join(input, 'pr-preview-update-sources.json'), configBytes),
    writeFile(path.join(input, 'gate-marker.txt'), 'signed candidate payload\n'),
    writeFile(appExe, 'packaged executable placeholder\n')
  ])
  const componentFile = path.join(bundle, ASSET)
  const archive = await createComponentZip({ inputDir: input, outputFile: componentFile, id: 'desktop-shell', version: PREVIEW, target: 'shell', AdmZipImpl: AdmZip })
  const component = createSignedComponentDescriptor({
    id: 'desktop-shell', version: PREVIEW, target: 'shell', platform: process.platform, arch: process.arch,
    archive,
    urls: [
      `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/${TAG}/${ASSET}`,
      `https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/${TAG}/${ASSET}`
    ],
    restart: true
  }, privateKey)
  const publishedAt = new Date(NOW - 60 * 60 * 1000)
  const expiresAt = new Date(publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const componentManifest = createSignedReleaseManifest({
    releaseVersion: PREVIEW,
    channel: 'prerelease',
    publishedAt,
    keyId,
    bootstrap: { minVersion: STABLE },
    components: [component],
    notes: 'local gate fixture'
  }, privateKey)
  const common = {
    schemaVersion: 1,
    repository: 'baiyuscc13724-max/deepseek-harness-desktop',
    channel: 'pr-preview',
    prNumber: PR,
    title: 'Local gate evidence',
    author: 'octo-contributor',
    baseRef: 'main',
    headSha: HEAD,
    sequence: SEQUENCE,
    publishedAt: publishedAt.toISOString(),
    expiresAt,
    keyId
  }
  const manifestReleaseAsset = `pr-preview-manifest-${HEAD}.json`
  const indexReleaseAsset = `pr-preview-index-${HEAD}.json`
  const manifest = signCanonicalObject({ ...common, kind: 'pr-preview-manifest', componentManifest }, privateKey)
  const index = signCanonicalObject({
    ...common,
    kind: 'pr-preview-index',
    manifestUrls: [
      `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/git/raw/main/component-feeds/pr-preview/manifests/${HEAD}.json`,
      `https://raw.githubusercontent.com/baiyuscc13724-max/deepseek-harness-desktop/main/component-feeds/pr-preview/manifests/${HEAD}.json`
    ],
    notes: 'approved local gate fixture'
  }, privateKey)
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`)
  await Promise.all([
    writeFile(path.join(bundle, manifestReleaseAsset), manifestBytes),
    writeFile(path.join(bundle, indexReleaseAsset), indexBytes)
  ])
  const audit = {
    schemaVersion: 1,
    kind: 'harness-pr-preview-signing-audit',
    repository: 'baiyuscc13724-max/deepseek-harness-desktop',
    prNumber: PR,
    headSha: HEAD,
    buildRunId: RUN_ID,
    runAttempt: ATTEMPT,
    immutableTag: TAG,
    artifactName: `pr-preview-unsigned-${PR}-${HEAD}`,
    officialStableVersion: STABLE,
    previewVersion: PREVIEW,
    manifestReleaseAsset,
    indexReleaseAsset,
    feedReleaseAssets: [
      { name: manifestReleaseAsset, size: manifestBytes.length, sha256: sha256(manifestBytes) },
      { name: indexReleaseAsset, size: indexBytes.length, sha256: sha256(indexBytes) }
    ]
  }
  await writeFile(path.join(bundle, 'pr-preview-signing-audit.json'), `${JSON.stringify(audit, null, 2)}\n`)
  return { root, bundle, profile, configFile, evidenceFile, appExe, audit, componentFile }
}

async function healthyActivation({ store }) {
  await applyReadyComponentUpdate({ store, parentPid: 1, waitImpl: async () => {}, restart: null })
  const prepared = await prepareComponentActivation({ store })
  assert.equal(prepared.action, 'health-check-required')
  const confirmed = await confirmComponentActivation(store)
  assert.equal(confirmed.confirmed, true)
  return { state: confirmed.state, selfTest: { ok: true } }
}

function selfTest(_executable, _profile, _output, phase) {
  assert.ok(['baseline', 'restored'].includes(phase))
  return Promise.resolve({ ok: true, product: { version: STABLE }, checks: HEALTHY_SELF_TEST_CHECKS })
}

function legacyStableSelfTest(_executable, _profile, _output, phase) {
  assert.ok(['baseline', 'restored'].includes(phase))
  return Promise.resolve({
    ok: false,
    product: { version: STABLE },
    checks: { ...HEALTHY_SELF_TEST_CHECKS, desktopMarketplace: false }
  })
}

test('CLI accepts only four local path inputs and rejects URL/token/private-key surfaces', async () => {
  const { parseGateArguments } = await loadGate()
  assert.throws(() => parseGateArguments([
    '--candidate-bundle', 'https://example.test/bundle',
    '--public-config', 'config.json', '--app-exe', 'app.exe', '--evidence', 'evidence.json'
  ]), /本机文件路径/)
  assert.throws(() => parseGateArguments([
    '--candidate-bundle', 'bundle', '--public-config', 'config.json', '--app-exe', 'app.exe',
    '--evidence', 'evidence.json', '--token', 'secret'
  ]), /拒绝参数/)
  assert.throws(() => parseGateArguments([
    '--candidate-bundle', 'bundle', '--public-config', 'config.json', '--app-exe', 'app.exe',
    '--evidence', 'evidence.json', '--private-key', 'key.pem'
  ]), /拒绝参数/)
})

test('real signed bundle stages, activates, restores stable, proves rollback, and emits strict non-sensitive evidence', async t => {
  const files = await fixture(t)
  const { runPrPreviewLocalGate } = await loadGate()
  const result = await runPrPreviewLocalGate({
    candidateBundle: files.bundle,
    publicConfig: files.configFile,
    appExe: files.appExe,
    evidenceFile: files.evidenceFile
  }, {
    now: () => NOW,
    profileRoot: files.profile,
    runPackagedSelfTestImpl: selfTest,
    activateCandidateImpl: healthyActivation
  })
  const bytes = await readFile(files.evidenceFile)
  const evidence = JSON.parse(bytes)
  assert.equal(result.evidenceSha256, sha256(bytes))
  assert.deepEqual(Object.keys(evidence).sort(), [
    'activatedRelease', 'baselineRelease', 'candidate', 'checks', 'createdAt',
    'kind', 'restoredRelease', 'result', 'schemaVersion'
  ])
  assert.deepEqual(Object.keys(evidence.candidate).sort(), ['componentSha256', 'headSha', 'immutableTag', 'sequence'])
  assert.deepEqual(Object.keys(evidence.checks).sort(), ['healthy', 'rollback'])
  assert.equal(evidence.result, 'passed')
  assert.equal(evidence.baselineRelease, STABLE)
  assert.equal(evidence.activatedRelease, PREVIEW)
  assert.equal(evidence.restoredRelease, STABLE)
  assert.equal(evidence.candidate.immutableTag, TAG)
  assert.equal(evidence.checks.healthy, 'passed')
  assert.equal(evidence.checks.rollback, 'passed')
  assert.doesNotMatch(bytes.toString('utf8'), /https?:|BEGIN |PRIVATE|TOKEN|secret|profile|\\|:\\|\.exe/i)
  const store = new ComponentUpdateStore(path.join(files.profile, 'component-updates'))
  assert.equal((await store.get()).phase, 'idle')
  assert.equal(await store.pointer(), null)
})

test('gate permits only the exact published v1.0.44 marketplace probe false-negative', async t => {
  const files = await fixture(t)
  const { runPrPreviewLocalGate } = await loadGate()
  const result = await runPrPreviewLocalGate({
    candidateBundle: files.bundle,
    publicConfig: files.configFile,
    appExe: files.appExe,
    evidenceFile: files.evidenceFile
  }, {
    now: () => NOW,
    profileRoot: files.profile,
    runPackagedSelfTestImpl: legacyStableSelfTest,
    activateCandidateImpl: healthyActivation
  })
  assert.equal(result.evidence.baselineRelease, STABLE)
  assert.equal(result.evidence.restoredRelease, STABLE)
  assert.deepEqual(result.evidence.checks, { healthy: 'passed', rollback: 'passed' })
})

test('gate rejects every other stable baseline self-test failure', async t => {
  const files = await fixture(t)
  const { runPrPreviewLocalGate } = await loadGate()
  const failingSelfTest = async () => ({
    ok: false,
    product: { version: STABLE },
    checks: { ...HEALTHY_SELF_TEST_CHECKS, runtimeWebBoot: false }
  })
  await assert.rejects(() => runPrPreviewLocalGate({
    candidateBundle: files.bundle,
    publicConfig: files.configFile,
    appExe: files.appExe,
    evidenceFile: files.evidenceFile
  }, {
    now: () => NOW,
    profileRoot: files.profile,
    runPackagedSelfTestImpl: failingSelfTest,
    activateCandidateImpl: healthyActivation
  }), /runtimeWebBoot/)
})

test('gate fails closed for disabled production config, byte-mismatched embedded config, tampering, and extra assets', async t => {
  const files = await fixture(t)
  const { verifyLocalCandidateBundle } = await loadGate()
  const originalConfig = JSON.parse(await readFile(files.configFile, 'utf8'))

  await writeFile(files.configFile, JSON.stringify({ ...originalConfig, enabled: false }))
  await assert.rejects(() => verifyLocalCandidateBundle({ candidateBundle: files.bundle, publicConfig: files.configFile, now: NOW }), /尚未启用/)

  await writeFile(files.configFile, JSON.stringify(originalConfig))
  await assert.rejects(() => verifyLocalCandidateBundle({ candidateBundle: files.bundle, publicConfig: files.configFile, now: NOW }), /ZIP 内公开 config.*不一致/)

  await writeFile(files.configFile, `${JSON.stringify(originalConfig, null, 2)}\n`)
  await writeFile(files.componentFile, Buffer.from('tampered candidate'))
  await assert.rejects(() => verifyLocalCandidateBundle({ candidateBundle: files.bundle, publicConfig: files.configFile, now: NOW }), /大小不匹配|SHA-256 不匹配/)

  const replacement = await fixture(t)
  await writeFile(path.join(replacement.bundle, 'unexpected.txt'), 'extra')
  await assert.rejects(() => verifyLocalCandidateBundle({ candidateBundle: replacement.bundle, publicConfig: replacement.configFile, now: NOW }), /资产集合不精确/)
})
