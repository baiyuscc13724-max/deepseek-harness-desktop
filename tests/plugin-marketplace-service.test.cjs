const test = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { pathToFileURL } = require('node:url')
const YAML = require('yaml')
const { MARKETPLACE_RUNTIME_FILES, ensurePluginMarketplace } = require('../electron/bridge/plugin-marketplace-service.cjs')

const bundledRoot = path.resolve(__dirname, '..', 'node_modules', 'dsh-plugin-marketplace')
const execFileAsync = promisify(execFile)
const yamlJsTag = { tag: 'tag:yaml.org,2002:js', resolve: value => value }

test('marketplace owns one persistent profile patch across repeated boots', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-marketplace-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profileRoot = path.join(dshHome, 'profiles', 'web')
  const { initProfile, loadProfile, PROFILE_TEMPLATES } = await import('@deepseek-ai/dsh-app-boot')
  initProfile(profileRoot, PROFILE_TEMPLATES.web)
  const first = await ensurePluginMarketplace({ dshHome, bundledRoot })
  assert.equal(first.action, 'installed')
  assert.equal(first.patchChanged, true)
  assert.equal(first.bundleRemoved, false)
  assert.equal(first.compatibilityReady, true)
  assert.equal(first.translationReady, true)
  await access(path.join(first.destination, 'lib', 'index.js'))
  const translatedClient = await readFile(path.join(first.destination, 'lib', 'client.js'), 'utf8')
  assert.match(translatedClient, /HARNESS_DESKTOP_AUTO_ZH_SUMMARY_V1/)
  assert.match(translatedClient, /自动翻译/)
  const second = await ensurePluginMarketplace({ dshHome, bundledRoot })
  assert.equal(second.action, 'preserved')
  assert.equal(second.patchChanged, false)
  assert.equal(second.bundleRemoved, false)
  assert.equal(second.translationReady, true)
  const manifest = JSON.parse(await readFile(path.join(profileRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.dsh.profile.bundles.includes('dsh-plugin-marketplace'), false)
  const patch = YAML.parse(await readFile(path.join(profileRoot, 'cordis.patch.yml'), 'utf8'))
  const marketplaceEntries = patch.flatMap(row => row.insert || []).filter(row => row.name === 'dsh-plugin-marketplace')
  assert.equal(marketplaceEntries.length, 1)
  assert.deepEqual(marketplaceEntries[0].inject, ['webServer'])

  const installAnchor = path.resolve(__dirname, '..', 'package.json')
  const firstBoot = loadProfile('marketplace-test', 'web', installAnchor, dshHome)
  const secondBoot = loadProfile('marketplace-test', 'web', installAnchor, dshHome)
  for (const boot of [firstBoot, secondBoot]) {
    assert.deepEqual(boot.layers.map(layer => layer.packageName), PROFILE_TEMPLATES.web)
    assert.equal(boot.patches.flatMap(row => row.insert || []).filter(row => row.name === 'dsh-plugin-marketplace').length, 1)
  }
})

test('desktop ownership prevents upstream apply from deleting its only patch registration', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-marketplace-apply-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const result = await ensurePluginMarketplace({ dshHome, bundledRoot })
  const patchFile = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  const script = `
    import { readFile } from 'node:fs/promises';
    globalThis.fetch = async () => ({ ok: false, status: 503, headers: { get: () => null } });
    const before = await readFile(${JSON.stringify(patchFile)}, 'utf8');
    const marketplace = await import(${JSON.stringify(pathToFileURL(path.join(result.destination, 'lib', 'index.js')).href)});
    const registrations = [];
    marketplace.apply({
      get: () => ({ tapIndex: () => {}, register: entry => registrations.push(entry) }),
      logger: { warn: () => {} }
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    const after = await readFile(${JSON.stringify(patchFile)}, 'utf8');
    if (after !== before) throw new Error('marketplace apply deleted the desktop-owned patch');
    if (!registrations.some(entry => entry.path === '/api/marketplace/self-update')) throw new Error('marketplace did not register its routes');
  `
  await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      HARNESS_DESKTOP_MARKETPLACE_PATCH_OWNER: '1'
    },
    timeout: 10_000
  })
})

