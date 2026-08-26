const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')

async function source(relative) {
  return readFile(path.join(root, relative), 'utf8')
}

const APPS = ['browser', 'computer-use', 'default-templates', 'deep-research', 'plugin-management', 'documents', 'pdf', 'spreadsheets', 'presentations', 'template-creator', 'sites', 'visualize']
const SKILLS = ['default-templates', 'deep-research', 'template-creator']
const ALL_CANDIDATES = [...APPS, ...SKILLS]

test('browser-tools client registers an @ apps source covering the Codex application roster', async () => {
  const client = await source('plugins/dsh-desktop-browser-tools/lib/client.js')
  assert.match(client, /window\.__ModuleLoader__\.load\(/)
  assert.match(client, /inputTriggers\.registerSource/)
  assert.match(client, /trigger: ['"]@['"]/)
  for (const app of APPS) {
    assert.match(client, new RegExp(`name: ['"]${app}['"]`), `@ app candidate missing ${app}`)
  }
  // @ onPick 保留 "@name "（不丢触发符、不带自动发送）
  assert.match(client, /onPick\(\{ candidate \}\) \{[\s\S]{0,120}text: `@\$\{candidate\.name\} `/u, '@ onPick must keep "@name "')
  assert.match(client, /lexicon\(\) \{/)
})

test('browser-tools client registers a $ skills source merging static and installed skills', async () => {
  const client = await source('plugins/dsh-desktop-browser-tools/lib/client.js')
  assert.match(client, /trigger: ['"]\$['"]/)
  for (const skill of SKILLS) {
    assert.match(client, new RegExp(`name: ['"]${skill}['"]`), `$ skill candidate missing ${skill}`)
  }
  // 动态并入已安装 skills（imagegen/openai-docs/visualize 等走 connection.api.skills）
  assert.match(client, /ctx\.get\(['"]connection['"]\)\.api\.skills/)
  assert.match(client, /skillsApi\.list\(/)
  assert.match(client, /startsWith\(query\)/)
  assert.match(client, /lexicon\(session\) \{/)
  assert.match(client, /subscribeLexicon\(session, listener\)/)
  // $ onPick 保留 "$name "
  assert.match(client, /onPick\(\{ candidate \}\) \{[\s\S]{0,120}text: `\$\$\{candidate\.name\} `/u, '$ onPick must keep "$name "')
})

test('browser-tools client covers every assigned candidate and never auto-sends', async () => {
  const client = await source('plugins/dsh-desktop-browser-tools/lib/client.js')
  for (const name of ALL_CANDIDATES) {
    assert.ok(client.includes(`name: '${name}'`) || client.includes(`name: "${name}"`), `candidate ${name} missing`)
  }
  assert.doesNotMatch(client, /autoSend|sendMessage|connection\.send|api\.send\(/)
  // 候选过滤与随输入更新保持官方 ui-skill 语义：startsWith + lexicon 聚合 + 会话缓存失效
  assert.match(client, /agent-preset\/selected/)
  assert.match(client, /connection\/reset/)
  assert.doesNotMatch(client, /require\(['"]@deepseek-ai\//u, 'client must not vendor official package internals')
})

test('browser-tools package declares the web client module and its client face', async () => {
  const pkg = JSON.parse(await source('plugins/dsh-desktop-browser-tools/package.json'))
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  for (const dep of ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-input-trigger']) {
    assert.ok(pkg.dsh.client.inject.includes(dep), `dsh.client inject missing ${dep}`)
  }
  const client = await source('plugins/dsh-desktop-browser-tools/lib/client.js')
  assert.match(client, /module\.exports = \{ apply, inject: \[['"]inputTriggers['"], ['"]connection['"], ['"]remote['"]\] \}/u)
})