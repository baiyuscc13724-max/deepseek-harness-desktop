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
  assert.match(entry, /defer \{ foregroundRecoveryTask = nil \}/)

  assert.match(recovery, /proxy\.update\(profile: profile\)\s+proxy\.networkChanged\(\)/s, 'an existing proxy must refresh its upstream route')
  assert.match(recovery, /let port = try await activeProxy\.start\(\)/, 'foreground recovery must ensure the loopback listener is healthy')
  assert.match(recovery, /if workbenchURL == nil \{\s+workbenchURL = profile\.stableOrigin\(localPort: port\)\s+\}/s, 'an existing stable workbench URL must be preserved')
  assert.match(recovery, /state = networkMonitor\.available\s+\? \.failed\(error\.localizedDescription\)\s+: \.connecting\("网络已断开，恢复后会自动连接…"\)/s, 'loss of network during recovery must not be reported as failure')
  assert.doesNotMatch(`${entry}\n${recovery}`, /reload\(|workbenchURL = nil|WKWebView\(/, 'foreground recovery must preserve page and web view state')
})
