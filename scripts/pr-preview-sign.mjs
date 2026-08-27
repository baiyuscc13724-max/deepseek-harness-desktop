import path from 'node:path'
import process from 'node:process'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash, createPublicKey } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  normalizeOfficialStableVersion,
  OFFICIAL_REPOSITORY,
  PREVIEW_BUILD_WORKFLOW,
  previewSequence,
  previewVersion
} from './pr-preview-build.mjs'
export { OFFICIAL_REPOSITORY }

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')
const { COMPONENT_INDEX_FILE } = require('../electron/bridge/component-update-archive.cjs')
const { validateAndVerifyManifest } = require('../electron/bridge/component-update-contract.cjs')
const MAX_PREVIEW_ZIP_BYTES = 256 * 1024 * 1024
const MAX_COMPONENT_INDEX_BYTES = 256 * 1024
const MAX_PREVIEW_CONFIG_BYTES = 128 * 1024
const MAX_ZIP_ENTRIES = 20_002
const {
  assertIndexMatchesManifest,
  validateAndVerifyPreviewIndex,
  validateAndVerifyPreviewManifest
} = require('../electron/bridge/pr-preview-update-contract.cjs')
const { normalizeOfficialManifestUrls, normalizePrPreviewUpdateConfig } = require('../electron/bridge/pr-preview-update-config.cjs')
const { previewChangeNotes } = require('../electron/bridge/update-summary.cjs')
const {
  createSignedComponentDescriptor,
  createSignedReleaseManifest,
  privateEd25519Key,
  signCanonicalObject,
  writeSignedManifest
} = require('../electron/bridge/component-update-builder.cjs')

function argument(argv, name, fallback = '') {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

function exactInteger(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} 无效。`)
  return parsed
}

function exactSha(value, label = 'SHA') {
  const text = String(value || '').trim().toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(text)) throw new Error(`${label} 无效。`)
  return text
}

async function digestFile(file) {
  const bytes = await readFile(file)
  return createHash('sha256').update(bytes).digest('hex')
}

function trustedOfficialStableRelease(release) {
  if (!release || release.draft !== false || release.prerelease !== false || typeof release.published_at !== 'string') {
    throw new Error('GitHub latest release 不是已发布的稳定版本。')
  }
  return normalizeOfficialStableVersion(release.tag_name)
}

function exactZipEntry(entries, name, maxBytes, label) {
  const matches = entries.filter(entry => String(entry.entryName || '').toLowerCase() === name.toLowerCase())
  if (matches.length !== 1 || matches[0].isDirectory || matches[0].entryName !== name) throw new Error(`预览 ZIP 必须恰好包含一个精确命名的 ${name}。`)
  const entry = matches[0]
  const declaredSize = Number(entry.header?.size)
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > maxBytes) throw new Error(`预览 ZIP ${label}大小无效。`)
  const bytes = entry.getData()
  if (bytes.length !== declaredSize || bytes.length > maxBytes) throw new Error(`预览 ZIP ${label}解压大小不一致。`)
  return bytes
}

function readTrustedComponentMetadata(zipFile, expectedVersion, trustedConfigBytes) {
  const archive = new AdmZip(zipFile)
  const entries = archive.getEntries()
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) throw new Error('预览 ZIP 条目数量无效。')
  const indexBytes = exactZipEntry(entries, COMPONENT_INDEX_FILE, MAX_COMPONENT_INDEX_BYTES, '组件索引')
  const configBytes = exactZipEntry(entries, 'pr-preview-update-sources.json', MAX_PREVIEW_CONFIG_BYTES, '预览公钥配置')
  if (!configBytes.equals(trustedConfigBytes)) throw new Error('预览 ZIP 公钥配置与受信任默认分支不一致。')
  const index = JSON.parse(indexBytes.toString('utf8'))
  if (!index || index.schemaVersion !== 1 || index.id !== 'desktop-shell' || index.target !== 'shell' || index.version !== expectedVersion || !Array.isArray(index.files)) {
    throw new Error('预览 ZIP component index version/identity 与可信稳定基线不一致。')
  }
  return index
}

function githubReleaseBase(repository, tag) {
  return `https://github.com/${repository}/releases/download/${tag}`
}

function cnbReleaseBase(project, tag) {
  return `https://cnb.cool/${project}/-/releases/download/${tag}`
}

function manifestUrls(headSha) {
  return [
    `https://cnb.cool/${OFFICIAL_REPOSITORY}/-/git/raw/main/component-feeds/pr-preview/manifests/${headSha}.json`,
    `https://raw.githubusercontent.com/${OFFICIAL_REPOSITORY}/main/component-feeds/pr-preview/manifests/${headSha}.json`
  ]
}

