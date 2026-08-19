import { createRequire } from 'node:module'
import { generateKeyPairSync } from 'node:crypto'
import { cp, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')
const { ComponentUpdateStore } = require('../electron/bridge/component-update-store.cjs')
const { ComponentUpdateService } = require('../electron/bridge/component-update-service.cjs')
const { createComponentZip, createSignedComponentDescriptor, createSignedReleaseManifest, hashStream } = require('../electron/bridge/component-update-builder.cjs')
const { validateAndVerifyManifest } = require('../electron/bridge/component-update-contract.cjs')
const { launchComponentUpdateHelper } = require('../electron/bridge/component-update-launcher.cjs')
const { desktopEnvironment } = require('../electron/bridge/component-update-helper.cjs')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function argument(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
async function waitForExit(child, timeoutMs = 120_000) {
  return Promise.race([
    new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolve(code))
    }),
    delay(timeoutMs).then(() => { child.kill(); throw new Error(`Process ${child.pid} timed out.`) })
  ])
}
async function waitForState(store, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let state
  while (Date.now() < deadline) {
    state = await store.get()
    if (predicate(state)) return state
    await delay(250)
  }
  throw new Error(`Timed out waiting for component state; last phase=${state?.phase || 'unknown'}`)
}
async function waitForReport(output, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const report = await readFile(output, 'utf8').then(value => JSON.parse(value)).catch(() => null)
    if (report && typeof report.ok === 'boolean') return report
    await delay(250)
  }
  throw new Error(`Timed out waiting for self-test report ${output}`)
}
async function runPackagedSelfTest(executable, profile, output) {
  const child = spawn(executable, [`--user-data-dir=${profile}`, `--harness-user-data-dir=${profile}`, '--self-test', `--self-test-output=${output}`], {
    cwd: path.dirname(executable), stdio: 'ignore', windowsHide: true, env: desktopEnvironment(process.env)
  })
  const exitPromise = waitForExit(child)
  const report = await Promise.race([
    waitForReport(output),
    exitPromise.then(async code => {
      const written = await readFile(output, 'utf8').then(value => JSON.parse(value)).catch(() => null)
      if (written && typeof written.ok === 'boolean') return written
      throw new Error(`Packaged baseline exited with code ${code} before writing its final self-test report (last phase: ${written?.phase || 'none'}).`)
    })
  ])
  await Promise.race([exitPromise, delay(2_000)])
  if (!report.ok) throw new Error(`Packaged baseline self-test failed: ${JSON.stringify(report.error || report.checks)}`)
  return report
}

const executable = path.resolve(argument('--app-exe'))
const profile = path.resolve(argument('--profile', path.join(root, '.local-component-update-profile')))
const workspace = path.join(profile, 'local-component-update-fixtures')
if (!(await stat(executable).catch(() => null))?.isFile()) throw new Error('Pass --app-exe with a packaged Harness Desktop executable.')
await rm(profile, { recursive: true, force: true })
await mkdir(workspace, { recursive: true })

const baselineOutput = path.join(workspace, 'baseline-self-test.json')
const baselineReport = await runPackagedSelfTest(executable, profile, baselineOutput)
const baselineParts = String(baselineReport.product.version || '').split('.').map(Number)
if (baselineParts.length !== 3 || baselineParts.some(value => !Number.isInteger(value) || value < 0)) throw new Error(`Packaged baseline version is invalid: ${baselineReport.product.version}`)
const healthyVersion = `${baselineParts[0]}.${baselineParts[1]}.${baselineParts[2] + 1}`
const brokenVersion = `${baselineParts[0]}.${baselineParts[1]}.${baselineParts[2] + 2}`
const store = new ComponentUpdateStore(path.join(profile, 'component-updates'))
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const trustedKeys = { 'local-test': publicKey.export({ type: 'spki', format: 'pem' }) }

async function prepareInput(version, healthy) {
  const input = path.join(workspace, `shell-${version}`)
  await mkdir(input, { recursive: true })
  await cp(path.join(root, 'electron'), path.join(input, 'electron'), { recursive: true })
  await copyFile(path.join(root, 'package.json'), path.join(input, 'package.json'))
  if (healthy) {
    await cp(path.join(root, 'renderer'), path.join(input, 'renderer'), { recursive: true })
    await writeFile(path.join(input, 'component-local-test-marker.txt'), `healthy ${version}\n`, 'utf8')
  }
  return input
}

