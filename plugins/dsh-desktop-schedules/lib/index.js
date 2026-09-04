import { createHash, randomBytes } from 'node:crypto'
import {
  ScheduleLogError,
  decodeScheduleChange,
  foldScheduleEvents,
  resolveEveryOccurrence,
  scheduleView
} from '@deepseek-ai/dsh-schedule'

const name = 'desktop-schedules'
const inject = ['agents', 'webServer']
const HISTORY_LIMIT = 50
const MAX_CACHE_ENTRIES = 128
const EMPTY_CHECKSUM_SEED = 'dsh-desktop-schedules/v1\0'

function json(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-cache, private',
    'x-content-type-options': 'nosniff',
    ...headers
  })
  res.end(body)
}

function empty(res, status, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-cache, private',
    'x-content-type-options': 'nosniff',
    ...headers
  })
  res.end()
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

function requestUrl(req) {
  return new URL(req.url, 'http://local')
}

function sessionIdFrom(req) {
  const values = requestUrl(req).searchParams.getAll('sessionId')
  const value = values[0]
  if (values.length !== 1 || typeof value !== 'string' || value.trim() !== value || !value || value.length > 256) throw new TypeError('sessionId must be a non-empty string')
  return value
}

function requestProjectionFrom(req) {
  const params = requestUrl(req).searchParams
  const sinceValues = params.getAll('since')
  const generationValues = params.getAll('generation')
  if (sinceValues.length > 1 || generationValues.length > 1) throw new TypeError('schedule projection validators must not be repeated')
  let since = null
  if (sinceValues.length) {
    if (!/^(?:-1|0|[1-9]\d*)$/u.test(sinceValues[0])) throw new TypeError('since must be a safe schedule cursor')
    since = Number(sinceValues[0])
    if (!Number.isSafeInteger(since)) throw new TypeError('since must be a safe schedule cursor')
  }
  let generation = null
  if (generationValues.length) {
    generation = generationValues[0]
    if (!generation || generation.length > 128 || generation.trim() !== generation || /[\r\n\u0000]/u.test(generation)) throw new TypeError('generation must be a bounded token')
  }
  const rawTag = req.headers['if-none-match']
  if (rawTag !== undefined && (typeof rawTag !== 'string' || rawTag.length > 1024 || /[\r\n\u0000]/u.test(rawTag))) throw new TypeError('If-None-Match must be a bounded header')
  return { since, generation, ifNoneMatch: rawTag ?? null }
}

function nextDispatchedRecord(record, change) {
  const hasAcceptedAt = Object.prototype.hasOwnProperty.call(change, 'acceptedAt')
  if (record.kind !== 'every') {
    if (hasAcceptedAt) throw new ScheduleLogError('one-shot dispatch must not contain acceptedAt')
    return undefined
  }
  if (!hasAcceptedAt) throw new ScheduleLogError('every dispatch must contain acceptedAt')
  const occurrence = resolveEveryOccurrence(record, Date.parse(change.acceptedAt))
  return occurrence.nextScheduledAt === undefined ? undefined : Object.freeze({ ...record, scheduledAt: occurrence.nextScheduledAt })
}

function historyItem(record, operation, change) {
  return {
    id: record.id,
    operation,
    prompt: record.prompt,
    kind: record.kind,
    schedule: { ...record },
    scheduledAt: record.scheduledAt,
    occurredAt: operation === 'created' ? record.scheduledAt : operation === 'deleted' ? null : change.acceptedAt || record.scheduledAt
  }
}

