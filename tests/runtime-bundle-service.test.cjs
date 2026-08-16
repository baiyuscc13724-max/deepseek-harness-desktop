const assert = require('node:assert/strict')
const test = require('node:test')
const os = require('node:os')
const path = require('node:path')
const { access, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')

const { ensureRuntimeNodeModules } = require('../electron/bridge/runtime-bundle-service.cjs')

test('packaged Harness runtime expands from app.asar into one versioned user cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-runtime-bundle-'))
  try {
    const appRoot = path.join(root, 'resources', 'app.asar')
    const source = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(path.join(source, 'lib'), { recursive: true })
    await writeFile(path.join(source, 'package.json'), '{"version":"test"}')
    await writeFile(path.join(source, 'lib', 'bin.js'), 'console.log("ok")')
    await writeFile(path.join(source, 'lib', 'ignored.ts'), 'source')

    const options = { appRoot, userData: path.join(root, 'user-data'), appVersion: '1.2.3' }
    const destination = await ensureRuntimeNodeModules(options)
    assert.match(destination, /runtime[\\/]1\.2\.3-/u)
    assert.equal(await readFile(path.join(destination, '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'utf8'), 'console.log("ok")')
    await assert.rejects(access(path.join(destination, '@deepseek-ai', 'dsh', 'lib', 'ignored.ts')))
    assert.equal(await ensureRuntimeNodeModules(options), destination)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent packaged starts share one runtime cache installation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-runtime-concurrent-'))
  try {
    const appRoot = path.join(root, 'resources', 'app.asar')
    const source = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib')
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, 'bin.js'), 'console.log("ok")')
    const options = { appRoot, userData: path.join(root, 'user-data'), appVersion: '1.2.4' }

    const destinations = await Promise.all(Array.from({ length: 8 }, () => ensureRuntimeNodeModules(options)))
    assert.equal(new Set(destinations).size, 1)
    assert.equal(await readFile(path.join(destinations[0], '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'utf8'), 'console.log("ok")')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
