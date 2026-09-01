const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const renderer = readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8')
const rendererHtml = readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8')
const rendererCss = readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8')
const mainActivity = readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'MainActivity.java'), 'utf8')
const pairingStore = readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'PairingProfileStore.java'), 'utf8')
const assetCache = readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'MobileAssetCache.java'), 'utf8')
const mobileRuntime = readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'), 'utf8')

function extractConst(name, nextName) {
  const start = renderer.indexOf(`  const ${name} =`)
  const end = renderer.indexOf(`\n  const ${nextName} =`, start)
  assert.ok(start >= 0 && end > start, `${name} source boundary is present`)
  const source = renderer.slice(start, end)
  const fakeDocument = { querySelector: () => null }
  return new Function('openMobileSync', 'document', `${source}; return ${name}`)(() => {}, fakeDocument) // eslint-disable-line no-new-func
}

function extractBefore(name, boundary, bindings = {}) {
  const start = renderer.indexOf(`  const ${name} =`)
  const end = renderer.indexOf(boundary, start)
  assert.ok(start >= 0 && end > start, `${name} source boundary is present`)
  const source = renderer.slice(start, end)
  return new Function(...Object.keys(bindings), `${source}; return ${name}`)(...Object.values(bindings)) // eslint-disable-line no-new-func
}

test('desktop shell does not duplicate the official workspace mobile sync entry', () => {
  assert.doesNotMatch(rendererHtml, /id="mobileSyncQuickButton"/u)
  assert.doesNotMatch(rendererCss, /\.mobile-sync-quick-button/u)
  assert.doesNotMatch(renderer, /mobileSyncQuickButton/u)
  assert.equal((renderer.match(/entry\.id = 'harness-desktop-mobile-sync-entry'/gu) || []).length, 1)
})

