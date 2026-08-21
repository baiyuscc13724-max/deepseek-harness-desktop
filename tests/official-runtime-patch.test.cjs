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

test('session projection streams do not invalidate the global list or run quadratic cache cleanup', async () => {
  const { patchSessionRenderingSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-runtime', 'lib', 'client.js'), 'utf8')
  const first = patchSessionRenderingSource(fixture)

  assert.equal(first.changed, !(fixture.includes('frame.key === "subagentTiming"') && fixture.includes('globalThis.setTimeout(publish, 50)')))
  assert.match(first.source, /for \(const key of \["title", "subagent"\]\) store\.faceOf\(key\)\.subscribe/)
  assert.doesNotMatch(first.source, /store\.subscribeAny\(\(\) => \{\s*this\.notifier\.markDirty\(\);/)
  assert.match(first.source, /if \(frame\.type === "session\/projection"\) \{\s*this\.projectionStore\(frame\.sessionId\)\.apply\(frame\.key, frame\.value, frame\.seq\);[\s\S]{0,260}\(frame\.key === "tokenUsage" \|\| frame\.key === "subagentTiming"\) && this\.openCatalogs\.size > 0/)
  assert.doesNotMatch(first.source, /if \(frame\.key === "tokenUsage" && this\.openCatalogs\.size > 0\)/)
  assert.doesNotMatch(first.source, /this\.projectionStore\(frame\.sessionId\)\.apply\(frame\.key, frame\.value, frame\.seq\);\s*this\.notifier\.markDirty\(\)/)
  assert.match(first.source, /const retainedEntryIds = new Set\(items\.map\(\(entry\) => entry\.sessionId\)\)/)
  assert.doesNotMatch(first.source, /for \(const id of this\.entryCache\.keys\(\)\) if \(!items\.some/)
  assert.match(first.source, /if \(kind === "frame"\) globalThis\.setTimeout\(publish, 50\)/)
  assert.doesNotMatch(first.source, /if \(kind === "frame"\) globalThis\.requestAnimationFrame\(publish\)/)
  assert.equal(patchSessionRenderingSource(first.source).changed, false)

  const notifierStart = first.source.indexOf('var Notifier = class {')
  const notifierEnd = first.source.indexOf('\n\t\t//#endregion', notifierStart)
  assert.ok(notifierStart >= 0 && notifierEnd > notifierStart)
  const timers = []
  const fakeGlobal = {
    requestAnimationFrame: () => { throw new Error('50ms stream scheduling must not publish at display frame rate') },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }) }
  }
  const Notifier = Function('globalThis', 'queueMicrotask', `${first.source.slice(notifierStart, notifierEnd)}; return Notifier`)(fakeGlobal, queueMicrotask)
  let rebuilds = 0
  let notices = 0
  const notifier = new Notifier(() => { rebuilds += 1 })
  notifier.subscribe(() => { notices += 1 })
  notifier.markFrameDirty()
  notifier.markFrameDirty()
  notifier.markFrameDirty()
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 50)
  assert.deepEqual({ rebuilds, notices }, { rebuilds: 0, notices: 0 })
  timers.shift().fn()
  assert.deepEqual({ rebuilds, notices }, { rebuilds: 1, notices: 1 })

  notifier.markFrameDirty()
  const supersededFrame = timers.shift()
  notifier.markDirty()
  await new Promise(resolve => queueMicrotask(resolve))
  assert.deepEqual({ rebuilds, notices }, { rebuilds: 2, notices: 2 })
  supersededFrame.fn()
  assert.deepEqual({ rebuilds, notices }, { rebuilds: 2, notices: 2 })

  notifier.markFrameDirty()
  const cancelledFrame = timers.shift()
  notifier.notifyNow()
  assert.deepEqual({ rebuilds, notices }, { rebuilds: 3, notices: 3 })
  cancelledFrame.fn()
  assert.deepEqual({ rebuilds, notices }, { rebuilds: 3, notices: 3 })

  const tokenOnly = first.source.replace(
    '// Catalog metrics are list-facing only while a catalog is visibly consuming them.\n\t\t\t\t\tif ((frame.key === "tokenUsage" || frame.key === "subagentTiming") && this.openCatalogs.size > 0) this.notifier.markDirty();',
    '// Token totals are list-facing only while a catalog is visibly consuming them.\n\t\t\t\t\tif (frame.key === "tokenUsage" && this.openCatalogs.size > 0) this.notifier.markDirty();'
  )
  assert.notEqual(tokenOnly, first.source)
  const migrated = patchSessionRenderingSource(tokenOnly)
  assert.equal(migrated.changed, true)
  assert.match(migrated.source, /frame\.key === "subagentTiming"/)
  assert.equal(patchSessionRenderingSource(migrated.source).changed, false)

  const drifted = fixture.includes('store.subscribeAny(() => {')
    ? fixture.replace('store.subscribeAny(() => {', 'store.subscribeAny(/* upstream drift */ () => {')
    : fixture.replace('for (const key of ["title", "subagent"])', 'for (const key /* upstream drift */ of ["title", "subagent"])')
  assert.throws(() => patchSessionRenderingSource(drifted), /Pinned DSH session projection list subscription changed/)
  const schedulerDrift = first.source.replace('globalThis.setTimeout(publish, 50);', 'globalThis.setTimeout(publish, 51);')
  assert.throws(() => patchSessionRenderingSource(schedulerDrift), /Pinned DSH stream notification frame scheduler changed/)
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
  if (tokenMeterFixture.includes('stateSchema: contextPressureStateSchema')) {
    assert.match(tokenPatch.source, /const tokenUsageDetailStateSchema =/)
    assert.match(tokenPatch.source, /stateSchema: tokenUsageDetailStateSchema/)
    assert.match(tokenPatch.source, /wire:\s*\{\s*viewSchema: tokenUsageDetailSchema,\s*view: \(state\) =>/)
    assert.doesNotMatch(tokenPatch.source, /\bschema: tokenUsageDetailSchema/)
  }
  assert.equal(patchTokenMeterSource(tokenPatch.source).changed, false)

  const conversationFixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js'), 'utf8')
  const conversationPatch = patchConversationCacheSource(conversationFixture)
  assert.match(conversationPatch.source, /useProjection\("tokenUsageDetail"\)/)
  assert.match(conversationPatch.source, /setView: actions\.setView/)
  assert.match(conversationPatch.source, /row\.placement === "queued" && !String\(row\.text \?\? row\.preview \?\? ""\)\.startsWith\("\[Agent team message "\)/)
  assert.doesNotMatch(conversationPatch.source, /inbox\.filter\(\(row\) => row\.placement === "queued"\), \[inbox\]\)/)
  assert.match(conversationPatch.source, /const runningTurnStart = useSession\(\(s\) => runningTurnStartTime\(s\.chat\.timeline\)\)/)
  assert.doesNotMatch(conversationPatch.source, /const timeline = useSession\(\(s\) => s\.chat\.timeline\)/)
  assert.match(conversationPatch.source, /const sessionHeader = \(0, react\.useMemo\)\(\(\) => renderSlot\("conversation\.session\.header", \{\}\), \[renderSlot\]\)/)
  assert.match(conversationPatch.source, /const sessionView = \(0, react\.useMemo\)\(\(\) => renderSlot\("conversation\.session", \{\}\), \[renderSlot\]\)/)
  assert.match(conversationPatch.source, /children: \[sessionHeader,[\s\S]{0,300}children: \[sessionView, composerSeat\]/)
  assert.match(conversationPatch.source, /"data-conversation-view": active\?\.id/)
  assert.match(conversationPatch.source, /\[data-conversation-scroll\]:has\(\[data-conversation-view\]:not\(\[data-conversation-view=\\"chat\\"\]\)\)>\[data-composer-seat\]\{display:none\}/)
  assert.match(conversationPatch.source, /data-conversation-view=\\"desktop-files\\"/)
  assert.match(conversationPatch.source, /height:34px;pointer-events:none;[^"\n]*backdrop-filter:blur\(2px\)/)
  assert.match(conversationPatch.source, /store = new MutableChatNodeStore\(\)/)
  assert.match(conversationPatch.source, /nodes: this\.store/)
  assert.doesNotThrow(() => new Function(conversationPatch.source))
  assert.match(conversationPatch.source, /最近一步缓存读取/)
  assert.match(conversationPatch.source, /提供方未报告/)
  assert.match(conversationPatch.source, /累计缓存读取 \{percent\}%（含首次冷启动）/)
  assert.equal(patchConversationCacheSource(conversationPatch.source).changed, false)
})

test('official Harness owns file references and multimodal message handling', () => {
  const patchSource = readFileSync(path.resolve(__dirname, '..', 'scripts', 'patch-official-runtime.mjs'), 'utf8')
  for (const obsoleteDesktopPatch of [
    'desktopMessagesForInputModalities',
    'patchAgentLoopImageCompatibilitySource',
    'patchApiProxyImageCompatibilitySource',
    'patchLlmPreparedCallSource',
    'patchConversationAttachmentCopySource'
  ]) assert.doesNotMatch(patchSource, new RegExp(obsoleteDesktopPatch))
})

test('agent cancellation interrupts a provider stream stalled before its first token', async () => {
  const { patchAgentLoopCancellationSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-agent-loop', 'lib', 'index.js'), 'utf8')
  const first = patchAgentLoopCancellationSource(fixture)
  assert.equal(first.changed, !fixture.includes('const iterator = stream[Symbol.asyncIterator]()'))
  assert.match(first.source, /const iterator = stream\[Symbol\.asyncIterator\]\(\)/u)
  assert.match(first.source, /signal\.addEventListener\("abort", onAbort, \{ once: true \}\)/u)
  assert.match(first.source, /Promise\.resolve\(iterator\.next\(\)\)\.then/u)
  assert.match(first.source, /signal\.removeEventListener\("abort", onAbort\)/u)
  assert.match(first.source, /Promise\.resolve\(iterator\.return\(\)\)\.catch/u)
  assert.doesNotMatch(first.source, /for await \(const chunk of stream\)/u)
  assert.match(first.source, /if \(this\.inbox\.hasPending\) this\.wakeDriver\(\)/u)
  assert.equal(patchAgentLoopCancellationSource(first.source).changed, false)
})

test('continuable subagents self-heal an accepted inbox stranded after a failed turn', async () => {
  const { patchSubagentContinuationSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-subagent', 'lib', 'index.js'), 'utf8')
  const first = patchSubagentContinuationSource(fixture)
  assert.equal(first.changed, !fixture.includes('activation.accepted.size > 0 && agent.inbox.hasPending'))
  assert.match(first.source, /activation\.accepted\.size > 0 && agent\.inbox\.hasPending/u)
  assert.match(first.source, /agent\.wakeDriver\(\)/u)
  assert.equal(patchSubagentContinuationSource(first.source).changed, false)
})

test('subagent catalog separates current work from retained history without deleting transcripts', async () => {
  const { patchSubagentSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-ui-subagent', 'lib', 'client.js'), 'utf8')
  const first = patchSubagentSource(fixture)
  const officialLineage = ['function SubagentHeaderLineage(', 'conversation.session.header.lineage', 'function CatalogDropdown(']
  if (officialLineage.every(marker => fixture.includes(marker))) {
    assert.equal(first.changed, false, 'rc.2 lineage navigation is official and must not be overpatched')
    assert.equal(first.source, fixture)
    assert.match(first.source, /"switcher\.aria": "切换子代理：\{title\}"/)
    assert.match(first.source, /name: "conversation\.session\.header\.lineage"/)
    assert.match(first.source, /openChild\(\{/)
    assert.doesNotMatch(first.source, /removeChild|deleteSubagent|archiveSubagent/)
    assert.doesNotThrow(() => new Function(first.source))
    return
  }

  assert.equal(first.changed, !fixture.includes('@harness-desktop/subagent-drawer') || !fixture.includes('harness-desktop:open-subagent-catalog'), 'fresh, legacy, or pre-unified drawer sources patch once; a current unified drawer stays idempotent')
  assert.match(first.source, /function subagentLifecycleCounts\(/)
  assert.match(first.source, /function sortSubagentCatalogEntries\(/)
  assert.match(first.source, /sortSubagentCatalogEntries\(catalog\.entries\.filter/)
  assert.match(first.source, /const effectiveLifecycleFilter = lifecycleFilter;/)
  assert.match(first.source, /disabled: value === "history" \? lifecycle\.history === 0 : value === "all" \? descendantCount === 0 : false/)
  assert.doesNotMatch(first.source, /lifecycleFilter === "active" && currentCount === 0 \? "history"/)
  assert.match(first.source, /filteredEntries\.map/)
  assert.match(first.source, /待命（可恢复）/)
  assert.match(first.source, /已结束（仅记录）/)
  assert.match(first.source, /filter\.active/)
  assert.match(first.source, /filter\.history/)
  assert.match(first.source, /filter\.all/)
  assert.match(first.source, /children: t\("count\.compact", \{ count: descendantCount \}\)/)
  assert.match(first.source, /dataPluginCss = "@harness-desktop\/subagent-drawer"/)
  assert.match(first.source, /position:fixed!important/)
  assert.match(first.source, /inset:0 0 0 auto!important/)
  assert.match(first.source, /hd-subagent-drawer-backdrop/)
  assert.match(first.source, /@media\(max-width:620px\)\{\.h8S2Va_menu\{width:100vw!important/)
  assert.match(first.source, /@media\(prefers-reduced-motion:reduce\)\{\.h8S2Va_menu\{animation:none\}\}/)
  assert.match(first.source, /const dialogRef = \(0, react\.useRef\)\(null\)/)
  assert.match(first.source, /ref: dialogRef,\s+tabIndex: -1,\s+role: "dialog"/)
  assert.match(first.source, /dialogRef\.current\?\.focus\(\)/)
  assert.match(first.source, /!next && restoreFocus/)
  assert.match(first.source, /window\.addEventListener\("harness-desktop:open-subagent-catalog", openRequestedCatalog\)/)
  assert.match(first.source, /event\?\.detail\?\.parentSessionId !== sessionId/)
  assert.match(first.source, /window\.removeEventListener\("harness-desktop:open-subagent-catalog", openRequestedCatalog\)/)
  assert.doesNotMatch(first.source, /"aria-modal": true/)
  assert.doesNotMatch(first.source, /width:560px/)
  assert.match(first.source, /一次性任务结束后仅保留记录/)
  assert.match(first.source, /event\.key === "Escape"/)
  assert.match(first.source, /event\.key === "ArrowDown"/)
  assert.match(first.source, /metricToken/)
  assert.match(first.source, /metricDuration/)
  assert.match(first.source, /openChild\(\{/)
  assert.match(first.source, /childSessionId: entry\.id/)
  assert.match(first.source, /function SubagentReadOnlyComposer/)
  assert.doesNotMatch(first.source, /removeChild|deleteSubagent|archiveSubagent/)
  assert.doesNotThrow(() => new Function(first.source))

  const helperStart = first.source.indexOf('function subagentLifecycleBucket(entry) {')
  const helperEnd = first.source.indexOf('/** Render one catalog level', helperStart)
  const helpers = Function(`${first.source.slice(helperStart, helperEnd)}; return { subagentLifecycleBucket, subagentLifecycleCounts, lifecycleFilterMatches, subagentBranchLifecycleBucket, sortSubagentCatalogEntries }`)()
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

  const sortSummaries = {
    runningOld: { id: 'runningOld', origin: 'subagent', parentId: 'root', running: true, updatedAt: 10 },
    runningNew: { id: 'runningNew', origin: 'subagent', parentId: 'root', running: true, updatedAt: 20 },
    branch: { id: 'branch', origin: 'subagent', parentId: 'root', running: false, updatedAt: 15, projectionValues: { subagent: { mode: 'one-shot' } } },
    branchChild: { id: 'branchChild', origin: 'subagent', parentId: 'branch', running: true, updatedAt: 30 },
    ready: { id: 'ready', origin: 'subagent', parentId: 'root', running: false, updatedAt: 40, projectionValues: { subagent: { mode: 'continuable' } } },
    history: { id: 'history', origin: 'subagent', parentId: 'root', running: false, updatedAt: 50, projectionValues: { subagent: { mode: 'one-shot' } } }
  }
  const entries = [
    { id: 'history', kind: 'child', activity: 'inactive', mode: 'one-shot' },
    { id: 'ready', kind: 'child', activity: 'inactive', mode: 'continuable' },
    { id: 'runningOld', kind: 'child', activity: 'running', mode: 'continuable' },
    { id: 'branch', kind: 'child', activity: 'inactive', mode: 'one-shot', hasChildren: true },
    { id: 'runningNew', kind: 'child', activity: 'running', mode: 'continuable' },
    { id: 'diagnostic-a', kind: 'diagnostic' },
    { id: 'diagnostic-b', kind: 'diagnostic' }
  ]
  assert.equal(helpers.subagentBranchLifecycleBucket(entries[3], sortSummaries), 'running', 'a running descendant promotes its parent branch')
  assert.deepEqual(helpers.sortSubagentCatalogEntries(entries, sortSummaries).map((entry) => entry.id), ['runningNew', 'branch', 'runningOld', 'ready', 'history', 'diagnostic-a', 'diagnostic-b'])
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
