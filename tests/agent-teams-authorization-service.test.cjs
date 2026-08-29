const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { createAgentTeamsAuthorizationService, startAgentTeamsAuthorizationService, ENDPOINT_ENV, TOKEN_ENV } = require('../electron/bridge/agent-teams-authorization-service.cjs')

const capabilityUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'desktop-authorization-capability.js')).href
const pluginUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href
function request(authorizationId = 'authorization-1', overrides = {}) {
  const value = {
    authorizationId,
    tool: 'team_task_external_effect',
    rootSessionId: 'root-1',
    turnKey: 'a'.repeat(64),
    teamId: 'team-1',
    taskId: 'task-1',
    effectName: 'publish-once',
    attemptId: 'attempt-1',
    outcome: 'not_started',
    pauseEpoch: 0,
    teamRevision: 7,
    ...overrides
  }
  value.canonicalArgumentsHash = overrides.canonicalArgumentsHash ?? createHash('sha256').update(JSON.stringify({ action: 'resolve_unknown', team_id: value.teamId, task_id: value.taskId, effect_name: value.effectName, attempt_id: value.attemptId, outcome: value.outcome })).digest('hex')
  return value
}
async function capabilityFor(service, suffix = '') {
  const { consumeDesktopAuthorizationCapability } = await import(`${capabilityUrl}?test=${Date.now()}-${Math.random()}-${suffix}`)
  const env = service.runtimeEnvironment({ SAFE: 'yes' })
  const capability = consumeDesktopAuthorizationCapability({ env, timeoutMs: 2_000 })
  assert.equal(env[ENDPOINT_ENV], undefined)
  assert.equal(env[TOKEN_ENV], undefined)
  return capability
}

test('native Host confirmation issues one exact short-lived receipt and persists single consumption across restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-host-authorization-'))
  const stateFile = path.join(root, 'authorizations.json')
  let prompts = 0
  const dialogs = []
  const create = () => createAgentTeamsAuthorizationService({
    stateFile,
    now: () => 1_800_000_000_000,
    showMessageBox: async options => { prompts += 1; dialogs.push(options); return { response: 0 } }
  })
  let service = create()
  await service.start()
  try {
    const capability = await capabilityFor(service)
    const value = request('durable-once')
    const [receipt, duplicate] = await Promise.allSettled([capability.consumeResolveUnknown(value), capability.consumeResolveUnknown(value)])
    assert.equal(receipt.status, 'fulfilled')
    assert.equal(duplicate.status, 'rejected')
    assert.equal(duplicate.reason.code, 'AGENT_TEAMS_HOST_AUTHORIZATION_REPLAY')
    assert.equal(prompts, 1, 'concurrent duplicate must not display two confirmations')
    assert.deepEqual(Object.fromEntries(Object.keys(value).map(key => [key, receipt.value[key]])), value)
    assert.equal(receipt.value.expiresAt, 1_800_000_060_000)
    assert.match(dialogs[0].detail, /team-1[\s\S]*task-1[\s\S]*publish-once[\s\S]*attempt-1[\s\S]*not_started/u)
    assert.equal(JSON.stringify(dialogs[0]).includes('canonicalArgumentsHash'), false)
    capability.dispose()
  } finally { await service.close() }

  const durable = JSON.parse(await readFile(stateFile, 'utf8'))
  assert.equal(durable.consumed.length, 1)
  assert.equal(JSON.stringify(durable).includes(TOKEN_ENV), false)
  service = create()
  await service.start()
  try {
    const restarted = await capabilityFor(service, 'restart')
    await assert.rejects(restarted.consumeResolveUnknown(request('durable-once')), error => error?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_REPLAY')
    assert.equal(prompts, 1, 'restart replay is rejected before showing a dialog')
    restarted.dispose()
  } finally { await service.close(); await rm(root, { recursive: true, force: true }) }
})

test('two Host service instances serialize through a wx lock and only one confirms the same authorization id', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-host-multi-instance-'))
  const stateFile = path.join(root, 'state.json')
  let prompts = 0
  const options = { stateFile, lockRetryMs: 2, showMessageBox: async () => { prompts += 1; await new Promise(resolve => setTimeout(resolve, 25)); return { response: 0 } } }
  const first = createAgentTeamsAuthorizationService(options)
  const second = createAgentTeamsAuthorizationService(options)
  await Promise.all([first.start(), second.start()])
  try {
    const [left, right] = await Promise.all([capabilityFor(first, 'multi-a'), capabilityFor(second, 'multi-b')])
    const results = await Promise.allSettled([left.consumeResolveUnknown(request('cross-instance-once')), right.consumeResolveUnknown(request('cross-instance-once'))])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_REPLAY').length, 1)
    assert.equal(prompts, 1, 'the lock-held re-read rejects the second instance before native UI')
    left.dispose(); right.dispose()
  } finally { await Promise.all([first.close(), second.close()]); await rm(root, { recursive: true, force: true }) }
})

