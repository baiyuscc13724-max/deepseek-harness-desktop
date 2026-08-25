import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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

function argument(argv, name) {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : ''
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function releaseIdentity(urlValue) {
  const url = new URL(urlValue)
  const parts = url.pathname.split('/').filter(Boolean)
  const download = parts.lastIndexOf('download')
  if (download < 0 || parts.length !== download + 3) throw new Error('PR 预览 release 资产 URL 无效。')
  return {
    tag: decodeURIComponent(parts[download + 1]),
    name: decodeURIComponent(parts[download + 2])
  }
}

function exactAsset(value, expected) {
  return value &&
    value.name === expected.name &&
    value.size === expected.size &&
    value.sha256 === expected.sha256 &&
    value.sourceUrl === expected.sourceUrl &&
    value.targetUrl === expected.targetUrl
}

async function verifyCnbRequest({ requestFile, indexFile, manifestFile, index, manifest }) {
  const [request, indexBytes, manifestBytes] = await Promise.all([
    readFile(path.resolve(requestFile), 'utf8').then(JSON.parse),
    readFile(path.resolve(indexFile)),
    readFile(path.resolve(manifestFile))
  ])
  if (
    request?.schemaVersion !== 1 ||
    request.kind !== 'harness-pr-preview-cnb-cloud-mirror-request' ||
    request.repository !== index.repository ||
    request.cnbProject !== index.repository ||
    request.prNumber !== index.prNumber ||
    request.headSha !== index.headSha ||
    request.source?.provider !== 'github-release' ||
    request.source?.cloudToCloudOnly !== true
  ) throw new Error('CNB 镜像请求身份与签名 feed 不一致。')

  const manifestPath = `component-feeds/pr-preview/manifests/${index.headSha}.json`
  if (
    request.promotion?.manifestPath !== manifestPath ||
    request.promotion?.latestPath !== 'component-feeds/pr-preview/latest.json' ||
    request.promotion?.signedManifestAsset !== `pr-preview-manifest-${index.headSha}.json` ||
    request.promotion?.signedIndexAsset !== `pr-preview-index-${index.headSha}.json` ||
    request.promotion?.allowedOnlyAfterEveryAssetVerified !== true ||
    request.promotion?.atomic !== true ||
    JSON.stringify(request.promotion?.sourcePriority) !== JSON.stringify(['cnb', 'github'])
  ) throw new Error('CNB 镜像请求提升契约无效。')

  const expected = []
  let immutableTag = ''
  for (const component of manifest.componentManifest.components) {
    const cnb = releaseIdentity(component.urls[0])
    const github = releaseIdentity(component.urls[1])
    if (cnb.tag !== github.tag || cnb.name !== github.name) throw new Error(`CNB/GitHub 组件身份不一致：${component.id}`)
    if (immutableTag && immutableTag !== github.tag) throw new Error('CNB 镜像请求包含多个不可变 Tag。')
    immutableTag = github.tag
    expected.push({
      name: github.name,
      size: component.size,
      sha256: component.sha256,
      sourceUrl: component.urls[1],
      targetUrl: component.urls[0]
    })
  }
  if (!immutableTag || request.immutableTag !== immutableTag) throw new Error('CNB 镜像请求 Tag 与签名组件不一致。')

  for (const item of [
    { name: request.promotion.signedManifestAsset, bytes: manifestBytes },
    { name: request.promotion.signedIndexAsset, bytes: indexBytes }
  ]) {
    expected.push({
      name: item.name,
      size: item.bytes.byteLength,
      sha256: sha256(item.bytes),
      sourceUrl: `https://github.com/${index.repository}/releases/download/${immutableTag}/${encodeURIComponent(item.name)}`,
      targetUrl: `https://cnb.cool/${index.repository}/-/releases/download/${immutableTag}/${encodeURIComponent(item.name)}`
    })
  }

  if (!Array.isArray(request.assets) || request.assets.length !== expected.length) throw new Error('CNB 镜像请求资产数量与签名 feed 不一致。')
  const actualByName = new Map(request.assets.map(asset => [asset?.name, asset]))
  if (actualByName.size !== request.assets.length) throw new Error('CNB 镜像请求资产名称重复。')
  for (const item of expected) {
    if (!exactAsset(actualByName.get(item.name), item)) throw new Error(`CNB 镜像请求资产与签名 feed 不一致：${item.name}`)
  }
  return request.assets.length
}

export async function verifyPrPreviewFeedFiles({ configFile, indexFile, manifestFile, requestFile = '', now = Date.now() }) {
  const [configPayload, indexPayload, manifestPayload] = await Promise.all([
    readFile(path.resolve(configFile), 'utf8').then(JSON.parse),
    readFile(path.resolve(indexFile), 'utf8').then(JSON.parse),
    readFile(path.resolve(manifestFile), 'utf8').then(JSON.parse)
  ])
  const config = normalizePrPreviewUpdateConfig(configPayload)
  if (!config.enabled || Object.keys(config.trustedKeys).length === 0) {
    throw new Error('PR 预览生产公钥尚未配置，拒绝提升 feed。')
  }
  const index = validateAndVerifyPreviewIndex(indexPayload, config.trustedKeys, {
    now,
    normalizeManifestUrls: normalizeOfficialManifestUrls
  })
  const manifest = validateAndVerifyPreviewManifest(manifestPayload, config.trustedKeys, { now })
  assertIndexMatchesManifest(index, manifest)
  const requestAssets = requestFile
    ? await verifyCnbRequest({ requestFile, indexFile, manifestFile, index, manifest })
    : 0
  return {
    repository: index.repository,
    prNumber: index.prNumber,
    headSha: index.headSha,
    sequence: index.sequence,
    keyId: index.keyId,
    expiresAt: index.expiresAt,
    releaseVersion: manifest.componentManifest.releaseVersion,
    requestAssets
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const configFile = argument(argv, 'config')
  const indexFile = argument(argv, 'index')
  const manifestFile = argument(argv, 'manifest')
  const requestFile = argument(argv, 'request')
  if (!configFile || !indexFile || !manifestFile || !requestFile) throw new Error('--config、--index、--manifest 和 --request 是必需参数。')
  const verified = await verifyPrPreviewFeedFiles({ configFile, indexFile, manifestFile, requestFile })
  process.stdout.write(`${JSON.stringify({ ok: true, ...verified })}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
