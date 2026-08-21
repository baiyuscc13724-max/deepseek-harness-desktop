const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const mainFile = path.resolve(__dirname, '..', 'electron', 'main.cjs')

function handlerWindows(source) {
  const lines = source.split(/\r?\n/u)
  const registrations = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/ipcMain\.handle\('([^']+)'/u)
    if (!match) continue
    registrations.push({ channel: match[1], source: lines.slice(index, index + 8).join('\n') })
  }
  return registrations
}

test('every privileged ipcMain handle has an explicit sender policy', async () => {
  const source = await readFile(mainFile, 'utf8')
  const allowedSpecialCases = new Set([
    // The pet has a separate sandboxed preload and intentionally shares only pet:*.
    'pet:getState', 'pet:setPreferences', 'pet:feed', 'pet:interact', 'pet:focusMain', 'pet:getEnvironment', 'pet:moveTo',
    // This one capability belongs to the official localhost Harness workspace, not the desktop shell renderer.
    'workspace:chooseDirectory'
  ])
  const missing = handlerWindows(source)
    .filter(({ channel, source: window }) => !allowedSpecialCases.has(channel)
      && !window.includes('desktopShellOnly(')
      && !window.includes('assertDesktopShellSender(event)'))
    .map(({ channel }) => channel)
  assert.deepEqual(missing, [])
})

test('desktop shell wrapper rejects before invoking a privileged handler', async () => {
  const source = await readFile(mainFile, 'utf8')
  assert.match(source, /function desktopShellOnly\(handler\) \{\s*return \(event, \.\.\.args\) => \{\s*assertDesktopShellSender\(event\)\s*return handler\(\.\.\.args\)/u)
  assert.match(source, /ipcMain\.handle\('updates:install', desktopShellOnly\(/u)
  assert.match(source, /ipcMain\.handle\('mobileControl:send', desktopShellOnly\(/u)
  assert.match(source, /ipcMain\.handle\('runtime:start', desktopShellOnly\(/u)
  assert.match(source, /ipcMain\.handle\('shell:openLocal', desktopShellOnly\(/u)
})
