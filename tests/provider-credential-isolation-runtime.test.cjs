const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  createProductionAdapterHarness,
  fingerprint,
  syntheticOauth,
  textRequest
} = require('./fixtures/provider-credential-isolation-runtime.cjs')
const { createCredentialHarness } = require('./fixtures/model-settings-key-override-runtime.cjs')

async function failureOf(operation) {
  try {
    const chunks = await operation
    return chunks.findLast((chunk) => chunk.type === 'finish')?.reason?.failure
  } catch (error) {
    return error.failure || { code: error.code, message: error.message }
  }
}

const customProfile = (baseURL, apiKeyEnv, model = 'synthetic-model') => ({
  api: 'openai-completions',
  baseURL,
  apiKeyEnv,
  retryPolicy: { mode: 'normal', maxRetries: 0 },
  models: [{ id: model }]
})

test('production request adapter keeps Codex, another provider, and Codex credentials and endpoints matched', async () => {
  const oauth = syntheticOauth()
  const otherKey = 'synthetic-other-provider-key'
  const refs = new Map([
    ['OPENAI_CODEX_ACCESS_TOKEN', oauth.credential.payload.access],
    ['OTHER_PROVIDER_API_KEY', otherKey]
  ])
  const records = new Map([['llm-pi-ai/openai-codex', oauth.credential]])
  const runtime = await createProductionAdapterHarness({ providers: {
    'openai-codex': { apiKeyEnv: 'OPENAI_CODEX_ACCESS_TOKEN', retryPolicy: { mode: 'normal', maxRetries: 0 } },
    other: customProfile('https://other.invalid/v1', 'OTHER_PROVIDER_API_KEY')
  } }, { refs, records })

  const codexModel = await runtime.adapter.resolveModel('openai-codex', 'gpt-5.4-mini')
  const otherModel = await runtime.adapter.resolveModel('other', 'synthetic-model')
  assert.deepEqual([codexModel.provider, codexModel.id, otherModel.provider, otherModel.id], ['openai-codex', 'gpt-5.4-mini', 'other', 'synthetic-model'])
  const firstCodex = await runtime.stream(textRequest('openai-codex', codexModel.id))
  await runtime.stream(textRequest('other', otherModel.id))
  const secondCodex = await runtime.stream(textRequest('openai-codex', codexModel.id))

  assert.equal([firstCodex, secondCodex].every((chunks) => chunks.findLast((chunk) => chunk.type === 'finish')?.reason?.failure?.code), true)
  assert.equal([firstCodex, secondCodex].some((chunks) => JSON.stringify(chunks).includes(oauth.credential.payload.access)), false)
  assert.equal(runtime.requests.length, 3)
  assert.deepEqual(runtime.requests.map((request) => ({
    host: new URL(request.url).host,
    bodyModel: request.model,
    authFingerprint: request.authFingerprint,
    hasAccountId: request.hasAccountId
  })), [
    { host: 'chatgpt.com', bodyModel: undefined, authFingerprint: oauth.accessFingerprint, hasAccountId: true },
    { host: 'other.invalid', bodyModel: 'synthetic-model', authFingerprint: fingerprint(`Bearer ${otherKey}`), hasAccountId: false },
    { host: 'chatgpt.com', bodyModel: undefined, authFingerprint: oauth.accessFingerprint, hasAccountId: true }
  ])
  assert.equal(runtime.logs.some((entry) => entry.text.includes(oauth.credential.payload.access) || entry.text.includes(otherKey)), false)
})

test('prepareCall freezes provider/model/baseURL/auth reference while the next request observes hot reload', async () => {
  const firstKey = 'synthetic-first-key'
  const secondKey = 'synthetic-second-key'
  const refs = new Map([['FIRST_KEY', firstKey], ['SECOND_KEY', secondKey]])
  const runtime = await createProductionAdapterHarness({ providers: {
    route: customProfile('https://first.invalid/v1', 'FIRST_KEY')
  } }, { refs })
  const prepared = await runtime.adapter.prepareCall('route', 'synthetic-model')
  const section = runtime.section()
  assert.equal(typeof section?.setSource, 'function')
  assert.equal(typeof section?.onChange, 'function')
  section.setSource(() => ({ providers: { route: customProfile('https://second.invalid/v1', 'SECOND_KEY') } }))
  section.onChange()

  await runtime.preparedStream(prepared, textRequest('route', 'synthetic-model'))
  await runtime.stream(textRequest('route', 'synthetic-model'))

  assert.deepEqual(runtime.requests.map((request) => ({
    host: new URL(request.url).host,
    model: request.model,
    authFingerprint: request.authFingerprint
  })), [
    { host: 'first.invalid', model: 'synthetic-model', authFingerprint: fingerprint(`Bearer ${firstKey}`) },
    { host: 'second.invalid', model: 'synthetic-model', authFingerprint: fingerprint(`Bearer ${secondKey}`) }
  ])
})

