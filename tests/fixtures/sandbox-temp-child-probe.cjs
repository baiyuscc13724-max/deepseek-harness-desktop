const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const script = path.join(os.tmpdir(), `dsh-temp-child-${process.pid}.cmd`)
try {
  fs.writeFileSync(script, '@echo child-ok\r\n')
  const result = childProcess.spawnSync('cmd', ['/d', '/c', 'call', script], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  try { fs.rmSync(script, { force: true }) } catch {}
}
