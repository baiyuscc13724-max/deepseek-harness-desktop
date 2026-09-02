const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, mkdir, readFile, readdir, rm, writeFile } = require('node:fs/promises')

const {
  GENERATED_WEB_PROFILE_ROOT,
  MAX_RUNTIME_DIAGNOSTIC_CHARS,
  appendBoundedRuntimeDiagnostic,
  isRecoverableGeneratedProfileFailure,
  resetGeneratedWebProfileRoot
} = require('../electron/bridge/dsh-generated-profile-recovery.cjs')

const mainFile = path.resolve(__dirname, '..', 'electron', 'main.cjs')

test('only a duplicate loader entry failure claims generated-profile recovery', () => {
  assert.equal(isRecoverableGeneratedProfileFailure('TypeError: duplicate loader entry id: dsh-android'), true)
  assert.equal(isRecoverableGeneratedProfileFailure('duplicate loader entry id: plugin-marketplace\n    at EntryGroup.update'), true)
  assert.equal(isRecoverableGeneratedProfileFailure('Cannot find module reflect-metadata'), false)
  assert.equal(isRecoverableGeneratedProfileFailure('DeepSeek Harness exited with code 1'), false)
  assert.equal(isRecoverableGeneratedProfileFailure(''), false)
})

test('runtime diagnostics remain bounded without breaking errors across stream chunks', () => {
  let diagnostic = appendBoundedRuntimeDiagnostic('', 'TypeError: duplicate loader ')
  diagnostic = appendBoundedRuntimeDiagnostic(diagnostic, 'entry id: dsh-android')
  assert.equal(isRecoverableGeneratedProfileFailure(diagnostic), true)
  assert.equal(appendBoundedRuntimeDiagnostic('x'.repeat(MAX_RUNTIME_DIAGNOSTIC_CHARS), 'tail').length, MAX_RUNTIME_DIAGNOSTIC_CHARS)
  assert.match(appendBoundedRuntimeDiagnostic('x'.repeat(MAX_RUNTIME_DIAGNOSTIC_CHARS), 'tail'), /tail$/u)
})

test('generated-profile recovery resets only cordis.yml and preserves user patches', async () => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-generated-profile-recovery-'))
  try {
    const profile = path.join(dshHome, 'profiles', 'web')
    const rootFile = path.join(profile, 'cordis.yml')
    const patchFile = path.join(profile, 'cordis.patch.yml')
    const patch = '- insert:\n    - id: dsh-android\n      name: "@zseven-w/dsh-android"\n'
    await mkdir(profile, { recursive: true })
    await writeFile(rootFile, '- id: dsh-android\n  name: "@zseven-w/dsh-android"\n')
    await writeFile(patchFile, patch)

    const first = await resetGeneratedWebProfileRoot({ dshHome })
    const second = await resetGeneratedWebProfileRoot({ dshHome })

    assert.equal(first.rootFile, rootFile)
    assert.equal(first.bytes, Buffer.byteLength(GENERATED_WEB_PROFILE_ROOT))
    assert.deepEqual(second, first)
    assert.equal(await readFile(rootFile, 'utf8'), GENERATED_WEB_PROFILE_ROOT)
    assert.equal(await readFile(patchFile, 'utf8'), patch)
    assert.deepEqual((await readdir(profile)).sort(), ['cordis.patch.yml', 'cordis.yml'])
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('desktop startup retries one generated-profile conflict without exposing the retry flag over IPC', async () => {
  const source = await readFile(mainFile, 'utf8')
  assert.match(source, /async function startRuntime\(\)[\s\S]{0,180}const attempt = startRuntimeAttempt\(false\)[\s\S]{0,80}runtimeStartPromise = attempt/u)
  assert.match(source, /!generatedProfileRecoveryAttempted[\s\S]{0,500}isRecoverableGeneratedProfileFailure\(diagnosticErrorText\)/u)
  assert.match(source, /resetGeneratedWebProfileRoot\(\{ dshHome: desktopDshHome\(\) \}\)[\s\S]{0,300}return startRuntimeAttempt\(true\)/u)
  assert.equal((source.match(/return startRuntimeAttempt\(true\)/gu) || []).length, 1)
  assert.match(source, /ipcMain\.handle\('runtime:start', desktopShellOnly\(options => startRuntime\(options \|\| \{\}\)\)\)/u)
})
