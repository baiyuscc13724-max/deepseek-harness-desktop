const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const android = path.join(root, 'mobile', 'android', 'app', 'src', 'main')
const files = {
  main: path.join(android, 'java', 'io', 'harnessdesktop', 'mobile', 'MainActivity.java'),
  capture: path.join(android, 'java', 'io', 'harnessdesktop', 'mobile', 'HarnessCaptureActivity.java'),
  manifest: path.join(android, 'AndroidManifest.xml'),
  layout: path.join(android, 'res', 'layout', 'activity_main.xml'),
  strings: path.join(android, 'res', 'values', 'strings.xml')
}

async function sources(...names) {
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(files[name], 'utf8')])))
}

test('MQA-01: pairing content measures its full height and exposes a real scroll range', async () => {
  const { layout } = await sources('layout')
  assert.match(layout, /android:id="@\+id\/pairing_scroll"/)
  const scrollChild = layout.match(/<ScrollView[\s\S]*?<LinearLayout([\s\S]*?)>/)?.[1] || ''
  assert.match(scrollChild, /android:layout_height="wrap_content"/)
  assert.doesNotMatch(scrollChild, /android:layout_height="match_parent"/)
  assert.doesNotMatch(layout, /android:layout_height="0dp"\s*android:layout_weight="1"\s*\/>/)
  assert.match(layout, /android:id="@\+id\/connect_button"[\s\S]*android:layout_height="@dimen\/harness_button_height_compact"/)
})

test('MQA-02: invalid IME submission preserves input while revealing one polite error', async () => {
  const { main, layout } = await sources('main', 'layout')
  assert.match(layout, /android:id="@\+id\/pairing_error"[\s\S]*android:accessibilityLiveRegion="polite"/)
  assert.match(main, /private void showPairingError\(String message\)[\s\S]*hideSoftKeyboard\(\)/)
  assert.match(main, /pairingError\.requestRectangleOnScreen\(/)
  assert.match(main, /pairingScroll\.requestChildFocus\(pairingError, pairingError\)/)
  assert.doesNotMatch(main, /pairingUrl\.setText\(""\)/, 'invalid input must remain editable')
  const errorMethod = main.slice(main.indexOf('private void showPairingError'), main.indexOf('@Override', main.indexOf('private void showPairingError')))
  assert.doesNotMatch(errorMethod, /announceForAccessibility/, 'polite live region must be the only announcement path')
})

test('MQA-04: main-frame failures use bounded retry, offline, auth-expired and terminal states', async () => {
  const { main, layout, strings } = await sources('main', 'layout', 'strings')
  for (const state of ['RETRYING', 'AUTH_EXPIRED', 'OFFLINE', 'TERMINAL_ERROR']) {
    assert.match(main, new RegExp(`\\b${state}\\b`))
  }
  assert.match(main, /classifyHttpFailure\(int statusCode\)/)
  assert.match(main, /statusCode == 502 \|\| statusCode == 503 \|\| statusCode == 504/)
  assert.match(main, /statusCode == 401 \|\| statusCode == 403 \|\| statusCode == 410/)
  assert.match(main, /onReceivedSslError[\s\S]*handler\.cancel\(\)/)
  assert.match(main, /workbenchRetryAttempt >= WORKBENCH_RETRY_DELAYS_MS\.length/)
  assert.match(main, /showTerminalMainFrameError/)
  assert.match(layout, /android:id="@\+id\/connection_spinner"/)
  assert.match(layout, /android:id="@\+id\/terminal_retry_button"/)
  assert.match(layout, /android:id="@\+id\/terminal_rescan_button"/)
  assert.match(main, /showTerminalMainFrameError[\s\S]*connectionSpinner\.setVisibility\(View\.GONE\)/)
  assert.match(strings, /name="terminal_http_status"/)
  assert.match(strings, /配对信息仍已保留/)
})

test('MQA-06: Android 15 predictive back and scanner cancellation share dispatchers', async () => {
  const { manifest, main, capture } = await sources('manifest', 'main', 'capture')
  assert.match(manifest, /android:enableOnBackInvokedCallback="true"/)
  assert.match(main, /getOnBackPressedDispatcher\(\)\.addCallback/)
  assert.match(capture, /getOnBackPressedDispatcher\(\)\.addCallback/)
  assert.match(capture, /handleOnBackPressed\(\)[\s\S]*cancelAndFinish\(\)/)
  assert.doesNotMatch(capture, /public void onBackPressed\(/)
})

test('MQA-07: local page loading announces only start and completion then leaves no focus target', async () => {
  const { main, layout, strings } = await sources('main', 'layout', 'strings')
  assert.match(layout, /android:id="@\+id\/loading"[\s\S]*android:accessibilityLiveRegion="polite"/)
  assert.match(main, /if \(!pageLoadingAnnounced\)[\s\S]*page_loading_started/)
  assert.match(main, /page_loading_finished/)
  assert.match(main, /setImportantForAccessibility\(View\.IMPORTANT_FOR_ACCESSIBILITY_NO\)/)
  assert.match(main, /if \(mainFrameLoadFailed\) hideLoadingIndicator\(\)/)
  assert.match(strings, /name="page_loading_started"/)
  assert.match(strings, /name="page_loading_finished"/)
})
