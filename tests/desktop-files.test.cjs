const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const YAML = require('yaml')

const root = path.resolve(__dirname, '..')
const service = require('../electron/bridge/desktop-files-plugin-service.cjs')

async function plugin() {
  return import(pathToFileURL(path.join(root, 'plugins/dsh-desktop-files/lib/index.js')).href)
}

test('file upload names are normalized and cannot create paths', async () => {
  const { safeFileName } = await plugin()
  assert.equal(safeFileName('../report.txt'), '_report.txt')
  assert.equal(safeFileName('folder\\draft.md'), 'folder_draft.md')
  assert.equal(safeFileName(' 计划.md '), '计划.md')
  assert.throws(() => safeFileName('..'), /invalid file name/)
})

test('uploads stay in the workspace, preserve collisions and are observable', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-files-'))
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

test('downloads require a regular workspace-contained relative path', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-download-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'dsh-outside-'))
  t.after(() => Promise.all([rm(directory, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]))
  await writeFile(path.join(directory, 'inside.txt'), 'ok')
  await writeFile(path.join(outside, 'outside.txt'), 'no')
  const { resolveDownload } = await plugin()
  const inside = await resolveDownload(directory, 'inside.txt')
  assert.equal(inside.info.size, 2)
  await assert.rejects(resolveDownload(directory, '../outside.txt'), error => error.code === 'FILES_PATH_ESCAPE')
  await assert.rejects(resolveDownload(directory, path.join(outside, 'outside.txt')), error => error.code === 'FILES_INVALID_PATH')
})

test('file plugin installation is additive and idempotent', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-file-plugin-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'cordis.patch.yml')
  assert.equal(await service.ensurePatchEntry(file), true)
  assert.equal(await service.ensurePatchEntry(file), false)
  const entries = YAML.parse(await readFile(file, 'utf8')).flatMap(row => row.insert || [])
  assert.equal(entries.filter(item => item.id === 'desktop-files' && item.name === 'dsh-desktop-files').length, 1)
})

test('legacy file APIs remain available without exposing a separate Files conversation page', async () => {
  const source = await readFile(path.join(root, 'plugins/dsh-desktop-files/lib/client.js'), 'utf8')
  assert.match(source, /The standalone Files conversation page is intentionally retired/u)
  assert.match(source, /dsh-session-experience/u)
  assert.match(source, /function apply\(\) \{\}/u)
  assert.match(source, /exports\.inject = \[\]/u)
  const applyBody = source.slice(source.lastIndexOf('function apply()'), source.indexOf('exports.apply', source.lastIndexOf('function apply()')))
  assert.doesNotMatch(applyBody, /conversation\.view|slots\.register/u)
  assert.doesNotThrow(() => new Function(source))
})
