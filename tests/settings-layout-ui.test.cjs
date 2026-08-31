const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const appSource = readFileSync(path.resolve(__dirname, '..', 'renderer', 'app.js'), 'utf8')

function settingsBootstrap() {
  const start = appSource.indexOf('function officialSettingsBootstrap()')
  const end = appSource.indexOf('\nfunction officialSubagentEnhancementsBootstrap()', start)
  assert.ok(start >= 0 && end > start, 'official settings bootstrap source boundary is present')
  const source = appSource.slice(start, end)
  return new Function('window', 'document', 'MutationObserver', 'setTimeout', `${source}; return officialSettingsBootstrap;`)
}

function createEventTargetStub() {
  const listeners = new Map()
  return {
    addEventListener(type, listener, options) {
      if (typeof listener !== 'function') return
      const entries = listeners.get(type) || []
      if (!entries.some(entry => entry.listener === listener)) entries.push({ listener, once: options?.once === true })
      listeners.set(type, entries)
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type)
      if (!entries) return
      listeners.set(type, entries.filter(entry => entry.listener !== listener))
    },
    dispatchEvent(event) {
      const entries = [...(listeners.get(event.type) || [])]
      for (const entry of entries) {
        entry.listener.call(this, event)
        if (entry.once) this.removeEventListener(event.type, entry.listener)
      }
      return true
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length
    }
  }
}

function runBootstrap(dialog) {
  const window = createEventTargetStub()
  const documentEvents = createEventTargetStub()
  const document = {
    documentElement: {},
    head: { appendChild() {} },
    createElement() { return { dataset: {} } },
    ...documentEvents,
    querySelector(selector) {
      return selector === '[role="dialog"][aria-modal="true"]' ? dialog : null
    }
  }
  class MutationObserver {
    observe() {}
  }
  const bootstrap = settingsBootstrap()
  bootstrap(window, document, MutationObserver, setTimeout)()
  return { bootstrap, document, documentEvents, MutationObserver, window }
}

test('ordinary aria-modal dialog is never marked as a settings layout', () => {
  const dialog = {
    dataset: {},
    querySelector() { return null }
  }

  runBootstrap(dialog)

  assert.equal(dialog.dataset.hdSettingsLayout, undefined)
})

test('a dialog with the settings navigation receives the settings layout marker', () => {
  const general = {
    textContent: '通用设置',
    getAttribute() { return 'false' }
  }
  const settingsNav = {
    dataset: {},
    querySelectorAll(selector) { return selector === 'button' ? [general] : [] }
  }
  const content = { dataset: {}, lastElementChild: { dataset: {} } }
  const dialog = {
    dataset: {},
    querySelector(selector) {
      if (selector === ':scope > nav') return settingsNav
      if (selector === ':scope > nav + div') return content
      return null
    },
    querySelectorAll() { return [general] }
  }

  runBootstrap(dialog)

  assert.equal(dialog.dataset.hdSettingsLayout, 'true')
  assert.equal(settingsNav.dataset.hdSettingsNav, 'true')
  assert.equal(content.dataset.hdSettingsContent, 'true')
})

test('bootstrap registers window listeners once and remains idempotent', () => {
  const dialog = { dataset: {}, querySelector() { return null } }
  const context = runBootstrap(dialog)

  assert.equal(context.window.listenerCount('resize'), 1)
  assert.equal(context.document.listenerCount('keydown'), 1)

  context.bootstrap(context.window, context.document, context.MutationObserver, setTimeout)()

  assert.equal(context.window.listenerCount('resize'), 1)
  assert.equal(context.document.listenerCount('keydown'), 1)
})
