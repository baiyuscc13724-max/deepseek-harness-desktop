function meterError(code, publicMessage) {
  return Object.assign(new Error(publicMessage), { code, publicMessage })
}

function isOfficialDeepSeek(provider) {
  if (['deepseek', 'deepseek-official'].includes(provider.id)) return true
  try {
    return new URL(provider.profile?.baseURL || provider.profile?.baseUrl || '').hostname === 'api.deepseek.com'
  } catch {
    return false
  }
}

function money(value) {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeDeepSeekBalance(payload) {
  if (!payload?.is_available) return { status: 'unavailable', message: 'DeepSeek 账户余额当前不可用。', meters: [] }
  const meters = (payload.balance_infos || []).map((row, index) => ({
    id: `balance-${String(row.currency || index).toLowerCase()}`,
    kind: 'balance',
    label: '账户余额',
    currency: String(row.currency || '').toUpperCase(),
    total: money(row.total_balance),
    granted: money(row.granted_balance),
    toppedUp: money(row.topped_up_balance)
  }))
  return { status: meters.length ? 'ready' : 'unavailable', message: meters.length ? '' : 'DeepSeek 未返回余额信息。', meters }
}

function createDeepSeekBalanceAdapter({ endpoint = 'https://api.deepseek.com/user/balance', timeoutMs = 8000 } = {}) {
  return {
    id: 'deepseek-balance-v1',
    supports: isOfficialDeepSeek,
    async refresh({ credential, fetchImpl }) {
      if (!credential?.value) throw meterError('METER_AUTH_REQUIRED', '请先为 DeepSeek 配置有效密钥。')
      if (typeof fetchImpl !== 'function') throw meterError('METER_UNAVAILABLE', '当前环境无法访问 DeepSeek 余额服务。')
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(endpoint, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${credential.value}` }
        })
        if (response.status === 401 || response.status === 403) throw meterError('METER_AUTH_REQUIRED', 'DeepSeek 密钥无效或无权查询余额。')
        if (!response.ok) throw meterError('METER_UNAVAILABLE', `DeepSeek 余额服务暂时不可用（${response.status}）。`)
        return normalizeDeepSeekBalance(await response.json())
      } catch (error) {
        if (error.code?.startsWith('METER_')) throw error
        throw meterError('METER_UNAVAILABLE', '连接 DeepSeek 余额服务失败。')
      } finally {
        clearTimeout(timeout)
      }
    }
  }
}

module.exports = { createAdapter: createDeepSeekBalanceAdapter, createDeepSeekBalanceAdapter, isOfficialDeepSeek, normalizeDeepSeekBalance }
