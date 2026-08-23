const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, powerMonitor, safeStorage, screen, session, shell, Tray, WebContentsView } = require('electron')
const { spawn, execFile } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')
const { existsSync, mkdirSync } = require('node:fs')
const { mkdir, open, readFile, readdir, realpath, stat, unlink, writeFile } = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const AdmZip = require('adm-zip')
const WebSocket = require('ws')

const { resolveDshBin } = require('./bridge/dsh-resolver.cjs')
const { ensureRuntimeNodeModules } = require('./bridge/runtime-bundle-service.cjs')
const { ensureModelRouting, getModelRouting, saveModelRouting } = require('./bridge/model-routing-service.cjs')
const { assertWallpaperLibraryCapacity, cleanupOrphanedWallpaperStorage, createWallpaperMediaResponse, createWallpaperMutationQueue, createWallpaperVideoResponse, installManagedWallpaperCopy, isManagedWallpaperFileName, resolveWallpaperEngineInput, resolveWallpaperEngineProject, revalidateProjectMediaPath, safeManagedWallpaperPath, wallpaperKind, wallpaperMime, wallpaperStorageUsageBytes } = require('./bridge/wallpaper-service.cjs')
const { defaultSteamRootCandidates, scanWallpaperEngineLibrary } = require('./bridge/wallpaper-library.cjs')
const { createDefaultProviderMeterRegistry } = require('./bridge/provider-meter-service.cjs')
const { ensurePluginMarketplace } = require('./bridge/plugin-marketplace-service.cjs')
const { ensureMobileControlPlugin } = require('./bridge/mobile-control-plugin-service.cjs')
const { ensureDesktopDirectoryPickerPlugin } = require('./bridge/desktop-directory-picker-plugin-service.cjs')
const { ensureDesktopBrowserToolsPlugin } = require('./bridge/desktop-browser-tools-plugin-service.cjs')
const { ensureDesktopMemoryToolsPlugin } = require('./bridge/desktop-memory-tools-plugin-service.cjs')
const { ensureDesktopMcpManagerPlugin } = require('./bridge/desktop-mcp-manager-plugin-service.cjs')
const { ensureDesktopSchedulesPlugin } = require('./bridge/desktop-schedules-plugin-service.cjs')
const { ensureDesktopFilesPlugin } = require('./bridge/desktop-files-plugin-service.cjs')
const { ensureDesktopProgressPlugin } = require('./bridge/desktop-progress-plugin-service.cjs')
const { ensureDesktopCompactionPlugin } = require('./bridge/desktop-compaction-plugin-service.cjs')
const { ensureDesktopComputerUsePlugin } = require('./bridge/desktop-computer-use-plugin-service.cjs')
const { ensureAgentTeamsPlugin } = require('./bridge/agent-teams-plugin-service.cjs')
const { ensureSessionExperiencePlugin } = require('./bridge/session-experience-plugin-service.cjs')
const { ComputerUseScreenshotStore, DEFAULT_MAX_FILES: COMPUTER_USE_SCREENSHOT_MAX_FILES, DEFAULT_MAX_BYTES: COMPUTER_USE_SCREENSHOT_MAX_BYTES, DEFAULT_MAX_AGE_MS: COMPUTER_USE_SCREENSHOT_MAX_AGE_MS } = require('./bridge/computer-use-screenshot-store.cjs')
const { ComputerUseConfirmationStore } = require('./bridge/computer-use-confirmation-store.cjs')
const { ComputerUseAppPolicy } = require('./bridge/computer-use-app-policy.cjs')
const { WindowsComputerUse } = require('./bridge/windows-computer-use.cjs')
const { spawnCommand } = require('./bridge/process-spawn.cjs')
const { createGitRuntimeService } = require('./bridge/git-runtime-service.cjs')
const { terminateProcessTree } = require('./bridge/process-tree.cjs')
const { desktopRuntimeEnvironment, resolveDesktopRuntimePaths } = require('./bridge/dsh-home.cjs')
const { resolveUserDataOverride } = require('./bridge/user-data-override.cjs')
const { buildRuntimeProxyEnv, hasExplicitProxy } = require('./bridge/runtime-proxy.cjs')
const { DEFAULT_APP_FEEDS, DEFAULT_MAX_REDIRECTS, checkAppUpdate, checkHarnessUpstream, parseChecksumFile, safeHttpsUpdateUrl } = require('./bridge/update-service.cjs')
const { checksumWithFallback, downloadWithFallback, fetchWithSafeRedirects } = require('./bridge/update-download-service.cjs')
const { resolveUpdateFeeds } = require('./bridge/update-feed-config.cjs')
const { openDesktopInstaller } = require('./bridge/update-launcher.cjs')
const { resolveComponentUpdateConfig } = require('./bridge/component-update-config.cjs')
const { ComponentUpdateService } = require('./bridge/component-update-service.cjs')
const { effectiveComponentLastCheck } = require('./bridge/component-update-service.cjs')
const { ComponentUpdateStore } = require('./bridge/component-update-store.cjs')
const { launchComponentUpdateHelper } = require('./bridge/component-update-launcher.cjs')
const { normalizeLocalTarget, openLocalTarget } = require('./bridge/local-target-service.cjs')
const { StorageManagementService } = require('./bridge/storage-management-service.cjs')
const { loadRightWorkspaceResource, previewLocalDocument } = require('./bridge/right-workspace-service.cjs')
const { MemoryService, createMemoryPack } = require('./bridge/memory-service.cjs')
const { redact: redactSensitiveText } = require('./bridge/memory-censor.cjs')
const { BrowserSecurityPolicy } = require('./bridge/browser-security-policy.cjs')
const { DECISIONS: BROWSER_LINK_DECISIONS, routeBrowserLink } = require('./bridge/browser-link-router.cjs')
const { MAX_DOWNLOAD_BYTES, MAX_UPLOAD_BYTES, isSensitiveText } = require('./bridge/browser-action-gate.cjs')
const { hostPublicInfo } = require('./bridge/browser-url-policy.cjs')
const { BrowserOperationCoordinator } = require('./bridge/browser-operation-coordinator.cjs')
const { BrowserControlServer } = require('./bridge/browser-control-server.cjs')
const { BrowserDiagnostics, safeUrl: safeBrowserDiagnosticUrl } = require('./bridge/browser-diagnostics.cjs')
const { BrowserHistoryStore } = require('./bridge/browser-history-store.cjs')
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
const { AppStateStore, MAX_WALLPAPER_LIBRARY_ITEMS } = require('./store/app-state-store.cjs')
const { MobileSyncStore } = require('./store/mobile-sync-store.cjs')
const { PetDomainService } = require('./pet/pet-domain-service.cjs')
const { PetEventAdapter } = require('./pet/pet-event-adapter.cjs')
const { PetStateStore } = require('./pet/pet-state-store.cjs')
const { PetWindowController } = require('./pet/pet-window.cjs')
const { THEME_CATALOG } = require('../renderer/theme-catalog.js')
const { mobileBootstrapSource } = require('../renderer/theme-integration.js')
const desktopPackage = require('../package.json')

const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:3080'
const WALLPAPER_SCHEME = 'harness-wallpaper'
const LOCAL_RUNTIME_HOSTS = new Set(['127.0.0.1', 'localhost'])
const SELF_TEST_MODE = process.argv.includes('--self-test')
const COMPONENT_HEALTH_CHECK_MODE = process.argv.includes('--component-health-check')
const MANUAL_VALIDATION_MODE = process.argv.includes('--manual-validation') && process.argv.some(value => /^--harness-user-data-dir=.+/.test(value))
const HAS_SINGLE_INSTANCE_LOCK = SELF_TEST_MODE || COMPONENT_HEALTH_CHECK_MODE || MANUAL_VALIDATION_MODE || app.requestSingleInstanceLock()
const STORE_BUILD = isStoreDistribution()

let mainWindow = null
const detachedSessionWindows = new Set()
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
let gitRuntimeService = null
let gitPreparationPromise = null
const CACHE_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000
let cacheMaintenanceTimer = null
let memoryService = null
let browserView = null
let runtimeGuest = null
const browserTabs = new Map()
let activeBrowserTabId = null
let nextBrowserTabSequence = 1
const browserDiagnostics = new BrowserDiagnostics()
const browserDownloads = []
const browserDialogs = new Map()
const activeBrowserTransfers = new Map()
let browserTransferTail = Promise.resolve()
let browserHistoryStore = null
let browserNetworkDiagnosticsAttached = false
let browserDownloadTrackingAttached = false
let browserSecurityPolicy = null
let browserControlServer = null
const browserOperations = new BrowserOperationCoordinator()
let browserSidebarVisible = false
let browserContentVisible = true
let workspacePickerPromise = null
let computerUseEnabled = false
let computerUseSessionGeneration = 0
let computerUseScreenshotStore = null
let computerUseAppPolicy = null
let windowsComputerUse = null
let computerUseCurrentTarget = null
let computerUseHarnessSurface = null
let computerUseScreenLocked = false
const computerUseTargets = new Map()
const computerUseKnownApps = new Map()
const computerUsePolicyRows = new Map()
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

function ensureGitRuntimeService() {
  if (!gitRuntimeService) {
    gitRuntimeService = createGitRuntimeService({
      resourcesPath: app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..'),
      platform: process.platform,
      env: process.env
    })
  }
  return gitRuntimeService
}

function prepareDevelopmentGitRuntime() {
  if (app.isPackaged) throw new Error('正式安装包应已包含 MinGit；组件缺失时请修复或重新安装应用。')
  if (process.platform !== 'win32') throw new Error('内置 MinGit 当前只支持 Windows。')
  if (gitPreparationPromise) return gitPreparationPromise
  const root = path.resolve(__dirname, '..')
  gitPreparationPromise = import(pathToFileURL(path.join(root, 'scripts', 'prepare-bundled-git.mjs')).href)
    .then(module => module.prepareBundledGit({ root }))
    .then(async () => {
      ensureGitRuntimeService().refresh()
      return ensureGitRuntimeService().status()
    })
    .finally(() => { gitPreparationPromise = null })
  return gitPreparationPromise
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

function runManagedCacheMaintenance() {
  return ensureStorageManagementService().maintainCaches()
    .catch(error => console.warn(`Unable to maintain managed caches: ${error.message}`))
}

function startManagedCacheMaintenance() {
  if (cacheMaintenanceTimer) return
  runManagedCacheMaintenance()
  cacheMaintenanceTimer = setInterval(runManagedCacheMaintenance, CACHE_MAINTENANCE_INTERVAL_MS)
  cacheMaintenanceTimer.unref?.()
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

const BROWSER_PANEL_MIN_WIDTH = 360
const BROWSER_PANEL_DEFAULT_WIDTH = 460
const BROWSER_PANEL_MAX_WIDTH = 1_400
const BROWSER_VIEW_TOP = 118
const BROWSER_VIEW_FOOTER = 34
let browserPanelWidth = BROWSER_PANEL_DEFAULT_WIDTH
let browserWideMode = false

function browserPolicyOptions() {
  const root = path.join(desktopRuntimePaths().root, 'browser')
  return {
    authzFile: path.join(root, 'site-authorizations.json'),
    authzRootDir: root,
    downloadRoots: [app.getPath('downloads')]
  }
}

function ensureBrowserHistoryStore() {
  if (!browserHistoryStore) {
    browserHistoryStore = new BrowserHistoryStore({ file: path.join(desktopRuntimePaths().root, 'browser', 'history.json') })
  }
  return browserHistoryStore
}

function effectiveBrowserPanelWidth(windowWidth) {
  const width = Math.max(1, Number(windowWidth) || 1)
  if (browserWideMode) return Math.min(width, Math.max(BROWSER_PANEL_DEFAULT_WIDTH, Math.floor(width * 0.72)))
  return Math.min(width, Math.max(BROWSER_PANEL_MIN_WIDTH, Math.min(BROWSER_PANEL_MAX_WIDTH, browserPanelWidth)))
}

function liveBrowserContents() {
  const contents = browserView?.webContents
  if (!contents || typeof contents.isDestroyed !== 'function' || contents.isDestroyed()) return null
  return contents
}

function closeBrowserViewContents() {
  abortBrowserTransfers()
  const views = [...browserTabs.values()].map(tab => tab.view)
  if (browserView && !views.includes(browserView)) views.push(browserView)
  browserView = null
  browserTabs.clear()
  browserDialogs.clear()
  activeBrowserTabId = null
  for (const view of views) {
    const contents = view?.webContents
    if (!contents || typeof contents.isDestroyed !== 'function' || contents.isDestroyed()) continue
    contents.close()
  }
}

function browserNavigationHistory() {
  return liveBrowserContents()?.navigationHistory || null
}

function layoutBrowserView() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [width, height] = mainWindow.getContentSize()
  const panelWidth = effectiveBrowserPanelWidth(width)
  const bounds = {
    x: Math.max(0, width - panelWidth),
    y: BROWSER_VIEW_TOP,
    width: panelWidth,
    height: Math.max(1, height - BROWSER_VIEW_TOP - BROWSER_VIEW_FOOTER)
  }
  for (const [tabId, tab] of browserTabs) {
    if (!tab.view?.webContents || tab.view.webContents.isDestroyed()) continue
    tab.view.setBounds(bounds)
    tab.view.setVisible(tabId === activeBrowserTabId && browserSidebarVisible && browserContentVisible)
  }
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
    pendingConfirmations: browserSecurityPolicy?.pendingConfirmations() || [],
    activeTabId: activeBrowserTabId,
    tabs: [...browserTabs.entries()].map(([id, tab]) => ({
      id,
      title: safeBrowserText(tab.view.webContents.getTitle() || '新标签页', 160),
      url: tab.view.webContents.getURL() || '',
      loading: tab.view.webContents.isLoading()
    })),
    downloads: browserDownloads.map(item => ({ ...item })),
    dialog: {
      available: browserTabs.get(activeBrowserTabId)?.dialogControl === true,
      pending: browserDialogs.has(activeBrowserTabId),
      type: browserDialogs.get(activeBrowserTabId)?.type || null
    },
    history: await ensureBrowserHistoryStore().search('', { limit: 50 }),
    panelWidth: effectiveBrowserPanelWidth(mainWindow?.getContentSize?.()[0] || browserPanelWidth),
    wideMode: browserWideMode,
    viewport: liveBrowserContents()
      ? { width: browserView.getBounds().width, height: browserView.getBounds().height }
      : { width: 0, height: 0 }
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
    browserSecurityPolicy.setActiveTab({ id: activeBrowserTabId || 'side-browser-main', origin: nav.origin, visible: browserSidebarVisible && browserContentVisible })
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
  if (!browserSecurityPolicy || browserSecurityPolicy.isStopped) browserSecurityPolicy = new BrowserSecurityPolicy(browserPolicyOptions())
  const browserSession = session.fromPartition(browserSecurityPolicy.partitionName, { cache: true })
  browserSession.setPermissionCheckHandler(() => false)
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  if (!browserNetworkDiagnosticsAttached) {
    browserNetworkDiagnosticsAttached = true
    browserSession.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, details => {
      browserDiagnostics.recordNetwork({
        id: details.id,
        method: details.method,
        url: details.url,
        status: details.statusCode,
        resourceType: details.resourceType,
        fromCache: details.fromCache,
        completedAt: Date.now()
      })
    })
  }
  if (!browserDownloadTrackingAttached) {
    browserDownloadTrackingAttached = true
    browserSession.on('will-download', (_event, item) => {
      const anyModelAuthorization = browserSecurityPolicy?.authorizations?.().entries?.some(entry => entry.actions?.length)
      const blockedWhileModelAuthorized = Boolean(anyModelAuthorization && browserSecurityPolicy?.isStopped !== true)
      if (blockedWhileModelAuthorized) item.cancel()
      const unconfirmedModelDownload = blockedWhileModelAuthorized
      const modelInitiated = false
      const entry = {
        id: randomUUID(),
        filename: safeBrowserText(item.getFilename(), 240),
        receivedBytes: 0,
        totalBytes: Math.max(0, Number(item.getTotalBytes()) || 0),
        state: unconfirmedModelDownload ? 'cancelled' : 'progressing',
        modelInitiated,
        blockedUnconfirmed: unconfirmedModelDownload,
        startedAt: Date.now()
      }
      browserDownloads.push(entry)
      if (browserDownloads.length > 20) browserDownloads.splice(0, browserDownloads.length - 20)
      const update = state => {
        entry.receivedBytes = Math.max(0, Number(item.getReceivedBytes()) || 0)
        entry.totalBytes = Math.max(entry.totalBytes, Number(item.getTotalBytes()) || 0)
        entry.state = String(state || item.getState() || 'progressing')
        publishBrowserState().catch(() => {})
      }
      item.on('updated', (_itemEvent, state) => update(state))
      item.once('done', (_itemEvent, state) => update(state))
      publishBrowserState().catch(() => {})
    })
  }
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
  const tabId = `browser-tab-${nextBrowserTabSequence++}`
  activeBrowserTabId = tabId
  const browserTab = { id: tabId, view: browserView, createdAt: Date.now(), dialogControl: false, navigationGeneration: 0 }
  browserTabs.set(tabId, browserTab)
  try {
    contents.debugger.attach('1.3')
    contents.debugger.sendCommand('Page.enable').then(() => { browserTab.dialogControl = true }).catch(() => {})
    contents.debugger.on('message', (_debuggerEvent, method, parameters) => {
      if (method === 'Page.javascriptDialogOpening') {
        const rawDialogMessage = String(parameters?.message || '')
        browserDialogs.set(tabId, {
          id: randomUUID(),
          type: safeBrowserText(parameters?.type || 'alert', 40),
          message: /(?:^|\D)\d{4,8}(?:\D|$)/.test(rawDialogMessage) ? '[REDACTED:sensitive-browser-content]' : safeBrowserText(rawDialogMessage, 500),
          hasBrowserHandler: Boolean(parameters?.hasBrowserHandler),
          at: Date.now()
        })
        if (tabId === activeBrowserTabId) publishBrowserState().catch(() => {})
      } else if (method === 'Page.javascriptDialogClosed') {
        browserDialogs.delete(tabId)
        if (tabId === activeBrowserTabId) publishBrowserState().catch(() => {})
      }
    })
    contents.debugger.on('detach', () => { browserTab.dialogControl = false; browserDialogs.delete(tabId) })
  } catch {}
  contents.on('console-message', (_event, details) => {
    if (tabId !== activeBrowserTabId) return
    browserDiagnostics.recordConsole({
      level: details.level,
      message: details.message,
      source: details.sourceId,
      line: details.lineNumber
    })
  })
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
  contents.on('did-start-loading', () => { if (tabId === activeBrowserTabId) publishBrowserState({ loading: true }).catch(() => {}) })
  contents.on('did-stop-loading', () => { if (tabId === activeBrowserTabId) publishBrowserState({ loading: false }).catch(() => {}) })
  const navigated = (_event, url) => {
    browserTab.navigationGeneration += 1
    ensureBrowserHistoryStore().add(url, contents.getTitle()).catch(() => {})
    if (tabId !== activeBrowserTabId) return
    updateBrowserActiveTab(url)
    publishBrowserState({ url }).catch(() => {})
  }
  contents.on('did-navigate', navigated)
  contents.on('did-navigate-in-page', navigated)
  contents.on('page-title-updated', (_event, title) => {
    ensureBrowserHistoryStore().updateTitle(contents.getURL(), title).catch(() => {})
    if (tabId === activeBrowserTabId) publishBrowserState({ title }).catch(() => {})
  })
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (tabId === activeBrowserTabId && isMainFrame && code !== -3) publishBrowserState({ loading: false, url, error: description || `加载失败 (${code})` }).catch(() => {})
  })
  layoutBrowserView()
  return browserView
}

