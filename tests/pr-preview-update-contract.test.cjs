const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { generateKeyPairSync, sign } = require('node:crypto')
const { canonicalJson, withoutSignature } = require('../electron/bridge/component-update-contract.cjs')
const {
  OFFICIAL_PREVIEW_REPOSITORY,
  assertIndexMatchesManifest,
  validateAndVerifyPreviewIndex,
  validateAndVerifyPreviewManifest
} = require('../electron/bridge/pr-preview-update-contract.cjs')
const {
  OFFICIAL_PREVIEW_INDEX_URLS,
  PREVIEW_SOURCES_FILENAME,
  normalizeOfficialManifestUrls,
  normalizePrPreviewUpdateConfig,
  previewConfigCandidateFiles,
  resolvePrPreviewUpdateConfig,
  safeOfficialPreviewUrl
} = require('../electron/bridge/pr-preview-update-config.cjs')

const NOW = Date.parse('2026-08-25T10:05:00.000Z')
const SHA = 'a'.repeat(40)

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

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const keyId = 'harness-preview-2026-test'
  const prNumber = 42
  const title = 'Add a safer preview update path'
  const author = 'octo-contributor'
  const baseRef = 'main'
  const tag = `pr-preview-${prNumber}-${SHA.slice(0, 12)}-run-12345-1`
  const filename = 'desktop-shell-1.0.41-pr.17-win32-x64.zip'
  const component = signed({
    id: 'desktop-shell', version: '1.0.41-pr.17', kind: 'zip', target: 'shell',
    platform: 'win32', arch: 'x64', size: 100, unpackedSize: 200,
    sha256: 'b'.repeat(64),
    urls: [
      `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/${tag}/${filename}`,
      `https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/${tag}/${filename}`
    ],
    required: true, restart: true
  }, privateKey)
  const componentManifest = signed({
    schemaVersion: 1, releaseVersion: '1.0.41-pr.17', channel: 'prerelease',
    publishedAt: '2026-08-25T10:01:00.000Z', keyId,
    bootstrap: { minVersion: '1.0.26' }, components: [component], notes: 'verified component preview'
  }, privateKey)
  const index = signed({
    schemaVersion: 1, kind: 'pr-preview-index', repository: OFFICIAL_PREVIEW_REPOSITORY,
    channel: 'pr-preview', prNumber, title, author, baseRef, headSha: SHA, sequence: 17,
    publishedAt: '2026-08-25T10:00:00.000Z', expiresAt: '2026-08-26T10:00:00.000Z',
    keyId, manifestUrls: manifestUrls(), notes: 'approved preview'
  }, privateKey)
  const previewManifest = signed({
    schemaVersion: 1, kind: 'pr-preview-manifest', repository: OFFICIAL_PREVIEW_REPOSITORY,
    channel: 'pr-preview', prNumber, title, author, baseRef, headSha: SHA, sequence: 17,
    publishedAt: '2026-08-25T10:01:00.000Z', expiresAt: '2026-08-26T10:00:00.000Z',
    keyId, componentManifest
  }, privateKey)
  return {
    privateKey, publicKey, keyId, index, previewManifest,
    trustedKeys: { [keyId]: publicKey.export({ type: 'spki', format: 'pem' }) }
  }
}

function verifyIndex(index, trustedKeys) {
  return validateAndVerifyPreviewIndex(index, trustedKeys, { now: NOW, normalizeManifestUrls: normalizeOfficialManifestUrls })
}

function previewCandidatePath(root) {
  return path.resolve(path.join(root, PREVIEW_SOURCES_FILENAME))
}

function previewFixtureRoots() {
  const base = path.resolve(__dirname, 'fixtures', 'preview-roots')
  return {
    resources: path.resolve(base, 'resources'),
    shell: path.resolve(base, 'shell'),
    app: path.resolve(base, 'app'),
    packaged: path.resolve(base, 'packaged')
  }
}

function missingFile() {
  return Object.assign(new Error('missing'), { code: 'ENOENT' })
}

function previewSourceJson(state) {
  return JSON.stringify({
    enabled: true,
    repository: OFFICIAL_PREVIEW_REPOSITORY,
    channelUrls: [...OFFICIAL_PREVIEW_INDEX_URLS],
    trustedKeys: state.trustedKeys
  })
}

