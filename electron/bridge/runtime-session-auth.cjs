'use strict'

const { createHash } = require('node:crypto')
const { normalizeRuntimeWebUrl } = require('./runtime-web-url.cjs')

const AUTH_COOKIE_PREFIX = 'dsh-auth-'
const AUTH_COOKIE_VALUE_PATTERN = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u
const AUTH_COOKIE_HEADER_PATTERN = /^dsh-auth-[A-Za-z0-9_-]+=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u

function runtimeLoopbackOrigin(value) {
  let target
  try { target = new URL(String(value || '')) }
  catch { return null }
  if (target.protocol === 'ws:') target.protocol = 'http:'
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname.toLowerCase())) return null
  const port = Number(target.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || target.username || target.password) return null
  target.hostname = '127.0.0.1'
  return target.origin
}

function runtimeAuthCookieName(value) {
  const origin = runtimeLoopbackOrigin(value)
  if (!origin) return null
  const authority = new URL(origin).host
  return `${AUTH_COOKIE_PREFIX}${createHash('sha256').update(authority).digest('base64url')}`
}

function runtimeAuthCookieHeaderFromSetCookie(value, runtimeUrl) {
  const expectedName = runtimeAuthCookieName(runtimeUrl)
  if (!expectedName || typeof value !== 'string') return ''
  const first = value.split(';', 1)[0]?.trim() || ''
  const separator = first.indexOf('=')
  if (separator < 1 || first.slice(0, separator).trim() !== expectedName) return ''
  try { return validatedRuntimeAuthCookieHeader(first) }
  catch { return '' }
}

function validRuntimeAuthCookie(cookie, expectedName, now = Date.now()) {
  if (!cookie || cookie.name !== expectedName || !AUTH_COOKIE_VALUE_PATTERN.test(String(cookie.value || ''))) return false
  if (cookie.expirationDate === undefined) return true
  return Number.isFinite(cookie.expirationDate) && cookie.expirationDate > now / 1000
}

async function readRuntimeAuthCookie(cookieStore, value, { now = Date.now() } = {}) {
  const origin = runtimeLoopbackOrigin(value)
  const name = runtimeAuthCookieName(value)
  if (!origin || !name || typeof cookieStore?.get !== 'function') return null
  const cookies = await cookieStore.get({ url: `${origin}/`, name })
  const cookie = cookies.find(candidate => validRuntimeAuthCookie(candidate, name, now))
  if (!cookie) return null
  return {
    origin,
    name,
    value: cookie.value,
    header: `${name}=${cookie.value}`,
    expiresAt: cookie.expirationDate === undefined ? Number.POSITIVE_INFINITY : cookie.expirationDate * 1000
  }
}

async function requireRuntimeAuthCookie(cookieStore, value, { refresh } = {}) {
  let cookie = await readRuntimeAuthCookie(cookieStore, value)
  if (!cookie && typeof refresh === 'function') {
    await refresh()
    cookie = await readRuntimeAuthCookie(cookieStore, value)
  }
  if (!cookie) throw new Error('Harness runtime browser authentication cookie is unavailable.')
  return cookie
}

async function exchangeRuntimeLaunchToken(runtimeSession, value, { signal } = {}) {
  const launchUrl = normalizeRuntimeWebUrl(value)
  if (!launchUrl) return false
  const target = new URL(launchUrl)
  if (!target.searchParams.has('token')) return true
  if (typeof runtimeSession?.fetch !== 'function') return false
  const response = await runtimeSession.fetch(launchUrl, {
    cache: 'no-store',
    credentials: 'include',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
    ...(signal ? { signal } : {})
  })
  if (!Number.isInteger(response?.status) || response.status < 200 || response.status >= 300) return false
  return Boolean(await readRuntimeAuthCookie(runtimeSession.cookies, launchUrl))
}

async function runtimeSessionFetch(runtimeSession, value, options = {}) {
  const target = new URL(String(value || ''))
  if (!runtimeLoopbackOrigin(target) || typeof runtimeSession?.fetch !== 'function') throw new Error('Harness runtime request target is unavailable.')
  return runtimeSession.fetch(target.toString(), { ...options, credentials: 'include' })
}

async function probeAuthenticatedRuntimeSession(runtimeSession, value, { signal } = {}) {
  const origin = runtimeLoopbackOrigin(value)
  if (!origin) return false
  const cookie = await readRuntimeAuthCookie(runtimeSession?.cookies, origin)
  if (!cookie) return false
  try {
    const response = await runtimeSessionFetch(runtimeSession, `${origin}/`, {
      cache: 'no-store',
      redirect: 'manual',
      ...(signal ? { signal } : {})
    })
    return Number.isInteger(response.status) && response.status >= 200 && response.status < 300
  } catch {
    return false
  }
}

function validatedRuntimeAuthCookieHeader(cookieHeader) {
  const header = String(cookieHeader || '')
  if (!header) return ''
  if (!AUTH_COOKIE_HEADER_PATTERN.test(header)) throw new Error('Harness runtime authentication cookie is invalid.')
  return header
}

function runtimeWebSocketOptions(cookieHeader) {
  const header = validatedRuntimeAuthCookieHeader(cookieHeader)
  return header ? { headers: { Cookie: header } } : {}
}

module.exports = {
  AUTH_COOKIE_PREFIX,
  AUTH_COOKIE_HEADER_PATTERN,
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
}