test('authorization capacity fails closed without evicting old ids and restart preserves replay denial', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-host-capacity-'))
  const stateFile = path.join(root, 'state.json')
  let prompts = 0
  const create = () => createAgentTeamsAuthorizationService({ stateFile, maxConsumed: 2, showMessageBox: async () => { prompts += 1; return { response: 0 } } })
  let service = create()
  await service.start()
  try {
    const capability = await capabilityFor(service, 'capacity')
    await capability.consumeResolveUnknown(request('capacity-1'))
    await capability.consumeResolveUnknown(request('capacity-2'))
    await assert.rejects(capability.consumeResolveUnknown(request('capacity-3')), error => error?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_CAPACITY')
    assert.equal(prompts, 2, 'capacity is rejected before native UI')
    capability.dispose()
  } finally { await service.close() }
  const state = JSON.parse(await readFile(stateFile, 'utf8'))
  assert.deepEqual(state.consumed.map(row => row.authorizationId), ['capacity-1', 'capacity-2'])

  service = create()
  await service.start()
  try {
    const restarted = await capabilityFor(service, 'capacity-restart')
    await assert.rejects(restarted.consumeResolveUnknown(request('capacity-1')), error => error?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_REPLAY')
    await assert.rejects(restarted.consumeResolveUnknown(request('capacity-new')), error => error?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_CAPACITY')
    assert.equal(prompts, 2)
    restarted.dispose()
  } finally { await service.close(); await rm(root, { recursive: true, force: true }) }
})

test('Agent Teams defaults to the Desktop Host capability while an explicit ctx provider remains injectable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-default-host-provider-'))
  const service = createAgentTeamsAuthorizationService({ stateFile: path.join(root, 'state.json'), showMessageBox: async () => ({ response: 0 }) })
  await service.start()
  try {
    Object.assign(process.env, service.runtimeEnvironment({}))
    const mod = await import(`${pluginUrl}?provider=${Date.now()}-${Math.random()}`)
    let explicitCalls = 0
    const explicit = { consumeResolveUnknown: async value => { explicitCalls += 1; return { ...value, expiresAt: Date.now() + 1_000 } } }
    const provider = mod.resolveAgentTeamsAuthorizationProvider({ get: name => name === 'agentTeamsAuthorization' ? explicit : undefined })
    assert.equal(provider.available, true)
    const receipt = await provider.consumeResolveUnknown(request('default-desktop-provider'))
    assert.equal(receipt.authorizationId, 'default-desktop-provider')
    assert.equal(explicitCalls, 0, 'a ctx service cannot override an available Desktop Host capability')
    assert.equal(process.env[ENDPOINT_ENV], undefined)
    assert.equal(process.env[TOKEN_ENV], undefined)
    provider.dispose()

    const selected = mod.resolveAgentTeamsAuthorizationProvider({ get: name => name === 'agentTeamsAuthorization' ? explicit : undefined })
    await selected.consumeResolveUnknown(request('explicit-provider'))
    assert.equal(explicitCalls, 1)
  } finally {
    delete process.env[ENDPOINT_ENV]
    delete process.env[TOKEN_ENV]
    await service.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('cancel, timeout, schema replacement, forged capability, and service errors fail closed without leaking details', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-host-denial-'))
  const stateFile = path.join(root, 'authorizations.json')
  let prompts = 0
  const service = createAgentTeamsAuthorizationService({
    stateFile,
    dialogTimeoutMs: 10,
    showMessageBox: async options => {
      prompts += 1
      if (options.detail.includes('timeout-effect')) return new Promise(() => {})
      if (options.detail.includes('throw-effect')) throw new Error('private-marker-from-dialog')
      return { response: 1 }
    }
  })
  await service.start()
  try {
    const capability = await capabilityFor(service)
    await assert.rejects(capability.consumeResolveUnknown(request('cancel')), error => error?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_DENIED' && !error.message.includes('private-marker'))
    await assert.rejects(capability.consumeResolveUnknown(request('timeout', { effectName: 'timeout-effect' })), error => error?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_DENIED')
    await assert.rejects(capability.consumeResolveUnknown(request('throw', { effectName: 'throw-effect' })), error => error?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_UNAVAILABLE' && !error.message.includes('private-marker'))
    const beforeInvalid = prompts
    const bindingSwap = request('binding-swap')
    bindingSwap.taskId = 'task-2'
    await assert.rejects(capability.consumeResolveUnknown(bindingSwap), error => error?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_INVALID')
    await assert.rejects(capability.consumeResolveUnknown({ ...request('swap'), outcome: 'forged', extra: true }), error => error?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_INVALID')
    assert.equal(prompts, beforeInvalid, 'invalid or replaced parameters are rejected before native UI')
    capability.dispose()

    const forgedEnv = service.runtimeEnvironment({})
    forgedEnv[TOKEN_ENV] = Buffer.alloc(32, 7).toString('base64url')
    const { consumeDesktopAuthorizationCapability } = await import(`${capabilityUrl}?forged=${Date.now()}`)
    const forged = consumeDesktopAuthorizationCapability({ env: forgedEnv, timeoutMs: 1_000 })
    await assert.rejects(forged.consumeResolveUnknown(request('forged-token')), error => error?.code === 'AGENT_TEAMS_HOST_AUTHORIZATION_UNAVAILABLE')
  } finally { await service.close(); await rm(root, { recursive: true, force: true }) }
})

test('authorization bridge start failure is fail-soft for ordinary Runtime and cleans partial service', async () => {
  let closed = 0
  const service = await startAgentTeamsAuthorizationService({
    createService: () => ({ start: async () => { throw new Error('private-marker-pipe-failure') }, close: async () => { closed += 1 } })
  })
  const runtime = { started: true, authorizationAvailable: service !== null }
  assert.deepEqual(runtime, { started: true, authorizationAvailable: false })
  assert.equal(closed, 1)
})
