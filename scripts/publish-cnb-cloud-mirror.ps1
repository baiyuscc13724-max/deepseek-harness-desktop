param(
  [string]$Remote = 'cnb',
  [int]$WaitMinutes = 20
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw "git failed: git $($Arguments -join ' ')" }
}

function Invoke-CnbJson {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $output = & npx.cmd --yes '@cnbcool/cnb-cli' @Arguments
  if ($LASTEXITCODE -ne 0) { throw "CNB CLI failed: $($Arguments -join ' ')" }
  return (($output -join "`n") | ConvertFrom-Json)
}

$package = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest = @(Get-Content -LiteralPath 'release-manifest.json' -Raw -Encoding UTF8 | ConvertFrom-Json)
if ($manifest.Count -ne 1) { throw 'release-manifest.json must contain exactly one release.' }
$release = $manifest[0]
$expectedTag = "v$($package.version)"
if ($release.tag_name -ne $expectedTag) { throw "Manifest tag $($release.tag_name) does not match package version $expectedTag." }

$assetNames = @(
  "Harness-Desktop-$($package.version)-win-x64.exe",
  "Harness-Desktop-$($package.version)-portable-x64.exe",
  "Harness-Desktop-$($package.version)-mac-arm64.dmg",
  "Harness-Desktop-$($package.version)-mac-arm64.zip",
  "Harness-Desktop-$($package.version)-mac-x64.dmg",
  "Harness-Desktop-$($package.version)-mac-x64.zip",
  "Harness-Mobile-$($package.version)-android-universal.apk",
  'SHA256SUMS.txt'
)
$manifestNames = @($release.assets | ForEach-Object { $_.name })
if (@(Compare-Object ($assetNames | Sort-Object) ($manifestNames | Sort-Object)).Count -ne 0) {
  throw 'The CNB cloud mirror accepts only the reviewed Windows, macOS, signed Android, and SHA256SUMS.txt assets.'
}
if (-not (Test-Path -LiteralPath 'dist/SHA256SUMS.txt')) { throw 'Missing audited release file: dist/SHA256SUMS.txt' }
foreach ($asset in $release.assets) {
  if ($asset.browser_download_url -notlike 'https://github.com/*') { throw "Untrusted GitHub source URL for $($asset.name)" }
  $sourceResponse = Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -Method Head -MaximumRedirection 8 -TimeoutSec 90
  $sourceRawLength = @($sourceResponse.Headers['Content-Length'])[0]
  $sourceLength = if ($sourceRawLength) { [long]$sourceRawLength } else { [long]$sourceResponse.RawContentLength }
  if ($sourceResponse.StatusCode -ne 200 -or $sourceLength -ne [long]$asset.size) {
    throw "GitHub source verification failed for $($asset.name): status=$($sourceResponse.StatusCode), size=$sourceLength"
  }
}

$mirrorFiles = @('.cnb.yml', 'CHANGELOG.md', 'LICENSE', 'README.md', 'release-manifest.json', 'release-notes.md')
foreach ($file in $mirrorFiles) {
  if (-not (Test-Path -LiteralPath $file)) { throw "Missing CNB mirror source file: $file" }
  & git diff --quiet HEAD -- $file
  if ($LASTEXITCODE -ne 0) { throw "Commit $file before publishing the CNB mirror." }
}

$remoteUrl = (& git remote get-url $Remote).Trim()
if ($LASTEXITCODE -ne 0 -or $remoteUrl -notmatch '^https://cnb\.cool/') { throw "Remote '$Remote' must be an HTTPS CNB repository." }
$repoSlug = ($remoteUrl -replace '^https://cnb\.cool/', '' -replace '\.git$', '')
if (-not $repoSlug) { throw "Unable to derive the CNB repository slug from $remoteUrl" }
Invoke-Git fetch $Remote main

