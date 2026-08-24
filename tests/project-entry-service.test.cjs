const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHmac, generateKeyPairSync } = require('node:crypto')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { once } = require('node:events')
const { inspect } = require('node:util')
const WebSocket = require('ws')
const { createHealthServer, createRelayRouter } = require('../services/wss-relay/server.cjs')

const serviceUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-entry-service.js')).href
const taskStoreUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')).href
const taskServiceUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-service.js')).href

async function pairCollaborator(authority, collaborator, { displayName = 'Sync Peer', role = 'contributor' } = {}) {
  const invite = await authority.createInvite({ displayName, role })
  const request = await collaborator.createJoinRequest({ inviteCode: invite.inviteCode, displayName })
  const approval = await authority.approveJoinRequest({ joinRequest: request.joinRequest })
  await collaborator.completeJoinRequest({ joinResponse: approval.joinResponse })
  return approval
}

async function usingService(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-entry-'))
  let now = 80_000_000
  const { ProjectEntryService } = await import(`${serviceUrl}?test=${Date.now()}-${Math.random()}`)
  const service = new ProjectEntryService({ dshHome: root, now: () => now })
  try {
    await run({ root, service, setNow: value => { now = value }, ProjectEntryService })
  } finally {
    await service.close()
    await rm(root, { recursive: true, force: true })
  }
}

