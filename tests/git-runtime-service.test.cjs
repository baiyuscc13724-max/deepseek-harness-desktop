const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const {
  GIT_AUTHORITY_COMMAND_ENV,
  GIT_AUTHORITY_ROOT_ENV,
  PUBLIC_ACTIONS,
  buildGitEnvironment,
  buildRuntimeGitEnvironment,
  bundledGcmCandidates,
  bundledGitCandidates,
  bundledGitInstallMarkerCandidates,
  createGitRuntimeService,
  parseGcmVersion,
  parseGitVersion,
  parseSshAgentStatus,
  resolveBundledGit,
  resolveGitAuthorityCapability,
  resolveSystemGit,
  systemGitCandidates
} = require('../electron/bridge/git-runtime-service.cjs')

function fakeChild({ stdout = '', stderr = '', code = 0, neverClose = false } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = () => { child.killed = true; return true }
  process.nextTick(() => {
    child.emit('spawn')
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    if (stderr) child.stderr.emit('data', Buffer.from(stderr))
    if (!neverClose) child.emit('close', code)
  })
  return child
}

const win = path.win32
const resources = 'C:\\Harness\\resources'
const bundled = win.join(resources, 'third_party', 'mingit', 'cmd', 'git.exe')
const bundledGcm = win.join(resources, 'third_party', 'mingit', 'gcm', 'git-credential-manager.exe')
const system = 'C:\\Program Files\\Git\\cmd\\git.exe'
const sc = 'C:\\Windows\\System32\\sc.exe'
const ssh = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe'

function winExists(value) {
  const expected = new Set([bundled, bundledGcm, system, sc, ssh].map(item => win.resolve(item).toLowerCase()))
  return expected.has(win.resolve(value).toLowerCase())
}

test('bundled resolver only considers fixed resources/third_party MinGit layouts', () => {
  const candidates = bundledGitCandidates(resources, 'win32')
  assert.equal(candidates[0], bundled)
  assert.ok(candidates.every(candidate => candidate.toLowerCase().startsWith(win.resolve(resources).toLowerCase())))
  assert.deepEqual(resolveBundledGit({ resourcesPath: resources, platform: 'win32', exists: winExists }), {
    source: 'bundled', command: bundled
  })
  assert.equal(resolveBundledGit({ resourcesPath: resources, platform: 'win32', exists: () => false }), null)
  assert.equal(bundledGcmCandidates(resources, 'win32')[0], bundledGcm)
})

test('service refreshes fixed bundled paths populated after creation and exposes preparation state', async () => {
  const present = new Set()
  const exists = value => present.has(win.resolve(value).toLowerCase())
  const marker = bundledGitInstallMarkerCandidates(resources, 'win32')[0]
  const service = createGitRuntimeService({
    resourcesPath: resources,
    env: { SystemRoot: 'C:\\Windows' },
    platform: 'win32',
    exists,
    spawnImpl: (command, args) => command === bundledGcm
      ? fakeChild({ stdout: '2.7.0\n' })
      : fakeChild({ stdout: args[0] === '--version' ? 'git version 2.53.0.windows.2\n' : '' })
  })

  assert.deepEqual(service.refresh().preparation, { state: 'missing', canPrepare: true })
  present.add(win.resolve(marker).toLowerCase())
  assert.deepEqual(service.refresh().preparation, { state: 'installing', canPrepare: false })
  present.delete(win.resolve(marker).toLowerCase())
  present.add(win.resolve(bundled).toLowerCase())
  present.add(win.resolve(bundledGcm).toLowerCase())

  const status = await service.status()
  assert.deepEqual(status.git.bundled, { available: true, version: '2.53.0.windows.2' })
  assert.deepEqual(status.gcm, { available: true, version: '2.7.0', source: 'bundled' })
  assert.deepEqual(status.preparation, { state: 'ready', canPrepare: false })
})

