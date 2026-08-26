const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')

test('desktop shell ships a bottom xterm panel with explicit lifecycle controls', async () => {
  const [html, app, styles] = await Promise.all([
    source('renderer/index.html'),
    source('renderer/app.js'),
    source('renderer/styles.css')
  ])
  for (const id of [
    'terminalPanel', 'terminalResizeHandle', 'terminalHost', 'terminalEmpty',
    'terminalShellBadge', 'terminalWorkspace', 'terminalStatus', 'terminalStart', 'terminalInterrupt',
    'terminalStop', 'terminalClear', 'terminalClose'
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing integrated-terminal element ${id}`)
  assert.match(html, /@xterm\/xterm\/css\/xterm\.css/u)
  assert.match(html, /@xterm\/xterm\/lib\/xterm\.js/u)
  assert.match(html, /@xterm\/addon-fit\/lib\/addon-fit\.js/u)
  assert.match(styles, /body\.terminal-panel-open #runtimeView/u)
  assert.match(styles, /--terminal-panel-height/u)
  assert.match(styles, /\.terminal-resize-handle/u)
  assert.doesNotMatch(html, /terminalQuickButton/u, 'terminal selection must not add a permanent main-interface button')
  assert.match(app, /new TerminalCtor\(/u)
  assert.match(app, /new FitAddonCtor\(\)/u)
  assert.match(app, /api\.startTerminal\(/u)
  assert.match(app, /api\.writeTerminal\(terminalSession\.id, data\)/u)
  assert.match(app, /api\.resizeTerminal\(terminalSession\.id, cols, rows\)/u)
  assert.match(app, /api\.stopTerminal\(/u)
  assert.match(app, /api\.onTerminalEvent\(event => applyTerminalEvent\(event\)\)/u)
  assert.match(app, /event\.ctrlKey[^\n]+event\.key === '`'/u)
})

test('General settings expose only available integrated-terminal shells and persist through the desktop intent bridge', async () => {
  const [app, main, preload] = await Promise.all([
    source('renderer/app.js'),
    source('electron/main.cjs'),
    source('electron/preload.cjs')
  ])
  assert.match(app, /id = 'harness-desktop-terminal-row'/u)
  assert.match(app, /集成终端 Shell/u)
  assert.match(app, /shell\.available \? '' : '（不可用）'/u)
  assert.match(app, /request\('terminal-shell', \{ shellId: event\.currentTarget\.value \}\)/u)
  assert.match(app, /target\.hostname === 'terminal-shell'/u)
  assert.match(app, /api\.setTerminalPreferences\(\{ shellId \}\)/u)
  assert.match(app, /__HARNESS_DESKTOP_TERMINAL_STATE__/u)
  assert.match(app, /__HARNESS_DESKTOP_RENDER_TERMINAL__/u)
  assert.match(main, /workspace: desktopRuntimePaths\(\)\.workspace/u)
  assert.match(main, /request\.cwd = desktopRuntimePaths\(\)\.workspace/u)
  assert.match(main, /bindIntegratedTerminalShortcut\(guest\)/u)
  assert.match(main, /input\.code !== 'Backquote'/u)
  assert.match(preload, /onTerminalToggle: listener => subscribe\('terminal:toggle', listener\)/u)
  assert.match(app, /api\.onTerminalToggle\(\(\) => toggleIntegratedTerminal\(\)\)/u)
})

test('xterm dependencies are exact and documented', async () => {
  const [pkgText, notices] = await Promise.all([
    source('package.json'),
    source('THIRD_PARTY_NOTICES.md')
  ])
  const pkg = JSON.parse(pkgText)
  assert.equal(pkg.dependencies['@xterm/xterm'], '6.0.0')
  assert.equal(pkg.dependencies['@xterm/addon-fit'], '0.11.0')
  assert.match(notices, /## Integrated terminal dependencies/u)
  assert.match(notices, /@xterm\/xterm/u)
  assert.match(notices, /@xterm\/addon-fit/u)
})
