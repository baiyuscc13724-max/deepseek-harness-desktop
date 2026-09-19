const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { createCredentialHarness } = require('./fixtures/model-settings-key-override-runtime.cjs')

const root = path.resolve(__dirname, '..')
const runtimePackageFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-models', 'package.json')
const runtimeFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-models', 'lib', 'client.js')

async function moduleUnderTest() {
  return import('../scripts/model-settings-key-override-patch.mjs')
}

test('read-only environment input creates isolated overrides without reading environment secret values', async () => {
  const { transitionModelCredentialOverride, planModelCredentialOverride, providerCredentialOverrideRef } = await moduleUnderTest()
  const typedSecret = ['typed', 'override', 'sentinel'].join('-')
  const environmentSecret = ['environment', 'secret', 'must-not-be-read'].join('-')
  for (const provider of ['deepseek-official', 'openai', 'codex', 'custom-gateway']) {
    const envRef = `ENV_${provider.toUpperCase().replaceAll('-', '_')}_API_KEY`
    const namespace = provider === 'deepseek-official' ? 'llm-deepseek' : 'llm-pi-ai'
    const overrideRef = providerCredentialOverrideRef(namespace, provider)
    let state = { gate: 'loading', writable: undefined, mode: 'configured', usingOverride: false, draft: '' }
    state = transitionModelCredentialOverride(state, { type: 'input', value: typedSecret })
    assert.equal(state.draft, '', `${provider} must fail closed before credential metadata resolves`)
    state = transitionModelCredentialOverride(state, { type: 'describe', writable: false })
    assert.equal(Object.values(state).includes(environmentSecret), false)
    state = transitionModelCredentialOverride(state, { type: 'input', value: typedSecret })
    assert.equal(state.mode, 'override')

    const plan = planModelCredentialOverride({ mode: state.mode, keyValue: state.draft, configuredKeyRef: envRef, overrideKeyRef: overrideRef, layout: provider === 'deepseek-official' ? 'deepseek' : 'pi-ai', hasDraftRef: false, hasFallbackRef: true })
    const harness = createCredentialHarness({ base: { apiKeyEnv: envRef, api: 'openai-completions' } })
    const result = await harness.apply(plan, { credentialOnly: provider === 'deepseek-official' })
    assert.deepEqual(harness.calls.set, [{ ref: overrideRef, value: typedSecret }])
    assert.deepEqual(harness.calls.unset, [])
    assert.equal(result.provider.apiKeyEnv, overrideRef)
    assert.equal(result.provider.api, 'openai-completions')
    assert.equal(result.environmentSecretReads, 0)
    assert.equal(JSON.stringify(result.provider).includes(typedSecret), false)
    assert.equal(JSON.stringify(result.provider).includes(environmentSecret), false)
    assert.equal(JSON.stringify(result.audit).includes(typedSecret), false)
    assert.equal(JSON.stringify(result.audit).includes(environmentSecret), false)
  }
})

test('an override can be modified and successfully restored without an orphan', async () => {
  const { transitionModelCredentialOverride, planModelCredentialOverride, providerCredentialOverrideRef } = await moduleUnderTest()
  const envRef = 'ENV_OPENAI_API_KEY'
  const overrideRef = providerCredentialOverrideRef('llm-pi-ai', 'openai')
  const firstSecret = ['first', 'secret', 'sentinel'].join('-')
  const secondSecret = ['second', 'secret', 'sentinel'].join('-')
  const harness = createCredentialHarness({ user: { apiKeyEnv: overrideRef }, base: { apiKeyEnv: envRef } })
  harness.secrets.set(overrideRef, firstSecret)

  let state = transitionModelCredentialOverride({ gate: 'loading', writable: undefined, mode: 'configured', usingOverride: true, draft: '' }, { type: 'describe', writable: true })
  state = transitionModelCredentialOverride(state, { type: 'input', value: secondSecret })
  await harness.apply(planModelCredentialOverride({ mode: state.mode, keyValue: state.draft, configuredKeyRef: overrideRef, overrideKeyRef: overrideRef, layout: 'pi-ai', hasDraftRef: true, hasFallbackRef: true }))
  assert.equal(harness.secrets.get(overrideRef), secondSecret)

  state = transitionModelCredentialOverride({ ...state, draft: '', usingOverride: true }, { type: 'restore' })
  const restored = await harness.apply(planModelCredentialOverride({ mode: state.mode, keyValue: '', configuredKeyRef: overrideRef, overrideKeyRef: overrideRef, layout: 'pi-ai', hasDraftRef: true, hasFallbackRef: true }))
  assert.equal(restored.outcome, 'ok')
  assert.deepEqual(harness.calls.unset, [{ ref: overrideRef }])
  assert.deepEqual(restored.credentialRefs, [])
  assert.equal(restored.provider.apiKeyEnv, envRef)
  assert.equal(Object.hasOwn(restored.user, 'apiKeyEnv'), false)
  assert.equal(JSON.stringify(restored.audit).includes(firstSecret), false)
  assert.equal(JSON.stringify(restored.audit).includes(secondSecret), false)
})

