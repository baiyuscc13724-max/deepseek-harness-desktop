'use strict'
// Verifies the classifier fix PROPOSAL (docs/deep-audit/delegation-classifier-fix-spec.md §6b) without
// touching any product file: it extracts the real shipped classifier text, evaluates it as-is, then
// evaluates the same text with the proposed 6-line insertion applied, and compares every branch.
// Read-only. No installer, no CLI, no running instance, no network.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PRODUCT = 'node_modules/@deepseek-ai/dsh-subagent/lib/index.js'
const ANCHOR = '\t\t\t} else code = "SUBAGENT_ERROR";'
const INSERTION = [
  '\t\t\t} else if (rawCode === "transport" || rawMessage.includes("fetch failed")) {',
  '\t\t\t\tcode = "SUBAGENT_PROVIDER_UNAVAILABLE";',
  '\t\t\t\tcategory = "provider_transient";',
  '\t\t\t\tstage = "provider_dispatch";',
  '\t\t\t\tretryable = true;',
  '\t\t\t\tnextAction = "retry_current_task";',
  ANCHOR
].join('\n')

const repo = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(repo, PRODUCT), 'utf8')

function extractClassifier(text) {
  const start = text.indexOf('function boundedSubagentTerminalDiagnostic(')
  assert.ok(start >= 0, 'classifier function must exist')
  const end = text.indexOf('\nfunction createLifecycleEmitter(', start)
  assert.ok(end > start, 'classifier function must be followed by the lifecycle emitter')
  const body = text.slice(start, end)
  const close = body.lastIndexOf('}')
  return body.slice(0, close + 1)
}

function compile(text) {
  return new Function(`return (${extractClassifier(text)})`)()
}

const cases = [
  ['aborted', 'aborted', {}],
  ['max-tokens', 'max-tokens', {}],
  ['refusal', 'refusal', {}],
  ['completed', 'completed', {}],
  ['teardown marker', 'error', { code: 'x', message: 'activation_teardown_failed while stopping' }],
  ['pi_ai_error not found', 'error', { code: 'pi_ai_error', message: 'model not found' }],
  ['pi_ai_error empty message', 'error', { code: 'pi_ai_error', message: '' }],
  ['timeout', 'error', { code: 'x', message: 'operation timed out' }],
  ['rate limit', 'error', { code: 'x', message: 'rate limit exceeded' }],
  ['overload', 'error', { code: 'x', message: 'server overload' }],
  ['unavailable', 'error', { code: 'continuation_unavailable', message: 'service unavailable' }],
  ['generic internal error', 'error', { code: 'ENOENT', message: 'no such file or directory' }],
  ['transport failure (the observed delegation failure)', 'error', { code: 'TRANSPORT', message: 'fetch failed' }]
]

const before = compile(source)
const after = compile(source.replace(ANCHOR, INSERTION))

test('the proposal is a pure 6-line insertion at a unique anchor', () => {
  assert.equal(source.split(ANCHOR).length - 1, 1, 'anchor must be unique')
  assert.equal(source.replace(ANCHOR, INSERTION).replace(INSERTION, ANCHOR), source, 'replacement must round-trip exactly')
})

test('the observed delegation failure is currently misclassified as an internal, non-retryable error', () => {
  const result = before('error', { code: 'TRANSPORT', message: 'fetch failed' }, false)
  assert.deepEqual(result, {
    code: 'SUBAGENT_ERROR', category: 'internal', stage: 'work_followup', retryable: false, partialOutputPresent: false, nextAction: 'view_live_status'
  })
})

test('the proposal classifies a transport failure as a retryable provider fault', () => {
  const result = after('error', { code: 'TRANSPORT', message: 'fetch failed' }, false)
  assert.deepEqual(result, {
    code: 'SUBAGENT_PROVIDER_UNAVAILABLE', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: false, nextAction: 'retry_current_task'
  })
})

test('every pre-existing branch keeps its exact behaviour (negative regression)', () => {
  for (const [label, stopReason, sourceValue] of cases) {
    if (label.startsWith('transport')) continue
    const was = before(stopReason, sourceValue, false)
    const now = after(stopReason, sourceValue, false)
    assert.deepEqual(now, was, `branch changed by the proposal: ${label}`)
  }
})

test('the proposal never turns a genuinely internal error into a retryable one', () => {
  const internal = after('error', new TypeError('x is not a function'), false)
  assert.equal(internal.code, 'SUBAGENT_ERROR')
  assert.equal(internal.retryable, false)
  const enoent = after('error', { code: 'ENOENT', message: 'no such file or directory' }, false)
  assert.equal(enoent.code, 'SUBAGENT_ERROR')
  assert.equal(enoent.retryable, false)
})

test('partial-output reporting is untouched by the proposal', () => {
  for (const value of [true, false]) {
    const was = before('error', { code: 'TRANSPORT', message: 'fetch failed' }, value)
    const now = after('error', { code: 'TRANSPORT', message: 'fetch failed' }, value)
    assert.equal(was.partialOutputPresent, value)
    assert.equal(now.partialOutputPresent, value)
  }
})
