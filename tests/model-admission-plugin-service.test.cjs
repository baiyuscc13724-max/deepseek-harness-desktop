const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const {
  ensureModelAdmissionPlugin,
  ensurePatchEntry,
  validateManifest
} = require('../electron/bridge/model-admission-plugin-service.cjs')

const bundledRoot = path.resolve(__dirname, '..', 'plugins', 'dsh-model-admission')
const validManifest = {
  name: 'dsh-model-admission',
  version: '1.0.40',
  type: 'module',
  main: 'lib/index.js',
  exports: { '.': './lib/index.js', './package.json': './package.json' }
}

async function fixtureBundle(root, manifest = validManifest, entry = 'export const name = "fixture"\n') {
  const bundle = path.join(root, 'bundle')
  await mkdir(path.join(bundle, 'lib'), { recursive: true })
  await writeFile(path.join(bundle, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  if (entry !== null) await writeFile(path.join(bundle, 'lib', 'index.js'), entry, 'utf8')
  return bundle
}

async function missing(file) {
  try {
    await access(file)
    return false
  } catch (error) {
    if (error.code === 'ENOENT') return true
    throw error
  }
}

test('Host-only model admission plugin installs atomically and patches the Web profile idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'model-admission-plugin-'))
  try {
    const first = await ensureModelAdmissionPlugin({ dshHome: root, bundledRoot })
    const second = await ensureModelAdmissionPlugin({ dshHome: root, bundledRoot })
    assert.equal(first.patchChanged, true)
    assert.equal(second.patchChanged, false)
    assert.equal(first.version, '1.0.40')

    const patch = await readFile(path.join(root, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')
    assert.equal((patch.match(/dsh-model-admission/g) || []).length, 1)
    assert.equal((patch.match(/id: model-admission/g) || []).length, 1)
    assert.match(patch, /name: dsh-model-admission/u)

    const installedManifest = JSON.parse(await readFile(path.join(first.destination, 'package.json'), 'utf8'))
    const installedCore = await readFile(path.join(first.destination, 'lib', 'index.js'), 'utf8')
    assert.equal(installedManifest.name, 'dsh-model-admission')
    assert.equal(installedManifest.dsh?.client, undefined)
    assert.match(installedCore, /ctx\.on\("llm\/stream"/u)
    assert.match(installedCore, /isAgentLoopRequest/u)
    assert.equal((await readdir(path.dirname(first.destination))).some(name => /\.desktop-|\.backup-/u.test(name)), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('manifest validation is strict and keeps the plugin Host-only', async () => {
  const accepted = { ...validManifest }
  assert.equal(validateManifest(accepted), accepted)
  const invalid = [
    [{ ...validManifest, name: 'other-plugin' }, /name/u],
    [{ ...validManifest, version: '1.0.40-beta.1' }, /version/u],
    [{ ...validManifest, type: 'commonjs' }, /type=module/u],
    [{ ...validManifest, main: 'index.js' }, /入口/u],
    [{ ...validManifest, exports: { '.': './other.js' } }, /入口/u],
    [{ ...validManifest, dsh: { client: { platform: 'web' } } }, /Host-only/u]
  ]
  for (const [manifest, expected] of invalid) assert.throws(() => validateManifest(manifest), expected)

  const root = await mkdtemp(path.join(os.tmpdir(), 'model-admission-manifest-'))
  try {
    const invalidBundle = await fixtureBundle(root, { ...validManifest, dsh: { client: { platform: 'web' } } })
    await assert.rejects(
      ensureModelAdmissionPlugin({ dshHome: path.join(root, 'home'), bundledRoot: invalidBundle }),
      /Host-only/u
    )
    assert.equal(await missing(path.join(root, 'home', 'profiles', 'web', 'node_modules', 'dsh-model-admission')), true)

    await rm(invalidBundle, { recursive: true, force: true })
    const missingEntryBundle = await fixtureBundle(root, validManifest, null)
    await assert.rejects(
      ensureModelAdmissionPlugin({ dshHome: path.join(root, 'home'), bundledRoot: missingEntryBundle }),
      /缺少 lib\/index\.js/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('conflicting patch aliases are rejected without rewriting the file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'model-admission-conflict-'))
  try {
    const patchFile = path.join(root, 'cordis.patch.yml')
    const conflict = '- insert:\n    - id: model-admission\n      name: wrong-package\n'
    await writeFile(patchFile, conflict, 'utf8')
    await assert.rejects(ensurePatchEntry(patchFile), /冲突/u)
    assert.equal(await readFile(patchFile, 'utf8'), conflict)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failure after patch publication restores the previous plugin and exact patch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'model-admission-rollback-'))
  try {
    const first = await ensureModelAdmissionPlugin({ dshHome: root, bundledRoot })
    const sentinel = path.join(first.destination, 'previous-install.txt')
    await writeFile(sentinel, 'keep previous install', 'utf8')
    const patchFile = path.join(root, 'profiles', 'web', 'cordis.patch.yml')
    const patchBefore = '- insert:\n    - id: existing\n      name: existing-plugin\n'
    await writeFile(patchFile, patchBefore, 'utf8')

    await assert.rejects(
      ensureModelAdmissionPlugin(
        { dshHome: root, bundledRoot },
        { afterPatch: async () => { throw new Error('injected publication failure') } }
      ),
      /injected publication failure/u
    )
    assert.equal(await readFile(sentinel, 'utf8'), 'keep previous install')
    assert.equal(await readFile(patchFile, 'utf8'), patchBefore)
    assert.equal((await readdir(path.dirname(first.destination))).some(name => /\.desktop-|\.backup-/u.test(name)), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('first-install rollback removes a patch file that did not previously exist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'model-admission-first-rollback-'))
  try {
    const patchFile = path.join(root, 'profiles', 'web', 'cordis.patch.yml')
    const destination = path.join(root, 'profiles', 'web', 'node_modules', 'dsh-model-admission')
    await assert.rejects(
      ensureModelAdmissionPlugin(
        { dshHome: root, bundledRoot },
        { afterPatch: async () => { throw new Error('first publication failed') } }
      ),
      /first publication failed/u
    )
    assert.equal(await missing(patchFile), true)
    assert.equal(await missing(destination), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('desktop startup installs and packages the Host-only admission plugin before Agent Teams', async () => {
  const pkg = JSON.parse(await readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8'))
  const main = await readFile(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.ok(pkg.build.files.includes('plugins/dsh-model-admission/**/*'))
  assert.ok(pkg.build.asarUnpack.includes('plugins/dsh-model-admission/**/*'))
  assert.match(main, /ensureModelAdmissionPlugin\(modelAdmissionPluginOptions\(\)\)/u)
  assert.equal((main.match(/ensureModelAdmissionPlugin\(modelAdmissionPluginOptions\(\)\)/gu) || []).length, 2)
  assert.ok(main.indexOf('ensureModelAdmissionPlugin(modelAdmissionPluginOptions())') < main.indexOf('ensureAgentTeamsPlugin(agentTeamsPluginOptions())'))
})
