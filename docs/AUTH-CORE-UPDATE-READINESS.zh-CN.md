# 认证核心修复与官方依赖升级：更新发布前置核验

> 核验日期：2026-09-09  
> 结论性质：只读发布前置核验，不是认证根因分析、测试通过、发布批准或发布完成证明。

## 1. 结论

**当前维护工作树不能直接作为可更新版本发布，也不能把现有 `1.0.60` 候选称为对已安装 `1.0.61` 的升级。**

原因同时成立：

1. 当前运行安装已经是 Harness Desktop `1.0.61`；维护树的 `package.json` / `package-lock.json` 工作区版本却是 `1.0.60`，构成降版。
2. 当前维护树 `main` 停在 `c13249132532d73f26fdd5830fe6a225b5f51feb`，提交态根版本实际还是 `1.0.59`；工作区只是未提交地把根版本改为 `1.0.60`。
3. 在本报告取证时间点，当前工作树有 **73 个已跟踪变更条目、21 个未跟踪路径，共 94 个 dirty 条目**，且包含其他任务的并行改动；这是当时的安全基线快照，不代表整个协作完成后的最终数量。统一发布器要求干净、已提交且来源冻结的精确源码。
4. 正式 `v1.0.61` 已存在并公开，产品提交为 `a5161f075cedec5b4a42ea33ca8950a8beefac85`；既有 Tag 与资产不可移动、覆盖或重建。认证修复与依赖升级必须使用 **高于 `1.0.61` 的新集成版本**；在没有更高版本占用信息时，最低自然候选为 `1.0.62`，最终版本号仍须由负责人冻结。
5. 用户目标已明确官方依赖版本为 **`0.1.5-alpha.1`**。隔离整合证据中的 package/lock 已将 26 个根官方包与 230 个锁定包固定到该精确版本；发布前仍须从最终候选 lockfile 复验完整依赖图、resolved/integrity 与可复现安装结果。

因此当前状态为 **NOT READY / 禁止执行 publish run**。合法路线是：从现行正式稳定源码建立隔离、干净的新版本候选，纳入已审查的认证修复和已确认的 `0.1.5-alpha.1` 升级，完成最终 lock 复验、冻结和全部门禁后，才由统一发布器发布。

## 2. 实际版本与源码身份证据

### 2.1 当前工作目录与维护树

- `pwd`：`D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`
- 当前分支：`main`
- 当前 HEAD：`c13249132532d73f26fdd5830fe6a225b5f51feb`
- `git describe`：`v1.0.59-2-gc132491-dirty`
- 本地分支记录：相对本地 `origin/main` 为 `+0 / -11`
- HEAD 中 `package.json` 版本：`1.0.59`
- 工作区 `package.json` 与 `package-lock.json` 根版本：`1.0.60`（未提交修改）
- dirty 基线（本报告取证时间点）：73 个已跟踪变更条目、21 个未跟踪路径，共 94 个状态条目；这是时间点快照，不是整个协作结束时的最终计数。不得丢弃、覆盖、暂存或夹带其他成员改动。

### 2.2 正式 1.0.60 / 1.0.61 来源

本地现有对象和公开 GitHub 元数据一致表明：

- `v1.0.60` → `b48a423a5f0b9ad3ad06313c56e070e108780310`
- `v1.0.61` 是 annotated tag：Tag 对象 `144f16031fb7a8c49e9a0ab9e58b3f23a109d90f` → 产品提交 `a5161f075cedec5b4a42ea33ca8950a8beefac85`
- GitHub 公开 Release ID `383578560`：`Harness Desktop v1.0.61`，`draft=false`、`prerelease=false`，发布时间 `2026-09-06T12:40:49Z`，`target_commitish` 为上述产品提交，并公开桌面、Android 与组件等 18 项资产。
- 公开远端 `main` 与本地 remote-tracking ref 均为 `2d3deaa539fe0eec344acd155ea3e162025dde52`，提交说明为 `release: promote v1.0.61 stable components`，根版本为 `1.0.61`。
- 当前 `c132491` 是 `v1.0.61` 的祖先，少 9 个提交；`v1.0.61` 又少于现行 `main` 2 个稳定发布提交。

这补齐了“正式 `1.0.61` 来源是否存在”的问题：**存在，且当前 dirty 维护树不是该来源。** 新修复候选必须以发布时重新确认的现行 `main` 为基线，保留 `v1.0.61` 产品与 stable 推进历史，不能从 `c132491` 的旧树直接改版本发布。

公开证据：

