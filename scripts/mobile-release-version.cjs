const fs = require('node:fs')
const path = require('node:path')

const INTEGRATION_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u
const ANDROID_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/u
const MAX_ANDROID_VERSION_CODE = 2_100_000_000

function parseProperties(source) {
  const result = Object.create(null)
  for (const rawLine of String(source).split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) throw new Error(`Invalid Android mobile version property: ${rawLine}`)
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!key || !value || Object.hasOwn(result, key)) throw new Error(`Invalid or duplicate Android mobile version property: ${key || rawLine}`)
    result[key] = value
  }
  return result
}

function encodeAndroidVersionCode(versionName) {
  const match = String(versionName).match(ANDROID_VERSION_PATTERN)
  if (!match) throw new Error('Android mobile versionName must be x.y.z or x.y.z.r.')
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  const revision = match[4] === undefined ? 0 : Number(match[4])
  if (minor > 99 || patch > 99 || revision > 99) throw new Error('Android mobile minor, patch, and revision components must each be between 0 and 99.')
  const versionCode = major * 1_000_000 + minor * 10_000 + patch * 100 + revision
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > MAX_ANDROID_VERSION_CODE) {
    throw new Error('Android mobile versionCode is outside the supported Play-compatible range.')
  }
  return versionCode
}

function readAndroidMobileVersion(root = path.resolve(__dirname, '..')) {
  const propertiesPath = path.join(root, 'mobile', 'android', 'app', 'version.properties')
  const properties = parseProperties(fs.readFileSync(propertiesPath, 'utf8'))
  const integrationVersion = properties.integrationVersion
  const versionName = properties.versionName
  const declaredVersionCode = Number(properties.versionCode)
  if (!INTEGRATION_VERSION_PATTERN.test(integrationVersion || '')) throw new Error('Android mobile integrationVersion must be x.y.z.')
  if (versionName !== integrationVersion && !versionName.startsWith(`${integrationVersion}.`)) {
    throw new Error('Android mobile versionName must equal the integration version or add one numeric revision component.')
  }
  const expectedVersionCode = encodeAndroidVersionCode(versionName)
  if (!Number.isSafeInteger(declaredVersionCode) || declaredVersionCode !== expectedVersionCode) {
    throw new Error(`Android mobile versionCode must be ${expectedVersionCode} for ${versionName}.`)
  }
  return Object.freeze({
    integrationVersion,
    versionName,
    versionCode: declaredVersionCode,
    tag: `android-v${versionName}`,
    assetName: `Harness-Mobile-${versionName}-android-universal.apk`,
    checksumName: `Harness-Mobile-${versionName}-android-universal.apk.sha256`
  })
}

module.exports = {
  ANDROID_VERSION_PATTERN,
  encodeAndroidVersionCode,
  parseProperties,
  readAndroidMobileVersion
}
