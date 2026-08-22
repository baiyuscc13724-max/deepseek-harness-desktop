'use strict'

function normalizeReleaseBody(value) {
  return String(value ?? '').replace(/\r\n?/gu, '\n')
}

function bodyWithoutOneFinalLf(value) {
  return normalizeReleaseBody(value).replace(/\n$/u, '')
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

module.exports = { canReattachPreferredDraft, isExactDetachedDraft, normalizeReleaseBody, selectReleaseForTag }