function trustedPullRequest(pr, { repository, prNumber, headSha }) {
  if (!pr || Number(pr.number) !== prNumber) throw new Error('GitHub PR 元数据编号不匹配。')
  if (pr.state !== 'open' || pr.draft === true || pr.merged_at) throw new Error('只能签署仍开放、非 draft、未合并的官方 PR。')
  if (String(pr.head?.sha || '').toLowerCase() !== headSha) throw new Error('GitHub PR 当前 head SHA 与审批值不一致。')
  if (String(pr.head?.repo?.full_name || '').toLowerCase() !== repository.toLowerCase() || pr.head?.repo?.fork === true) throw new Error('GitHub PR 不是官方同仓库分支。')
  if (pr.base?.ref !== 'main' || String(pr.base?.repo?.full_name || '').toLowerCase() !== repository.toLowerCase()) throw new Error('GitHub PR baseRef 必须是官方 main。')
  const title = String(pr.title || '').trim()
  if (!title || Array.from(title).length > 200 || Buffer.byteLength(title, 'utf8') > 512 || /[\u0000-\u001f\u007f]/.test(title)) throw new Error('GitHub PR title 无效。')
  const author = String(pr.user?.login || '').trim().toLowerCase()
  if (!/^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(author)) throw new Error('GitHub PR author login 无效。')
  const changeNotes = previewChangeNotes({ title, body: pr.body })
  return { prNumber, title, author, baseRef: 'main', changeNotes }
}

