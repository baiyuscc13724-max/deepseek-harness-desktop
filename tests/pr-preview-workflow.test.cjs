const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync, createHash } = require('node:crypto')
const { copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const YAML = require('yaml')
const AdmZip = require('adm-zip')

const root = path.resolve(__dirname, '..')

async function load(relative) {
  return readFile(path.join(root, relative), 'utf8')
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

test('PR build workflow is secretless, same-repository only, and binds the exact head SHA', async () => {
  const source = await load('.github/workflows/pr-preview-build.yml')
  const workflow = YAML.parse(source)
  assert.ok(workflow.on.pull_request)
  assert.equal(workflow.permissions.contents, 'read')
  assert.match(source, /head\.repo\.full_name == github\.repository/)
  assert.match(source, /head\.repo\.fork == false/)
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/)
  assert.match(source, /releases\/latest/)
  assert.ok(source.indexOf('releases/latest') < source.indexOf('actions/checkout@'), 'stable baseline must resolve before PR checkout')
  assert.match(source, /--official-stable-version/)
  assert.match(await load('scripts/pr-preview-build.mjs'), /pr-preview-update-sources\.json/)
  assert.match(source, /--sequence "\$GITHUB_RUN_NUMBER"/)
  assert.match(source, /persist-credentials: false/)
  assert.match(source, /git rev-parse HEAD/)
  assert.match(source, /npm ci --ignore-scripts/)
  assert.doesNotMatch(source, /secrets\./)
  assert.doesNotMatch(source, /pull_request_target/)
})

test('preview version advances from official stable instead of stale PR package version', async () => {
  const { previewSequence, previewVersion } = await import('../scripts/pr-preview-build.mjs')
  assert.equal(previewVersion('1.0.44', 88, 1), '1.0.45-pr.88.1')
  assert.notEqual(previewVersion('1.0.44', 88, 1), '1.0.41-pr.88.1')
  assert.equal(previewSequence(88, 1), 88_000_001)
  assert.ok(previewSequence(88, 2) > previewSequence(88, 1))
  assert.ok(previewSequence(89, 1) > previewSequence(88, 999_999))
})

test('sign workflow is protected dispatch from default branch and never runs downloaded PR code', async () => {
  const source = await load('.github/workflows/pr-preview-sign.yml')
  const workflow = YAML.parse(source)
  assert.ok(workflow.on.workflow_dispatch)
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'])
  assert.equal(workflow.concurrency.group, 'pr-preview-sign-channel')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(workflow.jobs['verify-sign-publish'].environment.name, 'pr-preview-signing')
  assert.match(source, /refs\/heads\/\$DEFAULT_BRANCH/)
  assert.match(source, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(source, /actions\/runs\/\$BUILD_RUN_ID/)
  assert.match(source, /expired == false/)
  assert.match(source, /run-id: \$\{\{ inputs\.build_run_id \}\}/)
  assert.match(source, /HARNESS_PR_PREVIEW_SIGNING_PRIVATE_KEY_BASE64/)
  assert.match(source, /pulls\/\$APPROVED_PR/)
  assert.match(source, /--pull-request-metadata/)
  assert.match(source, /releases\/latest/)
  assert.match(source, /--stable-release-metadata/)
  assert.match(source, /--trusted-preview-config "\$GITHUB_WORKSPACE\/pr-preview-update-sources\.json"/)
  assert.match(source, /--key-id 'harness-preview-v1'/)
  assert.match(source, /without replacement/)
  assert.doesNotMatch(source, /HARNESS_COMPONENT_SIGNING_PRIVATE_KEY_BASE64/)
  assert.doesNotMatch(source, /--clobber/)
  assert.doesNotMatch(source, /node \$RUNNER_TEMP\/unsigned-preview|bash \$RUNNER_TEMP\/unsigned-preview|chmod .*unsigned-preview/)
})

test('sign workflow publishes only immutable candidates and cannot access CNB promotion credentials', async () => {
  const source = await load('.github/workflows/pr-preview-sign.yml')
  assert.match(source, /Freeze only the immutable candidate bundle/)
  assert.match(source, /rm -f "\$signed\/cnb-mirror-request\.json"/)
  assert.match(source, /pr-preview-signed-candidate-/)
  assert.match(source, /Immutable signed candidate only/)
  assert.doesNotMatch(source, /CNB_PR_PREVIEW_PUSH_TOKEN|HEAD:refs\/heads\/pr-preview|Push signed metadata-only handoff/)
  assert.doesNotMatch(source, /component-feeds\/pr-preview\/latest\.json[\s\S]*git push/)
})

test('promotion workflow owns the CNB handoff behind independent local evidence approval', async () => {
  const source = await load('.github/workflows/pr-preview-promote.yml')
  const workflow = YAML.parse(source)
  assert.ok(workflow.on.workflow_dispatch)
  assert.equal(workflow.permissions.actions, 'read')
  assert.equal(workflow.permissions.contents, 'read')
  assert.equal(workflow.concurrency.group, 'pr-preview-promotion-channel')
  assert.equal(workflow.jobs['verify-evidence-and-promote'].environment.name, 'pr-preview-promotion')
  for (const input of ['sign_run_id', 'pull_request', 'head_sha', 'immutable_tag', 'sequence', 'bundle_digests_json', 'evidence_base64', 'evidence_sha256']) {
    assert.equal(workflow.on.workflow_dispatch.inputs[input].required, true)
  }
  assert.match(source, /pr-preview-promote-verify\.mjs/)
  assert.match(source, /pr-preview-cnb-request\.mjs/)
  assert.match(source, /secrets\.CNB_PR_PREVIEW_PUSH_TOKEN/)
  assert.match(source, /name: pr-preview-promotion/)
  assert.match(source, /HEAD:refs\/heads\/pr-preview/)
  assert.match(source, /git fetch --no-tags --depth=1 "\$cnb_url" refs\/heads\/pr-preview/)
  assert.match(source, /git update-ref refs\/heads\/pr-preview-handoff "\$remote_oid"/)
  assert.match(source, /git read-tree "\$remote_oid"/)
  assert.match(source, /test "\$\(git rev-parse HEAD\^\)" = "\$remote_oid"/)
  assert.match(source, /test "\$observed_oid" = "\$remote_oid"/)
  assert.match(source, /git push "\$cnb_url" HEAD:refs\/heads\/pr-preview/)
  assert.doesNotMatch(source, /--force(?:-with-lease|-if-includes)?|force-with-lease/)
  assert.match(source, /evidenceSha256/)
  assert.match(source, /state == "open" and \.draft == false and \.merged_at == null/)
  assert.match(source, /current-cnb-index|current-github-index/)
  assert.doesNotMatch(source, /HARNESS_PR_PREVIEW_SIGNING_PRIVATE_KEY_BASE64/)
  assert.doesNotMatch(source, /https:\/\/[^\s'"$]*\$CNB_PR_PREVIEW_PUSH_TOKEN/)
})

test('CNB verifier fails closed while production preview public key is unconfigured', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'harness-pr-preview-feed-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const indexFile = path.join(temp, 'latest.json')
  const manifestFile = path.join(temp, 'manifest.json')
  await writeFile(indexFile, '{}')
  await writeFile(manifestFile, '{}')
  const { verifyPrPreviewFeedFiles } = await import('../scripts/pr-preview-verify-feed.mjs')
  await assert.rejects(() => verifyPrPreviewFeedFiles({
    configFile: path.join(root, 'pr-preview-update-sources.json'), indexFile, manifestFile
  }), /生产公钥尚未配置/)
})

test('trusted run validator rejects forks and noncanonical workflows', async () => {
  const { validateTrustedBuildRun, OFFICIAL_REPOSITORY } = await import('../scripts/pr-preview-sign.mjs')
  const expected = { repository: OFFICIAL_REPOSITORY, headSha: 'a'.repeat(40), prNumber: 42, buildRunId: 99 }
  const run = {
    id: 99,
    run_number: 7,
    run_attempt: 1,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    path: '.github/workflows/pr-preview-build.yml',
    head_sha: expected.headSha,
    repository: { full_name: OFFICIAL_REPOSITORY },
    head_repository: { full_name: OFFICIAL_REPOSITORY },
    pull_requests: [{ number: 42 }],
    updated_at: '2026-08-25T00:00:00.000Z'
  }
  assert.equal(validateTrustedBuildRun(run, expected).runNumber, 7)
  assert.throws(() => validateTrustedBuildRun({ ...run, head_repository: { full_name: 'attacker/fork' } }, expected), /fork/)
  assert.throws(() => validateTrustedBuildRun({ ...run, path: '.github/workflows/other.yml' }, expected), /workflow/)
})

test('signer verifies artifact bytes, emits CNB-first signed metadata, and gates latest promotion', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'harness-pr-preview-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const input = path.join(temp, 'input')
  const output = path.join(temp, 'output')
  await mkdir(input)
  const repository = 'baiyuscc13724-max/deepseek-harness-desktop'
  const headSha = 'b'.repeat(40)
  const pullRequest = 42
  const buildRunId = 12345
  const artifactName = `pr-preview-unsigned-${pullRequest}-${headSha}`
  const version = '1.0.45-pr.88.1'
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const trustedPreviewConfig = {
    enabled: true,
    repository,
    trustedKeys: { 'harness-preview-test': publicKey.export({ type: 'spki', format: 'pem' }) }
  }
  const trustedPreviewConfigBytes = Buffer.from(`${JSON.stringify(trustedPreviewConfig, null, 2)}\n`)
  const componentName = `desktop-shell-${version}-win32-x64.zip`
  const componentZip = new AdmZip()
  componentZip.addFile('component.json', Buffer.from(JSON.stringify({
    schemaVersion: 1, id: 'desktop-shell', version, target: 'shell', files: []
  })))
  componentZip.addFile('pr-preview-update-sources.json', trustedPreviewConfigBytes)
  const componentBytes = componentZip.toBuffer()
  await writeFile(path.join(input, componentName), componentBytes)
  await writeFile(path.join(input, 'pr-preview-build.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'harness-pr-preview-unsigned',
    workflow: '.github/workflows/pr-preview-build.yml',
    artifactName,
    repository,
    headRepository: repository,
    fork: false,
    pullRequest,
    headSha,
    builtAt: '2026-08-25T00:00:00.000Z',
    prPackageVersion: '1.0.40',
    officialStableVersion: '1.0.44',
    buildRunNumber: 88,
    buildSequence: 88_000_001,
    buildAttempt: 1,
    previewVersion: version,
    target: 'win32-x64',
    component: {
      id: 'desktop-shell', target: 'shell', platform: 'win32', arch: 'x64', name: componentName,
      size: componentBytes.length, unpackedSize: 100, sha256: sha256(componentBytes), indexVersion: version
    }
  }))
  const runFile = path.join(temp, 'run.json')
  await writeFile(runFile, JSON.stringify({
    id: buildRunId, run_number: 88, run_attempt: 1, event: 'pull_request', status: 'completed', conclusion: 'success',
    path: '.github/workflows/pr-preview-build.yml', head_sha: headSha,
    repository: { full_name: repository }, head_repository: { full_name: repository },
    pull_requests: [{ number: pullRequest }], updated_at: '2026-08-25T00:00:00.000Z'
  }))
  const prFile = path.join(temp, 'pull-request.json')
  await writeFile(prFile, JSON.stringify({
    number: pullRequest,
    state: 'open',
    draft: false,
    merged_at: null,
    title: 'Fix signed preview discovery',
    user: { login: 'Harness-Contributor' },
    head: { sha: headSha, repo: { full_name: repository, fork: false } },
    base: { ref: 'main', repo: { full_name: repository } }
  }))
  const stableFile = path.join(temp, 'official-stable-release.json')
  await writeFile(stableFile, JSON.stringify({
    tag_name: 'v1.0.44', draft: false, prerelease: false, published_at: '2026-08-24T00:00:00.000Z'
  }))
  const keyFile = path.join(temp, 'preview-key.pem')
  const trustedPreviewConfigFile = path.join(temp, 'trusted-preview-sources.json')
  await writeFile(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  await writeFile(trustedPreviewConfigFile, trustedPreviewConfigBytes)
  const { signPreview } = await import('../scripts/pr-preview-sign.mjs')
  const result = await signPreview({
    runMetadataFile: runFile, pullRequestMetadataFile: prFile, stableReleaseMetadataFile: stableFile, trustedPreviewConfigFile,
    inputRoot: input, outputRoot: output, repository, prNumber: pullRequest, headSha,
    buildRunId, artifactName, keyFile, keyId: 'harness-preview-test',
    cnbProject: repository, publishedAt: '2026-08-25T00:00:00.000Z'
  })
  assert.equal(result.previewManifest.componentManifest.releaseVersion, '1.0.45-pr.88.1')
  assert.equal(result.previewManifest.componentManifest.bootstrap.minVersion, '1.0.44')
  assert.equal(result.previewManifest.componentManifest.components[0].version, '1.0.45-pr.88.1')
  assert.equal(result.previewIndex.sequence, 88_000_001)
  assert.equal(result.previewIndex.prNumber, pullRequest)
  assert.equal(result.previewIndex.title, 'Fix signed preview discovery')
  assert.equal(result.previewIndex.author, 'harness-contributor')
  assert.equal(result.previewIndex.baseRef, 'main')
  assert.equal(result.previewManifest.expiresAt, result.previewIndex.expiresAt)
  assert.equal(Date.parse(result.previewIndex.expiresAt) - Date.parse(result.previewIndex.publishedAt), 7 * 24 * 60 * 60 * 1000)
  assert.deepEqual(result.previewIndex.manifestUrls, [
    `https://cnb.cool/${repository}/-/git/raw/main/component-feeds/pr-preview/manifests/${headSha}.json`,
    `https://raw.githubusercontent.com/${repository}/main/component-feeds/pr-preview/manifests/${headSha}.json`
  ])
  assert.match(result.previewManifest.componentManifest.components[0].urls[0], /^https:\/\/cnb\.cool\//)
  assert.match(result.previewManifest.componentManifest.components[0].urls[1], /^https:\/\/github\.com\//)
  assert.ok(result.previewIndex.signature)
  assert.ok(result.previewManifest.signature)
  assert.deepEqual(Object.keys(result.previewIndex).sort(), [
    'author', 'baseRef', 'channel', 'expiresAt', 'headSha', 'keyId', 'kind', 'manifestUrls', 'notes',
    'prNumber', 'publishedAt', 'repository', 'schemaVersion', 'sequence', 'signature', 'title'
  ].sort())
  assert.deepEqual(Object.keys(result.previewManifest).sort(), [
    'author', 'baseRef', 'channel', 'componentManifest', 'expiresAt', 'headSha', 'keyId', 'kind',
    'prNumber', 'publishedAt', 'repository', 'schemaVersion', 'sequence', 'signature', 'title'
  ].sort())
  await stat(path.join(output, 'component-feeds', 'pr-preview', 'latest.json'))
  await stat(path.join(output, 'component-feeds', 'pr-preview', 'manifests', `${headSha}.json`))
  assert.equal(result.cnbRequest.source.cloudToCloudOnly, true)
  assert.equal(result.cnbRequest.verification.downloadEveryAssetCompletely, true)
  assert.equal(result.cnbRequest.verification.requireExactSize, true)
  assert.equal(result.cnbRequest.verification.requireSha256, true)
  assert.equal(result.cnbRequest.verification.readBackFromCnbBeforePromotion, true)
  assert.equal(result.cnbRequest.promotion.manifestPath, `component-feeds/pr-preview/manifests/${headSha}.json`)
  assert.equal(result.cnbRequest.promotion.latestPath, 'component-feeds/pr-preview/latest.json')
  assert.equal(result.cnbRequest.promotion.allowedOnlyAfterEveryAssetVerified, true)
  assert.equal(result.cnbRequest.promotion.atomic, true)
  assert.deepEqual(result.cnbRequest.promotion.sourcePriority, ['cnb', 'github'])

  const verifierConfig = path.join(temp, 'preview-sources.json')
  const requestFile = path.join(output, 'cnb-mirror-request.json')
  const indexFile = path.join(output, 'component-feeds', 'pr-preview', 'latest.json')
  const manifestFile = path.join(output, 'component-feeds', 'pr-preview', 'manifests', `${headSha}.json`)
  await writeFile(verifierConfig, JSON.stringify({
    enabled: true,
    repository,
    trustedKeys: { 'harness-preview-test': publicKey.export({ type: 'spki', format: 'pem' }) }
  }))
  const { verifyPrPreviewFeedFiles } = await import('../scripts/pr-preview-verify-feed.mjs')
  const verifiedFeed = await verifyPrPreviewFeedFiles({
    configFile: verifierConfig,
    indexFile,
    manifestFile,
    requestFile,
    now: Date.parse('2026-08-25T00:01:00.000Z')
  })
  assert.equal(verifiedFeed.requestAssets, 3)

  const releaseAssets = path.join(temp, 'immutable-release-assets')
  const candidateArtifact = path.join(temp, 'candidate-artifact')
  await mkdir(releaseAssets)
  await mkdir(candidateArtifact)
  const auditFile = path.join(output, 'pr-preview-signing-audit.json')
  const audit = JSON.parse(await readFile(auditFile, 'utf8'))
  const immutableNames = [componentName, audit.manifestReleaseAsset, audit.indexReleaseAsset, 'pr-preview-signing-audit.json']
  const digestAssets = {}
  for (const name of immutableNames) {
    const sourceFile = path.join(output, name)
    const bytes = await readFile(sourceFile)
    digestAssets[name] = sha256(bytes)
    await copyFile(sourceFile, path.join(releaseAssets, name))
    await copyFile(sourceFile, path.join(candidateArtifact, name))
  }
  const digestsFile = path.join(temp, 'candidate-digests.json')
  await writeFile(digestsFile, JSON.stringify({ schemaVersion: 1, assets: digestAssets }))
  const evidence = {
    schemaVersion: 1,
    kind: 'harness-pr-preview-local-gate-evidence',
    result: 'passed',
    candidate: { immutableTag: audit.immutableTag, headSha, sequence: result.previewIndex.sequence, componentSha256: sha256(componentBytes) },
    baselineRelease: '1.0.44',
    activatedRelease: version,
    restoredRelease: '1.0.44',
    checks: { healthy: 'passed', rollback: 'passed' },
    createdAt: '2026-08-25T00:02:00.000Z'
  }
  const evidenceBytes = Buffer.from(JSON.stringify(evidence))
  const evidenceFile = path.join(temp, 'local-gate-evidence.json')
  await writeFile(evidenceFile, evidenceBytes)
  const evidenceSha256 = sha256(evidenceBytes)
  const signRunFile = path.join(temp, 'sign-run.json')
  await writeFile(signRunFile, JSON.stringify({
    id: 777,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    path: '.github/workflows/pr-preview-sign.yml',
    head_branch: 'main',
    repository: { full_name: repository }
  }))
  const { verifyPromotionCandidate } = await import('../scripts/pr-preview-promote-verify.mjs')
  const promotion = await verifyPromotionCandidate({
    configFile: verifierConfig,
    indexFile: path.join(releaseAssets, audit.indexReleaseAsset),
    manifestFile: path.join(releaseAssets, audit.manifestReleaseAsset),
    auditFile: path.join(releaseAssets, 'pr-preview-signing-audit.json'),
    evidenceFile,
    evidenceSha256,
    digestsFile,
    releaseAssetsRoot: releaseAssets,
    candidateArtifactRoot: candidateArtifact,
    pullRequestFile: prFile,
    signRunFile,
    signRunId: 777,
    defaultBranch: 'main',
    prNumber: pullRequest,
    headSha,
    immutableTag: audit.immutableTag,
    sequence: result.previewIndex.sequence,
    now: Date.parse('2026-08-25T00:03:00.000Z')
  })
  assert.equal(promotion.componentSha256, sha256(componentBytes))
  assert.equal(promotion.evidenceSha256, evidenceSha256)
  assert.equal(promotion.baselineRelease, promotion.restoredRelease)

  const { createCnbMirrorRequest } = await import('../scripts/pr-preview-cnb-request.mjs')
  const evidenceBoundRequest = await createCnbMirrorRequest({
    previewIndex: result.previewIndex,
    previewManifest: result.previewManifest,
    audit,
    assetsRoot: releaseAssets,
    githubRepository: repository,
    cnbProject: repository,
    gateEvidence: evidence,
    gateEvidenceSha256: evidenceSha256
  })
  assert.deepEqual(evidenceBoundRequest.localGateEvidence, { ...evidence, sha256: evidenceSha256 })
  await writeFile(evidenceFile, JSON.stringify({ ...evidence, checks: { healthy: 'passed', rollback: 'failed' } }))
  await assert.rejects(() => verifyPromotionCandidate({
    configFile: verifierConfig,
    indexFile: path.join(releaseAssets, audit.indexReleaseAsset),
    manifestFile: path.join(releaseAssets, audit.manifestReleaseAsset),
    auditFile: path.join(releaseAssets, 'pr-preview-signing-audit.json'),
    evidenceFile,
    evidenceSha256,
    digestsFile,
    releaseAssetsRoot: releaseAssets,
    candidateArtifactRoot: candidateArtifact,
    pullRequestFile: prFile,
    signRunFile,
    signRunId: 777,
    defaultBranch: 'main',
    prNumber: pullRequest,
    headSha,
    immutableTag: audit.immutableTag,
    sequence: result.previewIndex.sequence,
    now: Date.parse('2026-08-25T00:03:00.000Z')
  }), /证据 SHA-256 不匹配/)
  await writeFile(evidenceFile, evidenceBytes)

  const originalRequest = JSON.parse(await readFile(requestFile, 'utf8'))
  const tamperedRequest = structuredClone(originalRequest)
  tamperedRequest.assets[0].sha256 = '0'.repeat(64)
  await writeFile(requestFile, JSON.stringify(tamperedRequest))
  await assert.rejects(() => verifyPrPreviewFeedFiles({
    configFile: verifierConfig,
    indexFile,
    manifestFile,
    requestFile,
    now: Date.parse('2026-08-25T00:01:00.000Z')
  }), /镜像请求资产与签名 feed 不一致/)
  await writeFile(requestFile, JSON.stringify(originalRequest))

  const originalReport = JSON.parse(await readFile(path.join(input, 'pr-preview-build.json'), 'utf8'))
  const wrongConfigZip = new AdmZip()
  wrongConfigZip.addFile('component.json', Buffer.from(JSON.stringify({
    schemaVersion: 1, id: 'desktop-shell', version, target: 'shell', files: []
  })))
  wrongConfigZip.addFile('pr-preview-update-sources.json', Buffer.from('{"enabled":false,"trustedKeys":{}}\n'))
  const wrongConfigBytes = wrongConfigZip.toBuffer()
  const wrongConfigReport = structuredClone(originalReport)
  wrongConfigReport.component.size = wrongConfigBytes.length
  wrongConfigReport.component.sha256 = sha256(wrongConfigBytes)
  await writeFile(path.join(input, componentName), wrongConfigBytes)
  await writeFile(path.join(input, 'pr-preview-build.json'), JSON.stringify(wrongConfigReport))
  await assert.rejects(() => signPreview({
    runMetadataFile: runFile, pullRequestMetadataFile: prFile, stableReleaseMetadataFile: stableFile, trustedPreviewConfigFile,
    inputRoot: input, outputRoot: path.join(temp, 'wrong-config'), repository, prNumber: pullRequest, headSha,
    buildRunId, artifactName, keyFile, keyId: 'harness-preview-test', cnbProject: repository
  }), /公钥配置与受信任默认分支不一致/)
  await writeFile(path.join(input, componentName), componentBytes)
  await writeFile(path.join(input, 'pr-preview-build.json'), JSON.stringify(originalReport))

  await writeFile(path.join(input, 'pr-preview-build.json'), JSON.stringify({ ...originalReport, officialStableVersion: '1.0.43' }))
  await assert.rejects(() => signPreview({
    runMetadataFile: runFile, pullRequestMetadataFile: prFile, stableReleaseMetadataFile: stableFile, trustedPreviewConfigFile,
    inputRoot: input, outputRoot: path.join(temp, 'bad-stable'), repository, prNumber: pullRequest, headSha,
    buildRunId, artifactName, keyFile, keyId: 'harness-preview-test', cnbProject: repository
  }), /稳定基线/)

  const tampered = structuredClone(originalReport)
  tampered.component.sha256 = '0'.repeat(64)
  await writeFile(path.join(input, 'pr-preview-build.json'), JSON.stringify(tampered))
  await assert.rejects(() => signPreview({
    runMetadataFile: runFile, pullRequestMetadataFile: prFile, stableReleaseMetadataFile: stableFile, trustedPreviewConfigFile,
    inputRoot: input, outputRoot: path.join(temp, 'tampered'), repository, prNumber: pullRequest, headSha,
    buildRunId, artifactName, keyFile, keyId: 'harness-preview-test', cnbProject: repository
  }), /size\/SHA-256/)

  const wrongIndexZip = new AdmZip()
  wrongIndexZip.addFile('component.json', Buffer.from(JSON.stringify({
    schemaVersion: 1, id: 'desktop-shell', version: '1.0.41-pr.88.1', target: 'shell', files: []
  })))
  wrongIndexZip.addFile('pr-preview-update-sources.json', trustedPreviewConfigBytes)
  const wrongIndexBytes = wrongIndexZip.toBuffer()
  await writeFile(path.join(input, componentName), wrongIndexBytes)
  const wrongIndexReport = structuredClone(originalReport)
  wrongIndexReport.component.size = wrongIndexBytes.length
  wrongIndexReport.component.sha256 = sha256(wrongIndexBytes)
  await writeFile(path.join(input, 'pr-preview-build.json'), JSON.stringify(wrongIndexReport))
  await assert.rejects(() => signPreview({
    runMetadataFile: runFile, pullRequestMetadataFile: prFile, stableReleaseMetadataFile: stableFile, trustedPreviewConfigFile,
    inputRoot: input, outputRoot: path.join(temp, 'wrong-index'), repository, prNumber: pullRequest, headSha,
    buildRunId, artifactName, keyFile, keyId: 'harness-preview-test', cnbProject: repository
  }), /component index version/)
})

test('CNB request script contains no network or promotion implementation', async () => {
  const source = await load('scripts/pr-preview-cnb-request.mjs')
  assert.doesNotMatch(source, /\bfetch\s*\(|https\.request|child_process|spawn\s*\(/)
  assert.match(source, /allowedOnlyAfterEveryAssetVerified: true/)
  assert.match(source, /downloadEveryAssetCompletely: true/)
  assert.match(source, /requireExactSize: true/)
  assert.match(source, /requireSha256: true/)
})
