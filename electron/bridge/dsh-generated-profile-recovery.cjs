const { mkdir, open, rename, rm } = require('node:fs/promises')
const path = require('node:path')

const GENERATED_WEB_PROFILE_ROOT = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

const DUPLICATE_LOADER_ENTRY_PATTERN = /\bduplicate loader entry id:\s*[^\s,;\])}]+/iu
const MAX_RUNTIME_DIAGNOSTIC_CHARS = 16_000

function appendBoundedRuntimeDiagnostic(current, chunk) {
  return `${String(current || '')}${String(chunk || '')}`.slice(-MAX_RUNTIME_DIAGNOSTIC_CHARS)
}

function isRecoverableGeneratedProfileFailure(diagnostic) {
  return DUPLICATE_LOADER_ENTRY_PATTERN.test(String(diagnostic || ''))
}

async function atomicWriteGeneratedRoot(rootFile) {
  const temporary = `${rootFile}.desktop-${process.pid}-${Date.now()}.tmp`
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(GENERATED_WEB_PROFILE_ROOT, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, rootFile)
  } finally {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function resetGeneratedWebProfileRoot({ dshHome }) {
  if (!String(dshHome || '').trim()) throw new TypeError('DSH home is required to reset the generated Web profile root.')
  const profileRoot = path.join(path.resolve(String(dshHome)), 'profiles', 'web')
  const rootFile = path.join(profileRoot, 'cordis.yml')
  await mkdir(profileRoot, { recursive: true, mode: 0o700 })
  await atomicWriteGeneratedRoot(rootFile)
  return { rootFile, bytes: Buffer.byteLength(GENERATED_WEB_PROFILE_ROOT) }
}

module.exports = {
  DUPLICATE_LOADER_ENTRY_PATTERN,
  GENERATED_WEB_PROFILE_ROOT,
  MAX_RUNTIME_DIAGNOSTIC_CHARS,
  appendBoundedRuntimeDiagnostic,
  isRecoverableGeneratedProfileFailure,
  resetGeneratedWebProfileRoot
}
