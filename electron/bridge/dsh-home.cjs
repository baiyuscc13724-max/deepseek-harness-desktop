const path = require('node:path')

function hasUserDataOverride(argv = []) {
  return argv.some((value, index) => {
    const current = String(value || '')
    if (/^--user-data-dir=.+/i.test(current)) return true
    return /^--user-data-dir$/i.test(current) && String(argv[index + 1] || '').trim() !== ''
  })
}

function resolveDesktopDshHome({ env = {}, argv = [], home, userData }) {
  const explicit = String(env.DSH_HOME || '').trim()
  if (explicit) return path.resolve(explicit)
  if (hasUserDataOverride(argv)) return path.resolve(userData, 'dsh-home')
  return path.resolve(home, '.dsh')
}

module.exports = { hasUserDataOverride, resolveDesktopDshHome }
