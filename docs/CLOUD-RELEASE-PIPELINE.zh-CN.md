# Harness Desktop 全云端发布流水线

本文定义统一发布器的正式打包边界。目标不是把全部验证都移出本机，而是保证 **Windows、macOS、Linux、Android 与生产组件的正式发布包只在受审计的云端工作流生成**；本机不得生成、采用或上传正式二进制包。

## 1. 信任边界

### 本机允许执行

- 检查版本号、工作树清洁度、`origin/main` 快进关系与 GitHub CLI 登录状态；
- 执行 `npm run verify` 与 `npm run verify:release`；
- 创建并推送唯一的不可变产品 Tag；
- 读取 GitHub Release、签名清单与工作流状态；
- 提交由云端签名工作流生成并校验过的清单/稳定源元数据；
- 触发 CNB Runner 从 GitHub 直接镜像。

### 本机禁止执行

- 在统一发布器中调用 `npm run dist` 或编排器 `--through windows`；
- 生成 Windows 安装器、便携包、macOS、Linux、Android 或生产组件正式包；
- 下载 GitHub Actions 二进制到本机再上传；
- 把本机 `dist` 中的二进制作为 GitHub/CNB 发布输入；
- 移动 Tag、覆盖已发布资产或绕过签名/摘要/快照校验。

发布器进入 `local-source-gates` 时先删除遗留 `dist`，只运行编排器到 `verify`，然后断言 `dist` 仍不存在。`release:orchestrate --through windows` 仅保留为开发者手工复现工具，不属于正式发布路径。

## 2. 不可变状态机

统一入口：

```powershell
npm run release:publish -- plan --version <version>
npm run release:publish -- run --version <version>
npm run release:publish -- status --version <version>
```

状态文件为 `.release-state/v<version>-publish.json`，`packagingMode` 必须是 `github-actions-only`。阶段顺序固定为：

1. `local-source-gates`：清洁源码、源码/安全门禁，无本地包；
2. `immutable-tag`：快进推送 `main`，创建并推送唯一产品 Tag；
3. `desktop-cloud-builds`：GitHub Actions 在 Windows、macOS、Linux 构建，并在 iPhone/iPad 模拟器验证；
4. `desktop-publication`：等待整个源工作流结束；成功则采用公开 Release，失败但留下精确私有 Draft 时才运行恢复工作流；
5. `signed-android`：云端签名 Android；
6. `signed-components`：云端签名生产组件并要求精确资产集合；
7. `release-manifest`：采用云端签名的桌面清单；
8. `cnb-assets`：CNB Runner 直接从 GitHub 镜像全部资产；
9. `stable-components`：两端资产就绪后才提升签名稳定源；
10. `cnb-stable`：只同步稳定元数据；
11. `complete`：最终核对 GitHub、CNB、摘要、签名与下载地址。

每阶段开始、运行编号、Release 编号、提交和结果都原子写入状态文件。重复执行只恢复未完成阶段；任何身份不一致、摘要变化或已完成阶段异常都失败关闭。

旧状态中只要出现 `local-windows`（包括旧版本已误迁移出的 `local-source-gates=completed`），两者都会被移除并强制按新流程重新执行：先删除 `dist`，再运行仅到 `verify` 的源码门禁，最后确认 `dist` 仍不存在。旧本地打包成功绝不能替代新边界；状态一旦声明其他打包模式，发布器拒绝继续。

## 3. 提交、Tag 与云端运行绑定

- 发布器把 `productRevision` 固定为 40 位提交 SHA，并拒绝远端 Tag 移动；
- `release.yml` 始终 checkout `RELEASE_TAG`，`build`、`ios-simulators` 与 `stage-draft` 三处分别校验：
  - checkout HEAD 等于 Tag 解析后的提交；
  - `product_revision`（发布器显式派发）或正常 Tag 事件的 `GITHUB_SHA` 等于同一提交；
  - Tag 与 `package.json` 版本一致；
  - `HARNESS_RELEASE_PACKAGING_MODE=github-actions-only`；