test('official bundle registration migrates to one patch while preserving custom YAML tags', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-marketplace-patch-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profile = path.join(dshHome, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  const manifest = {
    name: 'dsh-profile-web',
    dependencies: { 'dsh-plugin-marketplace': 'github:bradeGithub/DSH-Plugins-Marketplace' },
    dsh: { profile: { bundles: ['base-bundle', 'dsh-plugin-marketplace'] } }
  }
  await writeFile(path.join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(path.join(profile, 'cordis.patch.yml'), '- insert:\n    - id: existing\n      config: !!js process.platform\n    - id: legacy-market\n      name: dsh-plugin-marketplace\n- insert:\n    - id: plugin-marketplace\n      name: stale-marketplace-alias\n      inject: [wrong-service]\n  remove:\n    - id: keep-this-remove\n')
  const result = await ensurePluginMarketplace({ dshHome, bundledRoot })
  assert.equal(result.bundleRemoved, true)
  assert.equal(result.patchChanged, true)
  const text = await readFile(path.join(profile, 'cordis.patch.yml'), 'utf8')
  assert.match(text, /id: existing/)
  assert.match(text, /!!js process\.platform/)
  assert.match(text, /name: dsh-plugin-marketplace/)
  assert.match(text, /remove:[\s\S]*id: keep-this-remove/)
  assert.doesNotMatch(text, /legacy-market|stale-marketplace-alias|wrong-service/)
  const entries = YAML.parse(text, { customTags: [yamlJsTag] }).flatMap(row => row.insert || []).filter(entry => entry.id === 'plugin-marketplace' || entry.name === 'dsh-plugin-marketplace')
  assert.deepEqual(entries, [{ id: 'plugin-marketplace', name: 'dsh-plugin-marketplace', inject: ['webServer'] }])
  const after = JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8'))
  assert.deepEqual(after.dsh.profile.bundles, ['base-bundle'])
  assert.equal(after.dependencies['dsh-plugin-marketplace'], manifest.dependencies['dsh-plugin-marketplace'])
})

test('an existing official patch stays idempotent without rewriting its dependency source', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-marketplace-bundle-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profile = path.join(dshHome, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  const manifest = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { 'dsh-plugin-marketplace': 'github:bradeGithub/DSH-Plugins-Marketplace' },
    dsh: { profile: { bundles: ['base-bundle'] } },
    custom: { keep: true }
  }
  await writeFile(path.join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(path.join(profile, 'cordis.patch.yml'), '- insert:\n    - id: plugin-marketplace\n      name: dsh-plugin-marketplace\n      inject: [webServer]\n')

  const result = await ensurePluginMarketplace({ dshHome, bundledRoot })

  assert.equal(result.bundleRemoved, false)
  assert.equal(result.patchChanged, false)
  const after = JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8'))
  assert.deepEqual(after, manifest)
  const entries = YAML.parse(await readFile(path.join(profile, 'cordis.patch.yml'), 'utf8')).flatMap(row => row.insert || [])
  assert.equal(entries.filter(entry => entry.name === 'dsh-plugin-marketplace').length, 1)
})

test('a trusted older CLI bundle upgrades before desktop patch ownership migration without state', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-marketplace-old-cli-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profile = path.join(dshHome, 'profiles', 'web')
  const destination = path.join(profile, 'node_modules', 'dsh-plugin-marketplace')
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(bundledRoot, destination, { recursive: true })
  const packageFile = path.join(destination, 'package.json')
  const installedPackage = JSON.parse(await readFile(packageFile, 'utf8'))
  installedPackage.version = '1.3.5'
  await writeFile(packageFile, `${JSON.stringify(installedPackage, null, 2)}\n`)
  await writeFile(path.join(destination, 'lib', 'index.js'), 'export function apply() {}\n')
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { 'dsh-plugin-marketplace': 'github:bradeGithub/DSH-Plugins-Marketplace' },
    dsh: { profile: { bundles: ['dsh-plugin-marketplace'] } }
  }, null, 2))

  const result = await ensurePluginMarketplace({ dshHome, bundledRoot })

  assert.equal(result.action, 'updated')
  assert.equal(result.bundleRemoved, true)
  assert.equal(result.compatibilityReady, true)
  assert.equal(JSON.parse(await readFile(packageFile, 'utf8')).version, '1.5.5')
  assert.match(await readFile(path.join(destination, 'lib', 'index.js'), 'utf8'), /HARNESS_DESKTOP_MARKETPLACE_PATCH_OWNER_V1/)
})

