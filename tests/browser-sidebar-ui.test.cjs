const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

test('Codex-style right sidebar browser uses an isolated visible login profile', async () => {
  const [html, renderer, preload, main] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8'),
    readFile(path.join(root, 'electron', 'preload.cjs'), 'utf8'),
    readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  ])

  assert.match(html, /id="browserQuickButton"/u)
  assert.match(html, /id="browserSidebar"/u)
  assert.match(html, /id="browserAddress"/u)
  assert.match(html, /请直接在下方真实网页中亲自登录/u)
  assert.match(html, /模型无法读取密码、Cookie、验证码或令牌/u)
  assert.match(html, /browser-sidebar\.js/u)

  assert.match(main, /new WebContentsView/u)
  assert.match(main, /BrowserSecurityPolicy/u)
  assert.match(main, /partition: browserSecurityPolicy\.partitionName/u)
  assert.match(main, /nodeIntegration: false/u)
  assert.match(main, /sandbox: true/u)
  assert.match(main, /setPermissionRequestHandler/u)
  assert.match(main, /clearStorageData/u)
  assert.match(main, /request\?\.confirmed === true/u)
  assert.doesNotMatch(renderer, /document\.cookie|executeJavaScript|password/u)

  for (const channel of ['browser:state', 'browser:setVisible', 'browser:navigate', 'browser:clearSiteData', 'browser:clearAllData']) {
    assert.ok(preload.includes(channel), `preload missing ${channel}`)
    assert.ok(main.includes(channel), `main missing ${channel}`)
  }
})
