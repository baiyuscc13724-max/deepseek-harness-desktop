const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const { ARTIFACT_FIXTURE_MARKER, ensureAgentTeamsPlugin, validateAgentTeamsArtifactRoot } = require('../electron/bridge/agent-teams-plugin-service.cjs')

const repositoryPluginRoot = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams')

async function artifactFixture(root) {
  const bundledRoot = path.join(root, 'artifact-fixture', 'dsh-agent-teams')
  await cp(repositoryPluginRoot, bundledRoot, { recursive: true })
  await writeFile(path.join(bundledRoot, ARTIFACT_FIXTURE_MARKER), JSON.stringify({ kind: 'agent-teams-packaged-artifact-fixture', version: 1 }))
  return bundledRoot
}

test('Agent Teams plugin installs an explicitly marked artifact fixture into the Web profile idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-plugin-'))
  try {
    const bundledRoot = await artifactFixture(root)
    const first = await ensureAgentTeamsPlugin({ dshHome: root, bundledRoot, allowArtifactFixture: true, requireArtifact: true })
    const second = await ensureAgentTeamsPlugin({ dshHome: root, bundledRoot, allowArtifactFixture: true, requireArtifact: true })
    assert.equal(first.patchChanged, true)
    assert.equal(second.patchChanged, false)
    assert.equal(first.version, '1.0.56')

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
    assert.match(client, /conversation\.view/u)
    assert.doesNotMatch(client, /conversation\.session\.header\.actions|conversation\.input\.dock/u)
    assert.match(client, /\/api\/agent-teams\/events/u)
    const manifest = JSON.parse(await readFile(path.join(first.destination, 'package.json'), 'utf8'))
    assert.equal(manifest.dependencies['@peculiar/x509'], '2.0.0')
    assert.equal(manifest.dependencies['reflect-metadata'], '0.2.2')
    assert.equal(await readFile(path.join(first.destination, 'node_modules', 'reflect-metadata', 'package.json'), 'utf8').then(JSON.parse).then(value => value.name), 'reflect-metadata')
    await assert.rejects(readFile(path.join(root, 'profiles', 'web', 'node_modules', 'reflect-metadata', 'package.json')), error => error?.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('packaged startup installs Agent Teams dependencies from the expanded runtime root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-expanded-runtime-'))
  try {
    const bundledRoot = await artifactFixture(root)
    const manifestFile = path.join(bundledRoot, 'package.json')
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
    manifest.dependencies = { 'agent-teams-runtime-root-fixture': '1.0.0' }
    await writeFile(manifestFile, JSON.stringify(manifest), 'utf8')

    const dependencyRoot = path.join(root, 'expanded-runtime', 'node_modules')
    const directRoot = path.join(dependencyRoot, 'agent-teams-runtime-root-fixture')
    const transitiveRoot = path.join(dependencyRoot, 'agent-teams-runtime-transitive-fixture')
    await mkdir(directRoot, { recursive: true })
    await mkdir(transitiveRoot, { recursive: true })
    await writeFile(path.join(directRoot, 'package.json'), JSON.stringify({
      name: 'agent-teams-runtime-root-fixture',
      version: '1.0.0',
      dependencies: { 'agent-teams-runtime-transitive-fixture': '1.0.0' }
    }))
    await writeFile(path.join(directRoot, 'index.js'), 'module.exports = "direct"\n')
    await writeFile(path.join(transitiveRoot, 'package.json'), JSON.stringify({ name: 'agent-teams-runtime-transitive-fixture', version: '1.0.0' }))
    await writeFile(path.join(transitiveRoot, 'index.js'), 'module.exports = "transitive"\n')

    const installed = await ensureAgentTeamsPlugin({
      dshHome: root,
      bundledRoot,
      dependencyRoot,
      allowArtifactFixture: true,
      requireArtifact: true
    })
    assert.deepEqual(installed.runtimeDependencies, ['agent-teams-runtime-root-fixture', 'agent-teams-runtime-transitive-fixture'])
    assert.equal(await readFile(path.join(installed.destination, 'node_modules', 'agent-teams-runtime-root-fixture', 'index.js'), 'utf8'), 'module.exports = "direct"\n')
    assert.equal(await readFile(path.join(installed.destination, 'node_modules', 'agent-teams-runtime-transitive-fixture', 'index.js'), 'utf8'), 'module.exports = "transitive"\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('plugin install rolls back the previous directory when patch publication fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-rollback-'))
  try {
    const bundledRoot = await artifactFixture(root)
    const first = await ensureAgentTeamsPlugin({ dshHome: root, bundledRoot, allowArtifactFixture: true, requireArtifact: true })
    const sentinel = path.join(first.destination, 'previous-install.txt')
    await writeFile(sentinel, 'keep me', 'utf8')
    const sharedSentinel = path.join(root, 'profiles', 'web', 'node_modules', 'reflect-metadata', 'shared.txt')
    await mkdir(path.dirname(sharedSentinel), { recursive: true })
    await writeFile(sharedSentinel, 'shared package untouched', 'utf8')
    const patch = path.join(root, 'profiles', 'web', 'cordis.patch.yml')
    await rm(patch, { force: true })
    await mkdir(patch)
    await assert.rejects(ensureAgentTeamsPlugin({ dshHome: root, bundledRoot, allowArtifactFixture: true, requireArtifact: true }))
    assert.equal(await readFile(sentinel, 'utf8'), 'keep me')
    assert.equal(await readFile(sharedSentinel, 'utf8'), 'shared package untouched')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('dependency preparation failure preserves destination and shared packages and removes temporary publication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-dependency-failure-'))
  try {
    const bundledRoot = await artifactFixture(root)
    const first = await ensureAgentTeamsPlugin({ dshHome: root, bundledRoot, allowArtifactFixture: true, requireArtifact: true })
    const installedSentinel = path.join(first.destination, 'installed.txt')
    const sharedSentinel = path.join(root, 'profiles', 'web', 'node_modules', 'shared-package', 'shared.txt')
    await writeFile(installedSentinel, 'installed remains', 'utf8')
    await mkdir(path.dirname(sharedSentinel), { recursive: true })
    await writeFile(sharedSentinel, 'shared remains', 'utf8')
    const manifestFile = path.join(bundledRoot, 'package.json')
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
    manifest.dependencies['@definitely-missing/agent-teams-smoke'] = '1.0.0'
    await writeFile(manifestFile, JSON.stringify(manifest), 'utf8')
    await assert.rejects(ensureAgentTeamsPlugin({ dshHome: root, bundledRoot, allowArtifactFixture: true, requireArtifact: true }), /无法解析协作团队插件运行依赖/u)
    assert.equal(await readFile(installedSentinel, 'utf8'), 'installed remains')
    assert.equal(await readFile(sharedSentinel, 'utf8'), 'shared remains')
    const rows = await readdir(path.dirname(first.destination))
    assert.deepEqual(rows.filter(name => name.startsWith('dsh-agent-teams.desktop-') || name.startsWith('dsh-agent-teams.backup-')), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('default desktop startup mode still installs from a source checkout while gate mode rejects it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-source-startup-'))
  try {
    const installed = await ensureAgentTeamsPlugin({ dshHome: root, bundledRoot: repositoryPluginRoot })
    assert.equal(installed.version, '1.0.56')
    assert.equal(await readFile(path.join(installed.destination, 'package.json'), 'utf8').then(JSON.parse).then(value => value.name), 'dsh-agent-teams')
    await assert.rejects(ensureAgentTeamsPlugin({ dshHome: root, bundledRoot: repositoryPluginRoot, requireArtifact: true }), error => error?.code === 'AGENT_TEAMS_ARTIFACT_REQUIRED')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('artifact boundary rejects repository source and fake unpacked roots', async () => {
  await assert.rejects(validateAgentTeamsArtifactRoot(repositoryPluginRoot), error => error?.code === 'AGENT_TEAMS_ARTIFACT_REQUIRED')
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-fake-artifact-'))
  try {
    const fake = path.join(root, 'app.asar.unpacked', 'plugins', 'dsh-agent-teams')
    await cp(repositoryPluginRoot, fake, { recursive: true })
    await mkdir(path.join(root, 'app.asar'))
    await assert.rejects(validateAgentTeamsArtifactRoot(fake), error => error?.code === 'AGENT_TEAMS_ARTIFACT_MARKER_MISSING')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('desktop startup installs Agent Teams without patching the official runtime', async () => {
  const main = await readFile(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const pkg = JSON.parse(await readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8'))
  assert.match(main, /ensureAgentTeamsPlugin\(agentTeamsPluginOptions\(\)\)/u)
  assert.match(main, /dependencyRoot:\s*bundledNodeModulesRoot\(\)/u)
  assert.match(main, /ensureAgentTeamsSessionLaunchService\(\)/u)
  assert.match(main, /sessionLaunchService\.runtimeEnvironment\(authorizedRuntimeEnv\)/u)
  assert.match(main, /delete runtimeEnv\.DSH_AGENT_TEAMS_SESSION_LAUNCH_CALLER_SALT/u)
  assert.doesNotMatch(main, /getProjectBinding:\s*\(\)\s*=>\s*\(\{\s*workspacePath:/u)
  assert.match(main, /agentTeamsSessionLaunchService\?\.close\(\)/u)
  assert.ok(main.indexOf('ensureAgentTeamsSessionLaunchService()') < main.indexOf("spawnCommand(resolved.command, [...resolved.argsPrefix, 'web'"), 'Host capability starts before Runtime spawn')
  assert.ok(pkg.build.files.includes('plugins/dsh-agent-teams/**/*'))
  assert.ok(pkg.build.asarUnpack.includes('plugins/dsh-agent-teams/**/*'))
})

test('Agent Teams remains experimental and disabled by default', async () => {
  const source = await readFile(path.join(repositoryPluginRoot, 'lib', 'index.js'), 'utf8')
  assert.match(source, /enabled:\s*false/u)
  assert.match(source, /maxMembers:\s*4/u)
  assert.match(source, /HARD_MAX_MEMBERS\s*=\s*8/u)
  assert.doesNotMatch(source, /source:\s*\{\s*kind:\s*['"]user['"]/u)
})