async function stage(version, healthy) {
  const inputDir = await prepareInput(version, healthy)
  const archiveFile = path.join(workspace, `desktop-shell-${version}.zip`)
  const archive = await createComponentZip({ inputDir, outputFile: archiveFile, id: 'desktop-shell', version, target: 'shell', AdmZipImpl: AdmZip })
  const url = `https://local.invalid/desktop-shell-${version}.zip`
  const descriptor = createSignedComponentDescriptor({
    id: 'desktop-shell', version, target: 'shell', platform: 'win32', arch: process.arch,
    archive, urls: [url], restart: true
  }, privateKey)
  const signed = createSignedReleaseManifest({
    releaseVersion: version, keyId: 'local-test', bootstrap: { minVersion: baselineReport.product.version },
    components: [descriptor], notes: `Local component update test ${version}`
  }, privateKey)
  validateAndVerifyManifest(signed, trustedKeys)
  const service = new ComponentUpdateService({
    store, manifestUrls: ['https://local.invalid/manifest.json'], trustedKeys,
    bootstrapVersion: baselineReport.product.version, platform: 'win32', arch: process.arch, AdmZipImpl: AdmZip,
    fetchJson: async () => signed,
    downloadImpl: async ({ destination, expectedSize, expectedHash }) => {
      await copyFile(archiveFile, destination)
      const info = await stat(destination)
      const digest = await hashStream(destination)
      if (info.size !== expectedSize || digest !== expectedHash) throw new Error('Local staged archive verification failed.')
    }
  })
  const checked = await service.check()
  if (checked.plan.mode !== 'components') throw new Error(`Expected component plan for ${version}, got ${checked.plan.mode}.`)
  await service.stage(checked)
  const ready = await store.get()
  if (ready.phase !== 'ready') throw new Error(`Release ${version} did not reach ready state.`)
}

async function applyAndWait(version, terminalPhase, output) {
  const dummyParent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 900)'], { stdio: 'ignore', windowsHide: true })
  const helperScript = path.join(path.dirname(executable), 'resources', 'app.asar', 'scripts', 'component-update-helper.cjs')
  const launched = await launchComponentUpdateHelper({
    store,
    execPath: executable,
    helperScript,
    componentRoot: store.root,
    parentPid: dummyParent.pid,
    restartExecutable: executable,
    restartCwd: path.dirname(executable),
    accessImpl: async target => {
      if (path.resolve(target) === path.resolve(helperScript)) return
      if (!(await stat(target).catch(() => null))) throw new Error(`Missing helper launch path: ${target}`)
    },
    restartArgs: [`--user-data-dir=${profile}`, `--harness-user-data-dir=${profile}`, '--component-health-check', '--self-test', `--self-test-output=${output}`]
  })
  if (!launched.pid) throw new Error('Component helper did not start.')
  const state = await waitForState(store, value => value.phase === terminalPhase)
  const selfTest = await waitForReport(output)
  if (!selfTest.ok) throw new Error(`Post-update packaged self-test failed for ${version}.`)
  if (terminalPhase === 'idle' && state.active?.releaseVersion !== version) throw new Error(`Healthy release ${version} was not confirmed.`)
  return state
}

await stage(healthyVersion, true)
const healthyOutput = path.join(workspace, 'healthy-self-test.json')
const healthyState = await applyAndWait(healthyVersion, 'idle', healthyOutput)
const healthyPointer = await store.pointer()
const marker = path.join(store.componentPath(healthyPointer.components.find(component => component.id === 'desktop-shell')), 'component-local-test-marker.txt')
if (!(await stat(marker).catch(() => null))?.isFile()) throw new Error('Healthy component marker is missing after activation.')

await stage(brokenVersion, false)
const rollbackOutput = path.join(workspace, 'rollback-self-test.json')
const rollbackState = await applyAndWait(brokenVersion, 'failed', rollbackOutput)
const rollbackPointer = await store.pointer()
if (rollbackPointer?.releaseVersion !== healthyVersion || rollbackState.active?.releaseVersion !== healthyVersion) throw new Error(`Failed component did not roll back to ${healthyVersion}.`)
if (rollbackState.failure?.releaseVersion !== brokenVersion) throw new Error(`Rollback failure metadata does not identify ${brokenVersion}.`)

const report = {
  ok: true,
  executable,
  profile,
  baseline: { ok: baselineReport.ok, appVersion: baselineReport.product.version },
  healthy: { phase: healthyState.phase, active: healthyState.active?.releaseVersion, revision: healthyState.revision },
  rollback: {
    phase: rollbackState.phase,
    active: rollbackState.active?.releaseVersion,
    failedRelease: rollbackState.failure?.releaseVersion,
    message: rollbackState.failure?.message,
    revision: rollbackState.revision
  }
}
const reportFile = path.join(profile, 'local-component-update-report.json')
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`LOCAL_COMPONENT_UPDATE_TEST=${JSON.stringify({ ...report, reportFile })}`)
