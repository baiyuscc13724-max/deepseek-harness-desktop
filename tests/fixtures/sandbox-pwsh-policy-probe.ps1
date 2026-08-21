$ErrorActionPreference = 'Stop'

$pipeline = @(cmd /d /c echo pipe-ok | ForEach-Object { $_.Trim() })
if ($pipeline.Count -ne 1 -or $pipeline[0] -ne 'pipe-ok') {
  throw "native pipeline failed: $($pipeline -join ',')"
}
Write-Output 'pipeline-ok'

function Test-WriteAllowed([string]$Path) {
  try {
    Set-Content -LiteralPath $Path -Value 'sandbox-write-probe' -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

$workspaceAllowed = Test-WriteAllowed $env:DSH_TEST_WORKSPACE_FILE
$outsideAllowed = Test-WriteAllowed $env:DSH_TEST_OUTSIDE_FILE

if ($env:DSH_TEST_MODE -eq 'read-only') {
  if ($workspaceAllowed -or $outsideAllowed) { throw 'read-only unexpectedly allowed a write' }
  Write-Output 'read-only-writes-denied'
} elseif ($env:DSH_TEST_MODE -eq 'workspace-write') {
  if (-not $workspaceAllowed) { throw 'workspace-write denied its workspace file' }
  if ($outsideAllowed) { throw 'workspace-write unexpectedly allowed an outside file' }
  Write-Output 'workspace-write-boundary-ok'
} else {
  throw "unexpected test mode: $env:DSH_TEST_MODE"
}
