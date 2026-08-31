const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFileSync } = require('node:fs')

const root = path.join(__dirname, '..')
const androidRuntime = readFileSync(path.join(root, 'mobile/android/app/src/main/assets/mobile-runtime.js'), 'utf8')
const iosRuntime = readFileSync(path.join(root, 'mobile/ios/HarnessMobile/Resources/mobile-runtime.js'), 'utf8')
const androidCss = readFileSync(path.join(root, 'mobile/android/app/src/main/assets/mobile-compat.css'), 'utf8')
const iosCss = readFileSync(path.join(root, 'mobile/ios/HarnessMobile/Resources/mobile-compat.css'), 'utf8')

const createLightbox = close => {
  const mask = { kind: 'mask' }
  const image = { kind: 'image' }
  const dialog = {
    dataset: { harnessMobileSheet: 'true' },
    getAttribute: name => name === 'aria-modal' ? 'true' : null,
    matches: selector => selector === '[role="dialog"][aria-modal="true"]',
    querySelector: selector => selector === ':scope > div[aria-hidden="true"]'
      ? mask
      : selector === ':scope > img'
        ? image
        : selector === ':scope > button'
          ? close
          : null,
    querySelectorAll: () => []
  }
  return { dialog, mask, image }
}

test('mobile detects the attachment lightbox structurally and excludes generic sheet styling', () => {
  const helperStart = androidRuntime.indexOf('  const mobileImageLightboxParts = dialog => {')
  const helperEnd = androidRuntime.indexOf('  const installMobileBackHandler = () => {', helperStart)
  const decorateStart = androidRuntime.indexOf('  const decorateDialogs = () => {')
  const decorateEnd = androidRuntime.indexOf('  const decorateConversationWorkflow = conversation => {', decorateStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart)
  assert.ok(decorateStart >= 0 && decorateEnd > decorateStart)
  const helperSource = androidRuntime.slice(helperStart, helperEnd)
  const decorateSource = androidRuntime.slice(decorateStart, decorateEnd)
  const partsFor = new Function(`${helperSource}\nreturn mobileImageLightboxParts`)() // eslint-disable-line no-new-func
  const close = { dataset: {}, click() {} }
  const { dialog } = createLightbox(close)
  const focused = []
  const decorate = new Function('document', 'root', 'mobileImageLightboxParts', 'syncDialogFocus', 'decorateSettingsDialog', 'accessibleButtonText', 'officialSettingsSurface', 'visibleOfficialSettingsDialog', `${decorateSource}\nreturn decorateDialogs`) // eslint-disable-line no-new-func
    ({ querySelectorAll: () => [dialog] }, { dataset: {} }, partsFor, dialogs => focused.push(...dialogs), () => {}, () => '', () => null, () => false)
  decorate()
  assert.equal(dialog.dataset.harnessMobileImageLightbox, 'true')
  assert.equal(dialog.dataset.harnessMobileSheet, undefined)
  assert.equal(dialog.dataset.harnessMobileSettingsDialog, undefined)
  assert.equal(close.dataset.harnessMobileImageLightboxClose, 'true')
  assert.deepEqual(focused, [dialog])
})

test('system back dismisses a visible image lightbox without depending on translated labels', () => {
  const start = androidRuntime.indexOf('  const mobileImageLightboxParts = dialog => {')
  const end = androidRuntime.indexOf('  const syncMobileAppShell = () => {', start)
  assert.ok(start >= 0 && end > start)
  const source = androidRuntime.slice(start, end)
  let clicks = 0
  const close = { dataset: {}, getAttribute: () => '任意语言', textContent: '', click: () => { clicks += 1 } }
  const { dialog } = createLightbox(close)
  const shell = { querySelector: () => null }
  const document = {
    getElementById: id => id === 'harness-mobile-app-shell' ? shell : null,
    querySelectorAll: selector => selector === '[role="dialog"][aria-modal="true"]' ? [dialog] : [],
    querySelector: () => null
  }
  const window = {}
  const install = new Function('window', 'document', 'visible', `${source}\nreturn installMobileBackHandler`) // eslint-disable-line no-new-func
    (window, document, () => true)
  install()
  assert.equal(window.__harnessMobileHandleBack(), true)
  assert.equal(clicks, 1)
  assert.ok(source.indexOf('const imageLightbox') < source.indexOf('const projectSheet'), 'image preview must dismiss before lower navigation layers')
})

test('mobile lightbox CSS preserves viewport geometry and a touch-safe close control', () => {
  assert.match(androidCss, /\[data-harness-mobile-image-lightbox="true"\]\s*\{[^}]*position:\s*fixed\s*!important;[^}]*inset:\s*0\s*!important;[^}]*z-index:\s*1200\s*!important;[^}]*display:\s*grid\s*!important;[^}]*overflow:\s*visible\s*!important;[^}]*background:\s*transparent\s*!important;/su)
  assert.match(androidCss, /\[data-harness-mobile-image-lightbox="true"\] > div\[aria-hidden="true"\]\s*\{[^}]*position:\s*absolute\s*!important;[^}]*inset:\s*0\s*!important;[^}]*background:\s*var\(--dsw-alias-bg-mask-1/su)
  assert.match(androidCss, /\[data-harness-mobile-image-lightbox="true"\] > img\s*\{[^}]*max-height:\s*calc\(100dvh/su)
  assert.match(androidCss, /\[data-harness-mobile-image-lightbox="true"\] > img\s*\{[^}]*object-fit:\s*contain\s*!important;/su)
  assert.match(androidCss, /button\[data-harness-mobile-image-lightbox-close="true"\]\s*\{[^}]*position:\s*fixed\s*!important;[^}]*width:\s*48px\s*!important;[^}]*height:\s*48px\s*!important;[^}]*pointer-events:\s*auto\s*!important;/su)
})

test('Android and iOS share the same image preview escape behavior', () => {
  assert.equal(androidRuntime, iosRuntime)
  assert.equal(androidCss, iosCss)
})
