const path = require('node:path')
const { mkdirSync } = require('node:fs')

function resolveUserDataOverride(argv = [], commandLineValue = '') {
  let value = String(commandLineValue || '').trim()
  if (!value) {
    for (let index = 0; index < argv.length; index += 1) {
      const current = String(argv[index] || '')
      const inline = current.match(/^--(?:harness-)?user-data-dir=(.+)$/i)
      if (inline) { value = inline[1].trim(); break }
      if (/^--(?:harness-)?user-data-dir$/i.test(current)) { value = String(argv[index + 1] || '').trim(); break }
    }
  }
  return value ? path.resolve(value) : ''
}

function applyUserDataOverride(app, { argv = process.argv, mkdirImpl = mkdirSync } = {}) {
  const commandLineValue = app?.commandLine?.getSwitchValue?.('user-data-dir') || ''
  const resolved = resolveUserDataOverride(argv, commandLineValue)
  if (!resolved) return ''
  mkdirImpl(resolved, { recursive: true })
  app.setPath('userData', resolved)
  return resolved
}

module.exports = { applyUserDataOverride, resolveUserDataOverride }
