const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const root = path.resolve(__dirname, '..')
const {
  encodeAndroidVersionCode,
  parseProperties,
  readAndroidMobileVersion
} = require('../scripts/mobile-release-version.cjs')

test('Android revision versions remain monotonic across the next integration patch', () => {
  assert.equal(encodeAndroidVersionCode('1.0.49'), 1_004_900)
  assert.equal(encodeAndroidVersionCode('1.0.49.1'), 1_004_901)
  assert.equal(encodeAndroidVersionCode('1.0.49.99'), 1_004_999)
  assert.equal(encodeAndroidVersionCode('1.0.50'), 1_005_000)
  assert.equal(encodeAndroidVersionCode('1.0.51'), 1_005_100)
  assert.equal(encodeAndroidVersionCode('1.0.52'), 1_005_200)
  assert.equal(encodeAndroidVersionCode('1.0.53'), 1_005_300)
  assert.equal(encodeAndroidVersionCode('1.0.54'), 1_005_400)
  assert.equal(encodeAndroidVersionCode('1.0.55'), 1_005_500)
  assert.equal(encodeAndroidVersionCode('1.0.57'), 1_005_700)
})

test('checked-in Android mobile version has the unified 1.0.57 release identity', () => {
  const version = readAndroidMobileVersion(root)
  assert.deepEqual(version, {
    integrationVersion: '1.0.57',
    versionName: '1.0.57',
    versionCode: 1_005_700,
    tag: 'android-v1.0.57',
    assetName: 'Harness-Mobile-1.0.57-android-universal.apk',
    checksumName: 'Harness-Mobile-1.0.57-android-universal.apk.sha256'
  })
})

test('Android mobile version properties reject drift and ambiguous input', () => {
  assert.throws(() => encodeAndroidVersionCode('1.0.46.100'), /between 0 and 99/u)
  assert.throws(() => encodeAndroidVersionCode('1.0.46-beta'), /x\.y\.z/u)
  assert.throws(() => parseProperties('versionName=1.0.48\nversionName=1.0.49\n'), /duplicate/u)
})

test('Gradle consumes the reviewed default while allowing the publisher to pin an immutable tag identity', () => {
  const build = fs.readFileSync(path.join(root, 'mobile/android/app/build.gradle.kts'), 'utf8')
  assert.match(build, /providers\.gradleProperty\("HARNESS_MOBILE_VERSION_NAME"\)/u)
  assert.match(build, /providers\.gradleProperty\("HARNESS_MOBILE_VERSION_CODE"\)/u)
  assert.match(build, /must be supplied together/u)
  assert.match(build, /mobileVersionNameOverride[\s\S]*version\.properties/u)
  assert.match(build, /mobileVersionCodeOverride[\s\S]*version\.properties/u)
})
