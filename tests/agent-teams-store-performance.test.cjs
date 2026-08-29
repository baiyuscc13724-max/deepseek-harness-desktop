const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const pluginFile = path.join(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')

test('closed AgentTeamsStore instances stop receiving shared document publications', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-closed-store-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const mod = await import(`${pathToFileURL(pluginFile).href}?closed-store=${Date.now()}-${Math.random()}`)
  const closed = new mod.AgentTeamsStore(file)
  const active = new mod.AgentTeamsStore(file)
  try {
    await closed.init()
    await active.init()
    let closedListenerCalls = 0
    closed.subscribe(() => { closedListenerCalls += 1 })
    closed.close()

    await active.mutate(document => { document.settings.enabled = true })

    assert.equal(active.snapshot().settings.enabled, true)
    assert.equal(closed.snapshot().settings.enabled, false)
    assert.equal(closedListenerCalls, 0)
  } finally {
    active.close()
    await rm(root, { recursive: true, force: true })
  }
})
