import { createPublicKey } from 'node:crypto'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')
const { validateAndVerifyManifest } = require('../electron/bridge/component-update-contract.cjs')
const {
  createComponentZip,
  createSignedComponentDescriptor,
  createSignedReleaseManifest,
  hashStream,
  privateEd25519Key,
  writeSignedManifest
} = require('../electron/bridge/component-update-builder.cjs')

const TARGETS = Object.freeze([
  { id: 'win32-x64', platform: 'win32', arch: 'x64', fallbackName: version => `Harness-Desktop-${version}-win-x64.exe` },
  { id: 'darwin-x64', platform: 'darwin', arch: 'x64', fallbackName: version => `Harness-Desktop-${version}-mac-x64.dmg` },
  { id: 'darwin-arm64', platform: 'darwin', arch: 'arm64', fallbackName: version => `Harness-Desktop-${version}-mac-arm64.dmg` }
])

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function releaseBase(host, version) {
  if (host === 'cnb') return `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v${version}`
  return `https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v${version}`
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const version = String(argument('version', pkg.version)).replace(/^v/, '')
if (version !== pkg.version) throw new Error(`Component version ${version} must equal package version ${pkg.version}.`)
const publishedAtInput = String(argument('published-at')).trim()
const publishedAtDate = publishedAtInput ? new Date(publishedAtInput) : new Date()
if (!Number.isFinite(publishedAtDate.getTime())) throw new Error('--published-at must be an ISO-8601 timestamp when provided.')
const releaseDir = path.resolve(argument('release-dir'))
if (!argument('release-dir')) throw new Error('--release-dir is required and must contain verified full-package fallbacks.')
const keyFile = process.env.HARNESS_COMPONENT_SIGNING_KEY_FILE
const keyId = String(process.env.HARNESS_COMPONENT_KEY_ID || '').trim()
if (!keyFile || !keyId) throw new Error('HARNESS_COMPONENT_SIGNING_KEY_FILE and HARNESS_COMPONENT_KEY_ID are required.')
const privateKey = privateEd25519Key(await readFile(path.resolve(keyFile), 'utf8'))
const sources = JSON.parse(await readFile(path.join(root, 'component-update-sources.json'), 'utf8'))
const trustedPem = sources.trustedKeys?.[keyId]
if (!sources.enabled || !trustedPem) throw new Error(`Enabled component sources do not trust keyId ${keyId}.`)
const derivedPublic = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).trim()
if (derivedPublic !== String(trustedPem).trim()) throw new Error('Production private key does not match the public key embedded in the bootstrap config.')

const outputRoot = path.resolve(argument('out', path.join(root, '.artifacts', `component-production-v${version}`)))
const inputRoot = path.join(outputRoot, 'input', 'desktop-shell')
const assetsRoot = path.join(outputRoot, 'assets')
const manifestsRoot = path.join(outputRoot, 'manifests')
await rm(outputRoot, { recursive: true, force: true })
await mkdir(path.join(inputRoot, 'build'), { recursive: true, mode: 0o700 })
for (const directory of ['electron', 'renderer', 'plugins']) {
  await cp(path.join(root, directory), path.join(inputRoot, directory), { recursive: true, force: true })
}
for (const file of ['package.json', 'pr-preview-update-sources.json']) {
  await cp(path.join(root, file), path.join(inputRoot, file), { force: true })
}
await cp(path.join(root, 'build', 'icon.png'), path.join(inputRoot, 'build', 'icon.png'), { force: true })
await mkdir(assetsRoot, { recursive: true, mode: 0o700 })
await mkdir(manifestsRoot, { recursive: true, mode: 0o700 })

const publishedAt = publishedAtDate.toISOString()
const report = { schemaVersion: 1, version, keyId, publishedAt, targets: [] }
for (const target of TARGETS) {
  const componentName = `desktop-shell-${version}-${target.id}.zip`
  const componentFile = path.join(assetsRoot, componentName)
  const archive = await createComponentZip({
    inputDir: inputRoot,
    outputFile: componentFile,
    id: 'desktop-shell',
    version,
    target: 'shell',
    AdmZipImpl: AdmZip
  })
  const componentUrls = [releaseBase('cnb', version), releaseBase('github', version)].map(base => `${base}/${componentName}`)
  const descriptor = createSignedComponentDescriptor({
    id: 'desktop-shell',
    version,
    target: 'shell',
    platform: target.platform,
    arch: target.arch,
    archive,
    urls: componentUrls,
    required: true,
    restart: true
  }, privateKey)
  const fallbackName = target.fallbackName(version)
  const fallbackFile = path.join(releaseDir, fallbackName)
  const fallbackInfo = await stat(fallbackFile)
  if (!fallbackInfo.isFile() || fallbackInfo.size <= 0) throw new Error(`Missing full-package fallback: ${fallbackFile}`)
  const fallbackSha256 = await hashStream(fallbackFile)
  const fallback = {
    version,
    size: fallbackInfo.size,
    sha256: fallbackSha256,
    urls: [releaseBase('cnb', version), releaseBase('github', version)].map(base => `${base}/${fallbackName}`)
  }
  const manifest = createSignedReleaseManifest({
    releaseVersion: version,
    channel: 'stable',
    publishedAt,
    keyId,
    bootstrap: { minVersion: version },
    components: [descriptor],
    fallback,
    notes: `Harness Desktop ${version} signed production shell baseline for ${target.id}.`
  }, privateKey)
  validateAndVerifyManifest(manifest, { [keyId]: derivedPublic })
  const manifestName = `components-${version}-${target.id}.json`
  await writeSignedManifest(path.join(manifestsRoot, manifestName), manifest)
  report.targets.push({
    target: target.id,
    component: { name: componentName, size: archive.size, sha256: archive.sha256 },
    manifest: { name: manifestName },
    fallback: { name: fallbackName, size: fallbackInfo.size, sha256: fallbackSha256 }
  })
}
await writeFile(path.join(outputRoot, 'component-release-report.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
console.log(JSON.stringify({ ok: true, outputRoot, report: path.join(outputRoot, 'component-release-report.json'), targets: report.targets.map(item => item.target) }, null, 2))