test('preview config is default-off and accepts the packaged channelUrls/trustedKeys schema without losing order', () => {
  assert.deepEqual(normalizePrPreviewUpdateConfig({
    enabled: false,
    repository: OFFICIAL_PREVIEW_REPOSITORY,
    channelUrls: [...OFFICIAL_PREVIEW_INDEX_URLS],
    trustedKeys: {}
  }), {
    enabled: false,
    repository: OFFICIAL_PREVIEW_REPOSITORY,
    channelUrls: [...OFFICIAL_PREVIEW_INDEX_URLS],
    indexUrls: [...OFFICIAL_PREVIEW_INDEX_URLS],
    trustedKeys: {}
  })
  const state = fixture()
  assert.throws(() => normalizePrPreviewUpdateConfig({
    enabled: true,
    channelUrls: [...OFFICIAL_PREVIEW_INDEX_URLS],
    trustedKeys: { 'release-2026': state.trustedKeys[state.keyId] }
  }), /独立/)
  const enabled = normalizePrPreviewUpdateConfig({
    enabled: true,
    repository: OFFICIAL_PREVIEW_REPOSITORY,
    channelUrls: [...OFFICIAL_PREVIEW_INDEX_URLS],
    trustedKeys: state.trustedKeys
  })
  assert.equal(enabled.enabled, true)
  assert.deepEqual(enabled.channelUrls, [...OFFICIAL_PREVIEW_INDEX_URLS])
  assert.deepEqual(enabled.indexUrls, [...OFFICIAL_PREVIEW_INDEX_URLS])
  assert.deepEqual(Object.keys(enabled.trustedKeys), [state.keyId])
  assert.throws(() => normalizePrPreviewUpdateConfig({
    enabled: false,
    repository: 'other/repository',
    channelUrls: [...OFFICIAL_PREVIEW_INDEX_URLS],
    trustedKeys: {}
  }), /固定官方仓库/)
  assert.throws(() => normalizePrPreviewUpdateConfig({ enabled: false, trustedKeys: {}, token: 'forbidden' }), /未知字段/)
})

test('packaged preview config resolver prefers resources and reads the fixed filename', async () => {
  const state = fixture()
  const reads = []
  const resolved = await resolvePrPreviewUpdateConfig({
    resourcesPath: 'C:\\Resources',
    appRoot: 'C:\\App',
    readFileImpl: async file => {
      reads.push(file)
      if (!file.includes('Resources')) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return JSON.stringify({
        enabled: true,
        repository: OFFICIAL_PREVIEW_REPOSITORY,
        channelUrls: [...OFFICIAL_PREVIEW_INDEX_URLS],
        trustedKeys: state.trustedKeys
      })
    }
  })
  assert.equal(resolved.enabled, true)
  assert.equal(reads.length, 1)
  assert.match(reads[0], /pr-preview-update-sources\.json$/)
  assert.match(resolved.source, /Resources/)
})

test('preview config candidate list keeps resourcesPath → shellRoot → appRoot → packagedAppRoot priority and dedupes repeated paths', () => {
  const roots = previewFixtureRoots()
  const files = previewConfigCandidateFiles({
    resourcesPath: roots.resources,
    shellRoot: roots.shell,
    appRoot: roots.app,
    packagedAppRoot: roots.packaged
  })
  assert.deepEqual(files, [
    previewCandidatePath(roots.resources),
    previewCandidatePath(roots.shell),
    previewCandidatePath(roots.app),
    previewCandidatePath(roots.packaged)
  ])

  const shared = previewConfigCandidateFiles({
    resourcesPath: roots.packaged,
    shellRoot: roots.packaged,
    appRoot: roots.packaged,
    packagedAppRoot: roots.packaged
  })
  assert.deepEqual(shared, [previewCandidatePath(roots.packaged)])
})

test('preview config resolver falls back shellRoot → appRoot → packagedAppRoot and reads each candidate once', async () => {
  const roots = previewFixtureRoots()
  const encode = previewSourceJson(fixture())
  const candidates = {
    resources: previewCandidatePath(roots.resources),
    shell: previewCandidatePath(roots.shell),
    app: previewCandidatePath(roots.app),
    packaged: previewCandidatePath(roots.packaged)
  }
  const missing = missingFile()

  const reads = []
  const viaShell = await resolvePrPreviewUpdateConfig({
    resourcesPath: roots.resources,
    shellRoot: roots.shell,
    appRoot: roots.app,
    packagedAppRoot: roots.packaged,
    readFileImpl: async file => {
      reads.push(file)
      if (file === candidates.shell) return encode
      throw missing
    }
  })
  assert.equal(viaShell.enabled, true)
  assert.deepEqual(reads, [candidates.resources, candidates.shell])
  assert.equal(viaShell.source, candidates.shell)

  reads.length = 0
  const viaApp = await resolvePrPreviewUpdateConfig({
    resourcesPath: roots.resources,
    shellRoot: roots.shell,
    appRoot: roots.app,
    packagedAppRoot: roots.packaged,
    readFileImpl: async file => {
      reads.push(file)
      if (file === candidates.app) return encode
      throw missing
    }
  })
  assert.equal(viaApp.enabled, true)
  assert.deepEqual(reads, [candidates.resources, candidates.shell, candidates.app])
  assert.equal(viaApp.source, candidates.app)

  reads.length = 0
  const viaPackaged = await resolvePrPreviewUpdateConfig({
    resourcesPath: roots.resources,
    shellRoot: roots.shell,
    appRoot: roots.app,
    packagedAppRoot: roots.packaged,
    readFileImpl: async file => {
      reads.push(file)
      if (file === candidates.packaged) return encode
      throw missing
    }
  })
  assert.equal(viaPackaged.enabled, true)
  assert.deepEqual(reads, [candidates.resources, candidates.shell, candidates.app, candidates.packaged])
  assert.equal(viaPackaged.source, candidates.packaged)
})

