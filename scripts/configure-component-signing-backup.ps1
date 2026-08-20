param(
  [Parameter(Mandatory = $true)][string]$PrivateKeyFile,
  [Parameter(Mandatory = $true)][string]$EncryptedBackupFile,
  [Parameter(Mandatory = $true)][string]$PublicMetadataFile,
  [string]$SourceRepo = 'baiyuscc13724-max/deepseek-harness-desktop',
  [string]$BackupRepo = 'baiyuscc13724-max/harness-component-signing-backup',
  [string]$KeyId = 'harness-components-02643f81164c594a',
  [string]$SecretName = 'HARNESS_COMPONENT_SIGNING_PRIVATE_KEY_BASE64'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Invoke-Checked {
  param([Parameter(Mandatory = $true)][string]$Program, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed: $($Arguments -join ' ')" }
}

Invoke-Checked gh auth status
$private = (Resolve-Path -LiteralPath $PrivateKeyFile).Path
$encrypted = (Resolve-Path -LiteralPath $EncryptedBackupFile).Path
$metadata = (Resolve-Path -LiteralPath $PublicMetadataFile).Path
if ((Split-Path $private -Parent) -eq (Split-Path $encrypted -Parent)) { throw 'Private key and encrypted backup must remain in separate directories.' }
if ([IO.Path]::GetExtension($encrypted) -ne '.json' -or $encrypted -notlike '*.encrypted.json') { throw 'Backup repository input must be the encrypted JSON backup only.' }
Invoke-Checked node scripts/verify-component-signing-key.mjs --key-file $private --key-id $KeyId

$repoJson = & gh repo view $BackupRepo --json nameWithOwner,isPrivate 2>$null
if ($LASTEXITCODE -ne 0) {
  Invoke-Checked gh repo create $BackupRepo --private --disable-issues --disable-wiki --description 'Encrypted Harness component signing-key backup; no plaintext key or recovery material.'
  $repoJson = & gh repo view $BackupRepo --json nameWithOwner,isPrivate
}
$repo = $repoJson | ConvertFrom-Json
if (-not $repo.isPrivate) { throw "Backup repository must be private: $BackupRepo" }

$temp = Join-Path $env:TEMP ("harness-component-signing-backup-" + [guid]::NewGuid().ToString('N'))
try {
  Invoke-Checked gh repo clone $BackupRepo $temp
  Copy-Item -LiteralPath $encrypted -Destination (Join-Path $temp 'component-production-ed25519-private.encrypted.json') -Force
  Copy-Item -LiteralPath $metadata -Destination (Join-Path $temp 'component-production-key.json') -Force
  @'
# Harness component signing backup

This private repository contains only the AES-256-GCM encrypted Ed25519 backup and public key metadata.

It must never contain the plaintext PEM, recovery key, passwords, tokens, OTPs, or release artifacts.
'@ | Set-Content -LiteralPath (Join-Path $temp 'README.md') -Encoding utf8
  @'
*.pem
*recovery*
*.key
*.token
.env*
'@ | Set-Content -LiteralPath (Join-Path $temp '.gitignore') -Encoding ascii
  Invoke-Checked git -C $temp add README.md .gitignore component-production-key.json component-production-ed25519-private.encrypted.json
  & git -C $temp diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    Invoke-Checked git -C $temp commit -m 'backup: store encrypted component signing key'
    Invoke-Checked git -C $temp push origin HEAD:main
  }
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}

[byte[]]$privateBytes = [IO.File]::ReadAllBytes($private)
$privateBase64 = $null
try {
  $privateBase64 = [Convert]::ToBase64String($privateBytes)
  $privateBase64 | & gh secret set $SecretName --repo $SourceRepo
  if ($LASTEXITCODE -ne 0) { throw "Unable to set Actions Secret $SecretName." }
} finally {
  [Array]::Clear($privateBytes, 0, $privateBytes.Length)
  $privateBase64 = $null
}
$secretNames = @(& gh secret list --repo $SourceRepo --json name --jq '.[].name')
if ($LASTEXITCODE -ne 0 -or $secretNames -notcontains $SecretName) { throw "Actions Secret verification failed: $SecretName" }
$confirmed = (& gh repo view $BackupRepo --json isPrivate --jq '.isPrivate').Trim()
if ($LASTEXITCODE -ne 0 -or $confirmed -ne 'true') { throw "Private repository verification failed: $BackupRepo" }
Write-Host "Encrypted backup repository verified private: $BackupRepo"
Write-Host "Actions Secret name verified: $SecretName"
