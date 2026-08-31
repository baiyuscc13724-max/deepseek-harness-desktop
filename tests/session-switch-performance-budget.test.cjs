'use strict'

const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const benchmarkUrl = pathToFileURL(path.join(root, 'scripts', 'session-switch-performance-benchmark.mjs')).href
const electronRelative = process.platform === 'win32' ? ['electron.exe'] : process.platform === 'darwin' ? ['Electron.app', 'Contents', 'MacOS', 'Electron'] : ['electron']
const electronExecutable = path.join(root, 'node_modules', 'electron', 'dist', ...electronRelative)
const electronDisplayReady = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
const electronBenchmarkReady = existsSync(electronExecutable) && electronDisplayReady
const electronBenchmarkRequired = process.env.HARNESS_PERFORMANCE_ELECTRON_REQUIRED === '1' || process.env.npm_lifecycle_event === 'test:performance:synthetic'
const electronSkipReason = electronBenchmarkRequired
  ? false
  : 'The heavyweight Electron benchmark runs only in the isolated test:performance:synthetic lifecycle and mandatory cloud performance gate.'

function healthyMetrics() {
  return {
    scenario: { measuredSwitches: 100 },
    calibration: { p95Ms: 1 },
    firstOpenMs: 40,
    switch: { p95Ms: 12 },
    scroll: { p95Ms: 4 },
    memory: { afterWarmupMiB: 80, growthMiB: 5 },
    listeners: { growth: 0 },
    longTasks: { count: 1, maxMs: 60 }
  }
}

test('session benchmark models a genuinely long multi-session workload', async () => {
  const { DEFAULT_SCENARIO, electronExecutablePath } = await import(benchmarkUrl)
  assert.ok(DEFAULT_SCENARIO.sessions >= 8)
  assert.ok(DEFAULT_SCENARIO.messagesPerSession >= 1200)
  assert.ok(DEFAULT_SCENARIO.measuredSwitches >= 180)
  assert.ok(DEFAULT_SCENARIO.scrollSamples >= 120)
  assert.equal(electronExecutablePath('darwin'), path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'))
  assert.equal(electronExecutablePath('win32'), path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'))
  assert.equal(electronExecutablePath('linux'), path.join(root, 'node_modules', 'electron', 'dist', 'electron'))
})

test('performance budgets combine calibration ratios with leak-specific ceilings', async () => {
  const { evaluateBudgets } = await import(benchmarkUrl)
  const healthy = healthyMetrics()
  const passing = evaluateBudgets(healthy)
  assert.equal(passing.pass, true)
  assert.equal(passing.checks.length, 7)

  for (const mutate of [
    metrics => { metrics.firstOpenMs = 400 },
    metrics => { metrics.switch.p95Ms = 200 },
    metrics => { metrics.scroll.p95Ms = 100 },
    metrics => { metrics.memory.growthMiB = 60 },
    metrics => { metrics.listeners.growth = 3 },
    metrics => { metrics.longTasks.maxMs = 300 },
    metrics => { metrics.longTasks.count = 20 }
  ]) {
    const regressed = structuredClone(healthy)
    mutate(regressed)
    assert.equal(evaluateBudgets(regressed).pass, false)
  }

  const windowsColdPaint = structuredClone(healthy)
  windowsColdPaint.runtime = { platform: 'win32', ci: true }
  windowsColdPaint.firstOpenMs = 278.4
  windowsColdPaint.longTasks.maxMs = 295
  assert.equal(evaluateBudgets(windowsColdPaint).pass, true)
  assert.equal(evaluateBudgets({ ...windowsColdPaint, firstOpenMs: 351 }).pass, false)
  assert.equal(evaluateBudgets({ ...windowsColdPaint, longTasks: { ...windowsColdPaint.longTasks, maxMs: 351 } }).pass, false)
  assert.equal(evaluateBudgets({ ...windowsColdPaint, runtime: { platform: 'win32', ci: false } }).pass, false)
  assert.equal(evaluateBudgets({ ...windowsColdPaint, runtime: { platform: 'linux', ci: true } }).pass, false)
})

test('quick Electron stress fixture stays inside the regression budget', { timeout: 120_000, skip: electronSkipReason }, async () => {
  assert.equal(electronBenchmarkReady, true, `Required Electron benchmark runtime is unavailable: ${electronExecutable}`)
  const { QUICK_SCENARIO, runBenchmark } = await import(benchmarkUrl)
  const result = runBenchmark({ quick: true })
  assert.deepEqual(result.scenario, QUICK_SCENARIO)
  assert.ok(Number.isFinite(result.startupOpenMs))
  assert.ok(Number.isFinite(result.firstOpenMs))
  assert.equal(result.dom.totalMessages, QUICK_SCENARIO.sessions * QUICK_SCENARIO.messagesPerSession)
  assert.equal(result.dom.renderedMessages, QUICK_SCENARIO.renderedMessages)
  assert.equal(result.budget.pass, true, JSON.stringify(result.budget.checks, null, 2))
  assert.ok(result.listeners.growth <= 2)
  assert.ok(Number.isFinite(result.memory.growthMiB))
  assert.ok(Number.isFinite(result.longTasks.maxMs))
})
