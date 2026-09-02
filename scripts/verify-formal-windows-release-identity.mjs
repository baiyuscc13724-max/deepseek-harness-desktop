import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

function argument(name) {
  const joined = process.argv.find(value => value.startsWith(`--${name}=`))
  if (joined) return joined.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? String(process.argv[index + 1] || '') : ''
}

function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`)
  return number
}

function expectedIdentityFromArguments() {
  const repo = argument('repo')
  const tag = argument('tag')
  const productRevision = argument('product-revision').toLowerCase()
  const releaseId = positiveInteger(argument('release-id'), 'release-id')
  const assetId = positiveInteger(argument('asset-id'), 'asset-id')
  const assetName = argument('asset-name')
  const assetSize = positiveInteger(argument('asset-size'), 'asset-size')
  const assetDigest = argument('asset-digest')
  const assetUrl = argument('asset-url')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) throw new Error('repo must be an exact owner/name slug.')
  if (!/^v\d+\.\d+\.\d+$/u.test(tag)) throw new Error('tag must be an exact stable desktop release tag.')
  if (!/^[0-9a-f]{40}$/u.test(productRevision)) throw new Error('product-revision must be an exact 40-character commit.')
  const version = tag.slice(1)
  const expectedName = `Harness-Desktop-${version}-portable-x64.exe`
  if (assetName !== expectedName) throw new Error(`asset-name must equal ${expectedName}.`)
  if (!/^sha256:[0-9a-f]{64}$/u.test(assetDigest)) throw new Error('asset-digest must be an exact GitHub sha256 digest.')
  const expectedUrl = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(assetName)}`
  if (assetUrl !== expectedUrl) throw new Error('asset-url is not the canonical GitHub Release download URL.')
  return { repo, tag, productRevision, releaseId, assetId, assetName, assetSize, assetDigest, assetUrl }
}

export function verifyFormalWindowsReleaseIdentity(release, expected) {
  if (!release || typeof release !== 'object') throw new Error('GitHub Release response is missing.')
  if (
    Number(release.id) !== expected.releaseId ||
    release.tag_name !== expected.tag ||
    String(release.target_commitish || '').toLowerCase() !== expected.productRevision ||
    release.draft !== false ||
    release.prerelease !== false
  ) {
    throw new Error('Formal Windows GitHub Release identity changed.')
  }
  const matches = Array.isArray(release.assets)
    ? release.assets.filter(asset => asset?.name === expected.assetName)
    : []
  if (matches.length !== 1) throw new Error('Formal Windows portable asset is missing or duplicated.')
  const asset = matches[0]
  if (
    Number(asset.id) !== expected.assetId ||
    Number(asset.size) !== expected.assetSize ||
    asset.digest !== expected.assetDigest ||
    asset.browser_download_url !== expected.assetUrl
  ) {
    throw new Error('Formal Windows portable asset identity changed after local validation.')
  }
  return true
}

function githubRelease(repo, releaseId) {
  const result = spawnSync('gh', ['api', `repos/${repo}/releases/${releaseId}`], {
    encoding: 'utf8',
    env: process.env,
    shell: false,
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Unable to read formal Windows GitHub Release identity (status ${result.status}).`)
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error('GitHub returned invalid formal Windows Release JSON.', { cause: error })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const expected = expectedIdentityFromArguments()
  verifyFormalWindowsReleaseIdentity(githubRelease(expected.repo, expected.releaseId), expected)
  console.log(`Verified formal Windows Release asset identity: release=${expected.releaseId} asset=${expected.assetId}`)
}
