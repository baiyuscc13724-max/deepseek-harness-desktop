const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')

test('Android and iOS mobile release preparation stays synchronized with the integration version', async () => {
  const [pkg, manifest, androidBuild, iosProject] = await Promise.all([
    readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'mobile', 'mobile-app-update.example.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'mobile', 'android', 'app', 'build.gradle.kts'), 'utf8'),
    readFile(path.join(root, 'mobile', 'ios', 'project.yml'), 'utf8')
  ])
  const [major, minor, patch] = pkg.version.split('.').map(Number)
  const expectedBuild = major * 10000 + minor * 100 + patch
  assert.equal(manifest.platforms.android.version, pkg.version)
  assert.equal(manifest.platforms.ios.version, pkg.version)
  assert.match(androidBuild, new RegExp(`versionCode = ${expectedBuild}\\b`))
  assert.match(androidBuild, new RegExp(`versionName = "${pkg.version.replaceAll('.', '\\.')}"`))
  assert.match(iosProject, new RegExp(`CURRENT_PROJECT_VERSION: ${expectedBuild}\\b`))
  assert.match(iosProject, new RegExp(`MARKETING_VERSION: ${pkg.version.replaceAll('.', '\\.')}`))
})