function applyScheduleEventBatch(folded, priorHistory, events, limit = HISTORY_LIMIT) {
  const active = new Map(folded.active.map(record => [record.id, record]))
  const seen = new Set(folded.seenIds)
  const history = [...priorHistory]
  let scheduleChangeCount = 0
  for (const event of events) {
    if (event?.type !== 'schedule/change') continue
    const change = decodeScheduleChange(event.data)
    scheduleChangeCount += 1
    if (change.operation === 'create') {
      if (seen.has(change.schedule.id)) throw new ScheduleLogError(`schedule id ${JSON.stringify(change.schedule.id)} was reused`)
      seen.add(change.schedule.id)
      active.set(change.schedule.id, change.schedule)
      history.unshift(historyItem(change.schedule, 'created', change))
    } else {
      const record = active.get(change.id)
      if (!record) throw new ScheduleLogError(`schedule ${change.operation} targets inactive id ${JSON.stringify(change.id)}`)
      if (change.operation === 'delete') {
        active.delete(change.id)
        history.unshift(historyItem(record, 'deleted', change))
      } else if (change.operation === 'dispatch') {
        const next = nextDispatchedRecord(record, change)
        if (next === undefined) active.delete(change.id)
        else active.set(change.id, next)
        history.unshift(historyItem(record, 'dispatched', change))
      }
    }
    if (history.length > limit) history.length = limit
  }
  return {
    folded: Object.freeze({ active: Object.freeze([...active.values()]), seenIds: Object.freeze([...seen]) }),
    history,
    scheduleChangeCount
  }
}

function scheduleHistory(events, seedLength = 0, limit = HISTORY_LIMIT) {
  const bounded = Math.max(1, Math.min(100, Number(limit) || HISTORY_LIMIT))
  return applyScheduleEventBatch({ active: [], seenIds: [] }, [], events.slice(seedLength), bounded).history
}

function ownSessionEvents(session) {
  if (typeof session?.ownEvents !== 'function') throw new TypeError('official Session.ownEvents is unavailable')
  const events = session.ownEvents()
  if (!Array.isArray(events)) throw new TypeError('official Session.ownEvents must return an event array')
  return events
}

function liveAgent(ctx, sessionId) {
  const agent = ctx.agents.get(sessionId)
  return agent && ctx.agents.roots().includes(agent) ? agent : null
}

function semanticSnapshot(sessionId, folded, history, now) {
  const schedules = folded.active
    .map(record => scheduleView(record, now))
    .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt) || left.id.localeCompare(right.id))
  return {
    schemaVersion: 2,
    available: true,
    live: true,
    sessionId,
    schedules,
    seenIds: [...folded.seenIds],
    history,
    limitation: 'session-local',
    minimumEverySeconds: 300
  }
}

function unavailableSnapshot(sessionId) {
  return { schemaVersion: 2, available: false, live: false, sessionId, schedules: [], seenIds: [], history: [], limitation: 'session-local' }
}

function corruptSnapshot(sessionId) {
  return {
    schemaVersion: 2,
    available: true,
    live: true,
    sessionId,
    schedules: [],
    seenIds: [],
    history: [],
    limitation: 'session-local',
    error: { code: 'corrupt_schedule_log', message: '当前会话的定时任务记录无法安全读取。' }
  }
}

function snapshot(ctx, sessionId, now = Date.now()) {
  const agent = liveAgent(ctx, sessionId)
  if (!agent) return unavailableSnapshot(sessionId)
  try {
    const events = ownSessionEvents(agent.session)
    const folded = foldScheduleEvents(events)
    return semanticSnapshot(sessionId, folded, scheduleHistory(events), now)
  } catch {
    return corruptSnapshot(sessionId)
  }
}

function eventBytes(event) {
  const value = JSON.stringify(event)
  return `${Buffer.byteLength(value, 'utf8')}:${value}\n`
}

function emptyHasher() {
  return createHash('sha256').update(EMPTY_CHECKSUM_SEED)
}

function hashEventBatch(base, events) {
  const hasher = base ? base.copy() : emptyHasher()
  for (const event of events) hasher.update(eventBytes(event))
  return { hasher, checksum: hasher.copy().digest('hex') }
}

function eventFingerprint(event) {
  return event === undefined ? null : createHash('sha256').update(eventBytes(event)).digest('hex')
}

