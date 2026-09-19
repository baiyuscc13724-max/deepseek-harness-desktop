const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { syncBuiltinESMExports } = require('node:module')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { previewLocalDocument, loadRightWorkspaceResource } = require('../electron/bridge/right-workspace-service.cjs')
const { openLocalTarget, normalizeLocalTarget } = require('../electron/bridge/local-target-service.cjs')
test('explicit local paths preserve literal percent escapes instead of opening another filename', () => {
  const input = 'D:\\files\\report%20draft%25.md'
  assert.equal(normalizeLocalTarget(input).path, input)
})
const root = path.resolve(__dirname, '..')

test('workspace text preview also consumes short reads and closes the descriptor', async t => {
  const dir = await temp(t), file = path.join(dir, 'short.md'), text = '完整文本 complete body'
  await fs.writeFile(file, text)
  const mod = await plugin('dsh-desktop-files'), original = fs.open
  let closed = false
  fs.open = async (...args) => {
    const handle = await original(...args)
    if (args[0] !== file) return handle
    return { read: (buffer, offset, length, position) => handle.read(buffer, offset, Math.min(2, length), position), close: async () => { closed = true; await handle.close() } }
  }
  syncBuiltinESMExports()
  try { assert.equal((await mod.previewFile(dir, 'short.md')).text, text); assert.equal(closed, true) }
  finally { fs.open = original; syncBuiltinESMExports() }
})

test('upload size and empty-body rejection do not create a file', async () => {
  for (const name of ['dsh-desktop-files', 'dsh-session-experience']) {
    const { collectBody } = await plugin(name)
    const req = chunks => ({ headers: {}, async *[Symbol.asyncIterator]() { yield* chunks } })
    await assert.rejects(collectBody(req([]), 3), /空/u)
    await assert.rejects(collectBody(req([Buffer.from('ab'), Buffer.from('cd')]), 3), /50 MB/u)
    assert.equal((await collectBody(req([Buffer.from('abc')]), 3)).toString(), 'abc')
  }
})

test('source resolution accepts exact live/cold roots and rejects cross-project member borrowing', async t => {
  const { readWorkspaceSource } = await plugin('dsh-desktop-files')
  const dir = await temp(t), other = await temp(t)
  const parent = { session: { header: { id: 'parent', cwd: dir } } }
  const child = { session: { header: { id: 'child', cwd: dir, parentSession: 'parent', origin: 'subagent' } } }
  const agents = new Map([['parent', parent], ['child', child]])
  const ctx = { agents: { get: id => agents.get(id), roots: () => [parent], isOwnedBy: (id, owner) => id === 'child' && owner === parent } }
  assert.equal((await readWorkspaceSource(ctx, 'parent')).cwd, dir)
  assert.equal((await readWorkspaceSource(ctx, 'child')).cwd, dir)
  child.session.header.cwd = other
  await assert.rejects(readWorkspaceSource(ctx, 'child'), error => error.code === 'FILES_NO_WORKSPACE')
  child.session.header.cwd = dir; ctx.agents.isOwnedBy = () => false
  await assert.rejects(readWorkspaceSource(ctx, 'child'), error => error.code === 'FILES_SESSION_NOT_LIVE')
  let disposed = 0
  ctx.get = () => ({ observeSession: async id => ({ header: { id, cwd: dir }, [Symbol.dispose]() { disposed++ } }) })
  assert.equal((await readWorkspaceSource(ctx, 'cold')).cwd, dir); assert.equal(disposed, 1)
  ctx.get = () => ({ observeSession: async id => ({ header: { id: 'wrong', cwd: dir }, [Symbol.dispose]() { disposed++ } }) })
  await assert.rejects(readWorkspaceSource(ctx, 'cold'), error => error.code === 'FILES_SESSION_NOT_LIVE'); assert.equal(disposed, 2)
})