- 发布器对断点中记录的每个 runId 都从 GitHub API 重新核对精确 workflow 名称、workflow 文件路径、事件类型、`headSha` 与 `headBranch`；桌面运行还必须有四个固定作业全部成功，其他同 Tag 工作流绝不能充当阶段证据；
- 私有 Draft 的 `tag_name`、`target_commitish`、名称、正文、预发布标志和资产快照必须精确匹配。

桌面和生产组件工作流均不接受可变发布分支 push。Tag 后基础设施恢复只能由统一发布器调度专用恢复工作流；本机与云端会分别校验修复提交只包含预定义的六个发布基础设施文件。

## 4. Tag push 与手工派发竞态

正常路径优先采用 Tag push 自动创建的云端运行。发布器等待最长五分钟发现与 `productRevision`/Tag 精确匹配且尚可复用的运行；只有未发现时才用 `workflow_dispatch` 派发，并同时传入 Tag 与 `product_revision`。

同一 Tag 使用 GitHub Actions concurrency 串行化。即使极端延迟产生第二个云端请求，后续 Draft 创建仍拒绝已有 Release 变更，发布器也只采用记录的精确运行；因此不会覆盖资产或把不同提交混入同一版本。失败运行只能由发布器显式重试，不得降级采用不完整作业。

## 5. 云端包与发布门禁

`release.yml` 的矩阵是唯一桌面正式包来源：

- `windows-latest`：安装器、便携包、解包自检、组件测试，以及当前版本安装/已安装包自检/卸载；
- `macos-latest`：Intel/Apple Silicon 的 DMG/ZIP 及未签名策略验证；
- `ubuntu-latest`：AppImage/DEB 与 Electron sandbox/浏览器安全验证；
- `ios-simulators`：iPhone 与 iPad 模拟器测试（不生成公开 iOS 安装包）。

云端聚合资产后生成 `SHA256SUMS.txt`，原子创建私有 Draft；恢复工作流在 Ubuntu 上重新下载九项桌面资产，逐项校验精确快照、大小、摘要和校验和，只把小型不可变 Draft 快照交给公开阶段。公开前再次确认 Draft 元数据和资产集合逐字节未变。耗时且不可观察的 Windows previous-stable 原位升级作业固定禁用，真实更新/重启健康/回滚由发布前本机 PR Preview 门禁负责。

Android 与生产组件由独立受保护环境/签名密钥工作流生成。最终 Release 必须恰好包含 18 项受信任资产，签名 `release-manifest.json` 的内容、密钥根与 GitHub 资产元数据必须一致。

## 6. GitHub 到 CNB

CNB 阶段只接受已验证的 GitHub Release 与签名清单。CNB Runner 云到云下载并上传资产；本机只发起 Runner，不承载二进制。每次真正进入 `stable-components`（包括跨会话恢复）前，发布器都会重新核对 GitHub 的精确签名 18 项集合、逐项 CNB URL/HTTP 状态/大小，并下载小型 `SHA256SUMS.txt` 核其签名摘要；任何远端漂移都在稳定源提升前失败。通过后才提升稳定组件源并以 metadata-only 模式同步，避免重复传输 18 项资产。

## 7. 失败与恢复原则

- 云端包失败发生在不可变 Tag 之后：产品源码修复必须提升新版本，不能移动 Tag；
- 只有发布基础设施的受限文件可走 Tag 后恢复分支；
- 运行失败、作业缺失、提交不符、Draft 不精确、资产重复/缺失、签名或摘要不符时立即停止；
- 不运行单个手工发布命令；重复统一发布器命令恢复状态；
- 稳定源提升之前必须确认 GitHub 公共 Release、CNB 资产、签名 Android、签名组件与精确清单全部完成。

## 8. 自动化验收

`tests/release-publisher.test.cjs` 和 `scripts/verify-static.mjs` 至少锁定：

- `packagingMode` 与阶段顺序；
- 本地阶段只到 `verify`、删除并拒绝 `dist`、不调用本地 `dist/windows`；
- 三个关键云端作业的 Tag/提交绑定；
- Windows/macOS/Linux 矩阵与 iOS 模拟器门禁；
- 不下载 Actions 二进制到本机；
- 私有 Draft 恢复、不可覆盖资产、完整运行后才恢复；
- 签名 Android、签名组件、精确 18 项清单；
- GitHub→CNB 云镜像与 stable-last 顺序。