async function createBrowserTab(value = '') {
  browserOperations.ticket()
  browserView = null
  const view = ensureBrowserSidebar()
  const tabId = activeBrowserTabId
  const target = String(value || '').trim()
  if (target) await view.webContents.loadURL(normalizeBrowserAddress(target))
  else await view.webContents.loadURL('about:blank')
  layoutBrowserView()
  await publishBrowserState({ error: '' })
  return { activeTabId: tabId, state: await browserStatePayload() }
}

async function switchBrowserTab(tabId) {
  browserOperations.ticket()
  const tab = browserTabs.get(String(tabId || ''))
  if (!tab || tab.view.webContents.isDestroyed()) throw new Error('浏览器标签页不存在。')
  activeBrowserTabId = tab.id
  browserView = tab.view
  const url = tab.view.webContents.getURL()
  updateBrowserActiveTab(url)
  layoutBrowserView()
  return publishBrowserState({
    url,
    title: tab.view.webContents.getTitle(),
    loading: tab.view.webContents.isLoading(),
    error: ''
  })
}

async function closeBrowserTab(tabId) {
  browserOperations.ticket()
  const id = String(tabId || activeBrowserTabId || '')
  const tab = browserTabs.get(id)
  if (!tab) throw new Error('浏览器标签页不存在。')
  browserTabs.delete(id)
  browserDialogs.delete(id)
  try { mainWindow?.contentView.removeChildView(tab.view) } catch {}
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  if (!browserTabs.size) return createBrowserTab()
  if (id === activeBrowserTabId) {
    const next = [...browserTabs.values()].at(-1)
    activeBrowserTabId = next.id
    browserView = next.view
    updateBrowserActiveTab(next.view.webContents.getURL())
  }
  layoutBrowserView()
  return publishBrowserState()
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
  // Content visibility is an internal WebContentsView detail. Broadcasting it
  // as a sidebar state races browser:setVisible during open/close and can feed
  // a transient, opposite sidebar value back into the renderer indefinitely.
  return browserStatePayload()
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
  abortBrowserTransfers(origin)
  await withBrowserTransferLock(async () => {})
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
    browserDiagnostics.clear('all')
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
  const origin = browserState.origin
  const privateNetwork = !hostPublicInfo(new URL(origin).hostname).public
  browserSecurityPolicy.grant(origin, {
    actions: Array.isArray(actions) ? actions : [],
    ttlMs: 2 * 60 * 60 * 1000,
    ...(privateNetwork ? { by: 'user', allowPrivateNetwork: true } : {})
  })
  return publishBrowserState()
}

async function clearAllBrowserData(confirmed) {
  if (confirmed !== true) throw new Error('重置独立浏览器 Profile 需要用户明确确认。')
  const view = ensureBrowserSidebar()
  const resetGeneration = browserOperations.beginReset()
  const contents = view.webContents
  const browserSession = contents.session
  abortBrowserTransfers()
  await withBrowserTransferLock(async () => {})
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
    browserDiagnostics.clear('all')
    browserDownloads.length = 0
    browserDialogs.clear()
    await ensureBrowserHistoryStore().clear()
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
  return { view, url, origin: browserState.origin, tabId: activeBrowserTabId || 'side-browser-main', ticket }
}

function safeBrowserText(value, maximum = 12000) {
  const text = String(value || '').slice(0, maximum)
  if (isSensitiveText(text)) return '[REDACTED:sensitive-browser-content]'
  return redactSensitiveText(text).text
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
  const metadata = await view.webContents.executeJavaScript(`(() => {
    const element=document.querySelector('[data-hd-model-ref=${JSON.stringify(String(ref))}]');
    if(!element) return null;
    const label=element.labels?.[0]?.innerText||element.getAttribute('aria-label')||element.placeholder||'';
    const text=String(element.innerText||element.textContent||'').trim().slice(0,300);
    const rect=element.getBoundingClientRect();
    return { tag:element.tagName.toLowerCase(),type:String(element.type||''),name:String(element.name||''),id:String(element.id||''),role:String(element.getAttribute('role')||''),autocomplete:String(element.autocomplete||''),ariaLabel:String(element.getAttribute('aria-label')||''),label:String(label),baseUrl:location.origin,text,href:String(element.href||''),downloadName:String(element.getAttribute('download')||''),submit:Boolean(element.type==='submit'||element.closest('button[type="submit"],input[type="submit"]')),disabled:Boolean(element.disabled||element.getAttribute('aria-disabled')==='true'),x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2) };
  })()`, true)
  if (!metadata || !view.webContents.debugger.isAttached()) return metadata
  try {
    const documentNode = await view.webContents.debugger.sendCommand('DOM.getDocument', { depth: 0, pierce: true })
    const selected = await view.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: `[data-hd-model-ref="${String(ref)}"]` })
    if (!selected.nodeId) return null
    const described = await view.webContents.debugger.sendCommand('DOM.describeNode', { nodeId: selected.nodeId })
    return { ...metadata, backendNodeId: described.node.backendNodeId }
  } catch {
    return null
  }
}

function authorizeBrowserRead(origin, tabId, tag = 'document') {
  return browserSecurityPolicy.modelAction({ action: 'read', tabId, declaredOrigin: origin, field: { baseUrl: origin, tag }, payload: {} })
}

async function captureBrowserForModel(view, parameters) {
  const preflight = await view.webContents.executeJavaScript(`(() => {
    const sensitive=/(?:pass(?:word|wd)?|pwd|secret|token|cookie|authorization|otp|captcha|verification|验证码|银行卡|card.?number|cvv|cvc)/i;
    const visible=element=>{const rect=element.getBoundingClientRect();const style=getComputedStyle(element);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'};
    const sensitiveField=[...document.querySelectorAll('input,textarea,select,[contenteditable="true"]')].filter(visible).some(element=>sensitive.test([element.type,element.name,element.id,element.autocomplete,element.getAttribute('aria-label'),element.placeholder].filter(Boolean).join(' ')));
    return {sensitiveField,text:String(document.body?.innerText||'').slice(0,12000)};
  })()`, true)
  const highRisk = redactSensitiveText(preflight?.text || '').types
  if (preflight?.sensitiveField || highRisk.length || isSensitiveText(preflight?.text || '')) {
    throw Object.assign(new Error('当前可见页面包含密码、验证码、令牌、支付或账号类敏感内容，模型截图已阻止，请由用户亲自查看。'), { code: 'sensitive-screenshot-blocked' })
  }
  const image = await view.webContents.capturePage()
  const maxWidth = Math.max(320, Math.min(1600, Math.floor(Number(parameters.max_width) || 1200)))
  const sourceSize = image.getSize()
  const scaled = sourceSize.width > maxWidth ? image.resize({ width: maxWidth, quality: 'good' }) : image
  const size = scaled.getSize()
  return { image: scaled.toDataURL(), mime: 'image/png', width: size.width, height: size.height }
}

async function browserDomDiagnostics(view) {
  return view.webContents.executeJavaScript(`(() => {
    const sensitive=/(?:pass(?:word|wd)?|pwd|secret|token|cookie|authorization|otp|captcha|verification|验证码|银行卡|card.?number|cvv|cvc)/i;
    const clean=element=>!sensitive.test([element.type,element.name,element.id,element.autocomplete,element.getAttribute('aria-label'),element.placeholder].filter(Boolean).join(' '));
    const count=selector=>document.querySelectorAll(selector).length;
    const headings=[...document.querySelectorAll('h1,h2,h3')].filter(clean).slice(0,40).map(node=>({level:node.tagName.toLowerCase(),text:String(node.innerText||node.textContent||'').trim().slice(0,240)}));
    const landmarks=[...document.querySelectorAll('main,nav,header,footer,aside,[role="main"],[role="navigation"]')].slice(0,40).map(node=>({tag:node.tagName.toLowerCase(),role:String(node.getAttribute('role')||''),label:String(node.getAttribute('aria-label')||'').slice(0,160)}));
    return {url:location.href,title:document.title,readyState:document.readyState,viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},counts:{links:count('a'),buttons:count('button,[role="button"]'),forms:count('form'),inputs:count('input,textarea,select'),images:count('img')},headings,landmarks};
  })()`, true)
}

async function extractBrowserData(view, { mode = 'text', maxItems = 100, ref = '' } = {}) {
  const allowedModes = new Set(['text', 'links', 'tables'])
  if (!allowedModes.has(mode)) throw new Error('extract_mode 仅支持 text、links 或 tables。')
  if (ref && !/^b\d{1,4}$/.test(ref)) throw new Error('抓取范围引用无效，请重新 observe。')
  const raw = await view.webContents.executeJavaScript(`(() => {
    const mode=${JSON.stringify(mode)};
    const maximum=${Math.max(1, Math.min(200, maxItems))};
    const requestedRef=${JSON.stringify(ref)};
    const root=requestedRef?document.querySelector('[data-hd-model-ref="'+requestedRef+'"]'):document;
    if(!root)return {missingRef:true,items:[],truncated:false};
    const visible=node=>{if(!(node instanceof Element))return false;const style=getComputedStyle(node);const rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)>0&&rect.width>0&&rect.height>0};
    const text=node=>String(node.innerText||node.textContent||'').replace(/\s+/g,' ').trim();
    let candidates=[];
    if(mode==='links'){
      candidates=[...root.querySelectorAll('a[href]')].filter(visible).map(node=>({text:text(node).slice(0,500),url:String(node.href||''),ref:String(node.getAttribute('data-hd-model-ref')||''),rel:String(node.rel||'').slice(0,120)}));
    }else if(mode==='tables'){
      candidates=[...root.querySelectorAll('table')].filter(visible).map(table=>({caption:text(table.querySelector('caption')||{textContent:''}).slice(0,300),headers:[...table.querySelectorAll('thead th')].slice(0,50).map(cell=>text(cell).slice(0,500)),rows:[...table.querySelectorAll('tbody tr, tr')].filter(row=>!row.closest('thead')).slice(0,maximum).map(row=>[...row.querySelectorAll(':scope > th, :scope > td')].slice(0,50).map(cell=>text(cell).slice(0,500)))}));
    }else{
      const selector='h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,pre,[role="listitem"],[itemprop="name"],[itemprop="price"],[itemprop="description"]';
      const seen=new Set();
      candidates=[...root.querySelectorAll(selector)].filter(visible).map(node=>({tag:node.tagName.toLowerCase(),text:text(node).slice(0,2000),ref:String(node.getAttribute('data-hd-model-ref')||'')})).filter(item=>item.text&&!seen.has(item.text)&&(seen.add(item.text),true));
    }
    return {missingRef:false,items:candidates.slice(0,maximum),truncated:candidates.length>maximum,totalCandidates:candidates.length};
  })()`, true)
  if (raw?.missingRef) throw new Error('抓取范围已失效，请重新 observe。')
  const safeItems = mode === 'links'
    ? (raw.items || []).map(item => ({ text: safeBrowserText(item.text, 500), url: safeBrowserDiagnosticUrl(item.url), ref: /^b\d{1,4}$/.test(item.ref) ? item.ref : '', rel: safeBrowserText(item.rel, 120) }))
    : mode === 'tables'
      ? (raw.items || []).map(item => ({ caption: safeBrowserText(item.caption, 300), headers: (item.headers || []).map(cell => safeBrowserText(cell, 500)), rows: (item.rows || []).map(row => row.map(cell => safeBrowserText(cell, 500))) }))
      : (raw.items || []).map(item => ({ tag: safeBrowserText(item.tag, 20), text: safeBrowserText(item.text, 2000), ref: /^b\d{1,4}$/.test(item.ref) ? item.ref : '' }))
  return { mode, items: safeItems, count: safeItems.length, totalCandidates: Math.max(safeItems.length, Number(raw?.totalCandidates) || 0), truncated: Boolean(raw?.truncated), bounded: true }
}

function browserDownloadDestination(requested, _targetUrl) {
  const fallback = `download-${createHash('sha256').update(String(_targetUrl || '')).digest('hex').slice(0, 12)}.bin`
  const raw = String(requested || fallback).trim()
  let sanitized = path.basename(raw).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'download'
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized)) sanitized = `_${sanitized}`
  const directory = app.getPath('downloads')
  let destination = path.join(directory, sanitized)
  if (!existsSync(destination)) return destination
  const extension = path.extname(sanitized)
  const stem = path.basename(sanitized, extension)
  for (let index = 1; index <= 999; index++) {
    destination = path.join(directory, `${stem} (${index})${extension}`)
    if (!existsSync(destination)) return destination
  }
  throw new Error('下载目录中同名文件过多，请先整理后重试。')
}

function withBrowserTransferLock(task) {
  const previous = browserTransferTail
  let release
  browserTransferTail = new Promise(resolve => { release = resolve })
  return previous.catch(() => {}).then(task).finally(() => release())
}

function abortBrowserTransfers(origin = '') {
  for (const transfer of activeBrowserTransfers.values()) {
    if (!origin || transfer.origin === origin) transfer.controller.abort()
  }
}

