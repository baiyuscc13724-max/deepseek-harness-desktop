const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')
const { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'artifact-cas.js')).href
function digest(bytes) { return `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
async function fixture() {
  const mod = await import(moduleUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'artifact-cas-'))
  const objectRoot = path.join(root, 'objects')
  const stagingRoot = path.join(root, 'staging')
  const projectRef = `project_${'C'.repeat(26)}`, encryptionKey = randomBytes(32)
  const store = new mod.ArtifactContentAddressedStore({ objectRoot, stagingRoot, projectRef, encryptionKey, maxObjectBytes: 8 * 1024 * 1024 })
  await store.initialize()
  return { mod, root, objectRoot, stagingRoot, projectRef, encryptionKey, store }
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

function objectPath(objectRoot, digestRef) { const hex = digestRef.slice('sha256:'.length); return path.join(objectRoot, 'sha256', hex.slice(0, 2), hex) }
async function stagingFile(stagingRoot) { const names = await readdir(stagingRoot); assert.equal(names.length, 1); return path.join(stagingRoot, names[0]) }

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

test('two encrypted CAS instances race the same digest and accept only verified equivalent plaintext', async () => usingFixture(async ({ store, objectRoot, stagingRoot, projectRef, encryptionKey, mod }) => {
  const peer = new mod.ArtifactContentAddressedStore({ objectRoot, stagingRoot: path.join(path.dirname(stagingRoot), 'peer-staging'), projectRef, encryptionKey, maxObjectBytes: 8 * 1024 * 1024 })
  try {
    await peer.initialize(); const payload = randomBytes(64 * 1024), expectedDigest = digest(payload), left = `upload_${'S'.repeat(24)}`, right = `upload_${'T'.repeat(24)}`
    await Promise.all([store.beginUpload({ uploadRef: left, expectedDigest, expectedSize: payload.length }), peer.beginUpload({ uploadRef: right, expectedDigest, expectedSize: payload.length })])
    await Promise.all([store.appendChunk({ uploadRef: left, offset: 0, bytes: payload, chunkDigest: expectedDigest }), peer.appendChunk({ uploadRef: right, offset: 0, bytes: payload, chunkDigest: expectedDigest })])
    const results = await Promise.all([store.finalizeUpload(left), peer.finalizeUpload(right)]); assert.deepEqual(results[0], results[1])
    assert.deepEqual((await peer.readChunk({ digest: expectedDigest, offset: 0, length: payload.length })).bytes, payload)
  } finally { await peer.close() }
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

test('close drains accepted CAS work, rejects every later operation, and returns one promise', async () => usingFixture(async ({ store }) => {
  const payload = Buffer.alloc(1024 * 1024, 9), ref = `upload_${'I'.repeat(24)}`
  await store.beginUpload({ uploadRef: ref, expectedDigest: digest(payload), expectedSize: payload.length })
  const accepted = store.appendChunk({ uploadRef: ref, offset: 0, bytes: payload, chunkDigest: digest(payload) })
  const closing = store.close()
  assert.equal(store.close(), closing)
  await assert.rejects(store.inspect(digest(payload)), error => error.code === 'ARTIFACT_CAS_CLOSED')
  assert.equal((await accepted).offset, payload.length)
  await closing
  assert.equal(store.toJSON().ready, false)
  assert.equal(store.toJSON().activeUploadCount, 0)
}))

test('CAS close clears every upload and becomes terminal even when cleanup reports failure', async () => {
  const state = await fixture(), { store } = state
  let originalClose
  try {
    const payload = Buffer.from('cleanup failure'), ref = `upload_${'J'.repeat(24)}`
    await store.beginUpload({ uploadRef: ref, expectedDigest: digest(payload), expectedSize: payload.length })
    const upload = store.uploads.get(ref); originalClose = upload.handle.close.bind(upload.handle)
    upload.handle.close = async () => { throw new Error('simulated CAS cleanup failure') }
    const closing = store.close()
    assert.equal(store.close(), closing)
    await assert.rejects(closing, /simulated CAS cleanup failure/u)
    assert.equal(store.toJSON().ready, false)
    assert.equal(store.toJSON().activeUploadCount, 0)
    await assert.rejects(store.abortUpload(ref), error => error.code === 'ARTIFACT_CAS_CLOSED')
  } finally { await originalClose?.().catch(() => undefined); await rm(state.root, { recursive: true, force: true }) }
})

test('integrity checks detect post-publication corruption and close removes partial uploads', async () => usingFixture(async ({ store, objectRoot, stagingRoot }) => {
  const payload = Buffer.from('verify me')
  const result = await upload(store, `upload_${'G'.repeat(24)}`, payload)
  const hex = result.digest.slice('sha256:'.length)
  await writeFile(path.join(objectRoot, 'sha256', hex.slice(0, 2), hex), 'tampered', 'utf8')
  await assert.rejects(store.inspect(result.digest), error => error.code === 'ARTIFACT_CAS_CIPHERTEXT_INVALID')

  const partialRef = `upload_${'H'.repeat(24)}`
  const partial = Buffer.from('partial')
  await store.beginUpload({ uploadRef: partialRef, expectedDigest: digest(partial), expectedSize: partial.length })
  await store.close()
  assert.equal(store.toJSON().activeUploadCount, 0)
  assert.equal(JSON.stringify(store).includes(stagingRoot), false)
}))

test('encrypted staging and objects never contain plaintext, including authenticated empty objects', async () => usingFixture(async ({ store, objectRoot, stagingRoot, mod }) => {
  const payload = Buffer.from('KNOWN-PLAINTEXT-ARTIFACT-'.repeat(100)), ref = `upload_${'K'.repeat(24)}`, expectedDigest = digest(payload)
  await store.beginUpload({ uploadRef: ref, expectedDigest, expectedSize: payload.length })
  let disk = await readFile(await stagingFile(stagingRoot))
  assert.equal(disk.length, mod.HEADER_BYTES)
  assert.equal(disk.includes(payload.subarray(0, 20)), false)
  await store.appendChunk({ uploadRef: ref, offset: 0, bytes: payload, chunkDigest: expectedDigest })
  disk = await readFile(await stagingFile(stagingRoot))
  assert.equal(disk.includes(payload.subarray(0, 20)), false)
  await store.finalizeUpload(ref)
  assert.equal((await readFile(objectPath(objectRoot, expectedDigest))).includes(payload.subarray(0, 20)), false)

  const empty = Buffer.alloc(0), emptyDigest = digest(empty)
  await store.beginUpload({ uploadRef: `upload_${'L'.repeat(24)}`, expectedDigest: emptyDigest, expectedSize: 0 })
  await store.finalizeUpload(`upload_${'L'.repeat(24)}`)
  const emptyDisk = await readFile(objectPath(objectRoot, emptyDigest))
  assert.equal(emptyDisk.length, mod.HEADER_BYTES)
  assert.deepEqual(await store.inspect(emptyDigest), { digest: emptyDigest, size: 0, present: true })
  assert.deepEqual((await store.readChunk({ digest: emptyDigest, offset: 0, length: 1 })).bytes, Buffer.alloc(0))
}))

test('multi-frame random reads survive restart and inspect never allocates the whole object', async () => usingFixture(async ({ store, objectRoot, stagingRoot, projectRef, encryptionKey, mod }) => {
  const payload = randomBytes(3 * 1024 * 1024 + 333), expectedDigest = digest(payload), ref = `upload_${'M'.repeat(24)}`
  await store.beginUpload({ uploadRef: ref, expectedDigest, expectedSize: payload.length })
  for (let offset = 0; offset < payload.length; offset += mod.MAX_CHUNK_BYTES) { const chunk = payload.subarray(offset, Math.min(payload.length, offset + mod.MAX_CHUNK_BYTES)); await store.appendChunk({ uploadRef: ref, offset, bytes: chunk, chunkDigest: digest(chunk) }) }
  await store.finalizeUpload(ref)
  for (const [offset, length] of [[0, 17], [mod.MAX_CHUNK_BYTES - 9, 40], [2 * mod.MAX_CHUNK_BYTES + 7, 12345], [payload.length - 10, 100]]) assert.deepEqual((await store.readChunk({ digest: expectedDigest, offset, length })).bytes, payload.subarray(offset, Math.min(payload.length, offset + length)))
  await store.close()
  const reopened = new mod.ArtifactContentAddressedStore({ objectRoot, stagingRoot, projectRef, encryptionKey, maxObjectBytes: 8 * 1024 * 1024 })
  await reopened.initialize()
  const originalAlloc = Buffer.alloc, originalConcat = Buffer.concat; let largest = 0
  Buffer.alloc = function (size, ...args) { largest = Math.max(largest, size); return originalAlloc.call(Buffer, size, ...args) }
  Buffer.concat = function (list, totalLength) { const size = totalLength ?? list.reduce((sum, item) => sum + item.length, 0); largest = Math.max(largest, size); return originalConcat.call(Buffer, list, totalLength) }
  try { assert.deepEqual(await reopened.inspect(expectedDigest), { digest: expectedDigest, size: payload.length, present: true }) } finally { Buffer.alloc = originalAlloc; Buffer.concat = originalConcat; await reopened.close() }
  assert.ok(largest <= mod.MAX_CHUNK_BYTES + mod.HEADER_BYTES + 64, `largest temporary allocation was ${largest}`)
}))

test('wrong key, project, legacy plaintext, and every structural tamper fail with one ciphertext error', async () => usingFixture(async ({ store, objectRoot, stagingRoot, projectRef, encryptionKey, mod }) => {
  const payload = Buffer.from('first authenticated frame---second authenticated frame'), expectedDigest = digest(payload), ref = `upload_${'N'.repeat(24)}`
  await store.beginUpload({ uploadRef: ref, expectedDigest, expectedSize: payload.length })
  const split = 28
  await store.appendChunk({ uploadRef: ref, offset: 0, bytes: payload.subarray(0, split), chunkDigest: digest(payload.subarray(0, split)) })
  await store.appendChunk({ uploadRef: ref, offset: split, bytes: payload.subarray(split), chunkDigest: digest(payload.subarray(split)) })
  await store.finalizeUpload(ref)
  const target = objectPath(objectRoot, expectedDigest), original = await readFile(target), invalid = error => error.code === 'ARTIFACT_CAS_CIPHERTEXT_INVALID'
  const variants = []
  for (const index of [0, mod.HEADER_BYTES - 1, mod.HEADER_BYTES + 8, mod.HEADER_BYTES + 16, mod.HEADER_BYTES + 32, mod.HEADER_BYTES + 32 + split]) { const value = Buffer.from(original); value[index] ^= 0x80; variants.push(value) }
  variants.push(original.subarray(0, original.length - 1), Buffer.concat([original, Buffer.from([1])]))
  const firstLength = 32 + split + 16, first = original.subarray(mod.HEADER_BYTES, mod.HEADER_BYTES + firstLength), second = original.subarray(mod.HEADER_BYTES + firstLength)
  variants.push(Buffer.concat([original.subarray(0, mod.HEADER_BYTES), second, first]))
  for (const variant of variants) { await writeFile(target, variant); await assert.rejects(store.inspect(expectedDigest), invalid) }
  await writeFile(target, variants[4]); await assert.rejects(store.readChunk({ digest: expectedDigest, offset: 0, length: 5 }), invalid)
  await writeFile(target, original)

  for (const [candidateProject, candidateKey] of [[projectRef, randomBytes(32)], [`project_${'Z'.repeat(26)}`, encryptionKey]]) {
    const other = new mod.ArtifactContentAddressedStore({ objectRoot, stagingRoot: path.join(path.dirname(stagingRoot), `staging-${randomBytes(4).toString('hex')}`), projectRef: candidateProject, encryptionKey: candidateKey, maxObjectBytes: 8 * 1024 * 1024 })
    await other.initialize(); await assert.rejects(other.inspect(expectedDigest), invalid); await other.close()
  }
  await writeFile(target, payload)
  await assert.rejects(store.inspect(expectedDigest), invalid)
  await assert.rejects(store.beginUpload({ uploadRef: `upload_${'O'.repeat(24)}`, expectedDigest, expectedSize: payload.length }), invalid)
}))

test('failed frame authentication zeroes partial plaintext produced before final tag verification', async () => usingFixture(async ({ store, objectRoot }) => {
  const payload = Buffer.from('partial plaintext must be destroyed on bad tag'), expectedDigest = digest(payload), ref = `upload_${'V'.repeat(24)}`
  await store.beginUpload({ uploadRef: ref, expectedDigest, expectedSize: payload.length }); await store.appendChunk({ uploadRef: ref, offset: 0, bytes: payload, chunkDigest: expectedDigest }); await store.finalizeUpload(ref); const target = objectPath(objectRoot, expectedDigest), bytes = await readFile(target); bytes[bytes.length - 1] ^= 1; await writeFile(target, bytes)
  const originalFill = Buffer.prototype.fill, clearedPayloadSized = []
  Buffer.prototype.fill = function (value, ...args) { const result = originalFill.call(this, value, ...args); if (value === 0 && this.length === payload.length) clearedPayloadSized.push(this); return result }
  try { await assert.rejects(store.inspect(expectedDigest), error => error.code === 'ARTIFACT_CAS_CIPHERTEXT_INVALID') } finally { Buffer.prototype.fill = originalFill }
  assert.ok(clearedPayloadSized.length >= 2, 'ciphertext and unauthenticated partial plaintext were both cleared')
  for (const buffer of clearedPayloadSized) assert.ok(buffer.every(byte => byte === 0))
}))

test('non-files, leaf links, and parent-link escapes are invalid ciphertext rather than absent objects', async () => usingFixture(async ({ store, root, objectRoot }) => {
  const expectedDigest = digest(Buffer.from('linked-object')), target = objectPath(objectRoot, expectedDigest), invalid = error => error.code === 'ARTIFACT_CAS_CIPHERTEXT_INVALID'
  await mkdir(path.dirname(target), { recursive: true }); await mkdir(target)
  await assert.rejects(store.inspect(expectedDigest), invalid); await assert.rejects(store.readChunk({ digest: expectedDigest, offset: 0, length: 1 }), invalid)
  await rm(target, { recursive: true, force: true }); const outside = path.join(root, 'outside-object'); await mkdir(outside)
  await symlink(outside, target, 'junction'); await assert.rejects(store.inspect(expectedDigest), invalid)
  await rm(target, { recursive: true, force: true }); const prefix = path.dirname(target); await rm(prefix, { recursive: true, force: true }); await writeFile(path.join(outside, path.basename(target)), 'legacy plaintext')
  await symlink(outside, prefix, 'junction'); await assert.rejects(store.inspect(expectedDigest), invalid); await assert.rejects(store.readChunk({ digest: expectedDigest, offset: 0, length: 1 }), invalid)
}))

test('nonce reuse and partial frame writes abort without a finalizable staging object', async () => {
  const mod = await import(moduleUrl), root = await mkdtemp(path.join(os.tmpdir(), 'artifact-cas-failure-')), objectRoot = path.join(root, 'objects'), stagingRoot = path.join(root, 'staging'), key = randomBytes(32), projectRef = `project_${'P'.repeat(26)}`
  const store = new mod.ArtifactContentAddressedStore({ objectRoot, stagingRoot, projectRef, encryptionKey: key, randomBytesImpl: () => Buffer.alloc(12, 4), maxObjectBytes: 1024 })
  try {
    await store.initialize(); const payload = Buffer.from('partial encrypted frame'), expectedDigest = digest(payload), left = `upload_${'P'.repeat(24)}`
    await store.beginUpload({ uploadRef: left, expectedDigest, expectedSize: payload.length })
    await assert.rejects(store.beginUpload({ uploadRef: `upload_${'Q'.repeat(24)}`, expectedDigest, expectedSize: payload.length }), error => error.code === 'ARTIFACT_CAS_NONCE_REUSE')
    const uploadState = store.uploads.get(left), originalWrite = uploadState.handle.write.bind(uploadState.handle); let failed = false
    uploadState.handle.write = async (buffer, offset, length, position) => { if (!failed) { failed = true; await originalWrite(buffer, offset, Math.max(1, Math.floor(length / 2)), position); throw new Error('simulated partial write') } return originalWrite(buffer, offset, length, position) }
    await assert.rejects(store.appendChunk({ uploadRef: left, offset: 0, bytes: payload, chunkDigest: expectedDigest }), /simulated partial write/u)
    await assert.rejects(store.finalizeUpload(left), /not active/u)
    assert.deepEqual(await readdir(stagingRoot), [])
    assert.deepEqual(await store.inspect(expectedDigest), { digest: expectedDigest, size: 0, present: false })
  } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
})

test('a valid authenticated 2 GiB size header never causes whole-object allocation', async () => {
  const mod = await import(moduleUrl), root = await mkdtemp(path.join(os.tmpdir(), 'artifact-cas-2gib-')), objectRoot = path.join(root, 'objects'), stagingRoot = path.join(root, 'staging'), projectRef = `project_${'G'.repeat(26)}`, encryptionKey = randomBytes(32)
  const store = new mod.ArtifactContentAddressedStore({ objectRoot, stagingRoot, projectRef, encryptionKey })
  try {
    await store.initialize(); const declaredSize = 2 * 1024 * 1024 * 1024, expectedDigest = digest(Buffer.from('not-the-declared-object')), ref = `upload_${'U'.repeat(24)}`
    await store.beginUpload({ uploadRef: ref, expectedDigest, expectedSize: declaredSize })
    const temporary = store.uploads.get(ref).temporary, target = objectPath(objectRoot, expectedDigest); await mkdir(path.dirname(target), { recursive: true }); await copyFile(temporary, target)
    const originalAlloc = Buffer.alloc; let largest = 0
    Buffer.alloc = function (size, ...args) { largest = Math.max(largest, size); if (size > mod.MAX_CHUNK_BYTES + 1024) throw new Error('whole-object allocation attempted'); return originalAlloc.call(Buffer, size, ...args) }
    try { await assert.rejects(store.inspect(expectedDigest), error => error.code === 'ARTIFACT_CAS_CIPHERTEXT_INVALID') } finally { Buffer.alloc = originalAlloc }
    assert.ok(largest <= mod.HEADER_BYTES)
  } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
})

test('constructor is key-strict and temporary keys/plaintext copies are zeroed without touching caller buffers', async () => {
  const mod = await import(moduleUrl), root = await mkdtemp(path.join(os.tmpdir(), 'artifact-cas-zero-')), options = { objectRoot: path.join(root, 'objects'), stagingRoot: path.join(root, 'staging'), projectRef: `project_${'Y'.repeat(26)}` }
  assert.throws(() => new mod.ArtifactContentAddressedStore({ ...options, encryptionKey: 'secret' }))
  assert.throws(() => new mod.ArtifactContentAddressedStore({ ...options, encryptionKey: Buffer.alloc(31) }))
  if (typeof SharedArrayBuffer === 'function') assert.throws(() => new mod.ArtifactContentAddressedStore({ ...options, encryptionKey: new Uint8Array(new SharedArrayBuffer(32)) }))
  const callerKey = randomBytes(32), callerPayload = Buffer.from('caller-owned plaintext'), keyBefore = Buffer.from(callerKey), payloadBefore = Buffer.from(callerPayload), store = new mod.ArtifactContentAddressedStore({ ...options, encryptionKey: callerKey })
  const originalFill = Buffer.prototype.fill, cleared = []
  Buffer.prototype.fill = function (value, ...args) { const result = originalFill.call(this, value, ...args); if (value === 0) cleared.push(this); return result }
  try { await store.initialize(); const expectedDigest = digest(callerPayload), ref = `upload_${'R'.repeat(24)}`; await store.beginUpload({ uploadRef: ref, expectedDigest, expectedSize: callerPayload.length }); await store.appendChunk({ uploadRef: ref, offset: 0, bytes: callerPayload, chunkDigest: expectedDigest }); await store.finalizeUpload(ref); await store.inspect(expectedDigest); await store.close() } finally { Buffer.prototype.fill = originalFill; await store.close().catch(() => undefined); await rm(root, { recursive: true, force: true }) }
  assert.deepEqual(callerKey, keyBefore); assert.deepEqual(callerPayload, payloadBefore); assert.ok(cleared.length > 10); for (const buffer of cleared) assert.ok(buffer.every(byte => byte === 0))
})
