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
  assert.match(main, /const shellRoot = bootstrap\?\.layout\?\.shellRoot \|\| ''/)
  assert.match(
    main,
    /resolvePrPreviewUpdateConfig\(\{[\s\S]*resourcesPath: process\.resourcesPath[\s\S]*shellRoot[\s\S]*packagedAppRoot: app\.getAppPath\(\)/
  )
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

test('legacy preview IPC stays zero-input while unified actions use opaque ids after successful staging', async () => {
  const [main, preload, renderer] = await Promise.all([
    load('electron/main.cjs'),
    load('electron/preload.cjs'),
    load('renderer/app.js')
  ])

  assert.match(main, /await pending\.componentService\.stage\(pending\.checkResult,[\s\S]*await context\.service\.accept\(pending\.discovery\.candidateId\)/)
  assert.match(main, /ipcMain\.handle\('prPreviewUpdates:check', desktopShellOnly\(\(\) => checkPrPreviewUpdates\(\)\)\)/)
  assert.match(main, /ipcMain\.handle\('prPreviewUpdates:apply', desktopShellOnly\(\(\) => applyPrPreviewUpdate\(\)\)\)/)
  assert.match(main, /ipcMain\.handle\('unifiedUpdates:action', desktopShellOnly\(request => runUnifiedUpdateAction\(request\?\.id, request\?\.action\)\)\)/)
  assert.match(main, /function isPendingPreviewReady/)
  assert.match(main, /candidate: lastPrPreviewCandidate\?\.clientCandidate \|\| \(ready \? activationClientCandidate\(activation\) : null\)/)
  assert.match(main, /enabled: true/)
  assert.match(main, /const current = await getPrPreviewUpdateState\(\)[\s\S]*if \(current\.ready && current\.candidate\)/)
  assert.doesNotMatch(main, /if \(!preferences\.previewEnabled\)/)
  assert.match(main, /if \(!isPendingPreviewReady\(componentState, activation\)\) await stagePrPreviewUpdate\(candidateId\)/)
  assert.match(main, /else await ensureStateStore\(\)\.markPreviewCandidate\(activation\.candidate\.sequence, activation\.candidate\.headSha\)/)
  assert.match(main, /prNumber: pending\.discovery\.prNumber[\s\S]*provider: pending\.discovery\.provider/)
  assert.match(preload, /checkPrPreviewUpdates: \(\) => ipcRenderer\.invoke\('prPreviewUpdates:check'\)/)
  assert.match(preload, /applyPrPreviewUpdate: \(\) => ipcRenderer\.invoke\('prPreviewUpdates:apply'\)/)
  assert.match(preload, /runUnifiedUpdateAction: \(id, action\) => ipcRenderer\.invoke\('unifiedUpdates:action', \{ id: String\(id \|\| ''\), action: String\(action \|\| ''\) \}\)/)
  assert.doesNotMatch(preload, /checkPrPreviewUpdates:\s*(?:\([^)]*\w[^)]*\)|\w+)\s*=>/)
  assert.doesNotMatch(renderer, /data-hd-preview/)
  assert.doesNotMatch(renderer, /preview.*(?:prompt|PR\s*编号|Token|仓库).*input/i)
})

test('preview queue adapter uses synchronous AppStateStore reads and persists the full verified queue', async () => {
  const [main, store] = await Promise.all([
    load('electron/main.cjs'),
    load('electron/store/app-state-store.cjs')
  ])

  // AppStateStore loads synchronously in its constructor; get() remains the
  // only public reader, including for the persisted signed candidate queue.
  assert.doesNotMatch(main, /ensureStateStore\(\)\.load\(/)
  assert.match(main, /enabled: true/)
  assert.doesNotMatch(main, /if \(!preferences\.previewEnabled\)/)

  const adapter = main.match(/function prPreviewStateAdapter\(\)[\s\S]*?(?=\nasync function ensurePrPreviewUpdateContext)/)?.[0] || ''
  assert.match(adapter, /async load\(\)/)
  assert.match(adapter, /const updates = ensureStateStore\(\)\.get\(\)\.updates \|\| \{\}/)
  assert.match(adapter, /sequence: updates\.lastPreviewSequence \|\| 0/)
  assert.match(adapter, /headSha: updates\.lastPreviewHeadSha \|\| ''/)
  assert.match(adapter, /installedHeads: updates\.installedPreviewHeads \|\| \[\]/)
  assert.match(adapter, /candidates: updates\.previewCandidates \|\| \[\]/)
  assert.match(adapter, /async save\(next\)[\s\S]*savePreviewUpdateState\(next\)/)

  assert.match(store, /const MAX_PREVIEW_CANDIDATES = 128/)
  assert.match(store, /const MAX_INSTALLED_PREVIEW_HEADS = 128/)
  assert.match(store, /savePreviewUpdateState\(value = \{\}\)/)
  assert.match(store, /markPreviewCandidate\(sequence, headSha\)/)
  assert.match(store, /sequence < currentSequence\) throw new Error\('拒绝回退到旧的 PR 预览更新序号。'\)/)
  assert.match(store, /同一 PR 预览更新序号指向了不同 commit。/)
  assert.match(store, /\bget\(\)\s*\{/)
  // The public surface has get() only; no public load() reader may reappear
  // (the constructor-time private #load() is the only loader left).
  assert.doesNotMatch(store, /^\s{2}load\(\)\s*\{/m)
})