function assertBrowserTransferNotAborted(controller) {
  if (controller?.signal?.aborted) throw Object.assign(new Error('浏览器传输已由用户停止或撤权。'), { code: 'browser-transfer-aborted' })
}

function assertBrowserTransferBinding(view, binding, ticket, requiredAction) {
  browserOperations.assert(ticket)
  const tab = browserTabs.get(binding.tabId)
  if (!browserSidebarVisible || !browserContentVisible || activeBrowserTabId !== binding.tabId || tab?.view !== view) throw new Error('操作期间活动标签已变化，传输已取消。')
  if (tab.navigationGeneration !== binding.navigationGeneration || view.webContents.getURL() !== binding.url) throw new Error('操作期间页面已导航，传输已取消。')
  let currentOrigin = ''
  try { currentOrigin = new URL(view.webContents.getURL()).origin } catch {}
  const authorization = browserSecurityPolicy?.authorizations?.().entries?.find(entry => entry.origin === binding.origin)
  if (currentOrigin !== binding.origin || browserSecurityPolicy?.isStopped === true || !authorization?.actions?.includes(requiredAction)) throw new Error('操作期间页面来源、模型控制状态或站点授权已变化，传输已取消。')
  if (requiredAction === 'upload' && !view.webContents.debugger.isAttached()) throw new Error('文件选择期间固定浏览器控制通道已关闭，上传已取消。')
}

async function downloadBrowserResource(view, targetUrl, destinationPath, maxBytes, binding, ticket) {
  const transferId = randomUUID()
  const controller = new AbortController()
  activeBrowserTransfers.set(transferId, { origin: binding.origin, controller })
  try {
    return await runBrowserResourceDownload(view, targetUrl, destinationPath, maxBytes, binding, ticket, controller)
  } finally {
    activeBrowserTransfers.delete(transferId)
  }
}

async function runBrowserResourceDownload(view, targetUrl, destinationPath, maxBytes, binding, ticket, controller) {
  const origin = binding.origin
  let current = targetUrl
  let response
  for (let redirects = 0; redirects <= 5; redirects++) {
    assertBrowserTransferNotAborted(controller)
    assertBrowserTransferBinding(view, binding, ticket, 'download')
    response = await view.webContents.session.fetch(current, { redirect: 'manual', signal: controller.signal })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (!location) throw new Error('下载重定向缺少目标地址。')
    const next = new URL(location, current)
    if (!['http:', 'https:'].includes(next.protocol) || next.origin !== origin || next.username || next.password) throw new Error('下载重定向离开了已授权 origin，已阻止。')
    current = next.href
    if (redirects === 5) throw new Error('下载重定向次数过多。')
  }
  assertBrowserTransferNotAborted(controller)
    assertBrowserTransferBinding(view, binding, ticket, 'download')
  if (!response?.ok || !response.body) throw new Error(`下载请求失败（HTTP ${response?.status || 0}）。`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('下载大小超过已确认上限。')
  const entry = { id: randomUUID(), filename: safeBrowserText(path.basename(destinationPath), 240), receivedBytes: 0, totalBytes: Number.isFinite(declaredLength) ? declaredLength : 0, state: 'progressing', modelInitiated: true, startedAt: Date.now() }
  browserDownloads.push(entry)
  if (browserDownloads.length > 20) browserDownloads.splice(0, browserDownloads.length - 20)
  await publishBrowserState().catch(() => {})
  let handle
  let destinationCreated = false
  const reader = response.body.getReader()
  try {
    handle = await open(destinationPath, 'wx')
    destinationCreated = true
    while (true) {
      assertBrowserTransferNotAborted(controller)
    assertBrowserTransferBinding(view, binding, ticket, 'download')
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      if (entry.receivedBytes + chunk.length > maxBytes) throw new Error('下载流超过已确认大小上限。')
      let offset = 0
      while (offset < chunk.length) {
        const written = await handle.write(chunk, offset, chunk.length - offset, null)
        offset += written.bytesWritten
      }
      entry.receivedBytes += chunk.length
      entry.totalBytes = Math.max(entry.totalBytes, entry.receivedBytes)
      publishBrowserState().catch(() => {})
    }
    await withBrowserTransferLock(async () => {
      assertBrowserTransferNotAborted(controller)
      assertBrowserTransferBinding(view, binding, ticket, 'download')
      await handle.sync()
      assertBrowserTransferNotAborted(controller)
      entry.state = 'completed'
    })
    await publishBrowserState().catch(() => {})
    return { downloadCompleted: true, filename: entry.filename, bytes: entry.receivedBytes, maxBytes }
  } catch (error) {
    entry.state = 'interrupted'
    await reader.cancel().catch(() => {})
    await publishBrowserState().catch(() => {})
    throw error
  } finally {
    await handle?.close().catch(() => {})
    if (destinationCreated && entry.state !== 'completed') await unlink(destinationPath).catch(() => {})
  }
}

async function uploadBrowserFileInteractively(view, binding, ticket) {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: '选择要上传到当前网页的文件',
    buttonLabel: '选择并上传',
    properties: ['openFile']
  })
  assertBrowserTransferBinding(view, binding, ticket, 'upload')
  if (selection.canceled || !selection.filePaths?.[0]) return { uploaded: false, cancelled: true }
  const selectedPath = selection.filePaths[0]
  let handle
  let info
  let data
  try {
    handle = await open(selectedPath, 'r')
    info = await handle.stat()
    if (!info.isFile()) throw new Error('只能上传普通文件。')
    if (info.size <= 0 || info.size > MAX_UPLOAD_BYTES) throw new Error(`上传文件必须大于 0 字节且不超过 ${MAX_UPLOAD_BYTES} 字节。`)
    data = await handle.readFile()
    const after = await handle.stat()
    if (data.length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || data.length > MAX_UPLOAD_BYTES) throw new Error('文件在选择后发生变化，上传已取消。')
  } finally {
    await handle?.close().catch(() => {})
  }
  assertBrowserTransferBinding(view, binding, ticket, 'upload')
  const extension = path.extname(selectedPath).toLowerCase()
  const mediaTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.json': 'application/json', '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip' }
  const mediaType = mediaTypes[extension] || 'application/octet-stream'
  const resolved = await view.webContents.debugger.sendCommand('DOM.resolveNode', { backendNodeId: binding.backendNodeId })
  const objectId = resolved?.object?.objectId
  if (!objectId) throw new Error('文件选择控件已失效，请重新 observe 后再试。')
  let uploaded = false
  await withBrowserTransferLock(async () => {
    assertBrowserTransferBinding(view, binding, ticket, 'upload')
    try {
      const called = await view.webContents.debugger.sendCommand('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(base64,name,mediaType){if(!(this instanceof HTMLInputElement)||this.type!=='file'||!this.isConnected)return false;const binary=atob(base64);const bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);const transfer=new DataTransfer();transfer.items.add(new File([bytes],name,{type:mediaType}));this.files=transfer.files;this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));return true}`,
        arguments: [{ value: data.toString('base64') }, { value: path.basename(selectedPath) }, { value: mediaType }],
        returnByValue: true,
        awaitPromise: false
      })
      uploaded = called?.result?.value === true && !called?.exceptionDetails
    } finally {
      await view.webContents.debugger.sendCommand('Runtime.releaseObject', { objectId }).catch(() => {})
    }
  })
  if (!uploaded) throw new Error('文件选择控件已失效，请重新 observe 后再试。')
  return { uploaded: true, bytes: data.length, userSelected: true }
}

async function modelBrowserAction(input = {}) {
  const action = String(input.action || '')
  const parameters = input.payload && typeof input.payload === 'object' ? input.payload : input
  if (action === 'status') {
    const authorizations = browserSecurityPolicy?.authorizations() || { entries: [] }
    const current = authorizations.entries.find(entry => entry.origin === browserState.origin)
    const bounds = browserView?.getBounds?.() || { width: 0, height: 0 }
    return { visible: browserSidebarVisible && browserContentVisible, origin: browserState.origin || null, title: safeBrowserText(browserState.title, 500), loading: browserState.loading, stopped: browserSecurityPolicy?.isStopped === true, actions: current?.actions || [], activeTabId: activeBrowserTabId, tabs: [...browserTabs.entries()].map(([id, tab]) => ({ id, title: safeBrowserText(tab.view.webContents.getTitle(), 160), url: safeBrowserDiagnosticUrl(tab.view.webContents.getURL()), active: id === activeBrowserTabId })), downloads: browserDownloads.map(item => ({ id: item.id, receivedBytes: item.receivedBytes, totalBytes: item.totalBytes, state: item.state, modelInitiated: Boolean(item.modelInitiated) })), dialog: { available: browserTabs.get(activeBrowserTabId)?.dialogControl === true, pending: browserDialogs.has(activeBrowserTabId), type: browserDialogs.get(activeBrowserTabId)?.type || null }, viewport: { width: bounds.width, height: bounds.height }, diagnostics: { console: browserDiagnostics.snapshot('console', { limit: 500 }).console.length, network: browserDiagnostics.snapshot('network', { limit: 500 }).network.length } }
  }
  if (action === 'stop') {
    abortBrowserTransfers()
    await withBrowserTransferLock(async () => browserSecurityPolicy?.stop())
    return { stopped: true, message: '模型浏览器控制已停止；网页仍由用户直接控制。' }
  }
  if (action === 'observe') return observeBrowserForModel()
  const { view, origin, tabId, ticket } = requireVisibleBrowserForModel()
  if (action === 'screenshot') {
    authorizeBrowserRead(origin, tabId)
    const result = await captureBrowserForModel(view, parameters)
    browserOperations.assert(ticket)
    return result
  }
  if (action === 'inspect') {
    authorizeBrowserRead(origin, tabId)
    const result = await browserDomDiagnostics(view)
    browserOperations.assert(ticket)
    return {
      ...result,
      url: safeBrowserDiagnosticUrl(result.url),
      title: safeBrowserText(result.title, 500),
      headings: result.headings.map(item => ({ ...item, text: safeBrowserText(item.text, 240) })),
      landmarks: result.landmarks.map(item => ({ ...item, label: safeBrowserText(item.label, 160) }))
    }
  }
  if (action === 'extract') {
    authorizeBrowserRead(origin, tabId)
    const mode = String(parameters.extract_mode || 'text')
    const maxItems = Math.max(1, Math.min(200, Math.floor(Number(parameters.max_items) || 100)))
    const result = await extractBrowserData(view, { mode, maxItems, ref: String(parameters.ref || '') })
    browserOperations.assert(ticket)
    return { ...result, origin }
  }
  if (action === 'console' || action === 'network') {
    authorizeBrowserRead(origin, tabId)
    const limit = Math.max(1, Math.min(100, Math.floor(Number(parameters.limit) || 50)))
    const since = Math.max(0, Number(parameters.since) || 0)
    const entries = browserDiagnostics.snapshot(action, { limit: 500 })[action].filter(entry => entry.at >= since).slice(-limit)
    return { entries, count: entries.length, bounded: true, includesHeadersOrBodies: false }
  }
  if (action === 'wait') {
    authorizeBrowserRead(origin, tabId)
    const timeoutMs = Math.max(0, Math.min(10_000, Math.floor(Number(parameters.timeout_ms) || 1000)))
    await new Promise(resolve => setTimeout(resolve, timeoutMs))
    browserOperations.assert(ticket)
    return { waited: true, timeoutMs, loading: view.webContents.isLoading() }
  }
  if (action === 'tabList') {
    authorizeBrowserRead(origin, tabId)
    return { activeTabId, tabs: [...browserTabs.entries()].map(([id, tab]) => ({ id, title: safeBrowserText(tab.view.webContents.getTitle(), 160), url: safeBrowserDiagnosticUrl(tab.view.webContents.getURL()), active: id === activeBrowserTabId })) }
  }
  if (action === 'tabOpen') {
    const target = String(parameters.url || '').trim()
    if (!target) throw new Error('模型新建标签页必须提供已授权的 HTTP(S) 地址。')
    const nav = browserSecurityPolicy.modelNavigate(target, { tabId, base: view.webContents.getURL() })
    browserOperations.assert(ticket)
    const created = await createBrowserTab(nav.normalized)
    return { created: true, activeTabId: created.activeTabId, url: nav.normalized }
  }
  if (action === 'tabSwitch') {
    const targetId = String(parameters.tab_id || '')
    const target = browserTabs.get(targetId)
    if (!target) throw new Error('浏览器标签页不存在。')
    const targetUrl = target.view.webContents.getURL()
    if (!/^https?:/i.test(targetUrl)) throw new Error('模型不能切换到没有 HTTP(S) 来源的标签页。')
    browserSecurityPolicy.modelNavigate(targetUrl, { tabId, base: view.webContents.getURL() })
    await switchBrowserTab(targetId)
    return { switched: true, activeTabId: targetId, url: targetUrl }
  }
  if (action === 'tabClose') {
    const targetId = String(parameters.tab_id || activeBrowserTabId)
    if (targetId !== activeBrowserTabId) throw new Error('模型只能关闭当前可见标签页。')
    authorizeBrowserRead(origin, tabId)
    await closeBrowserTab(targetId)
    return { closed: true, activeTabId: activeBrowserTabId }
  }
  if (['back', 'forward', 'reload'].includes(action)) {
    authorizeBrowserRead(origin, tabId)
    const history = view.webContents.navigationHistory
    if (action === 'reload') view.webContents.reload()
    else {
      const canGo = action === 'back' ? history?.canGoBack() : history?.canGoForward()
      if (!canGo) return { navigated: false, reason: `cannot-go-${action}` }
      const index = history.getActiveIndex() + (action === 'back' ? -1 : 1)
      const entry = history.getEntryAtIndex(index)
      browserSecurityPolicy.modelNavigate(entry.url, { tabId, base: view.webContents.getURL() })
      history.goToIndex(index)
    }
    return { navigated: true, action }
  }
  if (action === 'scroll') {
    authorizeBrowserRead(origin, tabId)
    const bounds = view.getBounds()
    const deltaY = Math.max(-1200, Math.min(1200, Number(parameters.delta_y) || 0))
    const deltaX = Math.max(-1200, Math.min(1200, Number(parameters.delta_x) || 0))
    view.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.floor(bounds.width / 2), y: Math.floor(bounds.height / 2), deltaY, deltaX })
    return { scrolled: true, deltaX, deltaY }
  }
  if (action === 'hover') {
    const field = await browserElementMetadata(view, parameters.ref)
    browserOperations.assert(ticket)
    if (!field) throw new Error('元素已失效，请重新 observe。')
    authorizeBrowserRead(origin, tabId, field.tag)
    view.webContents.sendInputEvent({ type: 'mouseMove', x: field.x, y: field.y, movementX: 0, movementY: 0 })
    return { hovered: true, ref: String(parameters.ref) }
  }
  if (action === 'keypress') {
    const key = String(parameters.key || '')
    const allowedKeys = new Set(['Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', 'Space'])
    if (!allowedKeys.has(key)) throw new Error('不支持的按键；模型不能输入任意快捷键或文本。')
    const effectiveAction = key === 'Enter' || key === 'Space' ? 'submit' : 'read'
    const decision = browserSecurityPolicy.modelAction({ action: effectiveAction, tabId, declaredOrigin: origin, field: { baseUrl: origin, tag: 'document', submit: key === 'Enter' }, payload: {}, confirmationId: parameters.confirmation_id })
    if (!decision.allowed) return decision
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
    return { pressed: true, key, confirmed: key === 'Enter' }
  }
  if (action === 'select') {
    const field = await browserElementMetadata(view, parameters.ref)
    browserOperations.assert(ticket)
    if (!field) throw new Error('元素已失效，请重新 observe。')
    if (field.tag !== 'select') throw new Error('select 仅适用于下拉选择框。')
    const value = String(parameters.value || '').slice(0, 500)
    const decision = browserSecurityPolicy.modelAction({ action: 'type', tabId, declaredOrigin: origin, field, payload: { text: value }, confirmationId: parameters.confirmation_id })
    if (!decision.allowed) return decision
    const changed = await view.webContents.executeJavaScript(`(() => { const element=document.querySelector('[data-hd-model-ref=${JSON.stringify(String(parameters.ref))}]'); if(!(element instanceof HTMLSelectElement)) return false; const option=[...element.options].find(item=>item.value===${JSON.stringify(value)}||item.text===${JSON.stringify(value)}); if(!option) return false; element.value=option.value; element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`, true)
    browserOperations.assert(ticket)
    if (!changed) throw new Error('下拉选项不存在或元素已失效。')
    return { selected: true, ref: String(parameters.ref) }
  }
  if (action === 'navigate') {
    const nav = browserSecurityPolicy.modelNavigate(String(parameters.url || ''), { tabId, base: view.webContents.getURL() })
    browserOperations.assert(ticket)
    await view.webContents.loadURL(nav.normalized)
    browserOperations.assert(ticket)
    return { navigated: true, origin: nav.origin, url: nav.normalized }
  }
  if (action === 'download') {
    const field = await browserElementMetadata(view, parameters.ref)
    browserOperations.assert(ticket)
    if (!field?.href) throw new Error('download 只能用于具有明确 HTTP(S) 地址的链接。')
    let target
    try { target = new URL(field.href) } catch { throw new Error('下载链接地址无效。') }
    if (!['http:', 'https:'].includes(target.protocol) || target.origin !== origin || target.username || target.password) throw new Error('模型下载仅限当前已授权 origin 且不含内嵌凭据的 HTTP(S) 资源。')
    const destinationPath = browserDownloadDestination(parameters.filename, target.href)
    const maxBytes = Math.max(1, Math.min(MAX_DOWNLOAD_BYTES, Math.floor(Number(parameters.max_bytes) || Math.min(MAX_DOWNLOAD_BYTES, 50 * 1024 * 1024))))
    const payload = { destinationPath, maxBytes, targetUrl: target.href, accessibleName: safeBrowserText(field.label || field.text, 160) }
    const decision = browserSecurityPolicy.modelAction({ action: 'download', tabId, declaredOrigin: origin, field, payload, confirmationId: parameters.confirmation_id })
    if (!decision.allowed) {
      publishBrowserState().catch(() => {})
      return decision
    }
    const tab = browserTabs.get(tabId)
    return downloadBrowserResource(view, target.href, destinationPath, maxBytes, {
      tabId,
      origin,
      url: view.webContents.getURL(),
      navigationGeneration: tab.navigationGeneration
    }, ticket)
  }
  if (action === 'upload') {
    const field = await browserElementMetadata(view, parameters.ref)
    browserOperations.assert(ticket)
    if (!field || field.tag !== 'input' || field.type !== 'file' || !field.backendNodeId) throw new Error('upload 只能用于可验证身份的可见文件选择控件。')
    const decision = browserSecurityPolicy.modelAction({ action: 'upload', tabId, declaredOrigin: origin, field, payload: { interactivePicker: true }, confirmationId: parameters.confirmation_id })
    if (!decision.allowed) {
      publishBrowserState().catch(() => {})
      return decision
    }
    const tab = browserTabs.get(tabId)
    return uploadBrowserFileInteractively(view, {
      tabId,
      origin,
      url: view.webContents.getURL(),
      navigationGeneration: tab.navigationGeneration,
      backendNodeId: field.backendNodeId
    }, ticket)
  }
  if (action === 'dialog') {
    const pending = browserDialogs.get(tabId)
    const tab = browserTabs.get(tabId)
    if (!pending || !tab?.dialogControl || !view.webContents.debugger.isAttached()) throw new Error('当前页面没有可处理的 JavaScript 对话框。')
    const accept = parameters.accept === true
    const promptText = String(parameters.prompt_text || '')
    if (promptText.length > 1_000) throw new Error('对话框输入最多 1000 个字符。')
    if (isSensitiveText(promptText) || /(?:^|\D)\d{4,8}(?:\D|$)/.test(promptText)) throw Object.assign(new Error('对话框输入包含账号、邮箱、验证码或其他敏感内容，模型不能填写。'), { code: 'sensitive-value' })
    const payload = { actionText: accept ? 'accept javascript dialog' : 'dismiss javascript dialog', promptText, dialogId: pending.id, dialogType: pending.type, dialogMessage: pending.message }
    const decision = browserSecurityPolicy.modelAction({ action: 'submit', tabId, declaredOrigin: origin, field: { baseUrl: origin, tag: 'dialog', submit: true }, payload, confirmationId: parameters.confirmation_id })
    if (!decision.allowed) return { ...decision, dialog: { id: pending.id, type: pending.type, message: pending.message } }
    if (browserDialogs.get(tabId)?.id !== pending.id) throw Object.assign(new Error('对话框已变化，旧确认不能继续使用。'), { code: 'confirmation-mismatch' })
    await view.webContents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept, ...(promptText ? { promptText } : {}) })
    if (browserDialogs.get(tabId)?.id === pending.id) browserDialogs.delete(tabId)
    browserOperations.assert(ticket)
    return { handled: true, accepted: accept, type: pending.type }
  }
  if (!['click', 'type'].includes(action)) throw Object.assign(new Error('不支持的浏览器模型操作。'), { code: 'browser-action-unsupported' })
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

