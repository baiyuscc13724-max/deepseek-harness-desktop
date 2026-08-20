const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, powerMonitor, screen, session, shell, Tray, WebContentsView } = require('electron')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
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
const { ensureDesktopDirectoryPickerPlugin } = require('./bridge/desktop-directory-picker-plugin-service.cjs')
const { ensureDesktopBrowserToolsPlugin } = require('./bridge/desktop-browser-tools-plugin-service.cjs')
const { ensureDesktopMemoryToolsPlugin } = require('./bridge/desktop-memory-tools-plugin-service.cjs')
const { ensureDesktopComputerUsePlugin } = require('./bridge/desktop-computer-use-plugin-service.cjs')
const { ensureAgentTeamsPlugin } = require('./bridge/agent-teams-plugin-service.cjs')
const { ComputerUseScreenshotStore, DEFAULT_MAX_FILES: COMPUTER_USE_SCREENSHOT_MAX_FILES, DEFAULT_MAX_BYTES: COMPUTER_USE_SCREENSHOT_MAX_BYTES, DEFAULT_MAX_AGE_MS: COMPUTER_USE_SCREENSHOT_MAX_AGE_MS } = require('./bridge/computer-use-screenshot-store.cjs')
const { ComputerUseConfirmationStore } = require('./bridge/computer-use-confirmation-store.cjs')
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
const { StorageManagementService } = require('./bridge/storage-management-service.cjs')
const { MemoryService } = require('./bridge/memory-service.cjs')
const { redact: redactSensitiveText } = require('./bridge/memory-censor.cjs')
const { BrowserSecurityPolicy } = require('./bridge/browser-security-policy.cjs')
const { BrowserOperationCoordinator } = require('./bridge/browser-operation-coordinator.cjs')
const { BrowserControlServer } = require('./bridge/browser-control-server.cjs')
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
const MANUAL_VALIDATION_MODE = app.commandLine.hasSwitch('manual-validation') && Boolean(app.commandLine.getSwitchValue('user-data-dir'))
const HAS_SINGLE_INSTANCE_LOCK = SELF_TEST_MODE || COMPONENT_HEALTH_CHECK_MODE || MANUAL_VALIDATION_MODE || app.requestSingleInstanceLock()
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
let storageManagementService = null
let memoryService = null
let browserView = null
let browserSecurityPolicy = null
let browserControlServer = null
const browserOperations = new BrowserOperationCoordinator()
let browserSidebarVisible = false
let browserContentVisible = true
let workspacePickerPromise = null
let computerUseEnabled = false
let computerUseSessionGeneration = 0
let computerUseScreenshotStore = null
let computerUseQuitCleanupStarted = false
let computerUseQuitCleanupComplete = false
const computerUseConfirmations = new ComputerUseConfirmationStore()
let browserState = { visible: false, loading: false, url: '', title: '', origin: '', canGoBack: false, canGoForward: false, hasSiteData: false, error: '' }

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

function ensureStorageManagementService() {
  if (!storageManagementService) {
    storageManagementService = new StorageManagementService({
      root: desktopRuntimePaths().root,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch
    })
  }
  return storageManagementService
}

function memoryServiceOptions(overrides = {}) {
  const root = desktopRuntimePaths().root
  const preferences = ensureStateStore().get().memory
  return {
    dbPath: path.join(root, 'memory', 'memory.sqlite'),
    exportsDir: path.join(root, 'memory-exports'),
    enabled: preferences.enabled,
    sensitivityMode: preferences.sensitivityMode,
    ...overrides
  }
}

function ensureMemoryService() {
  if (!memoryService) memoryService = new MemoryService(memoryServiceOptions())
  return memoryService
}

function memoryStatusPayload() {
  const status = ensureMemoryService().status()
  return {
    ...status,
    dbPath: status.dbPath ? path.dirname(status.dbPath) : null,
    preferences: ensureStateStore().get().memory
  }
}

async function setMemoryEnabled(enabled) {
  const service = ensureMemoryService()
  if (enabled) {
    await service.enable(memoryServiceOptions({ enabled: true }))
    ensureStateStore().updateMemory({ enabled: true, autoRecall: true, autoCapture: true })
  } else {
    service.disable()
    ensureStateStore().updateMemory({ enabled: false, autoRecall: false, autoCapture: false })
  }
  return memoryStatusPayload()
}

async function updateMemoryPreferences(patch = {}) {
  const current = ensureStateStore().get().memory
  const next = {
    sensitivityMode: patch.sensitivityMode === 'redact' ? 'redact' : current.sensitivityMode,
    autoRecall: Object.prototype.hasOwnProperty.call(patch, 'autoRecall') ? Boolean(patch.autoRecall) : current.autoRecall,
    autoCapture: Object.prototype.hasOwnProperty.call(patch, 'autoCapture') ? Boolean(patch.autoCapture) : current.autoCapture
  }
  if (!current.enabled) {
    next.autoRecall = false
    next.autoCapture = false
  }
  ensureStateStore().updateMemory(next)
  if (current.enabled) await ensureMemoryService().enable(memoryServiceOptions({ enabled: true, sensitivityMode: next.sensitivityMode }))
  return memoryStatusPayload()
}

const BROWSER_PANEL_WIDTH = 460
const BROWSER_VIEW_TOP = 118
const BROWSER_VIEW_FOOTER = 34

function browserPolicyOptions() {
  const root = path.join(desktopRuntimePaths().root, 'browser')
  return {
    authzFile: path.join(root, 'site-authorizations.json'),
    authzRootDir: root
  }
}

function liveBrowserContents() {
  const contents = browserView?.webContents
  if (!contents || typeof contents.isDestroyed !== 'function' || contents.isDestroyed()) return null
  return contents
}

function closeBrowserViewContents() {
  const contents = browserView?.webContents
  browserView = null
  if (!contents || typeof contents.isDestroyed !== 'function' || contents.isDestroyed()) return
  contents.close()
}

