const test = require('node:test')
const assert = require('node:assert/strict')
const { WindowsUiAutomationSource, encodedCommand, rowsToTree } = require('../electron/bridge/windows-ui-automation-source.cjs')

test('UI Automation flat rows become a bounded target-scoped tree', () => {
  const tree = rowsToTree([
    { parent: -1, role: 'Window', name: 'Editor', runtimeId: '1', bounds: { x: 10, y: 20, width: 300, height: 200 }, enabled: true },
    { parent: 0, role: 'Button', name: 'Save', runtimeId: '1.2', clickable: true, enabled: true },
    { parent: 0, role: 'Edit', name: 'Password', runtimeId: '1.3', isPassword: true, editable: true, enabled: true }
  ], { id: 'window:7', window: { exeName: 'editor.exe' } })
  assert.equal(tree.targetId, 'window:7')
  assert.equal(tree.children[0].name, 'Save')
  assert.equal(tree.children[0].clickable, true)
  assert.equal(tree.children[1].name, '')
  assert.equal(tree.children[1].sensitive, true)
  assert.equal(tree.children[1].editable, true)
})

test('UI Automation source uses fixed scripts and never performs sensitive controls', async () => {
  const calls = []
  const source = new WindowsUiAutomationSource({
    available: true,
    run: async (script, input) => {
      calls.push({ script, input })
      if (input.maxNodes) return { rows: [{ parent: -1, role: 'Window', name: 'VM', runtimeId: '7' }] }
      return { handled: true, via: 'InvokePattern' }
    }
  })
  const tree = await source.observe({ id: 'window:99', kind: 'window', hwnd: 99, window: {} }, { maxNodes: 42 })
  assert.equal(tree.name, 'VM')
  assert.equal(calls[0].input.hwnd, 99)
  assert.equal(calls[0].input.maxNodes, 42)
  assert.deepEqual(await source.perform('type', { sensitive: true }), { handled: false, sensitive: true })
  assert.equal(calls.length, 1)
  assert.deepEqual(await source.perform('click', { targetId: 'window:99', runtimeId: '7', name: 'Run' }), { handled: true, via: 'InvokePattern' })
  assert.equal(calls[1].input.action, 'click')
})

test('PowerShell command encoding is UTF-16LE for EncodedCommand', () => {
  assert.equal(Buffer.from(encodedCommand('Write-Output ok'), 'base64').toString('utf16le'), 'Write-Output ok')
})
