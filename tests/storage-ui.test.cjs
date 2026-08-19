const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

test('desktop shell exposes a preview-first protected storage manager', async () => {
  const [html, renderer, preload, main] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'storage-manager.js'), 'utf8'),
    readFile(path.join(root, 'electron', 'preload.cjs'), 'utf8'),
    readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  ])

  assert.match(html, /id="storageQuickButton"/u)
  assert.match(html, /id="storageOverlay"/u)
  assert.match(html, /不会清理会话、附件、记忆或当前运行时/u)
  assert.match(html, /id="storageConfirm"/u)
  assert.match(html, /storage-manager\.js/u)

  assert.match(renderer, /previewStorageCleanup/u)
  assert.match(renderer, /activePreview\.previewId/u)
  assert.match(renderer, /confirmed: true/u)
  assert.doesNotMatch(renderer, /rm\(|unlink\(|rmdir\(/u)

  assert.match(preload, /storage:cleanupPreview/u)
  assert.match(preload, /storage:cleanupApply/u)
  assert.match(main, /assertDesktopShellSender\(event\)/u)
  assert.match(main, /StorageManagementService/u)
})
