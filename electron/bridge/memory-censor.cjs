// 本地跨会话记忆：高风险内容识别与脱敏（memory-censor）。
//
// 职责：识别密码、API key、token、Cookie、Authorization、银行卡号、
// 验证码等易泄露凭证并生成脱敏占位符。仅依赖正则与 Luhn 校验，无任何 IO。
// 本模块自身不保存任何原文，也不写入任何日志——调用方负责把识别结果
// 以元数据形式（类型列表）写入审计，绝不允许把命中原文带入审计记录。

const REDACT_PREFIX = '[REDACTED:'
const REDACT_SUFFIX = ']'

// 识别出的风险类型（稳定顺序，供审计与提示文案使用）。
const PATTERN_TYPES = Object.freeze([
  'password',
  'api-key',
  'token',
  'cookie',
  'authorization',
  'bank-card',
  'verification-code',
  'secret'
])

// 统一用零宽断言代替 \b，以便同时覆盖 ASCII 与中文边界。
const NB = '(?<![A-Za-z0-9_])'
const NA = '(?![A-Za-z0-9_])'
// 值分隔符：显式赋值符 + 中文“为/是”。刻意不收英文 is/are，
// 避免把“password is required”这类普通说明误判为凭证泄露；
// “为/是”后的空格由后续 \s* 消化，长度下限用于过滤非凭证句子。
const SEP = '(?:[=:：]|为|是)'
// 凭证值：不含空白的连续串。
const WORD = '[^\\s,，。；]'

// 需要含字母的令牌/密钥值（纯数字串不当作令牌，降低误报）。
const TOKEN_VALUE = `(?=[A-Za-z0-9._~+/-]{10,})[A-Za-z0-9._~+/-]*[A-Za-z][A-Za-z0-9._~+/-]*`

// 顺序重要：先匹配更精确的赋值式标签，再匹配裸令牌形态。
const LABELED_PATTERNS = [
  // 密码：password/passwd/pwd/口令/密码 + 赋值 + >=6 位值。
  { type: 'password', re: new RegExp(`${NB}(?:pass(?:word|wd)?|pwd|口令|密码)${NA}[^\\n]{0,24}?${SEP}\\s*${WORD}{6,80}`, 'gi') },
  // API key：api_key / secret_key / client_secret / access_key 等（需显式赋值）。
  { type: 'api-key', re: new RegExp(`${NB}(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?key|private[_-]?key|public[_-]?key)${NA}[^\\n]{0,24}?${SEP}\\s*${TOKEN_VALUE}`, 'gi') },
  // token：access/refresh/auth/id/session token、jwt、bearer 标签（需显式赋值）。
  { type: 'token', re: new RegExp(`${NB}(?:access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|session[_-]?token|jwt|bearer)${NA}[^\\n]{0,24}?${SEP}\\s*${TOKEN_VALUE}`, 'gi') },
  // cookie：Cookie 头或常见会话 cookie 名。
  { type: 'cookie', re: new RegExp(`${NB}(?:cookie|cookies)${NA}[^\\n]{0,24}?${SEP}\\s*[A-Za-z0-9_%.-]+(?:=[A-Za-z0-9_%.-]+)?`, 'gi') },
  { type: 'cookie', re: new RegExp(`${NB}(?:sessionid|session_id|connect\\.sid|csrftoken|xsrf[_-]?token)${NA}[^\\n]{0,24}?${SEP}\\s*[A-Za-z0-9_%.-]{6,}`, 'gi') },
  // authorization：请求头、Basic / Bearer 认证值。
  { type: 'authorization', re: new RegExp(`${NB}(?:authorization|proxy-authorization)${NA}[^\\n]{0,24}?${SEP}\\s*\\S+`, 'gi') },
  { type: 'authorization', re: new RegExp(`${NB}basic\\s+[a-z0-9+/=]{8,}`, 'gi') },
  { type: 'authorization', re: new RegExp(`${NB}bearer\\s+[a-z0-9._~+/=-]{10,}`, 'gi') },
  // 验证码：中文/英文标签 + 4-8 位数字。
  { type: 'verification-code', re: new RegExp(`${NB}(?:验证码|校验码|安全码|动态码|verification\\s*code|verify\\s*code|sms\\s*code|otp|captcha|auth\\s*code)${NA}[^\\n]{0,32}?\\b\\d{4,8}\\b`, 'gi') },
  { type: 'verification-code', re: new RegExp(`${NB}(?:验证码|verification\\s*code|otp)${NA}\\s*${SEP}\\s*\\d{4,8}\\b`, 'gi') },
  // 通用 secret：secret / 密钥 / 私钥。
  { type: 'secret', re: new RegExp(`${NB}(?:secret|密钥|私钥)${NA}[^\\n]{0,24}?${SEP}\\s*${WORD}{6,}`, 'gi') }
]