function boundedMemoryReference(value, field, max = 1024, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${field} 不能为空。`)
    return null
  }
  const text = String(value).trim()
  if ((!text && required) || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error(`无效的 ${field}。`)
  return text || null
}

function modelMemoryScopes(parameters = {}) {
  let values = parameters.scopes
  if (values === undefined && parameters.scope_type) values = [{ type: parameters.scope_type, ref: parameters.scope_ref }]
  if (values === undefined) values = [{ type: 'personal' }]
  if (!Array.isArray(values) || values.length < 1 || values.length > 8) throw new Error('记忆作用域必须是 1 到 8 项。')
  const seen = new Set()
  return values.flatMap(value => {
    const type = String(value?.type || value?.scopeType || '')
    if (!['personal', 'project', 'team', 'task'].includes(type)) throw new Error('无效的记忆作用域。')
    const ref = type === 'personal' ? null : boundedMemoryReference(value?.ref ?? value?.scopeRef, 'scopeRef', 1024, true)
    const key = `${type}\u0000${ref || ''}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ type, ref }]
  })
}

function projectMemoryScope(parameters = {}) {
  const scopes = modelMemoryScopes(parameters)
  const selected = scopes.find(scope => scope.type === String(parameters.scope_type || ''))
    || scopes.find(scope => scope.type === 'project')
    || scopes[0]
  return { scopeType: selected.type, scopeRef: selected.ref }
}

function publicMemoryHit(hit) {
  return {
    id: hit.id,
    title: safeBrowserText(hit.title, 300),
    content: safeBrowserText(hit.content, 2000),
    tags: hit.tags,
    matched: hit.matched,
    snippet: safeBrowserText(hit.snippet, 500),
    scopeType: hit.scopeType,
    scopeRef: safeBrowserText(hit.scopeRef, 1024),
    sourceType: hit.sourceType,
    sourceRef: safeBrowserText(hit.sourceRef, 1024),
    revision: hit.revision,
    verifiedAt: hit.verifiedAt,
    expiresAt: hit.expiresAt,
    pinned: hit.pinned
  }
}

async function modelMemoryAction(input = {}) {
  const action = String(input.action || '')
  const parameters = input.payload && typeof input.payload === 'object' ? input.payload : input
  const preferences = ensureStateStore().get().memory
  if (action === 'status') {
    const serviceStatus = preferences.enabled ? ensureMemoryService().status() : null
    return {
      enabled: preferences.enabled,
      recallAllowed: preferences.enabled && preferences.autoRecall,
      captureAllowed: preferences.enabled && preferences.autoCapture,
      count: serviceStatus?.counts.entries || 0,
      candidates: serviceStatus?.counts.candidates || 0,
      schemaVersion: serviceStatus?.schemaVersion || null
    }
  }
  if (!preferences.enabled) throw Object.assign(new Error('用户尚未开启本地记忆。'), { code: 'memory-disabled' })
  if (action === 'search' || action === 'pack') {
    if (!preferences.autoRecall) throw Object.assign(new Error('用户尚未允许模型按需召回本地记忆。'), { code: 'memory-recall-disabled' })
    const query = String(parameters.query || '').trim()
    const maxResults = action === 'pack'
      ? Math.max(1, Math.min(5, Math.floor(Number(parameters.max_results) || 5)))
      : Math.max(1, Math.min(8, Math.floor(Number(parameters.max_results) || 5)))
    const scopes = modelMemoryScopes(parameters)
    const recalled = await ensureMemoryService().recall(query, { maxResults, scopes })
    const hits = recalled.hits.map(publicMemoryHit)
    if (action === 'search') return { query: recalled.query, total: recalled.total, scopes, hits }
    const teamId = boundedMemoryReference(parameters.team_id, 'team_id', 128, true)
    const taskId = boundedMemoryReference(parameters.task_id, 'task_id', 128, true)
    return { pack: createMemoryPack(hits, { teamId, taskId }) }
  }
  if (action === 'remember' || action === 'suggest') {
    if (!preferences.autoCapture) throw Object.assign(new Error('用户尚未允许自动保存稳定偏好。'), { code: 'memory-capture-disabled' })
    const content = String(parameters.content || '').trim().slice(0, 2000)
    if (!content) throw new Error('本地记忆内容不能为空。')
    const title = String(parameters.title || content.slice(0, 80)).trim().slice(0, 160)
    const kind = ['preference', 'instruction', 'project', 'fact'].includes(parameters.kind) ? parameters.kind : 'preference'
    const tags = Array.isArray(parameters.tags)
      ? parameters.tags.map(value => String(value || '').trim().slice(0, 40)).filter(Boolean).slice(0, 8)
      : []
    const scopes = modelMemoryScopes(parameters)
    const scope = projectMemoryScope({ ...parameters, scopes })
    const status = action === 'suggest' ? 'candidate' : 'active'
    const service = ensureMemoryService()
    const probe = await service.search(content.slice(0, 200), { maxResults: 20, statuses: [status], scopes: [scope] })
    const duplicate = probe.hits.find(hit => hit.content === content && hit.title === title && hit.scopeType === scope.scopeType && hit.scopeRef === scope.scopeRef)
    if (duplicate) return { stored: false, duplicate: true, candidate: status === 'candidate', id: duplicate.id }
    const sourceSessionId = boundedMemoryReference(parameters.source_session_id, 'source_session_id', 128, false)
    const sourceType = ['manual', 'session', 'goal', 'task', 'file', 'import'].includes(parameters.source_type)
      ? parameters.source_type
      : (sourceSessionId ? 'session' : 'manual')
    const entry = await service.add({
      kind,
      title,
      content,
      tags,
      sourceSessionId,
      sourceType,
      sourceRef: boundedMemoryReference(parameters.source_ref, 'source_ref', 1024, false) || sourceSessionId,
      scopeType: scope.scopeType,
      scopeRef: scope.scopeRef,
      status,
      sensitivity: 0,
      recallPolicy: 'auto'
    })
    return { stored: true, duplicate: false, candidate: status === 'candidate', id: entry.id, scopeType: entry.scopeType, scopeRef: entry.scopeRef }
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

function ensureWindowsComputerUse() {
  if (!computerUseAppPolicy) {
    const rootDir = path.join(desktopRuntimePaths().root, 'computer-use')
    computerUseAppPolicy = new ComputerUseAppPolicy({ file: path.join(rootDir, 'app-policy.json'), rootDir })
  }
  if (!windowsComputerUse) windowsComputerUse = new WindowsComputerUse({ policy: computerUseAppPolicy })
  return windowsComputerUse
}

function computerUseCrossAppCapability() {
  const native = ensureWindowsComputerUse().capabilities().native
  const required = ['windowEnumeration', 'identity', 'screenshot', 'input']
  const missing = !native ? required : required.filter(name => native[name] !== true)
  return {
    available: missing.length === 0,
    reason: missing.length ? `缺少安全的 Windows 原生能力：${missing.join(', ')}` : '',
    native: native || null
  }
}

function computerUseDefaultAccessForUi(value) {
  if (value === 'trusted') return 'allow'
  if (value === 'never') return 'deny'
  return 'ask'
}

function computerUseDefaultAccessFromUi(value) {
  if (value === 'allow') return 'trusted'
  if (value === 'deny') return 'never'
  if (value === 'ask') return 'untrusted'
  throw new Error('default_app_access 只支持 ask、allow 或 deny。')
}

function computerUseRuleForIdentity(identity) {
  if (identity?.aumid) return { aumid: identity.aumid }
  if (identity?.publisher && identity?.product) return { publisher_name: identity.publisher, product_name: identity.product, ...(identity.exeName ? { binary_name: identity.exeName } : {}) }
  if (identity?.exePath) return { exe: identity.exePath }
  if (identity?.exeName) return { exe: identity.exeName }
  return null
}

function computerUseAppId(identity) {
  const stable = [identity?.aumid, identity?.publisher, identity?.product, identity?.exeName, identity?.exePath].map(value => String(value || '').toLowerCase()).join('\n')
  return `app-${createHash('sha256').update(stable).digest('hex').slice(0, 24)}`
}

function computerUseTargetId(window, fingerprint) {
  const stable = [computerUseSessionGeneration, window?.hwnd, window?.pid, fingerprint].join('\n')
  return `window-${createHash('sha256').update(stable).digest('hex').slice(0, 24)}`
}

function computerUseAuthorizationReason(authorization) {
  if (authorization?.nonBypassable) return `永久禁止：${authorization.code || authorization.reason}`
  if (authorization?.reason === 'allowlist') return '已持久允许'
  if (authorization?.reason === 'denylist') return '已持久拒绝'
  if (authorization?.reason === 'allowlist-invalidated') return '应用身份已变化，旧授权已失效'
  if (authorization?.status === 'allowed') return '跟随默认应用访问：允许'
  if (authorization?.status === 'denied') return '跟随默认应用访问：拒绝'
  return '尚未建立持久应用授权'
}

async function refreshComputerUseTargets() {
  const service = ensureWindowsComputerUse()
  computerUseTargets.clear()
  computerUseKnownApps.clear()
  computerUsePolicyRows.clear()
  computerUseTargets.set('harness', { id: 'harness', kind: 'harness', label: 'Harness Desktop' })
  let windows = []
  try {
    windows = await service.windows()
  } catch (error) {
    if (error?.code !== 'capability-unavailable') throw error
  }
  for (const window of windows.slice(0, 96)) {
    try {
      const bound = await service.bind(window.hwnd, window)
      const appId = computerUseAppId(bound.identity)
      const targetId = computerUseTargetId(window, bound.fingerprint)
      const label = String(bound.identity.program || bound.identity.product || bound.identity.exeName || 'Windows 应用').slice(0, 120)
      const target = { id: targetId, kind: 'window', hwnd: window.hwnd, window, identity: bound.identity, fingerprint: bound.fingerprint, authorization: bound.authorization, appId, label, lastSize: { width: window.width, height: window.height, sourceWidth: window.width, sourceHeight: window.height } }
      computerUseTargets.set(targetId, target)
      const existing = computerUseKnownApps.get(appId)
      if (!existing || bound.authorization.nonBypassable || (!existing.authorization.nonBypassable && bound.authorization.status === 'denied')) {
        computerUseKnownApps.set(appId, { id: appId, identity: bound.identity, authorization: bound.authorization, window, label })
      }
    } catch {
      // 无法安全解析身份的窗口不暴露给模型，也不能建立授权。
    }
  }
  return computerUseTargets
}

function reconcileComputerUseCurrentTarget() {
  if (!computerUseCurrentTarget || computerUseCurrentTarget.kind !== 'window') return
  const latest = computerUseTargets.get(computerUseCurrentTarget.id)
  if (!latest || latest.authorization.status !== 'allowed' || !latest.fingerprint) {
    computerUseCurrentTarget = null
    computerUseConfirmations.clear()
  } else {
    computerUseCurrentTarget = latest
  }
}

function computerUsePolicySnapshot() {
  const service = ensureWindowsComputerUse()
  const policy = service.policySnapshot()
  const apps = []
  const observedRules = new Set()
  for (const app of computerUseKnownApps.values()) {
    const matched = app.authorization?.matchedBy
    if (matched) observedRules.add(`${app.authorization.reason === 'denylist' ? 'denylist' : 'allowlist'}:${matched.kind}:${String(matched.value).toLowerCase()}`)
    apps.push({
      id: app.id,
      name: app.label,
      executable: app.identity.exeName || '',
      decision: app.authorization?.reason === 'allowlist' ? 'allow' : app.authorization?.reason === 'denylist' ? 'deny' : null,
      reason: computerUseAuthorizationReason(app.authorization),
      immutable: app.authorization?.nonBypassable === true
    })
  }
  for (const list of ['allowlist', 'denylist']) {
    for (const rule of policy[list] || []) {
      const key = `${list}:${rule.kind}:${String(rule.value).toLowerCase()}`
      if (observedRules.has(key)) continue
      const id = `rule-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`
      computerUsePolicyRows.set(id, { list, rule })
      apps.push({ id, name: rule.value, executable: rule.kind, decision: list === 'allowlist' ? 'allow' : 'deny', reason: '应用当前未打开；持久规则仍有效', immutable: false })
    }
  }
  const target = computerUseCurrentTarget
  return {
    defaultAccess: computerUseDefaultAccessForUi(policy.defaultAppAccess),
    apps,
    currentTarget: target ? { app: target.label, window: target.kind === 'window' ? String(target.window?.title || '').slice(0, 160) : 'Harness Desktop', reason: target.kind === 'window' ? computerUseAuthorizationReason(target.authorization) : '内置窗口' } : null,
    capability: computerUseCrossAppCapability()
  }
}

async function getComputerUsePolicy() {
  await refreshComputerUseTargets()
  reconcileComputerUseCurrentTarget()
  return computerUsePolicySnapshot()
}

async function setComputerUseDefaultAccess(access) {
  ensureWindowsComputerUse().setDefaultAccess(computerUseDefaultAccessFromUi(access), { by: 'user' })
  await refreshComputerUseTargets()
  reconcileComputerUseCurrentTarget()
  return computerUsePolicySnapshot()
}

async function setComputerUseAppOverride(id, decision) {
  const service = ensureWindowsComputerUse()
  const value = String(decision || '')
  if (!['allow', 'deny', 'default'].includes(value)) throw new Error('应用策略只支持 allow、deny 或 default。')
  let app = computerUseKnownApps.get(String(id || ''))
  const persisted = computerUsePolicyRows.get(String(id || ''))
  if (!app && !persisted) {
    await refreshComputerUseTargets()
    app = computerUseKnownApps.get(String(id || ''))
  }
  if (persisted && value === 'default') {
    service.revoke(persisted.rule, { list: persisted.list, by: 'user' })
  } else if (app) {
    const rule = computerUseRuleForIdentity(app.identity)
    if (!rule) throw new Error('无法建立此应用的持久身份规则。')
    if (value === 'default') {
      service.revoke(rule, { list: 'allowlist', by: 'user' })
      service.revoke(rule, { list: 'denylist', by: 'user' })
    } else if (value === 'allow') {
      if (app.authorization?.nonBypassable) throw Object.assign(new Error('系统、UAC、提权和敏感窗口永久禁止，不能授权。'), { code: 'window-denied' })
      service.revoke(rule, { list: 'denylist', by: 'user' })
      service.allow(app.identity, { by: 'user' })
    } else {
      service.revoke(rule, { list: 'allowlist', by: 'user' })
      service.deny(app.identity, { by: 'user' })
    }
  } else {
    throw new Error('该应用当前未打开；请撤销旧规则后，在应用打开时重新授权。')
  }
  await refreshComputerUseTargets()
  reconcileComputerUseCurrentTarget()
  return computerUsePolicySnapshot()
}

async function revokeComputerUseAppOverride(id) {
  const app = computerUseKnownApps.get(String(id || ''))
  const persisted = computerUsePolicyRows.get(String(id || ''))
  const service = ensureWindowsComputerUse()
  if (persisted) service.revoke(persisted.rule, { list: persisted.list, by: 'user' })
  else if (app) {
    const rule = computerUseRuleForIdentity(app.identity)
    if (rule) {
      service.revoke(rule, { list: 'allowlist', by: 'user' })
      service.revoke(rule, { list: 'denylist', by: 'user' })
    }
  }
  await refreshComputerUseTargets()
  reconcileComputerUseCurrentTarget()
  return computerUsePolicySnapshot()
}

async function clearComputerUseScreenshots() {
  return ensureComputerUseScreenshotStore().clear()
}

async function setComputerUseEnabled(enabled) {
  const next = enabled === true
  if (next && computerUseScreenLocked) throw Object.assign(new Error('计算机锁定或挂起期间不能开启 Computer Use。'), { code: 'computer-use-locked' })
  if (next === computerUseEnabled) return computerUseState()
  computerUseSessionGeneration += 1
  if (next) await clearComputerUseScreenshots()
  computerUseEnabled = next
  computerUseCurrentTarget = null
  computerUseHarnessSurface = null
  computerUseTargets.clear()
  if (!computerUseEnabled) {
    computerUseConfirmations.clear()
    await clearComputerUseScreenshots()
  }
  return computerUseState()
}

function computerUseState() {
  return {
    available: true,
    enabled: computerUseEnabled,
    generation: computerUseSessionGeneration,
    currentTarget: computerUseCurrentTarget ? { id: computerUseCurrentTarget.id, app: computerUseCurrentTarget.label, kind: computerUseCurrentTarget.kind } : null,
    crossApp: computerUseCrossAppCapability(),
    screenshotPolicy: { sessionOnly: true, maxFiles: COMPUTER_USE_SCREENSHOT_MAX_FILES, maxBytes: COMPUTER_USE_SCREENSHOT_MAX_BYTES, maxAgeMs: COMPUTER_USE_SCREENSHOT_MAX_AGE_MS },
    pending: computerUseConfirmations.snapshot()
  }
}

function computerUseSurface(target = computerUseCurrentTarget) {
  if (target?.kind === 'window') {
    return {
      generation: computerUseSessionGeneration,
      width: Math.max(1, Number(target.lastSize?.width) || Number(target.window?.width) || 1),
      height: Math.max(1, Number(target.lastSize?.height) || Number(target.window?.height) || 1),
      url: `app://${target.id}/${target.fingerprint || 'unresolved'}`,
      label: target.label
    }
  }
  if (!mainWindow || mainWindow.isDestroyed()) return null
  const [sourceWidth, sourceHeight] = mainWindow.getContentSize()
  const width = computerUseHarnessSurface?.width || sourceWidth
  const height = computerUseHarnessSurface?.height || sourceHeight
  const urls = [mainWindow.webContents.getURL()]
  if (runtimeGuest && !runtimeGuest.isDestroyed()) urls.push(runtimeGuest.getURL())
  const browserContents = browserSidebarVisible ? liveBrowserContents() : null
  if (browserContents) urls.push(browserContents.getURL())
  return { generation: computerUseSessionGeneration, width, height, url: urls.filter(Boolean).join('\n'), label: 'Harness Desktop' }
}

function requireComputerConfirmation(action, parameters, target = computerUseCurrentTarget) {
  return computerUseConfirmations.authorize(action, { ...parameters, surface: computerUseSurface(target) })
}

async function revalidateComputerUseTarget(target) {
  if (!target || target.kind !== 'window') return target
  const service = ensureWindowsComputerUse()
  const windows = await service.windows()
  const window = windows.find(item => Number(item.hwnd) === Number(target.hwnd) && Number(item.pid) === Number(target.window?.pid))
  if (!window) {
    computerUseCurrentTarget = null
    computerUseConfirmations.clear()
    throw Object.assign(new Error('目标窗口已关闭或身份已变化，请重新选择。'), { code: 'target-stale' })
  }
  const bound = await service.bind(window.hwnd, window)
  if (!bound.fingerprint || bound.fingerprint !== target.fingerprint || bound.authorization.status !== 'allowed') {
    computerUseCurrentTarget = null
    computerUseConfirmations.clear()
    throw Object.assign(new Error('目标应用身份或授权已变化，请重新选择。'), { code: 'target-stale' })
  }
  Object.assign(target, { window, identity: bound.identity, authorization: bound.authorization })
  if (!target.lastSize) target.lastSize = { width: window.width, height: window.height, sourceWidth: window.width, sourceHeight: window.height }
  return target
}

async function captureHarnessComputerUseScreenshot() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) throw new Error('Harness Desktop 主窗口当前不可见。')
  const image = await mainWindow.capturePage()
  const size = image.getSize()
  const scaled = size.width > 1280 ? image.resize({ width: 1280, quality: 'good' }) : image
  const displayed = scaled.getSize()
  computerUseHarnessSurface = { width: displayed.width, height: displayed.height, sourceWidth: size.width, sourceHeight: size.height }
  const file = await ensureComputerUseScreenshotStore().save(scaled.toPNG())
  return { file, width: displayed.width, height: displayed.height, sourceWidth: size.width, sourceHeight: size.height, scope: 'Harness Desktop window', target_id: 'harness' }
}

