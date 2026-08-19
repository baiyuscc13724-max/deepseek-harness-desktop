const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')

test('official workbench text selection remains visibly highlighted and copyable', async () => {
  const [theme, main, guestPreload] = await Promise.all([
    readFile(path.join(root, 'renderer', 'theme-integration.js'), 'utf8'),
    readFile(path.join(root, 'electron', 'main.cjs'), 'utf8'),
    readFile(path.join(root, 'electron', 'guest-preload.cjs'), 'utf8')
  ])
  assert.match(theme, /html body \*::selection/u)
  assert.match(theme, /background:rgba\(49,94,251,\.30\) !important/u)
  assert.match(theme, /color-mix\(in srgb,var\(--dsw-alias-brand-primary,#315efb\) 32%,transparent\)/u)
  assert.match(theme, /color:inherit !important/u)
  assert.match(theme, /document\.addEventListener\('pointerdown'/u)
  assert.match(theme, /if \(event\.key === 'Escape'\) clearPageSelection\(\)/u)
  assert.match(theme, /selection\.removeAllRanges\(\)/u)
  assert.match(main, /label: '复制', role: 'copy', enabled: Boolean\(params\.selectionText\)/u)
  assert.match(main, /label: '取消选择', enabled: Boolean\(params\.selectionText\)/u)
  assert.match(main, /label: '复制链接地址', click: \(\) => clipboard\.writeText\(external\)/u)
  assert.match(guestPreload, /if \(selection && !selection\.isCollapsed\) \{\s*selection\.removeAllRanges\(\)\s*return\s*\}\s*event\.preventDefault\(\)/u)
  assert.match(guestPreload, /if \(event\.key !== 'Escape'\) return\s*const selection = window\.getSelection\?\.\(\)\s*if \(selection && !selection\.isCollapsed\) selection\.removeAllRanges\(\)/u)
})

test('browser view teardown tolerates webContents already being released', async () => {
  const main = await readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /function closeBrowserViewContents\(\) \{\s*const contents = browserView\?\.webContents\s*browserView = null\s*if \(!contents \|\| typeof contents\.isDestroyed !== 'function' \|\| contents\.isDestroyed\(\)\) return\s*contents\.close\(\)/u)
  assert.equal((main.match(/closeBrowserViewContents\(\)/gu) || []).length, 3)
  assert.doesNotMatch(main, /browserView && !browserView\.webContents\.isDestroyed\(\)/u)
})
