const assert = require('node:assert/strict')
const test = require('node:test')
const os = require('node:os')
const path = require('node:path')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')

const { physicalUnpackedPath, resolveDshBin } = require('../electron/bridge/dsh-resolver.cjs')

test('packaged runtime resolves from the physical app.asar.unpacked tree', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-dsh-resolver-'))
  try {
    const virtual = path.join(root, 'app.asar', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    const physical = path.join(root, 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    await mkdir(path.dirname(physical), { recursive: true })
    await writeFile(physical, '{}')
    assert.equal(physicalUnpackedPath(virtual), physical)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bundled Harness Web runtime enables the Node internals required by HMR', () => {
  const originalCommand = process.env.HARNESS_DESKTOP_DSH_COMMAND
  delete process.env.HARNESS_DESKTOP_DSH_COMMAND
  try {
    const resolved = resolveDshBin()
    assert.equal(resolved.source, 'bundled')
    assert.equal(resolved.argsPrefix[0], '--expose-internals')
    assert.match(resolved.argsPrefix[1], /@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/)
  } finally {
    if (originalCommand === undefined) delete process.env.HARNESS_DESKTOP_DSH_COMMAND
    else process.env.HARNESS_DESKTOP_DSH_COMMAND = originalCommand
  }
})

test('packaged runtime can resolve from the versioned local runtime cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-dsh-cache-'))
  try {
    const packageRoot = path.join(root, '@deepseek-ai', 'dsh')
    const cli = path.join(packageRoot, 'lib', 'bin.js')
    await mkdir(path.dirname(cli), { recursive: true })
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ version: 'test', bin: { dsh: 'lib/bin.js' } }))
    await writeFile(cli, 'console.log("cached")')
    const resolved = resolveDshBin({ nodeModulesRoot: root })
    assert.equal(resolved.source, 'bundled')
    assert.equal(resolved.version, 'test')
    assert.equal(resolved.argsPrefix[1], cli)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
