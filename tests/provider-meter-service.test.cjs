const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, writeFile } = require('node:fs/promises')

const { ProviderMeterRegistry, loadBundledProviderMeterAdapters, safeAction, meterCredentialFor, grantCredentialValueFor, credentialFor } = require('../electron/bridge/provider-meter-service.cjs')

test('registry discovers bundled adapters without provider branches in the core service', async () => {
  const adapters = await loadBundledProviderMeterAdapters()
  assert.deepEqual(adapters.map(row => row.id).sort(), [
    'deepseek-balance-v1',
    'openai-codex-rate-limits-v2',
    'opencode-go-plan-v1'
  ])
})

test('registry keeps credentials in the main process and returns normalized snapshots only', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'harness-provider-meter-'))
  await writeFile(path.join(home, 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    example:\n      apiKeyEnv: EXAMPLE_KEY\n')
  await writeFile(path.join(home, '.credentials.yaml'), 'EXAMPLE_KEY: super-secret-value\n')
  const registry = new ProviderMeterRegistry({
    adapters: [{
      id: 'example-v1',
      supports: provider => provider.id === 'example',
      refresh: async ({ credential }) => {
        assert.equal(credential.value, 'super-secret-value')
        return { meters: [{ id: 'day', kind: 'usage-window', label: '日用量', usedPercent: 25, remainingPercent: 75 }] }
      }
    }],
    now: () => 1_700_000_000_000
  })
  const result = await registry.readAll({ dshHome: home })
  assert.equal(result.snapshots[0].status, 'ready')
  assert.equal(result.snapshots[0].meters[0].remainingPercent, 75)
  assert.equal(JSON.stringify(result).includes('super-secret-value'), false)
})

test('registry reports unsupported providers and reuses fresh cached data', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'harness-provider-cache-'))
  await writeFile(path.join(home, 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    supported: {}\n    unknown: {}\n')
  let calls = 0
  const registry = new ProviderMeterRegistry({ adapters: [{
    id: 'supported-v1',
    supports: provider => provider.id === 'supported',
    refresh: async () => { calls += 1; return { meters: [{ id: 'x', kind: 'token-counter', value: calls }] } }
  }] })
  const first = await registry.readAll({ dshHome: home })
  const second = await registry.readAll({ dshHome: home })
  assert.equal(calls, 1)
  assert.equal(first.snapshots.find(row => row.provider.id === 'unknown').status, 'unsupported')
  assert.equal(second.snapshots.find(row => row.provider.id === 'supported').meters[0].value, 1)
})

test('external account actions allow HTTPS only', () => {
  assert.deepEqual(safeAction({ label: '查看', url: 'https://example.com/usage' }), { label: '查看', url: 'https://example.com/usage' })
  assert.equal(safeAction({ label: '危险', url: 'file:///C:/secret' }), null)
})

const codexProvider = () => ({ id: 'openai-codex', name: 'OpenAI Codex', profile: { apiKeyEnv: 'OPENAI_API_KEY' } })

test('the Codex OAuth grant is selected as the meter credential and wins over apiKeyEnv', () => {
  const credentials = {
    version: 1,
    refs: { OPENAI_API_KEY: 'env-fallback-123' },
    records: {
      'llm-pi-ai/openai-codex': {
        kind: 'grant',
        payload: { type: 'oauth', access: 'access-token-abc', refresh: 'refresh-secret-xyz', expires: 1800000 }
      }
    }
  }
  const credential = meterCredentialFor(codexProvider(), credentials, {})
  assert.equal(credential.value, 'access-token-abc')
  // The grant (WHAM OAuth) wins over the apiKeyEnv fallback.
  assert.notEqual(credential.value, 'env-fallback-123')
  // refresh/expires are never surfaced in the credential handed to the adapter.
  assert.equal(Object.prototype.hasOwnProperty.call(credential, 'refresh'), false)
  assert.equal(JSON.stringify(credential).includes('refresh-secret-xyz'), false)
  assert.equal(JSON.stringify(credential).includes('expires'), false)
})

