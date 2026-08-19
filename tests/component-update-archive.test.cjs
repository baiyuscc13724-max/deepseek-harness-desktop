const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  normalizeComponentIndex,
  normalizeRelativePath,
  validateZipEntries,
  verifyExtractedComponent
} = require('../electron/bridge/component-update-archive.cjs')

const descriptor = {
  id: 'desktop-shell',
  version: '1.0.24',
  target: 'shell',
  size: 1024 * 1024,
  unpackedSize: 1
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

test('component archive paths reject traversal, absolute paths and drive letters', () => {
  for (const value of ['../escape', 'folder/../escape', '/absolute', 'C:/windows/file', 'folder//file']) {
    assert.throws(() => normalizeRelativePath(value), /路径/)
  }
  assert.equal(normalizeRelativePath('renderer/app.js'), 'renderer/app.js')
  assert.equal(normalizeRelativePath('renderer\\app.js'), 'renderer/app.js')
})

test('component index rejects case-insensitive collisions and descriptor drift', () => {
  assert.throws(() => normalizeComponentIndex({
    schemaVersion: 1,
    id: 'desktop-shell',
    version: '1.0.24',
    target: 'shell',
    files: [
      { path: 'Renderer/app.js', size: 1, sha256: 'a'.repeat(64) },
      { path: 'renderer/APP.js', size: 1, sha256: 'b'.repeat(64) }
    ]
  }, descriptor), /大小写冲突/)

  assert.throws(() => normalizeComponentIndex({
    schemaVersion: 1,
    id: 'other-shell',
    version: '1.0.24',
    target: 'shell',
    files: [{ path: 'renderer/app.js', size: 1, sha256: 'a'.repeat(64) }]
  }, descriptor), /已签名描述不一致/)
})

test('zip entry validation rejects traversal, symlinks and oversized expansion', () => {
  assert.throws(() => validateZipEntries([{ entryName: '../escape', header: { size: 1, attr: 0 } }], 100), /路径/)
  assert.throws(() => validateZipEntries([{ entryName: 'link', header: { size: 1, attr: 0o120000 << 16 } }], 100), /符号链接/)
  assert.throws(() => validateZipEntries([{ entryName: 'large.bin', header: { size: 101, attr: 0 } }], 100), /超过安全限制/)
})

test('extracted component must exactly match its per-file index', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-files-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const content = Buffer.from('console.log("ok")\n')
  await mkdir(path.join(root, 'renderer'), { recursive: true })
  await writeFile(path.join(root, 'renderer', 'app.js'), content)
  await writeFile(path.join(root, 'component.json'), JSON.stringify({
    schemaVersion: 1,
    id: descriptor.id,
    version: descriptor.version,
    target: descriptor.target,
    files: [{ path: 'renderer/app.js', size: content.length, sha256: hash(content) }]
  }))

  const index = await verifyExtractedComponent(root, { ...descriptor, unpackedSize: content.length })
  assert.equal(index.files.length, 1)

  await writeFile(path.join(root, 'undeclared.txt'), 'no')
  await assert.rejects(() => verifyExtractedComponent(root, { ...descriptor, unpackedSize: content.length }), /文件数量与索引不一致|未声明文件/)
})

test('extracted component rejects modified payload bytes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-tamper-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = Buffer.from('original')
  await writeFile(path.join(root, 'payload.js'), Buffer.from('tampered'))
  await writeFile(path.join(root, 'component.json'), JSON.stringify({
    schemaVersion: 1,
    id: descriptor.id,
    version: descriptor.version,
    target: descriptor.target,
    files: [{ path: 'payload.js', size: original.length, sha256: hash(original) }]
  }))
  await assert.rejects(() => verifyExtractedComponent(root, { ...descriptor, unpackedSize: original.length }), /SHA-256/)
})
