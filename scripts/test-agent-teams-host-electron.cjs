const { spawnSync } = require('node:child_process')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const electronBinary = require('electron')
const fixture = path.join(repoRoot, 'tests', 'fixtures', 'agent-teams-host-capability-electron.cjs')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const result = spawnSync(electronBinary, [fixture], {
  cwd: repoRoot,
  env: environment,
  encoding: 'utf8',
  timeout: 60_000,
  windowsHide: true
})
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) throw result.error
process.exitCode = result.status === null ? 1 : result.status
