import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+$/u.test(pkg.version)) throw new Error(`release audit expects a stable semantic version, got ${pkg.version}`)
const releaseTag = `v${pkg.version}`
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
const allowedDependencyHosts = new Set(['registry.npmjs.org', 'registry.npmmirror.com', 'github.com', 'codeload.github.com'])
for (const [packagePath, metadata] of Object.entries(lock.packages || {})) {
  if (!metadata.resolved) continue
  let resolved
  try { resolved = new URL(metadata.resolved) }
  catch { throw new Error(`Dependency lock has an invalid resolved URL at ${packagePath}: ${metadata.resolved}`) }
  if (resolved.protocol !== 'https:' || !allowedDependencyHosts.has(resolved.hostname)) throw new Error(`Dependency lock source is not approved at ${packagePath}: ${metadata.resolved}`)
  if (!/^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/.test(String(metadata.integrity || ''))) throw new Error(`Dependency lock is missing strong integrity at ${packagePath}.`)
}
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
for (const contract of ["'CSC_LINK'", "'CSC_KEY_PASSWORD'", "'APPLE_API_KEY'", "'APPLE_API_KEY_ID'", "'APPLE_API_ISSUER'", "'APPLE_TEAM_ID'", "CSC_IDENTITY_AUTO_DISCOVERY === 'true'", 'macOS unsigned packaging refuses Developer ID / notarization environment', 'macOS unsigned packaging requires CSC_IDENTITY_AUTO_DISCOVERY != true.']) {
  if (!buildScript.includes(contract)) throw new Error(`macOS release packaging must fail closed when signing/notarization input is present (unsigned contract): ${contract}`)
}
for (const contract of ["`/DMySourceDir=${path.join(dist, 'win-unpacked')}`", "`/DMyOutputDir=${dist}`", "path.join(root, 'build', 'installer.iss')"]) {
  if (!buildScript.includes(contract)) throw new Error(`The Windows installer must compile from explicit real paths: ${contract}`)
}
if (buildScript.includes("run('subst.exe'")) throw new Error('The Windows installer must not compile through SUBST; it can emit a truncated setup data section.')
if (pkg.scripts?.['release:cnb-cloud'] !== 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/publish-cnb-cloud-mirror.ps1') {
  throw new Error('CNB publishing must use the permanent cloud-mirror command instead of local binary uploads.')
}
const cnbPipeline = await readFile(path.join(root, '.cnb.yml'), 'utf8')
for (const contract of ['image: cnbcool/attachments:latest', 'CNB_TOKEN', 'browser_download_url', '.sha256 // empty', 'Missing trusted SHA-256', 'sha256sum', 'Already present and verified:', 'release-manifest.json']) {
  if (!cnbPipeline.includes(contract)) throw new Error(`CNB cloud mirror contract missing: ${contract}`)
}
for (const forbidden of ['asset-upload-url', '--upload-file', 'PLUGIN_TOKEN']) {
  if (cnbPipeline.includes(forbidden)) throw new Error(`CNB attachments must use the official plugin instead of custom local upload plumbing: ${forbidden}`)
}
const cnbPublisher = await readFile(path.join(root, 'scripts/publish-cnb-cloud-mirror.ps1'), 'utf8')
for (const contract of ['cnb-cloud-release-', 'get-build-status', 'CNB metadata pushed', 'Method Head', 'SHA256SUMS.txt', 'COMPONENT-SHA256SUMS.txt', 'linux-x86_64.AppImage', 'mac-arm64.dmg', 'mac-x64.dmg', 'android-universal.apk.sha256', 'desktop-shell-', 'components-', 'component-feeds/stable/win32-x64.json', 'component-feeds/stable/darwin-x64.json', 'component-feeds/stable/darwin-arm64.json', 'Stable component feeds must be absent or complete', 'Manifest SHA-256 missing', 'does not match the public GitHub release asset', 'GitHub source verification failed', "credential.helper='"]) {
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
if (pkg.build?.mac?.identity !== null || pkg.build?.mac?.hardenedRuntime === true || pkg.build?.mac?.notarize === true) throw new Error('macOS packages must be explicitly unsigned (identity null, no hardened runtime, no notarization).')
for (const target of ['AppImage', 'deb']) if (!pkg.build?.linux?.target?.includes(target)) throw new Error(`Linux target missing: ${target}`)
for (const file of ['build/icon.png', 'build/entitlements.mac.plist', 'build/installer.iss', 'electron/bootstrap.cjs', 'component-update-sources.json', 'mobile-relay-sources.json', 'mobile/ios/project.yml', 'scripts/build-release.mjs', 'scripts/build-mirror-manifest.mjs', 'scripts/prepare-production-components.mjs', 'scripts/release-orchestrator.mjs', 'scripts/create-component-signing-key.mjs', 'scripts/verify-component-signing-key.mjs', 'scripts/configure-component-signing-backup.ps1', 'scripts/publish-cnb-cloud-mirror.ps1', '.cnb.yml', 'docs/RELEASING.zh-CN.md', `docs/SECURITY-REVIEW-${releaseTag}.zh-CN.md`, 'electron/bridge/update-download-service.cjs', 'electron/bridge/update-feed-config.cjs', 'electron/bridge/update-launcher.cjs', 'electron/bridge/plugin-marketplace-service.cjs', 'electron/bridge/local-target-service.cjs', 'electron/bridge/runtime-bundle-service.cjs', 'renderer/workspace-links-integration.js', 'release-mirrors.example.json', 'release-update-sources.json', 'docs/UPDATE-MIRRORS.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'third_party/licenses/git-credential-manager-2.7.0-LICENSE.txt', 'third_party/licenses/git-lfs-3.7.1-LICENSE.md', 'SECURITY.md']) await access(path.join(root, file))
const signingBackup = await readFile(path.join(root, 'scripts/configure-component-signing-backup.ps1'), 'utf8')
for (const contract of ['--private', 'isPrivate', 'component-production-ed25519-private.encrypted.json', 'HARNESS_COMPONENT_SIGNING_PRIVATE_KEY_BASE64', 'verify-component-signing-key.mjs', '[Array]::Clear']) {
  if (!signingBackup.includes(contract)) throw new Error(`Signing backup automation must keep only encrypted material in a private repository and protect the CI Secret: ${contract}`)
}
for (const forbidden of ['Copy-Item -LiteralPath $private', 'recovery-key', 'Write-Host $privateBase64']) {
  if (signingBackup.includes(forbidden)) throw new Error(`Signing backup automation exposes forbidden material: ${forbidden}`)
}

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
const componentSources = JSON.parse(await readFile(path.join(root, 'component-update-sources.json'), 'utf8'))
if (componentSources.enabled !== true || Object.keys(componentSources.trustedKeys || {}).length !== 1) throw new Error('Production component updates must be enabled with exactly one reviewed trust root for the v1.0.28 bootstrap.')
for (const target of ['win32-x64', 'darwin-x64', 'darwin-arm64']) {
  if (componentSources.targets?.[target]?.length !== 2) throw new Error(`Production component mirrors are incomplete: ${target}`)
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
for (const workflowFile of ['release.yml', 'publish-production-components.yml', 'verify-component-signing-secret.yml', 'android-mobile-release.yml', 'apple-virtual-tests.yml', 'ci.yml', 'upstream-watch.yml']) {
  const source = await readFile(path.join(root, '.github', 'workflows', workflowFile), 'utf8')
  const unpinned = [...source.matchAll(/uses:\s+([^\s#]+)@([^\s#]+)/g)].filter(match => !/^[0-9a-f]{40}$/.test(match[2]))
  if (unpinned.length) throw new Error(`GitHub Actions must be pinned to immutable commits in ${workflowFile}: ${unpinned.map(match => match[0]).join(', ')}`)
}
for (const os of ['windows-latest', 'macos-latest', 'ubuntu-latest']) if (!workflow.includes(os)) throw new Error(`CI release OS missing: ${os}`)
if (!workflow.includes('npm run verify')) throw new Error('Release workflow must run verification before packaging.')
if (!workflow.includes('npm run dist')) throw new Error('Release workflow must package artifacts.')
if (!workflow.includes('npm run verify:artifact')) throw new Error('Release workflow must audit built artifacts and write checksums.')
if (!workflow.includes('Run packaged Windows self-test') || !workflow.includes('--self-test') || !workflow.includes('$selfTest = Start-Process') || !workflow.includes('-Wait -PassThru')) throw new Error('Windows release must launch and wait for the packaged app self-test before publishing.')
for (const contract of ['Run packaged macOS architecture and runtime self-tests', "'mac|x86_64|darwin-x64'", "'mac-arm64|arm64|darwin-arm64'", 'node-pty/prebuilds/$prebuild/pty.node', 'spawn-helper', 'harness-desktop-$prebuild-selftest.json']) {
  if (!workflow.includes(contract)) throw new Error(`macOS release self-test contract missing: ${contract}`)
}
for (const contract of ['Build unsigned macOS packages', "CSC_IDENTITY_AUTO_DISCOVERY: 'false'", 'Verify unsigned macOS packages', 'ditto -x -k', "test -f \"dist/mac/Harness Desktop.app/Contents/Resources/app.asar\""]) {
  if (!workflow.includes(contract)) throw new Error(`macOS unsigned build gate missing: ${contract}`)
}
for (const forbidden of ['macos-signing', 'Prepare Apple notarization API key', 'Build signed and notarized macOS packages', 'xcrun notarytool submit', 'xcrun stapler', 'codesign --verify', 'spctl --assess', 'secrets.APPLE_NOTARY', 'secrets.MACOS_DEVELOPER_ID', 'Remove temporary Apple notarization key']) {
  if (workflow.includes(forbidden)) throw new Error(`macOS unsigned contract forbids signing/notarization gates: ${forbidden}`)
}
if (/jobs:\s*[\s\S]*?build:\s*[\s\S]*?env:\s*[\s\S]*?(?:MACOS_DEVELOPER_ID|APPLE_NOTARY)/u.test(workflow.slice(0, workflow.indexOf('steps:')))) throw new Error('Apple signing Secrets must not be exposed at the matrix job level.')
for (const contract of ['Validate iPhone and iPad simulators', 'Test on iPhone Simulator', 'Test on iPad Simulator', 'needs: [build, ios-simulators]', 'XcodeGen/releases/download/2.46.0/xcodegen.zip', '4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806']) {
  if (!workflow.includes(contract)) throw new Error(`GitHub Release must wait for iPhone/iPad simulator validation: ${contract}`)
}
if (!workflow.includes('choco install innosetup --version=6.7.0 --allow-downgrade --force') || !workflow.includes('Run Windows installer smoke test') || !workflow.includes('/VERYSILENT') || !workflow.includes('Harness Desktop.exe') || !workflow.includes('app.asar') || !workflow.includes('unins*.exe')) throw new Error('Windows release must build, install, inspect, and uninstall the Inno Setup payload.')
if (!workflow.includes('3cfb0e5632828e0dd9b49400a185834e8f1ab570/Files/Languages/ChineseSimplified.isl') || !workflow.includes('e0b0b350e2245f3c5e65586dfe43d574f6e7f06f2261149aba284954b3fc9a8d')) throw new Error('Windows release must install and hash-check the pinned Simplified Chinese language file.')
for (const contract of ['workflow_dispatch:', 'Existing immutable release tag to build and publish', `release-retry/${releaseTag}`, 'ref: ${{ env.RELEASE_TAG }}', "group: release-${{ inputs.tag || (github.ref == 'refs/heads/release-retry/" + releaseTag + "' && '" + releaseTag + "') || github.ref_name }}", 'Ensure target tag matches package version', 'Verify immutable tag checkout', 'gh api --method POST "repos/$GITHUB_REPOSITORY/releases"', 'HTTP 422', 'gh release upload "$RELEASE_TAG" release-files/*', 'stage-draft:', 'verify-windows-draft:', 'publish:', 'Authenticated draft download, checksum, install, self-test, and uninstall', 'https://api.github.com/repos/$env:GITHUB_REPOSITORY/releases/assets/$($asset.id)', 'Authorization = "Bearer $env:GH_TOKEN"', '-OutFile $destination', '$downloaded.Length -ne [int64]$asset.size', 'Snapshot digest mismatch', 'SHA256SUMS.txt', 'Get-FileHash', 'Harness-Desktop-$version-portable-x64.exe', '$portableSelfTest.ExitCode', '--self-test-output=$portableReport', '$portableResult.product.version', '$portableProfile, $portableReport', "--self-test-output=$reportPath", 'product.version', 'resources/app.asar', "Filter 'unins*.exe'", 'Uninstaller left the temporary installation directory behind', 'Reconfirm draft and assets are unchanged before publication', 'draft-snapshot.json', '--draft=false']) {
  if (!workflow.includes(contract)) throw new Error(`Tag builds must atomically stage, id-download, install-test, and publish one verified non-overwriting draft release: ${contract}`)
}
const releaseSnapshotProjection = "{id,tag_name,target_commitish,draft,name,body,prerelease,assets:([.assets[] | {id,name,size,digest}] | sort_by(.name))}"
if (workflow.split(releaseSnapshotProjection).length - 1 !== 3) throw new Error('Stage, Windows verification, and publish must use the identical release snapshot projection exactly once each.')
if (!workflow.includes('needs: stage-draft') || !workflow.includes('needs: verify-windows-draft')) throw new Error('Draft publication jobs must remain strictly ordered: stage, Windows install gate, final publish.')
if (workflow.includes('gh release download') || workflow.includes('--clobber') || workflow.includes('overwrite_files: true')) throw new Error('Desktop release workflow must download by snapshotted asset id and never overwrite an asset.')
const componentPublishWorkflow = await readFile(path.join(root, '.github/workflows/publish-production-components.yml'), 'utf8')
for (const contract of [`component-publish/${releaseTag}`, 'HARNESS_COMPONENT_SIGNING_PRIVATE_KEY_BASE64', 'base64 --decode', "trap 'rm -f", 'prepare-production-components.mjs', 'verify-production-component-staging.mjs', 'Preserve matching assets and identify missing component assets', 'gh release upload', 'Re-download and verify public component assets', 'Sign exact desktop release manifest in protected CI', 'refresh-release-manifest.mjs', 'branch="release-manifest/$RELEASE_TAG"', 'git merge-base --is-ancestor', 'git diff-tree --no-commit-id --name-only -r', 'cmp "$manifest_file"', 'git push origin "HEAD:refs/heads/$branch"']) {
  if (!componentPublishWorkflow.includes(contract)) throw new Error(`Production component publication must verify public signed staging and refuse replacement: ${contract}`)
}
const signingSecretWorkflow = await readFile(path.join(root, '.github/workflows/verify-component-signing-secret.yml'), 'utf8')
for (const contract of [`verify-component-signing-secret/${releaseTag}`, 'HARNESS_COMPONENT_SIGNING_PRIVATE_KEY_BASE64', 'base64 --decode', "trap 'rm -f", 'verify-component-signing-key.mjs']) {
  if (!signingSecretWorkflow.includes(contract)) throw new Error(`Component signing Secret verification must remain isolated and non-exporting: ${contract}`)
}
const manifestRefresher = await readFile(path.join(root, 'scripts/refresh-release-manifest.mjs'), 'utf8')
for (const contract of ['assets: manifestAssets.length', 'asset.digest', 'Unexpected public release asset set', 'mirror_urls', 'COMPONENT-SHA256SUMS.txt', "assetName === 'SHA256SUMS.txt'", '/-/git/raw/main/SHA256SUMS.txt']) {
  if (!manifestRefresher.includes(contract)) throw new Error(`Final release manifest must bind the exact public asset set to GitHub digests and CNB mirrors: ${contract}`)
}
const androidReleaseWorkflow = await readFile(path.join(root, '.github/workflows/android-mobile-release.yml'), 'utf8')
for (const contract of ['seq 1 180', 'android-universal.apk.sha256', 'Preserving the existing immutable APK and deriving its missing checksum when necessary.', 'Verify public signed APK bytes and identity']) {
  if (!androidReleaseWorkflow.includes(contract)) throw new Error(`Android immutable publication contract missing: ${contract}`)
}
if (androidReleaseWorkflow.includes('--clobber')) throw new Error('Android publication must never overwrite public release assets.')
if (!workflow.includes('download-artifact')) throw new Error('Release job must collect audited matrix artifacts before publishing.')
if (!workflow.includes('find release-artifacts -mindepth 2 -maxdepth 2 -type f') || !workflow.includes('Duplicate release asset name')) throw new Error('Release collection must exclude unpacked executables and reject duplicate public names.')
if (pkg.build?.linux?.artifactName !== 'Harness-Desktop-${version}-linux-${arch}.${ext}') throw new Error('Linux release filenames must remain checksum-safe and space-free.')

console.log('Release audit passed: official single workbench, official icon, Inno Setup plus portable Windows targets, packaged gates, audited artifacts, and GitHub Release publishing are present.')
