const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

test('browser model tools remain user-authorized, visible-tab-only and secret-blind', async () => {
  const [main, html, renderer, preload] = await Promise.all([
    readFile(path.join(root, 'electron', 'main.cjs'), 'utf8'),
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8'),
    readFile(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  ])
  assert.match(main, /requireVisibleBrowserForModel/u)
  assert.match(main, /browserSidebarVisible \|\| !browserContentVisible/u)
  assert.match(main, /\['click', 'type'\]\.includes\(action\)/u)
  assert.match(main, /redactSensitiveText/u)
  assert.match(main, /browserSecurityPolicy\.modelAction/u)
  assert.match(main, /HARNESS_DESKTOP_BROWSER_STATE_FILE/u)
  assert.match(html, /模型站点授权（2 小时）/u)
  assert.match(html, /提交（仍需逐次确认）/u)
  assert.match(renderer, /grantCurrentBrowserOrigin/u)
  assert.match(renderer, /confirmBrowserModelAction/u)
  assert.doesNotMatch(renderer, /executeJavaScript|document\.cookie/u)
  for (const channel of ['browser:grantCurrent', 'browser:revokeCurrent', 'browser:resumeModelControl', 'browser:confirmModelAction']) {
    assert.ok(preload.includes(channel))
    assert.ok(main.includes(channel))
  }
})
