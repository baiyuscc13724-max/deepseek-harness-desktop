'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const semver = require('semver')
const test = require('node:test')

const ROOT = path.resolve(process.env.DSH_ALPHA3_CANDIDATE_ROOT || path.resolve(__dirname, '..'))
const TARGET = '0.1.2-alpha.3'
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

test('alpha.3 pins the complete installed official core graph without rc.2 or alpha.2 fallback', () => {
  const pkg = json('package.json')
  const lock = json('package-lock.json')
  const direct = Object.entries(pkg.dependencies).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  const optional = Object.entries(pkg.optionalDependencies || {}).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  assert.ok(direct.length > 0, 'the Desktop manifest must retain an explicit official DSH root')
  for (const [name, version] of direct) {
    assert.equal(version, TARGET, `${name} must pin alpha.3 exactly`)
    assert.equal(lock.packages[''].dependencies[name], TARGET, `${name} root lock must match package.json`)
  }
  for (const [name, version] of optional) {
    assert.equal(version, TARGET, `${name} optional root must pin alpha.3 exactly`)
    assert.equal(lock.packages[''].optionalDependencies[name], TARGET, `${name} optional root lock must match package.json`)
  }

  const entries = dshEntries(lock)
  assert.ok(entries.length >= direct.length + optional.length, 'lockfile must materialize every direct and optional official package')
  for (const { location, entry, name } of entries) {
    assert.equal(entry.version, TARGET, `${location} (${name}) must not retain a pre-alpha.3 package`)
    assert.match(entry.resolved, /^https:\/\/registry\.(?:npmjs\.org|npmmirror\.com)\//u, `${location} must use an official registry tarball`)
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, `${location} must retain registry integrity evidence`)
  }
  for (const name of retiredPrivatePackages) assert.equal(lock.packages[`node_modules/${name}`], undefined, `${name} must not re-enter the official alpha.3 graph`)
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-session-turn-outline']?.version, TARGET, 'alpha.3 must retain its official session turn outline package')
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-agent-spine-demo'], undefined, 'removed alpha.2 agent-spine demo must not survive in the alpha.3 graph')
})

test('alpha.3 root declares official scheduling, session reference, projection, preset, and todo capabilities', () => {
  const core = json('node_modules/@deepseek-ai/dsh/package.json')
  assert.equal(core.version, TARGET)
  for (const name of requiredOfficialCapabilities) assert.equal(core.dependencies[name], `^${TARGET}`, `${name} must be supplied by the official alpha.3 root`)
  for (const name of requiredOfficialCapabilities) {
    const installed = json(path.join('node_modules', '@deepseek-ai', name.slice('@deepseek-ai/'.length), 'package.json'))
    assert.equal(installed.version, TARGET, `${name} must resolve to the same alpha.3 release`)
  }
  for (const name of retiredPrivatePackages) assert.equal(fs.existsSync(path.join(DSH_SCOPE, name.slice('@deepseek-ai/'.length))), false, `${name} is a retired private implementation, not an alpha.3 capability`)
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
        assert.equal(names.includes(retired), false, `${directory} ${section} retains removed alpha.3 package ${retired}`)
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
        assert.equal(installed.version, TARGET, `${directory} peer ${name} must resolve from the alpha.3 official graph`)
      }
    }
  }
})

test('alpha.3 generated session descriptor exposes official queue, todo, image, goal, and skill seams', () => {
  const source = fs.readFileSync(path.join(DSH_SCOPE, 'dsh-api-session-controller', 'lib', 'typert.remote-client.js'), 'utf8')
  for (const projection of ['todos', 'imageLimits', 'goal']) assert.match(source, new RegExp(`'${projection}':`, 'u'), `${projection} must remain an official session projection`)
  for (const endpoint of ['session/attachment', 'session/updateQueue', 'skills/list']) assert.match(source, new RegExp(`#${endpoint}'`, 'u'), `${endpoint} must remain generated from the official descriptor`)
  assert.match(source, /maxImagesPerMessage/u, 'official image limits must keep their message-level cap')
  assert.match(source, /maxGoalRounds/u, 'official goal projection must preserve its durable round cap')
})

