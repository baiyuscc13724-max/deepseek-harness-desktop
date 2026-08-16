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

test('desktop Markdown keeps the upstream web allowlist and adds only local workspace targets', async () => {
  const { patchMarkdownSource } = await import('../scripts/patch-official-runtime.mjs')
  const original = `function sanitizeUrl(url) {
\ttry {
\t\tswitch (new URL(url).protocol) {
\t\t\tcase "http:":
\t\t\tcase "https:":
\t\t\tcase "mailto:": return url;
\t\t\tdefault: return "";
\t\t}
\t} catch {
\t\treturn "";
\t}
}
function inlineCodeHttpUrl(value) {
\tif (value.trim() !== value) return void 0;
\ttry {
\t\tconst protocol = new URL(value).protocol;
\t\treturn protocol === "http:" || protocol === "https:" ? value : void 0;
\t} catch {
\t\treturn;
\t}
}`
  const first = patchMarkdownSource(original)
  assert.equal(first.changed, true)
  assert.match(first.source, /harness-desktop:\/\/open-local\?path=/)
  assert.match(first.source, /case "https:"/)
  assert.match(first.source, /desktopLocalHref\(value\)/)
  assert.doesNotMatch(first.source, /case "javascript:"/)
  assert.equal(patchMarkdownSource(first.source).changed, false)
})

test('chat inline-code paths fall back to the active workspace without making launchables clickable', async () => {
  const { patchConversationSource } = await import('../scripts/patch-official-runtime.mjs')
  const original = 'fileMentions: (owner) => ctx.get("chatFileMentions")?.forClosing(owner),'
  const first = patchConversationSource(original)
  assert.equal(first.changed, true)
  assert.match(first.source, /owner\.openFile\(target\)/)
  assert.match(first.source, /looksLikePath/)
  assert.match(first.source, /launchable/)
  assert.match(first.source, /ps1/)
  const provider = Function('ctx', `return ({${first.source}}).fileMentions`)({ get: () => undefined })
  const opened = []
  const mentions = provider({ openFile: target => opened.push(target) })
  const relativeProject = mentions.resolve('./子项目')
  assert.equal(relativeProject.title, './子项目')
  relativeProject.open()
  assert.deepEqual(opened, ['./子项目'])
  assert.equal(mentions.resolve('setup.exe'), undefined)
  assert.equal(mentions.resolve('普通文本'), undefined)
  assert.equal(patchConversationSource(first.source).changed, false)
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
