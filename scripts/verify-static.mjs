import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'electron/bootstrap.cjs', 'electron/main.cjs', 'electron/preload.cjs', 'electron/guest-preload.cjs', 'electron/browser-provenance-preload.cjs', 'electron/desktop-tray.cjs',
  'electron/bridge/dsh-resolver.cjs', 'electron/bridge/dsh-home.cjs', 'electron/bridge/process-spawn.cjs', 'electron/bridge/process-tree.cjs', 'electron/bridge/git-runtime-service.cjs', 'electron/bridge/runtime-proxy.cjs', 'electron/bridge/runtime-bundle-service.cjs',
  'electron/bridge/update-service.cjs', 'electron/bridge/desktop-release-contract.cjs', 'electron/bridge/update-download-service.cjs', 'electron/bridge/update-feed-config.cjs', 'electron/bridge/update-launcher.cjs', 'electron/bridge/self-test-service.cjs', 'electron/bridge/model-routing-service.cjs', 'electron/bridge/provider-meter-service.cjs', 'electron/bridge/plugin-marketplace-service.cjs', 'electron/bridge/local-target-service.cjs',
  'electron/bridge/component-update-contract.cjs', 'electron/bridge/component-update-archive.cjs', 'electron/bridge/component-update-builder.cjs', 'electron/bridge/component-update-config.cjs', 'electron/bridge/component-update-store.cjs', 'electron/bridge/component-update-service.cjs', 'electron/bridge/component-update-helper.cjs', 'electron/bridge/component-update-launcher.cjs', 'electron/bridge/component-update-health.cjs', 'electron/bridge/component-runtime-resolver.cjs',
  'electron/bridge/relay-tunnel-codec.cjs', 'electron/bridge/mobile-relay-config.cjs', 'electron/bridge/sync-transport-manager.cjs', 'electron/bridge/sync-transports/wss-relay-adapter.cjs', 'services/wss-relay/server.cjs', 'services/wss-relay/README.zh-CN.md',
  'electron/bridge/capability-broker.cjs', 'electron/bridge/computer-use-screenshot-store.cjs', 'electron/bridge/storage-scan-service.cjs', 'electron/bridge/storage-cleanup-service.cjs', 'electron/bridge/storage-management-service.cjs', 'electron/bridge/memory-censor.cjs', 'electron/bridge/memory-service.cjs', 'electron/bridge/browser-link-router.cjs', 'electron/bridge/browser-url-policy.cjs', 'electron/bridge/browser-session-policy.cjs', 'electron/bridge/browser-site-authz.cjs', 'electron/bridge/browser-action-gate.cjs', 'electron/bridge/browser-audit.cjs', 'electron/bridge/browser-diagnostics.cjs', 'electron/bridge/browser-history-store.cjs', 'electron/bridge/browser-security-policy.cjs', 'electron/bridge/browser-navigation-guard.cjs', 'electron/bridge/browser-operation-coordinator.cjs', 'electron/bridge/browser-control-server.cjs', 'electron/bridge/computer-use-confirmation-store.cjs',
  'electron/bridge/desktop-directory-picker-plugin-service.cjs', 'plugins/dsh-desktop-directory-picker/package.json', 'plugins/dsh-desktop-directory-picker/lib/index.js', 'plugins/dsh-desktop-directory-picker/lib/client.js', 'electron/bridge/desktop-browser-tools-plugin-service.cjs', 'plugins/dsh-desktop-browser-tools/package.json', 'plugins/dsh-desktop-browser-tools/lib/index.js', 'electron/bridge/desktop-memory-tools-plugin-service.cjs', 'plugins/dsh-desktop-memory-tools/package.json', 'plugins/dsh-desktop-memory-tools/lib/index.js', 'electron/bridge/desktop-mcp-manager-plugin-service.cjs', 'plugins/dsh-desktop-mcp-manager/package.json', 'plugins/dsh-desktop-mcp-manager/lib/index.js', 'plugins/dsh-desktop-mcp-manager/lib/client.js', 'electron/bridge/desktop-schedules-plugin-service.cjs', 'plugins/dsh-desktop-schedules/package.json', 'plugins/dsh-desktop-schedules/lib/index.js', 'plugins/dsh-desktop-schedules/lib/client.js', 'electron/bridge/desktop-files-plugin-service.cjs', 'electron/bridge/right-workspace-service.cjs', 'plugins/dsh-desktop-files/package.json', 'plugins/dsh-desktop-files/lib/index.js', 'plugins/dsh-desktop-files/lib/client.js', 'electron/bridge/desktop-progress-plugin-service.cjs', 'plugins/dsh-desktop-progress/package.json', 'plugins/dsh-desktop-progress/lib/index.js', 'electron/bridge/desktop-compaction-plugin-service.cjs', 'plugins/dsh-desktop-compaction/package.json', 'plugins/dsh-desktop-compaction/lib/index.js', 'electron/bridge/desktop-computer-use-plugin-service.cjs', 'plugins/dsh-desktop-computer-use/package.json', 'plugins/dsh-desktop-computer-use/lib/index.js', 'electron/bridge/agent-teams-plugin-service.cjs', 'plugins/dsh-agent-teams/package.json', 'plugins/dsh-agent-teams/lib/index.js', 'plugins/dsh-agent-teams/lib/client.js', 'electron/bridge/model-admission-plugin-service.cjs', 'plugins/dsh-model-admission/package.json', 'plugins/dsh-model-admission/lib/index.js', 'electron/bridge/session-experience-plugin-service.cjs', 'plugins/dsh-session-experience/package.json', 'plugins/dsh-session-experience/lib/index.js', 'plugins/dsh-session-experience/lib/client.js',
  'electron/store/app-state-store.cjs', 'electron/store/mobile-sync-store.cjs',
  'renderer/index.html', 'renderer/styles.css', 'renderer/app.js', 'renderer/theme-catalog.js', 'renderer/theme-integration.js', 'renderer/model-routing-integration.js', 'renderer/workspace-links-integration.js', 'renderer/storage-manager.js', 'renderer/memory-manager.js', 'renderer/right-workspace.js', 'renderer/right-workspace-integration.js', 'renderer/right-workspace.css', 'renderer/browser-sidebar.js', 'renderer/pet/pet-sprite-rig.js', 'renderer/pets/maid-whale/atlas/maid-whale.atlas.json',
  'renderer/themes/maid-atelier/maid-atelier-maid-left-v5.webp',
  'renderer/themes/maid-atelier/maid-atelier-maid-right-v6.webp',
  'renderer/themes/maid-atelier/maid-atelier-palace-day-v4.webp',
  'renderer/themes/maid-atelier/maid-atelier-palace-night-v4.webp',
  'renderer/assets/deepseek-icon.svg', 'build/icon.png',
  'tests/app-state-store.test.cjs', 'tests/artifact-size-budget.test.cjs', 'tests/capability-broker.test.cjs', 'tests/computer-use-screenshot-store.test.cjs', 'tests/storage-scan-service.test.cjs', 'tests/storage-cleanup-service.test.cjs', 'tests/storage-management-service.test.cjs', 'tests/storage-ui.test.cjs', 'tests/memory-censor.test.cjs', 'tests/memory-service.test.cjs', 'tests/memory-ui.test.cjs', 'tests/browser-link-router.test.cjs', 'tests/browser-link-integration.test.cjs', 'tests/browser-url-policy.test.cjs', 'tests/browser-session-policy.test.cjs', 'tests/browser-site-authz.test.cjs', 'tests/browser-action-gate.test.cjs', 'tests/browser-audit.test.cjs', 'tests/browser-codex-parity.test.cjs', 'tests/browser-diagnostics.test.cjs', 'tests/browser-history-store.test.cjs', 'tests/browser-security-policy.test.cjs', 'tests/browser-navigation-guard.test.cjs', 'tests/fixtures/browser-navigation-guard-electron.cjs', 'tests/browser-operation-coordinator.test.cjs', 'tests/browser-sidebar-ui.test.cjs', 'tests/browser-control-server.test.cjs', 'tests/browser-model-tools-ui.test.cjs', 'tests/desktop-directory-picker-plugin-service.test.cjs', 'tests/desktop-browser-tools-plugin-service.test.cjs', 'tests/desktop-memory-tools-plugin-service.test.cjs', 'tests/desktop-mcp-manager-plugin-service.test.cjs', 'tests/mcp-manager-domain.test.cjs', 'tests/mcp-manager-runtime.test.cjs', 'tests/mcp-manager-ui.test.cjs', 'tests/desktop-schedules.test.cjs', 'tests/desktop-files.test.cjs', 'tests/right-workspace-service.test.cjs', 'tests/right-workspace-ui.test.cjs', 'tests/desktop-progress.test.cjs', 'tests/desktop-compaction.test.cjs', 'tests/desktop-computer-use.test.cjs', 'tests/computer-use-confirmation-store.test.cjs', 'tests/agent-teams-plugin-service.test.cjs', 'tests/agent-teams-domain.test.cjs', 'tests/agent-teams-runtime.test.cjs', 'tests/agent-teams-ui.test.cjs', 'tests/model-admission-plugin-service.test.cjs', 'tests/model-admission-runtime.test.cjs', 'tests/session-experience.test.cjs', 'tests/text-selection-ui.test.cjs', 'tests/ui-mode-integration.test.cjs', 'tests/pet-atlas-lossless.test.cjs',
  'tests/dsh-home.test.cjs', 'tests/user-data-override.test.cjs', 'tests/desktop-release-contract.test.cjs', 'tests/update-service.test.cjs', 'tests/update-download-service.test.cjs', 'tests/update-feed-config.test.cjs', 'tests/mirror-manifest.test.cjs', 'tests/update-launcher.test.cjs', 'tests/self-test-service.test.cjs', 'tests/model-routing-service.test.cjs', 'tests/provider-meter-service.test.cjs', 'tests/provider-meter-adapters.test.cjs', 'tests/plugin-marketplace-service.test.cjs', 'tests/runtime-proxy.test.cjs', 'tests/runtime-bundle-service.test.cjs', 'tests/official-runtime-patch.test.cjs', 'tests/local-target-service.test.cjs', 'tests/desktop-tray.test.cjs', 'tests/startup-animation.test.cjs',
  'tests/component-update-contract.test.cjs', 'tests/component-update-archive.test.cjs', 'tests/component-update-builder.test.cjs', 'tests/release-automation.test.cjs', 'tests/component-update-config.test.cjs', 'tests/component-update-service.test.cjs', 'tests/component-update-helper.test.cjs', 'tests/component-runtime-resolver.test.cjs', 'tests/component-update-ui.test.cjs', 'tests/process-tree.test.cjs', 'tests/mobile-version-sync.test.cjs', 'tests/mobile-relay-config.test.cjs', 'tests/wss-relay.test.cjs',
  'docs/ARCHITECTURE.zh-CN.md', 'docs/COMPETITOR-FEATURE-BENCHMARK.zh-CN.md', 'docs/UPDATE-MIRRORS.zh-CN.md', 'docs/COMPONENT-UPDATES.zh-CN.md', 'docs/CROSS-PLATFORM-MOBILE.zh-CN.md', 'docs/mobile-app-updates.md', 'docs/BRANDING.zh-CN.md', 'docs/VALIDATION.zh-CN.md', 'docs/CLOUD-RELEASE-PIPELINE.zh-CN.md', 'docs/SECURITY-REVIEW-v1.0.42.zh-CN.md', 'docs/assets/harness-desktop-hero.jpg',
  '.github/workflows/apple-virtual-tests.yml', '.github/workflows/android-mobile-release.yml', 'build/installer.iss', 'build/entitlements.mac.plist', 'build/artifact-size-budget.json', 'scripts/artifact-size-budget.mjs', 'scripts/build-maid-whale-atlases.mjs', 'scripts/prepare-bundled-git.mjs', 'scripts/build-release.mjs', 'scripts/build-mirror-manifest.mjs', 'scripts/build-component-update.mjs', 'scripts/prepare-production-components.mjs', 'scripts/release-orchestrator.mjs', 'scripts/component-update-helper.cjs', 'scripts/create-component-signing-key.mjs', 'scripts/create-android-release-keystore.ps1', 'scripts/local-component-update-test.mjs', 'scripts/mirror-manifest-lib.mjs', 'scripts/release-audit.mjs', 'scripts/packaged-selftest-contract.mjs', 'scripts/patch-official-runtime.mjs',
  'mobile/mobile-app-update.example.json', 'mobile/ios/project.yml', 'mobile/ios/README.zh-CN.md', 'mobile/ios/HarnessMobile/App/HarnessMobileApp.swift', 'mobile/ios/HarnessMobile/App/ContentView.swift', 'mobile/ios/HarnessMobile/App/WorkbenchView.swift', 'mobile/ios/HarnessMobile/App/QRScannerView.swift', 'mobile/ios/HarnessMobile/Core/PairingProfile.swift', 'mobile/ios/HarnessMobile/Core/PairingStore.swift', 'mobile/ios/HarnessMobile/Core/LoopbackProxy.swift', 'mobile/ios/HarnessMobile/Core/RelayTunnelCodec.swift', 'mobile/ios/HarnessMobile/Core/RelayTunnelClient.swift', 'mobile/ios/HarnessMobile/Core/MobileAppUpdateChecker.swift', 'mobile/ios/HarnessMobile/Resources/Info.plist', 'mobile/ios/HarnessMobile/Resources/PrivacyInfo.xcprivacy',
  'mobile/android/RELEASE-SIGNING.zh-CN.md', 'mobile/android/app/src/main/AndroidManifest.xml', 'mobile/android/app/src/main/res/xml/mobile_update_paths.xml', 'mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileAppUpdateChecker.java', 'mobile/android/app/src/main/java/io/harnessdesktop/mobile/RelayTunnelCodec.java', 'mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java', 'mobile/android/app/src/main/java/io/harnessdesktop/mobile/PairingProfileStore.java', 'mobile/android/app/src/main/java/io/harnessdesktop/mobile/NetworkReconnectPolicy.java',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'release-manifest.json', 'release-mirrors.example.json', 'release-update-sources.json', 'release-update-sources.example.json', 'component-update-sources.json', 'mobile-relay-sources.json', 'component-release.example.json', 'component-release.macos-arm64.example.json'
]

