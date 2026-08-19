const { readFileSync } = require('node:fs')

function validateRelayUrl(value) {
  const url = new URL(String(value || '').trim())
  if (url.protocol !== 'wss:' || (url.port && url.port !== '443') || url.username || url.password || url.hash) throw new Error('Mobile relay URL must be credential-free wss:// on port 443.')
  return url.toString()
}

function loadMobileRelayConfig({ file, env = process.env, allowEnvironmentOverride = false } = {}) {
  let source = {}
  try { source = JSON.parse(readFileSync(file, 'utf8')) }
  catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`Unable to read mobile relay config: ${error.message}`)
  }
  const override = allowEnvironmentOverride ? String(env.HARNESS_MOBILE_RELAY_URL || '').trim() : ''
  const enabled = override ? true : source.enabled === true
  const relayUrl = override || String(source.relayUrl || '').trim()
  if (!enabled) return Object.freeze({ enabled: false, relayUrl: '' })
  if (!relayUrl) throw new Error('Enabled mobile relay config is missing relayUrl.')
  return Object.freeze({ enabled: true, relayUrl: validateRelayUrl(relayUrl) })
}

module.exports = { loadMobileRelayConfig, validateRelayUrl }