test('preview config resolver supports the committed three-parameter contract without appRoot', async () => {
  const roots = previewFixtureRoots()
  const encode = previewSourceJson(fixture())
  const candidates = {
    resources: previewCandidatePath(roots.resources),
    shell: previewCandidatePath(roots.shell),
    packaged: previewCandidatePath(roots.packaged)
  }
  const missing = missingFile()

  const reads = []
  const viaShell = await resolvePrPreviewUpdateConfig({
    resourcesPath: roots.resources,
    shellRoot: roots.shell,
    packagedAppRoot: roots.packaged,
    readFileImpl: async file => {
      reads.push(file)
      if (file === candidates.shell) return encode
      throw missing
    }
  })
  assert.equal(viaShell.enabled, true)
  assert.deepEqual(reads, [candidates.resources, candidates.shell])
  assert.equal(viaShell.source, candidates.shell)

  reads.length = 0
  const viaPackaged = await resolvePrPreviewUpdateConfig({
    resourcesPath: roots.resources,
    shellRoot: roots.shell,
    packagedAppRoot: roots.packaged,
    readFileImpl: async file => {
      reads.push(file)
      if (file === candidates.packaged) return encode
      throw missing
    }
  })
  assert.equal(viaPackaged.enabled, true)
  assert.deepEqual(reads, [candidates.resources, candidates.shell, candidates.packaged])
  assert.equal(viaPackaged.source, candidates.packaged)
})

test('preview config resolver returns default-off when every candidate file is absent', async () => {
  const roots = previewFixtureRoots()
  const candidates = [
    previewCandidatePath(roots.resources),
    previewCandidatePath(roots.shell),
    previewCandidatePath(roots.app),
    previewCandidatePath(roots.packaged)
  ]
  const reads = []
  const resolved = await resolvePrPreviewUpdateConfig({
    resourcesPath: roots.resources,
    shellRoot: roots.shell,
    appRoot: roots.app,
    packagedAppRoot: roots.packaged,
    readFileImpl: async file => {
      reads.push(file)
      throw missingFile()
    }
  })
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.source, '')
  assert.deepEqual(resolved.channelUrls, [...OFFICIAL_PREVIEW_INDEX_URLS])
  assert.deepEqual(reads, candidates)
})

test('preview config resolver fails on an invalid existing config instead of skipping to the next candidate', async () => {
  const roots = previewFixtureRoots()
  const candidates = {
    resources: previewCandidatePath(roots.resources),
    shell: previewCandidatePath(roots.shell),
    app: previewCandidatePath(roots.app),
    packaged: previewCandidatePath(roots.packaged)
  }
  const valid = previewSourceJson(fixture())
  const invalidContents = [
    ['malformed json', '{ not json'],
    ['json null', 'null'],
    ['json array', '[]'],
    ['schema violation', JSON.stringify({ enabled: false, token: 'forbidden' })]
  ]
  for (const [name, content] of invalidContents) {
    const reads = []
    await assert.rejects(
      resolvePrPreviewUpdateConfig({
        resourcesPath: roots.resources,
        shellRoot: roots.shell,
        appRoot: roots.app,
        packagedAppRoot: roots.packaged,
        readFileImpl: async file => {
          reads.push(file)
          if (file === candidates.resources) return content
          return valid
        }
      }),
      /配置/,
      `${name} must fail loudly`
    )
    assert.deepEqual(reads, [candidates.resources], `${name} must not fall through to lower-priority candidates`)
  }

  const lowerTierReads = []
  await assert.rejects(
    resolvePrPreviewUpdateConfig({
      resourcesPath: roots.resources,
      shellRoot: roots.shell,
      appRoot: roots.app,
      packagedAppRoot: roots.packaged,
      readFileImpl: async file => {
        lowerTierReads.push(file)
        if (file === candidates.packaged) return 'null'
        throw missingFile()
      }
    }),
    /不是有效 JSON 对象/
  )
  assert.deepEqual(lowerTierReads, [
    candidates.resources,
    candidates.shell,
    candidates.app,
    candidates.packaged
  ])
})

