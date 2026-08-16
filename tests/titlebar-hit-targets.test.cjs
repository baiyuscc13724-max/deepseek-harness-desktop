const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('window drag surface spans the title bar without covering desktop or native controls', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'renderer', 'styles.css'), 'utf8')
  const rule = source.match(/\.window-drag\s*\{([^}]*)\}/)?.[1] ?? ''
  const petButtonRule = source.match(/\.pet-quick-button\s*\{([^}]*)\}/)?.[1] ?? ''
  const skinButtonRule = source.match(/\.skin-quick-button\s*\{([^}]*)\}/)?.[1] ?? ''

  assert.match(rule, /left:\s*0(?:px)?\b/)
  assert.match(rule, /right:\s*208px/)
  assert.match(rule, /height:\s*36px/)
  assert.match(rule, /(?:^|[;\s])app-region:\s*drag/)
  assert.match(rule, /-webkit-app-region:\s*drag/)
  assert.doesNotMatch(rule, /width:\s*24px/)
  assert.match(petButtonRule, /right:\s*176px/)
  assert.match(petButtonRule, /(?:^|[;\s])app-region:\s*no-drag/)
  assert.match(petButtonRule, /-webkit-app-region:\s*no-drag/)
  assert.match(skinButtonRule, /right:\s*140px/)
  assert.match(skinButtonRule, /(?:^|[;\s])app-region:\s*no-drag/)
  assert.match(skinButtonRule, /-webkit-app-region:\s*no-drag/)
})

test('desktop pet card closes when the user clicks outside it', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'renderer', 'app.js'), 'utf8')

  assert.match(source, /document\.addEventListener\('pointerdown', event => \{/)
  assert.match(source, /petPanel\.contains\(event\.target\) \|\| petQuickButton\.contains\(event\.target\)/)
  assert.match(source, /runtimeView\.addEventListener\('focus', closePetPanel\)/)
  assert.match(source, /closePetPanel\(\)/)
})