// Agent Teams M2-M5 are executable product surfaces, not optional design files.
// Keep every security boundary and its regression suite inside the static release gate.
required.push(
  'docs/AGENT-TEAMS-ARCHITECTURE.zh-CN.md',
  'docs/AGENT-TEAMS-USER-GUIDE.zh-CN.md',
  'electron/bridge/git-runtime-service.cjs',
  'plugins/dsh-agent-teams/lib/artifact-cas.js',
  'plugins/dsh-agent-teams/lib/defect-lifecycle.js',
  'plugins/dsh-agent-teams/lib/defect-lifecycle-service.js',
  'plugins/dsh-agent-teams/lib/desktop-git-capability.js',
  'plugins/dsh-agent-teams/lib/external-defect-connectors.js',
  'plugins/dsh-agent-teams/lib/external-defect-outbox.js',
  'plugins/dsh-agent-teams/lib/git-workspace-adapter.js',
  'plugins/dsh-agent-teams/lib/project-automation-domain.js',
  'plugins/dsh-agent-teams/lib/project-automation-service.js',
  'plugins/dsh-agent-teams/lib/project-automation-store.js',
  'plugins/dsh-agent-teams/lib/project-automation-web.js',
  'plugins/dsh-agent-teams/lib/project-business-sync-domain.js',
  'plugins/dsh-agent-teams/lib/project-business-sync-runtime.js',
  'plugins/dsh-agent-teams/lib/project-business-sync-service.js',
  'plugins/dsh-agent-teams/lib/project-business-sync-store.js',
  'plugins/dsh-agent-teams/lib/project-authority-service.js',
  'plugins/dsh-agent-teams/lib/project-entry-service.js',
  'plugins/dsh-agent-teams/lib/project-foundations-runtime.js',
  'plugins/dsh-agent-teams/lib/project-lan-transport.js',
  'plugins/dsh-agent-teams/lib/project-secure-channel.js',
  'plugins/dsh-agent-teams/lib/project-state-store.js',
  'plugins/dsh-agent-teams/lib/project-wss-relay-transport.js',
  'plugins/dsh-agent-teams/lib/project-task-actor.js',
  'plugins/dsh-agent-teams/lib/project-task-crypto.js',
  'plugins/dsh-agent-teams/lib/project-task-domain.js',
  'plugins/dsh-agent-teams/lib/project-task-service.js',
  'plugins/dsh-agent-teams/lib/project-task-store.js',
  'plugins/dsh-agent-teams/lib/project-task-web.js',
  'plugins/dsh-agent-teams/lib/quality-evidence.js',
  'plugins/dsh-agent-teams/lib/test-orchestrator.js',
  'plugins/dsh-agent-teams/lib/test-orchestrator-service.js',
  'plugins/dsh-agent-teams/lib/workspace-authority.js',
  'plugins/dsh-agent-teams/lib/workspace-authority-service.js',
  'tests/artifact-cas.test.cjs',
  'tests/defect-lifecycle.test.cjs',
  'tests/defect-lifecycle-service.test.cjs',
  'tests/desktop-git-capability.test.cjs',
  'tests/external-defect-connectors.test.cjs',
  'tests/external-defect-outbox.test.cjs',
  'tests/git-bundle-transfer.test.cjs',
  'tests/git-runtime-service.test.cjs',
  'tests/git-workspace-adapter.test.cjs',
  'tests/project-automation-domain.test.cjs',
  'tests/project-automation-service.test.cjs',
  'tests/project-automation-store.test.cjs',
  'tests/project-automation-web.test.cjs',
  'tests/project-business-sync-domain.test.cjs',
  'tests/project-business-sync-api.test.cjs',
  'tests/project-business-sync-runtime.test.cjs',
  'tests/project-business-sync-service.test.cjs',
  'tests/project-business-sync-store.test.cjs',
  'tests/project-authority-service.test.cjs',
  'tests/project-entry-service.test.cjs',
  'tests/project-foundations-runtime.test.cjs',
  'tests/project-foundations-tools.test.cjs',
  'tests/project-lan-transport.test.cjs',
  'tests/project-secure-channel.test.cjs',
  'tests/project-state-store.test.cjs',
  'tests/project-wss-relay-transport.test.cjs',
  'tests/project-task-api.test.cjs',
  'tests/project-task-domain.test.cjs',
  'tests/project-task-service.test.cjs',
  'tests/project-task-store.test.cjs',
  'tests/project-task-web.test.cjs',
  'tests/quality-evidence.test.cjs',
  'tests/test-orchestrator.test.cjs',
  'tests/test-orchestrator-service.test.cjs',
  'tests/workspace-authority.test.cjs',
  'tests/workspace-authority-service.test.cjs',
)
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
for (const relative of ['./styles.css', './theme-catalog.js', './theme-integration.js', './model-routing-integration.js', './workspace-links-integration.js', './storage-manager.js', './memory-manager.js', './right-workspace.css', './right-workspace.js', './right-workspace-integration.js', './browser-sidebar.js', './app.js', './assets/deepseek-icon.svg']) {
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
for (const obsoleteAttachmentShim of ['webUtils.getPathForFile(file)', "ipcRenderer.invoke('attachments:inspect'", 'data-hd-attachment-toast', 'dispatchNativeImages(nativeImages)']) {
  if (guestPreload.includes(obsoleteAttachmentShim)) throw new Error(`Desktop must defer file, session and image references to official Harness rc.2: ${obsoleteAttachmentShim}`)
}
if (!rendererScript.includes('api.startRuntime({})')) throw new Error('Official Harness Web UI must start automatically.')
if (!rendererScript.includes("document.addEventListener('pointerdown'") || !rendererScript.includes('petPanel.contains(event.target) || petQuickButton.contains(event.target)') || !rendererScript.includes("runtimeView.addEventListener('focus', closePetPanel)")) {
  throw new Error('The top-bar desktop pet card must close when the user clicks anywhere outside the card, including the isolated official WebView.')
}
if (rendererScript.includes('showCompatibility') || rendererScript.includes('compatibilityMode')) throw new Error('Renderer must expose one official workspace, not native/Web mode switching.')
if (!rendererScript.includes('harness-desktop-update-row') || !rendererScript.includes('api.getUpdatePreferences()')) {
  throw new Error('Desktop and Harness update status must be integrated into the official General settings surface.')
}
for (const contract of ['dataset.hdSettingsLayout', 'dataset.hdSettingsContent', 'dataset.hdSettingsOptions', 'width:min(1120px']) {
  if (!rendererScript.includes(contract)) throw new Error(`The functional settings dialog layout enhancement is missing: ${contract}`)
}
if (!rendererScript.includes('element.textContent !== value') || !rendererScript.includes('mountScheduled') || !rendererScript.includes('new MutationObserver(scheduleMount)')) {
  throw new Error('Official settings integration must prevent MutationObserver self-trigger loops.')
}
if (!rendererScript.includes("request('install-update')") || !rendererScript.includes('api.installUpdate()') || !rendererScript.includes('下载并安装桌面版更新')) {
  throw new Error('Official General settings must install verified Harness Desktop updates, not only open a download page.')
}
if (!rendererScript.includes('showUpdateReady(version') || !rendererScript.includes('api.launchReadyUpdate()') || !rendererScript.includes('api.applyComponentUpdates()')) {
  throw new Error('A verified update must use the in-app confirmation before opening the visible installer wizard.')
}
for (const contract of ['showUpdateNotice(result.app', 'normalizedReleaseNotes', 'data-hd-notes', '更新内容', 'officialSubagentEnhancementsBootstrap', 'hd-subagent-panel', 'hd-subagent-running-indicator']) {
  if (!rendererScript.includes(contract)) throw new Error(`Desktop enhancement contract is missing: ${contract}`)
}
const workspaceLinksIntegration = await readFile(path.join(root, 'renderer/workspace-links-integration.js'), 'utf8')
for (const contract of ['data-hd-local-target', 'harness-desktop://${host}', 'MutationObserver', '右键可复制']) {
  if (!workspaceLinksIntegration.includes(contract)) throw new Error(`Workspace local-link integration is missing: ${contract}`)
}
if (!rendererScript.includes('api.openHarnessSettings()') || !rendererScript.includes('api.chooseThemeBackground()') || !rendererScript.includes('api.chooseWallpaperEngine()') || !rendererScript.includes('api.importCurrentWallpaperEngine()') || !rendererScript.includes('themeIntegration.prepareCatalog')) {
  throw new Error('Official settings must integrate desktop file opening, theme selection, local media backgrounds, and Wallpaper Engine imports.')
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
if (!themeIntegration.includes('html[data-hd-theme="custom"] body::before')) {
  throw new Error('The custom wallpaper must stay outside the workbench layout so it cannot alter fixed dialog positioning.')
}
for (const contract of ['html[data-hd-theme="custom"] body::after', 'background-size:cover,contain', '--hd-wallpaper-contain', '--hd-wallpaper-overlay', 'blur(calc(var(--hd-wallpaper-blur,2px) + 22px))']) {
  if (!themeIntegration.includes(contract)) throw new Error(`Custom wallpapers must keep the full image above a blurred fill layer with a readable content overlay: ${contract}`)
}
if (!rendererScript.includes('center/contain no-repeat') || rendererStyles.includes('background-size:cover!important')) {
  throw new Error('The custom wallpaper preview must show the complete image instead of forcing a cropped cover preview.')
}
const customForegroundRule = themeIntegration.match(/html\[data-hd-theme="custom"\] body::after \{[^}]+\}/)?.[0] || ''
if (!customForegroundRule || customForegroundRule.includes(' blur(') || !themeIntegration.includes('填充背景模糊')) {
  throw new Error('The contained foreground wallpaper must stay sharp while only the fill layer uses the blur control.')
}
if (themeIntegration.includes('html[data-hd-theme="custom"] [data-hd-surface="sidebar"] { backdrop-filter')) {
  throw new Error('The custom sidebar must not use backdrop-filter because it traps fixed settings dialogs inside the sidebar containing block.')
}
const auroraSidebarRule = 'html[data-hd-ui-mode="aurora"] [data-hd-surface="sidebar"]'
const auroraDialogSafety = 'html[data-hd-ui-mode="aurora"] [data-hd-surface="sidebar"]:has([role="dialog"][aria-modal="true"]) { backdrop-filter:none!important; }'
if (!themeIntegration.includes(auroraDialogSafety) || themeIntegration.indexOf(auroraDialogSafety) < themeIntegration.indexOf(auroraSidebarRule)) {
  throw new Error('Aurora mode must remove the sidebar containing block while the official fixed settings dialog is open.')
}
if (!themeIntegration.includes('hexWithOpacity(surface, surfaceOpacity * .48)') || !themeIntegration.includes('hexWithOpacity(surface, surfaceOpacity * .70)')) {
  throw new Error('The custom sidebar and composer must follow the full 0-100 transparency range without hidden opacity floors.')
}
for (const readabilityContract of ['readabilityStrength', '--hd-theme-text-shadow', 'readableTextShadow', 'input::placeholder', 'max="100"']) {
  if (!themeIntegration.includes(readabilityContract) && !html.includes(readabilityContract)) {
    throw new Error(`Transparent custom themes must preserve readable text and expose the extended glass range: ${readabilityContract}`)
  }
}
if (!themeIntegration.includes('container-type:inline-size') || !themeIntegration.includes('@container (max-width:660px)')) {
  throw new Error('The custom theme editor must respond to its own settings-panel width instead of overflowing based on viewport width.')
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
if (!themeIntegration.includes('clearTimeout(mutationTimer)') || !themeIntegration.includes('mutationTimer = setTimeout')) {
  throw new Error('Theme integration must coalesce mutation refresh work.')
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
for (const contract of ['api.getProviderMeters(false)', 'api.getProviderMeters(true)', "target.hostname === 'refresh-provider-meters'", 'meters: { ...meters']) {
  if (!rendererScript.includes(contract)) throw new Error(`Provider meter renderer contract is missing: ${contract}`)
}
for (const contract of [
  'openSkinPicker',
  'closeSkinPicker()',
  "card.addEventListener('dblclick'",
  "api.setTheme(card.dataset.skinId",
  'themeIntegration.createSkinPickerHost(',
  'skinPickerHost.open({ fromSettings })',
  'skinPickerHost.close()',
  'skinPickerHost.apply(',
  "openSkinPicker({ fromSettings: target.searchParams.get('source') === 'settings' })"
]) {
  if (!rendererScript.includes(contract)) throw new Error(`Standalone skin picker behavior is missing: ${contract}`)
}
for (const contract of [
  "request('open-appearance', { source: 'settings' })",
  '__HARNESS_DESKTOP_APPEARANCE_HOST_DIALOG__',
  '__HARNESS_DESKTOP_CLOSE_SETTINGS_DIALOG__',
  'createSettingsDialogCloser',
  '/^(?:关闭|close|×)$/i.test(text)',
  'closeDesktopSettingsDialog'
]) {
  if (!themeIntegration.includes(contract)) throw new Error(`Settings-hosted appearance close behavior is missing: ${contract}`)
}

const modelRoutingIntegration = await readFile(path.join(root, 'renderer/model-routing-integration.js'), 'utf8')
for (const contract of ['主模型与子代理', '跟随主模型', 'data-hd-sub-provider', 'data-hd-sub-model', '不受官方更新覆盖']) {
  if (!modelRoutingIntegration.includes(contract)) throw new Error(`Model routing settings UI is missing: ${contract}`)
}
for (const contract of ['data-hd-sub-mode="inherit"', 'data-hd-sub-mode="independent"', "request('refresh-model-routing')", '选择服务商', '选择模型']) {
  if (!modelRoutingIntegration.includes(contract)) throw new Error(`Simple model routing selector is missing: ${contract}`)
}
for (const contract of ['账户额度', 'usage-window', 'spending-budget', 'token-counter', 'data-hd-meter-refresh', '不同服务商会按余额、套餐用量或消费限额显示']) {
  if (!modelRoutingIntegration.includes(contract)) throw new Error(`Generic provider meter UI is missing: ${contract}`)
}
for (const duplicateAction of ['data-hd-add-model', 'data-hd-refresh-models', '＋ 添加模型', '↻ 刷新模型']) {
  if (modelRoutingIntegration.includes(duplicateAction)) throw new Error(`The model router must rely on the official provider controls instead of duplicating: ${duplicateAction}`)
}
if (!modelRoutingIntegration.includes("querySelectorAll('#harness-desktop-model-routing,#harness-desktop-model-tabs').forEach(element => element.remove())")) {
  throw new Error('Model routing tabs must unmount immediately when the user leaves the official Models section.')
}
if (!themeIntegration.includes('__HARNESS_DESKTOP_ACTIVE_THEME_SIGNATURE__') || !themeIntegration.includes('mount(false)') || !themeIntegration.includes('[data-color-scheme]')) {
  throw new Error('Theme restoration must be idempotent and override nested upstream theme providers after restart.')
}
if (themeIntegration.includes('applySessionLogDock') || themeIntegration.includes('hdSessionLogDocked') || themeIntegration.includes("style.setProperty('top', '40px'") || themeIntegration.includes("style.setProperty('right', '12px'")) {
  throw new Error('Session log must stay in the upstream layout instead of overlapping native Windows controls.')
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+$/u.test(pkg.version)) throw new Error(`Expected a stable semantic package version, received ${pkg.version}`)
if (pkg.dependencies?.['dsh-progress-reporter']) throw new Error('dsh-progress-reporter must remain an opt-in community plugin instead of a bundled desktop dependency.')
if (pkg.main !== 'electron/bootstrap.cjs' || pkg.build?.extraMetadata?.main !== 'electron/bootstrap.cjs') throw new Error('Component updates require the stable Electron bootstrap entrypoint.')
if (pkg.scripts?.['release:components'] !== 'node scripts/build-component-update.mjs') throw new Error('Component release builder command is missing.')
if (pkg.scripts?.['test:component-local'] !== 'node scripts/local-component-update-test.mjs') throw new Error('Local component restart/rollback test command is missing.')
for (const helperPath of ['scripts/component-update-helper.cjs', 'electron/bridge/component-update-*.cjs']) {
  if (!pkg.build?.asarUnpack?.includes(helperPath)) throw new Error(`Detached component helper must be unpacked: ${helperPath}`)
}
const modelAdmissionBundle = 'plugins/dsh-model-admission/**/*'
if (!pkg.build?.files?.includes(modelAdmissionBundle) || !pkg.build?.asarUnpack?.includes(modelAdmissionBundle)) {
  throw new Error('The Host-only model admission plugin must be packaged and unpacked for profile installation.')
}
const modelAdmissionManifest = JSON.parse(await readFile(path.join(root, 'plugins/dsh-model-admission/package.json'), 'utf8'))
if (modelAdmissionManifest.name !== 'dsh-model-admission' || modelAdmissionManifest.version !== pkg.version || modelAdmissionManifest.type !== 'module' || modelAdmissionManifest.main !== 'lib/index.js' || modelAdmissionManifest.exports?.['.'] !== './lib/index.js' || modelAdmissionManifest.dsh?.client !== undefined) {
  throw new Error('The bundled model admission manifest must match the desktop version and remain Host-only.')
}
for (const bundled of ['component-update-sources.json', 'mobile-relay-sources.json', 'scripts/component-update-helper.cjs']) {
  if (!pkg.build?.files?.includes(bundled)) throw new Error(`Packaged component updater support file is missing: ${bundled}`)
}
if (pkg.scripts?.['dist:mac'] !== 'node scripts/build-release.mjs') throw new Error('macOS release packaging must use the audited fail-closed release builder.')
if (pkg.build?.mac?.artifactName !== 'Harness-Desktop-${version}-mac-${arch}.${ext}' || pkg.build?.mac?.identity !== null || pkg.build?.mac?.hardenedRuntime === true || pkg.build?.mac?.notarize === true || pkg.build?.mac?.minimumSystemVersion !== '12.0') throw new Error('macOS unsigned packaging contract is incomplete (identity must be null, hardened runtime and notarization must stay disabled).')
const releaseWorkflow = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8')
for (const contract of ['Build unsigned macOS packages', "CSC_IDENTITY_AUTO_DISCOVERY: 'false'", 'Verify unsigned macOS packages', 'ditto -x -k']) {
  if (!releaseWorkflow.includes(contract)) throw new Error(`macOS unsigned workflow contract is missing: ${contract}`)
}
for (const contract of ['name: Cloud Build & Release Desktop', 'HARNESS_RELEASE_PACKAGING_MODE: github-actions-only', 'product_revision:', 'PUBLISHER_PRODUCT_REVISION', 'git rev-parse HEAD', 'git rev-list -n 1 "$RELEASE_TAG"', 'Verify packaged Windows component health and rollback', 'npm run test:component-local']) {
  if (!releaseWorkflow.includes(contract)) throw new Error(`Cloud-only release workflow contract is missing: ${contract}`)
}
if ((releaseWorkflow.match(/Bind cloud package build to immutable source revision/gu) || []).length !== 3) throw new Error('Every cloud build, iOS gate, and draft staging job must bind the immutable product revision.')
if (releaseWorkflow.includes('release-retry/v')) throw new Error('Desktop release packaging must not be triggered by a mutable retry branch.')
for (const forbidden of ['macos-signing', 'Prepare Apple notarization API key', 'Build signed and notarized macOS packages', 'xcrun notarytool submit', 'xcrun stapler', 'codesign --verify', 'spctl --assess', 'Remove temporary Apple notarization key']) {
  if (releaseWorkflow.includes(forbidden)) throw new Error(`macOS unsigned workflow contract forbids signing/notarization gates: ${forbidden}`)
}
const macTargets = pkg.build?.mac?.target || []
for (const target of ['dmg', 'zip']) {
  const value = macTargets.find(entry => entry?.target === target)
  if (!value || !['x64', 'arm64'].every(arch => value.arch?.includes(arch))) throw new Error(`macOS ${target} target must cover Intel and Apple Silicon.`)
}
const desktopMain = await readFile(path.join(root, 'electron/main.cjs'), 'utf8')
for (const contract of ['createWssRelayAdapter', 'loadMobileRelayConfig', "detached: process.platform !== 'win32'", 'terminateProcessTree(child)', 'runtimeProbeOptions: { runtimeHome: desktopDshHome(), logOutput: true, timeoutMs: 180_000 }', 'ensureComputerUseScreenshotStore().save(scaled.toPNG())', 'clearComputerUseScreenshots()']) {
  if (!desktopMain.includes(contract)) throw new Error(`Cross-platform desktop runtime contract is missing: ${contract}`)
}
const iosInfo = await readFile(path.join(root, 'mobile/ios/HarnessMobile/Resources/Info.plist'), 'utf8')
for (const contract of ['NSCameraUsageDescription', 'NSLocalNetworkUsageDescription', 'NSAllowsLocalNetworking', 'harnessmobile']) {
  if (!iosInfo.includes(contract)) throw new Error(`iOS pairing declaration is missing: ${contract}`)
}
if (iosInfo.includes('UIBackgroundModes')) throw new Error('iOS client must not claim unsupported persistent background networking.')
const appleWorkflow = await readFile(path.join(root, '.github/workflows/apple-virtual-tests.yml'), 'utf8')
const iosProject = await readFile(path.join(root, 'mobile/ios/project.yml'), 'utf8')
if (!iosProject.includes('xcodeVersion: "16.0"')) throw new Error('iOS project generation must target the selected Xcode 16 cloud image.')
if (iosProject.includes('PRODUCT_NAME:')) throw new Error('The iOS target executable name must remain HarnessMobile so its unit-test host resolves correctly; use CFBundleDisplayName for branding.')
if (!iosProject.includes('HarnessMobileUpdateManifestURL: ""')) throw new Error('The iOS app update feed must remain disabled until a reviewed Store release configures it.')
const androidMobileUpdater = await readFile(path.join(root, 'mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileAppUpdateChecker.java'), 'utf8')
for (const contract of ['schemaVersion', 'sha256', 'endsWith(".apk")', 'https', 'downloadAndVerify', 'verifyInstalledSigningIdentity']) if (!androidMobileUpdater.includes(contract)) throw new Error(`Android mobile updater contract is missing: ${contract}`)
const iosMobileUpdater = await readFile(path.join(root, 'mobile/ios/HarnessMobile/Core/MobileAppUpdateChecker.swift'), 'utf8')
for (const contract of ['apps.apple.com', 'testflight.apple.com', 'schemaVersion', 'https']) if (!iosMobileUpdater.includes(contract)) throw new Error(`iOS mobile updater contract is missing: ${contract}`)
for (const contract of ['workflow_dispatch:', 'runs-on: macos-14', 'Select Xcode 16', 'XcodeGen/releases/download/2.46.0/xcodegen.zip', '4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806', 'xcodegen generate', 'iPhone Simulator', 'iPad Simulator', 'xcodebuild test', 'Build unsigned Intel app bundle', 'Build unsigned Apple Silicon app bundle', '--cpu=x64', '--cpu=arm64', 'CODE_SIGNING_ALLOWED=NO']) {
  if (!appleWorkflow.includes(contract)) throw new Error(`Apple virtual-device test contract is missing: ${contract}`)
}
for (const forbidden of ['upload-artifact', 'softprops/action-gh-release', 'contents: write']) {
  if (appleWorkflow.includes(forbidden)) throw new Error(`Apple virtual test workflow must not publish artifacts: ${forbidden}`)
}
const mobileSourceVersion = pkg.version
const mobileVersionParts = mobileSourceVersion.split('.').map(Number)
const mobileBuildNumber = mobileVersionParts[0] * 10000 + mobileVersionParts[1] * 100 + mobileVersionParts[2]
const androidBuild = await readFile(path.join(root, 'mobile/android/app/build.gradle.kts'), 'utf8')
if (!androidBuild.includes(`versionCode = ${mobileBuildNumber}`) || !androidBuild.includes(`versionName = "${mobileSourceVersion}"`)) throw new Error('Android mobile source version must stay synchronized with the desktop integration version.')
for (const contract of ['HARNESS_ANDROID_KEYSTORE_PATH', 'HARNESS_ANDROID_KEY_ALIAS', 'HARNESS_ANDROID_STORE_PASSWORD', 'HARNESS_ANDROID_KEY_PASSWORD', 'verifyReleaseSigningConfiguration', 'enableV3Signing = true']) {
  if (!androidBuild.includes(contract)) throw new Error(`Android release signing configuration is incomplete: ${contract}`)
}
const androidReleaseWorkflow = await readFile(path.join(root, '.github/workflows/android-mobile-release.yml'), 'utf8')
for (const contract of ['ANDROID_RELEASE_KEYSTORE_BASE64', 'ANDROID_RELEASE_CERT_SHA256', '092aea424b7e2edadd648967b7a9f909997fc028072532aea6cf459fcebf1c21', 'assembleRelease', 'apksigner', 'io.harnessdesktop.mobile', "expected_version_code=\"$(node -e", 'Harness-Mobile-${version}-android-universal.apk', 'RELEASE_TAG: ${{ inputs.tag || github.ref_name }}', 'Waiting for verified desktop release', 'seq 1 180', 'gh release upload', 'android-universal.apk.sha256', 'Preserving the existing immutable APK', 'Verify public signed APK bytes and identity']) {
  if (!androidReleaseWorkflow.includes(contract)) throw new Error(`Signed Android publication workflow contract missing: ${contract}`)
}
for (const forbidden of ['app-debug.apk', 'assembleDebug', '--clobber']) {
  if (androidReleaseWorkflow.includes(forbidden)) throw new Error(`Android publication workflow must never publish debug output: ${forbidden}`)
}
const mobileSyncService = await readFile(path.join(root, 'electron/bridge/mobile-sync-service.cjs'), 'utf8')
for (const contract of [`CURRENT_MOBILE_VERSION = '${mobileSourceVersion}'`, 'https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/', 'android-universal.apk', '直接在 Safari 使用', '添加到主屏幕', '无需 Apple Developer 会员', '不会提供无法公开安装的未签名 IPA', 'current.url']) {
  if (!mobileSyncService.includes(contract)) throw new Error(`iPhone/iPad no-membership QR fallback contract missing: ${contract}`)
}
if (!iosProject.includes(`CURRENT_PROJECT_VERSION: ${mobileBuildNumber}`) || !iosProject.includes(`MARKETING_VERSION: ${mobileSourceVersion}`)) throw new Error('iOS/iPadOS source version must stay synchronized with the desktop integration version.')
const publishedMobileVersion = pkg.version
const readme = await readFile(path.join(root, 'README.md'), 'utf8')
for (const contract of [
  `v${pkg.version}`,
  `Harness-Desktop-${pkg.version}-win-x64.exe`,
  `Harness-Desktop-${pkg.version}-portable-x64.exe`,
  `Harness-Mobile-${publishedMobileVersion}-android-universal.apk`,
  'docs/assets/harness-desktop-hero.jpg',
  'releases/latest'
]) {
  if (!readme.includes(contract)) throw new Error(`README release and discovery content is stale or incomplete: ${contract}`)
}
if (pkg.dependencies?.['@deepseek-ai/dsh'] !== '0.1.1-rc.2') throw new Error('Official DeepSeek Harness runtime must remain pinned.')
if (pkg.dependencies?.['@deepseek-ai/cordis-plugin-group'] !== '1.0.1') throw new Error('The DSH boot peer dependency must be pinned explicitly so electron-builder cannot prune it.')
for (const dependency of [
  'dsh-anonymous-user-id', 'dsh-atomic-write', 'dsh-bash-local', 'dsh-code-runtime',
  'dsh-compaction', 'dsh-fs', 'dsh-invariants', 'dsh-output-retention', 'dsh-sandbox',
  'dsh-scope', 'dsh-session-telemetry', 'dsh-session-title-llm', 'dsh-shell', 'dsh-spill',
  'dsh-subagent-in-process-driver', 'dsh-subprocess', 'dsh-timeout', 'dsh-workflow'
]) {
  if (pkg.dependencies?.[`@deepseek-ai/${dependency}`] !== '0.1.1-rc.2') {
    throw new Error(`The DSH Web runtime peer dependency must be pinned explicitly: ${dependency}`)
  }
}
if (pkg.dependencies?.['@earendil-works/pi-ai'] !== '0.82.1') throw new Error('Dynamic provider model discovery must remain pinned to the official Harness catalog dependency.')
if (pkg.dependencies?.yaml !== '2.9.0') throw new Error('Update-safe model routing requires pinned YAML document editing support.')
if (pkg.dependencies?.['dsh-plugin-marketplace'] !== 'https://codeload.github.com/bradeGithub/DSH-Plugins-Marketplace/tar.gz/dfe32cb8620658b55441787725f7f03e0491d15e') {
  throw new Error('The in-app DSH plugin marketplace must remain pinned to the audited upstream commit.')
}
const marketplacePackage = JSON.parse(await readFile(path.join(root, 'node_modules/dsh-plugin-marketplace/package.json'), 'utf8'))
const marketplaceRuntime = await readFile(path.join(root, 'node_modules/dsh-plugin-marketplace/lib/index.js'), 'utf8')
for (const contract of [
  'export const inject = ["webServer"]',
  'windowsHide: true',
  'execFileAsync("cmd.exe", ["/c", "npm.cmd", ...args]',
  'execFileAsync("cmd.exe", ["/d", "/s", "/c", "pnpm", ...args]'
]) {
  if (!marketplaceRuntime.includes(contract)) throw new Error(`The bundled marketplace is missing its audited v1.5.5 runtime contract: ${contract}`)
}
if (marketplacePackage.version !== '1.5.5' || marketplacePackage.repository?.url !== 'https://github.com/bradeGithub/DSH-Plugins-Marketplace.git' || marketplacePackage.dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('The bundled marketplace must be the audited upstream v1.5.5 package.')
}
if (pkg.build?.asarUnpack?.includes('node_modules/dsh-plugin-marketplace/**/*')) {
  throw new Error('The bundled marketplace must stay inside app.asar instead of exhausting the physical unpacked-file budget.')
}
const marketplaceService = await readFile(path.join(root, 'electron/bridge/plugin-marketplace-service.cjs'), 'utf8')
const marketplaceMain = await readFile(path.join(root, 'electron/main.cjs'), 'utf8')
for (const contract of ['HARNESS_DESKTOP_AUTO_ZH_SUMMARY_V1', 'automaticChineseDescription', '查看英文原文', 'translationReady']) {
  if (!marketplaceService.includes(contract)) throw new Error(`Managed marketplace Chinese translation overlay is missing: ${contract}`)
}
for (const contract of ['MARKETPLACE_RUNTIME_FILES', 'await writeFile(to, await readFile(from)', 'ensurePatchOwnershipCompatibility(destination)', 'removeProfileBundle(profileManifestFile)', 'ensureProfilePatch(patchFile)', 'installedRepository !== MARKETPLACE_REPOSITORY.toLowerCase()', "if (action === 'conflict')", 'compatibilityReady: false']) {
  if (!marketplaceService.includes(contract)) throw new Error(`Managed marketplace patch ownership or conflict fail-closed contract is missing: ${contract}`)
}
if (marketplaceService.includes('ensureProfileBundle(profileManifestFile)')) {
  throw new Error('The desktop-managed v1.5.5 marketplace must not be shadowed through DSH installation-first profile bundle resolution.')
}
if (!pkg.build?.files?.includes('third_party/licenses/dashi-taskboard-Apache-2.0-LICENSE.txt')) {
  throw new Error('The complete Apache-2.0 license for the adapted dashi task-board UI must ship with the application.')
}
for (const contract of ["HARNESS_DESKTOP_MARKETPLACE_PATCH_OWNER: '1'", '插件市场兼容层准备失败，已停止启动']) {
  if (!marketplaceMain.includes(contract)) throw new Error(`Every desktop-owned runtime start must preserve marketplace patch ownership: ${contract}`)
}
if (pkg.dependencies?.['node-pty']) throw new Error('node-pty must not return as a normal dependency with the removed native terminal.')
if (pkg.optionalDependencies?.['node-pty'] !== '1.2.0-beta.15') throw new Error('Official DSH macOS/Linux terminal support requires the pinned optional node-pty runtime.')
if (pkg.optionalDependencies?.['@deepseek-ai/dsh-sdk-client']) throw new Error('The removed duplicate AgentBridge SDK must not be packaged.')
if (pkg.scripts?.['test:provider:real']) throw new Error('The removed desktop provider smoke script must not return.')
if (pkg.build?.npmRebuild !== true || !pkg.build?.asarUnpack?.some(item => item === 'node_modules/**/*.node')) {
  throw new Error('The bundled Harness runtime requires Electron ABI rebuild while keeping only native modules outside app.asar.')
}
for (const excluded of [
  '!node_modules/**/*.map',
  '!node_modules/**/*.{ts,tsx,cts,mts}',
  '!node_modules/**/{test,tests,__tests__,example,examples,benchmark,benchmarks}/**/*',
  '!node_modules/**/{README,README.*,CHANGELOG,CHANGELOG.*,HISTORY,HISTORY.*,CONTRIBUTING,CONTRIBUTING.*,AUTHORS,AUTHORS.*}'
]) {
  if (!pkg.build?.files?.includes(excluded)) throw new Error(`Non-runtime package files must be pruned from the installer: ${excluded}`)
}
if (pkg.build?.files?.includes('docs/**/*')) throw new Error('Developer documentation must not be copied into release artifacts.')
if (!pkg.build?.files?.includes('!pet-sprite-source/**/*')) throw new Error('Pet source frames must stay outside packaged runtime assets.')
if (!pkg.build?.files?.includes('plugins/dsh-desktop-directory-picker/**/*')) throw new Error('The owned desktop directory picker plugin must be packaged.')
if (!pkg.build?.asarUnpack?.includes('plugins/dsh-desktop-directory-picker/**/*')) throw new Error('The desktop directory picker plugin must remain unpacked for profile installation.')
if (!pkg.build?.files?.includes('plugins/dsh-desktop-browser-tools/**/*')) throw new Error('The first-party browser tools plugin must be packaged.')
if (!pkg.build?.asarUnpack?.includes('plugins/dsh-desktop-browser-tools/**/*')) throw new Error('The browser tools plugin must remain unpacked for profile installation.')
if (!pkg.build?.files?.includes('plugins/dsh-desktop-memory-tools/**/*')) throw new Error('The opt-in local memory tool plugin must be packaged.')
if (!pkg.build?.asarUnpack?.includes('plugins/dsh-desktop-memory-tools/**/*')) throw new Error('The memory tool plugin must remain unpacked for profile installation.')
for (const plugin of ['dsh-desktop-mcp-manager', 'dsh-desktop-schedules', 'dsh-desktop-files', 'dsh-desktop-progress', 'dsh-desktop-compaction']) {
  const pattern = `plugins/${plugin}/**/*`
  if (!pkg.build?.files?.includes(pattern)) throw new Error(`The ${plugin} plugin must be packaged.`)
  if (!pkg.build?.asarUnpack?.includes(pattern)) throw new Error(`The ${plugin} plugin must remain unpacked for profile installation.`)
}
if (!pkg.build?.files?.includes('plugins/dsh-desktop-computer-use/**/*')) throw new Error('The constrained Computer Use plugin must be packaged.')
if (!pkg.build?.asarUnpack?.includes('plugins/dsh-desktop-computer-use/**/*')) throw new Error('The Computer Use plugin must remain unpacked for profile installation.')
if (!pkg.build?.files?.includes('plugins/dsh-agent-teams/**/*')) throw new Error('The experimental Agent Teams plugin must be packaged.')
if (!pkg.build?.asarUnpack?.includes('plugins/dsh-agent-teams/**/*')) throw new Error('The Agent Teams plugin must remain unpacked for profile installation.')
if (!pkg.build?.files?.includes('plugins/dsh-session-experience/**/*')) throw new Error('The session & attachment experience plugin must be packaged.')
if (!pkg.build?.asarUnpack?.includes('plugins/dsh-session-experience/**/*')) throw new Error('The session & attachment experience plugin must remain unpacked for profile installation.')
if (JSON.stringify(pkg.build?.win?.electronLanguages) !== JSON.stringify(['zh-CN', 'en-US'])) {
  throw new Error('Windows packages must contain only the supported zh-CN and en-US Electron locale packs.')
}
for (const excluded of [
  '!node_modules/node-pty/prebuilds/**/*.pdb',
  '!node_modules/node-pty/third_party/**/*',
  '!node_modules/node-pty/build/Release/*.{iobj,ipdb,lib,exp}'
]) {
  if (!pkg.build?.files?.includes(excluded)) throw new Error(`node-pty build debris must be pruned without deleting platform runtime binaries: ${excluded}`)
}
if (pkg.build?.files?.some(rule => rule.includes('node-pty/prebuilds/{darwin-') || rule.includes('node-pty/prebuilds/darwin-'))) {
  throw new Error('macOS node-pty prebuilds must never be removed by global package filters.')
}
if (!pkg.build?.files?.includes('node_modules/node-pty/**/*')) throw new Error('node-pty must be an explicit packaged runtime dependency on macOS and Linux.')
if (!pkg.build?.asarUnpack?.includes('node_modules/node-pty/prebuilds/**/*')) throw new Error('node-pty prebuilds and macOS spawn-helper must remain executable outside app.asar.')
if (pkg.build?.icon !== 'build/icon.png') throw new Error('All packages must use the official DeepSeek icon.')
if (pkg.devDependencies?.electron !== '43.2.0') throw new Error('Release baseline requires pinned Electron 43.2.0.')
if (pkg.scripts?.dist !== 'node scripts/build-release.mjs' || !pkg.build?.win?.target?.includes('portable')) throw new Error('Windows release must build the portable target and audited Inno Setup installer.')
if (pkg.scripts?.['prepare:git'] !== 'node scripts/prepare-bundled-git.mjs') throw new Error('Windows releases must use the pinned bundled-Git preparation gate.')
if (!pkg.build?.win?.extraResources?.some(entry => entry.from === 'third_party/mingit' && entry.to === 'third_party/mingit')) throw new Error('Windows packages must include the verified MinGit resource tree.')
if (pkg.build?.win?.target?.includes('nsis') || pkg.build?.nsis) throw new Error('The rejected NSIS installer configuration must not return.')

const officialIcon = await readFile(path.join(root, 'build/icon.png'))
const officialIconHash = createHash('sha256').update(officialIcon).digest('hex')
if (officialIconHash !== '77b823e3d14122b6dfe6ff6089e629d1c6e3fcd1ed7fc0b9e7bf594fe612597c') {
  throw new Error('build/icon.png drifted from the approved official DeepSeek Harness icon.')
}

const main = await readFile(path.join(root, 'electron/main.cjs'), 'utf8')
const bundledGitPreparer = await readFile(path.join(root, 'scripts/prepare-bundled-git.mjs'), 'utf8')
for (const gitGate of ['MinGit-2.53.0.2-64-bit.zip', 'd4bf83d6a860ccae9af44e508e1e00a39f09db6fa78a9ba5543b94d87ca22a29', 'gcm-win-x64-2.7.0.zip', '070c7cf706fbed844757f53d2f9d46ace09745820323264761e4f0bb4f0319bc', 'replaceDirectoryAtomically', 'validateZipEntries']) {
  if (!bundledGitPreparer.includes(gitGate)) throw new Error(`Bundled Git integrity gate missing: ${gitGate}`)
}
for (const gitIpc of ['gitRuntime:status', 'gitRuntime:refresh', 'gitRuntime:prepare', 'gitRuntime:authenticate', 'ensureGitRuntimeService().runtimeEnvironment']) {
  if (!main.includes(gitIpc)) throw new Error(`Bundled Git desktop integration missing: ${gitIpc}`)
}
const earlyBootstrap = await readFile(path.join(root, 'electron/bootstrap.cjs'), 'utf8')
const wallpaperService = await readFile(path.join(root, 'electron/bridge/wallpaper-service.cjs'), 'utf8')
const wallpaperLibrary = await readFile(path.join(root, 'electron/bridge/wallpaper-library.cjs'), 'utf8')
for (const wallpaperContract of ['MAX_THEME_BACKGROUND_BYTES', 'MAX_THEME_VIDEO_BYTES', "'png', 'jpg', 'jpeg', 'webp', 'gif', 'apng', 'mp4', 'webm'", 'appearance:chooseWallpaperEngine', 'customBackgroundVideoDataUrl', 'registerWallpaperProtocol', 'createWallpaperVideoResponse(file, request)', 'harness-wallpaper']) {
  if (!main.includes(wallpaperContract)) throw new Error(`Image/video wallpaper contract missing: ${wallpaperContract}`)
}
for (const earlySchemeContract of ['protocol.registerSchemesAsPrivileged', "scheme: 'harness-wallpaper'", 'bypassCSP: true']) {
  if (!earlyBootstrap.includes(earlySchemeContract)) throw new Error(`Early wallpaper scheme registration missing: ${earlySchemeContract}`)
}
if (main.includes('protocol.registerSchemesAsPrivileged')) throw new Error('Wallpaper scheme privilege registration must run in bootstrap before asynchronous startup work.')
if (main.includes("customBackgroundVideoDataUrl: kind === 'video' ? dataUrl")) {
  throw new Error('Video wallpapers must stream through the controlled local protocol instead of being serialized as data URLs.')
}
for (const protocolContract of [
  'session.defaultSession',
  "session.fromPartition('persist:harness')",
  "target.hostname === 'current' && target.pathname === '/video'",
  "target.hostname === 'library'",
  'wallpaperLibraryItem(match[1])',
  'wallpaperAssetPath(item.cachedFile)',
  'createWallpaperVideoResponse(file, request)',
  'createWallpaperMediaResponse(file, request)'
]) {
  if (!main.includes(protocolContract)) throw new Error(`Wallpaper protocol boundary missing: ${protocolContract}`)
}
for (const streamingContract of ['createReadStream', 'Readable.toWeb', 'Accept-Ranges', 'Content-Range', 'Content-Type', 'parseByteRange', "request.headers?.get?.('range')"]) {
  if (!wallpaperService.includes(streamingContract)) throw new Error(`Wallpaper video Range streaming contract missing: ${streamingContract}`)
}
const videoPayloadStart = main.indexOf("if (kind === 'video')", main.indexOf('async function readAppearancePayload'))
const videoPayloadEnd = main.indexOf("const info = kind === 'image'", videoPayloadStart)
const videoPayloadBranch = videoPayloadStart >= 0 && videoPayloadEnd > videoPayloadStart ? main.slice(videoPayloadStart, videoPayloadEnd) : ''
if (!videoPayloadBranch || /readFile|readThemeImageDataUrl|base64/.test(videoPayloadBranch) || !videoPayloadBranch.includes('MAX_THEME_VIDEO_BYTES')) {
  throw new Error('The 2 GB video appearance payload must publish only a streamed URL without reading the video into memory.')
}
const videoResponseBody = wallpaperService.match(/async function createWallpaperVideoResponse[\s\S]*?\n\}/)?.[0] || ''
if (!videoResponseBody.includes('createReadStream') || /readFile/.test(videoResponseBody)) {
  throw new Error('The wallpaper protocol handler must stream file ranges and never read the whole video.')
}
const imageResponseBody = wallpaperService.match(/async function createWallpaperMediaResponse[\s\S]*?\n\}/)?.[0] || ''
if (!imageResponseBody.includes('createReadStream') || /readFile/.test(imageResponseBody)) {
  throw new Error('Wallpaper library previews must stream managed images instead of serializing every card into memory.')
}
for (const libraryContract of [
  'MAX_WALLPAPER_LIBRARY_ITEMS',
  'safeManagedWallpaperPath',
  'appearance:applyWallpaper',
  'appearance:deleteWallpaper',
  'appearance:importCurrentWallpaperEngine',
  'wallpaper-${randomUUID().toLowerCase()}',
  'Startup and ordinary card application always use the managed local copy.'
]) {
  if (!main.includes(libraryContract)) throw new Error(`Persistent managed wallpaper library contract missing: ${libraryContract}`)
}
for (const libraryServiceContract of ['MAX_WALLPAPER_LIBRARY_BYTES', 'assertWallpaperLibraryCapacity', 'cleanupOrphanedWallpaperStorage', 'createWallpaperMutationQueue', 'installManagedWallpaperCopy', 'revalidateProjectMediaPath', 'wallpaperStorageUsageBytes']) {
  if (!wallpaperService.includes(libraryServiceContract)) throw new Error(`Wallpaper library service contract missing: ${libraryServiceContract}`)
}
if (!main.includes('wallpaperMutationQueue.run')) throw new Error('Wallpaper mutations must share a serialized main-process queue.')
for (const currentImportContract of ['wallpaperEngineConfigSelection', 'currentWallpaperEngineProjectDirectories', 'ambiguous-profile']) {
  if (!wallpaperLibrary.includes(currentImportContract) && !main.includes(currentImportContract)) throw new Error(`Current Wallpaper Engine import contract missing: ${currentImportContract}`)
}
for (const rule of themeIntegration.matchAll(/([^{}]*html\[data-hd-ui-mode="(?:aurora|spatial|tactile)"\][^{}]*)\{([^}]*)\}/g)) {
  const targetsRoot = /\[(?:data-composer-card="true"|data-hd-surface="conversation")\]\s*(?:,|$)/.test(rule[1])
  if (targetsRoot && /transform\s*:\s*[^;]*(?:translate|scale)/.test(rule[2])) {
    throw new Error('Interface modes must not translate or scale the composer/conversation root and destabilize the viewport.')
  }
}
for (const wallpaperEngineContract of ['resolveWallpaperEngineInput', 'resolveWallpaperEngineProject', "['image', 'video']", 'scene、web 与 application 项目不会执行', 'safeProjectMediaPath']) {
  if (!wallpaperService.includes(wallpaperEngineContract)) throw new Error(`Safe Wallpaper Engine import contract missing: ${wallpaperEngineContract}`)
}
for (const directoryImportContract of ["buttons: ['选择项目目录', '选择 project.json', '取消']", "properties: [chooseDirectory ? 'openDirectory' : 'openFile']", 'resolveWallpaperEngineInput(source)']) {
  if (!main.includes(directoryImportContract)) throw new Error(`Wallpaper Engine directory/project.json chooser contract missing: ${directoryImportContract}`)
}
for (const titleBarContract of ['syncTitleBarOverlay', 'setTitleBarOverlay', 'resolveTitleBarSymbolColor(requestedMode, nativeTheme.shouldUseDarkColors)', "nativeTheme.on('updated'"]) {
  if (!main.includes(titleBarContract)) throw new Error(`Native Windows controls must remain visible over the active light or dark skin: ${titleBarContract}`)
}
const titleBarAppearance = await readFile(path.join(root, 'electron/bridge/titlebar-appearance.cjs'), 'utf8')
for (const titleBarContract of ["normalizedMode === 'dark'", "normalizedMode === 'light'", "'#f4f7ff'", "'#202124'", 'shouldUseDarkColors === true']) {
  if (!titleBarAppearance.includes(titleBarContract)) throw new Error(`Native Windows title-bar color policy is incomplete: ${titleBarContract}`)
}
const bootstrap = await readFile(path.join(root, 'electron/bootstrap.cjs'), 'utf8')
for (const contract of ['prepareComponentActivation', 'resolveComponentLayout', 'installComponentModulePaths', '__HARNESS_COMPONENT_UPDATE__', 'require(layout.shellEntry)']) {
  if (!bootstrap.includes(contract)) throw new Error(`Stable component bootstrap contract missing: ${contract}`)
}
const componentSources = JSON.parse(await readFile(path.join(root, 'component-update-sources.json'), 'utf8'))
const desktopReleaseSources = JSON.parse(await readFile(path.join(root, 'release-update-sources.json'), 'utf8'))
if (JSON.stringify(desktopReleaseSources.trustedKeys) !== JSON.stringify(componentSources.trustedKeys)) throw new Error('Desktop release manifests must reuse the reviewed component Ed25519 trust root.')
const desktopReleaseContract = await readFile(path.join(root, 'electron/bridge/desktop-release-contract.cjs'), 'utf8')
for (const contract of ['harness-desktop-release-manifest', 'canonicalJson', 'verifySignedObject', 'validatePublicHttpsUrl', 'createSignedDesktopReleaseManifest', 'validateAndVerifyDesktopReleaseManifest']) {
  if (!desktopReleaseContract.includes(contract)) throw new Error(`Desktop release signature contract missing: ${contract}`)
}
for (const contract of ['desktopReleaseTrustedKeys()', '__HARNESS_COMPONENT_UPDATE__?.bundledRoot', 'trustedKeys, channel', 'redirect: \'manual\'']) {
  if (!desktopMain.includes(contract)) throw new Error(`Production desktop update trust boundary missing: ${contract}`)
}
if (componentSources.enabled !== true || componentSources.manifestUrls?.length) throw new Error('Production component updates must be enabled through per-target feeds only.')
for (const target of ['win32-x64', 'darwin-x64', 'darwin-arm64']) {
  const urls = componentSources.targets?.[target]
  if (!Array.isArray(urls) || urls.length !== 2) throw new Error(`Production component target must have CNB and GitHub feeds: ${target}`)
  const parsed = urls.map(value => new URL(value))
  if (parsed.some(url => url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)) throw new Error(`Component feed URL must be credential-free immutable HTTPS: ${target}`)
  if (parsed[0].hostname !== 'cnb.cool' || parsed[1].hostname !== 'raw.githubusercontent.com') throw new Error(`Component feeds must prefer CNB with GitHub fallback: ${target}`)
  if (!parsed.every(url => url.pathname.endsWith(`/component-feeds/stable/${target}.json`))) throw new Error(`Component feed target path drifted: ${target}`)
}
const componentKey = componentSources.trustedKeys?.['harness-components-02643f81164c594a']
if (!componentKey?.startsWith('-----BEGIN PUBLIC KEY-----') || !componentKey.endsWith('-----END PUBLIC KEY-----')) throw new Error('Reviewed production component Ed25519 public key is missing.')
const componentProductionBuilder = await readFile(path.join(root, 'scripts/prepare-production-components.mjs'), 'utf8')
for (const contract of ['HARNESS_COMPONENT_SIGNING_KEY_FILE', 'HARNESS_COMPONENT_KEY_ID', 'does not match the public key embedded', 'win32-x64', 'darwin-x64', 'darwin-arm64', 'full-package fallback', 'validateAndVerifyManifest']) {
  if (!componentProductionBuilder.includes(contract)) throw new Error(`Production component build contract missing: ${contract}`)
}
const productionComponentWorkflow = await readFile(path.join(root, '.github/workflows/publish-production-components.yml'), 'utf8')
for (const contract of ['product_revision:', 'ref: ${{ env.RELEASE_TAG }}', 'PUBLISHER_PRODUCT_REVISION', 'git rev-list -n 1 "$RELEASE_TAG"', 'test "${#files[@]}" -eq 7']) {
  if (!productionComponentWorkflow.includes(contract)) throw new Error(`Production component workflow immutable-tag contract missing: ${contract}`)
}
if (productionComponentWorkflow.includes('component-publish/v')) throw new Error('Production component publication must not be triggered by a mutable branch.')
const desktopManifestRefresher = await readFile(path.join(root, 'scripts/refresh-release-manifest.mjs'), 'utf8')
const releasePublisher = await readFile(path.join(root, 'scripts/release-publish.mjs'), 'utf8')
const releasePublisherSelection = await readFile(path.join(root, 'scripts/release-publish-selection.cjs'), 'utf8')
const releasePublisherTests = await readFile(path.join(root, 'tests/release-publisher.test.cjs'), 'utf8')
for (const contract of ['HARNESS_COMPONENT_SIGNING_KEY_FILE', 'HARNESS_COMPONENT_KEY_ID', 'createSignedDesktopReleaseManifest', 'validateAndVerifyDesktopReleaseManifest']) {
  if (!desktopManifestRefresher.includes(contract)) throw new Error(`Desktop release manifest publisher contract missing: ${contract}`)
}
for (const contract of ['release-update-sources.json trust root drifted from component-update-sources.json', 'verifiedDesktopRelease', 'readVerifiedDesktopRelease', 'GitHub/CNB signed desktop release manifest mismatch']) {
  if (!releasePublisher.includes(contract)) throw new Error(`Release publisher signed-manifest gate missing: ${contract}`)
}
for (const contract of ["PACKAGING_MODE = 'github-actions-only'", "LOCAL_GATE_PHASE = 'local-source-gates'", "--through', 'verify'", 'Cloud-only packaging forbids local release artifacts', "['product_revision', stateProductRevision]", 'repos/${repo}/actions/runs/${runId}', 'workflowPath', 'matchesWorkflowRunIdentity', 'verifyCloudAssetMirrorsBeforeStable', 'validateCompletedPhaseEvidence', 'validateGithubReleaseAgainstManifest', 'validateCnbMirrorObservations']) {
  if (!releasePublisher.includes(contract)) throw new Error(`Cloud-only release publisher contract missing: ${contract}`)
}
for (const contract of ["delete state.phases['local-windows']", 'incorrectlyMigratedLocal', 'delete state.phases[localGatePhase]', 'matchesWorkflowRunIdentity', 'validateCompletedPhaseEvidence', 'validateGithubReleaseAgainstManifest', 'validateCnbMirrorObservations']) {
  if (!releasePublisherSelection.includes(contract)) throw new Error(`Cloud-only publisher fail-closed helper missing: ${contract}`)
}
for (const contract of ['legacy local packaging state always reruns', 'tampered stored workflow run identities', 'completed publication phases cannot skip fresh run evidence validation', 'GitHub and CNB 18-asset drift is rejected before stable']) {
  if (!releasePublisherTests.includes(contract)) throw new Error(`Cloud-only publisher behavior regression test missing: ${contract}`)
}
const stablePromotion = releasePublisher.slice(releasePublisher.indexOf("phase(state, 'stable-components'"), releasePublisher.indexOf("phase(state, 'cnb-stable'"))
if (stablePromotion.indexOf('verifyCloudAssetMirrorsBeforeStable') < 0 || stablePromotion.indexOf('verifyCloudAssetMirrorsBeforeStable') > stablePromotion.indexOf('promoteStableFeeds')) throw new Error('Stable component promotion must revalidate exact GitHub/CNB assets immediately before promotion.')
const cloudMirrorVerifier = releasePublisher.slice(releasePublisher.indexOf('async function verifyCloudAssetMirrorsBeforeStable'), releasePublisher.indexOf('async function promoteStableFeeds'))
for (const contract of ['releaseForTag()', 'assertReleaseAssets(release, expectedAllNames()', 'validateGithubReleaseAgainstManifest', "method: 'HEAD'", 'validateCnbMirrorObservations']) {
  if (!cloudMirrorVerifier.includes(contract)) throw new Error(`Stable-last live two-cloud verification missing: ${contract}`)
}
if (releasePublisher.includes("--through', 'windows'")) throw new Error('The official publisher must never invoke local Windows packaging.')
const signingKeyCreator = await readFile(path.join(root, 'scripts/create-component-signing-key.mjs'), 'utf8')
for (const contract of ["generateKeyPairSync('ed25519')", "createCipheriv('aes-256-gcm'", 'Private key, encrypted backup, and recovery key directories must be separate', "mode: 0o600", "flag: 'wx'"]) {
  if (!signingKeyCreator.includes(contract)) throw new Error(`Component signing key custody contract missing: ${contract}`)
}
const releaseOrchestrator = await readFile(path.join(root, 'scripts/release-orchestrator.mjs'), 'utf8')
for (const contract of ['.release-state', "['--self-test'", "test:component-local", 'Skipping completed phase', 'cleanSourceRevision', 'sourceRevision !== sourceRevision', 'Release orchestration requires a clean source tree', 'PHASES.slice(phaseIndex)', "delete env.ELECTRON_RUN_AS_NODE"]) {
  if (!releaseOrchestrator.includes(contract)) throw new Error(`Resumable release orchestrator contract missing: ${contract}`)
}
const relaySources = JSON.parse(await readFile(path.join(root, 'mobile-relay-sources.json'), 'utf8'))
if (relaySources.enabled !== false || relaySources.relayUrl) throw new Error('Public WSS relay must remain disabled until its 443/TLS deployment is reviewed.')
if (!main.includes("ipcMain.handle('componentUpdates:apply'")) throw new Error('Component apply IPC is missing after local installation testing approval.')
for (const trayContract of ['createDesktopTray', 'ensureDesktopTray', "mainWindow.on('close'", 'event.preventDefault()', 'mainWindow.hide()', 'isQuitting = true']) {
  if (!main.includes(trayContract)) throw new Error(`Desktop tray lifecycle contract missing: ${trayContract}`)
}
for (const channel of ['runtime:start', 'runtime:state', 'updates:preferences', 'updates:setPreferences', 'updates:check', 'updates:install', 'updates:launchReady', 'updates:install-progress', 'componentUpdates:getState', 'componentUpdates:check', 'componentUpdates:stage', 'componentUpdates:apply', 'componentUpdates:progress', 'appearance:get', 'appearance:assets', 'appearance:setTheme', 'appearance:saveCustom', 'appearance:chooseBackground', 'settings:openDocument', 'models:routing:get', 'models:routing:save', 'models:meters:get', 'storage:scan', 'storage:cleanupPreview', 'storage:cleanupApply', 'storage:status', 'memory:status', 'memory:setEnabled', 'memory:setPreferences', 'memory:list', 'memory:search', 'memory:add', 'memory:update', 'memory:delete', 'memory:deleteAll', 'memory:export', 'browser:state', 'browser:setVisible', 'browser:setContentVisible', 'browser:setPanelWidth', 'browser:setWideMode', 'browser:historySearch', 'browser:historyOpen', 'browser:historyRemove', 'browser:historyClear', 'browser:navigate', 'browser:newTab', 'browser:switchTab', 'browser:closeTab', 'browser:back', 'browser:forward', 'browser:reload', 'browser:stop', 'browser:clearSiteData', 'browser:clearAllData', 'browser:grantCurrent', 'browser:revokeCurrent', 'browser:resumeModelControl', 'browser:confirmModelAction', 'browser:rejectModelAction', 'computerUse:state', 'computerUse:setEnabled', 'computerUse:confirm', 'computerUse:reject', 'computerUse:policy', 'computerUse:setDefaultAccess', 'computerUse:setAppOverride', 'computerUse:revokeAppOverride', 'shell:openExternal', 'shell:openLocal']) {
  if (!main.includes(`'${channel}'`)) throw new Error(`electron/main.cjs is missing IPC channel: ${channel}`)
}
for (const removedChannel of ['agent:run', 'session:create', 'git:status', 'workspace:list', 'terminal:start', 'mcp:list', 'skill:list', 'plugin:list', 'provider:get', 'diagnostics:run']) {
  if (main.includes(removedChannel)) throw new Error(`Duplicate native workbench IPC must not return: ${removedChannel}`)
}
for (const contract of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setWindowOpenHandler', 'will-navigate', 'will-attach-webview', 'did-attach-webview', "guest.on('context-menu'", 'showGuestContextMenu', 'normalizeLocalTarget']) {
  if (!main.includes(contract)) throw new Error(`Electron security contract missing: ${contract}`)
}
for (const updateContract of ['net.fetch(', 'fetchJsonWithSystemNetwork', "phase: 'ready'", 'launchReadyAppUpdate', 'openDesktopInstaller', 'shell.openPath', 'ensurePluginMarketplace']) {
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
for (const contract of ['this.sessions.create({ workspaceId: target })', 'this.sessions.clear()', 'Pinned DSH startSession implementation changed', 'System.Windows.Forms.FolderBrowserDialog', 'patchInstalledDirectoryPicker', 'patchInstalledConversation', 'patchInstalledTokenMeter', 'patchInstalledAgentLoop', 'patchInstalledSubagentContinuation', 'const iterator = stream[Symbol.asyncIterator]()', 'activation.accepted.size > 0 && agent.inbox.hasPending', 'internal team queue filtering', '[Agent team message ']) {
  if (!runtimePatch.includes(contract)) throw new Error(`Guarded desktop runtime patch is missing: ${contract}`)
}
for (const contract of ['patchInstalledFsSearch', 'patchFsSearchSource', 'Do NOT repeat this same search call', 'First use glob to discover which paths actually exist under the workspace', 'narrow the grep path to that existing subtree', 'refusing an unsafe search-recovery patch', 'fails closed as a search error (ripgrep exit 2)']) {
  if (!runtimePatch.includes(contract)) throw new Error(`Guarded search exit-2 recovery runtime patch is missing: ${contract}`)
}
for (const officialHarnessContract of ['patchInstalledMarkdownRenderer', 'patchInstalledModelImageCompatibility', 'desktopMessagesForInputModalities', 'does not accept the image waiting in the prompt', 'patchConversationAttachmentCopySource']) {
  if (runtimePatch.includes(officialHarnessContract)) throw new Error(`Desktop must defer file references and multimodal handling to official Harness rc.2: ${officialHarnessContract}`)
}
for (const contract of ['patchInstalledSubagent', 'subagentLifecycleCounts', 'filteredEntries.map', '待命（可恢复）', '已结束（仅记录）', 'children: t("count.compact"', 'hd-subagent-drawer-backdrop', 'dialogRef.current?.focus()', 'tabIndex: -1', '!next && restoreFocus', 'harness-desktop:open-subagent-catalog', 'position:fixed!important', '@media(max-width:620px)', '@media(prefers-reduced-motion:reduce)', 'dataPluginCss = "@harness-desktop/subagent-drawer"']) {
  if (!runtimePatch.includes(contract)) throw new Error(`Subagent lifecycle drawer patch is missing: ${contract}`)
}
for (const contract of ["HARNESS_DESKTOP_REUSE_RUNTIME === '1'", "'web', '--port', '0', '--no-open'"]) {
  if (!main.includes(contract)) throw new Error(`Dedicated desktop runtime policy is missing: ${contract}`)
}
const updateDownloadService = await readFile(path.join(root, 'electron/bridge/update-download-service.cjs'), 'utf8')
for (const contract of ['DEFAULT_IDLE_TIMEOUT_MS', 'DEFAULT_CHECKSUM_TIMEOUT_MS', 'rejectedInstallerType', 'SHA-256 校验失败', 'unlinkImpl(destination)']) {
  if (!updateDownloadService.includes(contract)) throw new Error(`Smart update fallback contract missing: ${contract}`)
}
const updateFeedConfig = await readFile(path.join(root, 'electron/bridge/update-feed-config.cjs'), 'utf8')
for (const contract of ['HARNESS_DESKTOP_UPDATE_FEEDS', 'configPaths', 'normalizeFeedUrls', 'https:']) {
  if (!updateFeedConfig.includes(contract)) throw new Error(`Update feed configuration contract missing: ${contract}`)
}
for (const contract of ['resolveDesktopRuntimePaths', 'desktopRuntimeEnvironment', 'userData: runtimePaths.root', 'mkdir(runtimePaths.temp', 'cwd: runtimePaths.workspace']) {
  if (!main.includes(contract)) throw new Error(`Install-local Harness runtime contract is missing: ${contract}`)
}
const dshHomeService = await readFile(path.join(root, 'electron/bridge/dsh-home.cjs'), 'utf8')
for (const contract of ['PORTABLE_EXECUTABLE_DIR', "INSTALL_DATA_DIRECTORY = 'HarnessData'", "dshHome: path.join(root, 'dsh-home')", "workspace: path.join(root, 'workspace')", "temp: path.join(root, 'temp')", 'TEMP: runtimePaths.temp', 'TMP: runtimePaths.temp', 'TMPDIR: runtimePaths.temp']) {
  if (!dshHomeService.includes(contract)) throw new Error(`Install-local Harness path resolution is missing: ${contract}`)
}
if (pkg.scripts?.postinstall !== 'node scripts/patch-official-runtime.mjs && electron-builder install-app-deps') {
  throw new Error('Dependency installation must reapply the audited project-scoped New Session patch.')
}

const preload = await readFile(path.join(root, 'electron/preload.cjs'), 'utf8')
for (const api of ['startRuntime', 'getRuntimeState', 'onRuntimeState', 'getUpdatePreferences', 'setUpdatePreferences', 'checkUpdates', 'installUpdate', 'launchReadyUpdate', 'getComponentUpdateState', 'checkComponentUpdates', 'stageComponentUpdates', 'onComponentUpdateProgress', 'getGitRuntimeStatus', 'refreshGitRuntimeStatus', 'prepareGitRuntime', 'openGitAuthentication', 'getAppearance', 'setTheme', 'getThemeAssets', 'saveCustomTheme', 'chooseThemeBackground', 'chooseWallpaperEngine', 'importCurrentWallpaperEngine', 'openHarnessSettings', 'getModelRouting', 'saveModelRouting', 'openLink', 'openExternal', 'openLocal', 'onUpdateResult', 'onUpdateInstallProgress']) {
  if (!preload.includes(api)) throw new Error(`preload API missing: ${api}`)
}
for (const removedApi of ['getProviderSettings', 'runDiagnostics', 'listSessions', 'listWorkspaceDirectory', 'startTerminal']) {
  if (preload.includes(removedApi)) throw new Error(`preload must not expose duplicate native workbench API: ${removedApi}`)
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'dist-store', 'dist-local-component-test', 'local-test-output', '.artifacts', '.android-build', 'release'].includes(entry.name)) continue
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
