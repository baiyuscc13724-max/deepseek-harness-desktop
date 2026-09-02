# Harness Desktop 全云端发布流水线

本文定义统一发布器的正式打包边界。目标不是把全部验证都移出本机，而是保证 **Windows、macOS、Linux、Android 与生产组件的正式发布包只在受审计的云端工作流生成**；本机不得生成、采用或上传正式二进制包。

## 1. 信任边界

### 本机允许执行

- 检查版本号、工作树清洁度、`origin/main` 快进关系与 GitHub CLI 登录状态；
- 执行 `npm run verify` 与 `npm run verify:release`；
- 创建并推送唯一的不可变产品 Tag；
- 读取 GitHub Release、签名清单与工作流状态；
- 在桌面 Release 已公开后，从其规范下载 URL 把正式 Windows x64 便携包下载到 `.release-state` 的版本/提交/运行隔离目录，并执行一次隔离自检；
- 提交由云端签名工作流生成并校验过的清单/稳定源元数据；
- 触发 CNB Runner 从 GitHub 直接镜像。

### 本机禁止执行

- 在统一发布器中调用 `npm run dist` 或编排器 `--through windows`；
- 生成 Windows 安装器、便携包、macOS、Linux、Android 或生产组件正式包；
- 下载 GitHub Actions 二进制到本机，或把正式 Release 验收副本再次上传；
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
2. `desktop-cloud-builds`：GitHub Actions 在 Windows、macOS、Linux 构建，并在 iPhone/iPad 模拟器验证；
3. `immutable-tag`：云构建全部成功后，创建并推送唯一产品 Tag；
4. `desktop-publication`：等待整个源工作流结束；成功则采用公开 Release，失败但留下精确私有 Draft 时才运行恢复工作流；
5. `local-formal-windows-validation`：只在 Windows x64 发布主机上下载已经公开的正式 portable x64 资产，绑定 Release/asset ID、size、GitHub SHA-256 digest 与 `productRevision`，以唯一 Electron/Harness 数据目录运行真实 `--self-test`；
6. `signed-android`：云端签名 Android；
7. `signed-components`：云端签名生产组件并要求精确资产集合；
8. `release-manifest`：采用云端签名的桌面清单；
9. `cnb-assets`：CNB Runner 直接从 GitHub 镜像全部资产；
10. `stable-components`：两端资产就绪后才提升签名稳定源；
11. `cnb-stable`：只同步稳定元数据；
12. `complete`：最终核对 GitHub、CNB、摘要、签名与下载地址。

每阶段开始、运行编号、Release 编号、提交和结果都原子写入状态文件。重复执行只恢复未完成阶段；任何身份不一致、摘要变化或已完成阶段异常都失败关闭。

`local-formal-windows-validation` 不读取 `dist`，也不接受 Actions artifact：输入只能是当前公开 GitHub Release 返回的规范 portable x64 asset。下载文件、双 profile 和 JSON 报告均位于 `.release-state/local-formal-windows-validation/v<version>/<productRevision>/<validationId>/`。报告必须同时满足 `ok=true`、`product.version=<version>` 且规定的每项 `checks` 都严格为 `true`，否则不能进入后续发布阶段。断点恢复和同一连续运行的每个后续阶段边界，发布器都会重新读取远端 Release/asset 元数据，并重新计算本地正式字节和报告摘要、重验报告内容；不能仅相信旧 checkpoint。发布器把 Release ID、portable asset ID/name/size/digest/URL 与 `productRevision` 原样传给 Android 和组件工作流；两者在产生公开副作用前以及工作流结束时再次查询 GitHub 并精确核对，发布器在工作流返回后还会重验。非 Windows x64 发布主机直接失败关闭。

如果正式 Windows 身份恰好在云工作流执行过程中漂移，云端尾部重验和发布器的下一阶段边界都会失败关闭。检测发生前已公开的 APK 或组件附件可能作为不完整 Release 留存，系统不会自动删除或覆盖它们；安全保证是不会采用签名 `release-manifest.json`、不会镜像/提升 stable、也不会把该运行标成完成。此时必须调查远端变更并发布更高版本，不能把“部分附件已存在”解释为 Release 已锁定。

旧状态中只要出现 `local-windows`（包括旧版本已误迁移出的 `local-source-gates=completed`），两者都会被移除并强制按新流程重新执行：先删除 `dist`，再运行仅到 `verify` 的源码门禁，最后确认 `dist` 仍不存在。旧本地打包成功绝不能替代新边界；状态一旦声明其他打包模式，发布器拒绝继续。

## 3. 提交、Tag 与云端运行绑定

