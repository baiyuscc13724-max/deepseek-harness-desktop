# DeepSeek Harness Desktop — 发布流程 Runbook（无 Apple 会员版）

> 适用仓库：`baiyuscc13724-max/deepseek-harness-desktop`（独立仓库，非 fork，默认分支 `main`）
> 本 Runbook 供任何 AI / 操作者按步骤执行。所有命令均只读或明确标注为写操作。

---

## 0. 设计原则（先读）

1. **发布 = 无签名构建 → GitHub Releases**。`release.yml` 设置了 `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`（electron-builder 明确禁用代码签名自动发现），因此**发布不依赖任何签名证书、不依赖 Apple Developer 会员**。
2. `macos-signing` Environment 及其 6 个 Apple Secret（MACOS_DEVELOPER_ID_P12_BASE64 / MACOS_DEVELOPER_ID_P12_PASSWORD / APPLE_NOTARY_API_KEY_P8_BASE64 / APPLE_NOTARY_KEY_ID / APPLE_NOTARY_ISSUER_ID / APPLE_TEAM_ID）**与发布流程无关，一律不要配置、修改或删除**。
3. 已发布历史：`v1.0.24` ~ `v1.0.28`（Latest = v1.0.28，2026-08-20）。每次发布必须使用**新版本号**，绝不覆盖已有 tag / release（CI 会拒绝：HTTP 422）。
4. 发布全流程在 GitHub Actions 完成，**本地只需推送 tag**，不需要本地构建。

---

## 1. 前置条件检查（只读）

```powershell
# gh 已登录且是仓库所有者
gh auth status
# 期望: Logged in to github.com account baiyuscc13724-max

# 仓库与默认分支
gh repo view baiyuscc13724-max/deepseek-harness-desktop --json defaultBranchRef --jq .defaultBranchRef.name
# 期望: main

# 当前版本与已发布版本
gh api "repos/baiyuscc13724-max/deepseek-harness-desktop/contents/package.json" --jq '.content' |
  ForEach-Object { [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($_)) } |
  ConvertFrom-Json | Select-Object -ExpandProperty version
gh release list --repo baiyuscc13724-max/deepseek-harness-desktop --limit 5
```

---

## 2. 发布步骤（标准流程）

设目标版本为 `X.Y.Z`（示例 `1.0.29`），**发布 tag 必须是 `vX.Y.Z`**。

### 2.1 准备代码

1. 在 `main` 分支合并好要发布的代码（自己改的，或按 §5 跟上上游）。
2. 确认 `package.json` 的 `version` 已是 `X.Y.Z`（CI 强制校验 `tag == 'v' + package.json.version`，不匹配直接失败）。
3. 更新 `release-notes.md`（仓库根目录，发布正文引用它）。
4. 提交并推送：
   ```powershell
   git add package.json release-notes.md
   git commit -m "release: vX.Y.Z"
   git push origin main
   ```

### 2.2 推送 tag 触发发布

```powershell
git tag vX.Y.Z
git push origin vX.Y.Z
```

> `release.yml` 在推送 `v*` tag 时自动触发（也支持在 Actions 页面手动 `Run workflow` 并填 `tag` 输入）。

### 2.3 监控与验证

```powershell
# 查看运行状态（也可在 Actions 页面看）
gh run list --repo baiyuscc13724-max/deepseek-harness-desktop --workflow release.yml --limit 3

# 发布成功后确认
gh release view vX.Y.Z --repo baiyuscc13724-max/deepseek-harness-desktop --json tagName,isDraft,assets --jq '{tag:.tagName,draft:.isDraft,assets:[.assets[].name]}'
```

### 2.4 流程内部结构（供排查用）

```
build (windows-latest / macos-latest / ubuntu-latest)  ← 构建+自测+上传 artifact
ios-simulators (macos-14)                              ← iPhone/iPad 模拟器测试
stage-draft                                            ← 创建私有草稿 Release，上传 8 个资产 + SHA256SUMS.txt
verify-windows-draft                                   ← 认证下载、校验 SHA-256、安装自测、卸载
publish                                                ← 复核草稿未变后置为公开 (draft=false)
```

---

## 3. 发布资产清单（每个版本 8 个文件）

