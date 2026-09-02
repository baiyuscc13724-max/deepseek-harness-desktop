const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const test = require('node:test')

const {
  exchangeRuntimeLaunchToken,
  probeAuthenticatedRuntimeSession,
  readRuntimeAuthCookie,
  requireRuntimeAuthCookie,
  runtimeAuthCookieHeaderFromSetCookie,
  runtimeAuthCookieName,
  runtimeLoopbackOrigin,
  runtimeSessionFetch,
  runtimeWebSocketOptions,
  validatedRuntimeAuthCookieHeader,
  validRuntimeAuthCookie
} = require('../electron/bridge/runtime-session-auth.cjs')

const ORIGIN = 'http://127.0.0.1:43126'
const COOKIE_NAME = `dsh-auth-${createHash('sha256').update('127.0.0.1:43126').digest('base64url')}`
const COOKIE_VALUE = 'v1.c2lnbmVkLWJvZHk.c2lnbmF0dXJl'

test('runtime authentication derives an exact loopback origin and official per-authority cookie name', () => {
  assert.equal(runtimeLoopbackOrigin('ws://localhost:43126/api/remote.mux'), ORIGIN)
  assert.equal(runtimeLoopbackOrigin(`${ORIGIN}/?token=secret`), ORIGIN)
  assert.equal(runtimeAuthCookieName(ORIGIN), COOKIE_NAME)
  assert.equal(runtimeAuthCookieHeaderFromSetCookie(`${COOKIE_NAME}=${COOKIE_VALUE}; Path=/; HttpOnly; SameSite=Strict`, ORIGIN), `${COOKIE_NAME}=${COOKIE_VALUE}`)
  assert.equal(runtimeAuthCookieHeaderFromSetCookie(`dsh-auth-wrong=${COOKIE_VALUE}; Path=/; HttpOnly`, ORIGIN), '')
  for (const rejected of ['https://127.0.0.1:43126', 'http://example.com:43126', 'http://127.0.0.1', 'http://user@127.0.0.1:43126']) {
    assert.equal(runtimeLoopbackOrigin(rejected), null)
  }
})

test('authenticated reuse probe requires the current Electron cookie and sends it through the persistent session', async () => {
  const calls = []
  const runtimeSession = {
    cookies: {
      get: async () => [{ name: COOKIE_NAME, value: COOKIE_VALUE, expirationDate: Date.now() / 1000 + 60 }]
    },
    fetch: async (url, options) => {
      calls.push({ url, options })
      return { status: 200 }
    }
  }
  assert.equal(await probeAuthenticatedRuntimeSession(runtimeSession, ORIGIN), true)
  assert.deepEqual(calls, [{
    url: `${ORIGIN}/`,
    options: { cache: 'no-store', redirect: 'manual', credentials: 'include' }
  }])

  runtimeSession.fetch = async (url, options) => { calls.push({ url, options }); return { status: 303 } }
  assert.equal(await probeAuthenticatedRuntimeSession(runtimeSession, ORIGIN), false, 'a clean authenticated root must render instead of redirecting elsewhere')

  runtimeSession.cookies.get = async () => []
  assert.equal(await probeAuthenticatedRuntimeSession(runtimeSession, ORIGIN), false)
  assert.equal(calls.length, 2, 'a missing or expired cookie must fail before the clean root is probed')
  assert.equal(await probeAuthenticatedRuntimeSession(runtimeSession, 'http://example.com:43126'), false)
})

test('runtime authentication reads only the non-expired official cookie from the Electron partition', async () => {
  const queries = []
  const cookieStore = {
    get: async query => {
      queries.push(query)
      return [
        { name: COOKIE_NAME, value: COOKIE_VALUE, expirationDate: 1_900_000_000 },
        { name: 'dsh-auth-forged', value: COOKIE_VALUE, expirationDate: 1_900_000_000 }
      ]
    }
  }
  const cookie = await readRuntimeAuthCookie(cookieStore, ORIGIN, { now: 1_800_000_000_000 })
  assert.deepEqual(queries, [{ url: `${ORIGIN}/`, name: COOKIE_NAME }])
  assert.deepEqual(cookie, {
    origin: ORIGIN,
    name: COOKIE_NAME,
    value: COOKIE_VALUE,
    header: `${COOKIE_NAME}=${COOKIE_VALUE}`,
    expiresAt: 1_900_000_000_000
  })
  assert.equal(validRuntimeAuthCookie({ name: COOKIE_NAME, value: COOKIE_VALUE, expirationDate: 1_700_000_000 }, COOKIE_NAME, 1_800_000_000_000), false)
  assert.equal(validRuntimeAuthCookie({ name: COOKIE_NAME, value: 'not-signed' }, COOKIE_NAME), false)
})