- 发布器把 `productRevision` 固定为 40 位提交 SHA，并拒绝远端 Tag 移动；
- `release.yml` 始终 checkout `RELEASE_TAG`，`build`、`ios-simulators` 与 `stage-draft` 三处分别校验：
  - checkout HEAD 等于 Tag 解析后的提交；
  - 发布器显式派发的 `product_revision` 与 `GITHUB_SHA` 等于同一提交；
  - Tag 与 `package.json` 版本一致；
  - `HARNESS_RELEASE_PACKAGING_MODE=github-actions-only`；
- 发布器对断点中记录的每个 runId 都从 GitHub API 重新核对精确 workflow 名称、workflow 文件路径、事件类型、`headSha` 与 `headBranch`；桌面运行还必须有四个固定作业全部成功，其他同 Tag 工作流绝不能充当阶段证据；
- 私有 Draft 的 `tag_name`、`target_commitish`、名称、正文、预发布标志和资产快照必须精确匹配。

桌面、Android 和生产组件工作流均不接受产品 Tag push 或可变发布分支 push。Tag 后基础设施恢复只能由统一发布器调度专用恢复工作流；本机与云端会分别校验修复提交只包含预定义的发布基础设施白名单。

## 4. 唯一派发请求与运行身份

桌面候选、Android 签名和生产组件工作流都只有 `workflow_dispatch` 入口。发布器在派发前先把唯一 `requestId` 写入断点，并分别要求精确 `display_title`、workflow 文件路径/ID、`workflow_dispatch` 事件、head SHA 与 ref；恢复只能采用该持久化请求对应的唯一运行，不能因相同 Tag 或相同提交采用其他运行。Android 和组件还必须携带前述正式 Windows 七字段身份；终止失败的精确请求只能由发布器有界地换新 requestId 后重派。

同一 Tag 使用 GitHub Actions concurrency 串行化。即使极端延迟产生第二个云端请求，后续 Draft 创建仍拒绝已有 Release 变更，发布器也只采用记录的精确运行；因此不会覆盖资产或把不同提交混入同一版本。失败运行只能由发布器显式重试，不得降级采用不完整作业。

## 5. 云端包与发布门禁

`release.yml` 的矩阵是唯一桌面正式包来源：

- `windows-latest`：安装器、便携包、解包自检、组件测试，以及当前版本安装/已安装包自检/卸载；
- `macos-latest`：Intel/Apple Silicon 的 DMG/ZIP 及未签名策略验证；
- `ubuntu-latest`：AppImage/DEB 与 Electron sandbox/浏览器安全验证；
- `ios-simulators`：iPhone 与 iPad 模拟器测试（不生成公开 iOS 安装包）。

云端聚合资产后生成 `SHA256SUMS.txt`，原子创建私有 Draft；恢复工作流在 Ubuntu 上重新下载九项桌面资产，逐项校验精确快照、大小、摘要和校验和，只把小型不可变 Draft 快照交给公开阶段。公开前再次确认 Draft 元数据和资产集合逐字节未变。耗时且不可观察的 Windows previous-stable 原位升级作业固定禁用，真实更新/重启健康/回滚由发布前本机 PR Preview 门禁负责。

Android 与生产组件由独立受保护环境/签名密钥工作流生成。两者仅接受发布器持久化的精确请求身份，并把本机已验收的正式 Windows Release/portable 身份作为必核输入；组件工作流在上传组件前、签清单前和全部副作用后重验，Android 在上传前与公开 APK 复核后重验。最终 Release 必须恰好包含 18 项受信任资产，签名 `release-manifest.json` 的内容、密钥根与 GitHub 资产元数据必须一致。

## 6. GitHub 到 CNB

CNB 阶段只接受已验证的 GitHub Release 与签名清单。CNB Runner 云到云下载并上传资产；除前述正式 Windows 本机验收副本外，本机不承载或转发发布二进制。每次真正进入 `stable-components`（包括跨会话恢复）前，发布器都会重新核对 GitHub 的精确签名 18 项集合、逐项 CNB URL/HTTP 状态/大小，并下载小型 `SHA256SUMS.txt` 核其签名摘要；任何远端漂移都在稳定源提升前失败。通过后才提升稳定组件源并以 metadata-only 模式同步，避免重复传输 18 项资产。

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
- 正式 Windows 验收严格位于 `desktop-publication` 之后和所有 Android/组件/清单/stable 阶段之前，只使用公开 Release 字节，并锁定大小、摘要、隔离参数和恢复重验；
- 三个关键云端作业的 Tag/提交绑定；
- Windows/macOS/Linux 矩阵与 iOS 模拟器门禁；
- 不下载 Actions 二进制到本机；
- 私有 Draft 恢复、不可覆盖资产、完整运行后才恢复；
- 签名 Android、签名组件、精确 18 项清单；
- GitHub→CNB 云镜像与 stable-last 顺序。
