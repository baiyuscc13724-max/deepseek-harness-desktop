const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const AdmZip = require('adm-zip')

const {
  createEasyTierComponentInstaller,
  extractExecutable,
  hashBuffer,
  safeArchiveEntryName
} = require('../electron/bridge/network-component-service.cjs')

function archiveWithExecutable(data = Buffer.from('fake-easytier-core')) {
  const zip = new AdmZip()
  zip.addFile('easytier/easytier-core.exe', data)
  return zip.toBuffer()
}

test('archive paths reject traversal and absolute paths', () => {
  assert.equal(safeArchiveEntryName('../core.exe'), null)
  assert.equal(safeArchiveEntryName('C:/core.exe'), null)
  assert.equal(safeArchiveEntryName('/core.exe'), null)
  assert.equal(safeArchiveEntryName('folder/core.exe'), 'folder/core.exe')
})

test('extractExecutable returns the single expected executable', () => {
  assert.deepEqual(extractExecutable(archiveWithExecutable(), 'easytier-core.exe'), Buffer.from('fake-easytier-core'))
})

test('component installer verifies archive hash and persists version metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-easytier-test-'))
  const archive = archiveWithExecutable(Buffer.from('verified-core'))
  let requests = 0
  const installer = createEasyTierComponentInstaller({
    componentRoot: root,
    platform: 'win32',
    arch: 'x64',
    release: {
      version: 'test',
      url: 'https://example.invalid/easytier.zip',
      sha256: hashBuffer(archive),
      executable: 'easytier-core.exe'
    },
    fetchImpl: async () => {
      requests += 1
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(archive.length) },
        body: (async function * () { yield archive })()
      }
    }
  })
  try {
    const binary = await installer()
    assert.equal(await readFile(binary, 'utf8'), 'verified-core')
    assert.equal(JSON.parse(await readFile(path.join(root, 'easytier', 'version.json'), 'utf8')).archiveSha256, hashBuffer(archive))
    assert.equal(await installer(), binary)
    assert.equal(requests, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
