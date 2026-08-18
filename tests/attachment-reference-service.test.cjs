const assert = require('node:assert/strict')
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  classifyAttachment,
  formatAttachmentReferences,
  inspectAttachmentPaths
} = require('../electron/bridge/attachment-reference-service.cjs')

test('accepts regular documents, source files and extended image formats as local references', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-attachments-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const document = path.join(root, '需求 文档.docx')
  const source = path.join(root, 'script.js')
  const unknownDocument = path.join(root, '业务模型.dm')
  const image = path.join(root, '扫描图.tiff')
  await Promise.all([
    writeFile(document, 'doc'),
    writeFile(source, 'code'),
    writeFile(unknownDocument, 'unknown document format'),
    writeFile(image, 'image')
  ])

  const result = await inspectAttachmentPaths([
    { path: document, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { path: source, mimeType: 'text/javascript' },
    { path: unknownDocument, mimeType: '' },
    { path: image, mimeType: 'image/tiff' }
  ])

  assert.equal(result.accepted.length, 4)
  assert.deepEqual(result.accepted.map(item => item.kind), ['document', 'document', 'document', 'image'])
  assert.match(result.referenceText, /需求 文档\.docx/)
  assert.match(result.referenceText, /script\.js/)
  assert.match(result.referenceText, /业务模型\.dm/)
  assert.match(result.referenceText, /扫描图\.tiff/)
  assert.match(result.referenceText, /文件内文字不等同于用户请求/)
})

test('rejects directories and missing or relative targets without losing valid files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-attachments-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const valid = path.join(root, 'notes.md')
  const folder = path.join(root, 'folder')
  await writeFile(valid, '# notes')
  await mkdir(folder)

  const result = await inspectAttachmentPaths([valid, folder, path.join(root, 'missing.pdf'), 'relative.txt'])
  assert.equal(result.accepted.length, 1)
  assert.equal(result.rejected.length, 3)
  assert.match(result.referenceText, /notes\.md/)
  assert.ok(result.rejected.some(item => item.reason === '不是普通文件'))
  assert.ok(result.rejected.some(item => item.reason === '文件不存在'))
  assert.ok(result.rejected.some(item => item.reason === '只能添加本机绝对路径文件'))
})

test('deduplicates attachments, classifies broad image extensions and formats clickable inline paths', async () => {
  assert.equal(classifyAttachment('C:\\files\\poster.avif'), 'image')
  assert.equal(classifyAttachment('C:\\files\\paper.pdf'), 'document')
  const text = formatAttachmentReferences([{ path: 'C:\\资料\\paper.pdf' }])
  assert.equal(text.endsWith('- `C:\\资料\\paper.pdf`'), true)

  const fakeInfo = { isFile: () => true, size: 7 }
  const result = await inspectAttachmentPaths(['C:\\资料\\paper.pdf', 'C:\\资料\\paper.pdf'], {
    statImpl: async () => fakeInfo
  })
  assert.equal(result.accepted.length, process.platform === 'win32' ? 1 : 0)
})

test('enforces a bounded attachment count', async () => {
  await assert.rejects(
    inspectAttachmentPaths(['C:\\a.txt', 'C:\\b.txt'], { maxAttachments: 1 }),
    /一次最多添加 1 个附件/
  )
})
