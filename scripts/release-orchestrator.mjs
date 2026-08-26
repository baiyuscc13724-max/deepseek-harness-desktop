import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { readAndroidMobileVersion } = require('./mobile-release-version.cjs')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const version = String(argument('version', pkg.version)).replace(/^v/, '')
const stateDir = path.join(root, '.release-state')
const stateFile = path.join(stateDir, `v${version}.json`)
const command = process.argv[2] || 'status'
const through = argument('through', 'verify')
const npmCli = String(process.env.npm_execpath || '').trim()
const portableGit = path.resolve(root, '..', '.tools', 'MinGit', 'cmd', 'git.exe')
const gitExecutable = String(process.env.HARNESS_RELEASE_GIT || (existsSync(portableGit) ? portableGit : 'git')).trim()

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

async function readState() {
  try { return JSON.parse(await readFile(stateFile, 'utf8')) }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { schemaVersion: 2, version, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceRevision: '', phases: {} }
  }
}

async function saveState(state) {
  await mkdir(stateDir, { recursive: true })
  state.updatedAt = new Date().toISOString()
  const temporary = `${stateFile}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, stateFile)
}

function run(program, args, options = {}) {
  console.log(`\n> ${program} ${args.join(' ')}`)
  const result = spawnSync(program, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: options.env || process.env,
    timeout: options.timeout || 45 * 60 * 1000
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} exited with code ${result.status}.`)
}

