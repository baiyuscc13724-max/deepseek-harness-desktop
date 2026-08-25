const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { execFile, execFileSync } = require('node:child_process')
const { existsSync, realpathSync } = require('node:fs')
const { mkdtemp, mkdir, open, readFile, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const execFileAsync = promisify(execFile)
const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'git-workspace-adapter.js')).href
const authorityUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'workspace-authority.js')).href
const casUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'artifact-cas.js')).href
const bundledGitPath = path.resolve(__dirname, '..', 'third_party', 'mingit', 'cmd', 'git.exe')
function resolveGitExecutable() {
  if (process.platform === 'win32' && existsSync(bundledGitPath)) return bundledGitPath
  const locate = process.platform === 'win32' ? 'where' : 'which'
  const raw = execFileSync(locate, ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/u)[0]
  return realpathSync(raw)
}
const gitCommand = resolveGitExecutable()
const allowedGitRoot = gitCommand === bundledGitPath
  ? path.resolve(__dirname, '..', 'third_party', 'mingit')
  : path.dirname(path.dirname(gitCommand))

async function git(cwd, args) {
  const result = await execFileAsync(gitCommand, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }
  })
  return String(result.stdout).trim()
}
async function commit(cwd, message) {
  await git(cwd, ['add', '-A'])
  await git(cwd, ['-c', 'user.name=Adapter Test', '-c', 'user.email=test@localhost', 'commit', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}
async function fixture() {
  const mod = await import(moduleUrl)
  const authorityMod = await import(authorityUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'git-workspace-adapter-'))
  const sourceInput = path.join(root, 'computer-a-source')
  const authorityRoot = path.join(root, 'authority-store')
  const workspaceRoot = path.join(root, 'task-workspaces')
  await mkdir(sourceInput)
  const source = await require('node:fs/promises').realpath(sourceInput)
  await git(source, ['init'])
  await writeFile(path.join(source, 'README.md'), 'initial\n', 'utf8')
  const initialHead = await commit(source, 'initial')
  const adapter = new mod.GitWorkspaceAdapter({
    gitCommand, allowedGitRoot, authorityRoot, sourceWorkspaceRoot: source, workspaceRoot,
    repositoryRef: 'repository_primary01'
  })
  return { mod, authorityMod, root, source, authorityRoot, workspaceRoot, initialHead, adapter }
}
async function usingFixture(run) {
  const state = await fixture()
  try { await run(state) } finally { await rm(state.root, { recursive: true, force: true }) }
}

function declaration(inspected, suffix) { return { changeSetRef: `changeset_${String(suffix).padEnd(8, 'x')}`, repositoryRef: inspected.repositoryRef, commit: inspected.commit, parentCommit: inspected.parentCommit, diffDigest: inspected.diffDigest, treeDigest: inspected.treeDigest, files: inspected.files } }
async function createCommittedWorkspace(state, workspaceRef, content, filename = 'README.md') {
  await state.adapter.createTaskWorkspace({ workspaceRef, baseCommit: state.initialHead })
  const workspacePath = path.join(state.workspaceRoot, workspaceRef)
  await writeFile(path.join(workspacePath, filename), content, 'utf8')
  const head = await commit(workspacePath, `change ${workspaceRef}`)
  return { workspacePath, head }
}

test('cheap source probe is side-effect free and reports exact invalid, subdirectory, and dirty states', async () => usingFixture(async state => {
  const clean = await state.adapter.probeSource(); assert.equal(clean.sourceDirty, false); assert.equal(clean.statusCode, 'GIT_SOURCE_READY'); assert.equal(existsSync(state.authorityRoot), false); assert.equal(existsSync(state.workspaceRoot), false)
  await writeFile(path.join(state.source, 'dirty.txt'), 'dirty\n'); const dirty = await state.adapter.probeSource(); assert.equal(dirty.sourceDirty, true); assert.equal(dirty.statusCode, 'GIT_SOURCE_DIRTY'); assert.equal(existsSync(state.authorityRoot), false)
  const nonGit = path.join(state.root, 'non-git'), subdir = path.join(state.source, 'subdir'); await mkdir(nonGit); await mkdir(subdir); const make = sourceWorkspaceRoot => new state.mod.GitWorkspaceAdapter({ gitCommand, allowedGitRoot, authorityRoot: state.authorityRoot, sourceWorkspaceRoot, workspaceRoot: state.workspaceRoot, repositoryRef: 'repository_probe0001' }); await assert.rejects(make(nonGit).probeSource(), error => error.code === 'GIT_SOURCE_INVALID'); await assert.rejects(make(subdir).probeSource(), error => error.code === 'GIT_SOURCE_INVALID'); assert.equal(existsSync(state.authorityRoot), false)
}))

test('bare authority import and isolated worktrees never mutate Computer A source', async () => usingFixture(async state => {
  await writeFile(path.join(state.source, 'local-only.txt'), 'uncommitted on Computer A\n', 'utf8')
  const initialized = await state.adapter.initialize({ expectedInitialHead: state.initialHead })
  assert.equal(initialized.headCommit, state.initialHead)
  assert.equal(initialized.sourceDirty, true)
  assert.equal(initialized.objectFormat, 'sha1')
  assert.equal(JSON.stringify(state.adapter).includes(state.source), false)
  assert.equal(JSON.stringify(state.adapter).includes(gitCommand), false)

  const workspaceRef = 'workspace_taskalpha01'
  await createCommittedWorkspace(state, workspaceRef, 'isolated change\n')
  const inspected = await state.adapter.inspectChangeSet({ workspaceRef, expectedBaseCommit: state.initialHead })
  assert.equal(inspected.parentCommit, state.initialHead)
  assert.deepEqual(inspected.files, ['README.md'])
  assert.match(inspected.diffDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.match(inspected.treeDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.equal(await readFile(path.join(state.source, 'README.md'), 'utf8'), 'initial\n')
  assert.equal(await readFile(path.join(state.source, 'local-only.txt'), 'utf8'), 'uncommitted on Computer A\n')
  assert.equal(await git(state.source, ['rev-parse', 'HEAD']), state.initialHead)
}))

test('bundle import writes every partial byte and zero progress never binds a ChangeSet ref', async () => usingFixture(async state => {
  await state.adapter.initialize(); const workspaceRef = 'workspace_bundlewrite1'; await createCommittedWorkspace(state, workspaceRef, 'bundle write all\n'); const inspected = await state.adapter.inspectChangeSet({ workspaceRef, expectedBaseCommit: state.initialHead }), changeSet = declaration(inspected, 'bundlewrite')
  const { ArtifactContentAddressedStore } = await import(casUrl), cas = new ArtifactContentAddressedStore({ objectRoot: path.join(state.root, 'cas-objects'), stagingRoot: path.join(state.root, 'cas-staging'), projectRef: 'project_bundlewrite', encryptionKey: Buffer.alloc(32, 7) }); await cas.initialize(); const bundle = await state.adapter.exportChangeSetBundle({ changeSet, workspaceRef, cas })
  const makeReceiver = async (suffix, openImpl) => { const authorityRoot = path.join(state.root, `authority-${suffix}`), workspaceRoot = path.join(state.root, `workspaces-${suffix}`), adapter = new state.mod.GitWorkspaceAdapter({ gitCommand, allowedGitRoot, authorityRoot, sourceWorkspaceRoot: state.source, workspaceRoot, repositoryRef: 'repository_primary01', openImpl }); await adapter.initialize({ expectedInitialHead: state.initialHead }); return { adapter, authorityRoot } }
  const partial = await makeReceiver('partial', async (file, flags, mode) => { const handle = await open(file, flags, mode); return { write: (buffer, offset, length, position) => handle.write(buffer, offset, Math.max(1, Math.ceil(length / 3)), position), sync: () => handle.sync(), close: () => handle.close() } }); assert.equal((await partial.adapter.importChangeSetBundle({ changeSet, bundleDigest: bundle.bundleDigest, cas })).admitted, true)
  const zero = await makeReceiver('zero', async (file, flags, mode) => { const handle = await open(file, flags, mode); return { write: async () => ({ bytesWritten: 0 }), sync: () => handle.sync(), close: () => handle.close() } }); await assert.rejects(zero.adapter.importChangeSetBundle({ changeSet, bundleDigest: bundle.bundleDigest, cas }), /made no progress/u); await assert.rejects(git(state.root, ['--git-dir', path.join(zero.authorityRoot, 'repositories', 'repository_primary01.git'), 'rev-parse', '--verify', `refs/harness/change-sets/${changeSet.changeSetRef}`])); await cas.close()
}))

test('bound ChangeSet export survives workspace close and adapter restart while drift and CAS failure fail closed', async () => usingFixture(async state => {
  await state.adapter.initialize(); const workspaceRef = 'workspace_boundexport1'; await createCommittedWorkspace(state, workspaceRef, 'bound export\n'); const inspected = await state.adapter.inspectChangeSet({ workspaceRef, expectedBaseCommit: state.initialHead }), changeSet = declaration(inspected, 'boundexport'); const { ArtifactContentAddressedStore } = await import(casUrl), cas = new ArtifactContentAddressedStore({ objectRoot: path.join(state.root, 'bound-cas-objects'), stagingRoot: path.join(state.root, 'bound-cas-staging'), projectRef: 'project_boundexport', encryptionKey: Buffer.alloc(32, 8) }); await cas.initialize(); const first = await state.adapter.exportChangeSetBundle({ changeSet, workspaceRef, cas }); await state.adapter.closeTaskWorkspace({ workspaceRef }); await state.adapter.close();
  const restarted = new state.mod.GitWorkspaceAdapter({ gitCommand, allowedGitRoot, authorityRoot: state.authorityRoot, sourceWorkspaceRoot: state.source, workspaceRoot: state.workspaceRoot, repositoryRef: 'repository_primary01' }); await restarted.initialize(); const replay = await restarted.exportBoundChangeSetBundle({ changeSet, cas }); assert.deepEqual(replay, first); assert.equal(existsSync(path.join(state.workspaceRoot, workspaceRef)), false); await assert.rejects(restarted.exportBoundChangeSetBundle({ changeSet: { ...changeSet, files: ['other.txt'] }, cas }), /exact declared ChangeSet|declaration/u)
  const originalBegin = cas.beginUpload.bind(cas); cas.beginUpload = async () => { throw new Error('injected CAS failure') }; await assert.rejects(restarted.exportBoundChangeSetBundle({ changeSet, cas }), /injected CAS failure/u); cas.beginUpload = originalBegin
  const repositoryPath = path.join(state.authorityRoot, 'repositories', 'repository_primary01.git'); await git(state.root, ['--git-dir', repositoryPath, 'update-ref', `refs/harness/change-sets/${changeSet.changeSetRef}`, state.initialHead]); await assert.rejects(restarted.exportBoundChangeSetBundle({ changeSet, cas }), /drifted/u); await restarted.close(); await cas.close()
}))

test('ensure and close task workspace recover strictly without accepting dirty, wrong-head, or foreign registrations', async () => usingFixture(async state => {
  await state.adapter.initialize(); const ref = 'workspace_ensuretask01', first = await state.adapter.ensureTaskWorkspace({ workspaceRef: ref, baseCommit: state.initialHead }); assert.equal(first.created, true); assert.equal((await state.adapter.ensureTaskWorkspace({ workspaceRef: ref, baseCommit: state.initialHead })).created, false); assert.equal(JSON.stringify(first).includes(state.workspaceRoot), false)
  const workspacePath = path.join(state.workspaceRoot, ref); await writeFile(path.join(workspacePath, 'dirty.txt'), 'dirty\n'); await assert.rejects(state.adapter.ensureTaskWorkspace({ workspaceRef: ref, baseCommit: state.initialHead }), /clean/u); const closed = await state.adapter.closeTaskWorkspace({ workspaceRef: ref }); assert.equal(closed.removed, true); assert.equal((await state.adapter.closeTaskWorkspace({ workspaceRef: ref })).removed, false)
  const wrongRef = 'workspace_wronghead01'; await createCommittedWorkspace(state, wrongRef, 'wrong head\n'); await assert.rejects(state.adapter.ensureTaskWorkspace({ workspaceRef: wrongRef, baseCommit: state.initialHead }), /HEAD does not match/u); await state.adapter.closeTaskWorkspace({ workspaceRef: wrongRef })
  const foreignRef = 'workspace_foreignrepo1', foreignPath = path.join(state.workspaceRoot, foreignRef); await git(state.source, ['worktree', 'add', '--detach', foreignPath, state.initialHead]); await assert.rejects(state.adapter.ensureTaskWorkspace({ workspaceRef: foreignRef, baseCommit: state.initialHead }), /another repository/u); await git(state.source, ['worktree', 'remove', '--force', foreignPath])
}))

test('real Git ChangeSet and MergeGroup bind into Workspace Authority and land by head CAS', async () => usingFixture(async state => {
  await state.adapter.initialize()
  const workspaceRef = 'workspace_taskmerge01'
  const { workspacePath } = await createCommittedWorkspace(state, workspaceRef, 'merged authority content\n')
  const authority = new state.authorityMod.WorkspaceAuthority({
    projectRef: 'project_adapter01', repositoryRef: 'repository_primary01',
    authorityRoot: state.authorityRoot, sourceWorkspaceRoot: state.source, workspaceRoot: state.workspaceRoot,
    initialHead: state.initialHead, secret: 'workspace-adapter-secret-with-twenty-four-characters', now: () => 100_000_000
  })
  const lease = authority.openWorkspace({ collaboratorRef: 'collaborator_adapter01', taskRef: 'task_adapter01', workspacePath, baseCommit: state.initialHead })
  const claim = authority.claimResources({ workspaceRef: lease.workspaceRef, mode: 'write', resources: ['README.md'] })
  const inspected = await state.adapter.inspectChangeSet({ workspaceRef, expectedBaseCommit: state.initialHead })
  const changeSet = authority.publishChangeSet({
    workspaceRef: lease.workspaceRef, commit: inspected.commit, parentCommit: inspected.parentCommit,
    diffDigest: inspected.diffDigest, treeDigest: inspected.treeDigest, files: inspected.files,
    claimRefs: [claim.claimRef], message: 'real Git adapter ChangeSet'
  })
  authority.enqueueChangeSet(changeSet.changeSetRef)
  const group = authority.planMergeGroup()
  const merged = await state.adapter.mergeChangeSets({ mergeGroupRef: group.mergeGroupRef, baseHead: group.baseHead, changeSets: [changeSet] })
  assert.equal(merged.merged, true)
  authority.recordMergeResult({ mergeGroupRef: group.mergeGroupRef, resultCommit: merged.resultCommit, treeDigest: merged.treeDigest })
  await assert.rejects(state.adapter.compareAndSwapHead({ mergeGroupRef: group.mergeGroupRef, expectedHead: group.baseHead, resultCommit: state.initialHead }), /not bound to the exact merge group/u)
  const landed = await state.adapter.compareAndSwapHead({ mergeGroupRef: group.mergeGroupRef, expectedHead: group.baseHead, resultCommit: merged.resultCommit })
  assert.equal(landed.headCommit, merged.resultCommit)
  assert.equal(await state.adapter.head(), merged.resultCommit)
  assert.equal(await git(state.source, ['rev-parse', 'HEAD']), state.initialHead)
  assert.equal(await readFile(path.join(state.source, 'README.md'), 'utf8'), 'initial\n')
  await assert.rejects(state.adapter.compareAndSwapHead({ mergeGroupRef: group.mergeGroupRef, expectedHead: group.baseHead, resultCommit: merged.resultCommit }), error => error?.code === 'AUTHORITY_HEAD_CONFLICT')
}))

test('merge receipt is immutable, receipt-first, ordered, race-safe, and fails closed on tamper', async () => usingFixture(async state => {
  await state.adapter.initialize(); const leftRef = 'workspace_receiptleft', rightRef = 'workspace_receiptright'; await createCommittedWorkspace(state, leftRef, 'left\n', 'left.txt'); await createCommittedWorkspace(state, rightRef, 'right\n', 'right.txt')
  const left = declaration(await state.adapter.inspectChangeSet({ workspaceRef: leftRef, expectedBaseCommit: state.initialHead }), 'receiptleft'), right = declaration(await state.adapter.inspectChangeSet({ workspaceRef: rightRef, expectedBaseCommit: state.initialHead }), 'receiptright'), input = { mergeGroupRef: 'mergegroup_receiptrace', baseHead: state.initialHead, changeSets: [left, right] }, repositoryPath = path.join(state.authorityRoot, 'repositories', 'repository_primary01.git'); await git(state.root, ['--git-dir', repositoryPath, 'config', 'core.logAllRefUpdates', 'always'])
  const second = new state.mod.GitWorkspaceAdapter({ gitCommand, allowedGitRoot, authorityRoot: state.authorityRoot, sourceWorkspaceRoot: state.source, workspaceRoot: state.workspaceRoot, repositoryRef: 'repository_primary01' }); await second.initialize()
  const [winnerA, winnerB] = await Promise.all([state.adapter.mergeChangeSets(input), second.mergeChangeSets(input)]); assert.deepEqual(winnerA, winnerB); assert.equal(winnerA.merged, true); assert.deepEqual(await state.adapter.readAndVerifyMergeGroupResult(input), winnerA); assert.deepEqual(await state.adapter.mergeChangeSets(input), winnerA); const receiptRef = `refs/harness/merge-groups/${input.mergeGroupRef}`, receiptLog = await git(state.root, ['--git-dir', repositoryPath, 'reflog', 'show', '--format=%H', receiptRef]); assert.equal(receiptLog.split(/\r?\n/u).filter(Boolean).length, 1)
  assert.equal(await state.adapter.readAndVerifyMergeGroupResult({ ...input, mergeGroupRef: 'mergegroup_absent0001' }), undefined); await assert.rejects(state.adapter.readAndVerifyMergeGroupResult({ ...input, changeSets: [right, left] }), /reordered|declared ChangeSet/u); await assert.rejects(state.adapter.readAndVerifyMergeGroupResult({ ...input, changeSets: [{ ...left, files: ['other.txt'] }, right] }), /exact declared ChangeSet/u)
  await git(state.root, ['--git-dir', repositoryPath, 'update-ref', `refs/harness/merge-groups/${input.mergeGroupRef}`, state.initialHead]); await assert.rejects(state.adapter.readAndVerifyMergeGroupResult(input), /commit count|receipt/u); await second.close()
}))

test('semantic drift in a successful cherry-pick is rejected before the immutable receipt bind', async () => usingFixture(async state => {
  await state.adapter.initialize(); const upperRef = 'workspace_semanticup1', lowerRef = 'workspace_semanticlow1'; await createCommittedWorkspace(state, upperRef, 'upper\ninitial\n'); await createCommittedWorkspace(state, lowerRef, 'initial\nlower\n'); const upper = declaration(await state.adapter.inspectChangeSet({ workspaceRef: upperRef, expectedBaseCommit: state.initialHead }), 'semanticup'), lower = declaration(await state.adapter.inspectChangeSet({ workspaceRef: lowerRef, expectedBaseCommit: state.initialHead }), 'semanticlow'), mergeGroupRef = 'mergegroup_semanticdrift'
  await assert.rejects(state.adapter.mergeChangeSets({ mergeGroupRef, baseHead: state.initialHead, changeSets: [upper, lower] }), /changed or reordered/u); await assert.rejects(git(state.root, ['--git-dir', path.join(state.authorityRoot, 'repositories', 'repository_primary01.git'), 'rev-parse', '--verify', `refs/harness/merge-groups/${mergeGroupRef}`]))
}))

test('dirty workspaces and conflicting commits fail closed without advancing authority', async () => usingFixture(async state => {
  await state.adapter.initialize()
  const dirtyRef = 'workspace_dirtytask01'
  await state.adapter.createTaskWorkspace({ workspaceRef: dirtyRef, baseCommit: state.initialHead })
  await writeFile(path.join(state.workspaceRoot, dirtyRef, 'README.md'), 'not committed\n', 'utf8')
  await assert.rejects(state.adapter.inspectChangeSet({ workspaceRef: dirtyRef, expectedBaseCommit: state.initialHead }), /must be clean/u)

  const leftRef = 'workspace_conflictleft'
  const rightRef = 'workspace_conflictright'
  await createCommittedWorkspace(state, leftRef, 'left version\n')
  await createCommittedWorkspace(state, rightRef, 'right version\n')
  const left = await state.adapter.inspectChangeSet({ workspaceRef: leftRef, expectedBaseCommit: state.initialHead })
  const right = await state.adapter.inspectChangeSet({ workspaceRef: rightRef, expectedBaseCommit: state.initialHead })
  const merge = await state.adapter.mergeChangeSets({
    mergeGroupRef: 'mergegroup_conflict01', baseHead: state.initialHead, changeSets: [declaration(left, 'left'), declaration(right, 'right')]
  })
  assert.equal(merge.merged, false)
  assert.deepEqual(merge.conflicts, ['README.md'])
  assert.equal(await state.adapter.head(), state.initialHead)
}))

test('adapter rejects overlapping authority/source/workspace roots and untrusted Git executables', async () => usingFixture(async state => {
  assert.throws(() => new state.mod.GitWorkspaceAdapter({
    gitCommand, allowedGitRoot, authorityRoot: state.source, sourceWorkspaceRoot: state.source,
    workspaceRoot: state.workspaceRoot, repositoryRef: 'repository_invalid01'
  }), /must be disjoint/u)
  const adapter = new state.mod.GitWorkspaceAdapter({
    gitCommand, allowedGitRoot: state.root, authorityRoot: state.authorityRoot,
    sourceWorkspaceRoot: state.source, workspaceRoot: state.workspaceRoot, repositoryRef: 'repository_invalid02'
  })
  await assert.rejects(adapter.initialize(), error => error.code === 'GIT_SOURCE_INVALID')
  await assert.rejects(state.adapter.createTaskWorkspace({ workspaceRef: '../escape', baseCommit: state.initialHead }), /safe opaque reference/u)
}))

test('close drains an accepted Git child, rejects new work, and is exactly idempotent', async () => usingFixture(async state => {
  await state.adapter.initialize({ expectedInitialHead: state.initialHead })
  const accepted = state.adapter.head()
  const closing = state.adapter.close()
  assert.equal(state.adapter.close(), closing)
  await assert.rejects(state.adapter.head(), error => error.code === 'GIT_WORKSPACE_ADAPTER_CLOSED')
  assert.equal(await accepted, state.initialHead)
  await closing
  assert.equal(state.adapter.toJSON().ready, false)
}))