test('failed override unset is compensated by rebinding the provider to the still-present override', async () => {
  const { planModelCredentialOverride, providerCredentialOverrideRef } = await moduleUnderTest()
  const overrideRef = providerCredentialOverrideRef('llm-pi-ai', 'openai')
  const harness = createCredentialHarness({ user: { apiKeyEnv: overrideRef }, base: { apiKeyEnv: 'ENV_OPENAI_API_KEY' }, failUnset: true })
  harness.secrets.set(overrideRef, 'opaque-test-secret')
  const plan = planModelCredentialOverride({ mode: 'restore', keyValue: '', configuredKeyRef: overrideRef, overrideKeyRef: overrideRef, layout: 'pi-ai', hasDraftRef: true, hasFallbackRef: true })
  const result = await harness.apply(plan)
  assert.equal(result.outcome, 'restore-compensated')
  assert.equal(result.provider.apiKeyEnv, overrideRef)
  assert.deepEqual(result.credentialRefs, [overrideRef])
  assert.deepEqual(harness.calls.mutate, [[{ op: 'unset', path: ['apiKeyEnv'] }], [{ op: 'set', path: ['apiKeyEnv'], value: overrideRef }]])
})

test('unset plus compensation failure is surfaced and records the extreme residual orphan risk', async () => {
  const { planModelCredentialOverride, providerCredentialOverrideRef } = await moduleUnderTest()
  const overrideRef = providerCredentialOverrideRef('llm-pi-ai', 'openai')
  const harness = createCredentialHarness({ user: { apiKeyEnv: overrideRef }, base: { apiKeyEnv: 'ENV_OPENAI_API_KEY' }, failUnset: true, failMutateAt: [2] })
  harness.secrets.set(overrideRef, 'opaque-test-secret')
  const result = await harness.apply(planModelCredentialOverride({ mode: 'restore', keyValue: '', configuredKeyRef: overrideRef, overrideKeyRef: overrideRef, layout: 'pi-ai', hasDraftRef: true, hasFallbackRef: true }))
  assert.equal(result.outcome, 'restore-compensation-failed')
  assert.equal(result.provider.apiKeyEnv, 'ENV_OPENAI_API_KEY')
  assert.deepEqual(result.credentialRefs, [overrideRef])
  assert.equal(result.audit.some((entry) => entry.operation === 'credentials.unset'), true)
  assert.equal(result.audit.filter((entry) => entry.operation === 'settings.mutate').length, 2)
})

