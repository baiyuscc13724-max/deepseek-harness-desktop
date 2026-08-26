'use strict'

function normalizeReleaseBody(value) {
  return String(value ?? '').replace(/\r\n?/gu, '\n')
}

function bodyWithoutOneFinalLf(value) {
  return normalizeReleaseBody(value).replace(/\n$/u, '')
}

function normalizePublisherPackagingState(state, { packagingMode = 'github-actions-only', localGatePhase = 'local-source-gates' } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Publication state must be an object.')
  if (state.packagingMode && state.packagingMode !== packagingMode) {
    throw new Error(`Publication state packaging mode mismatch: ${state.packagingMode}`)
  }
  let changed = state.schemaVersion !== 3 || state.packagingMode !== packagingMode || !state.phases || !state.releaseOrder
  state.schemaVersion = 3
  state.packagingMode = packagingMode
  state.phases ||= {}
  state.releaseOrder ||= (state.productRevision || state.phases['immutable-tag']) ? 'legacy-tag-first' : 'cloud-build-before-tag'
  const legacyLocal = Object.hasOwn(state.phases, 'local-windows')
  const incorrectlyMigratedLocal = state.phases[localGatePhase]?.migratedFrom === 'local-windows'
  if (legacyLocal || incorrectlyMigratedLocal) {
    delete state.phases['local-windows']
    // A legacy local package gate can never satisfy the new cloud-only source gate.
    // Remove both a partial migration and the already-written buggy migration shape,
    // so the publisher must delete dist and run the verify-only phase.
    delete state.phases[localGatePhase]
    changed = true
  }
  return changed
}

function matchesWorkflowRunIdentity(run, expected = {}) {
  if (!run || typeof run !== 'object') return false
  const events = Array.isArray(expected.events) ? expected.events : expected.event ? [expected.event] : []
  return (
    (!expected.workflowName || run.workflowName === expected.workflowName) &&
    (!expected.workflowPath || run.workflowPath === expected.workflowPath) &&
    (events.length === 0 || events.includes(run.event)) &&
    (!expected.headSha || run.headSha === expected.headSha) &&
    (!expected.headBranch || run.headBranch === expected.headBranch) &&
    (!expected.displayTitle || run.displayTitle === expected.displayTitle)
  )
}

function classifyCnbAssetStatuses(statuses) {
  if (!Array.isArray(statuses) || statuses.length !== 18 || statuses.some(status => !Number.isInteger(status))) {
    throw new Error('CNB asset absence requires exactly 18 bounded HTTP status observations.')
  }
  if (statuses.some(status => status >= 200 && status < 400)) return true
  if (statuses.every(status => status === 404)) return false
  throw new Error('CNB asset absence is unknown unless all exact asset URLs return 404.')
}

function selectUniqueWorkflowRunByDisplayTitle(runs, displayTitle, label = 'Workflow') {
  const matches = Array.isArray(runs) ? runs.filter(run => run?.displayTitle === displayTitle) : []
  if (matches.length === 0) return null
  if (matches.length !== 1) throw new Error(`${label} exact display title is ambiguous (${matches.length} runs).`)
  return matches[0]
}

function assertExistingTagRecoveryAllowed(state, evidence = {}) {
  const desktop = state?.phases?.['desktop-cloud-builds']
  const immutable = state?.phases?.['immutable-tag']
  const authorization = immutable?.tagAuthorization
  const sourceRevision = String(state?.sourceRevision || '').toLowerCase()
  const tagRevision = String(evidence.tagRevision || '').toLowerCase()
  const requestId = String(desktop?.requestId || '')
  const runId = Number(desktop?.runId || 0)
  const operation = String(authorization?.operation || '')
  const statusAllowsCrashRecovery = immutable?.status === 'running' || immutable?.status === 'failed'
  const operationAllowsObservedRefs = evidence.remoteTagExists
    ? operation === 'push-remote' && evidence.localTagExists === true
    : operation === 'create-local' || operation === 'push-remote'
  if (
    !statusAllowsCrashRecovery ||
    !/^[0-9a-f]{40}$/u.test(sourceRevision) ||
    tagRevision !== sourceRevision ||
    !requestId || !Number.isSafeInteger(runId) || runId < 1 ||
    authorization?.sourceRevision !== sourceRevision ||
    authorization?.requestId !== requestId ||
    Number(authorization?.runId || 0) !== runId ||
    !/^\d{4}-\d{2}-\d{2}T/u.test(String(authorization?.authorizedAt || '')) ||
    !operationAllowsObservedRefs
  ) {
    throw new Error('Existing Tag is not authorized by the publisher create/push crash window.')
  }
  return true
}

