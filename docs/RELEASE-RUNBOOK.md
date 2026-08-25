# DeepSeek Harness Desktop — 发布流程 Runbook（无 Apple 会员版）

> 适用仓库：`baiyuscc13724-max/deepseek-harness-desktop`（独立仓库，非 fork，默认分支 `main`）
> 本 Runbook 供任何 AI / 操作者按步骤执行。所有命令均只读或明确标注为写操作。

---

## 0. 设计原则（先读）

1. **发布 = 无签名构建 → GitHub Releases**。`release.yml` 设置了 `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`（electron-builder 明确禁用代码签名自动发现），因此**发布不依赖任何签名证书、不依赖 Apple Developer 会员**。
2. `macos-signing` Environment 及其 6 个 Apple Secret（MACOS_DEVELOPER_ID_P12_BASE64 / MACOS_DEVELOPER_ID_P12_PASSWORD / APPLE_NOTARY_API_KEY_P8_BASE64 / APPLE_NOTARY_KEY_ID / APPLE_NOTARY_ISSUER_ID / APPLE_TEAM_ID）**与发布流程无关，一律不要配置、修改或删除**。
3. 已发布历史：`v1.0.24` ~ `v1.0.28`（Latest = v1.0.28，2026-08-20）。每次发布必须使用**新版本号**，绝不覆盖已有 tag / release（CI 会拒绝：HTTP 422）。
4. 发布全流程在 GitHub Actions 完成，**本地只需推送 tag**，不需要本地构建。
5. **macOS 一键安装助手是打包流程的固定组成部分**（§9）：每次发布前必须确认 `build/macos-install.command` 与 `scripts/afterAllArtifactBuild.cjs` 存在并生效，否则按 §9 补齐后再发布。没有其他可选方案。

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
3. **确认一键安装助手在位**（§9 步骤 1-3；若缺失，先补上再继续）。
4. 更新 `release-notes.md`（仓库根目录，发布正文引用它；macOS 安装说明见 §7 模板）。
5. 提交并推送：
   ```powershell
   git add package.json release-notes.md build/macos-install.command scripts/afterAllArtifactBuild.cjs
   git commit -m "release: vX.Y.Z"
   git push origin main
   ```

### 2.2 使用统一可恢复发布器（禁止手工 Tag）

```powershell
npm run release:publish -- plan --version X.Y.Z
npm run release:publish -- run --version X.Y.Z
```

> `release.yml` 只接受发布器提供的精确 `source_revision` 和唯一 requestId，不监听 Tag push。发布器先验证云端候选，全部成功后才创建唯一不可变 Tag；不得手工创建、移动或重建 Tag，也不得逐条手工拼装发布命令。

### 2.3 监控与验证

```powershell
# 原子发布状态；网络中断后重复 run 会从未完成阶段续跑
npm run release:publish -- status --version X.Y.Z

# 查看候选云构建（也可在 Actions 页面看）
gh run list --repo baiyuscc13724-max/deepseek-harness-desktop --workflow release.yml --limit 3

# 发布器完成后确认
gh release view vX.Y.Z --repo baiyuscc13724-max/deepseek-harness-desktop --json tagName,isDraft,assets --jq '{tag:.tagName,draft:.isDraft,assets:[.assets[].name]}'
```

### 2.4 流程内部结构（供排查用）

```
release.yml / build（Windows / macOS / Linux）          ← 当前包构建、自检并上传三份 artifact
release.yml / ios-simulators                           ← iPhone/iPad 模拟器测试
publisher / immutable-tag                              ← 四个候选 job 全部成功后创建唯一 Tag
recover-release-from-actions.yml / recover             ← 复用同一 run，补齐 Draft 并重验九项桌面资产字节
recover-release-from-actions.yml / publish             ← 复核 Draft 快照未变后置为公开
publisher / Android、组件、清单、CNB、stable feed       ← 精确 18 项资产，stable 最后提升
```

云端 previous-stable Windows 原位升级 job 固定禁用；真实更新、重启健康与回滚由发布前本机 PR Preview 门禁负责。Windows 当前候选仍执行便携包自检、组件健康/回滚、安装器安装、已安装包自检和卸载。

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

> macOS 的 dmg/zip 内**必须包含** **`安装.command`**（一键安装助手，由 §9 的钩子自动注入；发布前按 §9 步骤 6 验证）。

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
- ❌ 不删除 / 不绕过 `build/macos-install.command` 与 `scripts/afterAllArtifactBuild.cjs`（§9 固定流程的一部分，缺失则按 §9 补齐）。
- ❌ 不擅自发布非 `main` 分支或未经验证的代码。

---

## 7. 用户须知（发布后转达用户/README）

**macOS（标准路径）**：打开 DMG 后双击 **`安装.command`** 一键安装——自动复制到应用程序、清除隔离标记并启动，无需处理任何系统警告。

**macOS（手动安装兜底，写进 release-notes.md 正文）**：
> 安装包未签名，若直接拖拽应用，macOS 首次打开可能提示"已损坏，无法打开"。这**不是文件损坏**，处理方式：
> 1. 打开"终端"，执行：`xattr -dr com.apple.quarantine "/Applications/Harness Desktop.app"`
> 2. 重新打开应用即可；或右键点击应用 → 打开。
> 推荐直接使用 DMG 内的 **`安装.command`** 一键安装，无需任何手动操作。

**Windows**：SmartScreen 会提示"已保护你的电脑"——点击"更多信息" → "仍要运行"。
**Linux**：无警告。

