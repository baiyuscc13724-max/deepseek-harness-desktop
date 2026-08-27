const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync, sign } = require('node:crypto')
const { canonicalJson, validateAndVerifyManifest, withoutSignature } = require('../electron/bridge/component-update-contract.cjs')
const { OFFICIAL_PREVIEW_REPOSITORY } = require('../electron/bridge/pr-preview-update-contract.cjs')
const { OFFICIAL_PREVIEW_INDEX_URLS } = require('../electron/bridge/pr-preview-update-config.cjs')
const {
  MAX_INSTALLED_PREVIEW_HEADS,
  MAX_PERSISTED_CANDIDATES,
  PrPreviewUpdateService,
  createMemoryPreviewState,
  normalizePreviewState,
  resolveOfficialPreviewRedirect
} = require('../electron/bridge/pr-preview-update-service.cjs')

const NOW = Date.parse('2026-08-25T10:05:00.000Z')
const SHA = 'c'.repeat(40)

function signed(value, privateKey) {
  value.signature = sign(null, Buffer.from(canonicalJson(withoutSignature(value))), privateKey).toString('base64')
  return value
}

function manifestUrls(headSha = SHA) {
  return [
    `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/git/raw/main/component-feeds/pr-preview/manifests/${headSha}.json`,
    `https://raw.githubusercontent.com/baiyuscc13724-max/deepseek-harness-desktop/main/component-feeds/pr-preview/manifests/${headSha}.json`
  ]
}

function fixture(sequence = 23) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const keyId = 'harness-preview-service-test'
  const prNumber = 42
  const title = 'Preview transaction semantics'
  const author = 'octo-contributor'
  const baseRef = 'main'
  const tag = `pr-preview-${prNumber}-${SHA.slice(0, 12)}-run-67890-1`
  const filename = `desktop-shell-1.0.41-pr.${sequence}-win32-x64.zip`
  const component = signed({
    id: 'desktop-shell', version: `1.0.41-pr.${sequence}`, kind: 'zip', target: 'shell',
    platform: 'win32', arch: 'x64', size: 321, unpackedSize: 654,
    sha256: 'd'.repeat(64), urls: [
      `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/${tag}/${filename}`,
      `https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/${tag}/${filename}`
    ],
    required: true, restart: true
  }, privateKey)
  const componentManifest = signed({
    schemaVersion: 1, releaseVersion: `1.0.41-pr.${sequence}`, channel: 'prerelease',
    publishedAt: '2026-08-25T10:01:00.000Z', keyId,
    bootstrap: { minVersion: '1.0.26' }, components: [component], notes: 'component preview'
  }, privateKey)
  const index = signed({
    schemaVersion: 1, kind: 'pr-preview-index', repository: OFFICIAL_PREVIEW_REPOSITORY,
    channel: 'pr-preview', prNumber, title, author, baseRef, headSha: SHA, sequence,
    publishedAt: '2026-08-25T10:00:00.000Z', expiresAt: '2026-08-26T10:00:00.000Z',
    keyId, manifestUrls: manifestUrls(), notes: 'automatically discovered'
  }, privateKey)
  const previewManifest = signed({
    schemaVersion: 1, kind: 'pr-preview-manifest', repository: OFFICIAL_PREVIEW_REPOSITORY,
    channel: 'pr-preview', prNumber, title, author, baseRef, headSha: SHA, sequence,
    publishedAt: '2026-08-25T10:01:00.000Z', expiresAt: '2026-08-26T10:00:00.000Z',
    keyId, componentManifest
  }, privateKey)
  return {
    privateKey, keyId, index, previewManifest,
    trustedKeys: { [keyId]: publicKey.export({ type: 'spki', format: 'pem' }) }
  }
}

function response(url, payload, status = 200, headers = {}) {
  return {
    status,
    url,
    headers: { get: name => headers[String(name).toLowerCase()] || null },
    text: async () => JSON.stringify(payload)
  }
}

