const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const source = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

test('runtime startup keeps the launch token main-only and publishes only the clean runtime origin', () => {
  assert.match(source, /require\('\.\/bridge\/runtime-web-url\.cjs'\)/u)
  assert.match(source, /return detectRuntimeWebUrl\(text\)/u)
  assert.match(source, /runtimeStdoutBuffer = appendRuntimeWebOutput\(runtimeStdoutBuffer, output\)/u)
  assert.match(source, /runtimeStderrBuffer = appendRuntimeWebOutput\(runtimeStderrBuffer, output\)/u)
  assert.match(source, /done\(isRuntimeWebReadyStatus\(response\.statusCode\)\)/u)
  assert.match(source, /diagnosticErrorText = appendBoundedRuntimeDiagnostic\(diagnosticErrorText, output\)[\s\S]{0,120}lastErrorText = redactRuntimeWebAuth\(diagnosticErrorText\)/u)
  assert.match(source, /DeepSeek Harness Web 已就绪：\$\{safeRuntimeWebUrl\(candidateUrl\)\}/u)
  assert.match(source, /let runtimeLaunchUrl = null/u)
  assert.match(source, /function markRuntimeReady\(launchUrl, detail\)[\s\S]{0,420}runtimeLaunchUrl = normalized[\s\S]{0,160}url: publicUrl/u)
  assert.match(source, /await prepareRuntimeSessionAuthentication\(candidateUrl\)[\s\S]{0,120}return markRuntimeReady\(candidateUrl,/u)
  assert.doesNotMatch(source, /setRuntimeState\(\{ status: 'ready', url: candidateUrl/u)
  assert.doesNotMatch(source, /statusCode >= 100 && response\.statusCode < 600/u)
  assert.doesNotMatch(source, /function detectUrl\(text\) \{\r?\n\s+const match/u)
})

test('main runtime clients share only the authenticated persist:harness session and controlled cookie provider', () => {
  assert.match(source, /return session\.fromPartition\('persist:harness'\)/u)
  assert.match(source, /exchangeRuntimeLaunchToken\(runtimeSession, launchUrl,[\s\S]{0,180}readRuntimeAuthCookie\(runtimeSession\.cookies, launchUrl\)/u)
  assert.match(source, /async function runtimeApiFetch\(value, options = \{\}\)[\s\S]{0,240}runtimeSessionFetch\(harnessRuntimeSession\(\), target, options\)/u)
  assert.match(source, /connectExistingRuntime\(\)[\s\S]{0,300}probeAuthenticatedRuntimeSession\(harnessRuntimeSession\(\), DEFAULT_RUNTIME_URL/u)
  assert.match(source, /fetchImpl: runtimeApiFetch,[\s\S]{0,100}WebSocketImpl: HarnessRuntimeWebSocket,[\s\S]{0,100}cookieProvider: runtimeAuthCookieHeader/u)
  assert.match(source, /petAdapter = new PetEventAdapter\(\{[\s\S]{0,140}fetchImpl: runtimeApiFetch,[\s\S]{0,100}cookieProvider: runtimeAuthCookieHeader/u)
  assert.match(source, /async function runtimeAuthCookieHeader\(value = runtimeState\.url, \{ force = false \} = \{\}\)[\s\S]{0,520}prepareRuntimeSessionAuthentication\(launchUrl, \{ force: true \}\)/u)
  assert.doesNotMatch(source, /callRuntimeRpc[\s\S]{0,500}net\.fetch/u)
})

test('packaged self-test prepares every critical plugin used by normal startup', () => {
  const body = source.slice(source.indexOf('async function runSelfTestMode()'), source.indexOf('function createWindow()'))
  for (const prepare of [
    'ensureDesktopCompactionPlugin',
    'ensurePluginMarketplace',
    'ensureMobileControlPlugin',
    'ensureDesktopDirectoryPickerPlugin',
    'ensureDesktopBrowserToolsPlugin',
    'ensureDesktopMemoryToolsPlugin',
    'ensureDesktopMcpManagerPlugin',
    'ensureDesktopSchedulesPlugin',
    'ensureDesktopFilesPlugin',
    'ensureDesktopProgressPlugin',
    'ensureDesktopComputerUsePlugin',
    'ensureDesktopAndroidPlugin',
    'ensureModelAdmissionPlugin',
    'ensureAgentTeamsPlugin',
    'ensureSessionExperiencePlugin'
  ]) assert.match(body, new RegExp(`await ${prepare}\\(`, 'u'), `${prepare} is missing from the packaged release gate`)
})

test('main exposes one sender-guarded unified update state and action contract', () => {
  assert.match(source, /async function getUnifiedUpdateState\(\)/)
  assert.match(source, /displayVersion:[\s\S]*pendingCount:[\s\S]*items,[\s\S]*preferences/)
  assert.match(source, /ipcMain\.handle\('unifiedUpdates:getState', desktopShellOnly\(/)
  assert.match(source, /ipcMain\.handle\('unifiedUpdates:check', desktopShellOnly\(/)
  assert.match(source, /ipcMain\.handle\('unifiedUpdates:action', desktopShellOnly\(request => runUnifiedUpdateAction\(request\?\.id, request\?\.action\)\)\)/)
})

test('unified actions accept only opaque ids and fixed actions while legacy IPC remains available', () => {
  assert.match(source, /if \(!\['check', 'install', 'apply', 'exit', 'settings'\]\.includes\(operation\)\)/)
  assert.match(source, /\^pr-\[a-f0-9\]\{64\}\$/)
  assert.match(source, /preparePrPreviewCandidate\(selectedId\)/)
  assert.match(source, /context\.service\.verifyCandidate\(candidateId\)/)
  assert.match(source, /\^active-pr-[\s\S]*operation === 'apply'\) return applyPrPreviewUpdate\(id\)/)
  assert.match(source, /if \(\/\^active-pr-\/\.test\(progressId\)\) throw new Error/)
  assert.doesNotMatch(source, /runUnifiedUpdateAction\([^)]*(?:url|manifest|keyId|prNumber)/)
  for (const channel of ['updates:check', 'componentUpdates:check', 'prPreviewUpdates:check', 'prPreviewUpdates:exit']) {
    assert.match(source, new RegExp(`ipcMain\\.handle\\('${channel.replace(':', '\\:')}'`))
  }
})

test('PR apply keeps staging, fail-closed advancement, health reconciliation and stable rollback exit', () => {
  assert.match(source, /const previousActivation = await context\.activation\.get\(\)/)
  assert.match(source, /if \(previousActivation && baseline\?\.releaseVersion !== previousActivation\.candidate\.releaseVersion\)/)
  assert.match(source, /activation\.capture\(\{[\s\S]*baseline,[\s\S]*sequence:[\s\S]*headSha:/)
  assert.match(source, /await pending\.componentService\.stage\(pending\.checkResult/)
  assert.match(source, /await context\.service\.accept\(pending\.discovery\.candidateId\)/)
  assert.match(source, /catch \(error\) \{[\s\S]*resetPendingPreview[\s\S]*activation\.restore\(previousActivation\)/)
  assert.match(source, /reconciledPrPreviewActivation\(componentState, context\.activation\)/)
  assert.match(source, /'--component-health-check'/)
  const exitSource = source.match(/async function exitPrPreviewUpdate\(\)[\s\S]*?(?=\nasync function setPrPreviewEnabled)/)?.[0] || ''
  assert.match(exitSource, /activation = await context\.activation\.reconcileActive\(state\.active\)/)
  assert.match(exitSource, /activation\.baseline[\s\S]*lastKnownGood: activation\.baseline/)
  assert.doesNotMatch(exitSource, /if \(!activePreview\)[\s\S]*activation\.clear\(\)/)
})

test('unified inbox filters no-op rows and suppresses preview duplicates', () => {
  assert.match(source, /previewContext\.enabled\s*\? previewContext\.service\.listCandidates\(\{ includeExpired: true \}\)/)
  assert.match(source, /if \(\['available', 'ready', 'error'\]\.includes\(desktopStatus\)\)/)
  assert.match(source, /const componentPlan = component\.lastCheck\s/)
  assert.doesNotMatch(source, /component\.lastCheck\?\.plan/)
  assert.match(source, /const componentStatus = componentReady \? 'ready' : componentAvailable \? 'available' : componentError \? 'error'/)
  assert.match(source, /上次更新失败：\$\{componentError\}，可以重试/)
  assert.match(source, /const previewOwnsDisplayedComponent = Boolean\([\s\S]{0,160}componentVersion === activation\.candidate\.releaseVersion/)
  assert.match(source, /if \(!previewOwnsDisplayedComponent && \['available', 'ready', 'error'\]\.includes\(componentStatus\)\)/)
  assert.doesNotMatch(source, /component\.state\?\.active\?\.releaseVersion[\s\S]{0,120}\.includes\(activation\.candidate\.releaseVersion\)/)
  assert.match(source, /candidate\.sequence === activation\.candidate\.sequence && candidate\.headSha === activation\.candidate\.headSha\) continue/)
  assert.match(source, /pendingCount: items\.filter\(item => item\.actionable && \['available', 'ready'\]\.includes\(item\.status\)\)\.length/)
})

test('stable releases can take over an active preview without losing rollback safety', () => {
  assert.match(source, /async function prepareStableComponentTakeover\(context, readyState\)/)
  assert.match(source, /readyState\.active\?\.releaseVersion !== activation\.candidate\.releaseVersion/)
  assert.match(source, /activationStore\.prepareStableTakeover\(\{[\s\S]*releaseVersion: readyState\.pending\.releaseVersion/)
  assert.match(source, /if \(!contextOverride\) await prepareStableComponentTakeover\(context, readyState\)/)
  assert.match(source, /if \(!activation \|\| componentState\?\.pending \|\| !\['idle', 'failed'\]\.includes\(componentState\?\.phase\)\) return activation/)
  assert.match(source, /reconciledPrPreviewActivation\(component\.state, previewContext\.activation\)/)
})

test('preview staging emits named download, verification, install and restart progress', () => {
  assert.match(source, /function sendPrPreviewUpdateProgress\(candidateId, progress = \{\}\)/)
  assert.match(source, /phase: 'prepare'/)
  assert.match(source, /progress => sendPrPreviewUpdateProgress\(selectedId, progress\)/)
  assert.match(source, /onProgress\?\.\(\{ phase: 'apply'/)
  assert.match(source, /onProgress\?\.\(\{ phase: 'restart'/)
})

test('automatic checks and signed PR discovery stay hard-enabled without user toggles', () => {
  assert.match(source, /async function setPrPreviewEnabled\(\) \{[\s\S]*previewEnabled: true/)
  assert.doesNotMatch(source, /if \(!preferences\.previewEnabled\)/)
  assert.match(source, /setTimeout\(\(\) => checkUpdates\(\)\.catch\(\(\) => \{\}\), 2500\)\.unref\(\)/)
  assert.match(source, /summary: previewChangeSummary\(candidate\), details: previewChangeDetails\(candidate\)/)
})
