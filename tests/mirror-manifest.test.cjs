const test = require('node:test')
const assert = require('node:assert/strict')

test('mirror manifest generates provider URLs in priority order and preserves existing fallbacks', async () => {
  const { addMirrorsToManifest } = await import('../scripts/mirror-manifest-lib.mjs')
  const result = addMirrorsToManifest({
    version: '1.2.3',
    tag_name: 'v1.2.3',
    assets: [{ name: 'Harness Desktop 1.2.3.exe', mirror_urls: ['https://old.example/existing.exe'], browser_download_url: 'https://github.example/setup.exe' }]
  }, {
    mirrors: [
      { id: 'cnb', priority: 10, urlTemplate: 'https://cnb.cool/example/harness-desktop/-/releases/download/{tag}/{fileEncoded}' }
    ]
  })

  assert.deepEqual(result.assets[0].mirror_urls, [
    'https://cnb.cool/example/harness-desktop/-/releases/download/v1.2.3/Harness%20Desktop%201.2.3.exe',
    'https://old.example/existing.exe'
  ])
  assert.equal(result.assets[0].browser_download_url, 'https://github.example/setup.exe')
})

test('mirror manifest rejects insecure templates and embedded credentials', async () => {
  const { renderMirrorUrl } = await import('../scripts/mirror-manifest-lib.mjs')
  const release = { version: '1.2.3', tag_name: 'v1.2.3' }
  assert.throws(() => renderMirrorUrl('http://example.test/{fileEncoded}', release, 'setup.exe'), /HTTPS/)
  assert.throws(() => renderMirrorUrl('https://user:pass@example.test/{fileEncoded}', release, 'setup.exe'), /账号或密码/)
  assert.throws(() => renderMirrorUrl('https://example.test/static.exe', release, 'setup.exe'), /\{file\}/)
})