- [GitHub v1.0.61 Release](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.61)
- [GitHub v1.0.61 Release API](https://api.github.com/repos/baiyuscc13724-max/deepseek-harness-desktop/releases/tags/v1.0.61)
- [GitHub v1.0.61 Tag API](https://api.github.com/repos/baiyuscc13724-max/deepseek-harness-desktop/git/ref/tags/v1.0.61)
- [GitHub main Ref API](https://api.github.com/repos/baiyuscc13724-max/deepseek-harness-desktop/git/ref/heads/main)

### 2.3 当前安装与运行时

只读文件元数据显示：

- 安装程序：`D:\Harness Desktop\Harness Desktop.exe`
- `FileVersion`：`1.0.61`
- `ProductVersion`：`1.0.61.0`
- 当前版本化 runtime 目录：`D:\Harness Desktop\HarnessData\runtime\1.0.61-win32-x64`（存在）
- 运行时 `@deepseek-ai/dsh/package.json`：`0.1.2-alpha.5`
- 运行时 `@deepseek-ai/dsh-code-runtime/package.json`：`0.1.2-alpha.5`

`v1.0.60`、`v1.0.61` 与现行 `origin/main` 的 lock 均把这两个官方模块固定到 `0.1.2-alpha.5`，其中 lock 的 integrity 分别为：

- `@deepseek-ai/dsh@0.1.2-alpha.5`：`sha512-MrD2rPhmjz+8Phs+d9lD9xL1qswCYjcSHMd96fF8NTdDm7FRRsU5QhLDR0x6U4JwGxEvee1pccuvbZY6NyEQhA==`
- `@deepseek-ai/dsh-code-runtime@0.1.2-alpha.5`：`sha512-ZRVuIDmYnyb30VDuFitd9/4oVId9qq2oQJj1boV/VCritu/fhrpx76S8MRaKmm8l66h299/XCTDkZ+z6tanmhQ==`

这与认证核验成员报告的“维护树与运行安装两处故障模块 SHA 相同”相容；本报告不重复认证根因调查，也不据此宣称修复已经生效。

## 3. 官方 `0.1.5-alpha.1` 目标与最终复验

用户目标已明确为完整 SemVer **`0.1.5-alpha.1`**，无需再次确认版本身份。现有隔离整合证据表明：

- package/lock 已将 26 个根 `@deepseek-ai/dsh*` 包与 230 个锁定包固定到 `0.1.5-alpha.1`。
- 公开 npm 元数据中的 `alpha` dist-tag 指向 `0.1.5-alpha.1`，该精确版本可见。
- 该隔离结果是整合输入证据，不替代最终发布候选的 lockfile、安装与 packaged runtime 复验。

发布冻结时必须从最终候选重新证明：所有预期官方包均为精确 `0.1.5-alpha.1`；lockfile 的 resolved/integrity 完整且来自批准 registry；可复现安装没有残留或意外混装 `alpha.5`；packaged runtime 实际装载同一冻结依赖图。禁止仅依赖浮动 dist-tag、只改两个顶层字段，或把隔离 lock 的统计结果直接当作正式制品验收。

## 4. 新修复更新的合法源码与版本路线

### 4.1 候选来源

1. 由负责人保护当前 dirty 树，先列明各任务所有权与最终纳入范围；不得清理、覆盖或顺手提交他人改动。
2. 在隔离、干净工作区中，以发布时重新确认的官方仓库现行 `main`（当前公开观测为 `2d3deaa...`）为基线；本核验没有执行 fetch/checkout。
3. 只纳入：
   - 已审查并可追溯的认证串用修复；
   - 已确认的官方依赖 `0.1.5-alpha.1` 精确版本升级；
   - 该修复/升级必需的回归测试、版本同步、发布说明和来源冻结。
4. 与认证修复无关的浏览器、手机、团队机制、预览或其他 dirty 改动，除非负责人逐项认定为本版本必要范围，否则留在各自任务中，不进入候选。
5. 新集成版本必须严格大于 `1.0.61`。如冻结为 `1.0.62`，根 package/lock、自有插件、Android/iOS 版本常量、UA、更新示例、发布说明、审计 fixture 等必须按仓库现有版本同步门禁一致更新。

### 4.2 冻结前技术条件

以下条件全部满足前，状态仍是 NOT READY：

- 最终候选中的官方依赖精确固定为 `0.1.5-alpha.1`，并从最终 lockfile 复验批准 registry 的 resolved/integrity；禁止浮动 dist-tag 作为发布输入。
- 认证修复的源码差异、依赖升级差异和必要测试差异均进入同一个干净候选提交链，且能从现行 `main` 安全快进。
- 依赖安装从 lockfile 可复现；官方依赖图无意外版本分裂、未审核 override、未知本地路径或未固定 tarball。
- 认证回归覆盖成员已确认的两处故障模块与串用边界；测试不能读取、记录或输出真实凭据、Token、验证码或完整认证材料。
- 生产边界验证另行完成：真实发布候选中的 packaged runtime 必须包含冻结后的依赖和修复，而不是只验证开发源码或当前 `1.0.61` runtime。任何需真实账号/凭据的最终人工验收必须由用户本人在受控环境完成，本报告及自动化不接触秘密。
- `git diff --check`、仓库常规验证、release audit、版本同步、来源/安全冻结以及统一发布器内置的本地源码门禁全部真实通过；不得把局部单测或本文替代发布门禁。
- 候选工作树在进入统一发布器前为 clean，所有纳入改动已由负责人审阅并提交；没有把本报告取证时间点观察到的 94 个 dirty 条目整体夹带进去。
- 发布说明明确：从 `1.0.61` 升级到新版本、官方依赖的旧/新精确版本、认证修复边界、仍未证明的现场条件与回滚边界。

## 5. 统一发布器只读核验

已执行且仅执行允许的只读入口：

```powershell
npm run release:publish -- plan --version 1.0.60
npm run release:publish -- status --version 1.0.60
npm run release:publish -- status --version 1.0.61
```

观察结果：

- `plan 1.0.60` 显示统一发布顺序为 `local-source-gates` → 云端构建 → 不可变 Tag → 桌面公开与正式 Windows 隔离自检 → 签名 Android → 签名组件 → 精确 18 项 manifest → GitHub 到 CNB 云镜像 → stable 最后提升。
- 当前 checkout 对 `1.0.60`、`1.0.61` 的本地 publish status 均没有可采用的 `sourceRevision` / `productRevision` / 已完成 phase；这只说明当前 checkout 没有相应可恢复状态，**不能推翻公开 `v1.0.61` Release 已存在的事实**。
- 没有执行 `run`、`resume`、发布内部阶段、上传、Tag、安装或 stable 推进。

`plan 1.0.60` 只是发布器契约观察，不是合法新候选：它低于当前安装版本。冻结新版本后，只能使用根 `package.json` 的精确新版本运行：

```powershell
npm run release:publish -- plan --version <新 package.json 版本>
npm run release:publish -- run --version <同一版本>
npm run release:publish -- status --version <同一版本>
```

实际发布必须遵循仓库唯一发布器。失败后重复同一 `run` 由原子状态续跑，不手工拆阶段；不移动/重建旧 Tag，不覆盖旧资产，不从本机向 CNB 上传二进制，不在双云资产完成前提升 stable。GitHub/CNB 登录及任何签名身份问题由用户本人处理，不在聊天或日志中提供秘密。

## 6. 安装、生效与进程边界

认证核心和 `@deepseek-ai/dsh*` 属于 packaged runtime / Node 模块加载边界。**只修改维护树、刷新 Web GUI、热重载插件或替换文档均不会让当前安装的认证核心升级生效。**

正式新版本发布后，用户侧至少需要：

1. 从受信更新入口安装/切换到严格高于 `1.0.61` 的正式版本；不能把 `1.0.60` 作为更新。
2. 完全退出旧 Harness Desktop 进程及其 runtime 子进程，再启动新安装；仅刷新页面不足以重新加载核心模块。
3. 新版本应使用自身版本化 runtime，而不是继续复用 `D:\Harness Desktop\HarnessData\runtime\1.0.61-win32-x64` 中的 `alpha.5` 模块。若更新策略复用缓存，必须以 manifest/digest 验证并强制切换到新冻结 runtime，失败时 fail closed。
4. 启动后只读确认 EXE File/ProductVersion、新 runtime 目录、两个关键官方包的精确版本与 lock integrity；随后执行 packaged self-test 和不含秘密的认证回归。
5. 对安装覆盖、用户数据保留、旧进程残留与回滚路径做明确验收。回滚不得把新数据错误地解释为旧认证状态，也不得记录或泄露凭据。

## 7. 需要用户/负责人最终决定或批准的边界

发布前仍需显式决定：

- 新产品版本号（必须 `> 1.0.61`，建议最低 `1.0.62`）及对应移动端/插件版本同步方案；官方依赖目标已明确为 `0.1.5-alpha.1`，不再是待决定项。
- 当前大量 dirty 改动中哪些属于本次认证修复更新；保护并排除其他任务改动的隔离/整合方案。
- 认证修复、官方依赖升级、回归测试与来源冻结的最终审阅结论。
- 何时允许统一发布器真正执行 `run`，以及用户本人完成 GitHub/CNB 登录、必要人工验收和安装重启的时间窗口。

这些决定完成前，不应生成、宣传或安装所谓“已修复更新”；更不能把旧 `1.0.60`、开发工作树或局部源码补丁描述成用户可更新的正式版本。

## 8. 本核验明确未执行

- 未调查或重述认证根因；未读取任何真实 credentials、Token、Codex auth 原文或验证码。
- 未运行真实模型、生产认证或生产网络流程。
- 未 fetch、checkout、stage、commit、push、Tag、上传、发布、安装或修改签名/认证配置。
- 未执行 `release:publish run`，未调用内部发布阶段，未下载或执行 Release 应用。
- 未修改发布机制或其他成员文件；本次唯一人工写入是本报告。
