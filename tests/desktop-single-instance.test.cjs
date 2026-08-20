const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('normal desktop launches hold one shared session-log writer', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const lock = source.indexOf('app.requestSingleInstanceLock()')
  const ready = source.indexOf('app.whenReady().then')

  assert.ok(lock >= 0 && lock < ready, 'single-instance lock must be acquired before app readiness')
  assert.match(source, /if \(!HAS_SINGLE_INSTANCE_LOCK\) \{\s*app\.quit\(\)\s*return/)
  assert.match(source, /function showMainWindow\(\)[\s\S]*mainWindow\.focus\(\)/)
  assert.match(source, /app\.on\('second-instance',[\s\S]*showMainWindow\(\)/)
  assert.match(source, /const MANUAL_VALIDATION_MODE = process\.argv\.includes\('--manual-validation'\) && process\.argv\.some\(value => \/\^--user-data-dir=\.\+\/\.test\(value\)\)/)
  assert.match(source, /const HAS_SINGLE_INSTANCE_LOCK = SELF_TEST_MODE \|\| COMPONENT_HEALTH_CHECK_MODE \|\| MANUAL_VALIDATION_MODE \|\| app\.requestSingleInstanceLock\(\)/)
})
