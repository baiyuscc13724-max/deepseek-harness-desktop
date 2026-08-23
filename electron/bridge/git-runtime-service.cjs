const path = require('node:path')
const { existsSync } = require('node:fs')
const { spawn } = require('node:child_process')

// Windows runtime paths must be built with win32 semantics regardless of the
// host OS, so candidate resolution and probes stay deterministic on every
// CI runner (Linux/macOS run the same logic tests with platform: 'win32').
function platformPath(platform) {
  return platform === 'win32' ? path.win32 : path
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024
const SAFE_ENV_KEYS = Object.freeze([
  'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA',
  'PROGRAMDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432'
])
const PUBLIC_ACTIONS = Object.freeze(['git-version', 'gcm-version', 'ssh-agent-status'])

function uniquePaths(values, platform = process.platform) {
  const p = platformPath(platform)
  const seen = new Set()
  const result = []
  for (const value of values) {
    if (!value || !String(value).trim()) continue
    const resolved = p.resolve(String(value))
    const key = platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(key)) continue
    seen.add(key)
    result.push(resolved)
  }
  return result
}

function bundledGitCandidates(resourcesPath, platform = process.platform) {
  const p = platformPath(platform)
  const executable = platform === 'win32' ? 'git.exe' : 'git'
  const root = p.resolve(resourcesPath)
  const thirdPartyRoots = [p.join(root, 'third_party'), p.join(root, 'app.asar.unpacked', 'third_party')]
  const layouts = [
    ['mingit', 'cmd'], ['MinGit', 'cmd'], ['git', 'cmd'],
    ['mingit', 'bin'], ['MinGit', 'bin'], ['git', 'bin']
  ]
  return uniquePaths(thirdPartyRoots.flatMap(thirdParty => layouts.map(parts => p.join(thirdParty, ...parts, executable))), platform)
}

function resolveBundledGit({ resourcesPath, platform = process.platform, exists = existsSync } = {}) {
  if (!resourcesPath) return null
  const command = bundledGitCandidates(resourcesPath, platform).find(candidate => exists(candidate))
  return command ? Object.freeze({ source: 'bundled', command }) : null
}

function bundledGcmCandidates(resourcesPath, platform = process.platform) {
  if (platform !== 'win32') return []
  const p = platformPath(platform)
  const root = p.resolve(resourcesPath)
  return uniquePaths([
    p.join(root, 'third_party', 'mingit', 'gcm', 'git-credential-manager.exe'),
    p.join(root, 'app.asar.unpacked', 'third_party', 'mingit', 'gcm', 'git-credential-manager.exe'),
    p.join(root, 'third_party', 'mingit', 'mingw64', 'bin', 'git-credential-manager.exe'),
    p.join(root, 'app.asar.unpacked', 'third_party', 'mingit', 'mingw64', 'bin', 'git-credential-manager.exe')
  ], platform)
}

function resolveBundledGcm({ resourcesPath, platform = process.platform, exists = existsSync } = {}) {
  if (!resourcesPath) return null
  const command = bundledGcmCandidates(resourcesPath, platform).find(candidate => exists(candidate))
  return command ? Object.freeze({ source: 'bundled', command }) : null
}

function bundledGitInstallMarkerCandidates(resourcesPath, platform = process.platform) {
  if (!resourcesPath || platform !== 'win32') return []
  const p = platformPath(platform)
  const root = p.resolve(resourcesPath)
  return uniquePaths([
    p.join(root, 'third_party', '.bundled-git-installing'),
    p.join(root, 'app.asar.unpacked', 'third_party', '.bundled-git-installing')
  ], platform)
}

function splitPath(env, platform) {
  const value = env?.PATH ?? env?.Path ?? env?.path ?? ''
  return String(value).split(platform === 'win32' ? ';' : path.delimiter).filter(entry => entry.trim())
}

function systemGitCandidates(env = process.env, platform = process.platform) {
  const p = platformPath(platform)
  const executable = platform === 'win32' ? 'git.exe' : 'git'
  const fromPath = splitPath(env, platform).map(directory => p.join(directory, executable))
  if (platform !== 'win32') return uniquePaths(fromPath, platform)
  const programRoots = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]
  const conventional = programRoots.filter(Boolean).flatMap(root => [
    p.join(root, 'Git', 'cmd', executable),
    p.join(root, 'Git', 'bin', executable)
  ])
  return uniquePaths([...fromPath, ...conventional], platform)
}

