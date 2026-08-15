const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const originalSource = `\t\t\t\tstartSession(workspaceId) {
\t\t\t\t\tconst workspace = this.list.getSnapshot();
\t\t\t\t\tconst current = this.sessions.list.getSnapshot().current;
\t\t\t\t\tconst currentWorkspaceId = current === void 0 ? void 0 : workspace.items.find((item) => item.sessionIds.includes(current))?.workspaceId;
\t\t\t\t\tconst target = workspaceId ?? currentWorkspaceId ?? workspace.recentWorkspaceId;
\t\t\t\t\tif (target === void 0) {
\t\t\t\t\t\tthis.sessions.clear();
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tthis.connectWorkspace(target).then((sessionId) => {
\t\t\t\t\t\tthis.sessions.open(sessionId);
\t\t\t\t\t}, (reason) => {
\t\t\t\t\t\tconsole.warn("new session failed:", reason);
\t\t\t\t\t});
\t\t\t\t}`.split('\n').map(line => line.slice(1)).join('\n')

test('all desktop New Session entry points force a new session and remain idempotent', async () => {
  const { patchRuntimeSource } = await import('../scripts/patch-official-runtime.mjs')
  const first = patchRuntimeSource(originalSource)
  assert.equal(first.changed, true)
  assert.match(first.source, /this\.sessions\.create\(\{ workspaceId: target \}\)/)
  assert.doesNotMatch(first.source, /connectWorkspace\(target\)/)
  assert.match(first.source, /this\.sessions\.clear\(\);\s*this\.sessions\.create/)
  assert.equal(patchRuntimeSource(first.source).changed, false)
})

test('Windows directory selection avoids the crashing Koffi dialog worker', async () => {
  const { patchDirectoryPickerSource } = await import('../scripts/patch-official-runtime.mjs')
  const original = 'if (platform === "win32") return await (internals.pickWin32Dialog ?? pickWin32Directory)(signal);'
  const first = patchDirectoryPickerSource(original)
  assert.equal(first.changed, true)
  assert.match(first.source, /powershell\.exe/)
  assert.match(first.source, /System\.Windows\.Forms\.FolderBrowserDialog/)
  assert.match(first.source, /-EncodedCommand/)
  assert.doesNotMatch(first.source, /internals\.pickWin32Dialog/)
  assert.equal(patchDirectoryPickerSource(first.source).changed, false)
})

test('patched Windows directory picker returns the selected existing project path', async () => {
  const pickerFile = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'index.js')
  const { pickNativeDirectory } = await import(`${pathToFileURL(pickerFile).href}?desktop-picker-test=${Date.now()}`)
  const calls = []
  const selected = await pickNativeDirectory(new AbortController().signal, {
    platform: 'win32',
    run: async (command, args) => {
      calls.push({ command, args })
      return { stdout: 'D:\\旧项目\\工作区\r\n', stderr: '' }
    },
    pickWin32Dialog: () => {
      throw new Error('crashing Koffi worker must not be called')
    }
  })
  assert.equal(selected, 'D:\\旧项目\\工作区')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'powershell.exe')
  assert.deepEqual(calls[0].args.slice(0, 4), ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand'])
  const script = Buffer.from(calls[0].args[4], 'base64').toString('utf16le')
  assert.match(script, /System\.Windows\.Forms\.FolderBrowserDialog/)
  assert.match(script, /SelectedPath/)
})

test('New Session targets the current project and supports multiple projects', async () => {
  const { patchRuntimeSource } = await import('../scripts/patch-official-runtime.mjs')
  const patched = patchRuntimeSource(originalSource).source
  const method = patched.slice(patched.indexOf('startSession('))
  const Runtime = Function(`return class Runtime { ${method} }`)()
  const events = []
  let current = 'session-a'
  let sequence = 0
  const runtime = new Runtime()
  runtime.list = { getSnapshot: () => ({
    items: [
      { workspaceId: 'project-a', sessionIds: ['session-a'] },
      { workspaceId: 'project-b', sessionIds: ['session-b'] }
    ],
    recentWorkspaceId: 'project-b'
  }) }
  runtime.sessions = {
    list: { getSnapshot: () => ({ current }) },
    clear: () => { events.push(['clear']); current = undefined },
    create: async ({ workspaceId }) => {
      const id = `${workspaceId}-new-${++sequence}`
      events.push(['create', workspaceId, id])
      return id
    },
    open: id => { events.push(['open', id]); current = id }
  }

  runtime.startSession('project-b')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events.slice(0, 3), [
    ['clear'],
    ['create', 'project-b', 'project-b-new-1'],
    ['open', 'project-b-new-1']
  ])

  current = 'session-a'
  runtime.startSession()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events.slice(3), [
    ['clear'],
    ['create', 'project-a', 'project-a-new-2'],
    ['open', 'project-a-new-2']
  ])
})