test('production credential store serializes OAuth refresh with another provider edit and preserves both records', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { LocalCredentialProvider } = await import('../node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js')
  const root = await mkdtemp(path.join(os.tmpdir(), 'provider-credential-isolation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  const releaseEnvironment = ctx.provide('launchEnvironment', { get() {}, getFrom() {} })
  t.after(() => releaseEnvironment())
  const provider = new LocalCredentialProvider(ctx, { path: path.join(root, '.credentials.yaml'), watch: false })
  await provider.loadInitial()

  const before = syntheticOauth({ account: 'synthetic-before' }).credential
  const after = syntheticOauth({ account: 'synthetic-after' }).credential
  const codexKey = 'llm-pi-ai/openai-codex'
  await provider.modifyRecord(codexKey, async () => before)
  const beforeHash = fingerprint(JSON.stringify(await provider.readRecord(codexKey)))

  let releaseRefresh
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve })
  const refreshing = provider.modifyRecord(codexKey, async () => {
    markStarted()
    await refreshGate
    return after
  })
  await started
  let editSettled = false
  const editing = provider.set('OTHER_PROVIDER_API_KEY', 'synthetic-other-key').then(() => { editSettled = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(editSettled, false, 'a ref write must wait for the in-flight OAuth record mutation')
  releaseRefresh()
  await Promise.all([refreshing, editing])

  const afterHash = fingerprint(JSON.stringify(await provider.readRecord(codexKey)))
  assert.notEqual(afterHash, beforeHash)
  assert.equal(afterHash, fingerprint(JSON.stringify(after)))
  assert.deepEqual(await provider.describe('OTHER_PROVIDER_API_KEY'), { configured: true, source: 'file', writable: true })
  assert.equal((await provider.listRecords()).filter((entry) => String(entry.key) === codexKey).length, 1)
})

test('editing an isolated provider ref leaves existing Codex OAuth record bytes unchanged', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { LocalCredentialProvider } = await import('../node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js')
  const root = await mkdtemp(path.join(os.tmpdir(), 'provider-credential-boundary-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  const releaseEnvironment = ctx.provide('launchEnvironment', { get() {}, getFrom() {} })
  t.after(() => releaseEnvironment())
  const provider = new LocalCredentialProvider(ctx, { path: path.join(root, '.credentials.yaml'), watch: false })
  await provider.loadInitial()
  const codexKey = 'llm-pi-ai/openai-codex'
  await provider.modifyRecord(codexKey, async () => syntheticOauth().credential)
  const beforeHash = fingerprint(JSON.stringify(await provider.readRecord(codexKey)))
  await provider.set('HARNESS_DESKTOP_OTHER_PROVIDER_API_KEY', 'synthetic-other-key')
  const afterHash = fingerprint(JSON.stringify(await provider.readRecord(codexKey)))
  assert.equal(afterHash, beforeHash)
})

test('page-owned refs isolate namespace/provider identities, slug collisions, and foreign configured refs', async () => {
  const { managedProviderCredentialRef, planModelCredentialOverride, providerCredentialOverrideRef } = await import('../scripts/model-settings-key-override-patch.mjs')
  const piDash = providerCredentialOverrideRef('llm-pi-ai', 'a-b')
  const piUnderscore = providerCredentialOverrideRef('llm-pi-ai', 'a_b')
  const deepseekDash = providerCredentialOverrideRef('llm-deepseek', 'a-b')
  assert.equal(new Set([piDash, piUnderscore, deepseekDash]).size, 3)
  const typed = 'synthetic-provider-key'
  const plan = planModelCredentialOverride({
    mode: 'configured',
    keyValue: typed,
    configuredKeyRef: 'OPENAI_CODEX_ACCESS_TOKEN',
    overrideKeyRef: piDash,
    layout: 'pi-ai',
    hasDraftRef: true,
    hasFallbackRef: true
  })
  assert.equal(plan.profile.op, 'set')
  assert.equal(plan.profile.ref, piDash)
  assert.equal(plan.credential.op, 'set')
  assert.equal(plan.credential.ref, piDash)
  assert.equal(fingerprint(plan.credential.value), fingerprint(typed))
  assert.equal(managedProviderCredentialRef('llm-pi-ai', 'a-b', 'OPENAI_CODEX_ACCESS_TOKEN', { configured: true, writable: true }), undefined)
  assert.equal(managedProviderCredentialRef('llm-pi-ai', 'a-b', piDash, { configured: true, writable: true }), piDash)
  assert.equal(managedProviderCredentialRef('llm-deepseek', 'a-b', piDash, { configured: true, writable: true }), undefined)
})

test('rapid A/B edits with reversed deferred completion stay in distinct production credential slots', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { LocalCredentialProvider } = await import('../node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js')
  const { planModelCredentialOverride, providerCredentialOverrideRef } = await import('../scripts/model-settings-key-override-patch.mjs')
  const root = await mkdtemp(path.join(os.tmpdir(), 'provider-deferred-save-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  const releaseEnvironment = ctx.provide('launchEnvironment', { get() {}, getFrom() {} })
  t.after(() => releaseEnvironment())
  const provider = new LocalCredentialProvider(ctx, { path: path.join(root, '.credentials.yaml'), watch: false })
  await provider.loadInitial()
  const keyA = 'synthetic-route-a-key'
  const keyB = 'synthetic-route-b-key'
  const plan = (route, value) => planModelCredentialOverride({
    mode: 'configured', keyValue: value, configuredKeyRef: 'SHARED_FOREIGN_REF',
    overrideKeyRef: providerCredentialOverrideRef('llm-pi-ai', route), layout: 'pi-ai', hasDraftRef: true, hasFallbackRef: true
  })
  let releaseA
  let releaseB
  const gateA = new Promise((resolve) => { releaseA = resolve })
  const gateB = new Promise((resolve) => { releaseB = resolve })
  const save = async (planned, gate) => { await gate; await provider.set(planned.credential.ref, planned.credential.value) }
  const plannedA = plan('route-a', keyA)
  const plannedB = plan('route-b', keyB)
  const savingA = save(plannedA, gateA)
  const savingB = save(plannedB, gateB)
  releaseB()
  await savingB
  releaseA()
  await savingA
  assert.notEqual(plannedA.credential.ref, plannedB.credential.ref)
  assert.equal(fingerprint((await provider.resolve(plannedA.credential.ref)).value), fingerprint(keyA))
  assert.equal(fingerprint((await provider.resolve(plannedB.credential.ref)).value), fingerprint(keyB))
})

test('settings-first credential failure leaves a retryable isolated intermediate state without touching another provider', async () => {
  const { planModelCredentialOverride, providerCredentialOverrideRef } = await import('../scripts/model-settings-key-override-patch.mjs')
  const ownRef = providerCredentialOverrideRef('llm-pi-ai', 'route-a')
  const otherRef = providerCredentialOverrideRef('llm-pi-ai', 'route-b')
  const typed = 'synthetic-retry-key'
  const harness = createCredentialHarness({ user: {}, base: {}, failSetAt: [1] })
  harness.secrets.set(otherRef, 'synthetic-other-provider-key')
  const plan = planModelCredentialOverride({
    mode: 'configured',
    keyValue: typed,
    configuredKeyRef: 'OPENAI_CODEX_ACCESS_TOKEN',
    overrideKeyRef: ownRef,
    layout: 'pi-ai',
    hasDraftRef: true,
    hasFallbackRef: true
  })
  const failed = await harness.apply(plan)
  assert.equal(failed.outcome, 'credential-set-failed')
  assert.equal(failed.user.apiKeyEnv, ownRef)
  assert.equal(harness.secrets.has(ownRef), false)
  assert.equal(fingerprint(harness.secrets.get(otherRef)), fingerprint('synthetic-other-provider-key'))
  const retried = await harness.apply(plan)
  assert.equal(retried.outcome, 'ok')
  assert.equal(harness.calls.mutate.length, 1, 'retry must not rewrite the already committed settings reference')
  assert.equal(harness.calls.set.length, 2)
  assert.equal(fingerprint(harness.secrets.get(ownRef)), fingerprint(typed))
  assert.equal(fingerprint(harness.secrets.get(otherRef)), fingerprint('synthetic-other-provider-key'))
  assert.equal(JSON.stringify(retried.audit).includes(typed), false)
})

test('authentication contract follows effective protocol rather than provider display identity', async () => {
  const { providerAuthContract, providerAuthFailure } = await import('../scripts/provider-auth-isolation-patch.mjs')
  assert.deepEqual(providerAuthContract('openai-codex', { api: 'openai-responses', apiKeyEnv: 'CUSTOM_KEY' }), { kind: 'api-key', credentialRef: 'CUSTOM_KEY' })
  assert.deepEqual(providerAuthContract('renamed-route', { api: 'openai-codex-responses' }), { kind: 'oauth-record', credentialRef: undefined })
  assert.deepEqual(providerAuthContract('openai-codex', { apiKeyEnv: 'OPENAI_CODEX_ACCESS_TOKEN' }), { kind: 'oauth-access-token', credentialRef: 'OPENAI_CODEX_ACCESS_TOKEN' })
  const mismatch = providerAuthContract('renamed-route', { api: 'openai-codex-responses', apiKeyEnv: 'CUSTOM_KEY' })
  const reservedRefLeak = providerAuthContract('generic-route', { api: 'openai-completions', apiKeyEnv: 'OPENAI_CODEX_ACCESS_TOKEN' })
  assert.equal(mismatch.kind, 'mismatch')
  assert.equal(mismatch.code, 'AUTH_KIND_MISMATCH')
  assert.equal(mismatch.message.includes('renamed-route'), true)
  assert.equal(reservedRefLeak.kind, 'mismatch')
  assert.equal(reservedRefLeak.code, 'AUTH_KIND_MISMATCH')
  assert.deepEqual(providerAuthFailure('openai-codex', 'server returned 401'), { message: 'OpenAI Codex OAuth credential was rejected; sign in again.', code: 'CODEX_AUTH_REJECTED' })
})

test('Codex token validation classifies format, account binding, expiry, and valid synthetic JWT without echoing input', async () => {
  const { codexAccessTokenState } = await import('../scripts/provider-auth-isolation-patch.mjs')
  const now = 2_000_000_000_000
  const jwt = (claims) => `synthetic.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
  const opaque = 'synthetic-opaque-token'
  const malformed = codexAccessTokenState(opaque, now)
  const noAccount = codexAccessTokenState(jwt({ exp: Math.floor(now / 1000) + 60 }), now)
  const expired = codexAccessTokenState(jwt({ exp: Math.floor(now / 1000) - 1, chatgpt_account_id: 'synthetic-account' }), now)
  const valid = codexAccessTokenState(jwt({ exp: Math.floor(now / 1000) + 60, chatgpt_account_id: 'synthetic-account' }), now)
  assert.deepEqual([malformed.code, noAccount.code, expired.code, valid.ok], ['CODEX_AUTH_TOKEN_FORMAT', 'CODEX_AUTH_ACCOUNT_MISSING', 'CODEX_AUTH_TOKEN_EXPIRED', true])
  assert.equal([malformed, noAccount, expired].some((result) => result.message.includes(opaque)), false)
})

test('installed production adapter sanitizes every effective Codex credential failure path', async (t) => {
  const nativeCodex = (apiKeyEnv, displayName) => ({
    baseURL: 'https://chatgpt.com/backend-api/codex',
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(displayName === undefined ? {} : { displayName }),
    models: [{ id: 'gpt-5.4-mini' }],
    retryPolicy: { mode: 'normal', maxRetries: 0 }
  })
  await t.test('explicit reserved ref missing maps to Codex required without transport', async () => {
    const runtime = await createProductionAdapterHarness({ providers: { 'openai-codex': nativeCodex('OPENAI_CODEX_ACCESS_TOKEN') } })
    const failure = await failureOf(runtime.stream(textRequest('openai-codex', 'gpt-5.4-mini')))
    assert.equal(failure?.code, 'CODEX_AUTH_REQUIRED')
    assert.equal(runtime.requests.length, 0)
  })
  await t.test('malformed reserved token never reaches transport or logs', async () => {
    const secret = 'synthetic-malformed-codex-token'
    const runtime = await createProductionAdapterHarness({ providers: { 'openai-codex': nativeCodex('OPENAI_CODEX_ACCESS_TOKEN') } }, { refs: new Map([['OPENAI_CODEX_ACCESS_TOKEN', secret]]) })
    const failure = await failureOf(runtime.stream(textRequest('openai-codex', 'gpt-5.4-mini')))
    assert.equal(failure?.code, 'CODEX_AUTH_TOKEN_FORMAT')
    assert.equal(JSON.stringify({ failure, logs: runtime.logs }).includes(secret), false)
    assert.equal(runtime.requests.length, 0)
  })
  await t.test('native Codex route with a custom display name uses its OAuth record and sanitizes 401', async () => {
    const oauth = syntheticOauth()
    const runtime = await createProductionAdapterHarness({ providers: { 'openai-codex': nativeCodex(undefined, 'Codex Alias') } }, {
      records: new Map([['llm-pi-ai/openai-codex', oauth.credential]]),
      responseStatus: 401,
      responseErrorMessage: '401 synthetic authorization rejected'
    })
    const failure = await failureOf(runtime.stream(textRequest('openai-codex', 'gpt-5.4-mini')))
    assert.equal(failure?.code, 'CODEX_AUTH_REJECTED')
    assert.equal(JSON.stringify({ failure, logs: runtime.logs }).includes(oauth.credential.payload.access), false)
  })
  await t.test('native Codex route with no ref and no OAuth record maps to required', async () => {
    const runtime = await createProductionAdapterHarness({ providers: { 'openai-codex': nativeCodex(undefined, 'Codex Alias') } })
    const failure = await failureOf(runtime.stream(textRequest('openai-codex', 'gpt-5.4-mini')))
    assert.equal(failure?.code, 'CODEX_AUTH_REQUIRED')
    assert.equal(runtime.requests.length, 0)
  })
  await t.test('unsupported custom Codex protocol is rejected before credential resolution and transport', async () => {
    await assert.rejects(createProductionAdapterHarness({ providers: {
      'codex-alias': { api: 'openai-codex-responses', baseURL: 'https://unsupported.invalid/v1', models: [{ id: 'gpt-5.4-mini' }] }
    } }), /cannot serve; supported protocols/u)
  })
  await t.test('unmatched upstream echo cannot expose the request credential', async () => {
    const oauth = syntheticOauth()
    const runtime = await createProductionAdapterHarness({ providers: { 'openai-codex': nativeCodex(undefined, 'Codex Alias') } }, {
      records: new Map([['llm-pi-ai/openai-codex', oauth.credential]]),
      responseStatus: 500,
      responseErrorMessage: `unclassified upstream failure ${oauth.credential.payload.access}`
    })
    const failure = await failureOf(runtime.stream(textRequest('openai-codex', 'gpt-5.4-mini')))
    assert.equal(failure?.code, 'CODEX_AUTH_FAILED')
    assert.equal(failure?.message.includes('OpenAI Codex'), true)
    assert.equal(failure?.message.includes(oauth.credential.payload.access), false, 'failure message leaked the request credential')
    assert.equal(String(failure?.code).includes(oauth.credential.payload.access), false, 'failure code leaked the request credential')
    assert.equal(JSON.stringify(failure).includes(oauth.credential.payload.access), false, 'finish/error payload leaked the request credential')
    assert.equal(JSON.stringify(runtime.logs).includes(oauth.credential.payload.access), false, 'adapter logs leaked the request credential')
  })
  await t.test('thrown transport errors discard a secret-bearing raw cause', async () => {
    const oauth = syntheticOauth()
    const runtime = await createProductionAdapterHarness({ providers: { 'openai-codex': nativeCodex(undefined, 'Codex Alias') } }, {
      records: new Map([['llm-pi-ai/openai-codex', oauth.credential]]),
      transportThrowMessage: `socket failed ${oauth.credential.payload.access}`
    })
    let thrown
    let chunks
    try {
      chunks = await runtime.stream(textRequest('openai-codex', 'gpt-5.4-mini'))
    } catch (error) {
      thrown = error
    }
    const observable = [JSON.stringify(chunks), JSON.stringify(runtime.logs)]
    for (let error = thrown, depth = 0; error !== undefined && depth < 4; error = error.cause, depth += 1) {
      observable.push(String(error.message), String(error.code), JSON.stringify(error.failure))
    }
    assert.equal(observable.join('\n').includes(oauth.credential.payload.access), false)
    assert.equal(observable.join('\n').includes('CODEX_AUTH_FAILED'), true)
  })
})

test('patched full production adapter rejects a malformed Codex access-token ref before fake transport', async (t) => {
  const { patchProviderAuthIsolationSource } = await import('../scripts/provider-auth-isolation-patch.mjs')
  const source = await readFile(path.join(__dirname, '../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), 'utf8')
  const patched = patchProviderAuthIsolationSource(source)
  assert.equal(typeof patched.changed, 'boolean')
  const root = await mkdtemp(path.join(__dirname, '.provider-auth-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const moduleFile = path.join(root, 'index.mjs')
  await writeFile(moduleFile, patched.source)
  const moduleUrl = `${pathToFileURL(moduleFile).href}?case=${Date.now()}`
  const opaque = 'synthetic-opaque-token'
  const runtime = await createProductionAdapterHarness({ providers: {
    'openai-codex': { apiKeyEnv: 'OPENAI_CODEX_ACCESS_TOKEN', retryPolicy: { mode: 'normal', maxRetries: 0 } }
  } }, { refs: new Map([['OPENAI_CODEX_ACCESS_TOKEN', opaque]]), moduleUrl })
  let malformedFailure
  await assert.rejects(runtime.stream(textRequest('openai-codex', 'gpt-5.4-mini')), (error) => {
    malformedFailure = error.failure || error
    return error.code === 'CODEX_AUTH_TOKEN_FORMAT'
  })
  assert.equal(malformedFailure?.message.includes('OpenAI Codex'), true)
  assert.equal(malformedFailure?.message.includes(opaque), false)
  assert.equal(runtime.requests.length, 0)

  const expiredOauth = syntheticOauth({ expires: Date.now() - 60_000 })
  const expiredRuntime = await createProductionAdapterHarness({ providers: {
    'openai-codex': { apiKeyEnv: 'OPENAI_CODEX_ACCESS_TOKEN', retryPolicy: { mode: 'normal', maxRetries: 0 } }
  } }, { refs: new Map([['OPENAI_CODEX_ACCESS_TOKEN', expiredOauth.credential.payload.access]]), moduleUrl })
  const expiredFailure = await failureOf(expiredRuntime.stream(textRequest('openai-codex', 'gpt-5.4-mini')))
  assert.equal(expiredFailure?.code, 'CODEX_AUTH_TOKEN_EXPIRED')
  assert.equal(expiredFailure?.message.includes(expiredOauth.credential.payload.access), false)
  assert.equal(expiredRuntime.requests.length, 0)

  const missingRuntime = await createProductionAdapterHarness({ providers: {
    'openai-codex': { retryPolicy: { mode: 'normal', maxRetries: 0 } }
  } }, { moduleUrl })
  const missingFailure = await failureOf(missingRuntime.stream(textRequest('openai-codex', 'gpt-5.4-mini')))
  assert.equal(missingFailure?.code, 'CODEX_AUTH_REQUIRED')
  assert.equal(missingRuntime.requests.length, 0)

  const oauth = syntheticOauth()
  const generic = await createProductionAdapterHarness({ providers: {
    generic: customProfile('https://generic.invalid/v1', 'OPENAI_CODEX_ACCESS_TOKEN')
  } }, { refs: new Map([['OPENAI_CODEX_ACCESS_TOKEN', oauth.credential.payload.access]]), moduleUrl })
  await assert.rejects(generic.stream(textRequest('generic', 'synthetic-model')), (error) => {
    assert.equal(error.message.includes(oauth.credential.payload.access), false)
    return error.code === 'AUTH_KIND_MISMATCH'
  })
  assert.equal(generic.requests.length, 0)

  const preparedRuntime = await createProductionAdapterHarness({ providers: {
    alpha: customProfile('https://alpha.invalid/v1', 'ALPHA_KEY'),
    beta: customProfile('https://beta.invalid/v1', 'BETA_KEY')
  } }, { refs: new Map([['ALPHA_KEY', 'synthetic-alpha'], ['BETA_KEY', 'synthetic-beta']]), moduleUrl })
  const prepared = await preparedRuntime.adapter.prepareCall('alpha', 'synthetic-model')
  await assert.rejects(preparedRuntime.preparedStream(prepared, textRequest('beta', 'synthetic-model')), (error) => error.code === 'REQUEST_AUTH_SNAPSHOT_MISMATCH')
  assert.equal(preparedRuntime.requests.length, 0)
})
