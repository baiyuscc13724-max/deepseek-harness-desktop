'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const semver = require('semver')
const test = require('node:test')

const ROOT = path.resolve(process.env.DSH_ALPHA5_CANDIDATE_ROOT || path.resolve(__dirname, '..'))
const TARGET = '0.1.2-alpha.5'
const LEGACY_ALPHA4_TARGET = '0.1.2-alpha.4'
const LEGACY_ALPHA3_TARGET = '0.1.2-alpha.3'
const DSH_SCOPE = path.join(ROOT, 'node_modules', '@deepseek-ai')
const requiredOfficialCapabilities = Object.freeze([
  '@deepseek-ai/dsh-schedule',
  '@deepseek-ai/dsh-session-reference',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-client-ui-agent-preset',
  '@deepseek-ai/dsh-tool-todo'
])
const retiredPrivatePackages = Object.freeze([
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-host-apiproxy'
])
const retiredClientPackages = Object.freeze([
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-slots'
])
const desktopOwnedPluginDirectories = Object.freeze([
  'dsh-agent-teams',
  'dsh-codex-image-bridge',
  'dsh-desktop-browser-tools',
  'dsh-desktop-compaction',
  'dsh-desktop-computer-use',
  'dsh-desktop-directory-picker',
  'dsh-desktop-files',
  'dsh-desktop-mcp-manager',
  'dsh-desktop-memory-tools',
  'dsh-desktop-progress',
  'dsh-desktop-schedules',
  'dsh-desktop-web-search',
  'dsh-mobile-control',
  'dsh-model-admission',
  'dsh-session-experience'
])

function json(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'))
}

function packageName(location, entry) {
  if (typeof entry?.name === 'string') return entry.name
  const tail = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length)
  return tail.startsWith('@') ? tail.split('/').slice(0, 2).join('/') : tail.split('/')[0]
}

function dshEntries(lock) {
  return Object.entries(lock.packages)
    .filter(([location]) => location !== '')
    .map(([location, entry]) => ({ location, entry, name: packageName(location, entry) }))
    .filter(({ name }) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
}

function desktopOwnedPluginManifests() {
  const pluginRoot = path.join(ROOT, 'plugins')
  return fs.readdirSync(pluginRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ directory: entry.name, manifest: json(path.join('plugins', entry.name, 'package.json')) }))
    .filter(({ manifest }) => typeof manifest.name === 'string' && manifest.name.startsWith('dsh-'))
    .sort((left, right) => left.directory.localeCompare(right.directory))
}

test('alpha.5 pins the complete installed official core graph without alpha.4, alpha.3, rc.2, or alpha.2 fallback', () => {
  const pkg = json('package.json')
  const lock = json('package-lock.json')
  const direct = Object.entries(pkg.dependencies).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  const optional = Object.entries(pkg.optionalDependencies || {}).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  assert.ok(direct.length > 0, 'the Desktop manifest must retain an explicit official DSH root')
  for (const [name, version] of direct) {
    assert.equal(version, TARGET, `${name} must pin alpha.5 exactly`)
    assert.equal(lock.packages[''].dependencies[name], TARGET, `${name} root lock must match package.json`)
  }
  for (const [name, version] of optional) {
    assert.equal(version, TARGET, `${name} optional root must pin alpha.5 exactly`)
    assert.equal(lock.packages[''].optionalDependencies[name], TARGET, `${name} optional root lock must match package.json`)
  }

  const entries = dshEntries(lock)
  assert.ok(entries.length >= direct.length + optional.length, 'lockfile must materialize every direct and optional official package')
  for (const { location, entry, name } of entries) {
    assert.equal(entry.version, TARGET, `${location} (${name}) must not retain an alpha.4 or earlier package`)
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\/@deepseek-ai\//u, `${location} must use the official npm registry tarball`)
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, `${location} must retain registry integrity evidence`)
  }
  for (const name of retiredPrivatePackages) assert.equal(lock.packages[`node_modules/${name}`], undefined, `${name} must not re-enter the official alpha.5 graph`)
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-session-turn-outline']?.version, TARGET, 'alpha.5 must retain its official session turn outline package')
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-agent-spine-demo'], undefined, 'removed alpha.2 agent-spine demo must not survive in the alpha.5 graph')
})

test('alpha.5 root declares official scheduling, session reference, projection, preset, and todo capabilities', () => {
  const core = json('node_modules/@deepseek-ai/dsh/package.json')
  assert.equal(core.version, TARGET)
  for (const name of requiredOfficialCapabilities) assert.equal(core.dependencies[name], `^${TARGET}`, `${name} must be supplied by the official alpha.5 root`)
  for (const name of requiredOfficialCapabilities) {
    const installed = json(path.join('node_modules', '@deepseek-ai', name.slice('@deepseek-ai/'.length), 'package.json'))
    assert.equal(installed.version, TARGET, `${name} must resolve to the same alpha.5 release`)
  }
  for (const name of retiredPrivatePackages) assert.equal(fs.existsSync(path.join(DSH_SCOPE, name.slice('@deepseek-ai/'.length))), false, `${name} is a retired private implementation, not an alpha.5 capability`)
})

