const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')

test('local link context menu preserves reveal-in-folder after workspace layout changes', async () => {
  const [main, links] = await Promise.all([
    source('electron/main.cjs'),
    source('renderer/workspace-links-integration.js')
  ])
  assert.match(links, /addEventListener\('contextmenu'/u)
  assert.match(links, /__HARNESS_DESKTOP_CONTEXT_LOCAL_TARGET__/u)
  assert.match(links, /hdLocalTarget/u)
  assert.match(main, /for \(const candidate of \[params\.linkURL, params\.srcURL\]\)/u)
  assert.match(main, /__HARNESS_DESKTOP_CONTEXT_LOCAL_TARGET__/u)
  assert.match(main, /打开链接所在文件夹/u)
  assert.match(main, /openDesktopLocalTarget\(localValue, true\)/u)
})
