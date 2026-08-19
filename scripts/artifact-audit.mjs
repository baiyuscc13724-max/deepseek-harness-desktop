import { createHash } from 'node:crypto'
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { assertMaximum, enforceWindowsFootprint, formatMiB, windowsFootprint } from './artifact-size-budget.mjs'

const { extractFile, getRawHeader, listPackage } = createRequire(import.meta.url)('@electron/asar')
const sizeBudget = JSON.parse(await readFile(new URL('../build/artifact-size-budget.json', import.meta.url), 'utf8'))

const dist = path.resolve(process.argv[2] || 'dist')
const names = await readdir(dist).catch(() => [])
const files = names.filter(name => !name.endsWith('.blockmap') && name !== 'builder-debug.yml' && name !== 'builder-effective-config.yaml')
const expected = process.platform === 'win32'
  ? files.filter(name => /\.exe$/i.test(name))
  : process.platform === 'darwin'
    ? files.filter(name => /\.(?:dmg|zip)$/i.test(name))
    : files.filter(name => /(?:\.AppImage|\.deb)$/i.test(name))
if (!expected.length) throw new Error(`No release artifact found for ${process.platform} in ${dist}. Found: ${files.join(', ') || '(none)'}`)
const supplemental = files.filter(name => /(?:portable.*\.zip|\.apk)$/i.test(name))
const audited = Array.from(new Set([...expected, ...supplemental]))
let measuredFootprint = null
if (process.platform === 'win32') {
  const asar = path.join(dist, 'win-unpacked', 'resources', 'app.asar')
  const unpacked = path.join(dist, 'win-unpacked', 'resources', 'app.asar.unpacked')
  const footprint = await windowsFootprint(dist)
  measuredFootprint = footprint
  enforceWindowsFootprint(footprint, sizeBudget.windows)
  const extractPackagedFile = relative => extractFile(asar, relative.split('/').join(path.sep))
  const asarHeader = getRawHeader(asar).header.files
  const treeSize = node => node?.files
    ? Object.values(node.files).reduce((total, child) => total + treeSize(child), 0)
    : Number(node?.size || 0)
  const petRuntimeBytes = treeSize(asarHeader.renderer?.files?.pets)
  assertMaximum('Packaged pet runtime assets', petRuntimeBytes, sizeBudget.windows.petRuntimeAssetsMiB)
  const runtimePackages = [
    'cordis-plugin-group', 'dsh-anonymous-user-id', 'dsh-atomic-write', 'dsh-bash-local',
    'dsh-code-runtime', 'dsh-compaction', 'dsh-fs', 'dsh-invariants', 'dsh-output-retention',
    'dsh-sandbox', 'dsh-scope', 'dsh-session-telemetry', 'dsh-session-title-llm', 'dsh-shell',
    'dsh-spill', 'dsh-subagent-in-process-driver', 'dsh-subprocess', 'dsh-timeout', 'dsh-workflow'
  ]
  for (const required of [
    ...runtimePackages.map(name => `node_modules/@deepseek-ai/${name}/package.json`),
    'node_modules/@deepseek-ai/cordis-plugin-group/lib/index.js',
    'node_modules/dsh-plugin-marketplace/package.json',
    'node_modules/dsh-plugin-marketplace/lib/index.js',
    'node_modules/dsh-plugin-marketplace/lib/client.js'
  ]) {
    try { extractPackagedFile(required) }
    catch { throw new Error(`Packaged runtime dependency is missing from app.asar: ${required}`) }
  }
  const marketplacePackage = JSON.parse(extractPackagedFile('node_modules/dsh-plugin-marketplace/package.json').toString('utf8'))
  const marketplaceRuntime = extractPackagedFile('node_modules/dsh-plugin-marketplace/lib/index.js').toString('utf8')
  if (marketplacePackage.version !== '1.2.2' || !marketplaceRuntime.includes('process.env.ComSpec') || !marketplaceRuntime.includes('"npm.cmd", ...args')) {
    throw new Error('Packaged marketplace is missing the verified Electron/Node 24 Windows npm launcher.')
  }
  const directoryPicker = extractPackagedFile('node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/index.js').toString('utf8')
  if (!directoryPicker.includes('System.Windows.Forms.FolderBrowserDialog') || !directoryPicker.includes('"-EncodedCommand"')) {
    throw new Error('Packaged runtime is missing the stable Windows directory picker.')
  }
  const packagedFiles = listPackage(asar)
  const forbiddenRuntimeFile = packagedFiles.find(name => /node_modules[\\/].*(?:\.map|\.(?:ts|tsx|cts|mts))$/i.test(name) && !/\.json$/i.test(name))
  if (forbiddenRuntimeFile) throw new Error(`Packaged runtime still contains a pruned development file: ${forbiddenRuntimeFile}`)
  const unpackedEntries = await readdir(unpacked, { recursive: true, withFileTypes: true }).catch(() => [])
  const unpackedFiles = unpackedEntries.filter(entry => entry.isFile())
  if (unpackedFiles.length > 1000) {
    throw new Error(`Too many physical files remain outside app.asar: ${unpackedFiles.length} (limit 1000)`)
  }
  const unpackedRuntime = path.join(unpacked, 'node_modules', '@deepseek-ai', 'dsh')
  try {
    await access(unpackedRuntime)
    throw new Error('The JavaScript DSH runtime must stay inside app.asar instead of expanding thousands of installer files.')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}
const lines = []
for (const name of audited.sort()) {
  const data = await readFile(path.join(dist, name))
  if (data.length < 1024) throw new Error(`Release artifact is implausibly small: ${name} (${data.length} bytes)`)
  if (process.platform === 'win32' && /\.exe$/i.test(name)) {
    const maximum = /portable/i.test(name) ? sizeBudget.windows.portableMiB : sizeBudget.windows.installerMiB
    assertMaximum(`Release artifact ${name}`, data.length, maximum)
  }
  lines.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`)
}
await writeFile(path.join(dist, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)
console.log(`Artifact audit passed for ${audited.length} release file(s) (${expected.length} native ${process.platform}, ${supplemental.length} supplemental).`)
if (measuredFootprint) {
  console.log(`Windows footprint: unpacked ${formatMiB(measuredFootprint.unpackedBytes)}, app.asar ${formatMiB(measuredFootprint.appAsarBytes)}, app.asar.unpacked ${formatMiB(measuredFootprint.appAsarUnpackedBytes)}, locales ${formatMiB(measuredFootprint.localesBytes)} (${measuredFootprint.localeFiles} files).`)
}
console.log(lines.join('\n'))
