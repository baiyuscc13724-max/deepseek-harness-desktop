const { app, BrowserWindow, dialog, ipcMain, net, shell } = require('electron')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync } = require('node:fs')
const { copyFile, mkdir, open, readFile, stat, writeFile } = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

const { resolveDshBin } = require('./bridge/dsh-resolver.cjs')
const { ensureModelRouting, getModelRouting, saveModelRouting } = require('./bridge/model-routing-service.cjs')
const { ensurePluginMarketplace } = require('./bridge/plugin-marketplace-service.cjs')
const { spawnCommand } = require('./bridge/process-spawn.cjs')
const { DEFAULT_APP_FEED, checkAppUpdate, checkHarnessUpstream, parseChecksumFile } = require('./bridge/update-service.cjs')
const { buildWindowsInstallerHandoff } = require('./bridge/update-launcher.cjs')
const { runPackagedSelfTest } = require('./bridge/self-test-service.cjs')
const { AppStateStore } = require('./store/app-state-store.cjs')
const desktopPackage = require('../package.json')

const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:3080'
const LOCAL_RUNTIME_HOSTS = new Set(['127.0.0.1', 'localhost'])

let mainWindow = null
let runtime = null
let runtimeOwnedByDesktop = false
let runtimeState = { status: 'stopped', url: null, detail: '' }
let appStateStore = null
let lastUpdatePayload = null
let activeUpdateInstall = null
let readyUpdate = null

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
}

function ensureStateStore() {
  if (!appStateStore) appStateStore = new AppStateStore(path.join(app.getPath('userData'), 'app-state.json'))
  return appStateStore
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
  const appearance = ensureStateStore().get().appearance
  const backgroundFile = appearance.customTheme?.backgroundFile
  if (!backgroundFile) return { ...appearance, customBackgroundDataUrl: null }
  const file = path.join(app.getPath('userData'), 'themes', backgroundFile)
  const customBackgroundDataUrl = await readThemeDataUrl(file).catch(() => null)
  return { ...appearance, customBackgroundDataUrl }
}

async function bundledThemeAssets() {
  const root = path.join(__dirname, '..', 'renderer', 'themes')
  const entries = await Promise.all(BUNDLED_THEME_ASSETS.map(async relative => {
    const url = await readThemeDataUrl(path.join(root, relative))
    return [relative, url]
  }))
  return Object.fromEntries(entries)
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
  await mkdir(directory, { recursive: true })
  await copyFile(source, path.join(directory, fileName))
  ensureStateStore().updateAppearance({ themeId: 'custom', customTheme: { backgroundFile: fileName } })
  return appearancePayload()
}

async function openHarnessSettingsDocument() {
  const harnessHome = String(process.env.DSH_HOME || path.join(app.getPath('home'), '.dsh')).trim()
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

async function startRuntime({ cwd } = {}) {
  if (runtimeState.status === 'ready' && runtimeState.url) return runtimeState
  if (runtime && runtime.exitCode == null) return runtimeState
  if (await connectExistingRuntime()) return runtimeState

  const resolved = resolveDshBin()
  setRuntimeState({ status: 'starting', url: null, detail: `正在启动 DeepSeek Harness Web（${resolved.source}）…` })

  let child
  try {
    child = spawnCommand(resolved.command, [...resolved.argsPrefix, 'web'], {
      cwd: cwd && existsSync(cwd) ? cwd : app.getPath('documents'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...resolved.env }
    })
  } catch (error) {
    setRuntimeState({ status: 'error', url: null, detail: error.message })
    return runtimeState
  }

  runtime = child
  runtimeOwnedByDesktop = true
  let candidateUrl = DEFAULT_RUNTIME_URL
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
    if (await probeUrl(candidateUrl)) {
      setRuntimeState({ status: 'ready', url: candidateUrl, detail: `DeepSeek Harness Web 已就绪：${candidateUrl}` })
      return runtimeState
    }
    if (candidateUrl !== DEFAULT_RUNTIME_URL && await probeUrl(DEFAULT_RUNTIME_URL)) {
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
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode == null) child.kill('SIGKILL')
    }, 3000).unref()
  }
}

