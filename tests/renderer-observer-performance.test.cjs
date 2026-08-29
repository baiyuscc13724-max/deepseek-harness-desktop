'use strict'

const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

function officialSettingsMutationPredicate(source) {
  const declaration = '  const officialSettingsMutationTouchesUi = '
  const start = source.indexOf(declaration)
  const end = source.indexOf('\n  let mountScheduled = false', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  return new Function(`return (${source.slice(start + declaration.length, end)})`)()
}

function fakeElement({ button = false, label = '', inSettings = false, mounted = false, containsMounted = false, buttons = [] } = {}) {
  return {
    nodeType: 1,
    textContent: button ? '' : label,
    matches(selector) { return selector === 'button' ? button : mounted },
    closest() { return inSettings ? {} : null },
    querySelector() { return containsMounted ? {} : null },
    querySelectorAll(selector) { return selector === 'button' ? buttons : [] },
    getAttribute(name) { return name === 'aria-label' ? label : null }
  }
}

test('official settings mounting ignores ordinary conversation mutations', async () => {
  const source = await readFile(path.join(root, 'renderer', 'app.js'), 'utf8')
  const touches = officialSettingsMutationPredicate(source)
  const ordinary = fakeElement()
  assert.equal(touches([{ target: ordinary, addedNodes: [fakeElement()], removedNodes: [] }]), false)
  assert.equal(touches([{ target: fakeElement({ inSettings: true }), addedNodes: [], removedNodes: [] }]), true)
  assert.equal(touches([{ target: ordinary, addedNodes: [fakeElement({ containsMounted: true })], removedNodes: [] }]), true)
  assert.equal(touches([{ target: ordinary, addedNodes: [fakeElement({ button: true, label: 'Settings' })], removedNodes: [] }]), true)
  assert.equal(touches([{ target: ordinary, addedNodes: [], removedNodes: [fakeElement({ mounted: true })] }]), true)
  assert.match(source, /new MutationObserver\(records => \{\s*if \(officialSettingsMutationTouchesUi\(records\)\) scheduleMount\(\)/u)
})

test('subagent DOM rescans keep trailing-edge timing without per-mutation timer churn', async () => {
  const source = await readFile(path.join(root, 'renderer', 'app.js'), 'utf8')
  const start = source.indexOf('function officialSubagentEnhancementsBootstrap() {')
  const end = source.indexOf('\nfunction showPrPreviewNotice(', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const bootstrap = source.slice(start, end)

  assert.match(bootstrap, /scanDeadline = performance\.now\(\) \+ 70/u)
  assert.match(bootstrap, /const remaining = scanDeadline - performance\.now\(\)/u)
  assert.match(bootstrap, /timer \?\?= setTimeout\(flushScan, 70\)/u)
  assert.match(bootstrap, /timer = setTimeout\(flushScan, remaining\)/u)
  assert.doesNotMatch(bootstrap, /clearTimeout\(timer\)/u)
  assert.match(bootstrap, /new MutationObserver\(schedule\)\.observe\(document\.documentElement, \{ childList: true, subtree: true, characterData: true \}\)/u)
  assert.match(bootstrap, /addEventListener\('resize', schedule\)/u)
})
