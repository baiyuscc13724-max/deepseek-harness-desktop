const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const workspaceUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'workspace-authority.js')).href
const serviceUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'workspace-authority-service.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-state-store.js')).href
const gitUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'git-workspace-adapter.js')).href
const HEAD = '1'.repeat(40)
const RESULT = '2'.repeat(40)
const OTHER = '3'.repeat(40)
const PROJECT = `project_${'W'.repeat(26)}`
const REPOSITORY = 'repository_service01'

function digest(value) { return `sha256:${createHash('sha256').update(String(value)).digest('hex')}` }
function receipt(authority, group, artifacts) {
  const binding = {
    projectRef: authority.projectRef, repositoryRef: authority.repositoryRef, authorityEpoch: authority.authorityEpoch,
    mergeGroupRef: group.mergeGroupRef, baseHead: group.baseHead, resultCommit: group.resultCommit,
    artifactSetRef: artifacts.artifactSetRef, manifestDigest: artifacts.manifestDigest
  }
  return { decision: 'pass', gateReceiptRef: `gate_${group.mergeGroupRef}`, token: digest(JSON.stringify(binding)) }
}
async function fixture() {
  const workspaceMod = await import(workspaceUrl)
  const serviceMod = await import(serviceUrl)
  const storeMod = await import(storeUrl)
  const gitMod = await import(gitUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspace-authority-service-'))
  const roots = {
    authorityRoot: path.join(root, 'authority'),
    sourceWorkspaceRoot: path.join(root, 'source'),
    workspaceRoot: path.join(root, 'workspaces')
  }
  let gitHead = HEAD
  const gitAdapter = new gitMod.GitWorkspaceAdapter({
    gitCommand: path.resolve(__dirname, '..', 'third_party', 'mingit', 'cmd', 'git.exe'),
    allowedGitRoot: path.resolve(__dirname, '..', 'third_party', 'mingit'),
    ...roots,
    repositoryRef: REPOSITORY
  })
  gitAdapter.head = async () => gitHead
  gitAdapter.compareAndSwapHead = async ({ expectedHead, resultCommit }) => {
    if (gitHead !== expectedHead) { const error = new Error('head conflict'); error.code = 'AUTHORITY_HEAD_CONFLICT'; throw error }
    gitHead = resultCommit
    return { advanced: true, headCommit: resultCommit }
  }
  const verifyGateReceipt = (value, binding) => value.token === digest(JSON.stringify(binding))
  const authority = new workspaceMod.WorkspaceAuthority({
    projectRef: PROJECT, repositoryRef: REPOSITORY, ...roots, initialHead: HEAD,
    secret: 'workspace-service-secret-with-twenty-four-characters', now: () => 110_000_000, verifyGateReceipt
  })
  const key = randomBytes(32)
  const filePath = path.join(root, 'state', 'workspace.enc')
  const store = new storeMod.EncryptedAuthorityStateStore(filePath, { projectRef: PROJECT, encryptionKey: key })
  const service = await serviceMod.PersistedWorkspaceAuthority.create({ store, gitAdapter, authority })
  return {
    workspaceMod, serviceMod, storeMod, root, roots, key, filePath, store, service, authority, gitAdapter, verifyGateReceipt,
    getGitHead: () => gitHead, setGitHead: value => { gitHead = value }
  }
}
async function usingFixture(run) {
  const state = await fixture()
  try { await run(state) } finally { await rm(state.root, { recursive: true, force: true }) }
}
async function buildReadyGroup(state, suffix = 'main') {
  const opened = (await state.service.mutate('openWorkspace', {
    collaboratorRef: `collaborator_${suffix}01`, taskRef: `task_${suffix}01`,
    workspacePath: path.join(state.roots.workspaceRoot, `workspace-${suffix}`), baseCommit: HEAD
  })).result
  const claim = (await state.service.mutate('claimResources', { workspaceRef: opened.workspaceRef, mode: 'write', resources: [`src/${suffix}.js`] })).result
  const change = (await state.service.mutate('publishChangeSet', {
    workspaceRef: opened.workspaceRef, commit: createHash('sha1').update(`service-${suffix}`).digest('hex'), parentCommit: HEAD,
    diffDigest: digest(`diff-${suffix}`), treeDigest: digest(`tree-${suffix}`), files: [`src/${suffix}.js`],
    claimRefs: [claim.claimRef], message: `Persist ${suffix}`
  })).result
  await state.service.mutate('enqueueChangeSet', change.changeSetRef)
  const group = (await state.service.mutate('planMergeGroup', {})).result
  const merged = (await state.service.mutate('recordMergeResult', { mergeGroupRef: group.mergeGroupRef, resultCommit: RESULT, treeDigest: digest('merged-tree') })).result
  const artifacts = (await state.service.mutate('recordArtifactSet', {
    mergeGroupRef: group.mergeGroupRef, commit: RESULT, buildEnvironmentDigest: digest('environment'),
    artifacts: [{ name: 'bundle.zip', digest: digest('bundle.zip'), size: 99 }]
  })).result
  return { opened, claim, change, group: merged, artifacts }
}

test('Workspace mutations publish only after encrypted revision CAS and reopen exactly', async () => usingFixture(async state => {
  const records = await buildReadyGroup(state)
  assert.equal(state.service.toJSON().persistencePhase, 'ready')
  assert.equal(state.service.toJSON().persistedRevision, 8)
  const ciphertext = await readFile(state.filePath, 'utf8')
  for (const secret of [state.roots.authorityRoot, state.roots.sourceWorkspaceRoot, state.roots.workspaceRoot, 'workspace-service-secret']) assert.equal(ciphertext.includes(secret), false)

  const reopenedStore = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key })
  const reopened = await state.serviceMod.PersistedWorkspaceAuthority.open({
    store: reopenedStore, gitAdapter: state.gitAdapter, now: () => 110_000_000, verifyGateReceipt: state.verifyGateReceipt, expected: state.roots
  })
  assert.equal(reopened.toJSON().persistedRevision, 8)
  assert.equal(reopened.toJSON().activeClaimCount, 1)
  assert.equal(records.group.resultCommit, RESULT)
}))