test('system resolver checks PATH entries and conventional Git for Windows locations without a shell', () => {
  const env = {
    PATH: 'C:\\Tools;C:\\Program Files\\Git\\cmd',
    ProgramFiles: 'C:\\Program Files'
  }
  const candidates = systemGitCandidates(env, 'win32')
  assert.equal(candidates[0], 'C:\\Tools\\git.exe')
  assert.ok(candidates.includes(system))
  assert.deepEqual(resolveSystemGit({ env, platform: 'win32', exists: winExists }), {
    source: 'system', command: system
  })
})

test('Git child environment uses an allowlist and replaces prompt/config hooks', () => {
  const env = buildGitEnvironment({
    SystemRoot: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\Ada',
    TEMP: 'C:\\Temp',
    PATH: 'C:\\attacker-bin',
    GH_TOKEN: 'top-secret',
    GITHUB_TOKEN: 'top-secret-2',
    HTTP_COOKIE: 'session=secret',
    SSH_AUTH_SOCK: 'sensitive-pipe',
    GIT_ASKPASS: 'steal.exe',
    NODE_OPTIONS: '--require steal.js'
  }, { gitCommand: bundled, platform: 'win32' })

  assert.equal(Object.getPrototypeOf(env), null)
  assert.equal(env.SystemRoot, 'C:\\Windows')
  assert.equal(env.USERPROFILE, 'C:\\Users\\Ada')
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  assert.equal(env.GCM_INTERACTIVE, 'Never')
  assert.equal(env.GIT_ASKPASS, 'NUL')
  assert.equal(env.GIT_CONFIG_GLOBAL, 'NUL')
  assert.equal(env.GH_TOKEN, undefined)
  assert.equal(env.GITHUB_TOKEN, undefined)
  assert.equal(env.HTTP_COOKIE, undefined)
  assert.equal(env.SSH_AUTH_SOCK, undefined)
  assert.equal(env.NODE_OPTIONS, undefined)
  assert.doesNotMatch(env.PATH, /attacker-bin/i)
})

test('runtime environment exposes Git tools without embedding credential material', () => {
  const env = buildRuntimeGitEnvironment({ PATH: 'C:\\Windows\\System32', CUSTOM: 'kept' }, {
    gitCommand: bundled, gcmCommand: bundledGcm, sshCommand: ssh, platform: 'win32'
  })
  assert.match(env.PATH, /mingit\\gcm/i)
  assert.match(env.PATH, /mingit\\cmd/i)
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  assert.equal(env.GCM_INTERACTIVE, 'Auto')
  assert.equal(env.GIT_SSH_COMMAND, 'C:/Windows/System32/OpenSSH/ssh.exe')
  assert.equal(env.GIT_SSH_VARIANT, 'ssh')
  assert.equal(env.CUSTOM, 'kept')
  assert.doesNotMatch(JSON.stringify(env), /password|token|cookie|private.?key/i)
})

test('runtime environment overwrites forged Git authority fields with the bundled Host capability', () => {
  const fakeStat = value => ({ isFile: () => /^git\.exe$/i.test(win.basename(value)), isDirectory: () => !/^git\.exe$/i.test(win.basename(value)) })
  const service = createGitRuntimeService({
    resourcesPath: resources,
    env: { PATH: win.dirname(system), ProgramFiles: 'C:\\Program Files' },
    platform: 'win32', exists: winExists, realpath: value => win.resolve(value), stat: fakeStat
  })
  const output = service.runtimeEnvironment({
    PATH: 'C:\\Windows\\System32',
    [GIT_AUTHORITY_COMMAND_ENV]: 'C:\\attacker\\git.exe',
    [GIT_AUTHORITY_ROOT_ENV]: 'C:\\attacker'
  })
  assert.equal(output[GIT_AUTHORITY_COMMAND_ENV], bundled)
  assert.equal(output[GIT_AUTHORITY_ROOT_ENV], win.dirname(win.dirname(bundled)))
  const capability = service.authorityCapability()
  assert.equal(capability.gitCommand, bundled)
  assert.equal(capability.allowedGitRoot, win.dirname(win.dirname(bundled)))
  assert.equal(Object.isFrozen(capability), true)
  assert.deepEqual(JSON.parse(JSON.stringify(capability)), { available: true })
  assert.doesNotMatch(JSON.stringify(capability), /Harness|git\.exe/i)
})

