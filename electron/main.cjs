const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, powerMonitor, screen, session, shell, Tray } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync, mkdirSync } = require('node:fs')
const { copyFile, mkdir, readFile, stat, unlink, writeFile } = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const AdmZip = require('adm-zip')
const WebSocket = require('ws')

const { resolveDshBin } = require('./bridge/dsh-resolver.cjs')
const { ensureRuntimeNodeModules } = require('./bridge/runtime-bundle-service.cjs')
const { ensureModelRouting, getModelRouting, saveModelRouting } = require('./bridge/model-routing-service.cjs')
const { createDefaultProviderMeterRegistry } = require('./bridge/provider-meter-service.cjs')
const { ensurePluginMarketplace } = require('./bridge/plugin-marketplace-service.cjs')
const { ensureMobileControlPlugin } = require('./bridge/mobile-control-plugin-service.cjs')
const { spawnCommand } = require('./bridge/process-spawn.cjs')
const { terminateProcessTree } = require('./bridge/process-tree.cjs')
const { desktopRuntimeEnvironment, resolveDesktopRuntimePaths } = require('./bridge/dsh-home.cjs')
const { resolveUserDataOverride } = require('./bridge/user-data-override.cjs')
const { buildRuntimeProxyEnv, hasExplicitProxy } = require('./bridge/runtime-proxy.cjs')
const { DEFAULT_APP_FEEDS, checkAppUpdate, checkHarnessUpstream, parseChecksumFile } = require('./bridge/update-service.cjs')
const { checksumWithFallback, downloadWithFallback } = require('./bridge/update-download-service.cjs')
const { resolveUpdateFeeds } = require('./bridge/update-feed-config.cjs')
const { openDesktopInstaller } = require('./bridge/update-launcher.cjs')
const { resolveComponentUpdateConfig } = require('./bridge/component-update-config.cjs')
const { ComponentUpdateService } = require('./bridge/component-update-service.cjs')
const { ComponentUpdateStore } = require('./bridge/component-update-store.cjs')
const { launchComponentUpdateHelper } = require('./bridge/component-update-launcher.cjs')
const { normalizeLocalTarget, openLocalTarget } = require('./bridge/local-target-service.cjs')
const { inspectAttachmentPaths } = require('./bridge/attachment-reference-service.cjs')
const { MobileSyncService } = require('./bridge/mobile-sync-service.cjs')
const { loadMobileRelayConfig } = require('./bridge/mobile-relay-config.cjs')
const { createEasyTierComponentInstaller } = require('./bridge/network-component-service.cjs')
const { SyncTransportManager } = require('./bridge/sync-transport-manager.cjs')
const { createEasyTierAdapter } = require('./bridge/sync-transports/easytier-adapter.cjs')
const { createWssRelayAdapter } = require('./bridge/sync-transports/wss-relay-adapter.cjs')
const { createTailscaleAdapter } = require('./bridge/sync-transports/tailscale-adapter.cjs')
const { runPackagedSelfTest } = require('./bridge/self-test-service.cjs')
const { beginWindowDrag, moveWindowDrag, endWindowDrag } = require('./bridge/window-drag-service.cjs')
const { createDesktopTray } = require('./desktop-tray.cjs')
const { distributionInfo, isStoreDistribution } = require('./distribution.cjs')
const { AppStateStore } = require('./store/app-state-store.cjs')
const { MobileSyncStore } = require('./store/mobile-sync-store.cjs')
const { PetDomainService } = require('./pet/pet-domain-service.cjs')
const { PetEventAdapter } = require('./pet/pet-event-adapter.cjs')
const { PetStateStore } = require('./pet/pet-state-store.cjs')
const { PetWindowController } = require('./pet/pet-window.cjs')
const { THEME_CATALOG } = require('../renderer/theme-catalog.js')
const { mobileBootstrapSource } = require('../renderer/theme-integration.js')
const desktopPackage = require('../package.json')

const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:3080'
const LOCAL_RUNTIME_HOSTS = new Set(['127.0.0.1', 'localhost'])
const SELF_TEST_MODE = process.argv.includes('--self-test')
const COMPONENT_HEALTH_CHECK_MODE = process.argv.includes('--component-health-check')
const HAS_SINGLE_INSTANCE_LOCK = SELF_TEST_MODE || COMPONENT_HEALTH_CHECK_MODE || app.requestSingleInstanceLock()
const STORE_BUILD = isStoreDistribution()

let mainWindow = null
let providerMeterRegistryPromise = null
let runtime = null
let runtimeOwnedByDesktop = false
let runtimeState = { status: 'stopped', url: null, detail: '' }
let appStateStore = null
let lastUpdatePayload = null
let activeUpdateInstall = null
let readyUpdate = null
let petStateStore = null
let petDomain = null
let petAdapter = null
let petWindowController = null
let petTickTimer = null
let desktopTray = null
let isQuitting = false
let runtimeNodeModulesRoot = null
let runtimeInitializationPromise = null
let mobileSyncStore = null
let mobileSyncService = null
let mobileSyncTransportManager = null
let componentUpdateServicePromise = null
let lastComponentUpdateCheck = null

const BUNDLED_THEME_ASSETS = Object.freeze([
  'maid-atelier/maid-atelier-maid-left-v5.webp',
  'maid-atelier/maid-atelier-maid-right-v6.webp',
  'maid-atelier/maid-atelier-palace-day-v4.webp',
  'maid-atelier/maid-atelier-palace-night-v4.webp'
])

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function setRuntimeState(next) {
  runtimeState = { ...runtimeState, ...next }
  send('runtime:state', runtimeState)
  if (runtimeState.status === 'ready' && runtimeState.url && petAdapter) {
    petAdapter.start(runtimeState.url).catch(error => console.warn(`Unable to start pet event adapter: ${error.message}`))
  } else if (['stopped', 'error'].includes(runtimeState.status) && petAdapter) {
    petAdapter.stop()
    petDomain?.resetTransient()
  }
  mobileSyncService?.publish()
}

function ensureStateStore() {
  if (!appStateStore) appStateStore = new AppStateStore(path.join(app.getPath('userData'), 'app-state.json'))
  return appStateStore
}

