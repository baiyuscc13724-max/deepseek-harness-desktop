const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { ensureDesktopDirectoryPickerPlugin } = require('../electron/bridge/desktop-directory-picker-plugin-service.cjs')

const bundledRoot = path.resolve(__dirname, '..', 'plugins', 'dsh-desktop-directory-picker')

test('desktop directory picker installs through the supported DSH Web profile patch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-directory-picker-'))
  try {
    const result = await ensureDesktopDirectoryPickerPlugin({ dshHome: root, bundledRoot })
    assert.equal(result.version, '1.0.48')
    assert.equal(result.patchChanged, true)
    const profile = path.join(root, 'profiles', 'web')
    const patch = await readFile(path.join(profile, 'cordis.patch.yml'), 'utf8')
    const client = await readFile(path.join(profile, 'node_modules', 'dsh-desktop-directory-picker', 'lib', 'client.js'), 'utf8')
    assert.match(patch, /id: desktop-directory-picker/u)
    assert.match(patch, /name: dsh-desktop-directory-picker/u)
    assert.match(client, /conversation\.hero\.workspace\.directoryFlow/u)
    assert.match(client, /chooseWorkspaceDirectory/u)
    assert.match(client, /__harness_mobile__\/workspace\/choose/u)
    assert.match(client, /X-Harness-Mobile-Request/u)
    assert.match(client, /__HARNESS_DESKTOP_DIRECTORY_PICKER__/u)
    assert.match(client, /priority: -100/u)
    const repeated = await ensureDesktopDirectoryPickerPlugin({ dshHome: root, bundledRoot })
    assert.equal(repeated.patchChanged, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('desktop directory picker host integration uses an owned native directory dialog', async () => {
  const main = await readFile(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /dialog\.showOpenDialogSync\(mainWindow/u)
  assert.match(main, /title: '选择工作区目录'/u)
  assert.match(main, /properties: \['openDirectory', 'createDirectory'\]/u)
  assert.match(main, /ipcMain\.handle\('workspace:chooseDirectory'/u)
  assert.match(main, /isLocalRuntimeUrl\(event\.sender\.getURL\(\)\)/u)
  const guestPreload = await readFile(path.resolve(__dirname, '..', 'electron', 'guest-preload.cjs'), 'utf8')
  assert.match(guestPreload, /contextBridge\.exposeInMainWorld\('harnessDesktopGuest'/u)
  assert.match(guestPreload, /ipcRenderer\.invoke\('workspace:chooseDirectory'\)/u)
})

test('sandboxed guest preload keeps the workspace picker bridge self-contained', async () => {
  const guestPreload = await readFile(path.resolve(__dirname, '..', 'electron', 'guest-preload.cjs'), 'utf8')
  assert.deepEqual([...guestPreload.matchAll(/require\((['"])(.*?)\1\)/gu)].map(match => match[2]), ['electron'])
  assert.match(guestPreload, /including the workspace picker/u)
})
