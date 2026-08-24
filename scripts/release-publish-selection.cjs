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
  let changed = state.schemaVersion !== 2 || state.packagingMode !== packagingMode || !state.phases
  state.schemaVersion = 2
  state.packagingMode = packagingMode
  state.phases ||= {}
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
    (!expected.headBranch || run.headBranch === expected.headBranch)
  )
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
  canReattachPreferredDraft,
  isExactDetachedDraft,
  matchesWorkflowRunIdentity,
  normalizePublisherPackagingState,
  normalizeReleaseBody,
  selectReleaseForTag,
  validateCnbMirrorObservations,
  validateCompletedPhaseEvidence,
  validateGithubReleaseAgainstManifest
}
