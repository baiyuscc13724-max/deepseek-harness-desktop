param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [string]$Remote = 'cnb',
  [int]$WaitMinutes = 20
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$GitExecutable = if ($env:HARNESS_RELEASE_GIT) { $env:HARNESS_RELEASE_GIT } else { 'git' }
$ExpectedRepo = 'baiyuscc13724-max/deepseek-harness-desktop'
$ExpectedRemoteUrl = "https://cnb.cool/$ExpectedRepo.git"
if ($GitExecutable -ne 'git' -and -not (Test-Path -LiteralPath $GitExecutable -PathType Leaf)) {
  throw "HARNESS_RELEASE_GIT does not exist: $GitExecutable"
}

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & $script:GitExecutable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "git failed: $script:GitExecutable $($Arguments -join ' ')" }
}

function Invoke-CnbJson {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $output = & npx.cmd --yes '@cnbcool/cnb-cli' @Arguments
  if ($LASTEXITCODE -ne 0) { throw "CNB CLI failed: $($Arguments -join ' ')" }
  return (($output -join "`n") | ConvertFrom-Json)
}

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  $stream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $LiteralPath))
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

$manifestPath = (Resolve-Path -LiteralPath $Manifest).Path
$documents = @(Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json)
if ($documents.Count -ne 1) { throw 'Standalone Android mirror manifest must contain exactly one release.' }
$release = $documents[0]
$tag = [string]$release.tag_name
$mobileVersion = [string]$release.mobileVersion
if ($release.schemaVersion -ne 1 -or $release.kind -ne 'harness-android-standalone-release') { throw 'Standalone Android mirror manifest identity is invalid.' }
if ($tag -ne "android-v$mobileVersion" -or $tag -notmatch '^android-v\d+\.\d+\.\d+(?:\.\d+)?$') { throw 'Standalone Android mirror tag/version binding is invalid.' }
$expectedNames = @(
  "Harness-Mobile-$mobileVersion-android-universal.apk",
  "Harness-Mobile-$mobileVersion-android-universal.apk.sha256"
)
$assets = @($release.assets)
if ($assets.Count -ne 2 -or @(Compare-Object ($expectedNames | Sort-Object) (@($assets.name) | Sort-Object)).Count -ne 0) {
  throw 'Standalone Android mirror requires exactly the APK and checksum assets.'
}
foreach ($asset in $assets) {
  if ([string]$asset.sha256 -notmatch '^[0-9a-f]{64}$' -or [long]$asset.size -lt 1) { throw "Invalid immutable asset metadata: $($asset.name)" }
  $expectedSource = "https://github.com/$ExpectedRepo/releases/download/$tag/$($asset.name)"
  $expectedTarget = "https://cnb.cool/$ExpectedRepo/-/releases/download/$tag/$($asset.name)"
  if ([string]$asset.browser_download_url -ne $expectedSource) { throw "Untrusted GitHub source URL: $($asset.name)" }
  if (@($asset.mirror_urls).Count -ne 1 -or [string]$asset.mirror_urls[0] -ne $expectedTarget) { throw "Untrusted CNB mirror URL: $($asset.name)" }
  $sourceResponse = Invoke-WebRequest -UseBasicParsing -Uri $expectedSource -Method Head -MaximumRedirection 8 -TimeoutSec 90
  $sourceLength = [long]@($sourceResponse.Headers['Content-Length'])[0]
  if ($sourceResponse.StatusCode -ne 200 -or $sourceLength -ne [long]$asset.size) { throw "GitHub source verification failed for $($asset.name)" }
}

& $GitExecutable diff --quiet HEAD -- .cnb.yml scripts/publish-cnb-mobile-cloud-mirror.ps1
if ($LASTEXITCODE -ne 0) { throw 'Commit the standalone Android CNB publisher before mirroring.' }
$remoteUrl = (& $GitExecutable remote get-url $Remote 2>$null)
if ($LASTEXITCODE -ne 0) {
  Invoke-Git remote add $Remote $ExpectedRemoteUrl
  $remoteUrl = $ExpectedRemoteUrl
}
$remoteUrl = ([string]$remoteUrl).Trim()
if ($remoteUrl -ne $ExpectedRemoteUrl -and $remoteUrl -ne $ExpectedRemoteUrl.Substring(0, $ExpectedRemoteUrl.Length - 4)) {
  throw "Remote '$Remote' must be the reviewed HTTPS CNB repository."
}
Invoke-Git fetch $Remote main
$baseCommit = (& $GitExecutable rev-parse "$Remote/main").Trim()
if ($LASTEXITCODE -ne 0 -or $baseCommit -notmatch '^[0-9a-f]{40}$') { throw 'Unable to bind the current CNB main commit.' }