$index = Join-Path $env:TEMP ("cnb-cloud-index-" + [guid]::NewGuid().ToString('N'))
$previousIndex = $env:GIT_INDEX_FILE
$env:GIT_INDEX_FILE = $index
try {
  Invoke-Git read-tree --empty
  foreach ($file in $mirrorFiles) {
    $blob = (& git hash-object -w $file).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Unable to hash $file" }
    Invoke-Git update-index --add --cacheinfo "100644,$blob,$file"
  }
  $checksumBlob = (& git hash-object -w 'dist/SHA256SUMS.txt').Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to hash dist/SHA256SUMS.txt' }
  Invoke-Git update-index --add --cacheinfo "100644,$checksumBlob,SHA256SUMS.txt"
  $tree = (& git write-tree).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to write CNB mirror tree.' }
  $commit = ("release: trigger CNB cloud mirror $expectedTag" | git commit-tree $tree -p "$Remote/main").Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create CNB mirror commit.' }
} finally {
  if ($null -eq $previousIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
  else { $env:GIT_INDEX_FILE = $previousIndex }
  Remove-Item -LiteralPath $index -Force -ErrorAction SilentlyContinue
}

$branch = "cnb-cloud-release-$($package.version)"
Invoke-Git update-ref "refs/heads/$branch" $commit
& git -c 'credential.helper=' -c 'credential.helper=!npx.cmd --yes @cnbcool/cnb-cli git-credential' push $Remote "refs/heads/$branch`:refs/heads/main"
if ($LASTEXITCODE -ne 0) { throw 'Unable to push the lightweight CNB mirror commit.' }
Write-Host "CNB metadata pushed: $commit"
Write-Host 'Release binaries remain on GitHub; CNB Runner will mirror them in the cloud.'

$build = $null
$discoveryDeadline = (Get-Date).AddMinutes(2)
do {
  Start-Sleep -Seconds 5
  $list = Invoke-CnbJson build get-build-logs --repo $repoSlug --sha $commit --page 1 --page-size 5 --verbose
  $build = @($list.data.data | Where-Object { $_.sha -eq $commit } | Select-Object -First 1)[0]
} while ($null -eq $build -and (Get-Date) -lt $discoveryDeadline)
if ($null -eq $build) { throw 'CNB did not start the cloud mirror pipeline within two minutes.' }
Write-Host "CNB cloud build: $($build.buildLogUrl)"

$deadline = (Get-Date).AddMinutes($WaitMinutes)
do {
  $statusResult = Invoke-CnbJson build get-build-status --repo $repoSlug --sn $build.sn --verbose
  $status = [string]$statusResult.data.status
  Write-Host "CNB cloud status: $status"
  if ($status -eq 'success') { break }
  if ($status -in @('error', 'cancel', 'failed')) { throw "CNB cloud mirror failed: $($build.buildLogUrl)" }
  Start-Sleep -Seconds 10
} while ((Get-Date) -lt $deadline)
if ($status -ne 'success') { throw "CNB cloud mirror timed out: $($build.buildLogUrl)" }

foreach ($asset in $release.assets) {
  $url = @($asset.mirror_urls | Where-Object { $_ -like 'https://cnb.cool/*' } | Select-Object -First 1)[0]
  if (-not $url) { throw "CNB mirror URL missing for $($asset.name)" }
  $response = Invoke-WebRequest -UseBasicParsing -Uri $url -Method Head -MaximumRedirection 8 -TimeoutSec 90
  $rawLength = @($response.Headers['Content-Length'])[0]
  $length = if ($rawLength) { [long]$rawLength } else { [long]$response.RawContentLength }
  if ($response.StatusCode -ne 200 -or $length -ne [long]$asset.size) {
    throw "CNB asset verification failed for $($asset.name): status=$($response.StatusCode), size=$length"
  }
  Write-Host "CNB asset verified: $($asset.name) ($length bytes)"
}

$checksumAsset = $release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1
$checksumUrl = @($checksumAsset.mirror_urls | Where-Object { $_ -like 'https://cnb.cool/*' } | Select-Object -First 1)[0]
$download = Invoke-WebRequest -UseBasicParsing -Uri $checksumUrl -TimeoutSec 60
$remoteChecksum = if ($download.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($download.Content) } else { [string]$download.Content }
$localChecksum = Get-Content -LiteralPath 'dist/SHA256SUMS.txt' -Raw
if ($remoteChecksum.Trim() -ne $localChecksum.Trim()) { throw 'CNB SHA256SUMS.txt does not match the audited local checksum file.' }

Write-Host "CNB cloud mirror complete: https://cnb.cool/$repoSlug/-/releases/tag/$expectedTag"