function resolveSystemGit({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const command = systemGitCandidates(env, platform).find(candidate => exists(candidate))
  return command ? Object.freeze({ source: 'system', command }) : null
}

function resolveWindowsOpenSsh({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  if (platform !== 'win32') return null
  const p = platformPath(platform)
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.WINDIR
  const command = systemRoot && p.join(systemRoot, 'System32', 'OpenSSH', 'ssh.exe')
  return command && exists(command) ? command : null
}

function buildGitEnvironment(sourceEnv = process.env, { gitCommand, platform = process.platform } = {}) {
  const p = platformPath(platform)
  const env = Object.create(null)
  for (const key of SAFE_ENV_KEYS) {
    if (typeof sourceEnv[key] === 'string' && sourceEnv[key]) env[key] = sourceEnv[key]
  }

  const gitDirectory = gitCommand ? p.dirname(p.resolve(gitCommand)) : null
  const gitRoot = gitDirectory && ['cmd', 'bin'].includes(p.basename(gitDirectory).toLowerCase())
    ? p.dirname(gitDirectory)
    : gitDirectory
  const systemRoot = sourceEnv.SystemRoot || sourceEnv.SYSTEMROOT || sourceEnv.WINDIR
  const pathEntries = uniquePaths([
    gitDirectory,
    gitRoot && p.join(gitRoot, 'cmd'),
    gitRoot && p.join(gitRoot, 'bin'),
    gitRoot && p.join(gitRoot, 'mingw64', 'bin'),
    gitRoot && p.join(gitRoot, 'usr', 'bin'),
    systemRoot && p.join(systemRoot, 'System32'),
    systemRoot
  ], platform)
  env.PATH = pathEntries.join(platform === 'win32' ? ';' : path.delimiter)
  env.GIT_TERMINAL_PROMPT = '0'
  env.GCM_INTERACTIVE = 'Never'
  env.GIT_ASKPASS = platform === 'win32' ? 'NUL' : '/bin/false'
  env.SSH_ASKPASS = platform === 'win32' ? 'NUL' : '/bin/false'
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = platform === 'win32' ? 'NUL' : '/dev/null'
  env.GIT_CONFIG_SYSTEM = platform === 'win32' ? 'NUL' : '/dev/null'
  env.LC_ALL = 'C'
  env.LANG = 'C'
  return env
}

function boundedProcess(command, args, {
  env,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  platform = process.platform
} = {}) {
  const p = platformPath(platform)
  if (!p.isAbsolute(command)) return Promise.reject(new Error('Executable must be an absolute resolved path.'))
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) return Promise.reject(new Error('Invalid process timeout.'))
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 256 || maxOutputBytes > 1024 * 1024) return Promise.reject(new Error('Invalid output limit.'))

  return new Promise(resolve => {
    let child
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let totalBytes = 0
    let settled = false
    let timer

    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(Object.freeze({
        ok: result.ok === true,
        code: Number.isInteger(result.code) ? result.code : null,
        reason: result.reason || null,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8')
      }))
    }
    const append = (which, chunk) => {
      if (settled) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      totalBytes += bytes.length
      if (totalBytes > maxOutputBytes) {
        try { child.kill() } catch {}
        finish({ ok: false, reason: 'output-limit' })
        return
      }
      if (which === 'stdout') stdout = Buffer.concat([stdout, bytes])
      else stderr = Buffer.concat([stderr, bytes])
    }

    try {
      child = spawnImpl(command, args, {
        cwd: p.dirname(command),
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      finish({ ok: false, reason: 'spawn-error' })
      return
    }
    child.stdout?.on('data', chunk => append('stdout', chunk))
    child.stderr?.on('data', chunk => append('stderr', chunk))
    child.once('error', () => finish({ ok: false, reason: 'spawn-error' }))
    child.once('close', code => finish({ ok: code === 0, code, reason: code === 0 ? null : 'exit' }))
    timer = setTimeout(() => {
      try { child.kill() } catch {}
      finish({ ok: false, reason: 'timeout' })
    }, timeoutMs)
    timer.unref?.()
  })
}

function buildRuntimeGitEnvironment(sourceEnv = process.env, { gitCommand, gcmCommand, sshCommand, platform = process.platform } = {}) {
  const p = platformPath(platform)
  const env = { ...sourceEnv }
  if (!gitCommand) return env
  const gitDirectory = p.dirname(p.resolve(gitCommand))
  const gitRoot = ['cmd', 'bin'].includes(p.basename(gitDirectory).toLowerCase()) ? p.dirname(gitDirectory) : gitDirectory
  const additions = [gitDirectory, p.join(gitRoot, 'cmd'), p.join(gitRoot, 'bin'), p.join(gitRoot, 'mingw64', 'bin')]
  if (gcmCommand) additions.unshift(p.dirname(p.resolve(gcmCommand)))
  const originalPath = sourceEnv.PATH || sourceEnv.Path || sourceEnv.path || ''
  env.PATH = [...uniquePaths(additions, platform), originalPath].filter(Boolean).join(platform === 'win32' ? ';' : path.delimiter)
  env.GIT_TERMINAL_PROMPT = '0'
  env.GCM_INTERACTIVE = 'Auto'
  if (sshCommand) {
    env.GIT_SSH_COMMAND = p.resolve(sshCommand).replaceAll('\\', '/')
    env.GIT_SSH_VARIANT = 'ssh'
  }
  return env
}

function launchUserVisible(command, args, { env, spawnImpl = spawn, lifetimeMs = 10 * 60_000, platform = process.platform } = {}) {
  const p = platformPath(platform)
  if (!p.isAbsolute(command)) return Promise.reject(new Error('Executable must be an absolute resolved path.'))
  if (!Number.isInteger(lifetimeMs) || lifetimeMs < 60_000 || lifetimeMs > 15 * 60_000) return Promise.reject(new Error('Invalid authentication lifetime.'))
  return new Promise(resolve => {
    let child
    let settled = false
    let started = false
    let timer
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(Object.freeze(result))
    }
    try {
      child = spawnImpl(command, args, {
        cwd: p.dirname(command), env, shell: false, windowsHide: true,
        detached: false, stdio: ['ignore', 'ignore', 'ignore']
      })
    } catch {
      finish({ started: false, reason: 'spawn-error' })
      return
    }
    child.once('error', () => finish({ started, completed: false, ok: false, reason: 'spawn-error' }))
    child.once('spawn', () => { started = true })
    child.once('close', code => finish({ started, completed: true, ok: code === 0, reason: code === 0 ? null : 'exit' }))
    timer = setTimeout(() => {
      try { child.kill() } catch {}
      finish({ started, completed: false, ok: false, reason: 'timeout' })
    }, lifetimeMs)
    timer.unref?.()
  })
}