function browserNavigationHistory() {
  return liveBrowserContents()?.navigationHistory || null
}

function layoutBrowserView() {
  if (!liveBrowserContents() || !mainWindow || mainWindow.isDestroyed()) return
  const [width, height] = mainWindow.getContentSize()
  const panelWidth = Math.min(BROWSER_PANEL_WIDTH, width)
  browserView.setBounds({
    x: Math.max(0, width - panelWidth),
    y: BROWSER_VIEW_TOP,
    width: panelWidth,
    height: Math.max(1, height - BROWSER_VIEW_TOP - BROWSER_VIEW_FOOTER)
  })
  browserView.setVisible(browserSidebarVisible && browserContentVisible)
}

async function browserStatePayload(patch = {}) {
  browserState = { ...browserState, ...patch }
  const contents = liveBrowserContents()
  const history = browserNavigationHistory()
  if (contents) {
    browserState.url = contents.getURL() || browserState.url
    browserState.title = contents.getTitle() || browserState.title
    browserState.canGoBack = Boolean(history?.canGoBack())
    browserState.canGoForward = Boolean(history?.canGoForward())
  }
  browserState.visible = browserSidebarVisible
  browserState.hasSiteData = false
  if (browserState.origin && contents) {
    const cookies = await contents.session.cookies.get({ url: browserState.origin }).catch(() => [])
    browserState.hasSiteData = cookies.length > 0
  }
  const audit = browserSecurityPolicy?.auditSnapshot() || { count: 0, total: 0, dropped: 0 }
  return {
    ...browserState,
    profile: {
      name: 'Harness Browser',
      partition: browserSecurityPolicy?.partitionName || BrowserSecurityPolicy.partitionName(),
      isolatedFromHarness: true
    },
    authorizations: browserSecurityPolicy?.authorizations() || { count: 0, entries: [] },
    audit: { count: audit.count, total: audit.total, dropped: audit.dropped },
    modelControlStopped: browserSecurityPolicy?.isStopped === true,
    profileResetting: browserOperations.snapshot().resetting,
    pendingConfirmations: browserSecurityPolicy?.pendingConfirmations() || []
  }
}

async function publishBrowserState(patch = {}) {
  const payload = await browserStatePayload(patch)
  send('browser:state', payload)
  return payload
}

function updateBrowserActiveTab(url) {
  if (browserOperations.snapshot().resetting) return
  if (!browserSecurityPolicy || !url) return
  try {
    const nav = browserSecurityPolicy.userNavigate(url)
    browserSecurityPolicy.setActiveTab({ id: 'side-browser-main', origin: nav.origin, visible: browserSidebarVisible && browserContentVisible })
    browserState.origin = nav.origin
    browserState.error = ''
  } catch {
    browserState.origin = ''
  }
}

function ensureBrowserSidebar() {
  if (liveBrowserContents()) return browserView
  browserView = null
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口尚未准备好。')
  browserSecurityPolicy = new BrowserSecurityPolicy(browserPolicyOptions())
  const browserSession = session.fromPartition(browserSecurityPolicy.partitionName, { cache: true })
  browserSession.setPermissionCheckHandler(() => false)
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  browserView = new WebContentsView({
    webPreferences: {
      partition: browserSecurityPolicy.partitionName,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
      spellcheck: true
    }
  })
  browserView.setBackgroundColor('#ffffff')
  mainWindow.contentView.addChildView(browserView)
  const contents = browserView.webContents
  const validateNavigation = (event, url) => {
    if (browserOperations.snapshot().resetting) {
      if (url === 'about:blank') return
      return event.preventDefault()
    }
    try { browserSecurityPolicy.userNavigate(url) }
    catch { event.preventDefault() }
  }
  contents.on('will-navigate', validateNavigation)
  contents.on('will-redirect', validateNavigation)
  contents.setWindowOpenHandler(details => {
    if (browserOperations.snapshot().resetting) return { action: 'deny' }
    try {
      const nav = browserSecurityPolicy.userNavigate(details.url)
      contents.loadURL(nav.normalized).catch(() => {})
    } catch {}
    return { action: 'deny' }
  })
  contents.on('did-start-loading', () => publishBrowserState({ loading: true }).catch(() => {}))
  contents.on('did-stop-loading', () => publishBrowserState({ loading: false }).catch(() => {}))
  const navigated = (_event, url) => {
    updateBrowserActiveTab(url)
    publishBrowserState({ url }).catch(() => {})
  }
  contents.on('did-navigate', navigated)
  contents.on('did-navigate-in-page', navigated)
  contents.on('page-title-updated', (_event, title) => publishBrowserState({ title }).catch(() => {}))
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) publishBrowserState({ loading: false, url, error: description || `加载失败 (${code})` }).catch(() => {})
  })
  layoutBrowserView()
  return browserView
}

function normalizeBrowserAddress(value, base = '') {
  const text = String(value || '').trim()
  if (!text) throw new Error('请输入网址或搜索内容。')
  let candidate = text
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    candidate = (/\s/u.test(candidate) || !candidate.includes('.'))
      ? `https://www.baidu.com/s?wd=${encodeURIComponent(candidate)}`
      : `https://${candidate}`
  }
  return browserSecurityPolicy.userNavigate(candidate, base ? { base } : {}).normalized
}

async function setBrowserSidebarVisible(visible) {
  const ticket = browserOperations.ticket()
  ensureBrowserSidebar()
  const contents = liveBrowserContents()
  if (!contents) throw new Error('浏览器视图尚未准备好。')
  browserSidebarVisible = Boolean(visible)
  if (browserSidebarVisible && !contents.getURL()) {
    await contents.loadURL(browserSecurityPolicy.userNavigate('https://www.baidu.com/').normalized)
  }
  browserOperations.assert(ticket)
  updateBrowserActiveTab(contents.getURL())
  layoutBrowserView()
  return publishBrowserState()
}

