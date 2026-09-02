const assert = require('node:assert/strict')
const { createHash, randomBytes } = require('node:crypto')
const { mkdtempSync, rmSync } = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { app, session } = require('electron')

const profileRoot = mkdtempSync(path.join(os.tmpdir(), 'hd-runtime-auth-electron-'))
app.setPath('userData', path.join(profileRoot, 'user-data'))
app.commandLine.appendSwitch('disable-gpu')

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()))
}

function cookieNameFor(origin) {
  return `dsh-auth-${createHash('sha256').update(new URL(origin).host).digest('base64url')}`
}

async function run() {
  const launchToken = randomBytes(24).toString('base64url')
  const cookieValue = `v1.${randomBytes(24).toString('base64url')}.${randomBytes(24).toString('base64url')}`
  const requests = []
  let origin = ''
  let cookieName = ''

  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, cookie: request.headers.cookie || '' })
    const target = new URL(request.url, origin)
    if (target.pathname === '/' && target.searchParams.get('token') === launchToken) {
      response.writeHead(303, {
        location: '/',
        'set-cookie': `${cookieName}=${cookieValue}; Path=/; HttpOnly; SameSite=Strict; Max-Age=300`
      })
      response.end()
      return
    }
    if (target.pathname === '/' && request.headers.cookie?.split(/;\s*/u).includes(`${cookieName}=${cookieValue}`)) {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('authenticated')
      return
    }
    response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('unauthorized')
  })

  const port = await listen(server)
  origin = `http://127.0.0.1:${port}`
  cookieName = cookieNameFor(origin)
  const launchUrl = `${origin}/?token=${encodeURIComponent(launchToken)}`
  const runtimeSession = session.fromPartition('persist:harness', { cache: true })
  const isolatedSession = session.fromPartition(`persist:harness-auth-control-${process.pid}`, { cache: true })

  try {
    await Promise.all([
      runtimeSession.clearStorageData(),
      isolatedSession.clearStorageData()
    ])

    const proxy = await runtimeSession.resolveProxy(origin)
    const exchange = await runtimeSession.fetch(launchUrl, {
      cache: 'no-store',
      credentials: 'include',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    })
    assert.equal(exchange.status, 200, 'the final response after the 303 launch exchange must be authenticated')
    assert.equal(await exchange.text(), 'authenticated')

    const cookies = await runtimeSession.cookies.get({ url: `${origin}/`, name: cookieName })
    assert.equal(cookies.length, 1, 'the auth cookie must be persisted in persist:harness')
    assert.equal(cookies[0].name, cookieName)
    assert.equal(cookies[0].value, cookieValue)
    assert.equal(cookies[0].httpOnly, true)
    assert.equal(cookies[0].path, '/')

    const probe = await runtimeSession.fetch(`${origin}/`, {
      cache: 'no-store',
      credentials: 'include',
      redirect: 'manual'
    })
    assert.equal(probe.status, 200, 'the clean root probe must reuse the cookie from persist:harness')
    assert.equal(await probe.text(), 'authenticated')

    const isolatedCookies = await isolatedSession.cookies.get({ url: `${origin}/`, name: cookieName })
    assert.equal(isolatedCookies.length, 0, 'an unrelated partition must not receive the runtime auth cookie')
    const isolatedProbe = await isolatedSession.fetch(`${origin}/`, {
      cache: 'no-store',
      credentials: 'include',
      redirect: 'manual'
    })
    assert.equal(isolatedProbe.status, 401, 'an unrelated partition must remain unauthenticated')

    assert.deepEqual(requests.slice(0, 2).map(item => ({ url: item.url, cookie: item.cookie })), [
      { url: `/?token=${encodeURIComponent(launchToken)}`, cookie: '' },
      { url: '/', cookie: `${cookieName}=${cookieValue}` }
    ], 'Electron must accept Set-Cookie on the 303 before following Location: /')
    assert.equal(requests[2]?.cookie, `${cookieName}=${cookieValue}`, 'the explicit clean probe must send the persisted cookie')
    assert.equal(requests[3]?.cookie, '', 'the control partition must not leak the cookie')

    process.stdout.write(`RUNTIME_SESSION_AUTH_ELECTRON_QA ${JSON.stringify({
      ok: true,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      partition: 'persist:harness',
      proxy,
      exchangeStatus: exchange.status,
      cookieCount: cookies.length,
      probeStatus: probe.status,
      isolatedProbeStatus: isolatedProbe.status,
      requests: requests.map(item => ({ url: item.url, hasCookie: Boolean(item.cookie) }))
    })}\n`)
  } finally {
    await Promise.all([
      runtimeSession.clearStorageData(),
      isolatedSession.clearStorageData()
    ]).catch(() => {})
    await close(server)
  }
}

app.whenReady()
  .then(run)
  .then(() => app.exit(0))
  .catch(error => {
    process.stderr.write(`RUNTIME_SESSION_AUTH_ELECTRON_QA_FAILED ${error?.stack || error}\n`)
    app.exit(1)
  })
  .finally(() => {
    try { rmSync(profileRoot, { recursive: true, force: true }) } catch {}
  })
