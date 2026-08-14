import { access, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import spawn from 'cross-spawn'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

function run(command, args) {
  const result = spawn.sync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`)
}

await rm(dist, { recursive: true, force: true })

if (process.platform === 'win32') {
  run('npx.cmd', ['electron-builder', '--win', 'portable', '--x64', '--publish', 'never'])

  const candidates = [
    process.env.ISCC_PATH,
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe'
  ].filter(Boolean)
  const iscc = await Promise.any(candidates.map(async candidate => {
    await access(candidate)
    return candidate
  })).catch(() => null)
  if (!iscc) throw new Error('Inno Setup 6 was not found. Install it or set ISCC_PATH.')

  run(iscc, [`/DMyAppVersion=${pkg.version}`, path.join(root, 'build', 'installer.iss')])
} else {
  run('npx', ['electron-builder', '--publish', 'never'])
}
