const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  checksumWithFallback,
  downloadWithFallback,
  safeHttpsUrl
} = require('../electron/bridge/update-download-service.cjs')
const { parseChecksumFile } = require('../electron/bridge/update-service.cjs')

function headers(values = {}) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]))
  return { get: name => normalized[String(name).toLowerCase()] || null }
}

function binaryResponse(value, type = 'application/octet-stream') {
  const bodyValue = Buffer.from(value)
  return {
    ok: true,
    status: 200,
    headers: headers({ 'content-type': type, 'content-length': bodyValue.length }),
    body: (async function * () { yield bodyValue })()
  }
}

test('installer download rejects a bad CNB file before accepting the verified GitHub fallback', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'harness-update-'))
  const destination = path.join(temp, 'setup.exe')
  const good = Buffer.from('verified-installer')
  const expectedHash = createHash('sha256').update(good).digest('hex')
  const calls = []
  const progress = []
  try {
    const result = await downloadWithFallback({
      asset: { urls: ['https://cnb.cool/example/setup.exe', 'https://github.example/setup.exe'] },
      destination,
      expectedSize: good.length,
      expectedHash,
      fetchImpl: async url => {
        calls.push(url)
        if (url.includes('cnb.cool')) return binaryResponse(Buffer.alloc(good.length, 0x78))
        return binaryResponse(good)
      },
      onProgress: value => progress.push(value)
    })

    assert.deepEqual(calls.map(value => new URL(value).hostname), ['cnb.cool', 'github.example'])
    assert.equal(result.attempt, 2)
    assert.equal(new URL(result.source).hostname, 'github.example')
    assert.equal(result.sha256, expectedHash)
    assert.deepEqual(await readFile(destination), good)
    assert.deepEqual(progress.filter(value => value.phase === 'source').map(value => value.attempt), [1, 2])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('checksum download skips a share page and accepts the next valid SHA-256 file', async () => {
  const fileName = 'Harness-Desktop-1.2.3-win-x64.exe'
  const digest = 'b'.repeat(64)
  const calls = []
  const result = await checksumWithFallback({
    asset: { urls: ['https://cnb.cool/example/SHA256SUMS.txt', 'https://github.example/SHA256SUMS.txt'] },
    fileName,
    parseChecksum: parseChecksumFile,
    fetchImpl: async url => {
      calls.push(url)
      if (url.includes('cnb.cool')) {
        return { ok: true, status: 200, headers: headers({ 'content-type': 'text/html' }), text: async () => '<html>share</html>' }
      }
      return { ok: true, status: 200, headers: headers({ 'content-type': 'text/plain' }), text: async () => `${digest}  ${fileName}\n` }
    }
  })

  assert.equal(result.hash, digest)
  assert.equal(new URL(result.source).hostname, 'github.example')
  assert.equal(calls.length, 2)
})

test('update files require HTTPS addresses', () => {
  assert.throws(() => safeHttpsUrl('http://example.test/setup.exe'), /HTTPS/)
  assert.equal(safeHttpsUrl('https://example.test/setup.exe'), 'https://example.test/setup.exe')
})