test('Git authority selection falls back to system and removes forged fields when no runtime exists', () => {
  const fakeStat = value => ({ isFile: () => /^git\.exe$/i.test(win.basename(value)), isDirectory: () => !/^git\.exe$/i.test(win.basename(value)) })
  const systemOnly = createGitRuntimeService({
    resourcesPath: resources,
    env: { PATH: win.dirname(system), ProgramFiles: 'C:\\Program Files' },
    platform: 'win32', exists: value => win.resolve(value).toLowerCase() === win.resolve(system).toLowerCase(), realpath: value => win.resolve(value), stat: fakeStat
  })
  const selected = systemOnly.runtimeEnvironment({})
  assert.equal(selected[GIT_AUTHORITY_COMMAND_ENV], system)
  assert.equal(selected[GIT_AUTHORITY_ROOT_ENV], 'C:\\Program Files\\Git')

  const missing = createGitRuntimeService({ resourcesPath: resources, env: {}, platform: 'win32', exists: () => false })
  const cleaned = missing.runtimeEnvironment({ [GIT_AUTHORITY_COMMAND_ENV]: 'C:\\forged\\git.exe', [GIT_AUTHORITY_ROOT_ENV]: 'C:\\forged' })
  assert.equal(cleaned[GIT_AUTHORITY_COMMAND_ENV], undefined)
  assert.equal(cleaned[GIT_AUTHORITY_ROOT_ENV], undefined)
  assert.equal(missing.authorityCapability(), null)
})

test('authority capability uses case-insensitive Windows containment and rejects invalid Host paths', () => {
  const fakeStat = value => ({ isFile: () => /^git\.exe$/i.test(win.basename(value)), isDirectory: () => !/^git\.exe$/i.test(win.basename(value)) })
  const accepted = resolveGitAuthorityCapability({ command: 'C:\\PROGRAM FILES\\Git\\cmd\\git.exe' }, {
    platform: 'win32', realpath: value => value.toLowerCase().endsWith('git.exe') ? 'c:\\program files\\git\\CMD\\git.exe' : 'C:\\Program Files\\GIT', stat: fakeStat
  })
  assert.equal(accepted.gitCommand, 'c:\\program files\\git\\CMD\\git.exe')
  assert.equal(resolveGitAuthorityCapability({ command: 'relative\\git.exe' }, { platform: 'win32', realpath: value => value, stat: fakeStat }), null)
  assert.equal(resolveGitAuthorityCapability({ command: 'C:\\Tools\\cmd\\bash.exe' }, { platform: 'win32', realpath: value => value, stat: fakeStat }), null)
  assert.equal(resolveGitAuthorityCapability({ command: 'C:\\Tools\\cmd\\git.exe' }, { platform: 'win32', realpath: value => /git\.exe$/i.test(value) ? 'C:\\Other\\git.exe' : 'C:\\Tools', stat: fakeStat }), null)
})

test('version parsers accept version output only and return short non-sensitive values', () => {
  assert.equal(parseGitVersion('git version 2.49.0.windows.1\n'), '2.49.0.windows.1')
  assert.equal(parseGitVersion('https://user:token@example.invalid'), null)
  assert.equal(parseGcmVersion('Git Credential Manager version 2.6.1+abc'), '2.6.1+abc')
  assert.equal(parseGcmVersion('token only'), null)
})