export function validateTrustedBuildRun(run, expected) {
  if (!run || typeof run !== 'object') throw new Error('GitHub run 元数据无效。')
  const repository = String(run.repository?.full_name || '').toLowerCase()
  const headRepository = String(run.head_repository?.full_name || '').toLowerCase()
  if (repository !== expected.repository.toLowerCase() || repository !== OFFICIAL_REPOSITORY) throw new Error('run 不属于固定官方仓库。')
  if (headRepository !== repository) throw new Error('run 来自 fork，拒绝签名。')
  if (run.event !== 'pull_request' || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('run 不是成功完成的 pull_request 构建。')
  if (String(run.path || '').replace(/^\//, '') !== PREVIEW_BUILD_WORKFLOW) throw new Error('run workflow 身份不匹配。')
  if (exactSha(run.head_sha, 'run head SHA') !== expected.headSha) throw new Error('run head SHA 与审批输入不一致。')
  if (!Array.isArray(run.pull_requests) || !run.pull_requests.some(item => Number(item.number) === expected.prNumber)) throw new Error('run 未绑定审批的 PR。')
  if (exactInteger(run.id, 'run id') !== expected.buildRunId) throw new Error('run id 与审批输入不一致。')
  return {
    runNumber: exactInteger(run.run_number, 'run number'),
    runAttempt: exactInteger(run.run_attempt || 1, 'run attempt'),
    publishedAt: new Date(run.updated_at || run.run_started_at).toISOString()
  }
}

export async function signPreview(options) {
  const repository = String(options.repository || '').trim()
  if (repository.toLowerCase() !== OFFICIAL_REPOSITORY) throw new Error('只允许固定官方仓库。')
  const headSha = exactSha(options.headSha, '审批 head SHA')
  const prNumber = exactInteger(options.prNumber ?? options.pullRequest, 'PR 编号')
  const buildRunId = exactInteger(options.buildRunId, 'build run id')
  const [run, pr, stableRelease] = await Promise.all([
    readFile(path.resolve(options.runMetadataFile), 'utf8').then(JSON.parse),
    readFile(path.resolve(options.pullRequestMetadataFile), 'utf8').then(JSON.parse),
    readFile(path.resolve(options.stableReleaseMetadataFile), 'utf8').then(JSON.parse)
  ])
  const trustedRun = validateTrustedBuildRun(run, { repository, headSha, prNumber, buildRunId })
  const prIdentity = trustedPullRequest(pr, { repository, prNumber, headSha })
  const { changeNotes, ...signedPrIdentity } = prIdentity
  const officialStableVersion = trustedOfficialStableRelease(stableRelease)
  const expectedPreviewVersion = previewVersion(officialStableVersion, trustedRun.runNumber, trustedRun.runAttempt)
  const expectedPreviewSequence = previewSequence(trustedRun.runNumber, trustedRun.runAttempt)
  const trustedPreviewConfigBytes = await readFile(path.resolve(options.trustedPreviewConfigFile))
  if (trustedPreviewConfigBytes.length <= 0 || trustedPreviewConfigBytes.length > MAX_PREVIEW_CONFIG_BYTES) throw new Error('受信任预览公钥配置大小无效。')
  const trustedPreviewConfig = normalizePrPreviewUpdateConfig(JSON.parse(trustedPreviewConfigBytes.toString('utf8')))
  const inputRoot = path.resolve(options.inputRoot)
  const outputRoot = path.resolve(options.outputRoot)
  const report = JSON.parse(await readFile(path.join(inputRoot, 'pr-preview-build.json'), 'utf8'))
  const expectedArtifactName = `pr-preview-unsigned-${prNumber}-${headSha}`
  if (report.schemaVersion !== 1 || report.kind !== 'harness-pr-preview-unsigned' || report.workflow !== PREVIEW_BUILD_WORKFLOW) throw new Error('无签名构建信封协议无效。')
  if (report.artifactName !== expectedArtifactName || options.artifactName !== expectedArtifactName) throw new Error('artifact 名称未精确绑定 PR/head SHA。')
  if (report.repository !== repository || report.headRepository !== repository || report.fork !== false) throw new Error('构建信封不是官方同仓库、非 fork 产物。')
  if (report.pullRequest !== prNumber || report.headSha !== headSha) throw new Error('构建信封与审批 PR/head SHA 不一致。')
  if (report.officialStableVersion !== officialStableVersion || report.buildRunNumber !== trustedRun.runNumber || report.buildSequence !== expectedPreviewSequence || report.buildAttempt !== trustedRun.runAttempt) {
    throw new Error('构建信封的官方稳定基线或 run/sequence/attempt 与签名侧独立查询不一致。')
  }
  if (report.previewVersion !== expectedPreviewVersion || report.component?.indexVersion !== expectedPreviewVersion) {
    throw new Error('构建信封 preview/component index version 与可信稳定基线不一致。')
  }
  if (!/^(win32-x64|darwin-x64|darwin-arm64)$/.test(report.target)) throw new Error('构建目标无效。')
  if (!report.component || report.component.id !== 'desktop-shell' || report.component.target !== 'shell') throw new Error('构建组件身份无效。')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,180}\.zip$/.test(report.component.name)) throw new Error('组件资产名无效。')
  const inputComponent = path.join(inputRoot, report.component.name)
  const inputInfo = await stat(inputComponent)
  if (!inputInfo.isFile() || inputInfo.size <= 0 || inputInfo.size > MAX_PREVIEW_ZIP_BYTES) throw new Error('artifact 内预览 ZIP 大小无效。')
  const inputSha256 = await digestFile(inputComponent)
  if (inputInfo.size !== report.component.size || inputSha256 !== report.component.sha256) throw new Error('artifact 内组件的完整 size/SHA-256 校验失败。')
  if (!Number.isSafeInteger(report.component.unpackedSize) || report.component.unpackedSize <= 0) throw new Error('组件解压大小无效。')
  const componentIndex = readTrustedComponentMetadata(inputComponent, expectedPreviewVersion, trustedPreviewConfigBytes)
  if (componentIndex.version !== report.component.indexVersion) throw new Error('ZIP component index version 与构建报告不一致。')

  const keyId = String(options.keyId || '').trim()
  if (!/^harness-preview-[A-Za-z0-9._-]{2,48}$/.test(keyId)) throw new Error('必须使用独立 harness-preview-* keyId。')
  const privateKey = privateEd25519Key(await readFile(path.resolve(options.keyFile), 'utf8'))
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
  const configuredPublicKey = trustedPreviewConfig.trustedKeys[keyId]
  if (!trustedPreviewConfig.enabled || !configuredPublicKey) throw new Error('受信任默认分支尚未启用当前 PR 预览公钥。')
  const configuredSpki = createPublicKey(configuredPublicKey).export({ type: 'spki', format: 'der' })
  const signingSpki = createPublicKey(publicKey).export({ type: 'spki', format: 'der' })
  if (!configuredSpki.equals(signingSpki)) throw new Error('签名私钥与受信任默认分支预览公钥不匹配。')
  const cnbProject = String(options.cnbProject || '').trim()
  if (cnbProject !== OFFICIAL_REPOSITORY) throw new Error('CNB 项目必须是固定官方镜像项目。')
  const immutableTag = `pr-preview-${prNumber}-${headSha.slice(0, 12)}-run-${buildRunId}-${trustedRun.runAttempt}`
  const githubBase = githubReleaseBase(repository, immutableTag)
  const cnbBase = cnbReleaseBase(cnbProject, immutableTag)
  await mkdir(outputRoot, { recursive: true, mode: 0o700 })
  const outputComponent = path.join(outputRoot, report.component.name)
  await copyFile(inputComponent, outputComponent)

  const component = createSignedComponentDescriptor({
    id: report.component.id,
    version: expectedPreviewVersion,
    target: report.component.target,
    platform: report.component.platform,
    arch: report.component.arch,
    archive: { size: report.component.size, unpackedSize: report.component.unpackedSize, sha256: report.component.sha256 },
    urls: [`${cnbBase}/${encodeURIComponent(report.component.name)}`, `${githubBase}/${encodeURIComponent(report.component.name)}`],
    required: true,
    restart: true
  }, privateKey)
  if (component.version !== expectedPreviewVersion || component.version !== componentIndex.version) throw new Error('签名组件描述符 version 与 ZIP index 不一致。')
  const publishedAt = new Date(options.publishedAt || trustedRun.publishedAt)
  if (!Number.isFinite(publishedAt.getTime())) throw new Error('签名发布时间无效。')
  const publishedIso = publishedAt.toISOString()
  const expiresAt = new Date(publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const componentManifest = createSignedReleaseManifest({
    releaseVersion: expectedPreviewVersion,
    channel: 'prerelease',
    publishedAt,
    keyId,
    bootstrap: { minVersion: officialStableVersion },
    components: [component],
    notes: changeNotes
  }, privateKey)
  const trustedKeys = { [keyId]: publicKey }
  validateAndVerifyManifest(componentManifest, trustedKeys, { now: Math.max(Date.now(), publishedAt.getTime()) })

  const common = {
    schemaVersion: 1,
    repository,
    channel: 'pr-preview',
    ...signedPrIdentity,
    headSha,
    sequence: expectedPreviewSequence,
    publishedAt: publishedIso,
    expiresAt,
    keyId
  }
  const previewManifest = signCanonicalObject({ ...common, kind: 'pr-preview-manifest', componentManifest }, privateKey)
  const previewIndex = signCanonicalObject({
    ...common,
    kind: 'pr-preview-index',
    manifestUrls: manifestUrls(headSha),
    notes: changeNotes
  }, privateKey)
  const now = Math.max(Date.now(), publishedAt.getTime())
  const verifiedIndex = validateAndVerifyPreviewIndex(previewIndex, trustedKeys, { now, normalizeManifestUrls: normalizeOfficialManifestUrls })
  const verifiedManifest = validateAndVerifyPreviewManifest(previewManifest, trustedKeys, { now })
  assertIndexMatchesManifest(verifiedIndex, verifiedManifest)

  const manifestReleaseAsset = `pr-preview-manifest-${headSha}.json`
  const indexReleaseAsset = `pr-preview-index-${headSha}.json`
  const feedManifestFile = path.join(outputRoot, manifestReleaseAsset)
  const feedIndexFile = path.join(outputRoot, indexReleaseAsset)
  await writeSignedManifest(feedManifestFile, previewManifest)
  await writeSignedManifest(feedIndexFile, previewIndex)
  const feedReleaseAssets = []
  for (const name of [manifestReleaseAsset, indexReleaseAsset]) {
    const info = await stat(path.join(outputRoot, name))
    feedReleaseAssets.push({ name, size: info.size, sha256: await digestFile(path.join(outputRoot, name)) })
  }
  const audit = {
    schemaVersion: 1,
    kind: 'harness-pr-preview-signing-audit',
    repository,
    prNumber,
    headSha,
    buildRunId,
    runAttempt: trustedRun.runAttempt,
    immutableTag,
    artifactName: expectedArtifactName,
    officialStableVersion,
    previewVersion: expectedPreviewVersion,
    manifestReleaseAsset,
    indexReleaseAsset,
    feedReleaseAssets
  }
  await writeFile(path.join(outputRoot, 'pr-preview-signing-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return { immutableTag, previewIndex, previewManifest, componentName: report.component.name, feedIndexFile, feedManifestFile }
}

async function main() {
  const argv = process.argv.slice(2)
  const required = ['run-metadata', 'pull-request-metadata', 'stable-release-metadata', 'trusted-preview-config', 'input', 'out', 'repository', 'pr-number', 'head-sha', 'build-run-id', 'artifact-name', 'key-file', 'key-id', 'cnb-project']
  for (const name of required) if (!argument(argv, name)) throw new Error(`--${name} 是必需参数。`)
  const result = await signPreview({
    runMetadataFile: argument(argv, 'run-metadata'),
    pullRequestMetadataFile: argument(argv, 'pull-request-metadata'),
    stableReleaseMetadataFile: argument(argv, 'stable-release-metadata'),
    trustedPreviewConfigFile: argument(argv, 'trusted-preview-config'),
    inputRoot: argument(argv, 'input'),
    outputRoot: argument(argv, 'out'),
    repository: argument(argv, 'repository'),
    prNumber: argument(argv, 'pr-number'),
    headSha: argument(argv, 'head-sha'),
    buildRunId: argument(argv, 'build-run-id'),
    artifactName: argument(argv, 'artifact-name'),
    keyFile: argument(argv, 'key-file'),
    keyId: argument(argv, 'key-id'),
    cnbProject: argument(argv, 'cnb-project'),
    publishedAt: argument(argv, 'published-at')
  })
  console.log(JSON.stringify({ ok: true, immutableTag: result.immutableTag, index: result.feedIndexFile, manifest: result.feedManifestFile, component: result.componentName }, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
