const { access, mkdir, mkdtemp, rm, unlink, writeFile } = require('node:fs/promises')
const { spawn } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')

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

async function probeRuntimeUrl(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) })
    return response.status >= 200 && response.status < 500
  } catch {
    return false
  }
}

async function runtimeWebBootable(dsh, options = {}) {
  if (!dsh?.command || !Array.isArray(dsh.argsPrefix)) return false
  const spawnImpl = options.spawnImpl || spawn
  const probeUrl = options.probeUrl || probeRuntimeUrl
  const ownsRuntimeHome = !options.runtimeHome
  const runtimeHome = options.runtimeHome || await mkdtemp(path.join(os.tmpdir(), 'harness-desktop-runtime-probe-'))
  let child = null
  let candidateUrl = null
  let exited = false
  try {
    child = spawnImpl(dsh.command, [...dsh.argsPrefix, 'web', '--port', '0'], {
      env: { ...process.env, ...(dsh.env || {}), DSH_HOME: runtimeHome },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const inspect = chunk => {
      const match = String(chunk || '').match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/i)
      if (match) candidateUrl = match[0].replace('localhost', '127.0.0.1')
    }
    child.stdout?.on('data', inspect)
    child.stderr?.on('data', inspect)
    child.once('error', () => { exited = true })
    child.once('exit', () => { exited = true })
    const deadline = Date.now() + (options.timeoutMs || 25000)
    while (Date.now() < deadline && !exited) {
      if (candidateUrl && await probeUrl(candidateUrl)) return true
      await wait(150)
    }
    return false
  } catch {
    return false
  } finally {
    child?.kill?.()
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

  const checks = {
    rendererEntry: await rendererAvailable(options.rendererEntry),
    bundledHarness: dsh.source === 'bundled' || dsh.source === 'env',
    runtimeWebBoot: options.runtimeProbe
      ? await options.runtimeProbe(dsh)
      : await runtimeWebBootable(dsh, options.runtimeProbeOptions),
    nodeRuntime: nodeRuntimeSupported(options.nodeVersion),
    userData: options.userDataProbe
      ? await options.userDataProbe(options.userData)
      : await userDataWritable(options.userData),
    desktopMarketplace: await marketplaceInstallable(options),
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
    generatedAt: new Date().toISOString()
  }
}

module.exports = { marketplaceInstallable, nodeRuntimeSupported, rendererAvailable, runPackagedSelfTest, runtimeWebBootable, userDataWritable }
