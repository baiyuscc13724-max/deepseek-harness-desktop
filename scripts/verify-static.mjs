import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'electron/main.cjs', 'electron/preload.cjs',
  'electron/bridge/dsh-resolver.cjs', 'electron/bridge/process-spawn.cjs',
  'electron/bridge/update-service.cjs', 'electron/bridge/self-test-service.cjs',
  'electron/store/app-state-store.cjs',
  'renderer/index.html', 'renderer/styles.css', 'renderer/app.js', 'renderer/theme-catalog.js', 'renderer/theme-integration.js',
  'renderer/themes/maid-atelier/maid-atelier-maid-left-v5.webp',
  'renderer/themes/maid-atelier/maid-atelier-maid-right-v6.webp',
  'renderer/themes/maid-atelier/maid-atelier-palace-day-v4.webp',
  'renderer/themes/maid-atelier/maid-atelier-palace-night-v4.webp',
  'renderer/assets/deepseek-icon.svg', 'build/icon.png',
  'tests/app-state-store.test.cjs', 'tests/update-service.test.cjs', 'tests/self-test-service.test.cjs',
  'docs/ARCHITECTURE.zh-CN.md', 'docs/BRANDING.zh-CN.md', 'docs/VALIDATION.zh-CN.md',
  'build/installer.iss', 'scripts/build-release.mjs', 'scripts/release-audit.mjs', 'scripts/packaged-selftest-contract.mjs',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md'
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
for (const relative of ['./styles.css', './theme-catalog.js', './theme-integration.js', './app.js', './assets/deepseek-icon.svg']) {
  if (!html.includes(relative)) throw new Error(`renderer/index.html is missing expected reference: ${relative}`)
}
for (const id of ['runtimeView', 'runtimeStatus', 'runtimeStatusTitle', 'runtimeStatusDetail', 'retryRuntime']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`renderer/index.html is missing desktop shell surface: ${id}`)
}
for (const removedSurface of ['nativeChatSurface', 'webCompatibilitySurface', 'session-sidebar', 'class="rail"', 'desktopSettingsButton', 'settingsOverlay', 'desktop-titlebar']) {
  if (html.includes(removedSurface)) throw new Error(`renderer/index.html must not retain duplicate native workspace surface: ${removedSurface}`)
}

const rendererScript = await readFile(path.join(root, 'renderer/app.js'), 'utf8')
if (!rendererScript.includes('api.startRuntime({})')) throw new Error('Official Harness Web UI must start automatically.')
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
if (!themeIntegration.includes('--hd-theme-sidebar') || !themeIntegration.includes('markThemeSurfaces') || !themeIntegration.includes('[data-slot="conversation"]')) {
  throw new Error('Theme integration must survive upstream class-name changes and isolate official surface variables.')
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (pkg.version !== '0.9.0-rc.3') throw new Error(`Expected package version 0.9.0-rc.3, received ${pkg.version}`)
if (pkg.dependencies?.['@deepseek-ai/dsh'] !== '0.1.0-rc.6') throw new Error('Official DeepSeek Harness runtime must remain pinned.')
if (pkg.dependencies?.['node-pty']) throw new Error('node-pty must not return with the removed native terminal.')
if (pkg.optionalDependencies?.['@deepseek-ai/dsh-sdk-client']) throw new Error('The removed duplicate AgentBridge SDK must not be packaged.')
if (pkg.scripts?.['test:provider:real']) throw new Error('The removed desktop provider smoke script must not return.')
if (pkg.build?.npmRebuild !== true || !pkg.build?.asarUnpack?.some(item => item === 'node_modules/node-pty/**/*')) {
  throw new Error('The bundled official Harness subprocess module requires Electron ABI rebuild and node-pty ASAR unpacking.')
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
for (const channel of ['runtime:start', 'runtime:state', 'updates:preferences', 'updates:setPreferences', 'updates:check', 'updates:install', 'updates:install-progress', 'appearance:get', 'appearance:assets', 'appearance:setTheme', 'appearance:saveCustom', 'appearance:chooseBackground', 'settings:openDocument', 'shell:openExternal']) {
  if (!main.includes(`'${channel}'`)) throw new Error(`electron/main.cjs is missing IPC channel: ${channel}`)
}
for (const removedChannel of ['agent:run', 'session:create', 'git:status', 'workspace:list', 'terminal:start', 'mcp:list', 'skill:list', 'plugin:list', 'provider:get', 'diagnostics:run']) {
  if (main.includes(removedChannel)) throw new Error(`Duplicate native workbench IPC must not return: ${removedChannel}`)
}
for (const contract of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setWindowOpenHandler', 'will-navigate', 'will-attach-webview', 'did-attach-webview']) {
  if (!main.includes(contract)) throw new Error(`Electron security contract missing: ${contract}`)
}

const preload = await readFile(path.join(root, 'electron/preload.cjs'), 'utf8')
for (const api of ['startRuntime', 'getRuntimeState', 'onRuntimeState', 'getUpdatePreferences', 'setUpdatePreferences', 'checkUpdates', 'installUpdate', 'getAppearance', 'setTheme', 'getThemeAssets', 'saveCustomTheme', 'chooseThemeBackground', 'openHarnessSettings', 'openExternal', 'onUpdateResult', 'onUpdateInstallProgress']) {
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
