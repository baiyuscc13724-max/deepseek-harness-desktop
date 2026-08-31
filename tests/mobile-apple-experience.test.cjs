const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const read = (...segments) => readFile(path.join(root, ...segments), 'utf8')

function assertContainsAll(source, contracts, label) {
  for (const contract of contracts) {
    assert.ok(source.includes(contract), `${label} missing contract: ${contract}`)
  }
}

test('iOS mobile experience keeps Apple-native state and accessibility contracts', async () => {
  const [content, pairing, banner, workbench, project, iosCompat, androidCompat, iosRuntime, androidRuntime] = await Promise.all([
    read('mobile', 'ios', 'HarnessMobile', 'App', 'ContentView.swift'),
    read('mobile', 'ios', 'HarnessMobile', 'App', 'PairingView.swift'),
    read('mobile', 'ios', 'HarnessMobile', 'App', 'StatusBannerView.swift'),
    read('mobile', 'ios', 'HarnessMobile', 'App', 'WorkbenchView.swift'),
    read('mobile', 'ios', 'project.yml'),
    read('mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-compat.css'),
    read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css'),
    read('mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-runtime.js'),
    read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js')
  ])

  assertContainsAll(content, [
    'NavigationStack',
    '@Environment(\\.accessibilityReduceMotion)',
    '.accessibilityLabel("重新连接")',
    'StatusBannerView',
    '.fullScreenCover'
  ], 'iOS root experience')
  assertContainsAll(pairing, [
    '@ScaledMetric',
    '.scrollDismissesKeyboard(.interactively)',
    '.accessibilityAddTraits(.updatesFrequently)',
    '.textInputAutocapitalization(.never)',
    '.keyboardType(.URL)'
  ], 'iOS pairing experience')
  assertContainsAll(banner, [
    '.accessibilityAddTraits(.updatesFrequently)',
    '.regularMaterial',
    'actionTitle'
  ], 'iOS status banner')
  assert.doesNotMatch(`${pairing}\n${banner}`, /\.accessibilityLiveRegion\(/, 'unsupported SwiftUI live-region API must not return')

  assertContainsAll(workbench, [
    'data-harness-mobile-add-photo',
    "input.type = 'file'",
    "input.accept = 'image/*'",
    'input.multiple = true',
    "textarea[data-phase]",
    "new Event('paste'",
    "Object.defineProperty(event, 'clipboardData'",
    'webView.uiDelegate = context.coordinator',
    'keyboardDismissMode = .interactive'
  ], 'iOS mobile attachment bridge')
  assertContainsAll(workbench, [
    'mobileStyleScript()',
    'mobileRuntimeScript()',
    'Bundle.main.url(forResource: "mobile-compat", withExtension: "css")',
    'Bundle.main.url(forResource: "mobile-runtime", withExtension: "js")',
    "const id = 'harness-mobile-compat'",
    "document.documentElement.dataset.harnessMobilePlatform = 'ios'",
    'injectionTime: .atDocumentEnd, forMainFrameOnly: true'
  ], 'iOS Orbit web asset injection')
  assertContainsAll(project, [
    'resources:',
    '- path: HarnessMobile/Resources/mobile-compat.css',
    '- path: HarnessMobile/Resources/mobile-runtime.js',
    'excludes:',
    '- Resources/mobile-compat.css',
    '- Resources/mobile-runtime.js'
  ], 'iOS explicit Orbit resource packaging')
  assert.equal(iosCompat, androidCompat, 'iOS must bundle the exact Android-validated Orbit CSS')
  assert.equal(iosRuntime, androidRuntime, 'iOS must bundle the exact capability-gated Android runtime')
  assert.doesNotMatch(workbench, /installControlSettingsEntry|harness-mobile-screen-captured/, 'iOS loader must not duplicate Android-only runtime behavior')
  assert.doesNotMatch(workbench, /WKOpenPanelParameters|runOpenPanelWith parameters/, 'iOS 18.4-only open-panel API must not be referenced by the iOS 16 target')
  assert.doesNotMatch(workbench, /PhotosUI|PHPicker|UIDocumentPicker/, 'the iOS 16 path must rely on the permission-minimal WebKit system picker')
})

test('Android native shell keeps touch, state, dark-mode, and attachment contracts', async () => {
  const [mainLayout, controlLayout, scannerLayout, dimensions, colors, nightColors, nightStyles, mainActivity, scannerActivity, adapter, compat, runtime, androidBuild, updateFeed, manifest] = await Promise.all([
    read('mobile', 'android', 'app', 'src', 'main', 'res', 'layout', 'activity_main.xml'),
    read('mobile', 'android', 'app', 'src', 'main', 'res', 'layout', 'activity_control_settings.xml'),
    read('mobile', 'android', 'app', 'src', 'main', 'res', 'layout', 'activity_scanner.xml'),
    read('mobile', 'android', 'app', 'src', 'main', 'res', 'values', 'dimens.xml'),
    read('mobile', 'android', 'app', 'src', 'main', 'res', 'values', 'colors.xml'),
    read('mobile', 'android', 'app', 'src', 'main', 'res', 'values-night', 'colors.xml'),
    read('mobile', 'android', 'app', 'src', 'main', 'res', 'values-night', 'styles.xml'),
    read('mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'MainActivity.java'),
    read('mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'HarnessCaptureActivity.java'),
    read('mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'MobileUiAdapter.java'),
    read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css'),
    read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'),
    read('mobile', 'android', 'app', 'build.gradle.kts'),
    read('mobile', 'mobile-app-update.json'),
    read('mobile', 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
  ])

  assertContainsAll(mainLayout, [
    '<ScrollView',
    '@+id/scan_button',
    '@+id/pairing_error',
    'android:accessibilityLiveRegion="polite"',
    'xmlns:app="http://schemas.android.com/apk/res-auto"',
    'app:tint="@color/harness_primary_dark"',
    '@string/'
  ], 'Android pairing shell')
  assert.doesNotMatch(mainLayout, /android:tint=/u, 'AppCompat image widgets must use app:tint')
  assertContainsAll(controlLayout, [
    '@+id/control_master_switch',
    '@+id/control_stop_now',
    'android:accessibilityLiveRegion="polite"',
    '@style/Widget.Harness.Button.Destructive'
  ], 'Android control settings')
  assertContainsAll(scannerLayout, [
    '@+id/scanner_permission_panel',
    '@+id/scanner_permission_retry',
    '@+id/scanner_permission_settings'
  ], 'Android recoverable scanner permission UI')
  assertContainsAll(scannerActivity, [
    'extends AppCompatActivity',
    'ActivityResultContracts.RequestPermission',
    'showPermissionRecovery()',
    'Settings.ACTION_APPLICATION_DETAILS_SETTINGS',
    'decodeSingle',
    'getOnBackPressedDispatcher().addCallback',
    'cancelAndFinish()'
  ], 'Android scanner permission ownership')
  assert.doesNotMatch(scannerActivity, /public void onBackPressed\(/u, 'scanner back must use the predictive-back dispatcher')
  assert.doesNotMatch(scannerActivity, /extends CaptureActivity/, 'ZXing must not own the camera permission denial dialog')
  assertContainsAll(dimensions, ['48dp', '16dp'], 'Android touch and spacing tokens')
  assertContainsAll(colors, ['harness_background', 'harness_text', 'harness_error', 'harness_success'], 'Android light semantic colors')
  assertContainsAll(nightColors, ['harness_background', 'harness_surface', 'harness_text', 'harness_secondary'], 'Android dark semantic colors')
  assertContainsAll(nightStyles, [
    '<item name="android:windowLightStatusBar">false</item>',
    '<item name="android:windowLightNavigationBar" tools:targetApi="27">false</item>'
  ], 'Android dark system bars')

  assertContainsAll(mainActivity, [
    'onShowFileChooser',
    'ValueCallback<Uri[]>',
    'FileChooserParams',
    'SOFT_INPUT_ADJUST_RESIZE',
    'WindowInsetsCompat.Type.ime()',
    'bottom + systemBars.bottom',
    'publishImeInsets(imeVisible, Math.max(0, ime.bottom - systemBars.bottom))',
    "window.dispatchEvent(new CustomEvent('harness-mobile-ime-change'",
    'ActivityResultLauncher<Intent>',
    'ActivityResultLauncher<PickVisualMediaRequest>',
    'MAX_PICKED_IMAGES = 20',
    'new ActivityResultContracts.PickMultipleVisualMedia(MAX_PICKED_IMAGES)',
    'uris.toArray(new Uri[0])',
    'PickVisualMedia.ImageOnly.INSTANCE',
    'forceMultiple || params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE',
    'Intent.EXTRA_ALLOW_MULTIPLE, multiple',
    'completeFileChooser',
    'protected void onResume()',
    'mobileUiAdapter.inject(webView)',
    '不得伪造 online/focus',
    'MOBILE_UPDATE_CHECK_INTERVAL_MS',
    'lastMobileUpdateCheckAt',
    'hideSoftKeyboard()',
    'InputMethodManager',
    'moveTaskToBack(true)',
    'Activity.ScreenCaptureCallback',
    'Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && screenCaptureObserver != null',
    'registerScreenCaptureCallback',
    'unregisterScreenCaptureCallback',
    "window.dispatchEvent(new Event('harness-mobile-screen-captured'))",
    'protected void onStart()',
    'protected void onStop()',
    'mainFrameLoadFailed',
    'if (!mainFrameLoadFailed) revealWorkbench()',
    "document.querySelector('[data-slot=\\\"conversation\\\"]') ||",
    "document.querySelector('[data-slot=\\\"sidebar\\\"]') ||"
  ], 'Android native file chooser and shell readiness')
  const resumeSource = mainActivity.slice(mainActivity.indexOf('protected void onResume()'), mainActivity.indexOf('private void checkMobileAppUpdate()'))
  assert.doesNotMatch(resumeSource, /dispatchEvent\(new Event\('(online|focus)'\)\)|\.reload\(\)|\.loadUrl\(/u, 'foreground resume must preserve the live WebView without fabricated reconnect signals or navigation')
  assertContainsAll(adapter, [
    'static final String RUNTIME_MARKER = "__harnessMobileRuntimeInstalled";',
    'if(window[runtimeMarker]!==" + JSONObject.quote(RUNTIME_READY) + "){try{',
    'window[runtimeMarker]=" + JSONObject.quote(RUNTIME_READY) + ";',
    '}catch(error){delete window[runtimeMarker];throw error;}}'
  ], 'Android per-document idempotent bootstrap and failed-bootstrap retry')
  assert.doesNotMatch(adapter, /window\[runtimeMarker\]\s*=\s*[^;]+;\s*try\{/u, 'runtime readiness must only be committed after bootstrap succeeds')
  assert.doesNotMatch(mainActivity, /\.isBlank\(|List\.of\(|(?<!Collectors)\.toList\(/u, 'minSdk 26 production code must not use newer un-desugared Java collection/string APIs')
  assert.doesNotMatch(mainActivity, /new ActivityResultContracts\.PickVisualMedia\(\)/u, 'the gallery path must not regress to a single-photo picker')
  assert.match(manifest, /android:windowSoftInputMode="stateAlwaysHidden\|adjustResize"/u, 'pairing and reconnect surfaces must not summon the IME')
  assert.match(manifest, /android\.permission\.DETECT_SCREEN_CAPTURE/u, 'Android 14+ screenshot hints use the official normal permission')
  assert.doesNotMatch(manifest, /READ_MEDIA_IMAGES|READ_MEDIA_VISUAL_USER_SELECTED|READ_EXTERNAL_STORAGE/u, 'system picker must not expand media or storage permissions')
  const screenshotHintSource = mainActivity.slice(mainActivity.indexOf('private void notifyScreenCaptured()'), mainActivity.indexOf('protected void onResume()'))
  assert.doesNotMatch(screenshotHintSource, /MediaStore\.|new\s+ContentObserver|registerContentObserver|getContentResolver/u, 'screenshot hints must never infer or read the newest media item')
  assert.match(androidBuild, /defaultUpdateManifestUrl = "https:\/\/raw\.githubusercontent\.com\/baiyuscc13724-max\/deepseek-harness-desktop\/main\/mobile\/mobile-app-update\.json"/u, 'Android must have an independent mobile update channel')
  const parsedUpdateFeed = JSON.parse(updateFeed)
  assert.equal(parsedUpdateFeed.schemaVersion, 1)
  assert.equal(parsedUpdateFeed.platforms.android.version, '0.0.0', 'the mutable channel must stay dormant until a signed mobile release is approved')
  assertContainsAll(adapter, [
    'data-harness-mobile-add-photo',
    "input.type='file'",
    'input.accept=accept',
    "makeInput('harness-mobile-photo-input','image/*')",
    'ClipboardEvent',
    'new FileReader()',
    'reader.readAsArrayBuffer(file)',
    'new File([reader.result]',
    'textarea[data-phase]',
    'var syncState=function(button)',
    'button.disabled=disabled',
    "button.setAttribute('aria-disabled',disabled?'true':'false')",
    'var affectsEntry=function(records)',
    'if(affectsEntry(records))syncOrMount()'
  ], 'Android mobile attachment bridge')
  assertContainsAll(compat, [
    ':focus-visible',
    'prefers-reduced-motion',
    'data-harness-mobile-appbar',
    'data-harness-mobile-drawer',
    'data-harness-mobile-conversation',
    'conversation.session.header',
    'data-chat-flow-kind="context"',
    'data-chat-flow-kind="command"',
    'data-chat-flow-kind="turn-tail"',
    'conversation.composer.dock',
    'data-harness-mobile-composer="orbit"',
    'data-harness-mobile-chat-detail="open"',
    'min-height: 42px',
    '#harness-mobile-input-menu:not([hidden])',
    'grid-template-columns: repeat(2, minmax(0, 1fr))',
    'position: sticky',
    'data-harness-mobile-sheet',
    'data-harness-mobile-settings-dialog',
    'data-harness-mobile-settings-view="list"',
    'data-harness-mobile-settings-toolbar="true"',
    'data-harness-mobile-settings-category="true"',
    'data-harness-mobile-conversation-search-proxy',
    'data-harness-mobile-conversation-list-title',
    'data-harness-mobile-model-routing="true"',
    '#harness-mobile-model-routing',
    'harness-mobile-model-meters',
    'data-harness-mobile-plugin-config="true"',
    '#harness-mobile-plugin-config',
    'data-harness-mobile-home-text="true"',
    '#harness-mobile-screenshot-suggestion',
    'data-harness-mobile-composer-frame="true"',
    'max-width: 100% !important',
    'position: fixed !important',
    'width: 100vw !important',
    'height: 100dvh !important',
    'data-harness-mobile-composer-lifted="true"',
    'var(--harness-mobile-ime-overlay, 0px)',
    'html[data-harness-mobile="true"][data-hd-theme]:root [data-slot="sidebar"] > *'
  ], 'Android native-feeling mobile shell and accessibility')
  assertContainsAll(runtime, [
    'containComposerContext',
    "document.querySelector('[data-composer-card]')",
    'composerStyleRestorations',
    "card?.querySelector('button[aria-haspopup=\"listbox\"]')",
    'setTemporary(button.parentElement',
    "const mobilePlatform = String(window.HarnessMobilePlatform || 'android')",
    'const mobileCapabilities = Object.freeze({',
    "root.dataset.harnessMobilePlatform = mobilePlatform",
    "Object.defineProperty(window, '__harnessMobileCapabilities'",
    'if (mobileCapabilities.imeSendBridge) installImeSendBridge()',
    'if (mobileCapabilities.screenshotSuggestion) installScreenshotSuggestion()',
    'if (mobileCapabilities.controlSettings) installControlSettingsEntry()',
    'installImeSendBridge',
    'installComposerLift',
    'harnessMobileComposerLifted',
    'harness-mobile-ime-change',
    'releaseComposerFocus',
    'pendingSendTextarea',
    'dispatchOfficialEnter',
    'structuralSelector',
    'records.some(needsMount)',
    'installSidebarAutoClose',
    'installTimeZoneCompatibility',
    "timeZone: 'UTC'",
    'setSidebarExpanded(false)',
    'installMobileAppShell',
    'decorateDialogs',
    'decorateConversation',
    'mobileSettingsCategories',
    'setSettingsView',
    'findNativeSettingsClose(dialog)?.click()',
    'harnessMobileConversationSearchSection',
    'shell.dataset.harnessMobileConversationHomeOpened',
    "['Settings', '设置']",
    'decorateMobileModelSettings',
    "fetch('/__harness_mobile__/model-routing'",
    "fetch('/__harness_mobile__/provider-meters'",
    '余额与额度',
    'decorateMobilePluginSettings',
    "fetch('/__harness_mobile__/plugins'",
    '只读显示已配对电脑的真实插件状态',
    '只读显示，来源：已配对电脑',
    '不代表凭据或连接状态',
    'installScreenshotSuggestion',
    "window.addEventListener('harness-mobile-screen-captured'",
    "document.getElementById('harness-mobile-photo-button')",
    '应用没有读取图片',
    "dialog.dataset.harnessMobileSettingsView = list ? 'list' : 'detail'",
    'nav.inert = !list',
    'content.inert = list',
    '返回设置分类',
    'data-harness-mobile-settings-close',
    "root.dataset.harnessMobileSettingsOpen = 'true'",
    "composerFrame.dataset.harnessMobileComposerFrame = 'true'",
    "composerFrame.dataset.harnessMobileComposerSeat = 'true'",
    "composer.dataset.harnessMobileComposer = 'orbit'",
    "input.placeholder = '发消息…'",
    'decorateConversationWorkflow',
    'data-harness-mobile-workflow-summary',
    'decorateAgentTeamsWorkbench',
    'data-harness-mobile-agent-detail-toggle',
    'data-harness-mobile-project-task-toggle',
    'data-harness-mobile-profile-card="true"',
    'officialAgentSessionId',
    'openOfficialAgentCanvas',
    'openOfficialScheduledTasks',
    '团队属于来源会话，不会因项目名称相同而合并。',
    '选择其他项目或会话',
    'officialSourceContext',
    'data-harness-mobile-switch-context',
    "['Open in new window', '在新窗口中打开']",
    "['Delete workspace', '删除项目']",
    'Workspace actions for\\s+(.+)',
    'data-harness-mobile-context-scope',
    '搜索项目和对话',
    'actionButton.hidden = !conversationsDomain',
    '上下文已压缩',
    'Update to-do list',
    '更新待办 ·',
    '团队画布已就绪',
    '返回对话并说明目标',
    "document.addEventListener('pointerdown'",
    'mobileMenu.contains(event.target)',
    '[data-harness-mobile-session-row="true"][aria-selected="true"]',
    'window.__harnessMobileHandleBack',
    'data-harness-mobile-home-text="true"',
    '<span>首页</span>',
    "root.dataset.harnessMobileDomain = activeDomain?.id || 'conversations'"
  ], 'Android mobile shell behavior and large-text containment')
  assert.doesNotMatch(runtime, /当前项目 · 已绑定/u, 'mobile context must explain its source instead of claiming an opaque binding')
  assert.doesNotMatch(runtime, /搜索对话和任务/u, 'conversation search must not imply that Scheduled Tasks are mixed into conversation search')
  assert.doesNotMatch(runtime, /settings\.describe|credentials\.(?:describe|set|unset)/u, 'mobile UI must not bypass the official protected settings and credentials plane')
  assert.doesNotMatch(runtime, /data-harness-mobile-action="more"/, 'mobile app bar must not expose an empty overflow action')
  assert.doesNotMatch(`${compat}\n${runtime}`, /qianwen/i, 'mobile presentation must use the original Orbit design language instead of a competitor-named imitation')
  assert.match(compat, /--hm-color-primary:\s*#4968e8/u, 'Orbit brand tokens must remain explicit and testable')
  assert.match(compat, /\[data-harness-mobile-conversation="true"\]\s*\{[^}]*height:\s*100%\s*!important/s, 'conversation follows the resized WebView instead of the layout viewport')
  assert.match(compat, /data-harness-mobile-composer-input="true"[\s\S]*?max-height:\s*min\(168px, 30dvh\)/u, 'long text input has a bounded growth ceiling')
  assert.match(compat, /data-input-mirror[\s\S]*?white-space:\s*pre-wrap !important;/u, 'Chinese multiline mirror preserves line breaks')
  assert.match(compat, /data-harness-mobile-composer-lifted="true"[\s\S]*?scroll-padding-bottom:\s*calc\(196px \+ var\(--harness-mobile-ime-overlay, 0px\)\)/u, 'IME lift reserves the visual viewport overlay')
})

test('mobile product specification includes real interaction and privacy release gates', async () => {
  const spec = await read('docs', 'MOBILE_APPLE_EXPERIENCE.zh-CN.md')
  assertContainsAll(spec, [
    '文本、照片、文件与截图发送',
    'Android Emulator',
    'iOS Simulator',
    '最小权限',
    'VoiceOver',
    'TalkBack',
    '发布阻断'
  ], 'mobile Apple experience specification')
})
