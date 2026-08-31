# 官方兼容核心端口：隔离源最终安全与回归验收

> 验收任务：`bf85595a-e0be-40a5-ba30-547dd3b43e9a`  
> 维护树：`D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`  
> 验收日期：2026-08-30  
> 结论：**PASS（465/465；0 fail；0 skipped；0 cancelled；0 timeout）**

## 1. 验收边界与独立性

本次只对维护工作树的隔离源快照做源码与 Node 行为验收，没有操作或读取当前 Harness Desktop GUI、当前运行时状态、已安装应用或打包产物；没有联网安装、打包、发布、提交、暂存、reset、rebase 或清理其他会话改动。

前置事实经 durable team projection fresh-read：端口实现任务 `081e8efb-f013-4b47-a9fe-f571bc6fcdb7` 已于 `2026-08-30T15:14:00.228Z` 由实现成员提交，并于 `2026-08-30T15:14:29.225Z` 获固定 root acceptance。本验收未把实现成员的 checkpoint、自报测试或成功 turn 当作最终证据。

Fresh-read 的已验收审计/契约包括：

- `docs/OFFICIAL-CORE-COMPATIBILITY-AUDIT.zh-CN.md`
- `docs/OFFICIAL-CORE-DEPENDENCY-MAP.zh-CN.md`
- `docs/OFFICIAL-CORE-ADAPTER-INTEGRATION.zh-CN.md`
- `docs/AGENT-TEAMS-SUBMISSION-AUDIT.zh-CN.md`
- `tests/official-core-ports.test.cjs`
- `tests/official-core-compatibility-contract.test.cjs`
- 生产实现 `plugins/dsh-agent-teams/lib/official-core-ports.js` 以及 `index.js`、Project Task/Collaboration/Entry/Web/Automation/Business Sync 调用链。

## 2. 隔离源快照与摘要

### 2.1 快照

- 维护树 Git HEAD：`7245b663117b6dfad2bd932bbc65f623555869cd`
- 分支：`release/v1.0.50`
- 隔离目录：`D:\Harness Desktop\HarnessData\temp\official-core-final-acceptance-20260830-231914\source`
- 源清单：`D:\Harness Desktop\HarnessData\temp\official-core-final-acceptance-20260830-231914\source-manifest.sha256`
- 清单文件数：1,879
- 排序后 SHA-256 清单摘要：`69f1b29facd9578cff017138aa0f9706ee0bc8637ef7dd7a100e9ffa1365b5f0`
- `robocopy` 退出码：1（成功，存在复制项）
- Node 环境：`v24.16.0`、`win32`、`x64`、V8 `13.6.233.17-node.49`、module ABI `137`

维护树包含多个会话的未提交改动，因此本报告绑定上述**工作树内容清单**，不把 Git HEAD 单独冒充被测内容。

### 2.2 明确排除项

快照排除 `.git`、`node_modules` 实体、`dist`、`build`、`out`、`coverage`、`.release-state`、`*.log` 与 `*.tmp`。为避免联网安装，快照内 `node_modules` 是指向维护树依赖目录的共享依赖 junction：junction Attributes 为 `Directory, ReparsePoint`，目标 Attributes 为 `Directory`。本次命令仅以读取方式使用该依赖目录，但操作系统只读属性或 ACL **没有**强制这一点；`node_modules` 不在 1,879 文件源清单内。因此本验收是 **source-isolated / dependency-shared**，不是 hermetic dependency snapshot，不能宣称依赖本身已隔离、防写或被该源摘要覆盖。共享依赖不作为官方 alpha.2、本机 runtime 或产品行为等价证据。没有读取或执行已安装 Harness Desktop、当前 GUI 或发布包。

### 2.3 关键源防漂移复核

测试结束后，维护树与隔离快照的关键文件 SHA-256 全部相等：

| 文件 | SHA-256 |
|---|---|
| `official-core-ports.js` | `2db76001fcc8ec7618d71c792c8325d2686399e1c21e1d8ae45192c3233c1ae6` |
| `index.js` | `f7def7d17af70243db471f4aa8a7e965bdfde28bbbba7de567857ea0464e2570` |
| `project-task-store.js` | `0961e342d65519d122cdc51791662f9d4a3434485bb84318588411d394076ccd` |
| `project-task-web.js` | `edd3617a75661852aabb8d26e03b796525bdf7351768fc071a82a2b30159bf75` |
| `official-core-ports.test.cjs` | `d09e363c07e299b46998bb8b5a5b5ad5c894ab7fe1d8d41a4de721df6d52b476` |
| `official-core-compatibility-contract.test.cjs` | `29e61b79d710dbe8e8c38a083efb07b02ed60be02cb5fc1bdd19d0fb06fa51c6` |
| `official-core-isolated-acceptance.test.cjs` | `a5597894725b64f3a0c25632310fac138be1c9d34ffefd297fddca2c61960482` |

## 3. 新增恶意与负向探针

新增 `tests/official-core-isolated-acceptance.test.cjs`，不修改或弱化原断言，独立覆盖：

