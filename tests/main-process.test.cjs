const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
const guestPreloadSource = readFileSync(path.resolve(__dirname, '..', 'electron', 'guest-preload.cjs'), 'utf8')

function loadGuestAutopilotAuthorizationApi() {
  const exposed = Object.create(null)
  const invocations = []
  const contextBridge = { exposeInMainWorld: (name, value) => { exposed[name] = value } }
  const ipcRenderer = {
    invoke: async (channel, value) => {
      invocations.push({ channel, value })
      return { authorizationId: `authorization-${value.autopilotMaxAdditionalRounds}` }
    },
    on: () => {},
    removeListener: () => {},
    send: () => {},
    sendToHost: () => {}
  }
  vm.runInNewContext(guestPreloadSource, {
    require: id => {
      assert.equal(id, 'electron', 'sandboxed guest preload must not require local modules')
      return { contextBridge, ipcRenderer }
    },
    navigator: { userActivation: { isActive: true } },
    window: { addEventListener: () => {} },
    process: { platform: 'win32' },
    console
  }, { filename: 'guest-preload.cjs' })
  return { api: exposed.harnessDesktopGuest, invocations }
}

test('runtime startup keeps the launch token main-only and publishes only the clean runtime origin', () => {
  assert.match(source, /require\('\.\/bridge\/runtime-web-url\.cjs'\)/u)
  assert.match(source, /return detectRuntimeWebUrl\(text\)/u)
  assert.match(source, /runtimeStdoutBuffer = appendRuntimeWebOutput\(runtimeStdoutBuffer, output\)/u)
  assert.match(source, /runtimeStderrBuffer = appendRuntimeWebOutput\(runtimeStderrBuffer, output\)/u)
  assert.doesNotMatch(source, /probeUrl\(candidateUrl\)/u)
  assert.doesNotMatch(source, /http\.get\(url,[\s\S]{0,180}isRuntimeWebReadyStatus/u)
  assert.match(source, /diagnosticErrorText = appendBoundedRuntimeDiagnostic\(diagnosticErrorText, output\)[\s\S]{0,120}lastErrorText = redactRuntimeWebAuth\(diagnosticErrorText\)/u)
  assert.match(source, /recordRuntimeProbeError = error =>[\s\S]{0,220}redactRuntimeWebAuth\(error\?\.message \|\| String\(error \|\| ''\)\)[\s\S]{0,160}本地 Web 认证检查失败/u)
  assert.match(source, /DeepSeek Harness Web 已就绪：\$\{safeRuntimeWebUrl\(candidateUrl\)\}/u)
  assert.match(source, /let runtimeLaunchUrl = null/u)
  assert.match(source, /function markRuntimeReady\(launchUrl, detail\)[\s\S]{0,420}runtimeLaunchUrl = normalized[\s\S]{0,160}url: publicUrl/u)
  assert.match(source, /await prepareRuntimeSessionAuthentication\(candidateUrl\)[\s\S]{0,180}probeAuthenticatedRuntimeSession\(harnessRuntimeSession\(\), candidateUrl,[\s\S]{0,180}return markRuntimeReady\(candidateUrl,/u)
  assert.match(source, /stage = 'token-exchange'/u)
  assert.match(source, /runtimeSession\.resolveProxy\(origin\)/u)
  assert.match(source, /cookieCount=\$\{cookies\.length\}/u)
  assert.doesNotMatch(source, /setRuntimeState\(\{ status: 'ready', url: candidateUrl/u)
  assert.doesNotMatch(source, /statusCode >= 100 && response\.statusCode < 600/u)
  assert.doesNotMatch(source, /function detectUrl\(text\) \{\r?\n\s+const match/u)
})

test('runtime startup is single-flight and retires a timed-out process tree before exposing Retry', () => {
  assert.match(source, /let runtimeStartPromise = null/u)
  assert.match(source, /async function startRuntime\(\)[\s\S]{0,360}if \(runtimeStartPromise\) return runtimeStartPromise[\s\S]{0,260}runtimeStartPromise = null/u)
  assert.match(source, /if \(runtime && runtime\.exitCode == null\)[\s\S]{0,520}terminateProcessTree\(staleRuntime\)[\s\S]{0,180}await waitForProcessExit\(staleRuntime\)/u)
  assert.match(source, /const detail = lastErrorText \|\| 'DeepSeek Harness 进程已启动，但 22 秒内没有检测到可访问的本地 Web 服务。'[\s\S]{0,220}terminateProcessTree\(child\)[\s\S]{0,160}await waitForProcessExit\(child\)[\s\S]{0,420}setRuntimeState/u)
  assert.match(source, /child\.on\('error',[\s\S]{0,140}if \(runtime !== child\) return/u)
  assert.match(source, /child\.on\('exit',[\s\S]{0,100}if \(runtime !== child\) return/u)
})

test('main runtime clients share only the authenticated persist:harness session and controlled cookie provider', () => {
  assert.match(source, /return session\.fromPartition\('persist:harness'\)/u)
  assert.match(source, /exchangeRuntimeLaunchToken\(runtimeSession, launchUrl,[\s\S]{0,520}readRuntimeAuthCookie\(runtimeSession\.cookies, launchUrl\)/u)
  assert.match(source, /async function runtimeApiFetch\(value, options = \{\}\)[\s\S]{0,240}runtimeSessionFetch\(harnessRuntimeSession\(\), target, options\)/u)
  assert.match(source, /connectExistingRuntime\(\)[\s\S]{0,300}probeAuthenticatedRuntimeSession\(harnessRuntimeSession\(\), DEFAULT_RUNTIME_URL/u)
  assert.match(source, /fetchImpl: runtimeApiFetch,[\s\S]{0,100}WebSocketImpl: HarnessRuntimeWebSocket,[\s\S]{0,100}cookieProvider: runtimeAuthCookieHeader/u)
  assert.match(source, /petAdapter = new PetEventAdapter\(\{[\s\S]{0,140}fetchImpl: runtimeApiFetch,[\s\S]{0,100}cookieProvider: runtimeAuthCookieHeader/u)
  assert.match(source, /async function runtimeAuthCookieHeader\(value = runtimeState\.url, \{ force = false \} = \{\}\)[\s\S]{0,520}prepareRuntimeSessionAuthentication\(launchUrl, \{ force: true \}\)/u)
  assert.doesNotMatch(source, /callRuntimeRpc[\s\S]{0,500}net\.fetch/u)
})

test('guest preload accepts 199 and 200 automatic rounds but rejects 201 before IPC', async () => {
  assert.match(guestPreloadSource, /value\.autopilotMaxAdditionalRounds < 1 \|\| value\.autopilotMaxAdditionalRounds > 200/u)
  assert.doesNotMatch(guestPreloadSource, /value\.autopilotMaxAdditionalRounds > 16/u)
  const { api, invocations } = loadGuestAutopilotAuthorizationApi()
  const base = {
    action: 'settings',
    sessionId: 'root-200-rounds',
    enabled: true,
    maxMembers: 4,
    maxActiveTurns: 4,
    autopilotEnabled: true,
    hostAuthorization: {
      rootSessionId: 'root-200-rounds',
      projectKey: 'a'.repeat(64),
      goalId: 'goal-200-rounds',
      teamId: 'team-200-rounds',
      pauseEpoch: 0,
      teamScopeHash: 'b'.repeat(64)
    }
  }
  for (const autopilotMaxAdditionalRounds of [199, 200]) {
    const result = await api.authorizeAgentTeamsAutopilotSettings({ ...base, autopilotMaxAdditionalRounds })
    assert.equal(result.authorizationId, `authorization-${autopilotMaxAdditionalRounds}`)
    assert.equal(invocations.at(-1).channel, 'agentTeams:authorizeAutopilotSettings')
    assert.equal(invocations.at(-1).value.autopilotMaxAdditionalRounds, autopilotMaxAdditionalRounds)
    assert.equal(invocations.at(-1).value.hostAuthorization.rootSessionId, base.sessionId)
  }
  await assert.rejects(api.authorizeAgentTeamsAutopilotSettings({ ...base, autopilotMaxAdditionalRounds: 201 }), /代理团队自动接力设置无效/u)
  assert.equal(invocations.length, 2, '201 must be rejected before the official IPC capability request')
})

test('autopilot settings authorization is injected only for an exact managed Runtime request and revoked with Runtime', () => {
  assert.match(source, /const AGENT_TEAMS_AUTHORIZATION_HEADER = 'X-Harness-Agent-Teams-Authorization'/u)
  assert.match(source, /const AGENT_TEAMS_ACTION_PATH = '\/api\/agent-teams\/action'/u)

  const ownerSource = source.slice(source.indexOf('function agentTeamsAutopilotOwnerForContents'), source.indexOf('function agentTeamsAutopilotDesktopBinding'))
  assert.match(ownerSource, /contents === runtimeGuest && mainWindow && !mainWindow\.isDestroyed\(\)/u)
  assert.match(ownerSource, /for \(const detached of detachedSessionWindows\)[\s\S]*detached\.webContents === contents/u)

  const issueSource = source.slice(source.indexOf('async function issueAgentTeamsAutopilotAuthorization'), source.indexOf('function removeRequestHeader'))
  assert.match(issueSource, /const firstBinding = agentTeamsAutopilotDesktopBinding\(event\)/u)
  assert.match(issueSource, /const normalized = validateAutopilotIssue\(body\)/u)
  assert.match(issueSource, /const confirmedBinding = agentTeamsAutopilotDesktopBinding\(event\)[\s\S]*confirmedBinding\.ownerWindow !== firstBinding\.ownerWindow[\s\S]*issueAutopilotAuthorization\(exactBody, confirmedBinding\.desktopBinding\)/u)

  const bodySource = source.slice(source.indexOf('function agentTeamsRequestBody'), source.indexOf('function currentAgentTeamsActionRequest'))
  assert.match(bodySource, /part\.bytes === undefined \|\| part\.file !== undefined \|\| part\.blobUUID !== undefined/u)
  assert.match(bodySource, /size > MAX_AGENT_TEAMS_ACTION_BODY_BYTES/u)
  assert.match(bodySource, /JSON\.parse\(Buffer\.concat\(chunks\)\.toString\('utf8'\)\)/u)
  assert.match(bodySource, /parsed && typeof parsed === 'object' && !Array\.isArray\(parsed\) \? parsed : null/u)

  const requestSource = source.slice(source.indexOf('function currentAgentTeamsActionRequest'), source.indexOf('function installAgentTeamsAuthorizationWebRequestBridge'))
  assert.match(requestSource, /runtimeState\.status !== 'ready' \|\| !runtimeState\.url \|\| details\.method !== 'POST'/u)
  assert.match(requestSource, /target\.origin !== runtimeOrigin \|\| target\.pathname !== AGENT_TEAMS_ACTION_PATH \|\| target\.search \|\| target\.hash/u)
  assert.match(requestSource, /runtimeGuest && !runtimeGuest\.isDestroyed\(\) && details\.webContentsId === runtimeGuest\.id/u)
  assert.match(requestSource, /!detached\.isDestroyed\(\) && detached\.webContents\.id === details\.webContentsId/u)
  assert.match(requestSource, /contents\.session !== harnessRuntimeSession\(\) \|\| !ownerWindow\.isVisible\(\) \|\| !ownerWindow\.isFocused\(\) \|\| !contents\.isFocused\(\)/u)

  const bridgeSource = source.slice(source.indexOf('function installAgentTeamsAuthorizationWebRequestBridge'), source.indexOf('function revokeAgentTeamsAutopilotAuthorizations'))
  assert.match(bridgeSource, /const desktopBinding = currentAgentTeamsActionRequest\(details\)[\s\S]*const body = desktopBinding && agentTeamsRequestBody\(details\)/u)
  assert.match(bridgeSource, /typeof body\?\.\[AGENT_TEAMS_CAPABILITY_FIELD\] === 'string'/u)
  assert.match(bridgeSource, /delete claimBody\[AGENT_TEAMS_CAPABILITY_FIELD\][\s\S]*agentTeamsAuthorizationRequests\.set\(details\.id, \{ capability, claimBody, desktopBinding \}\)/u)
  const stripIndex = bridgeSource.indexOf('removeRequestHeader(requestHeaders, AGENT_TEAMS_AUTHORIZATION_HEADER)')
  const pendingIndex = bridgeSource.indexOf('const pending = agentTeamsAuthorizationRequests.get(details.id)')
  const claimIndex = bridgeSource.indexOf('claimAutopilotWebRequest?.(pending.capability, pending.claimBody, currentBinding, origin)')
  const injectIndex = bridgeSource.indexOf('requestHeaders[AGENT_TEAMS_AUTHORIZATION_HEADER] = pending.capability')
  assert.ok(stripIndex >= 0 && stripIndex < pendingIndex, 'a page-forged Host header must be stripped before request lookup')
  assert.ok(pendingIndex < claimIndex && claimIndex < injectIndex, 'the one-time authorization id must be injected only after exact Host claim')
  assert.match(bridgeSource, /catch \{[\s\S]*claimAutopilotWebRequest\?\.\(pending\.capability, pending\.claimBody, pending\.desktopBinding, null\)/u)
  assert.match(bridgeSource, /agentTeamsAuthorizationRequests\.delete\(details\.id\)[\s\S]*onCompleted\(filter, cleanup\)[\s\S]*onErrorOccurred\(filter, cleanup\)/u)

  const revokeSource = source.slice(source.indexOf('function revokeAgentTeamsAutopilotAuthorizations'), source.indexOf('async function ensureAgentTeamsAuthorizationService'))
  assert.match(revokeSource, /agentTeamsAuthorizationRequests\.clear\(\)[\s\S]*revokeAutopilotAuthorizations\?\.\(reason\)/u)
  assert.match(revokeSource, /catch \(error\) \{[\s\S]*agentTeamsAuthorizationService = null[\s\S]*failed\?\.close\?\.\(\)\.catch\(\(\) => \{\}\)/u)
  assert.match(source, /revokeAgentTeamsAutopilotAuthorizations\('runtime start advanced the authorization epoch'\)/u)
  assert.match(source, /child\.on\('error',[\s\S]{0,180}revokeAgentTeamsAutopilotAuthorizations\('runtime process failed'\)/u)
  assert.match(source, /child\.on\('exit',[\s\S]{0,180}revokeAgentTeamsAutopilotAuthorizations\('runtime process exited'\)/u)
  assert.match(source, /revokeAgentTeamsAutopilotAuthorizations\('runtime startup timed out'\)/u)
  assert.match(source, /function stopRuntime\(\) \{\s+revokeAgentTeamsAutopilotAuthorizations\('runtime stop revoked automatic continuation authority'\)/u)
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
