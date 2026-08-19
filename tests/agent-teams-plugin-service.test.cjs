const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { ensureAgentTeamsPlugin } = require('../electron/bridge/agent-teams-plugin-service.cjs')

const bundledRoot = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams')

test('Agent Teams plugin installs into the Web profile idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-plugin-'))
  try {
    const first = await ensureAgentTeamsPlugin({ dshHome: root, bundledRoot })
    const second = await ensureAgentTeamsPlugin({ dshHome: root, bundledRoot })
    assert.equal(first.patchChanged, true)
    assert.equal(second.patchChanged, false)
    assert.equal(first.version, '1.0.25')

    const patch = await readFile(path.join(root, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')
    assert.equal((patch.match(/dsh-agent-teams/g) || []).length, 1)
    assert.match(patch, /id: agent-teams/u)
    assert.match(patch, /name: dsh-agent-teams/u)

    const installedRoot = path.join(first.destination, 'lib')
    const host = await readFile(path.join(installedRoot, 'index.js'), 'utf8')
    const client = await readFile(path.join(installedRoot, 'client.js'), 'utf8')
    assert.match(host, /team_start/u)
    assert.match(host, /team_message/u)
    assert.match(host, /team_task_update/u)
    assert.match(host, /x-harness-agent-teams/iu)
    assert.match(client, /conversation\.session\.header\.actions/u)
    assert.match(client, /\/api\/agent-teams\/events/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('plugin install rolls back the previous directory when patch publication fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-rollback-'))
  try {
    const first = await ensureAgentTeamsPlugin({ dshHome: root, bundledRoot })
    const sentinel = path.join(first.destination, 'previous-install.txt')
    await writeFile(sentinel, 'keep me', 'utf8')
    const patch = path.join(root, 'profiles', 'web', 'cordis.patch.yml')
    await rm(patch, { force: true })
    await mkdir(patch)
    await assert.rejects(ensureAgentTeamsPlugin({ dshHome: root, bundledRoot }))
    assert.equal(await readFile(sentinel, 'utf8'), 'keep me')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('desktop startup installs Agent Teams without patching the official runtime', async () => {
  const main = await readFile(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const pkg = JSON.parse(await readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8'))
  assert.match(main, /ensureAgentTeamsPlugin\(agentTeamsPluginOptions\(\)\)/u)
  assert.ok(pkg.build.files.includes('plugins/dsh-agent-teams/**/*'))
  assert.ok(pkg.build.asarUnpack.includes('plugins/dsh-agent-teams/**/*'))
})

test('Agent Teams remains experimental and disabled by default', async () => {
  const source = await readFile(path.join(bundledRoot, 'lib', 'index.js'), 'utf8')
  assert.match(source, /enabled:\s*false/u)
  assert.match(source, /maxMembers:\s*4/u)
  assert.match(source, /HARD_MAX_MEMBERS\s*=\s*8/u)
  assert.doesNotMatch(source, /source:\s*\{\s*kind:\s*['"]user['"]/u)
})
