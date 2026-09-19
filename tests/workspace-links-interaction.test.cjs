const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')

function extractFunction(text, name, nextName) {
  const start = text.indexOf(`function ${name}(`)
  const end = text.indexOf(`function ${nextName}(`, start)
  assert.notEqual(start, -1, `missing ${name}`)
  assert.notEqual(end, -1, `missing boundary ${nextName}`)
  return text.slice(start, end)
}

test('streaming text mutations only revisit a containing code path', async () => {
  const links = await source('renderer/workspace-links-integration.js')
  assert.match(links, /const redecorateContainingCode = node =>[\s\S]*?element\?\.matches\?\.\('code'\) \? element : element\?\.closest\?\.\('code'\)[\s\S]*?if \(inlineCode\) decorate\(inlineCode\)/u)
  assert.match(links, /for \(const record of records\) \{\s*redecorateContainingCode\(record\.target\)\s*for \(const node of record\.addedNodes\) decorateNode\(node\)/u)
  assert.doesNotMatch(links, /for \(const record of records\) \{\s*decorateNode\(record\.target\)/u)
})

test('runtime-relative and download anchors stay on the runtime link path', async () => {
  const links = (await source('renderer/workspace-links-integration.js')).replace(/\r\n/gu, '\n')
  const start = links.indexOf('const keepsRuntimeNavigation = anchor => {')
  const end = links.indexOf('\n\n    const route =', start)
  assert.notEqual(start, -1, 'runtime navigation classifier is required')
  assert.notEqual(end, -1, 'anchor classifier boundary is required')
  const classifiers = new Function('localPath', `${links.slice(start, end)}; return { keepsRuntimeNavigation, anchorPath }`)(value => `local:${value}`)
  const { keepsRuntimeNavigation, anchorPath } = classifiers
  const anchor = (href, download = false) => ({
    getAttribute: name => name === 'href' ? href : null,
    hasAttribute: name => name === 'download' && download
  })

  const download = anchor('/api/desktop-files/download?sessionId=session-1&path=human_attested')
  assert.equal(keepsRuntimeNavigation(download), true)
  assert.equal(keepsRuntimeNavigation(anchor('/settings?tab=files')), true)
  assert.equal(keepsRuntimeNavigation(anchor('#details')), true)
  assert.equal(keepsRuntimeNavigation(anchor('docs/report.md', true)), true)
  assert.equal(keepsRuntimeNavigation(anchor('//cdn.example.com/file.txt')), false)
  assert.equal(keepsRuntimeNavigation(anchor('docs/report.md')), false)
  assert.equal(anchorPath(download), '')
  assert.equal(anchorPath(anchor('/settings?tab=files')), '')
  assert.equal(anchorPath(anchor('//cdn.example.com/file.txt')), '')
  assert.equal(anchorPath(anchor('#details')), '')
  assert.equal(anchorPath(anchor('docs/report.md', true)), '')
  assert.equal(anchorPath(anchor('docs/report.md')), 'local:docs/report.md')
  assert.equal(anchorPath(anchor('file:///tmp/report.md')), 'local:file:///tmp/report.md')

  const clickStart = links.indexOf("document.addEventListener('click'")
  const nativeGuard = links.indexOf('if (keepsRuntimeNavigation(anchor)) return', clickStart)
  const externalRoute = links.indexOf("route('open-external'", clickStart)
  assert.ok(clickStart >= 0 && nativeGuard > clickStart && externalRoute > nativeGuard, 'runtime links must bypass the external browser route')
})

test('plain chat HTTP links take the explicit system-browser route', async () => {
  const [links, renderer, preload, main] = await Promise.all([
    source('renderer/workspace-links-integration.js'),
    source('renderer/app.js'),
    source('electron/preload.cjs'),
    source('electron/main.cjs')
  ])

  assert.match(links, /event\.button !== 0 \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey \|\| event\.metaKey/u)
  assert.match(links, /if \(\/\^https\?:\/i\.test\(href\)\)[\s\S]{0,220}route\('open-external', \{ url: href \}\)/u)
  assert.match(renderer, /target\.hostname === 'open-external'[\s\S]{0,360}api\.openLink\(url, \{ userChoice: 'system' \}\)/u)
  assert.match(preload, /openLink: \(url, context\) => ipcRenderer\.invoke\('shell:openLink', url, context \|\| \{\}\)/u)
  assert.match(main, /shell:openLink[\s\S]{0,360}userChoice: String\(context\.userChoice \|\| 'default'\)/u)
  assert.match(main, /decision\.decision === BROWSER_LINK_DECISIONS\.SYSTEM[\s\S]{0,180}shell\.openExternal\(decision\.target\)/u)
})

test('chat links never turn non-web schemes into system-browser requests', async () => {
  const [links, main] = await Promise.all([
    source('renderer/workspace-links-integration.js'),
    source('electron/main.cjs')
  ])

  assert.match(links, /if \(\/\^https\?:\/i\.test\(href\)\)/u)
  assert.match(main, /if \(decision\.decision === BROWSER_LINK_DECISIONS\.REJECT\) throw new Error/u)
  assert.match(main, /function externalWebUrl[\s\S]{0,220}\['http:', 'https:'\]\.includes\(target\.protocol\)/u)
})

test('workspace-link menu preserves source session for preview, safe-copy opening, reveal and copy', async () => {
  const main = await source('electron/main.cjs')
  const start = main.indexOf('async function showGuestContextMenu(')
  const end = main.indexOf('async function chooseWorkspaceDirectory(', start)
  assert.ok(start >= 0 && end > start)
  const local = Object.freeze({ target: 'reports/100%25 报告.md', sessionId: 'source-session', sourceKind: 'workspace-link' })
  let template
  const calls = []
  const menu = new Function('deps', `const { contextMenuRequests, guestLocalTargetAtPoint, resolveGuestLocalTarget, externalWebUrl, send, openRightWorkspaceTarget, clipboard, Menu } = deps; ${main.slice(start, end)}; return showGuestContextMenu`)(
    { contextMenuRequests: new WeakMap(), guestLocalTargetAtPoint: async () => local, resolveGuestLocalTarget: value => value,
      externalWebUrl: () => '', send: (event, value) => calls.push(['preview', event, value]), openRightWorkspaceTarget: async (value, reveal) => calls.push(['open', value, reveal]),
      clipboard: { writeText: value => calls.push(['copy', value]) }, Menu: { buildFromTemplate(items) { template = items; return { popup() {} } } } }
  )
  await menu({ isDestroyed: () => false }, {}, { ownerWindow: { isDestroyed: () => false } })
  for (const label of ['在右侧工作区预览', '使用系统应用打开', '在文件夹中显示安全副本', '复制文件引用']) template.find(item => item.label === label).click()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.find(x => x[0] === 'preview'), ['preview', 'rightWorkspace:previewLocal', local])
  assert.deepEqual(calls.filter(x => x[0] === 'open'), [['open', local, undefined], ['open', local, true]])
  assert.deepEqual(calls.find(x => x[0] === 'copy'), ['copy', local.target])
  assert.equal(template.some(x => x.label === '打开此项目'), false, 'guest file links must not become project/workspace switches')
})

test('guest targets require explicit source session and preserve literal paths for runtime containment checks', async () => {
  const main = await source('electron/main.cjs')
  const body = extractFunction(main, 'rightWorkspaceFileSource', 'browserIntentForLink')
  const resolve = new Function('path', `${body}; return resolveGuestLocalTarget`)(path)
  for (const bare of ['docs/README.md:12', path.resolve(path.sep, 'explicit', 'README.md'), '../outside.txt', 'https://example.com/project']) assert.equal(resolve(bare), null, 'bare guest path cannot fall back to the active workspace')
  assert.equal(resolve({ sourceKind: 'workspace-link', target: 'a.txt' }), null)
  assert.equal(resolve({ sourceKind: 'local', sessionId: 's', target: 'a.txt' }), null)
  assert.equal(resolve({ sourceKind: 'workspace-link', sessionId: ' s ', target: 'a.txt' }), null)
  assert.equal(resolve({ sourceKind: 'workspace-link', sessionId: 's', target: 'bad\npath' }), null)
  assert.equal(resolve({ sourceKind: 'workspace-link', sessionId: 's', target: 'a', path: 'b' }), null)
  for (const target of ['docs/100%25 报告.md', 'docs/README.md:12', path.resolve(path.sep, 'explicit', 'README.md')]) {
    const result = resolve({ sourceKind: 'workspace-link', sessionId: 'source-session', target })
    assert.equal(result.target, target, 'no URI decoding, path normalization, or active-workspace substitution')
    assert.equal(result.sessionId, 'source-session')
    assert.equal(result.sourceKind, 'workspace-link')
    assert.equal(Object.isFrozen(result), true)
  }
  // This source boundary deliberately leaves existence/symlink/containment to the
  // runtime materializer; it does not claim an arbitrary path is safe to open.
})
