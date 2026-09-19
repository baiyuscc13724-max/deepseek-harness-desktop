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
  // Execute the real menu builder, rather than requiring Electron role syntax.
  // A role targets the outer shell; this contract must prove exact-guest dispatch.
  const start = main.indexOf('async function showGuestContextMenu(')
  const end = main.indexOf('async function chooseWorkspaceDirectory(', start)
  assert.ok(start >= 0 && end > start)
  let template
  const ownerWindow = { isDestroyed: () => false }
  const build = new Function('deps', `const { contextMenuRequests, Menu, externalWebUrl } = deps; ${main.slice(start, end)}; return showGuestContextMenu`)(
    { contextMenuRequests: new WeakMap(), Menu: { buildFromTemplate(items) { template = items; return { popup() {} } } }, externalWebUrl: () => '' }
  )
  const calls = []
  let destroyed = false
  const guest = { isDestroyed: () => destroyed }
  for (const command of ['copy', 'cut', 'paste', 'pasteAndMatchStyle', 'undo', 'redo', 'selectAll']) {
    guest[command] = function () { assert.equal(this, guest); calls.push(command) }
  }
  await build(guest, { isEditable: true, editFlags: { canCopy: true, canCut: true, canPaste: true, canUndo: true, canRedo: true, canSelectAll: true } }, { ownerWindow, allowLocal: false })
  for (const label of ['复制', '剪切', '粘贴', '粘贴为纯文本', '撤销', '重做', '全选']) {
    const item = template.find(item => item.label === label)
    assert.equal(item.enabled, true, label)
    assert.equal(item.role, undefined, `${label} must not dispatch to the shell role`)
    item.click()
  }
  assert.deepEqual(calls, ['copy', 'cut', 'paste', 'pasteAndMatchStyle', 'undo', 'redo', 'selectAll'])
  destroyed = true
  template.find(item => item.label === '复制').click()
  assert.equal(calls.length, 7, 'destroyed originating guest is never replaced by another target')
  destroyed = false
  await build(guest, { isEditable: false, selectionText: '' }, { ownerWindow, allowLocal: false })
  assert.equal(template.find(item => item.label === '复制').enabled, false)
  await build(guest, { isEditable: false, selectionText: 'synthetic selection' }, { ownerWindow, allowLocal: false })
  template.find(item => item.label === '复制').click()
  assert.equal(calls.at(-1), 'copy')
  assert.match(main, /label: '取消选择', enabled: Boolean\(params\.selectionText\)/u)
  assert.match(main, /label: '复制链接地址', click: \(\) => clipboard\.writeText\(external\)/u)
  assert.match(guestPreload, /if \(selection && !selection\.isCollapsed\) \{\s*selection\.removeAllRanges\(\)\s*return\s*\}\s*event\.preventDefault\(\)/u)
  assert.match(guestPreload, /if \(event\.key !== 'Escape'\) return\s*const selection = window\.getSelection\?\.\(\)\s*if \(selection && !selection\.isCollapsed\) selection\.removeAllRanges\(\)/u)
})

test('browser view teardown tolerates webContents already being released', async () => {
  const main = await readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /function closeBrowserViewContents\(\) \{[\s\S]*const views = \[\.\.\.browserTabs\.values\(\)\]\.map\(tab => tab\.view\)[\s\S]*browserView = null[\s\S]*browserTabs\.clear\(\)[\s\S]*for \(const view of views\)[\s\S]*if \(!contents \|\| typeof contents\.isDestroyed !== 'function' \|\| contents\.isDestroyed\(\)\) continue[\s\S]*contents\.close\(\)/u)
  assert.equal((main.match(/closeBrowserViewContents\(\)/gu) || []).length, 3)
  assert.doesNotMatch(main, /browserView && !browserView\.webContents\.isDestroyed\(\)/u)
})
