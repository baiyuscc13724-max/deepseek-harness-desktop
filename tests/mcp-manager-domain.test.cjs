const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const plugin = import('../plugins/dsh-desktop-mcp-manager/lib/index.js')
const credentials = { resolve: async ref => ({ value: `secret:${ref}` }) }
const httpServer = (id, serverName = id) => ({ id, serverName, label: id, enabled: false, transport: { kind: 'streamable-http', url: 'https://example.com/mcp', headerRefs: { Authorization: 'MCP_TOKEN' } } })

test('domain persists atomically, enforces unique names and optimistic revisions', async t => {
  const { McpManager } = await plugin
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-manager-domain-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'servers.json')
  const manager = new McpManager({ file, credentials, mount: async () => ({ dispose: async () => {} }) })
  const created = await manager.create(httpServer('docs', 'Docs'))
  assert.equal(created.revision, 1)
  await assert.rejects(manager.create(httpServer('other', 'docs')), error => error.code === 'MCP_SERVER_NAME_CONFLICT')
  await assert.rejects(manager.update('docs', 99, httpServer('docs', 'Docs')), error => error.code === 'MCP_REVISION_CONFLICT')
  const updated = await manager.setEnabled('docs', 1, true)
  assert.equal(updated.revision, 2)
  assert.equal(updated.enabled, true)
  const disk = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(disk.version, 1)
  assert.equal(disk.servers[0].transport.headerRefs.Authorization, 'MCP_TOKEN')
  assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.tmp')), [])
  await manager.close()
})

test('transport policy permits HTTPS and loopback HTTP but rejects unsafe inputs', async () => {
  const { validateServer } = await plugin
  assert.equal(validateServer(httpServer('safe')).transport.url, 'https://example.com/mcp')
  assert.match(validateServer({ ...httpServer('local'), transport: { kind: 'streamable-http', url: 'http://127.0.0.1:7777/mcp', headerRefs: {} } }).transport.url, /^http:/)
  assert.throws(() => validateServer({ ...httpServer('bad'), transport: { kind: 'streamable-http', url: 'http://example.com/mcp', headerRefs: {} } }), /HTTPS/)
  assert.throws(() => validateServer({ ...httpServer('userinfo'), transport: { kind: 'streamable-http', url: 'https://user:pass@example.com/mcp', headerRefs: {} } }), /userinfo/)
  assert.throws(() => validateServer({ ...httpServer('cookie'), transport: { kind: 'streamable-http', url: 'https://example.com/mcp', headerRefs: { Cookie: 'TOKEN' } } }), /forbidden HTTP header/)
  assert.throws(() => validateServer({ ...httpServer('raw'), transport: { kind: 'streamable-http', url: 'https://example.com/mcp', headerRefs: { Authorization: 'Bearer raw-secret' } } }), /credential reference/)
  assert.throws(() => validateServer({ ...httpServer('cmd'), transport: { kind: 'stdio', command: 'npx', args: [], envRefs: {} } }), /absolute path/)
})

test('public projections contain references and configured flags, never resolved values', async t => {
  const { McpManager } = await plugin
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-manager-redact-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manager = new McpManager({ file: path.join(root, 'servers.json'), credentials, mount: async config => {
    assert.equal(config.headers.Authorization, 'secret:MCP_TOKEN')
    return { dispose: async () => {} }
  } })
  const result = await manager.create({ ...httpServer('private'), enabled: true })
  const serialized = JSON.stringify(result)
  assert.match(serialized, /MCP_TOKEN/)
  assert.doesNotMatch(serialized, /secret:MCP_TOKEN/)
  assert.equal(result.transport.headerRefs.Authorization.configured, true)
  await manager.close()
})
