const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const vm = require('node:vm')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const files = {
  main: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'MainActivity.java'),
  adapter: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'MobileUiAdapter.java'),
  runtime: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'),
  runtimeIos: path.join(root, 'mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-runtime.js'),
  css: path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css')
}

function methodBody(source, signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `missing ${nextSignature}`)
  return source.slice(start, end)
}

function runSessionObserverBurstFixture(runtime, deliveries = 40) {
  const source = methodBody(runtime, 'const validHistorySessionId', 'const requestHistorySessionId')
  const metrics = {
    observerDeliveries: 0,
    frameRequests: 0,
    frameFlushes: 0,
    filterClosestChecks: 0,
    filterMatchChecks: 0,
    filterSubtreeChecks: 0,
    composerQueries: 0,
    composerFiberScans: 0,
    sessionRowQueries: 0,
    sessionRowFiberScans: 0,
    restoreReads: 0
  }
  const frames = []
  let observerCallback = null

  const composerTarget = {
    nodeType: 1,
    parentElement: null,
    matches(selector) {
      metrics.filterMatchChecks++
      return selector.includes('[data-composer-card]')
    },
    querySelector() {
      metrics.filterSubtreeChecks++
      return null
    },
    closest() {
      metrics.filterClosestChecks++
      return composerCard
    }
  }
  composerTarget['__reactFiber$fixture'] = { memoizedProps: {}, return: null }
  const composerCard = new Proxy(composerTarget, {
    ownKeys(target) {
      metrics.composerFiberScans++
      return Reflect.ownKeys(target)
    }
  })

  const rowTarget = {
    nodeType: 1,
    parentElement: null,
    matches(selector) {
      metrics.filterMatchChecks++
      return selector.includes('[data-harness-mobile-session-row="true"]')
    },
    querySelector() {
      metrics.filterSubtreeChecks++
      return null
    },
    closest() {
      metrics.filterClosestChecks++
      return sessionRow
    },
    click() {}
  }
  rowTarget['__reactFiber$fixture'] = { memoizedProps: {}, return: null }
  const sessionRow = new Proxy(rowTarget, {
    ownKeys(target) {
      metrics.sessionRowFiberScans++
      return Reflect.ownKeys(target)
    }
  })

  const documentElement = { nodeType: 1 }
  const document = {
    documentElement,
    querySelector(selector) {
      assert.equal(selector, '[data-composer-card]')
      metrics.composerQueries++
      return composerCard
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-harness-mobile-session-row="true"]')
      metrics.sessionRowQueries++
      return [sessionRow]
    }
  }
  const window = {
    __harnessMobileCurrentSessionId: '',
    __harnessMobileCurrentSessionSource: '',
    HarnessMobileControl: {
      rememberSession() {},
      restoreSession() {
        metrics.restoreReads++
        return 'session-restore'
      }
    },
    addEventListener() {},
    requestAnimationFrame(callback) {
      metrics.frameRequests++
      frames.push(callback)
      return metrics.frameRequests
    }
  }
  class FixtureMutationObserver {
    constructor(callback) {
      observerCallback = callback
    }
    observe(target, options) {
      assert.equal(target, documentElement)
      assert.deepEqual(options, { childList: true, subtree: true })
    }
  }

  vm.runInNewContext(source, { window, document, MutationObserver: FixtureMutationObserver })
  assert.equal(typeof observerCallback, 'function')

  const resetMetrics = () => {
    for (const key of Object.keys(metrics)) metrics[key] = 0
  }
  const snapshot = () => ({ ...metrics, pendingFrames: frames.length })
  const deliver = record => {
    metrics.observerDeliveries++
    observerCallback([record])
  }
  const flushFrames = () => {
    const callbacks = frames.splice(0)
    for (const callback of callbacks) {
      metrics.frameFlushes++
      callback(16.67)
    }
  }
  const unrelatedTarget = {
    nodeType: 1,
    closest() {
      metrics.filterClosestChecks++
      return null
    }
  }
  const unrelatedNode = {
    nodeType: 1,
    matches() {
      metrics.filterMatchChecks++
      return false
    },
    querySelector() {
      metrics.filterSubtreeChecks++
      return null
    }
  }
  const unrelatedRecord = { target: unrelatedTarget, addedNodes: [unrelatedNode], removedNodes: [] }
  const relevantRecord = { target: unrelatedTarget, addedNodes: [composerCard], removedNodes: [] }

  resetMetrics()
  for (let index = 0; index < deliveries; index++) deliver(unrelatedRecord)
  const unrelatedBeforeFrame = snapshot()
  flushFrames()
  const unrelatedAfterFrame = snapshot()

  resetMetrics()
  assert.equal(frames.length, 0)
  for (let index = 0; index < deliveries; index++) deliver(relevantRecord)
  const relevantBeforeFrame = snapshot()
  flushFrames()
  const relevantAfterFrame = snapshot()

  return { deliveries, unrelatedBeforeFrame, unrelatedAfterFrame, relevantBeforeFrame, relevantAfterFrame }
}

