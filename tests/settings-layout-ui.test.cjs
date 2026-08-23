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

function runBootstrap(dialog) {
  const document = {
    documentElement: {},
    head: { appendChild() {} },
    createElement() { return { dataset: {} } },
    querySelector(selector) {
      return selector === '[role="dialog"][aria-modal="true"]' ? dialog : null
    }
  }
  class MutationObserver {
    observe() {}
  }
  settingsBootstrap()({}, document, MutationObserver, setTimeout)()
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
