const assert = require('node:assert/strict')
const test = require('node:test')

const { distributionInfo, isStoreDistribution } = require('../electron/distribution.cjs')

test('direct builds keep direct-only content and updater available', () => {
  const options = { windowsStore: false, env: {} }
  assert.equal(isStoreDistribution(options), false)
  assert.deepEqual(distributionInfo(options), {
    channel: 'direct',
    store: false,
    appUpdatesManagedByStore: false,
    nonCommercialContentAvailable: true,
    desktopPetAvailable: true,
    links: distributionInfo(options).links
  })
})

test('MSIX and explicit store builds use the Store policy', () => {
  for (const options of [
    { windowsStore: true, env: {} },
    { windowsStore: false, env: { HARNESS_DESKTOP_STORE_BUILD: '1' } }
  ]) {
    const info = distributionInfo(options)
    assert.equal(info.store, true)
    assert.equal(info.appUpdatesManagedByStore, true)
    assert.equal(info.nonCommercialContentAvailable, false)
    assert.equal(info.desktopPetAvailable, false)
    assert.match(info.links.privacy, /^https:\/\//)
    assert.match(info.links.aiReport, /^https:\/\//)
  }
})
