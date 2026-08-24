const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash, createHmac } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'workspace-authority.js')).href
const HEAD = '1'.repeat(40)
const RESULT_A = '2'.repeat(40)
const RESULT_B = '3'.repeat(40)

function digest(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`
}
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}
function resignHostState(state) {
  const body = { ...state }
  delete body.stateMac
  return { ...body, stateMac: createHmac('sha256', body.secret).update(canonicalJson(body)).digest('base64url') }
}

async function fixture() {
  const mod = await import(moduleUrl)
  let now = 20_000_000
  const roots = {
    authorityRoot: path.resolve('private-authority-store'),
    sourceWorkspaceRoot: path.resolve('computer-a-working-tree'),
    workspaceRoot: path.resolve('isolated-task-workspaces')
  }
  const verifyGateReceipt = (receipt, binding) => receipt.token === digest(JSON.stringify(binding))
  const authority = new mod.WorkspaceAuthority({
    projectRef: 'project_opaque_ref', repositoryRef: 'repo_opaque_ref', ...roots,
    initialHead: HEAD, secret: 'workspace-secret-with-at-least-twenty-four-characters', now: () => now, verifyGateReceipt
  })
  return { mod, authority, roots, setNow(value) { now = value }, getNow() { return now } }
}

function open(authority, roots, suffix, collaboratorRef = `collaborator_${suffix}`, taskRef = `task_${suffix}`) {
  return authority.openWorkspace({
    collaboratorRef,
    taskRef,
    workspacePath: path.join(roots.workspaceRoot, suffix)
  })
}

function publish(authority, workspace, claim, suffix, files = [`src/${suffix}.js`]) {
  return authority.publishChangeSet({
    workspaceRef: workspace.workspaceRef,
    commit: createHash('sha1').update(`commit-${suffix}`).digest('hex'),
    parentCommit: workspace.baseCommit,
    diffDigest: digest(`diff-${suffix}`),
    treeDigest: digest(`tree-${suffix}`),
    files,
    claimRefs: [claim.claimRef],
    message: `Change ${suffix}`
  })
}

function passingReceipt(binding) {
  return { decision: 'pass', gateReceiptRef: `gate_${binding.mergeGroupRef}`, token: digest(JSON.stringify(binding)) }
}

function bindingFor(authority, group, artifacts) {
  return {
    projectRef: authority.projectRef,
    repositoryRef: authority.repositoryRef,
    authorityEpoch: authority.authorityEpoch,
    mergeGroupRef: group.mergeGroupRef,
    baseHead: group.baseHead,
    resultCommit: group.resultCommit,
    artifactSetRef: artifacts.artifactSetRef,
    manifestDigest: artifacts.manifestDigest
  }
}

test('authority, source working tree, and isolated workspace roots must remain disjoint', async () => {
  const { mod, roots, authority } = await fixture()
  assert.throws(() => new mod.WorkspaceAuthority({
    projectRef: 'project_x', repositoryRef: 'repo_x', authorityRoot: roots.sourceWorkspaceRoot,
    sourceWorkspaceRoot: roots.sourceWorkspaceRoot, workspaceRoot: roots.workspaceRoot,
    initialHead: HEAD, secret: 'another-secret-with-at-least-twenty-four-characters'
  }), /must be disjoint paths/u)
  assert.throws(() => authority.openWorkspace({ collaboratorRef: 'collab_x', taskRef: 'task_x', workspacePath: path.join(roots.sourceWorkspaceRoot, 'shared') }), /dedicated child of workspaceRoot/u)
  const workspace = open(authority, roots, 'safe')
  const projection = JSON.stringify(workspace)
  assert.equal(projection.includes(roots.sourceWorkspaceRoot), false)
  assert.equal(projection.includes(roots.authorityRoot), false)
  assert.equal(projection.includes(roots.workspaceRoot), false)
  const authorityProjection = JSON.stringify(authority)
  assert.equal(authorityProjection.includes(roots.sourceWorkspaceRoot), false)
  assert.equal(authorityProjection.includes(roots.authorityRoot), false)
  assert.equal(authorityProjection.includes('workspace-secret-with-at-least-twenty-four-characters'), false)
  assert.match(workspace.workspaceRef, /^workspace_/u)
  assert.equal(workspace.fencingToken, '1:1'); assert.deepEqual(open(authority, roots, 'safe'), workspace); assert.equal(authority.exportHostState().fencingCounter, 1)
})

test('ResourceClaim distinguishes hard write conflicts from read/write advisories', async () => {
  const { authority, roots } = await fixture()
  const writer = open(authority, roots, 'writer')
  const reader = open(authority, roots, 'reader')
  const competitor = open(authority, roots, 'competitor')
  const writeClaim = authority.claimResources({ workspaceRef: writer.workspaceRef, mode: 'write', resources: ['src/shared'] })
  assert.deepEqual(authority.claimResources({ workspaceRef: writer.workspaceRef, mode: 'write', resources: ['src/shared'], claimMs: 1_000 }), writeClaim); assert.equal(authority.status().activeClaimCount, 1); const sameWorkspaceRead = authority.claimResources({ workspaceRef: writer.workspaceRef, mode: 'read', resources: ['src/shared'] }); assert.notEqual(sameWorkspaceRead.claimRef, writeClaim.claimRef); assert.equal(authority.status().activeClaimCount, 2)
  const readClaim = authority.claimResources({ workspaceRef: reader.workspaceRef, mode: 'read', resources: ['src/shared/file.js'] })
  assert.deepEqual(readClaim.advisoryConflictRefs, [writeClaim.claimRef])
  assert.throws(
    () => authority.claimResources({ workspaceRef: competitor.workspaceRef, mode: 'write', resources: ['src/shared/file.js'] }),
    error => error?.code === 'RESOURCE_CONFLICT' && error.conflictRefs.includes(writeClaim.claimRef)
  )
  assert.throws(() => authority.claimResources({ workspaceRef: competitor.workspaceRef, mode: 'exclusive', resources: ['src'] }), /conflicts with active/u)
})

test('closeWorkspace is fenced, idempotent, restores closed state, and retains only merge-held claims', async () => {
  const { mod, authority, roots, getNow } = await fixture()
  const active = open(authority, roots, 'close-active'), activeClaim = authority.claimResources({ workspaceRef: active.workspaceRef, mode: 'write', resources: ['src/active.js'] })
  assert.throws(() => authority.closeWorkspace({ workspaceRef: active.workspaceRef, fencingToken: '1:999' }), /fencing token/u)
  const closed = authority.closeWorkspace({ workspaceRef: active.workspaceRef, fencingToken: active.fencingToken }); assert.equal(closed.state, 'closed'); assert.equal(Object.hasOwn(closed, 'workspacePath'), false); assert.equal(authority.closeWorkspace({ workspaceRef: active.workspaceRef, fencingToken: active.fencingToken }).state, 'closed')
  let host = authority.exportHostState(); assert.equal(host.claims.find(item => item.claimRef === activeClaim.claimRef).state, 'released')
  const published = open(authority, roots, 'close-published'), held = authority.claimResources({ workspaceRef: published.workspaceRef, mode: 'write', resources: ['src/close-published.js'] }); publish(authority, published, held, 'close-published'); authority.closeWorkspace({ workspaceRef: published.workspaceRef, fencingToken: published.fencingToken })
  host = authority.exportHostState(); assert.equal(host.claims.find(item => item.claimRef === held.claimRef).state, 'held_for_merge'); assert.equal(host.workspaces.find(item => item.workspaceRef === published.workspaceRef).state, 'closed')
  const restored = mod.WorkspaceAuthority.restore(JSON.parse(JSON.stringify(host)), { now: () => getNow() }); assert.equal(restored.closeWorkspace({ workspaceRef: published.workspaceRef, fencingToken: published.fencingToken }).state, 'closed'); assert.equal(restored.status().activeWorkspaceCount, 0)
  const malformed = JSON.parse(JSON.stringify(host)); malformed.claims.find(item => item.claimRef === activeClaim.claimRef).state = 'active'; assert.throws(() => mod.WorkspaceAuthority.restore(resignHostState(malformed), { now: () => getNow() }), /closed workspace/u)
})

test('ChangeSet publication is immutable, idempotent, and requires exact active write coverage', async () => {
  const { authority, roots } = await fixture()
  const workspace = open(authority, roots, 'publish')
  const claim = authority.claimResources({ workspaceRef: workspace.workspaceRef, mode: 'write', resources: ['src/publish.js'] })
  const changeSet = publish(authority, workspace, claim, 'publish')
  assert.match(changeSet.changeSetRef, /^changeset_/u)
  assert.equal(changeSet.baseCommit, HEAD)
  assert.equal(Object.hasOwn(changeSet, 'workspacePath'), false)
  assert.equal(publish(authority, workspace, claim, 'publish'), changeSet)
  assert.throws(() => authority.publishChangeSet({
    workspaceRef: workspace.workspaceRef, commit: 'f'.repeat(40), parentCommit: HEAD,
    diffDigest: digest('different'), treeDigest: digest('different-tree'), files: ['src/publish.js'],
    claimRefs: [claim.claimRef], message: 'Different immutable content'
  }), /already published a different ChangeSet/u)

  const uncoveredWorkspace = open(authority, roots, 'uncovered')
  const narrowClaim = authority.claimResources({ workspaceRef: uncoveredWorkspace.workspaceRef, mode: 'write', resources: ['src/only.js'] })
  assert.throws(() => publish(authority, uncoveredWorkspace, narrowClaim, 'uncovered', ['src/other.js']), /not covered by an active write claim/u)
})

test('merge queue builds once, binds ArtifactSet, verifies an exact gate, and advances authority head', async () => {
  const { authority, roots } = await fixture()
  const workspaceA = open(authority, roots, 'a')
  const claimA = authority.claimResources({ workspaceRef: workspaceA.workspaceRef, mode: 'write', resources: ['src/a.js'] })
  const changeA = publish(authority, workspaceA, claimA, 'a')
  const workspaceB = open(authority, roots, 'b')
  const claimB = authority.claimResources({ workspaceRef: workspaceB.workspaceRef, mode: 'write', resources: ['src/b.js'] })
  const changeB = publish(authority, workspaceB, claimB, 'b')
  authority.enqueueChangeSet(changeA.changeSetRef)
  authority.enqueueChangeSet(changeB.changeSetRef)
  const planned = authority.planMergeGroup({ maxChangeSets: 2 })
  assert.deepEqual(planned.changeSetRefs, [changeA.changeSetRef, changeB.changeSetRef])
  const merged = authority.recordMergeResult({ mergeGroupRef: planned.mergeGroupRef, resultCommit: RESULT_A, treeDigest: digest('merged-tree') })
  const artifacts = authority.recordArtifactSet({
    mergeGroupRef: merged.mergeGroupRef,
    commit: RESULT_A,
    buildEnvironmentDigest: digest('windows-node-env'),
    artifacts: [{ name: 'app.zip', digest: digest('app.zip'), size: 1024 }]
  })
  assert.equal(authority.recordArtifactSet({
    mergeGroupRef: merged.mergeGroupRef,
    commit: RESULT_A,
    buildEnvironmentDigest: digest('windows-node-env'),
    artifacts: [{ name: 'app.zip', digest: digest('app.zip'), size: 1024 }]
  }), artifacts)
  assert.throws(() => authority.landMergeGroup({ mergeGroupRef: merged.mergeGroupRef, artifactSetRef: artifacts.artifactSetRef, gateReceipt: { decision: 'pass', gateReceiptRef: 'gate_fake', token: 'fake' } }), /authentic passing gate/u)
  const currentGroup = { ...merged, state: 'built', artifactSetRef: artifacts.artifactSetRef }
  const receipt = passingReceipt(bindingFor(authority, currentGroup, artifacts))
  const landed = authority.landMergeGroup({ mergeGroupRef: merged.mergeGroupRef, artifactSetRef: artifacts.artifactSetRef, gateReceipt: receipt })
  assert.equal(landed.headCommit, RESULT_A)
  assert.equal(authority.status().headCommit, RESULT_A)
  assert.equal(authority.status().activeClaimCount, 0)
})

test('authenticated Host snapshots restore exact queue, merge, artifact, and fencing state', async () => {
  const { mod, authority, roots, getNow } = await fixture()
  const workspace = open(authority, roots, 'snapshot')
  const claim = authority.claimResources({ workspaceRef: workspace.workspaceRef, mode: 'write', resources: ['src/snapshot.js'] })
  const change = publish(authority, workspace, claim, 'snapshot')
  authority.enqueueChangeSet(change.changeSetRef)
  const plan = authority.planMergeGroup()
  const merged = authority.recordMergeResult({ mergeGroupRef: plan.mergeGroupRef, resultCommit: RESULT_A, treeDigest: digest('snapshot-tree') })
  const artifacts = authority.recordArtifactSet({ mergeGroupRef: merged.mergeGroupRef, commit: RESULT_A, buildEnvironmentDigest: digest('snapshot-env'), artifacts: [{ name: 'snapshot.zip', digest: digest('snapshot.zip'), size: 42 }] })
  const hostState = authority.exportHostState()
  const verifyGateReceipt = (receipt, binding) => receipt.token === digest(JSON.stringify(binding))
  const restored = mod.WorkspaceAuthority.restore(JSON.parse(JSON.stringify(hostState)), { now: () => getNow(), verifyGateReceipt })
  assert.deepEqual(restored.status(), authority.status())
  const receipt = passingReceipt(bindingFor(restored, { ...merged, state: 'built' }, artifacts))
  const landed = restored.landMergeGroup({ mergeGroupRef: merged.mergeGroupRef, artifactSetRef: artifacts.artifactSetRef, gateReceipt: receipt })
  assert.equal(landed.headCommit, RESULT_A)
  assert.equal(restored.status().activeClaimCount, 0)

  assert.throws(() => mod.WorkspaceAuthority.restore({ ...hostState, headCommit: RESULT_B }, { verifyGateReceipt }), /authentication failed/u)
  const malformed = JSON.parse(JSON.stringify(hostState))
  malformed.changeSets[0].projectRef = 'project_wrong_scope'
  assert.throws(() => mod.WorkspaceAuthority.restore(resignHostState(malformed), { verifyGateReceipt }), /scope or version is invalid/u)
})

test('stale merge groups cannot land after another group wins the head compare-and-swap', async () => {
  const { authority, roots } = await fixture()
  const records = []
  for (const suffix of ['one', 'two']) {
    const workspace = open(authority, roots, suffix)
    const claim = authority.claimResources({ workspaceRef: workspace.workspaceRef, mode: 'write', resources: [`src/${suffix}.js`] })
    const change = publish(authority, workspace, claim, suffix)
    authority.enqueueChangeSet(change.changeSetRef)
    records.push(change)
  }
  const firstPlan = authority.planMergeGroup({ maxChangeSets: 1 })
  const secondPlan = authority.planMergeGroup({ maxChangeSets: 1 })
  const firstMerge = authority.recordMergeResult({ mergeGroupRef: firstPlan.mergeGroupRef, resultCommit: RESULT_A, treeDigest: digest('first-tree') })
  const secondMerge = authority.recordMergeResult({ mergeGroupRef: secondPlan.mergeGroupRef, resultCommit: RESULT_B, treeDigest: digest('second-tree') })
  const firstArtifacts = authority.recordArtifactSet({ mergeGroupRef: firstMerge.mergeGroupRef, commit: RESULT_A, buildEnvironmentDigest: digest('env'), artifacts: [{ name: 'first', digest: digest('first'), size: 1 }] })
  const secondArtifacts = authority.recordArtifactSet({ mergeGroupRef: secondMerge.mergeGroupRef, commit: RESULT_B, buildEnvironmentDigest: digest('env'), artifacts: [{ name: 'second', digest: digest('second'), size: 1 }] })
  authority.landMergeGroup({ mergeGroupRef: firstMerge.mergeGroupRef, artifactSetRef: firstArtifacts.artifactSetRef, gateReceipt: passingReceipt(bindingFor(authority, { ...firstMerge, state: 'built' }, firstArtifacts)) })
  assert.throws(() => authority.landMergeGroup({ mergeGroupRef: secondMerge.mergeGroupRef, artifactSetRef: secondArtifacts.artifactSetRef, gateReceipt: passingReceipt(bindingFor(authority, { ...secondMerge, state: 'built' }, secondArtifacts)) }), /head changed after merge planning/u)
})

test('merge conflicts retain claims and authority epoch promotion fences every old lease', async () => {
  const { authority, roots } = await fixture()
  const workspace = open(authority, roots, 'conflict')
  const claim = authority.claimResources({ workspaceRef: workspace.workspaceRef, mode: 'write', resources: ['src/conflict.js'] })
  const change = publish(authority, workspace, claim, 'conflict')
  authority.enqueueChangeSet(change.changeSetRef)
  const plan = authority.planMergeGroup()
  const conflicted = authority.recordMergeResult({ mergeGroupRef: plan.mergeGroupRef, conflicts: ['src/conflict.js'] })
  assert.equal(conflicted.state, 'conflicted')
  assert.equal(authority.status().activeClaimCount, 1)
  const promoted = authority.advanceAuthorityEpoch({ expectedHead: HEAD })
  assert.equal(promoted.authorityEpoch, 2)
  assert.equal(authority.status().activeClaimCount, 0)
  assert.throws(() => authority.claimResources({ workspaceRef: workspace.workspaceRef, mode: 'write', resources: ['src/new.js'] }), /unavailable|stale/u)
  assert.equal(authority.status().queuedChangeSetCount, 0)
})
