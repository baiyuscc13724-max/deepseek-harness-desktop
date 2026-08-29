const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')
const { createCore, isExplicitLocalTarget, isShortcutPressed, loadDocumentPreview, browserStateModeAction } = require('../renderer/right-workspace.js')
const { mapFramePoint, mapNormalizedPoint } = require('../renderer/device-workspace.js')

test('right workspace core provides bounded width and deterministic pane history', () => {
  const core = createCore({ width: 460 })
  for (const id of ['browser', 'files', 'schedules', 'devices', 'document']) core.register({ id, title: id })
  assert.equal(core.replace('browser'), true)
  assert.equal(core.push('files'), true)
  assert.equal(core.push('document'), true)
  assert.deepEqual(core.stack, ['browser', 'files', 'document'])
  assert.deepEqual(core.back(), { closed: false, id: 'files' })
  assert.equal(core.setWidth(20), 320)
  assert.equal(core.setWidth(5000), 1200)
  const saved = core.serialize()
  const restored = createCore()
  for (const id of ['browser', 'files', 'schedules', 'devices', 'document']) restored.register({ id })
  assert.equal(restored.restore(saved), true)
  assert.equal(restored.activeId, 'files')
  assert.equal(isShortcutPressed({ key: ']', ctrlKey: true, shiftKey: true }), true)
})

test('device workspace maps displayed frame coordinates without guessing scale', () => {
  const image = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 200 }) }
  assert.deepEqual(mapFramePoint({ clientX: 300, clientY: 150 }, image, { width: 800, height: 400 }), { x: 400, y: 200 })
  assert.deepEqual(mapFramePoint({ clientX: 10, clientY: 999 }, image, { width: 800, height: 400 }), { x: 0, y: 399 })
  assert.deepEqual(mapNormalizedPoint({ clientX: 300, clientY: 150 }, image), { x: 0.5, y: 0.5 })
  assert.deepEqual(mapNormalizedPoint({ clientX: 10, clientY: 999 }, image), { x: 0, y: 1 })
})

test('only explicit absolute targets may fall back to local read-only preview', () => {
  for (const target of ['D:\\outside\\chapter.txt', 'D:/outside/image.png', 'file:///D:/outside/report.pdf', 'file://localhost/D:/outside/report.pdf', '/tmp/outside/video.mp4']) {
    assert.equal(isExplicitLocalTarget(target), true, `${target} must be eligible for explicit local preview`)
  }
  for (const target of ['chapter.txt', 'drafts/chapter.txt', '../outside.txt', 'D:relative.txt', '\\\\server\\share\\audio.mp3', '//server/share/file.txt', 'file://server/share/file.txt', 'https://example.com/file.txt', '/api/desktop-files/download?sessionId=session-1&path=notes.md', '/settings?tab=files']) {
    assert.equal(isExplicitLocalTarget(target), false, `${target} must remain workspace-bound`)
  }
})

test('document preview falls back locally only after an absolute target escapes the workspace', async () => {
  const escaped = Object.assign(new Error('文件不存在或超出工作区。'), { code: 'FILES_PATH_ESCAPE' })
  const localFile = { path: 'D:\\outside\\chapter.txt', previewKind: 'text', previewable: true, text: 'outside' }
  let localCalls = 0
  const absolute = await loadDocumentPreview(localFile.path, {
    workspacePreview: async () => { throw escaped },
    localPreview: async target => { localCalls += 1; assert.equal(target, localFile.path); return localFile }
  })
  assert.deepEqual(absolute, { file: localFile })
  assert.equal(localCalls, 1)

  const workspace = { file: { path: 'drafts/chapter.txt', previewable: true, text: 'inside' } }
  assert.equal(await loadDocumentPreview('drafts/chapter.txt', {
    workspacePreview: async () => workspace,
    localPreview: async () => { throw new Error('must not read locally') }
  }), workspace)
  await assert.rejects(loadDocumentPreview('../outside.txt', {
    workspacePreview: async () => { throw escaped },
    localPreview: async () => { localCalls += 1 }
  }), error => error === escaped)
  await assert.rejects(loadDocumentPreview('/api/desktop-files/download?sessionId=session-1&path=notes.md', {
    workspacePreview: async () => { throw escaped },
    localPreview: async () => { localCalls += 1 }
  }), error => error === escaped)
  assert.equal(localCalls, 1)
})

