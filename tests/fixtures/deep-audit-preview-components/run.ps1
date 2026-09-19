param([Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9-]+$')][string]$Run)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$out = [IO.Path]::GetFullPath((Join-Path $repo ".artifacts/deep-audit-round2-preview/$Run"))
if (Test-Path $out) { throw 'Evidence directory exists; choose a new Run name' }
$profile = Join-Path $out 'profile'
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source
$allowed = @{ SystemRoot=$env:SystemRoot; WINDIR=$env:WINDIR; PATH="$(Split-Path $node);$env:SystemRoot\System32"; HOME=$profile; USERPROFILE=$profile; APPDATA=$profile; LOCALAPPDATA=$profile; TEMP=$profile; TMP=$profile; DSH_HOME=(Join-Path $profile 'dsh'); PREVIEW_AUDIT_RUN=$out }
$start = [Diagnostics.ProcessStartInfo]::new($node)
$start.UseShellExecute=$false
$start.WorkingDirectory=$repo
$start.Environment.Clear()
foreach ($entry in $allowed.GetEnumerator()) { $start.Environment[$entry.Key]=$entry.Value }
$start.ArgumentList.Add('--test')
$start.ArgumentList.Add('--test-reporter=tap')
$start.ArgumentList.Add("--test-reporter-destination=$out/node.tap")
$start.ArgumentList.Add('tests/deep-audit-preview-components.test.cjs')
# Derived from read-only clipboard run.ps1: only output, env key and test filename differ.
$process=[Diagnostics.Process]::Start($start)
$process.WaitForExit()
exit $process.ExitCode
