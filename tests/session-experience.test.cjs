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

test('client registers archive history and an in-composer paperclip — never a separate file page or header id pill', async () => {
  const source = await readFile(path.join(root, 'plugins/dsh-session-experience/lib/client.js'), 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load/u)
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
    'document.addEventListener("scroll", close, true)'
  ]) assert.ok(source.includes(marker), `missing sidebar session menu marker: ${marker}`)
  assert.doesNotMatch(source, /id: "fork"/u)
  assert.doesNotThrow(() => new Function(source))
})
