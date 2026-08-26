const assert = require('node:assert/strict')
const test = require('node:test')
const os = require('node:os')
const path = require('node:path')
const { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, lstat, writeFile } = require('node:fs/promises')

const api = import('../plugins/dsh-codex-image-bridge/src/core.js')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const THREAD = '01a03401-c8d5-7b71-a480-257394b6f507'
const NATIVE_ROOT = process.platform === 'win32' ? 'C:\\root' : '/root'
const NATIVE_WORK = process.platform === 'win32' ? 'C:\\work' : '/work'
const NATIVE_CODEX = process.platform === 'win32' ? 'C:\\codex.exe' : '/codex'

function protocol() {
  return { stdout: { readFrom: () => ({ text: JSON.stringify({ type: 'thread.started', thread_id: THREAD }), lossy: false }) } }
}

async function temp() {
  return mkdtemp(path.join(os.tmpdir(), 'codex-image-bridge-'))
}

async function expectCode(value, code) {
  const { ImageBridgeError } = await api
  await assert.rejects(value, error => error instanceof ImageBridgeError && error.code === code)
}

function typeOf(value) {
  return value.isFile() ? 'file' : value.isDirectory() ? 'directory' : value.isSymbolicLink() ? 'symlink' : 'other'
}

function localFs() {
  const target = value => ({ displayPath: value, path: value })
  return {
    async resolve(value, options = {}) { return target(await realpath(path.resolve(options.cwd || '', value))) },
    contains(parent, child) {
      const relative = path.relative(parent.path, child.path)
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    },
    async stat(value) {
      try {
        const info = await stat(value.path)
        return { type: typeOf(info), size: info.size }
      } catch (error) {
        if (error.code === 'ENOENT') return undefined
        throw error
      }
    },
    async lstat(value, options = {}) {
      try {
        const info = await lstat(path.resolve(options.cwd || '', value))
        return { type: typeOf(info), size: info.size }
      } catch (error) {
        if (error.code === 'ENOENT') return undefined
        throw error
      }
    },
    async readBytes(value, _signal, maxBytes) {
      const data = await readFile(value.path)
      if (data.length > maxBytes) {
        const error = new Error('too large')
        error.code = 'FS_TOO_LARGE'
        throw error
      }
      return new Uint8Array(data)
    },
    async listDir(value) {
      return (await readdir(value.path, { withFileTypes: true })).map(entry => ({
        name: entry.name,
        type: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other',
        target: target(path.join(value.path, entry.name))
      }))
    },
    processPath(value) { return value.path }
  }
}

function config(root) {
  return {
    enabled: true,
    codexExecutable: NATIVE_CODEX,
    codexHome: root,
    outputRoot: root,
    timeoutMs: 1_000,
    graceMs: 50,
    maxPromptChars: 100,
    maxInputBytes: 1_024,
    maxOutputBytes: 1_024,
    stdoutMaxBytes: 1_024,
    stderrMaxBytes: 1_024
  }
}

function imageRef(width = 1024, height = 1024) {
  return { attachmentId: 'sha256:test', mediaType: 'image/png', bytes: PNG.length, width, height, name: 'result.png' }
}

test('image bridge schema is closed and mode-aware', async () => {
  const { validateRequest } = await api
  assert.deepEqual(validateRequest({ mode: 'generate', prompt: 'fox', size: '1024x1024' }), { mode: 'generate', prompt: 'fox', size: '1024x1024' })
  assert.throws(() => validateRequest({ mode: 'generate', prompt: 'x', size: '1024x1024', argv: [] }), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => validateRequest({ mode: 'edit', prompt: 'x', size: '1024x1024' }), { code: 'INPUT_REQUIRED' })
})

test('enabled image bridge config requires an absolute executable', async () => {
  const { validateConfig } = await api
  assert.throws(() => validateConfig({ ...config(NATIVE_ROOT), codexExecutable: 'codex' }), { code: 'CODEX_PATH_INVALID' })
})

test('image bridge detects media signatures', async () => {
  const { detectMediaType } = await api
  assert.equal(detectMediaType(PNG), 'image/png')
  assert.equal(detectMediaType(Buffer.from([0xff, 0xd8, 0xff])), 'image/jpeg')
  assert.equal(detectMediaType(Buffer.from('bad')), undefined)
})

test('image bridge sends prompts on stdin and never as argv', async () => {
  const { buildCodexArgs, buildCodexPrompt } = await api
  const hostile = '--dangerously-bypass-approvals-and-sandbox'
  const args = buildCodexArgs()
  assert.equal(args.at(-1), '-')
  assert.equal(args.includes(hostile), false)
  assert.match(buildCodexPrompt({ mode: 'generate', size: '1024x1024', prompt: hostile }), /<user_request>/u)
})