test('preview discovery is default-off, accepts no PR number and performs no network request', async () => {
  let calls = 0
  const service = new PrPreviewUpdateService({ fetchImpl: async () => { calls += 1 } })
  assert.equal(PrPreviewUpdateService.prototype.discover.length, 0)
  assert.deepEqual(await service.discover(), {
    available: false,
    reason: 'disabled',
    repository: OFFICIAL_PREVIEW_REPOSITORY
  })
  assert.equal(calls, 0)
})

test('persisted candidate normalization retains exactly the newest 128 unique entries', () => {
  assert.equal(MAX_PERSISTED_CANDIDATES, 128)
  const candidates = Array.from({ length: MAX_PERSISTED_CANDIDATES + 1 }, (_, index) => ({
    id: `pr-${index.toString(16).padStart(64, '0')}`,
    provider: index % 2 ? 'github' : 'cnb',
    index: { sequence: index + 1 },
    previewManifest: { sequence: index + 1 }
  }))
  const normalized = normalizePreviewState({ candidates })
  assert.equal(normalized.candidates.length, MAX_PERSISTED_CANDIDATES)
  assert.equal(normalized.candidates[0].id, candidates[1].id)
  assert.equal(normalized.candidates.at(-1).id, candidates.at(-1).id)
  const afterRecovery = normalizePreviewState({ sequence: 64, headSha: 'f'.repeat(40), candidates })
  assert.equal(afterRecovery.candidates.length, 65)
  assert.equal(afterRecovery.candidates[0].index.sequence, 65)
  assert.equal(afterRecovery.candidates.at(-1).index.sequence, 129)

  const installedHeads = Array.from({ length: MAX_INSTALLED_PREVIEW_HEADS + 1 }, (_, index) => index.toString(16).padStart(40, '0'))
  const boundedHistory = normalizePreviewState({ installedHeads }).installedHeads
  assert.equal(boundedHistory.length, MAX_INSTALLED_PREVIEW_HEADS)
  assert.equal(boundedHistory[0], installedHeads[1])
  assert.equal(boundedHistory.at(-1), installedHeads.at(-1))
})

test('discovery falls back across both layers, persists the signed queue, and advances accepted state only after explicit accept', async () => {
  const data = fixture()
  const calls = []
  let stored = null
  const state = {
    async load() { return stored },
    async save(value) { stored = value }
  }
  const tamperedManifest = { ...data.previewManifest, headSha: 'e'.repeat(40) }
  const fetchImpl = async url => {
    calls.push(url)
    if (url === OFFICIAL_PREVIEW_INDEX_URLS[0]) return response(url, {}, 503)
    if (url === OFFICIAL_PREVIEW_INDEX_URLS[1]) return response(url, data.index)
    if (url === manifestUrls()[0]) return response(url, tamperedManifest)
    if (url === manifestUrls()[1]) return response(url, data.previewManifest)
    throw new Error(`unexpected URL ${url}`)
  }
  const service = new PrPreviewUpdateService({
    enabled: true,
    channelUrls: [...OFFICIAL_PREVIEW_INDEX_URLS],
    trustedKeys: data.trustedKeys,
    fetchImpl,
    clock: () => NOW,
    state
  })
  const result = await service.discover()
  assert.equal(result.available, true)
  assert.equal(result.provider, 'github')
  assert.equal(result.prNumber, 42)
  assert.equal(result.title, 'Preview transaction semantics')
  assert.equal(result.author, 'octo-contributor')
  assert.equal(result.baseRef, 'main')
  assert.equal(result.headSha, SHA)
  assert.equal(result.sequence, 23)
  assert.deepEqual(result.manifest, data.previewManifest.componentManifest)
  assert.doesNotThrow(() => validateAndVerifyManifest(result.manifest, data.trustedKeys, { now: NOW }))
  assert.equal(result.manifest.channel, 'prerelease')
  assert.equal(result.manifest.components[0].id, 'desktop-shell')
  assert.deepEqual(calls, [...OFFICIAL_PREVIEW_INDEX_URLS, ...manifestUrls()])
  assert.equal(stored.sequence, 0)
  assert.equal(stored.candidates.length, 1)
  assert.equal(stored.candidates[0].id, result.candidateId)
  const accepted = await service.accept(result)
  assert.equal(accepted.accepted, true)
  assert.equal(stored.sequence, 23)
  assert.equal(stored.headSha, SHA)
  assert.deepEqual(stored.installedHeads, [SHA])
  assert.deepEqual(stored.candidates, [])
})

