const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { componentDirectoryName } = require('../electron/bridge/component-update-store.cjs')
const { installComponentModulePaths, resolveComponentLayout } = require('../electron/bridge/component-runtime-resolver.cjs')

function record(id, version, digit) {
  const value = { id, version, sha256: digit.repeat(64) }
  return { ...value, directory: componentDirectoryName(value) }
}

test('runtime resolver selects immutable component roots and required entrypoints', () => {
  const shell = record('desktop-shell', '1.0.24', '1')
  const runtime = record('harness-runtime', '1.0.24', '2')
  const plugins = record('desktop-plugins', '1.0.24', '3')
  const store = { componentPath: component => path.join('C:\\Components', component.id, component.directory) }
  const expected = new Set([
    path.join(store.componentPath(shell), 'electron', 'main.cjs'),
    path.join(store.componentPath(runtime), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    store.componentPath(plugins)
  ].map(value => path.resolve(value)))
  const layout = resolveComponentLayout({
    store,
    pointer: { releaseVersion: '1.0.24', components: [shell, runtime, plugins] },
    bundledRoot: 'C:\\Bundled',
    exists: value => expected.has(path.resolve(value))
  })
  assert.equal(layout.shellEntry, path.join(layout.shellRoot, 'electron', 'main.cjs'))
  assert.equal(layout.runtimeNodeModules, path.join(layout.runtimeRoot, 'node_modules'))
  assert.equal(layout.pluginsRoot, store.componentPath(plugins))
})

test('runtime resolver falls back to bundled layout without a component pointer', () => {
  const bundledRoot = path.resolve('C:\\Bundled')
  const layout = resolveComponentLayout({
    store: { componentPath() { throw new Error('not expected') } },
    pointer: null,
    bundledRoot,
    exists: value => value === path.join(bundledRoot, 'electron', 'main.cjs')
  })
  assert.equal(layout.shellRoot, bundledRoot)
  assert.equal(layout.runtimeRoot, bundledRoot)
  assert.equal(layout.pluginsRoot, path.join(bundledRoot, 'plugins'))
})

test('module path installation prefers component runtime and strips duplicates', () => {
  const previous = process.env.NODE_PATH
  let initialized = false
  try {
    process.env.NODE_PATH = ['C:\\Existing', 'C:\\Runtime\\node_modules'].join(path.delimiter)
    const value = installComponentModulePaths({ runtimeNodeModules: 'C:\\Runtime\\node_modules' }, 'C:\\Bundled', {
      initPaths: () => { initialized = true }
    })
    const entries = value.split(path.delimiter)
    assert.equal(entries[0], 'C:\\Runtime\\node_modules')
    assert.equal(new Set(entries).size, entries.length)
    assert.equal(initialized, true)
  } finally {
    if (previous === undefined) delete process.env.NODE_PATH
    else process.env.NODE_PATH = previous
  }
})
