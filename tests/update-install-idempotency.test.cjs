const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const main = readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
const renderer = readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8')

test('installing while already current is an idempotent success', () => {
  assert.match(main, /if \(!update\?\.updateAvailable\) \{\s*return \{ ok: true, version: update\?\.currentVersion \|\| app\.getVersion\(\), ready: false, upToDate: true \}\s*\}/u)
  assert.doesNotMatch(main, /throw new Error\('当前桌面版已经是最新版本。'\)/u)
})

test('renderer clears stale update errors and paints the current state normally', () => {
  assert.match(renderer, /checking: true, checkError: '', installError: ''/u)
  assert.match(renderer, /checking: false, checkError: '', installError: ''/u)
  assert.match(renderer, /if \(!component && result\?\.upToDate\)/u)
  assert.match(renderer, /installProgress: \{ phase: 'current', version \}/u)
  assert.match(renderer, /if \(progress\.phase === 'current'\) return '当前桌面版已经是最新版本。'/u)
})
