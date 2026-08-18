const { spawn } = require('node:child_process')

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
      finish(meterError('METER_UNAVAILABLE', '未找到可用的 Codex 客户端。'))
      return
    }
    child.on('error', () => finish(meterError('METER_UNAVAILABLE', '未找到可用的 Codex 客户端。')))
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
        clientInfo: { name: 'harness-desktop-meter', title: 'Harness Desktop', version: '1.0.19' },
        capabilities: { experimentalApi: true }
      }
    })}\n`)
  })
}

function createCodexRateLimitsAdapter(options = {}) {
  return {
    id: 'openai-codex-rate-limits-v1',
    supports: provider => provider.id === 'openai-codex',
    async refresh({ spawnImpl }) {
      return normalizeCodexRateLimits(await queryCodexAppServer({ ...options, spawnImpl: spawnImpl || options.spawnImpl }))
    }
  }
}

module.exports = { createAdapter: createCodexRateLimitsAdapter, createCodexRateLimitsAdapter, normalizeCodexRateLimits, queryCodexAppServer }