async function setBrowserContentVisible(visible) {
  const ticket = browserOperations.ticket()
  browserContentVisible = Boolean(visible)
  const contents = liveBrowserContents()
  if (contents) {
    updateBrowserActiveTab(contents.getURL())
    layoutBrowserView()
  }
  browserOperations.assert(ticket)
  return publishBrowserState()
}

async function navigateBrowser(value) {
  const ticket = browserOperations.ticket()
  const view = ensureBrowserSidebar()
  const target = normalizeBrowserAddress(value, view.webContents.getURL())
  browserOperations.assert(ticket)
  await view.webContents.loadURL(target)
  browserOperations.assert(ticket)
  return publishBrowserState({ error: '' })
}

async function clearBrowserSiteData(confirmed) {
  if (confirmed !== true) throw new Error('清除当前站点登录数据需要用户明确确认。')
  const view = ensureBrowserSidebar()
  const origin = browserState.origin
  if (!origin) throw new Error('当前页面没有可清理的站点数据。')
  const resetGeneration = browserOperations.beginReset()
  const contents = view.webContents
  const browserSession = contents.session
  try {
    browserSecurityPolicy.clearPendingControl()
    contents.stop()
    if (typeof browserSession.closeAllConnections === 'function') await browserSession.closeAllConnections()
    await contents.loadURL('about:blank')
    await publishBrowserState({ loading: false })
    await browserSession.clearStorageData({ origin })
    if (typeof browserSession.clearCodeCaches === 'function') await browserSession.clearCodeCaches({ urlsForRequestingOrigins: [origin] })
    if (typeof browserSession.closeAllConnections === 'function') await browserSession.closeAllConnections()
    browserSecurityPolicy.revoke(origin)
    browserState = { ...browserState, loading: false, url: 'about:blank', title: '', origin: '', hasSiteData: false, error: '' }
  } finally {
    browserOperations.finishReset(resetGeneration)
    publishBrowserState().catch(() => {})
  }
  return publishBrowserState()
}

async function resumeBrowserModelControl() {
  browserOperations.ticket()
  if (!browserSecurityPolicy || browserSecurityPolicy.isStopped) browserSecurityPolicy = new BrowserSecurityPolicy(browserPolicyOptions())
  const contents = liveBrowserContents()
  if (contents) updateBrowserActiveTab(contents.getURL())
  return publishBrowserState()
}

async function grantCurrentBrowserOrigin(actions) {
  const ticket = browserOperations.ticket()
  if (!browserState.origin) throw new Error('请先打开需要授权的站点。')
  await resumeBrowserModelControl()
  browserOperations.assert(ticket)
  browserSecurityPolicy.grant(browserState.origin, { actions: Array.isArray(actions) ? actions : [], ttlMs: 2 * 60 * 60 * 1000 })
  return publishBrowserState()
}

async function clearAllBrowserData(confirmed) {
  if (confirmed !== true) throw new Error('重置独立浏览器 Profile 需要用户明确确认。')
  const view = ensureBrowserSidebar()
  const resetGeneration = browserOperations.beginReset()
  const contents = view.webContents
  const browserSession = contents.session
  try {
    browserSecurityPolicy.clearPendingControl()
    contents.stop()
    if (typeof browserSession.closeAllConnections === 'function') await browserSession.closeAllConnections()
    await contents.loadURL('about:blank')
    await publishBrowserState({ loading: false })
    await browserSession.clearStorageData()
    await browserSession.clearCache()
    if (typeof browserSession.clearAuthCache === 'function') await browserSession.clearAuthCache()
    if (typeof browserSession.clearCodeCaches === 'function') await browserSession.clearCodeCaches({})
    if (typeof browserSession.clearHostResolverCache === 'function') await browserSession.clearHostResolverCache()
    if (typeof browserSession.closeAllConnections === 'function') await browserSession.closeAllConnections()
    contents.navigationHistory?.clear()
    browserSecurityPolicy.revokeAll()
    browserSecurityPolicy.clearAudit()
    browserState = { ...browserState, loading: false, url: 'about:blank', title: '', origin: '', canGoBack: false, canGoForward: false, hasSiteData: false, error: '' }
  } finally {
    browserOperations.finishReset(resetGeneration)
    publishBrowserState().catch(() => {})
  }
  return publishBrowserState()
}

function requireVisibleBrowserForModel() {
  const ticket = browserOperations.ticket()
  const view = ensureBrowserSidebar()
  if (!browserSidebarVisible || !browserContentVisible) throw Object.assign(new Error('模型只能操作当前可见的右栏浏览器页面。'), { code: 'tab-not-visible' })
  if (!browserSecurityPolicy || browserSecurityPolicy.isStopped) throw Object.assign(new Error('浏览器模型控制已停止；需要用户在右栏重新启用。'), { code: 'stopped' })
  const url = view.webContents.getURL()
  updateBrowserActiveTab(url)
  if (!browserState.origin) throw new Error('当前浏览器页面没有可操作的 HTTP(S) 来源。')
  return { view, url, origin: browserState.origin, tabId: 'side-browser-main', ticket }
}

function safeBrowserText(value, maximum = 12000) {
  return redactSensitiveText(String(value || '').slice(0, maximum)).text
}

