# Harness Desktop 可恢复发布流程

本文是从源码、打包、双平台发布到用户下载验证的唯一正式流程。换会话后先读取本文件和 `.release-state/v<version>.json`，不要凭记忆重新设计步骤。

## 1. 默认安全原则

- 所有本地编排默认只验证，不上传：`npm run release:orchestrate -- run --through verify`。
- 只有干净、已验证的同一提交可以创建 Tag；Tag、GitHub Release、组件资产和 Android 正式 APK一经公开不得原地替换。
- `release-manifest.json` 在新资产全部存在前继续指向上一健康版本，避免公开空链接。
- v1.0.26 是生产组件更新的完整 Bootstrap 引导包。v1.0.25 不修改、不补发组件源。
- Android 只允许长期 release 证书；debug、未签名、包名/版本/指纹漂移时工作流必须失败。
- 用户未加入 Apple Developer Program，iPhone/iPad 只发布 Safari 工作台入口，不构造或发布未签名 IPA。
- 生产组件私钥、Android keystore、密码、恢复密钥和长期令牌不得进入 Git、聊天、日志或发布资产。

## 2. 本地可恢复编排

状态保存在被 Git 忽略的 `.release-state/v<version>.json`。每一阶段开始、成功或失败都原子写入；再次运行会跳过已成功阶段。

```powershell
# 查看状态
npm run release:orchestrate -- status --version 1.0.26

# 版本同步、生产源和文档门禁
npm run release:orchestrate -- run --version 1.0.26 --through source

# 385+ 项源码/安全测试与发布契约审计
npm run release:orchestrate -- run --version 1.0.26 --through verify

# Windows 安装版/便携版、体积审计、打包后真实自检、真实组件健康与回滚测试
npm run release:orchestrate -- run --version 1.0.26 --through windows

# 只有确认代码或环境修复后才重置失败阶段
npm run release:orchestrate -- reset --version 1.0.26 --phase windows
```

Windows 阶段固定生成并验证：

- `dist/Harness-Desktop-<version>-win-x64.exe`
- `dist/Harness-Desktop-<version>-portable-x64.exe`
- `dist/win-unpacked/Harness Desktop.exe`
- 打包自检报告和隔离组件测试 profile

## 3. 提交、Tag 与 GitHub 桌面制品

1. `git diff --check`，确认工作树干净且 `npm run verify`、`npm run verify:release`、本地 Windows 阶段均成功。
2. 快进合并验证提交到 `main`，先推送 `main`，再创建并推送唯一 Tag `v<version>`。
3. `.github/workflows/release.yml` 在 Windows、macOS、Linux 分别重新安装锁定依赖并运行全部门禁。
4. Windows 云端必须完成 unpacked 自检、Inno 安装/检查/卸载冒烟；macOS 必须分别完成 Intel/Apple Silicon 原生架构和打包后自检。
5. 聚合任务最后才创建 GitHub Release，并生成 `SHA256SUMS.txt`。任何矩阵任务失败都不得手动上传未验证替代品。

GitHub CLI 必须由发布者本人登录；不得在聊天中发送密码、Token 或验证码：

```powershell
gh auth status
gh run list --workflow release.yml --branch v1.0.26
gh run watch <run-id> --exit-status
```

## 4. 正式 Android

GitHub 仓库 Actions Secrets 必须已有：

- `ANDROID_RELEASE_KEYSTORE_BASE64`
- `ANDROID_RELEASE_KEY_ALIAS`
- `ANDROID_RELEASE_STORE_PASSWORD`
- `ANDROID_RELEASE_KEY_PASSWORD`
- `ANDROID_RELEASE_CERT_SHA256`

桌面 Release 成功后运行 **Publish Signed Android Mobile**，输入同一 Tag。工作流强制验证 `io.harnessdesktop.mobile`、从桌面版本推导的 versionCode/versionName、长期证书固定指纹和 `apksigner`，然后才加入：

- `Harness-Mobile-<version>-android-universal.apk`

上传后重新生成同一 Release 的 `SHA256SUMS.txt`，并从公开 URL 再次下载验签、验包名、验版本和 SHA-256。

## 5. 生产组件密钥保管

一次性生成命令只写受保护目录，拒绝覆盖；私钥、AES-256-GCM 加密备份和恢复密钥必须使用三个不同目录：

```powershell
node scripts/create-component-signing-key.mjs `
  --private-dir <受 ACL 保护的私钥目录> `
  --backup-dir <准备提交到私人备份仓库的加密目录> `
  --recovery-dir <与备份分离的恢复目录>