1. unknown/custom-shadow/official-shadow/multiple-primary provider 均失败关闭，只有 module-private brand 创建的 custom primary 被承认；同形 duck port 不能冒充。
2. provider descriptor getter 不执行；fake/accessor provider 不得借属性读取产生副作用。
3. execution 即使把 secret 放进不可枚举 own key 也因 `Reflect.ownKeys` 被拒；外层 context getter 不执行，失败清理 exactly once。
4. `ProjectTaskStore` constructor 失败时 context exactly-once dispose，且无数据库副作用。
5. continue/recover/reconcile 三条 recovery 路径对 inherited/own accessor/non-enumerable 控制字段失败关闭；`autoRetryUnknown` 全部拒绝且 effect 计数保持 0。
6. root recovery revision race 在任何 launch effect 前返回 `PROJECT_ROOT_RECOVERY_CONFLICT`。
7. raw actor/authority/role/project/session/user/execution/path/filePath/cwd/rootPath/workspacePath 输入失败关闭；跨项目 actor 失败关闭；executor 自批准失败关闭。
8. AEAD task cursor 对跨项目 replay 与 bit tamper 失败关闭。

专项结果：6/6 pass。

## 4. 独立 Node 进程矩阵

共启动 **10 个彼此独立的 Node test 进程 + 1 个独立 Node syntax-check 进程（11 次 Node 启动）**；结果未跨进程拼接为一个 pass。所有命令均以隔离 `source` 为工作目录；P01–P09 使用 `--test-concurrency=1` 保持各自进程内顺序可复核，P00 是单文件默认并发。后台并行只用于不同矩阵之间，不共享测试进程。

| 进程 | 原样命令 | 结果 | fail / timeout | 时长 |
|---|---|---:|---:|---:|
| S00 语法预检 | `node --check tests/official-core-isolated-acceptance.test.cjs` | pass | 0 / 0 | 未单独计时 |
| P00 恶意探针 | `node --test tests/official-core-isolated-acceptance.test.cjs` | 6/6 pass | 0 / 0 | 446 ms |
| P01 端口契约 | `node --test --test-concurrency=1 tests/official-core-ports.test.cjs` | 13/13 pass | 0 / 0 | 1,176 ms |
| P02 官方依赖契约 | `node --test --test-concurrency=1 tests/official-core-compatibility-contract.test.cjs` | 6/6 pass | 0 / 0 | 1,883 ms |
| P03 Project Task/持久层 | `node --test --test-concurrency=1 tests/project-task-domain.test.cjs tests/project-task-store.test.cjs tests/project-task-service.test.cjs tests/project-task-web.test.cjs tests/project-task-api.test.cjs tests/project-collaboration.test.cjs tests/project-authority-service.test.cjs tests/project-state-store.test.cjs tests/project-entry-service.test.cjs` | 118/118 pass | 0 / 0 | 18,152 ms |
| P04 Agent Teams/lifecycle/recovery | `node --test --test-concurrency=1 tests/agent-teams-domain.test.cjs tests/agent-teams-runtime.test.cjs tests/agent-teams-tools.test.cjs tests/agent-teams-lifecycle-hardening.test.cjs tests/agent-teams-stop.test.cjs tests/agent-teams-task-submission-protocol.test.cjs tests/agent-teams-top-level-session-launch.test.cjs tests/agent-teams-session-launch-caller-root.test.cjs tests/agent-teams-session-launch-service.test.cjs` | 120/120 pass | 0 / 0 | 15,981 ms |
| P05 security/multi-project | `node --test --test-concurrency=1 tests/agent-teams-cross-session-security-qa.test.cjs tests/agent-teams-cross-session-multi-project-qa.test.cjs tests/project-multi-project-isolation.test.cjs` | 10/10 pass | 0 / 0 | 7,597 ms |
| P06 UI/pagination | `node --test --test-concurrency=1 tests/agent-teams-ui.test.cjs tests/agent-teams-workbench-ui.test.cjs tests/agent-teams-cross-session-board.test.cjs` | 71/71 pass | 0 / 0 | 2,208 ms |
| P07 performance/continuous | `node --test --test-concurrency=1 tests/agent-teams-concurrency.test.cjs tests/agent-teams-performance.test.cjs tests/agent-teams-store-performance.test.cjs tests/agent-teams-cross-session-board-performance.test.cjs tests/agent-teams-cross-session-continuous-work.test.cjs` | 11/11 pass | 0 / 0 | 8,098 ms |
| P08 Automation | `node --test --test-concurrency=1 tests/project-automation-domain.test.cjs tests/project-automation-store.test.cjs tests/project-automation-service.test.cjs tests/project-automation-web.test.cjs` | 39/39 pass | 0 / 0 | 3,037 ms |
| P09 Business Sync | `node --test --test-concurrency=1 tests/project-business-sync-domain.test.cjs tests/project-business-sync-store.test.cjs tests/project-business-sync-service.test.cjs tests/project-business-sync-runtime.test.cjs tests/project-business-sync-api.test.cjs` | 71/71 pass | 0 / 0 | 10,641 ms |

汇总：**10 个 Node test 进程中的 465 tests 全部通过；另有 1 个 Node syntax-check 进程通过；合计 11 次 Node 启动，0 fail，0 cancelled，0 skipped，0 todo，0 timeout**。

