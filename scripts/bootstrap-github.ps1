$ErrorActionPreference = "Stop"
$Repo = "baiyuscc13724-max/deepseek-harness-desktop"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI (gh) is required." }
if (-not (Test-Path .git)) { git init -b main }
git add .
if (-not (git rev-parse --verify HEAD 2>$null)) { git commit -m "feat: initial DeepSeek Harness Desktop release candidate" }
try { gh repo view $Repo *> $null } catch { gh repo create $Repo --public --source . --remote origin }
if (-not (git remote get-url origin 2>$null)) { git remote add origin "https://github.com/$Repo.git" }
git push -u origin main
if (-not (git show-ref --verify --quiet refs/heads/develop)) { git branch develop }
if (-not (git show-ref --verify --quiet refs/heads/release/v0.9)) { git branch release/v0.9 }
git push origin develop release/v0.9
if (-not (git rev-parse "v0.9.0-rc.4" 2>$null)) { git tag -a v0.9.0-rc.4 -m "Harness Desktop v0.9.0-rc.4" }
git push origin v0.9.0-rc.4
Write-Host "Published: https://github.com/$Repo"
