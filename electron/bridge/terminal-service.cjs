const { randomUUID } = require('node:crypto')
const { existsSync, realpathSync, statSync } = require('node:fs')
const path = require('node:path')

const MAX_TERMINALS = 12
const MAX_INPUT_BYTES = 64 * 1024
const SHELL_IDS = Object.freeze(['powershell', 'cmd', 'git-bash', 'wsl', 'default'])

function loadPty() {
  try {
    return require('node-pty')
  } catch {
    return null
  }
}

function clampDimension(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.floor(number)))
}

function cleanEnvironment(env = {}) {
  return Object.fromEntries(Object.entries(env).flatMap(([key, value]) => {
    if (value === undefined || value === null) return []
    return [[key, String(value)]]
  }))
}

function executableCandidates(command, { platform = process.platform, env = process.env } = {}) {
  if (!command) return []
  const pathApi = platform === 'win32' ? path.win32 : path
  if (pathApi.isAbsolute(command)) return [command]
  const separator = platform === 'win32' ? ';' : path.delimiter
  const directories = String(env.PATH || env.Path || '').split(separator).filter(Boolean)
  if (platform !== 'win32') return directories.map(directory => pathApi.join(directory, command))
  const extensions = pathApi.extname(command)
    ? ['']
    : String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  return directories.flatMap(directory => extensions.map(extension => pathApi.join(directory, `${command}${extension.toLowerCase()}`)))
}

function firstExisting(candidates, exists = existsSync) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      if (exists(candidate)) return candidate
    } catch {}
  }
  return null
}

function detectWindowsShells({ env = process.env, resourcesPath = process.resourcesPath, appRoot, exists = existsSync } = {}) {
  const winPath = path.win32
  const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows'
  const programFiles = env.ProgramFiles || 'C:\\Program Files'
  const localAppData = env.LOCALAPPDATA || ''
  const powershell = firstExisting([
    ...executableCandidates('pwsh.exe', { platform: 'win32', env }),
    winPath.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
    winPath.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ...executableCandidates('powershell.exe', { platform: 'win32', env })
  ], exists)
  const cmd = firstExisting([
    env.ComSpec,
    winPath.join(systemRoot, 'System32', 'cmd.exe'),
    ...executableCandidates('cmd.exe', { platform: 'win32', env })
  ], exists)
  const gitBash = firstExisting([
    resourcesPath && winPath.join(resourcesPath, 'third_party', 'mingit', 'usr', 'bin', 'bash.exe'),
    appRoot && winPath.join(appRoot, 'third_party', 'mingit', 'usr', 'bin', 'bash.exe'),
    winPath.join(programFiles, 'Git', 'bin', 'bash.exe'),
    localAppData && winPath.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
    ...executableCandidates('bash.exe', { platform: 'win32', env })
  ], exists)
  const wsl = firstExisting([
    winPath.join(systemRoot, 'System32', 'wsl.exe'),
    ...executableCandidates('wsl.exe', { platform: 'win32', env })
  ], exists)

  return [
    { id: 'powershell', label: 'PowerShell', kind: 'powershell', command: powershell, args: ['-NoLogo'], available: Boolean(powershell) },
    { id: 'cmd', label: 'Command Prompt', kind: 'cmd', command: cmd, args: ['/Q'], available: Boolean(cmd) },
    { id: 'git-bash', label: 'Git Bash', kind: 'bash', command: gitBash, args: ['--login', '-i'], available: Boolean(gitBash) },
    { id: 'wsl', label: 'WSL', kind: 'wsl', command: wsl, args: [], available: Boolean(wsl) }
  ]
}

function detectPosixShells({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const command = firstExisting([
    env.SHELL,
    platform === 'darwin' ? '/bin/zsh' : null,
    '/bin/bash',
    '/bin/sh',
    ...executableCandidates('sh', { platform, env })
  ], exists)
  const name = command ? path.basename(command) : 'shell'
  return [{
    id: 'default',
    label: command ? `Default shell (${name})` : 'Default shell',
    kind: 'posix',
    command,
    args: ['-l'],
    available: Boolean(command)
  }]
}

function detectShells(options = {}) {
  const platform = options.platform || process.platform
  return platform === 'win32'
    ? detectWindowsShells({ ...options, platform })
    : detectPosixShells({ ...options, platform })
}

function defaultShell(shells = detectShells()) {
  const available = shells.filter(shell => shell.available)
  return available.find(shell => shell.id === 'powershell') || available.find(shell => shell.id === 'default') || available[0] || null
}

function normalizeCwd(value) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value.trim())) {
    throw new Error('请先选择有效的绝对工作区路径。')
  }
  let resolved
  try {
    resolved = realpathSync(value.trim())
    if (!statSync(resolved).isDirectory()) throw new Error('not-directory')
  } catch {
    throw new Error('请先选择有效的工作区目录。')
  }
  return resolved
}

class TerminalManager {
  constructor({
    onEvent = () => {},
    ptyModule = undefined,
    platform = process.platform,
    env = process.env,
    resourcesPath = process.resourcesPath,
    appRoot,
    exists = existsSync
  } = {}) {
    this.onEvent = onEvent
    this.terminals = new Map()
    this.pty = ptyModule === undefined ? loadPty() : ptyModule
    this.platform = platform
    this.env = env
    this.shells = detectShells({ platform, env, resourcesPath, appRoot, exists })
  }

