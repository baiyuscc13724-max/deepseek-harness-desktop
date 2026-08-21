const assert = require('node:assert/strict')
const test = require('node:test')
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const runtimeFile = (...parts) => path.join(root, 'node_modules', '@deepseek-ai', ...parts)

test('sandbox escalation fails before approval.request when session policy is never', async () => {
  const sandboxFile = runtimeFile('dsh-sandbox', 'lib', 'index.js')
  const { approveEscalation } = await import(`${pathToFileURL(sandboxFile).href}?never-policy=${Date.now()}`)
  let requests = 0
  const session = { id: 'session-never' }
  const approver = {
    effectivePolicy: candidate => candidate === session ? 'never' : 'ask',
    request: async () => { requests += 1; return 'allowed-once' }
  }

  await assert.rejects(
    approveEscalation({
      requestedMode: 'workspace-write',
      effectiveMode: 'read-only',
      justification: 'write the requested workspace file',
      subject: 'operation'
    }, {
      approver,
      agent: { session },
      toolName: 'write'
    }),
    /approval prompts are disabled in this session/
  )
  assert.equal(requests, 0)
})

test('ask policy still routes a strictly wider sandbox request exactly once', async () => {
  const sandboxFile = runtimeFile('dsh-sandbox', 'lib', 'index.js')
  const { approveEscalation } = await import(`${pathToFileURL(sandboxFile).href}?ask-policy=${Date.now()}`)
  let requests = 0
  const session = { id: 'session-ask' }
  const approver = {
    effectivePolicy: () => 'ask',
    request: async () => { requests += 1; return 'allowed-once' }
  }
  const granted = await approveEscalation({
    requestedMode: 'danger-full-access',
    effectiveMode: 'workspace-write',
    justification: 'run the exact denied command',
    subject: 'command'
  }, {
    approver,
    agent: { session },
    toolName: 'pwsh'
  })
  assert.equal(granted, 'danger-full-access')
  assert.equal(requests, 1)
})

test('Read Only PowerShell startup uses a ConstrainedLanguage-safe encoding preamble', { skip: process.platform !== 'win32' }, () => {
  const source = readFileSync(runtimeFile('dsh-pwsh-local', 'lib', 'index.js'), 'utf8')
  const match = /const CONSTRAINED_ENCODING_PREAMBLE = "([^"]+)";/.exec(source)
  assert.ok(match, 'patched constrained encoding preamble must exist')
  assert.doesNotMatch(match[1], /::new\(/)
  assert.match(source, /spec\.sandboxPolicy\?\.mode === "read-only" \? CONSTRAINED_ENCODING_PREAMBLE : ENCODING_PREAMBLE/)

  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const command = `$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'; ${match[1]}Write-Output '沙箱-utf8'`
  const probe = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' })
  assert.equal(probe.status, 0, probe.stderr)
  assert.doesNotMatch(probe.stderr, /only supports core types|仅支持核心类型/i)
  assert.match(probe.stdout, /沙箱-utf8/)
})

test('confined pwsh workdir is resolved from the canonical sandbox policy root', () => {
  const source = readFileSync(runtimeFile('dsh-tool-pwsh', 'lib', 'index.js'), 'utf8')
  assert.match(source, /function resolveWorkdir\(modelWorkdir, exec, policyWorkspaceRoot\)/)
  assert.match(source, /const sessionCwd = policyWorkspaceRoot \?\? headerCwd;/)
  assert.match(source, /resolveWorkdir\(args\.workdir, exec, standingPolicy\?\.workspaceRoot\)/)
})

