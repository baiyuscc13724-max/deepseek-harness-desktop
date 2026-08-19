const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { readFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const { ensureDesktopBrowserToolsPlugin } = require('../electron/bridge/desktop-browser-tools-plugin-service.cjs')

const bundledRoot = path.resolve(__dirname, '..', 'plugins', 'dsh-desktop-browser-tools')
const ACTIONS = ['status', 'observe', 'navigate', 'click', 'type', 'stop']
const FORBIDDEN = ['Cookie', 'password', 'token', 'OTP', 'banking', 'payment']

async function loadPluginTool() {
  const mod = await import(pathToFileURL(path.join(bundledRoot, 'lib', 'index.js')).href)
  let tool
  mod.apply({ tools: { register: registered => { tool = registered } } })
  return { mod, tool }
}

test('desktop browser tools installs into the DSH Web profile idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-browser-tools-'))
  try {
    const first = await ensureDesktopBrowserToolsPlugin({ dshHome: root, bundledRoot })
    const second = await ensureDesktopBrowserToolsPlugin({ dshHome: root, bundledRoot })
    assert.equal(first.version, '1.0.0')
    assert.equal(first.patchChanged, true)
    assert.equal(second.patchChanged, false)
    assert.match(readFileSync(path.join(first.destination, 'lib', 'index.js'), 'utf8'), /browser_control/)
    const patch = await readFile(path.join(root, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')
    assert.equal((patch.match(/dsh-desktop-browser-tools/g) || []).length, 1)
    assert.match(patch, /id: desktop-browser-tools/u)
    assert.match(patch, /name: dsh-desktop-browser-tools/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('browser_control tool exposes exactly the fixed action enum', async () => {
  const { tool } = await loadPluginTool()
  const properties = tool.parameters.properties
  assert.equal(tool.name, 'browser_control')
  assert.ok(tool.parameters.required.includes('action'))
  assert.deepEqual(properties.action.enum, ACTIONS)
  assert.equal(properties.action.type, 'string')
  for (const key of ['url', 'ref', 'text', 'confirmation_id']) {
    assert.ok(properties[key], `missing payload parameter ${key}`)
  }
})

test('browser_control description keeps sensitive terms out and warns type forever', async () => {
  const { tool } = await loadPluginTool()
  const properties = tool.parameters.properties
  const description = tool.description
  const textDescription = properties.text.description
  for (const word of FORBIDDEN) {
    assert.ok(!description.includes(word), `description must not contain ${word}`)
  }
  assert.match(description, /永远禁止/u)
  assert.match(description, /固定动作/u)
  assert.match(textDescription, /永远禁止/u)
  assert.match(textDescription, /敏感/u)
})

test('browser_control token comes only from the state file and hits exactly its loopback origin', async () => {
  const { tool } = await loadPluginTool()
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-browser-tools-token-'))
  const stateFile = path.join(root, 'state.json')
  try {
    await writeFile(stateFile, JSON.stringify({ origin: 'http://127.0.0.1:9347', token: 'secret-from-state' }))
    const previousEnv = process.env.HARNESS_DESKTOP_BROWSER_STATE_FILE
    const previousFetch = globalThis.fetch
    process.env.HARNESS_DESKTOP_BROWSER_STATE_FILE = stateFile
    let captured
    globalThis.fetch = async (url, init) => {
      captured = { url, headers: init.headers, body: JSON.parse(init.body) }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, action: 'status' }) }
    }
    try {
      const result = await tool.execute({ action: 'status' }, {})
      assert.deepEqual(result, { ok: true, action: 'status' })
      // Token must be the one from the state file, declared only as a Bearer header.
      assert.equal(captured.headers.Authorization, 'Bearer secret-from-state')
      assert.equal(new URL(captured.url).origin, 'http://127.0.0.1:9347')
      assert.equal(new URL(captured.url).pathname, '/action')
      assert.equal(captured.body.action, 'status')
      // Arbitrary args are never used as the credential.
      assert.equal(JSON.stringify(tool.parameters).includes('secret-from-state'), false)
    } finally {
      globalThis.fetch = previousFetch
      if (previousEnv === undefined) delete process.env.HARNESS_DESKTOP_BROWSER_STATE_FILE
      else process.env.HARNESS_DESKTOP_BROWSER_STATE_FILE = previousEnv
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('browser_control rejects a non-loopback origin from the state file', async () => {
  const { mod } = await loadPluginTool()
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-browser-tools-host-'))
  const stateFile = path.join(root, 'state.json')
  try {
    await writeFile(stateFile, JSON.stringify({ origin: 'https://evil.example.com', token: 'x' }))
    const previousEnv = process.env.HARNESS_DESKTOP_BROWSER_STATE_FILE
    const previousFetch = globalThis.fetch
    process.env.HARNESS_DESKTOP_BROWSER_STATE_FILE = stateFile
    globalThis.fetch = async () => { throw new Error('must not be reached') }
    const applyErr = await new Promise(resolve => {
      mod.apply({ tools: { register: tool => {
        tool.execute({ action: 'status' }, {}).then(() => resolve(null), error => resolve(error))
      } } })
    })
    try {
      assert.ok(applyErr instanceof Error)
      assert.match(applyErr.message, /回环|loopback/iu)
    } finally {
      globalThis.fetch = previousFetch
      if (previousEnv === undefined) delete process.env.HARNESS_DESKTOP_BROWSER_STATE_FILE
      else process.env.HARNESS_DESKTOP_BROWSER_STATE_FILE = previousEnv
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
