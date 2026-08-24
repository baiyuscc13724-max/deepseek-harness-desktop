const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'desktop-git-capability.js')).href

async function fixture(run) {
  const mod = await import(moduleUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-git-capability-'))
  const commandDir = path.join(root, 'cmd')
  const command = path.join(commandDir, process.platform === 'win32' ? 'git.exe' : 'git')
  await mkdir(commandDir)
  await writeFile(command, 'fixture')
  try { await run({ mod, root, command, commandDir }) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('consumes Host env immediately, validates real paths, freezes capability, and redacts JSON', async () => fixture(async ({ mod, root, command }) => {
  const env = { [mod.GIT_AUTHORITY_COMMAND_ENV]: command, [mod.GIT_AUTHORITY_ROOT_ENV]: root, PATH: '/attacker' }
  const pending = mod.consumeDesktopGitCapability({ env })
  assert.equal(env[mod.GIT_AUTHORITY_COMMAND_ENV], undefined)
  assert.equal(env[mod.GIT_AUTHORITY_ROOT_ENV], undefined)
  assert.equal(env.PATH, '/attacker')
  const capability = await pending
  assert.equal(capability.gitCommand, await require('node:fs/promises').realpath(command))
  assert.equal(capability.allowedGitRoot, await require('node:fs/promises').realpath(root))
  assert.equal(Object.isFrozen(capability), true)
  assert.deepEqual(Object.keys(capability), [])
  assert.deepEqual(JSON.parse(JSON.stringify(capability)), { available: true })
  assert.equal(JSON.stringify(capability).includes(root), false)
}))

test('missing dedicated env is unavailable and never falls back to PATH', async () => fixture(async ({ mod, command }) => {
  const env = { PATH: path.dirname(command) }
  await assert.rejects(mod.consumeDesktopGitCapability({ env }), error => error.code === 'PROJECT_FOUNDATION_GIT_UNAVAILABLE')
  assert.equal(env.PATH, path.dirname(command))
}))

test('wrong executable basename, missing path, and filesystem type mismatch are untrusted', async () => fixture(async ({ mod, root, commandDir }) => {
  const wrong = path.join(commandDir, process.platform === 'win32' ? 'bash.exe' : 'bash')
  await writeFile(wrong, 'fixture')
  const consume = (command, authorityRoot = root, extra = {}) => mod.consumeDesktopGitCapability({
    env: { [mod.GIT_AUTHORITY_COMMAND_ENV]: command, [mod.GIT_AUTHORITY_ROOT_ENV]: authorityRoot }, ...extra
  })
  await assert.rejects(consume(wrong), error => error.code === 'PROJECT_FOUNDATION_GIT_UNTRUSTED')
  await assert.rejects(consume(path.join(commandDir, process.platform === 'win32' ? 'missing-git.exe' : 'missing-git')), error => error.code === 'PROJECT_FOUNDATION_GIT_UNTRUSTED')
  await assert.rejects(consume(root, root), error => error.code === 'PROJECT_FOUNDATION_GIT_UNTRUSTED')
}))

test('realpath escape is rejected even when lexical command is under the allowed root', async () => fixture(async ({ mod, root, command }) => {
  const outsideRoot = `${root}-outside`
  const outside = path.join(outsideRoot, process.platform === 'win32' ? 'git.exe' : 'git')
  await mkdir(outsideRoot)
  await writeFile(outside, 'outside')
  const env = { [mod.GIT_AUTHORITY_COMMAND_ENV]: command, [mod.GIT_AUTHORITY_ROOT_ENV]: root }
  await assert.rejects(mod.consumeDesktopGitCapability({
    env,
    realpathImpl: async value => value === command ? outside : value,
    statImpl: async value => ({ isFile: () => value === outside, isDirectory: () => value === root })
  }), error => error.code === 'PROJECT_FOUNDATION_GIT_UNTRUSTED')
  assert.equal(env[mod.GIT_AUTHORITY_COMMAND_ENV], undefined)
  assert.equal(env[mod.GIT_AUTHORITY_ROOT_ENV], undefined)
  await rm(outsideRoot, { recursive: true, force: true })
}))

test('Windows containment is explicitly case-insensitive and rejects siblings', async () => {
  const { isSameOrWithinGitRoot } = await import(moduleUrl)
  assert.equal(isSameOrWithinGitRoot('C:\\Program Files\\Git', 'c:\\PROGRAM FILES\\git\\cmd\\git.exe', 'win32'), true)
  assert.equal(isSameOrWithinGitRoot('C:\\Program Files\\Git', 'C:\\Program Files\\Git-Evil\\cmd\\git.exe', 'win32'), false)
  assert.equal(isSameOrWithinGitRoot('C:\\Program Files\\Git', 'D:\\Program Files\\Git\\cmd\\git.exe', 'win32'), false)
})

test('an environment that prevents one-time consumption fails closed with the fixed untrusted code', async () => {
  const mod = await import(moduleUrl)
  const env = {}
  Object.defineProperty(env, mod.GIT_AUTHORITY_COMMAND_ENV, { value: '/usr/bin/git', configurable: false })
  await assert.rejects(mod.consumeDesktopGitCapability({ env }), error => error.code === 'PROJECT_FOUNDATION_GIT_UNTRUSTED')
})

test('partial env is consumed and reported unavailable without retaining either field', async () => {
  const mod = await import(moduleUrl)
  const env = { [mod.GIT_AUTHORITY_COMMAND_ENV]: '/usr/bin/git' }
  const pending = mod.consumeDesktopGitCapability({ env })
  assert.equal(env[mod.GIT_AUTHORITY_COMMAND_ENV], undefined)
  assert.equal(env[mod.GIT_AUTHORITY_ROOT_ENV], undefined)
  await assert.rejects(pending, error => error.code === 'PROJECT_FOUNDATION_GIT_UNAVAILABLE')
})
