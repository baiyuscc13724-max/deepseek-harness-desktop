const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')
const { createCore, isShortcutPressed, browserStateModeAction } = require('../renderer/right-workspace.js')

test('right workspace core provides bounded width and deterministic pane history', () => {
  const core = createCore({ width: 460 })
  for (const id of ['browser', 'files', 'schedules', 'document']) core.register({ id, title: id })
  assert.equal(core.replace('browser'), true)
  assert.equal(core.push('files'), true)
  assert.equal(core.push('document'), true)
  assert.deepEqual(core.stack, ['browser', 'files', 'document'])
  assert.deepEqual(core.back(), { closed: false, id: 'files' })
  assert.equal(core.setWidth(20), 320)
  assert.equal(core.setWidth(5000), 1200)
  const saved = core.serialize()
  const restored = createCore()
  for (const id of ['browser', 'files', 'schedules', 'document']) restored.register({ id })
  assert.equal(restored.restore(saved), true)
  assert.equal(restored.activeId, 'files')
  assert.equal(isShortcutPressed({ key: ']', ctrlKey: true, shiftKey: true }), true)
})

test('background browser state cannot replace an explicitly selected workspace mode', () => {
  for (const activeModeId of ['files', 'schedules', 'document']) {
    assert.equal(browserStateModeAction({
      restorePending: false,
      nativeVisible: true,
      workspaceOpen: true,
      activeModeId
    }), 'sync-only', `${activeModeId} must keep focus when a loading/title event reports visible=true`)
  }

  assert.equal(browserStateModeAction({
    restorePending: true,
    nativeVisible: true,
    workspaceOpen: false,
    activeModeId: 'browser'
  }), 'restore-browser', 'the initial renderer hydration may restore an already-visible browser')

  assert.equal(browserStateModeAction({
    restorePending: true,
    nativeVisible: false,
    workspaceOpen: false,
    activeModeId: 'browser'
  }), 'sync-only', 'a hidden native browser does not open the workspace')
})

test('Desktop shell exposes one unified right workspace with browser, files and schedules', async () => {
  const [html, integration, styles, browser, app, links] = await Promise.all([
    source('renderer/index.html'), source('renderer/right-workspace-integration.js'),
    source('renderer/right-workspace.css'), source('renderer/browser-sidebar.js'),
    source('renderer/app.js'), source('renderer/workspace-links-integration.js')
  ])
  for (const id of ['browserSidebar', 'rightWorkspaceBack', 'rightWorkspaceTitle', 'rightWorkspaceBrowserButton', 'rightWorkspaceFilesButton', 'rightWorkspaceSchedulesButton', 'rightWorkspaceSlot']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing right workspace element ${id}`)
  }
  assert.match(html, /right-workspace\.css/u)
  assert.match(html, /right-workspace\.js/u)
  assert.match(html, /right-workspace-integration\.js/u)
  for (const mode of ['browser', 'files', 'schedules', 'document']) assert.match(integration, new RegExp(`id: '${mode}'`))
  assert.match(integration, /getRightWorkspaceResource/u)
  assert.match(integration, /resource\('filePreview', \{ path: target \}\)/u)
  assert.doesNotMatch(integration, /api\.previewRightWorkspaceLocal/u)
  assert.match(integration, /runtimeView\.addEventListener\('ipc-message'/u)
  assert.match(integration, /runtimeView\.send\('right-workspace:command'/u)
  assert.match(integration, /schedulesSnapshot\.history/u)
  assert.match(integration, /submit\.type = 'submit'/u)
  assert.match(integration, /textContent = file\.text/u)
  assert.doesNotMatch(integration, /innerHTML|executeJavaScript|openExternal|file:\/\/|data:/u)
  assert.match(styles, /body\.dsh-right-workspace-open #runtimeView/u)
  assert.match(styles, /@media \(max-width: 900px\)/u)
  assert.match(styles, /@media \(max-width: 620px\)/u)
  assert.match(styles, /prefers-reduced-motion/u)
  assert.match(browser, /harnessDesktopRightWorkspace/u)
  assert.match(integration, /requestedBrowserContentVisible === next/u)
  assert.match(integration, /function setBrowserContentVisible\(visible\)/u)
  assert.match(integration, /browserStateModeAction\(/u)
  assert.match(integration, /if \(action === 'restore-browser'\) openMode\('browser', \{ nativeAlreadyVisible: true \}\)/u)
  assert.match(integration, /else \{[\s\S]{0,220}api\.setBrowserVisible\(false\)/u)
  assert.doesNotMatch(integration, /next\?\.visible === true[^\n]*openMode\('browser'\)/u)
  assert.doesNotMatch(browser, /workspace\) await workspace\.openMode\('browser'\)[\s\S]{0,80}api\.setBrowserVisible\(true\)/u)
  assert.match(app, /target\.hostname === 'preview-local'/u)
  assert.match(app, /harnessDesktopRightWorkspace\?\.openLocalDocument/u)
  assert.match(links, /route\('preview-local'/u)
  assert.match(links, /anchor\.getAttribute\('href'\)/u)
  assert.match(links, /withoutLocation/u)
  assert.match(links, /HTML 和程序源码不会执行/u)
  assert.match(links, /单击在右侧预览/u)
})

test('guest bridge publishes only session context and accepts bounded draft commands', async () => {
  const [guest, session, preload, main] = await Promise.all([
    source('electron/guest-preload.cjs'), source('plugins/dsh-session-experience/lib/client.js'),
    source('electron/preload.cjs'), source('electron/main.cjs')
  ])
  assert.match(guest, /ipcRenderer\.sendToHost\('right-workspace:context'/u)
  assert.match(guest, /type !== 'set-draft'/u)
  assert.match(guest, /text\.length > 12_000/u)
  assert.match(session, /publishRightWorkspaceContext/u)
  assert.match(session, /onRightWorkspaceCommand/u)
  assert.match(session, /inputActions\.setDraft\(command\.text\)/u)
  assert.match(preload, /rightWorkspace:resource/u)
  assert.match(main, /ipcMain\.handle\('rightWorkspace:resource'/u)
  assert.match(main, /rightWorkspace:resource[\s\S]{0,180}assertDesktopShellSender\(event\)/u)
  assert.match(main, /loadRightWorkspaceResource/u)
  assert.match(preload, /rightWorkspace:previewLocal/u)
  assert.match(main, /ipcMain\.handle\('rightWorkspace:previewLocal'/u)
  assert.match(main, /previewLocalDocument/u)
  assert.match(preload, /openSessionWindow: sessionId => ipcRenderer\.invoke\('session:openWindow'/u)
  assert.match(main, /function openDetachedSessionWindow\(sessionId\)/u)
  assert.match(main, /partition: 'persist:harness'/u)
})
