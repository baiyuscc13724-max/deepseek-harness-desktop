const assert = require('node:assert/strict')
const test = require('node:test')

test('raw upstream anchors patch directly to complete gated v3', async () => {
  const { createModelSettingsKeyOverrideUpstreamFixture, patchModelSettingsKeyOverrideSource } = await import('../scripts/model-settings-key-override-patch.mjs')
  const raw = createModelSettingsKeyOverrideUpstreamFixture()
  assert.doesNotMatch(raw, /model-settings-key-override-(?:direct|gated)/u)
  const result = patchModelSettingsKeyOverrideSource(raw)
  assert.equal(result.changed, true)
  assert.match(result.source, /@harness-desktop\/model-settings-key-override-gated-v3/u)
  assert.match(result.source, /modelSettingsManagedCredentialRef/u)
  assert.match(result.source, /keyRestoreCompensationFailed/u)
})

test('complete synthetic direct v2 anchor fixture migrates exactly to gated v3', async () => {
  const { createModelSettingsKeyOverrideDirectV2Fixture, patchModelSettingsKeyOverrideSource } = await import('../scripts/model-settings-key-override-patch.mjs')
  const directV2 = createModelSettingsKeyOverrideDirectV2Fixture()
  assert.match(directV2, /@harness-desktop\/model-settings-key-override-direct-v2/u)
  const patched = patchModelSettingsKeyOverrideSource(directV2).source

  assert.match(patched, /@harness-desktop\/model-settings-key-override-gated-v3/u)
  assert.match(patched, /function modelSettingsCredentialTransition/u)
  assert.match(patched, /function modelSettingsCredentialPlan/u)
  assert.match(patched, /function modelSettingsManagedCredentialRef/u)
  assert.match(patched, /HARNESS_DESKTOP_\$\{deriveKeyRef\(provider\)\}/u)
  assert.match(patched, /setCredentialGate\("unavailable"\)/u)
  assert.match(patched, /credentials\.unset\(\{ ref: credentialPlan\.credential\.ref \}\)/u)
  assert.match(patched, /expectedRevision: appliedRevision/u)
  assert.match(patched, /modelSettingsManagedCredentialRef\(row\.entry\.provider, row\.apiKeyEnv, row\.credential\)/u)
  assert.match(patched, /\("label", \{\s+htmlFor: credentialInputId/um)
  assert.match(patched, /id: credentialInputId/u)
  assert.match(patched, /autoComplete: "new-password"/u)
  assert.match(patched, /style: \{ minHeight: 44 \}/u)
  assert.match(patched, /style: \{ minHeight: 44, minWidth: 44 \}/u)
  assert.match(patched, /keyEnvironmentHint: "当前认证来自启动环境。直接输入或粘贴会建立独立的本机覆盖/u)
  assert.match(patched, /keyRestoreEnvironment: "恢复启动环境"/u)
})

test('complete generated gated v3 is idempotent', async () => {
  const { createModelSettingsKeyOverrideUpstreamFixture, patchModelSettingsKeyOverrideSource } = await import('../scripts/model-settings-key-override-patch.mjs')
  const v3 = patchModelSettingsKeyOverrideSource(createModelSettingsKeyOverrideUpstreamFixture()).source
  const second = patchModelSettingsKeyOverrideSource(v3)
  assert.equal(second.changed, false)
  assert.equal(second.source, v3)
})

test('partial v2 and partial v3 are both rejected fail-closed', async () => {
  const { createModelSettingsKeyOverrideDirectV2Fixture, patchModelSettingsKeyOverrideSource } = await import('../scripts/model-settings-key-override-patch.mjs')
  const v2 = createModelSettingsKeyOverrideDirectV2Fixture()
  const partialV2 = v2.replace('disabled: disabled || credentialMode === "restore"', 'disabled: disabled')
  assert.throws(() => patchModelSettingsKeyOverrideSource(partialV2), /v2 patch is incomplete/u)

  const v3 = patchModelSettingsKeyOverrideSource(v2).source
  const partialV3 = v3.replace('api.credentials.unset({ ref: credentialPlan.credential.ref })', 'Promise.resolve({ result: { ok: true } })')
  assert.throws(() => patchModelSettingsKeyOverrideSource(partialV3), /patch is incomplete/u)
})
