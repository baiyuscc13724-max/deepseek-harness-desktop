'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..', '..')
const profileRoot = process.env.HARNESS_RIGHT_WORKSPACE_E2E_PROFILE || mkdtempSync(path.join(os.tmpdir(), 'hd-right-workspace-electron-'))
const styles = readFileSync(path.join(root, 'renderer', 'right-workspace.css'), 'utf8')

app.commandLine.appendSwitch('disable-gpu')
app.setPath('userData', profileRoot)

async function run() {
  await app.whenReady()
  const window = new BrowserWindow({ show: false, width: 1460, height: 930, useContentSize: true, skipTaskbar: true })
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{width:100%;height:100%;margin:0;overflow:hidden}
      body{--browser-panel-width:640px;--dsh-right-workspace-width:640px;--dsh-workbench-header-height:76px}
      #runtimeView{display:block;width:100%;height:100%;border:0;background:#e9f8f4}
      ${styles}
    </style></head><body class="dsh-right-workspace-open">
      <div id="runtimeView" aria-label="会话区域"></div>
      <aside id="workspace" class="dsh-right-workspace browser-sidebar is-open is-home" aria-label="右侧工作区">
        <div class="dsh-right-workspace__handle"></div>
        <header class="dsh-right-workspace__header"></header>
        <div class="dsh-right-workspace__slot"></div>
      </aside>
    </body></html>`
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const desktop = await window.webContents.executeJavaScript(`(() => {
      const panel = document.getElementById('workspace')
      const runtime = document.getElementById('runtimeView')
      const handle = panel.querySelector('.dsh-right-workspace__handle')
      const panelRect = panel.getBoundingClientRect()
      const runtimeRect = runtime.getBoundingClientRect()
      const handleRect = handle.getBoundingClientRect()
      const before = getComputedStyle(panel, '::before')
      return {
        viewport: { width: innerWidth, height: innerHeight },
        panel: { top: panelRect.top, right: panelRect.right, bottom: panelRect.bottom, left: panelRect.left, width: panelRect.width, height: panelRect.height },
        runtime: { top: runtimeRect.top, right: runtimeRect.right, width: runtimeRect.width, height: runtimeRect.height },
        handle: { top: handleRect.top, bottom: handleRect.bottom },
        extension: { top: before.top, height: before.height, background: before.backgroundColor },
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
      }
    })()`, true)

    assert.deepEqual(desktop.viewport, { width: 1460, height: 930 })
    assert.deepEqual(desktop.panel, { top: 76, right: 1460, bottom: 930, left: 819, width: 641, height: 854 })
    assert.deepEqual(desktop.runtime, { top: 0, right: 820, width: 820, height: 930 })
    assert.deepEqual(desktop.handle, { top: 76, bottom: 930 })
    assert.deepEqual(desktop.extension.top, '-76px')
    assert.deepEqual(desktop.extension.height, '76px')
    assert.equal(desktop.overflowX, false)

    window.setContentSize(800, 700)
    await new Promise(resolve => setTimeout(resolve, 50))
    const compact = await window.webContents.executeJavaScript(`(() => {
      const panel = document.getElementById('workspace').getBoundingClientRect()
      const runtime = document.getElementById('runtimeView').getBoundingClientRect()
      return { panelTop: panel.top, panelBottom: panel.bottom, panelRight: panel.right, runtimeWidth: runtime.width, viewportWidth: innerWidth, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth }
    })()`, true)
    assert.equal(compact.panelTop, 76)
    assert.equal(compact.panelBottom, 700)
    assert.equal(compact.panelRight, compact.viewportWidth)
    assert.equal(compact.runtimeWidth, compact.viewportWidth)
    assert.equal(compact.overflowX, false)
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

run().then(() => app.exit(0), error => {
  console.error(error && error.stack ? error.stack : error)
  app.exit(1)
})
