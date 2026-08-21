const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'artifact-cas.js')).href
function digest(bytes) { return `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
async function fixture() {
  const mod = await import(moduleUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'artifact-cas-'))
  const objectRoot = path.join(root, 'objects')
  const stagingRoot = path.join(root, 'staging')
  const store = new mod.ArtifactContentAddressedStore({ objectRoot, stagingRoot, maxObjectBytes: 8 * 1024 * 1024 })
  await store.initialize()
  return { mod, root, objectRoot, stagingRoot, store }
}
async function usingFixture(run) {
  const state = await fixture()
  try { await run(state) } finally { await state.store.close(); await rm(state.root, { recursive: true, force: true }) }
}
async function upload(store, uploadRef, payload) {
  const expectedDigest = digest(payload)
  await store.beginUpload({ uploadRef, expectedDigest, expectedSize: payload.length })
  for (let offset = 0; offset < payload.length; offset += 7) {
    const chunk = payload.subarray(offset, Math.min(payload.length, offset + 7))
    await store.appendChunk({ uploadRef, offset, bytes: chunk, chunkDigest: digest(chunk) })
  }
  return store.finalizeUpload(uploadRef)
}

test('chunked CAS publication is content addressed, bounded, readable, and path private', async () => usingFixture(async ({ store, objectRoot, stagingRoot }) => {
  const payload = Buffer.from('immutable artifact and Git bundle bytes')
  const result = await upload(store, `upload_${'A'.repeat(24)}`, payload)
  assert.equal(result.digest, digest(payload))
  assert.equal(result.size, payload.length)
  assert.deepEqual(await store.inspect(result.digest), { digest: result.digest, size: payload.length, present: true })
  const chunks = []
  let offset = 0
  while (offset < payload.length) {
    const chunk = await store.readChunk({ digest: result.digest, offset, length: 5 })
    chunks.push(chunk.bytes)
    offset += chunk.bytes.length
    if (chunk.eof) break
  }
  assert.deepEqual(Buffer.concat(chunks), payload)
  const projection = JSON.stringify(store)
  assert.equal(projection.includes(objectRoot), false)
  assert.equal(projection.includes(stagingRoot), false)
  assert.equal(projection.includes(payload.toString()), false)
}))

test('deduplicated and concurrent uploads converge on one verified immutable object', async () => usingFixture(async ({ store }) => {
  const payload = Buffer.from('same bytes from two collaborators')
  const expectedDigest = digest(payload)
  const left = `upload_${'B'.repeat(24)}`
  const right = `upload_${'C'.repeat(24)}`
  await store.beginUpload({ uploadRef: left, expectedDigest, expectedSize: payload.length })
  await store.beginUpload({ uploadRef: right, expectedDigest, expectedSize: payload.length })
  await store.appendChunk({ uploadRef: left, offset: 0, bytes: payload, chunkDigest: expectedDigest })
  await store.appendChunk({ uploadRef: right, offset: 0, bytes: payload, chunkDigest: expectedDigest })
  const results = await Promise.all([store.finalizeUpload(left), store.finalizeUpload(right)])
  assert.deepEqual(results[0], results[1])
  const duplicate = await store.beginUpload({ uploadRef: `upload_${'D'.repeat(24)}`, expectedDigest, expectedSize: payload.length })
  assert.deepEqual(duplicate, { uploadRef: `upload_${'D'.repeat(24)}`, offset: payload.length, complete: true, digest: expectedDigest, size: payload.length })
}))

test('out-of-order, forged, oversized, incomplete, and wrong-total chunks fail closed', async () => usingFixture(async ({ store, mod }) => {
  const payload = Buffer.from('declared payload')
  const ref = `upload_${'E'.repeat(24)}`
  await store.beginUpload({ uploadRef: ref, expectedDigest: digest(payload), expectedSize: payload.length })
  await assert.rejects(store.appendChunk({ uploadRef: ref, offset: 1, bytes: payload, chunkDigest: digest(payload) }), /stale or out of order/u)
  await assert.rejects(store.appendChunk({ uploadRef: ref, offset: 0, bytes: payload, chunkDigest: digest(Buffer.from('forged')) }), /chunk digest is invalid/u)
  await assert.rejects(store.appendChunk({ uploadRef: ref, offset: 0, bytes: Buffer.alloc(mod.MAX_CHUNK_BYTES + 1), chunkDigest: digest(Buffer.alloc(mod.MAX_CHUNK_BYTES + 1)) }), /size exceeds/u)
  await store.appendChunk({ uploadRef: ref, offset: 0, bytes: payload.subarray(0, 3), chunkDigest: digest(payload.subarray(0, 3)) })
  await assert.rejects(store.finalizeUpload(ref), /incomplete/u)

  const wrongRef = `upload_${'F'.repeat(24)}`
  await store.beginUpload({ uploadRef: wrongRef, expectedDigest: digest(Buffer.from('other bytes')), expectedSize: payload.length })
  await store.appendChunk({ uploadRef: wrongRef, offset: 0, bytes: payload, chunkDigest: digest(payload) })
  await assert.rejects(store.finalizeUpload(wrongRef), /does not match/u)
}))

test('integrity checks detect post-publication corruption and close removes partial uploads', async () => usingFixture(async ({ store, objectRoot, stagingRoot }) => {
  const payload = Buffer.from('verify me')
  const result = await upload(store, `upload_${'G'.repeat(24)}`, payload)
  const hex = result.digest.slice('sha256:'.length)
  await writeFile(path.join(objectRoot, 'sha256', hex.slice(0, 2), hex), 'tampered', 'utf8')
  await assert.rejects(store.inspect(result.digest), /integrity verification failed/u)

  const partialRef = `upload_${'H'.repeat(24)}`
  const partial = Buffer.from('partial')
  await store.beginUpload({ uploadRef: partialRef, expectedDigest: digest(partial), expectedSize: partial.length })
  await store.close()
  assert.equal(store.toJSON().activeUploadCount, 0)
  assert.equal(JSON.stringify(store).includes(stagingRoot), false)
}))
