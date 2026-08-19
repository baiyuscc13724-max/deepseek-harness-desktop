import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')
const { validateAndVerifyManifest } = require('../electron/bridge/component-update-contract.cjs')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback = '') {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length).trim() : fallback
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

const version = argument('version')
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use --version=<semver>.')
const stagingDir = path.resolve(root, argument('dir'))
const sources = JSON.parse(await readFile(path.join(root, 'component-update-sources.json'), 'utf8'))
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (packageJson.version !== version) throw new Error(`Package version ${packageJson.version} does not match ${version}.`)

const targets = [
  { id: 'win32-x64', platform: 'win32', arch: 'x64', fallback: `Harness-Desktop-${version}-win-x64.exe` },
  { id: 'darwin-x64', platform: 'darwin', arch: 'x64', fallback: `Harness-Desktop-${version}-mac-x64.dmg` },
  { id: 'darwin-arm64', platform: 'darwin', arch: 'arm64', fallback: `Harness-Desktop-${version}-mac-arm64.dmg` }
]
const expectedAssets = targets.flatMap(target => [
  `desktop-shell-${version}-${target.id}.zip`,
  `components-${version}-${target.id}.json`
]).sort()
const checksumFile = 'COMPONENT-SHA256SUMS.txt'
const actualNames = (await readdir(stagingDir, { withFileTypes: true }))
  .filter(item => item.isFile())
  .map(item => item.name)
  .sort()
const expectedNames = [...expectedAssets, checksumFile].sort()
if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
  throw new Error(`Unexpected staging asset set. Expected ${expectedNames.join(', ')}; received ${actualNames.join(', ')}.`)
}

const checksumText = await readFile(path.join(stagingDir, checksumFile), 'utf8')
const checksumEntries = new Map()
for (const line of checksumText.trim().split(/\r?\n/u)) {
  const match = /^([0-9a-f]{64})  ([^/\\]+)$/u.exec(line)
  if (!match) throw new Error(`Invalid component checksum line: ${line}`)
  if (checksumEntries.has(match[2])) throw new Error(`Duplicate checksum entry: ${match[2]}`)
  checksumEntries.set(match[2], match[1])
}
if (JSON.stringify([...checksumEntries.keys()].sort()) !== JSON.stringify(expectedAssets)) {
  throw new Error('Component checksum file must list every immutable asset exactly once.')
}

const githubBase = `https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v${version}`
const cnbBase = `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v${version}`
const report = { schemaVersion: 1, version, assets: [] }
for (const name of expectedAssets) {
  const file = path.join(stagingDir, name)
  const buffer = await readFile(file)
  const actualHash = sha256(buffer)
  if (actualHash !== checksumEntries.get(name)) throw new Error(`SHA-256 mismatch: ${name}`)
  report.assets.push({ name, size: buffer.length, sha256: actualHash })
}

for (const target of targets) {
  const zipName = `desktop-shell-${version}-${target.id}.zip`
  const manifestName = `components-${version}-${target.id}.json`
  const zipPath = path.join(stagingDir, zipName)
  const manifest = JSON.parse(await readFile(path.join(stagingDir, manifestName), 'utf8'))
  validateAndVerifyManifest(manifest, sources.trustedKeys)
  if (manifest.releaseVersion !== version || manifest.channel !== 'stable') throw new Error(`Invalid release identity: ${manifestName}`)
  if (manifest.bootstrap?.minVersion !== version) throw new Error(`Invalid Bootstrap floor: ${manifestName}`)
  if (!Array.isArray(manifest.components) || manifest.components.length !== 1) throw new Error(`Unexpected component count: ${manifestName}`)
  const component = manifest.components[0]
  const zipInfo = await stat(zipPath)
  const zipHash = sha256(await readFile(zipPath))
  if (component.id !== 'desktop-shell' || component.version !== version || component.target !== 'shell') throw new Error(`Invalid component identity: ${manifestName}`)
  if (component.platform !== target.platform || component.arch !== target.arch) throw new Error(`Invalid component target: ${manifestName}`)
  if (component.kind !== 'zip' || component.size !== zipInfo.size || component.sha256 !== zipHash) throw new Error(`Component archive binding mismatch: ${manifestName}`)
  const expectedComponentUrls = [`${cnbBase}/${zipName}`, `${githubBase}/${zipName}`]
  if (JSON.stringify(component.urls) !== JSON.stringify(expectedComponentUrls)) throw new Error(`Component URL order mismatch: ${manifestName}`)
  if (manifest.fallback?.version !== version) throw new Error(`Fallback version mismatch: ${manifestName}`)
  const expectedFallbackUrls = [`${cnbBase}/${target.fallback}`, `${githubBase}/${target.fallback}`]
  if (JSON.stringify(manifest.fallback?.urls) !== JSON.stringify(expectedFallbackUrls)) throw new Error(`Fallback URL order mismatch: ${manifestName}`)
  const archive = new AdmZip(zipPath)
  if (!archive.test()) throw new Error(`Corrupt component ZIP: ${zipName}`)
  const indexEntry = archive.getEntry('component.json')
  if (!indexEntry) throw new Error(`Missing component.json: ${zipName}`)
  const index = JSON.parse(indexEntry.getData().toString('utf8'))
  if (index.id !== 'desktop-shell' || index.version !== version || index.target !== 'shell' || !Array.isArray(index.files) || index.files.length === 0) {
    throw new Error(`Invalid component index: ${zipName}`)
  }
}

console.log(JSON.stringify({ ok: true, ...report }, null, 2))
