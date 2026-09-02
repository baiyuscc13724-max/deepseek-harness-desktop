'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const ONEOFF_TAG = 'v1.0.58'
const ONEOFF_VERSION = '1.0.58'
const WORKFLOW_PATH = '.github/workflows/release.yml'
const WORKFLOW_NAME = 'Cloud Build & Release Desktop'
const REMOVAL_MARKER = 'DELETE the v1.0.58 one-off workflow job, script, and contract tests immediately after v1.0.58 publication completes.'
const EXPECTED_ARTIFACT_NAMES = Object.freeze([
  `Harness-Desktop-${ONEOFF_VERSION}-portable-x64.exe`,
  `Harness-Desktop-${ONEOFF_VERSION}-win-x64.exe`,
])
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const REVISION_PATTERN = /^[0-9a-f]{40}$/u

const SHELL_PROBE_EXPRESSION = `(() => {
  const runtime = document.querySelector('#runtimeView')
  const splash = document.querySelector('#startupSplash')
  const status = document.querySelector('#runtimeStatus')
  return {
    readyState: document.readyState,
    title: document.title,
    shell: Boolean(document.querySelector('main.official-shell')),
    startupComplete: Boolean(splash?.classList.contains('is-complete') && splash?.getAttribute('aria-hidden') === 'true'),
    runtimeReady: Boolean(status?.classList.contains('ready')),
    runtimeUrl: String(runtime?.src || ''),
  }
})()`

const GUEST_PROBE_EXPRESSION = `(() => {
  const visible = node => {
    if (!node) return false
    const style = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }
  const conversation = document.querySelector('[data-slot="conversation"]')
  const scroll = document.querySelector('[data-conversation-scroll]')
  const composer = document.querySelector('[data-composer-card]')
  const composerInput = composer?.querySelector('textarea,[contenteditable="true"],[role="textbox"]')
  const workspaceChooser = [...document.querySelectorAll('button')].find(node => /^(选择工作区|Choose workspace)$/iu.test(String(node.getAttribute('aria-label') || node.textContent || '').trim()))
  return {
    readyState: document.readyState,
    title: document.title,
    href: location.href,
    origin: location.origin,
    conversation: Boolean(conversation),
    conversationScroll: Boolean(scroll),
    composer: Boolean(composer),
    composerVisible: visible(composer),
    homeAction: Boolean(visible(composerInput) || visible(workspaceChooser)),
  }
})()`

function argument(argv, name, fallback = '') {
  const exact = argv.indexOf(`--${name}`)
  if (exact >= 0) return argv[exact + 1] ?? fallback
  const prefix = `--${name}=`
  const joined = argv.find(value => String(value).startsWith(prefix))
  return joined ? String(joined).slice(prefix.length) : fallback
}