test('Desktop-owned plugin manifests exclude retired client packages and accept every installed official peer', () => {
  const plugins = desktopOwnedPluginManifests()
  assert.deepEqual(
    plugins.map(({ directory }) => directory),
    desktopOwnedPluginDirectories,
    'the compatibility gate must cover every Desktop-owned plugin while excluding the adapted third-party Android plugin'
  )

  for (const { directory, manifest } of plugins) {
    const dependencySections = [
      ['dependencies', Object.keys(manifest.dependencies || {})],
      ['devDependencies', Object.keys(manifest.devDependencies || {})],
      ['optionalDependencies', Object.keys(manifest.optionalDependencies || {})],
      ['peerDependencies', Object.keys(manifest.peerDependencies || {})],
      ['dsh.client.inject', manifest.dsh?.client?.inject || []]
    ]
    for (const [section, names] of dependencySections) {
      for (const retired of retiredClientPackages) {
        assert.equal(names.includes(retired), false, `${directory} ${section} retains removed pre-alpha.5 package ${retired}`)
      }
    }

    for (const [name, range] of Object.entries(manifest.peerDependencies || {})) {
      if (!name.startsWith('@deepseek-ai/')) continue
      const installedPath = path.join('node_modules', ...name.split('/'), 'package.json')
      assert.equal(fs.existsSync(path.join(ROOT, installedPath)), true, `${directory} peer ${name} is not supplied by the installed official runtime`)
      const installed = json(installedPath)
      assert.ok(semver.validRange(range), `${directory} peer ${name} has invalid range ${range}`)
      assert.equal(semver.satisfies(installed.version, range), true, `${directory} peer ${name}@${range} rejects installed ${installed.version}`)
      if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
        assert.equal(installed.version, TARGET, `${directory} peer ${name} must resolve from the alpha.5 official graph`)
      }
    }
  }
})

test('alpha.5 generated session descriptor exposes official queue, todo, image, goal, and skill seams', () => {
  const source = fs.readFileSync(path.join(DSH_SCOPE, 'dsh-api-session-controller', 'lib', 'typert.remote-client.js'), 'utf8')
  for (const projection of ['todos', 'imageLimits', 'goal']) assert.match(source, new RegExp(`'${projection}':`, 'u'), `${projection} must remain an official session projection`)
  for (const endpoint of ['session/attachment', 'session/updateQueue', 'skills/list']) assert.match(source, new RegExp(`#${endpoint}'`, 'u'), `${endpoint} must remain generated from the official descriptor`)
  assert.match(source, /maxImagesPerMessage/u, 'official image limits must keep their message-level cap')
  assert.match(source, /maxGoalRounds/u, 'official goal projection must preserve its durable round cap')
})

test('alpha.5 official todo tool replaces the complete list and retains strict active-work protection', async () => {
  const { pathToFileURL } = require('node:url')
  const modulePath = path.join(DSH_SCOPE, 'dsh-tool-todo', 'lib', 'index.js')
  const todo = await import(`${pathToFileURL(modulePath).href}?official-alpha5=${Date.now()}`)
  let projection
  let tool
  todo.apply({
    sessionProjections: { register: value => { projection = value } },
    tools: { register: value => { tool = value } }
  }, { allowParallelInProgress: false })
  assert.equal(projection.key, 'todos')
  assert.equal(projection.apply([{ content: 'old', status: 'completed' }], { type: 'todo/write', data: { todos: [{ content: 'new', status: 'in_progress' }] } })[0].content, 'new')
  const events = []
  const result = await tool.execute({ todos: [{ content: '  verify alpha.5  ', status: 'in_progress' }, { content: 'report', status: 'pending' }] }, { agent: { session: { append: (...event) => events.push(event) } } })
  assert.deepEqual(result.counts, { pending: 1, inProgress: 1, completed: 0 })
  assert.deepEqual(events, [['todo/write', { todos: [{ content: 'verify alpha.5', status: 'in_progress' }, { content: 'report', status: 'pending' }] }]])
  await assert.rejects(tool.execute({ todos: [{ content: 'one', status: 'in_progress' }, { content: 'two', status: 'in_progress' }] }, { agent: { session: { append() {} } } }), /at most one task may be in_progress/u)
})

