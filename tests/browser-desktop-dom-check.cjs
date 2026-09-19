// Opt-in isolated Electron check. Never auto-download or use installed profiles.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const executable = process.platform === 'win32' ? path.join(root, 'node_modules/electron/dist/electron.exe') : process.platform === 'darwin' ? path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : path.join(root, 'node_modules/electron/dist/electron')
if (!fs.existsSync(executable)) throw new Error('Cached Electron required; automatic download is forbidden by this fixture.')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-desktop-dom-'))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
try {
  const child = spawnSync(executable, [path.join(__dirname, 'fixtures/browser-desktop-product-electron.cjs'), temp, ...(process.argv.includes('--media-compositor') ? ['--media-compositor'] : [])], { cwd: root, env, stdio: 'inherit', timeout: 90000 })
  if (child.error) throw child.error
  if (child.signal || child.status !== 0) throw new Error(`Browser DOM fixture failed: status=${child.status}, signal=${child.signal || 'none'}`)
} finally { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
