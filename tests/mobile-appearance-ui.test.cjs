const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')
const read = relative => readFile(path.join(root, relative), 'utf8')

test('phone appearance persists independently from desktop and exposes a phone-only skin page', async () => {
  const [main, store, integration] = await Promise.all([
    read('electron/main.cjs'),
    read('electron/store/app-state-store.cjs'),
    read('renderer/theme-integration.js')
  ])

  assert.match(store, /mobileAppearance:\s*\{[\s\S]*glassTransparency:\s*0[\s\S]*readabilityStrength:\s*100/u)
  assert.match(store, /updateMobileAppearance\(patch = \{\}\)/u)
  assert.match(main, /ensureStateStore\(\)\.get\(\)\.mobileAppearance/u)
  assert.match(main, /ensureStateStore\(\)\.updateMobileAppearance\(\{ themeId \}\)/u)
  assert.doesNotMatch(main, /async function updateMobileAppearance[\s\S]{0,900}updateAppearance\(/u)
  assert.doesNotMatch(main, /async function readMobileThemeAsset[\s\S]{0,900}get\(\)\.appearance/u, 'paired phones must not read the desktop wallpaper through the mobile theme asset route')
  assert.match(integration, /label\.textContent = mobile \? '手机外观' : '外观与界面模式'/u)
  assert.match(integration, /皮肤仅保存在手机版，不会改变电脑端外观/u)
  assert.match(integration, /data-hd-appearance-tab="modes"\]'\)\.hidden = true/u)
})

test('phone themes keep core surfaces opaque and composer lifts only for an active IME', async () => {
  const [css, runtime, activity, manifest] = await Promise.all([
    read('mobile/android/app/src/main/assets/mobile-compat.css'),
    read('mobile/android/app/src/main/assets/mobile-runtime.js'),
    read('mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java'),
    read('mobile/android/app/src/main/AndroidManifest.xml')
  ])

  assert.match(css, /html\[data-harness-mobile="true"\]\[data-hd-theme\]:root \[data-slot="sidebar"\] > \*/u)
  assert.match(css, /background:\s*linear-gradient\(var\(--dsw-alias-bg-layer-1/u)
  assert.ok(css.includes('var(--harness-mobile-opaque-base) !important;'))
  assert.match(css, /data-harness-mobile-composer-lifted="true"[\s\S]*position:\s*fixed\s*!important/u)
  assert.match(runtime, /const installComposerLift = \(\) =>/u)
  assert.match(runtime, /const lifted = focused && \(nativeImeOpen \|\| viewportCovered\)/u)
  assert.match(runtime, /root\.dataset\.harnessMobileComposerLifted = String\(lifted\)/u)
  assert.match(activity, /bottom \+ systemBars\.bottom/u)
  assert.match(activity, /boolean nextImeVisible = windowInsets\.isVisible\(WindowInsetsCompat\.Type\.ime\(\)\)/u)
  assert.match(activity, /api33BackDispatcher\.setImeVisible\(nextImeVisible\)/u)
  assert.match(activity, /publishImeInsets\(nextImeVisible, Math\.max\(0, ime\.bottom - systemBars\.bottom\)\)/u)
  assert.doesNotMatch(manifest, /android\.permission\.RECORD_AUDIO/u)
})

test('drawer summary keeps details action and recovery counts in normal responsive flow', async () => {
  const [android, ios] = await Promise.all([
    read('mobile/android/app/src/main/assets/mobile-compat.css'),
    read('mobile/ios/HarnessMobile/Resources/mobile-compat.css')
  ])

  assert.equal(android, ios, 'Android and iOS mobile CSS must stay byte-identical')
  assert.match(android, /data-harness-mobile-drawer="open"[^{}]*data-harness-mobile-conversation-list-title[\s\S]*?position:\s*static\s*!important/u)
  assert.match(android, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, auto\)\s*!important/u)
  assert.match(android, /data-harness-mobile-conversation-list-title\] > div[\s\S]*?min-width:\s*0\s*!important[\s\S]*?overflow:\s*hidden\s*!important/u)
  assert.match(android, /data-harness-mobile-conversation-list-title\] \[data-harness-mobile-project-details\][\s\S]*?max-width:\s*min\(40vw, 132px\)\s*!important/u)
  assert.match(android, /data-harness-mobile-conversation-list-title\] strong,[\s\S]*?overflow-wrap:\s*anywhere\s*!important[\s\S]*?white-space:\s*normal\s*!important/u)
  assert.match(android, /data-harness-mobile-drawer="open"[^{}]*\[class\*="_sidebarCol"\][\s\S]*?padding-top:\s*48px\s*!important/u)
  assert.doesNotMatch(android, /padding-top:\s*(?:84|148)px\s*!important/u, 'drawer must not double-reserve summary space')
  assert.match(android, /data-harness-mobile-conversation-search-box\][\s\S]*?top:\s*calc\(var\(--harness-mobile-appbar-height\) \+ 14px\)[\s\S]*?min-height:\s*46px/u)
  assert.match(android, /data-harness-mobile-conversation-list-title\][\s\S]*?margin:\s*calc\(var\(--harness-mobile-appbar-height\) \+ 14px \+ 46px \+ 8px\)/u)
})
