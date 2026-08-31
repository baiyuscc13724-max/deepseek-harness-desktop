const test = require('node:test')
const assert = require('node:assert/strict')
const { access, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const YAML = require('yaml')

const root = path.resolve(__dirname, '..')
const service = require('../electron/bridge/session-experience-plugin-service.cjs')

async function plugin() {
  return import(pathToFileURL(path.join(root, 'plugins/dsh-session-experience/lib/index.js')).href)
}

async function clientPlugin() {
  const source = await readFile(path.join(root, 'plugins/dsh-session-experience/lib/client.js'), 'utf8')
  let registration
  const browser = { __ModuleLoader__: { load(value) { registration = value } } }
  new Function('window', source)(browser)
  assert.ok(registration?.factory, 'client module registration missing')
  return registration.factory(name => {
    if (name === 'react') return { createElement() {}, useState() {}, useEffect() {}, useRef() {} }
    if (name === '@deepseek-ai/dsh-client-runtime/client') return { isAppendSurfaceEvent: event => event?.surfaceOp === 'append' }
    throw new Error(`unexpected client dependency: ${name}`)
  })
}

function completionSnapshot(current, completedIds = [], updatedAt = 1) {
  const ids = ['session-1', 'session-3']
  const completed = new Set(completedIds)
  return {
    phase: 'ready',
    current,
    ids,
    byId: Object.fromEntries(ids.map(id => [id, {
      id,
      displayTitle: id === 'session-1' ? '会话 1' : '会话 3',
      updatedAt,
      ...(completed.has(id) ? { completed: true } : {})
    }]))
  }
}

async function deletionFixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-session-delete-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const sessionId = options.sessionId || 'archived-session-1'
  const storeRoot = path.join(directory, 'sessions')
  const projectDirectory = path.join(storeRoot, '--project--')
  const sessionDirectory = path.join(projectDirectory, sessionId)
  const artifact = path.join(sessionDirectory, 'session.jsonl')
  await mkdir(storeRoot, { recursive: true })
  if (options.createArtifact !== false) {
    await mkdir(sessionDirectory, { recursive: true })
    await writeFile(artifact, JSON.stringify({ type: 'session', id: sessionId }) + '\n')
  }
  const header = { id: sessionId, cwd: directory, createdAt: 1 }
  let state = { initialized: true, workspaceIds: ['workspace-1'], archivedSessionIds: [sessionId] }
  const observations = { detached: [], projectionDeleted: [], queryReconciled: 0, rebuilt: 0, stateWrites: 0 }
  const registry = {
    get archivedSessionIds() { return state.archivedSessionIds },
    headers: new Map([[sessionId, header]]),
    sessionPaths: new Map([[sessionId, directory]]),
    invalidSessionPaths: new Map([[sessionId, 'stale']]),
    list() { return [{ async detachSession(id) { observations.detached.push(id) } }] },
    requireState() { return state },
    async setState(next) { state = next; observations.stateWrites += 1 },
    async enqueueOperation(operation) { return operation() },
    rebuildEntities() { observations.rebuilt += 1 }
  }
  const persistence = {
    root: storeRoot,
    async list() {
      try { await access(artifact); return [header] } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
    },
    locate() { return { kind: 'jsonl', path: options.artifactPath || artifact } }
  }
  const context = {
    workspaceRegistry: registry,
    sessionPersistence: persistence,
    sessions: { get() { return options.live ? { id: sessionId } : undefined } },
    agents: { get() { return undefined } },
    sessionProjectionCache: { requireTable() { return { async delete(id) { observations.projectionDeleted.push(id) } } } },
    sessionQuery: {
      _db: {},
      _serialized(_signal, operation) { return operation() },
      async _reconcile() { observations.queryReconciled += 1 }
    }
  }
  return { artifact, context, directory, observations, registry, sessionDirectory, sessionId, state: () => state, storeRoot }
}

