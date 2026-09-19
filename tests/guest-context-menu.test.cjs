const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')

test('local link context menu preserves source-bound preview and reveal actions', async () => {
  const [main, links] = await Promise.all([
    source('electron/main.cjs'),
    source('renderer/workspace-links-integration.js')
  ])
  assert.match(links, /addEventListener\('contextmenu'/u)
  assert.match(links, /__HARNESS_DESKTOP_CONTEXT_LOCAL_TARGET__/u)
  assert.match(links, /sourceKind:\s*'workspace-link'/u)
  assert.match(main, /guestLocalTargetAtPoint\(guest, params\)/u)
  assert.match(main, /resolveGuestLocalTarget\(localValue\)/u)
  assert.match(main, /label: '在右侧工作区预览'/u)
  assert.match(main, /openRightWorkspaceTarget\(local, true\)/u)
  assert.match(main, /const runVisibleAction = \(label, action\) =>/u)
  assert.match(main, /dialog\.showMessageBox\(mainWindow,[\s\S]{0,260}message: `\$\{label\}失败`/u)
})

test('guest context menu editing commands target the conversation web contents', async () => {
  const main = await source('electron/main.cjs')
  assert.match(main, /const guestCommand = command => \(\) =>/u)
  for (const command of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
    assert.match(main, new RegExp(`click: guestCommand\\('${command}'\\)`, 'u'))
  }
  assert.doesNotMatch(main, /label: '复制', role: 'copy'/u)
  assert.doesNotMatch(main, /label: '全选', role: 'selectAll'/u)
})