test('three sandbox modes retain their intended command and file boundaries', () => {
  const pwshSandbox = readFileSync(runtimeFile('dsh-pwsh-sandbox', 'lib', 'index.js'), 'utf8')
  const fsSandbox = readFileSync(runtimeFile('dsh-fs-sandbox', 'lib', 'index.js'), 'utf8')

  assert.match(pwshSandbox, /if \(mode === "danger-full-access"\) return \{\s*\.\.\.await super\.run\(spec\)/)
  assert.match(pwshSandbox, /const confined = this\.confine\(spec, \{/)
  assert.match(fsSandbox, /if \(mode === "danger-full-access"\) return target;/)
  assert.match(fsSandbox, /if \(mode === "read-only"\) throw new FsError\([^\n]+"FS_SANDBOX_DENIED"\)/)
  assert.match(fsSandbox, /for \(const root of writableRoots\(policy\)\)/)
  assert.match(fsSandbox, /if \(!contained\) throw new FsError\([^\n]+workspace-write mode/)
})

test('Windows ACL confined Node documents the exact stdio pipe boundary in both modes', { skip: process.platform !== 'win32', timeout: 120_000 }, () => {
  const runner = runtimeFile('dsh-sandbox-windows-acl', 'lib', 'runner.js')
  const probeFile = path.join(__dirname, 'fixtures', 'sandbox-child-stdio-probe.cjs')
  for (const mode of ['read-only', 'workspace-write']) {
    const workspace = mkdtempSync(path.join(tmpdir(), `dsh-${mode}-`))
    try {
      const probe = spawnSync(process.execPath, [runner, '--workspace', workspace, '--temp', tmpdir(), '--mode', mode, '--', process.execPath, probeFile], {
        encoding: 'utf8',
        timeout: 60_000
      })
      assert.equal(probe.status, 0, `${mode}: ${probe.stderr}`)
      const rows = probe.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line))
      assert.equal(rows.length, 5, `${mode}: ${probe.stdout}`)
      assert.deepEqual(rows.slice(0, 2).map(row => [row.stdio, row.status, row.error]), [
        ['ignore', 0, null],
        ['inherit', 0, null]
      ])
      for (const row of rows.slice(2)) {
        assert.ok(row.stdio.includes('pipe'))
        assert.equal(row.status, null)
        assert.equal(row.error, 'EPERM')
      }

      const namedPipeProbe = path.join(__dirname, 'fixtures', 'sandbox-named-pipe-probe.cjs')
      const pipe = spawnSync(process.execPath, [runner, '--workspace', workspace, '--temp', tmpdir(), '--mode', mode, '--', process.execPath, namedPipeProbe], {
        encoding: 'utf8',
        timeout: 60_000
      })
      assert.equal(pipe.status, 1)
      assert.match(pipe.stdout, /"operation":"listen","ok":true/)
      assert.match(pipe.stderr, /"operation":"connect","code":"EPERM"/)

      const apiProbe = path.join(__dirname, 'fixtures', 'sandbox-child-process-api-probe.cjs')
      const apis = spawnSync(process.execPath, [runner, '--workspace', workspace, '--temp', tmpdir(), '--mode', mode, '--', process.execPath, apiProbe], {
        encoding: 'utf8',
        timeout: 60_000
      })
      assert.equal(apis.status, 0, `${mode}: ${apis.stderr}`)
      const apiRows = apis.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line))
      assert.deepEqual(apiRows.map(row => row.api), ['spawnSync', 'execFileSync', 'execSync', 'spawn', 'execFile', 'exec'])
      assert.ok(apiRows.every(row => row.ok === false && row.error === 'EPERM'))

      if (mode === 'workspace-write') {
        const captureProbe = path.join(__dirname, 'fixtures', 'sandbox-cmd-capture-probe.cmd')
        const capture = spawnSync(process.execPath, [runner, '--workspace', workspace, '--temp', tmpdir(), '--mode', mode, '--', 'cmd', '/d', '/c', 'call', captureProbe], {
          encoding: 'utf8',
          timeout: 60_000,
          env: { ...process.env, DSH_TEST_NODE: process.execPath }
        })
        assert.equal(capture.status, 0, capture.stderr)
        assert.match(capture.stdout, /^v\d+/m)
        assert.doesNotMatch(capture.stderr, /not recognized as an internal or external command/i)

        const tempChildProbe = path.join(__dirname, 'fixtures', 'sandbox-temp-child-probe.cjs')
        const tempChild = spawnSync(process.execPath, [runner, '--workspace', workspace, '--temp', tmpdir(), '--mode', mode, '--', process.execPath, tempChildProbe], {
          encoding: 'utf8',
          timeout: 60_000
        })
        assert.equal(tempChild.status, 0, tempChild.stderr)
        assert.match(tempChild.stdout, /child-ok/)
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  }
})

test('logon-SID default DACL preserves PowerShell pipelines without widening file writes', { skip: process.platform !== 'win32', timeout: 120_000 }, () => {
  const runner = runtimeFile('dsh-sandbox-windows-acl', 'lib', 'runner.js')
  const probeFile = path.join(__dirname, 'fixtures', 'sandbox-pwsh-policy-probe.ps1')
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

  for (const mode of ['read-only', 'workspace-write']) {
    const workspace = mkdtempSync(path.join(tmpdir(), `dsh-pwsh-${mode}-`))
    const outside = mkdtempSync(path.join(tmpdir(), `dsh-pwsh-outside-${mode}-`))
    const workspaceFile = path.join(workspace, 'inside.txt')
    const outsideFile = path.join(outside, 'outside.txt')
    try {
      const probe = spawnSync(process.execPath, [runner, '--workspace', workspace, '--temp', tmpdir(), '--mode', mode, '--', powershell, '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probeFile], {
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          DSH_TEST_MODE: mode,
          DSH_TEST_WORKSPACE_FILE: workspaceFile,
          DSH_TEST_OUTSIDE_FILE: outsideFile
        }
      })
      assert.equal(probe.status, 0, `${mode}: ${probe.stderr}`)
      assert.match(probe.stdout, /pipeline-ok/)
      assert.equal(existsSync(workspaceFile), mode === 'workspace-write')
      assert.equal(existsSync(outsideFile), false)
      assert.match(probe.stdout, mode === 'read-only' ? /read-only-writes-denied/ : /workspace-write-boundary-ok/)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  }
})

test('sandbox executors classify only nested spawn/connect EPERM as a policy denial', () => {
  for (const packageName of ['dsh-pwsh-sandbox', 'dsh-bash-sandbox']) {
    const source = readFileSync(runtimeFile(packageName, 'lib', 'index.js'), 'utf8')
    const start = source.indexOf('function matchesSignature(')
    const end = source.indexOf('\n//#endregion', start)
    assert.notEqual(start, -1)
    assert.notEqual(end, -1)
    const matchesSignature = Function(`${source.slice(start, end)}; return matchesSignature`)()
    assert.equal(matchesSignature(1, 'EPERM spawnSync cmd EPERM', []), true)
    assert.equal(matchesSignature(1, 'Error: spawn git EPERM', []), true)
    assert.equal(matchesSignature(1, 'connect EPERM \\\\.\\pipe\\child', []), true)
    assert.equal(matchesSignature(1, 'ordinary command printed EPERM', []), false)
    assert.equal(matchesSignature(0, 'Error: spawn git EPERM', []), false)
  }
})

test('desktop postinstall patch remains idempotent for sandbox and PowerShell fixes', async () => {
  const patcher = await import(`../scripts/patch-official-runtime.mjs?mode-regression=${Date.now()}`)
  const sandboxSource = readFileSync(runtimeFile('dsh-sandbox', 'lib', 'index.js'), 'utf8')
  const pwshLocalSource = readFileSync(runtimeFile('dsh-pwsh-local', 'lib', 'index.js'), 'utf8')
  const toolPwshSource = readFileSync(runtimeFile('dsh-tool-pwsh', 'lib', 'index.js'), 'utf8')
  const pwshSandboxSource = readFileSync(runtimeFile('dsh-pwsh-sandbox', 'lib', 'index.js'), 'utf8')
  const bashSandboxSource = readFileSync(runtimeFile('dsh-bash-sandbox', 'lib', 'index.js'), 'utf8')
  const windowsAclSource = readFileSync(runtimeFile('dsh-sandbox-windows-acl', 'lib', 'types-CNjZgO4h.js'), 'utf8')

  assert.equal(patcher.patchSandboxEscalationSource(sandboxSource).changed, false)
  assert.equal(patcher.patchPwshLocalSource(pwshLocalSource).changed, false)
  assert.equal(patcher.patchToolPwshSource(toolPwshSource).changed, false)
  assert.equal(patcher.patchSandboxExecutorSource(pwshSandboxSource).changed, false)
  assert.equal(patcher.patchSandboxExecutorSource(bashSandboxSource).changed, false)
  assert.equal(patcher.patchWindowsAclSource(windowsAclSource).changed, false)
})