test('native alpha.5 provider deletion selects only its namespace-owned writable ref and removes it before settings', async () => {
  const { managedProviderCredentialRef, providerCredentialOverrideRef } = await moduleUnderTest()
  const overrideRef = providerCredentialOverrideRef('llm-pi-ai', 'custom-gateway')
  assert.equal(managedProviderCredentialRef('llm-pi-ai', 'custom-gateway', overrideRef, { configured: true, writable: true }), overrideRef)
  assert.equal(managedProviderCredentialRef('llm-deepseek', 'custom-gateway', overrideRef, { configured: true, writable: true }), undefined)
  assert.equal(managedProviderCredentialRef('llm-pi-ai', 'custom-gateway', 'ENV_CUSTOM_GATEWAY_API_KEY', { configured: true, writable: false }), undefined)

  const runtime = readFileSync(runtimeFile, 'utf8')
  assert.match(runtime, /const managedRef = deriveOverrideKeyRef\(row\.entry\.settingsNs, row\.entry\.provider\);/u)
  assert.match(runtime, /const credentialRef = row\.apiKeyEnv === managedRef && row\.credential\?\.configured === true && row\.credential\.writable \? managedRef : void 0;/u)
  const removeAt = runtime.indexOf('const credential = await operations.removeCredential(target.credentialRef);')
  const settingsAt = runtime.indexOf('const written = await operations.writeSettings(target.settingsNs, [{', removeAt)
  assert.ok(removeAt > 0)
  assert.ok(settingsAt > removeAt, 'credential removal must land before the provider settings unset')
})

test('writable foreign pi-ai refs switch to a page-owned ref and unavailable gates have no write path', async () => {
  const { transitionModelCredentialOverride, planModelCredentialOverride, providerCredentialOverrideRef } = await moduleUnderTest()
  const sentinel = ['custom', 'credential', 'sentinel'].join('-')
  let unavailable = transitionModelCredentialOverride({ gate: 'loading', writable: undefined, mode: 'configured', usingOverride: false, draft: '' }, { type: 'describe', writable: undefined })
  unavailable = transitionModelCredentialOverride(unavailable, { type: 'input', value: sentinel })
  assert.equal(unavailable.gate, 'unavailable')
  assert.equal(unavailable.draft, '')

  let writable = transitionModelCredentialOverride({ gate: 'loading', writable: undefined, mode: 'configured', usingOverride: false, draft: '' }, { type: 'describe', writable: true })
  writable = transitionModelCredentialOverride(writable, { type: 'input', value: sentinel })
  const overrideRef = providerCredentialOverrideRef('llm-pi-ai', 'custom-gateway')
  const plan = planModelCredentialOverride({ mode: writable.mode, keyValue: writable.draft, configuredKeyRef: 'CUSTOM_GATEWAY_API_KEY', overrideKeyRef: overrideRef, layout: 'pi-ai', hasDraftRef: false, hasFallbackRef: false })
  assert.deepEqual(plan.profile, { op: 'set', ref: overrideRef })
  assert.equal(plan.credential.ref, overrideRef)
})

test('native alpha.5 runtime is exact, executable, write-only, masked and accessible', () => {
  const manifest = JSON.parse(readFileSync(runtimePackageFile, 'utf8'))
  assert.deepEqual({ name: manifest.name, version: manifest.version }, { name: '@deepseek-ai/dsh-client-ui-settings-models', version: '0.1.2-alpha.5' })
  const runtime = readFileSync(runtimeFile, 'utf8')
  assert.equal(createHash('sha256').update(runtime).digest('hex').toUpperCase(), '766CFC372B94665000B60836D845767AEF3417852D6F97ED1CD035AFC039EA52')
  assert.doesNotThrow(() => new Function(runtime))
  assert.match(runtime, /type: "password"/u)
  assert.match(runtime, /autoComplete: "off"/u)
  assert.match(runtime, /"aria-label": t\("keyInput"\)/u)
  assert.match(runtime, /\n\s+disabled,\n/u)
  assert.match(runtime, /ctx\.remote\.credentials\.describe\(\[ref\]\)/u)
  assert.match(runtime, /ctx\.remote\.credentials\.set\(ref, value\)/u)
  assert.match(runtime, /ctx\.remote\.credentials\.unset\(ref\)/u)
  assert.doesNotMatch(runtime, /process\.env|Deno\.env|Bun\.env|credentials\.(?:get|read|reveal)\(/u)
  assert.doesNotMatch(runtime, /typed-override-sentinel|environment-secret-must-not-be-read|first-secret-sentinel|second-secret-sentinel|custom-credential-sentinel/u)
})
