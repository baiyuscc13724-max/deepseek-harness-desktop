const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const plugin = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
const indexSource = fs.readFileSync(plugin, 'utf8')

function between(source, start, end) {
  const begin = source.indexOf(start)
  const finish = source.indexOf(end, begin + start.length)
  assert.notEqual(begin, -1, `missing ${start}`)
  assert.notEqual(finish, -1, `missing ${end}`)
  return source.slice(begin, finish)
}

test('AT-004 direct-human resume unpauses and dispatches the trusted project wake in one reconciliation', () => {
  const observer = between(indexSource, 'function observeUserStops', 'function apply')
  assert.match(observer, /event\.type === "user\/message"[\s\S]*?scheduleProjectTaskWake\(lead, \{ paused: false, dispatch: true \}\)/u)
})

test('AT-004 Stop clears only queued Project-task wake messages before scheduling pause', () => {
  const observer = between(indexSource, 'function observeUserStops', 'function apply')
  assert.match(observer, /PROJECT_TASK_STOPPED_ROOTS\.add\(lead\.id\)[\s\S]*?clearQueuedProjectTaskWakes\(lead\)[\s\S]*?scheduleProjectTaskWake\(lead, \{ paused: true \}\)/u)
})

test('AT-004 evidence scan and Host retry scheduler remain bounded', () => {
  const wake = between(indexSource, 'function rootHasProjectTaskWake', 'async function dispatchProjectTaskWakeSignalsNow')
  const dispatch = between(indexSource, 'async function dispatchProjectTaskWakeSignalsNow', 'function dispatchProjectTaskWakeSignals')
  const scheduler = between(indexSource, 'function createProjectTaskWakeScheduler', 'function requireProjectRootCaller')
  assert.match(wake, /slice\(-PROJECT_TASK_WAKE_EVENT_TAIL\)/u, 'session evidence scan must have a fixed tail bound')
  assert.match(dispatch, /if \(outcome === "not_delivered"\) retryable \+= 1/u, 'only proven non-delivery retries')
  assert.doesNotMatch(dispatch, /outcome === "outcome_unknown"\) retryable \+= 1/u, 'unknown enqueue outcomes must not blindly retry')
  assert.match(scheduler, /Math\.min\(retryMaxMs, retryBaseMs \* \(2 \*\* Math\.min\(state\.retryAttempt, 16\)\)\)/u)
  assert.match(scheduler, /const retryBaseMs = options\.retryBaseMs \?\? PROJECT_TASK_WAKE_RETRY_BASE_MS/u)
  assert.match(scheduler, /const retryMaxMs = options\.retryMaxMs \?\? PROJECT_TASK_WAKE_RETRY_MAX_MS/u)
  assert.match(scheduler, /setTimer\([\s\S]*?state\.timer\?\.unref\?\.\(\)/u)
})

test('AT-004 scheduler disposer clears pending retry timers and rejects future scheduling', () => {
  const scheduler = between(indexSource, 'function createProjectTaskWakeScheduler', 'function requireProjectRootCaller')
  assert.match(scheduler, /let closed = false/u, 'scheduler needs a closed lifecycle fence')
  assert.match(scheduler, /const schedule = \(\{ projectRef \} = \{\}\) => \{\s*if \(closed/u, 'closed scheduler must ignore future scheduling')
  assert.match(scheduler, /schedule\.close = \(\) => \{[\s\S]*?closed = true/u, 'scheduler must expose an idempotent disposer')
  assert.match(scheduler, /for \(const state of states\.values\(\)\) \{[\s\S]*?clearTimer\(state\.timer\)/u, 'disposer must clear every pending retry timer')
  assert.match(indexSource, /ctx\.effect\(\(\) => \(\) => projectTaskWakeScheduler\.close\(\)\)/u, 'plugin lifecycle must own scheduler disposal')
})

test('AT-004 Stop before root lookup acknowledges the wake as paused, not retryable non-delivery', () => {
  const dispatch = between(indexSource, 'async function dispatchProjectTaskWakeSignalsNow', 'function dispatchProjectTaskWakeSignals')
  assert.doesNotMatch(dispatch, /\.find\(\(candidate\) => !PROJECT_TASK_STOPPED_ROOTS\.has\(candidate\.id\)/u, 'stopped root must remain discoverable for paused acknowledgement')
  assert.match(dispatch, /PROJECT_TASK_STOPPED_ROOTS\.has\(root\.id\)[\s\S]*?outcome = "paused"/u)
})