test('service executes only fixed whitelisted actions, arguments, and shell-free options', async () => {
  const calls = []
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options })
    if (args[0] === '--version') return fakeChild({ stdout: 'git version 2.49.0.windows.1\n' })
    if (args[0] === 'credential-manager') return fakeChild({ stdout: '2.6.1\n' })
    return fakeChild({ stdout: 'STATE              : 4  RUNNING\n' })
  }
  const service = createGitRuntimeService({
    resourcesPath: resources,
    env: { PATH: win.dirname(system), ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows', GH_TOKEN: 'never-pass' },
    platform: 'win32',
    exists: winExists,
    spawnImpl
  })

  await assert.rejects(service.execute('clone', 'bundled'), /not allowed/)
  await assert.rejects(service.execute('git-version', 'other'), /Unknown/)
  assert.deepEqual(PUBLIC_ACTIONS, ['git-version', 'gcm-version', 'ssh-agent-status'])
  const gitProbe = await service.execute('git-version', 'bundled')
  const gcmProbe = await service.execute('gcm-version', 'system')
  const sshProbe = await service.execute('ssh-agent-status')
  assert.deepEqual(gitProbe, { available: true, version: '2.49.0.windows.1', reason: null })
  assert.deepEqual(gcmProbe, { available: true, version: '2.6.1', reason: null })
  assert.deepEqual(sshProbe, { available: true, running: true, reason: null })
  assert.equal(gitProbe.stdout, undefined)
  assert.equal(gcmProbe.stderr, undefined)

  assert.deepEqual(calls.map(call => call.args), [
    ['--version'], ['credential-manager', '--version'], ['query', 'ssh-agent']
  ])
  for (const call of calls) {
    assert.equal(path.win32.isAbsolute(call.command), true)
    assert.equal(call.options.shell, false)
    assert.equal(call.options.windowsHide, true)
    assert.deepEqual(call.options.stdio, ['ignore', 'pipe', 'pipe'])
    assert.equal(call.options.env.GH_TOKEN, undefined)
  }
})

test('status reports versions and availability but never commands, environment, or credentials', async () => {
  const spawnImpl = (command, args) => {
    if (command === bundledGcm) return fakeChild({ stderr: 'Git Credential Manager version 2.6.1\n' })
    if (args[0] === '--version') return fakeChild({ stdout: 'git version 2.49.0.windows.1\n' })
    if (args[0] === 'credential-manager') return fakeChild({ stderr: 'Git Credential Manager version 2.6.1\n' })
    return fakeChild({ stdout: 'SERVICE_NAME: ssh-agent\n        STATE              : 4  RUNNING\n' })
  }
  const service = createGitRuntimeService({
    resourcesPath: resources,
    env: { PATH: win.dirname(system), ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows', GH_TOKEN: 'do-not-leak' },
    platform: 'win32', exists: winExists, spawnImpl
  })
  const status = await service.status()

  assert.deepEqual(status, {
    git: {
      available: true,
      source: 'bundled',
      version: '2.49.0.windows.1',
      bundled: { available: true, version: '2.49.0.windows.1' },
      system: { available: true, version: '2.49.0.windows.1' }
    },
    gcm: { available: true, version: '2.6.1', source: 'bundled' },
    github: { connected: false, accountCount: 0 },
    sshAgent: { available: true, running: true, clientAvailable: true },
    preparation: { state: 'ready', canPrepare: false }
  })
  const serialized = JSON.stringify(status)
  assert.doesNotMatch(serialized, /do-not-leak|Program Files|Harness|command|env|PATH/i)
})

test('GitHub authentication opens browser OAuth once, waits for completion, and returns no credentials', async () => {
  const calls = []
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options })
    if (command === bundledGcm && args[0] === '--version') return fakeChild({ stdout: '2.7.0\n' })
    if (command === bundledGcm && args[0] === 'github' && args[1] === 'list') return fakeChild({ stdout: 'octocat\n' })
    if (args[0] === '--version') return fakeChild({ stdout: 'git version 2.53.0.windows.2\n' })
    if (args[0] === 'query') return fakeChild({ stdout: 'STATE : 4 RUNNING\n' })
    return fakeChild()
  }
  const service = createGitRuntimeService({
    resourcesPath: resources,
    env: { PATH: win.dirname(system), ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows', GH_TOKEN: 'never-pass' },
    platform: 'win32', exists: winExists, spawnImpl
  })
  await assert.rejects(service.authenticate('cnb'), /Unsupported/)
  const authentication = service.authenticate('github')
  const duplicateAuthentication = service.authenticate('github')
  assert.equal(duplicateAuthentication, authentication)
  const [result, duplicateResult] = await Promise.all([authentication, duplicateAuthentication])
  assert.deepEqual(result, { started: true, completed: true, connected: true, provider: 'github', reason: null })
  assert.deepEqual(duplicateResult, result)
  const configure = calls.find(call => call.args[0] === 'configure')
  assert.deepEqual(configure.args, ['configure'])
  assert.equal(configure.options.env.GIT_CONFIG_GLOBAL, undefined)
  const launch = calls.find(call => call.args[0] === 'github' && call.args[1] === 'login')
  assert.equal(launch.command, bundledGcm)
  assert.deepEqual(launch.args, ['github', 'login', '--browser'])
  assert.equal(launch.args.includes('--device'), false)
  assert.equal(launch.options.shell, false)
  assert.equal(launch.options.windowsHide, true)
  assert.equal(launch.options.env.GCM_INTERACTIVE, 'Always')
  assert.equal(launch.options.env.GH_TOKEN, undefined)
  assert.equal(JSON.stringify(result).includes('token'), false)
  assert.equal(calls.filter(call => call.args[0] === 'configure').length, 1)
  assert.equal(calls.filter(call => call.args[0] === 'github' && call.args[1] === 'login').length, 1)
})

