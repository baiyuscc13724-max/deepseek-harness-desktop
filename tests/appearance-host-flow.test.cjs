const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createSkinPickerHost,
  createSettingsDialogCloser,
  closeDesktopSettingsDialog,
  mobileBootstrapSource
} = require('../renderer/theme-integration.js')

function fakeElement(initialClasses = []) {
  const classes = new Set(initialClasses)
  const attributes = new Map()
  return {
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value)
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.get(name),
    focusCalls: 0,
    focus() { this.focusCalls += 1 }
  }
}

function fakeOfficialSettingsDialog(closeText = '关闭') {
  let closeClicks = 0
  const closeButton = {
    title: '',
    textContent: closeText,
    getAttribute: () => '',
    click: () => { closeClicks += 1 }
  }
  const dialog = {
    dataset: { hdAppearanceHost: 'true' },
    closest: selector => selector === '[role="dialog"]' ? dialog : null,
    querySelector: () => null,
    querySelectorAll: selector => selector === 'button' ? [closeButton] : []
  }
  return {
    dialog,
    document: { querySelectorAll: () => [dialog] },
    closeClicks: () => closeClicks
  }
}

test('successful appearance apply closes both the native overlay and its settings host', async () => {
  const overlay = fakeElement(['hidden'])
  const trigger = fakeElement()
  const settings = fakeOfficialSettingsDialog()
  const closeSettingsDialog = createSettingsDialogCloser(settings.document)
  const host = createSkinPickerHost({
    overlay,
    trigger,
    closeSettingsDialog: async () => closeSettingsDialog(settings.dialog)
  })

  const settingsRequest = new URL('harness-desktop://open-appearance/?source=settings')
  host.open({ fromSettings: settingsRequest.searchParams.get('source') === 'settings' })
  assert.equal(overlay.classList.contains('hidden'), false)
  assert.equal(overlay.getAttribute('aria-hidden'), 'false')

  const result = await host.apply(async () => 'applied')
  assert.equal(result, 'applied')
  assert.equal(overlay.classList.contains('hidden'), true)
  assert.equal(overlay.getAttribute('aria-hidden'), 'true')
  assert.equal(trigger.focusCalls, 1)
  assert.equal(settings.closeClicks(), 1)
})

test('successful apply from the top-bar quick picker closes only the native overlay', async () => {
  const overlay = fakeElement(['hidden'])
  const trigger = fakeElement()
  const settings = fakeOfficialSettingsDialog('Close')
  const closeSettingsDialog = createSettingsDialogCloser(settings.document)
  const host = createSkinPickerHost({
    overlay,
    trigger,
    closeSettingsDialog: async () => closeSettingsDialog(settings.dialog)
  })

  host.open()
  await host.apply(async () => 'applied')
  assert.equal(overlay.classList.contains('hidden'), true)
  assert.equal(settings.closeClicks(), 0)
})

test('canceled and failed imports keep their settings host open', async () => {
  const overlay = fakeElement(['hidden'])
  const settings = fakeOfficialSettingsDialog()
  const closeSettingsDialog = createSettingsDialogCloser(settings.document)
  const host = createSkinPickerHost({
    overlay,
    trigger: fakeElement(),
    closeSettingsDialog: async () => closeSettingsDialog(settings.dialog)
  })

  host.open({ fromSettings: true })
  const canceled = await host.apply(async () => false, Boolean)
  assert.equal(canceled, false)
  assert.equal(overlay.classList.contains('hidden'), false)
  assert.equal(settings.closeClicks(), 0)

  await assert.rejects(host.apply(async () => { throw new Error('copy failed') }), /copy failed/)
  assert.equal(overlay.classList.contains('hidden'), false)
  assert.equal(settings.closeClicks(), 0)

  host.close()
  assert.equal(overlay.classList.contains('hidden'), true)
  assert.equal(settings.closeClicks(), 0)
})

test('desktop settings close delegates to the live official runtime document', async () => {
  let executed = ''
  const webview = {
    getURL: () => 'http://127.0.0.1:3000/',
    executeJavaScript: async script => { executed = script; return true }
  }
  assert.equal(await closeDesktopSettingsDialog(webview), true)
  assert.match(executed, /__HARNESS_DESKTOP_CLOSE_SETTINGS_DIALOG__/)

  let emptyRuntimeExecuted = false
  assert.equal(await closeDesktopSettingsDialog({
    getURL: () => '',
    executeJavaScript: async () => { emptyRuntimeExecuted = true }
  }), false)
  assert.equal(emptyRuntimeExecuted, false)
})

test('the generated guest bootstrap includes the executable official settings closer', () => {
  assert.doesNotThrow(() => new Function(mobileBootstrapSource))
  assert.match(mobileBootstrapSource, /\^\(\?:关闭\|close\|×\)\$/i)
})
