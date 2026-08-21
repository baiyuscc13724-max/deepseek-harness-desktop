import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export const name = 'desktop-mcp-manager'
export const inject = ['tools', 'credentials', 'webServer']
export const CSRF_HEADER = 'x-dsh-mcp-manager'
export const CONFIG_VERSION = 1
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
const FORBIDDEN_HEADERS = new Set(['cookie', 'host', 'content-length', 'connection', 'transfer-encoding'])
const DEFAULT_RECONNECT = Object.freeze({ enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 8 })

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value
}
function text(value, label, max = 1024) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`${label} must be a non-empty string of at most ${max} characters`)
  return value.trim()
}
function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field ${JSON.stringify(key)}`)
}
function validateRefs(value, kind) {
  const input = value === undefined ? {} : record(value, `${kind}Refs`)
  const output = {}
  for (const [key, ref] of Object.entries(input)) {
    if (kind === 'env') {
      if (!ENV_NAME.test(key)) throw new TypeError(`invalid environment name ${JSON.stringify(key)}`)
    } else {
      if (!HEADER_NAME.test(key) || FORBIDDEN_HEADERS.has(key.toLowerCase())) throw new TypeError(`forbidden HTTP header ${JSON.stringify(key)}`)
    }
    if (typeof ref !== 'string' || !CREDENTIAL_REF.test(ref)) throw new TypeError(`credential reference for ${JSON.stringify(key)} is invalid`)
    output[key] = ref
  }
  return output
}
function validateReconnect(value) {
  const input = value === undefined ? DEFAULT_RECONNECT : record(value, 'reconnect')
  exactKeys(input, new Set(['enabled', 'initialDelayMs', 'maxDelayMs', 'maxAttempts']), 'reconnect')
  const output = { ...DEFAULT_RECONNECT, ...input }
  if (typeof output.enabled !== 'boolean') throw new TypeError('reconnect.enabled must be boolean')
  for (const key of ['initialDelayMs', 'maxDelayMs', 'maxAttempts']) if (!Number.isSafeInteger(output[key]) || output[key] < 1) throw new TypeError(`reconnect.${key} must be a positive safe integer`)
  if (output.maxDelayMs < output.initialDelayMs) throw new TypeError('reconnect.maxDelayMs must be at least initialDelayMs')
  return output
}
function validateHttpUrl(raw) {
  const url = new URL(text(raw, 'transport.url', 4096))
  if (url.username || url.password) throw new TypeError('MCP URL must not contain userinfo')
  if (url.hash) throw new TypeError('MCP URL must not contain a fragment')
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new TypeError('MCP URL must use HTTPS; HTTP is allowed only for loopback hosts')
  return url.toString()
}
function validateTransport(value) {
  const input = record(value, 'transport')
  if (input.kind === 'stdio') {
    exactKeys(input, new Set(['kind', 'command', 'args', 'cwd', 'envRefs']), 'stdio transport')
    const command = text(input.command, 'transport.command', 4096)
    if (!isAbsolute(command)) throw new TypeError('stdio command must be an absolute path')
    const args = input.args === undefined ? [] : input.args
    if (!Array.isArray(args) || args.length > 128 || args.some(arg => typeof arg !== 'string' || arg.length > 8192)) throw new TypeError('stdio args must be an array of at most 128 bounded strings')
    const cwd = input.cwd === undefined || input.cwd === '' ? '' : text(input.cwd, 'transport.cwd', 4096)
    if (cwd && !isAbsolute(cwd)) throw new TypeError('stdio cwd must be an absolute path')
    return { kind: 'stdio', command, args: [...args], cwd, envRefs: validateRefs(input.envRefs, 'env') }
  }
  if (input.kind === 'streamable-http') {
    exactKeys(input, new Set(['kind', 'url', 'headerRefs']), 'HTTP transport')
    return { kind: 'streamable-http', url: validateHttpUrl(input.url), headerRefs: validateRefs(input.headerRefs, 'header') }
  }
  throw new TypeError('transport.kind must be stdio or streamable-http')
}
export function validateServer(input, current) {
  const value = record(input, 'server')
  exactKeys(value, new Set(['id', 'serverName', 'label', 'enabled', 'transport', 'toolCallTimeoutMs', 'reconnect']), 'server')
  const id = current?.id ?? text(value.id, 'id', 80)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) throw new TypeError('id is invalid')
  const serverName = text(value.serverName, 'serverName', 32)
  if (!SERVER_NAME.test(serverName)) throw new TypeError('serverName is invalid')
  const timeout = value.toolCallTimeoutMs ?? 60_000
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 3_600_000) throw new TypeError('toolCallTimeoutMs must be between 1000 and 3600000')
  return Object.freeze({ id, serverName, label: text(value.label, 'label', 120), enabled: value.enabled === true, transport: validateTransport(value.transport), toolCallTimeoutMs: timeout, reconnect: validateReconnect(value.reconnect) })
}
function persisted(server, revision) { return { ...server, revision } }
function publicServer(server) {
  const transport = server.transport.kind === 'stdio'
    ? { kind: 'stdio', command: server.transport.command, args: [...server.transport.args], cwd: server.transport.cwd, envRefs: Object.fromEntries(Object.entries(server.transport.envRefs).map(([key, ref]) => [key, { ref, configured: true }])) }
    : { kind: 'streamable-http', url: server.transport.url, headerRefs: Object.fromEntries(Object.entries(server.transport.headerRefs).map(([key, ref]) => [key, { ref, configured: true }])) }
  return { id: server.id, serverName: server.serverName, label: server.label, enabled: server.enabled, transport, toolCallTimeoutMs: server.toolCallTimeoutMs, reconnect: { ...server.reconnect }, revision: server.revision }
}
function safeError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'MCP_START_FAILED'
  return { code, message: 'MCP server could not be started. Check its executable, URL, and credential references.' }
}
async function atomicWrite(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
  } finally { await rm(temp, { force: true }).catch(() => {}) }
}
async function readStore(file) {
  const raw = await readFile(file, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
  if (!raw) return []
  const doc = JSON.parse(raw)
  if (!doc || doc.version !== CONFIG_VERSION || !Array.isArray(doc.servers)) throw new Error('unsupported MCP manager configuration')
  const names = new Set(); const ids = new Set()
  return doc.servers.map(row => {
    if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('invalid MCP server revision')
    const { revision, ...definition } = row
    const server = { ...validateServer(definition), revision }
    if (ids.has(server.id) || names.has(server.serverName.toLowerCase())) throw new Error('duplicate MCP server identity in configuration')
    ids.add(server.id); names.add(server.serverName.toLowerCase()); return server
  })
}
async function resolveCredentialMap(credentials, refs) {
  const output = {}
  for (const [key, ref] of Object.entries(refs)) {
    const resolved = await credentials.resolve(ref)
    if (!resolved?.value) { const error = new Error(`credential reference ${ref} is not configured`); error.code = 'MCP_CREDENTIAL_MISSING'; throw error }
    output[key] = resolved.value
  }
  return output
}
export class McpManager {
  constructor({ file, credentials, mount }) {
    this.file = resolve(file); this.credentials = credentials; this.mount = mount
    this.servers = new Map(); this.runtimes = new Map(); this.queue = Promise.resolve(); this.closed = false
  }
  async load() {
    const rows = await readStore(this.file)
    this.servers = new Map(rows.map(row => [row.id, row]))
    for (const row of rows) if (row.enabled) await this.start(row.id)
    return this.list()
  }
  list() { return [...this.servers.values()].map(server => ({ ...publicServer(server), status: this.status(server.id) })) }
  status(id) { return this.runtimes.get(id)?.status ?? { phase: this.servers.get(id)?.enabled ? 'stopped' : 'disabled' } }
  serialize() { return { version: CONFIG_VERSION, servers: [...this.servers.values()].map(row => ({ ...row })) } }
  transact(task) { const run = this.queue.catch(() => {}).then(task); this.queue = run.catch(() => {}); return run }
  assertUnique(candidate, except) {
    for (const row of this.servers.values()) if (row.id !== except && row.serverName.toLowerCase() === candidate.serverName.toLowerCase()) throw Object.assign(new Error('serverName already exists'), { code: 'MCP_SERVER_NAME_CONFLICT' })
  }
  expect(id, revision) {
    const row = this.servers.get(id)
    if (!row) throw Object.assign(new Error('MCP server not found'), { code: 'MCP_NOT_FOUND' })
    if (row.revision !== revision) throw Object.assign(new Error('MCP server revision conflict'), { code: 'MCP_REVISION_CONFLICT' })
    return row
  }
  async create(input) { return this.transact(async () => { const row = persisted(validateServer(input), 1); if (this.servers.has(row.id)) throw Object.assign(new Error('id already exists'), { code: 'MCP_ID_CONFLICT' }); this.assertUnique(row); this.servers.set(row.id, row); await atomicWrite(this.file, this.serialize()); if (row.enabled) await this.start(row.id); return { ...publicServer(row), status: this.status(row.id) } }) }
  async update(id, revision, input) { return this.transact(async () => { const prior = this.expect(id, revision); const next = persisted(validateServer({ ...input, id }, prior), prior.revision + 1); this.assertUnique(next, id); await this.stop(id); this.servers.set(id, next); await atomicWrite(this.file, this.serialize()); if (next.enabled) await this.start(id); return { ...publicServer(next), status: this.status(id) } }) }
  async setEnabled(id, revision, enabled) { const prior = this.expect(id, revision); const { revision: _revision, ...definition } = prior; return this.update(id, revision, { ...definition, enabled: enabled === true }) }
  async delete(id, revision) { return this.transact(async () => { this.expect(id, revision); await this.stop(id); this.servers.delete(id); await atomicWrite(this.file, this.serialize()); return { id, deleted: true } }) }
  async reconnect(id, revision) { const row = this.expect(id, revision); if (!row.enabled) throw Object.assign(new Error('MCP server is disabled'), { code: 'MCP_DISABLED' }); await this.stop(id); await this.start(id); return { id, revision: row.revision, status: this.status(id) } }
  async start(id) {
    const row = this.servers.get(id); if (!row?.enabled || this.closed) return
    this.runtimes.set(id, { status: { phase: 'connecting' } })
    try {
      const config = row.transport.kind === 'stdio'
        ? { transport: 'stdio', serverName: row.serverName, command: row.transport.command, args: row.transport.args, cwd: row.transport.cwd, env: await resolveCredentialMap(this.credentials, row.transport.envRefs), toolCallTimeoutMs: row.toolCallTimeoutMs, failOnStartupError: true, reconnect: row.reconnect }
        : { transport: 'streamable-http', serverName: row.serverName, url: row.transport.url, headers: await resolveCredentialMap(this.credentials, row.transport.headerRefs), toolCallTimeoutMs: row.toolCallTimeoutMs, failOnStartupError: true, reconnect: row.reconnect }
      const handle = await this.mount(config)
      this.runtimes.set(id, { handle, status: { phase: 'ready' } })
    } catch (error) { this.runtimes.set(id, { status: { phase: 'failed', error: safeError(error) } }) }
  }
  async stop(id) { const runtime = this.runtimes.get(id); this.runtimes.delete(id); if (runtime?.handle?.dispose) await runtime.handle.dispose() }
  async close() { this.closed = true; await Promise.allSettled([...this.runtimes.keys()].map(id => this.stop(id))) }
}
function trusted(req) {
  if (req.headers[CSRF_HEADER] !== '1') return false
  const host = String(req.headers.host || '').toLowerCase(); const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) return false
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === host } catch { return false }
}
function json(res, status, body) { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)) }
async function body(req) { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 128 * 1024) throw Object.assign(new Error('request too large'), { status: 413 }) } return JSON.parse(raw || '{}') }
function apiError(error) { return { code: error?.code || 'MCP_REQUEST_FAILED', message: ['MCP_REVISION_CONFLICT', 'MCP_SERVER_NAME_CONFLICT', 'MCP_ID_CONFLICT', 'MCP_NOT_FOUND', 'MCP_DISABLED'].includes(error?.code) ? error.message : 'MCP manager request failed.' } }
export async function apply(ctx, config = {}) {
  const file = config.path ? resolve(config.path) : join(process.env.DSH_HOME || process.cwd(), 'mcp-servers.json')
  const manager = new McpManager({ file, credentials: ctx.credentials, mount: async resolvedConfig => {
    const fiber = ctx.plugin(mcpClient, resolvedConfig)
    await fiber
    if (fiber.state === 3 || fiber._error) throw fiber._error || new Error('MCP client fiber failed')
    return fiber
  } })
  await manager.load()
  ctx.effect(() => () => manager.close(), 'desktop-mcp-manager.runtime')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/desktop-mcp/servers', handler: async (req, res) => {
    if (!trusted(req)) return json(res, 403, { error: { code: 'MCP_FORBIDDEN', message: 'Forbidden' } })
    if (req.method === 'GET') return json(res, 200, { servers: manager.list() })
    if (req.method !== 'POST') return json(res, 405, { error: { code: 'MCP_METHOD', message: 'Method not allowed' } })
    try {
      const input = await body(req)
      if (input.confirm !== true) return json(res, 400, { error: { code: 'MCP_CONFIRMATION_REQUIRED', message: 'Explicit confirmation is required.' } })
      let result
      if (input.action === 'create') result = await manager.create(input.server)
      else if (input.action === 'update') result = await manager.update(input.id, input.revision, input.server)
      else if (input.action === 'set-enabled') result = await manager.setEnabled(input.id, input.revision, input.enabled)
      else if (input.action === 'delete') result = await manager.delete(input.id, input.revision)
      else if (input.action === 'reconnect') result = await manager.reconnect(input.id, input.revision)
      else return json(res, 400, { error: { code: 'MCP_ACTION', message: 'Unknown action' } })
      return json(res, 200, { result })
    } catch (error) { return json(res, error.status || (error.code === 'MCP_REVISION_CONFLICT' ? 409 : 400), { error: apiError(error) }) }
  } }), 'desktop-mcp-manager web API')
}