test('discover does not hide deferred candidates; accept advances monotonic state and rejects unverified candidates', async () => {
  const data = fixture(23)
  let currentIndex = data.index
  const state = createMemoryPreviewState()
  const fetchImpl = async url => {
    if (OFFICIAL_PREVIEW_INDEX_URLS.includes(url)) return response(url, currentIndex)
    return response(url, data.previewManifest)
  }
  const service = new PrPreviewUpdateService({ enabled: true, trustedKeys: data.trustedKeys, fetchImpl, clock: () => NOW, state })
  const first = await service.discover()
  assert.equal(first.available, true)
  assert.equal((await service.discover()).available, true)
  await assert.rejects(() => service.accept({ sequence: 24, headSha: 'f'.repeat(40) }), /候选 id 无效|未经本服务验证/)
  assert.equal((await service.accept(first)).accepted, true)
  const duplicate = await service.discover()
  assert.equal(duplicate.available, false)
  assert.equal(duplicate.reason, 'already-installed')

  currentIndex = signed({ ...data.index, sequence: 24 }, data.privateKey)
  const resignedSameHead = await service.discover()
  assert.equal(resignedSameHead.available, false)
  assert.equal(resignedSameHead.reason, 'already-installed')
  assert.equal(resignedSameHead.sequence, 24)
  assert.deepEqual(await state.load(), {
    sequence: 24,
    headSha: SHA,
    installedHeads: [SHA],
    candidates: []
  })

  currentIndex = { ...data.index, sequence: 22 }
  signed(currentIndex, data.privateKey)
  await assert.rejects(() => service.discover(), /sequence 回退.*拒绝重放/)
})

test('newer latest entries append without hiding deferred signed candidates and each id is reverified', async () => {
  const data = fixture(23)
  let stored = null
  let currentIndex = data.index
  let currentManifest = data.previewManifest
  const state = {
    async load() { return stored },
    async save(value) { stored = JSON.parse(JSON.stringify(value)) }
  }
  const fetchImpl = async url => OFFICIAL_PREVIEW_INDEX_URLS.includes(url)
    ? response(url, currentIndex)
    : response(url, currentManifest)
  const service = new PrPreviewUpdateService({ enabled: true, trustedKeys: data.trustedKeys, fetchImpl, clock: () => NOW, state })
  const first = await service.discover()

  const nextSha = 'e'.repeat(40)
  const previousTag = `pr-preview-42-${SHA.slice(0, 12)}-run-67890-1`
  const nextTag = `pr-preview-42-${nextSha.slice(0, 12)}-run-67890-1`
  const previousComponent = data.previewManifest.componentManifest.components[0]
  const component = signed({
    ...previousComponent,
    version: '1.0.41-pr.24',
    urls: previousComponent.urls.map(url => url.replace(previousTag, nextTag))
  }, data.privateKey)
  const componentManifest = signed({
    ...data.previewManifest.componentManifest,
    releaseVersion: '1.0.41-pr.24',
    components: [component]
  }, data.privateKey)
  currentIndex = signed({ ...data.index, sequence: 24, headSha: nextSha, manifestUrls: manifestUrls(nextSha) }, data.privateKey)
  currentManifest = signed({ ...data.previewManifest, sequence: 24, headSha: nextSha, componentManifest }, data.privateKey)
  const second = await service.discover()
  const queued = await service.listCandidates()
  assert.deepEqual(queued.map(value => value.sequence), [23, 24])
  assert.notEqual(first.candidateId, second.candidateId)
  assert.equal((await service.verifyCandidate(first.candidateId)).sequence, 23)
  assert.equal((await service.accept(first.candidateId)).accepted, true)
  assert.deepEqual((await service.listCandidates()).map(value => value.sequence), [24])
})

