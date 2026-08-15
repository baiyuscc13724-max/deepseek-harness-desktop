import { createHash } from 'node:crypto'
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dist = path.resolve(process.argv[2] || 'dist')
const names = await readdir(dist).catch(() => [])
const files = names.filter(name => !name.endsWith('.blockmap') && name !== 'builder-debug.yml' && name !== 'builder-effective-config.yaml')
const expected = process.platform === 'win32'
  ? files.filter(name => /\.exe$/i.test(name))
  : process.platform === 'darwin'
    ? files.filter(name => /\.(?:dmg|zip)$/i.test(name))
    : files.filter(name => /(?:\.AppImage|\.deb)$/i.test(name))
if (!expected.length) throw new Error(`No release artifact found for ${process.platform} in ${dist}. Found: ${files.join(', ') || '(none)'}`)
if (process.platform === 'win32') {
  const unpacked = path.join(dist, 'win-unpacked', 'resources', 'app.asar.unpacked')
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
    await access(path.join(unpacked, ...required.split('/'))).catch(() => {
      throw new Error(`Packaged runtime dependency is missing from app.asar.unpacked: ${required}`)
    })
  }
  const marketplaceRoot = path.join(unpacked, 'node_modules', 'dsh-plugin-marketplace')
  const marketplacePackage = JSON.parse(await readFile(path.join(marketplaceRoot, 'package.json'), 'utf8'))
  const marketplaceRuntime = await readFile(path.join(marketplaceRoot, 'lib', 'index.js'), 'utf8')
  if (marketplacePackage.version !== '1.2.2' || !marketplaceRuntime.includes('process.env.ComSpec') || !marketplaceRuntime.includes('"npm.cmd", ...args')) {
    throw new Error('Packaged marketplace is missing the verified Electron/Node 24 Windows npm launcher.')
  }
  const directoryPicker = await readFile(path.join(unpacked, 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'index.js'), 'utf8')
  if (!directoryPicker.includes('System.Windows.Forms.FolderBrowserDialog') || !directoryPicker.includes('"-EncodedCommand"')) {
    throw new Error('Packaged runtime is missing the stable Windows directory picker.')
  }
  const unpackedFiles = await readdir(unpacked, { recursive: true })
  const forbiddenRuntimeFile = unpackedFiles.find(name => /(?:\.map|\.(?:ts|tsx|cts|mts))$/i.test(name) && !/\.json$/i.test(name))
  if (forbiddenRuntimeFile) throw new Error(`Packaged runtime still contains a pruned development file: ${forbiddenRuntimeFile}`)
}
const lines = []
for (const name of expected.sort()) {
  const data = await readFile(path.join(dist, name))
  if (data.length < 1024) throw new Error(`Release artifact is implausibly small: ${name} (${data.length} bytes)`)
  lines.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`)
}
await writeFile(path.join(dist, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)
console.log(`Artifact audit passed for ${expected.length} ${process.platform} release file(s).`)
console.log(lines.join('\n'))