function capture(program, args) {
  mkdirSync(stateDir, { recursive: true })
  const temporary = path.join(stateDir, `.capture-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.log`)
  const output = openSync(temporary, 'w')
  let result
  try {
    result = spawnSync(program, args, { cwd: root, stdio: ['ignore', output, output], shell: false, env: process.env, timeout: 60_000 })
  } finally {
    closeSync(output)
  }
  const text = readFileSync(temporary, 'utf8')
  rmSync(temporary, { force: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} exited with code ${result.status}: ${text.trim()}`)
  return text
}

function cleanSourceRevision() {
  const status = capture(gitExecutable, ['status', '--porcelain=v1', '--untracked-files=normal']).trim()
  if (status) throw new Error(`Release orchestration requires a clean source tree. Commit or remove:\n${status}`)
  const revision = capture(gitExecutable, ['rev-parse', 'HEAD']).trim()
  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error(`Cannot resolve an immutable Git source revision: ${revision}`)
  return revision.toLowerCase()
}

function runNpm(args, options = {}) {
  if (npmCli) return run(process.execPath, [npmCli, ...args], options)
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options)
}

async function requireFile(file) {
  const info = await stat(file)
  if (!info.isFile() || info.size <= 0) throw new Error(`Required release file is empty: ${file}`)
  return file
}

async function sourceContracts() {
  if (version !== pkg.version) throw new Error(`Requested version ${version} does not equal package ${pkg.version}.`)
  const [ios, mobile, sources] = await Promise.all([
    readFile(path.join(root, 'mobile/ios/project.yml'), 'utf8'),
    readFile(path.join(root, 'electron/bridge/mobile-sync-service.cjs'), 'utf8'),
    readFile(path.join(root, 'component-update-sources.json'), 'utf8').then(JSON.parse)
  ])
  const android = readAndroidMobileVersion(root)
  const [major, minor, patch] = version.split('.').map(Number)
  const mobileCode = major * 10000 + minor * 100 + patch
  if (android.integrationVersion !== version || android.versionName !== version) throw new Error('Android version is not synchronized.')
  if (!ios.includes(`CURRENT_PROJECT_VERSION: ${mobileCode}`) || !ios.includes(`MARKETING_VERSION: ${version}`)) throw new Error('iOS version is not synchronized.')
  if (!mobile.includes(`CURRENT_MOBILE_VERSION = '${version}'`)) throw new Error('Desktop mobile routing version is not synchronized.')
  if (sources.enabled !== true || Object.keys(sources.trustedKeys || {}).length !== 1) throw new Error('Production component source or trust root is not enabled exactly once.')
  for (const target of ['win32-x64', 'darwin-x64', 'darwin-arm64']) {
    if (sources.targets?.[target]?.length !== 2) throw new Error(`Component target ${target} does not have exactly two mirrors.`)
  }
  for (const file of ['CHANGELOG.md', 'README.md', 'release-notes.md']) {
    const text = await readFile(path.join(root, file), 'utf8')
    if (!text.includes(version)) throw new Error(`${file} does not mention ${version}.`)
  }
}

async function verifySource() {
  runNpm( ['run', 'verify'])
  runNpm( ['run', 'verify:release'])
}

async function windowsPackage() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The Windows package phase requires win32-x64.')
  runNpm( ['run', 'dist'], { timeout: 60 * 60 * 1000 })
  runNpm( ['run', 'verify:artifact'])
  const executable = await requireFile(path.join(root, 'dist', 'win-unpacked', 'Harness Desktop.exe'))
  const output = path.join(stateDir, `v${version}-packaged-selftest.json`)
  const userData = path.join(stateDir, `v${version}-packaged-selftest-userdata`)
  await rm(output, { force: true })
  await rm(userData, { recursive: true, force: true })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  run(executable, ['--self-test', `--self-test-output=${output}`, `--user-data-dir=${userData}`], { env, timeout: 5 * 60 * 1000 })
  const report = JSON.parse(await readFile(output, 'utf8'))
  if (!report.ok) throw new Error(`Packaged self-test failed: ${report.error || 'unknown error'}`)
  const componentProfile = path.join(stateDir, `v${version}-component-test-profile`)
  await rm(componentProfile, { recursive: true, force: true })
  runNpm( ['run', 'test:component-local', '--', '--app-exe', executable, '--profile', componentProfile], { env, timeout: 15 * 60 * 1000 })
  for (const file of [
    `Harness-Desktop-${version}-win-x64.exe`,
    `Harness-Desktop-${version}-portable-x64.exe`
  ]) await requireFile(path.join(root, 'dist', file))
}

const PHASES = [
  { id: 'source', execute: sourceContracts },
  { id: 'verify', execute: verifySource },
  { id: 'windows', execute: windowsPackage }
]

async function runPhases() {
  const targetIndex = PHASES.findIndex(phase => phase.id === through)
  if (targetIndex < 0) throw new Error(`Unknown --through phase: ${through}. Expected source, verify, or windows.`)
  const sourceRevision = cleanSourceRevision()
  const state = await readState()
  if (state.version !== version) throw new Error(`State version mismatch: ${state.version}`)
  if (state.sourceRevision !== sourceRevision) {
    if (Object.keys(state.phases || {}).length > 0) console.log(`Source revision changed (${state.sourceRevision || 'legacy state'} -> ${sourceRevision}); invalidating completed phases.`)
    state.schemaVersion = 2
    state.sourceRevision = sourceRevision
    state.phases = {}
    await saveState(state)
  }
  for (const phase of PHASES.slice(0, targetIndex + 1)) {
    if (state.phases[phase.id]?.status === 'completed') {
      console.log(`Skipping completed phase: ${phase.id}`)
      continue
    }
    state.phases[phase.id] = { status: 'running', startedAt: new Date().toISOString() }
    await saveState(state)
    try {
      await phase.execute()
      state.phases[phase.id] = { ...state.phases[phase.id], status: 'completed', completedAt: new Date().toISOString() }
      await saveState(state)
    } catch (error) {
      state.phases[phase.id] = { ...state.phases[phase.id], status: 'failed', failedAt: new Date().toISOString(), error: String(error?.message || error).slice(0, 1000) }
      await saveState(state)
      throw error
    }
  }
  console.log(JSON.stringify({ ok: true, stateFile, sourceRevision, completedThrough: through }, null, 2))
}

if (command === 'run') {
  await runPhases()
} else if (command === 'status') {
  console.log(JSON.stringify(await readState(), null, 2))
} else if (command === 'reset') {
  const phase = argument('phase')
  const phaseIndex = PHASES.findIndex(item => item.id === phase)
  if (phaseIndex < 0) throw new Error('reset requires --phase source|verify|windows.')
  const state = await readState()
  const reset = PHASES.slice(phaseIndex).map(item => item.id)
  for (const id of reset) delete state.phases[id]
  await saveState(state)
  console.log(JSON.stringify({ ok: true, reset, stateFile }, null, 2))
} else {
  throw new Error('Usage: node scripts/release-orchestrator.mjs status|run|reset [--version x.y.z] [--through source|verify|windows] [--phase phase]')
}
