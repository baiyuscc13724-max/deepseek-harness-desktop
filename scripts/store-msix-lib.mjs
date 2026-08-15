import { readFile } from 'node:fs/promises'
import path from 'node:path'

const REQUIRED_IDENTITY_FIELDS = ['packageIdentityName', 'publisher', 'publisherDisplayName']

export function msixVersion(version) {
  const numeric = String(version || '').split('-')[0].split('.')
  if (numeric.length < 1 || numeric.length > 4 || numeric.some(part => !/^\d+$/.test(part))) {
    throw new Error(`Invalid application version for MSIX: ${version}`)
  }
  const parts = [...numeric, '0', '0', '0'].slice(0, 4).map(Number)
  if (parts.some(part => part < 0 || part > 65535)) throw new Error(`MSIX version component is out of range: ${version}`)
  return parts.join('.')
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&apos;')
}

export function validateStoreIdentity(identity) {
  if (!identity || typeof identity !== 'object') throw new Error('Store identity file is missing or invalid.')
  for (const field of REQUIRED_IDENTITY_FIELDS) {
    const value = String(identity[field] || '').trim()
    if (!value || /PASTE_|__/.test(value)) throw new Error(`Store identity field is not filled: ${field}`)
  }
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identity.packageIdentityName)) {
    throw new Error('packageIdentityName must exactly match the Partner Center package identity name.')
  }
  if (!/^CN=.+/i.test(identity.publisher)) {
    throw new Error('publisher must be the exact Partner Center Publisher value and normally starts with CN=.')
  }
  return {
    packageIdentityName: String(identity.packageIdentityName).trim(),
    publisher: String(identity.publisher).trim(),
    publisherDisplayName: String(identity.publisherDisplayName).trim(),
    displayName: String(identity.displayName || 'Harness Desktop').trim()
  }
}

export function renderStoreManifest(template, identity, version) {
  const clean = validateStoreIdentity(identity)
  const replacements = {
    __PACKAGE_IDENTITY_NAME__: clean.packageIdentityName,
    __PUBLISHER__: clean.publisher,
    __PUBLISHER_DISPLAY_NAME__: clean.publisherDisplayName,
    __DISPLAY_NAME__: clean.displayName,
    __VERSION__: msixVersion(version)
  }
  let manifest = template
  for (const [token, value] of Object.entries(replacements)) manifest = manifest.replaceAll(token, xmlEscape(value))
  if (/__[A-Z0-9_]+__/.test(manifest)) throw new Error('The generated manifest still contains an unresolved placeholder.')
  return manifest
}

export async function readStoreIdentity(root, { required = false } = {}) {
  const identityPath = path.resolve(process.env.STORE_IDENTITY_FILE || path.join(root, 'store', 'store-identity.json'))
  try {
    return { identityPath, identity: validateStoreIdentity(JSON.parse(await readFile(identityPath, 'utf8'))) }
  } catch (error) {
    if (required) throw new Error(`Partner Center identity is required at ${identityPath}: ${error.message}`)
    return { identityPath, identity: null, warning: error.message }
  }
}
