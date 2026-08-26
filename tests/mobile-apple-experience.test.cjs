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
  const [content, pairing, banner, workbench] = await Promise.all([
    read('mobile', 'ios', 'HarnessMobile', 'App', 'ContentView.swift'),
    read('mobile', 'ios', 'HarnessMobile', 'App', 'PairingView.swift'),
    read('mobile', 'ios', 'HarnessMobile', 'App', 'StatusBannerView.swift'),
    read('mobile', 'ios', 'HarnessMobile', 'App', 'WorkbenchView.swift')
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
  assert.doesNotMatch(workbench, /WKOpenPanelParameters|runOpenPanelWith parameters/, 'iOS 18.4-only open-panel API must not be referenced by the iOS 16 target')
  assert.doesNotMatch(workbench, /PhotosUI|PHPicker|UIDocumentPicker/, 'the iOS 16 path must rely on the permission-minimal WebKit system picker')
})

test('Android native shell keeps touch, state, dark-mode, and attachment contracts', async () => {
  const [mainLayout, controlLayout, scannerLayout, dimensions, colors, nightColors, nightStyles, mainActivity, scannerActivity, adapter, compat, runtime] = await Promise.all([
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
    read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js')
  ])

  assertContainsAll(mainLayout, [
    '<ScrollView',
    '@+id/scan_button',
    '@+id/pairing_error',
    'android:accessibilityLiveRegion="polite"',
    '@string/'
  ], 'Android pairing shell')
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
    'super.onBackPressed()'
  ], 'Android scanner permission ownership')
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
    'ActivityResultLauncher<Intent>',
    'mainFrameLoadFailed',
    'if (!mainFrameLoadFailed) revealWorkbench()',
    "document.querySelector('[data-slot=\\\"conversation\\\"]') ||",
    "document.querySelector('[data-slot=\\\"sidebar\\\"]') ||"
  ], 'Android native file chooser and shell readiness')
  assert.doesNotMatch(mainActivity, /\.isBlank\(|List\.of\(|(?<!Collectors)\.toList\(/u, 'minSdk 26 production code must not use newer un-desugared Java collection/string APIs')
  assertContainsAll(adapter, [
    'data-harness-mobile-add-photo',
    "input.type='file'",
    "input.accept='image/*'",
    'ClipboardEvent',
    'textarea[data-phase]',
    'button.disabled!==unavailable',
    "button.getAttribute('aria-disabled')!==ariaDisabled"
  ], 'Android mobile attachment bridge')
  assertContainsAll(compat, [':focus-visible', 'prefers-reduced-motion'], 'Android embedded workbench accessibility')
  assertContainsAll(runtime, [
    'containComposerContext',
    "document.querySelector('[data-composer-card]')",
    'cardRect.right - target.rect.left',
    "item.style.setProperty('overflow', 'hidden', 'important')"
  ], 'Android large-text preset containment')
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