test('attachment upload names are normalized and cannot create paths', async () => {
  const { safeFileName } = await plugin()
  assert.equal(safeFileName('../../report.txt'), '_.._report.txt')
  assert.equal(safeFileName('folder\\draft.md'), 'folder_draft.md')
  assert.equal(safeFileName(' 计划.md '), '计划.md')
  assert.throws(() => safeFileName('..'), /invalid file name/)
})

test('attachments stay in the workspace uploads directory and preserve collisions', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-session-exp-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { listUploads, saveUpload } = await plugin()
  const first = await saveUpload(directory, 'report.txt', Buffer.from('one'))
  const second = await saveUpload(directory, 'report.txt', Buffer.from('two'))
  assert.equal(first.path, 'uploads/report.txt')
  assert.equal(second.path, 'uploads/report-1.txt')
  const files = await listUploads(directory)
  assert.deepEqual(new Set(files.map(file => file.path)), new Set(['uploads/report.txt', 'uploads/report-1.txt']))
  assert.equal(files.every(file => file.size === 3), true)
})

test('attachment download requires a regular workspace-contained relative path', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-session-dl-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'dsh-session-out-'))
  t.after(() => Promise.all([rm(directory, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]))
  await writeFile(path.join(directory, 'inside.txt'), 'ok')
  await writeFile(path.join(outside, 'outside.txt'), 'no')
  const { resolveDownload } = await plugin()
  const inside = await resolveDownload(directory, 'inside.txt')
  assert.equal(inside.info.size, 2)
  await assert.rejects(resolveDownload(directory, '../outside.txt'), error => error.code === 'ATTACH_PATH_ESCAPE')
  await assert.rejects(resolveDownload(directory, path.join(outside, 'outside.txt')), error => error.code === 'ATTACH_INVALID_PATH')
})

test('permanent archive deletion removes the session directory and registry traces', async t => {
  const { deleteArchivedSession } = await plugin()
  const fixture = await deletionFixture(t)
  const result = await deleteArchivedSession(fixture.context, fixture.sessionId)
  assert.deepEqual(result, { sessionId: fixture.sessionId, artifactDeleted: true })
  await assert.rejects(access(fixture.sessionDirectory), error => error.code === 'ENOENT')
  assert.deepEqual(fixture.state().archivedSessionIds, [])
  assert.deepEqual(fixture.observations.detached, [fixture.sessionId])
  assert.deepEqual(fixture.observations.projectionDeleted, [fixture.sessionId])
  assert.equal(fixture.observations.queryReconciled, 1)
  assert.equal(fixture.observations.rebuilt, 1)
  assert.equal(fixture.registry.headers.has(fixture.sessionId), false)
  assert.equal(fixture.registry.sessionPaths.has(fixture.sessionId), false)
  assert.equal(fixture.registry.invalidSessionPaths.has(fixture.sessionId), false)
})

test('permanent archive deletion rejects live sessions without touching their log', async t => {
  const { deleteArchivedSession } = await plugin()
  const fixture = await deletionFixture(t, { live: true })
  await assert.rejects(deleteArchivedSession(fixture.context, fixture.sessionId), error => error.code === 'SESSION_HISTORY_STILL_LIVE')
  await access(fixture.artifact)
  assert.deepEqual(fixture.state().archivedSessionIds, [fixture.sessionId])
  assert.deepEqual(fixture.observations.detached, [])
})

test('permanent archive deletion rejects non-archived sessions without touching their log', async t => {
  const { deleteArchivedSession } = await plugin()
  const fixture = await deletionFixture(t)
  fixture.state().archivedSessionIds = []
  await assert.rejects(deleteArchivedSession(fixture.context, fixture.sessionId), error => error.code === 'SESSION_HISTORY_NOT_ARCHIVED')
  await access(fixture.artifact)
  assert.deepEqual(fixture.observations.detached, [])
})