test('GitHub authentication clears a failed single flight so a later attempt can retry', async () => {
  let configureAttempts = 0
  const calls = []
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options })
    if (command === bundledGcm && args[0] === '--version') return fakeChild({ stdout: '2.7.0\n' })
    if (command === bundledGcm && args[0] === 'github' && args[1] === 'list') return fakeChild({ stdout: 'octocat\n' })
    if (command === bundledGcm && args[0] === 'configure') {
      configureAttempts += 1
      return fakeChild({ code: configureAttempts === 1 ? 1 : 0 })
    }
    if (args[0] === '--version') return fakeChild({ stdout: 'git version 2.53.0.windows.2\n' })
    if (args[0] === 'query') return fakeChild({ stdout: 'STATE : 4 RUNNING\n' })
    return fakeChild()
  }
  const service = createGitRuntimeService({
    resourcesPath: resources,
    env: { PATH: win.dirname(system), ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows' },
    platform: 'win32', exists: winExists, spawnImpl
  })

  const failed = await service.authenticate('github')
  assert.deepEqual(failed, { started: false, provider: 'github', reason: 'configure-failed' })
  const retried = await service.authenticate('github')
  assert.deepEqual(retried, { started: true, completed: true, connected: true, provider: 'github', reason: null })
  assert.equal(configureAttempts, 2)
  assert.equal(calls.filter(call => call.args[0] === 'github' && call.args[1] === 'login').length, 1)
})

test('ssh-agent parser distinguishes an absent service from a stopped service', () => {
  assert.deepEqual(parseSshAgentStatus({ code: 0, stdout: 'STATE : 1  STOPPED', stderr: '' }), {
    available: true, running: false
  })
  assert.deepEqual(parseSshAgentStatus({ code: 1060, stdout: '', stderr: 'FAILED 1060: service does not exist as an installed service' }), {
    available: false, running: false
  })
})

test('every process is killed on timeout', async () => {
  let child
  const service = createGitRuntimeService({
    resourcesPath: resources,
    env: { SystemRoot: 'C:\\Windows' },
    platform: 'win32', exists: value => win.resolve(value).toLowerCase() === win.resolve(bundled).toLowerCase(),
    timeoutMs: 100,
    spawnImpl: () => (child = fakeChild({ neverClose: true }))
  })
  const result = await service.execute('git-version', 'bundled')
  assert.equal(result.reason, 'timeout')
  assert.equal(child.killed, true)
})

test('combined stdout/stderr output is capped and the process is killed', async () => {
  let child
  const service = createGitRuntimeService({
    resourcesPath: resources,
    env: { SystemRoot: 'C:\\Windows' },
    platform: 'win32', exists: value => win.resolve(value).toLowerCase() === win.resolve(bundled).toLowerCase(),
    maxOutputBytes: 256,
    spawnImpl: () => (child = fakeChild({ stdout: 'x'.repeat(300), neverClose: true }))
  })
  const result = await service.execute('git-version', 'bundled')
  assert.equal(result.reason, 'output-limit')
  assert.equal(result.stdout, undefined)
  assert.equal(result.stderr, undefined)
  assert.equal(child.killed, true)
})
