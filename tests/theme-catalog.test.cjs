const test = require('node:test')
const assert = require('node:assert/strict')
const { THEME_CATALOG } = require('../renderer/theme-catalog.js')

test('theme catalog has unique safe ids and a reversible official theme', () => {
  const ids = THEME_CATALOG.map(theme => theme.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.match(ids.join(','), /official/)
  assert.ok(THEME_CATALOG.length >= 10)
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/)
})

test('third-party theme entries expose source and license metadata', () => {
  for (const id of ['maid-atelier', 'catppuccin-mocha', 'nord-aurora', 'dracula-night', 'gruvbox-paper', 'solarized-dawn', 'tokyo-night', 'rose-pine']) {
    const theme = THEME_CATALOG.find(entry => entry.id === id)
    assert.ok(theme, `missing ${id}`)
    assert.match(theme.source, /^https:\/\/github\.com\//)
    assert.ok(theme.license)
  }
  assert.equal(THEME_CATALOG.find(theme => theme.id === 'maid-atelier').nonCommercial, true)
})
