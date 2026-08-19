param(
  [string]$OutputPath = (Join-Path $env:USERPROFILE '.harness-desktop\signing\harness-mobile-release.jks'),
  [string]$Alias = 'harness-mobile-release',
  [string]$DistinguishedName = 'CN=Harness Mobile, OU=Release, O=Harness Desktop, L=Unknown, S=Unknown, C=CN',
  [int]$ValidityDays = 10000
)

$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputPath) { throw "Refusing to overwrite the existing keystore: $OutputPath" }
$keytool = (Get-Command keytool -ErrorAction Stop).Source
$parent = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $parent -Force | Out-Null

$storeSecure = Read-Host 'Create a strong keystore password (store it in your password manager)' -AsSecureString
$keySecure = Read-Host 'Create a strong key password (store it in your password manager)' -AsSecureString
$storeBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storeSecure)
$keyBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keySecure)
try {
  $env:HARNESS_KEYTOOL_STORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($storeBstr)
  $env:HARNESS_KEYTOOL_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyBstr)
  & $keytool -genkeypair -v -keystore $OutputPath -storetype PKCS12 -alias $Alias -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity $ValidityDays -dname $DistinguishedName -storepass:env HARNESS_KEYTOOL_STORE_PASSWORD -keypass:env HARNESS_KEYTOOL_KEY_PASSWORD
  if ($LASTEXITCODE -ne 0) { throw "keytool failed with exit code $LASTEXITCODE" }
  Write-Host "Android release keystore created: $OutputPath"
  Write-Host 'Back it up offline. Losing this file or either password prevents future in-place updates.'
  & $keytool -list -v -keystore $OutputPath -alias $Alias -storepass:env HARNESS_KEYTOOL_STORE_PASSWORD | Select-String 'SHA256:'
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the new signing certificate (exit $LASTEXITCODE)." }
} finally {
  Remove-Item Env:HARNESS_KEYTOOL_STORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:HARNESS_KEYTOOL_KEY_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($storeBstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyBstr)
}