test('closeWorkspace is a persisted fenced mutation and survives reopen', async () => usingFixture(async state => {
  const openInput = { collaboratorRef: 'collaborator_closepersist', taskRef: 'task_closepersist', workspacePath: path.join(state.roots.workspaceRoot, 'workspace-closepersist'), baseCommit: HEAD }, opened = (await state.service.mutate('openWorkspace', openInput)).result
  assert.deepEqual((await state.service.mutate('openWorkspace', openInput)).result, opened); assert.equal(state.service.toJSON().activeWorkspaceCount, 1)
  const claimInput = { workspaceRef: opened.workspaceRef, mode: 'write', resources: ['src/close.js'] }, claim = (await state.service.mutate('claimResources', claimInput)).result
  assert.deepEqual((await state.service.mutate('claimResources', claimInput)).result, claim); assert.equal(state.service.toJSON().activeClaimCount, 1)
  const closed = await state.service.mutate('closeWorkspace', { workspaceRef: opened.workspaceRef, fencingToken: opened.fencingToken }); assert.equal(closed.result.state, 'closed')
  const persisted = state.service.authority.exportHostState(); assert.equal(persisted.claims.find(item => item.claimRef === claim.claimRef).state, 'released')
  const reopenedStore = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key }), reopened = await state.serviceMod.PersistedWorkspaceAuthority.open({ store: reopenedStore, gitAdapter: state.gitAdapter, now: () => 110_000_000, verifyGateReceipt: state.verifyGateReceipt, expected: state.roots }); assert.equal(reopened.toJSON().activeWorkspaceCount, 0); assert.equal((await reopened.mutate('closeWorkspace', { workspaceRef: opened.workspaceRef, fencingToken: opened.fencingToken })).result.state, 'closed'); await reopened.close()
}))

test('landing journal atomically advances Git then encrypted state', async () => usingFixture(async state => {
  const records = await buildReadyGroup(state)
  const result = await state.service.landMergeGroup({
    mergeGroupRef: records.group.mergeGroupRef, artifactSetRef: records.artifacts.artifactSetRef,
    gateReceipt: receipt(state.authority, records.group, records.artifacts)
  })
  assert.equal(result.result.headCommit, RESULT)
  assert.equal(state.getGitHead(), RESULT)
  assert.equal(state.service.toJSON().headCommit, RESULT)
  assert.equal(state.service.toJSON().persistencePhase, 'ready')
  assert.equal(state.service.toJSON().persistedRevision, 10)
}))