test('mobile sync uses a body-level fixed portal instead of the official Settings event tree', () => {
  assert.match(renderer, /const mountMobileEntry = \(\) => \{/u)
  assert.match(renderer, /\[data-slot="settings\.trigger"\] button/u)
  assert.match(renderer, /entry\.parentElement !== document\.body\) document\.body\.append\(entry\)[\s\S]*const settingsTrigger = findSettingsTrigger\(\)/u)
  assert.match(renderer, /entry\.style\.bottom = '10px'[\s\S]*entry\.hidden = false/u)
  assert.match(renderer, /#harness-desktop-mobile-sync-entry \{ position:fixed; z-index:18;/u)
  assert.match(renderer, /pointer-events:auto; touch-action:manipulation; app-region:no-drag; -webkit-app-region:no-drag/u)
  assert.doesNotMatch(renderer, /host\.insertBefore\(entry, settingsTrigger\)/u)
  assert.doesNotMatch(renderer, /data-hd-mobile-entry-host="true"/u)
  assert.doesNotMatch(renderer, /row\.id = 'harness-desktop-mobile-sync-row'/u)
})

test('portal placement keeps a labeled 42px-tall target aligned to expanded and compact sidebars', () => {
  const compactForWidth = extractConst('mobileEntryCompactForWidth', 'mobileEntryPortalPlacement')
  const placement = extractBefore('mobileEntryPortalPlacement', '\n  let mobileEntryLayoutWidth', { mobileEntryCompactForWidth: compactForWidth })
  assert.equal(compactForWidth(176), false)
  assert.equal(compactForWidth(56), true)
  assert.equal(compactForWidth(56, true), false)

  const expanded = placement(
    { left: 14, right: 265, width: 251 },
    { top: 878, width: 251, height: 42 },
    1460,
    true
  )
  assert.deepEqual(expanded, { compact: false, left: 153, top: 878, size: 112 })

  const compact = placement(
    { left: 14, right: 70, width: 56 },
    { top: 878, width: 56, height: 42 },
    1460,
    false
  )
  assert.deepEqual(compact, { compact: true, left: 24, top: 881, size: 36 })
  assert.ok(expanded.left >= 8 && expanded.left + expanded.size <= 1452)
  assert.match(renderer, /<span class="hd-mobile-entry-label">手机同步<\/span>/u)
  assert.match(renderer, /#harness-desktop-mobile-sync-entry \{[^}]*width:112px!important;[^}]*height:42px!important;[^}]*padding:0 12px!important;/u)
  assert.match(renderer, /data-hd-mobile-compact="true"\] \.hd-mobile-entry-label \{ display:none; \}/u)
  assert.match(renderer, /new ResizeObserver/u)
  assert.match(renderer, /window\.addEventListener\('resize', \(\) => syncMobileEntryLayout\(\)\)/u)
  assert.match(renderer, /document\.addEventListener\('scroll', \(\) => syncMobileEntryLayout\(\), true\)/u)
})

test('mobile entry bypasses the custom URL bridge and opens the dialog directly every time', () => {
  const activate = extractConst('activateMobileEntry', 'mountMobileEntry')
  let prevented = 0
  let stopped = 0
  let immediate = 0
  let opened = 0
  const event = {
    preventDefault() { prevented += 1 },
    stopPropagation() { stopped += 1 },
    stopImmediatePropagation() { immediate += 1 }
  }
  const open = () => { opened += 1 }
  activate(event, open)
  activate(event, open)
  assert.equal(prevented, 2)
  assert.equal(stopped, 2)
  assert.equal(immediate, 2)
  assert.equal(opened, 2)
  assert.match(renderer, /const activateMobileEntry = \(event, open = openMobileSync\)/u)
  assert.match(renderer, /entry\.addEventListener\('click', activateMobileEntry, true\)/u)
  assert.doesNotMatch(renderer.slice(renderer.indexOf('const activateMobileEntry'), renderer.indexOf('const mountMobileEntry')), /open-mobile-sync/u)
  assert.doesNotMatch(renderer, /entry\.addEventListener\('pointerdown'/u)
})

test('mobile sync portal preserves status and accessible dialog semantics', () => {
  assert.match(renderer, /entry\.setAttribute\('aria-haspopup', 'dialog'\)/u)
  assert.match(renderer, /entry\.setAttribute\('aria-controls', 'mobileSyncOverlay'\)/u)
  assert.match(renderer, /id = 'harness-desktop-mobile-sync-tooltip'/u)
  assert.match(renderer, /entry\.dataset\.state = connected \? 'connected' : enabled \? 'waiting' : 'off'/u)
  assert.match(renderer, /等待手机连接/u)
})

test('Android offline cache is wired to the active pairing and cleared on explicit unpair', () => {
  assert.match(pairingStore, /static String cacheIdentity\(PairingProfile profile\)/u)
  assert.match(pairingStore, /MessageDigest\.getInstance\("SHA-256"\)/u)
  assert.doesNotMatch(assetCache, /new File\(offlineRoot,\s*profile\.pairUrl\)/u)
  assert.match(mainActivity, /PairingProfileStore\.cacheIdentity\(/u)
  assert.match(mainActivity, /mobileAssetCache\.loadLatestSnapshot\(/u)
  assert.match(mainActivity, /mobileAssetCache\.(?:applySyncResponse|storeFullSnapshot|applyIncrement)\(/u)
  assert.match(mainActivity, /mobileAssetCache\.clearOfflineSnapshots\(/u)
})

test('legacy web index cache cannot remain a global cross-pairing namespace', () => {
  const globalKey = "const INDEX_CACHE_KEY = 'harness.mobile.authoritative-index.v1'"
  if (!mobileRuntime.includes(globalKey)) return
  assert.match(mobileRuntime, /Pairing|pairing|cacheIdentity|pairingIdentity/u,
    'a persisted web index must be partitioned by a non-secret pairing identity or removed in favor of the native cache')
  assert.doesNotMatch(mobileRuntime, /const INDEX_CACHE_KEY = 'harness\.mobile\.authoritative-index\.v1'\s*$/mu,
    'the unscoped legacy localStorage cache replays one desktop index after switching pairings')
  assert.match(mobileRuntime, /INDEX_CACHE_KEY = pairingIdentity \? `\$\{INDEX_CACHE_LEGACY_KEY\}\.\$\{pairingIdentity\}` : ''/u)
  assert.match(mobileRuntime, /legacy\?\.pairingIdentity === pairingIdentity/u)
  assert.match(mobileRuntime, /removeItem\?\.\(INDEX_CACHE_LEGACY_KEY\)/u)
})

test('native cache restore precedes cursor refresh without reloading the WebView', () => {
  assert.match(mainActivity, /prepareOfflineState\(pairingProfile\)/u)
  assert.match(mainActivity, /publishOfflineState\(view\);[\s\S]*mobileUiAdapter\.inject\(view\);[\s\S]*publishOfflineState\(view\)/u)
  assert.match(mainActivity, /cacheIdentity=.*snapshotEpoch=.*cursor=/su)
  assert.match(mainActivity, /X-Harness-Mobile-Sync-Complete/u)
  assert.match(mainActivity, /response\.optBoolean\("protected", false\)/u)
  assert.match(mainActivity, /requestOfflineSync\(profile\)/u)
  const syncBody = mainActivity.slice(mainActivity.indexOf('private void requestOfflineSync'), mainActivity.indexOf('private void clearRevokedPairing'))
  assert.doesNotMatch(syncBody, /webView\.(?:reload|loadUrl)/u)
  assert.match(mobileRuntime, /window\.__harnessMobileApplyNativeSnapshot = snapshot =>/u)
})

test('mobile presentation and composer are structurally isolated', () => {
  assert.match(mobileRuntime, /presentationRoot\.id = 'harness-mobile-presentation-root'/u)
  assert.match(mobileRuntime, /presentationRoot\.appendChild\(shell\)/u)
  assert.match(mobileRuntime, /syncMobileComposerTextareaLayout/u)
  assert.match(mobileRuntime, /selectionStart/u)
  assert.match(mobileRuntime, /setSelectionRange/u)
  assert.match(mobileRuntime, /data\.harnessMobileComposerAttachments|harnessMobileComposerAttachments/u)
})
