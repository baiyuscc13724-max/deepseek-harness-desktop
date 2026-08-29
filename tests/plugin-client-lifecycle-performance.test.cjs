const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

for (const [name, relativePath, label] of [
  ['Agent Teams', ['plugins', 'dsh-agent-teams', 'lib', 'client.js'], 'agent-teams: locale subscription'],
  ['session experience', ['plugins', 'dsh-session-experience', 'lib', 'client.js'], 'session-experience: locale subscription']
]) {
  test(`${name} locale subscriptions are disposed with the client plugin`, async () => {
    const source = await readFile(path.join(root, ...relativePath), 'utf8')
    assert.match(source, new RegExp(`ctx\\.effect\\(function \\(\\) \\{ return ctx\\.locale\\.subscribe[\\s\\S]*?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.doesNotMatch(source, /try \{ ctx\.locale\.subscribe/u)
  })
}
