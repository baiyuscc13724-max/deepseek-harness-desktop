const { spawn } = require('node:child_process')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { resolveDshBin } = require('../electron/bridge/dsh-resolver.cjs')
const { MobileSyncService } = require('../electron/bridge/mobile-sync-service.cjs')
const { SyncTransportManager } = require('../electron/bridge/sync-transport-manager.cjs')
const { createEasyTierAdapter } = require('../electron/bridge/sync-transports/easytier-adapter.cjs')
const { MobileSyncStore } = require('../electron/store/mobile-sync-store.cjs')
const { THEME_CATALOG } = require('../renderer/theme-catalog.js')
const { mobileBootstrapSource } = require('../renderer/theme-integration.js')

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function waitForRuntime(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let output = ''
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve(value)
    }
    const inspect = chunk => {
      output = `${output}${chunk}`.slice(-8000)
      const match = output.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/i)
      if (match) finish(null, match[0])
    }
    child.stdout?.on('data', inspect)
    child.stderr?.on('data', inspect)
    child.once('error', error => finish(error))
    child.once('exit', (code, signal) => finish(new Error(`DSH runtime exited before ready (code=${code}, signal=${signal || '-'}).\n${output}`)))
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for DSH runtime.\n${output}`)), timeoutMs)
  })
}

async function main() {
  const readyFile = argument('--ready-file')
  const gatewayPort = Number(argument('--port', '3081'))
  const gatewayHost = argument('--host', '127.0.0.1')
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-e2e-'))
  const requestedTarget = argument('--target')
  let runtime = null
  let runtimeUrl = requestedTarget
  if (!runtimeUrl) {
    const resolved = resolveDshBin({ nodeModulesRoot: path.join(__dirname, '..', 'node_modules') })
    runtime = spawn(resolved.command, [...resolved.argsPrefix, 'web', '--port', '0'], {
      cwd: temporary,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...resolved.env, DSH_HOME: path.join(temporary, 'dsh-home') }
    })
    runtimeUrl = await waitForRuntime(runtime)
  }
  const store = new MobileSyncStore(path.join(temporary, 'mobile-sync.json'))
  const componentRoot = argument('--remote-component-root')
  const proxy = argument('--proxy')
  const transportManager = componentRoot
    ? new SyncTransportManager({
        store,
        adapters: [createEasyTierAdapter({
          componentRoot: path.resolve(componentRoot),
          developmentRoot: path.resolve(__dirname, '..'),
          resolveProxy: proxy ? async () => `PROXY ${proxy}` : async () => 'DIRECT'
        })]
      })
    : null
  let appearance = { themeId: 'porcelain-mist', customTheme: {}, customBackgroundDataUrl: null }
  const appearancePayload = () => ({
    state: appearance,
    catalog: THEME_CATALOG.map(theme => ({
      ...theme,
      assets: Object.fromEntries(Object.entries(theme.assets || {}).map(([name, relative]) => [
        name,
        `/__harness_mobile__/theme-assets/${relative.replace(/^\.\/themes\//, '').split('/').map(encodeURIComponent).join('/')}`
      ]))
    }))
  })
  const bridge = new MobileSyncService({
    store,
    getRuntimeTarget: () => runtimeUrl,
    host: gatewayHost,
    port: gatewayPort,
    stateDir: temporary,
    transportManager,
    getAppearance: async () => appearancePayload(),
    setAppearance: async payload => {
      if (payload?.action === 'set-theme') appearance = { ...appearance, themeId: String(payload.values?.id || 'official') }
      else if (payload?.action === 'save-custom-theme') appearance = { ...appearance, themeId: 'custom', customTheme: payload.values || {} }
      else throw new Error('Unsupported appearance action.')
      return appearancePayload()
    },
    getThemeScript: () => `${mobileBootstrapSource};(() => { fetch('/__harness_mobile__/appearance', { credentials: 'same-origin' }).then(response => response.json()).then(payload => { window.__HARNESS_DESKTOP_THEME_STATE__ = payload.state; window.__HARNESS_DESKTOP_THEMES__ = payload.catalog; window.__HARNESS_DESKTOP_RENDER_THEMES__?.(); window.__harnessMobileThemeBridgeLoading = false; }); })();`,
    readThemeAsset: async relative => {
      const normalized = String(relative || '').replaceAll('\\', '/')
      if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) return null
      const file = path.resolve(__dirname, '..', 'renderer', 'themes', ...normalized.split('/'))
      const root = path.resolve(__dirname, '..', 'renderer', 'themes')
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null
      try {
        const mime = /\.png$/i.test(file) ? 'image/png' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/webp'
        return { data: readFileSync(file), mime }
      } catch {
        return null
      }
    }
  })
  await bridge.start()
  const state = await bridge.beginPairing()
  const payload = {
    ok: true,
    runtimeUrl,
    gatewayOrigin: state.origins[0],
    pairingUrl: state.pairing.url,
    appUrl: state.pairing.appUrl,
    remote: state.remote,
    pid: process.pid
  }
  if (readyFile) writeFileSync(path.resolve(readyFile), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  if (!process.argv.includes('--quiet')) process.stdout.write(`${JSON.stringify(payload)}\n`)
  else process.stdout.write('MOBILE_SYNC_E2E_READY\n')

  const shutdown = async () => {
    await bridge.stop({ persist: false }).catch(() => {})
    if (runtime?.exitCode == null) runtime.kill('SIGTERM')
    setTimeout(() => process.exit(0), 250).unref()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