async function observeBrowserForModel() {
  const { view, origin, tabId, ticket } = requireVisibleBrowserForModel()
  browserSecurityPolicy.modelAction({ action: 'read', tabId, declaredOrigin: origin, field: { baseUrl: origin, tag: 'document' }, payload: {} })
  const raw = await view.webContents.executeJavaScript(`(() => {
    const sensitive = /(?:pass(?:word|wd)?|pwd|secret|token|cookie|authorization|otp|captcha|verification|验证码|银行卡|card.?number|cvv|cvc)/i;
    const visible = element => { const r=element.getBoundingClientRect(); const s=getComputedStyle(element); return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
    const nodes=[...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')].filter(visible);
    let sequence=0;
    const interactive=[];
    for (const element of nodes) {
      const metadata=[element.type,element.name,element.id,element.autocomplete,element.getAttribute('aria-label'),element.placeholder].filter(Boolean).join(' ');
      if (sensitive.test(metadata)) continue;
      const ref='b'+(++sequence);
      element.setAttribute('data-hd-model-ref',ref);
      interactive.push({ ref, tag:element.tagName.toLowerCase(), type:String(element.type||''), role:String(element.getAttribute('role')||''), label:String(element.getAttribute('aria-label')||element.innerText||element.textContent||element.placeholder||'').trim().slice(0,240), disabled:Boolean(element.disabled||element.getAttribute('aria-disabled')==='true') });
      if (interactive.length>=120) break;
    }
    return { title:document.title, text:String(document.body?.innerText||'').slice(0,12000), interactive };
  })()`, true)
  browserOperations.assert(ticket)
  const result = {
    origin,
    title: safeBrowserText(raw.title, 500),
    text: safeBrowserText(raw.text),
    interactive: (raw.interactive || []).map(item => ({ ...item, label: safeBrowserText(item.label, 240) }))
  }
  return result
}

async function browserElementMetadata(view, ref) {
  if (!/^b\d{1,4}$/.test(String(ref || ''))) throw new Error('浏览器元素引用无效，请重新 observe。')
  return view.webContents.executeJavaScript(`(() => {
    const element=document.querySelector('[data-hd-model-ref=${JSON.stringify(String(ref))}]');
    if(!element) return null;
    const label=element.labels?.[0]?.innerText||element.getAttribute('aria-label')||element.placeholder||'';
    const text=String(element.innerText||element.textContent||'').trim().slice(0,300);
    return { tag:element.tagName.toLowerCase(),type:String(element.type||''),name:String(element.name||''),id:String(element.id||''),role:String(element.getAttribute('role')||''),autocomplete:String(element.autocomplete||''),ariaLabel:String(element.getAttribute('aria-label')||''),label:String(label),baseUrl:location.origin,text,submit:Boolean(element.type==='submit'||element.closest('button[type="submit"],input[type="submit"]')),disabled:Boolean(element.disabled||element.getAttribute('aria-disabled')==='true') };
  })()`, true)
}

async function modelBrowserAction(input = {}) {
  const action = String(input.action || '')
  const parameters = input.payload && typeof input.payload === 'object' ? input.payload : input
  if (action === 'status') {
    const authorizations = browserSecurityPolicy?.authorizations() || { entries: [] }
    const current = authorizations.entries.find(entry => entry.origin === browserState.origin)
    return { visible: browserSidebarVisible && browserContentVisible, origin: browserState.origin || null, title: safeBrowserText(browserState.title, 500), loading: browserState.loading, stopped: browserSecurityPolicy?.isStopped === true, actions: current?.actions || [] }
  }
  if (action === 'stop') {
    browserSecurityPolicy?.stop()
    return { stopped: true, message: '模型浏览器控制已停止；网页仍由用户直接控制。' }
  }
  if (action === 'observe') return observeBrowserForModel()
  const { view, origin, tabId, ticket } = requireVisibleBrowserForModel()
  if (action === 'navigate') {
    const nav = browserSecurityPolicy.modelNavigate(String(parameters.url || ''), { tabId, base: view.webContents.getURL() })
    browserOperations.assert(ticket)
    await view.webContents.loadURL(nav.normalized)
    browserOperations.assert(ticket)
    return { navigated: true, origin: nav.origin, url: nav.normalized }
  }
  if (!['click', 'type'].includes(action)) throw new Error('不支持的浏览器模型操作。')
  const field = await browserElementMetadata(view, parameters.ref)
  browserOperations.assert(ticket)
  if (!field) throw new Error('元素已失效，请重新 observe。')
  if (field.disabled) throw new Error('目标元素当前不可用。')
  if (action === 'type') {
    const decision = browserSecurityPolicy.modelAction({ action: 'type', tabId, declaredOrigin: origin, field, payload: { text: String(parameters.text || '') }, confirmationId: parameters.confirmation_id })
    if (!decision.allowed) {
      publishBrowserState().catch(() => {})
      return decision
    }
    browserOperations.assert(ticket)
    await view.webContents.executeJavaScript(`(() => { const element=document.querySelector('[data-hd-model-ref=${JSON.stringify(String(parameters.ref))}]'); if(!element) return false; const setter=Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')?.set; if(setter) setter.call(element,${JSON.stringify(String(parameters.text || ''))}); else if(element.isContentEditable) element.textContent=${JSON.stringify(String(parameters.text || ''))}; else return false; element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'})); element.dispatchEvent(new Event('change',{bubbles:true})); element.focus(); return true; })()`, true)
    browserOperations.assert(ticket)
    return { typed: true, ref: String(parameters.ref), origin }
  }
  const targetDescription = `${field.text} ${field.label} ${field.ariaLabel}`
  if (/(?:purchase|pay|buy|checkout|bank|card|付款|支付|购买|结账|银行|银行卡)/i.test(targetDescription)) {
    throw Object.assign(new Error('模型永久禁止执行支付、购买或银行相关操作，请由用户亲自操作。'), { code: 'financial-action-blocked' })
  }
  const dangerous = field.submit || /(?:submit|publish|delete|remove|发送|提交|发布|删除|移除)/i.test(targetDescription)
  const effectiveAction = dangerous ? 'submit' : 'click'
  const decision = browserSecurityPolicy.modelAction({ action: effectiveAction, tabId, declaredOrigin: origin, field, payload: {}, confirmationId: parameters.confirmation_id })
  if (!decision.allowed) return decision
  browserOperations.assert(ticket)
  await view.webContents.executeJavaScript(`document.querySelector('[data-hd-model-ref=${JSON.stringify(String(parameters.ref))}]')?.click()`, true)
  browserOperations.assert(ticket)
  return { clicked: true, ref: String(parameters.ref), origin, confirmed: dangerous }
}

