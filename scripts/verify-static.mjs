import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'electron/main.cjs', 'electron/preload.cjs', 'electron/desktop-tray.cjs',
  'electron/bridge/dsh-resolver.cjs', 'electron/bridge/process-spawn.cjs', 'electron/bridge/runtime-proxy.cjs', 'electron/bridge/runtime-bundle-service.cjs',
  'electron/bridge/update-service.cjs', 'electron/bridge/update-launcher.cjs', 'electron/bridge/self-test-service.cjs', 'electron/bridge/model-routing-service.cjs', 'electron/bridge/plugin-marketplace-service.cjs', 'electron/bridge/local-target-service.cjs',
  'electron/store/app-state-store.cjs',
  'renderer/index.html', 'renderer/styles.css', 'renderer/app.js', 'renderer/theme-catalog.js', 'renderer/theme-integration.js', 'renderer/model-routing-integration.js', 'renderer/workspace-links-integration.js',
  'renderer/themes/maid-atelier/maid-atelier-maid-left-v5.webp',
  'renderer/themes/maid-atelier/maid-atelier-maid-right-v6.webp',
  'renderer/themes/maid-atelier/maid-atelier-palace-day-v4.webp',
  'renderer/themes/maid-atelier/maid-atelier-palace-night-v4.webp',
  'renderer/assets/deepseek-icon.svg', 'build/icon.png',
  'tests/app-state-store.test.cjs', 'tests/update-service.test.cjs', 'tests/update-launcher.test.cjs', 'tests/self-test-service.test.cjs', 'tests/model-routing-service.test.cjs', 'tests/plugin-marketplace-service.test.cjs', 'tests/runtime-proxy.test.cjs', 'tests/runtime-bundle-service.test.cjs', 'tests/official-runtime-patch.test.cjs', 'tests/local-target-service.test.cjs', 'tests/desktop-tray.test.cjs', 'tests/startup-animation.test.cjs',
  'docs/ARCHITECTURE.zh-CN.md', 'docs/BRANDING.zh-CN.md', 'docs/VALIDATION.zh-CN.md', 'docs/assets/harness-desktop-hero.jpg',
  'build/installer.iss', 'scripts/build-release.mjs', 'scripts/release-audit.mjs', 'scripts/packaged-selftest-contract.mjs', 'scripts/patch-official-runtime.mjs',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'release-manifest.json'
]
for (const relative of required) await access(path.join(root, relative))

const removed = [
  'electron/bridge/agent-bridge.cjs', 'electron/bridge/diagnostics-service.cjs',
  'electron/bridge/git-service.cjs', 'electron/bridge/mcp-service.cjs',
  'electron/bridge/plugin-service.cjs', 'electron/bridge/provider-service.cjs',
  'electron/bridge/secure-storage.cjs', 'electron/bridge/skill-service.cjs',
  'electron/bridge/terminal-service.cjs', 'electron/bridge/workspace-service.cjs',
  'electron/store/session-store.cjs', 'scripts/provider-real-smoke.cjs'
]
for (const relative of removed) {
  try {
    await access(path.join(root, relative))
    throw new Error(`Obsolete native workbench file must be removed: ${relative}`)
  } catch (error) {
    if (error.message?.startsWith('Obsolete')) throw error
  }
}

const html = await readFile(path.join(root, 'renderer/index.html'), 'utf8')
for (const relative of ['./styles.css', './theme-catalog.js', './theme-integration.js', './model-routing-integration.js', './workspace-links-integration.js', './app.js', './assets/deepseek-icon.svg']) {
  if (!html.includes(relative)) throw new Error(`renderer/index.html is missing expected reference: ${relative}`)
}
for (const id of ['runtimeView', 'runtimeStatus', 'runtimeStatusTitle', 'runtimeStatusDetail', 'retryRuntime']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`renderer/index.html is missing desktop shell surface: ${id}`)
}
for (const removedSurface of ['nativeChatSurface', 'webCompatibilitySurface', 'session-sidebar', 'class="rail"', 'desktopSettingsButton', 'settingsOverlay', 'desktop-titlebar']) {
  if (html.includes(removedSurface)) throw new Error(`renderer/index.html must not retain duplicate native workspace surface: ${removedSurface}`)
}