function previewFixture(options = {}) {
  const { EventEmitter } = require('node:events'), { WorkspacePreviewBridge } = require('../electron/bridge/workspace-preview-bridge.cjs')
  const win = new EventEmitter(), contents = new EventEmitter(); let nonce, captures = 0
  Object.assign(contents, { mainFrame: {}, isDestroyed: () => false, getZoomFactor: () => 1,
    send(channel, value) { if (channel.endsWith('modelPreview')) { nonce = value.nonce; queueMicrotask(() => bridge.acceptReceipt({ sender: contents, senderFrame: contents.mainFrame }, { ...value, revision: 1, state: options.receiptState || 'rendered' })) } },
    executeJavaScript: async () => ({ nonce, path: 'report.md', sourceSessionId: 'fixture-source', revision: 1, state: options.inspectState || 'rendered', contentKind: 'text', textExcerpt: 'fixture text', rect: { x: 600, y: 0, width: 400, height: 800 }, viewport: { width: 1000, height: 800, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 } }),
    capturePage: async rect => { captures++; assert.deepEqual(rect, { x: 600, y: 0, width: 400, height: 800 }); return { isEmpty: () => false, getSize: () => ({ width: 400 }), toPNG: () => Buffer.from('mock-image') } }
  })
  Object.assign(win, { webContents: contents, isDestroyed: () => false, isVisible: () => options.visible !== false, isMinimized: () => false, getContentSize: () => [1000, 800], getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }) })
  const bridge = new WorkspacePreviewBridge({ getWindow: () => win, timeoutMs: 100, loadFile: options.loadFile || (async () => ({ sessionId: 'fixture-source', file: { sourceSessionId: 'fixture-source', previewable: true } })) })
  const input = { scope: 'workspace', action: 'preview', payload: { path: 'report.md', sourceSessionId: 'fixture-source' } }
  return { bridge, input, contents, win, captures: () => captures }
}

test('model preview binds receipt and crops only the document, with all listeners cleaned', async () => {
  const fixture = previewFixture(), result = await fixture.bridge.preview(fixture.input)
  assert.equal(result.state, 'rendered'); assert.equal(result.sourceBound, true); assert.equal(fixture.captures(), 1)
  assert.equal(fixture.contents.listenerCount('destroyed'), 0); assert.equal(fixture.win.listenerCount('resize'), 0)
  assert.equal(fixture.bridge.pending, null)
})

test('model preview refuses hidden, superseded, and failed receipts without returning old images', async () => {
  for (const options of [{ visible: false }, { inspectState: 'superseded' }, { receiptState: 'failed' }]) {
    const fixture = previewFixture(options), result = await fixture.bridge.preview(fixture.input)
    assert.notEqual(result.state, 'rendered'); assert.equal(result.image, undefined); assert.equal(fixture.captures(), 0)
  }
})

test('model preview cancellation clears single-flight and a later request may retry', async () => {
  const wait = deferred(), fixture = previewFixture({ loadFile: () => wait.promise }), control = new AbortController()
  const pending = fixture.bridge.preview(fixture.input, { signal: control.signal })
  assert.equal((await fixture.bridge.preview(fixture.input)).code, 'WORKSPACE_PREVIEW_BUSY')
  control.abort(); assert.equal((await pending).state, 'unconfirmed'); assert.equal(fixture.bridge.pending, null)
  wait.resolve({ sessionId: 'fixture-source', file: { sourceSessionId: 'fixture-source', previewable: true } })
  const next = await fixture.bridge.preview(fixture.input); assert.equal(next.state, 'rendered')
})
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = () => new Promise(resolve => setImmediate(resolve))
function hooks() {
  const values = [], effects = []; let cursor = 0, pending = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useRef(value) { const i = cursor++; return values[i] || (values[i] = { current: value }) },
    useState(value) { const i = cursor++; if (!(i in values)) values[i] = value; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next }] },
    useEffect(effect, deps) { const i = cursor++; if (!effects[i] || !deps || deps.some((v, n) => v !== effects[i].deps[n])) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: effect() } }) }
  }
  React.useLayoutEffect = React.useEffect
  return { React, values, render(component, props) { cursor = 0; const tree = component(props); const queued = pending; pending = []; queued.forEach(fn => fn()); return tree }, dispose() { effects.forEach(item => item?.cleanup?.()) } }
}
async function clientForAudit(name, hook, windowOverrides = {}) {
  let registration
  const window = { __ModuleLoader__: { load: value => { registration = value } }, ...windowOverrides }
  const source = (await fs.readFile(path.join(root, 'plugins', name, 'lib/client.js'), 'utf8')).replace('exports.apply = apply', name === 'dsh-desktop-directory-picker' ? 'exports.__audit = { DesktopDirectoryFlow, pickerBridge }; exports.apply = apply' : 'exports.__audit = { ArchiveView }; exports.apply = apply')
  const document = { documentElement: { dataset: {} }, addEventListener() {}, removeEventListener() {} }
  new Function('window', 'document', 'crypto', 'navigator', source)(window, document, require('node:crypto').webcrypto, { language: 'zh-CN' })
  return registration.factory(name => {
    if (name === 'react') return hook.React
    if (name === '@deepseek-ai/dsh-client-runtime/client') return { isAppendSurfaceEvent: event => event?.surfaceOp === 'append' }
    throw new Error('unexpected dependency ' + name)
  }).__audit
}
function buttons(tree) { if (!tree || typeof tree !== 'object') return []; return [...(tree.type === 'button' ? [tree] : []), ...(tree.children || []).flatMap(buttons)] }