function continuity(session, events, inheritedEventCount) {
  const nextSeq = session?.seq
  if (!Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) return { valid: false, reason: 'inherited_event_count_invalid' }
  if (!Number.isSafeInteger(nextSeq) || nextSeq < inheritedEventCount || nextSeq !== inheritedEventCount + events.length) {
    return { valid: false, reason: 'sequence_length_mismatch' }
  }
  for (let index = 0; index < events.length; index += 1) {
    if (!Number.isSafeInteger(events[index]?.seq) || events[index].seq !== inheritedEventCount + index) return { valid: false, reason: 'sequence_gap' }
  }
  const lastSeq = nextSeq - 1
  return {
    valid: true,
    nextSeq,
    lastSeq,
    ownCount: events.length,
    tailFingerprint: events.length ? eventFingerprint(events[events.length - 1]) : null
  }
}

function nextStateBoundary(folded, now) {
  let boundary = Infinity
  for (const record of folded.active) {
    const target = Date.parse(record.scheduledAt)
    if (target > now && target < boundary) boundary = target
  }
  return boundary
}

function semanticEtag(generation, semantic) {
  // The cursor/checksum transport metadata may advance on non-Schedule events;
  // this weak validator intentionally represents the user-visible Schedule view.
  const digest = createHash('sha256').update(generation).update('\0').update(JSON.stringify(semantic)).digest('hex')
  return `W/"dds-${digest}"`
}

function matchesEtag(value, expected) {
  if (typeof value !== 'string') return false
  return value.split(',').some(candidate => candidate.trim() === '*' || candidate.trim() === expected)
}

function responseHeaders(entry) {
  return {
    etag: entry.etag,
    'x-schedule-cursor': String(entry.lastSeq),
    'x-schedule-generation': entry.generation,
    'x-schedule-inherited-event-count': String(entry.inheritedEventCount),
    'x-schedule-checksum': entry.checksum
  }
}

function responseBody(entry, details = {}) {
  return {
    ...entry.semantic,
    projection: {
      mode: details.mode || 'full',
      cacheable: true,
      cursor: entry.lastSeq,
      generation: entry.generation,
      inheritedEventCount: entry.inheritedEventCount,
      checksum: entry.checksum,
      ...(details.since === undefined ? {} : { since: details.since }),
      ...(details.deltaCount === undefined ? {} : { deltaCount: details.deltaCount }),
      ...(details.scheduleChangeCount === undefined ? {} : { scheduleChangeCount: details.scheduleChangeCount }),
      ...(details.viewChanged ? { viewChanged: true } : {}),
      ...(details.fallbackReason ? { fallbackReason: details.fallbackReason } : {})
    }
  }
}

function requestMismatch(request, entry, expectedCursor = entry.lastSeq, expectedEtag = entry.etag) {
  if (request.since === null) return 'since_missing'
  if (request.generation === null) return 'generation_missing'
  if (request.generation !== entry.generation) return 'generation_mismatch'
  if (request.since > expectedCursor) return 'since_ahead'
  if (request.since !== expectedCursor) return 'since_mismatch'
  if (!matchesEtag(request.ifNoneMatch, expectedEtag)) return 'etag_mismatch'
  return null
}