test('permanent archive deletion refuses a persistence path outside its session root', async t => {
  const { deleteArchivedSession } = await plugin()
  const fixture = await deletionFixture(t)
  const unsafeDirectory = path.join(fixture.directory, 'outside')
  const unsafeArtifact = path.join(unsafeDirectory, 'session.jsonl')
  await mkdir(unsafeDirectory, { recursive: true })
  await writeFile(unsafeArtifact, 'outside')
  fixture.context.sessionPersistence.locate = () => ({ kind: 'jsonl', path: unsafeArtifact })
  await assert.rejects(deleteArchivedSession(fixture.context, fixture.sessionId), error => error.code === 'SESSION_HISTORY_UNSAFE_PATH')
  await access(unsafeArtifact)
  await access(fixture.artifact)
  assert.deepEqual(fixture.state().archivedSessionIds, [fixture.sessionId])
})

test('permanent archive deletion repairs an archived row whose artifact is already absent', async t => {
  const { deleteArchivedSession } = await plugin()
  const fixture = await deletionFixture(t, { createArtifact: false })
  const result = await deleteArchivedSession(fixture.context, fixture.sessionId)
  assert.deepEqual(result, { sessionId: fixture.sessionId, artifactDeleted: false })
  assert.deepEqual(fixture.state().archivedSessionIds, [])
  assert.deepEqual(fixture.observations.detached, [fixture.sessionId])
  assert.deepEqual(fixture.observations.projectionDeleted, [fixture.sessionId])
})

test('permanent archive deletion removes a partially deleted session directory on retry', async t => {
  const { deleteArchivedSession } = await plugin()
  const fixture = await deletionFixture(t, { createArtifact: false })
  await mkdir(fixture.sessionDirectory, { recursive: true })
  await writeFile(path.join(fixture.sessionDirectory, 'future-artifact.bin'), 'orphan')
  const result = await deleteArchivedSession(fixture.context, fixture.sessionId)
  assert.deepEqual(result, { sessionId: fixture.sessionId, artifactDeleted: false })
  await assert.rejects(access(fixture.sessionDirectory), error => error.code === 'ENOENT')
  assert.deepEqual(fixture.state().archivedSessionIds, [])
})

test('cleanup failures do not skip remaining indexes and remain retryable', async t => {
  const { deleteArchivedSession } = await plugin()
  const fixture = await deletionFixture(t)
  fixture.context.workspaceRegistry.list = () => [
    { sessionIds: [fixture.sessionId], async detachSession() { throw new Error('workspace unavailable') } },
    { sessionIds: [fixture.sessionId], async detachSession(id) { fixture.observations.detached.push(id) } }
  ]
  await assert.rejects(deleteArchivedSession(fixture.context, fixture.sessionId), error => error.code === 'SESSION_HISTORY_CLEANUP_INCOMPLETE')
  await assert.rejects(access(fixture.sessionDirectory), error => error.code === 'ENOENT')
  assert.deepEqual(fixture.observations.detached, [fixture.sessionId])
  assert.deepEqual(fixture.observations.projectionDeleted, [fixture.sessionId])
  assert.equal(fixture.observations.queryReconciled, 1)
  assert.deepEqual(fixture.state().archivedSessionIds, [fixture.sessionId])

  fixture.context.workspaceRegistry.list = () => [{ sessionIds: [fixture.sessionId], async detachSession(id) { fixture.observations.detached.push(id) } }]
  const repaired = await deleteArchivedSession(fixture.context, fixture.sessionId)
  assert.deepEqual(repaired, { sessionId: fixture.sessionId, artifactDeleted: false })
  assert.deepEqual(fixture.state().archivedSessionIds, [])
})

