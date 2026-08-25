import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const {
  assertIndexMatchesManifest,
  validateAndVerifyPreviewIndex,
  validateAndVerifyPreviewManifest
} = require('../electron/bridge/pr-preview-update-contract.cjs')
const {
  normalizeOfficialManifestUrls,
  normalizePrPreviewUpdateConfig
} = require('../electron/bridge/pr-preview-update-config.cjs')

const OFFICIAL_REPOSITORY = 'baiyuscc13724-max/deepseek-harness-desktop'
const SIGN_WORKFLOW = '.github/workflows/pr-preview-sign.yml'
const EVIDENCE_KIND = 'harness-pr-preview-local-gate-evidence'
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const HEAD_PATTERN = /^[0-9a-f]{40}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-pr\.\d+\.\d+)?$/

function argument(argv, name, fallback = '') {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象。`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} 字段集合无效。`)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readJson(file, label) {
  try { return JSON.parse(await readFile(path.resolve(file), 'utf8')) }
  catch (error) { throw new Error(`${label} 无法读取：${error.message}`) }
}

async function assertRootFiles(root, expectedNames, label) {
  const entries = await readdir(path.resolve(root), { withFileTypes: true })
  const files = entries.filter(entry => entry.isFile()).map(entry => entry.name).sort()
  if (JSON.stringify(files) !== JSON.stringify([...expectedNames].sort())) throw new Error(`${label} 资产集合不精确。`)
}

async function verifyFile(root, name, expectedDigest) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,180}$/.test(name) || !SHA256_PATTERN.test(expectedDigest)) {
    throw new Error(`候选资产身份无效：${name}`)
  }
  const file = path.join(path.resolve(root), name)
  const [bytes, info] = await Promise.all([readFile(file), stat(file)])
  if (!info.isFile() || sha256(bytes) !== expectedDigest) throw new Error(`候选资产 SHA-256 不匹配：${name}`)
  return { file, bytes, size: info.size, sha256: expectedDigest }
}

function releaseAssetName(urlValue) {
  const url = new URL(String(urlValue || ''))
  const prefix = `/baiyuscc13724-max/deepseek-harness-desktop/releases/download/`
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(prefix)) throw new Error('组件 GitHub release URL 无效。')
  const parts = url.pathname.slice(prefix.length).split('/').map(decodeURIComponent)
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('组件 GitHub release 身份无效。')
  return { tag: parts[0], name: parts[1] }
}

function validatePullRequest(pr, { prNumber, headSha }) {
  if (
    pr?.number !== prNumber || pr.state !== 'open' || pr.draft !== false || pr.merged_at !== null ||
    pr.head?.sha !== headSha || pr.head?.repo?.full_name !== OFFICIAL_REPOSITORY || pr.head?.repo?.fork !== false ||
    pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== OFFICIAL_REPOSITORY
  ) throw new Error('提升时 PR 已关闭、为 draft、已合并或 head 身份发生变化。')
}

function validateSignRun(run, { signRunId, defaultBranch }) {
  if (
    run?.id !== signRunId || run.event !== 'workflow_dispatch' || run.status !== 'completed' || run.conclusion !== 'success' ||
    run.path !== SIGN_WORKFLOW || run.head_branch !== defaultBranch || run.repository?.full_name !== OFFICIAL_REPOSITORY
  ) throw new Error('签名 workflow run 身份或状态无效。')
}

function validateEvidence(evidence, { evidenceSha256, evidenceBytes, immutableTag, headSha, sequence, componentSha256, audit, index, now }) {
  exactKeys(evidence, ['schemaVersion', 'kind', 'result', 'candidate', 'baselineRelease', 'activatedRelease', 'restoredRelease', 'checks', 'createdAt'], '本机 gate 证据')
  exactKeys(evidence.candidate, ['immutableTag', 'headSha', 'sequence', 'componentSha256'], '本机 gate 候选')
  exactKeys(evidence.checks, ['healthy', 'rollback'], '本机 gate 检查')
  if (!SHA256_PATTERN.test(evidenceSha256) || sha256(evidenceBytes) !== evidenceSha256) throw new Error('本机 gate 证据 SHA-256 不匹配。')
  if (evidence.schemaVersion !== 1 || evidence.kind !== EVIDENCE_KIND || evidence.result !== 'passed') throw new Error('本机 gate 证据没有通过。')
  if (
    evidence.candidate.immutableTag !== immutableTag || evidence.candidate.headSha !== headSha ||
    evidence.candidate.sequence !== sequence || evidence.candidate.componentSha256 !== componentSha256
  ) throw new Error('本机 gate 证据候选身份不一致。')
  if (
    !VERSION_PATTERN.test(evidence.baselineRelease) || evidence.baselineRelease !== audit.officialStableVersion ||
    evidence.activatedRelease !== audit.previewVersion || evidence.restoredRelease !== evidence.baselineRelease
  ) throw new Error('本机 gate 的 baseline、activated 或 restored release 不一致。')
  if (evidence.checks.healthy !== 'passed' || evidence.checks.rollback !== 'passed') throw new Error('本机 healthy/rollback gate 未通过。')
  const createdAt = Date.parse(evidence.createdAt)
  if (!Number.isFinite(createdAt) || createdAt < Date.parse(index.publishedAt) || createdAt > now + 5 * 60 * 1000 || createdAt > Date.parse(index.expiresAt)) {
    throw new Error('本机 gate 证据 createdAt 无效。')
  }
}

