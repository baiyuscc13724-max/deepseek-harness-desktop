const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync } = require('node:crypto')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const {
  buildComponentIndex,
  createComponentZip,
  createSignedComponentDescriptor,
  createSignedReleaseManifest
} = require('../electron/bridge/component-update-builder.cjs')
const { validateAndVerifyManifest } = require('../electron/bridge/component-update-contract.cjs')

test('builder creates deterministic sorted per-file index', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-builder-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'renderer'), { recursive: true })
  await writeFile(path.join(root, 'z.txt'), 'z')
  await writeFile(path.join(root, 'renderer', 'a.js'), 'alpha')

  const built = await buildComponentIndex({ inputDir: root, id: 'desktop-shell', version: '1.0.24', target: 'shell' })
  assert.deepEqual(built.index.files.map(file => file.path), ['renderer/a.js', 'z.txt'])
  assert.equal(built.unpackedSize, 6)
  assert.match(built.index.files[0].sha256, /^[a-f0-9]{64}$/)
})

test('component ZIP bytes are deterministic across retries', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-zip-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const input = path.join(root, 'input')
  await mkdir(path.join(input, 'renderer'), { recursive: true })
  await writeFile(path.join(input, 'renderer', 'app.js'), 'deterministic')
  const first = path.join(root, 'first.zip')
  const second = path.join(root, 'second.zip')
  await createComponentZip({ inputDir: input, outputFile: first, id: 'desktop-shell', version: '1.0.24', target: 'shell', AdmZipImpl: AdmZip })
  await new Promise(resolve => setTimeout(resolve, 1100))
  await createComponentZip({ inputDir: input, outputFile: second, id: 'desktop-shell', version: '1.0.24', target: 'shell', AdmZipImpl: AdmZip })
  assert.deepEqual(await readFile(first), await readFile(second))
})

test('builder output validates with the client trust contract', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const component = createSignedComponentDescriptor({
    id: 'desktop-shell',
    version: '1.0.24',
    target: 'shell',
    platform: 'win32',
    arch: 'x64',
    archive: { size: 100, unpackedSize: 200, sha256: 'a'.repeat(64) },
    urls: ['https://cnb.example/desktop-shell.zip', 'https://github.example/desktop-shell.zip']
  }, privateKey)
  const manifest = createSignedReleaseManifest({
    releaseVersion: '1.0.24',
    keyId: 'release-2026',
    publishedAt: '2026-08-19T00:00:00.000Z',
    bootstrap: { minVersion: '1.0.24' },
    components: [component],
    fallback: {
      version: '1.0.24',
      size: 300,
      sha256: 'b'.repeat(64),
      urls: ['https://cnb.example/Harness-Desktop.exe']
    }
  }, privateKey)
  const verified = validateAndVerifyManifest(manifest, {
    'release-2026': publicKey.export({ type: 'spki', format: 'pem' })
  }, { now: Date.parse('2026-08-19T01:00:00.000Z') })

  assert.equal(verified.components[0].unpackedSize, 200)
  assert.equal(verified.releaseVersion, '1.0.24')
})
