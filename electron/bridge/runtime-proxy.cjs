const LOCAL_BYPASS = Object.freeze(['localhost', '127.0.0.1', '::1'])

function valueOf(env, upper, lower) {
  const value = env[upper] || env[lower]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function normalizeProxyUrl(value) {
  if (!value) return ''
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`
}

function proxyFromElectronRules(rules) {
  for (const entry of String(rules || '').split(';')) {
    const directive = entry.trim()
    if (!directive || /^DIRECT$/i.test(directive)) continue
    const match = /^(?:PROXY|HTTP|HTTPS)\s+(.+)$/i.exec(directive)
    if (match) return normalizeProxyUrl(match[1].trim())
  }
  return ''
}

function mergeNoProxy(value) {
  const entries = String(value || '').split(',').map(entry => entry.trim()).filter(Boolean)
  const normalized = new Set(entries.map(entry => entry.toLowerCase()))
  for (const local of LOCAL_BYPASS) {
    if (!normalized.has(local)) entries.push(local)
  }
  return entries.join(',')
}

function hasExplicitProxy(env) {
  return Boolean(valueOf(env, 'HTTP_PROXY', 'http_proxy') || valueOf(env, 'HTTPS_PROXY', 'https_proxy'))
}

function buildRuntimeProxyEnv(baseEnv = {}, electronRules = '') {
  const explicitHttp = valueOf(baseEnv, 'HTTP_PROXY', 'http_proxy')
  const explicitHttps = valueOf(baseEnv, 'HTTPS_PROXY', 'https_proxy')
  const systemProxy = proxyFromElectronRules(electronRules)
  const httpProxy = normalizeProxyUrl(explicitHttp || explicitHttps || systemProxy)
  const httpsProxy = normalizeProxyUrl(explicitHttps || explicitHttp || systemProxy)
  const noProxy = valueOf(baseEnv, 'NO_PROXY', 'no_proxy')
  const result = {
    NODE_USE_ENV_PROXY: '1',
    NO_PROXY: mergeNoProxy(noProxy)
  }
  if (httpProxy) result.HTTP_PROXY = httpProxy
  if (httpsProxy) result.HTTPS_PROXY = httpsProxy
  return result
}

module.exports = { buildRuntimeProxyEnv, hasExplicitProxy, proxyFromElectronRules }
