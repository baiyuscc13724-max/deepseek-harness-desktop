#!/usr/bin/env bash
set -euo pipefail
repo="baiyuscc13724-max/deepseek-harness-desktop"
command -v gh >/dev/null || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
[ -d .git ] || git init -b main
git add .
git rev-parse --verify HEAD >/dev/null 2>&1 || git commit -m "feat: initial DeepSeek Harness Desktop release candidate"
if ! gh repo view "$repo" >/dev/null 2>&1; then gh repo create "$repo" --public --source . --remote origin; fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$repo.git"
git push -u origin main
git show-ref --verify --quiet refs/heads/develop || git branch develop
git show-ref --verify --quiet refs/heads/release/v0.9 || git branch release/v0.9
git push origin develop release/v0.9
git rev-parse "v0.9.0-rc.5" >/dev/null 2>&1 || git tag -a v0.9.0-rc.5 -m "Harness Desktop v0.9.0-rc.5"
git push origin v0.9.0-rc.5
echo "Published: https://github.com/$repo"