function browserControlStateFile() {
  return path.join(app.getPath('userData'), 'browser-control.json')
}

async function modelMemoryAction(input = {}) {
  const action = String(input.action || '')
  const parameters = input.payload && typeof input.payload === 'object' ? input.payload : input
  const preferences = ensureStateStore().get().memory
  if (action === 'status') {
    return {
      enabled: preferences.enabled,
      recallAllowed: preferences.enabled && preferences.autoRecall,
      captureAllowed: preferences.enabled && preferences.autoCapture,
      count: preferences.enabled ? ensureMemoryService().status().counts.entries : 0
    }
  }
  if (!preferences.enabled) throw Object.assign(new Error('用户尚未开启本地记忆。'), { code: 'memory-disabled' })
  if (action === 'search') {
    if (!preferences.autoRecall) throw Object.assign(new Error('用户尚未允许模型按需召回本地记忆。'), { code: 'memory-recall-disabled' })
    const query = String(parameters.query || '').trim()
    const maxResults = Math.max(1, Math.min(8, Math.floor(Number(parameters.max_results) || 5)))
    const recalled = await ensureMemoryService().recall(query, { maxResults })
    return {
      query: recalled.query,
      total: recalled.total,
      hits: recalled.hits.map(hit => ({
        id: hit.id,
        title: safeBrowserText(hit.title, 300),
        content: safeBrowserText(hit.content, 2000),
        tags: hit.tags,
        matched: hit.matched,
        snippet: safeBrowserText(hit.snippet, 500)
      }))
    }
  }
  if (action === 'remember') {
    if (!preferences.autoCapture) throw Object.assign(new Error('用户尚未允许自动保存稳定偏好。'), { code: 'memory-capture-disabled' })
    const content = String(parameters.content || '').trim().slice(0, 2000)
    if (!content) throw new Error('本地记忆内容不能为空。')
    const title = String(parameters.title || content.slice(0, 80)).trim().slice(0, 160)
    const kind = ['preference', 'instruction', 'project', 'fact'].includes(parameters.kind) ? parameters.kind : 'preference'
    const tags = Array.isArray(parameters.tags)
      ? parameters.tags.map(value => String(value || '').trim().slice(0, 40)).filter(Boolean).slice(0, 8)
      : []
    const service = ensureMemoryService()
    const probe = await service.search(content.slice(0, 200), { maxResults: 20 })
    const duplicate = probe.hits.find(hit => hit.content === content && hit.title === title)
    if (duplicate) return { stored: false, duplicate: true, id: duplicate.id }
    const entry = await service.add({
      kind,
      title,
      content,
      tags,
      sourceSessionId: String(parameters.source_session_id || '').slice(0, 128),
      sensitivity: 0,
      recallPolicy: 'auto'
    })
    return { stored: true, duplicate: false, id: entry.id }
  }
  throw new Error('不支持的本地记忆操作。')
}

function ensureComputerUseScreenshotStore() {
  if (!computerUseScreenshotStore) {
    computerUseScreenshotStore = new ComputerUseScreenshotStore({
      directory: path.join(desktopRuntimePaths().root, 'computer-use', 'screenshots')
    })
  }
  return computerUseScreenshotStore
}

async function clearComputerUseScreenshots() {
  return ensureComputerUseScreenshotStore().clear()
}

async function setComputerUseEnabled(enabled) {
  const next = enabled === true
  if (next === computerUseEnabled) return computerUseState()
  computerUseSessionGeneration += 1
  if (next) await clearComputerUseScreenshots()
  computerUseEnabled = next
  if (!computerUseEnabled) {
    computerUseConfirmations.clear()
    await clearComputerUseScreenshots()
  }
  return computerUseState()
}

function computerUseState() {
  return { enabled: computerUseEnabled, screenshotPolicy: { sessionOnly: true, maxFiles: COMPUTER_USE_SCREENSHOT_MAX_FILES, maxBytes: COMPUTER_USE_SCREENSHOT_MAX_BYTES, maxAgeMs: COMPUTER_USE_SCREENSHOT_MAX_AGE_MS }, pending: computerUseConfirmations.snapshot() }
}

function requireComputerConfirmation(action, parameters) {
  return computerUseConfirmations.authorize(action, parameters)
}

async function modelComputerUseAction(input = {}) {
  const action = String(input.action || '')
  const parameters = input.payload && typeof input.payload === 'object' ? input.payload : input
  if (action === 'status') return computerUseState()
  if (action === 'stop') return setComputerUseEnabled(false)
  if (!computerUseEnabled) throw Object.assign(new Error('用户尚未开启本次 Computer Use。'), { code: 'computer-use-disabled' })
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) throw new Error('Harness Desktop 主窗口当前不可见。')
  if (action === 'screenshot') {
    const sessionGeneration = computerUseSessionGeneration
    const image = await mainWindow.capturePage()
    if (!computerUseEnabled || sessionGeneration !== computerUseSessionGeneration) throw Object.assign(new Error('Computer Use 会话已停止。'), { code: 'computer-use-disabled' })
    const size = image.getSize()
    const scaled = size.width > 1280 ? image.resize({ width: 1280, quality: 'good' }) : image
    const file = await ensureComputerUseScreenshotStore().save(scaled.toPNG())
    if (!computerUseEnabled || sessionGeneration !== computerUseSessionGeneration) {
      await clearComputerUseScreenshots()
      throw Object.assign(new Error('Computer Use 会话已停止。'), { code: 'computer-use-disabled' })
    }
    return { file, width: scaled.getSize().width, height: scaled.getSize().height, scope: 'Harness Desktop window only' }
  }
  if (!['click', 'type', 'scroll'].includes(action)) throw new Error('不支持的 Computer Use 操作。')
  if (action === 'type' && redactSensitiveText(String(parameters.text || '')).types.length) throw Object.assign(new Error('Computer Use 永久禁止输入密码、令牌、验证码、银行卡或其他秘密。'), { code: 'sensitive-input-blocked' })
  const confirmation = requireComputerConfirmation(action, parameters)
  if (confirmation) return confirmation
  const [width, height] = mainWindow.getContentSize()
  const x = Math.round(Number(parameters.x)); const y = Math.round(Number(parameters.y))
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 36 || x >= width || y >= height) throw new Error('操作坐标超出 Harness Desktop 可控区域。')
  if (action === 'click') {
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  } else if (action === 'scroll') {
    mainWindow.webContents.sendInputEvent({ type: 'mouseWheel', x, y, deltaY: Math.max(-800, Math.min(800, Number(parameters.delta_y) || 0)), deltaX: 0 })
  } else {
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    for (const character of String(parameters.text || '').slice(0, 2000)) mainWindow.webContents.sendInputEvent({ type: 'char', keyCode: character })
  }
  return { completed: true, action, x, y }
}

