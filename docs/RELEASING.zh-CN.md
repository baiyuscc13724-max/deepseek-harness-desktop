# Harness Desktop 可恢复发布流程

本文是从源码门禁、全云端打包、双平台发布到用户下载验证的唯一正式流程。仓库根目录 `AGENTS.md` 会由 Harness 自动载入，因此换会话后不需要用户重新解释上传步骤。

## 0. 唯一对外发布命令

任何会话收到“打包、发布、上传更新、镜像更新”请求时，只运行统一发布器，不手工拼接下文章节中的内部命令：

```powershell
# 显示固定阶段和安全保证，不修改远端
npm run release:publish -- plan --version <package.json 中的版本>

# 首次发布和断点续跑使用同一条命令
npm run release:publish -- run --version <package.json 中的版本>

# 只查看原子状态
npm run release:publish -- status --version <package.json 中的版本>
```

用户明确要求“只发布手机 APP”时，仍只能使用同一发布器，但加固定 Android scope；`--version` 仍传 `package.json` 的三段集成版本，独立 Android 四段版本由 `mobile/android/app/version.properties` 提供：

```powershell
npm run release:publish -- plan --version <package.json 中的版本> --scope android
npm run release:publish -- run --version <package.json 中的版本> --scope android
npm run release:publish -- status --version <package.json 中的版本> --scope android
```

Android scope 只允许干净且等于 `origin/main` 的源码，并先绑定该提交在 `main` 上唯一成功的 `CI / Android mobile compile/test` 云端编译测试证据，同时以 `mobile_only=true` 验证 iPhone/iPad 模拟器并明确跳过 macOS 桌面打包，之后才创建新的不可变 `android-v<mobileVersion>` Tag，由 GitHub Actions 使用长期证书生成/验证正式 APK，再由 CNB Runner 从 GitHub 云到云镜像；Release 只能有 APK 与 `.sha256` 两项，并重新证明既有 `v<integrationVersion>` 的 18 项桌面/组件资产、stable feed 与双云镜像没有变化。它不得调度桌面构建、组件发布或 stable 提升，也不得把本地 debug/release APK作为上传输入。iPhone/iPad 继续采用 Safari 工作台与“添加到主屏幕”，并保留模拟器门禁；没有 Apple Developer 会员时不发布不可安装的未签名 IPA。

状态保存在 `.release-state/v<version>-publish.json`，`packagingMode` 固定为 `github-actions-only`。从 `v1.0.44` 起发布器固定执行：本地源码/安全门禁（删除并拒绝 `dist`，不打包）→ 候选提交快进到 `main` → GitHub Actions 按精确 `source_revision` 完成 Windows/macOS/Linux 构建、iOS 模拟器测试、三份桌面制品归档、当前 Windows 便携/安装包自检、组件健康与回滚以及安装器安装/卸载 → **全部成功后才创建唯一不可变 Tag** → 恢复工作流直接消费前述同一 run 的 Actions 制品并公开 draft → 从公开 Release 下载正式 Windows portable x64 到 `.release-state` 隔离目录并真实自检 → 签名 Android → 签名组件 → 精确 18 项清单 → CNB 从 GitHub 云端镜像 → 最后提升 stable feed → 再同步 CNB。正式 Windows 验收绑定 asset ID、size、GitHub SHA-256 digest 与产品提交，使用唯一 Electron/Harness 数据目录；跨会话恢复会重新读取远端元数据、重新计算本地字节和报告摘要并严格检查全部报告项，不能只信旧状态。该阶段不读取 `dist`、不接受 Actions artifact，且非 Windows x64 发布主机失败关闭。`release.yml` 不再监听产品 Tag，因此 Tag push 不会重复构建桌面包。旧 `local-windows` 状态绝不折算成新门禁成功；恢复时记录的 runId 必须重新匹配精确 workflow ID/名称/路径、事件、持久化 requestId 对应的 `display_title`、提交、ref、结论、成功 jobs 和制品集合；GitHub REST run 对象没有 `inputs`，不得把不存在的字段当身份依据。每次实际进入 stable 提升前都会重新检查两云 18 项资产，第二次 CNB 同步才使用 metadata-only 模式，只校验并同步三个 stable feed，不重复传输 18 个不可变资产。阶段成功后原子记录，换会话或网络中断后重复 `run` 只从未完成阶段继续。

