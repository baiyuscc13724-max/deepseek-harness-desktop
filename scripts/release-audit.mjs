import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (pkg.version !== '1.0.26') throw new Error(`release audit expects 1.0.26, got ${pkg.version}`)
if (!pkg.author?.email) throw new Error('Linux .deb packaging requires a maintainer email in package author metadata.')
if (pkg.main !== 'electron/bootstrap.cjs' || pkg.build?.extraMetadata?.main !== 'electron/bootstrap.cjs') throw new Error('Stable Electron Bootstrap entry drifted.')
if (pkg.build?.asar !== true) throw new Error('Release must keep ASAR enabled.')
if (!pkg.build?.asarUnpack?.some(item => item === 'node_modules/**/*.node')) throw new Error('Native modules must remain outside app.asar.')
for (const helperPath of ['scripts/component-update-helper.cjs', 'electron/bridge/component-update-*.cjs']) {
  if (!pkg.build?.asarUnpack?.includes(helperPath)) throw new Error(`Detached component helper dependency must be physically unpacked: ${helperPath}`)
}
for (const excluded of ['!node_modules/**/*.map', '!node_modules/**/*.{ts,tsx,cts,mts}', '!node_modules/**/{test,tests,__tests__,example,examples,benchmark,benchmarks}/**/*']) {
  if (!pkg.build?.files?.includes(excluded)) throw new Error(`Release must prune non-runtime package files: ${excluded}`)
}
if (pkg.build?.npmRebuild !== true) throw new Error('Bundled official Harness native dependencies must be rebuilt for Electron.')
if (pkg.devDependencies?.electron !== '43.2.0') throw new Error('Release baseline must pin Electron 43.2.0 / Node 24.x.')
if (pkg.devDependencies?.['@microsoft/winappcli'] || !pkg.scripts?.['store:assets']?.includes('@microsoft/winappcli@0.5.0')) throw new Error('Windows-only Store tooling must be fetched only by explicit Store commands so macOS npm ci remains valid.')
if (pkg.dependencies?.['@earendil-works/pi-ai'] !== '0.82.1') throw new Error('Release must pin the provider model catalog used by dynamic routing discovery.')
if (pkg.devDependencies?.['electron-builder'] !== '26.15.7') throw new Error('Release must pin electron-builder 26.15.7.')
if (pkg.build?.icon !== 'build/icon.png') throw new Error('Release packages must use the official DeepSeek icon.')
for (const nativePattern of ['node_modules/@img/**/*', 'node_modules/@koromix/**/*']) {
  if (!pkg.build?.files?.includes(nativePattern) || !pkg.build?.asarUnpack?.includes(nativePattern)) throw new Error(`macOS runtime native dependencies must be explicitly packaged and unpacked: ${nativePattern}`)
}
if (pkg.scripts?.dist !== 'node scripts/build-release.mjs') throw new Error('Release packaging must use the audited cross-platform build script.')
const buildScript = await readFile(path.join(root, 'scripts/build-release.mjs'), 'utf8')
if (!buildScript.includes("'--publish', 'never'")) throw new Error('electron-builder implicit tag publishing must remain disabled.')
for (const contract of ["for (const arch of ['x64', 'arm64'])", "'--ignore-scripts'", "'--include=optional'", "`--cpu=${arch}`", "'--config.npmRebuild=false'"]) {
  if (!buildScript.includes(contract)) throw new Error(`macOS packages must install and package native dependencies independently per architecture: ${contract}`)
}
for (const contract of ["`/DMySourceDir=${path.join(dist, 'win-unpacked')}`", "`/DMyOutputDir=${dist}`", "path.join(root, 'build', 'installer.iss')"]) {
  if (!buildScript.includes(contract)) throw new Error(`The Windows installer must compile from explicit real paths: ${contract}`)
}
if (buildScript.includes("run('subst.exe'")) throw new Error('The Windows installer must not compile through SUBST; it can emit a truncated setup data section.')
if (pkg.scripts?.['release:cnb-cloud'] !== 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/publish-cnb-cloud-mirror.ps1') {
  throw new Error('CNB publishing must use the permanent cloud-mirror command instead of local binary uploads.')
}
const cnbPipeline = await readFile(path.join(root, '.cnb.yml'), 'utf8')
for (const contract of ['image: cnbcool/attachments:latest', 'CNB_TOKEN', 'browser_download_url', 'sha256sum', 'Already present:', 'release-manifest.json']) {
  if (!cnbPipeline.includes(contract)) throw new Error(`CNB cloud mirror contract missing: ${contract}`)
}
for (const forbidden of ['asset-upload-url', '--upload-file', 'PLUGIN_TOKEN']) {
  if (cnbPipeline.includes(forbidden)) throw new Error(`CNB attachments must use the official plugin instead of custom local upload plumbing: ${forbidden}`)
}
const cnbPublisher = await readFile(path.join(root, 'scripts/publish-cnb-cloud-mirror.ps1'), 'utf8')
for (const contract of ['cnb-cloud-release-', 'get-build-status', 'CNB metadata pushed', 'Method Head', 'SHA256SUMS.txt', 'mac-arm64.dmg', 'mac-x64.dmg', 'android-universal.apk', 'GitHub source verification failed', "credential.helper='"]) {
  if (!cnbPublisher.includes(contract)) throw new Error(`CNB cloud publisher contract missing: ${contract}`)
}
for (const forbidden of ['-InFile', '--upload-file', 'asset-upload-url']) {
  if (cnbPublisher.includes(forbidden)) throw new Error(`The local CNB publisher must never transmit release binaries: ${forbidden}`)
}
const releasingGuide = await readFile(path.join(root, 'docs/RELEASING.zh-CN.md'), 'utf8')
if (!releasingGuide.includes('npm run release:cnb-cloud') || !releasingGuide.includes('禁止从本机向 CNB 上传')) {
  throw new Error('The permanent release guide must require CNB cloud mirroring and forbid local large-file uploads.')
}
if (!pkg.build?.win?.target?.includes('portable')) throw new Error('Windows portable target is missing.')
if (pkg.build?.win?.target?.includes('nsis') || pkg.build?.nsis) throw new Error('The blocked NSIS installer must not return.')
for (const target of ['dmg', 'zip']) if (!pkg.build?.mac?.target?.some(entry => entry === target || entry?.target === target)) throw new Error(`macOS target missing: ${target}`)
if (pkg.build?.mac?.hardenedRuntime !== true || pkg.build?.mac?.notarize !== true || pkg.build?.mac?.entitlements !== 'build/entitlements.mac.plist') throw new Error('macOS signing and notarization contract is incomplete.')
for (const target of ['AppImage', 'deb']) if (!pkg.build?.linux?.target?.includes(target)) throw new Error(`Linux target missing: ${target}`)
for (const file of ['build/icon.png', 'build/entitlements.mac.plist', 'build/installer.iss', 'electron/bootstrap.cjs', 'component-update-sources.json', 'mobile-relay-sources.json', 'mobile/ios/project.yml', 'scripts/build-release.mjs', 'scripts/build-mirror-manifest.mjs', 'scripts/publish-cnb-cloud-mirror.ps1', '.cnb.yml', 'docs/RELEASING.zh-CN.md', 'electron/bridge/update-download-service.cjs', 'electron/bridge/update-feed-config.cjs', 'electron/bridge/update-launcher.cjs', 'electron/bridge/plugin-marketplace-service.cjs', 'electron/bridge/local-target-service.cjs', 'electron/bridge/runtime-bundle-service.cjs', 'renderer/workspace-links-integration.js', 'release-mirrors.example.json', 'release-update-sources.json', 'docs/UPDATE-MIRRORS.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md']) await access(path.join(root, file))

