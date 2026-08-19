const path = require('node:path')
const { access } = require('node:fs/promises')
const { spawn } = require('node:child_process')

function physicalAsarPath(value) {
  const resolved = path.resolve(String(value || ''))
  const marker = `${path.sep}app.asar${path.sep}`
  return resolved.includes(marker) ? resolved.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`) : resolved
}

function helperEnvironment(source = process.env) {
  const allowed = ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATH', 'Path', 'PATHEXT', 'COMSPEC', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL']
  const env = {}
  for (const name of allowed) if (source[name] !== undefined) env[name] = source[name]
  env.ELECTRON_RUN_AS_NODE = '1'
  env.HARNESS_COMPONENT_UPDATE_HELPER = '1'
  return env
}

async function launchComponentUpdateHelper({
  store,
  execPath,
  helperScript,
  componentRoot,
  parentPid = process.pid,
  restartExecutable = execPath,
  restartCwd = '',
  restartArgs = [],
  spawnImpl = spawn,
  accessImpl = access,
  env = process.env
}) {
  const state = await store.get()
  if (state.phase !== 'ready' || !state.pending) throw new Error('组件更新尚未准备完成。')
  const executable = path.resolve(String(execPath || ''))
  const script = physicalAsarPath(helperScript)
  const root = path.resolve(String(componentRoot || ''))
  await accessImpl(executable)
  await accessImpl(script)
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) throw new Error('主程序 PID 无效。')
  if (!Array.isArray(restartArgs) || restartArgs.length > 16) throw new Error('桌面程序重启参数无效。')
  const encodedArgs = Buffer.from(JSON.stringify(restartArgs.map(value => String(value))), 'utf8').toString('base64url')
  const args = [
    script,
    '--root', root,
    '--parent-pid', String(parentPid),
    '--restart-exe', path.resolve(String(restartExecutable || '')),
    '--restart-cwd', path.resolve(String(restartCwd || path.dirname(restartExecutable || executable))),
    '--restart-args', encodedArgs
  ]
  const child = spawnImpl(executable, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: helperEnvironment(env)
  })
  child.unref?.()
  if (!child.pid) throw new Error('无法启动组件更新助手。')
  return { pid: child.pid, releaseVersion: state.pending.releaseVersion }
}

module.exports = { helperEnvironment, launchComponentUpdateHelper, physicalAsarPath }
