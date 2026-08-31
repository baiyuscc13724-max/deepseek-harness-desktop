'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

/**
 * Device-agnostic acceptance contract. A MuMu/ADB collector can emit the same
 * event names and feed them to evaluateRun(); this file intentionally contains
 * no product implementation imports or device mutations.
 */
const THRESHOLDS = Object.freeze({
  coldStartupMs: 2500,
  hotStartupMs: 1200,
  firstProjectVisibleMs: 1800,
  authorityRefreshMs: 2500,
  offlineRecoveryMs: 5000,
  connectionStageMs: 12000,
  inputCommitMs: 800,
  imeOpenMs: 1200,
  imeCloseMs: 1200,
  toolbarJitterPx: 4,
  droppedImeFrames: 3,
  maxInputChars: 10000
})

const REQUIRED_SCENARIOS = Object.freeze([
  'cold-start', 'hot-start', 'cache-hit', 'authority-refresh',
  'offline-recovery', 'connection-stages', 'long-input', 'ime-stability'
])

function number(value, label) {
  assert.equal(typeof value, 'number', `${label} must be numeric`)
  assert.ok(Number.isFinite(value), `${label} must be finite`)
  return value
}

function evaluateRun(run, thresholds = THRESHOLDS) {
  const failures = []
  const timings = run.timings || {}
  const check = (name, value, limit, comparator = '<=') => {
    if (value === undefined) return failures.push(`${name}: missing measurement`)
    number(value, name)
    if (value > limit) failures.push(`${name}: ${value}ms exceeds ${limit}ms`)
  }
  check('coldStartupMs', timings.coldStartupMs, thresholds.coldStartupMs)
  check('hotStartupMs', timings.hotStartupMs, thresholds.hotStartupMs)
  check('firstProjectVisibleMs', timings.firstProjectVisibleMs, thresholds.firstProjectVisibleMs)
  check('authorityRefreshMs', timings.authorityRefreshMs, thresholds.authorityRefreshMs)
  check('offlineRecoveryMs', timings.offlineRecoveryMs, thresholds.offlineRecoveryMs)
  for (const [stage, value] of Object.entries(run.connectionStages || {})) check(`connectionStages.${stage}`, value, thresholds.connectionStageMs)
  const longInputSamples = run.longInput || []
  for (const sample of longInputSamples) {
    if (![500, 2000, 10000].includes(sample.chars)) failures.push(`longInput: unsupported sample ${sample.chars} chars`)
    check(`longInput.${sample.chars}.commitMs`, sample.commitMs, thresholds.inputCommitMs)
    if (sample.chars > thresholds.maxInputChars) failures.push(`longInput.${sample.chars}: exceeds supported maximum`)
  }
  for (const chars of [500, 2000, 10000]) {
    if (!longInputSamples.some(sample => sample.chars === chars)) failures.push(`longInput.${chars}.commitMs: missing measurement`)
  }
  const ime = run.ime || {}
  check('ime.openMs', ime.openMs, thresholds.imeOpenMs)
  check('ime.closeMs', ime.closeMs, thresholds.imeCloseMs)
  if (ime.toolbarJitterPx === undefined) failures.push('ime.toolbarJitterPx: missing measurement')
  else if (ime.toolbarJitterPx > thresholds.toolbarJitterPx) failures.push(`ime.toolbarJitterPx: ${ime.toolbarJitterPx}px exceeds ${thresholds.toolbarJitterPx}px`)
  if (ime.droppedFrames === undefined) failures.push('ime.droppedFrames: missing measurement')
  else if (ime.droppedFrames > thresholds.droppedImeFrames) failures.push(`ime.droppedFrames: ${ime.droppedFrames} exceeds ${thresholds.droppedImeFrames}`)
  const scenarios = new Set(run.scenarios || [])
  for (const required of REQUIRED_SCENARIOS) if (!scenarios.has(required)) failures.push(`scenario missing: ${required}`)
  if (run.cacheState !== 'hit' && run.cacheState !== 'miss') failures.push('cacheState: must be hit or miss')
  if (run.refreshMode !== 'authority' && run.refreshMode !== 'cache') failures.push('refreshMode: must be authority or cache')
  return { pass: failures.length === 0, failures, thresholds }
}

function healthyRun(overrides = {}) {
  return {
    scenarios: REQUIRED_SCENARIOS,
    cacheState: 'hit',
    refreshMode: 'cache',
    timings: {
      coldStartupMs: 1800,
      hotStartupMs: 650,
      firstProjectVisibleMs: 900,
      authorityRefreshMs: 1600,
      offlineRecoveryMs: 3200
    },
    connectionStages: { lan: 140, p2p: 900, relay: 2400 },
    longInput: [500, 2000, 10000].map(chars => ({ chars, commitMs: chars === 10000 ? 650 : 220 })),
    ime: { openMs: 600, closeMs: 500, toolbarJitterPx: 2, droppedFrames: 1 },
    ...overrides
  }
}

test('acceptance contract covers cold/hot, cache/authority, recovery, stages, input and IME', () => {
  const result = evaluateRun(healthyRun())
  assert.equal(result.pass, true, result.failures.join('; '))
  assert.deepEqual([...REQUIRED_SCENARIOS], ['cold-start', 'hot-start', 'cache-hit', 'authority-refresh', 'offline-recovery', 'connection-stages', 'long-input', 'ime-stability'])
})

test('threshold failures identify the exact diagnostic dimension', () => {
  const run = healthyRun({
    timings: { ...healthyRun().timings, coldStartupMs: 2601, offlineRecoveryMs: 5100 },
    connectionStages: { lan: 140, p2p: 13000, relay: 2400 },
    longInput: [{ chars: 500, commitMs: 900 }, { chars: 2000, commitMs: 220 }, { chars: 10000, commitMs: 220 }],
    ime: { openMs: 600, closeMs: 500, toolbarJitterPx: 7, droppedFrames: 4 }
  })
  const result = evaluateRun(run)
  assert.equal(result.pass, false)
  for (const marker of ['coldStartupMs', 'offlineRecoveryMs', 'connectionStages.p2p', 'longInput.500.commitMs', 'ime.toolbarJitterPx', 'ime.droppedFrames']) {
    assert.ok(result.failures.some(failure => failure.startsWith(marker)), `missing diagnostic for ${marker}`)
  }
})

test('cache and authoritative refresh are distinct required observations', () => {
  assert.equal(evaluateRun(healthyRun({ cacheState: 'miss', refreshMode: 'authority' })).pass, true)
  assert.equal(evaluateRun(healthyRun({ cacheState: 'warm', refreshMode: 'unknown' })).pass, false)
})

test('long-input matrix rejects missing or unsupported samples', () => {
  const run = healthyRun({ longInput: [{ chars: 500, commitMs: 100 }, { chars: 10000, commitMs: 100 }] })
  const result = evaluateRun(run)
  assert.equal(result.pass, false)
  assert.ok(result.failures.some(failure => failure.includes('longInput.2000.commitMs: missing')))
})

module.exports = { THRESHOLDS, REQUIRED_SCENARIOS, evaluateRun, healthyRun }
