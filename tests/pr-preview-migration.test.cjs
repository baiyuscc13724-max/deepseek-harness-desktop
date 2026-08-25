const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const load = relative => readFile(path.join(root, relative), 'utf8')

test('PR preview updater stays inside the desktop-shell component boundary', async () => {
  const [prepare, main, bootstrap, pkgText] = await Promise.all([
    load('scripts/prepare-production-components.mjs'),
    load('electron/main.cjs'),
    load('electron/bootstrap.cjs'),
    load('package.json')
  ])
  const pkg = JSON.parse(pkgText)

  for (const directory of ["'electron'", "'renderer'", "'plugins'"]) assert.match(prepare, new RegExp(directory))
  assert.match(prepare, /'pr-preview-update-sources\.json'/)
  assert.match(main, /bootstrap\?\.layout\?\.shellRoot \|\| app\.getAppPath\(\)/)
  assert.match(main, /new PrPreviewUpdateService/)
  assert.match(main, /new ComponentUpdateService/)
  assert.match(main, /launchReadyComponentUpdate\(context\.component\)/)
  assert.match(main, /PrPreviewActivationStore/)

  assert.equal(pkg.main, 'electron/bootstrap.cjs')
  assert.ok(pkg.build.files.includes('electron/**/*'))
  assert.ok(pkg.build.files.includes('renderer/**/*'))
  assert.ok(pkg.build.files.includes('pr-preview-update-sources.json'))
  assert.doesNotMatch(bootstrap, /pr-preview|PrPreview/)
})

test('existing installations can receive updater code as a stable shell without installer or native changes', async () => {
  const [prepare, packageText, configText, activationStore] = await Promise.all([
    load('scripts/prepare-production-components.mjs'),
    load('package.json'),
    load('pr-preview-update-sources.json'),
    load('electron/bridge/pr-preview-activation-store.cjs')
  ])
  const pkg = JSON.parse(packageText)
  const config = JSON.parse(configText)

  assert.match(prepare, /desktop-shell/)
  assert.doesNotMatch(prepare, /electron\.exe|app\.asar|installer|bootstrap\.cjs/)
  assert.ok(!Object.keys(pkg.dependencies || {}).some(name => /node-gyp|ffi|native/i.test(name) && /preview/i.test(name)))
  assert.equal(config.enabled, true)
  assert.equal(config.repository, 'baiyuscc13724-max/deepseek-harness-desktop')
  assert.deepEqual(Object.keys(config.trustedKeys), ['harness-preview-v1'])
  assert.match(config.trustedKeys['harness-preview-v1'], /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/u)
  assert.match(config.channelUrls[0], /^https:\/\/cnb\.cool\//)
  assert.match(config.channelUrls[1], /^https:\/\/raw\.githubusercontent\.com\//)
  assert.doesNotMatch(configText, /PRIVATE KEY|privateKey|secret|token/i)
  assert.match(activationStore, /baseline/)
  assert.match(activationStore, /拒绝覆盖稳定回滚点/)
})

test('preview IPC is zero-input and acceptance happens only after successful component staging', async () => {
  const [main, preload, renderer] = await Promise.all([
    load('electron/main.cjs'),
    load('electron/preload.cjs'),
    load('renderer/app.js')
  ])

  assert.match(main, /await pending\.componentService\.stage\([\s\S]*await context\.service\.accept\(pending\.discovery\)/)
  assert.match(main, /ipcMain\.handle\('prPreviewUpdates:check', desktopShellOnly\(\(\) => checkPrPreviewUpdates\(\)\)\)/)
  assert.match(main, /ipcMain\.handle\('prPreviewUpdates:apply', desktopShellOnly\(\(\) => applyPrPreviewUpdate\(\)\)\)/)
  assert.match(main, /function isPendingPreviewReady/)
  assert.match(main, /candidate: lastPrPreviewCandidate\?\.clientCandidate \|\| \(ready \? activationClientCandidate\(activation\) : null\)/)
  assert.match(main, /enabled: appState\.updates\?\.previewEnabled === true \|\| Boolean\(activation\)/)
  assert.match(main, /const current = await getPrPreviewUpdateState\(\)[\s\S]*if \(current\.ready && current\.candidate\)[\s\S]*if \(!preferences\.previewEnabled\)/)
  assert.match(main, /if \(!isPendingPreviewReady\(componentState, activation\)\) await stagePrPreviewUpdate\(\)/)
  assert.match(main, /else await ensureStateStore\(\)\.markPreviewCandidate\(activation\.candidate\.sequence, activation\.candidate\.headSha\)/)
  assert.match(main, /prNumber: pending\.discovery\.prNumber[\s\S]*provider: pending\.discovery\.provider/)
  assert.match(preload, /checkPrPreviewUpdates: \(\) => ipcRenderer\.invoke\('prPreviewUpdates:check'\)/)
  assert.match(preload, /applyPrPreviewUpdate: \(\) => ipcRenderer\.invoke\('prPreviewUpdates:apply'\)/)
  assert.doesNotMatch(preload, /checkPrPreviewUpdates:\s*(?:\([^)]*\w[^)]*\)|\w+)\s*=>/)
  assert.match(renderer, /data-hd-preview/)
  assert.doesNotMatch(renderer, /preview.*(?:prompt|PR\s*编号|Token|仓库).*input/i)
})
