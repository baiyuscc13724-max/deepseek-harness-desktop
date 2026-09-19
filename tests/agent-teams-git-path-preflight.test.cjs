'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { pathToFileURL } = require('node:url')
const exec = promisify(execFile)
const root = path.resolve(__dirname, '..')
const gitCommand = path.join(root, 'third_party/mingit/cmd/git.exe')

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'git-budget-')))
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }))
  const source = path.join(directory, 'source'), home = path.join(directory, 'home')
  await fs.mkdir(source); await fs.mkdir(home)
  const env = {}
  for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH']) if (process.env[name]) env[name] = process.env[name]
  Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: home, TMP: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_CONFIG_SYSTEM: 'NUL', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' })
  const git = args => exec(gitCommand, ['-c', 'core.longpaths=true', ...args], { cwd: source, env, timeout: 10000, windowsHide: true })
  await git(['init']); await fs.writeFile(path.join(source, 'README.md'), 'unmodified source fixture\n')
  await git(['add', 'README.md']); await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'fixture'])
  const before = (await git(['rev-parse', 'HEAD'])).stdout
  const { GitWorkspaceAdapter } = await import(pathToFileURL(path.join(root, 'plugins/dsh-agent-teams/lib/git-workspace-adapter.js')).href)
  return { directory, source, env, git, before, GitWorkspaceAdapter }
}

test('Windows Git long authority rejection is actual-binary read-only preflight with no half repository', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const fx = await fixture(t)
  const padding = Math.max(10, 165 - fx.directory.length)
  const authorityRoot = path.join(fx.directory, 'deep-' + 'x'.repeat(padding), 'authority'), workspaceRoot = path.join(fx.directory, 'worktrees'), calls = []
  const adapter = new fx.GitWorkspaceAdapter({ gitCommand, allowedGitRoot: path.join(root, 'third_party/mingit'), authorityRoot, workspaceRoot, sourceWorkspaceRoot: fx.source, repositoryRef: 'repository_' + 'R'.repeat(26), env: fx.env,
    spawnImpl(command, args, options) { calls.push(args); return spawn(command, args, options) } })
  try {
    await assert.rejects(adapter.initialize(), error => error.code === 'GIT_ADMIN_PATH_TOO_LONG' && /No repository\/worktree write was started/.test(error.message))
    assert.ok(calls.some(args => args.includes('rev-parse') && args.includes(adapter.repositoryPath)))
    assert.equal(calls.some(args => args.includes('init') || args.includes('fetch') || args.includes('worktree')), false)
    await assert.rejects(fs.stat(authorityRoot), { code: 'ENOENT' })
    await assert.rejects(fs.stat(workspaceRoot), { code: 'ENOENT' })
    assert.equal((await fx.git(['rev-parse', 'HEAD'])).stdout, fx.before)
    assert.equal((await fx.git(['status', '--porcelain'])).stdout, '')
  } finally { await adapter.close() }
})

test('Windows Git long worktree rejects before prune/add while a normal lifecycle stays usable', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const fx = await fixture(t), calls = []
  const padding = Math.max(10, 205 - fx.directory.length)
  const workspaceRoot = path.join(fx.directory, 'worktrees-' + 'x'.repeat(padding))
  const adapter = new fx.GitWorkspaceAdapter({ gitCommand, allowedGitRoot: path.join(root, 'third_party/mingit'), authorityRoot: path.join(fx.directory, 'authority'), workspaceRoot, sourceWorkspaceRoot: fx.source, repositoryRef: 'repository_fixture01', env: fx.env,
    spawnImpl(command, args, options) { calls.push(args); return spawn(command, args, options) } })
  try {
    const initial = await adapter.initialize(); calls.length = 0
    const workspaceRef = 'workspace_' + 'W'.repeat(32)
    await assert.rejects(adapter.ensureTaskWorkspace({ workspaceRef, baseCommit: initial.headCommit }), error => error.code === 'GIT_ADMIN_PATH_TOO_LONG')
    assert.equal(calls.some(args => args.includes('worktree')), false)
    assert.deepEqual(await fs.readdir(workspaceRoot), [])
    assert.equal((await fx.git(['rev-parse', 'HEAD'])).stdout, fx.before)
    assert.equal(await adapter.head(), initial.headCommit)
  } finally { await adapter.close() }
  const normal = new fx.GitWorkspaceAdapter({ gitCommand, allowedGitRoot: path.join(root, 'third_party/mingit'), authorityRoot: path.join(fx.directory, 'normal-authority'), workspaceRoot: path.join(fx.directory, 'normal-worktrees'), sourceWorkspaceRoot: fx.source, repositoryRef: 'repository_normal01', env: fx.env })
  try {
    const initial = await normal.initialize(), workspaceRef = 'workspace_normal01'
    assert.equal((await normal.ensureTaskWorkspace({ workspaceRef, baseCommit: initial.headCommit })).created, true)
    assert.equal(await fs.readFile(path.join(fx.directory, 'normal-worktrees', workspaceRef, 'README.md'), 'utf8'), 'unmodified source fixture\n')
    await normal.closeTaskWorkspace({ workspaceRef })
    await assert.rejects(fs.stat(path.join(fx.directory, 'normal-worktrees', workspaceRef)), { code: 'ENOENT' })
  } finally { await normal.close() }
})
