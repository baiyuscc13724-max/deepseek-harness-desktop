'use strict'

const DEFAULT_OUTPUT_LIMIT = 4096
const RUNTIME_URL_PATTERN = /http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}(?:\/\?token=[A-Za-z0-9_-]{1,512})?(?=$|[\s"'<>()[\]{},;.!?])/giu
const RUNTIME_TOKEN_PATTERN = /([?&]token=)[A-Za-z0-9_-]+/giu
const RUNTIME_TOKEN_VALUE_PATTERN = /^[A-Za-z0-9_-]{1,512}$/u

function normalizeRuntimeWebUrl(value) {
  let target
  try { target = new URL(String(value || '')) }
  catch { return null }
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname.toLowerCase())) return null
  const port = Number(target.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return null
  if (target.username || target.password || target.pathname !== '/' || target.hash) return null
  const entries = [...target.searchParams.entries()]
  if (entries.length > 1) return null
  if (entries.length === 1 && (entries[0][0] !== 'token' || !RUNTIME_TOKEN_VALUE_PATTERN.test(entries[0][1]))) return null
  target.hostname = '127.0.0.1'
  return entries.length === 1 ? target.href : target.origin
}

function detectRuntimeWebUrl(text) {
  let detected = null
  for (const match of String(text || '').matchAll(RUNTIME_URL_PATTERN)) {
    const normalized = normalizeRuntimeWebUrl(match[0])
    if (normalized) detected = normalized
  }
  return detected
}

function appendRuntimeWebOutput(previous, chunk, limit = DEFAULT_OUTPUT_LIMIT) {
  const maximum = Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_OUTPUT_LIMIT
  return `${String(previous || '')}${String(chunk || '')}`.slice(-maximum)
}

function safeRuntimeWebUrl(value) {
  const normalized = normalizeRuntimeWebUrl(value)
  if (!normalized) return null
  return new URL(normalized).origin
}

function runtimeSessionWindowUrl(value, sessionId) {
  const origin = safeRuntimeWebUrl(value)
  const id = String(sessionId || '')
  if (!origin || !id || id.length > 256 || id.trim() !== id) return null
  const target = new URL(origin)
  target.searchParams.set('harness-desktop-session', id)
  return target.toString()
}

function redactRuntimeWebAuth(value) {
  return String(value || '').replace(RUNTIME_TOKEN_PATTERN, '$1[redacted]')
}

function isRuntimeWebReadyStatus(statusCode) {
  return Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 400
}

module.exports = {
  DEFAULT_OUTPUT_LIMIT,
  appendRuntimeWebOutput,
  detectRuntimeWebUrl,
  isRuntimeWebReadyStatus,
  normalizeRuntimeWebUrl,
  redactRuntimeWebAuth,
  runtimeSessionWindowUrl,
  safeRuntimeWebUrl
}
