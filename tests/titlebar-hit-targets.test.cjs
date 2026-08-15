const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('window drag handle stays inside the reserved shell gap', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'renderer', 'styles.css'), 'utf8')
  const rule = source.match(/\.window-drag\s*\{([^}]*)\}/)?.[1] ?? ''

  assert.match(rule, /right:\s*208px/)
  assert.match(rule, /width:\s*24px/)
  assert.match(rule, /height:\s*36px/)
  assert.match(rule, /-webkit-app-region:\s*drag/)
  assert.doesNotMatch(rule, /left:\s*0(?:px)?\b/)
})
