const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
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
    if (name !== 'react') throw new Error(`unexpected client dependency: ${name}`)
    return { createElement() {}, useState() {}, useEffect() {}, useRef() {} }
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
  assert.match(source, /harness-desktop:\/\/copy-session-id/u)
  assert.match(source, /\/api\/session-experience\/upload/u)
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
  for (const label of ['归档历史', '复制会话 ID', '按会话 ID 定位', '附加文件']) {
    assert.ok(source.includes(label), `missing localized label: ${label}`)
  }
  assert.doesNotMatch(source, /function SessionIdAffordance/u)
  assert.doesNotMatch(source, /hd-session-copy/u)
  assert.match(source, /function PaperclipButton/u)
  assert.match(source, /function ArchiveView/u)
  assert.match(source, /harness-desktop-session/u)
  assert.match(source, /openRequestedDesktopSession/u)
  assert.match(source, /exports\.apply = apply/u)
  assert.match(source, /exports\.inject = \["slots", "locale", "sessions", "workspaces"\]/u)
})

test('official workspace sidebar receives the persistent Codex-style session menu', async () => {
  const source = await readFile(path.join(root, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js'), 'utf8')
  for (const marker of [
    'harness.desktop.session-menu.v1', '置顶', '标记为未读', '复制会话 ID',
    '在新窗口中打开', 'open-session-window', 'moveSession', 'react_dom.createPortal',
    'id.length <= 256', 'window.innerWidth - 228', 'hd-session-menu-dismiss',
    'document.addEventListener("scroll", close, true)', 'HD_SESSION_MENU_ICONS',
    'hd-session-menu-icon-slot', 'icon: "rename"', 'icon: "newWindow"',
    'strokeWidth: "1.35"', 'shape-rendering:geometricPrecision'
  ]) assert.ok(source.includes(marker), `missing sidebar session menu marker: ${marker}`)
  assert.doesNotMatch(source, /id: "fork"/u)
  assert.doesNotMatch(source, /glyph:\s*"[⌃✎◉▣▱▢↗]"/u)
  assert.doesNotThrow(() => new Function(source))
})