function parseGitVersion(output) {
  const match = /^git version ([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+.][0-9A-Za-z.-]+)?)/i.exec(String(output).trim())
  return match ? match[1].slice(0, 64) : null
}

function parseGcmVersion(output) {
  const match = /(?:^|\s)([0-9]+\.[0-9]+\.[0-9]+(?:[-+.][0-9A-Za-z.-]+)?)(?:\s|$)/.exec(String(output).trim())
  return match ? match[1].slice(0, 64) : null
}

function parseSshAgentStatus(result) {
  const output = `${result.stdout}\n${result.stderr}`
  const state = /STATE\s*:\s*\d+\s+([A-Z_]+)/i.exec(output)?.[1]?.toUpperCase() || null
  const missing = /(?:FAILED\s+1060|does not exist as an installed service)/i.test(output)
  return Object.freeze({ available: !missing && result.code === 0, running: state === 'RUNNING' })
}

function createGitRuntimeService({
  resourcesPath = process.resourcesPath,
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES
} = {}) {
  let runtimes
  let bundledGcm
  let windowsOpenSsh
  let preparation
  let authenticationPromise = null

  // Resolution is deliberately repeatable. Development installs may populate the
  // fixed third_party location after Electron has already created this service.
  // No caller-provided executable path is ever accepted by the refresh boundary.
  const refresh = () => {
    runtimes = Object.freeze({
      bundled: resolveBundledGit({ resourcesPath, platform, exists }),
      system: resolveSystemGit({ env, platform, exists })
    })
    bundledGcm = resolveBundledGcm({ resourcesPath, platform, exists })
    windowsOpenSsh = resolveWindowsOpenSsh({ env, platform, exists })
    const installing = bundledGitInstallMarkerCandidates(resourcesPath, platform).some(candidate => exists(candidate))
    const state = runtimes.bundled && bundledGcm
      ? 'ready'
      : installing
        ? 'installing'
        : platform === 'win32' ? 'missing' : 'unsupported'
    preparation = Object.freeze({ state, canPrepare: platform === 'win32' && state === 'missing' })
    return Object.freeze({
      bundledAvailable: Boolean(runtimes.bundled),
      systemAvailable: Boolean(runtimes.system),
      gcmAvailable: Boolean(bundledGcm),
      preparation
    })
  }
  refresh()

  const runAction = async (action, source = 'bundled') => {
    if (!PUBLIC_ACTIONS.includes(action)) throw new Error('Git runtime action is not allowed.')
    refresh()
    if (action === 'ssh-agent-status') {
      if (platform !== 'win32') return Object.freeze({ ok: false, code: null, reason: 'unsupported', stdout: '', stderr: '' })
      const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.WINDIR
      const command = systemRoot && platformPath(platform).join(systemRoot, 'System32', 'sc.exe')
      if (!command || !exists(command)) return Object.freeze({ ok: false, code: null, reason: 'unavailable', stdout: '', stderr: '' })
      return boundedProcess(command, ['query', 'ssh-agent'], {
        env: buildGitEnvironment(env, { platform }), spawnImpl, timeoutMs, maxOutputBytes, platform
      })
    }

    if (source !== 'bundled' && source !== 'system') throw new Error('Unknown Git runtime source.')
    const runtime = runtimes[source]
    if (!runtime) return Object.freeze({ ok: false, code: null, reason: 'unavailable', stdout: '', stderr: '' })
    const useDirectGcm = action === 'gcm-version' && source === 'bundled' && bundledGcm
    const command = useDirectGcm ? bundledGcm.command : runtime.command
    const args = action === 'git-version' ? ['--version'] : useDirectGcm ? ['--version'] : ['credential-manager', '--version']
    return boundedProcess(command, args, {
      env: buildGitEnvironment(env, { gitCommand: runtime.command, platform }),
      spawnImpl,
      timeoutMs,
      maxOutputBytes,
      platform
    })
  }

  // This is the renderer/model boundary: raw child output, executable paths and
  // the child environment never leave the service, even for failed probes.
  const execute = async (action, source = 'bundled') => {
    const result = await runAction(action, source)
    if (action === 'git-version') {
      const version = result.ok ? parseGitVersion(result.stdout) : null
      return Object.freeze({ available: Boolean(version), version, reason: version ? null : result.reason || 'invalid-output' })
    }
    if (action === 'gcm-version') {
      const version = result.ok ? parseGcmVersion(`${result.stdout}\n${result.stderr}`) : null
      return Object.freeze({ available: Boolean(version), version, reason: version ? null : result.reason || 'invalid-output' })
    }
    const state = platform === 'win32'
      ? parseSshAgentStatus(result)
      : Object.freeze({ available: false, running: false })
    return Object.freeze({ ...state, reason: state.available ? null : result.reason || 'unavailable' })
  }

  const status = async () => {
    refresh()
    const sources = ['bundled', 'system']
    const git = {}
    for (const source of sources) {
      const result = await execute('git-version', source)
      git[source] = Object.freeze({ available: result.available, version: result.version })
    }

    let gcm = Object.freeze({ available: false, version: null, source: null })
    for (const source of sources) {
      const result = await execute('gcm-version', source)
      if (result.available) {
        gcm = Object.freeze({ available: true, version: result.version, source })
        break
      }
    }
    const selectedSource = git.bundled?.available ? 'bundled' : git.system?.available ? 'system' : null
    const selectedGit = Object.freeze({
      available: Boolean(selectedSource),
      source: selectedSource,
      version: selectedSource ? git[selectedSource].version : null,
      bundled: git.bundled,
      system: git.system
    })
    const sshResult = await execute('ssh-agent-status')
    const sshAgent = Object.freeze({ available: sshResult.available, running: sshResult.running, clientAvailable: Boolean(windowsOpenSsh) })
    let github = Object.freeze({ connected: false, accountCount: 0 })
    if (gcm.available) {
      const runtime = runtimes[gcm.source]
      const direct = gcm.source === 'bundled' && bundledGcm
      const command = direct ? bundledGcm.command : runtime.command
      const args = direct ? ['github', 'list', '--no-ui'] : ['credential-manager', 'github', 'list', '--no-ui']
      const accountResult = await boundedProcess(command, args, {
        env: buildGitEnvironment(env, { gitCommand: runtime.command, platform }),
        spawnImpl,
        timeoutMs,
        maxOutputBytes,
        platform
      })
      const accountCount = accountResult.ok
        ? Math.min(20, String(accountResult.stdout).split(/\r?\n/u).filter(line => line.trim()).length)
        : 0
      github = Object.freeze({ connected: accountCount > 0, accountCount })
    }
    return Object.freeze({ git: selectedGit, gcm, github, sshAgent, preparation })
  }

  const authenticateGitHub = async provider => {
    const current = await status()
    const source = current.gcm.source
    if (!source) return Object.freeze({ started: false, provider, reason: 'gcm-unavailable' })
    const runtime = runtimes[source]
    const direct = source === 'bundled' && bundledGcm
    const command = direct ? bundledGcm.command : runtime.command
    // Browser OAuth is explicitly selected so GCM opens the user's default browser,
    // owns its short-lived loopback callback, and exits only after authorization.
    // Harness receives only the exit result and never credentials or authorization codes.
    const args = direct ? ['github', 'login', '--browser'] : ['credential-manager', 'github', 'login', '--browser']
    const childEnv = buildGitEnvironment(env, { gitCommand: runtime.command, platform })
    for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']) delete childEnv[key]
    childEnv.GCM_INTERACTIVE = 'Always'
    const configured = await boundedProcess(command, direct ? ['configure'] : ['credential-manager', 'configure'], {
      env: childEnv, timeoutMs, maxOutputBytes, spawnImpl, platform, exists
    })
    if (!configured.ok) return Object.freeze({ started: false, provider, reason: 'configure-failed' })
    const launched = await launchUserVisible(command, args, { env: childEnv, spawnImpl, platform })
    if (!launched.ok) return Object.freeze({ started: launched.started, completed: launched.completed, connected: false, provider, reason: launched.reason })
    const currentAfterLogin = await status()
    return Object.freeze({ started: true, completed: true, connected: currentAfterLogin.github.connected, provider, reason: currentAfterLogin.github.connected ? null : 'credential-not-found' })
  }

  const authenticate = (provider = 'github') => {
    if (provider !== 'github') return Promise.reject(new Error('Unsupported Git authentication provider.'))
    if (authenticationPromise) return authenticationPromise
    const pending = authenticateGitHub(provider).finally(() => {
      if (authenticationPromise === pending) authenticationPromise = null
    })
    authenticationPromise = pending
    return pending
  }

  const runtimeEnvironment = sourceEnv => {
    refresh()
    const runtime = runtimes.bundled || runtimes.system
    return buildRuntimeGitEnvironment(sourceEnv, {
      gitCommand: runtime?.command,
      gcmCommand: bundledGcm?.command,
      sshCommand: windowsOpenSsh,
      platform
    })
  }

  return Object.freeze({ authenticate, execute, refresh, runtimeEnvironment, status })
}

module.exports = {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  PUBLIC_ACTIONS,
  SAFE_ENV_KEYS,
  buildGitEnvironment,
  buildRuntimeGitEnvironment,
  bundledGcmCandidates,
  bundledGitCandidates,
  bundledGitInstallMarkerCandidates,
  createGitRuntimeService,
  launchUserVisible,
  parseGcmVersion,
  parseGitVersion,
  parseSshAgentStatus,
  resolveBundledGit,
  resolveSystemGit,
  resolveWindowsOpenSsh,
  systemGitCandidates
}
