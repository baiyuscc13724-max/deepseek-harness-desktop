'use strict'
const assert = require('node:assert/strict')
const { test, before, after } = require('node:test')
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createProductionAdapterHarness, fingerprint, textRequest } = require('./fixtures/provider-credential-isolation-runtime.cjs')

let root
let moduleUrl
let patcher
let source
before(async () => {
  patcher = await import('../scripts/provider-auth-isolation-patch.mjs')
  source = await readFile(path.join(__dirname, '../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), 'utf8')
  root = await mkdtemp(path.join(__dirname, '.audit-provider-'))
  const file = path.join(root, 'index.mjs')
  await writeFile(file, patcher.patchProviderAuthIsolationSource(source).source)
  moduleUrl = pathToFileURL(file).href
})
after(async () => { if (root) await rm(root, { recursive: true, force: true }) })

const profile = (baseURL, apiKeyEnv, extra = {}) => ({
  api: 'openai-completions', baseURL, apiKeyEnv,
  retryPolicy: { mode: 'normal', maxRetries: 0 },
  models: [{ id: 'synthetic-model' }, { id: 'synthetic-other-model' }], ...extra
})
async function routeHarness() {
  return createProductionAdapterHarness({ providers: {
    alpha: profile('https://alpha.invalid/tenant-a/v1', 'ALPHA_KEY', { headers: { 'x-api-key': 'synthetic-header-a' } }),
    beta: profile('https://beta.invalid/v1', 'BETA_KEY')
  } }, { moduleUrl, refs: new Map([['ALPHA_KEY', 'synthetic-key-a'], ['BETA_KEY', 'synthetic-key-b']]) })
}

test('discovery draft destination/protocol changes never forward stored route credentials or headers', async (t) => {
  for (const changed of [
    { baseURL: 'https://beta.invalid/v1' },
    { baseURL: 'https://alpha.invalid/tenant-b/v1' },
    { baseURL: 'http://alpha.invalid/tenant-a/v1' },
    { baseURL: 'https://alpha.invalid:444/tenant-a/v1' },
    { baseURL: 'https://alpha.invalid/tenant-a/v1', api: 'openai-responses' }
  ]) await t.test(JSON.stringify(changed), async () => {
    const runtime = await routeHarness()
    const models = await runtime.discover({ provider: 'alpha', api: 'openai-completions', ...changed })
    assert.equal(models[0].id, 'synthetic-discovered-model')
    assert.equal(runtime.requests[0].authFingerprint, undefined, 'foreign draft destination received stored Authorization')
    assert.equal(runtime.requests[0].headerFingerprints['x-api-key'], undefined, 'foreign draft destination received stored custom header')
    assert.deepEqual(runtime.resolvedRefs, [], 'foreign destination must not even resolve the old credential')
  })
})

test('same discovery endpoint still uses its own stored key and headers, with redirects disabled', async () => {
  const runtime = await routeHarness()
  await runtime.discover({ provider: 'alpha', baseURL: 'https://alpha.invalid/tenant-a/v1/', api: 'openai-completions' })
  assert.equal(runtime.requests[0].authFingerprint, fingerprint('Bearer synthetic-key-a'))
  assert.equal(runtime.requests[0].headerFingerprints['x-api-key'], fingerprint('synthetic-header-a'))
  assert.equal(runtime.requests[0].redirect, 'error')
  assert.deepEqual(runtime.resolvedRefs, ['ALPHA_KEY'])
})

test('explicit draft keys never inherit old custom authentication headers, at a changed or unchanged destination', async () => {
  for (const baseURL of ['https://beta.invalid/v1', 'https://alpha.invalid/tenant-a/v1']) {
    const runtime = await routeHarness()
    await runtime.discover({ provider: 'alpha', baseURL, api: 'openai-completions', apiKey: 'synthetic-draft-b' })
    assert.equal(runtime.requests[0].authFingerprint, fingerprint('Bearer synthetic-draft-b'))
    assert.equal(runtime.requests[0].headerFingerprints['x-api-key'], undefined)
    assert.deepEqual(runtime.resolvedRefs, [])
  }
})

test('prepared model identity cannot be swapped under an already accepted route snapshot', async () => {
  const runtime = await routeHarness()
  const prepared = await runtime.adapter.prepareCall('alpha', 'synthetic-model')
  await assert.rejects(runtime.preparedStream(prepared, textRequest('alpha', 'synthetic-other-model')), { code: 'REQUEST_AUTH_SNAPSHOT_MISMATCH' })
  assert.equal(runtime.requests.length, 0)
})

test('concurrent prepared A/B streams retain independent keys and endpoints across rotation', async () => {
  const runtime = await routeHarness()
  const [alpha, beta] = await Promise.all([
    runtime.adapter.prepareCall('alpha', 'synthetic-model'),
    runtime.adapter.prepareCall('beta', 'synthetic-model')
  ])
  runtime.refs.set('ALPHA_KEY', 'synthetic-rotated-a')
  runtime.refs.set('BETA_KEY', 'synthetic-rotated-b')
  await runtime.parallelPreparedStreams([
    { prepared: beta, options: textRequest('beta', 'synthetic-model') },
    { prepared: alpha, options: textRequest('alpha', 'synthetic-model') }
  ])
  assert.deepEqual(runtime.requests.map(r => [new URL(r.url).host, r.authFingerprint]).sort(), [
    ['alpha.invalid', fingerprint('Bearer synthetic-key-a')],
    ['beta.invalid', fingerprint('Bearer synthetic-key-b')]
  ])
  await runtime.stream(textRequest('alpha', 'synthetic-model'))
  assert.equal(runtime.requests.at(-1).authFingerprint, fingerprint('Bearer synthetic-rotated-a'))
})

test('discovery errors do not retain a raw credential-bearing transport cause', async () => {
  const secret = 'synthetic-key-in-error'
  const runtime = await createProductionAdapterHarness({ providers: {
    alpha: profile('https://alpha.invalid/v1', 'ALPHA_KEY')
  } }, { moduleUrl, refs: new Map([['ALPHA_KEY', secret]]), transportThrowMessage: `socket failed ${secret}` })
  await assert.rejects(runtime.discover({ provider: 'alpha', baseURL: 'https://alpha.invalid/v1', api: 'openai-completions' }), error => {
    assert.equal(error.code, 'DISCOVERY_FAILED')
    for (let current = error, depth = 0; current && depth < 5; current = current.cause, depth++) {
      assert.equal(String(current.message).includes(secret), false)
      assert.equal(JSON.stringify(current).includes(secret), false)
    }
    return true
  })
})

test('directory hot reload keeps identity metadata separate and discovery resolves only the new route reference', async () => {
  const runtime = await routeHarness()
  runtime.refs.set('NEXT_ALPHA_KEY', 'synthetic-next-alpha')
  const section = runtime.section()
  section.setSource(() => ({ providers: {
    alpha: profile('https://next-alpha.invalid/v1', 'NEXT_ALPHA_KEY', { displayName: 'New Alpha' }),
    beta: profile('https://beta.invalid/v1', 'BETA_KEY')
  } }))
  section.onChange()
  const rows = runtime.directory().filter(row => ['alpha', 'beta'].includes(row.provider))
  assert.deepEqual(rows.map(row => [row.provider, row.settingsNs, row.settingsPath]), [
    ['alpha', 'llm-pi-ai', ['providers', 'alpha']], ['beta', 'llm-pi-ai', ['providers', 'beta']]
  ])
  assert.equal(rows[0].displayName, 'New Alpha')
  assert.equal(JSON.stringify(rows).includes('synthetic-next-alpha'), false)
  await runtime.discover({ provider: 'alpha', baseURL: 'https://next-alpha.invalid/v1', api: 'openai-completions' })
  await runtime.discover({ provider: 'beta', baseURL: 'https://beta.invalid/v1', api: 'openai-completions' })
  assert.deepEqual(runtime.resolvedRefs, ['NEXT_ALPHA_KEY', 'BETA_KEY'])
  assert.deepEqual(runtime.requests.map(r => r.authFingerprint), [fingerprint('Bearer synthetic-next-alpha'), fingerprint('Bearer synthetic-key-b')])
})

test('built-in catalog lookup stays local and resolves no unrelated provider secret', async () => {
  const runtime = await routeHarness()
  const models = await runtime.discover({ provider: 'openai-codex' })
  assert.equal(models.length > 0, true)
  assert.deepEqual(runtime.requests, [])
  assert.deepEqual(runtime.resolvedRefs, [])
})

test('route matching is structural rather than object identity, while malformed credential-bearing URLs fail closed', () => {
  const saved = { baseURL: 'https://alpha.invalid/v1', api: 'openai-completions' }
  assert.equal(patcher.providerDiscoveryRouteMatches({ ...saved }, structuredClone(saved)), true)
  for (const baseURL of ['https://user:password@alpha.invalid/v1', 'https://alpha.invalid/v1?api_key=synthetic', 'https://alpha.invalid/v1#fragment', 'not-a-url']) {
    assert.equal(patcher.providerDiscoveryRouteMatches({ ...saved, baseURL }, { ...saved, baseURL }), false)
  }
})

test('current source upgrades once and an incomplete marked patch is refused', () => {
  const patched = patcher.patchProviderAuthIsolationSource(source)
  assert.equal(patched.source.includes('provider-auth-isolation-v4'), true)
  assert.equal(patcher.patchProviderAuthIsolationSource(patched.source).changed, false)
  assert.throws(() => patcher.patchProviderAuthIsolationSource(patched.source.replace('function modelProviderDiscoveryRouteMatches', 'function corruptedDiscoveryRouteMatches')), /incomplete/)
})