test('expired or tampered persisted candidates remain non-actionable and cannot be accepted', async () => {
  const data = fixture(23)
  let stored = null
  let now = NOW
  const state = {
    async load() { return stored },
    async save(value) { stored = JSON.parse(JSON.stringify(value)) }
  }
  const fetchImpl = async url => OFFICIAL_PREVIEW_INDEX_URLS.includes(url)
    ? response(url, data.index)
    : response(url, data.previewManifest)
  const service = new PrPreviewUpdateService({ enabled: true, trustedKeys: data.trustedKeys, fetchImpl, clock: () => now, state })
  const candidate = await service.discover()
  now = Date.parse('2026-08-27T10:00:00.000Z')
  const listed = await service.listCandidates()
  assert.equal(listed[0].expired, true)
  await assert.rejects(() => service.accept(candidate.candidateId), /已过期/)
  stored.candidates[0].previewManifest.componentManifest.components[0].sha256 = 'e'.repeat(64)
  assert.deepEqual(await service.listCandidates(), [])
  await assert.rejects(() => service.verifyCandidate(candidate.candidateId), /id 与签名载荷不一致|签名校验失败/)
  now = NOW
  const recovered = await service.discover()
  assert.equal(recovered.candidateId, candidate.candidateId)
  assert.equal((await service.listCandidates()).length, 1)
})

test('state loads before source selection and stale or conflicting CNB indexes fall back to newer GitHub', async () => {
  const data = fixture(23)
  const older = { ...data.index, sequence: 21 }
  signed(older, data.privateKey)
  const conflictSha = 'e'.repeat(40)
  const conflict = { ...data.index, sequence: 22, headSha: conflictSha, manifestUrls: manifestUrls(conflictSha) }
  signed(conflict, data.privateKey)

  for (const cnbIndex of [older, conflict]) {
    const events = []
    let saved = null
    const state = {
      async load() { events.push('load'); return saved || { sequence: 22, headSha: 'f'.repeat(40) } },
      async save(value) { events.push('save'); saved = value }
    }
    const fetchImpl = async url => {
      events.push(url)
      if (url === OFFICIAL_PREVIEW_INDEX_URLS[0]) return response(url, cnbIndex)
      if (url === OFFICIAL_PREVIEW_INDEX_URLS[1]) return response(url, data.index)
      return response(url, data.previewManifest)
    }
    const service = new PrPreviewUpdateService({ enabled: true, trustedKeys: data.trustedKeys, fetchImpl, clock: () => NOW, state })
    const result = await service.discover()
    assert.equal(events[0], 'load')
    assert.equal(result.available, true)
    assert.equal(result.indexSource, OFFICIAL_PREVIEW_INDEX_URLS[1])
    assert.equal(result.sequence, 23)
  }
})

test('redirect policy permits only the same fixed official provider and exact signed path', () => {
  const from = OFFICIAL_PREVIEW_INDEX_URLS[0]
  assert.equal(resolveOfficialPreviewRedirect(from, from, { kind: 'index' }), from)
  assert.throws(() => resolveOfficialPreviewRedirect(from, 'https://evil.example/latest.json', { kind: 'index' }), /主机不受信任/)
  assert.throws(() => resolveOfficialPreviewRedirect(from, OFFICIAL_PREVIEW_INDEX_URLS[1], { kind: 'index' }), /跨来源/)
  assert.throws(() => resolveOfficialPreviewRedirect(from, '/other/latest.json', { kind: 'index' }), /固定官方仓库路径/)
})