async function checkUpdates() {
  const store = ensureStateStore()
  const resolved = resolveDshBin()
  const currentHarnessVersion = resolved.version && !['unresolved', 'external'].includes(resolved.version)
    ? resolved.version
    : desktopPackage.dependencies?.['@deepseek-ai/dsh'] || 'unknown'
  const preferences = store.get().updates
  const feedUrl = String(process.env.HARNESS_DESKTOP_UPDATE_FEED || DEFAULT_APP_FEED).trim()
  const channel = preferences.channel === 'prerelease' || app.getVersion().includes('-') ? 'prerelease' : 'stable'
  const [appResult, harnessResult] = await Promise.all([
    checkAppUpdate({ currentVersion: app.getVersion(), feedUrl, channel, fetchJsonImpl: fetchJsonWithSystemNetwork }).catch(error => ({
      kind: 'app', configured: Boolean(feedUrl), currentVersion: app.getVersion(), updateAvailable: false, error: error.message
    })),
    checkHarnessUpstream({ currentVersion: currentHarnessVersion, fetchJsonImpl: fetchJsonWithSystemNetwork }).catch(error => ({
      kind: 'harness', currentVersion: currentHarnessVersion, updateAvailable: false, error: error.message
    }))
  ])
  const state = store.markUpdateChecked()
  const payload = { app: appResult, harness: harnessResult, preferences: state.updates }
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
    dshHome: String(process.env.DSH_HOME || path.join(app.getPath('home'), '.dsh')).trim(),
    shippedPresetRoot: path.join(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets')
  }
}

