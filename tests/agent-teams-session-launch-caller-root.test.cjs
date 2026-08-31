const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { createHmac } = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-session-launch.js')).href
const methods = ['resolveProject', 'reserveAdoption', 'launch', 'reconcile', 'cancel', 'redeemAdoption']

function validProvider(overrides = {}) {
  return {
    callerRootRef: () => 'a'.repeat(64),
    ...Object.fromEntries(methods.map(method => [method, async () => ({})])),
    ...overrides,
  }
}

async function runtimeWith(provider) {
  const mod = await import(`${moduleUrl}?caller-root=${Date.now()}-${Math.random()}`)
  const directory = await mkdtemp(path.join(os.tmpdir(), 'session-launch-caller-root-'))
  const runtime = new mod.ProjectSessionLaunchRuntime({ filePath: path.join(directory, 'launch.json'), provider })
  await runtime.init()
  return { runtime, directory }
}

test('Desktop provider derives the exact lowercase 64-hex Host-compatible HMAC', async () => {
  const mod = await import(`${moduleUrl}?hmac=${Date.now()}-${Math.random()}`)
  const token = Buffer.alloc(32, 7).toString('base64url')
  const callerSalt = Buffer.alloc(32, 9).toString('base64url')
  const env = { [mod.ENDPOINT_ENV]: '/tmp/session-launch-caller-root.sock', [mod.TOKEN_ENV]: token, [mod.CALLER_SALT_ENV]: callerSalt }
  const connect = () => { throw new Error('no transport expected') }
  const provider = mod.consumeDesktopProjectSessionLaunchCapability({ env, connect, platform: 'linux' })
  const canonicalProjectKey = 'b'.repeat(64)
  const callerRootId = 'root-session'
  const expected = createHmac('sha256', Buffer.alloc(32, 9)).update(JSON.stringify(['agent-teams-caller-root-v1', canonicalProjectKey, callerRootId])).digest('hex')
  assert.match(expected, /^[a-f0-9]{64}$/u)
  assert.equal(provider.callerRootRef(canonicalProjectKey, callerRootId), expected)
  provider.dispose()
})

test('provider without callerRootRef fails closed before resolving a project', async () => {
  const provider = validProvider()
  delete provider.callerRootRef
  const { runtime, directory } = await runtimeWith(provider)
  try {
    assert.equal(runtime.safeState().available, false)
    await assert.rejects(
      () => runtime.preflight({}, { totalSessions: 2, projectBinding: { canonicalProjectKey: 'a'.repeat(64), workspacePath: '/workspace', callerRootId: 'root' } }),
      error => error.code === 'PROJECT_SESSION_LAUNCH_HOST_UNAVAILABLE' && error.message === 'Host project session launch capability is unavailable',
    )
  } finally {
    await runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('invalid callerRootRef output fails closed without leaking provider material', async () => {
  const secret = 'provider-secret-material'
  const { runtime, directory } = await runtimeWith(validProvider({ callerRootRef: () => secret }))
  try {
    await assert.rejects(
      () => runtime.preflight({}, { totalSessions: 2, projectBinding: { canonicalProjectKey: 'a'.repeat(64), workspacePath: '/workspace', callerRootId: 'root' } }),
      error => error.code === 'PROJECT_SESSION_LAUNCH_HOST_UNAVAILABLE' && !error.message.includes(secret) && !JSON.stringify(error).includes(secret),
    )
  } finally {
    await runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})
