const path = require('node:path')

const INSTALL_DATA_DIRECTORY = 'HarnessData'

function hasUserDataOverride(argv = []) {
  return argv.some((value, index) => {
    const current = String(value || '')
    if (/^--user-data-dir=.+/i.test(current)) return true
    return /^--user-data-dir$/i.test(current) && String(argv[index + 1] || '').trim() !== ''
  })
}

function resolveDesktopRuntimePaths({
  env = {},
  argv = [],
  appPath,
  executablePath,
  isPackaged = false,
  platform = process.platform,
  store = false,
  userData,
  userDataOverride = false
}) {
  const isolatedLaunch = userDataOverride || hasUserDataOverride(argv)
  const portableDirectory = String(env.PORTABLE_EXECUTABLE_DIR || '').trim()
  const canUseInstallDirectory = platform === 'win32' && isPackaged && !store && !isolatedLaunch
  const applicationDirectory = canUseInstallDirectory
    ? path.resolve(portableDirectory || path.dirname(executablePath))
    : path.resolve(userData || appPath)
  const root = path.join(applicationDirectory, INSTALL_DATA_DIRECTORY)

  return Object.freeze({
    root,
    dshHome: path.join(root, 'dsh-home'),
    workspace: path.join(root, 'workspace'),
    temp: path.join(root, 'temp')
  })
}

function resolveDesktopDshHome(options) {
  return resolveDesktopRuntimePaths(options).dshHome
}

function desktopRuntimeEnvironment(env, runtimePaths) {
  return {
    ...env,
    DSH_HOME: runtimePaths.dshHome,
    TEMP: runtimePaths.temp,
    TMP: runtimePaths.temp,
    TMPDIR: runtimePaths.temp
  }
}

module.exports = { INSTALL_DATA_DIRECTORY, desktopRuntimeEnvironment, hasUserDataOverride, resolveDesktopDshHome, resolveDesktopRuntimePaths }
