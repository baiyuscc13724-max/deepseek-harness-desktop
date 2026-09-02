import { foldScheduleEvents, scheduleView } from '@deepseek-ai/dsh-schedule'

const name = 'desktop-schedules'
const inject = ['agents', 'webServer']

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(body)
}

function trustedRequest(req) {
  const rawHost = req.headers.host
  if (typeof rawHost !== 'string') return false
  let host
  try { host = new URL(`http://${rawHost}`).hostname.toLowerCase() } catch { return false }
  if (!['127.0.0.1', 'localhost'].includes(host)) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' && parsed.host.toLowerCase() === rawHost.toLowerCase() && ['127.0.0.1', 'localhost'].includes(parsed.hostname.toLowerCase())
  } catch { return false }
}

function sessionIdFrom(req) {
  const value = new URL(req.url, 'http://local').searchParams.get('sessionId')
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > 256) throw new TypeError('sessionId must be a non-empty string')
  return value
}

function scheduleHistory(events, seedLength = 0, limit = 50) {
  const records = new Map()
  const history = []
  for (const event of events.slice(seedLength)) {
    if (event?.type !== 'schedule/change' || event.data?.version !== 1) continue
    const change = event.data
    if (change.operation === 'create' && change.schedule?.id) {
      const record = { ...change.schedule }
      records.set(record.id, record)
      history.push({ id: record.id, operation: 'created', prompt: record.prompt, kind: record.kind, schedule: { ...record }, scheduledAt: record.scheduledAt, occurredAt: record.scheduledAt })
      continue
    }
    const record = records.get(change.id)
    if (!record) continue
    if (change.operation === 'delete') {
      history.push({ id: record.id, operation: 'deleted', prompt: record.prompt, kind: record.kind, schedule: { ...record }, scheduledAt: record.scheduledAt, occurredAt: null })
      records.delete(record.id)
    } else if (change.operation === 'dispatch') {
      history.push({ id: record.id, operation: 'dispatched', prompt: record.prompt, kind: record.kind, schedule: { ...record }, scheduledAt: record.scheduledAt, occurredAt: change.acceptedAt || record.scheduledAt })
      if (record.kind !== 'every') records.delete(record.id)
    }
  }
  return history.slice(-Math.max(1, Math.min(100, Number(limit) || 50))).reverse()
}

function ownSessionEvents(session) {
  if (typeof session?.ownEvents !== 'function') throw new TypeError('official Session.ownEvents is unavailable')
  return session.ownEvents()
}

function snapshot(ctx, sessionId, now = Date.now()) {
  const agent = ctx.agents.get(sessionId)
  if (!agent || !ctx.agents.roots().includes(agent)) {
    return { schemaVersion: 2, available: false, live: false, sessionId, schedules: [], history: [], limitation: 'session-local' }
  }
  try {
    const events = ownSessionEvents(agent.session)
    const folded = foldScheduleEvents(events)
    const schedules = folded.active.map(record => scheduleView(record, now)).sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt) || left.id.localeCompare(right.id))
    return { schemaVersion: 2, available: true, live: true, sessionId, schedules, history: scheduleHistory(events), limitation: 'session-local', minimumEverySeconds: 300 }
  } catch {
    return { schemaVersion: 2, available: true, live: true, sessionId, schedules: [], history: [], limitation: 'session-local', error: { code: 'corrupt_schedule_log', message: '当前会话的定时任务记录无法安全读取。' } }
  }
}

function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop-schedules/state',
    handler: async (req, res) => {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed', code: 'SCHEDULE_METHOD_NOT_ALLOWED' })
      if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden', code: 'SCHEDULE_FORBIDDEN' })
      try { return json(res, 200, snapshot(ctx, sessionIdFrom(req))) }
      catch (error) { return json(res, 400, { error: error.message, code: 'SCHEDULE_BAD_REQUEST' }) }
    }
  }), 'desktop-schedules state route')
}

export { apply, inject, name, scheduleHistory, snapshot, trustedRequest }
