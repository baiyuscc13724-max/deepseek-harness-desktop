const test = require('node:test')
const assert = require('node:assert/strict')

const { createDeepSeekBalanceAdapter, normalizeDeepSeekBalance } = require('../electron/bridge/provider-meter-adapters/deepseek-balance.cjs')
const { normalizeCodexRateLimits } = require('../electron/bridge/provider-meter-adapters/codex-rate-limits.cjs')
const { createOpenCodeGoPlanAdapter } = require('../electron/bridge/provider-meter-adapters/opencode-go-plan.cjs')

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

test('OpenCode Go is explicit when its model API key cannot query plan usage', async () => {
  const result = await createOpenCodeGoPlanAdapter().refresh({})
  assert.equal(result.status, 'auth-required')
  assert.equal(result.action.url, 'https://opencode.ai/auth')
  assert.equal(result.meters.length, 0)
})
