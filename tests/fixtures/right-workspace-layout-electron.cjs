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
      body{--browser-panel-width:640px;--dsh-right-workspace-width:640px;--dsh-right-workspace-dock-width:320px;--dsh-workbench-header-height:76px}
      #runtimeView{display:block;width:100%;height:100%;border:0;background:#e9f8f4}
      ${styles}
      #runtimeView,.dsh-right-workspace{transition:none!important}
    </style></head><body class="dsh-right-workspace-open dsh-right-workspace-docked">
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
    assert.deepEqual(desktop.panel, { top: 0, right: 1460, bottom: 930, left: 1140, width: 320, height: 930 })
    assert.deepEqual(desktop.runtime, { top: 0, right: 1140, width: 1140, height: 930 })
    assert.deepEqual(desktop.handle, { top: 0, bottom: 0 })
    assert.deepEqual(desktop.extension.top, '0px')
    assert.deepEqual(desktop.extension.height, '76px')
    assert.equal(desktop.overflowX, false)

    const tool = await window.webContents.executeJavaScript(`(() => {
      const panelNode = document.getElementById('workspace')
      document.body.style.setProperty('--dsh-right-workspace-dock-width','640px')
      panelNode.classList.remove('is-home')
      const panel = panelNode.getBoundingClientRect()
      const runtime = document.getElementById('runtimeView').getBoundingClientRect()
      const handle = panelNode.querySelector('.dsh-right-workspace__handle').getBoundingClientRect()
      const before = getComputedStyle(panelNode, '::before')
      return {
        panel: { top: panel.top, right: panel.right, bottom: panel.bottom, left: panel.left, width: panel.width, height: panel.height },
        runtime: { right: runtime.right, width: runtime.width },
        handle: { top: handle.top, bottom: handle.bottom },
        extension: { top: before.top, height: before.height },
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
      }
    })()`, true)
    assert.deepEqual(tool.panel, { top: 0, right: 1460, bottom: 930, left: 820, width: 640, height: 930 })
    assert.deepEqual(tool.runtime, { right: 820, width: 820 })
    assert.deepEqual(tool.handle, { top: 0, bottom: 930 })
    assert.deepEqual(tool.extension, { top: '0px', height: '76px' })
    assert.equal(tool.overflowX, false)

    const closed = await window.webContents.executeJavaScript(`(() => {
      document.body.classList.remove('dsh-right-workspace-open','dsh-right-workspace-docked')
      document.getElementById('workspace').classList.remove('is-open')
      const runtime = document.getElementById('runtimeView').getBoundingClientRect()
      return { right:runtime.right,width:runtime.width }
    })()`, true)
    assert.deepEqual(closed, { right:1460, width:1460 })

    window.setContentSize(800, 700)
    await new Promise(resolve => setTimeout(resolve, 50))
    const compact = await window.webContents.executeJavaScript(`(() => {
      document.body.classList.add('dsh-right-workspace-open','dsh-right-workspace-docked')
      document.getElementById('workspace').classList.add('is-open')
      const panel = document.getElementById('workspace').getBoundingClientRect()
      const runtime = document.getElementById('runtimeView').getBoundingClientRect()
      return { panelTop: panel.top, panelBottom: panel.bottom, panelLeft: panel.left, panelRight: panel.right, panelWidth: panel.width, runtimeWidth: runtime.width, viewportWidth: innerWidth, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth }
    })()`, true)
    assert.equal(compact.panelTop, 0)
    assert.equal(compact.panelBottom, 700)
    assert.equal(compact.panelLeft, 48)
    assert.equal(compact.panelRight, compact.viewportWidth)
    assert.equal(compact.panelWidth, 752)
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
