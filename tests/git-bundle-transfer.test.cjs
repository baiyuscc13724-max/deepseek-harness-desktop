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
const gitUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'git-workspace-adapter.js')).href
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
const REPOSITORY = 'repository_bundle01'

async function git(cwd, args) {
  const result = await execFileAsync(gitCommand, args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } })
  return String(result.stdout).trim()
}
async function commit(cwd, message) {
  await git(cwd, ['add', '-A'])
  await git(cwd, ['-c', 'user.name=Bundle Test', '-c', 'user.email=bundle@localhost', 'commit', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}
async function fixture() {
  const gitMod = await import(gitUrl)
  const casMod = await import(casUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'git-bundle-transfer-'))
  const source = path.join(root, 'computer-a-source')
  await mkdir(source)
  await git(source, ['init'])
  await writeFile(path.join(source, 'README.md'), 'initial source\n', 'utf8')
  const initialHead = await commit(source, 'initial')
  function adapter(name) {
    return new gitMod.GitWorkspaceAdapter({
      gitCommand, allowedGitRoot,
      authorityRoot: path.join(root, `${name}-authority`), sourceWorkspaceRoot: source,
      workspaceRoot: path.join(root, `${name}-workspaces`), repositoryRef: REPOSITORY,
      maxBundleBytes: 8 * 1024 * 1024
    })
  }
  const sender = adapter('sender')
  const receiver = adapter('receiver')
  await sender.initialize()
  await receiver.initialize()
  const cas = new casMod.ArtifactContentAddressedStore({ objectRoot: path.join(root, 'cas-objects'), stagingRoot: path.join(root, 'cas-staging'), maxObjectBytes: 8 * 1024 * 1024 })
  await cas.initialize()
  return { gitMod, casMod, root, source, initialHead, sender, receiver, cas, adapter }
}
async function usingFixture(run) {
  const state = await fixture()
  try { await run(state) } finally { await state.cas.close(); await rm(state.root, { recursive: true, force: true }) }
}
async function makeChangeSet(state) {
  const workspaceRef = 'workspace_bundlework01'
  await state.sender.createTaskWorkspace({ workspaceRef, baseCommit: state.initialHead })
  const workspacePath = path.join(state.root, 'sender-workspaces', workspaceRef)
  await writeFile(path.join(workspacePath, 'remote.txt'), 'remote collaborator content\n', 'utf8')
  await commit(workspacePath, 'remote change')
  const inspected = await state.sender.inspectChangeSet({ workspaceRef, expectedBaseCommit: state.initialHead })
  return {
    workspaceRef,
    changeSet: {
      changeSetRef: `changeset_${'B'.repeat(26)}`,
      repositoryRef: REPOSITORY,
      commit: inspected.commit,
      baseCommit: inspected.parentCommit,
      diffDigest: inspected.diffDigest,
      treeDigest: inspected.treeDigest,
      files: inspected.files
    }
  }
}

test('remote bundle export enters CAS and imports only the exact declared ChangeSet', async () => usingFixture(async state => {
  const { workspaceRef, changeSet } = await makeChangeSet(state)
  const exported = await state.sender.exportChangeSetBundle({ changeSet, workspaceRef, cas: state.cas })
  assert.match(exported.bundleDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.ok(exported.bundleSize > 0)
  assert.equal(JSON.stringify(exported).includes(state.root), false)
  assert.equal((await state.cas.inspect(exported.bundleDigest)).present, true)

  const [admitted, duplicate] = await Promise.all([
    state.receiver.importChangeSetBundle({ changeSet, bundleDigest: exported.bundleDigest, cas: state.cas }),
    state.receiver.importChangeSetBundle({ changeSet, bundleDigest: exported.bundleDigest, cas: state.cas })
  ])
  assert.equal(admitted.admitted, true)
  assert.equal(admitted.commit, changeSet.commit)
  assert.deepEqual(admitted.files, ['remote.txt'])
  assert.deepEqual(duplicate, admitted)

  const merged = await state.receiver.mergeChangeSets({ mergeGroupRef: 'mergegroup_remotebundle01', baseHead: state.initialHead, changeSets: [admitted] })
  assert.equal(merged.merged, true)
  assert.equal(await git(state.source, ['rev-parse', 'HEAD']), state.initialHead)
  assert.equal(await readFile(path.join(state.source, 'README.md'), 'utf8'), 'initial source\n')
}))

test('bundle admission recomputes parent, file set, diff digest, and tree digest', async () => usingFixture(async state => {
  const { workspaceRef, changeSet } = await makeChangeSet(state)
  const exported = await state.sender.exportChangeSetBundle({ changeSet, workspaceRef, cas: state.cas })
  for (const [field, value] of [
    ['diffDigest', `sha256:${'0'.repeat(64)}`],
    ['treeDigest', `sha256:${'1'.repeat(64)}`],
    ['files', ['wrong.txt']],
    ['baseCommit', 'f'.repeat(40)]
  ]) {
    const receiver = state.adapter(`reject-${field}`)
    await receiver.initialize()
    await assert.rejects(receiver.importChangeSetBundle({ changeSet: { ...changeSet, [field]: value }, bundleDigest: exported.bundleDigest, cas: state.cas }), /exact declared ChangeSet|parent does not match/u)
  }
}))

test('bundle ref substitution, wrong repository, missing CAS content, and size limits fail closed', async () => usingFixture(async state => {
  const { workspaceRef, changeSet } = await makeChangeSet(state)
  const exported = await state.sender.exportChangeSetBundle({ changeSet, workspaceRef, cas: state.cas })
  await assert.rejects(state.receiver.importChangeSetBundle({ changeSet: { ...changeSet, changeSetRef: `changeset_${'C'.repeat(26)}` }, bundleDigest: exported.bundleDigest, cas: state.cas }), /bounded Git operation failed/u)
  await assert.rejects(state.receiver.importChangeSetBundle({ changeSet: { ...changeSet, repositoryRef: 'repository_other01' }, bundleDigest: exported.bundleDigest, cas: state.cas }), /another repository/u)
  await assert.rejects(state.receiver.importChangeSetBundle({ changeSet, bundleDigest: `sha256:${'9'.repeat(64)}`, cas: state.cas }), /unavailable/u)

  const limited = new state.gitMod.GitWorkspaceAdapter({
    gitCommand, allowedGitRoot, authorityRoot: path.join(state.root, 'limited-authority'), sourceWorkspaceRoot: state.source,
    workspaceRoot: path.join(state.root, 'limited-workspaces'), repositoryRef: REPOSITORY, maxBundleBytes: 8
  })
  await limited.initialize()
  await assert.rejects(limited.importChangeSetBundle({ changeSet, bundleDigest: exported.bundleDigest, cas: state.cas }), /exceeds its bound/u)
}))
