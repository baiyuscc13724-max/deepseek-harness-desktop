const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

test('desktop shell exposes low-profile automatic local memory with deletion controls', async () => {
  const [html, renderer, preload, main] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'memory-manager.js'), 'utf8'),
    readFile(path.join(root, 'electron', 'preload.cjs'), 'utf8'),
    readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  ])

  assert.match(html, /id="memoryQuickButton" class="memory-quick-button hidden"/u)
  assert.match(html, /id="memoryOverlay"/u)
  assert.match(html, /完全本地、后台低干扰/u)
  assert.match(html, /密码、令牌、Cookie、银行卡和验证码不会保存/u)
  assert.match(html, /id="memoryAutoCapture"/u)
  assert.match(html, /id="memoryDeleteAllConfirm"/u)
  assert.match(html, /id="memoryDeleteExports"/u)
  assert.match(html, /安全擦除数据库中的全部本地记忆/u)
  assert.match(html, /memory-manager\.js/u)

  assert.match(renderer, /setMemoryEnabled/u)
  assert.match(renderer, /searchMemories/u)
  assert.match(renderer, /autoCapture: autoCapture\.checked/u)
  assert.match(renderer, /onOpenDataManager/u)
  assert.match(renderer, /deleteAllMemories\(\{ confirmed: true, deleteExports: deleteExports\.checked \}\)/u)
  assert.match(renderer, /已安全擦除/u)
  assert.doesNotMatch(renderer, /node:sqlite|document\.cookie|localStorage/u)

  for (const channel of ['memory:status', 'memory:setEnabled', 'memory:setPreferences', 'memory:add', 'memory:search', 'memory:deleteAll']) {
    assert.ok(preload.includes(channel), `preload missing ${channel}`)
    assert.ok(main.includes(channel), `main missing ${channel}`)
  }
  assert.match(main, /assertDesktopShellSender\(event\)/u)
  assert.match(main, /request\?\.confirmed !== true/u)
  assert.match(main, /MemoryService/u)
})
