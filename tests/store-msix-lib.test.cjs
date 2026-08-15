const assert = require('node:assert/strict')
const test = require('node:test')

test('Store manifest rendering uses a four-part version and escapes identity fields', async () => {
  const { msixVersion, renderStoreManifest } = await import('../scripts/store-msix-lib.mjs')
  assert.equal(msixVersion('1.0.9'), '1.0.9.0')
  const template = '<Identity Name="__PACKAGE_IDENTITY_NAME__" Publisher="__PUBLISHER__" Version="__VERSION__"/><P>__PUBLISHER_DISPLAY_NAME__ __DISPLAY_NAME__</P>'
  const result = renderStoreManifest(template, {
    packageIdentityName: '12345HarnessDesktop',
    publisher: 'CN=1234-5678',
    publisherDisplayName: 'Harness & Co',
    displayName: 'Harness Desktop'
  }, '1.0.9')
  assert.match(result, /Version="1\.0\.9\.0"/)
  assert.match(result, /Harness &amp; Co/)
  assert.doesNotMatch(result, /__[A-Z0-9_]+__/)
})

test('placeholder Partner Center identity is rejected', async () => {
  const { validateStoreIdentity } = await import('../scripts/store-msix-lib.mjs')
  assert.throws(() => validateStoreIdentity({
    packageIdentityName: 'PASTE_PARTNER_CENTER_PACKAGE_IDENTITY_NAME',
    publisher: 'CN=placeholder',
    publisherDisplayName: 'placeholder'
  }), /not filled/)
})