$index = Join-Path $env:TEMP ("cnb-mobile-index-" + [guid]::NewGuid().ToString('N'))
$previousIndex = $env:GIT_INDEX_FILE
$env:GIT_INDEX_FILE = $index
try {
  Invoke-Git read-tree $baseCommit
  $cnbBlob = (& $GitExecutable hash-object -w '.cnb.yml').Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to hash .cnb.yml.' }
  Invoke-Git update-index --add --cacheinfo "100644,$cnbBlob,.cnb.yml"
  $manifestBlob = (& $GitExecutable hash-object -w $manifestPath).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to hash standalone Android mirror manifest.' }
  Invoke-Git update-index --add --cacheinfo "100644,$manifestBlob,mobile-release-manifest.json"
  $manifestHash = Get-Sha256Hex -LiteralPath $manifestPath
  $markerBlob = ("standalone Android cloud mirror $tag $manifestHash`n" | & $GitExecutable hash-object -w --stdin).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create standalone Android CNB marker.' }
  Invoke-Git update-index --add --cacheinfo "100644,$markerBlob,.cnb-mobile-only"
  foreach ($marker in @('.cnb-stable-only', '.cnb-preview-feed-only', '.cnb-pr-preview-request')) {
    & $GitExecutable update-index --force-remove -- $marker 2>$null
  }
  $tree = (& $GitExecutable write-tree).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to write standalone Android CNB mirror tree.' }
  Invoke-Git fetch $Remote main
  $currentBase = (& $GitExecutable rev-parse "$Remote/main").Trim()
  if ($LASTEXITCODE -ne 0 -or $currentBase -ne $baseCommit) { throw 'CNB main changed while preparing the mobile mirror; resume the publisher to rebind safely.' }
  $commit = ("release: mirror standalone Android $mobileVersion" | & $GitExecutable commit-tree $tree -p $baseCommit).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create standalone Android CNB mirror commit.' }
} finally {
  if ($null -eq $previousIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
  else { $env:GIT_INDEX_FILE = $previousIndex }
  Remove-Item -LiteralPath $index -Force -ErrorAction SilentlyContinue
}

$branch = "cnb-mobile-release-$($mobileVersion -replace '[^0-9A-Za-z._-]', '-')"
Invoke-Git update-ref "refs/heads/$branch" $commit
& $GitExecutable -c 'credential.helper=' -c 'credential.helper=!npx.cmd --yes @cnbcool/cnb-cli git-credential' push $Remote "refs/heads/$branch`:refs/heads/main"
if ($LASTEXITCODE -ne 0) { throw 'Unable to push the standalone Android CNB mirror request.' }
Write-Host "CNB standalone Android metadata pushed: $commit"

$build = $null
$discoveryDeadline = (Get-Date).AddMinutes(2)
do {
  Start-Sleep -Seconds 5
  $list = Invoke-CnbJson build get-build-logs --repo $ExpectedRepo --sha $commit --page 1 --page-size 5 --verbose
  $build = @($list.data.data | Where-Object { $_.sha -eq $commit } | Select-Object -First 1)[0]
} while ($null -eq $build -and (Get-Date) -lt $discoveryDeadline)
if ($null -eq $build) { throw 'CNB did not start the standalone Android mirror pipeline within two minutes.' }
Write-Host "CNB standalone Android build: $($build.buildLogUrl)"

$deadline = (Get-Date).AddMinutes($WaitMinutes)
$status = ''
do {
  $statusResult = Invoke-CnbJson build get-build-status --repo $ExpectedRepo --sn $build.sn --verbose
  $status = [string]$statusResult.data.status
  Write-Host "CNB standalone Android status: $status"
  if ($status -eq 'success') { break }
  if ($status -in @('error', 'cancel', 'failed')) { throw "CNB standalone Android mirror failed: $($build.buildLogUrl)" }
  Start-Sleep -Seconds 10
} while ((Get-Date) -lt $deadline)
if ($status -ne 'success') { throw "CNB standalone Android mirror timed out: $($build.buildLogUrl)" }

foreach ($asset in $assets) {
  $url = [string]$asset.mirror_urls[0]
  $response = Invoke-WebRequest -UseBasicParsing -Uri $url -Method Head -MaximumRedirection 8 -TimeoutSec 90
  $length = [long]@($response.Headers['Content-Length'])[0]
  if ($response.StatusCode -ne 200 -or $length -ne [long]$asset.size) { throw "CNB standalone Android asset verification failed: $($asset.name)" }
  Write-Host "CNB standalone Android asset verified: $($asset.name) ($length bytes)"
}
Write-Host "CNB standalone Android cloud mirror complete: https://cnb.cool/$ExpectedRepo/-/releases/tag/$tag"
