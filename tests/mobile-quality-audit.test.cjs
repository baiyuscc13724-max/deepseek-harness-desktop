const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const files = {
  main: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'MainActivity.java'),
  networkPolicy: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'NetworkReconnectPolicy.java'),
  capture: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'HarnessCaptureActivity.java'),
  manifest: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  layout: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res', 'layout', 'activity_main.xml'),
  scanner: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res', 'layout', 'activity_scanner.xml'),
  dimensions: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res', 'values', 'dimens.xml'),
  strings: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
  runtime: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'),
  css: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css'),
  adapter: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'MobileUiAdapter.java'),
  audit: path.join(root, 'docs', 'mobile-quality-audit.md')
}

async function sources(...names) {
  const entries = await Promise.all(names.map(async name => [name, await readFile(files[name], 'utf8')]))
  return Object.fromEntries(entries)
}

function methodBody(source, signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = nextSignature ? source.indexOf(nextSignature, start + signature.length) : -1
  return source.slice(start, end === -1 ? undefined : end)
}

test('状态连续性：前台恢复保留现有 WebView 文档而不是 reload', async () => {
  const { main } = await sources('main')
  const onResume = methodBody(main, 'protected void onResume()', 'private void checkMobileAppUpdate()')
  assert.match(onResume, /webView\.onResume\(\)/)
  assert.match(onResume, /webView\.resumeTimers\(\)/)
  assert.match(onResume, /mobileUiAdapter\.inject\(webView\)/)
  assert.doesNotMatch(onResume, /\.reload\(|\.loadUrl\(/, '前台恢复不得重建主文档')
  assert.match(main, /rememberSession\(String sessionId\)/)
  assert.match(main, /restoreSession\(\)/)
})

test('离线与重连：网络回调去抖、保留配对并使用有界退避', async () => {
  const { main, networkPolicy, strings } = await sources('main', 'networkPolicy', 'strings')
  assert.match(main, /registerDefaultNetworkCallback\(networkCallback\)/)
  assert.match(networkPolicy, /RECOVERY_HOLDOFF_MS\s*=\s*250L/)
  assert.match(networkPolicy, /LOSS_HOLDOFF_MS\s*=\s*1_500L/)
  assert.match(networkPolicy, /SWITCH_HOLDOFF_MS\s*=\s*3_000L/)
  assert.match(main, /WORKBENCH_RETRY_DELAYS_MS\s*=\s*\{\s*800L,\s*1500L,\s*2500L,\s*4000L,\s*5000L\s*\}/)
  assert.match(main, /localProxy\.resetRoutePreference\(transition\.generation\)/)
  assert.match(main, /showConnectionOverlay\(getString\(R\.string\.network_lost_status\)\)/)
  assert.match(strings, /name="network_lost_status"/)
  assert.match(strings, /恢复后会自动重新连接/)
})

test('焦点与键盘：原生 resize、IME inset 与 Web visualViewport 形成双通道契约', async () => {
  const { main, manifest, runtime, css } = await sources('main', 'manifest', 'runtime', 'css')
  assert.match(manifest, /android:windowSoftInputMode="stateAlwaysHidden\|adjustResize"/)
  assert.match(main, /WindowInsetsCompat\.Type\.ime\(\)/)
  assert.match(main, /--harness-mobile-ime-height/)
  assert.match(main, /harness-mobile-ime-change/)
  assert.match(runtime, /window\.visualViewport/)
  assert.match(runtime, /--harness-mobile-ime-overlay/)
  assert.match(css, /var\(--harness-mobile-ime-overlay,\s*0px\)/)
})

test('加载、空态与恢复：状态可理解，退避错误、过期配对和人工恢复均有路径', async () => {
  const { main, layout, strings, runtime } = await sources('main', 'layout', 'strings', 'runtime')
  assert.match(layout, /android:id="@\+id\/connection_status"[\s\S]*android:accessibilityLiveRegion="polite"/)
  assert.match(main, /isRetryableHttpStatus\(errorResponse\.getStatusCode\(\)\)/)
  assert.match(main, /isPairingRejectedHttpStatus\(errorResponse\.getStatusCode\(\)\)/)
  assert.match(main, /setPositiveButton\(getString\(R\.string\.action_reconnect_now\)/)
  assert.match(main, /setNeutralButton\(getString\(R\.string\.action_forget_computer\)/)
  assert.match(strings, /name="workbench_slow_status"/)
  assert.match(strings, /name="pairing_expired_status"/)
  assert.match(runtime, /empty\.textContent = '还没有项目'/)
  assert.match(runtime, /已配对电脑暂未返回可显示的提供方/)
  assert.match(runtime, /已配对电脑返回的权威插件列表为空/)
})

test('新配对首屏：当前“内测声明”由手机运行时识别并通过官方按钮关闭', async () => {
  const { runtime } = await sources('runtime')
  const start = runtime.indexOf('  const dismissOfficialNotice = () => {')
  const end = runtime.indexOf('  const decorateHeader = () => {', start)
  assert.ok(start >= 0 && end > start)
  let clicks = 0
  const proceed = { textContent: '继续', click() { clicks += 1 } }
  const notice = {
    textContent: '内测声明 DeepSeek Harness 目前仍处在测试阶段',
    querySelectorAll(selector) { return selector === 'button' ? [proceed] : [] }
  }
  const dismiss = new Function('document', `${runtime.slice(start, end)}; return dismissOfficialNotice`)({
    querySelectorAll(selector) { return selector === '[role="dialog"],dialog' ? [notice] : [] }
  }) // eslint-disable-line no-new-func
  assert.equal(dismiss(), true)
  assert.equal(clicks, 1, 'the official Continue action must remain the only dismissal authority')
})

test('呈现根透明区域：官方项目和会话行保持可点击，手机自有控件单独接收触摸', async () => {
  const { css } = await sources('css')
  const rule = css.match(/#harness-mobile-presentation-root > #harness-mobile-app-shell\s*\{([^}]*)\}/)?.[1] || ''
  assert.match(rule, /pointer-events:\s*none !important;/, 'the full-screen shell must not intercept official sidebar rows')
  assert.doesNotMatch(rule, /pointer-events:\s*auto/, 'presentation isolation must not create a transparent touch blocker')
  for (const selector of ['data-harness-mobile-appbar', 'data-harness-mobile-navigation', 'data-harness-mobile-conversation-search-proxy']) {
    assert.match(css, new RegExp(`\\[${selector}[^}]*\\][^{]*\\{[^}]*pointer-events:\\s*auto`, 's'), `${selector} must remain independently interactive`)
  }
})

test('触控、安全区与动画：原生 48dp 基线、cutout/IME inset、Web safe-area 和 Reduce Motion 均受保护', async () => {
  const { main, layout, scanner, dimensions, css } = await sources('main', 'layout', 'scanner', 'dimensions', 'css')
  assert.match(dimensions, /name="harness_touch_min">48dp</)
  assert.match(layout, /android:layout_height="@dimen\/harness_button_height"/)
  assert.match(layout, /android:layout_height="@dimen\/harness_button_height_compact"/)
  assert.match(scanner, /android:id="@\+id\/scanner_back_button"[\s\S]*android:layout_height="@dimen\/harness_touch_min"/)
  assert.match(main, /WindowInsetsCompat\.Type\.systemBars\(\)\s*\|\s*WindowInsetsCompat\.Type\.displayCutout\(\)/)
  assert.match(css, /env\(safe-area-inset-top\)/)
  assert.match(css, /env\(safe-area-inset-bottom\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
})

test('扫码拒权恢复：拒绝相机后提供重试、系统设置、返回与辅助技术播报', async () => {
  const { capture, scanner, strings } = await sources('capture', 'scanner', 'strings')
  assert.match(capture, /else showPermissionRecovery\(\)/)
  assert.match(capture, /permissionPanel\.announceForAccessibility/)
  assert.match(capture, /Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/)
  assert.match(scanner, /android:id="@\+id\/scanner_permission_retry"/)
  assert.match(scanner, /android:id="@\+id\/scanner_permission_settings"/)
  assert.match(scanner, /android:id="@\+id\/scanner_back_button"/)
  assert.match(strings, /你也可以返回后粘贴配对地址/)
})

test('审计文档：每个发现都包含复现、证据、严重度、根因、归属文件与验收标准', async () => {
  const { audit } = await sources('audit')
  const issues = [...audit.matchAll(/^### (MQA-\d{2})[^\n]*\n([\s\S]*?)(?=^### MQA-|^## 5\.)/gm)]
  assert.equal(issues.length, 7, '审计问题数量漂移时必须同步更新契约')
  for (const [, id, body] of issues) {
    assert.match(body, /\*\*严重度：P[012]\*\*/, `${id} 缺严重度`)
    assert.match(body, /\*\*复现\*\*/, `${id} 缺复现步骤`)
    assert.match(body, /\*\*证据\*\*/, `${id} 缺证据`)
    assert.match(body, /\*\*根因候选\*\*/, `${id} 缺根因候选`)
    assert.match(body, /\*\*建议归属文件\*\*/, `${id} 缺建议归属文件`)
    assert.match(body, /\*\*可验证验收标准\*\*/, `${id} 缺可验证验收标准`)
  }
  assert.match(audit, /\| P0 \| 0 \|/)
  assert.match(audit, /状态连续性/)
  assert.match(audit, /离线\/重连/)
  assert.match(audit, /TalkBack/)
})

// MQA-01～07 必须直接约束产品实现；禁止以删除检查、降低 48px 阈值或 OCR 替代语义验收。
test('MQA-01：200% 字体横屏下配对内容按完整高度测量且主操作可滚达', async () => {
  const { layout } = await sources('layout')
  assert.match(layout, /android:id="@\+id\/pairing_scroll"[\s\S]*android:fillViewport="true"/)
  const scrollChild = layout.match(/<ScrollView[\s\S]*?<LinearLayout([\s\S]*?)>/)?.[1] || ''
  assert.match(scrollChild, /android:layout_height="wrap_content"/)
  assert.doesNotMatch(scrollChild, /android:layout_height="match_parent"/)
  assert.doesNotMatch(layout, /android:layout_height="0dp"\s*android:layout_weight="1"\s*\/>/)
  assert.match(layout, /android:id="@\+id\/connect_button"[\s\S]*android:layout_height="@dimen\/harness_button_height_compact"/)
})

test('MQA-02：无效地址提交后隐藏 IME、保留输入并把单一 polite 错误滚入视口', async () => {
  const { main, layout } = await sources('main', 'layout')
  assert.match(layout, /android:id="@\+id\/pairing_error"[\s\S]*android:accessibilityLiveRegion="polite"/)
  const errorMethod = methodBody(main, 'private void showPairingError(String message)', 'protected void onNewIntent')
  assert.match(errorMethod, /hideSoftKeyboard\(\)/)
  assert.match(errorMethod, /pairingError\.requestRectangleOnScreen\(/)
  assert.match(errorMethod, /pairingScroll\.requestChildFocus\(pairingError, pairingError\)/)
  assert.match(errorMethod, /if \(changed\) pairingError\.setText\(message\)/)
  assert.doesNotMatch(errorMethod, /announceForAccessibility/, 'polite live region must be the single announcement channel')
  assert.doesNotMatch(main, /pairingUrl\.setText\(""\)/, 'invalid input must remain available for correction')
})

test('MQA-03：语义刷新覆盖加载时序、无/有 Dialog 状态与关闭后的焦点返回', async () => {
  const { main, runtime, adapter } = await sources('main', 'runtime', 'adapter')
  assert.match(adapter, /setImportantForAccessibility\(View\.IMPORTANT_FOR_ACCESSIBILITY_YES\)/)
  assert.match(adapter, /setFocusable\(true\)/)
  assert.match(adapter, /if\(!root\|\|!body\)\{delete window\[runtimeMarker\];return false;\}/)
  assert.match(adapter, /INJECTION_DELAYS_MS = \{ 0L, 250L, 900L \}/)
  for (const lifecycle of [
    methodBody(main, 'public void onPageStarted', 'public void onPageCommitVisible'),
    methodBody(main, 'public void onPageCommitVisible', 'public void onPageFinished'),
    methodBody(main, 'public void onPageFinished', 'public void onReceivedError')
  ]) assert.match(lifecycle, /mobileUiAdapter\.inject\(view\)/, 'every post-navigation timing point must refresh semantics')

  const semantics = methodBody(runtime, 'const decorateAccessibilitySemantics = () =>', 'const mount = () =>')
  for (const contract of [
    /setAttribute\('role', 'banner'\)/,
    /setAttribute\('role', 'heading'\)/,
    /setAttribute\('aria-label', '主要导航'\)/,
    /setAttribute\('aria-label', '项目与对话列表'\)/,
    /setAttribute\('role', 'log'\)/,
    /setAttribute\('aria-label', '消息编辑器'\)/,
    /setAttribute\('aria-label', '发送消息'\)/,
    /setAttribute\('aria-label', '停止生成'\)/
  ]) assert.match(semantics, contract)

  const dialogs = methodBody(runtime, 'const decorateDialogs = () =>', 'const decorateConversationWorkflow')
  assert.match(dialogs, /const modalDialogs = \[\]/)
  assert.match(dialogs, /syncDialogFocus\(modalDialogs\)/, 'empty and populated dialog lists must both refresh focus state')
  const focus = methodBody(runtime, 'const syncDialogFocus = dialogs =>', 'const decorateDialogs = () =>')
  assert.match(focus, /const current = dialogs\.find\(dialog => visible\(dialog\)\) \|\| null/)
  assert.match(focus, /if \(trigger\?\.isConnected\) setTimeout\(\(\) => trigger\.focus\?\.\(\{ preventScroll: true \}\), 0\)/)
  assert.match(focus, /if \(!current \|\| activeMobileDialog === current\) return/)
  assert.match(runtime, /window\.__harnessMobileUiObserver = new MutationObserver/)
  assert.match(runtime, /observe\(root, \{ childList: true, subtree: true \}\)/)
  assert.match(runtime, /visibilityState === 'visible'\) scheduleMount\(\)/)
  assert.doesNotMatch(runtime, /OCR|optical character recognition|伪节点/i)
})

test('MQA-04：HTTP、WebView 与 SSL 主帧失败进入有界状态机和明确终止态', async () => {
  const { main, layout, strings } = await sources('main', 'layout', 'strings')
  for (const state of ['RETRYING', 'AUTH_EXPIRED', 'OFFLINE', 'TERMINAL_ERROR']) assert.match(main, new RegExp(`\\b${state}\\b`))
  assert.match(main, /classifyHttpFailure\(int statusCode\)[\s\S]*return MainFrameState\.TERMINAL_ERROR/)
  assert.match(main, /classifyWebFailure\(int errorCode, boolean usableNetwork\)[\s\S]*return MainFrameState\.TERMINAL_ERROR/)
  assert.match(main, /onReceivedSslError[\s\S]*handler\.cancel\(\)[\s\S]*showTerminalMainFrameError/)
  assert.match(main, /workbenchRetryAttempt >= WORKBENCH_RETRY_DELAYS_MS\.length/)
  assert.match(main, /showTerminalMainFrameError[\s\S]*connectionSpinner\.setVisibility\(View\.GONE\)/)
  assert.match(layout, /android:id="@\+id\/terminal_retry_button"/)
  assert.match(layout, /android:id="@\+id\/terminal_rescan_button"/)
  assert.match(strings, /name="terminal_http_status"/)
  assert.match(strings, /配对信息仍已保留/)
})

test('MQA-05：Web 核心交互 hit box 保持至少 48×48 CSS px 且状态不改变几何', async () => {
  const { css } = await sources('css')
  const contract = css.slice(css.indexOf('/* Accessibility hit-target contract.'))
  assert.ok(contract.length > 0, 'final accessibility hit-target layer must exist')
  for (const selector of [
    '[data-harness-mobile-appbar="true"] > button',
    '[data-harness-mobile-navigation] > button',
    '[data-harness-mobile-session-row="true"]',
    '[data-harness-mobile-settings-toolbar="true"] > button',
    '[data-harness-mobile-composer-action="true"]',
    '#harness-mobile-input-button',
    '#harness-mobile-model-button'
  ]) assert.ok(contract.includes(selector), `missing 48px hit-target contract for ${selector}`)
  assert.match(contract, /min-width: 48px !important;[^]*min-height: 48px !important;/)
  assert.match(contract, /button\[data-harness-mobile-icon="brand"\][^]*width: 48px !important;[^]*height: 48px !important;/)
  assert.match(contract, /button\[data-harness-mobile-icon="brand"\] svg[^]*width: 34px !important;[^]*height: 34px !important;/)
  assert.ok(css.lastIndexOf('/* Accessibility hit-target contract.') > css.lastIndexOf('min-height: 34px'), '48px layer must win over compact legacy rules')
  for (const selector of ['button:not(:disabled):active', 'button:disabled', '[data-harness-mobile-document-reference="true"]:focus-visible']) {
    const start = css.lastIndexOf(selector)
    assert.ok(start >= 0, `missing stable ${selector} state`)
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', css.indexOf('{', start)))
    assert.doesNotMatch(body, /(?:^|;)\s*(?:min-|max-)?(?:width|height)|(?:^|;)\s*(?:margin|padding)(?:-|:)/)
  }
})

test('MQA-06：Android 15 预测返回在应用和扫码页统一使用 dispatcher', async () => {
  const { manifest, main, capture } = await sources('manifest', 'main', 'capture')
  assert.match(manifest, /android:enableOnBackInvokedCallback="true"/)
  assert.match(main, /getOnBackPressedDispatcher\(\)\.addCallback/)
  assert.match(capture, /getOnBackPressedDispatcher\(\)\.addCallback/)
  assert.match(capture, /handleOnBackPressed\(\)[\s\S]*cancelAndFinish\(\)/)
  assert.doesNotMatch(capture, /public void onBackPressed\(/)
})

test('MQA-07：局部加载只播报开始/完成且隐藏后不残留辅助技术焦点', async () => {
  const { main, layout, strings } = await sources('main', 'layout', 'strings')
  assert.match(layout, /android:id="@\+id\/loading"[\s\S]*android:accessibilityLiveRegion="polite"/)
  const progress = methodBody(main, 'private void updateAccessibleLoadingProgress(int progress)', 'private void hideLoadingIndicator()')
  assert.match(progress, /if \(!pageLoadingAnnounced\)[\s\S]*page_loading_started/)
  assert.match(progress, /if \(pageLoadingAnnounced\)[\s\S]*page_loading_finished/)
  const hide = methodBody(main, 'private void hideLoadingIndicator()', 'private void showConnectionOverlay')
  assert.match(hide, /setVisibility\(View\.GONE\)/)
  assert.match(hide, /setImportantForAccessibility\(View\.IMPORTANT_FOR_ACCESSIBILITY_NO\)/)
  assert.match(main, /if \(mainFrameLoadFailed\) hideLoadingIndicator\(\)/)
  assert.match(strings, /name="page_loading_started"/)
  assert.match(strings, /name="page_loading_finished"/)
})