test('signed index and preview manifest bind official repository, PR metadata, full SHA, sequence, expiry and component manifest', () => {
  const state = fixture()
  const index = verifyIndex(state.index, state.trustedKeys)
  const preview = validateAndVerifyPreviewManifest(state.previewManifest, state.trustedKeys, { now: NOW })
  assert.equal(assertIndexMatchesManifest(index, preview), true)
  assert.equal(index.prNumber, 42)
  assert.equal(index.title, 'Add a safer preview update path')
  assert.equal(index.author, 'octo-contributor')
  assert.equal(index.baseRef, 'main')
  assert.equal(index.headSha.length, 40)
  assert.equal(index.sequence, 17)
  assert.equal(preview.componentManifest.channel, 'prerelease')
  assert.equal(preview.componentManifest.keyId, state.keyId)
})

test('preview trust contract rejects tampering, short SHA, stale data and sequence collisions', () => {
  const tampered = fixture()
  tampered.index.notes = 'unsigned change'
  assert.throws(() => verifyIndex(tampered.index, tampered.trustedKeys), /签名校验失败/)

  const short = fixture()
  short.index.headSha = 'a'.repeat(12)
  signed(short.index, short.privateKey)
  assert.throws(() => verifyIndex(short.index, short.trustedKeys), /完整 40 位/)

  const stale = fixture()
  stale.index.expiresAt = '2026-08-25T10:04:59.000Z'
  signed(stale.index, stale.privateKey)
  assert.throws(() => verifyIndex(stale.index, stale.trustedKeys), /已过期/)

  const mismatch = fixture()
  mismatch.previewManifest.sequence = 18
  signed(mismatch.previewManifest, mismatch.privateKey)
  const index = verifyIndex(mismatch.index, mismatch.trustedKeys)
  const preview = validateAndVerifyPreviewManifest(mismatch.previewManifest, mismatch.trustedKeys, { now: NOW })
  assert.throws(() => assertIndexMatchesManifest(index, preview), /sequence 不一致/)
})

test('signed PR metadata requires a positive number, bounded display fields and main base', () => {
  const invalidNumber = fixture()
  invalidNumber.index.prNumber = 0
  signed(invalidNumber.index, invalidNumber.privateKey)
  assert.throws(() => verifyIndex(invalidNumber.index, invalidNumber.trustedKeys), /prNumber 必须是正安全整数/)

  const state = fixture()
  state.index.baseRef = 'develop'
  signed(state.index, state.privateKey)
  assert.throws(() => verifyIndex(state.index, state.trustedKeys), /baseRef 必须是 main/)

  const invalidAuthor = fixture()
  invalidAuthor.index.author = 'bad--login'
  signed(invalidAuthor.index, invalidAuthor.privateKey)
  assert.throws(() => verifyIndex(invalidAuthor.index, invalidAuthor.trustedKeys), /GitHub login/)

  const longTitle = fixture()
  longTitle.index.title = 'x'.repeat(201)
  signed(longTitle.index, longTitle.privateKey)
  assert.throws(() => verifyIndex(longTitle.index, longTitle.trustedKeys), /title 无效或过长/)
})

test('every signed component is restricted to matching official CNB-first and GitHub-second release assets', () => {
  const state = fixture()
  const component = state.previewManifest.componentManifest.components[0]
  component.urls = ['https://downloads.example/preview.zip', component.urls[1]]
  signed(component, state.privateKey)
  signed(state.previewManifest.componentManifest, state.privateKey)
  signed(state.previewManifest, state.privateKey)
  assert.throws(
    () => validateAndVerifyPreviewManifest(state.previewManifest, state.trustedKeys, { now: NOW }),
    /固定官方仓库/
  )

  const reversed = fixture()
  reversed.previewManifest.componentManifest.components[0].urls.reverse()
  signed(reversed.previewManifest.componentManifest.components[0], reversed.privateKey)
  signed(reversed.previewManifest.componentManifest, reversed.privateKey)
  signed(reversed.previewManifest, reversed.privateKey)
  assert.throws(
    () => validateAndVerifyPreviewManifest(reversed.previewManifest, reversed.trustedKeys, { now: NOW }),
    /固定官方仓库/
  )
})

test('official URL policy rejects alternate repositories, hosts, queries and wrong source order', () => {
  assert.throws(() => safeOfficialPreviewUrl('https://evil.example/latest.json', { kind: 'index' }), /主机不受信任/)
  assert.throws(() => safeOfficialPreviewUrl('https://raw.githubusercontent.com/other/repo/main/component-feeds/pr-preview/latest.json', { kind: 'index' }), /固定官方仓库路径/)
  assert.throws(() => safeOfficialPreviewUrl(`${OFFICIAL_PREVIEW_INDEX_URLS[0]}?token=x`, { kind: 'index' }), /无查询/)
  assert.throws(() => normalizeOfficialManifestUrls(manifestUrls().reverse(), SHA), /CNB 优先/)
})
