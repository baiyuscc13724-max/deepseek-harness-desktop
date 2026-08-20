const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
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
  assert.match(first.source, /this\.sessionWorkspaceHints \?\?= new Map\(\)/)
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

test('cache metrics separate the latest warm request from the cold-start cumulative value', async () => {
  const { patchConversationCacheSource, patchTokenMeterSource } = await import('../scripts/patch-official-runtime.mjs')
  const tokenMeterFixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-token-meter', 'lib', 'index.js'), 'utf8')
  const tokenPatch = patchTokenMeterSource(tokenMeterFixture)
  assert.match(tokenPatch.source, /key: "tokenUsageDetail"/)
  assert.match(tokenPatch.source, /lastCacheReadReported/)
  assert.match(tokenPatch.source, /previousPromptTokens/)
  assert.match(tokenPatch.source, /register\(tokenUsageDetailProjectionDefinition\)/)
  assert.equal(patchTokenMeterSource(tokenPatch.source).changed, false)

  const conversationFixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js'), 'utf8')
  const conversationPatch = patchConversationCacheSource(conversationFixture)
  assert.match(conversationPatch.source, /useProjection\("tokenUsageDetail"\)/)
  assert.match(conversationPatch.source, /最近一步缓存读取/)
  assert.match(conversationPatch.source, /提供方未报告/)
  assert.match(conversationPatch.source, /累计缓存读取 \{percent\}%（含首次冷启动）/)
  assert.equal(patchConversationCacheSource(conversationPatch.source).changed, false)
})

test('official rc.8 owns file references and multimodal message handling', () => {
  const patchSource = readFileSync(path.resolve(__dirname, '..', 'scripts', 'patch-official-runtime.mjs'), 'utf8')
  for (const obsoleteDesktopPatch of [
    'desktopMessagesForInputModalities',
    'patchAgentLoopImageCompatibilitySource',
    'patchApiProxyImageCompatibilitySource',
    'patchLlmPreparedCallSource',
    'patchConversationAttachmentCopySource'
  ]) assert.doesNotMatch(patchSource, new RegExp(obsoleteDesktopPatch))
})

test('subagent catalog separates current work from retained history without deleting transcripts', async () => {
  const { patchSubagentSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-ui-subagent', 'lib', 'client.js'), 'utf8')
  const first = patchSubagentSource(fixture)

  assert.match(first.source, /function subagentLifecycleCounts\(/)
  assert.match(first.source, /filteredEntries\.map/)
  assert.match(first.source, /待命（可恢复）/)
  assert.match(first.source, /已结束（仅记录）/)
  assert.match(first.source, /filter\.active/)
  assert.match(first.source, /filter\.history/)
  assert.match(first.source, /width:560px/)
  assert.match(first.source, /一次性任务结束后仅保留记录/)
  assert.match(first.source, /openChild\(\{/)
  assert.match(first.source, /childSessionId: entry\.id/)
  assert.doesNotMatch(first.source, /removeChild|deleteSubagent|archiveSubagent/)
  assert.doesNotThrow(() => new Function(first.source))

  const helperStart = first.source.indexOf('function subagentLifecycleBucket(entry) {')
  const helperEnd = first.source.indexOf('/** Render one catalog level', helperStart)
  const helpers = Function(`${first.source.slice(helperStart, helperEnd)}; return { subagentLifecycleBucket, subagentLifecycleCounts, lifecycleFilterMatches }`)()
  assert.equal(helpers.subagentLifecycleBucket({ kind: 'child', activity: 'running', mode: 'continuable' }), 'running')
  assert.equal(helpers.subagentLifecycleBucket({ kind: 'child', activity: 'inactive', mode: 'continuable' }), 'resumable')
  assert.equal(helpers.subagentLifecycleBucket({ kind: 'child', activity: 'inactive', mode: 'one-shot' }), 'history')

  const summaries = {
    running: { id: 'running', origin: 'subagent', parentId: 'root', running: true, projectionValues: { subagent: { mode: 'continuable' } } },
    ready: { id: 'ready', origin: 'subagent', parentId: 'root', running: false, projectionValues: { subagent: { mode: 'continuable' } } },
    history: { id: 'history', origin: 'subagent', parentId: 'root', running: false, projectionValues: { subagent: { mode: 'one-shot' } } },
    nested: { id: 'nested', origin: 'subagent', parentId: 'history', running: false, projectionValues: { subagent: { mode: 'continuable' } } }
  }
  assert.deepEqual(helpers.subagentLifecycleCounts(summaries, 'root', 4), { running: 1, resumable: 2, history: 1 })
  assert.equal(helpers.lifecycleFilterMatches('resumable', 'active'), true)
  assert.equal(helpers.lifecycleFilterMatches('history', 'active'), false)
  assert.equal(helpers.lifecycleFilterMatches('history', 'history'), true)
  assert.equal(patchSubagentSource(first.source).changed, false)
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
  const summaries = {
    'session-a': { id: 'session-a', cwd: 'D:\\project-a' },
    'session-b': { id: 'session-b', cwd: 'D:\\project-b' }
  }
  const runtime = new Runtime()
  runtime.list = { getSnapshot: () => ({
    items: [
      { workspaceId: 'project-a', path: 'D:\\project-a', sessionIds: ['session-a'] },
      { workspaceId: 'project-b', path: 'D:\\project-b', sessionIds: ['session-b'] }
    ],
    recentWorkspaceId: 'project-b'
  }) }
  runtime.sessions = {
    list: { getSnapshot: () => ({ current, byId: summaries }) },
    clear: () => { events.push(['clear']); current = undefined },
    create: async ({ workspaceId }) => {
      const id = `${workspaceId}-new-${++sequence}`
      summaries[id] = { id }
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

  // The Workspace changed projection can lag behind session.create. The next
  // click must stay in project A instead of falling back to recent project B.
  runtime.startSession()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events.slice(6), [
    ['clear'],
    ['create', 'project-a', 'project-a-new-3'],
    ['open', 'project-a-new-3']
  ])

  // A selected session with stale membership can still resolve by cwd.
  current = 'session-c'
  summaries['session-c'] = { id: 'session-c', cwd: 'D:\\project-c' }
  runtime.list = { getSnapshot: () => ({
    items: [
      { workspaceId: 'project-b', path: 'D:\\project-b', sessionIds: ['session-b'] },
      { workspaceId: 'project-c', path: 'D:\\project-c', sessionIds: [] }
    ],
    recentWorkspaceId: 'project-b'
  }) }
  runtime.startSession()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events.slice(9), [
    ['clear'],
    ['create', 'project-c', 'project-c-new-4'],
    ['open', 'project-c-new-4']
  ])
})
