const test = require('node:test')
const assert = require('node:assert/strict')
const {
  extractPrBodyDescription,
  previewChangeDetails,
  previewChangeNotes,
  previewChangeSummary,
  sanitizeUpdateDescription
} = require('../electron/bridge/update-summary.cjs')

test('preview update summaries describe the change without exposing transport metadata', () => {
  const summary = previewChangeSummary({
    title: 'docs: clarify PR preview activation',
    notes: `docs: clarify PR preview activation — @author-name; exact head ${'a'.repeat(40)}. https://example.invalid/feed`
  })
  assert.equal(summary, '本次更新：文档：完善 PR 预览启用流程')
  assert.doesNotMatch(summary, /https?:|@author|[a-f0-9]{40}/i)
})

test('legacy signed candidates receive reviewed detailed notes bound to their exact head', () => {
  const candidate = { headSha: '64f5567e452518942de8fd2fda672d461fa3c16f', title: 'docs: clarify PR preview activation' }
  const details = previewChangeDetails(candidate)
  assert.equal(details.length, 3)
  assert.ok(details.every(detail => detail.length > 20))
  assert.equal(previewChangeSummary(candidate), '本次更新包含 3 项变更')
})

test('signed preview notes prefer the PR change section and omit testing links', () => {
  const body = [
    '## Summary',
    '- 修复自动更新提示',
    '- 合并桌面版与 PR 候选',
    '',
    '## Testing',
    '- https://example.invalid/internal-log'
  ].join('\n')
  assert.equal(extractPrBodyDescription(body), '修复自动更新提示；合并桌面版与 PR 候选')
  assert.equal(previewChangeNotes({ title: 'fix: fallback title', body }), '修复自动更新提示；合并桌面版与 PR 候选')
})

test('display sanitization removes Markdown links, bare URLs, authors and full hashes', () => {
  const raw = `See [release notes](https://example.invalid/notes) — @author; commit ${'b'.repeat(40)}.`
  const cleaned = sanitizeUpdateDescription(raw)
  assert.equal(cleaned, 'See release notes')
})