async function waitFor(predicate, { timeoutMs = 10_000, intervalMs = 20, message = 'condition was not satisfied within the wait window' } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${message}`)
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

test('project entry reports honest LAN and remote capability before project creation', async () => usingService(async ({ service }) => {
  const status = await service.status()
  assert.equal(status.project, null)
  assert.deepEqual(status.lan, { connected: false, reconnecting: false, listening: false, connectionCount: 0 })
  assert.equal(status.relay.enabled, false)
  assert.equal(status.relay.connected, false)
  assert.equal(status.relay.channelReady, false)
}))

test('project creation persists one owner and reopens without exposing private material in status', async () => usingService(async ({ root, service, ProjectEntryService }) => {
  const created = await service.createProject({ projectName: 'Private Release', displayName: 'Owner' })
  assert.equal(created.existing, false)
  assert.match(created.status.project.projectRef, /^project_[A-Za-z0-9_-]{20,64}$/u)
  assert.equal(created.status.project.memberCount, 1)
  assert.equal(created.status.project.revision, 2)
  assert.equal(created.status.project.ownerDisplayName, 'Owner')
  assert.equal(JSON.stringify(created.status).includes('Private Release'), false)
  assert.equal(JSON.stringify(created.status).includes('PrivateKey'), false)

  const duplicate = await service.createProject({ projectName: 'Ignored', displayName: 'Ignored' })
  assert.equal(duplicate.existing, true)
  assert.equal(duplicate.status.project.projectRef, created.status.project.projectRef)

  const reopened = new ProjectEntryService({ dshHome: root, now: () => 80_000_000 })
  try {
    const restored = await reopened.status()
    assert.equal(restored.project.projectRef, created.status.project.projectRef)
    assert.equal(restored.project.memberCount, 1)
    assert.equal(restored.project.ownerDisplayName, 'Owner')
  } finally {
    await reopened.close()
  }

  const device = JSON.parse(await readFile(path.join(root, 'storages', 'agent_project_device.json'), 'utf8'))
  assert.match(device.device.signingPrivateKey, /^[A-Za-z0-9_-]+$/u)
  assert.match(device.device.encryptionPrivateKey, /^[A-Za-z0-9_-]+$/u)
  assert.equal(JSON.stringify(device).includes('Private Release'), false)
}))

test('Host-only project task context binds execution identity, actor resolution, storage, and derived key', async () => usingService(async ({ root, service }) => {
  const created = await service.createProject({ projectName: 'Task Context', displayName: 'Owner' })
  const context = await service.localProjectTaskContext()
  assert.equal(context.projectRef, created.status.project.projectRef)
  assert.equal(context.databasePath, path.join(root, 'storages', 'agent_project_tasks.sqlite'))
  assert.equal(Object.isFrozen(context), true)
  assert.equal(Object.isFrozen(context.execution), true)
  assert.deepEqual(Object.keys(context.execution), [])
  assert.equal(typeof context.actorResolver, 'function')
  assert.equal(typeof context.keyProvider, 'function')

  const actor = context.actorResolver(context.execution, context.projectRef)
  assert.equal(actor.projectRef, context.projectRef)
  assert.match(actor.actorRef, /^collaborator_[A-Za-z0-9_-]{20,64}$/u)
  assert.deepEqual({ kind: actor.kind, role: actor.role }, { kind: 'human', role: 'owner' })
  assert.equal(Object.isFrozen(actor), true)
  assert.throws(() => context.actorResolver({}, context.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => context.actorResolver(context.execution, 'project_AAAAAAAAAAAAAAAAAAAAAAAA'), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => context.keyProvider('project_AAAAAAAAAAAAAAAAAAAAAAAA'), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')

  const first = context.keyProvider(context.projectRef)
  const expected = Buffer.from(first)
  assert.equal(Buffer.isBuffer(first), true)
  assert.equal(first.length, 32)
  first.fill(0)
  const second = context.keyProvider(context.projectRef)
  assert.deepEqual(second, expected, 'callers receive an independent key copy')
  assert.notStrictEqual(first, second)

  const { ProjectTaskStore } = await import(taskStoreUrl)
  const { ProjectTaskCommandService } = await import(taskServiceUrl)
  const store = new ProjectTaskStore({ filePath: context.databasePath, keyProvider: context.keyProvider })
  store.initialize()
  try {
    const commands = new ProjectTaskCommandService({ store, actorResolver: context.actorResolver, now: () => 80_000_001 })
    const command = {
      projectRef: context.projectRef,
      taskRef: 'task_context_integration',
      commandId: 'command_context_integration_create',
      eventRef: 'event_context_integration_create',
      type: 'create',
      expectedRevision: 0,
      payload: { title: 'Context-backed task', requirements: { acceptance: 'direct wiring works' }, fileScope: ['src/context.js'] },
    }
    const createdTask = commands.executeCommand(context.execution, command)
    assert.equal(createdTask.task.title, 'Context-backed task')
    assert.equal(createdTask.task.ownerActorRef, actor.actorRef)
    assert.deepEqual(store.getTask({ projectRef: context.projectRef, taskRef: command.taskRef }), createdTask.task)
  } finally {
    store.close()
  }

  const publicJson = JSON.stringify(await service.status())
  const contextJson = JSON.stringify(context)
  for (const forbidden of ['actorRef', 'execution', 'keyProvider', 'dispose', 'encryptionKey', 'signingPrivateKey', 'encryptionPrivateKey']) {
    assert.equal(publicJson.includes(forbidden), false, `public status leaked ${forbidden}`)
    assert.equal(contextJson.includes(forbidden), false, `serialized Host context leaked ${forbidden}`)
  }

  const disposable = await service.localProjectTaskContext()
  assert.equal(disposable.keyProvider(disposable.projectRef).length, 32)
  assert.equal(disposable.dispose(), true)
  assert.equal(disposable.dispose(), false)
  assert.throws(() => disposable.actorResolver(disposable.execution, disposable.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => disposable.keyProvider(disposable.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')

  const nextMemberKey = generateKeyPairSync('ed25519')
  const invite = await service.createInvite({ displayName: 'Contributor', role: 'contributor' })
  await service.redeemInvite({ inviteCode: invite.inviteCode, displayName: 'Contributor', publicKey: nextMemberKey.publicKey })
  assert.throws(() => context.actorResolver(context.execution, context.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID', 'authority revision changes invalidate old execution capabilities')
  assert.throws(() => context.keyProvider(context.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
}))

test('Host-only project Automation context is redacted, independently keyed, and authority-bound', async () => usingService(async ({ root, service }) => {
  const created = await service.createProject({ projectName: 'Automation Context', displayName: 'Owner' })
  const task = await service.localProjectTaskContext()
  const automation = await service.localProjectAutomationContext()
  assert.deepEqual(Object.keys(automation), ['projectRef', 'filePath'])
  assert.equal(automation.projectRef, created.status.project.projectRef)
  assert.equal(automation.filePath, path.join(root, 'storages', 'agent_project_automation.enc.json'))
  assert.equal(Object.isFrozen(automation), true)
  assert.equal(Object.isFrozen(automation.execution), true)
  assert.deepEqual(Object.keys(automation.execution), [])
  const actor = automation.actorResolver(automation.execution, automation.projectRef)
  assert.deepEqual({ kind: actor.kind, role: actor.role, projectRef: actor.projectRef }, { kind: 'human', role: 'owner', projectRef: automation.projectRef })
  assert.throws(() => automation.actorResolver({}, automation.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => automation.actorResolver(automation.execution, 'project_wrong'), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => automation.keyProvider('project_wrong'), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')

  const taskKey = task.keyProvider(task.projectRef)
  const first = automation.keyProvider(automation.projectRef)
  const expected = Buffer.from(first)
  assert.equal(first.length, 32)
  assert.notDeepEqual(first, taskKey, 'task and Automation keys use independent HMAC domains')
  const chainedGuess = createHmac('sha256', taskKey).update('dsh/project-automation-store/v1').update('\0').update(automation.projectRef).digest()
  assert.notDeepEqual(chainedGuess, first, 'knowing the task key cannot reconstruct the Automation key')
  first.fill(0)
  const second = automation.keyProvider(automation.projectRef)
  assert.deepEqual(second, expected)
  assert.notStrictEqual(first, second)
  for (const forbidden of ['actorRef', 'execution', 'keyProvider', 'dispose', 'encryptionKey', 'taskKey', 'automationKey']) assert.equal(JSON.stringify(automation).includes(forbidden), false)

  assert.equal(automation.dispose(), true)
  assert.equal(automation.dispose(), false)
  assert.throws(() => automation.actorResolver(automation.execution, automation.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => automation.keyProvider(automation.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')

  const stale = await service.localProjectAutomationContext()
  const nextMemberKey = generateKeyPairSync('ed25519')
  const invite = await service.createInvite({ displayName: 'Contributor', role: 'contributor' })
  await service.redeemInvite({ inviteCode: invite.inviteCode, displayName: 'Contributor', publicKey: nextMemberKey.publicKey })
  assert.throws(() => stale.actorResolver(stale.execution, stale.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => stale.keyProvider(stale.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.equal(stale.dispose(), true)
  task.dispose()
}))

test('Host-only foundations context derives five isolated keys and exposes only projectRef', async () => usingService(async ({ root, service, ProjectEntryService }) => {
  const created = await service.createProject({ projectName: 'Foundations Context', displayName: 'Owner' })
  const task = await service.localProjectTaskContext()
  const automation = await service.localProjectAutomationContext()
  const context = await service.localProjectFoundationsContext()
  const domains = [
    'dsh/project-workspace/v1',
    'dsh/project-cas/v1',
    'dsh/project-quality/v1',
    'dsh/project-defect/v1',
    'dsh/project-defect-outbox/v1'
  ]
  assert.equal(context.projectRef, created.status.project.projectRef)
  assert.deepEqual(Object.keys(context), ['projectRef'])
  assert.deepEqual(JSON.parse(JSON.stringify(context)), { projectRef: context.projectRef })
  assert.equal(inspect(context), `{ projectRef: '${context.projectRef}' }`)
  assert.equal(Object.isFrozen(context), true)
  assert.equal(Object.isFrozen(context.execution), true)

  const foundationsRoot = path.join(root, 'storages', 'agent_project_foundations')
  assert.equal(context.foundationsRoot, foundationsRoot)
  const expectedPaths = {
    workspaceStatePath: path.join(foundationsRoot, 'workspace-authority.enc.json'),
    authorityRoot: path.join(foundationsRoot, 'git-authority'),
    worktreeRoot: path.join(foundationsRoot, 'worktrees'),
    casObjectRoot: path.join(foundationsRoot, 'cas', 'objects'),
    casStagingRoot: path.join(foundationsRoot, 'cas', 'staging'),
    qualityStatePath: path.join(foundationsRoot, 'quality-orchestrator.enc.json'),
    defectStatePath: path.join(foundationsRoot, 'defect-lifecycle.enc.json'),
    outboxStatePath: path.join(foundationsRoot, 'defect-outbox.enc.json')
  }
  for (const [name, expectedPath] of Object.entries(expectedPaths)) {
    assert.equal(context[name], expectedPath)
    assert.equal(Object.getOwnPropertyDescriptor(context, name).enumerable, false)
    assert.equal(path.relative(foundationsRoot, expectedPath).startsWith('..'), false)
    assert.equal(JSON.stringify(context).includes(expectedPath), false)
    assert.equal(inspect(context).includes(expectedPath), false)
  }
  assert.equal(new Set(Object.values(expectedPaths)).size, Object.keys(expectedPaths).length)

  const taskKey = task.keyProvider(task.projectRef)
  const automationKey = automation.keyProvider(automation.projectRef)
  const keys = domains.map(domain => context.keyProvider(domain, context.projectRef))
  assert.equal(new Set(keys.map(key => key.toString('base64url'))).size, 5)
  for (const key of keys) {
    assert.equal(key.length, 32)
    assert.notDeepEqual(key, taskKey)
    assert.notDeepEqual(key, automationKey)
  }
  const saved = Buffer.from(keys[0])
  keys[0].fill(0)
  assert.deepEqual(context.keyProvider(domains[0], context.projectRef), saved, 'foundation callers receive key copies')
  assert.throws(() => context.keyProvider('dsh/project-unknown/v1', context.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => context.keyProvider(domains[0], 'project_wrong'), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => context.actorResolver({}, context.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')

  const realRoot = path.normalize(root)
  const firstRepositoryRef = context.repositoryRefFor(realRoot)
  const workspaceKey = context.keyProvider(domains[0], context.projectRef)
  const expectedRepositoryDigest = createHmac('sha256', workspaceKey).update(realRoot).update('\0').update(context.projectRef).digest()
  assert.equal(firstRepositoryRef, `repository_${expectedRepositoryDigest.toString('base64url')}`, 'repository identity uses the exact real root and projectRef')
  workspaceKey.fill(0)
  expectedRepositoryDigest.fill(0)
  assert.match(firstRepositoryRef, /^repository_[A-Za-z0-9_-]{43}$/u)
  assert.equal(context.repositoryRefFor(realRoot), firstRepositoryRef)
  assert.notEqual(context.repositoryRefFor(path.normalize(path.join(root, 'other-repository'))), firstRepositoryRef)
  assert.equal(firstRepositoryRef.includes(root), false)
  assert.throws(() => context.repositoryRefFor('relative/repository'), /normalized absolute path/)
  assert.throws(() => context.repositoryRefFor(` ${realRoot}`), /normalized absolute path/)

  const secondHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-foundation-binding-'))
  const secondService = new ProjectEntryService({ dshHome: secondHome, now: () => 80_000_000 })
  try {
    await secondService.createProject({ projectName: 'Other Foundations', displayName: 'Owner' })
    const secondContext = await secondService.localProjectFoundationsContext()
    assert.notEqual(secondContext.repositoryRefFor(realRoot), firstRepositoryRef, 'repository refs bind the project and workspace key')
    secondContext.dispose()
  } finally {
    await secondService.close()
    await rm(secondHome, { recursive: true, force: true })
  }
  context.dispose()
  automation.dispose()
  task.dispose()
}))

test('foundations dispose and Entry close zero every retained key and invalidate all closures', async () => usingService(async ({ service }) => {
  await service.createProject({ projectName: 'Foundations Zeroization', displayName: 'Owner' })
  const before = new Set(service.taskContextKeys)
  const disposable = await service.localProjectFoundationsContext()
  const retained = [...service.taskContextKeys].filter(key => !before.has(key))
  assert.equal(retained.length, 6, 'five foundation keys plus the delegated task authority key are tracked')
  assert.equal(retained.every(key => key.some(byte => byte !== 0)), true)
  assert.equal(disposable.dispose(), true)
  assert.equal(disposable.dispose(), false)
  assert.equal(retained.every(key => key.every(byte => byte === 0)), true)
  assert.throws(() => disposable.keyProvider('dsh/project-workspace/v1', disposable.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => disposable.repositoryRefFor(path.resolve('.')), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')

  const closingContext = await service.localProjectFoundationsContext()
  const closingKeys = [...service.taskContextKeys]
  const closing = service.close()
  assert.throws(() => closingContext.keyProvider('dsh/project-workspace/v1', closingContext.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.equal(closingKeys.every(key => key.every(byte => byte === 0)), true)
  await closing
  assert.equal(service.close(), closing)
  assert.equal(closingContext.dispose(), true)
  assert.equal(closingContext.dispose(), false)
}))

test('foundations authority revision and close races fail closed before capability publication', async () => usingService(async ({ service }) => {
  await service.createProject({ projectName: 'Foundations Stale', displayName: 'Owner' })
  const stale = await service.localProjectFoundationsContext()
  const memberKey = generateKeyPairSync('ed25519')
  const invite = await service.createInvite({ displayName: 'Contributor', role: 'contributor' })
  await service.redeemInvite({ inviteCode: invite.inviteCode, displayName: 'Contributor', publicKey: memberKey.publicKey })
  assert.throws(() => stale.keyProvider('dsh/project-workspace/v1', stale.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => stale.repositoryRefFor(path.resolve('.')), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  stale.dispose()

  const pending = service.localProjectFoundationsContext()
  const closing = service.close()
  await assert.rejects(pending, error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  await closing
}))

test('business sync contexts keep authority and collaborator keys local, stable, isolated, and redacted', async () => usingService(async ({ root, service, ProjectEntryService }) => {
  await service.createProject({ projectName: 'Business Sync', displayName: 'Owner' })
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-sync-collaborator-'))
  let collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
  try {
    const approval = await pairCollaborator(service, collaborator)
    const decodedApproval = JSON.parse(Buffer.from(approval.joinResponse.slice('joinack_'.length), 'base64url').toString('utf8'))
    assert.equal(JSON.stringify(decodedApproval).includes('syncCacheKey'), false)

    const task = await service.localProjectTaskContext()
    const automation = await service.localProjectAutomationContext()
    const foundations = await service.localProjectFoundationsContext()
    const authority = await service.localProjectBusinessSyncContext()
    const remote = await collaborator.localProjectBusinessSyncContext()
    assert.deepEqual(Object.keys(authority), ['projectRef', 'mode'])
    assert.deepEqual(Object.keys(remote), ['projectRef', 'mode'])
    assert.deepEqual(JSON.parse(JSON.stringify(authority)), { projectRef: authority.projectRef, mode: 'authority' })
    assert.deepEqual(JSON.parse(JSON.stringify(remote)), { projectRef: remote.projectRef, mode: 'collaborator' })
    assert.equal(authority.filePath, path.join(root, 'storages', 'agent_project_business_sync.enc.json'))
    assert.equal(remote.filePath, path.join(collaboratorHome, 'storages', 'agent_project_business_sync.enc.json'))
    for (const name of ['authorityEpoch', 'localDeviceRef', 'filePath', 'execution', 'keyProvider', 'peerResolver', 'peerDeviceRefs', 'dispose']) {
      assert.equal(Object.getOwnPropertyDescriptor(authority, name).enumerable, false)
      assert.equal(JSON.stringify(authority).includes(name), false)
      assert.equal(inspect(authority).includes(authority.filePath), false)
    }

    const authorityKey = authority.keyProvider(authority.projectRef)
    const remoteKey = remote.keyProvider(remote.projectRef)
    const neighboringKeys = [
      task.keyProvider(task.projectRef),
      automation.keyProvider(automation.projectRef),
      ...['dsh/project-workspace/v1', 'dsh/project-cas/v1', 'dsh/project-quality/v1', 'dsh/project-defect/v1', 'dsh/project-defect-outbox/v1'].map(domain => foundations.keyProvider(domain, foundations.projectRef))
    ]
    assert.equal(authorityKey.length, 32)
    assert.equal(remoteKey.length, 32)
    assert.notDeepEqual(authorityKey, remoteKey, 'collaborator cache key is never the authority DB key')
    for (const other of neighboringKeys) assert.notDeepEqual(authorityKey, other)
    const authorityCopy = Buffer.from(authorityKey)
    authorityKey.fill(0)
    assert.deepEqual(authority.keyProvider(authority.projectRef), authorityCopy)
    assert.throws(() => authority.keyProvider('project_wrong'), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')

    const trustedCollaborator = await authority.peerResolver({ senderDeviceRef: remote.localDeviceRef, authorityEpoch: authority.authorityEpoch })
    assert.deepEqual({ deviceRef: trustedCollaborator.deviceRef, role: trustedCollaborator.role }, { deviceRef: remote.localDeviceRef, role: 'contributor' })
    assert.equal(Object.isFrozen(trustedCollaborator), true)
    assert.equal(Object.isFrozen(trustedCollaborator.permissions), true)
    const trustedAuthority = await remote.peerResolver({ senderDeviceRef: authority.localDeviceRef, authorityEpoch: remote.authorityEpoch })
    assert.deepEqual({ deviceRef: trustedAuthority.deviceRef, role: trustedAuthority.role }, { deviceRef: authority.localDeviceRef, role: 'owner' })
    const authorityPeerRefs = await authority.peerDeviceRefs()
    const remotePeerRefs = await remote.peerDeviceRefs()
    assert.deepEqual(authorityPeerRefs, [remote.localDeviceRef])
    assert.deepEqual(remotePeerRefs, [authority.localDeviceRef])
    assert.equal(Object.isFrozen(authorityPeerRefs), true)
    assert.equal(Object.isFrozen(remotePeerRefs), true)
    assert.notStrictEqual(await authority.peerDeviceRefs(), authorityPeerRefs, 'each fresh read returns a frozen copy')
    assert.equal(JSON.stringify(authority).includes('peerDeviceRefs'), false)
    assert.equal(JSON.stringify(await service.status()).includes('peerDeviceRefs'), false)

    const authorityDevice = JSON.parse(await readFile(path.join(root, 'storages', 'agent_project_device.json'), 'utf8'))
    const collaboratorDevice = JSON.parse(await readFile(path.join(collaboratorHome, 'storages', 'agent_project_device.json'), 'utf8'))
    assert.equal(authorityDevice.syncCacheKey, undefined)
    const rawProjectKey = Buffer.from(authorityDevice.encryptionKey, 'base64url')
    const exactAuthorityKey = createHmac('sha256', rawProjectKey).update('dsh/project-business-sync/v1').update('\0').update(authority.projectRef).digest()
    assert.deepEqual(authority.keyProvider(authority.projectRef), exactAuthorityKey)
    rawProjectKey.fill(0); exactAuthorityKey.fill(0)
    assert.match(collaboratorDevice.syncCacheKey, /^[A-Za-z0-9_-]{43}$/u)
    assert.equal(collaboratorDevice.syncCacheKey, remoteKey.toString('base64url'))
    assert.equal(JSON.stringify(await service.status()).includes('syncCacheKey'), false)
    assert.equal(JSON.stringify(await collaborator.status()).includes('syncCacheKey'), false)

    const stableAuthority = Buffer.from(authority.keyProvider(authority.projectRef))
    const stableRemote = Buffer.from(remote.keyProvider(remote.projectRef))
    authority.dispose(); remote.dispose(); foundations.dispose(); automation.dispose(); task.dispose()
    await collaborator.close()
    collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
    const reopenedRemote = await collaborator.localProjectBusinessSyncContext()
    assert.deepEqual(reopenedRemote.keyProvider(reopenedRemote.projectRef), stableRemote)
    reopenedRemote.dispose()
    const reopenedAuthorityService = new ProjectEntryService({ dshHome: root, now: () => 80_000_000 })
    try {
      const reopenedAuthority = await reopenedAuthorityService.localProjectBusinessSyncContext()
      assert.deepEqual(reopenedAuthority.keyProvider(reopenedAuthority.projectRef), stableAuthority)
      reopenedAuthority.dispose()
    } finally { await reopenedAuthorityService.close() }
    stableAuthority.fill(0); stableRemote.fill(0); authorityCopy.fill(0); remoteKey.fill(0)
    for (const key of neighboringKeys) key.fill(0)
  } finally {
    await collaborator.close()
    await rm(collaboratorHome, { recursive: true, force: true })
  }
}))

test('legacy collaborator sync cache migrates once and forged opened metadata fails before member lookup', async () => usingService(async ({ service, ProjectEntryService }) => {
  await service.createProject({ projectName: 'Business Sync Migration', displayName: 'Owner' })
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-sync-migration-'))
  let collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
  try {
    await pairCollaborator(service, collaborator)
    await collaborator.close()
    const deviceFile = path.join(collaboratorHome, 'storages', 'agent_project_device.json')
    const legacy = JSON.parse(await readFile(deviceFile, 'utf8'))
    delete legacy.syncCacheKey
    await writeFile(deviceFile, `${JSON.stringify(legacy)}\n`)
    collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
    const first = await collaborator.localProjectBusinessSyncContext()
    const migrated = JSON.parse(await readFile(deviceFile, 'utf8'))
    assert.match(migrated.syncCacheKey, /^[A-Za-z0-9_-]{43}$/u)
    const firstKey = first.keyProvider(first.projectRef)
    first.dispose()
    const second = await collaborator.localProjectBusinessSyncContext()
    assert.deepEqual(second.keyProvider(second.projectRef), firstKey)

    const authority = await service.localProjectBusinessSyncContext()
    const originalRead = service.persisted.read.bind(service.persisted)
    let memberReads = 0
    service.persisted.read = (...args) => { memberReads += 1; return originalRead(...args) }
    await assert.rejects(authority.peerResolver({ senderDeviceRef: second.localDeviceRef, authorityEpoch: authority.authorityEpoch, role: 'owner' }), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
    assert.equal(memberReads, 0)
    let getterRuns = 0
    const accessor = { authorityEpoch: authority.authorityEpoch }
    Object.defineProperty(accessor, 'senderDeviceRef', { enumerable: true, get() { getterRuns += 1; return second.localDeviceRef } })
    await assert.rejects(authority.peerResolver(accessor), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
    assert.equal(getterRuns, 0)
    assert.equal(memberReads, 0)
    await assert.rejects(authority.peerResolver({ senderDeviceRef: 'device_unknown', authorityEpoch: authority.authorityEpoch }), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
    await assert.rejects(authority.peerResolver({ senderDeviceRef: second.localDeviceRef, authorityEpoch: authority.authorityEpoch + 1 }), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
    authority.dispose(); second.dispose(); firstKey.fill(0)

    await collaborator.close()
    const wrongRolePeer = JSON.parse(await readFile(deviceFile, 'utf8'))
    wrongRolePeer.peers[0].role = 'reviewer'
    await writeFile(deviceFile, `${JSON.stringify(wrongRolePeer)}\n`)
    collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
    const wrongRoleContext = await collaborator.localProjectBusinessSyncContext()
    assert.deepEqual(await wrongRoleContext.peerDeviceRefs(), [])
    await assert.rejects(wrongRoleContext.peerResolver({ senderDeviceRef: wrongRolePeer.peers[0].deviceRef, authorityEpoch: wrongRoleContext.authorityEpoch }), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
    wrongRoleContext.dispose()
  } finally {
    await collaborator.close()
    await rm(collaboratorHome, { recursive: true, force: true })
  }
}))

test('business sync contexts fail closed on grant tamper, authority revision, close race, and zeroize retained keys', async () => usingService(async ({ service, ProjectEntryService }) => {
  await service.createProject({ projectName: 'Business Sync Stale', displayName: 'Owner' })
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-sync-stale-'))
  let collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
  try {
    await pairCollaborator(service, collaborator)
    const authority = await service.localProjectBusinessSyncContext()
    const before = new Set(service.taskContextKeys)
    const disposable = await service.localProjectBusinessSyncContext()
    const retained = [...service.taskContextKeys].filter(key => !before.has(key))
    assert.equal(retained.length, 2, 'authority sync key and delegated Task key are retained')
    assert.equal(disposable.dispose(), true)
    assert.equal(disposable.dispose(), false)
    assert.equal(retained.every(key => key.every(byte => byte === 0)), true)
    await assert.rejects(disposable.peerDeviceRefs(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')

    const disposedCollaborator = await collaborator.localProjectBusinessSyncContext()
    const pairedCollaboratorDeviceRef = disposedCollaborator.localDeviceRef
    const pendingAfterDispose = disposedCollaborator.peerResolver({ senderDeviceRef: authority.localDeviceRef, authorityEpoch: disposedCollaborator.authorityEpoch })
    disposedCollaborator.dispose()
    await assert.rejects(pendingAfterDispose, error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')

    const closingCollaborator = await collaborator.localProjectBusinessSyncContext()
    const pendingAfterClose = closingCollaborator.peerResolver({ senderDeviceRef: authority.localDeviceRef, authorityEpoch: closingCollaborator.authorityEpoch })
    const collaboratorClosing = collaborator.close()
    await assert.rejects(pendingAfterClose, error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
    await collaboratorClosing
    collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })

    const refreshRacing = await service.localProjectBusinessSyncContext()
    const originalRefresh = service.persisted.refresh.bind(service.persisted)
    let releaseRefresh
    let refreshStarted
    const refreshStartedPromise = new Promise(resolve => { refreshStarted = resolve })
    service.persisted.refresh = () => new Promise(resolve => { releaseRefresh = resolve; refreshStarted() })
    const pendingAfterRefreshDispose = refreshRacing.peerResolver({ senderDeviceRef: pairedCollaboratorDeviceRef, authorityEpoch: refreshRacing.authorityEpoch })
    await refreshStartedPromise
    refreshRacing.dispose()
    releaseRefresh()
    await assert.rejects(pendingAfterRefreshDispose, error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
    service.persisted.refresh = originalRefresh

    const memberKey = generateKeyPairSync('ed25519')
    const invite = await service.createInvite({ displayName: 'Revision Peer', role: 'reviewer' })
    await service.redeemInvite({ inviteCode: invite.inviteCode, displayName: 'Revision Peer', publicKey: memberKey.publicKey })
    assert.throws(() => authority.keyProvider(authority.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
    await assert.rejects(authority.peerResolver({ senderDeviceRef: 'device_unknown', authorityEpoch: authority.authorityEpoch }), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
    await assert.rejects(authority.peerDeviceRefs(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
    authority.dispose()

    const pairedDevice = JSON.parse(await readFile(path.join(collaboratorHome, 'storages', 'agent_project_device.json'), 'utf8'))
    await service.persisted.mutate('revokeDevice', {
      actorDeviceRef: service.device.device.deviceRef,
      targetDeviceRef: pairedDevice.device.deviceRef,
      reason: 'sync peer revoked'
    })
    const afterRevocation = await service.localProjectBusinessSyncContext()
    await assert.rejects(afterRevocation.peerResolver({ senderDeviceRef: pairedDevice.device.deviceRef, authorityEpoch: afterRevocation.authorityEpoch }), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
    const remainingPeerRefs = await afterRevocation.peerDeviceRefs()
    assert.equal(remainingPeerRefs.includes(pairedDevice.device.deviceRef), false)
    assert.equal(Object.isFrozen(remainingPeerRefs), true)
    afterRevocation.dispose()

    await collaborator.close()
    const deviceFile = path.join(collaboratorHome, 'storages', 'agent_project_device.json')
    const original = JSON.parse(await readFile(deviceFile, 'utf8'))
    const tampered = structuredClone(original)
    tampered.device.role = 'owner'
    await writeFile(deviceFile, `${JSON.stringify(tampered)}\n`)
    collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
    await assert.rejects(collaborator.localProjectBusinessSyncContext(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
    await collaborator.close()
    await writeFile(deviceFile, `${JSON.stringify(original)}\n`)
    collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => original.device.grant.expiresAt + 1 })
    await assert.rejects(collaborator.localProjectBusinessSyncContext(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')

    const pending = service.localProjectBusinessSyncContext()
    const closingKeys = [...service.taskContextKeys]
    const closing = service.close()
    await assert.rejects(pending, error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
    assert.equal(closingKeys.every(key => key.every(byte => byte === 0)), true)
    await closing
  } finally {
    await collaborator.close()
    await rm(collaboratorHome, { recursive: true, force: true })
  }
}))

test('business sync device schema rejects authority cache keys and malformed collaborator cache keys', async () => usingService(async ({ root, service, ProjectEntryService }) => {
  await service.createProject({ projectName: 'Business Sync Schema', displayName: 'Owner' })
  const authorityFile = path.join(root, 'storages', 'agent_project_device.json')
  const authorityDevice = JSON.parse(await readFile(authorityFile, 'utf8'))
  const forgedAuthority = structuredClone(authorityDevice)
  forgedAuthority.syncCacheKey = 'A'.repeat(43)
  await writeFile(authorityFile, `${JSON.stringify(forgedAuthority)}\n`)
  const rejectedAuthority = new ProjectEntryService({ dshHome: root, now: () => 80_000_000 })
  await assert.rejects(rejectedAuthority.localProjectBusinessSyncContext(), error => error?.code === 'PROJECT_ENTRY_NOT_CREATED')
  await rejectedAuthority.close()
  await writeFile(authorityFile, `${JSON.stringify(authorityDevice)}\n`)

  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-sync-schema-'))
  let collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
  try {
    await pairCollaborator(service, collaborator)
    await collaborator.close()
    const collaboratorFile = path.join(collaboratorHome, 'storages', 'agent_project_device.json')
    const collaboratorDevice = JSON.parse(await readFile(collaboratorFile, 'utf8'))
    collaboratorDevice.syncCacheKey = 'not-a-32-byte-key'
    await writeFile(collaboratorFile, `${JSON.stringify(collaboratorDevice)}\n`)
    collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
    await assert.rejects(collaborator.localProjectBusinessSyncContext(), error => error?.code === 'PROJECT_ENTRY_NOT_CREATED')
  } finally {
    await collaborator.close()
    await rm(collaboratorHome, { recursive: true, force: true })
  }
}))

test('closing project entry immediately invalidates task and Automation capabilities and remains idempotent', async () => usingService(async ({ service }) => {
  await service.createProject({ projectName: 'Closing Context', displayName: 'Owner' })
  const context = await service.localProjectTaskContext()
  const automation = await service.localProjectAutomationContext()
  const unsubscribeDelivery = service.subscribeProjectBusinessDelivery(() => undefined)
  assert.equal(context.keyProvider(context.projectRef).length, 32)
  assert.equal(automation.keyProvider(automation.projectRef).length, 32)
  assert.equal(context.actorResolver(context.execution, context.projectRef).projectRef, context.projectRef)

  const closing = service.close()
  assert.equal(service.close(), closing)
  assert.throws(() => service.subscribeProjectBusinessDelivery(() => undefined), error => error?.code === 'PROJECT_ENTRY_CLOSED')
  assert.equal(unsubscribeDelivery(), true)
  assert.equal(unsubscribeDelivery(), false)
  await assert.rejects(service.sendProjectBusinessMessage({ targetDeviceRef: `device_${'Z'.repeat(26)}`, message: { type: 'business.sync' } }), error => error?.code === 'PROJECT_ENTRY_CLOSED')
  assert.throws(() => context.actorResolver(context.execution, context.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => context.keyProvider(context.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => automation.actorResolver(automation.execution, automation.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.throws(() => automation.keyProvider(automation.projectRef), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  assert.equal(automation.dispose(), true)
  assert.equal(automation.dispose(), false)
  await closing
  await assert.rejects(service.localProjectTaskContext(), error => error?.code === 'PROJECT_ENTRY_CLOSED')
  await assert.rejects(service.localProjectAutomationContext(), error => error?.code === 'PROJECT_ENTRY_CLOSED')
  await assert.rejects(service.localProjectFoundationsContext(), error => error?.code === 'PROJECT_ENTRY_CLOSED')
  await assert.rejects(service.localProjectBusinessSyncContext(), error => error?.code === 'PROJECT_ENTRY_CLOSED')
}))

test('Automation context creation racing close fails closed before publishing keys', async () => usingService(async ({ service }) => {
  await service.createProject({ projectName: 'Automation Close Race', displayName: 'Owner' })
  const pending = service.localProjectAutomationContext()
  const closing = service.close()
  await assert.rejects(pending, error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_INVALID')
  await closing
  assert.equal(service.close(), closing)
}))

test('close drains work accepted before shutdown and rejects every new public operation', async () => usingService(async ({ root, service, ProjectEntryService }) => {
  const creating = service.createProject({ projectName: 'Drained Project', displayName: 'Owner' })
  const closing = service.close()
  await assert.rejects(service.status(), error => error?.code === 'PROJECT_ENTRY_CLOSED')
  const created = await creating
  assert.equal(created.existing, false)
  await closing
  assert.equal(service.persisted, undefined)
  assert.equal(service.device, undefined)

  const reopened = new ProjectEntryService({ dshHome: root, now: () => 80_000_000 })
  try {
    assert.equal((await reopened.status()).project.projectRef, created.status.project.projectRef)
  } finally {
    await reopened.close()
  }
}))

test('project task context rejects missing, collaborator, stale, mismatched, and revoked local authority membership', async t => {
  const { ProjectEntryService } = await import(`${serviceUrl}?task-context=${Date.now()}-${Math.random()}`)
  const emptyHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-empty-context-'))
  const empty = new ProjectEntryService({ dshHome: emptyHome, now: () => 80_000_000 })
  t.after(async () => { await empty.close(); await rm(emptyHome, { recursive: true, force: true }) })
  await assert.rejects(empty.localProjectTaskContext(), error => error?.code === 'PROJECT_ENTRY_NOT_CREATED')
  await assert.rejects(empty.localProjectFoundationsContext(), error => error?.code === 'PROJECT_ENTRY_NOT_CREATED')

  const authorityHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-context-authority-'))
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-context-collaborator-'))
  const authority = new ProjectEntryService({ dshHome: authorityHome, now: () => 80_000_000 })
  const collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
  t.after(async () => {
    await collaborator.close(); await authority.close()
    await rm(authorityHome, { recursive: true, force: true })
    await rm(collaboratorHome, { recursive: true, force: true })
  })
  await authority.createProject({ projectName: 'Context Authority', displayName: 'Owner' })
  const invite = await authority.createInvite({ displayName: 'Reviewer', role: 'reviewer' })
  const request = await collaborator.createJoinRequest({ inviteCode: invite.inviteCode, displayName: 'Reviewer' })
  const approval = await authority.approveJoinRequest({ joinRequest: request.joinRequest })
  await collaborator.completeJoinRequest({ joinResponse: approval.joinResponse })
  await assert.rejects(collaborator.localProjectTaskContext(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
  await assert.rejects(collaborator.localProjectFoundationsContext(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')

  const deviceFile = path.join(authorityHome, 'storages', 'agent_project_device.json')
  const savedDevice = JSON.parse(await readFile(deviceFile, 'utf8'))
  const tamperedDevice = structuredClone(savedDevice)
  tamperedDevice.device.grant.role = 'reviewer'
  await writeFile(deviceFile, `${JSON.stringify(tamperedDevice)}\n`)
  const tampered = new ProjectEntryService({ dshHome: authorityHome, now: () => 80_000_000 })
  await assert.rejects(tampered.localProjectTaskContext(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
  await assert.rejects(tampered.localProjectFoundationsContext(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
  await tampered.close()
  await writeFile(deviceFile, `${JSON.stringify(savedDevice)}\n`)
  const expired = new ProjectEntryService({ dshHome: authorityHome, now: () => savedDevice.device.grant.expiresAt + 1 })
  await assert.rejects(expired.localProjectTaskContext(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
  await assert.rejects(expired.localProjectFoundationsContext(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
  await expired.close()

  const localDeviceRef = savedDevice.device.deviceRef
  const secondOwnerKey = generateKeyPairSync('ed25519')
  const ownerInvite = await authority.createInvite({ displayName: 'Other Owner', role: 'owner' })
  const secondOwner = await authority.redeemInvite({ inviteCode: ownerInvite.inviteCode, displayName: 'Other Owner', publicKey: secondOwnerKey.publicKey })
  await authority.persisted.mutate('revokeDevice', { actorDeviceRef: secondOwner.member.deviceRef, targetDeviceRef: localDeviceRef, reason: 'test revocation' })
  await assert.rejects(authority.localProjectTaskContext(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
  await assert.rejects(authority.localProjectFoundationsContext(), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
})

test('remote invitations are bounded, one-time, signed, expiring, and redeem to a persisted member grant', async () => usingService(async ({ root, service, setNow }) => {
  await service.createProject({ projectName: 'Remote Project', displayName: 'Owner' })
  const invite = await service.createInvite({ displayName: 'Reviewer', role: 'reviewer', expiresAtMs: 80_010_000 })
  assert.match(invite.inviteCode, /^invite_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u)
  assert.match(invite.roomRef, /^[A-Za-z0-9_-]{43}$/u)
  assert.equal(invite.role, 'reviewer')
  assert.equal(invite.expiresAt, new Date(80_010_000).toISOString())
  const storedInvites = await readFile(path.join(root, 'storages', 'agent_project_invites.json'), 'utf8')
  assert.equal(storedInvites.includes(invite.inviteCode), false, 'the reusable invitation credential must not be stored in plaintext')

  const collaborator = generateKeyPairSync('ed25519')
  const redeemed = await service.redeemInvite({ inviteCode: invite.inviteCode, displayName: 'Reviewer', publicKey: collaborator.publicKey })
  assert.equal(redeemed.member.role, 'reviewer')
  assert.match(redeemed.member.deviceRef, /^device_[A-Za-z0-9_-]{20,64}$/u)
  assert.equal(typeof redeemed.grant.signature, 'string')
  assert.equal((await service.status()).project.memberCount, 2)
  await assert.rejects(service.redeemInvite({ inviteCode: invite.inviteCode, displayName: 'Replay', publicKey: collaborator.publicKey }), error => error?.code === 'PROJECT_ENTRY_INVITE_INVALID')

  const tampered = `${invite.inviteCode.slice(0, -1)}${invite.inviteCode.endsWith('A') ? 'B' : 'A'}`
  await assert.rejects(service.redeemInvite({ inviteCode: tampered, displayName: 'Bad', publicKey: collaborator.publicKey }), error => error?.code === 'PROJECT_ENTRY_INVITE_INVALID')
  const expiring = await service.createInvite({ displayName: 'Late', role: 'observer', expiresAtMs: 80_015_000 })
  setNow(80_020_000)
  await assert.rejects(service.redeemInvite({ inviteCode: expiring.inviteCode, displayName: 'Late', publicKey: collaborator.publicKey }), error => error?.code === 'PROJECT_ENTRY_INVITE_EXPIRED')
}))

test('remote relay stays disabled until a credential-free WSS endpoint and room exist', async () => usingService(async ({ service }) => {
  await service.createProject({ projectName: 'Relay Project', displayName: 'Owner' })
  await assert.rejects(service.connectRemote(), error => error?.code === 'PROJECT_ENTRY_RELAY_NOT_CONFIGURED')
  await assert.rejects(service.setRelay({ relayUrl: 'ws://relay.example.com' }), /credential-free wss/u)
  await assert.rejects(service.setRelay({ relayUrl: 'wss://user:secret@relay.example.com' }), /credential-free wss/u)

  const configured = await service.setRelay({ relayUrl: 'wss://relay.example.com' })
  assert.equal(configured.enabled, true)
  assert.equal(configured.relayUrl, 'wss://relay.example.com/')
  await assert.rejects(service.connectRemote(), error => error?.code === 'PROJECT_ENTRY_RELAY_ROOM_MISSING')

  await service.createInvite({ displayName: 'Contributor', role: 'contributor' })
  await assert.rejects(service.connectRemote(), error => error?.code === 'PROJECT_ENTRY_RELAY_WEBSOCKET_UNAVAILABLE')
  const status = await service.status()
  assert.equal(status.relay.enabled, true)
  assert.equal(status.relay.connected, false)
  assert.equal(status.relay.channelReady, false)
}))

test('two desktops complete the invitation handshake and exchange authenticated E2EE relay presence', async t => {
  const authorityHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-authority-'))
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-collaborator-'))
  const server = createHealthServer()
  const router = createRelayRouter({ server })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const localUrl = `ws://127.0.0.1:${server.address().port}`
  class LocalRelaySocket extends WebSocket {
    constructor(_publicUrl, options) { super(localUrl, options) }
  }
  const { ProjectEntryService } = await import(`${serviceUrl}?pairing=${Date.now()}-${Math.random()}`)
  const authority = new ProjectEntryService({ dshHome: authorityHome, WebSocketImpl: LocalRelaySocket, now: () => 80_000_000 })
  const collaborator = new ProjectEntryService({ dshHome: collaboratorHome, WebSocketImpl: LocalRelaySocket, now: () => 80_000_000 })
  t.after(async () => {
    await collaborator.close()
    await authority.close()
    for (const client of router.wss.clients) client.terminate()
    await router.close().catch(() => {})
    await new Promise(resolve => server.close(resolve))
    await rm(authorityHome, { recursive: true, force: true })
    await rm(collaboratorHome, { recursive: true, force: true })
  })

  await authority.createProject({ projectName: 'Paired Project', displayName: 'Owner' })
  const invite = await authority.createInvite({ displayName: 'Reviewer', role: 'reviewer' })
  const request = await collaborator.createJoinRequest({ inviteCode: invite.inviteCode, displayName: 'Reviewer' })
  assert.match(request.joinRequest, /^joinreq_[A-Za-z0-9_-]+$/u)
  const pendingJoin = await readFile(path.join(collaboratorHome, 'storages', 'agent_project_pending_join.json'), 'utf8')
  assert.equal(pendingJoin.includes(invite.inviteCode), false, 'the reusable invitation credential must not be persisted with pending device keys')
  assert.equal((await collaborator.status()).pairing.pending, true)
  const approval = await authority.approveJoinRequest({ joinRequest: request.joinRequest })
  assert.match(approval.joinResponse, /^joinack_[A-Za-z0-9_-]+$/u)
  const approvalPayload = JSON.parse(Buffer.from(approval.joinResponse.slice('joinack_'.length), 'base64url').toString('utf8'))
  assert.equal(approvalPayload.lan, undefined)
  assert.equal(approvalPayload.relayUrl, undefined)
  assert.equal(typeof approvalPayload.pairingCipher?.ciphertext, 'string')
  assert.equal(JSON.stringify(approvalPayload).includes('BEGIN PRIVATE KEY'), false)
  const joined = await collaborator.completeJoinRequest({ joinResponse: approval.joinResponse })
  assert.equal(joined.member.role, 'reviewer')
  assert.equal(joined.status.project.role, 'reviewer')
  assert.equal(joined.status.relay.channelReady, true)
  assert.equal(joined.status.relay.enabled, false, 'approval before relay setup must still complete without pretending the relay is configured')
  assert.equal(joined.status.relay.roomRef, invite.roomRef, 'the approved opaque room remains available for later manual relay setup')
  assert.equal((await authority.status()).project.memberCount, 2)

  await authority.setRelay({ relayUrl: 'wss://relay.example.com/project' })
  assert.equal((await collaborator.status()).relay.enabled, false, 'the collaborator does not silently learn a relay URL configured after approval')
  await assert.rejects(collaborator.setRelay({ relayUrl: 'wss://user:secret@relay.example.com/project' }), /credential-free wss/u)
  const rescued = await collaborator.setRelay({ relayUrl: 'wss://relay.example.com/project' })
  assert.equal(rescued.enabled, true)
  assert.equal(rescued.roomRef, invite.roomRef, 'manual setup reuses the authenticated room instead of requiring another invitation')

  await authority.connectRemote()
  await collaborator.connectRemote()
  for (let index = 0; index < 200; index += 1) {
    const [authorityStatus, collaboratorStatus] = await Promise.all([authority.status(), collaborator.status()])
    if (authorityStatus.relay.lastDelivery?.type === 'presence' && collaboratorStatus.relay.lastDelivery?.type === 'presence.ack') {
      const deliveries = []
      const unsubscribe = collaborator.subscribeProjectBusinessDelivery(delivery => deliveries.push(delivery))
      const queued = await authority.sendProjectBusinessMessage({ targetDeviceRef: collaborator.device.device.deviceRef, message: { type: 'business.sync', revision: 3 } })
      assert.equal(queued.transport, 'remote_wss', 'Entry falls back to WSS when no authenticated LAN socket exists')
      await waitFor(() => deliveries.length > 0, { message: 'remote_wss business.sync delivery (revision 3) did not arrive on the collaborator' })
      assert.equal(deliveries[0].payload.revision, 3)
      unsubscribe()
      return
    }
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('paired desktops did not exchange E2EE presence through the relay')
})