test('archive deletion route requires an explicit same-origin permanent-delete confirmation', async () => {
  const { apply } = await plugin()
  const routes = []
  apply({
    effect(register) { register() },
    webServer: { register(route) { routes.push(route); return () => {} } }
  })
  const route = routes.find(item => item.path === '/api/session-experience/archive-history')
  assert.ok(route)
  const response = { status: 0, body: '', writeHead(status) { this.status = status }, end(body) { this.body = String(body) } }
  await route.handler({
    method: 'DELETE',
    url: '/api/session-experience/archive-history?sessionId=archived-session-1',
    headers: { host: '127.0.0.1:4119', origin: 'http://127.0.0.1:4119' }
  }, response)
  assert.equal(response.status, 400)
  assert.equal(JSON.parse(response.body).code, 'SESSION_HISTORY_CONFIRMATION_REQUIRED')

  const forbidden = { status: 0, body: '', writeHead(status) { this.status = status }, end(body) { this.body = String(body) } }
  await route.handler({
    method: 'DELETE',
    url: '/api/session-experience/archive-history?sessionId=archived-session-1',
    headers: { host: '127.0.0.1:4119', 'x-dsh-delete-confirmation': 'permanent' }
  }, forbidden)
  assert.equal(forbidden.status, 403)
  assert.equal(JSON.parse(forbidden.body).code, 'SESSION_HISTORY_FORBIDDEN')
})

test('session experience plugin installation is additive and idempotent', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-session-plugin-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'cordis.patch.yml')
  assert.equal(await service.ensurePatchEntry(file), true)
  assert.equal(await service.ensurePatchEntry(file), false)
  const entries = YAML.parse(await readFile(file, 'utf8')).flatMap(row => row.insert || [])
  assert.equal(entries.filter(item => item.id === 'session-experience' && item.name === 'dsh-session-experience').length, 1)
})

test('completion notice state seeds once, filters current sessions, deduplicates and rearms', async () => {
  const client = await clientPlugin()
  const { createCompletionState, reconcileCompletionState } = client.__completionTest
  let state = createCompletionState()
  const pending = reconcileCompletionState(state, { phase: 'pending' }, 100)
  assert.equal(pending, state)

  state = reconcileCompletionState(state, completionSnapshot('session-1'), 1_000)
  assert.equal(state.initialized, true)
  assert.deepEqual(state.notices, [])

  state = reconcileCompletionState(state, completionSnapshot('session-1', ['session-3'], 2), 2_000)
  assert.deepEqual(state.notices.map(item => [item.id, item.title, item.expiresAt]), [['session-3', '会话 3', 10_000]])
  const firstNotices = state.notices

  state = reconcileCompletionState(state, completionSnapshot('session-1', ['session-3'], 3), 3_000)
  assert.equal(state.notices, firstNotices, 'a repeated completed snapshot must not duplicate or extend the notice')

  state = reconcileCompletionState(state, completionSnapshot('session-3', ['session-3'], 4), 4_000)
  assert.deepEqual(state.notices, [], 'opening the completed session dismisses its notice')
  state = reconcileCompletionState(state, completionSnapshot('session-1', [], 5), 5_000)
  state = reconcileCompletionState(state, completionSnapshot('session-1', ['session-3'], 6), 6_000)
  assert.deepEqual(state.notices.map(item => item.id), ['session-3'], 'a later false-to-true edge rearms the session')

  let currentState = createCompletionState()
  currentState = reconcileCompletionState(currentState, completionSnapshot('session-1'), 1_000)
  currentState = reconcileCompletionState(currentState, completionSnapshot('session-1', ['session-1'], 2), 2_000)
  assert.deepEqual(currentState.notices, [], 'the current session must never raise a cross-session notice')

  let subagentState = createCompletionState()
  const subagentBaseline = completionSnapshot('session-1')
  subagentBaseline.byId['session-3'].origin = 'subagent'
  subagentState = reconcileCompletionState(subagentState, subagentBaseline, 1_000)
  const subagentCompleted = completionSnapshot('session-1', ['session-3'], 2)
  subagentCompleted.byId['session-3'].origin = 'subagent'
  subagentState = reconcileCompletionState(subagentState, subagentCompleted, 2_000)
  assert.deepEqual(subagentState.notices, [], 'subagent completion must never raise a card')

  let restored = createCompletionState()
  restored = reconcileCompletionState(restored, completionSnapshot('session-1', ['session-3'], 1), 1_000)
  assert.deepEqual(restored.notices, [], 'the first ready snapshot is a baseline, not a replay')
})

