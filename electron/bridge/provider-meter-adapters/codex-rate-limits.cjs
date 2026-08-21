const { spawn } = require('node:child_process')

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CODEX_APP_URL = 'https://developers.openai.com/codex/app'

function meterError(code, publicMessage) {
  return Object.assign(new Error(publicMessage), { code, publicMessage })
}

function percentage(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null
}

function normalizeWindow(window, id, label) {
  if (!window || percentage(window.usedPercent) === null) return null
  const usedPercent = percentage(window.usedPercent)
  return {
    id,
    kind: 'usage-window',
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt: Number.isFinite(Number(window.resetsAt)) ? Number(window.resetsAt) : null,
    windowDurationMins: Number.isFinite(Number(window.windowDurationMins)) ? Number(window.windowDurationMins) : null
  }
}

function normalizeCodexRateLimits(payload) {
  const source = payload?.rateLimitsByLimitId && Object.keys(payload.rateLimitsByLimitId).length
    ? Object.values(payload.rateLimitsByLimitId)
    : [payload?.rateLimits]
  const meters = []
  const seen = new Set()
  for (const snapshot of source) {
    if (!snapshot) continue
    const limitId = String(snapshot.limitId || 'codex')
    if (seen.has(limitId)) continue
    seen.add(limitId)
    const baseLabel = String(snapshot.limitName || (limitId === 'codex' ? 'Codex 用量' : limitId))
    const primary = normalizeWindow(snapshot.primary, `${limitId}-primary`, baseLabel)
    const secondary = normalizeWindow(snapshot.secondary, `${limitId}-secondary`, `${baseLabel}（次级周期）`)
    if (primary) meters.push(primary)
    if (secondary) meters.push(secondary)
    if (snapshot.individualLimit) {
      meters.push({
        id: `${limitId}-budget`,
        kind: 'spending-budget',
        label: `${baseLabel}消费限额`,
        used: String(snapshot.individualLimit.used),
        limit: String(snapshot.individualLimit.limit),
        remainingPercent: percentage(snapshot.individualLimit.remainingPercent),
        resetsAt: Number(snapshot.individualLimit.resetsAt) || null
      })
    }
  }
  return { status: meters.length ? 'ready' : 'unavailable', message: meters.length ? '' : 'Codex 当前未返回可显示的用量周期。', meters }
}

function accountIdFromAccessToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token || '').split('.')[1] || '', 'base64url').toString('utf8'))
    const accountId = payload?.['https://api.openai.com/auth']?.chatgpt_account_id || payload?.chatgpt_account_id
    return typeof accountId === 'string' ? accountId.trim() : ''
  } catch {
    return ''
  }
}

function normalizedLimitId(value, fallback) {
  const id = String(value || fallback || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  return id || fallback
}

function whamWindow(window) {
  if (!window || percentage(window.used_percent) === null) return null
  return {
    usedPercent: percentage(window.used_percent),
    resetsAt: Number.isFinite(Number(window.reset_at)) ? Number(window.reset_at) : null,
    windowDurationMins: Number.isFinite(Number(window.limit_window_seconds)) ? Number(window.limit_window_seconds) / 60 : null
  }
}

function whamRateLimit(rateLimit, limitId, limitName = '') {
  if (!rateLimit) return null
  const primary = whamWindow(rateLimit.primary_window)
  const secondary = whamWindow(rateLimit.secondary_window)
  if (!primary && !secondary) return null
  return { limitId, limitName, primary, secondary }
}

function normalizeCodexUsage(payload) {
  const rateLimitsByLimitId = {}
  const primary = whamRateLimit(payload?.rate_limit, 'codex', 'Codex 用量')
  if (primary) rateLimitsByLimitId.codex = primary
  const codeReview = whamRateLimit(payload?.code_review_rate_limit, 'code-review', 'Codex 代码审查')
  if (codeReview) rateLimitsByLimitId['code-review'] = codeReview
  for (const [index, entry] of (Array.isArray(payload?.additional_rate_limits) ? payload.additional_rate_limits : []).entries()) {
    const limitId = normalizedLimitId(entry?.metered_feature || entry?.limit_name, `additional-${index + 1}`)
    const snapshot = whamRateLimit(entry?.rate_limit, limitId, String(entry?.limit_name || limitId))
    if (snapshot && !rateLimitsByLimitId[limitId]) rateLimitsByLimitId[limitId] = snapshot
  }
  return normalizeCodexRateLimits({ rateLimitsByLimitId })
}

async function queryCodexUsage({ credential, fetchImpl = globalThis.fetch } = {}) {
  const token = typeof credential === 'string' ? credential.trim() : String(credential?.value || '').trim()
  if (!token) throw meterError('METER_AUTH_REQUIRED', 'Codex 账户尚未登录。')
  const accountId = accountIdFromAccessToken(token)
  if (!accountId) throw meterError('METER_AUTH_REQUIRED', 'Codex 登录凭据格式已失效，请重新登录。')
  let response
  try {
    response = await fetchImpl(CODEX_USAGE_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'ChatGPT-Account-Id': accountId
      }
    })
  } catch {
    throw meterError('METER_UNAVAILABLE', 'Codex 用量服务当前无法连接。')
  }
  if (response.status === 401 || response.status === 403) throw meterError('METER_AUTH_REQUIRED', 'Codex 登录已过期，请重新登录。')
  if (!response.ok) throw meterError('METER_UNAVAILABLE', `Codex 用量服务暂时不可用 (${response.status})。`)
  return response.json()
}

