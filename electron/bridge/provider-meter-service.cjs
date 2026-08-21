const { readFile, readdir } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')

const METER_SCHEMA_VERSION = 1
const DEFAULT_CACHE_MS = 60 * 1000
const DEFAULT_STALE_MS = 5 * 60 * 1000

// Fixed, officially-owned scoped record the desktop meter is allowed to read
// (read-only) for the Codex WHAM quota path. The official
// `@deepseek-ai/dsh-credentials-local` provider stores it at
// `<scope>/<id>` = `llm-pi-ai/openai-codex` with `kind: grant` and an oauth
// payload. We consume only the non-empty `payload.access` as the meter
// credential and never return, log, refresh, or write back `refresh`.
const CODEX_CREDENTIAL_KEY = 'llm-pi-ai/openai-codex'

async function readYaml(file) {
  try {
    const document = YAML.parseDocument(await readFile(file, 'utf8'))
    if (document.errors.length) throw document.errors[0]
    return document.toJS() || {}
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

function configuredProviders(settings) {
  const rows = settings?.['llm-pi-ai']?.providers || {}
  return Object.entries(rows).map(([id, profile]) => ({
    id,
    name: String(profile?.displayName || profile?.name || id),
    profile: profile && typeof profile === 'object' ? profile : {}
  }))
}

/**
 * Normalize the official `@deepseek-ai/dsh-credentials-local` v1 document into
 * `{ refs, records }`. A version-1 document nests references and machine-owned
 * grant records under `refs:` / `records:`; a pre-1.0 flat document (the shape
 * the current tests and older stores still write) is itself the refs map. Any
 * other shape is treated as empty rather than raising: the meter is a
 * best-effort read and treats an unknown or malformed parsed document shape as
 * empty. YAML/IO failures still surface normally. No values are logged or echoed here.
 */
function credentialDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { refs: {}, records: {} }
  if (Object.hasOwn(value, 'version')) {
    if (value.version !== 1) return { refs: {}, records: {} }
    const { refs, records } = value
    return {
      refs: refs && typeof refs === 'object' && !Array.isArray(refs) ? refs : {},
      records: records && typeof records === 'object' && !Array.isArray(records) ? records : {}
    }
  }
  // A nested document without its schema version is ambiguous and must not be
  // reinterpreted as the old flat ref map.
  if (Object.hasOwn(value, 'refs') || Object.hasOwn(value, 'records')) return { refs: {}, records: {} }
  return { refs: value, records: {} }
}

function credentialFor(provider, credentials, environment) {
  const reference = String(provider.profile?.apiKeyEnv || '').trim()
  if (!reference) return null
  const refs = credentialDocument(credentials).refs
  const value = environment[reference] ?? refs[reference]
  return typeof value === 'string' && value.trim() ? { reference, value: value.trim() } : { reference, value: '' }
}

/**
 * Read-only, scoped extraction of the Codex OAuth grant. Only the exact
 * `llm-pi-ai/openai-codex` record with `kind: grant` and an `oauth` payload
 * whose `access` is a non-empty string is admitted; any other scope, provider,
 * kind, payload type, or an empty/missing access is ignored (returns null).
 * The matching non-empty `access` string is returned as the meter credential
 * value; `refresh`, `expires`, and every other payload field are never read
 * into the returned credential.
 */
function grantCredentialValueFor(credentials) {
  const record = credentialDocument(credentials).records?.[CODEX_CREDENTIAL_KEY]
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  if (record.kind !== 'grant') return null
  const payload = record.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  if (payload.type !== 'oauth') return null
  const access = typeof payload.access === 'string' ? payload.access.trim() : ''
  return access || null
}

/**
 * The meter credential for one provider. For Codex the official OAuth grant
 * takes priority over `apiKeyEnv` so the WHAM OAuth path runs with the
 * already-logged-in credential; for every other provider the api-key
 * reference path is unchanged.
 */
function meterCredentialFor(provider, credentials, environment) {
  if (provider.id === 'openai-codex') {
    const grant = grantCredentialValueFor(credentials)
    if (grant) return { reference: CODEX_CREDENTIAL_KEY, source: 'grant', value: grant }
  }
  return credentialFor(provider, credentials, environment)
}

function unavailableSnapshot(provider, status, message, adapterId = null) {
  return {
    schemaVersion: METER_SCHEMA_VERSION,
    provider: { id: provider.id, name: provider.name },
    adapterId,
    status,
    observedAt: new Date().toISOString(),
    stale: false,
    message,
    meters: []
  }
}

function normalizedSnapshot(provider, adapter, result, now) {
  const meters = Array.isArray(result?.meters) ? result.meters.filter(row => row && typeof row.kind === 'string') : []
  return {
    schemaVersion: METER_SCHEMA_VERSION,
    provider: { id: provider.id, name: provider.name },
    adapterId: adapter.id,
    status: result?.status || (meters.length ? 'ready' : 'unavailable'),
    observedAt: result?.observedAt || new Date(now).toISOString(),
    stale: false,
    message: String(result?.message || ''),
    action: safeAction(result?.action),
    meters
  }
}

function safeAction(action) {
  if (!action?.url || !action?.label) return null
  try {
    const url = new URL(action.url)
    if (url.protocol !== 'https:') return null
    return { label: String(action.label), url: url.toString() }
  } catch {
    return null
  }
}

function publicFailure(error) {
  if (error?.code === 'METER_AUTH_REQUIRED') return { status: 'auth-required', message: error.publicMessage || '缺少账户凭据。' }
  if (error?.code === 'METER_UNAVAILABLE') return { status: 'unavailable', message: error.publicMessage || '暂时无法读取额度。' }
  return { status: 'error', message: '额度刷新失败，请稍后重试。' }
}

class ProviderMeterRegistry {
  constructor({ adapters = [], cacheMs = DEFAULT_CACHE_MS, staleMs = DEFAULT_STALE_MS, environment = process.env, now = Date.now } = {}) {
    this.adapters = []
    this.cache = new Map()
    this.inFlight = new Map()
    this.cacheMs = cacheMs
    this.staleMs = staleMs
    this.environment = environment
    this.now = now
    for (const adapter of adapters) this.register(adapter)
  }

  register(adapter) {
    if (!adapter?.id || typeof adapter.supports !== 'function' || typeof adapter.refresh !== 'function') {
      throw new TypeError('额度适配器必须提供 id、supports() 和 refresh()。')
    }
    if (this.adapters.some(row => row.id === adapter.id)) throw new Error(`额度适配器重复：${adapter.id}`)
    this.adapters.push(adapter)
    return this
  }

  adapterFor(provider) {
    return this.adapters.find(adapter => adapter.supports(provider)) || null
  }

  async refreshProvider(provider, context, force) {
    const adapter = this.adapterFor(provider)
    if (!adapter) return unavailableSnapshot(provider, 'unsupported', '该服务商尚未提供额度查询能力。')
    const cached = this.cache.get(provider.id)
    const now = this.now()
    if (!force && cached && now - cached.time < this.cacheMs) return cached.snapshot
    if (this.inFlight.has(provider.id)) return this.inFlight.get(provider.id)

    const request = (async () => {
      try {
        const result = await adapter.refresh({ ...context, provider })
        const snapshot = normalizedSnapshot(provider, adapter, result, this.now())
        this.cache.set(provider.id, { time: this.now(), snapshot })
        return snapshot
      } catch (error) {
        const failure = publicFailure(error)
        if (cached && now - cached.time < this.staleMs && cached.snapshot.status === 'ready') {
          return { ...cached.snapshot, stale: true, message: `${failure.message} 当前显示上次成功结果。` }
        }
        return unavailableSnapshot(provider, failure.status, failure.message, adapter.id)
      } finally {
        this.inFlight.delete(provider.id)
      }
    })()
    this.inFlight.set(provider.id, request)
    return request
  }

  async readAll({ dshHome, force = false, fetchImpl = globalThis.fetch, spawnImpl } = {}) {
    const home = path.resolve(dshHome)
    const [settings, credentials] = await Promise.all([
      readYaml(path.join(home, 'settings.yaml')),
      readYaml(path.join(home, '.credentials.yaml'))
    ])
    const providers = configuredProviders(settings)
    const snapshots = await Promise.all(providers.map(provider => this.refreshProvider(provider, {
      credential: meterCredentialFor(provider, credentials, this.environment),
      secret: name => {
        const refs = credentialDocument(credentials).refs
        const value = this.environment[name] ?? refs[name]
        return typeof value === 'string' ? value.trim() : ''
      },
      fetchImpl,
      spawnImpl
    }, force)))
    return { schemaVersion: METER_SCHEMA_VERSION, refreshedAt: new Date(this.now()).toISOString(), snapshots }
  }
}

async function loadBundledProviderMeterAdapters(directory = path.join(__dirname, 'provider-meter-adapters')) {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.cjs'))
    .map(entry => entry.name)
    .sort()
  return files.map(file => {
    const module = require(path.join(directory, file))
    if (typeof module.createAdapter !== 'function') throw new Error(`额度适配器缺少 createAdapter()：${file}`)
    return module.createAdapter()
  })
}

async function createDefaultProviderMeterRegistry(options = {}) {
  return new ProviderMeterRegistry({ ...options, adapters: await loadBundledProviderMeterAdapters(options.adapterDirectory) })
}

module.exports = {
  METER_SCHEMA_VERSION,
  ProviderMeterRegistry,
  createDefaultProviderMeterRegistry,
  configuredProviders,
  credentialDocument,
  credentialFor,
  grantCredentialValueFor,
  loadBundledProviderMeterAdapters,
  meterCredentialFor,
  safeAction,
  unavailableSnapshot
}