test('two paired desktops automatically establish a real LAN mTLS and E2EE connection without exposing PEM fields', async t => {
  const authorityHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-lan-authority-'))
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-lan-collaborator-'))
  const { ProjectEntryService } = await import(`${serviceUrl}?lan-pairing=${Date.now()}-${Math.random()}`)
  const fixedNow = Date.now()
  const authority = new ProjectEntryService({ dshHome: authorityHome, now: () => fixedNow })
  const collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => fixedNow })
  t.after(async () => {
    await collaborator.close()
    await authority.close()
    await rm(authorityHome, { recursive: true, force: true })
    await rm(collaboratorHome, { recursive: true, force: true })
  })

  await authority.createProject({ projectName: 'LAN Project', displayName: 'Owner' })
  const listening = await authority.startLan({ host: '127.0.0.1' })
  assert.deepEqual(listening, { connected: false, reconnecting: false, listening: true, connectionCount: 0 })

  const invite = await authority.createInvite({ displayName: 'LAN Reviewer', role: 'reviewer' })
  const request = await collaborator.createJoinRequest({ inviteCode: invite.inviteCode, displayName: 'LAN Reviewer' })
  const approval = await authority.approveJoinRequest({ joinRequest: request.joinRequest })
  assert.equal(approval.joinResponse.includes('BEGIN PRIVATE KEY'), false, 'the transfer stays encoded instead of rendering PEM in the UI')
  const tamperedApproval = JSON.parse(Buffer.from(approval.joinResponse.slice('joinack_'.length), 'base64url').toString('utf8'))
  tamperedApproval.pairingCipher.ciphertext = `${tamperedApproval.pairingCipher.ciphertext.slice(0, -1)}${tamperedApproval.pairingCipher.ciphertext.endsWith('A') ? 'B' : 'A'}`
  const tamperedJoinResponse = `joinack_${Buffer.from(JSON.stringify(tamperedApproval), 'utf8').toString('base64url')}`
  await assert.rejects(collaborator.completeJoinRequest({ joinResponse: tamperedJoinResponse }), error => error?.code === 'PROJECT_ENTRY_INVITE_INVALID' && /authority signature/u.test(error.message))
  await collaborator.completeJoinRequest({ joinResponse: approval.joinResponse })
  const collaboratorStatus = await collaborator.status()
  assert.deepEqual(collaboratorStatus.lan, { connected: false, reconnecting: false, listening: false, connectionCount: 0 })

  let connected
  try { connected = await collaborator.connectLan() }
  catch (error) { assert.fail(`${error?.stack || error}\nserver rejection: ${authority.lanTransport?.lastError?.stack || authority.lanTransport?.lastError}`) }
  assert.equal(connected.connected, true)
  assert.equal((await collaborator.status()).lan.connected, true)
  assert.equal((await authority.status()).relay.lastDelivery.type, 'presence')
  assert.equal((await authority.status()).lan.connectionCount, 1)

  const authorityDeliveries = []
  const collaboratorDeliveries = []
  const never = new Promise(() => {})
  const unsubscribeThrowing = authority.subscribeProjectBusinessDelivery(() => { throw new Error('listener isolation') })
  const unsubscribeNever = authority.subscribeProjectBusinessDelivery(() => never)
  const unsubscribeAuthority = authority.subscribeProjectBusinessDelivery(delivery => authorityDeliveries.push(delivery))
  const unsubscribeCollaborator = collaborator.subscribeProjectBusinessDelivery(delivery => collaboratorDeliveries.push(delivery))
  const authorityDeviceRef = authority.device.device.deviceRef
  const collaboratorDeviceRef = collaborator.device.device.deviceRef
  const toCollaborator = await authority.sendProjectBusinessMessage({ targetDeviceRef: collaboratorDeviceRef, message: { type: 'business.sync', revision: 1 } })
  assert.deepEqual({ queued: toCollaborator.queued, transport: toCollaborator.transport }, { queued: true, transport: 'lan_mtls' })
  await waitFor(() => collaboratorDeliveries.length > 0, { message: 'LAN mTLS/E2EE business.sync delivery (revision 1) did not arrive on the collaborator' })
  assert.equal(collaboratorDeliveries[0].payload.revision, 1)
  assert.equal(Object.isFrozen(collaboratorDeliveries[0]), true)
  assert.equal(Object.isFrozen(collaboratorDeliveries[0].payload), true)

  const toAuthority = await collaborator.sendProjectBusinessMessage({ targetDeviceRef: authorityDeviceRef, message: { type: 'business.sync', revision: 2 } })
  assert.equal(toAuthority.transport, 'lan_mtls')
  await waitFor(() => authorityDeliveries.length > 0, { message: 'LAN mTLS/E2EE business.sync delivery (revision 2) did not arrive on the authority' })
  assert.equal(authorityDeliveries[0].payload.revision, 2, 'never-settling listeners do not block delivery or ACK')
  await assert.rejects(authority.sendProjectBusinessMessage({ targetDeviceRef: 'device_unknown_device_unknown', message: { type: 'business.sync' } }), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
  await assert.rejects(authority.sendProjectBusinessMessage({ targetDeviceRef: collaboratorDeviceRef, message: { type: 'business.sync' }, transport: 'remote_wss' }), /only targetDeviceRef and message/)
  await assert.rejects(authority.sendProjectBusinessMessage({ targetDeviceRef: collaboratorDeviceRef, message: { type: 'business.sync', transport: 'remote_wss' } }), /cannot provide transport/)
  let getterRuns = 0
  authority.lanTransport.onDelivery(Object.defineProperties({}, {
    senderDeviceRef: { value: collaboratorDeviceRef, enumerable: true },
    authorityEpoch: { value: authorityDeliveries[0].authorityEpoch, enumerable: true },
    payload: { enumerable: true, get() { getterRuns += 1; return { type: 'forged' } } }
  }))
  assert.equal(getterRuns, 0)
  assert.equal(unsubscribeThrowing(), true); assert.equal(unsubscribeThrowing(), false)
  assert.equal(unsubscribeNever(), true); unsubscribeAuthority(); unsubscribeCollaborator()
})