test('image bridge subprocess is bounded, terminated, and awaited', async () => {
  const { buildCodexArgs, runCodex } = await api
  let spec
  let terminated = false
  let waited = false
  const subprocess = {
    async resolveExecutable(value) { return value },
    spawn(value) {
      spec = value
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: protocol(),
        terminate() { terminated = true },
        async waitForExit() { waited = true; return true }
      }
    }
  }
  await runCodex(subprocess, NATIVE_CODEX, buildCodexArgs(), NATIVE_WORK, 'visual', config(NATIVE_ROOT), new AbortController().signal)
  assert.deepEqual(spec.stdio.stdin, { data: 'visual' })
  assert.equal(spec.argv.at(-1), '-')
  assert.equal(spec.env, undefined)
  assert.equal(terminated, true)
  assert.equal(waited, true)
})

test('image bridge process failure never exposes diagnostics', async () => {
  const { runCodex } = await api
  const subprocess = {
    async resolveExecutable(value) { return value },
    spawn() {
      return {
        done: Promise.resolve({ exitCode: 1, signal: null }),
        collected: { stderr: { readFrom: () => ({ text: 'SECRET_TOKEN' }) } },
        terminate() {},
        async waitForExit() { return true }
      }
    }
  }
  await assert.rejects(
    runCodex(subprocess, NATIVE_CODEX, [], NATIVE_WORK, 'x', config(NATIVE_ROOT)),
    error => error.code === 'CODEX_FAILED' && !error.message.includes('SECRET_TOKEN')
  )
})

test('image bridge normalizes edit input through attachment storage', async () => {
  const { resolveInputImage } = await api
  const root = await temp()
  try {
    await writeFile(path.join(root, 'in.png'), PNG)
    let saved = false
    let read = false
    const attachments = {
      async saveImage(input) { saved = input.mediaType === 'image/png'; return imageRef() },
      async readImage(ref) { read = true; return { ref, data: new Uint8Array(PNG) } }
    }
    const value = await resolveInputImage(localFs(), attachments, 'in.png', root, 1_024, new AbortController().signal)
    assert.equal(saved && read, true)
    assert.deepEqual(Buffer.from(value.data), PNG)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('image bridge isolates requests, validates the attachment, and cleans up', async () => {
  const { executeImageBridge } = await api
  const workspace = await temp()
  const output = await temp()
  let cwd
  try {
    const subprocess = {
      async resolveExecutable(value) { return value },
      spawn(spec) {
        cwd = spec.cwd
        return {
          done: (async () => {
            const directory = path.join(output, 'generated_images', THREAD)
            await mkdir(directory, { recursive: true })
            await writeFile(path.join(directory, 'result.png'), PNG)
            return { exitCode: 0, signal: null }
          })(),
          collected: protocol(),
          terminate() {},
          async waitForExit() { return true }
        }
      }
    }
    const value = await executeImageBridge(
      { mode: 'generate', prompt: 'fox', size: '1024x1024' },
      { agent: { session: { header: { cwd: workspace } } }, signal: new AbortController().signal },
      { fs: localFs(), subprocess, attachments: { async saveImage() { return imageRef() } } },
      config(output)
    )
    assert.equal(value.image.attachmentId, 'sha256:test')
    await assert.rejects(stat(path.dirname(cwd)), { code: 'ENOENT' })
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(output, { recursive: true, force: true })
  }
})

test('image bridge rejects extra outputs and wrong dimensions', async () => {
  const { executeImageBridge } = await api
  for (const scenario of ['extra', 'dimensions']) {
    const workspace = await temp()
    const output = await temp()
    try {
      const subprocess = {
        async resolveExecutable(value) { return value },
        spawn() {
          return {
            done: (async () => {
              const directory = path.join(output, 'generated_images', THREAD)
              await mkdir(directory, { recursive: true })
              await writeFile(path.join(directory, scenario === 'extra' ? 'a.png' : 'result.png'), PNG)
              if (scenario === 'extra') await writeFile(path.join(directory, 'b.png'), PNG)
              return { exitCode: 0, signal: null }
            })(),
            collected: protocol(),
            terminate() {},
            async waitForExit() { return true }
          }
        }
      }
      await expectCode(executeImageBridge(
        { mode: 'generate', prompt: 'x', size: '1024x1024' },
        { agent: { session: { header: { cwd: workspace } } }, signal: new AbortController().signal },
        { fs: localFs(), subprocess, attachments: { saveImage: async () => scenario === 'extra' ? imageRef() : imageRef(512, 768) } },
        config(output)
      ), scenario === 'extra' ? 'OUTPUT_COUNT_INVALID' : 'OUTPUT_DIMENSIONS_INVALID')
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(output, { recursive: true, force: true })
    }
  }
})
