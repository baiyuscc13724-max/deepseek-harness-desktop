const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const plugin = import('../plugins/dsh-desktop-mcp-manager/lib/index.js')
const server = enabled => ({ id: 'runtime', serverName: 'runtime', label: 'Runtime', enabled, transport: { kind: 'streamable-http', url: 'https://example.com/mcp', headerRefs: { Authorization: 'MCP_TOKEN' } } })

test('host dynamically mounts the official MCP client through a Cordis child fiber', async () => {
  const source = await require('node:fs/promises').readFile(path.resolve(__dirname, '../plugins/dsh-desktop-mcp-manager/lib/index.js'), 'utf8')
  assert.match(source, /import \* as mcpClient from '@deepseek-ai\/dsh-mcp-client'/)
  assert.match(source, /ctx\.plugin\(mcpClient, resolvedConfig\)/)
  assert.doesNotMatch(source, /child_process|ipcMain/)
})

test('enabled servers mount official-client-shaped config and manual reconnect disposes old child fiber', async t => {
  const { McpManager } = await plugin
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-manager-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const mounts = []; const disposed = []
  const manager = new McpManager({
    file: path.join(root, 'servers.json'),
    credentials: { resolve: async ref => ({ value: `resolved:${ref}` }) },
    mount: async config => { mounts.push(config); const id = mounts.length; return { dispose: async () => disposed.push(id) } }
  })
  const created = await manager.create(server(true))
  assert.equal(created.status.phase, 'ready')
  assert.equal(mounts[0].transport, 'streamable-http')
  assert.equal(mounts[0].headers.Authorization, 'resolved:MCP_TOKEN')
  assert.equal(mounts[0].serverName, 'runtime')
  assert.equal(mounts[0].failOnStartupError, true)
  const reconnected = await manager.reconnect('runtime', created.revision)
  assert.equal(reconnected.status.phase, 'ready')
  assert.equal(mounts.length, 2)
  assert.deepEqual(disposed, [1])
  await manager.close()
  assert.deepEqual(disposed, [1, 2])
})

test('missing credential fails closed without projecting the reference resolution error', async t => {
  const { McpManager } = await plugin
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-manager-runtime-fail-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let mounted = false
  const manager = new McpManager({ file: path.join(root, 'servers.json'), credentials: { resolve: async () => undefined }, mount: async () => { mounted = true } })
  const created = await manager.create(server(true))
  assert.equal(mounted, false)
  assert.equal(created.status.phase, 'failed')
  assert.equal(created.status.error.code, 'MCP_CREDENTIAL_MISSING')
  assert.doesNotMatch(created.status.error.message, /MCP_TOKEN/)
})

test('enable and disable are revisioned and stop dynamic instances', async t => {
  const { McpManager } = await plugin
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-manager-enable-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let disposed = 0
  const manager = new McpManager({ file: path.join(root, 'servers.json'), credentials: { resolve: async () => ({ value: 'x' }) }, mount: async () => ({ dispose: async () => { disposed++ } }) })
  const created = await manager.create(server(false))
  assert.equal(created.status.phase, 'disabled')
  const enabled = await manager.setEnabled('runtime', 1, true)
  assert.equal(enabled.status.phase, 'ready')
  const disabled = await manager.setEnabled('runtime', 2, false)
  assert.equal(disabled.status.phase, 'disabled')
  assert.equal(disposed, 1)
})
