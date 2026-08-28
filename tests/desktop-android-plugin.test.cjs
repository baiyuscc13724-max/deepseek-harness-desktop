const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, readdir, rm, stat } = require('node:fs/promises')
const { ensureDesktopAndroidPlugin } = require('../electron/bridge/desktop-android-plugin-service.cjs')

const bundledRoot = path.resolve(__dirname, '..', 'plugins', 'dsh-android')

async function walk(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await walk(target))
    else if (entry.isFile()) files.push(target)
  }
  return files
}

test('adapted Android plugin installs into the scoped DSH Web profile package', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-android-plugin-'))
  try {
    const result = await ensureDesktopAndroidPlugin({ dshHome: root, bundledRoot })
    assert.equal(result.version, '0.1.0-rc.4')
    assert.equal(result.patchChanged, true)
    const profile = path.join(root, 'profiles', 'web')
    const patch = await readFile(path.join(profile, 'cordis.patch.yml'), 'utf8')
    const installed = path.join(profile, 'node_modules', '@zseven-w', 'dsh-android')
    const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'))
    const host = await readFile(path.join(installed, 'lib', 'index.js'), 'utf8')
    const client = await readFile(path.join(installed, 'lib', 'client.js'), 'utf8')
    assert.equal(manifest.name, '@zseven-w/dsh-android')
    assert.match(patch, /id: dsh-android/u)
    assert.match(patch, /name: ["']@zseven-w\/dsh-android["']/u)
    assert.match(host, /android_devices/u)
    assert.match(host, /android_ui_tree/u)
    assert.match(host, /android_logs/u)
    assert.match(client, /openInPanel/u)
    assert.match(client, /data-android-panel/u)
    assert.doesNotMatch(client, /root\.style\.marginRight\s*=\s*dockWidth/u, 'Android panel must overlay the right edge instead of shrinking the conversation workspace')
    const repeated = await ensureDesktopAndroidPlugin({ dshHome: root, bundledRoot })
    assert.equal(repeated.patchChanged, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bundled Android source preserves the adapted package without heavy Android runtimes', async () => {
  const manifest = JSON.parse(await readFile(path.join(bundledRoot, 'package.json'), 'utf8'))
  const license = await readFile(path.join(bundledRoot, 'LICENSE'), 'utf8')
  const notices = await readFile(path.join(bundledRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  assert.equal(manifest.name, '@zseven-w/dsh-android')
  assert.equal(manifest.version, '0.1.0-rc.4')
  assert.match(String(manifest.repository?.url), /ZSeven-W\/dsh-android/u)
  assert.match(license, /MIT License/u)
  assert.ok(notices.length > 100)

  const files = await walk(bundledRoot)
  const forbidden = /(?:^|[\\/])(?:platforms?|system-images?|avd|sdk|jre|jdk)(?:[\\/]|$)|\.(?:img|iso|qcow2|vdi|vmdk)$|(?:^|[\\/])(?:adb|emulator|qemu-system[^\\/]*)\.exe$/iu
  assert.deepEqual(files.filter(file => forbidden.test(file)), [])
  const bytes = (await Promise.all(files.map(file => stat(file)))).reduce((sum, value) => sum + value.size, 0)
  assert.ok(bytes < 4 * 1024 * 1024, `adapted plugin source unexpectedly grew to ${bytes} bytes`)
})