test('background browser state cannot replace an explicitly selected workspace mode', () => {
  for (const activeModeId of ['files', 'schedules', 'devices', 'document']) {
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

test('Desktop shell exposes one unified right workspace with browser, files, schedules and devices', async () => {
  const [html, integration, styles, shellStyles, browser, app, links, devices] = await Promise.all([
    source('renderer/index.html'), source('renderer/right-workspace-integration.js'),
    source('renderer/right-workspace.css'), source('renderer/styles.css'), source('renderer/browser-sidebar.js'),
    source('renderer/app.js'), source('renderer/workspace-links-integration.js'), source('renderer/device-workspace.js')
  ])
  for (const id of ['browserSidebar', 'rightWorkspaceBack', 'rightWorkspaceTitle', 'rightWorkspaceBrowserButton', 'rightWorkspaceFilesButton', 'rightWorkspaceSchedulesButton', 'rightWorkspaceDevicesButton', 'rightWorkspaceSlot']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing right workspace element ${id}`)
  }
  assert.match(html, /right-workspace\.css/u)
  assert.match(html, /right-workspace\.js/u)
  assert.match(html, /device-workspace\.js/u)
  assert.match(html, /right-workspace-integration\.js/u)
  for (const mode of ['home', 'browser', 'files', 'schedules', 'devices', 'document']) assert.match(integration, new RegExp(`id: '${mode}'`))
  assert.match(html, /right-workspace-toggle-icon/u)
  assert.match(html, /title="切换右侧工作区"/u)
  assert.match(integration, /rightWorkspaceHomePane/u)
  assert.match(integration, /dataset\.rightWorkspaceHomeAction/u)
  assert.match(integration, /Control\+P Meta\+P/u)
  assert.match(integration, /Control\+T Meta\+T/u)
  assert.match(integration, /Control\+Shift\+A Meta\+Shift\+A/u)
  assert.match(integration, /Control\+Shift\+D Meta\+Shift\+D/u)
  assert.match(integration, /openHome/u)
  assert.match(integration, /deviceWorkspace\?\.activate/u)
  assert.doesNotMatch(integration, /openAndroidDevicePanel|closeWorkspace\('android-device'/u)
  assert.match(devices, /desktopDeviceAction/u)
  assert.match(devices, /desktopAndroidAction/u)
  assert.match(devices, /switchDevice/u)
  assert.match(devices, /pointerdown/u)
  assert.match(devices, /data-device-source-view|dataset\.deviceSourceView/u)
  assert.match(devices, /right-workspace-phone-frame/u)
  assert.match(devices, /right-workspace-monitor-screen/u)
  assert.doesNotMatch(devices, /monitor-neck|monitor-base|phone-speaker/u)
  assert.match(styles, /\.right-workspace-monitor-frame,\.right-workspace-android-frame \{[^}]*max-width:100%;[^}]*max-height:100%;[^}]*background:transparent/u)
  assert.match(styles, /\.right-workspace-monitor-screen,\.right-workspace-phone-frame \{[^}]*border:0;[^}]*background:transparent/u)
  assert.match(devices, /right-workspace-device-controls-toggle/u)
  assert.match(styles, /\.right-workspace-device-pane\.is-controls-open/u)
  assert.doesNotMatch(devices, /onOpenAndroid/u)
  assert.match(devices, /requestAuthorization/u)
  assert.match(devices, /selectTarget/u)
  assert.match(devices, /onContextMenu|contextmenu/u)
  assert.match(devices, /delta_y/u)
  assert.match(devices, /avoid capturing Harness itself|避免捕获 Harness 自身/u)
  assert.match(integration, /openMode\(item\.id, \{ push: true \}\)/u)
  assert.match(integration, /quickButton\?\.setAttribute\('aria-expanded'/u)
  assert.match(integration, /getRightWorkspaceResource/u)
  assert.match(integration, /factory\.loadDocumentPreview\(target/u)
  assert.match(integration, /workspacePreview: path => resource\('filePreview', \{ path \}\)/u)
  assert.match(integration, /localPreview: path => api\.previewRightWorkspaceLocal\(path\)/u)
  assert.match(integration, /runtimeView\.addEventListener\('ipc-message'/u)
  assert.match(integration, /runtimeView\.send\('right-workspace:command'/u)
  assert.match(integration, /schedulesSnapshot\.history/u)
  assert.match(integration, /submit\.type = 'submit'/u)
  assert.match(integration, /textContent = file\.text/u)
  for (const kind of ['image', 'audio', 'video', 'pdf', 'html-app']) assert.match(integration, new RegExp(`previewKind === '${kind}'`))
  assert.match(integration, /setAttribute\('sandbox', 'allow-scripts allow-pointer-lock'\)/u)
  assert.doesNotMatch(integration, /allow-same-origin/u)
  assert.match(links, /工作区 HTML 可隔离试玩/u)
  assert.match(styles, /\.right-workspace-document-app-stage/u)
  assert.match(styles, /\.right-workspace-document-pane\.is-interactive/u)
  assert.match(integration, /openRightWorkspaceFile/u)
  assert.match(integration, /safePreviewSource/u)
  assert.match(integration, /setAttribute\('aria-busy', 'true'\)/u)
  assert.match(integration, /setAttribute\('aria-live', 'polite'\)/u)
  assert.match(integration, /startsWith\('reveal'\) \? '已在文件夹中显示' : '已打开'/u)
  assert.match(integration, /安装包、脚本等主动内容只会在文件夹中显示/u)
  assert.doesNotMatch(integration, /innerHTML|executeJavaScript|openExternal|file:\/\//u)
  assert.match(html, /img-src[^;]*http:\/\/127\.0\.0\.1:\*/u)
  assert.match(html, /media-src[^;]*http:\/\/127\.0\.0\.1:\*/u)
  assert.match(styles, /--dsh-right-workspace-home-width:\s*320px/u)
  assert.match(styles, /\.dsh-right-workspace\.browser-sidebar\.is-home \{[\s\S]{0,120}width:\s*min\(var\(--dsh-right-workspace-home-width\),\s*100vw\)/u)
  assert.match(styles, /\.dsh-right-workspace\.is-home \.dsh-right-workspace__handle \{ display:none; \}/u)
  assert.match(styles, /body\.dsh-right-workspace-open #runtimeView \{ width:100%; \}/u)
  assert.match(styles, /body\.dsh-right-workspace-open \.runtime-status \{ right:0; \}/u)
  assert.match(styles, /@media \(min-width:901px\)[\s\S]*body\.dsh-right-workspace-docked #runtimeView \{[\s\S]{0,180}width:calc\(100% - min\(/u)
  assert.match(styles, /body\.dsh-right-workspace-docked \.runtime-status,[\s\S]{0,100}body\.dsh-right-workspace-docked \.terminal-panel/u)
  assert.match(integration, /classList\.toggle\('dsh-right-workspace-docked', open\)/u)
  assert.match(integration, /--dsh-right-workspace-dock-width/u)
  assert.match(shellStyles, /body\.browser-sidebar-open #runtimeView \{ width:100%; \}/u)
  assert.match(shellStyles, /body\.browser-sidebar-open \.runtime-status \{ right:0; \}/u)
  assert.match(shellStyles, /body\.dsh-right-workspace-open \.terminal-panel,body\.browser-sidebar-open \.terminal-panel \{ right:0; \}/u)
  assert.doesNotMatch(shellStyles, /browser-sidebar-open #runtimeView \{ width:calc\(100% -/u)
  assert.match(styles, /\.dsh-right-workspace \{[\s\S]{0,180}top:\s*0;[\s\S]{0,320}padding-top:\s*var\(--dsh-workbench-header-height\)/u)
  assert.match(styles, /\.dsh-right-workspace::before \{[\s\S]{0,260}height:\s*var\(--dsh-workbench-header-height\)/u)
  assert.match(styles, /\.dsh-right-workspace:not\(\.is-home\)::before/u)
  assert.match(styles, /body\.dsh-right-workspace-open \.pet-quick-button/u)
  assert.match(styles, /\.dsh-right-workspace\.is-home \.dsh-right-workspace__header/u)
  assert.match(styles, /\.right-workspace-home-actions/u)
  assert.match(styles, /\.right-workspace-home-shortcut/u)
  assert.match(styles, /@media \(max-width: 900px\)/u)
  assert.match(styles, /@media \(max-width: 620px\)/u)
  assert.match(styles, /prefers-reduced-motion/u)
  assert.match(browser, /harnessDesktopRightWorkspace/u)
  assert.match(browser, /workspace\.openHome\?\.\(\)/u)
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
  assert.match(links, /const anchorPath = anchor =>/u)
  assert.match(links, /anchor\.getAttribute\('href'\)/u)
  assert.match(links, /anchor\.hasAttribute\('download'\)/u)
  assert.match(links, /else delete anchor\.dataset\.hdLocalTarget/u)
  assert.match(links, /withoutLocation/u)
  assert.match(links, /const nativeFileButton = code\.querySelector\(':scope > button'\)/u)
  assert.match(links, /mark\(nativeFileButton, target\)/u)
  assert.match(links, /redecorateContainingCode\(record\.target\)/u)
  assert.match(links, /for \(const node of record\.addedNodes\) decorateNode\(node\)/u)
  assert.match(links, /characterData: true/u)
  assert.doesNotMatch(links, /code\.querySelector\('a,button'\)/u)
  assert.match(links, /相对路径只从当前工作区读取/u)
  assert.match(links, /明确绝对路径可只读预览本机文件/u)
  assert.match(links, /程序和安装包不会执行/u)
})

test('guest bridge publishes bounded session/browser intents and accepts bounded draft commands', async () => {
  const [guest, session, preload, main] = await Promise.all([
    source('electron/guest-preload.cjs'), source('plugins/dsh-session-experience/lib/client.js'),
    source('electron/preload.cjs'), source('electron/main.cjs')
  ])
  assert.match(guest, /ipcRenderer\.sendToHost\('right-workspace:context'/u)
  assert.match(guest, /normalizeBrowserOpenIntent/u)
  assert.match(guest, /ipcRenderer\.sendToHost\('right-workspace:intent', intent\)/u)
  assert.match(guest, /type !== 'set-draft'/u)
  assert.match(guest, /text\.length > 12_000/u)
  assert.match(session, /publishRightWorkspaceContext/u)
  assert.match(session, /onRightWorkspaceCommand/u)
  assert.match(session, /inputActions\.setDraft\(command\.text\)/u)
  assert.match(preload, /rightWorkspace:resource/u)
  assert.match(main, /ipcMain\.handle\('rightWorkspace:resource'/u)
  assert.match(main, /rightWorkspace:resource[\s\S]{0,180}assertDesktopShellSender\(event\)/u)
  assert.match(main, /loadRightWorkspaceResource/u)
  assert.match(preload, /rightWorkspace:openFile/u)
  assert.match(main, /ipcMain\.handle\('rightWorkspace:openFile'/u)
  assert.match(main, /materializeRightWorkspaceFile/u)
  assert.match(main, /openLocalTarget\(file\.destination/u)
  assert.match(main, /tempBase: app\.getPath\('temp'\)/u)
  assert.match(main, /mkdtempImpl: mkdtemp/u)
  assert.match(main, /openPath: target => shell\.openPath\(target\)/u)
  assert.doesNotMatch(main, /shell\.openPath\(destination\)/u)
  assert.match(main, /opened: result\.ok && String\(result\.action \|\| ''\)\.startsWith\('open-'\)/u)
  assert.match(preload, /rightWorkspace:previewLocal/u)
  assert.match(main, /ipcMain\.handle\('rightWorkspace:previewLocal'/u)
  assert.match(main, /previewLocalDocument/u)
  assert.match(preload, /openSessionWindow: sessionId => ipcRenderer\.invoke\('session:openWindow'/u)
  assert.match(main, /function openDetachedSessionWindow\(sessionId\)/u)
  assert.match(main, /partition: 'persist:harness'/u)
})

test('right workspace data panes preserve scrollTop only across filter/refresh re-renders', async () => {
  const integration = await source('renderer/right-workspace-integration.js')

  // Helpers exist and capture only when a real, scrollable list is on screen.
  assert.match(integration, /function captureDataScroll\(kind\)/u)
  assert.match(integration, /view\.scrollHeight > view\.clientHeight \? view\.scrollTop : null/u)
  assert.match(integration, /function applyDataScroll\(kind, hasList\)/u)
  assert.match(integration, /pendingDataScroll\[kind\] = null/u)

  // Filtering re-renders request preserve for both panes.
  assert.match(integration, /filesQuery = value/u)
  assert.match(integration, /renderFiles\(\{ preserve: true \}\)/u)
  assert.match(integration, /schedulesQuery = value/u)
  assert.match(integration, /renderSchedules\(\{ preserve: true \}\)/u)

  // Refocusing the search box after a rebuilt list must not scroll it (or the
  // top of the pane) back into view and override the just-restored scrollTop.
  assert.match(integration, /#rightWorkspaceFilesSearch'\)\?\.focus\(\{ preventScroll: true \}\)/u)
  assert.match(integration, /#rightWorkspaceSchedulesSearch'\)\?\.focus\(\{ preventScroll: true \}\)/u)
  assert.doesNotMatch(integration, /#rightWorkspaceFilesSearch'\)\?\.focus\(\)/u)
  assert.doesNotMatch(integration, /#rightWorkspaceSchedulesSearch'\)\?\.focus\(\)/u)

  // A preserve refresh keeps the current list on screen until the request
  // resolves: the loading render is skipped (guarded by !opts.preserve), so a
  // bare loading render can never clear the pending scroll before the final
  // data render captures the still-visible old scrollTop.
  assert.match(integration, /if \(!opts\.preserve\) \{\r?\n      filesSnapshot = null\r?\n      renderFiles\(\)\r?\n    \}/u)
  assert.match(integration, /if \(!opts\.preserve\) \{\r?\n      schedulesSnapshot = null\r?\n      renderSchedules\(\)\r?\n    \}/u)
  assert.match(integration, /renderFiles\(opts\.preserve \? \{ preserve: true \} : \{\}\)/u)
  assert.match(integration, /renderSchedules\(opts\.preserve \? \{ preserve: true \} : \{\}\)/u)

  // The refresh button hands straight to the preserve load; there is no
  // separate pre-capture that a loading render could clear, so the preserved
  // position cannot be wiped before the final data render restores it.
  assert.match(integration, /\(\) => loadFiles\(\{ preserve: true \}\)/u)
  assert.match(integration, /\(\) => loadSchedules\(\{ preserve: true \}\)/u)
  assert.doesNotMatch(integration, /captureDataScroll\('files'\); return loadFiles/u)
  assert.doesNotMatch(integration, /captureDataScroll\('schedules'\); return loadSchedules/u)

  // Empty/loading/error states and no-session render force scrollTop back to 0
  // instead of restoring a stale position.
  assert.match(integration, /applyDataScroll\('files', false\)/u)
  assert.match(integration, /applyDataScroll\('schedules', false\)/u)
  assert.match(integration, /applyDataScroll\('files', true\)/u)
  assert.match(integration, /const hasScheduleList = rows\.length > 0/u)
  assert.match(integration, /schedulesView\.append\(history\)[\s\S]*applyDataScroll\('schedules', hasScheduleList\)/u,
    'schedule scroll must clamp only after optional history is rendered')
  assert.match(integration, /hasList && pending !== null \? Math\.min\(pending, Math\.max\(0, view\.scrollHeight - view\.clientHeight\)\) : 0/u)

  // Explicit mode switches and the initial hydration never pass preserve, so a
  // stale position from an unrelated mode/load cannot be forcibly restored.
  assert.doesNotMatch(integration, /if \(id === 'files'\) loadFiles\(\{ preserve: true \}\)/u)
  assert.doesNotMatch(integration, /if \(id === 'schedules'\) loadSchedules\(\{ preserve: true \}\)/u)
  assert.match(integration, /if \(id === 'files'\) loadFiles\(\)/u)
  assert.match(integration, /if \(id === 'schedules'\) loadSchedules\(\)/u)
  assert.match(integration, /^  renderFiles\(\)$/m)
  assert.match(integration, /^  renderSchedules\(\)$/m)
})

test('desktop shell coalesces resize work and pauses hidden workspace refreshes', async () => {
  const [workspace, integration, app] = await Promise.all([
    source('renderer/right-workspace.js'),
    source('renderer/right-workspace-integration.js'),
    source('renderer/app.js')
  ])

  // Repeated state snapshots do not redraw or broadcast, and pointermove bursts
  // are collapsed into one width mutation per animation frame.
  assert.match(workspace, /if \(isOpen === wasOpen\) return isOpen/u)
  assert.match(workspace, /if \(width === previous\) return width/u)
  assert.match(workspace, /if \(!dragFrame\) dragFrame = requestAnimationFrame\(flushDragWidth\)/u)
  assert.match(workspace, /if \(dragFrame\) cancelAnimationFrame\(dragFrame\)[\s\S]{0,80}flushDragWidth\(\)/u)

  // Browser state events may be frequent; only changed chrome fields touch DOM
  // or cross the content-visibility IPC boundary.
  assert.match(integration, /let chromeState = null/u)
  assert.match(integration, /previous\.dockWidth !== dockWidth/u)
  assert.match(integration, /previous\.active !== active/u)
  assert.match(integration, /previous\.open !== open/u)
  assert.match(integration, /previous\.browserContentVisible !== browserContentVisible/u)
  assert.match(integration, /if \(!controller\.isOpen\(\)\) return[\s\S]{0,120}loadFiles\(\)/u)

  // Re-running the settings mount against the same sidebar no longer forces a
  // layout read. ResizeObserver supplies contentRect and dataset writes dedupe.
  assert.match(app, /if \(mobileEntryLayoutHost === host && mobileEntryLayoutTrigger === settingsTrigger\) return/u)
  assert.match(app, /hostEntry\?\.contentRect\?\.width \?\? mobileEntryLayoutWidth/u)
  assert.match(app, /if \(host\.dataset\.hdMobileCompact !== compact\) host\.dataset\.hdMobileCompact = compact/u)
})