## 5. 关键合同结论

### 5.1 Provider、Host identity 与恢复

- `custom-authoritative-v12` 继续是唯一 primary；official 自报 alpha.2/tag/commit/runtimeEquivalent 不能成为本机 runtime 证明。
- 无 provider、unknown provider、official provider、fake/duck/accessor/incomplete/multiple primary 和裸 dual-write 均失败关闭。
- Host execution 为冻结、null-prototype、零 own key、JSON `{}` 的 capability；context 同样不序列化内部 projectRef/databasePath/keyProvider/actorResolver。
- 公开边界不接受 raw actor/project/session/authority/role/path/cwd/workspace/execution；合法 project-relative evidence path 仍经真实 `project_collaboration` allowlist 接受。
- root/member recovery 与普通 Task 写分离；confirm-first 不替代 Host authority；所有 recovery 自动重试 unknown 均拒绝，observer-first reconciliation、receipt 与 exact revision 保留。

### 5.2 schema、WAL、legacy lane、receipt、锁与队列

- SQLite `user_version=12`、WAL、密文敏感字段、future schema 13 拒绝降级通过。
- command/event/claim_next receipt 精确重放与 drift conflict 通过；Automation/Business Sync 同样 receipt-first，不把未知 effect 当成功，也不盲目重复。
- legacy WAL snapshot 只绑定 exact lane，`copying → complete` 崩溃恢复、独立新 lane、显式 bind、16 canonical projects 均通过。
- 层级资源锁 SQL-bounded、跨项目隔离、同 root 单活、claim_next 并发无重复通过。
- Agent Teams admission/worker/Team operation tail、Automation runner、Business Sync outbox/pending reset/close drain 队列均有界且恢复通过。
- failed member/root recovery、Stop/resume epoch、one-time adoption capability、stale claim/lease、outcome_unknown fence 均通过。

### 5.3 分页、精确性与预算

- 任务 120、协作 section 24、响应 128 KiB 均保持为**单页/单窗口预算，不是项目容量**。
- 131 项 authority/跨项目遍历 exact+unique、组合 state 动态预算与八区最小进度通过。
- 157 refs 的用户驱动协作分页保持每个 incoming 当前页完整可见、全程 exact+unique，并保持 DOM/window 上限。
- 16 projects 的 SQLite/key/cursor/cache/SSE/launch ledger 隔离通过；跨项目、stale、tampered cursor 均失败关闭。
- 600/601、数千任务与 24 busy teams 的 keyset/索引/字节预算/performance 门禁通过，无全局项目扫描或全量锁查询回归。

### 5.4 Continuous work、安全与下游

- 三个真实顶层 root 连续 claim、单活与 fast-lane 前进通过。
- SSE backpressure/coalescing/cleanup、close drain、restart replay 与 safe projection 通过。
- Automation 人工批准、队列、effect identity、unknown receipt 与 crash recovery 通过。
- Business Sync 七类消息、加密 store、outbox、ACK、reset pagination、offline/restart/revocation 与 32 KiB wire repaging 通过。
- UI/工具仍走稳定端口与安全投影；官方兼容端口没有删除 Store/Service/Registry/StateStore，也没有使 official shadow 驱动 UI、写入或恢复。

## 6. 官方 alpha.2 与 MIT 边界

固定证据仍为 `deepseek-ai/deepseek-harness` tag `dsh-v0.1.2-alpha.2`、commit `0a53fb55bea101816fa226bb964ae2bed71c343b`、MIT；端口常量明确 `runtimeEquivalent:false`。本地 `package.json`/`package-lock.json` 仍固定主要官方 npm 组件 `0.1.1-rc.2`，所以本验收**不**宣称本机已安装或运行 alpha.2 等价 runtime。

本次没有复制 alpha.2 官方源码，只消费已验收审计中的 tag/commit/license 源码证据并验证本地 adapter 行为；因此没有新增 vendored 官方源码 notice。若未来复制或实质移植 alpha.2 源码，必须保留 DeepSeek MIT copyright/license notice，并重新做供应链、lockfile 与 runtime identity 验收。

## 7. 最终判定与限制

**最终判定：PASS。** 在上述隔离快照与矩阵范围内，未发现需要回派实现者的产品缺陷；原断言未弱化，所有关键负向探针均按预期失败关闭。

限制：这是 source-isolated / dependency-shared 验收，不是 hermetic dependency snapshot；共享 `node_modules` junction 未由操作系统只读属性或 ACL 强制防写，也不在 1,879 文件源摘要内。测试命令实际只读使用依赖，且测试后七个关键源哈希无漂移，但这些事实不能证明整个依赖树未变化。这也不是 GUI 目检、安装包验证、alpha.2 本机 runtime 验证、打包或发布授权；不改变 `OFFICIAL-CORE-COMPATIBILITY-AUDIT.zh-CN.md` 对官方 experimental Team 不可替代本地 authoritative stores 的结论。未来若源清单摘要、共享依赖、官方版本、provider admission、schema、公开 DTO 或恢复语义变化，必须重新制作隔离快照并完整复跑。
