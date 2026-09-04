const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const vm = require('node:vm')

const alpha2CandidateRoot = process.env.DSH_ALPHA2_CANDIDATE_ROOT || path.resolve(__dirname, '..')
const alpha2CandidateVersion = (() => {
  try {
    return JSON.parse(readFileSync(path.join(alpha2CandidateRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version
  } catch {
    return null
  }
})()
const alpha2FixtureTest = alpha2CandidateVersion === '0.1.2-alpha.2' ? test : (name, fn) => test.skip(name, fn)

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

const mcpStartupFixture = `const GENERATION_CLOSE_TIMEOUT_MS = 5e3;
async function syncTools(client, ctx, opts, previous) {
	for (const dispose of previous.values()) dispose();
	return previous;
}
function startConnection(ctx, config, policy) {
	let disposers;
	let syncChain = Promise.resolve();
	const isCurrent = () => true;
	function enqueueSync(generation, syncOpts = opts) {
		const run = syncChain.then(async () => {
			disposers = await syncTools(generation, ctx, syncOpts, disposers);
		});
		syncChain = run.catch(() => {});
		return run;
	}
	function waitForClose(closed) {
		return Promise.resolve(true);
	}
	function scheduleReconnect() {
		return policy;
	}
	async function connectGeneration(startup) {
		const generation = createGeneration();
		const closed = Promise.withResolvers();
		let attemptSettled = false;
		const hasClosed = () => false;
		try {
			await generation.connect(createTransport(config));
			if (hasClosed()) {
				attemptSettled = true;
				generationDown(generation);
				return;
			}
			await enqueueSync(generation, startup ? startupOpts : opts);
		} catch (error) {
			try {
				await generation.close();
			} catch {}
			const quiesced = hasClosed() || await waitForClose(closed.promise);
			if (!quiesced) return;
		}
	}
	return {
		async dispose() {
			const current = client;
			const currentClosed = clientClosed;
			if (current !== void 0) {
				try {
					await current.close();
				} catch {}
				if (currentClosed !== void 0 && !await waitForClose(currentClosed)) report();
			}
			await settling;
			await syncChain;
		}
	};
}
async function apply(ctx, config) {
	const connection = startConnection(ctx, config, reconnect);
	const outcome = await connection.ready;
	if (outcome.error !== void 0 && config.failOnStartupError) throw new Error(\`mcp-client(\${config.serverName}): initial connection or tool synchronization failed\`, { cause: outcome.error });
}`

test('MCP startup patch bounds connect plus first tool sync and leaves optional integrations non-blocking', async () => {
  const { patchMcpClientStartupTimeoutSource } = await import('../scripts/patch-official-runtime.mjs')
  const patched = patchMcpClientStartupTimeoutSource(mcpStartupFixture)
  assert.equal(patched.changed, true)
  for (const marker of [
    'const CONNECTION_ATTEMPT_TIMEOUT_MS = 8e3;',
    'const completed = await Promise.race([',
    'connection and initial tool sync timed out',
    'function requestClose(generation)',
    'requestClose(current);',
    'if (!config.failOnStartupError) return;',
    'if (!isActive()) return previous;',
    'attemptQuiesced, syncQuiesced'
  ]) assert.match(patched.source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.equal(patchMcpClientStartupTimeoutSource(patched.source).changed, false)
  assert.throws(() => patchMcpClientStartupTimeoutSource(patched.source.replace('const CONNECTION_ATTEMPT_TIMEOUT_MS = 8e3;\n', '')), /incomplete/u)
  assert.throws(() => patchMcpClientStartupTimeoutSource(mcpStartupFixture.replace('await generation.connect(createTransport(config));', 'await generation.connect(changedTransport);')), /connection attempt changed/u)
})

test('installed alpha.5 MCP client and Goal tool are exact complete patched artifacts', async () => {
  const { patchInstalledMcpClient, patchInstalledGoalTool } = await import('../scripts/patch-official-runtime.mjs')
  const mcpFile = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-mcp-client', 'lib', 'index.js')
  const goalFile = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-tool-goal', 'lib', 'index.js')
  assert.equal(await patchInstalledMcpClient(mcpFile), false)
  assert.equal(await patchInstalledGoalTool(goalFile), false)
  assert.equal(createHash('sha256').update(readFileSync(mcpFile)).digest('hex').toUpperCase(), '58254A778587C06DBAE6BC2B811C9D3DA5AE4EB2565A371B960C3CA27A273A18')
  assert.equal(createHash('sha256').update(readFileSync(goalFile)).digest('hex').toUpperCase(), '742551EB41DDF0FC96D736A888454FCA5801EEA5C5A89800EA774DF12EB7EB23')
})

test('alpha.5 chat scroll-state patch is exact-hash bound, fail-closed, idempotent, and leaves alpha.4 untouched', async () => {
  const {
    patchAlpha5ChatScrollSource,
    patchAlpha5ChatSentTimeSnapshotSource,
    patchInstalledAlpha5ChatScroll,
    restoreAlpha5ChatScrollSource,
    restoreAlpha5ChatSentTimeSnapshotSource
  } = await import('../scripts/patch-official-runtime.mjs')
  const installedFile = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js')
  const installed = readFileSync(installedFile, 'utf8')
  const official = restoreAlpha5ChatSentTimeSnapshotSource(restoreAlpha5ChatScrollSource(installed))
  assert.equal(createHash('sha256').update(official).digest('hex').toUpperCase(), '9C9874C57B7D3E5A71222A72E0F19ED8D884C40F895D898640C882D49BD1B231')
  const scrollExpected = patchAlpha5ChatScrollSource(official)
  assert.equal(scrollExpected.changed, true)
  assert.equal(createHash('sha256').update(scrollExpected.source).digest('hex').toUpperCase(), '4C05AE99A177B83E9F32F5D0459F5BBA595D2701A02B6B635CE14FD0416BFF06')
  const expected = patchAlpha5ChatSentTimeSnapshotSource(scrollExpected.source)
  assert.equal(expected.changed, true)
  assert.equal(createHash('sha256').update(expected.source).digest('hex').toUpperCase(), '27439B98CFB2A8DA1C4CD3E1CEF17088CFF3DEF636676BDF93939C8E7753D018')
  assert.equal(patchAlpha5ChatScrollSource(expected.source).changed, false)
  assert.equal(patchAlpha5ChatSentTimeSnapshotSource(expected.source).changed, false)
  assert.equal(restoreAlpha5ChatSentTimeSnapshotSource(restoreAlpha5ChatScrollSource(expected.source)), official)
  for (const marker of [
    'function deriveChatScrollIntent(',
    'function createChatScrollIntentMachine(',
    'const onScrollIntentRef = (0, react.useRef)',
    'Reader/follower intent is already current',
    'machine.dispose();',
    '"message.sentTimeSnapshot": "发送时快照"',
    '"message.sentTimeSnapshot": "Sent-time snapshot"'
  ]) assert.equal(expected.source.split(marker).length - 1, 1, `${marker} must occur exactly once`)
  assert.match(expected.source, /children: t\("message\.turnError"\) \+ " · " \+ t\("message\.sentTimeSnapshot"\)/u)
  assert.match(expected.source, /commitIntent: \(\) => onScrollIntentRef\.current\(true, local, el\)/u)
  assert.match(expected.source, /\(0, react\.useLayoutEffect\)\(\(\) => \{[\s\S]*?const machine = createChatScrollIntentMachine/u)
  assert.doesNotMatch(expected.source, /Reader\/follower intent is already current;[\s\S]{0,160}scrollSamplePendingRef\.current/u)

  const temporary = mkdtempSync(path.join(os.tmpdir(), 'dsh-alpha5-chat-scroll-'))
  const packageRoot = path.join(temporary, 'dsh-client-ui-chat')
  const file = path.join(packageRoot, 'lib', 'client.js')
  mkdirSync(path.dirname(file), { recursive: true })
  try {
    writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-chat', version: '0.1.2-alpha.5' }))
    writeFileSync(file, official)
    assert.equal(await patchInstalledAlpha5ChatScroll(file), true)
    assert.equal(readFileSync(file, 'utf8'), expected.source)
    assert.equal(await patchInstalledAlpha5ChatScroll(file), false)

    writeFileSync(file, expected.source.replace('machine.dispose();', 'machine.dispose /* drift */;'))
    await assert.rejects(patchInstalledAlpha5ChatScroll(file), /neither exact official nor an exact complete Desktop chat artifact/u)

    writeFileSync(file, official)
    writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@example/forged-chat', version: '0.1.2-alpha.5' }))
    await assert.rejects(patchInstalledAlpha5ChatScroll(file), /Pinned DSH chat identity changed/u)

    writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-chat', version: '0.1.2-alpha.4' }))
    assert.equal(await patchInstalledAlpha5ChatScroll(file), false)
    assert.equal(readFileSync(file, 'utf8'), official)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('alpha.5 root and selected official dependency graphs are exact, registry-backed, and unmixed', async () => {
  const root = path.resolve(__dirname, '..')
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const installedCore = JSON.parse(readFileSync(path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
  const { classifyOfficialRuntimeGraph } = await import('../scripts/patch-official-runtime.mjs')
  assert.deepEqual(classifyOfficialRuntimeGraph(manifest, lock, installedCore), {
    mode: 'alpha5',
    version: '0.1.2-alpha.5',
    directRootCount: 26,
    selectedPackageCount: 215
  })
  const roots = [...Object.entries(manifest.dependencies), ...Object.entries(manifest.optionalDependencies || {})]
    .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  assert.equal(roots.length, 26)
  assert.ok(roots.every(([, version]) => version === '0.1.2-alpha.5'))
  const selected = Object.entries(lock.packages)
    .filter(([location]) => location.split('node_modules/').at(-1)?.startsWith('@deepseek-ai/dsh'))
  assert.equal(selected.length, 215)
  assert.equal(new Set(selected.map(([location, entry]) => entry.name || location.split('node_modules/').at(-1))).size, 214)
  assert.ok(selected.every(([, entry]) => entry.version === '0.1.2-alpha.5'))
  assert.ok(selected.every(([, entry]) => entry.resolved.startsWith('https://registry.npmjs.org/@deepseek-ai/')))
  assert.ok(selected.every(([, entry]) => /^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity)))
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-tool-subagent-report'], undefined)

  const [sampleLocation] = selected[0]
  const mirrorLock = structuredClone(lock)
  mirrorLock.packages[sampleLocation].resolved = mirrorLock.packages[sampleLocation].resolved.replace('registry.npmjs.org', 'registry.npmmirror.com')
  assert.throws(() => classifyOfficialRuntimeGraph(manifest, mirrorLock, installedCore), /selected lock artifact is not canonical/u)
  const mixedLock = structuredClone(lock)
  mixedLock.packages[sampleLocation].version = '0.1.2-alpha.4'
  assert.throws(() => classifyOfficialRuntimeGraph(manifest, mixedLock, installedCore), /selected lock version mismatch/u)
})

alpha2FixtureTest('alpha.2 installed workspace wrapper enforces the exact transformed output guard', async () => {
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

alpha2FixtureTest('alpha.2 removes the legacy runtime and keeps session projection work in Session Controller', async () => {
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

alpha2FixtureTest('alpha.2 Session Controller real bundle enforces keyed dirtiness, bounded scheduling and linear cache cleanup', async () => {
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

test('alpha.5 keeps native turn navigation, queue images, reconnect, schedule catalog, and session lineage behavior without Desktop overrides', async () => {
  const { assertInstalledAlpha5NativeCapabilities } = await import('../scripts/patch-official-runtime.mjs')
  const base = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai')
  const chat = readFileSync(path.join(base, 'dsh-client-ui-chat', 'lib', 'client.js'), 'utf8')
  const conversation = readFileSync(path.join(base, 'dsh-client-ui-conversation', 'lib', 'client.js'), 'utf8')
  const connection = readFileSync(path.join(base, 'dsh-client-connection', 'lib', 'client.js'), 'utf8')
  const schedule = readFileSync(path.join(base, 'dsh-client-ui-schedule', 'lib', 'client.js'), 'utf8')
  const session = readFileSync(path.join(base, 'dsh-session', 'lib', 'index.js'), 'utf8')
  assert.match(chat, /function TurnNavigatorRail\(/u)
  assert.match(chat, /useProjection\("turnOutline"\)/u)
  assert.match(conversation, /function QueueThumb\(/u)
  assert.match(conversation, /conversation\.input\.attachments/u)
  assert.match(connection, /connection: manual reconnect requested/u)
  assert.match(connection, /backoffMaxMs: 1e4/u)
  assert.match(schedule, /function ScheduleCatalogAction\(/u)
  assert.match(schedule, /schedule-catalog/u)
  assert.match(session, /function SessionSeq\(value\) \{/u)
  assert.match(session, /inheritedEventCount;/u)
  assert.match(session, /ownEvents\(\) \{\s*return this\.snapshotEvents\(this\.inheritedEventCount\);/u)
  assert.equal(await assertInstalledAlpha5NativeCapabilities(), false)
  assert.equal(await assertInstalledAlpha5NativeCapabilities(), false, 'native capability verification must be idempotent')
})

test('alpha.5 exposes the audited cross-version projection-cache recovery API', () => {
  const base = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai')
  const projectionCache = readFileSync(path.join(base, 'dsh-session-projection-cache', 'lib', 'index.js'), 'utf8')
  const storageTypes = readFileSync(path.join(base, 'dsh-storage', 'lib', 'types', 'backend.d.ts'), 'utf8')
  const storageDomain = readFileSync(path.join(base, 'dsh-storage-domain', 'lib', 'index.js'), 'utf8')
  const storageJson = readFileSync(path.join(base, 'dsh-storage-json', 'lib', 'index.js'), 'utf8')
  assert.match(projectionCache, /version: 5,\s*compatibleVersions: \[3, 4\],\s*invalidRecords: "backup-and-skip"/u)
  assert.match(projectionCache, /isSeeded: z\$1\.boolean\(\)\.optional\(\)/u)
  assert.match(projectionCache, /inheritedEventCount: z\$1\.number\(\)\.int\(\)\.nonnegative\(\)\.transform\(SessionLogOffset\)\.optional\(\)/u)
  assert.match(storageTypes, /readonly compatibleVersions\?: readonly number\[\]/u)
  assert.match(storageTypes, /backupRecord\?\(table: string, key: string\): Promise<string>/u)
  assert.match(storageDomain, /spec\.invalidRecords !== "backup-and-skip" \|\| unit\.backupRecord === void 0/u)
  assert.match(storageDomain, /const moved = await unit\.backupRecord\(table, key\);/u)
  assert.match(storageJson, /function acceptedStamps\(descriptor\) \{\s*return \[descriptor\.version, \.\.\.descriptor\.compatibleVersions \?\? \[\]\];/u)
  assert.match(storageJson, /async backupRecord\(table, key\) \{[\s\S]{0,500}await this\.tracked\(rename\(path, moved\)\);/u)
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

test('alpha.5 subagent lifecycle exposes only bounded terminal diagnostics and exact activation receipts', async () => {
  const { patchAlpha5SubagentLifecycleSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-subagent', 'lib', 'index.js'), 'utf8')
  const first = patchAlpha5SubagentLifecycleSource(fixture)
  assert.match(first.source, /function boundedSubagentTerminalDiagnostic\(stopReason, source, partialOutputPresent\)/u)
  assert.match(first.source, /terminalDiagnostic: boundedSubagentTerminalDiagnostic\("error", failure, false\)/u)
  assert.match(first.source, /emit\("subagent\/accepted", \{[\s\S]*?\.\.\.identity,[\s\S]*?messageId/u)
  assert.match(first.source, /queueSubagentPromptWithActivation = Symbol\.for\("dsh\.subagent\.queuePromptWithActivation"\)/u)
  assert.match(first.source, /activationReceipt: true/u)
  assert.match(first.source, /runId: activation\.observer\.runId/u)
  assert.match(first.source, /failure === void 0 \? captured : \{ stopReason: "error" \}/u)
  assert.equal(patchAlpha5SubagentLifecycleSource(first.source).changed, false)

  const helperStart = first.source.indexOf('function boundedSubagentTerminalDiagnostic(')
  const helperEnd = first.source.indexOf('\n}\nfunction createLifecycleEmitter', helperStart) + 2
  assert.ok(helperStart >= 0 && helperEnd > helperStart)
  const boundedDiagnostic = Function(`${first.source.slice(helperStart, helperEnd)}; return boundedSubagentTerminalDiagnostic`)()
  assert.equal(boundedDiagnostic('completed', 'ignored secret', true), undefined)
  assert.deepEqual(boundedDiagnostic('max-tokens', undefined, true), {
    code: 'SUBAGENT_MAX_TOKENS',
    category: 'resource_limit',
    stage: 'work_followup',
    retryable: true,
    partialOutputPresent: true,
    nextAction: 'retry_current_task'
  })
  const timeout = boundedDiagnostic('error', 'provider timed out at C:\\private\\secret token=123', true)
  assert.deepEqual(timeout, {
    code: 'SUBAGENT_TIMEOUT',
    category: 'lifecycle_timeout',
    stage: 'work_followup',
    retryable: true,
    partialOutputPresent: true,
    nextAction: 'retry_current_task'
  })
  assert.doesNotMatch(JSON.stringify(timeout), /private|secret|token|provider timed out/u)
  const teardown = boundedDiagnostic('error', { code: 'ACTIVATION_TEARDOWN_FAILED', message: 'raw provider output' }, false)
  assert.deepEqual(teardown, {
    code: 'SUBAGENT_ACTIVATION_TEARDOWN_FAILED',
    category: 'teardown',
    stage: 'retirement',
    retryable: false,
    partialOutputPresent: false,
    nextAction: 'view_live_status'
  })
  const piError = boundedDiagnostic('error', { code: 'PI_AI_ERROR', message: 'Not Found: private provider route C:\\secret' }, true)
  assert.deepEqual(piError, { code: 'PI_AI_ERROR', category: 'provider_transient', stage: 'provider_dispatch', retryable: true, partialOutputPresent: true, nextAction: 'retry_current_task' })
  assert.doesNotMatch(JSON.stringify(piError), /Not Found|private provider|secret/u)
  let getterReads = 0
  const hostile = {}
  Object.defineProperty(hostile, 'code', { get() { getterReads += 1; throw new Error('must not escape') } })
  Object.defineProperty(hostile, 'message', { get() { getterReads += 1; throw new Error('must not escape') } })
  assert.deepEqual(boundedDiagnostic('error', hostile, false), {
    code: 'SUBAGENT_ERROR',
    category: 'internal',
    stage: 'work_followup',
    retryable: false,
    partialOutputPresent: false,
    nextAction: 'view_live_status'
  })
  assert.equal(getterReads, 0)

  const observerStart = first.source.indexOf('function createActivationObserver(')
  const observerEnd = first.source.indexOf('\n}\n/**\n* Why this child', observerStart) + 2
  assert.ok(observerStart >= 0 && observerEnd > observerStart)
  const partial = [{ type: 'text', text: 'failed turn text is lifecycle-only' }]
  const createObserver = Function('SubagentRunId', 'randomUUID', 'SessionLogOffset', 'finalAssistantOutput', 'epochStopReason', 'boundedSubagentTerminalDiagnostic', `${first.source.slice(observerStart, observerEnd)}; return createActivationObserver`)(
    value => value,
    () => 'exact-run-id',
    value => value,
    () => partial,
    () => 'refusal',
    boundedDiagnostic
  )
  const events = []
  const observer = createObserver((name, info, parent) => events.push({ name, info, parent }), 'spawn', 'exact-child-id', 'exact-parent')
  const child = { session: { seq: 7, snapshotEvents: () => [] } }
  assert.equal(observer.runId, 'exact-run-id')
  observer.start(child)
  observer.accept('accepted-message-id')
  observer.capture(child)
  observer.settle()
  assert.deepEqual(events.map(event => event.name), ['subagent/start', 'subagent/accepted', 'subagent/end'])
  assert.deepEqual(events[1].info, { runId: 'exact-run-id', provider: 'spawn', id: 'exact-child-id', local: true, messageId: 'accepted-message-id' })
  assert.equal(events[2].info.stopReason, 'refusal')
  assert.deepEqual(events[2].info.terminalDiagnostic, { code: 'SUBAGENT_REFUSAL', category: 'policy', stage: 'work_followup', retryable: false, partialOutputPresent: true, nextAction: 'view_live_status' })
  assert.equal(events[2].info.lastAssistantMessage, partial)
  assert.doesNotMatch(JSON.stringify(events[2].info.terminalDiagnostic), /failed turn text/u)

  const teardownEvents = []
  const teardownObserver = createObserver((name, info) => teardownEvents.push({ name, info }), 'spawn', 'teardown-child', 'exact-parent')
  teardownObserver.start(child)
  teardownObserver.capture(child)
  teardownObserver.settle({ code: 'ACTIVATION_TEARDOWN_FAILED', message: 'raw provider output and path' })
  const teardownEnd = teardownEvents.at(-1).info
  assert.equal(teardownEnd.stopReason, 'error')
  assert.equal(teardownEnd.lastAssistantMessage, undefined, 'teardown failure wins and withholds captured output')
  assert.deepEqual(teardownEnd.terminalDiagnostic, { code: 'SUBAGENT_ACTIVATION_TEARDOWN_FAILED', category: 'teardown', stage: 'retirement', retryable: false, partialOutputPresent: true, nextAction: 'view_live_status' })
  assert.doesNotMatch(JSON.stringify(teardownEnd), /raw provider|path|failed turn text/u)
})

test('alpha.5 installed subagent lifecycle patch is exact-hash bound, repeatable, and preserves alpha.4 behavior', async () => {
  const { patchAlpha5SubagentLifecycleSource, patchInstalledSubagentContinuation } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-subagent', 'lib', 'index.js'), 'utf8')
  const expected = patchAlpha5SubagentLifecycleSource(fixture).source
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dsh-alpha5-subagent-patch-'))
  const packageRoot = path.join(temp, 'dsh-subagent')
  const file = path.join(packageRoot, 'lib', 'index.js')
  mkdirSync(path.dirname(file), { recursive: true })
  try {
    writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-subagent', version: '0.1.2-alpha.5' }))
    writeFileSync(file, fixture)
    assert.equal(await patchInstalledSubagentContinuation(file), fixture !== expected)
    assert.equal(readFileSync(file, 'utf8'), expected)
    assert.equal(await patchInstalledSubagentContinuation(file), false)

    writeFileSync(file, `${expected}\n// raw-provider-secret C:\\private\\prompt`)
    await assert.rejects(
      patchInstalledSubagentContinuation(file),
      error => error?.message === 'Pinned DSH alpha.5 subagent source is neither exact official nor exact complete patched artifact; refusing an unsafe lifecycle patch.'
    )

    writeFileSync(file, expected)
    writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@example/forged-subagent', version: '0.1.2-alpha.5' }))
    await assert.rejects(patchInstalledSubagentContinuation(file), /Pinned DSH subagent identity changed/u)

    const alpha4Original = `prefix\n\t\t\t\tif (!settling.settling) {\n\t\t\t\t\tif (activation.handle.agent.status !== "running") await poked;\n\t\t\t\t\tcontinue;\n\t\t\t\t}\nsuffix`
    writeFileSync(file, alpha4Original)
    writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-subagent', version: '0.1.2-alpha.4' }))
    assert.equal(await patchInstalledSubagentContinuation(file), true)
    assert.match(readFileSync(file, 'utf8'), /activation\.accepted\.size > 0 && agent\.inbox\.hasPending/u)
    assert.equal(await patchInstalledSubagentContinuation(file), false)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
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
    const complete = ['harness-desktop:agent-team-live-status', 'const safeTeamLiveCount =', 'const menuId = (0, react.useId)();', 'changeOpen(!open);'].every(marker => fixture.includes(marker)) && !fixture.includes('openTitle();')
    assert.equal(first.changed, !complete, 'official lineage receives the bounded realtime bridge and whole-chip disclosure exactly once')
    assert.equal(createHash('sha256').update(first.source).digest('hex').toUpperCase(), '035C0B528D341F031886BEF5B4910E83BF502748CE6D0633126590A7DB68372D')
    assert.match(first.source, /"switcher\.aria": "切换子代理：\{title\}"/)
    assert.match(first.source, /name: "conversation\.session\.header\.lineage"/)
    assert.match(first.source, /openChild\(\{/)
    assert.match(first.source, /harness-desktop:agent-team-live-status/u)
    assert.match(first.source, /window\.__DSH_AGENT_TEAM_LIVE_STATUS__/u)
    assert.match(first.source, /const safeTeamLiveCount = \(value\) => Number\.isSafeInteger\(value\)/u)
    assert.match(first.source, /const teamLiveActiveCount =/u)
    assert.doesNotMatch(first.source, /Number\(teamLiveCounts\./u)
    assert.match(first.source, /Math\.max\(healthy\.length, descendants\.count, teamLiveActiveCount\)/u)
    assert.match(first.source, /removeEventListener\("harness-desktop:agent-team-live-status", updateTeamLiveStatus\)/u)
    assert.match(first.source, /const menuId = \(0, react\.useId\)\(\);/u)
    assert.match(first.source, /"aria-expanded": open,\s*"aria-controls": menuId,/u)
    assert.match(first.source, /onClick: \(\) => \{\s*cancelHoverOpen\(\);\s*changeOpen\(!open\);\s*\},/u)
    assert.doesNotMatch(first.source, /openTitle\(\);/u)
    assert.match(first.source, /id: menuId,\s*ref: menuRef,/u)
    assert.match(first.source, /\.ZKlsPq_trigger,\.ZKlsPq_switcherTrigger\{min-width:44px;min-height:44px;/u)
    assert.match(first.source, /\.ZKlsPq_trigger:focus-visible,\.ZKlsPq_switcherTrigger:focus-visible\{outline:2px solid/u)
    assert.match(first.source, /@media\(prefers-reduced-motion:reduce\)\{\.ZKlsPq_trigger svg,\.ZKlsPq_switcherTrigger svg\{transition:none\}\}/u)
    assert.doesNotMatch(first.source, /removeChild|deleteSubagent|archiveSubagent/)
    assert.doesNotThrow(() => new Function(first.source))
    assert.equal(patchSubagentSource(first.source).changed, false)
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

test('alpha.5 subagent header uses one whole-chip disclosure trigger for pointer and keyboard activation', async () => {
  const { patchSubagentSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-ui-subagent', 'lib', 'client.js'), 'utf8')
  const patched = patchSubagentSource(fixture).source
  const instrumented = patched.replace('exports.apply = apply;', 'exports.__catalogDisclosureTest = { CatalogDropdown };\n\t\texports.apply = apply;')
  assert.notEqual(instrumented, patched)

  function harness() {
    const state = [], refs = [], ids = [], catalogCalls = []
    let stateCursor = 0, refCursor = 0, idCursor = 0, exports
    const jsx = (type, props, key) => ({ type, key, props: props || {} })
    const react = {
      useState(initial) {
        const index = stateCursor++
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
      },
      useRef(initial) { const index = refCursor++; refs[index] ||= { current: initial }; return refs[index] },
      useMemo(work) { return work() },
      useEffect() {},
      useId() { const index = idCursor++; ids[index] ||= `catalog-menu-${index}`; return ids[index] }
    }
    const document = { querySelector() { return null }, createElement() { return { dataset: {}, textContent: '' } }, head: { appendChild() {} }, body: {} }
    const window = {
      innerWidth: 1200,
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: { load(definition) { exports = definition.factory(name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'fragment' } : name === 'react-dom' ? { createPortal: child => ({ type: 'portal', props: { children: child } }) } : name === '@deepseek-ai/dsh-client-ui-primitives' ? new Proxy({}, { get: (_target, key) => String(key) }) : (() => { throw new Error(`unexpected module ${name}`) })()) } }
    }
    vm.runInNewContext(instrumented, { window, document, console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Date, Math, Number, Object, Set, Map })
    const store = {
      subagentsByParent: { root: { state: 'ready', error: null, parentAvailable: true, entries: [{ kind: 'child', id: 'child', label: '可继续', activity: 'inactive', mode: 'continuable' }] } },
      byId: { child: { id: 'child', origin: 'subagent', parentId: 'root', running: false, projectionValues: { subagent: { mode: 'continuable' } } } }
    }
    const render = () => {
      stateCursor = 0; refCursor = 0; idCursor = 0
      const root = exports.__catalogDisclosureTest.CatalogDropdown({ rootSessionId: 'root', variant: 'count', separator: true, useSessions: select => select(store), openChild() {}, refresh() {}, setCatalogOpen: (...args) => catalogCalls.push(args), t: (key, values) => `${key}:${JSON.stringify(values || {})}` })
      const trigger = root.props.children[1]
      trigger.props.ref.current = { getBoundingClientRect: () => ({ left: 20, bottom: 40 }), focus() {} }
      return { root, trigger }
    }
    return { render, state, catalogCalls }
  }

  function nestedButtonCount(node) {
    if (!node || typeof node !== 'object') return 0
    const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]
    return (node.type === 'button' ? 1 : 0) + children.reduce((total, child) => total + nestedButtonCount(child), 0)
  }

  for (const targetIndex of [0, 1]) {
    const current = harness(), initial = current.render(), target = initial.trigger.props.children[targetIndex]
    assert.equal(initial.trigger.type, 'button')
    assert.equal(nestedButtonCount({ props: { children: initial.trigger.props.children } }), 0, 'the disclosure contains no nested button')
    assert.equal(initial.trigger.props.type, 'button')
    assert.equal(initial.trigger.props['aria-expanded'], false)
    assert.equal(initial.trigger.props['aria-controls'], 'catalog-menu-0')
    assert.equal(target.props?.onClick, undefined, 'body and caret remain children of the one native button')
    initial.trigger.props.onClick({ target, currentTarget: initial.trigger })
    assert.equal(current.state[0], true, targetIndex === 0 ? 'status/text body opens' : 'caret opens')
    assert.deepEqual(current.catalogCalls, [['root', true]], 'one pointer activation changes the catalog exactly once')
    const opened = current.render()
    assert.equal(opened.trigger.props['aria-expanded'], true)
    assert.equal(opened.root.props.children[2].props.children.props.id, opened.trigger.props['aria-controls'])
    opened.trigger.props.onClick({ target: opened.trigger.props.children[targetIndex], currentTarget: opened.trigger })
    assert.equal(current.state[0], false)
    assert.deepEqual(current.catalogCalls, [['root', true], ['root', false]], 'one close activation closes exactly once without caret bubbling a second toggle')
  }

  for (const key of ['Enter', ' ']) {
    const current = harness(), initial = current.render()
    let prevented = 0
    initial.trigger.props.onKeyDown({ key, preventDefault() { prevented += 1 } })
    assert.equal(current.state[0], false, `${key} relies on native button activation without a second manual toggle`)
    assert.equal(prevented, 0)
    initial.trigger.props.onClick({ key })
    assert.equal(current.state[0], true)
    assert.deepEqual(current.catalogCalls, [['root', true]])
  }

  assert.match(patched, /document\.addEventListener\("pointerdown", closeOutside\)/u)
  assert.match(patched, /openChild\(\{[\s\S]*?closeCatalog\(\);/u)
  assert.equal(patchSubagentSource(patched).changed, false, 'HMR/repeated patching never nests another trigger or handler')
})

test('alpha.5 switcher variants toggle one dropdown from every chip point without invoking openTitle', async () => {
  const { patchSubagentSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-ui-subagent', 'lib', 'client.js'), 'utf8')
  const patched = patchSubagentSource(fixture).source
  const instrumented = patched.replace('exports.apply = apply;', 'exports.__catalogDisclosureTest = { CatalogDropdown };\n\t\texports.apply = apply;')
  assert.notEqual(instrumented, patched)

  function harness({ ancestor = false, initiallyOpen = false } = {}) {
    const state = initiallyOpen ? [true] : [], refs = [], ids = [], catalogCalls = [], openTitleCalls = []
    let stateCursor = 0, refCursor = 0, idCursor = 0, exports
    const jsx = (type, props, key) => ({ type, key, props: props || {} })
    const react = {
      useState(initial) {
        const index = stateCursor++
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
      },
      useRef(initial) { const index = refCursor++; refs[index] ||= { current: initial }; return refs[index] },
      useMemo(work) { return work() },
      useEffect() {},
      useId() { const index = idCursor++; ids[index] ||= `switcher-menu-${index}`; return ids[index] }
    }
    const document = { querySelector() { return null }, createElement() { return { dataset: {}, textContent: '' } }, head: { appendChild() {} }, body: {} }
    const window = {
      innerWidth: 1200,
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: { load(definition) { exports = definition.factory(name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'fragment' } : name === 'react-dom' ? { createPortal: child => ({ type: 'portal', props: { children: child } }) } : name === '@deepseek-ai/dsh-client-ui-primitives' ? new Proxy({}, { get: (_target, key) => String(key) }) : (() => { throw new Error(`unexpected module ${name}`) })()) } }
    }
    vm.runInNewContext(instrumented, { window, document, console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Date, Math, Number, Object, Set, Map })
    const store = {
      subagentsByParent: { root: { state: 'ready', error: null, parentAvailable: true, entries: [{ kind: 'child', id: 'child', label: '当前子代理', activity: 'inactive', mode: 'continuable' }] } },
      byId: { child: { id: 'child', origin: 'subagent', parentId: 'root', running: false, projectionValues: { subagent: { mode: 'continuable' } } } }
    }
    const render = () => {
      stateCursor = 0; refCursor = 0; idCursor = 0
      const props = { rootSessionId: 'root', currentSessionId: 'child', displayTitle: 'fallback title', variant: 'switcher', separator: false, useSessions: select => select(store), openChild() {}, refresh() {}, setCatalogOpen: (...args) => catalogCalls.push(args), t: (key, values) => `${key}:${JSON.stringify(values || {})}` }
      if (ancestor) props.openTitle = () => openTitleCalls.push('open-title')
      const root = exports.__catalogDisclosureTest.CatalogDropdown(props)
      const trigger = root.props.children[1]
      trigger.props.ref.current = { getBoundingClientRect: () => ({ left: 20, bottom: 40 }), focus() {} }
      return { root, trigger }
    }
    return { render, state, catalogCalls, openTitleCalls }
  }

  function nestedButtonCount(node) {
    if (!node || typeof node !== 'object') return 0
    const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]
    return (node.type === 'button' ? 1 : 0) + children.reduce((total, child) => total + nestedButtonCount(child), 0)
  }

  for (const targetIndex of [0, 1]) {
    const current = harness(), initial = current.render(), target = initial.trigger.props.children[targetIndex]
    assert.equal(initial.trigger.type, 'button')
    assert.equal(initial.trigger.props.type, 'button')
    assert.equal(initial.trigger.props['aria-expanded'], false)
    assert.equal(initial.trigger.props['aria-controls'], 'switcher-menu-0')
    assert.match(initial.trigger.props['aria-label'], /^switcher\.aria:/u)
    assert.equal(initial.trigger.props.children[0].props.children, '当前子代理')
    assert.equal(nestedButtonCount({ props: { children: initial.trigger.props.children } }), 0)
    assert.equal(target.props?.onClick, undefined, 'switcher title and icon stay inside one native disclosure button')
    initial.trigger.props.onClick({ target, currentTarget: initial.trigger })
    assert.equal(current.state[0], true, targetIndex === 0 ? 'current subagent title opens' : 'current subagent icon opens')
    assert.deepEqual(current.catalogCalls, [['root', true]], 'one switcher pointer activation toggles exactly once')
    const opened = current.render()
    assert.equal(opened.trigger.props['aria-expanded'], true)
    assert.equal(opened.root.props.children[2].props.children.props.id, opened.trigger.props['aria-controls'])
    opened.trigger.props.onClick({ target: opened.trigger.props.children[targetIndex], currentTarget: opened.trigger })
    assert.equal(current.state[0], false)
    assert.deepEqual(current.catalogCalls, [['root', true], ['root', false]], 'one switcher close does not bubble into a second toggle')
  }

  for (const key of ['Enter', ' ']) {
    const current = harness(), initial = current.render()
    let prevented = 0
    initial.trigger.props.onKeyDown({ key, preventDefault() { prevented += 1 } })
    assert.equal(current.state[0], false, `${key} has no manual switcher toggle`)
    assert.equal(prevented, 0)
    initial.trigger.props.onClick({ key })
    assert.equal(current.state[0], true)
    assert.deepEqual(current.catalogCalls, [['root', true]], `${key} relies on the native button click exactly once`)
  }

  for (const targetIndex of [0, 1]) {
    const ancestor = harness({ ancestor: true }), initial = ancestor.render(), target = initial.trigger.props.children[targetIndex]
    assert.equal(initial.trigger.props['aria-expanded'], false)
    assert.equal(target.props?.onClick, undefined)
    initial.trigger.props.onClick({ target, currentTarget: initial.trigger })
    assert.equal(ancestor.state[0], true, 'ancestor title or icon opens the dropdown exactly once')
    assert.deepEqual(ancestor.openTitleCalls, [], 'ancestor trigger points never navigate through openTitle')
    assert.deepEqual(ancestor.catalogCalls, [['root', true]], 'ancestor disclosure reports exactly one open')
    const opened = ancestor.render()
    opened.trigger.props.onClick({ target: opened.trigger.props.children[targetIndex], currentTarget: opened.trigger })
    assert.equal(ancestor.state[0], false, 'ancestor title or icon closes the dropdown exactly once')
    assert.deepEqual(ancestor.catalogCalls, [['root', true], ['root', false]], 'ancestor close does not double-toggle')
    assert.deepEqual(ancestor.openTitleCalls, [], 'ancestor close never navigates through openTitle')
  }

  for (const key of ['Enter', ' ']) {
    const ancestor = harness({ ancestor: true }), initial = ancestor.render()
    let prevented = 0
    initial.trigger.props.onKeyDown({ key, preventDefault() { prevented += 1 } })
    initial.trigger.props.onClick({ key })
    assert.equal(prevented, 0)
    assert.equal(ancestor.state[0], true)
    assert.deepEqual(ancestor.catalogCalls, [['root', true]], `ancestor ${key} relies on one native disclosure click`)
    assert.deepEqual(ancestor.openTitleCalls, [], `ancestor ${key} activation never invokes openTitle`)
  }
})

test('alpha.5 installed subagent header disclosure is exact-hash bound and repeatable', async () => {
  const { patchInstalledSubagent } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-client-ui-subagent', 'lib', 'client.js'), 'utf8')
  const temp = mkdtempSync(path.join(os.tmpdir(), 'dsh-alpha5-subagent-ui-patch-'))
  const root = path.join(temp, 'dsh-client-ui-subagent'), file = path.join(root, 'lib', 'client.js')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-subagent', version: '0.1.2-alpha.5' }))
  try {
    writeFileSync(file, fixture)
    assert.equal(await patchInstalledSubagent(file), true)
    const once = readFileSync(file, 'utf8')
    assert.equal(createHash('sha256').update(once).digest('hex').toUpperCase(), '035C0B528D341F031886BEF5B4910E83BF502748CE6D0633126590A7DB68372D')
    assert.equal(await patchInstalledSubagent(file), false)
    assert.equal(readFileSync(file, 'utf8'), once)
    const wholeChipV1 = once.replace(`\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\tcancelHoverOpen();\n\t\t\t\t\t\t\tchangeOpen(!open);\n\t\t\t\t\t\t},`, `\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\tcancelHoverOpen();\n\t\t\t\t\t\t\tif (openTitle !== void 0) {\n\t\t\t\t\t\t\t\tif (open) changeOpen(false);\n\t\t\t\t\t\t\t\topenTitle();\n\t\t\t\t\t\t\t\treturn;\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\tchangeOpen(!open);\n\t\t\t\t\t\t},`)
    assert.notEqual(wholeChipV1, once)
    assert.equal(createHash('sha256').update(wholeChipV1).digest('hex').toUpperCase(), '89F332378BEF2003B32EAA1471E93BED2DA34A176C42E0F8DE8293E7BA735C50')
    writeFileSync(file, wholeChipV1)
    assert.equal(await patchInstalledSubagent(file), true, 'the exact prior whole-chip branch migrates once without navigation')
    assert.equal(readFileSync(file, 'utf8'), once)
    const disclosureV1 = wholeChipV1.replace('@media(prefers-reduced-motion:reduce){.ZKlsPq_trigger svg,.ZKlsPq_switcherTrigger svg{transition:none}}', '')
    assert.equal(createHash('sha256').update(disclosureV1).digest('hex').toUpperCase(), 'B406852F572DF14EE6C7A8BCD00B811151B2064D2E6D73EF1940DDEED4FF7E21')
    writeFileSync(file, disclosureV1)
    assert.equal(await patchInstalledSubagent(file), true, 'the exact first disclosure composition migrates once')
    assert.equal(readFileSync(file, 'utf8'), once)
    const disclosureV2 = once.replace('@media(prefers-reduced-motion:reduce){.ZKlsPq_trigger svg,.ZKlsPq_switcherTrigger svg{transition:none}}', '')
    assert.equal(createHash('sha256').update(disclosureV2).digest('hex').toUpperCase(), 'AC873867529F46E75117157016A43614C2182C455611D23D3D98ED05A4263137')
    writeFileSync(file, disclosureV2)
    assert.equal(await patchInstalledSubagent(file), true, 'the exact prior disclosure composition migrates once')
    assert.equal(readFileSync(file, 'utf8'), once)
    writeFileSync(file, `${fixture}\n/* drift */`)
    await assert.rejects(() => patchInstalledSubagent(file), /neither exact official nor an exact complete Desktop catalog artifact/u)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
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