```

- `component-update-sources.json` 只能提交公开 SPKI 公钥。
- GitHub Actions 只通过 Secret 获取生产私钥；私人备份仓库只保存 `.encrypted.json`，绝不保存明文 PEM 或恢复密钥。
- 恢复演练必须在隔离临时目录解密并完成一次 Ed25519 签名/验签，随后删除临时明文。

## 6. 生成生产组件

先把 GitHub Release 中已经公开并验证的 Windows 安装版、macOS x64 DMG、macOS arm64 DMG 下载到同一 `release-dir`，再运行：

```powershell
$env:HARNESS_COMPONENT_SIGNING_KEY_FILE='<受保护的私钥 PEM>'
$env:HARNESS_COMPONENT_KEY_ID='harness-components-02643f81164c594a'
npm run release:components:production -- --version 1.0.26 --release-dir <完整包目录>
Remove-Item Env:HARNESS_COMPONENT_SIGNING_KEY_FILE
Remove-Item Env:HARNESS_COMPONENT_KEY_ID
```

脚本先确认私钥与 Bootstrap 内置公钥一致，再为 `win32-x64`、`darwin-x64`、`darwin-arm64` 生成：

- 不可变 `desktop-shell-<version>-<target>.zip`
- 不可变 `components-<version>-<target>.json`
- `component-release-report.json`（只含公开哈希、大小和文件名）

每个目标的完整包兜底必须使用同架构 EXE/DMG，禁止跨架构复用。

## 7. 组件与稳定指针的强制顺序

1. **先有可信完整 Bootstrap**：GitHub/CNB 的 v1.0.26 完整安装包均已下载验哈希。
2. 上传三个不可变组件 ZIP 到 GitHub Release，重新下载并逐个验大小、SHA-256 和 ZIP 索引。
3. 上传三个不可变目标清单到 GitHub Release；本地再次用内置公钥验签。
4. 把组件 ZIP/不可变清单加入 `release-manifest.json`，先运行 CNB 云端镜像并等待所有附件验哈希成功。
5. 只有 GitHub 与 CNB 两端资产都可用后，才把三个签名清单复制为：
   - `component-feeds/stable/win32-x64.json`
   - `component-feeds/stable/darwin-x64.json`
   - `component-feeds/stable/darwin-arm64.json`
6. 单独提交并推送稳定指针；验证 CNB raw 优先 URL 与 GitHub raw 后备 URL 返回完全相同字节。

稳定文件永远最后更新。同版本不同 SHA-256 是冲突而不是覆盖理由，必须发布更高版本。

## 8. CNB 云端镜像

- 禁止从本机向 CNB 上传 EXE、DMG、ZIP、APK 等大文件。
- 本机只推送 `.cnb.yml`、发布说明、清单和校验信息；CNB Runner 从 GitHub Release 下载后按 `release-manifest.json` 的大小和 SHA-256 验证。
- 官方 `cnbcool/attachments:latest` 插件负责上传；流水线短期 `CNB_TOKEN` 自动注入、结束销毁。
- 使用已登录的官方 `@cnbcool/cnb-cli` 启动并等待：

```powershell
npm run release:cnb-cloud
```

失败可安全重跑；已验证存在的附件跳过，只补缺失项。不得绕过大小或哈希失败。

## 9. 用户下载前最终核验

必须对 README、`release-manifest.json`、GitHub Release、CNB Release 和三个稳定组件 URL 做外部 HTTP 验证：

- 状态码成功、无重定向到登录页、无凭据或查询 Token。
- 文件名、Content-Length（若提供）、实际大小、SHA-256 与清单一致。
- Windows 安装版与便携版可启动并通过打包自检；正式 APK 证书/包名/版本正确。
- macOS Intel/Apple Silicon 云端自检成功；iPhone/iPad 说明只指向 Safari 工作台。
- 生产清单签名有效，目标架构和兜底资产一致；健康激活、失败回滚、同版本冲突拒绝、完整包兜底均有测试证据。
- 新安装上自动本地记忆和七天缓存维护默认生效；托盘可以关闭、搜索、预览、单项删除、全部安全删除，敏感内容不入库。

全部核验完成后才把发布目标标记完成。若 GitHub/CNB 登录是唯一阻塞，保留状态文件和已验证产物，明确停在对应步骤，不得伪造“已发布”。
