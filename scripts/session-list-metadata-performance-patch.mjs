const SUMMARIZE_ORIGINAL = `function summarize(session, running) {
\tconst metadata = sessionListMetadata(session.events);
\treturn {
\t\tsessionId: session.id,
\t\tupdatedAt: sessionListUpdatedAt(session.header, metadata),
\t\trunning,
\t\tblank: metadata.blank,
\t\t...sessionListFields(session.header, session.events)
\t};
}`

const SUMMARIZE_PROJECTED = `function summarize(session, running, projectedMetadata) {
\t/* DSH_DESKTOP_PROJECTED_SESSION_LIST_METADATA: reuse the exact live projection fold. */
\tconst metadata = projectedMetadata ?? sessionListMetadata(session.events);
\treturn {
\t\tsessionId: session.id,
\t\tupdatedAt: sessionListUpdatedAt(session.header, metadata),
\t\trunning,
\t\tblank: metadata.blank,
\t\t...sessionListFields(session.header, session.events)
\t};
}`

const SUMMARIZE_PATCHED = `const sessionListFieldsCache = /* @__PURE__ */ new WeakMap();
function memoizedSessionListFields(session) {
\tconst events = session.events;
\tconst length = events.length;
\tconst tail = length === 0 ? void 0 : events[length - 1];
\tconst cached = sessionListFieldsCache.get(events);
\tif (cached !== void 0 && cached.header === session.header && cached.length === length && cached.tail === tail) return cached.value;
\tconst value = sessionListFields(session.header, events);
\tsessionListFieldsCache.set(events, { header: session.header, length, tail, value });
\treturn value;
}
function summarize(session, running, projectedMetadata) {
\t/* DSH_DESKTOP_PROJECTED_SESSION_LIST_METADATA: reuse the exact live projection fold. */
\t/* DSH_DESKTOP_MEMOIZED_SESSION_LIST_FIELDS: avoid rescanning unchanged append-only logs. */
\tconst metadata = projectedMetadata ?? sessionListMetadata(session.events);
\treturn {
\t\tsessionId: session.id,
\t\tupdatedAt: sessionListUpdatedAt(session.header, metadata),
\t\trunning,
\t\tblank: metadata.blank,
\t\t...memoizedSessionListFields(session)
\t};
}`

const ATTACHED_ORIGINAL = `\t\tconst summarizeAttached = (session) => {
\t\t\tconst agent = ctx.agents.get(session.id);
\t\t\tconst projections = listProjectionsFor(ctx, session.header, session);
\t\t\treturn {
\t\t\t\t...summarize(session, agent?.status === "running"),
\t\t\t\t...projections === void 0 ? {} : { projections }
\t\t\t};
\t\t};`

const ATTACHED_PATCHED = `\t\tconst summarizeAttached = (session) => {
\t\t\tconst agent = ctx.agents.get(session.id);
\t\t\tconst projections = listProjectionsFor(ctx, session.header, session);
\t\t\treturn {
\t\t\t\t...summarize(session, agent?.status === "running", projections?.values.sessionListMetadata),
\t\t\t\t...projections === void 0 ? {} : { projections }
\t\t\t};
\t\t};`

function occurrences(source, value) {
  return source.split(value).length - 1
}

export function patchHostSessionListingSource(source) {
  const originalSummaries = occurrences(source, SUMMARIZE_ORIGINAL)
  const projectedSummaries = occurrences(source, SUMMARIZE_PROJECTED)
  const patchedSummaries = occurrences(source, SUMMARIZE_PATCHED)
  const originalAttached = occurrences(source, ATTACHED_ORIGINAL)
  const patchedAttached = occurrences(source, ATTACHED_PATCHED)

  if (patchedSummaries === 1 && patchedAttached === 1 && originalSummaries === 0 && projectedSummaries === 0 && originalAttached === 0) {
    return { source, changed: false }
  }
  const originalPair = originalSummaries === 1 && originalAttached === 1 && projectedSummaries === 0 && patchedSummaries === 0 && patchedAttached === 0
  const projectedPair = projectedSummaries === 1 && patchedAttached === 1 && originalSummaries === 0 && patchedSummaries === 0 && originalAttached === 0
  if (!originalPair && !projectedPair) {
    throw new Error('Pinned DSH host session-list metadata path changed; refusing an unsafe performance patch.')
  }
  let patched = source.replace(originalPair ? SUMMARIZE_ORIGINAL : SUMMARIZE_PROJECTED, SUMMARIZE_PATCHED)
  if (originalPair) patched = patched.replace(ATTACHED_ORIGINAL, ATTACHED_PATCHED)
  return { source: patched, changed: true }
}
