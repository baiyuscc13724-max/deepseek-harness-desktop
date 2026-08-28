const ACTION_MARKER = '@harness-desktop/timeline-reference-action-v1'

const ACTION_SOURCE = `\t\t\tactions = {
\t\t\t\tsetDraft: (text) => {
\t\t\t\t\tthis.setDraft(text);
\t\t\t\t},
\t\t\t\taddImages: (ids) => this.addImages(ids),`

const ACTION_REPLACEMENT = `\t\t\tactions = {
\t\t\t\t/* ${ACTION_MARKER} */
\t\t\t\tsetDraft: (text) => {
\t\t\t\t\tthis.setDraft(text);
\t\t\t\t},
\t\t\t\tinsertReference: (reference) => {
\t\t\t\t\tconst snapshot = this.snapshot;
\t\t\t\t\treturn this.insertReference(reference, {
\t\t\t\t\t\tstart: snapshot.draft.length,
\t\t\t\t\t\tend: snapshot.draft.length,
\t\t\t\t\t\tdraftRev: snapshot.draftRev
\t\t\t\t\t});
\t\t\t\t},
\t\t\t\taddImages: (ids) => this.addImages(ids),`

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`Pinned conversation runtime changed: missing ${label}`)
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Pinned conversation runtime changed: duplicate ${label}`)
  }
  return source.slice(0, first) + after + source.slice(first + before.length)
}

export function patchTimelineReferenceActionSource(source) {
  if (typeof source !== 'string' || source.length === 0) {
    throw new TypeError('patchTimelineReferenceActionSource requires non-empty JavaScript source')
  }
  if (source.includes(ACTION_MARKER)) return { source, changed: false }
  const output = replaceOnce(source, ACTION_SOURCE, ACTION_REPLACEMENT, 'SessionInputShell actions')
  if (!output.includes(ACTION_MARKER) || !output.includes('insertReference: (reference) =>')) {
    throw new Error('Timeline reference action patch did not install its guarded action contract')
  }
  return { source: output, changed: true }
}

export const TIMELINE_REFERENCE_ACTION_MARKER = ACTION_MARKER
