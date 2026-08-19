import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import spawn from 'cross-spawn'
import { readStoreIdentity, renderStoreManifest } from './store-msix-lib.mjs'

if (process.platform !== 'win32') throw new Error('The MSIX build must run on Windows.')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist-store')
const layout = path.join(dist, 'win-unpacked')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const template = await readFile(path.join(root, 'store', 'Package.appxmanifest.template'), 'utf8')
const { identity } = await readStoreIdentity(root, { required: true })
const manifest = renderStoreManifest(template, identity, pkg.version)

function run(command, args, env = process.env) {
  const result = spawn.sync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`)
}

const resolvedRoot = path.resolve(root)
const resolvedDist = path.resolve(dist)
if (path.dirname(resolvedDist) !== resolvedRoot || path.basename(resolvedDist) !== 'dist-store') {
  throw new Error(`Refusing to clean unexpected Store output path: ${resolvedDist}`)
}

await rm(resolvedDist, { recursive: true, force: true })
await mkdir(resolvedDist, { recursive: true })
const manifestPath = path.join(resolvedDist, 'Package.appxmanifest')
await writeFile(manifestPath, manifest, 'utf8')

run(process.execPath, ['scripts/store-readiness.mjs', '--require-identity'])
run(process.execPath, ['scripts/patch-official-runtime.mjs'])
run('npx.cmd', ['electron-builder', '--dir', '--win', '--x64', '--publish', 'never', '--config', 'build/electron-builder.store.yml'], {
  ...process.env,
  HARNESS_DESKTOP_STORE_BUILD: '1'
})
await access(path.join(layout, 'Harness Desktop.exe'))

const msixPath = path.join(resolvedDist, `Harness-Desktop-${pkg.version}-store-x64.msix`)
const packArgs = ['--yes', '--package', '@microsoft/winappcli@0.5.0', 'winapp', 'package', layout, '--output', msixPath, '--manifest', manifestPath]
const certificate = String(process.env.STORE_CERT_PATH || '').trim()
if (certificate) packArgs.push('--cert', path.resolve(certificate))
run('npx.cmd', packArgs)
await access(msixPath)

console.log(`MSIX_READY: ${msixPath}`)
console.log(certificate ? 'The package is signed with STORE_CERT_PATH.' : 'The package is intentionally unsigned for Microsoft Store ingestion.')