async function desktopModelToolAction(input = {}) {
  if (input.scope === 'memory') return modelMemoryAction(input)
  if (input.scope === 'computer') return modelComputerUseAction(input)
  return modelBrowserAction(input)
}

async function ensureBrowserControlServer() {
  if (!browserControlServer) browserControlServer = new BrowserControlServer({ stateFile: browserControlStateFile(), handler: desktopModelToolAction })
  await browserControlServer.start()
  return browserControlServer
}

function assertDesktopShellSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('只允许 Harness Desktop 桌面壳调用本地桌面能力。')
  }
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

const MAX_THEME_BACKGROUND_BYTES = 50 * 1024 * 1024

function themeAssetMime(file) {
  if (/\.png$/i.test(file)) return 'image/png'
  if (/\.apng$/i.test(file)) return 'image/apng'
  if (/\.gif$/i.test(file)) return 'image/gif'
  if (/\.jpe?g$/i.test(file)) return 'image/jpeg'
  return 'image/webp'
}

async function readThemeDataUrl(file) {
  const info = await stat(file)
  if (!info.isFile() || info.size > MAX_THEME_BACKGROUND_BYTES) throw new Error('主题图片无效或超过 50 MB。')
  const data = await readFile(file)
  return `data:${themeAssetMime(file)};base64,${data.toString('base64')}`
}

function syncTitleBarOverlay(appearance = ensureStateStore().get().appearance) {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return
  const theme = THEME_CATALOG.find(entry => entry.id === appearance.themeId)
  const requestedMode = appearance.themeId === 'custom' ? appearance.customTheme?.mode : theme?.mode
  const dark = requestedMode === 'dark' || (requestedMode === 'adaptive' && nativeTheme.shouldUseDarkColors)
  mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f4f7ff' : '#202124', height: 36 })
}

async function appearancePayload() {
  let appearance = ensureStateStore().get().appearance
  if (STORE_BUILD && appearance.themeId === 'maid-atelier') {
    appearance = ensureStateStore().updateAppearance({ themeId: 'porcelain-mist' }).appearance
  }
  syncTitleBarOverlay(appearance)
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
  syncTitleBarOverlay()
  return mobileAppearancePayload()
}