test('crash after Git CAS leaves a durable journal that reopening completes', async () => usingFixture(async state => {
  const records = await buildReadyGroup(state, 'crash')
  const originalSave = state.store.save.bind(state.store)
  let pendingSaved = false
  state.store.save = async (value, options) => {
    if (value.phase === 'landing_pending') { pendingSaved = true; return originalSave(value, options) }
    if (pendingSaved && value.phase === 'ready') throw new Error('simulated crash before final state publication')
    return originalSave(value, options)
  }
  await assert.rejects(state.service.landMergeGroup({
    mergeGroupRef: records.group.mergeGroupRef, artifactSetRef: records.artifacts.artifactSetRef,
    gateReceipt: receipt(state.authority, records.group, records.artifacts)
  }), error => error?.code === 'WORKSPACE_LANDING_PENDING')
  assert.equal(state.getGitHead(), RESULT)
  assert.equal(state.service.toJSON().persistencePhase, 'landing_pending')
  assert.equal(state.service.toJSON().headCommit, HEAD)

  const recoveryStore = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key })
  const recovered = await state.serviceMod.PersistedWorkspaceAuthority.open({
    store: recoveryStore, gitAdapter: state.gitAdapter, now: () => 110_000_000, verifyGateReceipt: state.verifyGateReceipt, expected: state.roots
  })
  assert.equal(recovered.toJSON().headCommit, RESULT)
  assert.equal(recovered.toJSON().persistencePhase, 'ready')
  assert.equal(recovered.toJSON().activeClaimCount, 0)
}))

test('pending journal refuses recovery when an unrelated Git head won', async () => usingFixture(async state => {
  const records = await buildReadyGroup(state, 'conflict')
  const originalSave = state.store.save.bind(state.store)
  let pendingSaved = false
  state.store.save = async (value, options) => {
    if (value.phase === 'landing_pending') { pendingSaved = true; return originalSave(value, options) }
    if (pendingSaved && value.phase === 'ready') throw new Error('keep pending')
    return originalSave(value, options)
  }
  await assert.rejects(state.service.landMergeGroup({
    mergeGroupRef: records.group.mergeGroupRef, artifactSetRef: records.artifacts.artifactSetRef,
    gateReceipt: receipt(state.authority, records.group, records.artifacts)
  }), error => error?.code === 'WORKSPACE_LANDING_PENDING')
  state.setGitHead(OTHER)
  const recoveryStore = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key })
  await assert.rejects(state.serviceMod.PersistedWorkspaceAuthority.open({
    store: recoveryStore, gitAdapter: state.gitAdapter, now: () => 110_000_000, verifyGateReceipt: state.verifyGateReceipt
  }), error => error?.code === 'WORKSPACE_RECOVERY_CONFLICT')
}))

test('close drains an accepted authority mutation and gates status before one store close', async () => usingFixture(async state => {
  const originalSave = state.store.save.bind(state.store), originalClose = state.store.close.bind(state.store)
  let release, closeCalls = 0
  const barrier = new Promise(resolve => { release = resolve })
  state.store.save = async (...args) => { await barrier; return originalSave(...args) }
  state.store.close = () => { closeCalls += 1; return originalClose() }
  const accepted = state.service.mutate('openWorkspace', { collaboratorRef: 'collaborator_close01', taskRef: 'task_close01', workspacePath: path.join(state.roots.workspaceRoot, 'workspace-close'), baseCommit: HEAD })
  const closing = state.service.close()
  assert.equal(state.service.close(), closing)
  assert.throws(() => state.service.readStatus(), error => error.code === 'WORKSPACE_AUTHORITY_CLOSED')
  await assert.rejects(state.service.refresh(), error => error.code === 'WORKSPACE_AUTHORITY_CLOSED')
  await assert.rejects(state.service.mutate('not-a-method'), error => error.code === 'WORKSPACE_AUTHORITY_CLOSED')
  release()
  assert.equal((await accepted).revision, 2)
  await closing
  assert.equal(closeCalls, 1)
}))