test('runtime cookie resolution fails closed after clean reuse loses its cookie and refreshes token launches once', async () => {
  let cookies = []
  let refreshes = 0
  const cookieStore = { get: async () => cookies }
  await assert.rejects(requireRuntimeAuthCookie(cookieStore, ORIGIN), /cookie is unavailable/u)
  assert.equal(refreshes, 0, 'a clean reused runtime has no launch authority to manufacture a cookie')

  const resolved = await requireRuntimeAuthCookie(cookieStore, `${ORIGIN}/?token=launch-token`, {
    refresh: async () => {
      refreshes += 1
      cookies = [{ name: COOKIE_NAME, value: COOKIE_VALUE, expirationDate: Date.now() / 1000 + 60 }]
    }
  })
  assert.equal(resolved.header, `${COOKIE_NAME}=${COOKIE_VALUE}`)
  assert.equal(refreshes, 1)
})

test('runtime launch exchange follows the official redirect in one Electron session and requires its cookie', async () => {
  const calls = []
  let cookies = []
  let installCookie = true
  const runtimeSession = {
    cookies: {
      get: async () => cookies
    },
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (installCookie) cookies = [{ name: COOKIE_NAME, value: COOKIE_VALUE, expirationDate: Date.now() / 1000 + 60 }]
      return { status: 200 }
    }
  }
  const launchUrl = `${ORIGIN}/?token=launch-token`
  assert.equal(await exchangeRuntimeLaunchToken(runtimeSession, launchUrl), true)
  assert.equal(calls[0].url, launchUrl)
  assert.deepEqual(calls[0].options, {
    cache: 'no-store',
    credentials: 'include',
    redirect: 'follow',
    referrerPolicy: 'no-referrer'
  })

  cookies = []
  installCookie = false
  assert.equal(await exchangeRuntimeLaunchToken(runtimeSession, launchUrl), false)
  assert.equal(await exchangeRuntimeLaunchToken(runtimeSession, ORIGIN), true)
  assert.equal(await exchangeRuntimeLaunchToken({}, ORIGIN), true)
  assert.equal(calls.length, 2, 'clean URLs do not manufacture a token exchange request')
})

test('runtime launch exchange rejects non-2xx finals, missing cookies, forged names, and expired cookies', async () => {
  let status = 401
  let cookies = [{ name: COOKIE_NAME, value: COOKIE_VALUE, expirationDate: Date.now() / 1000 + 60 }]
  const runtimeSession = {
    cookies: { get: async () => cookies },
    fetch: async () => ({ status })
  }
  const launchUrl = `${ORIGIN}/?token=launch-token`
  assert.equal(await exchangeRuntimeLaunchToken(runtimeSession, launchUrl), false)

  status = 200
  cookies = []
  assert.equal(await exchangeRuntimeLaunchToken(runtimeSession, launchUrl), false)

  cookies = [{ name: 'dsh-auth-forged', value: COOKIE_VALUE, expirationDate: Date.now() / 1000 + 60 }]
  assert.equal(await exchangeRuntimeLaunchToken(runtimeSession, launchUrl), false)

  cookies = [{ name: COOKIE_NAME, value: COOKIE_VALUE, expirationDate: Date.now() / 1000 - 1 }]
  assert.equal(await exchangeRuntimeLaunchToken(runtimeSession, launchUrl), false)

  assert.equal(await exchangeRuntimeLaunchToken(runtimeSession, 'http://example.com:43126/?token=launch-token'), false)
})

test('runtime launch exchange surfaces Electron redirect failures and never switches HTTP stacks', async () => {
  let electronCalls = 0
  let nodeCalls = 0
  const runtimeSession = {
    cookies: { get: async () => [] },
    fetch: async () => {
      electronCalls += 1
      throw new Error('Redirect was cancelled')
    }
  }
  await assert.rejects(exchangeRuntimeLaunchToken(runtimeSession, `${ORIGIN}/?token=launch-token`, {
    fetchImpl: async () => { nodeCalls += 1 }
  }), /Redirect was cancelled/u)
  assert.equal(electronCalls, 1)
  assert.equal(nodeCalls, 0)
})

test('runtime session fetch and websocket options remain loopback-scoped and cookie-controlled', async () => {
  const calls = []
  const runtimeSession = {
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true } }
  }
  await runtimeSessionFetch(runtimeSession, `${ORIGIN}/api/session/list`, { method: 'POST', credentials: 'omit' })
  assert.deepEqual(calls, [{ url: `${ORIGIN}/api/session/list`, options: { method: 'POST', credentials: 'include' } }])
  await assert.rejects(runtimeSessionFetch(runtimeSession, 'http://example.com/api/session/list'), /unavailable/)
  const header = `${COOKIE_NAME}=${COOKIE_VALUE}`
  assert.equal(validatedRuntimeAuthCookieHeader(header), header)
  assert.deepEqual(runtimeWebSocketOptions(header), { headers: { Cookie: header } })
  assert.deepEqual(runtimeWebSocketOptions(''), {})
  for (const rejected of [`${COOKIE_NAME}=forged`, `other=${COOKIE_VALUE}`, `${header}; extra=yes`]) {
    assert.throws(() => runtimeWebSocketOptions(rejected), /invalid/)
  }
})