test('alpha.3 official todo tool replaces the complete list and retains strict active-work protection', async () => {
  const { pathToFileURL } = require('node:url')
  const modulePath = path.join(DSH_SCOPE, 'dsh-tool-todo', 'lib', 'index.js')
  const todo = await import(`${pathToFileURL(modulePath).href}?official-alpha3=${Date.now()}`)
  let projection
  let tool
  todo.apply({
    sessionProjections: { register: value => { projection = value } },
    tools: { register: value => { tool = value } }
  }, { allowParallelInProgress: false })
  assert.equal(projection.key, 'todos')
  assert.equal(projection.apply([{ content: 'old', status: 'completed' }], { type: 'todo/write', data: { todos: [{ content: 'new', status: 'in_progress' }] } })[0].content, 'new')
  const events = []
  const result = await tool.execute({ todos: [{ content: '  verify alpha.3  ', status: 'in_progress' }, { content: 'report', status: 'pending' }] }, { agent: { session: { append: (...event) => events.push(event) } } })
  assert.deepEqual(result.counts, { pending: 1, inProgress: 1, completed: 0 })
  assert.deepEqual(events, [['todo/write', { todos: [{ content: 'verify alpha.3', status: 'in_progress' }, { content: 'report', status: 'pending' }] }]])
  await assert.rejects(tool.execute({ todos: [{ content: 'one', status: 'in_progress' }, { content: 'two', status: 'in_progress' }] }, { agent: { session: { append() {} } } }), /at most one task may be in_progress/u)
})

test('alpha.3 runtime graph classifier accepts only the installed official core', async () => {
  const { pathToFileURL } = require('node:url')
  const patch = await import(`${pathToFileURL(path.join(ROOT, 'scripts', 'patch-official-runtime.mjs')).href}?official-alpha3=${Date.now()}`)
  const result = patch.classifyOfficialRuntimeGraph(json('package.json'), json('package-lock.json'), json('node_modules/@deepseek-ai/dsh/package.json'))
  assert.equal(result.mode, 'alpha3')
  assert.equal(result.version, TARGET)
  const rootPackage = json('package.json')
  const rootCount = [...Object.keys(rootPackage.dependencies), ...Object.keys(rootPackage.optionalDependencies || {})]
    .filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')).length
  assert.equal(result.directRootCount, rootCount, 'classifier must cover exact direct and optional official roots')
  assert.ok(result.selectedPackageCount >= result.directRootCount)
})

test('official compatibility installer selects alpha.3 and rejects stale alpha.2 dispatch', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'patch-official-runtime.mjs'), 'utf8')
  assert.match(source, /0\.1\.2-alpha\.3/u, 'runtime patcher must identify the upgraded official release')
  assert.match(source, /officialGraph\.mode === 'alpha3'/u, 'alpha.3 requires an explicit official dispatch branch')
  assert.match(source, /if \(targetsAlpha3\) await assertInstalledAlpha3NativeCapabilities\(\)/u, 'alpha.3 must verify native official capability anchors before patch dispatch')
  for (const installer of ['patchInstalledAlpha2SessionController', 'patchInstalledRuntime', 'patchInstalledConversation', 'patchInstalledAttachmentInput', 'patchInstalledModelSelection', 'patchInstalledModelSettings', 'patchInstalledWorkspaceUi', 'patchInstalledHostApiProxy']) {
    assert.match(source, new RegExp(`targetsAlpha3 \\? false :[^;]*${installer}`, 'u'), `${installer} must be skipped for alpha.3 instead of mutating an official native owner`)
  }
  assert.match(source, /if \(targetsAlpha2\) await assertOfficialAlpha2RemovedArtifactsAbsent\(\)/u, 'retired private bundle checks must remain confined to the alpha.2 compatibility branch')
  assert.match(source, /for \(const removed of \[runtimeClient, hostApiProxyRuntime,/u, 'alpha.3 native capability verification must fail closed when retired private artifacts are installed')
})