test('authority outbound refreshes persisted membership for LAN and WSS and never sends to a revoked connected peer', async () => usingService(async ({ service, ProjectEntryService }) => {
  await service.createProject({ projectName: 'Outbound Authority Gate', displayName: 'Owner' })
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-outbound-authority-'))
  const collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
  try {
    await pairCollaborator(service, collaborator)
    const targetDeviceRef = collaborator.device.device.deviceRef
    const sent = []
    const lan = {
      canSend: deviceRef => deviceRef === targetDeviceRef,
      send: packet => { sent.push({ transport: 'lan_mtls', packet }); return { queued: true, packetRef: `packet_lan_${sent.length}` } },
      stop: async () => undefined
    }
    const wss = {
      canSend: deviceRef => deviceRef === targetDeviceRef,
      send: packet => { sent.push({ transport: 'remote_wss', packet }); return { queued: true, packetRef: `packet_wss_${sent.length}` } },
      stop: async () => undefined
    }
    const authorizationRevision = service.persisted.revision
    service.lanTransport = lan
    assert.equal((await service.sendProjectBusinessMessage({ targetDeviceRef, message: { type: 'business.sync', sequence: 1 } })).transport, 'lan_mtls')
    service.lanTransport = undefined
    service.relayTransport = wss
    assert.equal((await service.sendProjectBusinessMessage({ targetDeviceRef, message: { type: 'business.sync', sequence: 2 } })).transport, 'remote_wss')
    assert.equal(service.persisted.revision, authorizationRevision, 'response loss/retry does not repeat an authorization mutation')
    assert.equal(sent.length, 2)

    service.relayTransport = undefined
    service.lanTransport = lan
    await service.persisted.mutate('revokeDevice', {
      actorDeviceRef: service.device.device.deviceRef,
      targetDeviceRef,
      reason: 'outbound connected peer revoked'
    })
    await assert.rejects(
      service.sendProjectBusinessMessage({ targetDeviceRef, message: { type: 'business.sync', sequence: 3 } }),
      error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN'
    )
    assert.equal(sent.length, 2, 'a still-connected LAN socket never receives a post-revocation packet')
  } finally {
    await collaborator.close()
    await rm(collaboratorHome, { recursive: true, force: true })
  }
}))

