const path = require('node:path')
const { spawn } = require('node:child_process')
const { appendFile, mkdir } = require('node:fs/promises')
const { ComponentUpdateStore } = require('../electron/bridge/component-update-store.cjs')
const { applyReadyComponentUpdate, desktopEnvironment } = require('../electron/bridge/component-update-helper.cjs')

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function decodeArgs(value) {
  if (!value) return []
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  if (!Array.isArray(parsed) || parsed.length > 16) throw new Error('重启参数无效。')
  return parsed.map(item => String(item).slice(0, 4096))
}

async function log(root, level, message) {
  const logRoot = path.join(root, 'logs')
  await mkdir(logRoot, { recursive: true })
  await appendFile(path.join(logRoot, 'helper.log'), `${new Date().toISOString()} ${level} ${String(message).replace(/[\r\n]+/g, ' ').slice(0, 2000)}\n`, 'utf8')
}

async function main() {
  const root = path.resolve(argument('--root'))
  const parentPid = Number(argument('--parent-pid'))
  const executable = path.resolve(argument('--restart-exe'))
  const cwd = path.resolve(argument('--restart-cwd', path.dirname(executable)))
  const args = decodeArgs(argument('--restart-args'))
  const restartEnv = desktopEnvironment(process.env)
  const store = new ComponentUpdateStore(root)

  try {
    await log(root, 'INFO', `waiting for parent ${parentPid}`)
    const result = await applyReadyComponentUpdate({ store, parentPid, restart: { executable, cwd, args } })
    await log(root, 'INFO', `activated ${result.state.active.releaseVersion}; restart pid=${result.restartPid}`)
  } catch (error) {
    await log(root, 'ERROR', error?.stack || error).catch(() => {})
    const state = await store.get().catch(() => null)
    if (state?.phase !== 'awaiting-health') await store.markFailed(error).catch(() => {})
    const recoveryArgs = state?.phase === 'awaiting-health'
      ? args
      : args.filter(value => value !== '--component-health-check')
    try {
      const child = spawn(executable, recoveryArgs, { cwd, detached: true, stdio: 'ignore', windowsHide: true, env: restartEnv })
      child.unref()
      await log(root, 'INFO', `recovery restart pid=${child.pid}`)
    } catch (restartError) {
      await log(root, 'ERROR', `recovery restart failed: ${restartError.message}`).catch(() => {})
    }
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
