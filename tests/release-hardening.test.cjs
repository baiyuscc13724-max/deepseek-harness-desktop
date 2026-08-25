const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('desktop candidate keeps current-package gates and disables the previous-stable cloud loop', async () => {
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8')

  assert.match(workflow, /workflow_dispatch:[\s\S]*source_revision:[\s\S]*request_id:/u)
  assert.ok(workflow.includes('group: release-candidate-${{ inputs.tag }}'))
  assert.doesNotMatch(workflow, /release-retry\/v|stage-draft:|verify-windows-draft:|^  publish:|contents: write/mu)
  assert.doesNotMatch(workflow, /gh api --method POST "repos\/\$GITHUB_REPOSITORY\/releases"|uploads\.github\.com|draft-snapshot\.json|--method PATCH/u)
  assert.match(workflow, /^  prepare-windows-candidate:\r?\n(?:    #[^\r\n]*\r?\n)*    if: \$\{\{ false \}\}$/mu)
  assert.match(workflow, /^  verify-windows-candidate:\r?\n    if: \$\{\{ false \}\}$/mu)

  for (const contract of [
    'Run packaged Windows self-test',
    'Verify packaged Windows component health and rollback',
    'Run Windows installer smoke test',
    'Current-version portable self-test failed or reported the wrong version.',
    'Current-version installed self-test failed or reported the wrong version.',
    "Filter 'unins*.exe'",
    'Windows uninstaller did not remove the temporary installation.'
  ]) assert.match(workflow, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.match(workflow, /Harness-Desktop-\$version-portable-x64\.exe/u)
  assert.match(workflow, /Harness-Desktop-\$version-win-x64\.exe/u)
})

test('release recovery binds the exact successful candidate run and publishes an unchanged byte-verified draft', async () => {
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'recover-release-from-actions.yml'), 'utf8')

  assert.match(workflow, /workflow_dispatch:[\s\S]*source_run_id:[\s\S]*source_request_id:[\s\S]*release_id:/u)
  assert.match(workflow, /permissions:\s*\r?\n\s*actions: read\s*\r?\n\s*contents: write/u)
  assert.match(workflow, /run-id: \$\{\{ inputs\.source_run_id \}\}/u)
  for (const job of ['Build windows-latest', 'Build macos-latest', 'Build ubuntu-latest', 'Validate iPhone and iPad simulators']) {
    assert.match(workflow, new RegExp(job.replaceAll(' ', '\\s'), 'u'))
  }
  assert.doesNotMatch(workflow, /Verify\sWindows\scandidate\supgrade\sand\sinstallation/u)
  assert.match(workflow, /name: Bind the signed previous stable Windows installer to an exact public asset\r?\n        if: \$\{\{ false \}\}/u)
  assert.match(workflow, /^  verify-windows-draft:\r?\n(?:    #[^\r\n]*\r?\n)*    if: \$\{\{ false \}\}$/mu)
  assert.match(workflow, /^  publish:\r?\n    name: Publish unchanged recovered draft\r?\n    needs: recover$/mu)
  assert.match(workflow, /name: recovered-draft-snapshot[\s\S]*path: \$\{\{ runner\.temp \}\}\/recovered-draft-state/u)
  assert.match(workflow, /\.head_sha == \$sha[\s\S]*\.head_branch == "main"/u)
  assert.match(workflow, /\.display_title == "Candidate \\\(\$tag\) @ \\\(\$sha\) · \\\(\$request\)"/u)
  assert.match(workflow, /Exact same-run desktop artifact set is unavailable/u)
  assert.match(workflow, /workflow_run\.id == \$run/u)
  assert.match(workflow, /Unexpected private draft assets/u)
  assert.match(workflow, /Duplicate release asset name/u)
  assert.match(workflow, /Preserving verified existing asset/u)
  assert.match(workflow, /uploads\.github\.com\/repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID\/assets\?name=\$encoded_name/u)
  assert.match(workflow, /--data-binary "@\$file"/u)
  assert.match(workflow, /releases\/assets\/\$id/u)
  assert.match(workflow, /sha256sum --strict -c SHA256SUMS\.txt/u)
  assert.match(workflow, /diff -u <\(jq -S \. draft-snapshot\.json\) <\(jq -S \. current-draft\.json\)/u)
  assert.match(workflow, /--method PATCH "repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID"[\s\S]*-F draft=false/u)
  assert.doesNotMatch(workflow, /--clobber|overwrite_files: true|softprops\/action-gh-release|npm run dist/u)
})
