const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const YAML = require('yaml')

const root = path.resolve(__dirname, '..')

async function source(relative) {
  return readFile(path.join(root, relative), 'utf8')
}

test('CNB preview branch mirrors immutable assets before atomically promoting signed feeds', async () => {
  const text = await source('.cnb.yml')
  const pipeline = YAML.parse(text)
  const stages = pipeline['pr-preview']?.push?.[0]?.stages
  assert.ok(Array.isArray(stages))
  assert.deepEqual(stages.map(stage => stage.name), [
    'Validate signed PR preview mirror request',
    'Download and verify every immutable GitHub preview asset',
    'Upload verified PR preview assets with official plugin',
    'Read back CNB assets and atomically promote signed feeds'
  ])
  assert.equal(stages[2].image, 'cnbcool/attachments:latest')
  assert.equal(stages[2].settings.type, 'UPLOAD')
  assert.match(stages[0].script, /pr-preview-verify-feed\.mjs/)
  assert.match(stages[0].script, /readBackFromCnbBeforePromotion == true/)
  assert.match(stages[1].script, /github\.com\/baiyuscc13724-max\/deepseek-harness-desktop\/releases\/download/)
  assert.match(stages[1].script, /sha256sum/)
  assert.match(stages[3].script, /CNB read-back SHA-256 mismatch/)
  assert.match(stages[3].script, /sequence rollback refused/)
  assert.match(stages[3].script, /cp \.cnb\.yml "\$promotion\/\.cnb\.yml"[\s\S]*cp "\$promotion\/\.cnb\.yml" \.cnb\.yml/)
  assert.match(stages[3].script, /rm -f \.cnb-stable-only[\s\S]*git add -u[\s\S]*git add \.cnb\.yml \.cnb-preview-feed-only[\s\S]*git commit -m "preview: promote signed head/)
  assert.match(stages[3].script, /git\/trees/)
  assert.match(stages[3].script, /force:false/)

  const readBack = stages[3].script.indexOf('CNB read-back SHA-256 mismatch')
  const cnbPromotion = stages[3].script.indexOf('push origin HEAD:main')
  const githubPromotion = stages[3].script.indexOf("github_api='https://api.github.com")
  assert.ok(readBack >= 0 && cnbPromotion > readBack && githubPromotion > cnbPromotion)
})

test('CNB preview promotion is isolated from the stable mirror and keeps credentials out of URLs', async () => {
  const text = await source('.cnb.yml')
  const pipeline = YAML.parse(text)
  const mainStages = pipeline.main.push[0].stages
  const stableDownload = mainStages.find(stage => stage.name === 'Prepare verified GitHub release assets')
  const stableUpload = mainStages.find(stage => stage.name === 'Upload verified assets with official plugin')
  assert.match(stableDownload.if, /! -f \.cnb-preview-feed-only/)
  assert.match(stableUpload.if, /! -f \.cnb-preview-feed-only/)
  assert.match(text, /GITHUB_PR_PREVIEW_FEED_TOKEN/)
  assert.match(text, /Authorization: Bearer \$CNB_TOKEN/)
  assert.doesNotMatch(text, /https:\/\/[^\s"']*\$(?:CNB_TOKEN|GITHUB_PR_PREVIEW_FEED_TOKEN)/)
  assert.doesNotMatch(text, /component-feeds\/stable.*pr-preview|pr-preview.*component-feeds\/stable/)
})

test('cloud feed verifier fails closed until a production preview public key is provisioned', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'harness-preview-feed-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const config = path.join(temporary, 'config.json')
  const index = path.join(temporary, 'index.json')
  const manifest = path.join(temporary, 'manifest.json')
  await writeFile(config, await source('pr-preview-update-sources.json'))
  await writeFile(index, '{}')
  await writeFile(manifest, '{}')
  const { verifyPrPreviewFeedFiles } = await import('../scripts/pr-preview-verify-feed.mjs')
  await assert.rejects(() => verifyPrPreviewFeedFiles({ configFile: config, indexFile: index, manifestFile: manifest }), /生产公钥尚未配置/)
})