function isPathInside(root, candidate, { allowEqual = false } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  if (!relative) return allowEqual
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function assertPathInside(root, candidate, label, options) {
  if (!isPathInside(root, candidate, options)) throw new Error(`${label} must stay inside RUNNER_TEMP.`)
  return path.resolve(candidate)
}

function normalizeIdentity({ tag, sourceRevision, githubSha, runId, workflowRef, workflowName = WORKFLOW_NAME }) {
  const normalizedTag = String(tag || '').trim()
  const normalizedRevision = String(sourceRevision || '').trim().toLowerCase()
  const normalizedGithubSha = String(githubSha || '').trim().toLowerCase()
  const normalizedRunId = String(runId || '').trim()
  const normalizedWorkflowRef = String(workflowRef || '').trim().replaceAll('\\', '/')
  const normalizedWorkflowName = String(workflowName || '').trim()

  if (normalizedTag !== ONEOFF_TAG) throw new Error(`This validation is intentionally restricted to ${ONEOFF_TAG}.`)
  if (!REVISION_PATTERN.test(normalizedRevision)) throw new Error('sourceRevision must be an exact lowercase 40-character commit SHA.')
  if (normalizedGithubSha !== normalizedRevision) throw new Error('GITHUB_SHA does not match the requested sourceRevision.')
  if (!/^[1-9][0-9]*$/u.test(normalizedRunId)) throw new Error('GitHub workflow run id is invalid.')
  if (normalizedWorkflowName !== WORKFLOW_NAME) throw new Error('GitHub workflow name does not match the formal desktop candidate workflow.')
  if (!normalizedWorkflowRef.includes(`/${WORKFLOW_PATH}@refs/heads/main`)) {
    throw new Error('GitHub workflow ref is not the main-branch formal desktop candidate workflow.')
  }

  return Object.freeze({
    tag: normalizedTag,
    version: ONEOFF_VERSION,
    sourceRevision: normalizedRevision,
    githubSha: normalizedGithubSha,
    runId: normalizedRunId,
    workflowRef: normalizedWorkflowRef,
    workflowName: normalizedWorkflowName,
  })
}

function createValidationLayout({ runnerTemp, reportPath = '' }) {
  const normalizedRunnerTemp = path.resolve(String(runnerTemp || ''))
  if (!normalizedRunnerTemp || !existsSync(normalizedRunnerTemp) || !statSync(normalizedRunnerTemp).isDirectory()) {
    throw new Error('RUNNER_TEMP must be an existing directory.')
  }
  const normalizedReportPath = assertPathInside(
    normalizedRunnerTemp,
    reportPath || path.join(normalizedRunnerTemp, 'release-oneoff-v1.0.58-windows-ui-evidence.json'),
    'Structured evidence report',
  )
  const validationRoot = mkdtempSync(path.join(normalizedRunnerTemp, 'harness-v1.0.58-ui-'))
  try {
    const electronUserDataDir = path.join(validationRoot, 'electron-user-data')
    const layout = Object.freeze({
      runnerTemp: normalizedRunnerTemp,
      validationRoot,
      installRoot: path.join(validationRoot, 'installed-app'),
      electronUserDataDir,
      harnessUserDataDir: path.join(electronUserDataDir, 'HarnessData'),
      installerLogPath: path.join(validationRoot, 'installer.log'),
      reportPath: normalizedReportPath,
    })
    for (const [label, value] of Object.entries(layout)) {
      if (!label.endsWith('Root') && !label.endsWith('Dir') && !label.endsWith('Path')) continue
      if (label === 'runnerTemp') continue
      assertPathInside(normalizedRunnerTemp, value, label)
    }
    if (isPathInside(validationRoot, layout.reportPath, { allowEqual: true })) {
      throw new Error('Structured evidence report must survive outside the disposable validation root.')
    }
    return layout
  } catch (error) {
    rmSync(validationRoot, { recursive: true, force: true })
    throw error
  }
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function bindInstallerArtifact({ artifactRoot, runnerTemp, identity }) {
  const normalizedArtifactRoot = assertPathInside(runnerTemp, artifactRoot, 'Downloaded artifact directory')
  if (!existsSync(normalizedArtifactRoot) || !statSync(normalizedArtifactRoot).isDirectory()) {
    throw new Error('Downloaded current-run Windows artifact directory is missing.')
  }
  const names = readdirSync(normalizedArtifactRoot, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort()
  if (JSON.stringify(names) !== JSON.stringify([...EXPECTED_ARTIFACT_NAMES].sort())) {
    throw new Error(`Current-run Windows artifact has an unexpected file set: ${JSON.stringify(names)}`)
  }
  const name = `Harness-Desktop-${identity.version}-win-x64.exe`
  const file = path.join(normalizedArtifactRoot, name)
  const metadata = lstatSync(file)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) throw new Error('Formal Windows installer artifact is empty, linked, or not a file.')
  const digest = sha256File(file)
  if (!SHA256_PATTERN.test(digest)) throw new Error('Formal Windows installer digest is invalid.')
  return Object.freeze({ name, path: file, size: metadata.size, sha256: digest })
}

function installedLayout(layout) {
  const executablePath = path.join(layout.installRoot, 'Harness Desktop.exe')
  const asarPath = path.join(layout.installRoot, 'resources', 'app.asar')
  const uninstallers = existsSync(layout.installRoot)
    ? readdirSync(layout.installRoot, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^unins.*\.exe$/iu.test(entry.name))
      .map(entry => path.join(layout.installRoot, entry.name))
    : []
  if (!existsSync(executablePath) || !statSync(executablePath).isFile()) throw new Error('Installed Harness Desktop executable is missing.')
  if (!existsSync(asarPath) || !statSync(asarPath).isFile()) throw new Error('Installed app.asar is missing.')
  if (uninstallers.length !== 1) throw new Error(`Expected exactly one installed Windows uninstaller; found ${uninstallers.length}.`)
  return Object.freeze({ executablePath, asarPath, uninstallerPath: uninstallers[0] })
}

function processFailure(label, result) {
  const detail = [result?.stdout, result?.stderr].map(value => String(value || '').trim()).filter(Boolean).join('\n')
  const suffix = detail ? `\n${detail.slice(-12000)}` : ''
  if (result?.error) return new Error(`${label} failed: ${result.error.message}${suffix}`)
  return new Error(`${label} exited with code ${String(result?.status)}.${suffix}`)
}

function runBounded(file, args, { label, timeoutMs, env = process.env, spawnSyncImpl = spawnSync }) {
  const result = spawnSyncImpl(file, args, {
    env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
  })
  if (result?.error || result?.signal || result?.status !== 0) throw processFailure(label, result)
  return result
}

async function installCandidate({ artifact, layout, spawnSyncImpl }) {
  mkdirSync(layout.installRoot, { recursive: true })
  runBounded(artifact.path, [
    '/VERYSILENT',
    '/SUPPRESSMSGBOXES',
    '/NORESTART',
    '/NORESTARTAPPLICATIONS',
    `/LOG=${layout.installerLogPath}`,
    `/DIR=${layout.installRoot}`,
  ], { label: 'v1.0.58 one-off Windows installer', timeoutMs: 300_000, spawnSyncImpl })
}

async function reserveLoopbackPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  if (!Number.isInteger(port) || port < 1) throw new Error('Could not reserve a loopback CDP port.')
  return port
}

function ordinaryLaunchArguments({ layout, cdpPort }) {
  return Object.freeze([
    `--user-data-dir=${layout.electronUserDataDir}`,
    `--harness-user-data-dir=${layout.electronUserDataDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${cdpPort}`,
  ])
}

async function launchOrdinaryApplication({ installed, layout, cdpPort, spawnImpl = spawn }) {
  mkdirSync(layout.electronUserDataDir, { recursive: true })
  const args = ordinaryLaunchArguments({ layout, cdpPort })
  if (args.some(value => value === '--self-test' || value.startsWith('--self-test-'))) throw new Error('Homepage validation must launch the ordinary app, never self-test mode.')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawnImpl(installed.executablePath, args, {
    cwd: layout.installRoot,
    env,
    stdio: 'ignore',
    windowsHide: false,
  })
  await new Promise((resolve, reject) => {
    const onSpawn = () => { child.off?.('error', onError); resolve() }
    const onError = error => { child.off?.('spawn', onSpawn); reject(error) }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error('Ordinary installed Harness Desktop process did not expose a valid pid.')
  return Object.freeze({ child, pid: child.pid, args, cdpPort })
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function cdpTargets(port, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}.`)
  const targets = await response.json()
  if (!Array.isArray(targets)) throw new Error('CDP target list is not an array.')
  return targets
}

async function evaluateCdp(webSocketDebuggerUrl, expression, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 10_000 } = {}) {
  if (typeof WebSocketImpl !== 'function') throw new Error('Node WebSocket support is unavailable for structured homepage validation.')
  const socket = new WebSocketImpl(webSocketDebuggerUrl)
  let timer
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CDP WebSocket open timed out.')), timeoutMs)
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('CDP WebSocket open failed.')), { once: true })
    })
    clearTimeout(timer)
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CDP Runtime.evaluate timed out.')), timeoutMs)
      socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data))
        if (message.id === 1) resolve(message)
      })
      socket.addEventListener('error', () => reject(new Error('CDP Runtime.evaluate failed.')), { once: true })
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    })
    clearTimeout(timer)
    if (response.error) throw new Error(`CDP Runtime.evaluate error: ${response.error.message}`)
    if (response.result?.exceptionDetails) throw new Error('CDP homepage probe raised an exception.')
    return response.result?.result?.value
  } finally {
    clearTimeout(timer)
    try { socket.close() } catch {}
  }
}

function loopbackHttpUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function validateHomepageProof(proof) {
  const shell = proof?.shell
  const guest = proof?.guest
  if (!shell || shell.readyState !== 'complete' || shell.title !== 'Harness Desktop' || shell.shell !== true) {
    throw new Error('Installed application shell did not reach its structured ready state.')
  }
  if (shell.startupComplete !== true || shell.runtimeReady !== true || !loopbackHttpUrl(shell.runtimeUrl)) {
    throw new Error('Installed application shell did not finish opening the local Harness workbench.')
  }
  if (!guest || guest.readyState !== 'complete' || !loopbackHttpUrl(guest.href) || !loopbackHttpUrl(guest.origin)) {
    throw new Error('Official Harness guest did not reach a complete loopback page.')
  }
  if (guest.conversation !== true || guest.conversationScroll !== true || guest.composer !== true || guest.composerVisible !== true || guest.homeAction !== true) {
    throw new Error('Official Harness guest did not expose the structured homepage conversation and composer controls.')
  }
  return true
}

async function proveHomepage({ launched, timeoutMs = 180_000, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket }) {
  const deadline = Date.now() + timeoutMs
  let lastObservation = null
  while (Date.now() < deadline) {
    if (launched.child.exitCode != null) throw new Error(`Installed application exited before homepage validation (code ${launched.child.exitCode}).`)
    try {
      const targets = await cdpTargets(launched.cdpPort, fetchImpl)
      const shellTarget = targets.find(target => target.type === 'page' && /renderer(?:\\|\/)index\.html/iu.test(decodeURIComponent(String(target.url || ''))))
      const guestTarget = targets.find(target => target.type === 'webview' && loopbackHttpUrl(target.url))
      if (shellTarget?.webSocketDebuggerUrl && guestTarget?.webSocketDebuggerUrl) {
        const [shell, guest] = await Promise.all([
          evaluateCdp(shellTarget.webSocketDebuggerUrl, SHELL_PROBE_EXPRESSION, { WebSocketImpl }),
          evaluateCdp(guestTarget.webSocketDebuggerUrl, GUEST_PROBE_EXPRESSION, { WebSocketImpl }),
        ])
        lastObservation = { shell, guest }
        try {
          validateHomepageProof(lastObservation)
          return Object.freeze({
            shell,
            guest,
            targets: Object.freeze({ shell: shellTarget.url, guest: guestTarget.url }),
            method: 'cdp-runtime-evaluate',
          })
        } catch {}
      }
    } catch (error) {
      lastObservation = { error: error.message }
    }
    await wait(1_000)
  }
  throw new Error(`Installed ordinary application did not reach the structured homepage before timeout: ${JSON.stringify(lastObservation)}`)
}

async function stopOrdinaryApplication({ launched, spawnSyncImpl = spawnSync }) {
  if (!launched?.pid) return
  if (launched.child?.exitCode != null) return
  const result = spawnSyncImpl('taskkill.exe', ['/PID', String(launched.pid), '/T', '/F'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  if (result?.error || (result?.status !== 0 && launched.child?.exitCode == null)) throw processFailure('Installed application process-tree stop', result)
}

async function uninstallCandidate({
  installed,
  layout,
  spawnSyncImpl = spawnSync,
  waitImpl = wait,
  maxCleanupAttempts = 120,
}) {
  runBounded(installed.uninstallerPath, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
    label: 'v1.0.58 one-off Windows uninstaller',
    timeoutMs: 300_000,
    spawnSyncImpl,
  })
  for (let attempt = 0; attempt < maxCleanupAttempts; attempt += 1) {
    if (!existsSync(layout.installRoot)) return
    let residualEntries
    try { residualEntries = readdirSync(layout.installRoot) } catch (error) {
      if (error?.code === 'ENOENT' || !existsSync(layout.installRoot)) return
      throw error
    }
    if (residualEntries.length === 0) {
      try { rmdirSync(layout.installRoot) } catch (error) {
        if (error?.code === 'ENOENT' || !existsSync(layout.installRoot)) return
        if (!['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error
      }
      if (!existsSync(layout.installRoot)) return
    }
    await waitImpl(500)
  }
  if (!existsSync(layout.installRoot)) return
  let residualEntries
  try { residualEntries = readdirSync(layout.installRoot).slice(0, 32) } catch (error) {
    if (error?.code === 'ENOENT' || !existsSync(layout.installRoot)) return
    throw error
  }
  throw new Error(`Windows uninstaller left residual entries in the isolated installation directory: ${residualEntries.join(', ') || '(empty directory)'}.`)
}

function writeReport(reportPath, report) {
  mkdirSync(path.dirname(reportPath), { recursive: true })
  const temporary = `${reportPath}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, reportPath)
}

async function performOneoffWindowsUiValidation(options = {}) {
  const platform = options.platform || process.platform
  const arch = options.arch || process.arch
  if (platform !== 'win32' || arch !== 'x64') throw new Error('The v1.0.58 one-off installed homepage validation requires a Windows x64 runner.')

  const identity = normalizeIdentity(options)
  const layout = createValidationLayout(options)
  const lifecycle = []
  const mark = phase => lifecycle.push(Object.freeze({ phase, at: new Date().toISOString() }))
  let artifact
  let installed
  let launched
  let homepage
  let primaryError = null
  const cleanupErrors = []

  const installImpl = options.installImpl || installCandidate
  const launchImpl = options.launchImpl || launchOrdinaryApplication
  const proveHomepageImpl = options.proveHomepageImpl || proveHomepage
  const stopImpl = options.stopImpl || stopOrdinaryApplication
  const uninstallImpl = options.uninstallImpl || uninstallCandidate
  const reservePortImpl = options.reservePortImpl || reserveLoopbackPort

  try {
    artifact = bindInstallerArtifact({ artifactRoot: options.artifactRoot, runnerTemp: layout.runnerTemp, identity })
    mark('same-run-installer-bound')
    await installImpl({ artifact, identity, layout, spawnSyncImpl: options.spawnSyncImpl })
    installed = installedLayout(layout)
    mark('isolated-install-complete')
    const cdpPort = await reservePortImpl()
    launched = await launchImpl({ installed, identity, layout, cdpPort, spawnImpl: options.spawnImpl })
    if (!launched || !Number.isSafeInteger(launched.pid) || launched.pid <= 0) throw new Error('Ordinary application launch did not return a valid process identity.')
    if (!Array.isArray(launched.args) || launched.args.some(value => String(value).startsWith('--self-test'))) {
      throw new Error('Ordinary application launch contract is missing or entered self-test mode.')
    }
    mark('ordinary-application-launched')
    homepage = await proveHomepageImpl({ launched, installed, identity, layout, timeoutMs: options.timeoutMs })
    validateHomepageProof(homepage)
    mark('structured-homepage-proved')
  } catch (error) {
    primaryError = error
  } finally {
    if (launched) {
      try {
        await stopImpl({ launched, installed, identity, layout, spawnSyncImpl: options.spawnSyncImpl })
        mark('application-process-tree-stopped')
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (installed) {
      try {
        await uninstallImpl({ launched, installed, identity, layout, spawnSyncImpl: options.spawnSyncImpl })
        mark('isolated-install-uninstalled')
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
  }

  try {
    rmSync(layout.validationRoot, { recursive: true, force: true })
    if (existsSync(layout.validationRoot)) throw new Error('Disposable validation root could not be removed.')
    mark('validation-root-removed')
  } catch (error) {
    cleanupErrors.push(error)
  }

  const ok = !primaryError && cleanupErrors.length === 0
  const report = {
    schemaVersion: 1,
    kind: 'release-oneoff-v1.0.58-windows-ui-validation',
    ok,
    oneOff: true,
    removalMarker: REMOVAL_MARKER,
    identity,
    artifact: artifact ? { name: artifact.name, size: artifact.size, sha256: artifact.sha256 } : null,
    isolation: {
      runnerTemp: layout.runnerTemp,
      validationRoot: layout.validationRoot,
      installRoot: layout.installRoot,
      electronUserDataDir: layout.electronUserDataDir,
      harnessUserDataDir: layout.harnessUserDataDir,
    },
    launchMode: 'ordinary-application-with-cdp-structure-probe',
    launchArguments: launched?.args || null,
    homepage: homepage || null,
    lifecycle,
    error: primaryError ? { name: primaryError.name, message: primaryError.message } : null,
    cleanupErrors: cleanupErrors.map(error => ({ name: error.name, message: error.message })),
  }
  writeReport(layout.reportPath, report)

  if (!ok) {
    const messages = [primaryError, ...cleanupErrors].filter(Boolean).map(error => error.message)
    const error = new Error(`v1.0.58 pre-Tag installed homepage validation failed: ${messages.join(' | ')}`)
    error.reportPath = layout.reportPath
    throw error
  }
  return Object.freeze({ ...report, reportPath: layout.reportPath })
}

function cliOptions(argv = process.argv.slice(2), env = process.env) {
  return {
    tag: argument(argv, 'tag', env.ONEOFF_TAG || env.RELEASE_TAG),
    sourceRevision: argument(argv, 'source-revision', env.ONEOFF_SOURCE_REVISION || env.SOURCE_REVISION),
    githubSha: argument(argv, 'github-sha', env.GITHUB_SHA),
    runId: argument(argv, 'run-id', env.ONEOFF_RUN_ID || env.GITHUB_RUN_ID),
    workflowRef: argument(argv, 'workflow-ref', env.ONEOFF_WORKFLOW_REF || env.GITHUB_WORKFLOW_REF),
    workflowName: argument(argv, 'workflow-name', env.ONEOFF_WORKFLOW_NAME || env.GITHUB_WORKFLOW),
    runnerTemp: argument(argv, 'runner-temp', env.RUNNER_TEMP),
    artifactRoot: argument(argv, 'artifact-root', env.ONEOFF_ARTIFACT_ROOT),
    reportPath: argument(argv, 'report', env.ONEOFF_REPORT_PATH),
  }
}

module.exports = {
  EXPECTED_ARTIFACT_NAMES,
  GUEST_PROBE_EXPRESSION,
  ONEOFF_TAG,
  ONEOFF_VERSION,
  REMOVAL_MARKER,
  SHELL_PROBE_EXPRESSION,
  WORKFLOW_NAME,
  WORKFLOW_PATH,
  bindInstallerArtifact,
  cliOptions,
  createValidationLayout,
  isPathInside,
  normalizeIdentity,
  ordinaryLaunchArguments,
  performOneoffWindowsUiValidation,
  uninstallCandidate,
  validateHomepageProof,
}

if (require.main === module) {
  performOneoffWindowsUiValidation(cliOptions())
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error?.stack || error)
      if (error?.reportPath) console.error(`Structured failure evidence: ${error.reportPath}`)
      process.exitCode = 1
    })
}
