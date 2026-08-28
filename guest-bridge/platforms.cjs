'use strict'

const { fail } = require('./errors.cjs')

const UI_BACKENDS = Object.freeze({
  win32: Object.freeze({ name: 'Windows UI Automation', authority: 'Windows accessibility/UI Automation policy' }),
  linux: Object.freeze({ name: 'AT-SPI', authority: 'desktop session accessibility policy' }),
  darwin: Object.freeze({ name: 'macOS Accessibility', authority: 'macOS TCC Accessibility consent' })
})

function unavailable(platform, code, reason, extra = {}) {
  const backend = UI_BACKENDS[platform]
  return Object.freeze({
    platform,
    backend: backend ? backend.name : null,
    authority: backend ? backend.authority : null,
    available: false,
    degraded: true,
    code,
    reason,
    ...extra
  })
}

function detectUiBackend(options = {}) {
  const platform = options.platform || process.platform
  const env = options.env || process.env
  const adapterAvailable = options.adapterAvailable === true

  if (!UI_BACKENDS[platform]) return unavailable(platform, 'platform-unsupported', 'No structured accessibility backend is defined for this platform')

  if (platform === 'win32') {
    if (!adapterAvailable) return unavailable(platform, 'adapter-missing', 'A separately installed lightweight UI Automation adapter is required')
    if (options.accessibilityAuthorized !== true) return unavailable(platform, 'permission-required', 'Windows accessibility authorization has not been established')
  }

  if (platform === 'darwin') {
    if (!adapterAvailable) return unavailable(platform, 'adapter-missing', 'A separately installed lightweight macOS accessibility adapter is required')
    if (options.accessibilityAuthorized !== true) return unavailable(platform, 'permission-required', 'Accessibility consent must be granted by the user in System Settings')
  }

  if (platform === 'linux') {
    const sessionType = String(env.XDG_SESSION_TYPE || '').toLowerCase()
    if (sessionType === 'wayland' && options.portalAuthorized !== true) {
      return unavailable(platform, 'portal-required', 'Wayland session requires a user-authorized desktop portal; X11 injection fallback is forbidden', { sessionType })
    }
    if (!adapterAvailable) return unavailable(platform, 'adapter-missing', 'A separately installed lightweight AT-SPI adapter is required', { sessionType: sessionType || null })
    if (!env.AT_SPI_BUS_ADDRESS && options.accessibilityAuthorized !== true) {
      return unavailable(platform, 'permission-required', 'AT-SPI accessibility availability has not been established', { sessionType: sessionType || null })
    }
  }

  return Object.freeze({
    platform,
    backend: UI_BACKENDS[platform].name,
    authority: UI_BACKENDS[platform].authority,
    available: true,
    degraded: false,
    code: 'available',
    reason: 'A system-authorized structured accessibility adapter is available'
  })
}

function requireUiBackend(status) {
  if (!status || status.available !== true) fail(status?.code || 'ui-unavailable', status?.reason || 'Structured UI backend is unavailable')
  return status
}

module.exports = { UI_BACKENDS, detectUiBackend, requireUiBackend }