test('Android navigation coalesces full mobile-runtime injection across one document generation', async t => {
  const [main, adapter, runtime, css] = await Promise.all([
    readFile(files.main, 'utf8'),
    readFile(files.adapter, 'utf8'),
    readFile(files.runtime, 'utf8'),
    readFile(files.css, 'utf8')
  ])

  const started = methodBody(main, 'public void onPageStarted', 'public void onPageCommitVisible')
  const committed = methodBody(main, 'public void onPageCommitVisible', 'public void onPageFinished')
  const finished = methodBody(main, 'public void onPageFinished', 'public void onReceivedError')
  const resumed = methodBody(main, 'protected void onResume()', 'private void checkMobileAppUpdate()')
  const readyCheck = methodBody(main, 'private void checkWorkbenchReady', 'private static boolean isRetryableHttpStatus')

  assert.match(started, /beginMobileUiDocument\(view, \(\) -> \{ mobileUiAdapter\.inject\(view\); \}\)/)
  for (const checkpoint of [committed, finished]) {
    assert.match(checkpoint, /ensureMobileUiRuntime\(view, \(\) -> mobileUiAdapter\.inject\(view\)\)/)
  }
  assert.match(resumed, /ensureMobileUiRuntime\(webView, \(\) -> mobileUiAdapter\.inject\(webView\)\)/)
  assert.match(readyCheck, /ensureMobileUiRuntime\(webView, \(\) -> mobileUiAdapter\.inject\(webView\)\)/)
  assert.doesNotMatch(main, /^\s*mobileUiAdapter\.inject\(/mu, 'lifecycle callbacks must not launch unconditional duplicate batches')

  const delayList = adapter.match(/INJECTION_DELAYS_MS\s*=\s*\{([^}]*)\}/)?.[1]
  assert.ok(delayList, 'adapter retry schedule must remain explicit')
  const evaluationsPerBatch = delayList.split(',').filter(Boolean).length
  const legacyNormalEvaluations = 3 * evaluationsPerBatch
  const optimizedNormalEvaluations = evaluationsPerBatch
  assert.equal(legacyNormalEvaluations, 9)
  assert.equal(optimizedNormalEvaluations, 3)
  assert.ok(optimizedNormalEvaluations <= legacyNormalEvaluations / 3)

  const injectedAssetBytes = Buffer.byteLength(runtime) + Buffer.byteLength(css)
  const legacyLowerBoundBytes = legacyNormalEvaluations * injectedAssetBytes
  const optimizedLowerBoundBytes = optimizedNormalEvaluations * injectedAssetBytes
  assert.ok(optimizedLowerBoundBytes < legacyLowerBoundBytes)
  t.diagnostic(`full-script evaluations: ${legacyNormalEvaluations} -> ${optimizedNormalEvaluations}; parsed asset lower bound: ${legacyLowerBoundBytes} -> ${optimizedLowerBoundBytes} bytes`)
})