后文章节是发布器和工作流的安全契约及故障排查资料，不是让会话绕过发布器逐条手工执行的操作清单。完整信任边界、状态迁移和竞态分析见 `docs/CLOUD-RELEASE-PIPELINE.zh-CN.md`。

## 1. 默认安全原则

- 所有本地编排默认只验证，不上传：`npm run release:orchestrate -- run --through verify`。
- 只有干净、已验证且同一轮云构建/测试完整成功的精确提交可以创建 Tag；Tag 创建后永不移动或重建，GitHub Release、组件资产和 Android 正式 APK 一经公开也不得原地替换。
- 用户可见的 signed manifest/stable 推进前，发布器必须已在 Windows x64 本机下载并隔离启动公开 Release 中的正式 portable x64；该副本仅用于验收，绝不回传或充当发布输入。
- `release-manifest.json` 在新资产全部存在前继续指向上一健康版本，避免公开空链接。
- v1.0.29 是生产组件更新的完整 Bootstrap 引导包。v1.0.25 不修改、不补发组件源。
- Android 只允许长期 release 证书；debug、未签名、包名/版本/指纹漂移时工作流必须失败。
- macOS 桌面包采用显式无签名契约（当前无 Apple Developer 会员）：构建拒绝任何 Developer ID/公证输入，DMG/ZIP 内含"一键安装"助手；这不等于 Developer ID 签名、Apple 公证或 Gatekeeper 验收，macOS 用户仍会看到 Gatekeeper 提示。iPhone/iPad 当前仍只发布 Safari 工作台入口，不构造或发布未签名 IPA；桌面端的 `安装.command` 类助手不能替代 iOS 代码签名和 App Store/TestFlight 安装规则。
- 生产组件私钥、Android keystore、密码、恢复密钥和长期令牌不得进入 Git、聊天、日志或发布资产。

## 2. 本地源码编排与可选开发者复现

状态保存在被 Git 忽略的 `.release-state/v<version>.json`。每一阶段开始、成功或失败都原子写入；再次运行只会跳过**同一个干净 Git 提交**且重新验证远端证据后的已成功阶段。提交哈希变化不会无条件清空状态：只有尚无任何 Tag/Release/CNB/stable 副作用、旧云 run 已终止、版本不变且新提交安全快进时，统一发布器才按第 3 节规则保留审计后重置候选阶段；否则直接拒绝。存在已跟踪或未跟踪改动时也拒绝编排。统一发布器只调用到 `--through verify`；下面的 `windows` 阶段只供开发者手工复现，不是正式发布输入，也不得由统一发布器调用。

```powershell
# 从 lock 冷安装；Windows 的 node-gyp 必须能找到真实 Python 3（必要时先设置 $env:PYTHON）
npm ci --no-audit --no-fund

# 查看状态
npm run release:orchestrate -- status --version 1.0.29

# 版本同步、生产源和文档门禁
npm run release:orchestrate -- run --version 1.0.29 --through source

# 390+ 项源码/安全测试与发布契约审计
npm run release:orchestrate -- run --version 1.0.29 --through verify

# 可选：仅供本机故障复现，正式发布器绝不执行或采用这些产物
npm run release:orchestrate -- run --version 1.0.29 --through windows

# 只有确认代码或环境修复后才重置失败阶段
npm run release:orchestrate -- reset --version 1.0.29 --phase windows
```

可选开发者 `windows` 阶段会在本机生成并验证（这些文件不得进入正式发布）：

- `dist/Harness-Desktop-<version>-win-x64.exe`
- `dist/Harness-Desktop-<version>-portable-x64.exe`
- `dist/win-unpacked/Harness Desktop.exe`
- 打包自检报告和隔离组件测试 profile

## 3. 提交、Tag 与 GitHub 桌面制品

### macOS 显式无签名契约（当前无 Apple Developer 会员）