test('a newer user-updated marketplace is never overwritten by a desktop update', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-marketplace-newer-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const destination = path.join(dshHome, 'profiles', 'web', 'node_modules', 'dsh-plugin-marketplace')
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(bundledRoot, destination, { recursive: true })
  const pkgFile = path.join(destination, 'package.json')
  const pkg = JSON.parse(await readFile(pkgFile, 'utf8'))
  pkg.version = '9.9.9'
  await writeFile(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
  await writeFile(path.join(dshHome, 'harness-desktop-marketplace.json'), JSON.stringify({ managed: true }))
  const result = await ensurePluginMarketplace({ dshHome, bundledRoot })
  assert.equal(result.action, 'preserved')
  assert.equal(JSON.parse(await readFile(pkgFile, 'utf8')).version, '9.9.9')
  assert.equal(result.translationReady, false)
})

test('a same-name package from another repository is never activated or registered', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-marketplace-conflict-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profile = path.join(dshHome, 'profiles', 'web')
  const destination = path.join(profile, 'node_modules', 'dsh-plugin-marketplace')
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(bundledRoot, destination, { recursive: true })
  const installedManifestFile = path.join(destination, 'package.json')
  const installedManifest = JSON.parse(await readFile(installedManifestFile, 'utf8'))
  installedManifest.repository.url = 'https://github.com/example/untrusted-marketplace.git'
  await writeFile(installedManifestFile, `${JSON.stringify(installedManifest, null, 2)}\n`)

  const profileManifestFile = path.join(profile, 'package.json')
  const patchFile = path.join(profile, 'cordis.patch.yml')
  const profileManifestBefore = '{\n  "name": "dsh-profile-web",\n  "custom": true\n}\n'
  const patchBefore = '- insert:\n    - id: existing\n      name: trusted-existing-plugin\n'
  await writeFile(profileManifestFile, profileManifestBefore)
  await writeFile(patchFile, patchBefore)

  const result = await ensurePluginMarketplace({ dshHome, bundledRoot })

  assert.equal(result.action, 'conflict')
  assert.equal(result.patchChanged, false)
  assert.equal(result.bundleRemoved, false)
  assert.equal(result.compatibilityReady, false)
  assert.match(result.warning, /example\/untrusted-marketplace/)
  assert.equal(await readFile(profileManifestFile, 'utf8'), profileManifestBefore)
  assert.equal(await readFile(patchFile, 'utf8'), patchBefore)
  await assert.rejects(access(path.join(dshHome, 'harness-desktop-marketplace.json')), { code: 'ENOENT' })
})

test('a same-name package without a verifiable repository is never activated', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-marketplace-unknown-source-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const destination = path.join(dshHome, 'profiles', 'web', 'node_modules', 'dsh-plugin-marketplace')
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(bundledRoot, destination, { recursive: true })
  const packageFile = path.join(destination, 'package.json')
  const installedPackage = JSON.parse(await readFile(packageFile, 'utf8'))
  delete installedPackage.repository
  await writeFile(packageFile, `${JSON.stringify(installedPackage, null, 2)}\n`)

  const result = await ensurePluginMarketplace({ dshHome, bundledRoot })

  assert.equal(result.action, 'conflict')
  assert.equal(result.compatibilityReady, false)
  assert.match(result.warning, /未知来源/)
  await assert.rejects(access(path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml')), { code: 'ENOENT' })
  await assert.rejects(access(path.join(dshHome, 'harness-desktop-marketplace.json')), { code: 'ENOENT' })
})

test('marketplace installation copies only the audited runtime files without directory enumeration', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-marketplace-runtime-files-'))
  const dshHome = path.join(root, 'dsh-home')
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await ensurePluginMarketplace({ dshHome, bundledRoot })

  assert.equal(result.action, 'installed')
  for (const relative of MARKETPLACE_RUNTIME_FILES) {
    await access(path.join(result.destination, ...relative.split('/')))
  }
  await assert.rejects(access(path.join(result.destination, 'README.md')), { code: 'ENOENT' })
  await assert.rejects(access(path.join(result.destination, 'scripts')), { code: 'ENOENT' })
})
