const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  MAX_INPUT_BYTES,
  TerminalManager,
  detectWindowsShells
} = require('../electron/bridge/terminal-service.cjs')

test('Windows integrated terminal exposes PowerShell, Command Prompt, Git Bash and WSL availability', () => {
  const installed = new Set([
    path.normalize('C:\\Program Files\\PowerShell\\7\\pwsh.exe').toLowerCase(),
    path.normalize('C:\\Windows\\System32\\cmd.exe').toLowerCase(),
    path.normalize('C:\\Program Files\\Git\\bin\\bash.exe').toLowerCase(),
    path.normalize('C:\\Windows\\System32\\wsl.exe').toLowerCase()
  ])
  const shells = detectWindowsShells({
    env: {
      SystemRoot: 'C:\\Windows',
      ProgramFiles: 'C:\\Program Files',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
      PATH: '',
      PATHEXT: '.EXE;.CMD'
    },
    exists: candidate => installed.has(path.normalize(candidate).toLowerCase())
  })
  assert.deepEqual(shells.map(shell => [shell.id, shell.label, shell.available]), [
    ['powershell', 'PowerShell', true],
    ['cmd', 'Command Prompt', true],
    ['git-bash', 'Git Bash', true],
    ['wsl', 'WSL', true]
  ])
})

test('TerminalManager owns a bounded PTY lifecycle without exposing launch argv in capabilities', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'harness-terminal-'))
  const calls = { spawn: null, writes: [], resizes: [], kills: 0 }
  let dataHandler = null
  let exitHandler = null
  const pty = {
    spawn(command, args, options) {
      calls.spawn = { command, args, options }
      return {
        onData(handler) { dataHandler = handler },
        onExit(handler) { exitHandler = handler },
        write(value) { calls.writes.push(value) },
        resize(cols, rows) { calls.resizes.push([cols, rows]) },
        kill() { calls.kills += 1 }
      }
    }
  }
  const events = []
  const manager = new TerminalManager({
    ptyModule: pty,
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', PATH: '' },
    exists: candidate => path.normalize(candidate).toLowerCase() === path.normalize('C:\\Windows\\System32\\cmd.exe').toLowerCase(),
    onEvent: event => events.push(event)
  })
  try {
    const capabilities = manager.capabilities()
    assert.equal(capabilities.pty, true)
    assert.equal(capabilities.shells.find(shell => shell.id === 'cmd').available, true)
    assert.equal('command' in capabilities.shells[0], false)
    assert.equal('args' in capabilities.shells[0], false)

    const started = manager.start({ cwd, shellId: 'cmd', cols: 900, rows: 1 })
    assert.equal(started.shellId, 'cmd')
    assert.equal('shell' in started, false)
    assert.equal(started.cols, 400)
    assert.equal(started.rows, 5)
    assert.equal(calls.spawn.options.cwd, cwd)
    assert.deepEqual(calls.spawn.args, ['/Q'])

    dataHandler('ready>')
    assert.equal(events.at(-1).text, 'ready>')
    assert.deepEqual(manager.write(started.id, 'echo ok\r'), { written: 8, mode: 'pty' })
    assert.deepEqual(calls.writes, ['echo ok\r'])
    assert.equal(manager.resize(started.id, 100, 30).resized, true)
    assert.deepEqual(calls.resizes, [[100, 30]])

    exitHandler({ exitCode: 0, signal: 0 })
    assert.equal(manager.list().length, 0)
    assert.equal(events.at(-1).stream, 'exit')
  } finally {
    manager.closeAll()
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('TerminalManager rejects unknown shells and oversized writes', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'harness-terminal-bounds-'))
  const terminal = { onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }
  const manager = new TerminalManager({
    ptyModule: { spawn: () => terminal },
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', PATH: '' },
    exists: candidate => path.normalize(candidate).toLowerCase() === path.normalize('C:\\Windows\\System32\\cmd.exe').toLowerCase()
  })
  try {
    assert.throws(() => manager.start({ cwd, shellId: '../../escape' }), /Shell 标识无效/)
    const started = manager.start({ cwd, shellId: 'cmd' })
    assert.throws(() => manager.write(started.id, 'x'.repeat(MAX_INPUT_BYTES + 1)), /输入过长/)
  } finally {
    manager.closeAll()
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('real Windows node-pty runs an interactive shell in the requested workspace', { skip: process.platform !== 'win32', timeout: 10_000 }, async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'harness-terminal-real-'))
  let output = ''
  let settle
  const exited = new Promise((resolve, reject) => { settle = { resolve, reject } })
  const manager = new TerminalManager({
    onEvent(event) {
      if (event.stream === 'stdout' || event.stream === 'stderr') output += event.text || ''
      if (event.stream === 'exit') settle.resolve(event)
      if (event.stream === 'error') settle.reject(new Error(event.text || 'terminal error'))
    }
  })
  try {
    assert.equal(manager.capabilities().pty, true)
    const started = manager.start({ cwd, shellId: 'cmd', cols: 90, rows: 24 })
    manager.write(started.id, 'echo HARNESS_TERMINAL_OK\r\nexit\r\n')
    const exit = await exited
    assert.equal(exit.code, 0)
    assert.match(output, /HARNESS_TERMINAL_OK/u)
  } finally {
    manager.closeAll()
    rmSync(cwd, { recursive: true, force: true })
  }
})