`{version}` 为不带 `v` 的版本号（如 `1.0.29`）：

- `Harness-Desktop-{version}-win-x64.exe`（Windows 安装包）
- `Harness-Desktop-{version}-portable-x64.exe`（Windows 便携版）
- `Harness-Desktop-{version}-mac-arm64.dmg` / `-mac-arm64.zip`
- `Harness-Desktop-{version}-mac-x64.dmg` / `-mac-x64.zip`
- `Harness-Desktop-{version}-linux-x86_64.AppImage`
- `Harness-Desktop-{version}-linux-amd64.deb`
- `SHA256SUMS.txt`（上述文件的 SHA-256 校验和）

---

## 4. 失败恢复

### 4.1 常见失败点

| 现象 | 原因 | 处理 |
|---|---|---|
| 工作流第一步报 tag 校验失败 | tag 与 package.json 版本不一致 | 修正版本号或 tag 后重来 |
| stage-draft 报 HTTP 422 | 该 tag 的 Release 已存在 | 换新版本号；绝不覆盖 |
| `npm audit` / `npm run verify` 失败 | 依赖漏洞或校验不过 | 先修代码/依赖，再重新触发 |
| 打包自测失败 | 构建产物异常 | 打开失败 job 日志定位 |

### 4.2 恢复通道（构建成功但发布中途失败时）

使用 `Recover Release From Verified Actions Artifacts` 工作流（手动触发），输入：
- `tag`：目标 tag（如 `v1.0.29`）
- `source_run_id`：已失败的 release 运行 ID（其平台构建 job 必须全部 success）
- `release_id`：仓库所有者创建的私有草稿 Release ID
- 它会校验并转移已验证的云端产物，以不可变资产方式补齐并发布，绝不覆盖已有资产。

---

## 5. 上游更新（跟随 DeepSeek Harness 新版本）

- `upstream-watch.yml` 每日 03:23 UTC 运行，检查 pinned 的 `@deepseek-ai/dsh` npm 依赖是否有新版本；有更新时在 Actions 输出 notice（pinned vs latest）。
- 手动触发：
  ```powershell
  gh workflow run upstream-watch.yml --repo baiyuscc13724-max/deepseek-harness-desktop
  ```
- 有更新时：把依赖升到新版本 → 跑 `npm run verify` → 走 §2 发布流程。**上游有更新 ≠ 立即发版**，需先做验收测试。

---

## 6. 明确禁止（安全边界）

- ❌ 不配置 / 不修改 / 不删除 `macos-signing` 环境的 6 个 Apple Secret（与发布无关；值只存在于用户手中）。
- ❌ 不读取、复制、粘贴、输出任何 Secret 的值；不操作 .p12 / .p8 / 密码 / Token。
- ❌ 不覆盖已有 tag 或 Release（CI 也会拒绝）。
- ❌ 不修改 `release.yml` 的签名开关（保持 `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`）。
- ❌ 不擅自发布非 `main` 分支或未经验证的代码。

---

## 7. 用户须知（发布后转达用户/README）

- **macOS**：安装包未签名，首次打开会提示"无法验证开发者"——右键点击 → 打开，或在 系统设置 → 隐私与安全性 → 仍要打开。
- **Windows**：SmartScreen 会提示"已保护你的电脑"——点击"更多信息" → "仍要运行"。
- **Linux**：无警告。
- 签名 + 公证（消除上述警告）需要 Apple Developer 会员（$99/年），本项目刻意不做；不要购买第三方证书。

---

## 8. 常用只读检查命令速查

```powershell
gh release list --repo baiyuscc13724-max/deepseek-harness-desktop --limit 5
gh api "repos/baiyuscc13724-max/deepseek-harness-desktop/tags?per_page=5" --jq '.[].name'
gh secret list --repo baiyuscc13724-max/deepseek-harness-desktop          # 仅名称
gh secret list --env macos-signing --repo baiyuscc13724-max/deepseek-harness-desktop  # 仅名称
gh run list --repo baiyuscc13724-max/deepseek-harness-desktop --limit 5
gh api "repos/baiyuscc13724-max/deepseek-harness-desktop/contents/.github/workflows" --jq '.[].name'
```
