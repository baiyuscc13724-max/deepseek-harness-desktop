const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { execFile, execFileSync } = require('node:child_process')
const { existsSync, realpathSync } = require('node:fs')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const execFileAsync = promisify(execFile)
const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'git-workspace-adapter.js')).href
const authorityUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'workspace-authority.js')).href
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
  const source = path.join(root, 'computer-a-source')
  const authorityRoot = path.join(root, 'authority-store')
  const workspaceRoot = path.join(root, 'task-workspaces')
  await mkdir(source)
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

async function createCommittedWorkspace(state, workspaceRef, content, filename = 'README.md') {
  await state.adapter.createTaskWorkspace({ workspaceRef, baseCommit: state.initialHead })
  const workspacePath = path.join(state.workspaceRoot, workspaceRef)
  await writeFile(path.join(workspacePath, filename), content, 'utf8')
  const head = await commit(workspacePath, `change ${workspaceRef}`)
  return { workspacePath, head }
}

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
    mergeGroupRef: 'mergegroup_conflict01', baseHead: state.initialHead, changeSets: [left, right]
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
  await assert.rejects(adapter.initialize(), /outside the fixed allowed runtime root/u)
  await assert.rejects(state.adapter.createTaskWorkspace({ workspaceRef: '../escape', baseCommit: state.initialHead }), /safe opaque reference/u)
}))
