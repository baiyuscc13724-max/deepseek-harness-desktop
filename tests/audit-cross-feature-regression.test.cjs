'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const V3 = '2171f31250c0970d1cc9a9733a241364306d99146e5baec8d0775066d7ae3388'
const V4 = '28a7850e44bc24cdd0e5e7222eb0fe655877d1433db59f8ff435934528ba0207'
const hash = source => createHash('sha256').update(source).digest('hex')
const installedSource = () => readFile(path.join(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), 'utf8')
async function fixture(source, run, name = '@deepseek-ai/dsh-llm-pi-ai') {
  const dir = await mkdtemp(path.join(__dirname, '.audit-cross-'))
  const file = path.join(dir, 'lib/index.js')
  try {
    await mkdir(path.dirname(file))
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.1.2-alpha.5', type: 'module' }))
    await writeFile(file, source)
    return await run(file)
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 3 }) }
}

test('audit: provider output bytes are independently pinned and source patch is idempotent', async () => {
  const { patchProviderAuthIsolationSource: patch } = await import('../scripts/provider-auth-isolation-patch.mjs')
  const source = await installedSource()
  assert.ok([V3, V4].includes(hash(source)), 'this audit requires a known v3 or v4 source, never an arbitrary marker')
  const output = patch(source)
  assert.equal(hash(output.source), V4)
  assert.equal(patch(output.source).changed, false)
  assert.equal(patch(output.source).source, output.source)
})

test('audit: exact legacy v3 install migrates to v4 and reinstallation is a byte-stable no-op', async t => {
  const source = await installedSource()
  if (hash(source) !== V3) { t.skip('legacy v3 bytes are not present; do not fabricate a migration input'); return }
  const { patchInstalledProviderAuthIsolation: install } = await import('../scripts/patch-official-runtime.mjs')
  await fixture(source, async file => {
    assert.equal(await install(file), true)
    assert.equal(hash(await readFile(file)), V4)
    assert.equal(await install(file), false)
    assert.equal(hash(await readFile(file)), V4)
  })
})

test('audit: complete marked but unknown bytes and wrong package identity never get rewritten', async () => {
  const { patchProviderAuthIsolationSource: patch } = await import('../scripts/provider-auth-isolation-patch.mjs')
  const { patchInstalledProviderAuthIsolation: install } = await import('../scripts/patch-official-runtime.mjs')
  const output = patch(await installedSource()).source
  for (const source of [output + '\n// unknown byte change\n', output.replace('function modelProviderDiscoveryRouteMatches', 'function invalidRouteMatcher')]) {
    await fixture(source, async file => {
      await assert.rejects(install(file), /neither exact official nor an exact complete/)
      assert.equal(await readFile(file, 'utf8'), source, 'failed gate mutated fixture bytes')
    })
  }
  await fixture(output, async file => {
    await assert.rejects(install(file), /identity changed/)
    assert.equal(await readFile(file, 'utf8'), output)
  }, '@synthetic/foreign-package')
})

test('audit: known complete v4 is accepted unchanged and incomplete v4 source is rejected', async () => {
  const { patchProviderAuthIsolationSource: patch } = await import('../scripts/provider-auth-isolation-patch.mjs')
  const { patchInstalledProviderAuthIsolation: install } = await import('../scripts/patch-official-runtime.mjs')
  const source = patch(await installedSource()).source
  await fixture(source, async file => {
    assert.equal(await install(file), false)
    assert.equal(await readFile(file, 'utf8'), source)
  })
  assert.throws(() => patch(source.replace('preparedCredential.model !== options.model', 'false')), /incomplete/)
})
