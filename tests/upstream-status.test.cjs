'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(process.env.DSH_ALPHA3_CANDIDATE_ROOT || path.resolve(__dirname, '..'))

async function statusSelectors() {
  return import(pathToFileURL(path.join(ROOT, 'scripts', 'upstream-status.mjs')).href)
}

test('alpha.3 runtime pin compares the npm alpha channel rather than latest rc.2', async () => {
  const { selectRuntimeNpmTag, selectRuntimeNpmVersion } = await statusSelectors()
  const metadata = { 'dist-tags': { alpha: '0.1.2-alpha.3', latest: '0.1.1-rc.2' } }

  assert.equal(selectRuntimeNpmTag('0.1.2-alpha.3'), 'alpha')
  assert.equal(selectRuntimeNpmVersion('0.1.2-alpha.3', metadata), '0.1.2-alpha.3')
  assert.notEqual(selectRuntimeNpmVersion('0.1.2-alpha.3', metadata), metadata['dist-tags'].latest)
})

test('stable runtime pins continue to compare the npm latest channel', async () => {
  const { selectRuntimeNpmTag, selectRuntimeNpmVersion } = await statusSelectors()
  const metadata = { 'dist-tags': { alpha: '0.1.2-alpha.3', latest: '0.1.2' } }

  assert.equal(selectRuntimeNpmTag('0.1.2'), 'latest')
  assert.equal(selectRuntimeNpmVersion('0.1.2', metadata), '0.1.2')
  assert.equal(selectRuntimeNpmVersion('0.1.2', { 'dist-tags': {} }), null)
})
