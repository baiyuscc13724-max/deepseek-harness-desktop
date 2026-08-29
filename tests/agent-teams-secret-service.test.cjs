const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { createAgentTeamsSecretService, startAgentTeamsSecretService, ENDPOINT_ENV, TOKEN_ENV } = require('../electron/bridge/agent-teams-secret-service.cjs')

const capabilityUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'desktop-secret-capability.js')).href

function controlledProtector() {
  const key = randomBytes(32)
  return {
    async protect(plaintext) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
    },
    async unprotect(ciphertext) {
      const decipher = createDecipheriv('aes-256-gcm', key, ciphertext.subarray(0, 12))
      decipher.setAuthTag(ciphertext.subarray(12, 28))
      return Buffer.concat([decipher.update(ciphertext.subarray(28)), decipher.final()])
    }
  }
}

test('Host secret capability is one-time consumed, purpose-bound, restart-stable, and redacted', async () => {
  const service = createAgentTeamsSecretService({ protector: controlledProtector() })
  await service.start()
  try {
    const env = service.runtimeEnvironment({ SAFE: 'yes' })
    const { consumeDesktopSecretCapability } = await import(`${capabilityUrl}?ipc=${Date.now()}-${Math.random()}`)
    const capability = consumeDesktopSecretCapability({ env })
    assert.equal(env[ENDPOINT_ENV], undefined)
    assert.equal(env[TOKEN_ENV], undefined)
    assert.deepEqual(JSON.parse(JSON.stringify(capability)), { available: true })
    assert.equal(Object.keys(capability).includes('protect'), false)

    const secret = Buffer.from('private-marker-never-persisted', 'utf8')
    const sealed = await capability.protect(secret, { purpose: 'agent-teams/test/v1', binding: 'project_test' })
    assert.equal(sealed.includes(secret.toString('utf8')), false)
    const opened = await capability.unprotect(sealed, { purpose: 'agent-teams/test/v1', binding: 'project_test' })
    assert.equal(opened.toString('utf8'), secret.toString('utf8'))
    opened.fill(0)
    await assert.rejects(capability.unprotect(sealed, { purpose: 'agent-teams/test/v1', binding: 'project_other' }), error => error?.code === 'PROJECT_ENTRY_SECRET_INVALID')
    assert.equal(capability.dispose(), true)
    assert.equal(capability.dispose(), false)
    await assert.rejects(capability.protect(secret, { purpose: 'agent-teams/test/v1', binding: 'project_test' }), error => error?.code === 'PROJECT_ENTRY_SECRET_UNAVAILABLE')
    const restartedEnv = service.runtimeEnvironment({})
    const restartedCapability = consumeDesktopSecretCapability({ env: restartedEnv })
    const reopened = await restartedCapability.unprotect(sealed, { purpose: 'agent-teams/test/v1', binding: 'project_test' })
    assert.equal(reopened.toString('utf8'), secret.toString('utf8'))
    reopened.fill(0)
    restartedCapability.dispose()
    secret.fill(0)
  } finally { await service.close() }
})

test('safeStorage unavailable and secret service start failures do not block ordinary Runtime startup', async () => {
  const launchOrdinaryRuntime = async options => {
    const secretService = await startAgentTeamsSecretService(options)
    return { runtimeStarted: true, secretCapabilityAvailable: secretService !== null }
  }

  let createCalls = 0
  const unavailable = await launchOrdinaryRuntime({
    isEncryptionAvailable: () => false,
    createService: () => { createCalls += 1; throw new Error('must not run') }
  })
  assert.deepEqual(unavailable, { runtimeStarted: true, secretCapabilityAvailable: false })
  assert.equal(createCalls, 0)

  const availabilityThrows = await launchOrdinaryRuntime({
    isEncryptionAvailable: () => { throw new Error('platform keyring failure containing private-marker') },
    createService: () => { createCalls += 1 }
  })
  assert.deepEqual(availabilityThrows, { runtimeStarted: true, secretCapabilityAvailable: false })
  assert.equal(createCalls, 0)

  const creationThrows = await launchOrdinaryRuntime({
    isEncryptionAvailable: () => true,
    createService: () => { throw new Error('protector construction failed with private-marker') }
  })
  assert.deepEqual(creationThrows, { runtimeStarted: true, secretCapabilityAvailable: false })

  let closeCalls = 0
  const startFails = await launchOrdinaryRuntime({
    isEncryptionAvailable: () => true,
    createService: () => ({
      start: async () => { throw new Error('pipe start failed with private-marker') },
      close: async () => { closeCalls += 1 }
    })
  })
  assert.deepEqual(startFails, { runtimeStarted: true, secretCapabilityAvailable: false })
  assert.equal(closeCalls, 1, 'a partially created service is cleaned after start failure')
})

test('missing and forged Host capability references fail closed without fallback', async () => {
  const { consumeDesktopSecretCapability } = await import(`${capabilityUrl}?missing=${Date.now()}-${Math.random()}`)
  const missingEnv = {}
  const missing = consumeDesktopSecretCapability({ env: missingEnv })
  assert.equal(missing.available, false)
  await assert.rejects(missing.protect(Buffer.from('x'), { purpose: 'p', binding: 'b' }), error => error?.code === 'PROJECT_ENTRY_SECRET_UNAVAILABLE')

  const service = createAgentTeamsSecretService({ protector: controlledProtector() })
  await service.start()
  try {
    const forgedEnv = service.runtimeEnvironment({})
    forgedEnv[TOKEN_ENV] = randomBytes(32).toString('base64url')
    const forged = consumeDesktopSecretCapability({ env: forgedEnv })
    await assert.rejects(forged.protect(Buffer.from('x'), { purpose: 'p', binding: 'b' }), error => error?.code === 'PROJECT_ENTRY_SECRET_UNAVAILABLE')
  } finally { await service.close() }
})
