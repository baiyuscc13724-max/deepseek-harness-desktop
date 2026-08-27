const CONVENTIONAL_LABELS = Object.freeze({
  feat: '新增',
  fix: '修复',
  docs: '文档',
  refactor: '优化',
  perf: '性能',
  test: '测试',
  build: '构建',
  ci: '持续集成',
  chore: '维护',
  style: '界面'
})

const LEGACY_SIGNED_PREVIEW_DETAILS = Object.freeze({
  '64f5567e452518942de8fd2fda672d461fa3c16f': Object.freeze([
    '明确 PR 预览候选只有在签名、真实更新/重启/回滚门禁和 CNB/GitHub 双源提升全部通过后才会推送',
    '补充独立生产预览公钥与 CNB pipeline 已启用的通道状态说明',
    '明确 CNB 推送令牌必须具有仓库代码读写权限，仅有 ISSUE 与 PR 管理权限不足'
  ])
})

const UPDATE_SUBJECT_REPLACEMENTS = Object.freeze([
  [/\bpr\s+preview\s+activation\b/giu, 'PR 预览启用流程'],
  [/\bpr\s+preview\b/giu, 'PR 预览'],
  [/\bsigned\s+preview\s+discovery\b/giu, '签名预览发现机制'],
  [/\bupdate\s+center\b/giu, '更新中心'],
  [/\bclarif(?:y|ies|ied)\b/giu, '完善'],
  [/\brollback\b/giu, '回滚'],
  [/\bactivation\b/giu, '启用流程'],
  [/\bdiscovery\b/giu, '发现机制'],
  [/\bpersist(?:s|ed|ence|ent)?\b/giu, '持久化'],
  [/\bqueue\b/giu, '队列'],
  [/\bdesktop\b/giu, '桌面端'],
  [/\bcomponent\b/giu, '组件'],
  [/\bpreview\b/giu, '预览'],
  [/\bupdate\b/giu, '更新'],
  [/\bstate\b/giu, '状态']
])

function boundedText(value, maximum = 600) {
  const text = String(value || '').trim()
  const characters = Array.from(text)
  return characters.length <= maximum ? text : `${characters.slice(0, maximum - 1).join('')}…`
}

function sanitizeUpdateDescription(value) {
  return boundedText(String(value || '')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<https?:\/\/[^>]+>/giu, ' ')
    .replace(/https?:\/\/[^\s)\]}]+/giu, ' ')
    .replace(/\s*[—–-]\s*@[a-z0-9](?:[a-z0-9-]{0,38})(?:\s*[;；,，]\s*)?/giu, ' ')
    .replace(/\b(?:exact\s+head|head\s+sha|commit)\s*[:#]?\s*[a-f0-9]{7,64}\b\.?/giu, ' ')
    .replace(/\b[a-f0-9]{40,64}\b/giu, ' ')
    .replace(/\bbuild\s+run\s+#?\d+\b/giu, ' ')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s:：;；,，.。—–-]+|[\s:：;；,，.。—–-]+$/gu, ''), 600)
}

function localizeUpdateSubject(value) {
  let text = sanitizeUpdateDescription(value)
  for (const [pattern, replacement] of UPDATE_SUBJECT_REPLACEMENTS) text = text.replace(pattern, replacement)
  return text
    .replace(/\s+/gu, ' ')
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
    .replace(/\s+([：，。])/gu, '$1')
    .trim()
}

function humanizeConventionalTitle(value) {
  const text = sanitizeUpdateDescription(value)
  const match = /^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/iu.exec(text)
  if (!match) return localizeUpdateSubject(text)
  const label = CONVENTIONAL_LABELS[match[1].toLowerCase()]
  return label ? `${label}：${localizeUpdateSubject(match[2])}` : localizeUpdateSubject(text)
}

function extractPrBodyDescription(value) {
  const body = String(value || '').replace(/\r\n?/gu, '\n').replace(/<!--[\s\S]*?-->/gu, ' ').replace(/```[\s\S]*?```/gu, ' ')
  const section = /(?:^|\n)#{1,6}\s*(?:summary|what\s+changed|changes|更新内容|变更(?:说明|摘要)?)\s*\n([\s\S]*?)(?=\n#{1,6}\s|$)/iu.exec(body)?.[1] || body
  const lines = []
  for (const raw of section.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^#{1,6}\s*(?:test|testing|verification|checklist|screenshots?|测试|验证|检查清单)/iu.test(line)) break
    if (/^#{1,6}\s/iu.test(line)) continue
    const cleaned = line.replace(/^[-*+]\s*(?:\[[ xX]\]\s*)?/u, '').trim()
    if (!cleaned || /^https?:\/\//iu.test(cleaned)) continue
    lines.push(cleaned)
    if (lines.length >= 6) break
  }
  return sanitizeUpdateDescription(lines.join('；'))
}

function previewChangeNotes({ title = '', body = '', notes = '' } = {}) {
  const bodyText = extractPrBodyDescription(body)
  const notesText = humanizeConventionalTitle(notes)
  const titleText = humanizeConventionalTitle(title)
  return bodyText || notesText || titleText || 'PR 预览更新'
}

function previewChangeDetails(candidate = {}) {
  const headSha = String(candidate.headSha || '').trim().toLowerCase()
  const legacy = LEGACY_SIGNED_PREVIEW_DETAILS[headSha]
  if (legacy) return [...legacy]
  const fragments = String(candidate.notes || '')
    .split(/(?:\r?\n|；|•)/gu)
    .map(value => humanizeConventionalTitle(value.replace(/^[-*+]\s*/u, '')))
    .filter(Boolean)
  if (!fragments.length) fragments.push(humanizeConventionalTitle(candidate.title) || 'PR 预览更新')
  const unique = []
  for (const fragment of fragments) {
    const detail = boundedText(fragment, 240)
    if (!detail || unique.includes(detail)) continue
    unique.push(detail)
    if (unique.length >= 8) break
  }
  return unique
}

function previewChangeSummary(candidate = {}) {
  const details = previewChangeDetails(candidate)
  return details.length > 1 ? `本次更新包含 ${details.length} 项变更` : `本次更新：${details[0]}`
}

module.exports = {
  extractPrBodyDescription,
  humanizeConventionalTitle,
  localizeUpdateSubject,
  previewChangeDetails,
  previewChangeNotes,
  previewChangeSummary,
  sanitizeUpdateDescription
}
