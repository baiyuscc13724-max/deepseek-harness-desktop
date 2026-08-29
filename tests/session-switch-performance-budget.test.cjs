'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

const benchmarkUrl = pathToFileURL(path.resolve(__dirname, '..', 'scripts', 'session-switch-performance-benchmark.mjs')).href

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
  const { DEFAULT_SCENARIO } = await import(benchmarkUrl)
  assert.ok(DEFAULT_SCENARIO.sessions >= 8)
  assert.ok(DEFAULT_SCENARIO.messagesPerSession >= 1200)
  assert.ok(DEFAULT_SCENARIO.measuredSwitches >= 180)
  assert.ok(DEFAULT_SCENARIO.scrollSamples >= 120)
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
})

test('quick Electron stress fixture stays inside the regression budget', { timeout: 120_000 }, async () => {
  const { QUICK_SCENARIO, runBenchmark } = await import(benchmarkUrl)
  const result = runBenchmark({ quick: true })
  assert.deepEqual(result.scenario, QUICK_SCENARIO)
  assert.equal(result.dom.totalMessages, QUICK_SCENARIO.sessions * QUICK_SCENARIO.messagesPerSession)
  assert.equal(result.dom.renderedMessages, QUICK_SCENARIO.renderedMessages)
  assert.equal(result.budget.pass, true, JSON.stringify(result.budget.checks, null, 2))
  assert.ok(result.listeners.growth <= 2)
  assert.ok(Number.isFinite(result.memory.growthMiB))
  assert.ok(Number.isFinite(result.longTasks.maxMs))
})
