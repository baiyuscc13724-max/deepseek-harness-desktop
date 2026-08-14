import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (pkg.version !== '0.9.0-rc.8') throw new Error(`release audit expects 0.9.0-rc.8, got ${pkg.version}`)
if (!pkg.author?.email) throw new Error('Linux .deb packaging requires a maintainer email in package author metadata.')
if (pkg.main !== 'electron/main.cjs') throw new Error('Electron main entry drifted.')
if (pkg.build?.asar !== true) throw new Error('Release must keep ASAR enabled.')
if (!pkg.build?.asarUnpack?.some(item => item === 'node_modules/node-pty/**/*')) throw new Error('Bundled official Harness node-pty must be unpacked from ASAR.')
if (pkg.build?.npmRebuild !== true) throw new Error('Bundled official Harness native dependencies must be rebuilt for Electron.')
if (pkg.devDependencies?.electron !== '43.2.0') throw new Error('Release baseline must pin Electron 43.2.0 / Node 24.x.')
if (pkg.devDependencies?.['electron-builder'] !== '26.15.7') throw new Error('Release must pin electron-builder 26.15.7.')
if (pkg.build?.icon !== 'build/icon.png') throw new Error('Release packages must use the official DeepSeek icon.')
if (pkg.scripts?.dist !== 'node scripts/build-release.mjs') throw new Error('Release packaging must use the audited cross-platform build script.')
const buildScript = await readFile(path.join(root, 'scripts/build-release.mjs'), 'utf8')
if (!buildScript.includes("'--publish', 'never'")) throw new Error('electron-builder implicit tag publishing must remain disabled.')
if (!pkg.build?.win?.target?.includes('portable')) throw new Error('Windows portable target is missing.')
if (pkg.build?.win?.target?.includes('nsis') || pkg.build?.nsis) throw new Error('The blocked NSIS installer must not return.')
for (const target of ['dmg', 'zip']) if (!pkg.build?.mac?.target?.includes(target)) throw new Error(`macOS target missing: ${target}`)
for (const target of ['AppImage', 'deb']) if (!pkg.build?.linux?.target?.includes(target)) throw new Error(`Linux target missing: ${target}`)
for (const file of ['build/icon.png', 'build/installer.iss', 'scripts/build-release.mjs', 'electron/bridge/update-launcher.cjs', 'electron/bridge/plugin-marketplace-service.cjs', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md']) await access(path.join(root, file))

const installer = await readFile(path.join(root, 'build/installer.iss'), 'utf8')
for (const contract of ['PrivilegesRequired=lowest', 'DefaultDirName={localappdata}\\Programs\\{#MyAppName}', 'OutputBaseFilename=Harness-Desktop-{#MyAppVersion}-win-x64', 'SetupIconFile=..\\dist\\.icon-ico\\icon.ico', 'UninstallDisplayIcon={app}\\{#MyAppExeName}', 'Name: "chinesesimp"', 'compiler:Languages\\ChineseSimplified.isl', 'recursesubdirs', 'autodesktop', 'autoprograms']) {
  if (!installer.includes(contract)) throw new Error(`Inno Setup contract missing: ${contract}`)
}

const main = await readFile(path.join(root, 'electron/main.cjs'), 'utf8')
for (const contract of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setWindowOpenHandler', 'will-navigate', 'will-attach-webview', 'did-attach-webview']) {
  if (!main.includes(contract)) throw new Error(`Electron security contract missing: ${contract}`)
}
for (const contract of ["ipcMain.handle('updates:install'", "ipcMain.handle('updates:launchReady'", 'SHA256SUMS.txt', 'buildWindowsInstallerHandoff', 'downloadUpdateFile', 'fetchChecksum', 'ensurePluginMarketplace']) {
  if (!main.includes(contract)) throw new Error(`Desktop self-update contract missing: ${contract}`)
}
const updateLauncher = await readFile(path.join(root, 'electron/bridge/update-launcher.cjs'), 'utf8')
for (const contract of ['Wait-Process', 'Start-Process', "'/NORESTART'"]) {
  if (!updateLauncher.includes(contract)) throw new Error(`Installer handoff contract missing: ${contract}`)
}
if (updateLauncher.includes('/VERYSILENT') || updateLauncher.includes('/SUPPRESSMSGBOXES')) throw new Error('In-app updates must open the visible Simplified Chinese installer wizard.')
for (const removedContract of ['AgentBridge', 'TerminalManager', 'SessionStore', 'ProviderStore']) {
  if (main.includes(removedContract)) throw new Error(`Obsolete native backend returned to the release: ${removedContract}`)
}

const workflow = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8')
for (const os of ['windows-latest', 'macos-latest', 'ubuntu-latest']) if (!workflow.includes(os)) throw new Error(`CI release OS missing: ${os}`)
if (!workflow.includes('npm run verify')) throw new Error('Release workflow must run verification before packaging.')
if (!workflow.includes('npm run dist')) throw new Error('Release workflow must package artifacts.')
if (!workflow.includes('npm run verify:artifact')) throw new Error('Release workflow must audit built artifacts and write checksums.')
if (!workflow.includes('Run packaged Windows self-test') || !workflow.includes('--self-test') || !workflow.includes('$selfTest = Start-Process') || !workflow.includes('-Wait -PassThru')) throw new Error('Windows release must launch and wait for the packaged app self-test before publishing.')
if (!workflow.includes('choco install innosetup') || !workflow.includes('Run Windows installer smoke test') || !workflow.includes('/VERYSILENT') || !workflow.includes('Harness Desktop.exe') || !workflow.includes('app.asar') || !workflow.includes('unins*.exe')) throw new Error('Windows release must build, install, inspect, and uninstall the Inno Setup payload.')
if (!workflow.includes('3cfb0e5632828e0dd9b49400a185834e8f1ab570/Files/Languages/ChineseSimplified.isl') || !workflow.includes('e0b0b350e2245f3c5e65586dfe43d574f6e7f06f2261149aba284954b3fc9a8d')) throw new Error('Windows release must install and hash-check the pinned Simplified Chinese language file.')
if (!workflow.includes('softprops/action-gh-release')) throw new Error('Tag builds must publish a GitHub Release after matrix artifacts are audited.')
if (!workflow.includes('download-artifact')) throw new Error('Release job must collect audited matrix artifacts before publishing.')

console.log('Release audit passed: official single workbench, official icon, Inno Setup plus portable Windows targets, packaged gates, audited artifacts, and GitHub Release publishing are present.')