test('client registers completion notices, archive history and an in-composer paperclip', async () => {
  const source = await readFile(path.join(root, 'plugins/dsh-session-experience/lib/client.js'), 'utf8')
  const manifest = JSON.parse(await readFile(path.join(root, 'plugins/dsh-session-experience/package.json'), 'utf8'))
  assert.match(source, /window\.__ModuleLoader__\.load/u)
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.match(source, /ctx\.slots\.inject\("shell\.overlay"/u)
  assert.match(source, /id: "session-completion-notifications"/u)
  assert.match(source, /item\.completed === true/u)
  assert.match(source, /item\.origin !== "subagent"/u)
  assert.doesNotMatch(source, /subagentRows|openSubagent|subagentComplete/u)
  assert.match(source, /item\.id !== snapshot\.current/u)
  assert.match(source, /apply\(\);\s*var unsubscribe = list\.subscribe\(apply\);\s*apply\(\);/u)
  assert.match(source, /sessions\.open\(id\)/u)
  assert.match(source, /document\.addEventListener\("pointerdown", onPointerDown, true\)/u)
  assert.match(source, /window\.addEventListener\("blur", dismissAll\)/u)
  assert.match(source, /event\.key !== "Escape"/u)
  assert.match(source, /event\.preventDefault\(\)/u)
  assert.match(source, /stack\.matches\(":hover"\)/u)
  assert.match(source, /stack\.contains\(document\.activeElement\)/u)
  assert.match(source, /COMPLETE_NOTICE_MS = 8000/u)
  assert.match(source, /top:var\(--dsh-workbench-header-height,76px\)/u)
  assert.match(source, /"aria-live": "polite"/u)
  assert.doesNotMatch(source, /if \(!notices\.length\) return null/u)
  assert.match(source, /prefers-reduced-motion:reduce/u)
  assert.match(source, /ctx\.slots\.inject\("conversation\.view"/u)
  assert.match(source, /id: "session-archive"/u)
  assert.match(source, /label: function \(\) \{ return translate\("archiveView"\);/u)
  assert.doesNotMatch(source, /conversation\.session\.header\.utilities/u)
  assert.match(source, /conversation\.input\.right/u)
  assert.match(source, /archivedSessionIds/u)
  assert.match(source, /sessions\.open/u)
  assert.match(source, /sessions\.fork\(\{ sessionId: id, increaseTitle: true \}\)/u)
  assert.match(source, /restoreSession: "恢复为新会话"/u)
  assert.match(source, /copySessionId/u)
  assert.match(source, /deleteHistory: "删除历史"/u)
  assert.match(source, /deleteTitle: "永久删除整个会话？"/u)
  assert.match(source, /role: "alertdialog"/u)
  assert.match(source, /"x-dsh-delete-confirmation": "permanent"/u)
  assert.match(source, /sessions\.refresh\(\)/u)
  assert.match(source, /harness-desktop:\/\/copy-session-id/u)
  assert.match(source, /\/api\/session-experience\/upload/u)
  assert.match(source, /\/api\/session-experience\/archive-history/u)
  assert.match(source, /inputActions\.setDraft/u)
  assert.match(source, /currentDraft \+ separator \+ quoted \+ " "/u)
  assert.match(source, /type:\s*["']file["']/u)
  assert.match(source, /最大 50 MB/u)
  assert.doesNotMatch(source, /ipcRenderer|desktopHarness/u)
  assert.doesNotMatch(source, /inputActions\.(submit|send)/u)
  assert.doesNotThrow(() => new Function(source))
})

test('client keeps session id copy in archive and sidebar paths without a top-right affordance', async () => {
  const source = await readFile(path.join(root, 'plugins/dsh-session-experience/lib/client.js'), 'utf8')
  for (const label of ['归档历史', '复制会话 ID', '删除历史', '永久删除整个会话？', '按会话 ID 定位', '附加文件']) {
    assert.ok(source.includes(label), `missing localized label: ${label}`)
  }
  assert.doesNotMatch(source, /function SessionIdAffordance/u)
  assert.doesNotMatch(source, /hd-session-copy/u)
  assert.match(source, /function PaperclipButton/u)
  assert.match(source, /function ArchiveView/u)
  assert.match(source, /harness-desktop-session/u)
  assert.match(source, /openRequestedDesktopSession/u)
  assert.match(source, /exports\.apply = apply/u)
  assert.match(source, /exports\.inject = \["slots", "locale", "sessions", "workspaces", "inputTriggers"\]/u)
})

test('official alpha.2 workspace sidebar owns the accessible session action menu', async () => {
  const source = await readFile(path.join(root, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js'), 'utf8')
  for (const marker of [
    'function SessionNodeItem(', 'const sessionMenuItems = [', 'id: "rename"', 'id: "fork"',
    'id: "archive"', 'IconEditOutline16', 'IconBranchOutline16', 'IconArchiveOutline20',
    'items: sessionMenuItems', 'portal: true', 'closeOnPointerLeave: true',
    '"aria-label": t("actions.session.aria", { name: title })',
    'if (id === "rename") onRename(node.id, row.title)',
    'if (id === "fork") onFork(node.id)', 'if (id === "archive") onArchive(node.id)',
    'function deriveGroups(', 'function deriveFlat(', 'insertSessionBefore(activeDrag.accountKey'
  ]) assert.ok(source.includes(marker), `missing native sidebar session-menu contract: ${marker}`)
  assert.doesNotMatch(source, /harness\.desktop\.session-menu\.v1|syncDesktopSessionMenuState|bridge\.setSessionMenuFlag/u)
  assert.doesNotThrow(() => new Function(source))
})

test('desktop shell owns session-menu persistence independently of the random runtime port', async () => {
  const [main, guestPreload, detachedPreload] = await Promise.all([
    readFile(path.join(root, 'electron/main.cjs'), 'utf8'),
    readFile(path.join(root, 'electron/guest-preload.cjs'), 'utf8'),
    readFile(path.join(root, 'electron/session-menu-preload.cjs'), 'utf8')
  ])
  assert.match(main, /'--port',\s*'0'/u)
  assert.match(main, /function assertLocalRuntimeSender\(event\)[\s\S]{0,500}senderOrigin === runtimeOrigin/u)
  assert.match(main, /ipcMain\.handle\('sessionMenu:sync'[\s\S]{0,220}assertLocalRuntimeSender\(event\)/u)
  assert.match(main, /ipcMain\.handle\('sessionMenu:setFlag'[\s\S]{0,220}updateSessionMenuFlag/u)
  assert.match(main, /function openDetachedSessionWindow\(sessionId\)[\s\S]{0,1400}preload: path\.join\(__dirname, 'session-menu-preload\.cjs'\)/u)
  for (const preload of [guestPreload, detachedPreload]) {
    assert.match(preload, /syncSessionMenuState[\s\S]{0,260}ipcRenderer\.invoke\('sessionMenu:sync'/u)
    assert.match(preload, /setSessionMenuFlag[\s\S]{0,260}ipcRenderer\.invoke\('sessionMenu:setFlag'/u)
    assert.match(preload, /safeSessionMenuIds[\s\S]{0,400}ids\.length >= 1000/u)
  }
  assert.doesNotMatch(detachedPreload, /window:beginDrag|chooseWorkspaceDirectory|onWallpaperLifecycle/u)
})
