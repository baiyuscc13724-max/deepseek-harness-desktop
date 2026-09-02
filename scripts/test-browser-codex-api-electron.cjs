const { spawnSync } = require('node:child_process')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const electronBinary = require('electron')
const fixture = path.join(repoRoot, 'tests', 'fixtures', 'browser-codex-api-electron.cjs')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE

const result = spawnSync(electronBinary, [fixture], {
  cwd: repoRoot,
  env: environment,
  stdio: 'inherit',
  timeout: 30_000,
  windowsHide: true
})

if (result.error) throw result.error
if (result.signal) throw new Error(`Electron browser Playwright fixture terminated by ${result.signal}`)
process.exitCode = result.status ?? 1
