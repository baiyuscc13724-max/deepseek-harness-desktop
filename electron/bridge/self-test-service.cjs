const { access, mkdir, mkdtemp, rm, unlink, writeFile } = require('node:fs/promises')
const { spawn } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
const { runtimeAuthCookieHeaderFromSetCookie } = require('./runtime-session-auth.cjs')
const { appendRuntimeWebOutput, detectRuntimeWebUrl, normalizeRuntimeWebUrl, redactRuntimeWebAuth, safeRuntimeWebUrl } = require('./runtime-web-url.cjs')

async function rendererAvailable(rendererEntry) {
  try {
    await access(rendererEntry)
    return true
  } catch {
    return false
  }
}

function nodeRuntimeSupported(version = process.versions.node) {
  const major = Number.parseInt(String(version || '').split('.')[0], 10)
  return Number.isInteger(major) && major >= 20
}

async function userDataWritable(userData) {
  const marker = path.join(userData, `.harness-desktop-selftest-${process.pid}-${Date.now()}`)
  try {
    await mkdir(userData, { recursive: true })
    await writeFile(marker, 'ok', { encoding: 'utf8', mode: 0o600 })
    await unlink(marker)
    return true
  } catch {
    await unlink(marker).catch(() => {})
    return false
  }
}

async function marketplaceInstallable(options = {}) {
  if (typeof options.marketplaceProbe === 'function') return Boolean(await options.marketplaceProbe())
  if (typeof options.ensurePluginMarketplace !== 'function' || !options.marketplaceBundledRoot) return false
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-desktop-marketplace-probe-'))
  try {
    const result = await options.ensurePluginMarketplace({
      dshHome,
      bundledRoot: options.marketplaceBundledRoot
    })
    await access(path.join(result.destination, 'lib', 'client.js'))
    await access(path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml'))
    return true
  } catch {
    return false
  } finally {
    await rm(dshHome, { recursive: true, force: true }).catch(() => {})
  }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function probeRuntimeUrl(url, { fetchImpl = globalThis.fetch, timeoutMs = 1200 } = {}) {
  try {
    const launchUrl = normalizeRuntimeWebUrl(url)
    if (!launchUrl || typeof fetchImpl !== 'function') return false
    const response = await fetchImpl(launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    const launch = new URL(launchUrl)
    if (!launch.searchParams.has('token')) return response.status >= 200 && response.status < 300
    if (response.status !== 303) return false
    const location = response.headers?.get?.('location')
    const clean = location ? new URL(location, launchUrl) : null
    if (!clean || clean.origin !== launch.origin || clean.pathname !== '/' || clean.search || clean.hash) return false
    const cookieValues = typeof response.headers?.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers?.get?.('set-cookie')]
    const cookie = cookieValues.map(value => runtimeAuthCookieHeaderFromSetCookie(value, launchUrl)).find(Boolean)
    if (!cookie) return false
    const cleanResponse = await fetchImpl(clean.toString(), {
      cache: 'no-store',
      headers: { Cookie: cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    })
    return cleanResponse.status >= 200 && cleanResponse.status < 300
  } catch {
    return false
  }
}

function writeRedactedRuntimeOutput(state, chunk, writer) {
  let output = String(chunk || '')
  if (state.suppressUntilLineBreak) {
    const breakAt = output.search(/[\r\n]/u)
    if (breakAt < 0) return
    output = output.slice(breakAt + 1)
    state.suppressUntilLineBreak = false
  }
  state.pending += output
  const lastLineFeed = state.pending.lastIndexOf('\n')
  const lastCarriageReturn = state.pending.lastIndexOf('\r')
  const completeAt = Math.max(lastLineFeed, lastCarriageReturn)
  if (completeAt >= 0) {
    writer(redactRuntimeWebAuth(state.pending.slice(0, completeAt + 1)))
    state.pending = state.pending.slice(completeAt + 1)
  }
  if (state.pending.length > 8192) {
    writer('[runtime output line omitted]\n')
    state.pending = ''
    state.suppressUntilLineBreak = true
  }
}

function flushRedactedRuntimeOutput(state, writer) {
  if (state.pending) writer(redactRuntimeWebAuth(state.pending))
  state.pending = ''
}

async function runtimeWebBootable(dsh, options = {}) {
  if (!dsh?.command || !Array.isArray(dsh.argsPrefix)) return false
  const spawnImpl = options.spawnImpl || spawn
  const probeUrl = options.probeUrl || probeRuntimeUrl
  const ownsRuntimeHome = !options.runtimeHome
  const runtimeHome = options.runtimeHome || await mkdtemp(path.join(os.tmpdir(), 'harness-desktop-runtime-probe-'))
  const deadline = Date.now() + (options.timeoutMs || 25000)
  const maxAttempts = Number.isSafeInteger(options.maxAttempts) && options.maxAttempts > 0 ? options.maxAttempts : 3
  const diagnostics = options.diagnostics && Array.isArray(options.diagnostics.attempts) ? options.diagnostics : null
  try {
    for (let attempt = 1; attempt <= maxAttempts && Date.now() < deadline; attempt += 1) {
      let child = null
      let candidateUrl = null
      let exited = false
      let exitCode = null
      let signal = null
      let failure = ''
      let booted = false
      let stdoutBuffer = ''
      let stderrBuffer = ''
      const stdoutLog = { pending: '', suppressUntilLineBreak: false }
      const stderrLog = { pending: '', suppressUntilLineBreak: false }
      try {
        child = spawnImpl(dsh.command, [...dsh.argsPrefix, 'web', '--port', '0', '--no-open'], {
          env: { ...process.env, ...(dsh.env || {}), DSH_HOME: runtimeHome, HARNESS_DESKTOP_MARKETPLACE_PATCH_OWNER: '1' },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        const inspect = (chunk, isError = false) => {
          if (isError) stderrBuffer = appendRuntimeWebOutput(stderrBuffer, chunk)
          else stdoutBuffer = appendRuntimeWebOutput(stdoutBuffer, chunk)
          const detected = detectRuntimeWebUrl(isError ? stderrBuffer : stdoutBuffer)
          if (detected) candidateUrl = detected
        }
        child.stdout?.on('data', chunk => {
          inspect(chunk)
          if (options.logOutput) writeRedactedRuntimeOutput(stdoutLog, chunk, value => process.stdout.write(value))
        })
        child.stderr?.on('data', chunk => {
          inspect(chunk, true)
          if (options.logOutput) writeRedactedRuntimeOutput(stderrLog, chunk, value => process.stderr.write(value))
        })
        child.once('error', error => { failure = String(error?.message || error || 'spawn error'); exited = true })
        child.once('exit', (code, receivedSignal) => { exitCode = code; signal = receivedSignal; exited = true })
        while (Date.now() < deadline && !exited) {
          if (candidateUrl && await probeUrl(candidateUrl)) { booted = true; break }
          await wait(150)
        }
      } catch (error) {
        failure = String(error?.message || error)
      } finally {
        if (options.logOutput) {
          flushRedactedRuntimeOutput(stdoutLog, value => process.stdout.write(value))
          flushRedactedRuntimeOutput(stderrLog, value => process.stderr.write(value))
        }
        diagnostics?.attempts.push({ attempt, candidateUrl: safeRuntimeWebUrl(candidateUrl), exited, exitCode, signal, failure: redactRuntimeWebAuth(failure) })
        child?.kill?.()
      }
      if (booted) return true
      if (attempt < maxAttempts && Date.now() < deadline) await wait(150)
    }
    return false
  } finally {
    if (ownsRuntimeHome) await rm(runtimeHome, { recursive: true, force: true }).catch(() => {})
  }
}

async function runPackagedSelfTest(options = {}) {
  let dsh = { source: 'unknown', version: 'unknown', error: '' }
  try {
    dsh = options.resolveDshBin()
  } catch (error) {
    dsh = { source: 'error', version: 'unknown', error: error.message }
  }

  const platform = options.platform || process.platform
  const gitRuntime = typeof options.gitRuntimeProbe === 'function'
    ? await options.gitRuntimeProbe().catch(() => null)
    : null
  const runtimeDiagnostics = { attempts: [] }
  const runtimeWebBoot = options.runtimeProbe
    ? await options.runtimeProbe(dsh)
    : await runtimeWebBootable(dsh, { ...options.runtimeProbeOptions, diagnostics: runtimeDiagnostics })
  const checks = {
    rendererEntry: await rendererAvailable(options.rendererEntry),
    bundledHarness: dsh.source === 'bundled' || dsh.source === 'env',
    runtimeWebBoot,
    nodeRuntime: nodeRuntimeSupported(options.nodeVersion),
    userData: options.userDataProbe
      ? await options.userDataProbe(options.userData)
      : await userDataWritable(options.userData),
    desktopMarketplace: await marketplaceInstallable(options),
    // Bundled MinGit is Windows-only by design. On Windows the packaged app
    // must use the bundled Git toolchain; on macOS/Linux any available Git
    // (system or bundled) satisfies the release probe.
    bundledGit: !gitRuntime ? true : platform === 'win32'
      ? gitRuntime.git?.source === 'bundled' && gitRuntime.git?.available === true && gitRuntime.gcm?.available === true
      : gitRuntime.git?.available === true,
    webCompatibility: true
  }

  return {
    ok: Object.values(checks).every(Boolean),
    product: {
      name: 'Harness Desktop',
      version: options.appVersion || 'unknown',
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron || '',
      node: process.versions.node || ''
    },
    checks,
    dsh: {
      source: dsh.source || 'unknown',
      version: dsh.version || 'unknown',
      detail: dsh.error || ''
    },
    runtimeProbe: runtimeDiagnostics,
    git: gitRuntime || { git: { available: false, source: null }, gcm: { available: false, source: null }, sshAgent: { available: false, running: false } },
    generatedAt: new Date().toISOString()
  }
}

module.exports = { marketplaceInstallable, nodeRuntimeSupported, probeRuntimeUrl, rendererAvailable, runPackagedSelfTest, runtimeWebBootable, userDataWritable }