test('collaborator outbound requires a fresh valid grant and exactly one owner authority target', async () => usingService(async ({ service, ProjectEntryService }) => {
  await service.createProject({ projectName: 'Outbound Collaborator Gate', displayName: 'Owner' })
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-outbound-collaborator-'))
  let collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
  const deviceFile = path.join(collaboratorHome, 'storages', 'agent_project_device.json')
  try {
    await pairCollaborator(service, collaborator)
    const ownerDeviceRef = service.device.device.deviceRef
    await collaborator.close()
    const original = JSON.parse(await readFile(deviceFile, 'utf8'))
    const fakeConnectedLan = { canSend: () => true, send: () => { assert.fail('unauthorized collaborator send reached transport') }, stop: async () => undefined }

    const nonOwner = structuredClone(original)
    nonOwner.peers[0].role = 'reviewer'
    await writeFile(deviceFile, `${JSON.stringify(nonOwner)}\n`)
    collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
    collaborator.lanClient = fakeConnectedLan
    await assert.rejects(collaborator.sendProjectBusinessMessage({ targetDeviceRef: ownerDeviceRef, message: { type: 'business.sync' } }), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
    await collaborator.close()

    const tampered = structuredClone(original)
    tampered.device.grant.signature = `${tampered.device.grant.signature.slice(0, -1)}${tampered.device.grant.signature.endsWith('A') ? 'B' : 'A'}`
    await writeFile(deviceFile, `${JSON.stringify(tampered)}\n`)
    collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
    collaborator.lanClient = fakeConnectedLan
    await assert.rejects(collaborator.sendProjectBusinessMessage({ targetDeviceRef: ownerDeviceRef, message: { type: 'business.sync' } }), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
    await collaborator.close()

    await writeFile(deviceFile, `${JSON.stringify(original)}\n`)
    collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => original.device.grant.expiresAt + 1 })
    collaborator.lanClient = fakeConnectedLan
    await assert.rejects(collaborator.sendProjectBusinessMessage({ targetDeviceRef: ownerDeviceRef, message: { type: 'business.sync' } }), error => error?.code === 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN')
  } finally {
    await collaborator.close()
    await rm(collaboratorHome, { recursive: true, force: true })
  }
}))

test('business send accepted into the Entry queue drains through a concurrent close', async () => usingService(async ({ service, ProjectEntryService }) => {
  await service.createProject({ projectName: 'Outbound Close Drain', displayName: 'Owner' })
  const collaboratorHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-outbound-close-'))
  const collaborator = new ProjectEntryService({ dshHome: collaboratorHome, now: () => 80_000_000 })
  try {
    await pairCollaborator(service, collaborator)
    const targetDeviceRef = collaborator.device.device.deviceRef
    let sent = 0
    service.lanTransport = {
      canSend: deviceRef => deviceRef === targetDeviceRef,
      send: () => { sent += 1; return { queued: true, packetRef: 'packet_close_drain' } },
      stop: async () => undefined
    }
    let releaseRefresh
    let refreshStarted
    const refreshStartedPromise = new Promise(resolve => { refreshStarted = resolve })
    service.persisted.refresh = () => new Promise(resolve => { releaseRefresh = resolve; refreshStarted() })
    const accepted = service.sendProjectBusinessMessage({ targetDeviceRef, message: { type: 'business.sync', closeRace: true } })
    await refreshStartedPromise
    const closing = service.close()
    releaseRefresh()
    const result = await accepted
    assert.deepEqual({ queued: result.queued, transport: result.transport }, { queued: true, transport: 'lan_mtls' })
    assert.equal(sent, 1)
    await closing
  } finally {
    await collaborator.close()
    await rm(collaboratorHome, { recursive: true, force: true })
  }
}))
