import { access, copyFile, mkdir, readFile, rm } from 'node:fs/promises'
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

function withNodeRequire(modulePath, callback) {
  const previous = process.env.NODE_OPTIONS
  const requireOption = `--require=${modulePath}`
  process.env.NODE_OPTIONS = [previous, requireOption].filter(Boolean).join(' ')
  try {
    return callback()
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = previous
  }
}

await rm(dist, { recursive: true, force: true })
run(process.execPath, ['scripts/patch-official-runtime.mjs'])

if (process.platform === 'win32') {
  run(process.execPath, ['scripts/prepare-bundled-git.mjs'])
  // Native dependencies are already aligned by the package postinstall step.
  // Re-running electron-rebuild here adds no release value and can fail in
  // restricted Windows shells that deny nested child-process forks.
  withNodeRequire(path.join(root, 'scripts', 'electron-builder-traversal.cjs'), () => {
    run('npx.cmd', [
      'electron-builder',
      '--win',
      'portable',
      '--x64',
      '--publish',
      'never',
      '--config.npmRebuild=false',
      // The app does not enable Electron's embedded ASAR-integrity fuse. Avoid
      // loading the entire 200+ MB Electron executable into a second in-memory
      // PE image merely to embed an integrity resource that is never consumed.
      '--config.disableAsarIntegrity=true'
    ])
  })

  const installerIconDir = path.join(dist, '.icon-ico')
  await mkdir(installerIconDir, { recursive: true })
  await copyFile(path.join(root, 'build', '.icon-ico', 'icon.ico'), path.join(installerIconDir, 'icon.ico'))

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

  // Compile against the real paths. Building through a temporary SUBST drive
  // can make Inno Setup return success while emitting a truncated setup data
  // section once the application is concentrated in a large ASAR file.
  run(iscc, [
    `/DMyAppVersion=${pkg.version}`,
    `/DMySourceDir=${path.join(dist, 'win-unpacked')}`,
    `/DMyOutputDir=${dist}`,
    path.join(root, 'build', 'installer.iss')
  ])
} else if (process.platform === 'darwin') {
  const requiredSigningEnvironment = [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
    'APPLE_TEAM_ID'
  ]
  const missingSigningEnvironment = requiredSigningEnvironment.filter(name => !String(process.env[name] || '').trim())
  if (missingSigningEnvironment.length > 0) {
    throw new Error(`macOS release packaging requires Developer ID signing and notarization environment: ${missingSigningEnvironment.join(', ')}`)
  }
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'true') {
    throw new Error('macOS release packaging requires CSC_IDENTITY_AUTO_DISCOVERY=true.')
  }
  const notarizationKey = path.resolve(process.env.APPLE_API_KEY)
  if (!path.isAbsolute(process.env.APPLE_API_KEY)) throw new Error('APPLE_API_KEY must be an absolute path to an ephemeral App Store Connect API key.')
  await access(notarizationKey)

  // A single node_modules tree cannot contain reliable native sharp/koffi
  // payloads for both Intel and Apple Silicon. Reinstall and package each
  // architecture independently so the immutable runtime cache is complete.
  for (const arch of ['x64', 'arm64']) {
    run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts', '--include=optional', '--os=darwin', `--cpu=${arch}`])
    run(process.execPath, ['scripts/patch-official-runtime.mjs'])
    run('npx', [
      'electron-builder', '--mac', 'dmg', 'zip', `--${arch}`, '--publish', 'never',
      '--config.npmRebuild=false'
    ])
  }
} else {
  run('npx', ['electron-builder', '--publish', 'never'])
}
