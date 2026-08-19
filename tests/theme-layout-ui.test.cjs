const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')

test('desktop themes lock the outer viewport while preserving mobile page scrolling', async () => {
  const source = await readFile(path.join(root, 'renderer', 'theme-integration.js'), 'utf8')
  assert.match(source, /:not\(\[data-harness-mobile="true"\]\) body,\s*html\[data-hd-theme\].*:not\(\[data-harness-mobile="true"\]\) #root \{ width:100%; height:100%; min-height:0 !important; overflow:hidden !important; \}/u)
  assert.match(source, /\[data-harness-mobile="true"\] body,\s*html\[data-hd-theme\].*\[data-harness-mobile="true"\] #root \{ min-height:100vh; \}/u)
  assert.match(source, /if \(root\.dataset\.harnessMobile === 'true' \|\| root\.dataset\.hdTheme === 'official'\) return/u)
  assert.match(source, /if \(window\.scrollX !== 0 \|\| window\.scrollY !== 0\) window\.scrollTo\(0, 0\)/u)
  assert.match(source, /if \(refreshTheme\) applyTheme\(\)\s*stabilizeWorkbenchViewport\(\)/u)
})