export async function verifyPromotionCandidate({
  configFile,
  indexFile,
  manifestFile,
  auditFile,
  evidenceFile,
  evidenceSha256,
  digestsFile,
  releaseAssetsRoot,
  candidateArtifactRoot,
  pullRequestFile,
  signRunFile,
  signRunId,
  defaultBranch,
  prNumber,
  headSha,
  immutableTag,
  sequence,
  currentIndexFiles = [],
  now = Date.now()
}) {
  if (!Number.isSafeInteger(signRunId) || signRunId < 1 || !Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('run/PR 编号无效。')
  if (!HEAD_PATTERN.test(headSha) || !Number.isSafeInteger(sequence) || sequence < 1) throw new Error('head/sequence 输入无效。')
  const [configPayload, indexPayload, manifestPayload, audit, evidenceBytes, digests, pr, signRun] = await Promise.all([
    readJson(configFile, '预览公钥配置'),
    readJson(indexFile, '签名 index'),
    readJson(manifestFile, '签名 manifest'),
    readJson(auditFile, '签名审计'),
    readFile(path.resolve(evidenceFile)),
    readJson(digestsFile, '候选 digest 清单'),
    readJson(pullRequestFile, 'PR 元数据'),
    readJson(signRunFile, '签名 run 元数据')
  ])
  const config = normalizePrPreviewUpdateConfig(configPayload)
  if (!config.enabled || Object.keys(config.trustedKeys).length === 0) throw new Error('PR 预览生产公钥尚未配置。')
  const index = validateAndVerifyPreviewIndex(indexPayload, config.trustedKeys, { now, normalizeManifestUrls: normalizeOfficialManifestUrls })
  const manifest = validateAndVerifyPreviewManifest(manifestPayload, config.trustedKeys, { now })
  assertIndexMatchesManifest(index, manifest)
  if (index.repository !== OFFICIAL_REPOSITORY || index.prNumber !== prNumber || index.headSha !== headSha || index.sequence !== sequence) {
    throw new Error('提升输入与签名 index 身份不一致。')
  }
  if (!new RegExp(`^pr-preview-${prNumber}-${headSha.slice(0, 12)}-run-[1-9]\\d*-[1-9]\\d*$`).test(immutableTag)) throw new Error('不可变候选 Tag 无效。')
  validatePullRequest(pr, { prNumber, headSha })
  validateSignRun(signRun, { signRunId, defaultBranch })
  if (
    audit?.schemaVersion !== 1 || audit.kind !== 'harness-pr-preview-signing-audit' || audit.repository !== OFFICIAL_REPOSITORY ||
    audit.prNumber !== prNumber || audit.headSha !== headSha || audit.immutableTag !== immutableTag || audit.previewVersion !== manifest.componentManifest.releaseVersion
  ) throw new Error('签名审计与候选身份不一致。')

  const components = manifest.componentManifest.components
  if (!Array.isArray(components) || components.length !== 1) throw new Error('当前提升合同只接受一个 desktop-shell 组件。')
  const component = components[0]
  const githubAsset = releaseAssetName(component.urls?.[1])
  if (githubAsset.tag !== immutableTag || component.id !== 'desktop-shell' || !SHA256_PATTERN.test(component.sha256)) throw new Error('组件候选身份无效。')
  exactKeys(digests, ['schemaVersion', 'assets'], '候选 digest 清单')
  if (digests.schemaVersion !== 1) throw new Error('候选 digest schemaVersion 无效。')
  const expectedNames = [githubAsset.name, audit.manifestReleaseAsset, audit.indexReleaseAsset, 'pr-preview-signing-audit.json'].sort()
  exactKeys(digests.assets, expectedNames, '候选 digest 资产')
  if (digests.assets[githubAsset.name] !== component.sha256) throw new Error('组件 digest 输入与签名 manifest 不一致。')
  const feedByName = new Map((audit.feedReleaseAssets || []).map(item => [item.name, item]))
  for (const name of [audit.manifestReleaseAsset, audit.indexReleaseAsset]) {
    const item = feedByName.get(name)
    if (!item || digests.assets[name] !== item.sha256) throw new Error(`feed digest 输入与签名审计不一致：${name}`)
  }
  await assertRootFiles(releaseAssetsRoot, expectedNames, 'GitHub immutable release')
  await assertRootFiles(candidateArtifactRoot, expectedNames, '签名恢复 artifact')
  for (const name of expectedNames) {
    const releaseAsset = await verifyFile(releaseAssetsRoot, name, digests.assets[name])
    const recoveryAsset = await verifyFile(candidateArtifactRoot, name, digests.assets[name])
    if (releaseAsset.size !== recoveryAsset.size) throw new Error(`release 与恢复 artifact 大小不一致：${name}`)
  }
  const indexBytes = await readFile(path.resolve(indexFile))
  const manifestBytes = await readFile(path.resolve(manifestFile))
  if (sha256(indexBytes) !== digests.assets[audit.indexReleaseAsset] || sha256(manifestBytes) !== digests.assets[audit.manifestReleaseAsset]) {
    throw new Error('签名 feed 文件与候选 digest 不一致。')
  }
  const evidence = JSON.parse(evidenceBytes.toString('utf8'))
  validateEvidence(evidence, { evidenceSha256, evidenceBytes, immutableTag, headSha, sequence, componentSha256: component.sha256, audit, index, now })

  for (const file of currentIndexFiles.filter(Boolean)) {
    const currentPayload = await readJson(file, '当前预览 index')
    const current = validateAndVerifyPreviewIndex(currentPayload, config.trustedKeys, { now, normalizeManifestUrls: normalizeOfficialManifestUrls })
    if (index.sequence < current.sequence || (index.sequence === current.sequence && JSON.stringify(indexPayload) !== JSON.stringify(currentPayload))) {
      throw new Error('预览 sequence 回退或同序列候选冲突。')
    }
  }
  return {
    ok: true,
    repository: OFFICIAL_REPOSITORY,
    signRunId,
    prNumber,
    headSha,
    immutableTag,
    sequence,
    componentName: githubAsset.name,
    componentSha256: component.sha256,
    evidenceSha256,
    evidenceCreatedAt: evidence.createdAt,
    baselineRelease: evidence.baselineRelease,
    activatedRelease: evidence.activatedRelease,
    restoredRelease: evidence.restoredRelease
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const required = ['config', 'index', 'manifest', 'audit', 'evidence', 'evidence-sha256', 'digests', 'release-assets', 'candidate-artifact', 'pull-request', 'sign-run', 'sign-run-id', 'default-branch', 'pr-number', 'head-sha', 'immutable-tag', 'sequence']
  for (const name of required) if (!argument(argv, name)) throw new Error(`--${name} 是必需参数。`)
  const currentIndexFiles = [argument(argv, 'current-cnb-index'), argument(argv, 'current-github-index')].filter(Boolean)
  const result = await verifyPromotionCandidate({
    configFile: argument(argv, 'config'),
    indexFile: argument(argv, 'index'),
    manifestFile: argument(argv, 'manifest'),
    auditFile: argument(argv, 'audit'),
    evidenceFile: argument(argv, 'evidence'),
    evidenceSha256: argument(argv, 'evidence-sha256'),
    digestsFile: argument(argv, 'digests'),
    releaseAssetsRoot: argument(argv, 'release-assets'),
    candidateArtifactRoot: argument(argv, 'candidate-artifact'),
    pullRequestFile: argument(argv, 'pull-request'),
    signRunFile: argument(argv, 'sign-run'),
    signRunId: Number(argument(argv, 'sign-run-id')),
    defaultBranch: argument(argv, 'default-branch'),
    prNumber: Number(argument(argv, 'pr-number')),
    headSha: argument(argv, 'head-sha'),
    immutableTag: argument(argv, 'immutable-tag'),
    sequence: Number(argument(argv, 'sequence')),
    currentIndexFiles
  })
  const output = argument(argv, 'out')
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
