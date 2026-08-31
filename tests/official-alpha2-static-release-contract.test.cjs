const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = readFileSync(path.join(root, 'scripts', 'verify-static.mjs'), 'utf8')

function balancedEnd(text, start) {
  const open = text.indexOf('{', start)
  assert.notEqual(open, -1, 'contract function body is missing')
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    if (text[index] === '}' && --depth === 0) return index + 1
  }
  assert.fail('contract function body is unterminated')
}

function loadContract() {
  const constantsStart = source.indexOf("const OFFICIAL_ALPHA2_VERSION = '0.1.2-alpha.2'")
  const functionStart = source.indexOf('export function assertOfficialAlpha2ReleaseContract(pkg)')
  assert.notEqual(constantsStart, -1, 'alpha.2 version contract is missing')
  assert.notEqual(functionStart, -1, 'alpha.2 release contract export is missing')
  const functionEnd = balancedEnd(source, functionStart)
  const productionCalls = source.slice(functionEnd).match(/\bassertOfficialAlpha2ReleaseContract\(pkg\)/g) || []
  assert.equal(productionCalls.length, 1, 'static gate must invoke the alpha.2 release contract exactly once')
  const contract = source.slice(constantsStart, functionEnd).replace('export function', 'function')
  return Function(`${contract}; return { assertOfficialAlpha2ReleaseContract }`)()
}

const alpha2Roots = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-anonymous-user-id', '@deepseek-ai/dsh-atomic-write', '@deepseek-ai/dsh-bash-local',
  '@deepseek-ai/dsh-code-runtime', '@deepseek-ai/dsh-compaction', '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-fs', '@deepseek-ai/dsh-invariants', '@deepseek-ai/dsh-output-retention',
  '@deepseek-ai/dsh-sandbox', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-session-telemetry',
  '@deepseek-ai/dsh-session-title-llm', '@deepseek-ai/dsh-shell', '@deepseek-ai/dsh-spill',
  '@deepseek-ai/dsh-subagent-in-process-driver', '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-timeout', '@deepseek-ai/dsh-workflow'
]

function manifest() {
  return {
    dependencies: {
      ...Object.fromEntries(alpha2Roots.map(name => [name, '0.1.2-alpha.2'])),
      '@deepseek-ai/cordis-plugin-group': '1.0.1',
      '@earendil-works/pi-ai': '0.82.1',
      yaml: '2.9.0',
      'dsh-plugin-marketplace': 'https://codeload.github.com/bradeGithub/DSH-Plugins-Marketplace/tar.gz/dfe32cb8620658b55441787725f7f03e0491d15e'
    }
  }
}

test('official alpha.2 static release contract accepts only the complete exact 20-root manifest', () => {
  const { assertOfficialAlpha2ReleaseContract } = loadContract()
  assert.equal(alpha2Roots.length, 20)
  assert.doesNotThrow(() => assertOfficialAlpha2ReleaseContract(manifest()))
})

test('official alpha.2 static release contract fails closed for root regressions and graph drift', () => {
  const { assertOfficialAlpha2ReleaseContract } = loadContract()
  const cases = [
    ['missing dependencies', candidate => { delete candidate.dependencies }, /dependencies must be an object/],
    ['root fallback', candidate => { candidate.dependencies['@deepseek-ai/dsh'] = '0.1.1-rc.2' }, /pinned exactly/],
    ['root omission', candidate => { delete candidate.dependencies['@deepseek-ai/dsh-compaction-basic'] }, /pinned exactly/],
    ['floating range', candidate => { candidate.dependencies['@deepseek-ai/dsh-workflow'] = '^0.1.2-alpha.2' }, /pinned exactly/],
    ['extra DSH root', candidate => { candidate.dependencies['@deepseek-ai/dsh-unreviewed'] = '0.1.2-alpha.2' }, /Unexpected direct DSH root/],
    ['removed client runtime re-entry', candidate => { candidate.dependencies['@deepseek-ai/dsh-client-runtime'] = '0.1.2-alpha.2' }, /Removed DSH root/],
    ['removed host apiproxy re-entry', candidate => { candidate.dependencies['@deepseek-ai/dsh-host-apiproxy'] = '0.1.2-alpha.2' }, /Removed DSH root/]
  ]
  for (const [name, mutate, expected] of cases) {
    const candidate = manifest()
    mutate(candidate)
    assert.throws(() => assertOfficialAlpha2ReleaseContract(candidate), expected, name)
  }
})
