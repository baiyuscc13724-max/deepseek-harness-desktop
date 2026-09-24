'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const PACKAGE = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai')
const INSTALLED = path.join(PACKAGE, 'lib', 'index.js')
const digest = value => createHash('sha256').update(value).digest('hex').toUpperCase()

// Stage one source in the exact layout the installer resolves its package identity from.
async function stage(root, source, name = 'index.js') {
  const packageRoot = path.join(root, name.replace(/\.js$/u, ''), 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai')
  await mkdir(path.join(packageRoot, 'lib'), { recursive: true })
  await copyFile(path.join(PACKAGE, 'package.json'), path.join(packageRoot, 'package.json'))
  const target = path.join(packageRoot, 'lib', 'index.js')
  await writeFile(target, source)
  return target
}

test('provider-auth isolation pins are exactly the artifacts its own transform produces', async t => {
  const installer = await import(pathToFileURL(path.join(ROOT, 'scripts', 'patch-official-runtime.mjs')).href)
  const transform = await import(pathToFileURL(path.join(ROOT, 'scripts', 'provider-auth-isolation-patch.mjs')).href)
  const installed = await readFile(INSTALLED, 'utf8')
  // A pristine official runtime is what a clean `npm ci` installs; a patched one is what a
  // developer machine holds after its own postinstall. Both are legitimate starting states.
  const pristine = transform.patchProviderAuthIsolationSource(installed).changed === true
  const root = await mkdtemp(path.join(os.tmpdir(), 'provider-auth-pin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  try {
    const target = await stage(root, installed, 'installed.js')
    assert.equal(await installer.patchInstalledProviderAuthIsolation(target), pristine)
    const artifact = await readFile(target, 'utf8')
    assert.equal(await installer.patchInstalledProviderAuthIsolation(target), false, 'installing a canonical artifact is a no-op')
    assert.equal(await readFile(target, 'utf8'), artifact)
    assert.equal(artifact.includes('@harness-desktop/provider-auth-isolation-v4'), true, 'the installed runtime carries the reviewed v4 isolation patch')

    if (pristine) {
      // The guard already refuses any transform output that is not the pinned artifact, so a
      // successful install above binds the pins to the transform. Verify the stronger claim:
      // every accepted entry point converges on that one artifact.
      const stages = transform.providerAuthIsolationCanonicalStages(installed)
      assert.equal(digest(stages.v4), digest(artifact), 'the pinned artifact is the transform output')
      for (const [name, source] of Object.entries(stages)) {
        const stageTarget = await stage(root, source, `${name}.js`)
        assert.equal(await installer.patchInstalledProviderAuthIsolation(stageTarget), name !== 'v4')
        assert.equal(digest(await readFile(stageTarget, 'utf8')), digest(artifact), `${name} must converge on the pinned artifact`)
      }
    }

    const driftTarget = await stage(root, `${artifact}\n// drift\n`, 'drift.js')
    await assert.rejects(installer.patchInstalledProviderAuthIsolation(driftTarget), /neither exact official nor an exact complete/)
    assert.equal(await readFile(driftTarget, 'utf8'), `${artifact}\n// drift\n`, 'a rejected artifact is never rewritten')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