test('alpha.5 runtime graph classifier accepts only the installed official core', async () => {
  const { pathToFileURL } = require('node:url')
  const patch = await import(`${pathToFileURL(path.join(ROOT, 'scripts', 'patch-official-runtime.mjs')).href}?official-alpha5=${Date.now()}`)
  const result = patch.classifyOfficialRuntimeGraph(json('package.json'), json('package-lock.json'), json('node_modules/@deepseek-ai/dsh/package.json'))
  assert.equal(result.mode, 'alpha5')
  assert.equal(result.version, TARGET)
  const rootPackage = json('package.json')
  const rootCount = [...Object.keys(rootPackage.dependencies), ...Object.keys(rootPackage.optionalDependencies || {})]
    .filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')).length
  assert.equal(result.directRootCount, rootCount, 'classifier must cover exact direct and optional official roots')
  assert.ok(result.selectedPackageCount >= result.directRootCount)
})

test('official compatibility installer selects alpha.5 while retaining explicit alpha.4, alpha.3, and alpha.2 compatibility dispatch', async t => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'patch-official-runtime.mjs'), 'utf8')
  assert.match(source, /0\.1\.2-alpha\.5/u, 'runtime patcher must identify the current official release')
  assert.match(source, /officialGraph\.mode === 'alpha5'/u, 'alpha.5 requires an explicit official dispatch branch')
  assert.match(source, /if \(targetsAlpha5\) await assertInstalledAlpha5NativeCapabilities\(\)/u, 'alpha.5 must verify native official capability anchors before patch dispatch')
  for (const installer of ['patchInstalledAlpha2SessionController', 'patchInstalledRuntime', 'patchInstalledConversation', 'patchInstalledAttachmentInput', 'patchInstalledModelSelection', 'patchInstalledModelSettings', 'patchInstalledWorkspaceUi', 'patchInstalledHostApiProxy']) {
    assert.match(source, new RegExp(`targetsAlpha5 \\? false :[^;]*${installer}`, 'u'), `${installer} must be skipped for alpha.5 instead of mutating an official native owner`)
  }
  assert.match(source, new RegExp(LEGACY_ALPHA4_TARGET.replace(/[.]/gu, '\\.'), 'u'), 'alpha.4 remains a recognized backward-compatible official graph')
  assert.match(source, /officialGraph\.mode === 'alpha4'/u, 'alpha.4 keeps an explicit compatibility dispatch branch')
  assert.match(source, /if \(targetsAlpha4\) await assertInstalledAlpha4NativeCapabilities\(\)/u, 'alpha.4 retains native capability verification')
  assert.match(source, new RegExp(LEGACY_ALPHA3_TARGET.replace(/[.]/gu, '\\.'), 'u'), 'alpha.3 remains a recognized backward-compatible official graph')
  assert.match(source, /officialGraph\.mode === 'alpha3'/u, 'alpha.3 keeps an explicit compatibility dispatch branch')
  assert.match(source, /if \(targetsAlpha3\) await assertInstalledAlpha3NativeCapabilities\(\)/u, 'alpha.3 retains native capability verification')
  assert.match(source, /if \(targetsAlpha2\) await assertOfficialAlpha2RemovedArtifactsAbsent\(\)/u, 'retired private bundle checks must remain confined to the alpha.2 compatibility branch')
  // The contract is rejection, not the spelling of the old default-root variables.
  // Exercise the real shared native-capability gate on a complete temporary graph.
  const fixture = await temporaryNativeGraph(t)
  const clean = snapshotTree(fixture.modules)
  assert.equal(await fixture.patch.assertInstalledAlpha5NativeCapabilities(fixture.modules), false)
  assert.deepEqual(snapshotTree(fixture.modules), clean, 'successful preflight is read-only')
  for (const [name, relative] of [
    ['dsh-client-runtime', 'lib/client.js'],
    ['dsh-host-apiproxy', 'lib/index.js'],
    ['dsh-session-persistence-sqlite', 'package.json']
  ]) {
    const packageRoot = path.join(fixture.modules, '@deepseek-ai', name)
    const artifact = path.join(packageRoot, relative)
    fs.mkdirSync(path.dirname(artifact), { recursive: true })
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/' + name, version: LEGACY_ALPHA3_TARGET }))
    if (relative !== 'package.json') fs.writeFileSync(artifact, '// inert alpha.3 retired residue; must never load or execute\n')
    const before = snapshotTree(fixture.modules)
    await assert.rejects(fixture.patch.assertInstalledAlpha5NativeCapabilities(fixture.modules), error => {
      assert.equal(error.message, `Retired ${TARGET} compatibility artifact is unexpectedly installed: ${artifact}`)
      return true
    })
    assert.deepEqual(snapshotTree(fixture.modules), before, 'refusal must preserve every file, including retired residue')
    fs.rmSync(packageRoot, { recursive: true, force: true }) // fixture cleanup, never production cleanup
    assert.deepEqual(snapshotTree(fixture.modules), clean)
    assert.equal(await fixture.patch.assertInstalledAlpha5NativeCapabilities(fixture.modules), false)
  }
})

