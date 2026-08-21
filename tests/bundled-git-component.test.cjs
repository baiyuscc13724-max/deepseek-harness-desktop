const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm, writeFile, mkdir } = require('node:fs/promises')
const AdmZip = require('adm-zip')

function zipBuffer(files) {
  const zip = new AdmZip()
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content))
  return zip.toBuffer()
}

function responseFor(buffer) {
  return {
    ok: true,
    status: 200,
    url: 'https://objects.githubusercontent.com/fixed-asset',
    headers: { get: name => name.toLowerCase() === 'content-length' ? String(buffer.length) : null },
    body: (async function * () { yield buffer })()
  }
}

test('pinned bundled Git descriptors use official HTTPS assets and fixed digests', async () => {
  const { ASSETS } = await import('../scripts/prepare-bundled-git.mjs')
  assert.match(ASSETS.mingit.url, /^https:\/\/github\.com\/git-for-windows\/git\/releases\/download\//u)
  assert.match(ASSETS.gcm.url, /^https:\/\/github\.com\/git-ecosystem\/git-credential-manager\/releases\/download\//u)
  assert.match(ASSETS.lfs.url, /^https:\/\/github\.com\/git-lfs\/git-lfs\/releases\/download\//u)
  for (const asset of Object.values(ASSETS)) {
    assert.match(asset.sha256, /^[0-9a-f]{64}$/u)
    assert.ok(asset.size > 1_000_000)
  }
})

test('ZIP validation rejects traversal, links, case collisions and expansion bombs', async () => {
  const { normalizeZipPath, validateZipEntries } = await import('../scripts/prepare-bundled-git.mjs')
  for (const value of ['../escape', '/absolute', 'C:/escape', 'a/../b', 'a\0b']) assert.throws(() => normalizeZipPath(value))
  const entry = (name, size = 1, attr = 0) => ({ entryName: name, isDirectory: false, header: { size, attr } })
  assert.throws(() => validateZipEntries([entry('A.txt'), entry('a.TXT')], 10), /duplicate|case-conflicting/i)
  assert.throws(() => validateZipEntries([entry('link', 1, 0o120000 << 16)], 10), /symbolic links/i)
  assert.throws(() => validateZipEntries([entry('large', 11)], 10), /exceeds/i)
})

test('preparer verifies all archives and atomically assembles MinGit with GCM and LFS', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bundled-git-'))
  const mingit = zipBuffer({
    'cmd/git.exe': 'fake-git',
    'mingw64/share/licenses/git/COPYING': 'GPL-2.0'
  })
  const gcm = zipBuffer({
    'git-credential-manager.exe': 'fake-gcm',
    'LICENSE': 'MIT'
  })
  const lfs = zipBuffer({ 'git-lfs.exe': 'fake-lfs' })
  try {
    const licenses = path.join(root, 'third_party', 'licenses')
    await mkdir(licenses, { recursive: true })
    await writeFile(path.join(licenses, 'git-lfs-3.7.1-LICENSE.md'), 'MIT')
    const { getBundledGitPreparationState, prepareBundledGit } = await import('../scripts/prepare-bundled-git.mjs')
    const crypto = require('node:crypto')
    const descriptor = (id, archive, license) => ({
      id, name: `${id}.zip`, version: 'test', url: `https://github.com/example/${id}.zip`,
      size: archive.length, sha256: crypto.createHash('sha256').update(archive).digest('hex'),
      maxUnpackedBytes: 1024 * 1024, license
    })
    const assets = {
      mingit: descriptor('mingit', mingit, 'GPL-2.0-only'),
      gcm: descriptor('gcm', gcm, 'MIT'),
      lfs: descriptor('lfs', lfs, 'MIT')
    }
    const fetchImpl = async url => responseFor(url.includes('mingit') ? mingit : url.includes('gcm') ? gcm : lfs)
    const states = []
    assert.deepEqual(await getBundledGitPreparationState({ root }), { state: 'missing', canPrepare: true })
    const result = await prepareBundledGit({ root, assets, fetchImpl, onStateChange: state => states.push(state) })
    assert.deepEqual(states, [
      { state: 'installing', canPrepare: false },
      { state: 'ready', canPrepare: false }
    ])
    assert.deepEqual(await getBundledGitPreparationState({ root }), { state: 'ready', canPrepare: false })
    assert.equal(await readFile(path.join(result.destination, 'cmd', 'git.exe'), 'utf8'), 'fake-git')
    assert.equal(await readFile(path.join(result.destination, 'mingw64', 'bin', 'git-credential-manager.exe'), 'utf8'), 'fake-gcm')
    assert.equal(await readFile(path.join(result.destination, 'mingw64', 'bin', 'git-lfs.exe'), 'utf8'), 'fake-lfs')
    assert.equal(await readFile(path.join(result.destination, 'mingw64', 'bin', 'git-lfs-LICENSE.md'), 'utf8'), 'MIT')
    const metadata = JSON.parse(await readFile(path.join(result.destination, 'BUNDLED-GIT-METADATA.json'), 'utf8'))
    assert.equal(metadata.assets.length, 3)
    assert.ok(metadata.assets.every(asset => asset.licenseFile))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('preparation marker reports installing and prevents concurrent writers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bundled-git-lock-'))
  const thirdParty = path.join(root, 'third_party')
  await mkdir(thirdParty, { recursive: true })
  await writeFile(path.join(thirdParty, '.bundled-git-installing'), '')
  try {
    const { getBundledGitPreparationState, prepareBundledGit } = await import('../scripts/prepare-bundled-git.mjs')
    assert.deepEqual(await getBundledGitPreparationState({ root }), { state: 'installing', canPrepare: false })
    await assert.rejects(prepareBundledGit({ root }), /already in progress/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed verification preserves an existing bundled Git directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bundled-git-rollback-'))
  const existing = path.join(root, 'third_party', 'mingit')
  await mkdir(existing, { recursive: true })
  await writeFile(path.join(existing, 'keep.txt'), 'keep')
  try {
    const { prepareBundledGit } = await import('../scripts/prepare-bundled-git.mjs')
    const archive = zipBuffer({ 'cmd/git.exe': 'fake', 'COPYING': 'GPL' })
    const assets = {
      mingit: { id: 'mingit', name: 'mingit.zip', version: 'x', url: 'https://github.com/x/mingit.zip', size: archive.length, sha256: '0'.repeat(64), maxUnpackedBytes: 100000, license: 'GPL-2.0-only' },
      gcm: { id: 'gcm', name: 'gcm.zip', version: 'x', url: 'https://github.com/x/gcm.zip', size: archive.length, sha256: '0'.repeat(64), maxUnpackedBytes: 100000, license: 'MIT' }
    }
    const states = []
    await assert.rejects(prepareBundledGit({
      root, assets, fetchImpl: async () => responseFor(archive), onStateChange: state => states.push(state)
    }), /SHA-256/)
    assert.deepEqual(states, [
      { state: 'installing', canPrepare: false },
      { state: 'failed', canPrepare: true, reason: 'preparation-failed' }
    ])
    const { getBundledGitPreparationState } = await import('../scripts/prepare-bundled-git.mjs')
    assert.deepEqual(await getBundledGitPreparationState({ root }), { state: 'missing', canPrepare: true })
    assert.equal(await readFile(path.join(existing, 'keep.txt'), 'utf8'), 'keep')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
