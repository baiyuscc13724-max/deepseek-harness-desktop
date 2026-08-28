const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const YAML = require('yaml')

const root = path.resolve(__dirname, '..')
const service = require('../electron/bridge/desktop-files-plugin-service.cjs')

async function plugin() {
  return import(pathToFileURL(path.join(root, 'plugins/dsh-desktop-files/lib/index.js')).href)
}

// Production containment compares candidates against realpath(%cwd) using the
// async fs/promises.realpath, which fully expands Windows 8.3 short temp names
// while realpathSync can keep them. macOS /var -> /private/var similarly makes
// raw mkdtemp paths non-canonical, so fixtures must hand the plugin canonical
// roots obtained with the same asynchronous API production uses.
async function canonicalTemp(prefix) {
  const canonical = await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
  assert.equal(canonical, await realpath(canonical), 'canonical fixture root must be its exact async realpath')
  return canonical
}

test('file upload names are normalized and cannot create paths', async () => {
  const { safeFileName } = await plugin()
  assert.equal(safeFileName('../report.txt'), '_report.txt')
  assert.equal(safeFileName('folder\\draft.md'), 'folder_draft.md')
  assert.equal(safeFileName(' 计划.md '), '计划.md')
  assert.throws(() => safeFileName('..'), /invalid file name/)
})