function pluginMarketplaceOptions() {
  return {
    dshHome: String(process.env.DSH_HOME || path.join(app.getPath('home'), '.dsh')).trim(),
    bundledRoot: path.join(__dirname, '..', 'node_modules', 'dsh-plugin-marketplace')
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

async function downloadUpdateFile(url, destination, expectedSize, onProgress) {
  const response = await net.fetch(safeUpdateUrl(url), {
    redirect: 'follow',
    headers: { 'User-Agent': `Harness-Desktop/${app.getVersion()}`, Accept: 'application/octet-stream' }
  })
  if (!response.ok || !response.body) throw new Error(`下载更新失败（HTTP ${response.status}）。`)
  const advertised = Number(response.headers.get('content-length') || expectedSize || 0)
  const maximum = 600 * 1024 * 1024
  if (advertised > maximum) throw new Error('更新文件大小超过安全限制。')

  const file = await open(destination, 'w', 0o600)
  const hash = createHash('sha256')
  let received = 0
  try {
    for await (const value of response.body) {
      const chunk = Buffer.from(value)
      received += chunk.length
      if (received > maximum) throw new Error('更新文件大小超过安全限制。')
      await file.write(chunk)
      hash.update(chunk)
      onProgress?.({ received, total: advertised || 0 })
    }
  } finally {
    await file.close()
  }
  if (expectedSize && received !== expectedSize) throw new Error('更新文件大小校验失败。')
  return { size: received, sha256: hash.digest('hex') }
}

async function fetchChecksum(url, fileName) {
  const response = await net.fetch(safeUpdateUrl(url), {
    redirect: 'follow',
    headers: { 'User-Agent': `Harness-Desktop/${app.getVersion()}`, Accept: 'text/plain' }
  })
  if (!response.ok) throw new Error(`下载更新校验文件失败（HTTP ${response.status}）。`)
  const text = await response.text()
  if (text.length > 2 * 1024 * 1024) throw new Error('更新校验文件过大。')
  return parseChecksumFile(text, fileName)
}

async function installAppUpdate() {
  if (process.platform !== 'win32') throw new Error('当前版本仅支持在 Windows 内自动安装更新。')
  if (activeUpdateInstall) return activeUpdateInstall

  activeUpdateInstall = (async () => {
    let payload = lastUpdatePayload
    if (!payload?.app?.updateAvailable) payload = await checkUpdates()
    const update = payload?.app
    if (!update?.updateAvailable) throw new Error('当前桌面版已经是最新版本。')
    if (!update.installer?.url) throw new Error('新版本没有可用的 Windows 安装包。')
    if (!update.checksums?.url) throw new Error('新版本缺少 SHA256SUMS.txt，已拒绝不安全更新。')

    let installerPath = readyUpdate?.version === update.latestVersion && existsSync(readyUpdate.installerPath)
      ? readyUpdate.installerPath
      : null
    if (!installerPath) {
      const updatesDir = path.join(app.getPath('temp'), 'harness-desktop-updates')
      await mkdir(updatesDir, { recursive: true })
      installerPath = path.join(updatesDir, path.basename(update.installer.name))
      send('updates:install-progress', { phase: 'checksum', version: update.latestVersion })
      const expectedHash = await fetchChecksum(update.checksums.url, update.installer.name)
      send('updates:install-progress', { phase: 'download', version: update.latestVersion, received: 0, total: update.installer.size || 0 })
      const downloaded = await downloadUpdateFile(update.installer.url, installerPath, update.installer.size, progress => {
        send('updates:install-progress', { phase: 'download', version: update.latestVersion, ...progress })
      })
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
  if (process.platform !== 'win32') throw new Error('当前版本仅支持在 Windows 内自动安装更新。')
  if (!readyUpdate?.installerPath || !existsSync(readyUpdate.installerPath)) {
    throw new Error('已下载的更新安装包不存在，请重新下载。')
  }

  send('updates:install-progress', { phase: 'launch', version: readyUpdate.version })
  const handoff = buildWindowsInstallerHandoff({ installerPath: readyUpdate.installerPath, parentPid: process.pid })
  const child = spawn(handoff.command, handoff.args, handoff.options)
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
  const version = readyUpdate.version
  app.quit()
  return { ok: true, version }
}

function selfTestOutputPath() {
  const prefix = '--self-test-output='
  const arg = process.argv.find(value => String(value).startsWith(prefix))
  return arg ? String(arg).slice(prefix.length) : String(process.env.HARNESS_DESKTOP_SELFTEST_OUTPUT || '').trim()
}

async function runSelfTestMode() {
  const report = await runPackagedSelfTest({
    appVersion: app.getVersion(),
    userData: app.getPath('userData'),
    rendererEntry: path.join(__dirname, '..', 'renderer', 'index.html'),
    resolveDshBin
  })
  const output = selfTestOutputPath()
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (output) await writeFile(path.resolve(output), text, { encoding: 'utf8', mode: 0o600 })
  else process.stdout.write(`HARNESS_DESKTOP_SELFTEST=${JSON.stringify(report)}\n`)
  return report
}

function secureGuest(guest) {
  guest.setWindowOpenHandler(() => ({ action: 'deny' }))
  guest.on('will-navigate', (event, targetUrl) => {
    if (!isLocalRuntimeUrl(targetUrl)) event.preventDefault()
  })
}

function createWindow() {
  ensureStateStore()
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png')
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
    delete webPreferences.preload
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
  mainWindow.on('closed', () => { mainWindow = null })

  if (ensureStateStore().get().updates.checkOnStartup) {
    setTimeout(() => checkUpdates().catch(() => {}), 2500).unref()
  }
}

ipcMain.handle('updates:preferences', () => ensureStateStore().get().updates)
ipcMain.handle('updates:setPreferences', (_event, patch) => ensureStateStore().updatePreferences(patch || {}).updates)
ipcMain.handle('updates:check', () => checkUpdates())
ipcMain.handle('updates:install', () => installAppUpdate())
ipcMain.handle('updates:launchReady', () => launchReadyAppUpdate())
ipcMain.handle('appearance:get', () => appearancePayload())
ipcMain.handle('appearance:assets', () => bundledThemeAssets())
ipcMain.handle('appearance:setTheme', async (_event, themeId) => {
  ensureStateStore().updateAppearance({ themeId })
  return appearancePayload()
})
ipcMain.handle('appearance:saveCustom', async (_event, customTheme) => {
  ensureStateStore().updateAppearance({ themeId: 'custom', customTheme })
  return appearancePayload()
})
ipcMain.handle('appearance:chooseBackground', () => chooseCustomThemeBackground())
ipcMain.handle('settings:openDocument', () => openHarnessSettingsDocument())
ipcMain.handle('models:routing:get', () => getModelRouting(modelRoutingOptions()))
ipcMain.handle('models:routing:save', (_event, routing) => saveModelRouting(modelRoutingOptions(), routing || {}))
ipcMain.handle('runtime:start', (_event, options) => startRuntime(options || {}))
ipcMain.handle('runtime:state', () => runtimeState)
ipcMain.handle('shell:openExternal', async (_event, value) => {
  const target = new URL(value)
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('只允许打开 http/https 链接。')
  return shell.openExternal(target.toString())
})

app.whenReady().then(async () => {
  if (process.argv.includes('--self-test')) {
    const report = await runSelfTestMode().catch(error => ({ ok: false, error: error.message }))
    app.exit(report.ok ? 0 : 1)
    return
  }
  await ensureModelRouting(modelRoutingOptions()).catch(error => {
    console.warn(`Unable to restore desktop model routing: ${error.message}`)
  })
  await ensurePluginMarketplace(pluginMarketplaceOptions()).then(result => {
    if (result.warning) console.warn(result.warning)
  }).catch(error => {
    console.warn(`Unable to prepare DSH plugin marketplace: ${error.message}`)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', stopRuntime)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