test('the Codex grant reader ignores wrong scope, provider, kind, type and empty access', () => {
  const grant = access => ({ kind: 'grant', payload: { type: 'oauth', access } })
  assert.equal(grantCredentialValueFor({ version: 1, records: { 'other/openai-codex': grant('x') } }), null)
  assert.equal(grantCredentialValueFor({ version: 1, records: { 'llm-pi-ai/opencode-go': grant('x') } }), null)
  assert.equal(grantCredentialValueFor({ version: 1, records: { 'llm-pi-ai/openai-codex': { kind: 'api-key', key: 'x' } } }), null)
  assert.equal(grantCredentialValueFor({ version: 1, records: { 'llm-pi-ai/openai-codex': { kind: 'grant', payload: { type: 'bearer', access: 'x' } } } }), null)
  assert.equal(grantCredentialValueFor({ version: 1, records: { 'llm-pi-ai/openai-codex': grant('   ') } }), null)
  assert.equal(grantCredentialValueFor({ version: 1, records: { 'llm-pi-ai/openai-codex': grant('') } }), null)
  assert.equal(grantCredentialValueFor({ version: 1, records: { 'llm-pi-ai/openai-codex': 'not-a-mapping' } }), null)
  assert.equal(grantCredentialValueFor({ version: 1, records: {} }), null)
  assert.equal(grantCredentialValueFor({ version: 2, records: { 'llm-pi-ai/openai-codex': grant('future-secret') } }), null)
  assert.equal(grantCredentialValueFor({ records: { 'llm-pi-ai/openai-codex': grant('unversioned-secret') } }), null)
  // A non-codex provider is untouched by the grant path and keeps apiKeyEnv.
  const other = meterCredentialFor({ id: 'deepseek', name: 'DeepSeek', profile: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
    { version: 1, refs: { DEEPSEEK_API_KEY: 'dsk-123' }, records: { 'llm-pi-ai/openai-codex': grant('access-abc') } }, {})
  assert.equal(other.value, 'dsk-123')
})

test('the Codex grant reader admits a legacy flat document and a v1 refs document for apiKeyEnv', () => {
  assert.deepEqual(credentialFor(codexProvider(), { OPENAI_API_KEY: 'flat-value' }, {}), { reference: 'OPENAI_API_KEY', value: 'flat-value' })
  assert.deepEqual(credentialFor(codexProvider(), { version: 1, refs: { OPENAI_API_KEY: 'v1-value' } }, {}), { reference: 'OPENAI_API_KEY', value: 'v1-value' })
  // Environment wins over the store for an api-key reference.
  assert.deepEqual(credentialFor(codexProvider(), { version: 1, refs: { OPENAI_API_KEY: 'v1-value' } }, { OPENAI_API_KEY: 'env-value' }), { reference: 'OPENAI_API_KEY', value: 'env-value' })
})

test('the Codex OAuth grant drives the WHAM path end-to-end without leaking the token', async () => {
  const accountId = 'account-grant-test'
  // A realistic OpenAI OAuth JWT whose payload carries the ChatGPT account id the
  // WHAM endpoint requires; a synthetic non-JWT would correctly be rejected.
  const grantAccess = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } })).toString('base64url')}.signature`
  const grantRefresh = 'refresh-secret-999'
  const home = await mkdtemp(path.join(os.tmpdir(), 'harness-codex-grant-'))
  await writeFile(path.join(home, 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    openai-codex:\n      apiKeyEnv: OPENAI_API_KEY\n')
  await writeFile(path.join(home, '.credentials.yaml'), [
    'version: 1',
    'refs:',
    '  OPENAI_API_KEY: env-fallback-should-not-be-used',
    'records:',
    "  llm-pi-ai/openai-codex:",
    '    kind: grant',
    '    payload:',
    '      type: oauth',
    `      access: ${grantAccess}`,
    `      refresh: ${grantRefresh}`,
    '      expires: 1800000'
  ].join('\n'))

  const accessTokensSeen = []
  const registry = new ProviderMeterRegistry({
    adapters: [require('../electron/bridge/provider-meter-adapters/codex-rate-limits.cjs').createCodexRateLimitsAdapter()]
  })
  const result = await registry.readAll({
    dshHome: home,
    fetchImpl: async (url, options) => {
      const auth = String(options.headers.Authorization || '')
      accessTokensSeen.push(auth)
      return {
        ok: true,
        status: 200,
        json: async () => ({ rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 3600, reset_at: 1800000000 } } })
      }
    }
  })
  const snapshot = result.snapshots[0]
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.meters[0].remainingPercent, 58)
  // The WHAM request used the grant's access token (not the apiKeyEnv fallback).
  assert.equal(accessTokensSeen.length, 1)
  assert.equal(accessTokensSeen[0], `Bearer ${grantAccess}`)
  assert.equal(accessTokensSeen[0].includes('env-fallback-should-not-be-used'), false)
  // No token, refresh, or account id ever leaks into the returned snapshot.
  assert.equal(JSON.stringify(result).includes(grantAccess), false)
  assert.equal(JSON.stringify(result).includes(grantRefresh), false)
  assert.equal(JSON.stringify(result).includes('account-grant-test'), false)
  assert.equal(JSON.stringify(result).includes('env-fallback-should-not-be-used'), false)
})

test('Codex with no grant and no client still degrades to an actionable auth-required state', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'harness-codex-auth-required-'))
  await writeFile(path.join(home, 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    openai-codex:\n      displayName: OpenAI Codex\n')
  await writeFile(path.join(home, '.credentials.yaml'), 'version: 1\nrefs: {}\nrecords: {}\n')
  const registry = new ProviderMeterRegistry({
    adapters: [require('../electron/bridge/provider-meter-adapters/codex-rate-limits.cjs').createCodexRateLimitsAdapter()]
  })
  const result = await registry.readAll({ dshHome: home, spawnImpl: require('node:child_process').spawn })
  assert.equal(result.snapshots[0].status, 'auth-required')
  assert.equal(result.snapshots[0].meters.length, 0)
})

test('Codex transient client probe failure stays unavailable after the grant wiring', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'harness-codex-unavailable-'))
  await writeFile(path.join(home, 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    openai-codex:\n      displayName: OpenAI Codex\n')
  await writeFile(path.join(home, '.credentials.yaml'), 'version: 1\nrefs: {}\nrecords: {}\n')
  const events = require('node:events')
  const spawnExit = () => {
    const child = new events.EventEmitter()
    child.stdout = new events.EventEmitter()
    child.stdin = new events.EventEmitter()
    child.stdin.write = () => true
    child.stdin.on = () => child.stdin
    child.killed = false
    child.kill = () => { child.killed = true }
    process.nextTick(() => child.emit('exit', 1))
    return child
  }
  const registry = new ProviderMeterRegistry({
    adapters: [require('../electron/bridge/provider-meter-adapters/codex-rate-limits.cjs').createCodexRateLimitsAdapter()]
  })
  const result = await registry.readAll({ dshHome: home, spawnImpl: spawnExit })
  assert.equal(result.snapshots[0].status, 'unavailable')
})