test('uploads stay in the workspace, preserve collisions and are observable', async t => {
  const directory = await canonicalTemp('dsh-files-')
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

test('downloads require a regular workspace-contained path', async t => {
  const directory = await canonicalTemp('dsh-download-')
  const outside = await canonicalTemp('dsh-outside-')
  t.after(() => Promise.all([rm(directory, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]))
  await writeFile(path.join(directory, 'inside.txt'), 'ok')
  await writeFile(path.join(outside, 'outside.txt'), 'no')
  const { resolveDownload } = await plugin()
  const inside = await resolveDownload(directory, 'inside.txt')
  assert.equal(inside.info.size, 2)
  assert.equal((await resolveDownload(directory, path.join(directory, 'inside.txt'))).info.size, 2)
  await assert.rejects(resolveDownload(directory, '../outside.txt'), error => error.code === 'FILES_PATH_ESCAPE')
  await assert.rejects(resolveDownload(directory, path.join(outside, 'outside.txt')), error => error.code === 'FILES_PATH_ESCAPE')
})

test('right-workspace previews are bounded text and preserve workspace containment', async t => {
  const directory = await canonicalTemp('dsh-preview-')
  const outside = await canonicalTemp('dsh-preview-outside-')
  t.after(() => Promise.all([rm(directory, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]))
  const { MAX_HTML_APP_BYTES, MAX_PREVIEW_BYTES, contentHeaders, contentPresentation, downloadHeaders, previewFile } = await plugin()
  await writeFile(path.join(directory, 'notes.md'), '# Notes\n\nHello')
  await writeFile(path.join(directory, 'page.html'), '<script>window.played = true</script>')
  await writeFile(path.join(directory, 'game.htm'), '<button onclick="window.clicked = true">Play</button>')
  await writeFile(path.join(directory, 'oversized.html'), Buffer.alloc(MAX_HTML_APP_BYTES + 1, 0x20))
  await writeFile(path.join(directory, 'main.cs'), 'Console.WriteLine("source");')
  await writeFile(path.join(directory, 'config.cjs'), 'module.exports = { safe: true }')
  await writeFile(path.join(directory, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(path.join(directory, 'document.pdf'), Buffer.from('%PDF-1.7'))
  await writeFile(path.join(directory, 'binary.bin'), Buffer.from([0, 1, 2, 3]))
  await writeFile(path.join(outside, 'secret.txt'), 'outside')
  const notes = await previewFile(directory, 'notes.md')
  assert.equal(notes.previewable, true)
  assert.equal(notes.text, '# Notes\n\nHello')
  assert.equal(notes.maxPreviewBytes, MAX_PREVIEW_BYTES)
  const located = await previewFile(directory, `${path.join(directory, 'notes.md')}:9:2`)
  assert.equal(located.line, 9)
  assert.equal(located.column, 2)
  assert.deepEqual(await previewFile(directory, 'page.html'), {
    path: 'page.html', name: 'page.html', size: 37, extension: '.html', openable: true,
    previewable: true, previewKind: 'html-app', mimeType: 'text/html; charset=utf-8', maxPreviewBytes: MAX_HTML_APP_BYTES
  })
  assert.equal((await previewFile(directory, 'game.htm')).previewKind, 'html-app')
  assert.deepEqual(await previewFile(directory, 'oversized.html'), {
    path: 'oversized.html', name: 'oversized.html', size: MAX_HTML_APP_BYTES + 1, extension: '.html', openable: true,
    previewable: false, reason: 'too-large', maxPreviewBytes: MAX_HTML_APP_BYTES
  })
  assert.equal((await previewFile(directory, 'main.cs')).previewable, true)
  assert.equal((await previewFile(directory, 'config.cjs')).text, 'module.exports = { safe: true }')
  assert.deepEqual(await previewFile(directory, 'image.png'), {
    path: 'image.png', name: 'image.png', size: 4, extension: '.png', openable: true,
    previewKind: 'image', mimeType: 'image/png', previewable: true
  })
  assert.equal((await previewFile(directory, 'document.pdf')).previewKind, 'pdf')
  const pdfHeaders = contentHeaders('document.pdf', 8, { previewKind: 'pdf', mimeType: 'application/pdf' })
  assert.match(pdfHeaders['content-disposition'], /^inline;/u)
  assert.equal(pdfHeaders['content-security-policy'], undefined)
  assert.equal(pdfHeaders['cross-origin-resource-policy'], undefined)
  const imageHeaders = contentHeaders('image.png', 4, { previewKind: 'image', mimeType: 'image/png' })
  assert.equal(imageHeaders['content-security-policy'], undefined)
  assert.equal(imageHeaders['cross-origin-resource-policy'], undefined)
  const htmlPresentation = contentPresentation({ name: 'page.html', info: { size: 37 } })
  assert.deepEqual(htmlPresentation, { previewKind: 'html-app', mimeType: 'text/html; charset=utf-8' })
  const htmlHeaders = contentHeaders('page.html', 37, htmlPresentation)
  assert.equal(htmlHeaders['content-type'], 'text/html; charset=utf-8')
  assert.match(htmlHeaders['content-disposition'], /^inline;/u)
  assert.match(htmlHeaders['content-security-policy'], /^sandbox allow-scripts allow-pointer-lock;/u)
  assert.match(htmlHeaders['content-security-policy'], /connect-src 'none'/u)
  assert.match(htmlHeaders['content-security-policy'], /form-action 'none'/u)
  assert.match(htmlHeaders['content-security-policy'], /object-src 'none'/u)
  assert.match(htmlHeaders['content-security-policy'], /base-uri 'none'/u)
  assert.match(htmlHeaders['content-security-policy'], /script-src 'unsafe-inline' 'unsafe-eval' data: blob:/u)
  assert.match(htmlHeaders['content-security-policy'], /frame-src 'none'/u)
  assert.doesNotMatch(htmlHeaders['content-security-policy'], /allow-same-origin|https?:|'self'/u)
  assert.equal(htmlHeaders['cross-origin-resource-policy'], undefined)
  assert.equal(contentPresentation({ name: 'oversized.html', info: { size: MAX_HTML_APP_BYTES + 1 } }), null)
  const oversizedHeaders = contentHeaders('oversized.html', MAX_HTML_APP_BYTES + 1, null)
  assert.equal(oversizedHeaders['content-type'], 'application/octet-stream')
  assert.match(oversizedHeaders['content-disposition'], /^attachment;/u)
  assert.equal(oversizedHeaders['content-security-policy'], "sandbox; default-src 'none'")
  assert.equal(oversizedHeaders['cross-origin-resource-policy'], undefined)
  const executableHeaders = downloadHeaders('installer.exe', 4)
  assert.match(executableHeaders['content-disposition'], /^attachment;/u)
  assert.equal(executableHeaders['content-type'], 'application/octet-stream')
  assert.equal(executableHeaders['content-security-policy'], "sandbox; default-src 'none'")
  assert.equal(executableHeaders['cross-origin-resource-policy'], undefined)
  assert.deepEqual(await previewFile(directory, 'binary.bin'), {
    path: 'binary.bin', name: 'binary.bin', size: 4, extension: '.bin', openable: true, previewable: false, reason: 'external'
  })
  await assert.rejects(previewFile(directory, '../secret.txt'), error => error.code === 'FILES_PATH_ESCAPE')
})

test('inline preview matrix separates sandboxed HTML apps from media and active content', async () => {
  const { HTML_APP_EXTENSIONS, INLINE_PREVIEW_TYPES } = await plugin()
  const expected = {
    image: ['.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.webp'],
    audio: ['.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav'],
    video: ['.m4v', '.mov', '.mp4', '.ogv', '.webm'],
    pdf: ['.pdf']
  }
  for (const [kind, extensions] of Object.entries(expected)) {
    for (const extension of extensions) assert.equal(INLINE_PREVIEW_TYPES.get(extension)?.previewKind, kind, `${extension} must render as ${kind}`)
  }
  assert.deepEqual([...HTML_APP_EXTENSIONS], ['.htm', '.html'])
  for (const extension of ['.html', '.svg', '.js', '.exe', '.lnk']) assert.equal(INLINE_PREVIEW_TYPES.has(extension), false)
})

test('file plugin registers GET-only preview, inline-content and download routes', async () => {
  const source = await readFile(path.join(root, 'plugins/dsh-desktop-files/lib/index.js'), 'utf8')
  assert.match(source, /path: '\/api\/desktop-files\/preview'/u)
  assert.match(source, /path: '\/api\/desktop-files\/content'/u)
  assert.match(source, /previewFile\(cwd, requestedPath\)/u)
  assert.match(source, /contentPresentation\(file\)/u)
  assert.match(source, /contentHeaders\(file\.name, file\.info\.size, presentation\)/u)
  assert.match(source, /previewKind: 'html-app', mimeType: 'text\/html; charset=utf-8'/u)
  assert.match(source, /sandbox allow-scripts allow-pointer-lock/u)
  assert.match(source, /req\.method !== 'GET'/u)
  assert.match(source, /trustedRequest\(req\)/u)
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
