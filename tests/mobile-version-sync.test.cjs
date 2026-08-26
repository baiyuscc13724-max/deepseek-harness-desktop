const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')
const { readAndroidMobileVersion } = require('../scripts/mobile-release-version.cjs')

const root = path.resolve(__dirname, '..')

test('Android and iOS stay unified with the desktop release while keeping platform-compatible build codes', async () => {
  const [pkg, manifest, androidBuild, iosProject] = await Promise.all([
    readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'mobile', 'mobile-app-update.example.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'mobile', 'android', 'app', 'build.gradle.kts'), 'utf8'),
    readFile(path.join(root, 'mobile', 'ios', 'project.yml'), 'utf8')
  ])
  const androidVersion = readAndroidMobileVersion(root)
  const [major, minor, patch] = pkg.version.split('.').map(Number)
  const iosBuild = major * 10000 + minor * 100 + patch

  assert.equal(androidVersion.integrationVersion, pkg.version)
  assert.equal(androidVersion.versionName, pkg.version)
  assert.equal(manifest.platforms.android.version, pkg.version)
  assert.equal(manifest.platforms.android.url, `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v${pkg.version}/Harness-Mobile-${pkg.version}-android-universal.apk`)
  assert.equal(manifest.platforms.ios.version, pkg.version)
  assert.match(androidBuild, /file\("version\.properties"\)/u)
  assert.match(androidBuild, /versionCode = mobileVersionCode/u)
  assert.match(androidBuild, /versionName = mobileVersionName/u)
  assert.match(iosProject, new RegExp(`CURRENT_PROJECT_VERSION: ${iosBuild}\\b`))
  assert.match(iosProject, new RegExp(`MARKETING_VERSION: ${pkg.version.replaceAll('.', '\\.')}`))
})