const rendererStyles = await readFile(path.join(root, 'renderer/styles.css'), 'utf8')
if (!html.includes('id="skinQuickButton"') || !html.includes('id="skinPickerOverlay"') || !rendererStyles.includes('.skin-picker-dialog')) {
  throw new Error('The desktop shell must expose a standalone quick skin picker without opening the full official settings dialog.')
}
for (const id of ['updateReadyOverlay', 'updateReadyDetail', 'updateLaterButton', 'updateNowButton', 'updateLaunchError']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`In-app update confirmation is missing: ${id}`)
}
for (const id of ['updateNoticeOverlay', 'updateNoticeTitle', 'updateNoticeNotes', 'updateNoticeLater', 'updateNoticeRelease', 'updateNoticeInstall']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Proactive update notification is missing: ${id}`)
}
if (!rendererStyles.includes('.update-ready-dialog')) throw new Error('In-app update confirmation must inherit the active desktop theme.')
if (!rendererStyles.includes('.update-notice-dialog')) throw new Error('Update release notes notification must inherit the active desktop theme.')

const rendererScript = await readFile(path.join(root, 'renderer/app.js'), 'utf8')
const guestPreload = await readFile(path.join(root, 'electron/guest-preload.cjs'), 'utf8')
if (/window-drag|drag-region/.test(html) || !guestPreload.includes("ipcRenderer.send('window:beginDrag',") || !guestPreload.includes("ipcRenderer.send('window:moveDrag'") || !guestPreload.includes('target.closest(interactiveSelector)')) {
  throw new Error('The frameless desktop shell must move only from dynamically detected blank workbench areas.')
}
if (!rendererScript.includes('api.startRuntime({})')) throw new Error('Official Harness Web UI must start automatically.')
if (!rendererScript.includes("document.addEventListener('pointerdown'") || !rendererScript.includes('petPanel.contains(event.target) || petQuickButton.contains(event.target)') || !rendererScript.includes("runtimeView.addEventListener('focus', closePetPanel)")) {
  throw new Error('The top-bar desktop pet card must close when the user clicks anywhere outside the card, including the isolated official WebView.')
}
if (rendererScript.includes('showCompatibility') || rendererScript.includes('compatibilityMode')) throw new Error('Renderer must expose one official workspace, not native/Web mode switching.')
if (!rendererScript.includes('harness-desktop-update-row') || !rendererScript.includes('api.getUpdatePreferences()')) {
  throw new Error('Desktop and Harness update status must be integrated into the official General settings surface.')
}
if (!rendererScript.includes('element.textContent !== value') || !rendererScript.includes('mountScheduled') || !rendererScript.includes('new MutationObserver(scheduleMount)')) {
  throw new Error('Official settings integration must prevent MutationObserver self-trigger loops.')
}
if (!rendererScript.includes("request('install-update')") || !rendererScript.includes('api.installUpdate()') || !rendererScript.includes('下载并安装桌面版更新')) {
  throw new Error('Official General settings must install verified Harness Desktop updates, not only open a download page.')
}
if (!rendererScript.includes('showUpdateReady(result.version)') || !rendererScript.includes('api.launchReadyUpdate()')) {
  throw new Error('A verified update must use the in-app confirmation before opening the visible installer wizard.')
}
for (const contract of ['showUpdateNotice(result.app', 'normalizedReleaseNotes', 'data-hd-notes', '更新内容', 'officialSubagentEnhancementsBootstrap', 'hd-subagent-panel', 'hd-subagent-running-indicator']) {
  if (!rendererScript.includes(contract)) throw new Error(`Desktop enhancement contract is missing: ${contract}`)
}
const workspaceLinksIntegration = await readFile(path.join(root, 'renderer/workspace-links-integration.js'), 'utf8')
for (const contract of ['data-hd-local-target', 'harness-desktop://${host}', 'MutationObserver', '右键可复制']) {
  if (!workspaceLinksIntegration.includes(contract)) throw new Error(`Workspace local-link integration is missing: ${contract}`)
}
if (!rendererScript.includes('api.openHarnessSettings()') || !rendererScript.includes('api.chooseThemeBackground()') || !rendererScript.includes('themeIntegration.prepareCatalog')) {
  throw new Error('Official settings must integrate desktop file opening, theme selection, and local custom backgrounds.')
}

const themeCatalog = await readFile(path.join(root, 'renderer/theme-catalog.js'), 'utf8')
const themeIntegration = await readFile(path.join(root, 'renderer/theme-integration.js'), 'utf8')
for (const id of ['official', 'maid-atelier', 'catppuccin-mocha', 'nord-aurora', 'dracula-night', 'gruvbox-paper', 'solarized-dawn', 'tokyo-night', 'rose-pine', 'custom']) {
  if (!themeCatalog.includes(`id: '${id}'`)) throw new Error(`Theme catalog is missing: ${id}`)
}
if (!themeCatalog.includes("license: 'CC BY-NC-SA 4.0'") || !themeCatalog.includes('nonCommercial: true')) {
  throw new Error('The non-commercial Deep Whale derivative must retain its license boundary.')
}
if (!themeIntegration.includes("event.detail >= 2") || !themeIntegration.includes("addEventListener('dblclick'") || themeIntegration.includes('>使用</button>')) {
  throw new Error('Theme cards must apply on a real double click without restoring a visible apply button.')
}
if (!themeIntegration.includes('--hd-theme-sidebar') || !themeIntegration.includes('[data-slot="conversation"]')) {
  throw new Error('Theme integration must survive upstream class-name changes and isolate official surface variables.')
}
const startupSplash = html.match(/<section id="startupSplash"[\s\S]*?<\/section>/)?.[0] ?? ''
if ((startupSplash.match(/<path\b/g) || []).length !== 1 || !startupSplash.includes('pathLength="1"') || !rendererScript.includes('requestAnimationFrame(drawStartupFrame)')) {
  throw new Error('The startup experience must adaptively trace the DeepSeek mark with one DOM path.')
}
for (const token of ['--dsw-alias-button-contrast-fill', '--dsw-alias-button-primary-fill', '--dsw-specific-sidebar-nav-item-active']) {
  if (!themeIntegration.includes(token)) throw new Error(`Theme compatibility palette is missing: ${token}`)
}
if (themeIntegration.includes("root.querySelectorAll('div,main,section')") || themeIntegration.includes('getComputedStyle(element).backgroundColor')) {
  throw new Error('Theme integration must not force a full-page layout scan during sidebar updates.')
}
if (!themeIntegration.includes('clearTimeout(mutationTimer)') || !themeIntegration.includes('cancelAnimationFrame(resizeFrame)')) {
  throw new Error('Theme integration must coalesce mutation and resize refresh work.')
}
if (!rendererScript.includes('applyShellTheme()') || !rendererStyles.includes('--shell-surface') || !rendererStyles.includes('--shell-accent')) {
  throw new Error('The standalone skin picker must inherit the selected Harness Desktop theme.')
}
if (!rendererScript.includes("themeId: 'porcelain-mist'") || !(await readFile(path.join(root, 'electron/store/app-state-store.cjs'), 'utf8')).includes("DEFAULT_THEME_ID = 'porcelain-mist'")) {
  throw new Error('Porcelain Mist must remain the first-run desktop theme without overriding later user selections.')
}
if (!rendererScript.includes('api.getModelRouting()') || !rendererScript.includes('api.saveModelRouting(') || !rendererScript.includes("target.hostname === 'save-model-routing'")) {
  throw new Error('Official Models settings must expose independent main-model and subagent routing.')
}
for (const contract of ['openSkinPicker', 'closeSkinPicker()', "card.addEventListener('dblclick'", "api.setTheme(card.dataset.skinId", 'skinPickerOverlay.classList.add']) {
  if (!rendererScript.includes(contract)) throw new Error(`Standalone skin picker behavior is missing: ${contract}`)
}

const modelRoutingIntegration = await readFile(path.join(root, 'renderer/model-routing-integration.js'), 'utf8')
for (const contract of ['主模型与子代理', '跟随主模型', 'data-hd-sub-provider', 'data-hd-sub-model', '不受官方更新覆盖']) {
  if (!modelRoutingIntegration.includes(contract)) throw new Error(`Model routing settings UI is missing: ${contract}`)
}
for (const contract of ['data-hd-sub-mode="inherit"', 'data-hd-sub-mode="independent"', "request('refresh-model-routing')", '选择服务商', '选择模型']) {
  if (!modelRoutingIntegration.includes(contract)) throw new Error(`Simple model routing selector is missing: ${contract}`)
}
for (const duplicateAction of ['data-hd-add-model', 'data-hd-refresh-models', '＋ 添加模型', '↻ 刷新模型']) {
  if (modelRoutingIntegration.includes(duplicateAction)) throw new Error(`The model router must rely on the official provider controls instead of duplicating: ${duplicateAction}`)
}
if (!modelRoutingIntegration.includes("querySelectorAll('#harness-desktop-model-routing').forEach(panel => panel.remove())")) {
  throw new Error('Model routing must unmount immediately when the user leaves the official Models section.')
}
if (!themeIntegration.includes('__HARNESS_DESKTOP_ACTIVE_THEME_SIGNATURE__') || !themeIntegration.includes('mount(false)') || !themeIntegration.includes('[data-color-scheme]')) {
  throw new Error('Theme restoration must be idempotent and override nested upstream theme providers after restart.')
}
if (!themeIntegration.includes('applySessionLogDock') || !themeIntegration.includes('hdSessionLogDocked') || !themeIntegration.includes("style.setProperty('top', '40px'") || !themeIntegration.includes("style.setProperty('right', '12px'") || !themeIntegration.includes("addEventListener('resize'")) {
  throw new Error('Session log must remain docked below the native Windows controls after upstream or viewport changes.')
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (pkg.version !== '1.0.13') throw new Error(`Expected package version 1.0.13, received ${pkg.version}`)
const readme = await readFile(path.join(root, 'README.md'), 'utf8')
for (const contract of [
  `v${pkg.version}`,
  `Harness-Desktop-${pkg.version}-win-x64.exe`,
  `Harness-Desktop-${pkg.version}-portable-x64.exe`,
  'docs/assets/harness-desktop-hero.jpg',
  'releases/latest'
]) {
  if (!readme.includes(contract)) throw new Error(`README release and discovery content is stale or incomplete: ${contract}`)
}
if (pkg.dependencies?.['@deepseek-ai/dsh'] !== '0.1.0-rc.6') throw new Error('Official DeepSeek Harness runtime must remain pinned.')
if (pkg.dependencies?.['@deepseek-ai/cordis-plugin-group'] !== '1.0.1') throw new Error('The DSH boot peer dependency must be pinned explicitly so electron-builder cannot prune it.')
for (const dependency of [
  'dsh-anonymous-user-id', 'dsh-atomic-write', 'dsh-bash-local', 'dsh-code-runtime',
  'dsh-compaction', 'dsh-fs', 'dsh-invariants', 'dsh-output-retention', 'dsh-sandbox',
  'dsh-scope', 'dsh-session-telemetry', 'dsh-session-title-llm', 'dsh-shell', 'dsh-spill',
  'dsh-subagent-in-process-driver', 'dsh-subprocess', 'dsh-timeout', 'dsh-workflow'
]) {
  if (pkg.dependencies?.[`@deepseek-ai/${dependency}`] !== '0.1.0-rc.6') {
    throw new Error(`The DSH Web runtime peer dependency must be pinned explicitly: ${dependency}`)
  }
}
if (pkg.dependencies?.['@earendil-works/pi-ai'] !== '0.82.1') throw new Error('Dynamic provider model discovery must remain pinned to the official Harness catalog dependency.')
if (pkg.dependencies?.yaml !== '2.9.0') throw new Error('Update-safe model routing requires pinned YAML document editing support.')
if (pkg.dependencies?.['dsh-plugin-marketplace'] !== 'github:baiyuscc13724-max/DSH-Plugins-Marketplace#41cf453f1267b535258720dda3966b8643f3a224') {
  throw new Error('The in-app DSH plugin marketplace must remain pinned to the audited upstream commit.')
}
const marketplacePackage = JSON.parse(await readFile(path.join(root, 'node_modules/dsh-plugin-marketplace/package.json'), 'utf8'))
const marketplaceRuntime = await readFile(path.join(root, 'node_modules/dsh-plugin-marketplace/lib/index.js'), 'utf8')
if (marketplacePackage.version !== '1.2.2' || !marketplaceRuntime.includes('process.env.ComSpec') || !marketplaceRuntime.includes('"npm.cmd", ...args')) {
  throw new Error('The bundled marketplace must include the verified Electron/Node 24 Windows npm launcher.')
}
const marketplaceService = await readFile(path.join(root, 'electron/bridge/plugin-marketplace-service.cjs'), 'utf8')
for (const contract of ['HARNESS_DESKTOP_AUTO_ZH_SUMMARY_V1', 'automaticChineseDescription', '查看英文原文', 'translationReady']) {
  if (!marketplaceService.includes(contract)) throw new Error(`Managed marketplace Chinese translation overlay is missing: ${contract}`)
}
if (pkg.dependencies?.['node-pty']) throw new Error('node-pty must not return with the removed native terminal.')
if (pkg.optionalDependencies?.['@deepseek-ai/dsh-sdk-client']) throw new Error('The removed duplicate AgentBridge SDK must not be packaged.')
if (pkg.scripts?.['test:provider:real']) throw new Error('The removed desktop provider smoke script must not return.')
if (pkg.build?.npmRebuild !== true || !pkg.build?.asarUnpack?.some(item => item === 'node_modules/**/*.node')) {
  throw new Error('The bundled Harness runtime requires Electron ABI rebuild while keeping only native modules outside app.asar.')
}
for (const excluded of ['!node_modules/**/*.map', '!node_modules/**/*.{ts,tsx,cts,mts}', '!node_modules/**/{test,tests,__tests__,example,examples,benchmark,benchmarks}/**/*']) {
  if (!pkg.build?.files?.includes(excluded)) throw new Error(`Non-runtime package files must be pruned from the installer: ${excluded}`)
}
if (pkg.build?.icon !== 'build/icon.png') throw new Error('All packages must use the official DeepSeek icon.')
if (pkg.devDependencies?.electron !== '43.2.0') throw new Error('Release baseline requires pinned Electron 43.2.0.')
if (pkg.scripts?.dist !== 'node scripts/build-release.mjs' || !pkg.build?.win?.target?.includes('portable')) throw new Error('Windows release must build the portable target and audited Inno Setup installer.')
if (pkg.build?.win?.target?.includes('nsis') || pkg.build?.nsis) throw new Error('The rejected NSIS installer configuration must not return.')

const officialIcon = await readFile(path.join(root, 'build/icon.png'))
const officialIconHash = createHash('sha256').update(officialIcon).digest('hex')
if (officialIconHash !== '77b823e3d14122b6dfe6ff6089e629d1c6e3fcd1ed7fc0b9e7bf594fe612597c') {
  throw new Error('build/icon.png drifted from the approved official DeepSeek Harness icon.')
}

const main = await readFile(path.join(root, 'electron/main.cjs'), 'utf8')
for (const trayContract of ['createDesktopTray', 'ensureDesktopTray', "mainWindow.on('close'", 'event.preventDefault()', 'mainWindow.hide()', 'isQuitting = true']) {
  if (!main.includes(trayContract)) throw new Error(`Desktop tray lifecycle contract missing: ${trayContract}`)
}
for (const channel of ['runtime:start', 'runtime:state', 'updates:preferences', 'updates:setPreferences', 'updates:check', 'updates:install', 'updates:launchReady', 'updates:install-progress', 'appearance:get', 'appearance:assets', 'appearance:setTheme', 'appearance:saveCustom', 'appearance:chooseBackground', 'settings:openDocument', 'models:routing:get', 'models:routing:save', 'shell:openExternal', 'shell:openLocal']) {
  if (!main.includes(`'${channel}'`)) throw new Error(`electron/main.cjs is missing IPC channel: ${channel}`)
}
for (const removedChannel of ['agent:run', 'session:create', 'git:status', 'workspace:list', 'terminal:start', 'mcp:list', 'skill:list', 'plugin:list', 'provider:get', 'diagnostics:run']) {
  if (main.includes(removedChannel)) throw new Error(`Duplicate native workbench IPC must not return: ${removedChannel}`)
}
for (const contract of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setWindowOpenHandler', 'will-navigate', 'will-attach-webview', 'did-attach-webview', "guest.on('context-menu'", 'showGuestContextMenu', 'normalizeLocalTarget']) {
  if (!main.includes(contract)) throw new Error(`Electron security contract missing: ${contract}`)
}
for (const updateContract of ['net.fetch(', 'fetchJsonWithSystemNetwork', "phase: 'ready'", 'launchReadyAppUpdate', 'openWindowsInstaller', 'shell.openPath', 'ensurePluginMarketplace']) {
  if (!main.includes(updateContract)) throw new Error(`Background updater contract missing: ${updateContract}`)
}
if (main.includes('await fetch(safeUpdateUrl')) throw new Error('Update downloads must use Electron system networking for proxy and direct connections.')
for (const proxyContract of ['buildRuntimeProxyEnv', 'hasExplicitProxy', "resolveProxy('https://chatgpt.com')", 'runtimeProxyEnv']) {
  if (!main.includes(proxyContract)) throw new Error(`Harness runtime proxy bridge is missing: ${proxyContract}`)
}
if (!(await readFile(path.join(root, 'electron/bridge/dsh-resolver.cjs'), 'utf8')).includes("argsPrefix: ['--expose-internals', cli]")) {
  throw new Error('The bundled Harness Web runtime must enable Node internals required by the official HMR plugin.')
}

const runtimePatch = await readFile(path.join(root, 'scripts/patch-official-runtime.mjs'), 'utf8')
for (const contract of ['this.sessions.create({ workspaceId: target })', 'this.sessions.clear()', 'Pinned DSH startSession implementation changed', 'System.Windows.Forms.FolderBrowserDialog', 'patchInstalledDirectoryPicker', 'patchInstalledMarkdownRenderer', 'patchInstalledConversation', 'desktopLocalHref', 'owner.openFile(target)']) {
  if (!runtimePatch.includes(contract)) throw new Error(`Project-scoped New Session patch is missing: ${contract}`)
}
for (const contract of ["HARNESS_DESKTOP_REUSE_RUNTIME === '1'", "'web', '--port', '0'"]) {
  if (!main.includes(contract)) throw new Error(`Dedicated desktop runtime policy is missing: ${contract}`)
}
if (pkg.scripts?.postinstall !== 'node scripts/patch-official-runtime.mjs && electron-builder install-app-deps') {
  throw new Error('Dependency installation must reapply the audited project-scoped New Session patch.')
}

const preload = await readFile(path.join(root, 'electron/preload.cjs'), 'utf8')
for (const api of ['startRuntime', 'getRuntimeState', 'onRuntimeState', 'getUpdatePreferences', 'setUpdatePreferences', 'checkUpdates', 'installUpdate', 'launchReadyUpdate', 'getAppearance', 'setTheme', 'getThemeAssets', 'saveCustomTheme', 'chooseThemeBackground', 'openHarnessSettings', 'getModelRouting', 'saveModelRouting', 'openExternal', 'openLocal', 'onUpdateResult', 'onUpdateInstallProgress']) {
  if (!preload.includes(api)) throw new Error(`preload API missing: ${api}`)
}
for (const removedApi of ['getProviderSettings', 'runDiagnostics', 'listSessions', 'listWorkspaceDirectory', 'startTerminal']) {
  if (preload.includes(removedApi)) throw new Error(`preload must not expose duplicate native workbench API: ${removedApi}`)
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'release'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

const likelyLiveSecret = /sk-[A-Za-z0-9]{30,}/
for await (const file of walk(root)) {
  if (!/\.(?:js|cjs|mjs|json|md|html|css|ya?ml|txt)$/i.test(file)) continue
  const text = await readFile(file, 'utf8').catch(() => '')
  if (likelyLiveSecret.test(text)) throw new Error(`Possible live API key found in source artifact: ${path.relative(root, file)}`)
}

console.log(`Static verification passed for Harness Desktop ${pkg.version}.`)
console.log(`Pinned official DeepSeek Harness runtime: ${pkg.dependencies['@deepseek-ai/dsh']}`)
console.log('Single-workbench contract passed: official Harness Web UI, integrated updates, official icon, minimal IPC, and no obsolete native desktop backend.')