function isUncheckpointedImmutableTagFailure(phase) {
  if (!phase || typeof phase !== 'object' || Array.isArray(phase) || phase.status !== 'failed') return false
  // phase() writes only these fields before the first durable tag-authorization checkpoint.
  // Any additional field must fail closed as a possible tag-mutation crash window.
  const allowedKeys = new Set(['status', 'startedAt', 'failedAt', 'error'])
  return (
    Object.keys(phase).every(key => allowedKeys.has(key)) &&
    /^\d{4}-\d{2}-\d{2}T/u.test(String(phase.startedAt || '')) &&
    /^\d{4}-\d{2}-\d{2}T/u.test(String(phase.failedAt || '')) &&
    typeof phase.error === 'string' && phase.error.length > 0
  )
}

function assertCandidateRebindAllowed(state, evidence = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Candidate rebind requires publication state.')
  if (state.productRevision || evidence.localTagExists || evidence.remoteTagExists) throw new Error('Candidate revision cannot rebind after an immutable tag exists.')
  if (evidence.githubReleaseExists || evidence.cnbReleaseExists || evidence.stablePromoted) throw new Error('Candidate revision cannot rebind after a publication side effect exists.')
  if (evidence.oldRunTerminal !== true) throw new Error('Candidate revision cannot rebind while its previous cloud run is active or unknown.')
  if (evidence.sameVersion !== true) throw new Error('Candidate revision cannot rebind across product versions.')
  if (evidence.fastForward !== true) throw new Error('Candidate revision must advance by fast-forward.')
  const allowed = new Set(['local-source-gates', 'desktop-cloud-builds'])
  for (const [id, phase] of Object.entries(state.phases || {})) {
    if (allowed.has(id)) continue
    if (id === 'immutable-tag' && isUncheckpointedImmutableTagFailure(phase)) continue
    throw new Error('Candidate revision cannot rebind after tag-dependent phases begin.')
  }
  return true
}

async function validateCompletedPhaseEvidence(phaseState, validator) {
  if (phaseState?.status !== 'completed') return false
  if (typeof validator !== 'function') throw new Error('Completed publication phase requires fresh evidence validation.')
  await validator(phaseState)
  return true
}

function validateGithubReleaseAgainstManifest(assets, releaseAssets) {
  if (!Array.isArray(assets) || !Array.isArray(releaseAssets)) throw new Error('GitHub release validation requires signed and live asset arrays.')
  const expectedNames = assets.map(asset => asset?.name).sort()
  const liveNames = releaseAssets.map(asset => asset?.name).sort()
  if (expectedNames.length === 0 || expectedNames.length !== liveNames.length || expectedNames.some((name, index) => name !== liveNames[index])) {
    throw new Error('Live GitHub Release does not match the exact signed asset set.')
  }
  const liveByName = new Map(releaseAssets.map(asset => [asset.name, asset]))
  for (const asset of assets) {
    const live = liveByName.get(asset.name)
    if (
      live.size !== asset.size ||
      live.digest !== `sha256:${asset.sha256}` ||
      live.browser_download_url !== asset.browser_download_url
    ) {
      throw new Error(`Live GitHub Release asset drifted from the signed manifest: ${asset.name}`)
    }
  }
  return true
}