async function readMobileThemeAsset(relative) {
  if (relative === 'custom-background') {
    const backgroundFile = ensureStateStore().get().appearance.customTheme?.backgroundFile
    if (!backgroundFile) return null
    const file = path.join(app.getPath('userData'), 'themes', backgroundFile)
    if (!existsSync(file)) return null
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_THEME_BACKGROUND_BYTES) return null
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
    title: '选择自定义主题壁纸或动图',
    properties: ['openFile'],
    filters: [{ name: '静态或动态图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'apng'] }]
  })
  if (result.canceled || !result.filePaths[0]) return appearancePayload()

  const source = path.resolve(result.filePaths[0])
  const extension = path.extname(source).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.apng'].includes(extension)) throw new Error('仅支持 PNG、JPG、WebP、GIF 和 APNG 图片。')
  const info = await stat(source)
  if (!info.isFile() || info.size > MAX_THEME_BACKGROUND_BYTES) throw new Error('背景图片或动图必须小于 50 MB。')

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
    await ensureBrowserControlServer()
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
        HARNESS_MOBILE_SYNC_STATE_FILE: path.join(app.getPath('userData'), 'mobile-sync.json'),
        HARNESS_DESKTOP_BROWSER_STATE_FILE: browserControlStateFile(),
        HARNESS_DESKTOP_CAPABILITIES_STATE_FILE: browserControlStateFile()
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

function desktopDirectoryPickerPluginOptions() {
  return {
    dshHome: desktopDshHome(),
    bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-desktop-directory-picker')
  }
}

function desktopBrowserToolsPluginOptions() {
  return {
    dshHome: desktopDshHome(),
    bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-desktop-browser-tools')
  }
}

function desktopMemoryToolsPluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-desktop-memory-tools') }
}
function desktopComputerUsePluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-desktop-computer-use') }
}
function agentTeamsPluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-agent-teams') }
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
  const output = selfTestOutputPath()
  if (output) await writeFile(path.resolve(output), `${JSON.stringify({ phase: 'preparing-runtime', startedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await ensureBundledRuntime()
  await ensurePluginMarketplace(pluginMarketplaceOptions())
  await ensureAgentTeamsPlugin(agentTeamsPluginOptions())
  if (output) await writeFile(path.resolve(output), `${JSON.stringify({ phase: 'probing-runtime', startedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  const report = await runPackagedSelfTest({
    appVersion: app.getVersion(),
    userData: app.getPath('userData'),
    rendererEntry: path.join(__dirname, '..', 'renderer', 'index.html'),
    resolveDshBin: () => resolveDshBin({ nodeModulesRoot: bundledNodeModulesRoot() }),
    ensurePluginMarketplace,
    marketplaceBundledRoot: pluginMarketplaceOptions().bundledRoot,
    runtimeProbeOptions: { runtimeHome: desktopDshHome(), logOutput: true, timeoutMs: 180_000 }
  })
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
      { label: '复制链接地址', click: () => clipboard.writeText(external) },
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
      { label: '取消选择', enabled: Boolean(params.selectionText), click: () => guest.executeJavaScript('window.getSelection?.()?.removeAllRanges()', true).catch(() => {}) },
      { label: '全选', role: 'selectAll' }
    )
  }

  while (template[0]?.type === 'separator') template.shift()
  while (template.at(-1)?.type === 'separator') template.pop()
  if (template.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
    Menu.buildFromTemplate(template).popup({ window: mainWindow })
  }
}

async function chooseWorkspaceDirectory() {
  if (workspacePickerPromise) return workspacePickerPromise
  showMainWindow()
  workspacePickerPromise = Promise.resolve().then(() => {
    const filePaths = dialog.showOpenDialogSync(mainWindow, {
      title: '选择工作区目录',
      buttonLabel: '选择此文件夹',
      defaultPath: desktopRuntimePaths().workspace,
      properties: ['openDirectory', 'createDirectory']
    })
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus()
    return filePaths?.[0] || null
  })
  try {
    return await workspacePickerPromise
  } finally {
    workspacePickerPromise = null
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

function openDataManager(target) {
  showMainWindow()
  const contents = mainWindow?.webContents
  if (!contents || contents.isDestroyed()) return
  const publish = () => contents.send('data:open-manager', target)
  if (contents.isLoadingMainFrame()) contents.once('did-finish-load', publish)
  else publish()
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
    openMemoryManager: () => openDataManager('memory'),
    openStorageManager: () => openDataManager('storage'),
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
  syncTitleBarOverlay()

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
  mainWindow.on('resize', layoutBrowserView)
  mainWindow.on('closed', () => {
    browserSecurityPolicy?.stop()
    closeBrowserViewContents()
    browserSecurityPolicy = null
    browserSidebarVisible = false
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
ipcMain.handle('appearance:setUiPreferences', async (_event, patch) => {
  ensureStateStore().updateAppearance(patch || {})
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
ipcMain.handle('storage:scan', event => {
  assertDesktopShellSender(event)
  return ensureStorageManagementService().scan()
})
ipcMain.handle('storage:cleanupPreview', (event, options) => {
  assertDesktopShellSender(event)
  return ensureStorageManagementService().preview(options || {})
})
ipcMain.handle('storage:cleanupApply', (event, request) => {
  assertDesktopShellSender(event)
  return ensureStorageManagementService().apply(request?.previewId, { confirmed: request?.confirmed === true })
})
ipcMain.handle('storage:status', event => {
  assertDesktopShellSender(event)
  return ensureStorageManagementService().status()
})
ipcMain.handle('memory:status', event => {
  assertDesktopShellSender(event)
  return memoryStatusPayload()
})
ipcMain.handle('memory:setEnabled', (event, enabled) => {
  assertDesktopShellSender(event)
  return setMemoryEnabled(Boolean(enabled))
})
ipcMain.handle('memory:setPreferences', (event, patch) => {
  assertDesktopShellSender(event)
  return updateMemoryPreferences(patch || {})
})
ipcMain.handle('memory:list', (event, options) => {
  assertDesktopShellSender(event)
  return ensureMemoryService().list(options || {})
})
ipcMain.handle('memory:search', (event, query, options) => {
  assertDesktopShellSender(event)
  return ensureMemoryService().search(String(query || ''), options || {})
})
ipcMain.handle('memory:add', (event, entry) => {
  assertDesktopShellSender(event)
  return ensureMemoryService().add(entry || {})
})
ipcMain.handle('memory:update', (event, id, patch) => {
  assertDesktopShellSender(event)
  return ensureMemoryService().update(String(id || ''), patch || {})
})
ipcMain.handle('memory:delete', (event, id) => {
  assertDesktopShellSender(event)
  return ensureMemoryService().delete(String(id || ''))
})
ipcMain.handle('memory:deleteAll', async (event, request) => {
  assertDesktopShellSender(event)
  if (request?.confirmed !== true) throw new Error('删除全部记忆需要用户明确确认。')
  const service = ensureMemoryService()
  const deleted = await service.deleteAll()
  const exports = request?.deleteExports === true ? await service.deleteExports() : { deletedExports: 0 }
  return { ...deleted, ...exports }
})
ipcMain.handle('memory:export', event => {
  assertDesktopShellSender(event)
  const destination = path.join(desktopRuntimePaths().root, 'memory-exports', `memory-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  return ensureMemoryService().export({ to: destination })
})
ipcMain.handle('browser:state', event => {
  assertDesktopShellSender(event)
  return browserStatePayload()
})
ipcMain.handle('browser:setVisible', (event, visible) => {
  assertDesktopShellSender(event)
  return setBrowserSidebarVisible(Boolean(visible))
})
ipcMain.handle('browser:setContentVisible', (event, visible) => {
  assertDesktopShellSender(event)
  return setBrowserContentVisible(Boolean(visible))
})
ipcMain.handle('browser:navigate', (event, value) => {
  assertDesktopShellSender(event)
  return navigateBrowser(value)
})
ipcMain.handle('browser:back', event => {
  assertDesktopShellSender(event)
  browserOperations.ticket()
  const history = browserNavigationHistory()
  if (history?.canGoBack()) history.goBack()
  return browserStatePayload()
})
ipcMain.handle('browser:forward', event => {
  assertDesktopShellSender(event)
  browserOperations.ticket()
  const history = browserNavigationHistory()
  if (history?.canGoForward()) history.goForward()
  return browserStatePayload()
})
ipcMain.handle('browser:reload', event => {
  assertDesktopShellSender(event)
  browserOperations.ticket()
  ensureBrowserSidebar().webContents.reload()
  return browserStatePayload()
})
ipcMain.handle('browser:stop', event => {
  assertDesktopShellSender(event)
  ensureBrowserSidebar().webContents.stop()
  return browserStatePayload({ loading: false })
})
ipcMain.handle('browser:clearSiteData', (event, request) => {
  assertDesktopShellSender(event)
  return clearBrowserSiteData(request?.confirmed === true)
})
ipcMain.handle('browser:clearAllData', (event, request) => {
  assertDesktopShellSender(event)
  return clearAllBrowserData(request?.confirmed === true)
})
ipcMain.handle('browser:grantCurrent', (event, actions) => {
  assertDesktopShellSender(event)
  return grantCurrentBrowserOrigin(actions)
})
ipcMain.handle('browser:revokeCurrent', event => {
  assertDesktopShellSender(event)
  browserOperations.ticket()
  if (browserState.origin && browserSecurityPolicy && !browserSecurityPolicy.isStopped) browserSecurityPolicy.revoke(browserState.origin)
  return publishBrowserState()
})
ipcMain.handle('browser:resumeModelControl', event => {
  assertDesktopShellSender(event)
  return resumeBrowserModelControl()
})
ipcMain.handle('browser:confirmModelAction', (event, confirmationId) => {
  assertDesktopShellSender(event)
  browserOperations.ticket()
  const confirmation = browserSecurityPolicy?.confirm(String(confirmationId || ''), { by: 'user' })
  return { confirmation, pending: browserSecurityPolicy?.pendingConfirmations() || [] }
})
ipcMain.handle('browser:rejectModelAction', (event, confirmationId) => {
  assertDesktopShellSender(event)
  browserOperations.ticket()
  browserSecurityPolicy?.rejectConfirmation(String(confirmationId || ''))
  return { pending: browserSecurityPolicy?.pendingConfirmations() || [] }
})
ipcMain.handle('computerUse:state', event => { assertDesktopShellSender(event); return computerUseState() })
ipcMain.handle('computerUse:setEnabled', async (event, enabled) => { assertDesktopShellSender(event); return setComputerUseEnabled(Boolean(enabled)) })
ipcMain.handle('computerUse:confirm', (event, id) => { assertDesktopShellSender(event); computerUseConfirmations.confirm(id); return computerUseState() })
ipcMain.handle('computerUse:reject', (event, id) => { assertDesktopShellSender(event); computerUseConfirmations.reject(id); return computerUseState() })
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
ipcMain.handle('workspace:chooseDirectory', event => {
  if (!isLocalRuntimeUrl(event.sender.getURL())) throw new Error('只允许本机 Harness 界面选择工作区。')
  return chooseWorkspaceDirectory()
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
  await clearComputerUseScreenshots().catch(error => console.warn(`Unable to clear stale Computer Use screenshots: ${error.message}`))
  try { ensureMemoryService() } catch (error) { console.warn(`Unable to initialize local memory: ${error.message}`) }
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
    await ensureDesktopDirectoryPickerPlugin(desktopDirectoryPickerPluginOptions()).catch(error => {
      console.warn(`Unable to prepare desktop directory picker plugin: ${error.message}`)
    })
    await ensureDesktopBrowserToolsPlugin(desktopBrowserToolsPluginOptions()).catch(error => {
      console.warn(`Unable to prepare desktop browser tools plugin: ${error.message}`)
    })
    await ensureDesktopMemoryToolsPlugin(desktopMemoryToolsPluginOptions()).catch(error => {
      console.warn(`Unable to prepare desktop memory tools plugin: ${error.message}`)
    })
    await ensureDesktopComputerUsePlugin(desktopComputerUsePluginOptions()).catch(error => {
      console.warn(`Unable to prepare desktop Computer Use plugin: ${error.message}`)
    })
    await ensureAgentTeamsPlugin(agentTeamsPluginOptions()).catch(error => {
      console.warn(`Unable to prepare Agent Teams plugin: ${error.message}`)
    })
  })()
  runtimeInitializationPromise.then(() => ensureStorageManagementService().maintainCaches())
    .catch(error => console.warn(`Unable to maintain managed caches: ${error.message}`))
  if (!STORE_BUILD) ensurePetSystem()
  const syncService = ensureMobileSyncService()
  if (mobileSyncStore.get().enabled) {
    syncService.start({ persist: false }).catch(error => console.warn(`Unable to restore mobile sync: ${error.message}`))
  }
  ensureDesktopTray()
  createWindow()
  nativeTheme.on('updated', () => syncTitleBarOverlay())
  runtimeInitializationPromise.catch(error => console.warn(`Unable to prepare bundled Harness runtime: ${error.message}`))
  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('before-quit', event => {
  isQuitting = true
  clearInterval(petTickTimer)
  petAdapter?.stop()
  petDomain?.dispose()
  petWindowController?.dispose()
  desktopTray?.destroy()
  desktopTray = null
  mobileSyncService?.stop({ persist: false }).catch(() => {})
  storageManagementService?.stop()
  memoryService?.close()
  browserSecurityPolicy?.stop()
  browserControlServer?.stop().catch(() => {})
  computerUseEnabled = false
  computerUseSessionGeneration += 1
  computerUseConfirmations.clear()
  if (!computerUseQuitCleanupComplete) {
    event.preventDefault()
    if (!computerUseQuitCleanupStarted) {
      computerUseQuitCleanupStarted = true
      clearComputerUseScreenshots()
        .catch(error => console.warn(`Unable to clear Computer Use screenshots during shutdown: ${error.message}`))
        .finally(() => { computerUseQuitCleanupComplete = true; app.quit() })
    }
  }
  closeBrowserViewContents()
  stopRuntime()
})
app.on('window-all-closed', () => {
  // The tray owns the application lifecycle; only its explicit Exit action quits.
})
