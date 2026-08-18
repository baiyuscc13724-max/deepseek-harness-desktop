const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { normalizeFeedUrls, resolveUpdateFeeds } = require('../electron/bridge/update-feed-config.cjs')

test('update feed configuration prefers environment, then local config, then fallback', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'harness-feeds-'))
  const config = path.join(temp, 'feeds.json')
  try {
    await writeFile(config, JSON.stringify({ feeds: ['https://cnb.cool/example/release.json', 'https://github.example/release.json'] }))
    assert.deepEqual(await resolveUpdateFeeds({ environment: {}, configPaths: [config], fallback: ['https://github.example/release.json'] }), [
      'https://cnb.cool/example/release.json',
      'https://github.example/release.json'
    ])
    assert.deepEqual(await resolveUpdateFeeds({
      environment: { HARNESS_DESKTOP_UPDATE_FEEDS: 'https://cnb.cool/example/release.json;https://github.example/release.json' },
      configPaths: [config]
    }), ['https://cnb.cool/example/release.json', 'https://github.example/release.json'])
    assert.deepEqual(await resolveUpdateFeeds({ environment: {}, configPaths: [path.join(temp, 'missing.json')], fallback: ['https://github.example/release.json'] }), ['https://github.example/release.json'])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('update feed configuration requires public HTTPS URLs', () => {
  assert.throws(() => normalizeFeedUrls(['http://example.test/release.json']), /HTTPS/)
  assert.throws(() => normalizeFeedUrls(['https://user:pass@example.test/release.json']), /账号或密码/)
})
