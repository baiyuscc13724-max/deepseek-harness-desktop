const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { ensureDesktopComputerUsePlugin } = require('../electron/bridge/desktop-computer-use-plugin-service.cjs')

test('Computer Use is built in with pushed session/permanent unlimited authorization', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'computer-use-'))
  try {
    const repositoryRoot = path.resolve(__dirname, '..')
    const bundledRoot = path.join(repositoryRoot, 'plugins', 'dsh-desktop-computer-use')
    assert.equal((await ensureDesktopComputerUsePlugin({ dshHome: root, bundledRoot })).patchChanged, true)
    assert.equal((await ensureDesktopComputerUsePlugin({ dshHome: root, bundledRoot })).patchChanged, false)

    const [plugin, manifestText, client, main, preload, renderer] = await Promise.all([
      readFile(path.join(bundledRoot, 'lib', 'index.js'), 'utf8'),
      readFile(path.join(bundledRoot, 'package.json'), 'utf8'),
      readFile(path.join(bundledRoot, 'lib', 'client.js'), 'utf8'),
      readFile(path.join(repositoryRoot, 'electron', 'main.cjs'), 'utf8'),
      readFile(path.join(repositoryRoot, 'electron', 'preload.cjs'), 'utf8'),
      readFile(path.join(repositoryRoot, 'renderer', 'app.js'), 'utf8')
    ])
    const manifest = JSON.parse(manifestText)

    assert.match(plugin, /const inject = \['systemPrompt', 'tools'\]/u)
    assert.match(plugin, /Computer Use is a built-in desktop skill/u)
    assert.match(plugin, /never ask the user to install it or add a skill card/u)
    assert.match(plugin, /'status', 'requestAuthorization', 'targets', 'select', 'screenshot', 'click', 'type', 'scroll'/u)
    assert.match(plugin, /pushes an authorization card above the dialog/u)
    assert.match(plugin, /unlimited is true/u)
    assert.match(plugin, /same grant and enabled state are shared with background-capable browser_control/u)
    assert.match(plugin, /user authorizes only once/u)
    assert.match(plugin, /browser_control can run its internal browser in the background through structured CDP\/DOM references/u)
    assert.match(plugin, /do not substitute Computer Use screenshot coordinates for browser work/u)
    assert.match(plugin, /browser_control keeps its own credential, payment, and transaction safety boundaries/u)
    assert.match(plugin, /without per-action confirmation/u)
    assert.match(plugin, /UAC\/system\/elevated\/sensitive-window/u)
    assert.match(plugin, /no Shell or scripts are exposed/u)
    assert.match(plugin, /installSettingsSection/u)
    assert.match(plugin, /Settings > Plugins > Plugin configuration/u)
    assert.match(plugin, /cannot grant itself authorization/u)
    assert.doesNotMatch(plugin, /仅在用户明确开启后截取或操作 Harness Desktop 自身窗口/u)

    assert.equal(manifest.exports['./client'], './lib/client.js')
    assert.equal(manifest.dsh?.client?.platform, 'web')
    assert.equal(manifest.dsh?.client?.immediately, true)
    assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'))
    assert.match(client, /settings\.plugin\.item/u)
    assert.match(client, /computer-use-toggle/u)
    assert.match(client, /computer-use-revoke-permanent/u)
    assert.match(client, /trusted Host authorization card/u)
    assert.match(client, /cannot choose its scope/u)
    assert.match(client, /unlimited mode bypasses application policy, per-action confirmation/u)
    assert.doesNotMatch(client, /authorize-session|authorize-forever/u)
    assert.match(client, /computer-use-refresh/u)
    assert.match(client, /computer-use-status/u)
    assert.match(client, /computer-use-toggle/u)
    assert.match(client, /computer-use-revoke-permanent/u)
    assert.doesNotMatch(renderer, /computer-use-(?:refresh|status|toggle|revoke-permanent)/u)
    assert.doesNotMatch(renderer, /pluginMutation|setComputerUseAppPolicy/u)

    assert.match(main, /new ComputerUseAppPolicy/u)
    assert.match(main, /new WindowsComputerUse/u)
    assert.match(main, /refreshComputerUseTargets/u)
    assert.match(main, /Number\(window\.pid\) === process\.pid/u)
    assert.match(main, /revalidateComputerUseTarget/u)
    assert.match(main, /requestComputerUseAuthorization/u)
    assert.match(main, /authorizeComputerUse/u)
    assert.match(main, /sharedComputerUseControlState/u)
    assert.match(main, /syncBrowserControlWithComputerUse/u)
    assert.match(main, /requireSharedComputerUseForBrowser/u)
    assert.match(main, /browserSecurityPolicy\.setUnifiedControl\(control\.active\)/u)
    assert.match(main, /computerUseUnlimited \? null : requireComputerConfirmation/u)
    assert.match(main, /grant\.json/u)
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

    for (const channel of ['computerUse:requestAuthorization', 'computerUse:authorize', 'computerUse:decline', 'computerUse:revokePermanent', 'computerUse:policy', 'computerUse:setDefaultAccess', 'computerUse:setAppOverride', 'computerUse:revokeAppOverride']) {
      assert.ok(main.includes(channel), `main missing ${channel}`)
      assert.ok(preload.includes(channel), `preload missing ${channel}`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
