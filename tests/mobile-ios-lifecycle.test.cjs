const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const read = (...segments) => readFile(path.join(root, ...segments), 'utf8')

function section(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing section start: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing section end: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('iOS scene activation delegates only the active foreground transition', async () => {
  const app = await read('mobile', 'ios', 'HarnessMobile', 'App', 'HarnessMobileApp.swift')

  assert.match(app, /@Environment\(\\\.scenePhase\) private var scenePhase/)
  assert.match(app, /\.onChange\(of: scenePhase\) \{ phase in\s+guard phase == \.active else \{ return \}\s+model\.sceneBecameActive\(\)/s)
  assert.doesNotMatch(app, /reload\(|WKWebView\(/, 'the app lifecycle must not reload or recreate the workbench')
})

test('iOS foreground recovery is paired, idempotent, and network-aware', async () => {
  const model = await read('mobile', 'ios', 'HarnessMobile', 'App', 'MobileSessionViewModel.swift')
  const entry = section(model, 'func sceneBecameActive()', '/// 工作台页加载失败时上报')
  const recovery = section(model, 'private func recoverFromForeground', 'private func activate')

  assert.ok(entry.indexOf('guard let profile else { return }') < entry.indexOf('foregroundRecoveryTask = Task'), 'unpaired activation must return before starting recovery')
  assert.ok(entry.indexOf('guard foregroundRecoveryTask == nil else { return }') < entry.indexOf('foregroundRecoveryTask = Task'), 'duplicate active notifications must share one recovery')
  assert.ok(entry.indexOf('guard networkMonitor.available else') < entry.indexOf('foregroundRecoveryTask = Task'), 'offline activation must not start a doomed recovery')
  assert.match(entry, /if workbenchURL != nil \{\s+state = \.connecting\("网络已断开，恢复后会自动连接…"\)/s)
  // Source-contract only: a stale task must not clear a replacement generation's slot.
  assert.match(entry, /let generation = activationGeneration\s+foregroundRecoveryTask = Task/s)
  assert.match(entry, /defer\s*\{\s*if activationGeneration == generation\s*\{\s*foregroundRecoveryTask = nil\s*\}\s*\}/s)
  assert.match(entry, /await recoverFromForeground\(profile, generation: generation\)/)

  assert.match(recovery, /proxy\.update\(profile: profile\)\s+proxy\.networkChanged\(\)/s, 'an existing proxy must refresh its upstream route')
  assert.match(recovery, /let port = try await activeProxy\.start\(\)/, 'foreground recovery must ensure the loopback listener is healthy')
  assert.match(recovery, /if workbenchURL == nil \{\s+workbenchURL = profile\.stableOrigin\(localPort: port\)\s+\}/s, 'an existing stable workbench URL must be preserved')
  assert.match(recovery, /state = networkMonitor\.available\s+\? \.failed\(error\.localizedDescription\)\s+: \.connecting\("网络已断开，恢复后会自动连接…"\)/s, 'loss of network during recovery must not be reported as failure')
  assert.doesNotMatch(`${entry}\n${recovery}`, /reload\(|workbenchURL = nil|WKWebView\(/, 'foreground recovery must preserve page and web view state')
})

function ordered(fragment, tokens) {
  let previous = -1
  for (const token of tokens) {
    const index = fragment.indexOf(token, previous + 1)
    assert.ok(index > previous, `required source-contract ordering missing: ${token}`)
    previous = index
  }
}

test('iOS source contract fences suspension writes and cancellation by profile and activation generation', async t => {
  const model = await read('mobile', 'ios', 'HarnessMobile', 'App', 'MobileSessionViewModel.swift')
  const current = section(model, 'private func operationCurrent(', 'private func scheduleActivation(')
  assert.match(current, /self\.profile == profile && activationGeneration == generation && !Task\.isCancelled/)
  const scheduled = section(model, 'private func scheduleActivation(', 'private func recoverFromForeground')
  ordered(scheduled, ['activationGeneration &+= 1', 'let generation = activationGeneration', 'activationTask?.cancel()', 'foregroundRecoveryTask?.cancel()', 'foregroundRecoveryTask = nil', 'activationTask = Task'])
  assert.match(scheduled, /defer\s*\{\s*if activationGeneration == generation\s*\{\s*activationTask = nil\s*\}\s*\}/s)
  const forgetting = section(model, 'func forgetDesktop()', 'private func operationCurrent(')
  ordered(forgetting, ['activationGeneration &+= 1', 'activationTask?.cancel()', 'foregroundRecoveryTask?.cancel()', 'profile = nil', 'workbenchURL = nil', 'proxy?.stop()'])
  const recovery = section(model, 'private func recoverFromForeground', 'private func activate')
  const fence = 'guard operationCurrent(profile, generation: generation) else { return }'
  ordered(recovery, [fence, 'try await activeProxy.start()', fence, 'if workbenchURL == nil', 'state = .connected', '} catch {', fence, 'state = networkMonitor.available'])
  const activation = model.slice(model.indexOf('private func activate('))
  ordered(activation, [fence, 'try await activeProxy.start()', fence, 'workbenchURL = pairing', 'state = .connected', '} catch {', fence, 'state = .failed'])
  t.diagnostic('Swift source contract only; no compiler/Xcode, actor scheduling, native cancellation or iOS runtime executed')
})