const installer = await readFile(path.join(root, 'build/installer.iss'), 'utf8')
for (const contract of ['PrivilegesRequired=lowest', 'DefaultDirName={code:GetDefaultDirName}', 'UsePreviousAppDir=yes', 'CloseApplications=no', '#define MyOutputBaseFilename "Harness-Desktop-" + MyAppVersion + "-win-x64"', 'OutputBaseFilename={#MyOutputBaseFilename}', 'SetupIconFile=..\\dist\\.icon-ico\\icon.ico', 'UninstallDisplayIcon={app}\\{#MyAppExeName}', 'Name: "chinesesimp"', 'compiler:Languages\\ChineseSimplified.isl', 'recursesubdirs', 'autodesktop', 'autoprograms', 'FindLegacyInstallDirectory', 'ReadInstallHint', 'ReadUserInstallLocationFile', 'ReadLastInstallDirectory', 'LastInstallLocation', "RegQueryStringValue(RootKey, Subkey, 'DisplayIcon'", "HasCommandLineParameter('/CLOSEAPPLICATIONS')", "'/NORESTART /LANG=chinesesimp'", 'WizardSilent']) {
  if (!installer.includes(contract)) throw new Error(`Inno Setup contract missing: ${contract}`)
}

const main = await readFile(path.join(root, 'electron/main.cjs'), 'utf8')
for (const contract of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setWindowOpenHandler', 'will-navigate', 'will-attach-webview', 'did-attach-webview', "guest.on('context-menu'", "ipcMain.handle('shell:openLocal'"]) {
  if (!main.includes(contract)) throw new Error(`Electron security contract missing: ${contract}`)
}
for (const contract of ["ipcMain.handle('updates:install'", "ipcMain.handle('updates:launchReady'", 'SHA256SUMS.txt', 'openDesktopInstaller', 'shell.openPath', 'downloadUpdateFile', 'fetchChecksum', 'ensurePluginMarketplace']) {
  if (!main.includes(contract)) throw new Error(`Desktop self-update contract missing: ${contract}`)
}
const updateDownloadService = await readFile(path.join(root, 'electron/bridge/update-download-service.cjs'), 'utf8')
for (const contract of ['DEFAULT_IDLE_TIMEOUT_MS', 'DEFAULT_CHECKSUM_TIMEOUT_MS', 'rejectedInstallerType', 'expectedHash', 'unlinkImpl(destination)']) {
  if (!updateDownloadService.includes(contract)) throw new Error(`Smart mirror fallback contract missing: ${contract}`)
}
for (const source of ['release-update-sources.json', 'release-update-sources.local.json', 'component-update-sources.json', 'mobile-relay-sources.json']) {
  if (!pkg.build?.files?.includes(source)) throw new Error(`Packaged desktop update source is missing: ${source}`)
}
const updateLauncher = await readFile(path.join(root, 'electron/bridge/update-launcher.cjs'), 'utf8')
if (updateLauncher.includes('powershell.exe') || updateLauncher.includes('Wait-Process')) throw new Error('The updater must not depend on a hidden PowerShell handoff.')
if (!updateLauncher.includes('openPath(resolved)')) throw new Error('The updater must launch the verified installer through the Windows shell.')
for (const contract of ['currentInstallDir', '.install-dir', 'writeInstallHint']) {
  if (!updateLauncher.includes(contract)) throw new Error(`The updater must preserve the current install location: ${contract}`)
}
for (const removedContract of ['AgentBridge', 'TerminalManager', 'SessionStore', 'ProviderStore']) {
  if (main.includes(removedContract)) throw new Error(`Obsolete native backend returned to the release: ${removedContract}`)
}