// Only exact fixture files are copied. No default installed writer, CLI, legacy
// bundle evaluation, registry lookup or actual cleanup of a user's install runs.
async function temporaryNativeGraph(t) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'alpha3 中文 fixture '))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const modules = path.join(directory, 'node_modules')
  const clients = ['dsh-api-session-controller', 'dsh-client-ui-chat', 'dsh-client-ui-conversation', 'dsh-client-connection', 'dsh-client-ui-schedule', 'dsh-client-ui-attachment']
  const servers = ['dsh-session-turn-outline', 'dsh-api-gateway', 'dsh-api-remotes', 'dsh-session', 'dsh-session-projection-cache', 'dsh-storage-domain', 'dsh-storage-json']
  for (const [name, file] of [...clients.map(name => [name, 'client.js']), ...servers.map(name => [name, 'index.js'])]) {
    const destination = path.join(modules, '@deepseek-ai', name)
    fs.mkdirSync(path.join(destination, 'lib'), { recursive: true })
    fs.copyFileSync(path.join(DSH_SCOPE, name, 'package.json'), path.join(destination, 'package.json'))
    fs.copyFileSync(path.join(DSH_SCOPE, name, 'lib', file), path.join(destination, 'lib', file))
  }
  const patch = await import(require('node:url').pathToFileURL(path.join(ROOT, 'scripts/patch-official-runtime.mjs')).href)
  return { modules, patch, conversation: path.join(modules, '@deepseek-ai/dsh-client-ui-conversation/lib/client.js') }
}

function snapshotTree(directory) {
  const entries = []
  const visit = relative => {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name)
      if (entry.isDirectory()) { entries.push([name, 'directory']); visit(name) }
      else {
        assert.equal(entry.isFile(), true, 'fixture contains only regular files and directories')
        entries.push([name, require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')])
      }
    }
  }
  visit('')
  return entries
}

test('temporary compatibility installer rejects wrong identity and legacy version without changing bytes, then replays valid core safely', async t => {
  const fixture = await temporaryNativeGraph(t)
  const manifest = path.join(path.dirname(fixture.conversation), '../package.json')
  const originalManifest = fs.readFileSync(manifest, 'utf8')
  const originalSource = fs.readFileSync(fixture.conversation)
  for (const change of [{ name: '@deepseek-ai/wrong-package' }, { version: LEGACY_ALPHA3_TARGET }]) {
    fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(originalManifest), ...change }))
    const before = snapshotTree(fixture.modules)
    await assert.rejects(fixture.patch.patchInstalledSessionCoreClient(fixture.conversation), /Pinned session-core package identity\/version changed/u)
    await assert.rejects(fixture.patch.assertInstalledAlpha5NativeCapabilities(fixture.modules), /capability package changed: @deepseek-ai\/dsh-client-ui-conversation/u)
    assert.deepEqual(snapshotTree(fixture.modules), before)
    assert.deepEqual(fs.readFileSync(fixture.conversation), originalSource)
  }
  fs.writeFileSync(manifest, originalManifest)
  const core = await import(require('node:url').pathToFileURL(path.join(ROOT, 'scripts/deep-audit-session-core-patch.mjs')).href)
  const input = core.restoreSessionCoreClientSource(fs.readFileSync(fixture.conversation, 'utf8'))
  fs.writeFileSync(fixture.conversation, input)
  const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex').toUpperCase()
  const proof = core.SESSION_CORE_PROOFS.find(value => value.input === digest(input))
  assert.ok(proof, 'positive install uses one complete pinned input, not a marker-only fixture')
  const beforeInstall = snapshotTree(fixture.modules)
  assert.equal(await fixture.patch.patchInstalledSessionCoreClient(fixture.conversation), true)
  assert.equal(digest(fs.readFileSync(fixture.conversation)), proof.output)
  const afterInstall = snapshotTree(fixture.modules)
  const expectedChangedPath = path.relative(fixture.modules, fixture.conversation)
  assert.deepEqual(afterInstall.map(entry => entry[0]), beforeInstall.map(entry => entry[0]), 'installer must not add or remove other paths')
  assert.deepEqual(afterInstall.filter((entry, index) => entry[1] !== beforeInstall[index][1]).map(entry => entry[0]), [expectedChangedPath])
  assert.equal(await fixture.patch.patchInstalledSessionCoreClient(fixture.conversation), false)
  assert.equal(await fixture.patch.assertInstalledAlpha5NativeCapabilities(fixture.modules), false)
  assert.deepEqual(snapshotTree(fixture.modules), afterInstall)
  assert.equal(fs.readFileSync(manifest, 'utf8'), originalManifest)
})