macOS 桌面包按显式无签名契约构建：`package.json` 的 `build.mac.identity` 固定为 `null`，release.yml 的 macOS job 使用 `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` 构建，`scripts/build-release.mjs` 在检测到任何 Developer ID/公证输入（`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`APPLE_TEAM_ID`）时 fail closed。产物确定性地未签名。

**未签名包不是 Developer ID 签名、Apple 公证或 Gatekeeper 验收的等价替代。** 用户从浏览器下载后会遇到 Gatekeeper 提示；为降低摩擦，DMG/ZIP 内由 `scripts/afterAllArtifactBuild.cjs` 注入 **`安装.command`** 一键安装助手（复制到应用程序、清除隔离标记并启动）。这不等于"安全修复已损坏"——直接拖拽 .app 的用户仍需按 `docs/RELEASE-RUNBOOK.md` §7 处理 Gatekeeper。

`desktop-build` Environment 不含任何 Apple Secrets；`macos-signing` Environment 及其 6 个 Apple Secret 与当前发布流程无关，一律不得配置、修改或删除。若日后获得 Apple Developer 会员，可升级回签名+公证契约（届时需同步修改 `build-release.mjs`、`release-audit.mjs`、`release.yml` 与相关契约测试）。

无签名 macOS 产物仍需通过：双架构（x64/arm64）构建、打包后自检、DMG/ZIP 内应用结构核验（release.yml 的 `Verify unsigned macOS packages` 步骤）。

1. `git diff --check`，确认工作树干净且本地 `npm run verify`、`npm run verify:release` 均成功；统一发布器删除遗留 `dist` 并在源码门禁后断言它仍不存在。
2. 快进合并验证提交到 `main`，但此时**不创建 Tag**。发布器从 `main` 调度 `.github/workflows/release.yml`，输入候选版本标签和精确 40 位 `source_revision`；checkout HEAD、`GITHUB_SHA`、输入 SHA 与 `package.json` 版本必须一致，且候选 Tag 必须尚不存在。
3. Windows、macOS、Linux 分别重新安装锁定依赖、运行全部门禁并生成正式包；Windows 云端必须完成 unpacked 自检、真实组件健康/回滚测试、Inno 当前版本安装/已安装包自检/卸载冒烟，macOS 必须分别完成 Intel/Apple Silicon 原生架构、打包后自检和显式未签名 DMG/ZIP 结构验证。
4. 同一候选工作流还必须完成 iPhone Simulator 与 iPad Simulator 测试。真实上一稳定版更新、重启健康检查和强制回滚由发布前 PR Preview 本机门禁完成；耗时且结束前不可观察的云端 previous-stable 原地升级循环固定禁用，不在正式发布中重复。发布器先持久化唯一 requestId 后立即 dispatch，只接受精确 workflow 路径/ID、`workflow_dispatch` 事件、`main` ref、精确 `display_title`、head SHA、成功结论、四个成功 job 以及未过期且归属同一 run、无额外 `desktop-*` 名称的 Windows/macOS/Linux 三份制品。
5. 只有上述 run 整体成功后，发布器才把唯一 `v<version>` Tag 指向该 `source_revision`。正式 Tag 一旦创建绝不移动、删除或重建。
6. 发布器随后创建精确私有 draft，并调度 `.github/workflows/recover-release-from-actions.yml`；它只从第 4 步记录的同一 `source_run_id` 下载 Actions 制品，不在本机中转、不重新构建，也不接受其他 run 的制品。
7. 恢复工作流生成 `SHA256SUMS.txt`、按大小/digest 幂等补齐 draft，并从 draft 重新下载全部资产核对精确集合和 SHA-256 后才一次性公开。同名资产永不覆盖；任一上传/复核失败时只留下非公开 draft，不得手工上传替代品。
8. `local-formal-windows-validation` 随后从第 7 步公开 Release 的规范 URL 下载正式 `Harness-Desktop-<version>-portable-x64.exe`。下载目录按版本、40 位 `productRevision` 和随机 validation ID 隔离；文件必须与远端 Release ID 及 asset ID/size/`sha256:` digest/URL 一致，并用各自唯一的 `--user-data-dir`、`--harness-user-data-dir` 运行 `--self-test`。只有报告 `ok=true`、产品版本精确匹配且全部规定检查严格为 `true` 才写入成功 checkpoint；恢复时以及同一连续运行的每个后续阶段前，仍重验远端元数据、本地文件和报告。Android/组件工作流也在公开副作用前后核对发布器传入的同一正式身份，发布器在工作流结束后再次核对。漂移会阻断清单采用、CNB 和 stable；若检测前已有 APK/组件附件公开，它们可能留在不完整 Release 中，但不会被自动覆盖、不会被清单或 stable 采用，必须调查并提升版本。

GitHub CLI 必须由发布者本人登录；不得在聊天中发送密码、Token 或验证码：

```powershell
gh auth status
gh run list --workflow release.yml --branch v1.0.29
gh run watch <run-id> --exit-status
```

历史 `v1.0.41`、`v1.0.42`、`v1.0.43` Tag 与状态记录保持只读，不移动、不改写，也不把其已完成阶段重新解释为新顺序；它们曾因托管 Runner 跨平台 fixture/竞态门禁失败而未发布（v1.0.42 本地 1200 项门禁与 Ubuntu/iOS 云端通过，Windows short-path fixture 与 macOS 并发 Git worktree 竞态失败；v1.0.43 本地官方门禁 1202 tests/1200 pass/2 skip/0 fail 通过，Ubuntu job 在 CAS concurrent finalize 的 POSIX rename/inode race 失败）。从 `v1.0.44` 起，云端失败发生在 Tag 之前，因此不会留下失败 Tag：在版本号不变、旧 run 已终止、新提交是旧候选的安全快进，并且本地/远端 Tag、GitHub Release（含 draft）、CNB Release/资产、stable 提升均不存在时，发布器可以把同一个版本候选重新绑定到新 SHA；它会保留旧 run、结论和阶段快照作为 `candidateAttempts` 审计记录，并仅重置候选门禁/构建阶段。CNB absence 不读取会对不存在版本也返回 200 的 SPA release 页面，而是对精确 18 项规范 download URL 做 15 秒超时的有界 HEAD：仅 **18 项全部返回 404** 才证明不存在，任一 2xx/3xx 是副作用，410、5xx、网络异常或观测数量不是 18 均为 unknown 并 fail closed。任一条件不能证明或任何公开副作用已发生都 fail closed；启动时已有本地或远端 Tag 即使候选 run 成功也默认视为外部 Tag 并拒绝。唯一例外是 `immutable-tag` 阶段已在 state 中预先 checkpoint 同一 `sourceRevision`、`requestId`、`runId` 和操作类型的窄授权标记，随后发布器执行本地 create 或远端 push、但在完成阶段 checkpoint 前崩溃的窗口；恢复仍须重新验证同 SHA 的本地门禁、完整成功 run、五个 jobs 与制品证据。授权窗口不允许不同 SHA、不同 run、缺少本地 Tag 的远端采用或任何 Tag 移动。Tag 创建后仍维持绝对不可变，只允许恢复同一成功 source run 的制品；恢复 draft 时逐个保留大小/digest 一致的资产、只补缺失项，因此上传中断后仍可续跑。可变 `release-retry/*` push 入口已移除；如 Tag 后必须修复恢复基础设施，只能由统一发布器调度恢复工作流，云端会再次校验发布器修复提交相对产品 Tag 只改动白名单内的发布基础设施文件。Inno Setup 固定 6.7.0 时显式允许从托管 Runner 预装的更新版本降级，避免镜像更新导致伪失败。

## 4. 正式 Android

GitHub 仓库 Actions Secrets 必须已有：

- `ANDROID_RELEASE_KEYSTORE_BASE64`
- `ANDROID_RELEASE_KEY_ALIAS`
- `ANDROID_RELEASE_STORE_PASSWORD`
- `ANDROID_RELEASE_KEY_PASSWORD`
- `ANDROID_RELEASE_CERT_SHA256`

**Publish Signed Android Mobile** 只接受统一发布器的 `workflow_dispatch`，不监听产品 Tag push。发布器必须先持久化唯一 requestId，再传入精确 Tag、requestId，以及本机已验收的正式 Windows Release/portable 七字段身份；只采用 `display_title`、workflow 路径/ID、事件、head SHA 与 Tag ref 全部匹配该请求的运行。工作流先检查全部 Secret，并等待经过桌面矩阵和 iPhone/iPad 模拟器门禁的 Release 最多 90 分钟；它在上传前和公开 APK 复核后重新查询 GitHub，确认正式 Windows 身份没有漂移。随后强制验证 `io.harnessdesktop.mobile`、从桌面版本推导的 versionCode/versionName、长期证书固定指纹和 `apksigner`，然后只在资产尚不存在时加入：

- `Harness-Mobile-<version>-android-universal.apk`
- `Harness-Mobile-<version>-android-universal.apk.sha256`

桌面 `SHA256SUMS.txt`、APK 和 APK 独立校验文件一经公开均不覆盖。安全重跑遇到已有 APK 时重新下载既有字节核验并可补齐缺失校验文件；若只存在校验文件，则本次 Tag 构建的 APK 必须与其哈希一致才允许补齐。首次上传后也从公开 URL 重新下载并验签、验包名、验版本和 SHA-256。

## 5. 生产组件密钥保管

一次性生成命令只写受保护目录，拒绝覆盖；私钥、AES-256-GCM 加密备份和恢复密钥必须使用三个不同目录：

```powershell
node scripts/create-component-signing-key.mjs `
  --private-dir <受 ACL 保护的私钥目录> `
  --backup-dir <准备提交到私人备份仓库的加密目录> `
  --recovery-dir <与备份分离的恢复目录>
```

- `component-update-sources.json` 只能提交公开 SPKI 公钥。
- GitHub Actions 只通过 Secret `HARNESS_COMPONENT_SIGNING_PRIVATE_KEY_BASE64` 获取生产私钥（明文 PEM 的 Base64，仅在临时 Runner 文件中解码并用 `trap` 删除）；私人备份仓库只保存 `.encrypted.json`，绝不保存明文 PEM 或恢复密钥。
- 恢复演练必须在隔离临时目录解密并完成一次 Ed25519 签名/验签，随后删除临时明文。
- `gh auth login` 必须由用户本人完成。授权后用固定脚本创建/复核私有备份仓库并写入 Actions Secret；脚本只提交加密 JSON 与公开元数据，不复制恢复密钥或明文 PEM，也不在输出中打印 Secret：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/configure-component-signing-backup.ps1 `
  -PrivateKeyFile <明文私钥路径> `
  -EncryptedBackupFile <AES-256-GCM 加密备份路径> `
  -PublicMetadataFile <公开密钥元数据路径>
```

## 6. 生成生产组件与桌面签名清单

统一发布器在桌面和 Android 资产公开后，从不可变产品 Tag 调度 `publish-production-components.yml`，并显式传入同一 `productRevision`、已持久化的唯一 requestId 和本机验收得到的正式 Windows Release/portable 七字段身份；工作流只接受精确 `workflow_dispatch` 请求，不接受可变分支 push。Runner 在准备/上传组件前、签清单前以及全部公开/分支副作用后重新查询 GitHub 并核对该身份。GitHub Runner 从 Actions Secret `HARNESS_COMPONENT_SIGNING_PRIVATE_KEY_BASE64` 创建一次性临时 PEM，确认它与 Bootstrap 内置公钥一致，再为 `win32-x64`、`darwin-x64`、`darwin-arm64` 生成：

- 不可变 `desktop-shell-<version>-<target>.zip`
- 不可变 `components-<version>-<target>.json`
- `COMPONENT-SHA256SUMS.txt`
- 精确绑定全部 18 项公开资产的签名 `release-manifest.json`

私钥只存在于受保护 Runner 的临时文件并由 `trap` 删除。签名清单提交到 `release-manifest/v<version>` 临时分支；发布器只在该提交是不可变产品 Tag 的直接子提交、只修改 `release-manifest.json` 且内置公钥验签通过时，才快进 `main`。本地发布机器不需要也不得从 GitHub 导出生产私钥。

每个目标的完整包兜底必须使用同架构 EXE/DMG，禁止跨架构复用。

## 7. 组件与稳定指针的强制顺序

1. **先有可信完整 Bootstrap**：GitHub/CNB 的 v1.0.29 完整安装包均已下载验哈希。
2. 受保护 GitHub Runner 从不可变产品 Tag 在临时目录生成三个组件 ZIP、三个目标清单和 `COMPONENT-SHA256SUMS.txt`；不使用可变 `component-publish/*` 分支，私钥、临时 staging 和恢复资料永不进入 Git。
3. `Publish Verified Production Components` 工作流先重验发布器传入的正式 Windows 身份，再用内置公钥、精确文件集、SHA-256、ZIP 索引、目标架构、CNB/GitHub URL 顺序和完整包兜底绑定复核。ZIP 时间戳和清单 `publishedAt` 固定到 Tag，使重跑字节确定；已存在资产只有与本次确定性签名产物大小和 digest 完全一致才保留，只补齐缺失项，上传后重新下载复核。签清单前及工作流结束时再验正式 Windows 身份；尾部漂移会使工作流失败，发布器下一阶段也会失败关闭，不采用其清单或提升 stable。
4. GitHub Runner 使用现有 Actions Secret 为精确 18 项 `release-manifest.json` 添加域分离的 Ed25519 签名；发布器校验签名分支父提交、唯一文件差异和内置公钥后快进 `main`，再运行 CNB 云端镜像并等待所有附件验哈希成功。
5. 只有 GitHub 与 CNB 两端资产都可用后，才把三个签名清单复制为：
   - `component-feeds/stable/win32-x64.json`
   - `component-feeds/stable/darwin-x64.json`
   - `component-feeds/stable/darwin-arm64.json`
6. 单独提交并推送稳定指针；验证 CNB raw 优先 URL 与 GitHub raw 后备 URL 返回完全相同字节。

稳定文件永远最后更新。同版本不同 SHA-256 是冲突而不是覆盖理由，必须发布更高版本。

## 8. CNB 云端镜像

- 禁止从本机向 CNB 上传 EXE、DMG、ZIP、APK 等大文件。
- 本机只推送 `.cnb.yml`、发布说明、清单和校验信息；`release-manifest.json` 的每项资产必须记录独立 `size` 与 `sha256`，CNB Runner 从 GitHub Release 下载后逐项验证；旧清单仅可回退读取同版本 `SHA256SUMS.txt`。
- 桌面清单迁移保持 JSON 顶层数组和既有 18 项资产字段不变，只给每条发布记录增加 `schemaVersion`、`kind`、`keyId`、`signature`。旧桌面版本会忽略新增字段并继续更新；启用新验签逻辑的版本对无签名、未知 key 或任何字段篡改一律 fail closed。
- 源码仓库可暂存未签名开发态清单，但它绝不能被生产更新器接受，也不得进入 CNB 镜像或发布完成状态。迁移发布必须先用旧客户端可读取的兼容格式生成签名清单，再分发强制验签的新桌面版本。
- 官方 `cnbcool/attachments:latest` 插件负责上传；流水线短期 `CNB_TOKEN` 自动注入、结束销毁。
- stable feed 提升后的第二次同步由发布器传入 `-StableOnly`，CNB Runner 只验证三份签名 feed；18 个不可变资产已由前一 `cnb-assets` 原子阶段完成镜像和逐项校验，不得再次全量下载。
- GitHub 桌面、APK 和七项组件资产全部公开并复核后，发布器从 GitHub API 的不可变 `sha256:` digest 生成精确 18 项清单，签名并自验；不得绕过仓库统一 `release:publish` 命令单独运行下面的内部脚本：

```powershell
node scripts/refresh-release-manifest.mjs --version=1.0.29
```

- 使用已登录的官方 `@cnbcool/cnb-cli` 启动并等待；`dist/SHA256SUMS.txt` 必须先替换为 GitHub 公开同名字节：

```powershell
npm run release:cnb-cloud
```

失败可安全重跑；已验证存在的附件跳过，只补缺失项。不得绕过大小或哈希失败。

## 9. 用户下载前最终核验

必须对 README、`release-manifest.json`、GitHub Release、CNB Release 和三个稳定组件 URL 做外部 HTTP 验证：

- 状态码成功、无重定向到登录页、无凭据或查询 Token。
- 文件名、Content-Length（若提供）、实际大小、SHA-256 与清单一致。
- Windows 安装版与便携版可启动并通过打包自检；正式 APK 证书/包名/版本正确。
- macOS Intel/Apple Silicon 云端自检成功，两个架构的 DMG/ZIP 均完成无签名结构核验且内含 `安装.command` 一键安装助手；iPhone/iPad 说明只指向 Safari 工作台。
- 生产清单签名有效，目标架构和兜底资产一致；健康激活、失败回滚、同版本冲突拒绝、完整包兜底均有测试证据。
- 新安装上自动本地记忆和七天缓存维护默认生效；托盘可以关闭、搜索、预览、单项删除、全部安全删除，敏感内容不入库。

全部核验完成后才把发布目标标记完成。若 GitHub/CNB 登录是唯一阻塞，保留状态文件和已验证产物，明确停在对应步骤，不得伪造“已发布”。