function validateCnbMirrorObservations(assets, observations) {
  if (!Array.isArray(assets) || !Array.isArray(observations)) throw new Error('CNB mirror validation requires asset and observation arrays.')
  const expectedNames = assets.map(asset => asset?.name).sort()
  const observedNames = observations.map(observation => observation?.name).sort()
  if (expectedNames.length === 0 || expectedNames.length !== observedNames.length || expectedNames.some((name, index) => name !== observedNames[index])) {
    throw new Error('CNB mirror observations do not match the exact signed asset set.')
  }
  const byName = new Map(observations.map(observation => [observation.name, observation]))
  for (const asset of assets) {
    const observation = byName.get(asset.name)
    const mirrorUrl = Array.isArray(asset.mirror_urls) ? asset.mirror_urls.find(url => String(url).startsWith('https://cnb.cool/')) : ''
    if (!mirrorUrl || observation.url !== mirrorUrl || observation.status !== 200 || observation.size !== asset.size) {
      throw new Error(`CNB mirror asset drifted: ${asset.name}`)
    }
    if (asset.name === 'SHA256SUMS.txt' && observation.sha256 !== asset.sha256) {
      throw new Error('CNB SHA256SUMS.txt digest drifted from the signed manifest.')
    }
  }
  return true
}

function isExactDetachedDraft(preferred, { productRevision, name, body, expectedAssetNames } = {}) {
  const expected = new Set(Array.isArray(expectedAssetNames) ? expectedAssetNames : [])
  const preferredNames = Array.isArray(preferred?.assets) ? preferred.assets.map(asset => asset?.name) : []
  return (
    Number.isSafeInteger(preferred?.id) &&
    preferred.draft === true &&
    /^untagged-[0-9a-f]+$/u.test(String(preferred.tag_name || '')) &&
    preferred.target_commitish === productRevision &&
    preferred.name === name &&
    preferred.prerelease === false &&
    normalizeReleaseBody(preferred.body) === normalizeReleaseBody(body) &&
    preferredNames.length > 0 &&
    preferredNames.every(assetName => expected.has(assetName))
  )
}

function canReattachPreferredDraft(preferred, claimant, identity = {}) {
  const { tag, productRevision, name, body } = identity
  const claimantNames = Array.isArray(claimant?.assets) ? claimant.assets.map(asset => asset?.name) : []
  return (
    isExactDetachedDraft(preferred, identity) &&
    Number.isSafeInteger(claimant?.id) &&
    preferred.id !== claimant.id &&
    claimant.draft === true &&
    claimant.tag_name === tag &&
    claimant.target_commitish === productRevision &&
    claimant.name === name &&
    claimant.prerelease === false &&
    claimantNames.length === 0 &&
    bodyWithoutOneFinalLf(claimant.body) === bodyWithoutOneFinalLf(body)
  )
}

function selectReleaseForTag(releases, { tag, productRevision, name, body } = {}) {
  const candidates = Array.isArray(releases)
    ? releases.filter(release => release?.tag_name === tag)
    : []
  if (candidates.length === 0) return null

  const published = candidates.filter(release => release.draft === false)
  if (published.length > 1) {
    throw new Error(`Multiple published releases exist for immutable tag ${tag}.`)
  }
  if (published.length === 1) return published[0]

  const exactDrafts = candidates.filter(release => (
    release.draft === true &&
    release.target_commitish === productRevision &&
    release.name === name &&
    normalizeReleaseBody(release.body) === normalizeReleaseBody(body)
  ))
  if (exactDrafts.length > 1) {
    throw new Error(`Multiple exact private drafts exist for immutable tag ${tag}.`)
  }
  if (exactDrafts.length === 1) return exactDrafts[0]

  // Return one candidate so the caller's existing metadata/asset checks fail closed.
  return candidates[0]
}

module.exports = {
  assertCandidateRebindAllowed,
  assertExistingTagRecoveryAllowed,
  canReattachPreferredDraft,
  classifyCnbAssetStatuses,
  isExactDetachedDraft,
  matchesWorkflowRunIdentity,
  normalizePublisherPackagingState,
  normalizeReleaseBody,
  selectReleaseForTag,
  selectUniqueWorkflowRunByDisplayTitle,
  validateCnbMirrorObservations,
  validateCompletedPhaseEvidence,
  validateGithubReleaseAgainstManifest
}