async function captureExternalComputerUseScreenshot(target) {
  const shot = await ensureWindowsComputerUse().screenshot(target.hwnd, target.identity, target.window)
  if (shot.blank) throw Object.assign(new Error('目标窗口返回空白/受保护画面，拒绝伪造截图。'), { code: 'screenshot-protected' })
  target.lastCaptureHash = createHash('sha256').update(shot.bgra).digest('hex')
  const bitmap = Buffer.from(shot.bgra)
  for (let index = 3; index < bitmap.length; index += 4) bitmap[index] = 255
  const image = nativeImage.createFromBitmap(bitmap, { width: shot.width, height: shot.height, scaleFactor: 1 })
  if (image.isEmpty()) throw Object.assign(new Error('目标窗口截图无法安全解码。'), { code: 'screenshot-failed' })
  const scaled = shot.width > 1280 ? image.resize({ width: 1280, quality: 'good' }) : image
  const displayed = scaled.getSize()
  target.lastSize = { width: displayed.width, height: displayed.height, sourceWidth: shot.width, sourceHeight: shot.height }
  const file = await ensureComputerUseScreenshotStore().save(scaled.toPNG())
  return { file, width: displayed.width, height: displayed.height, sourceWidth: shot.width, sourceHeight: shot.height, scope: target.label, target_id: target.id }
}

async function verifyExternalComputerUseSurface(target) {
  if (!target.lastCaptureHash) throw Object.assign(new Error('跨应用输入前必须先截取并检查目标窗口。'), { code: 'screenshot-required' })
  const shot = await ensureWindowsComputerUse().screenshot(target.hwnd, target.identity, target.window)
  if (shot.blank) throw Object.assign(new Error('目标窗口返回空白/受保护画面，已取消输入。'), { code: 'screenshot-protected' })
  const currentHash = createHash('sha256').update(shot.bgra).digest('hex')
  if (currentHash !== target.lastCaptureHash) {
    target.lastCaptureHash = null
    computerUseConfirmations.clear()
    throw Object.assign(new Error('目标窗口在确认期间已变化，请重新截图并确认。'), { code: 'target-surface-changed' })
  }
}

async function modelComputerUseAction(input = {}) {
  const action = String(input.action || '')
  const parameters = input.payload && typeof input.payload === 'object' ? input.payload : input
  if (action === 'status') return computerUseState()
  if (action === 'stop') return setComputerUseEnabled(false)
  if (!computerUseEnabled || computerUseScreenLocked) throw Object.assign(new Error('用户尚未开启本次 Computer Use，或计算机已锁定。'), { code: 'computer-use-disabled' })
  if (action === 'targets') {
    await refreshComputerUseTargets()
    const targets = [...computerUseTargets.values()].filter(target => target.kind === 'harness' || (target.authorization?.status === 'allowed' && target.fingerprint)).map(target => ({ target_id: target.id, app: target.label, kind: target.kind, width: target.window?.width, height: target.window?.height }))
    return { targets, crossApp: computerUseCrossAppCapability() }
  }
  if (action === 'select') {
    const requested = String(parameters.target_id || '')
    if (!requested) throw new Error('请选择 targets 返回的 target_id。')
    if (!computerUseTargets.size) await refreshComputerUseTargets()
    const target = computerUseTargets.get(requested)
    if (!target) throw Object.assign(new Error('目标不存在、已过期或未被持久策略允许。'), { code: 'target-unavailable' })
    if (target.kind === 'window') {
      await revalidateComputerUseTarget(target)
      if (target.authorization.status !== 'allowed') throw Object.assign(new Error('该应用未被持久策略允许。'), { code: 'window-untrusted' })
    }
    computerUseCurrentTarget = target
    computerUseConfirmations.clear()
    return { selected: true, target: { target_id: target.id, app: target.label, kind: target.kind } }
  }
  const target = computerUseCurrentTarget || computerUseTargets.get('harness') || { id: 'harness', kind: 'harness', label: 'Harness Desktop' }
  if (target.kind === 'window') await revalidateComputerUseTarget(target)
  if (action === 'screenshot') {
    const sessionGeneration = computerUseSessionGeneration
    const result = target.kind === 'window' ? await captureExternalComputerUseScreenshot(target) : await captureHarnessComputerUseScreenshot()
    if (!computerUseEnabled || sessionGeneration !== computerUseSessionGeneration) {
      await clearComputerUseScreenshots()
      throw Object.assign(new Error('Computer Use 会话已停止。'), { code: 'computer-use-disabled' })
    }
    return result
  }
  if (!['click', 'type', 'scroll'].includes(action)) throw new Error('不支持的 Computer Use 操作。')
  if (action === 'type' && redactSensitiveText(String(parameters.text || '')).types.length) throw Object.assign(new Error('Computer Use 永久禁止输入密码、令牌、验证码、银行卡或其他秘密。'), { code: 'sensitive-input-blocked' })
  if (target.kind === 'window' && !target.lastCaptureHash) throw Object.assign(new Error('跨应用输入前必须先截取并检查目标窗口。'), { code: 'screenshot-required' })
  const confirmation = requireComputerConfirmation(action, parameters, target)
  if (confirmation) return confirmation
  if (target.kind === 'window') await verifyExternalComputerUseSurface(target)
  const surface = computerUseSurface(target)
  const x = Math.round(Number(parameters.x)); const y = Math.round(Number(parameters.y))
  const targetScale = target.kind === 'window' ? target.lastSize : computerUseHarnessSurface
  const sourceWidth = Math.max(1, Number(targetScale?.sourceWidth) || surface.width)
  const sourceHeight = Math.max(1, Number(targetScale?.sourceHeight) || surface.height)
  const minimumY = target.kind === 'harness' ? Math.ceil(36 * surface.height / sourceHeight) : 0
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < minimumY || x >= surface.width || y >= surface.height) throw new Error('操作坐标超出当前目标的可控区域。')
  const sourceX = Math.max(0, Math.min(sourceWidth - 1, Math.round(x * sourceWidth / surface.width)))
  const sourceY = Math.max(0, Math.min(sourceHeight - 1, Math.round(y * sourceHeight / surface.height)))
  if (target.kind === 'window') {
    await revalidateComputerUseTarget(target)
    try {
      if (action === 'click') await ensureWindowsComputerUse().click(target.hwnd, { x: sourceX, y: sourceY }, target.identity, target.window)
      else if (action === 'scroll') await ensureWindowsComputerUse().scroll(target.hwnd, { x: sourceX, y: sourceY, deltaY: Math.max(-800, Math.min(800, Number(parameters.delta_y) || 0)) }, target.identity, target.window)
      else {
        await ensureWindowsComputerUse().click(target.hwnd, { x: sourceX, y: sourceY }, target.identity, target.window)
        await ensureWindowsComputerUse().type(target.hwnd, { text: String(parameters.text || '').slice(0, 500) }, target.identity, target.window)
      }
    } finally {
      target.lastCaptureHash = null
    }
  } else {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) throw new Error('Harness Desktop 主窗口当前不可见。')
    if (action === 'click') {
      mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: sourceX, y: sourceY, button: 'left', clickCount: 1 })
      mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: sourceX, y: sourceY, button: 'left', clickCount: 1 })
    } else if (action === 'scroll') {
      mainWindow.webContents.sendInputEvent({ type: 'mouseWheel', x: sourceX, y: sourceY, deltaY: Math.max(-800, Math.min(800, Number(parameters.delta_y) || 0)), deltaX: 0 })
    } else {
      mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: sourceX, y: sourceY, button: 'left', clickCount: 1 })
      mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: sourceX, y: sourceY, button: 'left', clickCount: 1 })
      for (const character of String(parameters.text || '').slice(0, 2000)) mainWindow.webContents.sendInputEvent({ type: 'char', keyCode: character })
    }
  }
  return { completed: true, action, x, y, target_id: target.id, app: target.label }
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

function desktopShellOnly(handler) {
  return (event, ...args) => {
    assertDesktopShellSender(event)
    return handler(...args)
  }
}

function mobileSyncSecretAdapter() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return {
      protect: plaintext => safeStorage.encryptString(String(plaintext)),
      unprotect: ciphertext => safeStorage.decryptString(Buffer.from(ciphertext))
    }
  } catch {
    return null
  }
}

