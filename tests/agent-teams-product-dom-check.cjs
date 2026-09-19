// Standalone opt-in real DOM check; no auto-install, live GUI, or HTTP server.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const repo = path.resolve(__dirname, '..')
const executable = process.platform === 'win32' ? path.join(repo,'node_modules/electron/dist/electron.exe') : process.platform === 'darwin' ? path.join(repo,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : path.join(repo,'node_modules/electron/dist/electron')
if (!fs.existsSync(executable)) throw new Error('Cached development Electron is required; this check never downloads it automatically.')
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'team-product-dom-check-'))
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE
try {
  const result = spawnSync(executable,[path.join(__dirname,'fixtures/agent-teams-product-dom.cjs'),temp],{cwd:repo,env,stdio:'inherit',timeout:60000})
  if (result.error) throw result.error
  if (result.signal || result.status !== 0) throw new Error(`DOM check failed: exit=${result.status}, signal=${result.signal || 'none'}`)
} finally { fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100}) }