test('directory picker close/reopen ignores the old selection receipt', async t => {
  const h = hooks(), first = deferred(), second = deferred(), picked = []; let calls = 0
  const api = await clientForAudit('dsh-desktop-directory-picker', h, { harnessDesktopGuest: { chooseWorkspaceDirectory: () => (++calls === 1 ? first : second).promise } })
  t.after(async () => { first.resolve(null); second.resolve(null); await flush(); h.dispose() })
  const props = { open: true, onPicked: value => picked.push(value), onCancel() {}, onError(error) { throw new Error(error) } }
  h.render(api.DesktopDirectoryFlow, props)
  h.render(api.DesktopDirectoryFlow, { ...props, open: false })
  h.render(api.DesktopDirectoryFlow, props)
  first.resolve('old-project'); await flush()
  assert.deepEqual(picked, [])
  second.resolve('new-project'); await flush(); assert.deepEqual(picked, ['new-project']); h.dispose()
})

test('directory picker synchronous native failure releases pending request', async () => {
  const h = hooks(), api = await clientForAudit('dsh-desktop-directory-picker', h, { harnessDesktopGuest: { chooseWorkspaceDirectory() { throw new Error('native unavailable') } } })
  const bridge = api.pickerBridge()
  try { await assert.rejects(Promise.resolve().then(() => bridge.request()), /native unavailable/); assert.equal(bridge.pending.size, 0) }
  finally { for (const [id] of bridge.pending) bridge.settle(id, null, ''); h.dispose() }
})

test('archive restore is single-flight and success waits for the child to open', async () => {
  const h = hooks(), forked = deferred(), opened = deferred(); let forks = 0
  const api = await clientForAudit('dsh-session-experience', h)
  const sessions = { list: { getSnapshot: () => ({ byId: { old: { id: 'old', title: 'archive' } } }) }, fork() { forks++; return forked.promise }, open: () => opened.promise }
  const props = { sessions, workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: ['old'] }) } } }
  const tree = h.render(api.ArchiveView, props), restore = buttons(tree).find(item => item.children.includes('恢复为新会话'))
  assert.ok(restore); restore.props.onClick(); restore.props.onClick()
  assert.equal(forks, 1)
  forked.resolve('child'); await flush()
  assert.equal(h.values.some(value => typeof value === 'string' && value.includes('恢复副本')), false)
  assert.equal(buttons(h.render(api.ArchiveView, props)).find(item => item.children.includes('恢复为新会话')).props.disabled, true)
  opened.resolve(); await flush()
  assert.equal(h.values.includes('已从归档会话恢复副本'), true); h.dispose()
})

test('archive open failure clears busy and supports an explicit retry', async () => {
  const h = hooks(); let attempts = 0
  const api = await clientForAudit('dsh-session-experience', h)
  const props = { sessions: { list: { getSnapshot: () => ({ byId: { old: { id: 'old' } } }) }, fork: async () => 'child', open: async () => { if (++attempts === 1) throw new Error('fixture unavailable') } }, workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: ['old'] }) } } }
  const button = () => buttons(h.render(api.ArchiveView, props)).find(item => item.children.includes('恢复为新会话'))
  button().props.onClick(); await flush()
  assert.equal(h.values.some(value => typeof value === 'string' && value.includes('fixture unavailable')), true)
  assert.equal(button().props.disabled, false)
  button().props.onClick(); await flush(); assert.equal(attempts, 2); assert.equal(h.values.includes('已从归档会话恢复副本'), true); h.dispose()
})

