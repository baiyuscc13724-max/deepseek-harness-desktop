import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

function argument(name, fallback = '') {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length).trim() : fallback
}

const version = argument('version', pkg.version)
const repo = argument('repo', 'baiyuscc13724-max/deepseek-harness-desktop')
const output = path.resolve(root, argument('output', 'release-manifest.json'))
const tag = `v${version}`
if (!/^\d+\.\d+\.\d+$/.test(version) || version !== pkg.version) throw new Error(`Release version must match package.json: ${pkg.version}.`)
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid GitHub repository slug.')

const expectedNames = [
  `Harness-Desktop-${version}-win-x64.exe`,
  `Harness-Desktop-${version}-portable-x64.exe`,
  `Harness-Desktop-${version}-mac-arm64.dmg`,
  `Harness-Desktop-${version}-mac-arm64.zip`,
  `Harness-Desktop-${version}-mac-x64.dmg`,
  `Harness-Desktop-${version}-mac-x64.zip`,
  `Harness-Desktop-${version}-linux-amd64.deb`,
  `Harness-Desktop-${version}-linux-x86_64.AppImage`,
  `Harness-Mobile-${version}-android-universal.apk`,
  `Harness-Mobile-${version}-android-universal.apk.sha256`,
  `desktop-shell-${version}-win32-x64.zip`,
  `desktop-shell-${version}-darwin-x64.zip`,
  `desktop-shell-${version}-darwin-arm64.zip`,
  `components-${version}-win32-x64.json`,
  `components-${version}-darwin-x64.json`,
  `components-${version}-darwin-arm64.json`,
  'COMPONENT-SHA256SUMS.txt',
  'SHA256SUMS.txt'
].sort((a, b) => a.localeCompare(b, 'en'))

const response = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Harness-Desktop-Release' }
})
if (!response.ok) throw new Error(`GitHub release query failed: ${response.status}`)
const release = await response.json()
if (release.tag_name !== tag || release.draft || release.prerelease) throw new Error(`Release ${tag} must exist and be final.`)
const assets = [...release.assets].sort((a, b) => a.name.localeCompare(b.name, 'en'))
if (JSON.stringify(assets.map(asset => asset.name)) !== JSON.stringify(expectedNames)) {
  throw new Error(`Unexpected public release asset set for ${tag}.`)
}
const manifestAssets = assets.map(asset => {
  const digest = String(asset.digest || '')
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`GitHub SHA-256 digest missing: ${asset.name}`)
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error(`Invalid public asset size: ${asset.name}`)
  const expectedUrl = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(asset.name)}`
  if (asset.browser_download_url !== expectedUrl) throw new Error(`Unexpected public asset URL: ${asset.name}`)
  return {
    name: asset.name,
    browser_download_url: asset.browser_download_url,
    size: asset.size,
    sha256: digest.slice('sha256:'.length),
    mirror_urls: [`https://cnb.cool/${repo}/-/releases/download/${tag}/${encodeURIComponent(asset.name)}`]
  }
})
const manifest = [{
  tag_name: release.tag_name,
  name: release.name,
  html_url: release.html_url,
  prerelease: Boolean(release.prerelease),
  draft: Boolean(release.draft),
  body: String(release.body || ''),
  assets: manifestAssets
}]
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ok: true, output, tag, assets: manifestAssets.length }, null, 2))
