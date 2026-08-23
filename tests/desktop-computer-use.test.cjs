const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { ensureDesktopComputerUsePlugin } = require('../electron/bridge/desktop-computer-use-plugin-service.cjs')

test('Computer Use is built in, cross-application, policy bound and confirmation gated', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'computer-use-'))
  try {
    const repositoryRoot = path.resolve(__dirname, '..')
    const bundledRoot = path.join(repositoryRoot, 'plugins', 'dsh-desktop-computer-use')
    assert.equal((await ensureDesktopComputerUsePlugin({ dshHome: root, bundledRoot })).patchChanged, true)
    assert.equal((await ensureDesktopComputerUsePlugin({ dshHome: root, bundledRoot })).patchChanged, false)

    const [plugin, main, preload] = await Promise.all([
      readFile(path.join(bundledRoot, 'lib', 'index.js'), 'utf8'),
      readFile(path.join(repositoryRoot, 'electron', 'main.cjs'), 'utf8'),
      readFile(path.join(repositoryRoot, 'electron', 'preload.cjs'), 'utf8')
    ])

    assert.match(plugin, /const inject = \['systemPrompt', 'tools'\]/u)
    assert.match(plugin, /Computer Use is a built-in desktop skill/u)
    assert.match(plugin, /never ask the user to install it or add a skill card/u)
    assert.match(plugin, /'targets', 'select', 'screenshot', 'click', 'type', 'scroll'/u)
    assert.match(plugin, /Host-provided per-action confirmation/u)
    assert.match(plugin, /no Shell or scripts are exposed/u)
    assert.doesNotMatch(plugin, /仅在用户明确开启后截取或操作 Harness Desktop 自身窗口/u)

    assert.match(main, /new ComputerUseAppPolicy/u)
    assert.match(main, /new WindowsComputerUse/u)
    assert.match(main, /refreshComputerUseTargets/u)
    assert.match(main, /Number\(window\.pid\) === process\.pid/u)
    assert.match(main, /revalidateComputerUseTarget/u)
    assert.match(main, /requireComputerConfirmation/u)
    assert.match(main, /computerUseConfirmations\.authorize/u)
    assert.match(main, /mainWindow\.capturePage/u)
    assert.match(main, /nativeImage\.createFromBitmap/u)
    assert.match(main, /verifyExternalComputerUseSurface/u)
    assert.match(main, /screenshot-required/u)
    assert.match(main, /target-surface-changed/u)
    assert.match(main, /sensitive-input-blocked/u)
    assert.match(main, /powerMonitor\.on\('lock-screen'/u)
    assert.match(main, /computerUse:setDefaultAccess/u)
    assert.match(main, /computerUse:setAppOverride/u)
    assert.doesNotMatch(main, /desktopCapturer/u)

    for (const channel of ['computerUse:policy', 'computerUse:setDefaultAccess', 'computerUse:setAppOverride', 'computerUse:revokeAppOverride']) {
      assert.ok(main.includes(channel), `main missing ${channel}`)
      assert.ok(preload.includes(channel), `preload missing ${channel}`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
