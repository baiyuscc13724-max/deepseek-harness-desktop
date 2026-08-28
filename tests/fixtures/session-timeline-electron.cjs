'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..', '..')
const profileRoot = process.env.HARNESS_TIMELINE_E2E_PROFILE || mkdtempSync(path.join(os.tmpdir(), 'hd-session-timeline-electron-'))
const clientSource = readFileSync(path.join(root, 'plugins', 'dsh-session-experience', 'lib', 'client.js'), 'utf8')

app.commandLine.appendSwitch('disable-gpu')
app.setPath('userData', profileRoot)

async function run() {
  await app.whenReady()
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: true
    }
  })

  try {
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'))
    await window.webContents.executeJavaScript('window.__ModuleLoader__={load(value){window.__timelineRegistration=value}};true', true)
    await window.webContents.executeJavaScript(clientSource, true)
    const result = await window.webContents.executeJavaScript(`(async () => {
      const registration = window.__timelineRegistration
      const plugin = registration.factory(name => {
        if (name === 'react') return { createElement() {}, useState() {}, useEffect() {}, useRef() {} }
        if (name === '@deepseek-ai/dsh-client-runtime/client') return { isAppendSurfaceEvent: event => event && event.surfaceOp === 'append' }
        throw new Error('unexpected dependency: ' + name)
      })
      const timeline = plugin.__timelineTest
      timeline.injectStyles()
      document.body.innerHTML = '<main data-phase="active"><div id="scroll" data-conversation-scroll style="position:relative;height:360px;overflow-y:auto"><section id="view" data-conversation-view="chat"><div data-chat-flow><div data-chat-flow-kind="user" style="height:300px">one</div><div data-chat-flow-kind="user" style="height:300px">two</div><div data-chat-flow-kind="user" style="height:300px">three</div></div></section><div data-composer-seat><div data-composer-card><textarea></textarea><button id="anchor" type="button">anchor</button></div></div></div></main>'
      const events = [
        { type:'user/message', seq:1, time:1, surfaceOp:'append', data:{ source:{kind:'user'}, content:[{type:'text',text:'first task'}] } },
        { type:'assistant/message', seq:2, time:2, surfaceOp:'append', data:{ message:{content:[{type:'text',text:'first result'}]} } },
        { type:'user/message', seq:3, time:3, surfaceOp:'append', data:{ source:{kind:'user'}, content:[{type:'text',text:'second task'}] } },
        { type:'assistant/message', seq:4, time:4, surfaceOp:'append', data:{ message:{content:[{type:'text',text:'second result'}]} } },
        { type:'user/message', seq:5, time:5, surfaceOp:'append', data:{ source:{kind:'user'}, content:[{type:'text',text:'third task'}] } },
        { type:'assistant/message', seq:6, time:6, surfaceOp:'append', data:{ message:{content:[{type:'text',text:'third result'}]} } }
      ]
      let subscriber = null
      let inserted = null
      const session = { events, subscribe(listener) { subscriber = listener; return () => { subscriber = null } } }
      const sessions = { binding(id) { return id === 'session-e2e' ? { session } : undefined } }
      const cleanup = timeline.installInlineTimelineRail({
        sessionId: 'session-e2e',
        sessions,
        inputActions: { insertReference(reference) { inserted = reference; return true } },
        anchor: document.getElementById('anchor')
      })
      const rail = document.querySelector('.dse-inline-timeline')
      const markers = Array.from(document.querySelectorAll('.dse-inline-timeline-marker'))
      const currentIndex = () => markers.findIndex(marker => marker.dataset.current === 'true')
      const display = () => getComputedStyle(rail).display
      const before = { markerCount: markers.length, current: currentIndex(), display: display() }
      const scroll = document.getElementById('scroll')
      scroll.scrollTop = 320
      scroll.dispatchEvent(new Event('scroll'))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const afterScroll = { current: currentIndex(), transform: getComputedStyle(markers[currentIndex()].firstElementChild).transform }
      const settings = document.createElement('section')
      settings.dataset.harnessDesktopSettingsLayout = 'true'
      document.body.appendChild(settings)
      const settingsDisplay = display()
      settings.remove()
      const view = document.getElementById('view')
      view.dataset.conversationView = 'agent-teams'
      const agentTeamsDisplay = display()
      view.dataset.conversationView = 'chat'
      const restoredDisplay = display()
      markers[1].dispatchEvent(new MouseEvent('mouseenter'))
      const popover = document.querySelector('.dse-inline-timeline-popover')
      const popoverVisible = !popover.hidden
      document.querySelector('.dse-inline-timeline-reference').click()
      const reference = inserted
      const focusRestored = document.activeElement === document.querySelector('textarea')
      if (typeof subscriber === 'function') subscriber()
      await new Promise(resolve => requestAnimationFrame(resolve))
      const currentAfterDataRefresh = currentIndex()
      cleanup()
      return {
        before,
        afterScroll,
        settingsDisplay,
        agentTeamsDisplay,
        restoredDisplay,
        popoverVisible,
        reference,
        focusRestored,
        currentAfterDataRefresh,
        removed: !document.querySelector('.dse-inline-timeline')
      }
    })()`, true)

    assert.deepEqual(result.before, { markerCount: 3, current: 0, display: 'block' })
    assert.equal(result.afterScroll.current, 1)
    assert.notEqual(result.afterScroll.transform, 'none')
    assert.equal(result.settingsDisplay, 'none')
    assert.equal(result.agentTeamsDisplay, 'none')
    assert.equal(result.restoredDisplay, 'block')
    assert.equal(result.popoverVisible, true)
    assert.equal(result.reference.source, 'timeline')
    assert.equal(result.reference.appearance, 'session')
    assert.match(result.reference.clipboardText, /^@timeline:3-4$/)
    assert.equal(result.focusRestored, true)
    assert.equal(result.currentAfterDataRefresh, 1)
    assert.equal(result.removed, true)
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

run().then(() => {
  app.exit(0)
}, error => {
  console.error(error && error.stack ? error.stack : error)
  app.exit(1)
})
