const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(process.env.DSH_ALPHA4_CANDIDATE_ROOT || process.env.DSH_ALPHA3_CANDIDATE_ROOT || process.env.DSH_ALPHA2_CANDIDATE_ROOT || path.resolve(__dirname, '..'))
const source = readFileSync(path.join(root, 'scripts', 'verify-static.mjs'), 'utf8')
const TARGET = '0.1.2-alpha.4'

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
  const constantsStart = source.indexOf("const OFFICIAL_ALPHA4_VERSION = '0.1.2-alpha.4'")
  const functionStart = source.indexOf('export function assertOfficialAlpha4ReleaseContract(pkg)')
  assert.notEqual(constantsStart, -1, 'alpha.4 version contract is missing')
  assert.notEqual(functionStart, -1, 'alpha.4 release contract export is missing')
  const functionEnd = balancedEnd(source, functionStart)
  const productionCalls = source.slice(functionEnd).match(/\bassertOfficialAlpha4ReleaseContract\(pkg\)/g) || []
  assert.equal(productionCalls.length, 1, 'static gate must invoke the alpha.4 release contract exactly once')
  const contract = source.slice(constantsStart, functionEnd).replace('export function', 'function')
  return Function(`${contract}; return { assertOfficialAlpha4ReleaseContract }`)()
}

const alpha4Roots = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-anonymous-user-id', '@deepseek-ai/dsh-atomic-write', '@deepseek-ai/dsh-bash-local',
  '@deepseek-ai/dsh-code-runtime', '@deepseek-ai/dsh-compaction', '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-fs', '@deepseek-ai/dsh-invariants', '@deepseek-ai/dsh-output-retention',
  '@deepseek-ai/dsh-sandbox', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-session-telemetry',
  '@deepseek-ai/dsh-session-title-llm', '@deepseek-ai/dsh-shell', '@deepseek-ai/dsh-spill',
  '@deepseek-ai/dsh-subagent-in-process-driver', '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-timeout', '@deepseek-ai/dsh-workflow'
]
const alpha4OptionalRoots = [
  '@deepseek-ai/dsh-attachment', '@deepseek-ai/dsh-jobs', '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-session-query', '@deepseek-ai/dsh-settings', '@deepseek-ai/dsh-util-time'
]

function manifest() {
  return {
    dependencies: {
      ...Object.fromEntries(alpha4Roots.map(name => [name, TARGET])),
      '@deepseek-ai/cordis-plugin-group': '1.0.1',
      '@earendil-works/pi-ai': '0.82.1',
      yaml: '2.9.0',
      'dsh-plugin-marketplace': 'https://codeload.github.com/bradeGithub/DSH-Plugins-Marketplace/tar.gz/dfe32cb8620658b55441787725f7f03e0491d15e'
    },
    optionalDependencies: Object.fromEntries(alpha4OptionalRoots.map(name => [name, TARGET]))
  }
}

test('official alpha.4 static release contract accepts only the complete exact root manifest', () => {
  const { assertOfficialAlpha4ReleaseContract } = loadContract()
  assert.equal(alpha4Roots.length, 20)
  assert.equal(alpha4OptionalRoots.length, 6)
  assert.doesNotThrow(() => assertOfficialAlpha4ReleaseContract(manifest()))
})

test('official alpha.4 static release contract fails closed for historical fallback and graph drift', () => {
  const { assertOfficialAlpha4ReleaseContract } = loadContract()
  const cases = [
    ['missing dependencies', candidate => { delete candidate.dependencies }, /dependencies and optionalDependencies must be objects/],
    ['missing optional dependencies', candidate => { delete candidate.optionalDependencies }, /dependencies and optionalDependencies must be objects/],
    ['rc.2 fallback', candidate => { candidate.dependencies['@deepseek-ai/dsh'] = '0.1.1-rc.2' }, /pinned exactly/],
    ['alpha.2 fallback', candidate => { candidate.dependencies['@deepseek-ai/dsh'] = '0.1.2-alpha.2' }, /pinned exactly/],
    ['alpha.3 fallback', candidate => { candidate.dependencies['@deepseek-ai/dsh'] = '0.1.2-alpha.3' }, /pinned exactly/],
    ['alpha.3 optional fallback', candidate => { candidate.optionalDependencies['@deepseek-ai/dsh-attachment'] = '0.1.2-alpha.3' }, /pinned exactly/],
    ['root omission', candidate => { delete candidate.dependencies['@deepseek-ai/dsh-compaction-basic'] }, /pinned exactly/],
    ['floating range', candidate => { candidate.dependencies['@deepseek-ai/dsh-workflow'] = `^${TARGET}` }, /pinned exactly/],
    ['extra DSH root', candidate => { candidate.dependencies['@deepseek-ai/dsh-unreviewed'] = TARGET }, /Unexpected direct DSH root/],
    ['retired client runtime re-entry', candidate => { candidate.dependencies['@deepseek-ai/dsh-client-runtime'] = TARGET }, /Removed DSH root/],
    ['retired host apiproxy re-entry', candidate => { candidate.dependencies['@deepseek-ai/dsh-host-apiproxy'] = TARGET }, /Removed DSH root/]
  ]
  for (const [name, mutate, expected] of cases) {
    const candidate = manifest()
    mutate(candidate)
    assert.throws(() => assertOfficialAlpha4ReleaseContract(candidate), expected, name)
  }
})
