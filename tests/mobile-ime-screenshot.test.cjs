const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')
const runtime = read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js')
const compat = read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css')
const mainActivity = read('mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'MainActivity.java')
const adapter = read('mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'MobileUiAdapter.java')

function assertContainsAll(source, contracts, label) {
  for (const contract of contracts) {
    assert.ok(source.includes(contract), `${label} missing contract: ${contract}`)
  }
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = compat.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'su'))
  assert.ok(match, `missing CSS rule: ${selector}`)
  return match[1]
}

test('draft text immediately presents Stop as send intent without treating it as official Send', () => {
  assertContainsAll(runtime, [
    "document.addEventListener('input'",
    'if (textarea) syncStopIntent(textarea)',
    "const hasDraft = Boolean((textarea?.value || '').trim())",
    "button.dataset.harnessMobileStopAsSend = 'true'",
    "button.setAttribute('aria-label', sendLabel)",
    "button.setAttribute('title', sendLabel)",
    'for (const button of buttons) if (stopAsSend(button)) restoreStopPresentation(button)',
    'delete button.dataset.harnessMobileStopAsSend',
    'window.__harnessMobileSyncComposerIntent?.(input)'
  ], 'send-intent presentation')
  assert.match(runtime, /const isSend = button => !stopAsSend\(button\) && \/send message\|发送消息\|发送\/i\.test\(actionLabel\(button\)\)/u)

  const decoratedRule = cssRule('[data-composer-card] button[data-harness-mobile-stop-as-send="true"]')
  assert.match(decoratedRule, /background:\s*var\(--hm-color-primary/u)
  assert.match(cssRule('[data-composer-card] button[data-harness-mobile-stop-as-send="true"] > *'), /opacity:\s*0\s*!important/u)
  assert.match(cssRule('[data-composer-card] button[data-harness-mobile-stop-as-send="true"]::after'), /content:\s*"↑"\s*!important/u)
})

test('send-intent clicks are captured before Stop and wait for the official Send control', () => {
  assertContainsAll(runtime, [
    "document.addEventListener('click'",
    'event.preventDefault()',
    'event.stopImmediatePropagation()',
    'pendingStop = button',
    'activateOfficialSend(textarea)',
    'if (button !== stop || !(textarea.value || \'\').trim()) return',
    '.find(button => isSend(button) && !button.disabled && visible(button))',
    'if (++attempts < 12) setTimeout(activate, 24)'
  ], 'guarded send activation')
  assert.match(runtime, /if \(!hasDraft\) \{[^]*pendingStop = null[^]*return null/u)
  assert.match(runtime, /const isStop = button => stopAsSend\(button\) \|\|/u)
})

test('screenshot notice stays in composer flow and only opens the system photo picker', () => {
  assertContainsAll(runtime, [
    "const composerSeat = () => document.querySelector('[data-composer-card]')?.closest?.('[data-composer-seat]') || null",
    'seat.insertBefore(chip, seat.firstChild)',
    "chip.dataset.harnessMobileComposerSuggestion = 'true'",
    '应用没有读取图片；请从系统照片选择器选择',
    "document.getElementById('harness-mobile-photo-button') || document.getElementById('harness-mobile-photo-input')",
    'const photo = photoPicker()',
    'photo.click()'
  ], 'composer-anchored screenshot suggestion')
  const screenshotStart = runtime.indexOf('  const installScreenshotSuggestion = () => {')
  const screenshotEnd = runtime.indexOf('  const shortStableRef = value => {', screenshotStart)
  assert.ok(screenshotStart >= 0 && screenshotEnd > screenshotStart, 'missing installScreenshotSuggestion contract')
  const screenshotRuntime = runtime.slice(screenshotStart, screenshotEnd)
  assert.match(screenshotRuntime, /dismissTimer = setTimeout\(dismiss, 6_000\)/u)
  assert.doesNotMatch(screenshotRuntime, /setTimeout\(dismiss, 12_000\)/u)
  assert.doesNotMatch(screenshotRuntime, /document\.body\.appendChild\(chip\)|FileReader|fetch\(|getContentResolver|MediaStore/u)

  const suggestionRule = cssRule('#harness-mobile-screenshot-suggestion')
  assert.match(suggestionRule, /position:\s*relative\s*!important/u)
  assert.match(suggestionRule, /flex:\s*0 0 auto\s*!important/u)
  assert.doesNotMatch(suggestionRule, /position:\s*fixed|top:\s*calc/u)

  assertContainsAll(mainActivity, [
    'supplies no Bitmap or URI',
    'explicit Photo',
    'recentImagePicker.launch(request)',
    'MAX_PICKED_IMAGES = 20',
    'new ActivityResultContracts.PickMultipleVisualMedia(MAX_PICKED_IMAGES)',
    'uris.toArray(new Uri[0])',
    'completeFileChooser'
  ], 'Android screenshot and picker contract')
  const screenshotMethod = mainActivity.match(/private void notifyScreenCaptured\(\) \{[^]*?\n    \}/u)?.[0] || ''
  assert.ok(screenshotMethod, 'missing notifyScreenCaptured contract')
  assert.doesNotMatch(screenshotMethod, /getContentResolver|MediaStore\.(?:Images|Files)|BitmapFactory|registerContentObserver/u)

  assertContainsAll(adapter, [
    "makeInput('harness-mobile-photo-input','image/*')",
    "var paste=new ClipboardEvent('paste'",
    'textarea.dispatchEvent(paste)',
    "new DragEvent('drop'",
    'new File([reader.result]'
  ], 'official attachment preview bridge')
})

test('IME, history, theme, navigation, attachment and control bridges remain mounted', () => {
  assertContainsAll(runtime, [
    'installImeSendBridge',
    'installComposerLift',
    'installHistoryRecovery',
    'installThemeBridge',
    'syncMobileNavigation',
    'installScreenshotSuggestion',
    'installControlSettingsEntry',
    'harness-mobile-ime-change',
    'structuralSelector',
    'records.some(needsMount)'
  ], 'mobile runtime regression surface')
  assertContainsAll(adapter, [
    'data-harness-mobile-input-menu',
    'harness-mobile-photo-input',
    'affectsEntry',
    'if(affectsEntry(records))syncOrMount()'
  ], 'attachment lifecycle')
})
