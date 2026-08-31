const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const vm = require('node:vm')

const alpha2CandidateRoot = process.env.DSH_ALPHA2_CANDIDATE_ROOT || path.resolve(__dirname, '..')

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

test('alpha.2 installed workspace wrapper enforces the exact transformed output guard', async () => {
  const source = readFileSync(path.join(alpha2CandidateRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js'), 'utf8')
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'alpha2-workspace-wrapper-'))
  const file = path.join(temporary, 'lib', 'client.js')
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-workspace', version: '0.1.2-alpha.2' }))
    writeFileSync(file, source)
    const { patchInstalledWorkspaceUi } = await import('../scripts/patch-official-runtime.mjs')
    const changed = await patchInstalledWorkspaceUi(file)
    const output = readFileSync(file, 'utf8')
    assert.equal(changed, !source.includes('this.pendingSessionWorkspaceTarget = target;'))
    assert.equal(createHash('sha256').update(output).digest('hex').toUpperCase(), 'B47D4AD32FF91ACDC7B27BE85AA184E4579B1973DF2DB04FB8E58A30590FDE0D')
    assert.equal(await patchInstalledWorkspaceUi(file), false)
    const drifted = output.replace('this.pendingSessionWorkspaceTarget = target;', 'this.pendingSessionWorkspaceTarget = target /* drift */;')
    assert.notEqual(drifted, output)
    writeFileSync(file, drifted)
    await assert.rejects(() => patchInstalledWorkspaceUi(file), /neither exact official nor exact complete patched artifact/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('alpha.2 removes the legacy runtime and keeps session projection work in Session Controller', async () => {
  const { access } = require('node:fs/promises')
  const removed = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-runtime', 'lib', 'client.js')
  await assert.rejects(() => access(removed), error => error?.code === 'ENOENT')

  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'client.js'), 'utf8')
  const { patchAlpha2SessionControllerSource } = await import('../scripts/patch-official-runtime.mjs')
  const first = patchAlpha2SessionControllerSource(fixture)
  assert.match(first.source, /for \(const key of \["title", "subagent"\]\) store\.faceOf\(key\)\.subscribe/u)
  assert.match(first.source, /\(frame\.key === "tokenUsage" \|\| frame\.key === "subagentTiming"\) && this\.openCatalogs\.size > 0/u)
  assert.match(first.source, /const retainedEntryIds = new Set\(items\.map\(\(entry\) => entry\.sessionId\)\)/u)
  assert.match(first.source, /if \(kind === "frame"\) globalThis\.setTimeout\(publish, 50\)/u)
  assert.doesNotMatch(first.source, /requestAnimationFrame\(publish\)|items\.some\(\(entry\) => entry\.sessionId === id\)/u)
  assert.equal(patchAlpha2SessionControllerSource(first.source).changed, false)
})

test('alpha.2 Session Controller real bundle enforces keyed dirtiness, bounded scheduling and linear cache cleanup', async () => {
  const alpha2File = path.join(alpha2CandidateRoot, 'node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'client.js')
  const source = readFileSync(alpha2File, 'utf8')
  const { patchAlpha2SessionControllerSource } = await import('../scripts/patch-official-runtime.mjs')
  const patched = patchAlpha2SessionControllerSource(source).source

  const managerStart = patched.indexOf('var SessionManager = class {')
  assert.notEqual(managerStart, -1)
  const extractBlock = (signature, from = 0) => {
    const start = patched.indexOf(signature, from)
    assert.notEqual(start, -1, `missing real-bundle block: ${signature}`)
    const body = patched.indexOf('{', start)
    let depth = 0
    for (let index = body; index < patched.length; index += 1) {
      if (patched[index] === '{') depth += 1
      else if (patched[index] === '}' && --depth === 0) return patched.slice(start, index + 1)
    }
    assert.fail(`unterminated real-bundle block: ${signature}`)
  }

  class ControlledProjectionValueStore {
    constructor() { this.listeners = new Map() }
    faceOf(key) {
      return { subscribe: listener => {
        const listeners = this.listeners.get(key) || []
        listeners.push(listener)
        this.listeners.set(key, listeners)
        return () => {}
      } }
    }
    apply(key) { for (const listener of this.listeners.get(key) || []) listener() }
  }
  const projectionStoreMethod = extractBlock('projectionStore(sessionId) {', managerStart)
  const controlFrameMethod = extractBlock('handleControlFrame(frame) {', managerStart)
  const ControlledSessionManager = vm.runInNewContext(`(class ControlledSessionManager {
    constructor(notifier) { this.projectionStores = new Map(); this.openCatalogs = new Set(); this.notifier = notifier; this.jobsBySession = new Map(); this.queues = new Map(); this.sessions = new Map(); }
    ${projectionStoreMethod}
    ${controlFrameMethod}
  })`, { Map, Set, ControlledProjectionValueStore, ProjectionValueStore: ControlledProjectionValueStore })
  let dirty = 0
  const manager = new ControlledSessionManager({ markDirty: () => { dirty += 1 } })
  manager.handleControlFrame({ type: 'projection', sessionId: 'hidden', key: 'tokenUsage', value: {}, seq: 1 })
  manager.handleControlFrame({ type: 'projection', sessionId: 'hidden', key: 'subagentTiming', value: {}, seq: 2 })
  assert.equal(dirty, 0, 'hidden token/timing projections must not dirty the list')
  manager.handleControlFrame({ type: 'projection', sessionId: 'hidden', key: 'title', value: 'Title', seq: 3 })
  assert.equal(dirty, 1, 'title projection must dirty exactly once')
  manager.openCatalogs.add('visible')
  manager.handleControlFrame({ type: 'projection', sessionId: 'visible', key: 'tokenUsage', value: {}, seq: 4 })
  assert.equal(dirty, 2, 'visible token projection must dirty exactly once')
  manager.handleControlFrame({ type: 'projection', sessionId: 'visible', key: 'subagentTiming', value: {}, seq: 5 })
  assert.equal(dirty, 3, 'visible timing projection must dirty exactly once')

  const notifierStart = patched.indexOf('var Notifier = class {')
  const notifierEnd = patched.indexOf('\n\t\t//#endregion', notifierStart)
  assert.ok(notifierStart >= 0 && notifierEnd > notifierStart)
  const timers = []
  let rafCalls = 0
  const context = {
    queueMicrotask,
    setTimeout: (fn, delay) => { timers.push({ fn, delay }) },
    requestAnimationFrame: () => { rafCalls += 1; throw new Error('requestAnimationFrame must not be used') },
    _deepseek_ai_dsh_client_store: { notifySubscribers: listeners => { for (const listener of listeners) listener() } }
  }
  context.globalThis = context
  const Notifier = vm.runInNewContext(`(()=>{${patched.slice(notifierStart, notifierEnd)};return Notifier})()`, context)
  let rebuilds = 0
  let notices = 0
  const notifier = new Notifier(() => { rebuilds += 1 })
  notifier.subscribe(() => { notices += 1 })
  notifier.markFrameDirty()
  notifier.markFrameDirty()
  notifier.markFrameDirty()
  assert.equal(rafCalls, 0)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 50)
  timers[0].fn()
  assert.deepEqual({ rebuilds, notices }, { rebuilds: 1, notices: 1 })

  const cleanupStart = patched.indexOf('const retainedEntryIds = new Set(items.map((entry) => entry.sessionId));')
  const cleanupEnd = patched.indexOf('\n', patched.indexOf('this.entryCache.delete(id);', cleanupStart))
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart)
  const cleanup = vm.runInNewContext(`(function(items){${patched.slice(cleanupStart, cleanupEnd)}})`, { Set })
  const items = [{ sessionId: 'keep-a' }, { sessionId: 'keep-b' }]
  items.some = () => { throw new Error('quadratic items.some cleanup executed') }
  const entryCache = new Map([['keep-a', {}], ['drop-a', {}], ['drop-b', {}]])
  cleanup.call({ entryCache }, items)
  assert.deepEqual([...entryCache.keys()], ['keep-a'])
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

test('Windows skills, Git commands and process cleanup never flash console windows', async () => {
  const { patchSubprocessSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', 'index.js'), 'utf8')
  const unpatched = fixture
    .replaceAll(', windowsHide: true', '')
    .replace('\n\t\twindowsHide: true,', '')
  const first = patchSubprocessSource(unpatched)

  assert.equal(first.changed, true)
  assert.match(first.source, /function taskkillTree\(pid, force\)[\s\S]{0,260}stdio: "ignore", windowsHide: true/u)
  assert.match(first.source, /function taskkillProcessTree\(pid\)[\s\S]{0,240}stdio: "ignore", windowsHide: true/u)
  assert.match(first.source, /const child = spawn\(program, args, \{\s*cwd: spec\.cwd,\s*env,\s*windowsHide: true,/u)
  assert.equal(patchSubprocessSource(first.source).changed, false)

  const drifted = first.source.replace('windowsHide: true,\n\t\tstdio:', 'windowsHide: true /* upstream drift */,\n\t\tstdio:')
  assert.notEqual(drifted, first.source)
  assert.throws(() => patchSubprocessSource(drifted), /Pinned DSH subprocess command spawn implementation changed/u)
})

test('the on-demand browser launcher does not flash a Node console window', async () => {
  const { patchWebAppSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'lib', 'index.js'), 'utf8')
  const unpatched = fixture.replace('\n\t\twindowsHide: true,\n\t\tstdio:', '\n\t\tstdio:')
  const first = patchWebAppSource(unpatched)

  assert.equal(first.changed, true)
  assert.match(first.source, /function spawnBrowserLauncher\(url\)[\s\S]{0,300}env: scrubbedParentEnv\(\),\s*windowsHide: true,\s*stdio:/u)
  assert.equal(patchWebAppSource(first.source).changed, false)

  const drifted = first.source.replace('windowsHide: true,\n\t\tstdio:', 'windowsHide: true /* upstream drift */,\n\t\tstdio:')
  assert.notEqual(drifted, first.source)
  assert.throws(() => patchWebAppSource(drifted), /Pinned DSH browser launcher implementation changed/u)
})

test('alpha.3 keeps native turn navigation, queue images, reconnect, and schedule catalog behavior without Desktop conversation patches', async () => {
  const { assertInstalledAlpha3NativeCapabilities } = await import('../scripts/patch-official-runtime.mjs')
  const base = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai')
  const chat = readFileSync(path.join(base, 'dsh-client-ui-chat', 'lib', 'client.js'), 'utf8')
  const conversation = readFileSync(path.join(base, 'dsh-client-ui-conversation', 'lib', 'client.js'), 'utf8')
  const connection = readFileSync(path.join(base, 'dsh-client-connection', 'lib', 'client.js'), 'utf8')
  const schedule = readFileSync(path.join(base, 'dsh-client-ui-schedule', 'lib', 'client.js'), 'utf8')
  assert.match(chat, /function TurnNavigatorRail\(/u)
  assert.match(chat, /useProjection\("turnOutline"\)/u)
  assert.match(conversation, /function QueueThumb\(/u)
  assert.match(conversation, /conversation\.input\.attachments/u)
  assert.match(connection, /connection: manual reconnect requested/u)
  assert.match(connection, /backoffMaxMs: 1e4/u)
  assert.match(schedule, /function ScheduleCatalogAction\(/u)
  assert.match(schedule, /schedule-catalog/u)
  assert.equal(await assertInstalledAlpha3NativeCapabilities(), false)
  assert.equal(await assertInstalledAlpha3NativeCapabilities(), false, 'native capability verification must be idempotent')
})

test('full-response copy uses the official alpha.2 unobtrusive icon action', async () => {
  const { shouldOfferAssistantCopyText } = await import('../scripts/assistant-copy-patch.mjs')
  const source = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'), 'utf8')

  assert.equal(shouldOfferAssistantCopyText('简短回复'), false)
  assert.equal(shouldOfferAssistantCopyText('x'.repeat(599)), false)
  assert.equal(shouldOfferAssistantCopyText('x'.repeat(600)), true)
  assert.equal(shouldOfferAssistantCopyText(Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行`).join('\n')), true)
  assert.equal(shouldOfferAssistantCopyText('```js\nconsole.log("copy me")\n```'), true)

  assert.match(source, /function MessageIconActions\(\{ text, time, clock, onBranch, branchUnavailable = false, className, extraActions, usageAction, t \}\)/u)
  assert.match(source, /writeClipboard\)\(text\)\.then\(\(ok\) =>/u)
  assert.match(source, /children: copied \? \(0, react_jsx_runtime\.jsx\)\(_deepseek_ai_dsh_client_ui_primitives\.IconCheckOutline16/u)
  assert.match(source, /children: copied \? \(0, react_jsx_runtime\.jsx\)\(_deepseek_ai_dsh_client_ui_primitives\.IconCheckOutline16, \{\}\) : \(0, react_jsx_runtime\.jsx\)\(_deepseek_ai_dsh_client_ui_primitives\.IconCopyOutline16, \{\}\)/u)
  assert.match(source, /const assistantActions = messageId === void 0 \? null : renderSlot\("conversation\.chat\.assistant-actions", \{ messageId \}\)/u)
  assert.match(source, /className: TurnTailNodeView_module_css_default\.actions/u)
  assert.match(source, /"data-actions-reveal": isLatestTurn \? "always" : "hover"/u)
  assert.doesNotMatch(source, /window\.getSelection|\.innerText|hd-assistant-copy-dock/u)
  assert.doesNotThrow(() => new Function(source))
})

test('screenshots and image attachments have no arbitrary side-length or normalization resize cap', async () => {
  const { patchAttachmentProfileSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'), 'utf8')
  const first = patchAttachmentProfileSource(fixture)
  assert.match(first.source, /maxImagePixels: 64000000/u, 'decoded-pixel resource budget remains explicit')
  assert.match(first.source, /maxImageDimension: 2147483647/u, 'per-side admission cap is effectively removed')
  assert.match(first.source, /normalizedImageMaxDimension: 2147483647/u, 'accepted originals are not resized for a fixed side length')
  assert.match(first.source, /normalizedImageMaxBytes: 20971520/u, 'normalization retains the existing encoded-byte safety budget')
  assert.doesNotMatch(first.source, /maxImageDimension:\s*8192/u)
  assert.doesNotMatch(first.source, /normalizedImageMaxDimension:\s*2048/u)
  assert.equal(patchAttachmentProfileSource(first.source).changed, false)
  const drifted = fixture.replace("name: '@deepseek-ai/dsh-attachment-local'", "name: '@deepseek-ai/dsh-attachment-local-next'")
  if (drifted !== fixture) assert.throws(() => patchAttachmentProfileSource(drifted), /attachment-local profile changed/u)
})

test('extreme-aspect-ratio images retain their dimensions under the desktop attachment policy', async () => {
  const sharp = (await import('sharp')).default
  const { prepareImageFile } = await import('@deepseek-ai/dsh-attachment-local')
  const data = await sharp({ create: { width: 10000, height: 2, channels: 4, background: { r: 8, g: 16, b: 32, alpha: 1 } } }).png().toBuffer()
  const limits = {
    maxImageBytes: 20 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 200 * 1024 * 1024,
    maxImagePixels: 64000000,
    maxImageDimension: 2147483647,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  }
  const prepared = await prepareImageFile({ data, mediaType: 'image/png', name: 'ultrawide.png' }, limits, { maxDimension: 2147483647, maxPixels: 64000000, maxBytes: 20 * 1024 * 1024 })
  assert.equal(prepared.ref.width, 10000)
  assert.equal(prepared.ref.height, 2)
  assert.equal(prepared.ref.mediaType, 'image/png')
  assert.equal(prepared.ref.originalDimensions, undefined)
  await assert.rejects(
    prepareImageFile({ data, mediaType: 'image/png' }, { ...limits, maxImageDimension: 8192 }, { maxDimension: 2048, maxBytes: 4 * 1024 * 1024 }),
    error => error?.code === 'IMAGE_DIMENSION_TOO_LARGE'
  )
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

test('search exit-2 path/permission failures get do-not-repeat and glob-first guidance, fail-closed', async () => {
  const { patchFsSearchSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-tool-fs-search', 'lib', 'index.js'), 'utf8')
  const first = patchFsSearchSource(fixture)
  assert.equal(first.changed, !fixture.includes('Do NOT repeat this same search call'))
  assert.match(first.source, /if \(exitCode === 2 && \/no such file\|permission denied\|access is denied\|os error\|cannot find the path\|unable to read\|is not a directory\/i\.test\(stderr\)\)/)
  assert.match(first.source, /Do NOT repeat this same search call and do not auto-retry it/u)
  assert.match(first.source, /First use glob to discover which paths actually exist under the workspace, then narrow the \$\{toolName\} path to the existing subtree/u)
  assert.match(first.source, /no partial results are returned/u)
  assert.match(first.source, /Use the grep tool — not shell grep or rg — to search file contents\. Use read on a matched file when you need surrounding context\. A missing or unreadable target path fails closed as a search error \(ripgrep exit 2\): do NOT repeat the same call and do not auto-retry — first glob to discover which paths actually exist, then narrow the grep path to that existing subtree before searching again\./u)
  assert.match(first.source, /A missing or unreadable target path fails closed as a search error \(ripgrep exit 2\): partial results are never returned and the same call is never auto-retried — glob first to discover existing paths, then narrow the path to the existing subtree before retrying\./u)
  assert.equal(patchFsSearchSource(first.source).changed, false)

  const classifierStart = first.source.indexOf('function classifyRunFailure(')
  const classifierEnd = first.source.indexOf('\n}', classifierStart) + 2
  const classifierChunk = first.source.slice(classifierStart, classifierEnd)
  class StubSearchError extends Error {
    constructor(message, code, options) { super(message, options); this.code = code; }
  }
  const stderrExcerpt = (text, truncated) => {
    const t = text.trim();
    return t.length === 0 ? '' : truncated ? `${t} [stderr truncated]` : t;
  }
  const classifyRunFailure = Function('SearchError', 'stderrExcerpt', `${classifierChunk}; return classifyRunFailure`)(StubSearchError, stderrExcerpt)
  const missing = classifyRunFailure('grep', 2, 'error: No such file or directory (os error 2)\n', false)
  assert.equal(missing.code, 'SEARCH_FAILED')
  assert.match(missing.message, /Do NOT repeat this same search call/)
  assert.match(missing.message, /glob to discover which paths actually exist/)
  assert.doesNotMatch(missing.message, /SEARCH_INVALID_PATTERN/)
  const denied = classifyRunFailure('grep', 2, 'error: Permission denied (os error 13)\n', false)
  assert.equal(denied.code, 'SEARCH_FAILED')
  assert.match(denied.message, /Do NOT repeat this same search call/)
  const windows = classifyRunFailure('grep', 2, 'error: The system cannot find the path specified. (os error 3)\n', false)
  assert.equal(windows.code, 'SEARCH_FAILED')
  assert.match(windows.message, /Do NOT repeat this same search call/)
  assert.match(windows.message, /narrow the grep path to the existing subtree/)
  const invalidPattern = classifyRunFailure('grep', 2, 'regex parse error: unbalanced group\n', false)
  assert.equal(invalidPattern.code, 'SEARCH_INVALID_PATTERN')
  assert.doesNotMatch(invalidPattern.message, /Do NOT repeat this same search call/)
  const otherExit = classifyRunFailure('grep', 3, 'some other rg failure\n', false)
  assert.equal(otherExit.code, 'SEARCH_FAILED')
  assert.doesNotMatch(otherExit.message, /Do NOT repeat this same search call/)
  assert.match(otherExit.message, /search failed \(exit 3\)/)

  const drifted = first.source.replace('const stderr = stderrExcerpt(stderrText, stderrTruncated);', 'const stderr = stderrExcerpt(/* upstream drift */ stderrText, stderrTruncated);')
  assert.notEqual(drifted, first.source)
  assert.throws(() => patchFsSearchSource(drifted), /Pinned DSH search exit-2 failure classifier changed/)
})

test('literal edit not-found failures require a fresh read and one rebuilt retry, fail-closed', async () => {
  const { patchFsEditSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-tool-fs', 'lib', 'index.js'), 'utf8')
  const first = patchFsEditSource(fixture)

  assert.equal(first.changed, !fixture.includes('Immediately before the first edit to a target file'))
  assert.match(first.source, /FS_EDIT_NOT_FOUND: "the edit was not applied; do not repeat or guess—read the exact target file around the intended location, copy a short current literal old_string, then retry once"/u)
  assert.match(first.source, /Immediately before the first edit to a target file, read that exact file around the intended location and copy a short unique old_string verbatim/u)
  assert.match(first.source, /a read of another file, a grep\/search snippet, a remembered fragment, or an inferred function shape is not a valid basis/u)
  assert.match(first.source, /A missing match is a safe no-op and requires a fresh target-file read, never fuzzy replacement\./u)
  assert.match(first.source, /Short unique literal copied verbatim from the latest read of this exact target file/u)
  assert.equal(patchFsEditSource(first.source).changed, false)

  const remediationStart = first.source.indexOf('const REMEDIES = {')
  const remediationEnd = first.source.indexOf('\n//#endregion', remediationStart)
  assert.ok(remediationStart >= 0 && remediationEnd > remediationStart)
  const remediationChunk = first.source.slice(remediationStart, remediationEnd)
  class StubFsError extends Error {
    constructor(message, code, options) { super(message, options); this.code = code }
  }
  const remediateFsError = Function('FsError', `${remediationChunk}; return remediateFsError`)(StubFsError)
  const original = new StubFsError('old_string was not found in "target.js"', 'FS_EDIT_NOT_FOUND')
  const remediated = remediateFsError(original)
  assert.equal(remediated.code, 'FS_EDIT_NOT_FOUND')
  assert.equal(remediated.cause, original)
  assert.match(remediated.message, /do not repeat or guess/u)
  assert.match(remediated.message, /read the exact target file/u)
  assert.match(remediated.message, /retry once/u)
  const unrelated = new StubFsError('unrelated', 'FS_OTHER')
  assert.equal(remediateFsError(unrelated), unrelated)

  const driftAnchor = fixture.includes('FS_NOT_OBSERVED: "read the exact target file before editing it, then retry"')
    ? 'FS_NOT_OBSERVED: "read the exact target file before editing it, then retry"'
    : 'FS_NOT_OBSERVED: "read the file, then retry"'
  const drifted = fixture.replace(driftAnchor, `${driftAnchor} /* upstream drift */`)
  assert.notEqual(drifted, fixture)
  assert.throws(() => patchFsEditSource(drifted), /Pinned DSH edit not-found remediation changed/u)
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
