const { access, mkdir, unlink, writeFile } = require('node:fs/promises')
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
    nodeRuntime: nodeRuntimeSupported(options.nodeVersion),
    userData: options.userDataProbe
      ? await options.userDataProbe(options.userData)
      : await userDataWritable(options.userData),
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

module.exports = { nodeRuntimeSupported, rendererAvailable, runPackagedSelfTest, userDataWritable }