> 签名 + 公证（彻底消除上述警告）需要 Apple Developer 会员（$99/年），本项目刻意不做；不要购买第三方证书。

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

---

## 9. macOS "已损坏，无法打开" 处理（打包固定步骤，无其他选项）

### 9.1 现象与根因

用户反馈：**"Harness Desktop已损坏，无法打开。你应该将它移到废纸篓。"**

根因（与安装包质量无关）：
- 应用**未签名**（本项目刻意无签名发布，`CSC_IDENTITY_AUTO_DISCOVERY: 'false'`）；
- 用户通过浏览器下载时，macOS 给文件打上**隔离标记** `com.apple.quarantine`；
- Gatekeeper 对"带隔离标记 + 无有效签名"的应用直接拦截，新版本 macOS 常报"已损坏"而非"无法验证开发者"。

**解决方式固定为：DMG/zip 内置"一键安装"助手，用户双击即可完成安装，全程不接触隔离警告。**

### 9.2 打包固定步骤（每次发布前逐条执行）

**步骤 1 — 确认 `build/macos-install.command` 存在**（缺失则创建；**LF 行尾**、UTF-8、无 BOM；CRLF 会导致脚本在 macOS 上失效）：

```bash
#!/bin/bash
# Harness Desktop one-click installer (macOS)
set -u
cd "$(dirname "$0")"
APP="Harness Desktop.app"
if [ ! -d "$APP" ]; then
  echo "Error: cannot find $APP next to this file."
  read -r -p "Press Enter to exit..."
  exit 1
fi
echo "Installing Harness Desktop ..."
if [ -w /Applications ]; then DEST="/Applications/$APP"; else DEST="$HOME/Applications/$APP"; mkdir -p "$HOME/Applications"; fi
rm -rf "$DEST" 2>/dev/null || true
ditto "$APP" "$DEST" || { echo "Copy failed."; read -r -p "Press Enter to exit..."; exit 1; }
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
echo "Installed: $DEST"
open "$DEST"
exit 0
```

**步骤 2 — 确认 `scripts/afterAllArtifactBuild.cjs` 存在**（缺失则创建；electron-builder 钩子，macOS 构建时把助手注入 dmg/zip；注入失败不阻断构建）：

```js
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HELPER_SRC = path.join(__dirname, '..', 'build', 'macos-install.command');
const HELPER_NAME = '安装.command';
function sh(cmd, args, opts) { execFileSync(cmd, args, Object.assign({ stdio: 'inherit' }, opts)); }
function injectIntoDmg(dmg) {
  const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-dmg-'));
  try {
    sh('hdiutil', ['attach', dmg, '-nobrowse', '-mountpoint', mnt]);
    fs.copyFileSync(HELPER_SRC, path.join(mnt, HELPER_NAME));
    fs.chmodSync(path.join(mnt, HELPER_NAME), 0o755);
  } finally { sh('hdiutil', ['detach', mnt, '-quiet'], { stdio: 'ignore' }); }
}
function injectIntoZip(zip) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-zip-'));
  fs.copyFileSync(HELPER_SRC, path.join(stage, HELPER_NAME));
  fs.chmodSync(path.join(stage, HELPER_NAME), 0o755);
  sh('zip', ['-ur', zip, HELPER_NAME], { cwd: stage });
}
async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== 'darwin') return buildResult;
  if (!fs.existsSync(HELPER_SRC)) { console.warn('[install-helper] helper missing:', HELPER_SRC); return buildResult; }
  for (const artifact of buildResult.artifactPaths) {
    try {
      if (artifact.endsWith('.dmg')) { injectIntoDmg(artifact); console.log('[install-helper] injected into', path.basename(artifact)); }
      else if (artifact.endsWith('.zip') && artifact.includes('-mac-')) { injectIntoZip(artifact); console.log('[install-helper] injected into', path.basename(artifact)); }
    } catch (err) { console.warn('[install-helper] failed for', path.basename(artifact), ':', err.message); }
  }
  return buildResult;
}
module.exports = afterAllArtifactBuild;
module.exports.default = afterAllArtifactBuild;
```

**步骤 3 — 确认 `package.json` 已含两处配置**（缺失则补上）：
- `build` 对象内（如 `"asar": true,` 之后）：
  ```json
  "afterAllArtifactBuild": "scripts/afterAllArtifactBuild.cjs",
  ```
- `build.mac` 内（如 `"category": ...` 之后，显式无签名，避免 ad-hoc 签名导致的"已损坏"）：
  ```json
  "identity": null,
  ```

**步骤 4 — 提交**：把上述文件与版本变更一起提交（§2.1 步骤 3-5）。

**步骤 5 — 发布**：按 §2 推送 tag 触发。

**步骤 6 — 验证**：发布后确认 mac 构建日志含 `[install-helper] injected into ...`，且 `SHA256SUMS.txt` 与资产 digest 一致（§8 命令；比对 64 位哈希与 `.assets[].digest` 的 `sha256:` 前缀）。

**步骤 7 — release-notes**：正文包含 §7 的 macOS 安装说明模板。

> 说明：本仓库已采用显式无签名契约（`build.mac.identity: null`，构建时拒绝任何签名/公证输入）。彻底消除 macOS 警告的唯一路径仍是签名 + 公证（需 Apple Developer 会员）；取得会员后需同步升级 `build-release.mjs`、`release-audit.mjs`、`release.yml` 与契约测试，再切换回签名发布。
