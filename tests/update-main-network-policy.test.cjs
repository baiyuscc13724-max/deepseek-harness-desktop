const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const mainFile = path.resolve(__dirname, '..', 'electron', 'main.cjs')

test('Electron system-network JSON fetch enforces the update redirect policy on every hop', async () => {
  const main = await readFile(mainFile, 'utf8')
  const start = main.indexOf('async function fetchJsonWithSystemNetwork')
  const end = main.indexOf('\nfunction componentUpdateBootstrapContext', start)
  assert.ok(start >= 0 && end > start)
  const source = main.slice(start, end)
  assert.match(source, /safeHttpsUpdateUrl\(url, '更新清单地址'\)/u)
  assert.match(source, /redirect: 'manual'/u)
  assert.match(source, /resolveUpdateRedirect\(current, location, \{ redirectCount, maxRedirects, allowedHosts \}\)/u)
  assert.doesNotMatch(source, /redirect: 'follow'/u)
  assert.doesNotMatch(source, /\['https:', 'http:'\]/u)
})