function createScheduleProjectionStore(options = {}) {
  const entries = new Map()
  const objectEpochs = new WeakMap()
  let nextObjectEpoch = 1
  const enabled = options.enabled !== false
  const maxEntries = Math.max(1, Number(options.maxEntries) || MAX_CACHE_ENTRIES)
  const storeEpoch = typeof options.epoch === 'string' && options.epoch ? options.epoch : randomBytes(12).toString('hex')

  function inheritedCount(session) {
    return session?.inheritedEventCount === undefined ? 0 : session.inheritedEventCount
  }

  function generationFor(session, sessionId) {
    let objectEpoch = objectEpochs.get(session)
    if (objectEpoch === undefined) {
      objectEpoch = nextObjectEpoch
      nextObjectEpoch += 1
      objectEpochs.set(session, objectEpoch)
    }
    const header = session?.header || {}
    const declared = session?.generation ?? session?.epoch ?? null
    const value = JSON.stringify({
      sessionId,
      storeEpoch,
      objectEpoch,
      declared: typeof declared === 'string' || typeof declared === 'number' ? declared : null,
      version: header.version ?? null,
      createdAt: header.createdAt ?? null,
      parentSession: header.parentSession ?? null,
      isSeeded: header.isSeeded ?? null,
      inheritedEventCount: inheritedCount(session)
    })
    return createHash('sha256').update(value).digest('hex').slice(0, 32)
  }

  function remember(sessionId, entry) {
    entries.delete(sessionId)
    entries.set(sessionId, entry)
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
  }

  function buildEntry(sessionId, session, generation, inheritedEventCount, folded, history, hash, facts, now) {
    const semantic = semanticSnapshot(sessionId, folded, history, now)
    return {
      session,
      generation,
      inheritedEventCount,
      folded,
      history,
      hasher: hash.hasher,
      checksum: hash.checksum,
      nextSeq: facts.nextSeq,
      lastSeq: facts.lastSeq,
      ownCount: facts.ownCount,
      tailFingerprint: facts.tailFingerprint,
      semantic,
      etag: semanticEtag(generation, semantic),
      renderedAt: now,
      nextBoundary: nextStateBoundary(folded, now)
    }
  }

  function fullReplay(sessionId, session, generation, inheritedEventCount, now, fallbackReason) {
    try {
      const events = ownSessionEvents(session)
      const folded = foldScheduleEvents(events)
      const history = scheduleHistory(events)
      const facts = continuity(session, events, inheritedEventCount)
      const hash = hashEventBatch(null, events)
      if (!facts.valid) {
        entries.delete(sessionId)
        return {
          status: 200,
          headers: {},
          body: {
            ...semanticSnapshot(sessionId, folded, history, now),
            projection: {
              mode: 'full',
              cacheable: false,
              cursor: Number.isSafeInteger(session?.seq) ? session.seq - 1 : null,
              generation,
              inheritedEventCount,
              checksum: hash.checksum,
              fallbackReason: facts.reason
            }
          }
        }
      }
      const entry = buildEntry(sessionId, session, generation, inheritedEventCount, folded, history, hash, facts, now)
      remember(sessionId, entry)
      return { status: 200, headers: responseHeaders(entry), body: responseBody(entry, { mode: 'full', fallbackReason }) }
    } catch {
      entries.delete(sessionId)
      return { status: 200, headers: {}, body: corruptSnapshot(sessionId) }
    }
  }

  function tailStillMatches(session, entry) {
    if (!entry.ownCount || typeof session?.eventAt !== 'function') return true
    return eventFingerprint(session.eventAt(entry.lastSeq)) === entry.tailFingerprint
  }

  function project(ctx, sessionId, request = {}) {
    const now = Number.isFinite(request.now) ? request.now : Date.now()
    const agent = liveAgent(ctx, sessionId)
    if (!agent) {
      entries.delete(sessionId)
      return { status: 200, headers: {}, body: unavailableSnapshot(sessionId) }
    }
    if (!enabled) return { status: 200, headers: {}, body: snapshot(ctx, sessionId, now) }

    const session = agent.session
    const inheritedEventCount = inheritedCount(session)
    const generation = generationFor(session, sessionId)
    const entry = entries.get(sessionId)
    if (!entry) return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'cold_start')
    if (entry.session !== session) return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'epoch_changed')
    if (entry.inheritedEventCount !== inheritedEventCount) return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'inherited_event_count_changed')
    if (entry.generation !== generation) return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'generation_changed')

    const nextSeq = session?.seq
    if (!Number.isSafeInteger(nextSeq) || nextSeq < inheritedEventCount) return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'sequence_unproven')
    if (nextSeq < entry.nextSeq) return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'sequence_rewind')
    if (!tailStillMatches(session, entry)) return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'prefix_checksum_mismatch')

    if (nextSeq === entry.nextSeq) {
      const previousEtag = entry.etag
      let current = entry
      let viewChanged = false
      if (now < entry.renderedAt || now >= entry.nextBoundary) {
        const semantic = semanticSnapshot(sessionId, entry.folded, entry.history, now)
        current = { ...entry, semantic, etag: semanticEtag(entry.generation, semantic), renderedAt: now, nextBoundary: nextStateBoundary(entry.folded, now) }
        remember(sessionId, current)
        viewChanged = current.etag !== previousEtag
      } else {
        remember(sessionId, entry)
      }
      const mismatch = requestMismatch(request, current, current.lastSeq, previousEtag)
      if (!mismatch && !viewChanged && matchesEtag(request.ifNoneMatch, current.etag)) {
        return { status: 304, headers: responseHeaders(current), body: null }
      }
      return {
        status: 200,
        headers: responseHeaders(current),
        body: responseBody(current, mismatch ? { mode: 'full', fallbackReason: mismatch } : { mode: 'delta', since: request.since, deltaCount: 0, scheduleChangeCount: 0, viewChanged })
      }
    }

    let events
    try { events = ownSessionEvents(session) } catch { return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'own_events_unavailable') }
    const facts = continuity(session, events, inheritedEventCount)
    if (!facts.valid || facts.ownCount < entry.ownCount) return fullReplay(sessionId, session, generation, inheritedEventCount, now, facts.reason || 'sequence_gap')
    if (entry.ownCount && eventFingerprint(events[entry.ownCount - 1]) !== entry.tailFingerprint) {
      return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'prefix_checksum_mismatch')
    }
    const delta = events.slice(entry.ownCount)
    if (!delta.length || delta[0].seq !== entry.nextSeq) return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'sequence_gap')

    let applied
    try { applied = applyScheduleEventBatch(entry.folded, entry.history, delta) } catch {
      return fullReplay(sessionId, session, generation, inheritedEventCount, now, 'incremental_transition_failed')
    }
    const hash = hashEventBatch(entry.hasher, delta)
    const current = buildEntry(sessionId, session, generation, inheritedEventCount, applied.folded, applied.history, hash, facts, now)
    remember(sessionId, current)
    const mismatch = requestMismatch(request, entry)
    if (!mismatch && matchesEtag(request.ifNoneMatch, current.etag)) {
      return { status: 304, headers: responseHeaders(current), body: null }
    }
    return {
      status: 200,
      headers: responseHeaders(current),
      body: responseBody(current, mismatch
        ? { mode: 'full', fallbackReason: mismatch }
        : { mode: 'delta', since: request.since, deltaCount: delta.length, scheduleChangeCount: applied.scheduleChangeCount })
    }
  }

  return { enabled, project, clear: () => entries.clear(), size: () => entries.size }
}

function incrementalEnabled(config = {}) {
  return config.incremental !== false && process.env.DSH_DESKTOP_SCHEDULES_INCREMENTAL !== '0'
}

function apply(ctx, config = {}) {
  const projections = createScheduleProjectionStore({ enabled: incrementalEnabled(config) })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop-schedules/state',
    handler: async (req, res) => {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed', code: 'SCHEDULE_METHOD_NOT_ALLOWED' })
      if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden', code: 'SCHEDULE_FORBIDDEN' })
      try {
        const result = projections.project(ctx, sessionIdFrom(req), requestProjectionFrom(req))
        if (result.status === 304) return empty(res, 304, result.headers)
        return json(res, result.status, result.body, result.headers)
      } catch (error) {
        return json(res, 400, { error: error.message, code: 'SCHEDULE_BAD_REQUEST' })
      }
    }
  }), 'desktop-schedules state route')
}

export {
  apply,
  applyScheduleEventBatch,
  createScheduleProjectionStore,
  incrementalEnabled,
  inject,
  name,
  requestProjectionFrom,
  scheduleHistory,
  snapshot,
  trustedRequest
}