// 裸令牌形态（无需标签即可识别）。
const BARE_PATTERNS = [
  { type: 'api-key', re: /(?<![A-Za-z0-9_])sk-[A-Za-z0-9]{16,}/g },
  { type: 'api-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'token', re: /(?<![A-Za-z0-9_-])gh[pousr]_[A-Za-z0-9]{20,}/g },
  { type: 'token', re: /(?<![A-Za-z0-9_-])(?:xox[baprs]-|glpat-|github_pat_)[A-Za-z0-9_-]{16,}/g },
  { type: 'token', re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g }
]

// 银行卡候选：13-19 位数字（允许空格/连字符），需通过 Luhn 校验，
// 避免把普通长数字（时间戳、版本号）误判为卡号。
const CARD_CANDIDATE_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g

function luhnValid(digits) {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

function collectMatches(text) {
  const raw = []
  const push = (kind, re) => {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      raw.push({ type: kind, start: m.index, end: m.index + m[0].length })
      if (m[0].length === 0) re.lastIndex += 1
    }
  }
  for (const p of LABELED_PATTERNS) push(p.type, p.re)
  for (const p of BARE_PATTERNS) push(p.type, p.re)
  CARD_CANDIDATE_RE.lastIndex = 0
  let cm
  while ((cm = CARD_CANDIDATE_RE.exec(text)) !== null) {
    const digits = cm[0].replace(/[^\d]/g, '')
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
      raw.push({ type: 'bank-card', start: cm.index, end: cm.index + cm[0].length })
    }
    if (cm[0].length === 0) CARD_CANDIDATE_RE.lastIndex += 1
  }
  // 按出现位置排序；重叠时保留更早出现者并扩展其覆盖范围。
  raw.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept = []
  for (const m of raw) {
    const last = kept[kept.length - 1]
    if (last && m.start < last.end) {
      if (m.end > last.end) last.end = m.end
      continue
    }
    kept.push(m)
  }
  return kept
}

/**
 * 检测文本中的高风险内容。
 * @param {string} text 原始文本（标题、内容、标签拼接均可）。
 * @returns {string[]} 按首次出现顺序去重后的风险类型列表；无风险时为空数组。
 */
function detectHighRisk(text) {
  const value = String(text == null ? '' : text)
  if (!value) return []
  const types = []
  for (const m of collectMatches(value)) {
    if (!types.includes(m.type)) types.push(m.type)
  }
  return types
}

/**
 * 脱敏文本中的高风险内容。
 * @param {string} text 原始文本。
 * @returns {{ text: string, types: string[] }} 脱敏后的文本与命中的风险类型；
 *   原始命中内容绝不会出现在结果中。
 */
function redact(text) {
  const value = String(text == null ? '' : text)
  const matches = collectMatches(value)
  if (!matches.length) return { text: value, types: [] }
  const types = []
  let out = ''
  let cursor = 0
  for (const m of matches) {
    out += value.slice(cursor, m.start)
    out += `${REDACT_PREFIX}${m.type}${REDACT_SUFFIX}`
    cursor = m.end
    if (!types.includes(m.type)) types.push(m.type)
  }
  out += value.slice(cursor)
  return { text: out, types }
}

module.exports = {
  PATTERN_TYPES,
  REDACT_PREFIX,
  REDACT_SUFFIX,
  detectHighRisk,
  redact
}