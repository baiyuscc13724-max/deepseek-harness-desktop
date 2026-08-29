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

test('local-path context menu opens only normalized targets and exposes the project action', async () => {
  const main = await source('electron/main.cjs')
  assert.match(main, /const local = localValue \? resolveGuestLocalTarget\(localValue\) : null/u)
  assert.match(main, /label: '打开此项目', click: \(\) => openDesktopLocalTarget\(local\.path\)/u)
  assert.match(main, /label: '在文件夹中显示', click: \(\) => openDesktopLocalTarget\(local\.path, true\)/u)
  assert.match(main, /label: '复制本机路径', click: \(\) => clipboard\.writeText\(local\.path\)/u)
  assert.doesNotMatch(main, /openDesktopLocalTarget\(localValue/u)
})

test('relative project targets are workspace-confined while explicit absolute paths keep host validation', async () => {
  const main = await source('electron/main.cjs')
  const body = extractFunction(main, 'resolveGuestLocalTarget', 'browserIntentForLink')
  const workspace = path.resolve(path.sep, 'managed-workspace')
  const absolute = path.resolve(path.sep, 'explicit', 'README.md')
  const normalizeLocalTarget = value => {
    if (value === absolute) return { path: absolute, line: null, column: null }
    throw new Error('relative')
  }
  const resolveGuestLocalTarget = new Function(
    'normalizeLocalTarget', 'path', 'desktopRuntimePaths',
    `${body}; return resolveGuestLocalTarget`
  )(normalizeLocalTarget, path, () => ({ workspace }))

  assert.deepEqual(resolveGuestLocalTarget(absolute), { path: absolute, line: null, column: null })
  assert.deepEqual(resolveGuestLocalTarget('docs/README.md:12'), {
    path: path.join(workspace, 'docs', 'README.md'), line: null, column: null
  })
  assert.equal(resolveGuestLocalTarget('../outside.txt'), null)
  assert.equal(resolveGuestLocalTarget('%2e%2e/outside.txt'), null)
  assert.equal(resolveGuestLocalTarget('https://example.com/project'), null)
  assert.equal(resolveGuestLocalTarget('https%3A%2F%2Fexample.com/project'), null)
  assert.equal(resolveGuestLocalTarget('javascript:alert(1)'), null)
  assert.equal(resolveGuestLocalTarget('docs/report.txt:stream'), null)
  assert.equal(resolveGuestLocalTarget('bad\npath'), null)
})
