# GitHub 首次发布

目标仓库：`baiyuscc13724-max/deepseek-harness-desktop`

## 分支

- `main`
- `develop`
- `release/v0.9`

## RC 标签

`v0.9.0-rc.8`

## 自动构建

Tag 推送后由 `.github/workflows/release.yml` 执行 Windows / macOS / Linux 构建、打包自检、产物审计与 Release。

## 本地一次性创建仓库（GitHub CLI）

```powershell
gh auth login
gh auth refresh -h github.com -s workflow
gh repo create baiyuscc13724-max/deepseek-harness-desktop --public --source . --remote origin --push
git push origin develop release/v0.9
git push origin v0.9.0-rc.8
```

注意：公开前必须运行完整验证与密钥扫描。只有实际安装版、便携版和 GitHub Actions 均通过后才推送 RC 标签。
