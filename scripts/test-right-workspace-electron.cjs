'use strict'

const { mkdtempSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const executable = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const fixture = path.join(root, 'tests', 'fixtures', 'right-workspace-layout-electron.cjs')
const profileRoot = mkdtempSync(path.join(os.tmpdir(), 'hd-right-workspace-electron-'))
const env = { ...process.env, HARNESS_RIGHT_WORKSPACE_E2E_PROFILE: profileRoot }
delete env.ELECTRON_RUN_AS_NODE

let status = 1
try {
  const result = spawnSync(executable, [fixture], { cwd: root, env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  status = Number.isInteger(result.status) ? result.status : 1
} finally {
  rmSync(profileRoot, { recursive: true, force: true })
}

process.exit(status)