  #emit(id, stream, text, extra = {}) {
    this.onEvent({ terminalId: id, stream, text: String(text ?? ''), at: new Date().toISOString(), ...extra })
  }

  #disposeRecord(record, { kill = false } = {}) {
    try { record.dataSubscription?.dispose?.() } catch {}
    try { record.exitSubscription?.dispose?.() } catch {}
    if (kill) {
      try { record.terminal.kill() } catch {}
    }
  }

  #summary(record) {
    return {
      id: record.id,
      cwd: record.cwd,
      shellId: record.shell.id,
      shellLabel: record.shell.label,
      startedAt: record.startedAt,
      mode: 'pty',
      cols: record.cols,
      rows: record.rows,
      running: true
    }
  }

  start({ cwd, shellId, cols = 120, rows = 32 } = {}) {
    if (!this.pty || typeof this.pty.spawn !== 'function') throw new Error('集成终端 PTY 后端不可用，请修复 node-pty 安装。')
    if (this.terminals.size >= MAX_TERMINALS) throw new Error(`最多同时打开 ${MAX_TERMINALS} 个集成终端。`)
    const workingDirectory = normalizeCwd(cwd)
    const requestedId = typeof shellId === 'string' && shellId ? shellId : null
    if (requestedId && !SHELL_IDS.includes(requestedId)) throw new Error('终端 Shell 标识无效。')
    const shell = requestedId ? this.shells.find(item => item.id === requestedId) : defaultShell(this.shells)
    if (!shell?.available || !shell.command) throw new Error('所选终端 Shell 当前不可用。')

    const id = randomUUID()
    const width = clampDimension(cols, 20, 400, 120)
    const height = clampDimension(rows, 5, 200, 32)
    const startedAt = new Date().toISOString()
    const terminal = this.pty.spawn(shell.command, [...shell.args], {
      name: 'xterm-256color',
      cols: width,
      rows: height,
      cwd: workingDirectory,
      env: cleanEnvironment({ ...this.env, TERM: 'xterm-256color', COLORTERM: this.env.COLORTERM || 'truecolor' })
    })
    const record = { id, terminal, cwd: workingDirectory, shell, startedAt, cols: width, rows: height }
    this.terminals.set(id, record)
    record.dataSubscription = terminal.onData(data => this.#emit(id, 'stdout', data, { mode: 'pty' }))
    record.exitSubscription = terminal.onExit(({ exitCode, signal } = {}) => {
      if (!this.terminals.delete(id)) return
      this.#disposeRecord(record, { kill: true })
      this.#emit(id, 'exit', `\r\n[terminal exited: code=${exitCode ?? '-'}, signal=${signal ?? '-'}]\r\n`, {
        mode: 'pty', code: exitCode ?? null, signal: signal ?? null
      })
    })
    return this.#summary(record)
  }

  write(id, data) {
    const record = this.terminals.get(String(id || ''))
    if (!record) throw new Error('终端已经关闭。')
    const text = String(data ?? '')
    if (!text) return { written: 0, mode: 'pty' }
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > MAX_INPUT_BYTES) throw new Error('单次终端输入过长。')
    record.terminal.write(text)
    return { written: bytes, mode: 'pty' }
  }

  resize(id, cols, rows) {
    const record = this.terminals.get(String(id || ''))
    if (!record) return { resized: false, reason: 'closed' }
    const width = clampDimension(cols, 20, 400, record.cols)
    const height = clampDimension(rows, 5, 200, record.rows)
    record.cols = width
    record.rows = height
    record.terminal.resize(width, height)
    return { resized: true, mode: 'pty', cols: width, rows: height }
  }

  stop(id) {
    const terminalId = String(id || '')
    const record = this.terminals.get(terminalId)
    if (!record) return { stopped: false }
    this.terminals.delete(terminalId)
    this.#disposeRecord(record, { kill: true })
    return { stopped: true, mode: 'pty' }
  }

  list() {
    return [...this.terminals.values()].map(record => this.#summary(record))
  }

  capabilities() {
    const selected = defaultShell(this.shells)
    return {
      pty: Boolean(this.pty && typeof this.pty.spawn === 'function'),
      backend: this.pty && typeof this.pty.spawn === 'function' ? 'node-pty' : 'unavailable',
      defaultShellId: selected?.id || null,
      maxTerminals: MAX_TERMINALS,
      maxInputBytes: MAX_INPUT_BYTES,
      shells: this.shells.map(shell => ({
        id: shell.id,
        label: shell.label,
        kind: shell.kind,
        available: shell.available,
        detail: shell.available ? '已安装' : '未检测到'
      }))
    }
  }

  closeAll() {
    for (const id of [...this.terminals.keys()]) this.stop(id)
  }
}

module.exports = {
  MAX_INPUT_BYTES,
  MAX_TERMINALS,
  SHELL_IDS,
  TerminalManager,
  clampDimension,
  cleanEnvironment,
  defaultShell,
  detectPosixShells,
  detectShells,
  detectWindowsShells,
  executableCandidates,
  loadPty,
  normalizeCwd
}
