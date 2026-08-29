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

const SUMMARIZE_PATCHED = `function summarize(session, running, projectedMetadata) {
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
  const patchedSummaries = occurrences(source, SUMMARIZE_PATCHED)
  const originalAttached = occurrences(source, ATTACHED_ORIGINAL)
  const patchedAttached = occurrences(source, ATTACHED_PATCHED)

  if (patchedSummaries === 1 && patchedAttached === 1 && originalSummaries === 0 && originalAttached === 0) {
    return { source, changed: false }
  }
  if (originalSummaries !== 1 || originalAttached !== 1 || patchedSummaries !== 0 || patchedAttached !== 0) {
    throw new Error('Pinned DSH host session-list metadata path changed; refusing an unsafe performance patch.')
  }
  return {
    source: source.replace(SUMMARIZE_ORIGINAL, SUMMARIZE_PATCHED).replace(ATTACHED_ORIGINAL, ATTACHED_PATCHED),
    changed: true
  }
}