const workflow = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8')
for (const os of ['windows-latest', 'macos-latest', 'ubuntu-latest']) if (!workflow.includes(os)) throw new Error(`CI release OS missing: ${os}`)
if (!workflow.includes('npm run verify')) throw new Error('Release workflow must run verification before packaging.')
if (!workflow.includes('npm run dist')) throw new Error('Release workflow must package artifacts.')
if (!workflow.includes('npm run verify:artifact')) throw new Error('Release workflow must audit built artifacts and write checksums.')
if (!workflow.includes('Run packaged Windows self-test') || !workflow.includes('--self-test') || !workflow.includes('$selfTest = Start-Process') || !workflow.includes('-Wait -PassThru')) throw new Error('Windows release must launch and wait for the packaged app self-test before publishing.')
for (const contract of ['Run packaged macOS architecture and runtime self-tests', "'mac|x86_64|darwin-x64'", "'mac-arm64|arm64|darwin-arm64'", 'node-pty/prebuilds/$prebuild/pty.node', 'spawn-helper', 'harness-desktop-$prebuild-selftest.json']) {
  if (!workflow.includes(contract)) throw new Error(`macOS release self-test contract missing: ${contract}`)
}
if (!workflow.includes('choco install innosetup') || !workflow.includes('Run Windows installer smoke test') || !workflow.includes('/VERYSILENT') || !workflow.includes('Harness Desktop.exe') || !workflow.includes('app.asar') || !workflow.includes('unins*.exe')) throw new Error('Windows release must build, install, inspect, and uninstall the Inno Setup payload.')
if (!workflow.includes('3cfb0e5632828e0dd9b49400a185834e8f1ab570/Files/Languages/ChineseSimplified.isl') || !workflow.includes('e0b0b350e2245f3c5e65586dfe43d574f6e7f06f2261149aba284954b3fc9a8d')) throw new Error('Windows release must install and hash-check the pinned Simplified Chinese language file.')
if (!workflow.includes('softprops/action-gh-release')) throw new Error('Tag builds must publish a GitHub Release after matrix artifacts are audited.')
if (!workflow.includes('download-artifact')) throw new Error('Release job must collect audited matrix artifacts before publishing.')
if (!workflow.includes('find release-artifacts -mindepth 2 -maxdepth 2 -type f')) throw new Error('Release collection must exclude unpacked internal executables.')
if (pkg.build?.linux?.artifactName !== 'Harness-Desktop-${version}-linux-${arch}.${ext}') throw new Error('Linux release filenames must remain checksum-safe and space-free.')

console.log('Release audit passed: official single workbench, official icon, Inno Setup plus portable Windows targets, packaged gates, audited artifacts, and GitHub Release publishing are present.')