function queryCodexAppServer({ spawnImpl = spawn, command = process.env.HARNESS_CODEX_EXECUTABLE || 'codex', timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let buffer = ''
    let child
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child && !child.killed) child.kill()
      error ? reject(error) : resolve(result)
    }
    const timer = setTimeout(() => finish(meterError('METER_UNAVAILABLE', 'Codex 用量查询超时。')), timeoutMs)
    try {
      child = spawnImpl(command, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    } catch {
      finish(meterError('METER_CLIENT_MISSING', '未找到可用的 Codex 客户端。'))
      return
    }
    child.on('error', () => finish(meterError('METER_CLIENT_MISSING', '未找到可用的 Codex 客户端。')))
    child.on('exit', code => {
      if (!settled) finish(meterError('METER_UNAVAILABLE', code === 0 ? 'Codex 未返回用量信息。' : 'Codex 账户尚未登录或客户端不可用。'))
    })
    child.stdout.on('data', chunk => {
      buffer += chunk
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ method: 'initialized', params: null })}\n`)
          child.stdin.write(`${JSON.stringify({ id: 2, method: 'account/rateLimits/read', params: null })}\n`)
        } else if (message.id === 2) {
          if (message.error) finish(meterError('METER_UNAVAILABLE', 'Codex 账户尚未登录或无法读取用量。'))
          else finish(null, message.result)
        }
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.write(`${JSON.stringify({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'harness-desktop-meter', title: 'Harness Desktop', version: '1.0.20' },
        capabilities: { experimentalApi: true }
      }
    })}\n`)
  })
}

function createCodexRateLimitsAdapter(options = {}) {
  return {
    id: 'openai-codex-rate-limits-v2',
    supports: provider => provider.id === 'openai-codex',
    async refresh({ credential, fetchImpl, spawnImpl }) {
      if (credential?.value) {
        return normalizeCodexUsage(await queryCodexUsage({ credential, fetchImpl: fetchImpl || options.fetchImpl }))
      }
      try {
        return normalizeCodexRateLimits(await queryCodexAppServer({ ...options, spawnImpl: spawnImpl || options.spawnImpl }))
      } catch (error) {
        // A bare spawn failure means no discoverable Codex client on this
        // machine. That is a persistent environment gap (真无客户端), not a
        // transient meter outage: surface an actionable auth-required state
        // (mirroring the OpenCode Go adapter) instead of a dead-end
        // "unavailable" message. Timeouts, protocol errors and HTTP failures
        // still reject as METER_UNAVAILABLE further up.
        if (error?.code === 'METER_CLIENT_MISSING') {
          return {
            status: 'auth-required',
            message: '未找到可用的 Codex 客户端，也未取得可查询官方用量的 Codex 凭据；请安装 Codex CLI，或在服务商设置中配置 Codex 凭据后重试。',
            action: { label: '查看官方 Codex', url: CODEX_APP_URL },
            meters: []
          }
        }
        throw error
      }
    }
  }
}

module.exports = {
  CODEX_APP_URL,
  CODEX_USAGE_URL,
  accountIdFromAccessToken,
  createAdapter: createCodexRateLimitsAdapter,
  createCodexRateLimitsAdapter,
  normalizeCodexRateLimits,
  normalizeCodexUsage,
  queryCodexAppServer,
  queryCodexUsage
}
