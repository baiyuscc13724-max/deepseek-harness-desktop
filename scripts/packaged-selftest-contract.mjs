import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = await readFile(path.join(root, 'electron/main.cjs'), 'utf8')
const workflow = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8')
const service = await readFile(path.join(root, 'electron/bridge/self-test-service.cjs'), 'utf8')
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
const OFFICIAL_ALPHA4_VERSION = '0.1.2-alpha.4'
const packagedAlpha4Peers = Object.freeze([
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-jobs',
  '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-util-time'
])
const officialRuntimeVersion = manifest.dependencies?.['@deepseek-ai/dsh']
if (officialRuntimeVersion !== OFFICIAL_ALPHA4_VERSION) throw new Error('Packaged runtime must stay pinned to the reviewed official alpha.4 release.')
const declaredDshOptionalRoots = Object.keys(manifest.optionalDependencies || {})
  .filter(packageName => packageName === '@deepseek-ai/dsh' || packageName.startsWith('@deepseek-ai/dsh-'))
  .sort()
if (JSON.stringify(declaredDshOptionalRoots) !== JSON.stringify([...packagedAlpha4Peers].sort())) {
  throw new Error('Packaged alpha.4 runtime peers must match the complete reviewed optional-root allowlist.')
}
const lockRoot = lock.packages?.['']
if (!lockRoot || Array.isArray(lockRoot) || typeof lockRoot !== 'object') throw new Error('Packaged alpha.4 runtime lock root is missing or malformed.')

for (const packageName of packagedAlpha4Peers) {
  const manifestVersion = manifest.optionalDependencies?.[packageName]
  if (manifestVersion !== officialRuntimeVersion) throw new Error(`Packaged alpha.4 runtime peer is not an exact optional root: ${packageName}`)
  if (lockRoot.optionalDependencies?.[packageName] !== manifestVersion) throw new Error(`Packaged alpha.4 runtime peer root lock does not match the manifest: ${packageName}`)
  const locked = lock.packages?.[`node_modules/${packageName}`]
  if (locked?.version !== manifestVersion || locked.peer === true) throw new Error(`Packaged alpha.4 runtime peer is not locked as a packable root: ${packageName}`)
}

for (const contract of ['--self-test', 'runPackagedSelfTest', 'HARNESS_DESKTOP_SELFTEST']) {
  if (!main.includes(contract)) throw new Error(`Packaged self-test main-process contract missing: ${contract}`)
}
for (const contract of ['rendererEntry', 'bundledHarness', 'runtimeWebBoot', 'runtimeWebBootable', "'web', '--port', '0'", 'nodeRuntime', 'userData', 'desktopMarketplace', 'marketplaceInstallable', 'webCompatibility']) {
  if (!service.includes(contract)) throw new Error(`Packaged self-test service contract missing: ${contract}`)
}
if (!workflow.includes('Run packaged Windows self-test')) throw new Error('Release workflow must execute the unpacked Windows app self-test before artifact upload.')
if (!workflow.includes('--self-test')) throw new Error('Release workflow does not invoke --self-test.')
console.log('Packaged self-test contract passed.')