test('failed bootstrap retries only after a cheap marker probe and stays bounded', async () => {
  const main = await readFile(files.main, 'utf8')
  const ensure = methodBody(main, 'private void ensureMobileUiRuntime', 'private void probeMobileUiRuntime')
  const probe = methodBody(main, 'private void probeMobileUiRuntime', 'static boolean mobileUiRuntimeReady')
  const policy = methodBody(main, 'static final class MobileUiInjectionPolicy', 'private void configureBackNavigation')

  assert.match(main, /MOBILE_UI_RUNTIME_READY_SCRIPT\s*=\s*\n?\s*"window\.__harnessMobileRuntimeInstalled === 'ready'"/)
  assert.match(main, /MOBILE_UI_INJECTION_SETTLE_MS\s*=\s*1_000L/)
  assert.match(main, /MAX_MOBILE_UI_INJECTION_BATCHES_PER_DOCUMENT\s*=\s*3/)
  assert.match(ensure, /reserveReadyProbe/)
  assert.match(ensure, /postDelayed\(\(\) -> probeMobileUiRuntime/)
  assert.doesNotMatch(ensure, /injection\.run\(\)/, 'an ordinary checkpoint must only reserve the marker probe')
  assert.match(probe, /evaluateJavascript\(MOBILE_UI_RUNTIME_READY_SCRIPT/)
  assert.match(probe, /finishReadyProbe\(generation, ready\)/)
  assert.match(probe, /if \(mobileUiInjectionPolicy\.startInjectionBatch[\s\S]*injection\.run\(\)/)
  assert.match(policy, /batchCount >= MAX_MOBILE_UI_INJECTION_BATCHES_PER_DOCUMENT\) return false/)
  assert.match(policy, /probePending \|\| batchCount == 0\) return -1L/)
})

test('repeated session observer receipts do not enqueue duplicate SharedPreferences writes', async t => {
  const [main, runtime] = await Promise.all([readFile(files.main, 'utf8'), readFile(files.runtime, 'utf8')])
  const observer = methodBody(runtime, 'const sessionObserver = new MutationObserver', 'sessionObserver.observe')
  const scheduler = methodBody(runtime, 'const scheduleOfficialSessionSync', 'window.addEventListener')
  const bridge = methodBody(main, '@JavascriptInterface public void rememberSession', '@JavascriptInterface public String restoreSession')

  assert.match(observer, /mutations\.some\(isOfficialSessionMutation\)/)
  assert.match(observer, /scheduleOfficialSessionSync\(\)/)
  assert.doesNotMatch(observer, /syncOfficialComposerSession\(\)|restoreOfficialSession\(\)/)
  assert.match(scheduler, /requestAnimationFrame/)
  assert.match(scheduler, /syncOfficialComposerSession\(\)/)
  assert.match(scheduler, /restoreOfficialSession\(\)/)
  assert.match(bridge, /synchronized \(rememberedSessionLock\)/)
  const readIndex = bridge.indexOf('preferences.getString(SAVED_SESSION, "")')
  const gateIndex = bridge.indexOf('shouldPersistSessionReference')
  const editIndex = bridge.indexOf('preferences.edit()')
  assert.ok(readIndex >= 0 && gateIndex >= 0 && editIndex > gateIndex && gateIndex <= readIndex,
    'the unchanged-session gate must return before allocating an editor')

  let stored = ''
  let writes = 0
  for (let callback = 0; callback < 1_000; callback++) {
    const next = 'session-12345678'
    if (next !== stored) {
      stored = next
      writes++
    }
  }
  assert.equal(writes, 1)
  t.diagnostic('simulated observer callbacks: 1,000; preference writes: 1')
})

test('session observer filters unrelated bursts and coalesces relevant work once per frame', async t => {
  const [runtime, runtimeIos] = await Promise.all([
    readFile(files.runtime, 'utf8'),
    readFile(files.runtimeIos, 'utf8')
  ])
  assert.equal(runtimeIos, runtime, 'Android and iOS mobile runtimes must stay byte-identical')

  const result = runSessionObserverBurstFixture(runtime)
  t.diagnostic(`session observer burst metrics: ${JSON.stringify(result)}`)

  const heavyLookups = [
    'composerQueries',
    'composerFiberScans',
    'sessionRowQueries',
    'sessionRowFiberScans',
    'restoreReads'
  ]
  assert.equal(result.unrelatedAfterFrame.observerDeliveries, result.deliveries)
  assert.equal(result.unrelatedAfterFrame.frameRequests, 0)
  for (const metric of heavyLookups) {
    assert.equal(result.unrelatedAfterFrame[metric], 0, `unrelated mutations must not perform ${metric}`)
  }

  assert.equal(result.relevantBeforeFrame.observerDeliveries, result.deliveries)
  assert.equal(result.relevantBeforeFrame.frameRequests, 1)
  assert.equal(result.relevantBeforeFrame.pendingFrames, 1)
  for (const metric of heavyLookups) {
    assert.equal(result.relevantBeforeFrame[metric], 0, `relevant work must wait for the animation frame before ${metric}`)
    assert.equal(result.relevantAfterFrame[metric], 1, `one relevant burst must perform ${metric} once`)
  }
  assert.equal(result.relevantAfterFrame.frameFlushes, 1)
  assert.equal(result.relevantAfterFrame.pendingFrames, 0)
})
