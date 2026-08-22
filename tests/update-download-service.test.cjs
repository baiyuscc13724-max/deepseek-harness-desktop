const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  DEFAULT_CHECKSUM_TIMEOUT_MS,
  checksumWithFallback,
  downloadWithFallback,
  fetchWithSafeRedirects,
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

function redirectResponse(location) {
  return { ok: false, status: 302, headers: headers({ location }), body: null }
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

test('installer redirects stay manual, HTTPS, source-limited, and bounded before fallback', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'harness-update-redirect-'))
  const destination = path.join(temp, 'setup.exe')
  const good = Buffer.from('verified-installer')
  const expectedHash = createHash('sha256').update(good).digest('hex')
  const calls = []
  try {
    const result = await downloadWithFallback({
      asset: { urls: ['https://github.com/example/setup.exe', 'https://fallback.example/setup.exe'] },
      destination,
      expectedSize: good.length,
      expectedHash,
      maxRedirects: 1,
      fetchImpl: async (url, options) => {
        calls.push([url, options.redirect])
        if (url === 'https://github.com/example/setup.exe') return redirectResponse('https://release-assets.githubusercontent.com/example/setup.exe')
        if (url.includes('release-assets.githubusercontent.com')) return redirectResponse('/example/again.exe')
        return binaryResponse(good)
      }
    })
    assert.equal(result.source, 'https://fallback.example/setup.exe')
    assert.deepEqual(calls.map(([, redirect]) => redirect), ['manual', 'manual', 'manual'])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('checksum redirects reject HTTPS downgrade and unapproved host migration before fallback', async () => {
  const fileName = 'Harness-Desktop-1.2.3-win-x64.exe'
  const digest = 'c'.repeat(64)
  const calls = []
  const result = await checksumWithFallback({
    asset: { urls: ['https://cnb.cool/example/SHA256SUMS.txt', 'https://github.example/SHA256SUMS.txt'] },
    fileName,
    parseChecksum: parseChecksumFile,
    fetchImpl: async (url, options) => {
      calls.push([url, options.redirect])
      if (url.includes('cnb.cool')) return redirectResponse('http://cnb.cool/example/SHA256SUMS.txt')
      return { ok: true, status: 200, headers: headers({ 'content-type': 'text/plain' }), text: async () => `${digest}  ${fileName}\n` }
    }
  })
  assert.equal(result.hash, digest)
  assert.equal(result.source, 'https://github.example/SHA256SUMS.txt')
  assert.deepEqual(calls.map(([, redirect]) => redirect), ['manual', 'manual'])
})

test('Electron cancelled manual redirects retry with follow only for a trusted final host', async () => {
  const calls = []
  const response = await fetchWithSafeRedirects('https://cnb.cool/example/SHA256SUMS.txt', {
    allowedHosts: ['cnb.cool'],
    fetchImpl: async (url, options) => {
      calls.push([url, options.redirect])
      if (options.redirect === 'manual') throw new Error('Redirect was cancelled')
      return { ok: true, status: 200, url: 'https://assets.cnb.cool/example/SHA256SUMS.txt', headers: headers() }
    }
  })
  assert.equal(response.status, 200)
  assert.deepEqual(calls.map(([, redirect]) => redirect), ['manual', 'follow'])
})

test('Electron redirect fallback still rejects an untrusted final host', async () => {
  await assert.rejects(fetchWithSafeRedirects('https://cnb.cool/example/SHA256SUMS.txt', {
    allowedHosts: ['cnb.cool'],
    fetchImpl: async (url, options) => {
      if (options.redirect === 'manual') throw new Error('Redirect was cancelled')
      return { ok: true, status: 200, url: 'https://evil.example/SHA256SUMS.txt', headers: headers() }
    }
  }), /拒绝跨来源重定向/)
})

test('update files require public HTTPS addresses and checksum requests allow slow public mirrors', () => {
  assert.equal(DEFAULT_CHECKSUM_TIMEOUT_MS, 30_000)
  assert.throws(() => safeHttpsUrl('http://example.test/setup.exe'), /HTTPS/)
  assert.throws(() => safeHttpsUrl('https://user:pass@example.test/setup.exe'), /凭据/)
  assert.throws(() => safeHttpsUrl('https://example.test:8443/setup.exe'), /端口/)
  assert.equal(safeHttpsUrl('https://example.test/setup.exe'), 'https://example.test/setup.exe')
})
