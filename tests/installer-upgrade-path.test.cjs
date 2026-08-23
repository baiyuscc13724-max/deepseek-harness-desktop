const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const installer = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.iss'), 'utf8')

test('Windows installer preserves both current Inno and legacy NSIS install directories', () => {
  assert.match(installer, /AppId=\{\{\{#MyAppId\}\}/)
  assert.match(installer, /UsePreviousAppDir=yes/)
  assert.match(installer, /DefaultDirName=\{code:GetDefaultDirName\}/)
  assert.match(installer, /#ifndef MySourceDir/)
  assert.match(installer, /#ifndef MyOutputDir/)
  assert.match(installer, /#ifndef MyOutputBaseFilename/)
  assert.match(installer, /ReadRegisteredInstallDirectory\(HKCU, '\{#MyUninstallKey\}'/)
  assert.match(installer, /FindLegacyInstallDirectory\(HKLM64, Directory\)/)
  assert.match(installer, /RegQueryStringValue\(RootKey, Subkey, 'InstallLocation'/)
  assert.match(installer, /RegQueryStringValue\(RootKey, Subkey, 'DisplayIcon'/)
  assert.match(installer, /FileExists\(AddBackslash\(Directory\) \+ '\{#MyAppExeName\}'\)/)
})

test('Windows installer closes the running desktop before replacing locked runtime DLLs', () => {
  assert.match(installer, /^CloseApplications=force$/m)
  assert.match(installer, /^RestartApplications=no$/m)
  assert.doesNotMatch(installer, /^CloseApplications=yes$/m)
  assert.doesNotMatch(installer, /^CloseApplications=no$/m)
})
