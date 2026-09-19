param([Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9-]+$')][string]$Run)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$out=Join-Path $repo ".artifacts/deep-audit-round3-appframe/$Run"
if(Test-Path $out){throw 'Existing evidence refused; choose fresh Run'}
$profile=Join-Path $out 'profile';New-Item -ItemType Directory -Path $profile -Force|Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$allowed=@{SystemRoot=$env:SystemRoot;WINDIR=$env:WINDIR;PATH="$(Split-Path $node);$env:SystemRoot\System32";HOME=$profile;USERPROFILE=$profile;APPDATA=$profile;LOCALAPPDATA=$profile;TEMP=$profile;TMP=$profile;DSH_HOME=(Join-Path $profile 'dsh');APPFRAME_AUDIT_RUN=$out}
$p=[Diagnostics.ProcessStartInfo]::new($node);$p.UseShellExecute=$false;$p.WorkingDirectory=$repo;$p.Environment.Clear()
foreach($item in $allowed.GetEnumerator()){$p.Environment[$item.Key]=$item.Value}
$p.ArgumentList.Add('--test');$p.ArgumentList.Add('--test-reporter=tap');$p.ArgumentList.Add("--test-reporter-destination=$out/node.tap");$p.ArgumentList.Add('tests/deep-audit-round3-appframe.test.cjs')
$proc=[Diagnostics.Process]::Start($p);$proc.WaitForExit();exit $proc.ExitCode
