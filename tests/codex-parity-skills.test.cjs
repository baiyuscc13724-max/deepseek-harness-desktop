const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { readFile, readdir } = require('node:fs/promises')
const YAML = require('yaml')

const root = path.resolve(__dirname, '..', 'plugins', 'dsh-desktop-browser-tools', 'skills')
const EXPECTED = [
  'deep-research', 'default-templates', 'documents', 'imagegen', 'openai-docs', 'pdf',
  'plugin-management', 'presentations', 'sites', 'spreadsheets', 'template-creator', 'visualize'
]
const CLEAN_ROOM = EXPECTED.filter(name => name !== 'imagegen' && name !== 'openai-docs')

async function skillSource(name) {
  return readFile(path.join(root, name, 'SKILL.md'), 'utf8')
}

function metadata(source, name) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)
  assert.ok(match, `${name} must have YAML frontmatter`)
  return YAML.parse(match[1])
}

test('Codex parity bundle exposes the complete exact skill roster with valid metadata', async () => {
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))
  assert.deepEqual(directories, EXPECTED)
  for (const name of directories) {
    const source = await skillSource(name)
    const frontmatter = metadata(source, name)
    assert.equal(frontmatter.name, name)
    assert.equal(typeof frontmatter.description, 'string')
    assert.ok(frontmatter.description.trim().length >= 20)
    assert.match(source, /(?:验证|Verification|verify)/iu, `${name} needs a verification workflow`)
    assert.match(source, /(?:边界|Boundaries|失败|unavailable)/iu, `${name} needs explicit failure boundaries`)
  }
})

test('Apache OpenAI skills retain licenses, source pin, and prominent modification notices', async () => {
  for (const name of ['imagegen', 'openai-docs']) {
    const [source, license] = await Promise.all([
      skillSource(name),
      readFile(path.join(root, name, 'LICENSE.txt'), 'utf8')
    ])
    assert.match(license, /Apache License[\s\S]*Version 2\.0/u)
    assert.match(source, /Modified by Harness Desktop Contributors/u)
  }
  const sources = await readFile(path.join(root, 'OPENAI_SKILLS_SOURCES.md'), 'utf8')
  assert.match(sources, /49f948faa9258a0c61caceaf225e179651397431/u)
  assert.match(sources, /skills\/\.system\/imagegen/u)
  assert.match(sources, /skills\/\.system\/openai-docs/u)
})

test('clean-room compatibility skills do not depend on proprietary OpenAI payloads or connectors', async () => {
  for (const name of CLEAN_ROOM) {
    const source = await skillSource(name)
    assert.doesNotMatch(source, /@oai\/artifact-tool|connector_openai_|mcp__codex_apps__|mcp__openaiDeveloperDocs__/u, `${name} references a proprietary connector`)
  }
  assert.match(await skillSource('deep-research'), /web_search/u)
  assert.match(await skillSource('plugin-management'), /DSH_HOME\/skills/u)
  assert.match(await skillSource('documents'), /python-docx/u)
  assert.match(await skillSource('pdf'), /reportlab/u)
  assert.match(await skillSource('spreadsheets'), /openpyxl/u)
  assert.match(await skillSource('presentations'), /python-pptx/u)
  assert.match(await skillSource('sites'), /browser_control/u)
  assert.match(await skillSource('visualize'), /SVG|Canvas/u)
})

test('default templates are editable local assets without external runtime dependencies', async () => {
  const templateRoot = path.join(root, 'default-templates', 'templates')
  const names = (await readdir(templateRoot)).sort((left, right) => left.localeCompare(right))
  assert.deepEqual(names, ['budget-quarter.csv', 'landing-page.html', 'meeting-notes.md', 'project-kickoff.html', 'report-outline.md', 'slide-deck.html'])
  for (const name of names.filter(value => value.endsWith('.html'))) {
    const source = await readFile(path.join(templateRoot, name), 'utf8')
    assert.match(source, /<!DOCTYPE html>/iu)
    assert.doesNotMatch(source, /https?:\/\//iu)
  }
})

test('imagegen and OpenAI docs skills use only native bounded Harness routes', async () => {
  const imagegen = await skillSource('imagegen')
  assert.match(imagegen, /native `image_gen` tool/u)
  assert.doesNotMatch(imagegen, /OPENAI_API_KEY|scripts\/image_gen\.py/u)
  const docs = await skillSource('openai-docs')
  assert.match(docs, /web_search/u)
  assert.match(docs, /browser_control/u)
  assert.match(docs, /developers\.openai\.com/u)
  assert.doesNotMatch(docs, /mcp__openaiDeveloperDocs__/u)
})
