const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { createDeepSeekBalanceAdapter, normalizeDeepSeekBalance } = require('../electron/bridge/provider-meter-adapters/deepseek-balance.cjs')
const { CODEX_APP_URL, CODEX_USAGE_URL, createCodexRateLimitsAdapter, normalizeCodexRateLimits, normalizeCodexUsage } = require('../electron/bridge/provider-meter-adapters/codex-rate-limits.cjs')
const { createOpenCodeGoPlanAdapter } = require('../electron/bridge/provider-meter-adapters/opencode-go-plan.cjs')

function spawnErrorChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stdin = new EventEmitter()
  child.stdin.write = () => true
  child.stdin.on = () => child.stdin
  child.killed = false
  child.kill = () => { child.killed = true }
  process.nextTick(() => child.emit('error', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' })))
  return child
}

function spawnExitChild(code) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stdin = new EventEmitter()
  child.stdin.write = () => true
  child.stdin.on = () => child.stdin
  child.killed = false
  child.kill = () => { child.killed = true }
  process.nextTick(() => child.emit('exit', code))
  return child
}

test('DeepSeek balance normalizes every returned currency', () => {
  const result = normalizeDeepSeekBalance({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '2.00', topped_up_balance: '10.34' }]
  })
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.meters[0], {
    id: 'balance-cny', kind: 'balance', label: '账户余额', currency: 'CNY', total: 12.34, granted: 2, toppedUp: 10.34
  })
})

test('DeepSeek adapter keeps the API key out of its result', async () => {
  let authorization = ''
  const adapter = createDeepSeekBalanceAdapter()
  const result = await adapter.refresh({
    credential: { value: 'secret-deepseek-key' },
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization
      return { ok: true, status: 200, json: async () => ({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '3', granted_balance: '1', topped_up_balance: '2' }] }) }
    }
  })
  assert.equal(authorization, 'Bearer secret-deepseek-key')
  assert.equal(JSON.stringify(result).includes('secret-deepseek-key'), false)
})

test('Codex rate limits become generic usage windows and budgets', () => {
  const result = normalizeCodexRateLimits({
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        primary: { usedPercent: 66, windowDurationMins: 10080, resetsAt: 1_800_000_000 },
        individualLimit: { used: '4', limit: '10', remainingPercent: 60, resetsAt: 1_800_000_000 }
      },
      spark: { limitId: 'spark', limitName: 'Spark', primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1_800_000_100 } }
    }
  })
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.meters.map(row => row.kind), ['usage-window', 'spending-budget', 'usage-window'])
  assert.equal(result.meters[0].remainingPercent, 34)
  assert.equal(result.meters[2].label, 'Spark')
})

test('Harness Codex OAuth usage response becomes generic usage windows', () => {
  const result = normalizeCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 87, limit_window_seconds: 604800, reset_at: 1_800_000_000 }
    },
    additional_rate_limits: [{
      limit_name: 'Spark',
      metered_feature: 'spark',
      rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 18000, reset_at: 1_800_000_100 } }
    }]
  })
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.meters.map(row => row.remainingPercent), [13, 95])
  assert.deepEqual(result.meters.map(row => row.windowDurationMins), [10080, 300])
})

test('Codex adapter queries official usage with Harness OAuth without exposing credentials', async () => {
  const accountId = 'account-test-only'
  const token = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } })).toString('base64url')}.signature`
  let request
  const result = await createCodexRateLimitsAdapter().refresh({
    credential: { value: token },
    fetchImpl: async (url, options) => {
      request = { url, options }
      return {
        ok: true,
        status: 200,
        json: async () => ({ rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 3600, reset_at: 1_800_000_000 } } })
      }
    }
  })
  assert.equal(request.url, CODEX_USAGE_URL)
  assert.equal(request.options.headers.Authorization, `Bearer ${token}`)
  assert.equal(request.options.headers['ChatGPT-Account-Id'], accountId)
  assert.equal(result.status, 'ready')
  assert.equal(result.meters[0].remainingPercent, 75)
  assert.equal(JSON.stringify(result).includes(token), false)
  assert.equal(JSON.stringify(result).includes(accountId), false)
})

test('Codex without credential and without a discoverable client gives an actionable auth-required state', async () => {
  const result = await createCodexRateLimitsAdapter().refresh({ spawnImpl: () => spawnErrorChild() })
  assert.equal(result.status, 'auth-required')
  assert.equal(result.meters.length, 0)
  assert.match(result.message, /Codex (CLI|凭据)/)
  assert.deepEqual(result.action, { label: '查看官方 Codex', url: CODEX_APP_URL })
})

test('Codex client probe failures (non-zero exit) still stay unavailable', async () => {
  await assert.rejects(
    createCodexRateLimitsAdapter().refresh({ spawnImpl: () => spawnExitChild(1) }),
    error => error.code === 'METER_UNAVAILABLE'
  )
})

test('Codex client timeout is a transient unavailable state, not a missing client', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stdin = new EventEmitter()
  child.stdin.write = () => true
  child.stdin.on = () => child.stdin
  child.killed = false
  child.kill = () => { child.killed = true }
  await assert.rejects(
    createCodexRateLimitsAdapter({ timeoutMs: 30 }).refresh({ spawnImpl: () => child }),
    error => error.code === 'METER_UNAVAILABLE'
  )
})

test('OpenCode Go is explicit when its model API key cannot query plan usage', async () => {
  const result = await createOpenCodeGoPlanAdapter().refresh({})
  assert.equal(result.status, 'auth-required')
  assert.equal(result.action.url, 'https://opencode.ai/auth')
  assert.equal(result.meters.length, 0)
})
