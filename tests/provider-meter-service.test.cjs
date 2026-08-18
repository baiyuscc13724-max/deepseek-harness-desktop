const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, writeFile } = require('node:fs/promises')

const { ProviderMeterRegistry, loadBundledProviderMeterAdapters, safeAction } = require('../electron/bridge/provider-meter-service.cjs')

test('registry discovers bundled adapters without provider branches in the core service', async () => {
  const adapters = await loadBundledProviderMeterAdapters()
  assert.deepEqual(adapters.map(row => row.id).sort(), [
    'deepseek-balance-v1',
    'openai-codex-rate-limits-v1',
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
