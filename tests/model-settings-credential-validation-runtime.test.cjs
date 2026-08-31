const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const modelSettingsRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-models', 'lib', 'client.js')
const deepSeekRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js')

async function patchedModelSettings() {
  const [{ patchModelSettingsKeyOverrideSource }, { patchModelSettingsCredentialValidationSource }] = await Promise.all([
    import('../scripts/model-settings-key-override-patch.mjs'),
    import('../scripts/model-settings-credential-validation-patch.mjs')
  ])
  const keyed = patchModelSettingsKeyOverrideSource(readFileSync(modelSettingsRuntime, 'utf8')).source
  return patchModelSettingsCredentialValidationSource(keyed)
}

test('provider keys are remotely checked before settings or credentials are persisted', async () => {
  const patched = (await patchedModelSettings()).source
  const validateAt = patched.indexOf('api.llm.discoverModels(validationRequest)')
  const settingsAt = patched.indexOf('api.settings.mutate({', validateAt)
  const credentialAt = patched.indexOf('api.credentials.set({', validateAt)
  assert.ok(validateAt > 0)
  assert.ok(settingsAt > validateAt)
  assert.ok(credentialAt > settingsAt)
  assert.match(patched, /provider !== "deepseek-official" && provider !== "opencode-go"/u)
  assert.match(patched, /provider === "opencode-go" \? "https:\/\/opencode\.ai\/zen\/go\/v1"/u)
  assert.match(patched, /settingsNs: probe\.settingsNs,[\s\S]+apiKey/u)
  assert.match(patched, /status: "invalid", message/u)
  assert.match(patched, /credentialValidated \? \{ status: "valid" \} : \{ status: "unverified" \}/u)
})

test('credential indicators distinguish verified, rejected, unverified, and missing states', async () => {
  const patched = (await patchedModelSettings()).source
  assert.match(patched, /credentialValidation\?\.status === "valid"/u)
  assert.match(patched, /credentialValidation\?\.status === "invalid"/u)
  assert.match(patched, /credentialDotUnverified/u)
  assert.match(patched, /credentialVerified: "API key verified by the provider"/u)
  assert.match(patched, /credentialInvalid: "The provider rejected this API key"/u)
  assert.match(patched, /credentialVerified: "API 密钥已通过提供方认证"/u)
  assert.match(patched, /credentialInvalid: "提供方拒绝了此 API 密钥"/u)
  assert.doesNotThrow(() => new Function(patched))
})

test('model-settings credential validation patch is idempotent and rejects partial markers', async () => {
  const { patchModelSettingsCredentialValidationSource } = await import('../scripts/model-settings-credential-validation-patch.mjs')
  const once = await patchedModelSettings()
  assert.equal(once.changed, true)
  assert.equal(patchModelSettingsCredentialValidationSource(once.source).changed, false)
  assert.throws(() => patchModelSettingsCredentialValidationSource(`${readFileSync(modelSettingsRuntime, 'utf8')}\n// @harness-desktop/model-settings-credential-validation-v1`), /incomplete/u)
})

test('DeepSeek model discovery validates the supplied key at the official model endpoint', async () => {
  const { patchDeepSeekModelDiscoverySource } = await import('../scripts/deepseek-model-discovery-patch.mjs')
  const source = readFileSync(deepSeekRuntime, 'utf8')
  const once = patchDeepSeekModelDiscoverySource(source)
  assert.equal(once.changed, true)
  assert.equal(patchDeepSeekModelDiscoverySource(once.source).changed, false)
  assert.match(once.source, /const url = `\$\{baseURL\}\/models`/u)
  assert.match(once.source, /authorization: `Bearer \$\{apiKey\}`/u)
  assert.match(once.source, /response\.status === 401 \|\| response\.status === 403 \? "AUTH"/u)
  assert.match(once.source, /ctx\.llm\.registerModelDiscovery\(NS/u)
})
