import path from 'node:path'
import process from 'node:process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

function argument(argv, name, fallback = '') {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

async function sha256File(file) {
  const bytes = await readFile(file)
  return createHash('sha256').update(bytes).digest('hex')
}

function assertHttps(value, label) {
  const parsed = new URL(String(value || ''))
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`${label} 必须是无凭据、无查询、无片段的 HTTPS URL。`)
  return parsed.toString()
}

async function checkedAsset(assetsRoot, item) {
  if (!item || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,180}$/.test(item.name)) throw new Error('镜像资产名称无效。')
  const file = path.join(assetsRoot, item.name)
  const info = await stat(file)
  const digest = await sha256File(file)
  if (!info.isFile() || info.size !== item.size || digest !== item.sha256) throw new Error(`本地签名资产校验失败：${item.name}`)
  return { name: item.name, size: item.size, sha256: item.sha256 }
}

export async function createCnbMirrorRequest({ previewIndex, previewManifest, audit, assetsRoot, githubRepository, cnbProject, gateEvidence = null, gateEvidenceSha256 = '' }) {
  if (previewIndex?.kind !== 'pr-preview-index' || previewManifest?.kind !== 'pr-preview-manifest') throw new Error('预览 index/wrapper 无效。')
  const repository = String(githubRepository || '').trim()
  if (previewIndex.repository !== repository || previewManifest.repository !== repository) throw new Error('CNB 请求仓库与签名 feed 不一致。')
  const project = String(cnbProject || '').trim()
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(project)) throw new Error('CNB 项目标识无效。')
  const immutableTag = String(audit?.immutableTag || '')
  if (!new RegExp(`^pr-preview-${previewIndex.prNumber}-${previewIndex.headSha.slice(0, 12)}-run-[1-9]\\d*-[1-9]\\d*$`).test(immutableTag)) throw new Error('CNB 请求 immutable tag 无效。')

  const assets = []
  for (const component of previewManifest.componentManifest.components) {
    const cnbUrl = assertHttps(component.urls?.[0], `${component.id} CNB 目标`)
    const githubUrl = assertHttps(component.urls?.[1], `${component.id} GitHub 源`)
    const name = decodeURIComponent(new URL(githubUrl).pathname.split('/').pop())
    const checked = await checkedAsset(assetsRoot, { name, size: component.size, sha256: component.sha256 })
    assets.push({ ...checked, sourceUrl: githubUrl, targetUrl: cnbUrl })
  }
  for (const item of audit.feedReleaseAssets || []) {
    const checked = await checkedAsset(assetsRoot, item)
    assets.push({
      ...checked,
      sourceUrl: assertHttps(`https://github.com/${repository}/releases/download/${immutableTag}/${encodeURIComponent(item.name)}`, `${item.name} GitHub 源`),
      targetUrl: assertHttps(`https://cnb.cool/${project}/-/releases/download/${immutableTag}/${encodeURIComponent(item.name)}`, `${item.name} CNB 目标`)
    })
  }
  if (!assets.length || new Set(assets.map(asset => asset.name)).size !== assets.length) throw new Error('CNB 请求资产为空或重复。')

  let localGateEvidence
  if (gateEvidence !== null) {
    if (!/^[0-9a-f]{64}$/.test(gateEvidenceSha256) || gateEvidence?.schemaVersion !== 1 || gateEvidence.kind !== 'harness-pr-preview-local-gate-evidence' || gateEvidence.result !== 'passed') {
      throw new Error('本机 gate 证据或 SHA-256 无效。')
    }
    if (
      gateEvidence.candidate?.immutableTag !== immutableTag || gateEvidence.candidate?.headSha !== previewIndex.headSha ||
      gateEvidence.candidate?.sequence !== previewIndex.sequence || gateEvidence.candidate?.componentSha256 !== previewManifest.componentManifest.components[0]?.sha256 ||
      gateEvidence.checks?.healthy !== 'passed' || gateEvidence.checks?.rollback !== 'passed' ||
      gateEvidence.restoredRelease !== gateEvidence.baselineRelease
    ) throw new Error('本机 gate 证据与 CNB 候选身份不一致。')
    localGateEvidence = {
      schemaVersion: gateEvidence.schemaVersion,
      kind: gateEvidence.kind,
      result: gateEvidence.result,
      sha256: gateEvidenceSha256,
      candidate: { ...gateEvidence.candidate },
      baselineRelease: gateEvidence.baselineRelease,
      activatedRelease: gateEvidence.activatedRelease,
      restoredRelease: gateEvidence.restoredRelease,
      checks: { ...gateEvidence.checks },
      createdAt: gateEvidence.createdAt
    }
  }

  return {
    schemaVersion: 1,
    kind: 'harness-pr-preview-cnb-cloud-mirror-request',
    repository,
    cnbProject: project,
    prNumber: previewIndex.prNumber,
    headSha: previewIndex.headSha,
    buildRunId: audit.buildRunId,
    runAttempt: audit.runAttempt,
    immutableTag,
    ...(localGateEvidence ? { localGateEvidence } : {}),
    source: { provider: 'github-release', cloudToCloudOnly: true },
    assets,
    verification: {
      downloadEveryAssetCompletely: true,
      requireExactSize: true,
      requireSha256: true,
      rejectPartialOrExtraAssets: true,
      readBackFromCnbBeforePromotion: true
    },
    promotion: {
      manifestPath: `component-feeds/pr-preview/manifests/${previewIndex.headSha}.json`,
      latestPath: 'component-feeds/pr-preview/latest.json',
      signedManifestAsset: audit.manifestReleaseAsset,
      signedIndexAsset: audit.indexReleaseAsset,
      allowedOnlyAfterEveryAssetVerified: true,
      atomic: true,
      sourcePriority: ['cnb', 'github']
    }
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const indexFile = path.resolve(argument(argv, 'index'))
  const manifestFile = path.resolve(argument(argv, 'manifest'))
  const auditFile = path.resolve(argument(argv, 'audit'))
  const assetsRoot = path.resolve(argument(argv, 'assets'))
  const output = path.resolve(argument(argv, 'out'))
  const evidenceFileValue = argument(argv, 'evidence')
  const evidenceSha256 = argument(argv, 'evidence-sha256')
  if (!argument(argv, 'index') || !argument(argv, 'manifest') || !argument(argv, 'audit') || !argument(argv, 'assets') || !argument(argv, 'out') || !evidenceFileValue || !evidenceSha256) {
    throw new Error('--index、--manifest、--audit、--assets、--evidence、--evidence-sha256 和 --out 是必需参数。')
  }
  const [previewIndex, previewManifest, audit, gateEvidence] = await Promise.all([
    readFile(indexFile, 'utf8').then(JSON.parse),
    readFile(manifestFile, 'utf8').then(JSON.parse),
    readFile(auditFile, 'utf8').then(JSON.parse),
    readFile(path.resolve(evidenceFileValue), 'utf8').then(JSON.parse)
  ])
  const request = await createCnbMirrorRequest({
    previewIndex,
    previewManifest,
    audit,
    assetsRoot,
    githubRepository: argument(argv, 'github-repository', previewIndex.repository),
    cnbProject: argument(argv, 'cnb-project'),
    gateEvidence,
    gateEvidenceSha256: evidenceSha256
  })
  await writeFile(output, `${JSON.stringify(request, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  console.log(JSON.stringify({ ok: true, output, assets: request.assets.length }, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
