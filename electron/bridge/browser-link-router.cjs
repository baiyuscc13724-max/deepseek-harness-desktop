'use strict'

// Pure link-routing policy. This module classifies a structured request only; it
// deliberately performs no I/O and never opens either browser.

const { URL } = require('node:url')

const MAX_TARGET_LENGTH = 8192

const DECISIONS = Object.freeze({
  EMBEDDED: 'embedded-browser',
  SYSTEM: 'system-browser',
  REJECT: 'reject'
})

const SOURCES = new Set(['user', 'model', 'app', 'developer'])
const INTENTS = new Set([
  'navigation', 'document', 'search', 'repository', 'oauth', 'gcm', 'sso',
  'external-app', 'download', 'installer', 'development'
])
const USER_CHOICES = new Set(['default', 'embedded', 'system'])
const EMBEDDED_INTENTS = new Set(['navigation', 'document', 'search', 'repository'])
const SYSTEM_INTENTS = new Set(['oauth', 'gcm', 'sso', 'external-app', 'download', 'installer'])
const EXTERNAL_SCHEMES = new Set([
  'mailto:', 'tel:', 'sms:', 'vscode:', 'vscode-insiders:', 'github-desktop:',
  'ms-windows-store:', 'itms-apps:'
])
const DANGEROUS_SCHEMES = new Set([
  'about:', 'blob:', 'chrome:', 'chrome-extension:', 'data:', 'devtools:',
  'file:', 'ftp:', 'gopher:', 'javascript:', 'moz-extension:', 'shell:',
  'vbscript:', 'ws:', 'wss:'
])
const INSTALLER_EXTENSION = /\.(?:appimage|deb|dmg|exe|msi|msix|msixbundle|pkg|rpm)(?:$|[?#])/i
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/
const BAD_PERCENT = /%(?![0-9a-fA-F]{2})/

function result(target, decision, reason) {
  return { target, decision, reason }
}

function reject(reason) {
  return result(null, DECISIONS.REJECT, reason)
}

function sanitizeTarget(value) {
  if (typeof value !== 'string' || !value.trim()) return { error: 'invalid-target' }
  if (value.length > MAX_TARGET_LENGTH) return { error: 'target-too-long' }
  if (CONTROL_CHAR.test(value) || BAD_PERCENT.test(value)) return { error: 'malformed-target' }

  let url
  try {
    url = new URL(value)
  } catch {
    return { error: 'malformed-target' }
  }

  const protocol = url.protocol.toLowerCase()
  if (url.username || url.password) return { error: 'credential-url' }
  if (DANGEROUS_SCHEMES.has(protocol)) return { error: 'dangerous-protocol' }

  if (protocol === 'http:' || protocol === 'https:') {
    if (!url.hostname) return { error: 'malformed-target' }
    if (url.href.length > MAX_TARGET_LENGTH) return { error: 'target-too-long' }
    return { target: url.href, protocol, hostname: url.hostname.toLowerCase(), external: false }
  }

  if (!EXTERNAL_SCHEMES.has(protocol)) return { error: 'unsupported-protocol' }
  if (url.href.length > MAX_TARGET_LENGTH) return { error: 'target-too-long' }
  return { target: url.href, protocol, hostname: '', external: true }
}

function isLocalhost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' ||
    host === '::1' || host === '0.0.0.0'
}

/**
 * Select a destination for a structured link request.
 *
 * @param {{target:string, source:'user'|'model'|'app'|'developer',
 *   intent:string, userChoice:'default'|'embedded'|'system'}} request
 * @returns {{target:string|null, decision:string, reason:string}}
 */
function routeBrowserLink(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return reject('invalid-request')
  const { target, source, intent, userChoice } = request
  if (!SOURCES.has(source) || !INTENTS.has(intent) || !USER_CHOICES.has(userChoice)) {
    return reject('invalid-routing-context')
  }

  const sanitized = sanitizeTarget(target)
  if (sanitized.error) return reject(sanitized.error)

  // A native protocol is only valid when the caller has explicitly classified
  // it as an external-app handoff. Choice cannot turn an arbitrary link into one.
  if (sanitized.external) {
    if (intent !== 'external-app') return reject('external-protocol-intent-required')
    return result(sanitized.target, DECISIONS.SYSTEM, 'external-application-protocol')
  }

  // Authentication and OS handoffs never enter the isolated browser. This rule
  // takes precedence over an erroneous request for the embedded browser.
  if (SYSTEM_INTENTS.has(intent)) {
    return result(sanitized.target, DECISIONS.SYSTEM, `${intent}-requires-system`)
  }
  if (INSTALLER_EXTENSION.test(sanitized.target)) {
    return result(sanitized.target, DECISIONS.SYSTEM, 'installer-target-requires-system')
  }

  // An explicit user selection is honored only after target safety validation.
  if (userChoice === 'system') {
    return result(sanitized.target, DECISIONS.SYSTEM, 'user-selected-system-browser')
  }

  if (isLocalhost(sanitized.hostname)) {
    const explicitEmbedded = userChoice === 'embedded' && source === 'user'
    const developmentContext = source === 'developer' || intent === 'development'
    if (explicitEmbedded) return result(sanitized.target, DECISIONS.EMBEDDED, 'user-approved-localhost')
    if (developmentContext) return result(sanitized.target, DECISIONS.EMBEDDED, 'development-localhost')
    return result(sanitized.target, DECISIONS.SYSTEM, 'localhost-not-approved-for-embedded')
  }

  if (intent === 'development') {
    return result(sanitized.target, DECISIONS.EMBEDDED, 'development-navigation')
  }
  if (EMBEDDED_INTENTS.has(intent)) {
    const reason = source === 'model' ? 'model-navigation-isolated' : `${intent}-isolated`
    return result(sanitized.target, DECISIONS.EMBEDDED, reason)
  }

  return reject('unsupported-routing-context')
}

module.exports = {
  DECISIONS,
  DANGEROUS_SCHEMES,
  EXTERNAL_SCHEMES,
  INTENTS,
  MAX_TARGET_LENGTH,
  SOURCES,
  USER_CHOICES,
  isLocalhost,
  routeBrowserLink,
  sanitizeTarget
}