function ensureMobileSyncService() {
  if (mobileSyncService) return mobileSyncService
  const userData = app.getPath('userData')
  const componentRoot = path.join(userData, 'network-components')
  const stateDir = path.join(userData, 'mobile-sync-network')
  mkdirSync(componentRoot, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  mobileSyncStore = new MobileSyncStore(path.join(userData, 'mobile-sync.json'))
  let relayConfig = { enabled: false, relayUrl: '' }
  try {
    relayConfig = loadMobileRelayConfig({
      file: path.join(app.getAppPath(), 'mobile-relay-sources.json'),
      env: process.env,
      allowEnvironmentOverride: !app.isPackaged
    })
  } catch (error) {
    console.warn(`Unable to load WSS relay configuration: ${error.message}`)
  }
  const adapterOptions = {
    resourcesPath: process.resourcesPath,
    componentRoot,
    developmentRoot: path.resolve(__dirname, '..'),
    ensureBinary: createEasyTierComponentInstaller({
      componentRoot,
      fetchImpl: (url, options) => net.fetch(url, options)
    }),
    resolveProxy: url => session.defaultSession.resolveProxy(url),
    relayUrl: relayConfig.enabled ? relayConfig.relayUrl : '',
    WebSocketImpl: WebSocket
  }
  mobileSyncTransportManager = new SyncTransportManager({
    store: mobileSyncStore,
    adapters: [createEasyTierAdapter(adapterOptions), createWssRelayAdapter(adapterOptions), createTailscaleAdapter(adapterOptions)]
  })
  mobileSyncService = new MobileSyncService({
    store: mobileSyncStore,
    getRuntimeTarget: () => runtimeState.status === 'ready' ? runtimeState.url : null,
    transportManager: mobileSyncTransportManager,
    stateDir,
    getAppearance: mobileAppearancePayload,
    setAppearance: updateMobileAppearance,
    getThemeScript: () => `${mobileBootstrapSource};(() => { fetch('/__harness_mobile__/appearance', { credentials: 'same-origin' }).then(response => { if (!response.ok) throw new Error('appearance ' + response.status); return response.json(); }).then(payload => { window.__HARNESS_DESKTOP_THEME_STATE__ = payload.state; window.__HARNESS_DESKTOP_THEMES__ = payload.catalog; window.__HARNESS_DESKTOP_RENDER_THEMES__?.(); window.__harnessMobileThemeBridgeLoading = false; }).catch(error => { window.__harnessMobileThemeBridgeLoading = false; console.warn('Unable to load mobile appearance:', error); }); })();`,
    readThemeAsset: readMobileThemeAsset
  })
  mobileSyncService.on('state', state => send('mobileSync:state', state))
  return mobileSyncService
}

function desktopRuntimePaths() {
  return resolveDesktopRuntimePaths({
    env: process.env,
    argv: process.argv,
    appPath: app.getAppPath(),
    executablePath: app.getPath('exe'),
    isPackaged: app.isPackaged,
    platform: process.platform,
    store: STORE_BUILD,
    userData: app.getPath('userData'),
    userDataOverride: app.commandLine.hasSwitch('user-data-dir')
  })
}

function desktopDshHome() {
  return desktopRuntimePaths().dshHome
}

function bundledNodeModulesRoot() {
  return runtimeNodeModulesRoot || path.join(__dirname, '..', 'node_modules')
}

async function ensureBundledRuntime() {
  if (runtimeNodeModulesRoot) return runtimeNodeModulesRoot
  const componentRuntimeRoot = String(process.env.HARNESS_COMPONENT_RUNTIME_ROOT || '').trim()
  if (componentRuntimeRoot && path.isAbsolute(componentRuntimeRoot)) {
    const componentNodeModules = path.join(componentRuntimeRoot, 'node_modules')
    if (existsSync(path.join(componentNodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
      runtimeNodeModulesRoot = componentNodeModules
      return runtimeNodeModulesRoot
    }
  }
  const runtimePaths = desktopRuntimePaths()
  await Promise.all([
    mkdir(runtimePaths.dshHome, { recursive: true }),
    mkdir(runtimePaths.workspace, { recursive: true }),
    mkdir(runtimePaths.temp, { recursive: true })
  ])
  const bundledRoot = String(process.env.HARNESS_DESKTOP_BUNDLED_ROOT || '').trim()
  runtimeNodeModulesRoot = await ensureRuntimeNodeModules({
    appRoot: bundledRoot && path.isAbsolute(bundledRoot) ? bundledRoot : path.join(__dirname, '..'),
    userData: runtimePaths.root,
    appVersion: app.getVersion()
  })
  return runtimeNodeModulesRoot
}

function petPayload(domainState = petDomain?.getState()) {
  if (STORE_BUILD) {
    return {
      status: 'disabled',
      disabled: true,
      fullness: 0,
      inventory: { refined: 0, standard: 0, fragments: 0 },
      preferences: { enabled: false, awake: false, alwaysOnTop: false, autoFeed: false }
    }
  }
  return {
    ...(domainState || {}),
    preferences: ensureStateStore().get().pet
  }
}

function publishPetState(domainState = petDomain?.getState()) {
  const payload = petPayload(domainState)
  send('pet:state', payload)
  petWindowController?.publish(payload)
  return payload
}

function updatePetPreferences(patch = {}) {
  const preferences = ensureStateStore().updatePet(patch).pet
  petWindowController?.syncPreferences(preferences)
  publishPetState()
  return petPayload()
}

function ensurePetSystem() {
  if (petDomain) return
  petStateStore = new PetStateStore(path.join(app.getPath('userData'), 'pet-state.json'))
  petDomain = new PetDomainService({
    store: petStateStore,
    getPreferences: () => ensureStateStore().get().pet,
    onChange: state => publishPetState(state)
  })
  petAdapter = new PetEventAdapter({
    onEvent: event => {
      if (event.type === 'baseline') petDomain.ingestBaseline(event)
      else petDomain.ingest(event)
    },
    onDiagnostic: message => console.warn(message)
  })
  petWindowController = new PetWindowController({
    BrowserWindow,
    screen,
    appRoot: path.join(__dirname, '..'),
    preload: path.join(__dirname, 'pet', 'pet-preload.cjs'),
    getPreferences: () => ensureStateStore().get().pet,
    updatePreferences: patch => updatePetPreferences(patch),
    getMainBounds: () => mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized() ? mainWindow.getBounds() : null,
    onFocusMain: sessionId => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
      if (sessionId) petDomain.markRead(sessionId)
    }
  })
  petWindowController.syncPreferences(ensureStateStore().get().pet)
  petTickTimer = setInterval(() => {
    const preferences = ensureStateStore().get().pet
    if (!preferences.enabled || !preferences.awake) return
    if (powerMonitor.getSystemIdleTime() >= 300) return
    petDomain.tickActive(1)
  }, 60 * 1000)
  petTickTimer.unref?.()
}

function themeAssetMime(file) {
  if (/\.png$/i.test(file)) return 'image/png'
  if (/\.jpe?g$/i.test(file)) return 'image/jpeg'
  return 'image/webp'
}

async function readThemeDataUrl(file) {
  const info = await stat(file)
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('主题图片无效或超过 20 MB。')
  const data = await readFile(file)
  return `data:${themeAssetMime(file)};base64,${data.toString('base64')}`
}

async function appearancePayload() {
  let appearance = ensureStateStore().get().appearance
  if (STORE_BUILD && appearance.themeId === 'maid-atelier') {
    appearance = ensureStateStore().updateAppearance({ themeId: 'porcelain-mist' }).appearance
  }
  const backgroundFile = appearance.customTheme?.backgroundFile
  if (!backgroundFile) return { ...appearance, customBackgroundDataUrl: null }
  const file = path.join(app.getPath('userData'), 'themes', backgroundFile)
  const customBackgroundDataUrl = await readThemeDataUrl(file).catch(() => null)
  return { ...appearance, customBackgroundDataUrl }
}

async function bundledThemeAssets() {
  if (STORE_BUILD) return {}
  const root = path.join(__dirname, '..', 'renderer', 'themes')
  const entries = await Promise.all(BUNDLED_THEME_ASSETS.map(async relative => {
    const url = await readThemeDataUrl(path.join(root, relative))
    return [relative, url]
  }))
  return Object.fromEntries(entries)
}

function mobileThemeAssetUrl(relative) {
  return `/__harness_mobile__/theme-assets/${String(relative).split('/').map(encodeURIComponent).join('/')}`
}

async function mobileAppearancePayload() {
  let state = ensureStateStore().get().appearance
  if (STORE_BUILD && state.themeId === 'maid-atelier') {
    state = ensureStateStore().updateAppearance({ themeId: 'porcelain-mist' }).appearance
  }
  const backgroundFile = state.customTheme?.backgroundFile
  const customBackgroundFile = backgroundFile && path.join(app.getPath('userData'), 'themes', backgroundFile)
  const catalog = THEME_CATALOG
    .filter(theme => !STORE_BUILD || !theme.nonCommercial)
    .map(theme => ({
      ...theme,
      assets: Object.fromEntries(Object.entries(theme.assets || {}).map(([name, relative]) => [name, mobileThemeAssetUrl(relative.replace(/^\.\/themes\//, ''))]))
    }))
  return {
    state: {
      ...state,
      customBackgroundDataUrl: customBackgroundFile && existsSync(customBackgroundFile)
        ? mobileThemeAssetUrl('custom-background')
        : null
    },
    catalog
  }
}

async function updateMobileAppearance(payload = {}) {
  const action = String(payload.action || '')
  const values = payload.values && typeof payload.values === 'object' ? payload.values : {}
  if (action === 'set-theme') {
    const themeId = String(values.id || '')
    if (STORE_BUILD && themeId === 'maid-atelier') throw new Error('Microsoft Store 版本不包含非商业授权主题。')
    ensureStateStore().updateAppearance({ themeId })
  } else if (action === 'save-custom-theme') {
    ensureStateStore().updateAppearance({ themeId: 'custom', customTheme: values })
  } else if (action === 'clear-theme-background') {
    await removeCustomThemeBackground()
  } else {
    throw new Error('Unsupported appearance action.')
  }
  return mobileAppearancePayload()
}

async function readMobileThemeAsset(relative) {
  if (relative === 'custom-background') {
    const backgroundFile = ensureStateStore().get().appearance.customTheme?.backgroundFile
    if (!backgroundFile) return null
    const file = path.join(app.getPath('userData'), 'themes', backgroundFile)
    if (!existsSync(file)) return null
    const info = await stat(file)
    if (!info.isFile() || info.size > 20 * 1024 * 1024) return null
    return { data: await readFile(file), mime: themeAssetMime(file) }
  }
  const normalized = String(relative || '').replaceAll('\\', '/')
  if (STORE_BUILD || !BUNDLED_THEME_ASSETS.includes(normalized)) return null
  const root = path.join(__dirname, '..', 'renderer', 'themes')
  const file = path.join(root, ...normalized.split('/'))
  return { data: await readFile(file), mime: themeAssetMime(file) }
}

async function chooseCustomThemeBackground() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择自定义主题背景图',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  })
  if (result.canceled || !result.filePaths[0]) return appearancePayload()

  const source = path.resolve(result.filePaths[0])
  const extension = path.extname(source).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('仅支持 PNG、JPG 和 WebP 图片。')
  const info = await stat(source)
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('背景图片必须小于 20 MB。')

  const directory = path.join(app.getPath('userData'), 'themes')
  const fileName = `custom-background${extension}`
  const previousFile = ensureStateStore().get().appearance.customTheme?.backgroundFile
  await mkdir(directory, { recursive: true })
  await copyFile(source, path.join(directory, fileName))
  if (previousFile && previousFile !== fileName) {
    await unlink(path.join(directory, previousFile)).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
  ensureStateStore().updateAppearance({ themeId: 'custom', customTheme: { backgroundFile: fileName } })
  return appearancePayload()
}

async function removeCustomThemeBackground() {
  const backgroundFile = ensureStateStore().get().appearance.customTheme?.backgroundFile
  if (backgroundFile) {
    const file = path.join(app.getPath('userData'), 'themes', backgroundFile)
    await unlink(file).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
  ensureStateStore().updateAppearance({ customTheme: { backgroundFile: null } })
}

async function clearCustomThemeBackground() {
  await removeCustomThemeBackground()
  return appearancePayload()
}

async function openHarnessSettingsDocument() {
  const harnessHome = desktopDshHome()
  const settingsFile = path.resolve(harnessHome, 'settings.yaml')
  if (!existsSync(settingsFile)) {
    await mkdir(path.dirname(settingsFile), { recursive: true })
    await writeFile(settingsFile, '', { encoding: 'utf8', mode: 0o600, flag: 'a' })
  }
  const error = await shell.openPath(settingsFile)
  if (error) {
    shell.showItemInFolder(settingsFile)
    return { ok: false, path: settingsFile, fallback: 'folder', error }
  }
  return { ok: true, path: settingsFile }
}

function detectUrl(text) {
  const match = String(text || '').match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/i)
  return match ? match[0].replace('localhost', '127.0.0.1') : null
}

function isLocalRuntimeUrl(value) {
  try {
    const target = new URL(value)
    return target.protocol === 'http:' && LOCAL_RUNTIME_HOSTS.has(target.hostname)
  } catch {
    return false
  }
}

function probeUrl(url, timeoutMs = 900) {
  return new Promise(resolve => {
    if (!isLocalRuntimeUrl(url)) return resolve(false)
    let settled = false
    const done = value => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const request = http.get(url, response => {
      response.resume()
      done(response.statusCode >= 100 && response.statusCode < 600)
    })
    request.setTimeout(timeoutMs, () => {
      request.destroy()
      done(false)
    })
    request.on('error', () => done(false))
  })
}

async function connectExistingRuntime() {
  if (!await probeUrl(DEFAULT_RUNTIME_URL, 500)) return false
  runtimeOwnedByDesktop = false
  setRuntimeState({
    status: 'ready',
    url: DEFAULT_RUNTIME_URL,
    detail: '已连接本机正在运行的 DeepSeek Harness；桌面版不会接管该进程。'
  })
  return true
}

async function startRuntime() {
  if (runtimeState.status === 'ready' && runtimeState.url) return runtimeState
  if (runtime && runtime.exitCode == null) return runtimeState
  // Desktop extensions patch the pinned client runtime bundled with this app.
  // Reusing an arbitrary service on 3080 can silently serve a different client
  // build, leaving shell-owned actions (such as New Session) out of sync.
  // Keep reuse as an explicit developer escape hatch only.
  if (process.env.HARNESS_DESKTOP_REUSE_RUNTIME === '1' && await connectExistingRuntime()) return runtimeState

  if (runtimeInitializationPromise) {
    setRuntimeState({ status: 'starting', url: null, detail: '正在准备本地 Harness 运行环境…' })
    try { await runtimeInitializationPromise }
    catch (error) {
      setRuntimeState({ status: 'error', url: null, detail: `本地运行环境准备失败：${error.message}` })
      return runtimeState
    }
  } else await ensureBundledRuntime()
  const resolved = resolveDshBin({ nodeModulesRoot: bundledNodeModulesRoot() })
  let systemProxyRules = ''
  if (!hasExplicitProxy(process.env)) {
    systemProxyRules = await session.defaultSession.resolveProxy('https://chatgpt.com').catch(() => '')
  }
  const runtimeProxyEnv = buildRuntimeProxyEnv(process.env, systemProxyRules)
  setRuntimeState({ status: 'starting', url: null, detail: `正在启动 DeepSeek Harness Web（${resolved.source}）…` })

  let child
  try {
    const runtimePaths = desktopRuntimePaths()
    child = spawnCommand(resolved.command, [...resolved.argsPrefix, 'web', '--port', '0'], {
      cwd: runtimePaths.workspace,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: desktopRuntimeEnvironment({
        ...process.env,
        ...runtimeProxyEnv,
        ...resolved.env,
        HARNESS_MOBILE_SYNC_STATE_FILE: path.join(app.getPath('userData'), 'mobile-sync.json')
      }, runtimePaths)
    })
  } catch (error) {
    setRuntimeState({ status: 'error', url: null, detail: error.message })
    return runtimeState
  }

  runtime = child
  runtimeOwnedByDesktop = true
  let candidateUrl = null
  let lastErrorText = ''

  const onOutput = (chunk, isError = false) => {
    const output = chunk.toString()
    const detected = detectUrl(output)
    if (detected) candidateUrl = detected
    if (isError && output.trim()) lastErrorText = output.trim().slice(-1200)
  }

  child.stdout?.on('data', chunk => onOutput(chunk))
  child.stderr?.on('data', chunk => onOutput(chunk, true))
  child.on('error', error => setRuntimeState({ status: 'error', url: null, detail: error.message }))
  child.on('exit', (code, signal) => {
    if (runtime === child) runtime = null
    const wasStopping = runtimeState.status === 'stopping'
    runtimeOwnedByDesktop = false
    setRuntimeState({
      status: wasStopping || code === 0 ? 'stopped' : 'error',
      url: null,
      detail: wasStopping
        ? 'DeepSeek Harness 已停止。'
        : `DeepSeek Harness 已退出（code=${code}, signal=${signal || '-'}）${lastErrorText ? `：${lastErrorText}` : ''}`
    })
  })

  const deadline = Date.now() + 22000
  while (Date.now() < deadline && runtime === child && child.exitCode == null) {
    if (candidateUrl && await probeUrl(candidateUrl)) {
      setRuntimeState({ status: 'ready', url: candidateUrl, detail: `DeepSeek Harness Web 已就绪：${candidateUrl}` })
      return runtimeState
    }
    if (process.env.HARNESS_DESKTOP_REUSE_RUNTIME === '1' && candidateUrl !== DEFAULT_RUNTIME_URL && await probeUrl(DEFAULT_RUNTIME_URL)) {
      candidateUrl = DEFAULT_RUNTIME_URL
      setRuntimeState({ status: 'ready', url: candidateUrl, detail: `DeepSeek Harness Web 已就绪：${candidateUrl}` })
      return runtimeState
    }
    await new Promise(resolve => setTimeout(resolve, 350))
  }

  if (runtime === child && child.exitCode == null && runtimeState.status === 'starting') {
    setRuntimeState({
      status: 'error',
      url: null,
      detail: lastErrorText || 'DeepSeek Harness 进程已启动，但 22 秒内没有检测到可访问的本地 Web 服务。'
    })
  }
  return runtimeState
}

function stopRuntime() {
  if (!runtimeOwnedByDesktop || !runtime || runtime.exitCode != null) {
    runtime = null
    runtimeOwnedByDesktop = false
    return
  }
  const child = runtime
  setRuntimeState({ status: 'stopping', detail: '正在停止 DeepSeek Harness…' })
  terminateProcessTree(child)
}

async function checkUpdates() {
  const store = ensureStateStore()
  const resolved = resolveDshBin({ nodeModulesRoot: runtimeNodeModulesRoot || undefined })
  const currentHarnessVersion = resolved.version && !['unresolved', 'external'].includes(resolved.version)
    ? resolved.version
    : desktopPackage.dependencies?.['@deepseek-ai/dsh'] || 'unknown'
  const preferences = store.get().updates
  const feedUrls = await resolveUpdateFeeds({
    configPaths: [
      path.resolve(__dirname, '..', 'release-update-sources.local.json'),
      path.resolve(__dirname, '..', 'release-update-sources.json')
    ],
    fallback: DEFAULT_APP_FEEDS
  })
  const channel = preferences.channel === 'prerelease' || app.getVersion().includes('-') ? 'prerelease' : 'stable'
  const appUpdateCheck = STORE_BUILD
    ? Promise.resolve({
        kind: 'app',
        configured: true,
        currentVersion: app.getVersion(),
        latestVersion: app.getVersion(),
        updateAvailable: false,
        storeManaged: true
      })
    : checkAppUpdate({ currentVersion: app.getVersion(), feedUrls, channel, fetchJsonImpl: fetchJsonWithSystemNetwork }).catch(error => ({
        kind: 'app', configured: Boolean(feedUrls.length), currentVersion: app.getVersion(), updateAvailable: false, error: error.message
      }))
  const [appResult, harnessResult, componentResult] = await Promise.all([
    appUpdateCheck,
    checkHarnessUpstream({ currentVersion: currentHarnessVersion, fetchJsonImpl: fetchJsonWithSystemNetwork }).catch(error => ({
      kind: 'harness', currentVersion: currentHarnessVersion, updateAvailable: false, error: error.message
    })),
    checkComponentUpdates().catch(error => ({ enabled: false, error: error.message }))
  ])
  const state = store.markUpdateChecked()
  const payload = { app: appResult, harness: harnessResult, component: componentResult, preferences: state.updates, distribution: distributionInfo() }
  lastUpdatePayload = payload
  send('updates:result', payload)
  return payload
}

function safeUpdateUrl(value) {
  const target = new URL(value)
  if (target.protocol !== 'https:') throw new Error('更新文件必须使用 HTTPS 地址。')
  return target.toString()
}

function modelRoutingOptions() {
  return {
    dshHome: desktopDshHome(),
    shippedPresetRoot: path.join(bundledNodeModulesRoot(), '@deepseek-ai', 'dsh', 'config', 'agent-presets')
  }
}

function providerMeterRegistry() {
  if (!providerMeterRegistryPromise) providerMeterRegistryPromise = createDefaultProviderMeterRegistry()
  return providerMeterRegistryPromise
}

async function getProviderMeters(force = false) {
  const registry = await providerMeterRegistry()
  return registry.readAll({ dshHome: desktopDshHome(), force, fetchImpl: net.fetch, spawnImpl: spawn })
}

function pluginMarketplaceOptions() {
  return {
    dshHome: desktopDshHome(),
    bundledRoot: path.join(bundledNodeModulesRoot(), 'dsh-plugin-marketplace')
  }
}

function mobileControlPluginOptions() {
  const componentPluginsRoot = String(process.env.HARNESS_COMPONENT_PLUGINS_ROOT || '').trim()
  return {
    dshHome: desktopDshHome(),
    bundledRoot: path.join(componentPluginsRoot && path.isAbsolute(componentPluginsRoot) ? componentPluginsRoot : path.join(__dirname, '..', 'plugins'), 'dsh-mobile-control')
  }
}

async function fetchJsonWithSystemNetwork(url, { timeoutMs = 6000, maxBytes = 1024 * 1024, headers = {} } = {}) {
  const target = new URL(url)
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('更新地址只允许 http/https。')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await net.fetch(target.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Harness-Desktop-Update-Checker', Accept: 'application/json', ...headers }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw new Error('更新响应过大。')
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new Error(`更新响应不是有效 JSON：${error.message}`)
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`更新检查超时（${timeoutMs}ms）`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function componentUpdateBootstrapContext() {
  return global.__HARNESS_COMPONENT_UPDATE__ || null
}

async function ensureComponentUpdateService() {
  if (componentUpdateServicePromise) return componentUpdateServicePromise
  componentUpdateServicePromise = (async () => {
    const bootstrap = componentUpdateBootstrapContext()
    const bundledRoot = bootstrap?.bundledRoot || app.getAppPath()
    const config = await resolveComponentUpdateConfig({ appRoot: bundledRoot, resourcesPath: process.resourcesPath })
    const store = bootstrap?.store || new ComponentUpdateStore(path.join(app.getPath('userData'), 'component-updates'))
    if (!config.enabled || STORE_BUILD) return { enabled: false, config, store, service: null }
    const service = new ComponentUpdateService({
      store,
      manifestUrls: config.manifestUrls,
      trustedKeys: config.trustedKeys,
      bootstrapVersion: app.getVersion(),
      fetchJson: url => fetchJsonWithSystemNetwork(url, { timeoutMs: 8_000, maxBytes: 1024 * 1024 }),
      fetchImpl: net.fetch,
      AdmZipImpl: AdmZip
    })
    return { enabled: true, config, store, service }
  })()
  return componentUpdateServicePromise
}

async function getComponentUpdateState() {
  const context = await ensureComponentUpdateService()
  return {
    enabled: context.enabled,
    source: context.config.source || '',
    state: await context.store.get(),
    pointer: await context.store.pointer(),
    lastCheck: lastComponentUpdateCheck ? {
      source: lastComponentUpdateCheck.source,
      releaseVersion: lastComponentUpdateCheck.manifest.releaseVersion,
      mode: lastComponentUpdateCheck.plan.mode,
      components: lastComponentUpdateCheck.plan.components?.map(component => ({ id: component.id, version: component.version, size: component.size })) || [],
      totalSize: lastComponentUpdateCheck.plan.totalSize || 0
    } : null
  }
}

async function checkComponentUpdates() {
  const context = await ensureComponentUpdateService()
  if (!context.enabled) return getComponentUpdateState()
  lastComponentUpdateCheck = await context.service.check()
  return getComponentUpdateState()
}

async function stageComponentUpdates() {
  const context = await ensureComponentUpdateService()
  if (!context.enabled) throw new Error('组件增量更新尚未启用。')
  if (!lastComponentUpdateCheck) lastComponentUpdateCheck = await context.service.check()
  if (lastComponentUpdateCheck.plan.mode !== 'components') throw new Error('当前没有可暂存的组件更新。')
  await context.service.stage(lastComponentUpdateCheck, progress => send('componentUpdates:progress', progress))
  return getComponentUpdateState()
}

async function launchReadyComponentUpdate() {
  const context = await ensureComponentUpdateService()
  if (!context.enabled) throw new Error('组件增量更新尚未启用。')
  const bootstrap = componentUpdateBootstrapContext()
  const bundledRoot = bootstrap?.bundledRoot || app.getAppPath()
  const userDataOverride = resolveUserDataOverride(process.argv, app.commandLine.getSwitchValue('user-data-dir'))
  const launched = await launchComponentUpdateHelper({
    store: context.store,
    execPath: process.execPath,
    helperScript: path.join(bundledRoot, 'scripts', 'component-update-helper.cjs'),
    componentRoot: context.store.root,
    restartExecutable: process.execPath,
    restartCwd: path.dirname(process.execPath),
    restartArgs: [
      ...(userDataOverride ? [`--user-data-dir=${userDataOverride}`, `--harness-user-data-dir=${userDataOverride}`] : []),
      '--component-health-check'
    ]
  })
  await new Promise(resolve => setTimeout(resolve, 250))
  app.quit()
  return launched
}

async function downloadUpdateFile(asset, destination, expectedSize, onProgress, expectedHash) {
  return downloadWithFallback({
    asset,
    destination,
    expectedSize,
    expectedHash,
    fetchImpl: net.fetch,
    onProgress,
    userAgent: `Harness-Desktop/${app.getVersion()}`
  })
}

async function fetchChecksum(asset, fileName) {
  const result = await checksumWithFallback({
    asset,
    fileName,
    fetchImpl: net.fetch,
    parseChecksum: parseChecksumFile,
    userAgent: `Harness-Desktop/${app.getVersion()}`
  })
  return result.hash
}

async function installAppUpdate() {
  if (STORE_BUILD) throw new Error('此版本由 Microsoft Store 管理桌面应用更新。')
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('当前系统暂不支持应用内桌面更新。')
  if (activeUpdateInstall) return activeUpdateInstall

  activeUpdateInstall = (async () => {
    let payload = lastUpdatePayload
    if (!payload?.app?.updateAvailable) payload = await checkUpdates()
    const update = payload?.app
    if (!update?.updateAvailable) throw new Error('当前桌面版已经是最新版本。')
    if (!update.installer?.url) throw new Error('新版本没有适用于当前系统和架构的桌面安装包。')
    if (!update.checksums?.url) throw new Error('新版本缺少 SHA256SUMS.txt，已拒绝不安全更新。')

    let installerPath = readyUpdate?.version === update.latestVersion && existsSync(readyUpdate.installerPath)
      ? readyUpdate.installerPath
      : null
    if (!installerPath) {
      const updatesDir = path.join(app.getPath('temp'), 'harness-desktop-updates')
      await mkdir(updatesDir, { recursive: true })
      installerPath = path.join(updatesDir, path.basename(update.installer.name))
      send('updates:install-progress', { phase: 'checksum', version: update.latestVersion })
      const expectedHash = await fetchChecksum(update.checksums, update.installer.name)
      send('updates:install-progress', { phase: 'download', version: update.latestVersion, received: 0, total: update.installer.size || 0 })
      const downloaded = await downloadUpdateFile(update.installer, installerPath, update.installer.size, progress => {
        send('updates:install-progress', { phase: 'download', version: update.latestVersion, ...progress })
      }, expectedHash)
      if (downloaded.sha256 !== expectedHash) throw new Error('更新安装包 SHA-256 校验失败，已停止安装。')

      readyUpdate = { version: update.latestVersion, installerPath }
    }

    send('updates:install-progress', { phase: 'ready', version: update.latestVersion })
    return { ok: true, version: update.latestVersion, ready: true }
  })()

  try {
    return await activeUpdateInstall
  } finally {
    activeUpdateInstall = null
  }
}

async function launchReadyAppUpdate() {
  if (STORE_BUILD) throw new Error('此版本由 Microsoft Store 管理桌面应用更新。')
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('当前系统暂不支持应用内桌面更新。')
  if (!readyUpdate?.installerPath || !existsSync(readyUpdate.installerPath)) {
    throw new Error('已下载的更新安装包不存在，请重新下载。')
  }

  send('updates:install-progress', { phase: 'launch', version: readyUpdate.version })
  await openDesktopInstaller({
    installerPath: readyUpdate.installerPath,
    currentInstallDir: app.isPackaged ? path.dirname(process.execPath) : '',
    platform: process.platform,
    openPath: value => shell.openPath(value)
  })
  const version = readyUpdate.version
  await new Promise(resolve => setTimeout(resolve, 250))
  app.quit()
  return { ok: true, version }
}

function selfTestOutputPath() {
  const prefix = '--self-test-output='
  const arg = process.argv.find(value => String(value).startsWith(prefix))
  return arg ? String(arg).slice(prefix.length) : String(process.env.HARNESS_DESKTOP_SELFTEST_OUTPUT || '').trim()
}

async function runSelfTestMode() {
  await ensureBundledRuntime()
  await ensurePluginMarketplace(pluginMarketplaceOptions())
  const report = await runPackagedSelfTest({
    appVersion: app.getVersion(),
    userData: app.getPath('userData'),
    rendererEntry: path.join(__dirname, '..', 'renderer', 'index.html'),
    resolveDshBin: () => resolveDshBin({ nodeModulesRoot: bundledNodeModulesRoot() }),
    ensurePluginMarketplace,
    marketplaceBundledRoot: pluginMarketplaceOptions().bundledRoot,
    runtimeProbeOptions: { runtimeHome: desktopDshHome(), logOutput: true, timeoutMs: 60_000 }
  })
  const output = selfTestOutputPath()
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (output) await writeFile(path.resolve(output), text, { encoding: 'utf8', mode: 0o600 })
  else process.stdout.write(`HARNESS_DESKTOP_SELFTEST=${JSON.stringify(report)}\n`)
  return report
}

function openDesktopLocalTarget(value, reveal = false) {
  return openLocalTarget(value, {
    reveal,
    statImpl: stat,
    openPath: target => shell.openPath(target),
    showItemInFolder: target => shell.showItemInFolder(target)
  })
}

function externalWebUrl(value) {
  try {
    const target = new URL(value)
    return ['http:', 'https:'].includes(target.protocol) ? target.toString() : ''
  } catch {
    return ''
  }
}

async function guestLocalTargetAtPoint(guest, params) {
  if (/^harness-desktop:\/\/open-local(?:[/?#]|$)/i.test(params.linkURL || '')) return params.linkURL
  const x = Number.isFinite(params.x) ? params.x : 0
  const y = Number.isFinite(params.y) ? params.y : 0
  return guest.executeJavaScript(`(() => {
    const element = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)});
    return element?.closest?.('[data-hd-local-target]')?.dataset?.hdLocalTarget || '';
  })()`, true).catch(() => '')
}

async function showGuestContextMenu(guest, params) {
  const template = []
  const localValue = await guestLocalTargetAtPoint(guest, params)
  let local = null
  if (localValue) local = (() => {
    try { return normalizeLocalTarget(localValue) } catch { return null }
  })()
  const external = externalWebUrl(params.linkURL)

  if (local) {
    template.push(
      { label: '打开文件或项目', click: () => openDesktopLocalTarget(localValue).catch(() => {}) },
      { label: '在文件夹中显示', click: () => openDesktopLocalTarget(localValue, true).catch(() => {}) },
      { label: '复制本机路径', click: () => clipboard.writeText(local.path) },
      { type: 'separator' }
    )
  } else if (external) {
    template.push(
      { label: '打开链接', click: () => shell.openExternal(external).catch(() => {}) },
      { label: '复制链接', click: () => clipboard.writeText(external) },
      { type: 'separator' }
    )
  }

  if (params.isEditable) {
    template.push(
      { label: '撤销', role: 'undo', enabled: Boolean(params.editFlags?.canUndo) },
      { label: '重做', role: 'redo', enabled: Boolean(params.editFlags?.canRedo) },
      { type: 'separator' },
      { label: '剪切', role: 'cut', enabled: Boolean(params.editFlags?.canCut) },
      { label: '复制', role: 'copy', enabled: Boolean(params.editFlags?.canCopy) },
      { label: '粘贴', role: 'paste', enabled: Boolean(params.editFlags?.canPaste) },
      { label: '全选', role: 'selectAll', enabled: Boolean(params.editFlags?.canSelectAll) }
    )
  } else {
    template.push(
      { label: '复制', role: 'copy', enabled: Boolean(params.selectionText) },
      { label: '全选', role: 'selectAll' }
    )
  }

  while (template[0]?.type === 'separator') template.shift()
  while (template.at(-1)?.type === 'separator') template.pop()
  if (template.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
    Menu.buildFromTemplate(template).popup({ window: mainWindow })
  }
}

function secureGuest(guest) {
  guest.setWindowOpenHandler(details => {
    const external = externalWebUrl(details.url)
    if (external) shell.openExternal(external).catch(() => {})
    else if (/^harness-desktop:\/\/open-local(?:[/?#]|$)/i.test(details.url || '')) openDesktopLocalTarget(details.url).catch(() => {})
    return { action: 'deny' }
  })
  guest.on('will-navigate', (event, targetUrl) => {
    if (!isLocalRuntimeUrl(targetUrl)) event.preventDefault()
  })
  guest.on('context-menu', (_event, params) => {
    showGuestContextMenu(guest, params).catch(() => {})
  })
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
}

function ensureDesktopTray() {
  if (desktopTray && !desktopTray.isDestroyed()) return desktopTray
  desktopTray = createDesktopTray({
    Tray,
    Menu,
    nativeImage,
    iconPath: STORE_BUILD
      ? path.join(__dirname, '..', 'store', 'Assets', 'AppList.targetsize-256.png')
      : path.join(__dirname, '..', 'build', 'icon.png'),
    showMainWindow,
    hideMainWindow,
    quitApp: () => app.quit()
  })
  return desktopTray
}

function createWindow() {
  ensureStateStore()
  const iconPath = STORE_BUILD
    ? path.join(__dirname, '..', 'store', 'Assets', 'AppList.targetsize-256.png')
    : path.join(__dirname, '..', 'build', 'icon.png')
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 930,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#f7f8fa',
    icon: existsSync(iconPath) ? iconPath : undefined,
    title: 'Harness Desktop',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#00000000', symbolColor: '#202124', height: 36 }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  })

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.preload = path.join(__dirname, 'guest-preload.cjs')
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    if (!isLocalRuntimeUrl(params.src || DEFAULT_RUNTIME_URL)) event.preventDefault()
  })
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => secureGuest(guest))
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).protocol !== 'file:') event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  mainWindow.on('close', event => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  petWindowController?.syncPreferences(ensureStateStore().get().pet)

  if (ensureStateStore().get().updates.checkOnStartup) {
    setTimeout(() => checkUpdates().catch(() => {}), 2500).unref()
  }
}

ipcMain.handle('updates:preferences', () => ensureStateStore().get().updates)
ipcMain.handle('updates:setPreferences', (_event, patch) => ensureStateStore().updatePreferences(patch || {}).updates)
ipcMain.handle('updates:check', () => checkUpdates())
ipcMain.handle('updates:install', () => installAppUpdate())
ipcMain.handle('updates:launchReady', () => launchReadyAppUpdate())
ipcMain.handle('componentUpdates:getState', () => getComponentUpdateState())
ipcMain.handle('componentUpdates:check', () => checkComponentUpdates())
ipcMain.handle('componentUpdates:stage', () => stageComponentUpdates())
ipcMain.handle('componentUpdates:apply', () => launchReadyComponentUpdate())
// Applying a ready component update remains intentionally unexposed until the
// isolated branch is merged and installation testing is explicitly approved.
ipcMain.handle('distribution:get', () => distributionInfo())
ipcMain.handle('appearance:get', () => appearancePayload())
ipcMain.handle('appearance:assets', () => bundledThemeAssets())
ipcMain.handle('appearance:setTheme', async (_event, themeId) => {
  if (STORE_BUILD && themeId === 'maid-atelier') throw new Error('Microsoft Store 版本不包含非商业授权主题。')
  ensureStateStore().updateAppearance({ themeId })
  return appearancePayload()
})
ipcMain.handle('appearance:saveCustom', async (_event, customTheme) => {
  ensureStateStore().updateAppearance({ themeId: 'custom', customTheme })
  return appearancePayload()
})
ipcMain.handle('appearance:chooseBackground', () => chooseCustomThemeBackground())
ipcMain.handle('appearance:clearBackground', () => clearCustomThemeBackground())
ipcMain.handle('pet:getState', () => petPayload())
ipcMain.handle('pet:setPreferences', (_event, patch) => updatePetPreferences(patch || {}))
ipcMain.handle('pet:feed', (_event, kind) => {
  petDomain?.feed(kind)
  return petPayload()
})
ipcMain.handle('pet:interact', (_event, kind) => petDomain?.interact(kind) || petPayload())
ipcMain.handle('pet:focusMain', (_event, sessionId) => {
  petWindowController?.focusMain(sessionId || null)
  return true
})
ipcMain.handle('pet:getEnvironment', () => petWindowController?.environment())
ipcMain.handle('pet:moveTo', (_event, point = {}) => petWindowController?.moveTo(point.x, point.y))
ipcMain.on('pet:setInteractive', (_event, value) => petWindowController?.setInteractive(value))
ipcMain.on('pet:setHitProfile', (_event, profile) => petWindowController?.setHitProfile(profile || {}))
ipcMain.handle('settings:openDocument', () => openHarnessSettingsDocument())
ipcMain.handle('models:routing:get', () => getModelRouting(modelRoutingOptions()))
ipcMain.handle('models:routing:save', (_event, routing) => saveModelRouting(modelRoutingOptions(), routing || {}))
ipcMain.handle('models:meters:get', (_event, force) => getProviderMeters(Boolean(force)))
ipcMain.handle('mobileSync:getState', () => ensureMobileSyncService().state())
ipcMain.handle('mobileSync:setEnabled', (_event, enabled) => ensureMobileSyncService().setEnabled(Boolean(enabled)))
ipcMain.handle('mobileSync:setRemoteEnabled', (_event, enabled) => ensureMobileSyncService().setRemoteEnabled(Boolean(enabled)))
ipcMain.handle('mobileSync:setTransportPreference', (_event, preference) => ensureMobileSyncService().setTransportPreference(String(preference || 'auto')))
ipcMain.handle('mobileSync:beginPairing', () => ensureMobileSyncService().beginPairing())
ipcMain.handle('mobileSync:revokeDevice', (_event, id) => ensureMobileSyncService().revokeDevice(String(id || '')))
ipcMain.handle('mobileControl:send', (_event, deviceId, command) => ensureMobileSyncService().sendControlCommand(String(deviceId || ''), command || {}))
ipcMain.handle('mobileControl:cancel', (_event, commandId) => ensureMobileSyncService().cancelControlCommand(String(commandId || '')))
ipcMain.handle('mobileControl:stop', (_event, deviceId) => ensureMobileSyncService().stopControl(deviceId ? String(deviceId) : null, 'DESKTOP_STOP'))
ipcMain.handle('mobileSync:copy', (_event, value) => {
  clipboard.writeText(String(value || ''))
  return true
})
ipcMain.handle('runtime:start', (_event, options) => startRuntime(options || {}))
ipcMain.handle('runtime:state', () => runtimeState)
ipcMain.on('window:beginDrag', (event, point) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (event.sender !== mainWindow.webContents && !isLocalRuntimeUrl(event.sender.getURL())) return
  beginWindowDrag(mainWindow, point)
})
ipcMain.on('window:moveDrag', (event, point) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (event.sender !== mainWindow.webContents && !isLocalRuntimeUrl(event.sender.getURL())) return
  moveWindowDrag(mainWindow, point)
})
ipcMain.on('window:endDrag', event => {
  if (event.sender !== mainWindow?.webContents && !isLocalRuntimeUrl(event.sender.getURL())) return
  endWindowDrag(mainWindow)
})
ipcMain.handle('shell:openExternal', async (_event, value) => {
  const target = new URL(value)
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('只允许打开 http/https 链接。')
  return shell.openExternal(target.toString())
})
ipcMain.handle('shell:openLocal', (_event, value, options = {}) => openDesktopLocalTarget(value, Boolean(options.reveal)))
ipcMain.handle('attachments:inspect', (event, candidates) => {
  if (!isLocalRuntimeUrl(event.sender.getURL())) throw new Error('只允许本机 Harness 界面添加附件。')
  return inspectAttachmentPaths(candidates)
})

if (HAS_SINGLE_INSTANCE_LOCK && !SELF_TEST_MODE) {
  app.on('second-instance', () => {
    showMainWindow()
  })
}

app.whenReady().then(async () => {
  if (!HAS_SINGLE_INSTANCE_LOCK) {
    app.quit()
    return
  }
  if (SELF_TEST_MODE || COMPONENT_HEALTH_CHECK_MODE) {
    const report = await runSelfTestMode().catch(error => ({ ok: false, error: error.message }))
    if (COMPONENT_HEALTH_CHECK_MODE) {
      const componentUpdate = global.__HARNESS_COMPONENT_UPDATE__
      let canRestart = false
      if (report.ok && componentUpdate?.healthCheckRequired) {
        try {
          await componentUpdate.confirmHealthy()
          canRestart = true
        } catch (error) {
          const recovered = await componentUpdate.rollback(error).catch(rollbackError => ({ error: rollbackError.message }))
          canRestart = !recovered?.error
        }
      } else if (componentUpdate?.healthCheckRequired) {
        const failure = new Error(report.error || '组件版本打包自检失败。')
        const recovered = await componentUpdate.rollback(failure).catch(error => ({ error: error.message }))
        canRestart = !recovered?.error
      } else {
        canRestart = true
      }
      if (canRestart && !SELF_TEST_MODE) {
        const args = process.argv.slice(1).filter(value => value !== '--component-health-check')
        app.relaunch({ args })
      }
    }
    app.exit(report.ok ? 0 : 1)
    return
  }
  runtimeInitializationPromise = (async () => {
    await ensureBundledRuntime()
    await ensureModelRouting(modelRoutingOptions()).catch(error => {
      console.warn(`Unable to restore desktop model routing: ${error.message}`)
    })
    await ensurePluginMarketplace(pluginMarketplaceOptions()).then(result => {
      if (result.warning) console.warn(result.warning)
    }).catch(error => {
      console.warn(`Unable to prepare DSH plugin marketplace: ${error.message}`)
    })
    await ensureMobileControlPlugin(mobileControlPluginOptions()).catch(error => {
      console.warn(`Unable to prepare mobile control plugin: ${error.message}`)
    })
  })()
  if (!STORE_BUILD) ensurePetSystem()
  const syncService = ensureMobileSyncService()
  if (mobileSyncStore.get().enabled) {
    syncService.start({ persist: false }).catch(error => console.warn(`Unable to restore mobile sync: ${error.message}`))
  }
  ensureDesktopTray()
  createWindow()
  runtimeInitializationPromise.catch(error => console.warn(`Unable to prepare bundled Harness runtime: ${error.message}`))
  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  clearInterval(petTickTimer)
  petAdapter?.stop()
  petDomain?.dispose()
  petWindowController?.dispose()
  desktopTray?.destroy()
  desktopTray = null
  mobileSyncService?.stop({ persist: false }).catch(() => {})
  stopRuntime()
})
app.on('window-all-closed', () => {
  // The tray owns the application lifecycle; only its explicit Exit action quits.
})