test('archive permanent-delete double activation sends exactly one request', async () => {
  const h = hooks(), response = deferred(); let requests = 0
  const api = await clientForAudit('dsh-session-experience', h, { fetch: () => { requests++; return response.promise } })
  const props = { sessions: { list: { getSnapshot: () => ({ byId: { old: { id: 'old' } } }) } }, workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: ['old'] }) } } }
  let tree = h.render(api.ArchiveView, props)
  buttons(tree).find(item => item.children.includes('删除历史')).props.onClick()
  tree = h.render(api.ArchiveView, props)
  const confirm = buttons(tree).find(item => item.children.includes('永久删除'))
  confirm.props.onClick(); confirm.props.onClick(); assert.equal(requests, 1)
  response.resolve({ ok: true, json: async () => ({}) }); await flush(); h.dispose()
})
const plugin = name => import(pathToFileURL(path.join(root, 'plugins', name, 'lib/index.js')).href)
async function temp(t) { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-deep-files-'))); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir }

for (const name of ['dsh-desktop-files', 'dsh-session-experience']) {
  test(`${name}: simultaneous identical names never overwrite successful upload receipts`, async t => {
    const dir = await temp(t)
    const { saveUpload } = await plugin(name)
    const original = fs.lstat, originalNow = Date.now
    let clock = originalNow()
    Date.now = () => ++clock
    let arrivals = 0, release
    const rendezvous = new Promise(resolve => { release = resolve })
    // Force the former check-then-rename window. This injection only delays two
    // actual ENOENT reads; filesystem writes and upload implementation stay real.
    fs.lstat = async (...args) => {
      try { return await original(...args) } catch (error) {
        if (error.code === 'ENOENT' && String(args[0]).endsWith('collision.txt')) {
          if (++arrivals === 2) release()
          await rendezvous
        }
        throw error
      }
    }
    syncBuiltinESMExports()
    try {
      const values = [Buffer.from('first'), Buffer.from('second')]
      const results = await Promise.all(values.map(value => saveUpload(dir, 'collision.txt', value)))
      assert.equal(new Set(results.map(item => item.path)).size, 2, 'each acknowledged upload needs its own path')
      for (let i = 0; i < results.length; i++) assert.deepEqual(await fs.readFile(path.join(dir, results[i].path)), values[i])
    } finally { release(); Date.now = originalNow; fs.lstat = original; syncBuiltinESMExports() }
  })
  test(`${name}: unsupported atomic publication cleans staging, preserves originals and remains retryable`, async t => {
    const dir = await temp(t), { saveUpload } = await plugin(name)
    await saveUpload(dir, 'report.txt', Buffer.from('original'))
    const link = fs.link
    try {
      for (const code of ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']) {
        fs.link = async () => { throw Object.assign(new Error('unsupported fixture'), { code }) }; syncBuiltinESMExports()
        await assert.rejects(saveUpload(dir, 'report.txt', Buffer.from('attempt')), error => error.code === 'UPLOAD_ATOMIC_PUBLISH_UNAVAILABLE' && /NTFS.*重试/u.test(error.message))
        assert.deepEqual(await fs.readdir(path.join(dir, 'uploads')), ['report.txt'])
        assert.equal(await fs.readFile(path.join(dir, 'uploads/report.txt'), 'utf8'), 'original')
      }
    } finally { fs.link = link; syncBuiltinESMExports() }
    const retry = await saveUpload(dir, 'report.txt', Buffer.from('retry'))
    assert.equal(retry.path, 'uploads/report-1.txt')
    assert.equal(await fs.readFile(path.join(dir, retry.path), 'utf8'), 'retry')
  })
  test(`${name}: staging write failure closes the file and removes the incomplete upload`, async t => {
    const dir = await temp(t), { saveUpload } = await plugin(name), original = fs.open
    let closed = 0
    fs.open = async (...args) => {
      const handle = await original(...args)
      return { writeFile: async () => { throw new Error('fixture disk full') }, close: async () => { closed++; await handle.close() } }
    }; syncBuiltinESMExports()
    try { await assert.rejects(saveUpload(dir, 'broken.txt', Buffer.from('data')), /fixture disk full/u); assert.equal(closed, 1); assert.deepEqual(await fs.readdir(path.join(dir, 'uploads')), []) }
    finally { fs.open = original; syncBuiltinESMExports() }
    assert.equal((await saveUpload(dir, 'broken.txt', Buffer.from('retry'))).path, 'uploads/broken.txt')
  })
  test(`${name}: upload filenames reject Windows ADS and device aliases`, async () => {
    const { safeFileName } = await plugin(name)
    for (const name of ['payload.exe:note.txt', 'CON.txt', 'NUL', 'bad?.txt', 'ends. ']) {
      const safe = safeFileName(name)
      assert.doesNotMatch(safe, /[<>:"/\\|?*\u0000-\u001f]/u)
      assert.doesNotMatch(safe, /[. ]$/u)
      assert.doesNotMatch(safe, /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu)
    }
  })
}

test('local preview reads short chunks to EOF rather than silently truncating', async () => {
  const bytes = Buffer.from('complete text preview')
  let closed = false
  const result = await previewLocalDocument(path.resolve('notes.md'), {
    realpathImpl: async value => value,
    statImpl: async () => ({ isFile: () => true, size: bytes.length }),
    openImpl: async () => ({ read: async (buffer, offset, length, position) => {
      const count = Math.min(3, length, bytes.length - position)
      bytes.copy(buffer, offset, position, position + count)
      return { bytesRead: count }
    }, close: async () => { closed = true } })
  })
  assert.equal(result.text, bytes.toString())
  assert.equal(closed, true)
})

test('preview input provenance remains immutable across pending fetch', async () => {
  let resolve
  const pending = new Promise(yes => { resolve = yes })
  const options = { runtimeUrl: 'http://127.0.0.1:8906', kind: 'filePreview', sessionId: 'source-A', path: 'first.md', fetchImpl: () => pending }
  const work = loadRightWorkspaceResource(options)
  options.sessionId = 'source-B'; options.path = 'second.md'
  resolve({ ok: true, headers: { get: () => null }, arrayBuffer: async () => Buffer.from(JSON.stringify({ sessionId: 'source-A', file: { previewable: true } })) })
  const value = await work
  assert.equal(value.file.sourceSessionId, 'source-A')
  assert.equal(new URL(value.file.contentUrl).searchParams.get('path'), 'first.md')
})

test('system open classifies success, executable reveal, missing path and fallback without real applications', async () => {
  let opens = 0, reveals = 0
  const adapters = { statImpl: async () => ({ isDirectory: () => false }), openPath: async () => { opens++; return '' }, showItemInFolder: () => { reveals++ } }
  assert.equal((await openLocalTarget(path.resolve('document.txt'), adapters)).action, 'open-file')
  assert.equal((await openLocalTarget(path.resolve('payload.exe'), adapters)).action, 'reveal-blocked-executable')
  assert.equal(opens, 1); assert.equal(reveals, 1)
  assert.equal((await openLocalTarget(path.resolve('document.txt'), { ...adapters, openPath: async () => 'No association' })).ok, false)
  await assert.rejects(openLocalTarget(path.resolve('missing.txt'), { ...adapters, statImpl: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } }), /路径不存在/u)
})

test('Windows deep canonical Git worktree remains usable without shortening roots', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const { spawn, execFile } = require('node:child_process')
  const exec = require('node:util').promisify(execFile)
  const dir = await temp(t), source = path.join(dir, 'source')
  await fs.mkdir(source)
  const gitCommand = path.join(root, 'third_party/mingit/cmd/git.exe')
  const git = args => exec(gitCommand, ['-c', 'core.longpaths=true', ...args], { cwd: source, env: process.env, windowsHide: true, timeout: 10000 })
  await git(['init']); await fs.writeFile(path.join(source, 'README.md'), 'fixture only\n')
  await git(['add', '-A']); await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'fixture'])
  // Each segment is legal. Only the complete administrative path crosses 260.
  const padding = Math.max(10, 165 - dir.length)
  const deep = path.join(dir, 'deep-' + 'x'.repeat(padding))
  const authorityRoot = path.join(deep, 'authority'), workspaceRoot = path.join(deep, 'worktrees')
  const { GitWorkspaceAdapter } = await import(pathToFileURL(path.join(root, 'plugins/dsh-agent-teams/lib/git-workspace-adapter.js')).href)
  const failures = []
  const adapter = new GitWorkspaceAdapter({ gitCommand, allowedGitRoot: path.join(root, 'third_party/mingit'), sourceWorkspaceRoot: source, authorityRoot, workspaceRoot, repositoryRef: 'repository_' + 'R'.repeat(26), spawnImpl(command, args, options) {
    const child = spawn(command, args, options); let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('close', code => { if (code !== 0) failures.push({ args, code, stderr }) })
    return child
  } })
  try {
    const initial = await adapter.initialize()
    const workspaceRef = 'workspace_' + 'W'.repeat(32)
    const metadata = path.join(adapter.repositoryPath, 'worktrees', workspaceRef)
    t.diagnostic(JSON.stringify({ repositoryLength: adapter.repositoryPath.length, metadataLength: metadata.length, workspaceLength: path.join(workspaceRoot, workspaceRef).length }))
    assert.ok(metadata.length > 260)
    const opened = await adapter.ensureTaskWorkspace({ workspaceRef, baseCommit: initial.headCommit })
    assert.equal(opened.created, true)
  } finally { t.diagnostic(JSON.stringify({ gitFailures: failures })); await adapter.close() }
})
