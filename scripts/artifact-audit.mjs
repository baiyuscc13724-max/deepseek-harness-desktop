import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import asar from '@electron/asar'
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
  const archive = path.join(dist, 'win-unpacked', 'resources', 'app.asar')
  const entries = new Set(asar.listPackage(archive, { isPack: false }).map(entry => entry.replaceAll('\\', '/').replace(/^\//, '')))
  for (const required of [
    'node_modules/@deepseek-ai/cordis-plugin-group/package.json',
    'node_modules/@deepseek-ai/cordis-plugin-group/lib/index.js'
  ]) {
    if (!entries.has(required)) throw new Error(`Packaged runtime dependency is missing from app.asar: ${required}`)
  }
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