function ensureMobileSyncService() {
  if (mobileSyncService) return mobileSyncService
  const userData = app.getPath('userData')
  const componentRoot = path.join(userData, 'network-components')
  const stateDir = path.join(userData, 'mobile-sync-network')
  mkdirSync(componentRoot, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  mobileSyncStore = new MobileSyncStore(path.join(userData, 'mobile-sync.json'), mobileSyncSecretAdapter())
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
const MAX_THEME_VIDEO_BYTES = 2 * 1024 * 1024 * 1024
const wallpaperMutationQueue = createWallpaperMutationQueue()

function themeAssetMime(file) {
  return wallpaperMime(file)
}

async function readThemeImageDataUrl(file) {
  if (wallpaperKind(file) !== 'image') throw new Error('仅图片壁纸可转换为 data URL。')
  const info = await stat(file)
  if (!info.isFile() || info.size > MAX_THEME_BACKGROUND_BYTES) throw new Error('图片壁纸无效或超过 50 MB。')
  const data = await readFile(file)
  return `data:${themeAssetMime(file)};base64,${data.toString('base64')}`
}

function currentWallpaperVideoFile() {
  const backgroundFile = ensureStateStore().get().appearance.customTheme?.backgroundFile
  if (!backgroundFile || wallpaperKind(backgroundFile) !== 'video') return null
  return wallpaperAssetPath(backgroundFile)
}

function currentWallpaperImageFile() {
  const backgroundFile = ensureStateStore().get().appearance.customTheme?.backgroundFile
  if (!backgroundFile || wallpaperKind(backgroundFile) !== 'image') return null
  return wallpaperAssetPath(backgroundFile)
}

function wallpaperAssetPath(fileName) {
  return safeManagedWallpaperPath(path.join(app.getPath('userData'), 'themes'), fileName)
}

function wallpaperLibraryItem(id, appearance = ensureStateStore().get().appearance) {
  const normalizedId = String(id || '').toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(normalizedId)) return null
  return appearance.wallpaperLibrary?.items?.find(item => item.id === normalizedId) || null
}

async function assertManagedWallpaperLibraryCapacity(library, replacingId, incomingBytes, temporaryFile = null) {
  const replacing = library?.items?.find(item => item.id === replacingId)
  const storedBytes = await wallpaperStorageUsageBytes(path.join(app.getPath('userData'), 'themes'), {
    excludeFileNames: [replacing?.cachedFile, temporaryFile].filter(Boolean)
  })
  return assertWallpaperLibraryCapacity([{ id: 'managed-storage', bytes: storedBytes }], {
    incomingBytes,
    sizeOf: item => item.bytes
  })
}

async function wallpaperLibraryPayload(appearance) {
  const library = appearance.wallpaperLibrary || { activeId: null, items: [] }
  const items = await Promise.all((library.items || []).map(async item => {
    const file = wallpaperAssetPath(item.cachedFile)
    const info = file ? await stat(file).catch(() => null) : null
    const maximum = item.kind === 'video' ? MAX_THEME_VIDEO_BYTES : MAX_THEME_BACKGROUND_BYTES
    const available = Boolean(info?.isFile() && info.size <= maximum && wallpaperKind(file) === item.kind)
    return {
      ...item,
      available,
      previewUrl: available && item.kind === 'image'
        ? `${WALLPAPER_SCHEME}://library/${encodeURIComponent(item.id)}/media?v=${Math.round(info.mtimeMs)}-${info.size}`
        : null
    }
  }))
  return { activeId: library.activeId || null, items }
}

async function registerWallpaperProtocol() {
  const handler = async request => {
    const target = new URL(request.url)
    let file = null
    if (target.hostname === 'current' && target.pathname === '/video') {
      file = currentWallpaperVideoFile()
    } else if (target.hostname === 'current' && target.pathname === '/image') {
      file = currentWallpaperImageFile()
    } else if (target.hostname === 'library') {
      const match = /^\/([a-z0-9][a-z0-9-]{0,79})\/media$/i.exec(target.pathname)
      const item = match ? wallpaperLibraryItem(match[1]) : null
      file = item ? wallpaperAssetPath(item.cachedFile) : null
    }
    if (!file || !existsSync(file)) return new Response('Not found', { status: 404 })
    const info = await stat(file).catch(() => null)
    const maximum = wallpaperKind(file) === 'video' ? MAX_THEME_VIDEO_BYTES : MAX_THEME_BACKGROUND_BYTES
    if (!info?.isFile() || info.size > maximum) return new Response('Not found', { status: 404 })
    return wallpaperKind(file) === 'video'
      ? createWallpaperVideoResponse(file, request)
      : createWallpaperMediaResponse(file, request)
  }
  for (const targetSession of [session.defaultSession, session.fromPartition('persist:harness')]) {
    if (!targetSession.protocol.isProtocolHandled(WALLPAPER_SCHEME)) await targetSession.protocol.handle(WALLPAPER_SCHEME, handler)
  }
}

function syncTitleBarOverlay(appearance = ensureStateStore().get().appearance) {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return
  const theme = THEME_CATALOG.find(entry => entry.id === appearance.themeId)
  const requestedMode = appearance.themeId === 'custom' ? appearance.customTheme?.mode : theme?.mode
  const dark = requestedMode === 'dark' || (requestedMode === 'adaptive' && nativeTheme.shouldUseDarkColors)
  mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f4f7ff' : '#202124', height: 36 })
}

async function readAppearancePayload() {
  let appearance = ensureStateStore().get().appearance
  if (STORE_BUILD && appearance.themeId === 'maid-atelier') {
    appearance = ensureStateStore().updateAppearance({ themeId: 'porcelain-mist' }).appearance
  }
  syncTitleBarOverlay(appearance)
  const wallpaperLibrary = await wallpaperLibraryPayload(appearance)
  const backgroundFile = appearance.customTheme?.backgroundFile
  if (!backgroundFile) return { ...appearance, wallpaperLibrary, customBackgroundDataUrl: null, customBackgroundVideoDataUrl: null, customBackgroundKind: null }
  const file = wallpaperAssetPath(backgroundFile)
  if (!file) return { ...appearance, wallpaperLibrary, customBackgroundDataUrl: null, customBackgroundVideoDataUrl: null, customBackgroundKind: null }
  const kind = wallpaperKind(file)
  if (kind === 'video') {
    const info = await stat(file).catch(() => null)
    const valid = info?.isFile() && info.size <= MAX_THEME_VIDEO_BYTES
    return {
      ...appearance,
      wallpaperLibrary,
      customBackgroundDataUrl: null,
      customBackgroundVideoDataUrl: valid ? `${WALLPAPER_SCHEME}://current/video?v=${Math.round(info.mtimeMs)}-${info.size}` : null,
      customBackgroundKind: valid ? 'video' : null
    }
  }
  const info = kind === 'image' ? await stat(file).catch(() => null) : null
  const dataUrl = info?.isFile() && info.size <= MAX_THEME_BACKGROUND_BYTES
    ? `${WALLPAPER_SCHEME}://current/image?v=${Math.round(info.mtimeMs)}-${info.size}`
    : null
  return { ...appearance, wallpaperLibrary, customBackgroundDataUrl: dataUrl, customBackgroundVideoDataUrl: null, customBackgroundKind: dataUrl ? 'image' : null }
}

// Signature of a bound Wallpaper Engine project: project.json and its resolved
// media file, so the one-click sync can detect content changes cheaply.
async function boundWallpaperEngineSignature(projectFile, mediaFile) {
  const [projectInfo, mediaInfo] = await Promise.all([stat(projectFile), stat(mediaFile)]).catch(() => [null, null])
  if (!projectInfo?.isFile() || !mediaInfo?.isFile()) return ''
  return `${Math.round(projectInfo.mtimeMs)}:${projectInfo.size}:${Math.round(mediaInfo.mtimeMs)}:${mediaInfo.size}`
}

// Refresh the active Wallpaper Engine source only after the user explicitly
// requests synchronization. A removed/unreadable source marks the card while
// preserving the managed copy and never opens dialogs.
async function syncBoundWallpaperEngineUnlocked() {
  const appearance = ensureStateStore().get().appearance
  const custom = appearance.customTheme
  const activeId = appearance.wallpaperLibrary?.activeId
  const active = wallpaperLibraryItem(activeId, appearance)
  const projectDir = active?.projectDir || custom?.wallpaperEngineProject
  if (!projectDir) return { changed: false, synchronized: false, reason: 'unbound' }
  const projectFile = path.join(projectDir, 'project.json')
  let resolution
  try {
    resolution = await resolveWallpaperEngineInput(projectFile)
  } catch {
    if (active) {
      const items = appearance.wallpaperLibrary.items.map(item => item.id === active.id ? { ...item, sourceStatus: 'unavailable' } : item)
      ensureStateStore().updateAppearance({ wallpaperLibrary: { ...appearance.wallpaperLibrary, items } })
    }
    return { changed: false, synchronized: false, reason: 'source-unavailable' }
  }
  const signature = await boundWallpaperEngineSignature(projectFile, resolution.file)
  if (!signature) {
    if (active) {
      const items = appearance.wallpaperLibrary.items.map(item => item.id === active.id ? { ...item, sourceStatus: 'unavailable' } : item)
      ensureStateStore().updateAppearance({ wallpaperLibrary: { ...appearance.wallpaperLibrary, items } })
    }
    return { changed: false, synchronized: false, reason: 'unreadable' }
  }
  const cachedFile = active ? wallpaperAssetPath(active.cachedFile) : null
  const cachedInfo = cachedFile ? await stat(cachedFile).catch(() => null) : null
  const cachedMaximum = active?.kind === 'video' ? MAX_THEME_VIDEO_BYTES : MAX_THEME_BACKGROUND_BYTES
  const cachedAvailable = Boolean(cachedInfo?.isFile() && cachedInfo.size <= cachedMaximum && wallpaperKind(cachedFile) === active?.kind)
  if (signature === (active?.signature || custom?.wallpaperEngineSignature) && cachedAvailable) {
    if (active?.sourceStatus !== 'ready') {
      const items = appearance.wallpaperLibrary.items.map(item => item.id === active.id ? { ...item, sourceStatus: 'ready' } : item)
      ensureStateStore().updateAppearance({ wallpaperLibrary: { ...appearance.wallpaperLibrary, items } })
    }
    return { changed: false, synchronized: true, reason: 'current' }
  }
  let fileName = null
  try {
    fileName = await installCustomThemeBackground(resolution.file, {
      projectRoot: resolution.projectRoot,
      beforeCopy: (info, context) => assertManagedWallpaperLibraryCapacity(appearance.wallpaperLibrary, active?.id, info.size, context?.temporaryFile)
    })
    const now = new Date().toISOString()
    const items = active
      ? appearance.wallpaperLibrary.items.map(item => item.id === active.id ? { ...item, cachedFile: fileName, kind: resolution.kind, signature, sourceStatus: 'ready', lastSyncedAt: now } : item)
      : appearance.wallpaperLibrary.items
    ensureStateStore().updateAppearance({
      themeId: 'custom',
      customTheme: { backgroundFile: fileName, wallpaperEngineSignature: signature },
      wallpaperLibrary: { ...appearance.wallpaperLibrary, activeId: active?.id || appearance.wallpaperLibrary.activeId, items }
    })
  } catch (error) {
    if (fileName) await removeWallpaperAsset(fileName).catch(() => {})
    throw error
  }
  if (active?.cachedFile && active.cachedFile !== fileName) scheduleWallpaperAssetRemoval(active.cachedFile)
  return { changed: true, synchronized: true, reason: 'resynced' }
}

async function syncBoundWallpaperEngine() {
  return wallpaperMutationQueue.run(syncBoundWallpaperEngineUnlocked)
}

async function appearancePayload() {
  // Startup and ordinary card application always use the managed local copy.
  // The source project is consulted only by the explicit sync action.
  return readAppearancePayload()
}

async function bundledThemeAssets() {
  if (STORE_BUILD) return {}
  const root = path.join(__dirname, '..', 'renderer', 'themes')
  const entries = await Promise.all(BUNDLED_THEME_ASSETS.map(async relative => {
    const url = await readThemeImageDataUrl(path.join(root, relative))
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
  const customBackgroundFile = backgroundFile && wallpaperAssetPath(backgroundFile)
  const catalog = THEME_CATALOG
    .filter(theme => !STORE_BUILD || !theme.nonCommercial)
    .map(theme => ({
      ...theme,
      assets: Object.fromEntries(Object.entries(theme.assets || {}).map(([name, relative]) => [name, mobileThemeAssetUrl(relative.replace(/^\.\/themes\//, ''))]))
    }))
  return {
    state: {
      ...state,
      customBackgroundDataUrl: customBackgroundFile && wallpaperKind(customBackgroundFile) === 'image' && existsSync(customBackgroundFile)
        ? mobileThemeAssetUrl('custom-background')
        : null,
      customBackgroundVideoDataUrl: null,
      customBackgroundKind: customBackgroundFile && wallpaperKind(customBackgroundFile) === 'image' ? 'image' : null
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
    const file = wallpaperAssetPath(backgroundFile)
    if (!file || !existsSync(file)) return null
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

// Copy every imported wallpaper into a unique managed file. Applying a card
// later never needs Wallpaper Engine, Steam, or the original source file.
async function installCustomThemeBackground(source, options = {}) {
  if (options.projectRoot) source = (await revalidateProjectMediaPath(options.projectRoot, source)).file
  const kind = wallpaperKind(source)
  if (!kind) throw new Error('仅支持 PNG、JPG、WebP、GIF、APNG、MP4 和 WebM 壁纸。')
  const info = await stat(source)
  let maximum = kind === 'video' ? MAX_THEME_VIDEO_BYTES : MAX_THEME_BACKGROUND_BYTES
  if (!info.isFile() || info.size > maximum) throw new Error(kind === 'video' ? '视频壁纸必须小于 2 GB。' : '图片壁纸必须小于 50 MB。')
  if (typeof options.beforeCopy === 'function') await options.beforeCopy(info)
  if (options.projectRoot) source = (await revalidateProjectMediaPath(options.projectRoot, source)).file
  const finalKind = wallpaperKind(source)
  const finalInfo = await stat(source)
  maximum = finalKind === 'video' ? MAX_THEME_VIDEO_BYTES : MAX_THEME_BACKGROUND_BYTES
  if (!finalKind || finalKind !== kind || !finalInfo.isFile() || finalInfo.size > maximum) {
    throw new Error('壁纸源文件在导入期间已发生变化，请重试。')
  }
  if (finalInfo.size !== info.size && typeof options.beforeCopy === 'function') await options.beforeCopy(finalInfo)
  const extension = path.extname(source).toLowerCase()
  const directory = path.join(app.getPath('userData'), 'themes')
  const fileName = `wallpaper-${randomUUID().toLowerCase()}${extension}`
  const installed = await installManagedWallpaperCopy({
    source,
    directory,
    fileName,
    expectedKind: kind,
    maximumBytes: maximum,
    afterCopyValidate: options.projectRoot
      ? async () => {
          const validated = await revalidateProjectMediaPath(options.projectRoot, source)
          if (path.relative(source, validated.file) !== '') throw new Error('壁纸源文件在复制期间已发生变化，请重试。')
        }
      : null,
    beforeFinalize: typeof options.beforeCopy === 'function' ? options.beforeCopy : null
  })
  return installed.fileName
}

async function removeWallpaperAsset(fileName) {
  const file = wallpaperAssetPath(fileName)
  if (!file) return
  await unlink(file).catch(error => {
    if (error?.code !== 'ENOENT') throw error
  })
}

function scheduleWallpaperAssetRemoval(fileName, attempt = 0) {
  const delays = [800, 2500, 8000]
  const timer = setTimeout(() => {
    removeWallpaperAsset(fileName).catch(() => {
      if (attempt + 1 < delays.length) scheduleWallpaperAssetRemoval(fileName, attempt + 1)
    })
  }, delays[attempt])
  timer.unref?.()
}

async function cleanupOrphanedWallpaperAssetsUnlocked() {
  const appearance = ensureStateStore().get().appearance
  const referenced = [
    appearance.customTheme?.backgroundFile,
    ...(appearance.wallpaperLibrary?.items || []).map(item => item.cachedFile)
  ].filter(Boolean)
  const result = await cleanupOrphanedWallpaperStorage(path.join(app.getPath('userData'), 'themes'), referenced)
  for (const fileName of result.failed) {
    if (isManagedWallpaperFileName(fileName)) scheduleWallpaperAssetRemoval(fileName)
  }
  return result
}

async function cleanupOrphanedWallpaperAssets() {
  return wallpaperMutationQueue.run(cleanupOrphanedWallpaperAssetsUnlocked)
}

async function importWallpaperRecordUnlocked({ source, title, projectDir = null, projectRoot = null, signature = null }) {
  const appearance = ensureStateStore().get().appearance
  const library = appearance.wallpaperLibrary || { activeId: null, items: [] }
  const existing = projectDir
    ? library.items.find(item => item.source === 'wallpaper-engine' && String(item.projectDir || '').toLowerCase() === String(projectDir).toLowerCase())
    : null
  if (!existing && library.items.length >= MAX_WALLPAPER_LIBRARY_ITEMS) {
    throw new Error(`壁纸库最多保存 ${MAX_WALLPAPER_LIBRARY_ITEMS} 项，请先移除不再使用的壁纸。`)
  }
  const fileName = await installCustomThemeBackground(source, {
    projectRoot,
    beforeCopy: (info, context) => assertManagedWallpaperLibraryCapacity(library, existing?.id, info.size, context?.temporaryFile)
  })
  const id = existing?.id || randomUUID().toLowerCase()
  const now = new Date().toISOString()
  const item = {
    id,
    title: String(title || path.basename(source, path.extname(source))).slice(0, 160),
    kind: wallpaperKind(fileName),
    source: projectDir ? 'wallpaper-engine' : 'local',
    cachedFile: fileName,
    projectDir,
    signature: projectDir ? signature : null,
    sourceStatus: projectDir ? 'ready' : null,
    lastSyncedAt: projectDir ? now : null,
    addedAt: existing?.addedAt || now
  }
  const items = existing
    ? library.items.map(entry => entry.id === existing.id ? item : entry)
    : [item, ...library.items]
  try {
    ensureStateStore().updateAppearance({
      themeId: 'custom',
      customTheme: {
        backgroundFile: fileName,
        wallpaperEngineProject: projectDir,
        wallpaperEngineSignature: projectDir ? signature : null
      },
      wallpaperLibrary: { activeId: id, items }
    })
  } catch (error) {
    await removeWallpaperAsset(fileName).catch(() => {})
    throw error
  }
  if (existing?.cachedFile && existing.cachedFile !== fileName) scheduleWallpaperAssetRemoval(existing.cachedFile)
  return appearancePayload()
}

async function importWallpaperRecord(options) {
  return wallpaperMutationQueue.run(() => importWallpaperRecordUnlocked(options))
}

// Steam install root from the HKCU Valve\Steam registry value, when present.
function readWallpaperEngineRegistryPath() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve('')
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) return resolve('')
      const match = /SteamPath\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/i.exec(String(stdout || ''))
      resolve(match ? match[1].trim().replace(/"$/, '') : '')
    })
  })
}

// One-click library scan: registry Steam path first, common install roots as
// fallback, then resolve every image/video project found.
async function wallpaperEngineLibraryScan() {
  const registryRoot = await readWallpaperEngineRegistryPath().catch(() => '')
  const steamRoots = [registryRoot, ...defaultSteamRootCandidates(process.env, process.platform)]
  return scanWallpaperEngineLibrary({
    steamRoots,
    readdir: directory => readdir(directory, { withFileTypes: true }),
    readFile: (file, encoding) => readFile(file, encoding),
    stat: file => stat(file),
    resolveProject: resolveWallpaperEngineProject
  })
}

async function chooseCustomThemeBackground(options = {}) {
  const wallpaperEngine = options.wallpaperEngine === true
  let projectFile = null
  if (wallpaperEngine && options.source) {
    const sourceValue = String(options.source).trim()
    if (!sourceValue) return appearancePayload()
    if (/\.json$/i.test(sourceValue)) projectFile = path.resolve(sourceValue)
    else projectFile = path.join(path.resolve(sourceValue), 'project.json')
    const resolution = await resolveWallpaperEngineInput(sourceValue)
    const signature = await boundWallpaperEngineSignature(projectFile, resolution.file)
    return importWallpaperRecord({
      source: resolution.file,
      title: resolution.title,
      projectDir: path.dirname(projectFile),
      projectRoot: resolution.projectRoot,
      signature: signature || null
    })
  }
  let chooseDirectory = false
  if (wallpaperEngine) {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '导入 Wallpaper Engine 项目',
      message: '请选择导入方式',
      detail: '支持包含 project.json 的项目目录，也可直接选择 project.json。仅导入 image/video 类型。',
      buttons: ['选择项目目录', '选择 project.json', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (choice.response === 2) return appearancePayload()
    chooseDirectory = choice.response === 0
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: wallpaperEngine ? (chooseDirectory ? '选择 Wallpaper Engine 项目目录' : '选择 Wallpaper Engine 项目的 project.json') : '选择自定义图片或视频壁纸',
    properties: [chooseDirectory ? 'openDirectory' : 'openFile'],
    filters: wallpaperEngine && !chooseDirectory
      ? [{ name: 'Wallpaper Engine 项目', extensions: ['json'] }]
      : wallpaperEngine ? [] : [{ name: '图片或视频壁纸', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'apng', 'mp4', 'webm'] }]
  })
  if (result.canceled || !result.filePaths[0]) return appearancePayload()

  let source = path.resolve(result.filePaths[0])
  let title = path.basename(source, path.extname(source))
  let projectRoot = null
  if (wallpaperEngine) {
    if (/\.json$/i.test(source)) projectFile = source
    else projectFile = path.join(source, 'project.json')
    const resolution = await resolveWallpaperEngineInput(source)
    source = resolution.file
    title = resolution.title
    projectRoot = resolution.projectRoot
  }
  const projectDir = wallpaperEngine && projectFile ? path.dirname(projectFile) : null
  const signature = projectDir ? (await boundWallpaperEngineSignature(projectFile, source)) || null : null
  return importWallpaperRecord({ source, title, projectDir, projectRoot, signature })
}

// Apply a picked Wallpaper Engine project (directory or project.json) in one
// step and bind it so later launches or the sync button refresh it.
async function applyWallpaperEngineProject(value) {
  return chooseCustomThemeBackground({ wallpaperEngine: true, source: value })
}

async function applyWallpaperLibraryItemUnlocked(value) {
  const id = String(value || '').toLowerCase()
  const appearance = ensureStateStore().get().appearance
  const item = wallpaperLibraryItem(id, appearance)
  if (!item) throw new Error('壁纸记录不存在或已被移除。')
  const file = wallpaperAssetPath(item.cachedFile)
  const info = file ? await stat(file).catch(() => null) : null
  const maximum = item.kind === 'video' ? MAX_THEME_VIDEO_BYTES : MAX_THEME_BACKGROUND_BYTES
  if (!info?.isFile() || info.size > maximum || wallpaperKind(file) !== item.kind) {
    throw new Error('壁纸的本地副本已失效；请移除该记录后重新导入。')
  }
  ensureStateStore().updateAppearance({
    themeId: 'custom',
    customTheme: {
      backgroundFile: item.cachedFile,
      wallpaperEngineProject: item.projectDir,
      wallpaperEngineSignature: item.signature
    },
    wallpaperLibrary: { ...appearance.wallpaperLibrary, activeId: item.id }
  })
  return appearancePayload()
}

async function applyWallpaperLibraryItem(value) {
  return wallpaperMutationQueue.run(() => applyWallpaperLibraryItemUnlocked(value))
}

async function deleteWallpaperLibraryItemUnlocked(value) {
  const id = String(value || '').toLowerCase()
  const appearance = ensureStateStore().get().appearance
  const item = wallpaperLibraryItem(id, appearance)
  if (!item) return appearancePayload()
  const active = appearance.wallpaperLibrary?.activeId === item.id
  ensureStateStore().updateAppearance({
    customTheme: active ? { backgroundFile: null, wallpaperEngineProject: null, wallpaperEngineSignature: null } : {},
    wallpaperLibrary: {
      activeId: active ? null : appearance.wallpaperLibrary.activeId,
      items: appearance.wallpaperLibrary.items.filter(entry => entry.id !== item.id)
    }
  })
  const payload = await appearancePayload()
  scheduleWallpaperAssetRemoval(item.cachedFile)
  return payload
}

async function deleteWallpaperLibraryItem(value) {
  return wallpaperMutationQueue.run(() => deleteWallpaperLibraryItemUnlocked(value))
}

async function removeCustomThemeBackgroundUnlocked() {
  const appearance = ensureStateStore().get().appearance
  ensureStateStore().updateAppearance({
    customTheme: { backgroundFile: null, wallpaperEngineProject: null, wallpaperEngineSignature: null },
    wallpaperLibrary: { ...appearance.wallpaperLibrary, activeId: null }
  })
}

async function removeCustomThemeBackground() {
  return wallpaperMutationQueue.run(removeCustomThemeBackgroundUnlocked)
}

async function clearCustomThemeBackground() {
  await removeCustomThemeBackground()
  return appearancePayload()
}

async function syncWallpaperEngineBackground() {
  const wallpaperEngineSync = process.platform === 'win32'
    ? await syncBoundWallpaperEngine()
    : { changed: false, synchronized: false, reason: 'unavailable' }
  return { ...(await appearancePayload()), wallpaperEngineSync }
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
    const runtimeEnv = ensureGitRuntimeService().runtimeEnvironment({
      ...process.env,
      ...runtimeProxyEnv,
      ...resolved.env,
      HARNESS_MOBILE_SYNC_STATE_FILE: path.join(app.getPath('userData'), 'mobile-sync.json'),
      HARNESS_DESKTOP_BROWSER_STATE_FILE: browserControlStateFile(),
      HARNESS_DESKTOP_CAPABILITIES_STATE_FILE: browserControlStateFile()
    })
    child = spawnCommand(resolved.command, [...resolved.argsPrefix, 'web', '--port', '0', '--no-open'], {
      cwd: runtimePaths.workspace,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: desktopRuntimeEnvironment(runtimeEnv, runtimePaths)
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

async function desktopReleaseTrustedKeys() {
  const packagedRoot = global.__HARNESS_COMPONENT_UPDATE__?.bundledRoot || path.resolve(__dirname, '..')
  const configPath = path.join(packagedRoot, 'release-update-sources.json')
  const payload = JSON.parse(await readFile(configPath, 'utf8'))
  if (!payload.trustedKeys || typeof payload.trustedKeys !== 'object' || Array.isArray(payload.trustedKeys)) {
    throw new Error('桌面更新源缺少受信任的 Ed25519 公钥。')
  }
  return payload.trustedKeys
}

async function checkUpdates() {
  const store = ensureStateStore()
  const resolved = resolveDshBin({ nodeModulesRoot: runtimeNodeModulesRoot || undefined })
  const currentHarnessVersion = resolved.version && !['unresolved', 'external'].includes(resolved.version)
    ? resolved.version
    : desktopPackage.dependencies?.['@deepseek-ai/dsh'] || 'unknown'
  const preferences = store.get().updates
  const trustedKeys = await desktopReleaseTrustedKeys()
  const packagedUpdateRoot = global.__HARNESS_COMPONENT_UPDATE__?.bundledRoot || path.resolve(__dirname, '..')
  const feedUrls = await resolveUpdateFeeds({
    configPaths: [
      path.join(packagedUpdateRoot, 'release-update-sources.local.json'),
      path.join(packagedUpdateRoot, 'release-update-sources.json')
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
    : checkAppUpdate({ currentVersion: app.getVersion(), feedUrls, trustedKeys, channel, fetchJsonImpl: fetchJsonWithSystemNetwork }).catch(error => ({
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
function desktopMcpManagerPluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-desktop-mcp-manager') }
}
function desktopSchedulesPluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-desktop-schedules') }
}
function desktopFilesPluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-desktop-files') }
}
function desktopProgressPluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-desktop-progress') }
}
function desktopCompactionPluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-desktop-compaction') }
}
function desktopComputerUsePluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-desktop-computer-use') }
}
function agentTeamsPluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-agent-teams') }
}
function sessionExperiencePluginOptions() {
  return { dshHome: desktopDshHome(), bundledRoot: path.join(__dirname, '..', 'plugins', 'dsh-session-experience') }
}

async function fetchJsonWithSystemNetwork(url, { timeoutMs = 6000, maxBytes = 1024 * 1024, headers = {}, maxRedirects = DEFAULT_MAX_REDIRECTS, allowedHosts = [] } = {}) {
  const current = safeHttpsUpdateUrl(url, '更新清单地址').toString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchWithSafeRedirects(current, {
      fetchImpl: net.fetch,
      signal: controller.signal,
      maxRedirects,
      allowedHosts,
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

// Reconcile the latest component check plan against the store's active pointer
// before exposing it to the renderer, so a stale last-check after an applied
// component update never re-triggers the "update available" notice. The helper
// lives in component-update-service.cjs for unit-testability.
async function getComponentUpdateState() {
  const context = await ensureComponentUpdateService()
  const state = context.enabled ? await context.store.get() : null
  const pointer = context.enabled ? await context.store.pointer() : null
  return {
    enabled: context.enabled,
    source: context.config.source || '',
    state,
    pointer,
    lastCheck: effectiveComponentLastCheck(lastComponentUpdateCheck, pointer, state)
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
  // The update is being applied and the app is about to restart; drop the stale
  // in-memory check so nothing reports the (now-applied) release as still pending.
  lastComponentUpdateCheck = null
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
    if (!update?.updateAvailable) {
      return { ok: true, version: update?.currentVersion || app.getVersion(), ready: false, upToDate: true }
    }
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
    gitRuntimeProbe: () => ensureGitRuntimeService().status(),
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

function browserIntentForLink(value, fallback = 'navigation') {
  try {
    const target = new URL(value)
    if (!['http:', 'https:'].includes(target.protocol)) return 'external-app'
    const oauthPath = /\/(?:oauth2?|authorize|device(?:code)?)(?:[/?#]|$)/i.test(target.pathname)
    const oauthQuery = ['client_id', 'redirect_uri', 'response_type', 'code_challenge'].some(key => target.searchParams.has(key))
    if (oauthPath && oauthQuery) return 'oauth'
    if (/^(?:login\.microsoftonline\.com|accounts\.google\.com)$/i.test(target.hostname) && oauthPath) return 'sso'
    return fallback
  } catch {
    return fallback
  }
}

async function openRoutedBrowserLink(value, context = {}) {
  const intent = String(context.intent || browserIntentForLink(value, 'navigation'))
  const decision = routeBrowserLink({
    target: String(value || ''),
    source: ['user', 'model', 'app', 'developer'].includes(context.source) ? context.source : 'app',
    intent,
    userChoice: ['default', 'embedded', 'system'].includes(context.userChoice) ? context.userChoice : 'default'
  })
  if (decision.decision === BROWSER_LINK_DECISIONS.REJECT) throw new Error(`链接已被安全策略拒绝：${decision.reason}`)
  if (decision.decision === BROWSER_LINK_DECISIONS.SYSTEM) {
    await shell.openExternal(decision.target)
    return decision
  }
  showMainWindow()
  await createBrowserTab(decision.target)
  await setBrowserSidebarVisible(true)
  return decision
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
      { label: '在右侧工作区预览', click: () => send('rightWorkspace:previewLocal', localValue) },
      { label: '打开文件或项目', click: () => openDesktopLocalTarget(localValue).catch(() => {}) },
      { label: '在文件夹中显示', click: () => openDesktopLocalTarget(localValue, true).catch(() => {}) },
      { label: '复制本机路径', click: () => clipboard.writeText(local.path) },
      { type: 'separator' }
    )
  } else if (external) {
    template.push(
      { label: '在内置浏览器打开', click: () => openRoutedBrowserLink(external, { source: 'user', intent: 'navigation', userChoice: 'embedded' }).catch(() => {}) },
      { label: '用系统浏览器打开', click: () => openRoutedBrowserLink(external, { source: 'user', intent: 'navigation', userChoice: 'system' }).catch(() => {}) },
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
    if (/^harness-desktop:\/\/open-local(?:[/?#]|$)/i.test(details.url || '')) openDesktopLocalTarget(details.url).catch(() => {})
    else openRoutedBrowserLink(details.url, { source: 'app', intent: browserIntentForLink(details.url), userChoice: 'default' }).catch(() => {})
    return { action: 'deny' }
  })
  guest.on('will-navigate', (event, targetUrl) => {
    if (!isLocalRuntimeUrl(targetUrl)) event.preventDefault()
  })
  guest.on('context-menu', (_event, params) => {
    showGuestContextMenu(guest, params).catch(() => {})
  })
}

function openDetachedSessionWindow(sessionId) {
  const value = String(sessionId || '')
  if (!value || value.length > 256 || value.trim() !== value) throw new Error('会话 ID 无效。')
  if (runtimeState.status !== 'ready' || !runtimeState.url) throw new Error('Harness 运行时尚未就绪。')
  const target = new URL(runtimeState.url)
  target.searchParams.set('harness-desktop-session', value)
  const iconPath = STORE_BUILD
    ? path.join(__dirname, '..', 'store', 'Assets', 'AppList.targetsize-256.png')
    : path.join(__dirname, '..', 'build', 'icon.png')
  const detached = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f7f8fa',
    icon: existsSync(iconPath) ? iconPath : undefined,
    title: 'Harness Desktop',
    webPreferences: {
      partition: 'persist:harness',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  detachedSessionWindows.add(detached)
  detached.webContents.setWindowOpenHandler(details => {
    openRoutedBrowserLink(details.url, { source: 'app', intent: browserIntentForLink(details.url), userChoice: 'default' }).catch(() => {})
    return { action: 'deny' }
  })
  detached.webContents.on('will-navigate', (event, targetUrl) => {
    if (/^harness-desktop:\/\/copy-session-id(?:[/?#]|$)/i.test(targetUrl)) {
      event.preventDefault()
      try {
        const copyTarget = new URL(targetUrl)
        const copyValue = copyTarget.searchParams.get('value')
        if (copyValue) clipboard.writeText(copyValue)
      } catch {}
      return
    }
    if (/^harness-desktop:\/\/open-session-window(?:[/?#]|$)/i.test(targetUrl)) {
      event.preventDefault()
      try {
        const openTarget = new URL(targetUrl)
        const openValue = openTarget.searchParams.get('sessionId')
        if (openValue) openDetachedSessionWindow(openValue)
      } catch {}
      return
    }
    if (!isLocalRuntimeUrl(targetUrl)) event.preventDefault()
  })
  detached.webContents.on('will-attach-webview', event => event.preventDefault())
  detached.on('closed', () => detachedSessionWindows.delete(detached))
  detached.loadURL(target.toString())
  return true
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
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    runtimeGuest = guest
    guest.once('destroyed', () => { if (runtimeGuest === guest) runtimeGuest = null })
    secureGuest(guest)
  })
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).protocol !== 'file:') event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  mainWindow.on('session-end', () => {
    // Windows Restart Manager sends WM_ENDSESSION with ENDSESSION_CLOSEAPP
    // before replacing locked files. Older Harness builds hide on WM_CLOSE
    // because the tray owns the normal close lifecycle, so explicitly enter
    // the real quit path and release the bundled runtime for every committed
    // Windows session end (which can no longer be cancelled at this stage).
    isQuitting = true
    stopRuntime()
    app.quit()
  })
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

ipcMain.handle('updates:preferences', desktopShellOnly(() => ensureStateStore().get().updates))
ipcMain.handle('session:openWindow', desktopShellOnly(sessionId => openDetachedSessionWindow(sessionId)))
ipcMain.handle('updates:setPreferences', desktopShellOnly(patch => ensureStateStore().updatePreferences(patch || {}).updates))
ipcMain.handle('updates:check', desktopShellOnly(() => checkUpdates()))
ipcMain.handle('updates:install', desktopShellOnly(() => installAppUpdate()))
ipcMain.handle('updates:launchReady', desktopShellOnly(() => launchReadyAppUpdate()))
ipcMain.handle('componentUpdates:getState', desktopShellOnly(() => getComponentUpdateState()))
ipcMain.handle('componentUpdates:check', desktopShellOnly(() => checkComponentUpdates()))
ipcMain.handle('componentUpdates:stage', desktopShellOnly(() => stageComponentUpdates()))
ipcMain.handle('componentUpdates:apply', desktopShellOnly(() => launchReadyComponentUpdate()))
ipcMain.handle('gitRuntime:status', event => {
  assertDesktopShellSender(event)
  return ensureGitRuntimeService().status()
})
ipcMain.handle('gitRuntime:refresh', event => {
  assertDesktopShellSender(event)
  return ensureGitRuntimeService().status()
})
ipcMain.handle('gitRuntime:prepare', event => {
  assertDesktopShellSender(event)
  return prepareDevelopmentGitRuntime()
})
ipcMain.handle('gitRuntime:authenticate', (event, provider) => {
  assertDesktopShellSender(event)
  return ensureGitRuntimeService().authenticate(String(provider || 'github'))
})
// Applying a ready component update remains intentionally unexposed until the
// isolated branch is merged and installation testing is explicitly approved.
ipcMain.handle('distribution:get', desktopShellOnly(() => distributionInfo()))
ipcMain.handle('appearance:get', desktopShellOnly(() => appearancePayload()))
ipcMain.handle('appearance:assets', desktopShellOnly(() => bundledThemeAssets()))
ipcMain.handle('appearance:setTheme', desktopShellOnly(async themeId => {
  if (STORE_BUILD && themeId === 'maid-atelier') throw new Error('Microsoft Store 版本不包含非商业授权主题。')
  ensureStateStore().updateAppearance({ themeId })
  return appearancePayload()
}))
ipcMain.handle('appearance:setUiPreferences', desktopShellOnly(async patch => {
  ensureStateStore().updateAppearance(patch || {})
  return appearancePayload()
}))
ipcMain.handle('appearance:saveCustom', desktopShellOnly(async customTheme => {
  ensureStateStore().updateAppearance({ themeId: 'custom', customTheme })
  return appearancePayload()
}))
ipcMain.handle('appearance:chooseBackground', desktopShellOnly(() => chooseCustomThemeBackground()))
ipcMain.handle('appearance:chooseWallpaperEngine', desktopShellOnly(() => chooseCustomThemeBackground({ wallpaperEngine: true })))
ipcMain.handle('appearance:listWallpaperEngineProjects', desktopShellOnly(() => wallpaperEngineLibraryScan()))
ipcMain.handle('appearance:applyWallpaperEngineProject', desktopShellOnly(value => applyWallpaperEngineProject(value)))
ipcMain.handle('appearance:applyWallpaper', desktopShellOnly(value => applyWallpaperLibraryItem(value)))
ipcMain.handle('appearance:deleteWallpaper', desktopShellOnly(value => deleteWallpaperLibraryItem(value)))
ipcMain.handle('appearance:syncWallpaperEngine', desktopShellOnly(() => syncWallpaperEngineBackground()))
ipcMain.handle('appearance:clearBackground', desktopShellOnly(() => clearCustomThemeBackground()))
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
ipcMain.handle('settings:openDocument', desktopShellOnly(() => openHarnessSettingsDocument()))
ipcMain.handle('models:routing:get', desktopShellOnly(() => getModelRouting(modelRoutingOptions())))
ipcMain.handle('models:routing:save', desktopShellOnly(routing => saveModelRouting(modelRoutingOptions(), routing || {})))
ipcMain.handle('models:meters:get', desktopShellOnly(force => getProviderMeters(Boolean(force))))
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
ipcMain.handle('rightWorkspace:resource', (event, kind, payload) => {
  assertDesktopShellSender(event)
  return loadRightWorkspaceResource({
    runtimeUrl: runtimeState.status === 'ready' ? runtimeState.url : null,
    kind: String(kind || ''),
    sessionId: payload?.sessionId,
    path: payload?.path,
    fetchImpl: (url, options) => net.fetch(url.toString(), options)
  })
})
ipcMain.handle('rightWorkspace:previewLocal', (event, value) => {
  assertDesktopShellSender(event)
  const target = normalizeLocalTarget(value)
  return previewLocalDocument(target.path, { realpathImpl: realpath, statImpl: stat, openImpl: open })
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
ipcMain.handle('browser:setPanelWidth', (event, width) => {
  assertDesktopShellSender(event)
  browserPanelWidth = Math.max(BROWSER_PANEL_MIN_WIDTH, Math.min(BROWSER_PANEL_MAX_WIDTH, Math.floor(Number(width) || BROWSER_PANEL_DEFAULT_WIDTH)))
  browserWideMode = false
  layoutBrowserView()
  return publishBrowserState()
})
ipcMain.handle('browser:setWideMode', (event, enabled) => {
  assertDesktopShellSender(event)
  browserWideMode = Boolean(enabled)
  layoutBrowserView()
  return publishBrowserState()
})
ipcMain.handle('browser:historySearch', async (event, query) => {
  assertDesktopShellSender(event)
  return { entries: await ensureBrowserHistoryStore().search(String(query || ''), { limit: 100 }) }
})
ipcMain.handle('browser:historyOpen', async (event, id) => {
  assertDesktopShellSender(event)
  const entries = await ensureBrowserHistoryStore().search('', { limit: 500 })
  const entry = entries.find(item => item.id === String(id || ''))
  if (!entry) throw new Error('浏览历史记录不存在。')
  return navigateBrowser(entry.url)
})
ipcMain.handle('browser:historyRemove', async (event, id) => {
  assertDesktopShellSender(event)
  const removed = await ensureBrowserHistoryStore().remove(String(id || ''))
  return { removed, entries: await ensureBrowserHistoryStore().search('', { limit: 100 }) }
})
ipcMain.handle('browser:historyClear', async (event, request) => {
  assertDesktopShellSender(event)
  if (request?.confirmed !== true) throw new Error('清空浏览历史需要用户明确确认。')
  await ensureBrowserHistoryStore().clear()
  return publishBrowserState()
})
ipcMain.handle('browser:navigate', (event, value) => {
  assertDesktopShellSender(event)
  return navigateBrowser(value)
})
ipcMain.handle('browser:newTab', (event, value) => {
  assertDesktopShellSender(event)
  return createBrowserTab(value)
})
ipcMain.handle('browser:switchTab', (event, id) => {
  assertDesktopShellSender(event)
  return switchBrowserTab(id)
})
ipcMain.handle('browser:closeTab', (event, id) => {
  assertDesktopShellSender(event)
  return closeBrowserTab(id)
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
ipcMain.handle('browser:revokeCurrent', async event => {
  assertDesktopShellSender(event)
  browserOperations.ticket()
  const origin = browserState.origin
  if (origin) abortBrowserTransfers(origin)
  await withBrowserTransferLock(async () => {
    if (origin && browserSecurityPolicy && !browserSecurityPolicy.isStopped) browserSecurityPolicy.revoke(origin)
  })
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
ipcMain.handle('computerUse:policy', desktopShellOnly(() => getComputerUsePolicy()))
ipcMain.handle('computerUse:setDefaultAccess', desktopShellOnly(access => setComputerUseDefaultAccess(access)))
ipcMain.handle('computerUse:setAppOverride', desktopShellOnly((id, decision) => setComputerUseAppOverride(id, decision)))
ipcMain.handle('computerUse:revokeAppOverride', desktopShellOnly(id => revokeComputerUseAppOverride(id)))
ipcMain.handle('mobileSync:getState', desktopShellOnly(() => ensureMobileSyncService().state()))
ipcMain.handle('mobileSync:setEnabled', desktopShellOnly(enabled => ensureMobileSyncService().setEnabled(Boolean(enabled))))
ipcMain.handle('mobileSync:setRemoteEnabled', desktopShellOnly(enabled => ensureMobileSyncService().setRemoteEnabled(Boolean(enabled))))
ipcMain.handle('mobileSync:setTransportPreference', desktopShellOnly(preference => ensureMobileSyncService().setTransportPreference(String(preference || 'auto'))))
ipcMain.handle('mobileSync:beginPairing', desktopShellOnly(() => ensureMobileSyncService().beginPairing()))
ipcMain.handle('mobileSync:revokeDevice', desktopShellOnly(id => ensureMobileSyncService().revokeDevice(String(id || ''))))
ipcMain.handle('mobileControl:send', desktopShellOnly((deviceId, command) => ensureMobileSyncService().sendControlCommand(String(deviceId || ''), command || {})))
ipcMain.handle('mobileControl:cancel', desktopShellOnly(commandId => ensureMobileSyncService().cancelControlCommand(String(commandId || ''))))
ipcMain.handle('mobileControl:stop', desktopShellOnly(deviceId => ensureMobileSyncService().stopControl(deviceId ? String(deviceId) : null, 'DESKTOP_STOP')))
ipcMain.handle('mobileSync:copy', desktopShellOnly(value => {
  clipboard.writeText(String(value || ''))
  return true
}))
ipcMain.handle('shell:copyText', desktopShellOnly(value => {
  clipboard.writeText(String(value || ''))
  return true
}))
ipcMain.handle('runtime:start', desktopShellOnly(options => startRuntime(options || {})))
ipcMain.handle('runtime:state', desktopShellOnly(() => runtimeState))
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
ipcMain.handle('shell:openLink', (event, value, context = {}) => {
  assertDesktopShellSender(event)
  return openRoutedBrowserLink(value, {
    source: 'user',
    intent: String(context.intent || browserIntentForLink(value)),
    userChoice: String(context.userChoice || 'default')
  })
})
ipcMain.handle('shell:openExternal', (event, value) => {
  assertDesktopShellSender(event)
  return openRoutedBrowserLink(value, { source: 'user', intent: browserIntentForLink(value), userChoice: 'system' })
})
ipcMain.handle('shell:openLocal', desktopShellOnly((value, options = {}) => openDesktopLocalTarget(value, Boolean(options.reveal))))
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
  await cleanupOrphanedWallpaperAssets().catch(error => console.warn(`Unable to clean stale managed wallpapers: ${error.message}`))
  await registerWallpaperProtocol().catch(error => console.warn(`Unable to register wallpaper media protocol: ${error.message}`))
  await clearComputerUseScreenshots().catch(error => console.warn(`Unable to clear stale Computer Use screenshots: ${error.message}`))
  powerMonitor.on('lock-screen', () => {
    computerUseScreenLocked = true
    setComputerUseEnabled(false).catch(() => {})
  })
  powerMonitor.on('unlock-screen', () => { computerUseScreenLocked = false })
  powerMonitor.on('suspend', () => {
    computerUseScreenLocked = true
    setComputerUseEnabled(false).catch(() => {})
  })
  powerMonitor.on('resume', () => { computerUseScreenLocked = false })
  try { ensureMemoryService() } catch (error) { console.warn(`Unable to initialize local memory: ${error.message}`) }
  runtimeInitializationPromise = (async () => {
    await ensureBundledRuntime()
    await ensureDesktopCompactionPlugin(desktopCompactionPluginOptions())
    await ensureModelRouting(modelRoutingOptions())
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
    await ensureDesktopMcpManagerPlugin(desktopMcpManagerPluginOptions()).catch(error => {
      console.warn(`Unable to prepare desktop MCP manager plugin: ${error.message}`)
    })
    await ensureDesktopSchedulesPlugin(desktopSchedulesPluginOptions()).catch(error => {
      console.warn(`Unable to prepare desktop schedules plugin: ${error.message}`)
    })
    await ensureDesktopFilesPlugin(desktopFilesPluginOptions()).catch(error => {
      console.warn(`Unable to prepare desktop files plugin: ${error.message}`)
    })
    await ensureDesktopProgressPlugin(desktopProgressPluginOptions()).catch(error => {
      console.warn(`Unable to prepare desktop progress plugin: ${error.message}`)
    })
    await ensureDesktopComputerUsePlugin(desktopComputerUsePluginOptions()).catch(error => {
      console.warn(`Unable to prepare desktop Computer Use plugin: ${error.message}`)
    })
    await ensureAgentTeamsPlugin(agentTeamsPluginOptions()).catch(error => {
      console.warn(`Unable to prepare Agent Teams plugin: ${error.message}`)
    })
    await ensureSessionExperiencePlugin(sessionExperiencePluginOptions()).catch(error => {
      console.warn(`Unable to prepare session & attachment experience plugin: ${error.message}`)
    })
  })()
  runtimeInitializationPromise.then(startManagedCacheMaintenance)
    .catch(error => console.warn(`Unable to start managed cache maintenance: ${error.message}`))
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
  clearInterval(cacheMaintenanceTimer)
  cacheMaintenanceTimer = null
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
  computerUseCurrentTarget = null
  computerUseHarnessSurface = null
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
