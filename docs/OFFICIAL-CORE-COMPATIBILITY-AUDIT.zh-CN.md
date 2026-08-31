# 官方最新核心兼容差异审计

> 审计对象：Harness Desktop 维护树 `release-v1.0.28-worktree`（审计时 `package.json` 为 `1.0.54`）  
> 官方唯一基准：`deepseek-ai/deepseek-harness` `dsh-v0.1.2-alpha.2` / `0a53fb55bea101816fa226bb964ae2bed71c343b`  
> 审计日期：2026-08-30  
> 性质：源码兼容性审计；不代表已经集成、打包或安装验证

## 1. 结论摘要

1. **旧截图不是基准。** 审计执行时官方最新公开 release/tag 已是 [`dsh-v0.1.2-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2)，发布时间 `2026-08-30T13:52:14Z`；tag 与当时 `master` HEAD 均指向 [`0a53fb55`](https://github.com/deepseek-ai/deepseek-harness/commit/0a53fb55bea101816fa226bb964ae2bed71c343b)。用户旧截图中的 `dsh-v0.1.2-alpha.1` / `cd5ef81` 仅是检索线索。
2. **官方 alpha.2 的核心架构升级是真实且成体系的。** `ApiProxy` 已被显式 Remote/Typert BFF 取代；会话历史流、控制 baseline 与日志派生 projection 分层；浏览器启动 token 交换为签名 cookie；PTC、逐 subagent 路由、ACP、SDK、压缩、token-meter 与不可变图片附件均有源码和包级约定。
3. **维护树不是 alpha.2 源码树。** 当前 `package.json` 仍固定官方 npm `0.1.1-rc.2` 组件，并通过 `scripts/patch-official-runtime.mjs` 对安装产物做受控补丁。因此“本地已有同名 npm 包”不等于“已具备 alpha.2 语义”。每项升级都必须按 Remote descriptor、event/projection、持久 schema、恢复语义和 UI carrier 逐一验证。
4. **官方 Agent Team 不能覆盖维护树自研 Agent Teams。** 官方包明确是“不进入正式发布、无稳定承诺”的单进程实验原型：一个顶层 Session 隐式对应一个 Team、共享 checkout、write scope 只警告、失败/退出不自动释放 owner、不支持独立 worktree、跨进程一致性或项目级任务。维护树则已有 durable plan/lease/effect fence、跨会话项目板、canonical-project 分片、强恢复、claim_next、协作请求和加密游标分页。该域必须**保留自研，只在适配层消费官方底层 Session/Subagent/Projection 能力**。
5. **最安全的演进顺序**是：先升级并锁定官方 runtime contract；再迁 Remote/Projection/Auth；随后启用 PTC、subagent route、压缩/token/图片；最后把 ACP/SDK作为附加自动化入口。任何阶段都不得用官方 experimental Team store 替换维护树 authoritative stores。

## 2. 基准、发布日期、许可证与可复核 URL

| 项 | 审计事实 | 证据 |
|---|---|---|
| 官方仓库 | `deepseek-ai/deepseek-harness`，默认分支 `master` | [仓库](https://github.com/deepseek-ai/deepseek-harness) |
| 最新公开 release | `v0.1.2-alpha.2`，prerelease，2026-08-30 13:52:14 UTC | [release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2) |
| 精确 tag/commit | `dsh-v0.1.2-alpha.2` → `0a53fb55bea101816fa226bb964ae2bed71c343b` | [commit](https://github.com/deepseek-ai/deepseek-harness/commit/0a53fb55bea101816fa226bb964ae2bed71c343b) |
| commit 时间 | 2026-08-30 21:37:53 +08:00 | 同上 commit metadata |
| 许可证 | MIT，Copyright (c) 2026 DeepSeek | [`LICENSE@0a53fb55`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/LICENSE) |
| 本地外壳许可证 | `package.json` 声明 MIT | `package.json:1-12` |
| 本地官方组件基线 | `@deepseek-ai/dsh*` 主要固定为 `0.1.1-rc.2` | `package.json:48-69`、`package-lock.json` |

MIT 允许使用、复制、修改、合并、发布、分发、再许可与销售，但复制或实质部分必须保留版权与许可声明。若直接移植官方源码，文件/发布材料必须保留该通知；若只升级 npm 依赖，仍应在第三方许可证清单中维持归属。

## 3. 审计方法与判定词

- 仅把 tag `0a53fb55` 的源码、README、测试和 release metadata 当作官方事实；不从名称、截图或本地同名符号推断等价。
- 本地证据均来自维护树 fresh-read；未运行 GUI、未安装、未发布、未修改产品或测试。
- **可直接采用**：边界独立，官方 contract 可作为新基线，最多改配置/导入。
- **适配层**：目标一致但 wire、生命周期、存储、UI 或权限模型不同，必须写显式桥接并做迁移测试。
- **保留自研**：本地能力超出官方范围，官方没有等价 authoritative contract。
- **不兼容**：若直接替换会丢失安全、持久性或生命周期语义；只能并存或拒绝。

## 4. ours → official 核心矩阵

| 能力 | 本地现状与路径证据 | 官方 alpha.2 源码证据 | 判定 | 迁移边界/缺口 |
|---|---|---|---|---|
| ApiProxy → Remote | lockfile 已含 `@deepseek-ai/dsh-api-remotes@0.1.1-rc.2`；自研 client 也使用 `ctx.remote.$on`：`plugins/dsh-desktop-browser-tools/lib/client.js` | `packages/api/remotes/README.md`；Host 选显式 Remote contribution，Client 通过 `ctx.remote.$mount()`，Gateway 拥有 transport/cancel/reconnect | **适配层** | 禁止把旧 ApiProxy method/event 名称机械替换；逐 namespace 比对 generated `/remote` descriptor 与 forwarded-event allowlist。可靠状态必须另有 query/cursor/opening baseline，普通 event 不 replay。 |
| 会话历史/控制/投影视图拆分 | 本地 UI 补丁直接作用于官方 bundled conversation/runtime：`scripts/patch-official-runtime.mjs:34-43`、`scripts/conversation-work-tree-patch.mjs` | `packages/api/session-controller/README.zh.md:26-32`；`packages/session/session-projection/README.zh.md:10-68` | **适配层** | 官方把 durable history stream、process-local control snapshot、log-derived projection 分开。现有 work-tree patch 必须重新定位到公开 record/projection seam，不能继续依赖 rc.2 bundle 私有文本锚点。 |
| 一次性 Web 启动 token | Desktop 目前主要依赖自有 Electron/Host 边界；仓内没有 alpha.2 `browser-auth.ts` 的直接实现证据 | `packages/client/connection/src/browser-auth.ts:12-20,52-57,69-97,256-263`；process-launch token 仅用于交换，随后写 authority-bound、签名、过期 cookie | **可直接采用 + Desktop 适配** | 采用官方浏览器 carrier auth；Electron 只负责安全传递启动 URL。不得把 query token持久化、写日志或复用于其他 authority。现有 Desktop 浏览器授权/分区策略是另一安全域，不得混为登录 cookie。 |
| PTC / `run_code` | 本地已依赖 `dsh-code-runtime@0.1.1-rc.2`，但没有 alpha.2 PTC contract 的本地等价证明 | `packages/core/tools/README.zh.md:62-77,119-125,167-198,221-227`，`packages/core/tools/src/ptc.ts` | **适配层** | 升级 `dsh-tools` + code runtime + SDK renderer 后才能启用。纯 PTC 必须拒绝原生直呼；子调用仍进完整 guard/pipeline。注意中间值无字节上限且不可回放，外层输出才受限；默认先 `both` 做兼容验证。 |
| 子代理 `provider/model/reasoning_effort` 参数 | 自研 Team 读取 `harness-desktop-model-routing.json`，解析 `main/subagent` tier，并把 route 注入 continuable `agentOptions`：`plugins/dsh-agent-teams/lib/index.js:70-72,164-227,3171,3435`；Desktop 路由服务写 `agentOptions` | `packages/subagent/tool-subagent/README.zh.md:43-69,83-105,134-148` | **适配层，保留策略层** | 官方提供逐 Session opt-in allowlist、`list_subagent_models` 与 provider capability check；ACP/Codex/Claude Code 明确拒绝 agentOptions，不能静默忽略。保留 Desktop main/subagent tier UX，但下沉到官方 model-selection policy；fork 仍不得任意换路由。 |
| ACP | 本地没有自研 ACP server 的 authoritative 实现证据 | `packages/acp/acp/README.md:10-12,25-55,163-172`；标准 ACP v1 over JSON-RPC stdio，持久 session、MCP、模型/推理选择、语义更新 | **可直接采用（附加入口）** | ACP 是 automation-only，不携带 DSH 私有 UI、plans/todos/terminal。不能用于替换 Desktop UI carrier，也不能承载自研 Project/Team 私有权限面。 |
| SDK / Windows | Desktop 是 Windows/macOS Electron 外壳并含本机 session launch IPC：`electron/bridge/agent-teams-session-launch-service.cjs` | `packages/sdk/README.zh.md`、`packages/bundle/sdk-app/README.zh.md`：TS/Python client + JSON-RPC stdio server/profile；官方 tag 中未发现“Windows 专用 SDK”contract | **并存；“Windows SDK 等价”不成立** | 可采用官方跨平台 SDK profile 做外部自动化；保留 Windows Electron bridge、进程树与本机 IPC。不得因 SDK 能在 Windows 运行就称其等价于 Desktop Windows SDK/Host bridge。 |
| 自动压缩 | 本地依赖 `dsh-compaction* 0.1.1-rc.2`，另有 `plugins/dsh-desktop-compaction` | `packages/compaction/compaction-basic/README.zh.md:10-12,28-89,101+` | **适配层** | alpha.2 增加路由模型窗口策略、overflow 后压缩再重试、tool-result pruner、surface replacement generation。需迁 config/schema 和事件语义；不能仅升级包版本后假设 Desktop compaction UI 数字仍一致。 |
| Token 计量/投影 | 本地 patch 脚本直接定位 `node_modules/@deepseek-ai/dsh-token-meter/lib/index.js`：`scripts/patch-official-runtime.mjs:40` | `packages/llm/token-meter/README.zh.md:10-12,34-51,76-99` | **适配层** | alpha.2 是 replay-aware per-session fold，提供 `tokenUsage/contextPressure/contextBreakdown` projection；图片按 adapter pricing，文本启发式并非计费值。删除/重写私有 patch 前必须核对投影 key、anchor 与 CJK 误差展示。 |
| 图片附件管线 | 本地官方 rc.2 attachment 依赖 + `dsh-codex-image-bridge`；`scripts/patch-official-runtime.mjs:5,10,38-39` | `packages/attachment/attachment/README.zh.md:10-12,28-48,60-80` | **适配层** | 采用“事件前批量规范化和持久化、不可变引用、读取时校验、确定性 route variant”。保留 Codex image bridge，但入口/输出都必须通过 attachment admission；不能持久化 browser path、provider URL、host path 或 base64。当前仅光栅图，且官方不自动 GC。 |
| 官方 experimental Agent Team | 本地 `plugins/dsh-agent-teams/lib/index.js` 是 Host-only durable coordinator，store v6，计划/权限/effect/lease/recovery 丰富 | `packages/experimental/agent-team/**`；README 明确单进程、共享 cwd、实验且不进正式发布 | **不兼容，保留自研** | 官方 Team 可作为参考或低层互操作对象，不能成为本地 store 真源。两套 task id、owner/revision、message exactly-once 范围都不同。 |
| Team roster/task schema | 本地 task 有 `claimId/leaseEpoch/submission/acceptance/capabilities/externalEffects`：`plugins/dsh-agent-teams/lib/index.js:94-120` | 官方 `src/types.ts:43-103,220-235` 只有 member phase、task revision/owner/deps/writeScopes 与 Lead Session 事件 | **不兼容** | 禁止 schema 直接迁移或双写。需要显式 adapter 时只投影最小只读交集；official task revision 不能充当本地 leaseEpoch。 |
| CAS 与任务依赖 | 本地 Team + Project Task 均有 claim lease/OCC；Project domain 有 RBAC、attempt、review：`project-task-domain.js:1-35,313-336` | 官方 `task-board.ts` 提供 revision CAS、DAG、owner 与 advisory overlap | **概念可借鉴，存储不兼容** | 只复用算法/测试思想；本地权限、提交/验收和 side-effect fence 不得降级。 |
| 成员失败恢复 | 本地 `MEMBER_RECOVERY_*` 包含 retry/replace、阶段 receipt 与 outcome_unknown：`plugins/dsh-agent-teams/lib/index.js:59-68,94-119`；架构文档 `:176-186` | 官方失败 provisioning 会持久化且名字永久占用；README `:188-200` 明确 idle/interrupt/process exit/work failure 不自动释放 owner | **保留自研** | 官方没有同等 retry/replace/lease revocation/explicit reconcile。不能把官方 inactive/failed status 映射为“已安全恢复”。 |
| 失败根恢复 | 本地 project recovery states、一次性 adoption capability、retry/takeover 与 Host evidence：`project-task-store.js:12-19,360+`、`project-session-launch.js`、架构文档 `:243-251` | 官方 experimental Team 没有 project root seat/takeover/recovery；只恢复隐式 root Session 后重放 Team log | **保留自研；官方无等价项** | 保持 observer-first、outcome_unknown 人工定案与 exact Host evidence；不能用 team spawn 模拟 replacement root。 |
| canonical project 分片 | `ProjectEntryRegistry` 对 canonical key 做 HMAC lane/project/key 派生并独立 SQLite/WAL：`project-entry-registry.js:6-17,50-170`；架构文档 `:235-241` | 官方 TeamId 只是 root SessionId：`packages/experimental/agent-team/src/types.ts:7-17` | **保留自研；不兼容** | 官方 Session/Workspace 可作为输入，但 laneRef/projectRef/store key 必须继续 Host-only；模型不得选择 lane。 |
| `claim_next` | 本地 Project Store 设 blocker/candidate bounds，架构约定单 SQLite `BEGIN IMMEDIATE`、公平 key、单活与持久 receipt：`project-task-store.js:15-17`、架构文档 `:150-154` | 官方 Team 只有按 id claim/release/complete，无 `claim_next` | **保留自研** | 不得用客户端 list→claim 循环替代事务 claim_next，否则有 TOCTOU 和单活破坏。 |
| 协作请求/接管 | 本地 kind=`dependency_unblock/release/handoff/takeover`，response=`accept/reject/release`：`project-task-store.js:18-19`；架构文档 `:148-152,247-249` | 官方 mailbox 是 member-to-member quiet/wakeup；无 owner deadline escalation 或 root takeover | **保留自研** | mailbox 消息不等于 request 状态机；不得从“消息已投递”推断 ownership/seat/task 已迁移。 |
| 任务游标分页 | 本地 state/page/SSE，AES-256-GCM 游标绑定 project+revision，120项/128KiB：`project-task-web.js:6-18,41-62`、架构文档 `:127-142` | 官方 Remote README 明确普通 forwarded event 不 replay，可靠恢复需 owner query/cursor/opening baseline；experimental Team view 是一次点时快照，无项目分页 | **保留自研；与 Remote 做适配** | 把分页作为独立 data protocol，不伪装 unary Remote。SSE 只做 invalidation；cursor stale/foreign/tampered 必须 fail closed。 |
| 跨会话项目任务视图 | 本地唯一“跨会话任务”聚合，Project Board 与私有 Team 分离：架构文档 `:144-156`；client `workspaceFlow`/分页文案 | 官方 Session Controller 管单 Session address；experimental Team 隐式绑定单 root Session | **保留自研，UI 需适配官方 Session stream** | 可用官方 Session history/control/projection 驱动单会话卡片，但项目级聚合与安全摘要仍由本地 Host authoritative API 提供。 |
| 请求接管与真实顶层 Session 启动 | 本地 Host IPC 有 token、canonical binding、slot/operation ledger：`project-session-launch.js:6-26`、`electron/bridge/agent-teams-session-launch-service.cjs:7-38` | 官方 subagent/Team 只创建 child；ACP/SDK 可创建普通 session，但无本地 project seat reservation contract | **保留自研；仅底层启动适配** | 可以把实际 session create/resume 委托官方 Session/SDK，但 reserve→launch→ready→adopt 的事务与证据仍归本地。 |
| 权限/身份 | 本地 Project domain 禁止 caller 提交 session/user/actor/role/authority 字段：`project-task-domain.js:11-35`；Web 同样禁止身份键：`project-task-web.js:21-29` | 官方 Team 每个方法接收 exact live Agent，Lead-only spawn/reassign/interrupt；Remote/Session Controller own identity policy | **适配层 + 保留自研 RBAC** | 使用官方 live Agent/Session resolver 作为底层身份来源；项目 actor、RBAC、lane authority、handoff token 仍由 Host 派生，不能接受模型自报。 |
| 持久化/迁移 | 本地 Project SQLite schema v12、Team store v6、legacy lane migration/backup；`project-task-store.js:8+`、`project-entry-registry.js:26-48,108-170` | 官方 Team 真源为 Lead Session event log；projection/checkpoint cache另成 seam | **不兼容，分库保留** | 不做覆盖迁移。升级官方 Session persistence 时只迁官方 session store；本地 project/team store 独立备份、版本迁移和回滚门禁。 |

## 5. 重点差异详解

### 5.1 ApiProxy → Remote 不是重命名

官方 `packages/api/remotes/README.md` 定义的是应用级双面 BFF：Host 显式选择 generated contribution 和允许转发的 Cordis event；Client 只依赖 facade，并由 Gateway 拥有 descriptor validation、namespace service、invocation、stream、cancel/reconnect。该包还明确：

- Remote 只负责所选 capability，不拥有物理 transport 或 Host service discovery；
- forwarded event allowlist 是协议面的一部分；
- 普通 event 不 replay；需要可靠恢复的状态必须由 owner 提供 query、cursor 或 opening baseline；
- Client 业务包不能回穿 Gateway 实现。

因此迁移清单必须按“namespace/method/result/failure/event/recovery”逐项建立，不允许全局文本替换 `ApiProxy` 为 `Remote`。本地 Project Task 分页、Project Board 和恢复 ledger 应继续走独立数据协议，只在 Client 装配层与 `ctx.remote` 共存。

### 5.2 会话三视图

alpha.2 实际是三条不同一致性边界：

1. **Session history stream**：durable event/chunk record，先 follow 再 page，以 tail page 修复 gap；
2. **Session control stream**：queue/jobs/projection 的 process-local full baseline，重连整代 replace；
3. **Session projection seam**：Host 在 committed event 上增量 fold，client 获取 schema-validated complete current values，cache 用 `(key, stateVersion, seq)` 检查点。

本地 `conversation-work-tree-patch.mjs` 是针对 rc.2 compiled UI 的字符串补丁。升级时应把工作树的 durable facts 绑定 history，把 jobs/live state 绑定 control，把 todo/goal/token 等绑定 projection；不得把 process-local jobs 写成 durable history，也不得让 Client 自行 fold 官方已拥有的 projection。

### 5.3 官方 Team 与本地 Team 的不可替代性

官方源码中 `TeamId(rootSessionId)`、`team/member`、`team/task`、`team/message/queued|delivered` 都存于 Lead Session 日志；官方 README 还明确：

- 单进程、共享 cwd；
- writeScopes 只产生警告；
- roster 扁平不可变；
- 退出/失败不自动释放 task owner；
- mailbox 不保证多进程 exactly-once；
- experimental 包不进入正式发布且无稳定性承诺。

本地 store 反而以 plan revision/hash、pauseEpoch、claimId/leaseEpoch、submission/acceptance、capability、external-effect fence、handoff、recovery receipt 为核心。两者的“成员”“任务”“revision”是不同协议概念。允许的互操作最多是：使用官方 continuable subagent/session 作为本地 member 的执行载体；禁止把官方 task board 作为本地 durable truth，禁止双写后按最后写入者胜出。

### 5.4 失败恢复

- **官方成员失败**：记录 provisioning failure，保留名字，可能恢复 root log/mailbox；不自动释放 owner。
- **本地成员失败**：retry/replace 受 claim/lease、checkpoint、发布边界和 outcome_unknown 约束。
- **本地失败 root**：需要 Host 真实 top-level operation evidence；retry observer-first 复用原 operation；takeover 必须先完成 request/ownership 迁移，再 reserve seat/task/locks、启动真实 top-level session，最后用一次性 capability adopt。

这三者不能共用一个 `recover()`。适配器应保留不同 error code、receipt 和人工确认面；特别是“官方 child 恢复成功”不能推导“本地 project seat 已 ready”。

### 5.5 PTC、Token 与图片是一条联合管线

PTC 把可见工具折叠为 `run_code` + deterministic SDK，但每个 binding call 仍进入完整 tool policy/pipeline。图片工具结果会在 run 后附加，其他中间结果不进入 conversation；而 token-meter 对图片只有在 adapter 声明视觉定价时才使用路由价格。图片附件又要求先规范化/持久化、再发布 session event。

因此联合验收至少应覆盖：

- PTC pure mode 中原生直呼返回 `UNKNOWN_TOOL`；`both` 同时暴露两面；
- binding 调用继承取消、guard、approval、timeout wrapper 与并发分类；
- 图片结果进入官方 attachment store 后才出现在 conversation；
- token projection 对图像 route pricing 和文本 heuristic 明确区分；
- compaction/pruner 不破坏 attachment ref，读取损坏时 fail closed；
- PTC 中间大对象内存风险有单独限制/测试，不能误以为 outer result byte cap 覆盖内部值。

## 6. 建议的兼容实施分层（不是本次实施）

### A. 可先引入的官方底座

1. 以精确 tag/锁文件更新官方 runtime，保存第三方许可证和供应链摘要；
2. 使用官方 Remote facade、Session Controller、Session Projection 和 browser auth contract；
3. 保持 Desktop Electron/Host security boundary 不变，只替换其下的官方连接装配。

### B. 必须经过适配的功能

1. conversation work tree → history/control/projection 三 seam；
2. Desktop main/subagent tier → 官方 `modelSelectionSettings`/`agentOptions`；
3. PTC → code runtime、SDK renderer、tool guard 与 UI result；
4. compaction/token/image → alpha.2 projection 和 immutable attachment contract；
5. ACP/SDK → 新的 automation-only 入口，不暴露本地私有 Project/Team API。

### C. 明确保留自研的 authoritative 域

- Agent Team plan/lease/effect fence、bootstrap/resume/handoff；
- failed member retry/replace 与 outcome reconciliation；
- canonical project lane 与独立加密 SQLite；
- Project Task RBAC/attempt/review/receipt；
- `claim_next`；
- collaboration request/takeover；
- failed root reserve/launch/adopt/recovery；
- authority-only keyset pagination、safe remote cache 与 SSE invalidation；
- 跨会话项目聚合 UI。

### D. 禁止的“兼容捷径”

- 不以同名 package/type/function 判断语义等价；
- 不把官方 Team `revision` 当成本地 `leaseEpoch`；
- 不把 mailbox delivered 当成 ownership/takeover 成功；
- 不把 ACP/SDK session create 当成 project root adoption；
- 不把 Remote unary method 伪装成分页/增量日志协议；
- 不把 heuristic token 数展示成计费值；
- 不把 query launch token 保存、记录或重复使用；
- 不复制覆盖维护树，不 merge/reset/rebase 官方 checkout。

## 7. 后续验收门（供独立实施任务使用）

| 门 | 必须证明 |
|---|---|
| 供应链 | lockfile 精确绑定官方版本/commit，MIT notice 完整，构建不引用审计临时 checkout |
| Remote | 所有 namespace/descriptor/failure/event allowlist 对齐；断线后状态由 query/cursor/baseline 恢复 |
| Session | history gap recovery、control generation replacement、projection checkpoint/version invalidation 均通过 |
| Auth | launch token 一次交换；cookie authority/expiry/signature/secure flags 正确；日志和 referrer 不泄漏 token |
| PTC | native/ptc/both schema、guard、取消、并发、结果大小、图片结果与中间值内存边界 |
| Subagent route | allowlist、provider capability、成对 provider/model、reasoning inheritance、fork 禁止变路由 |
| Compaction | threshold、manual、overflow retry、no-progress 停止、pruner 与 surface generation |
| Token | replay/fork/compaction、provider anchor、CJK heuristic 提示、image pricing、projection O(1) 一致性 |
| Attachment | 全批次原子准入、格式/像素/字节上限、immutable ref、corruption fail-closed、route variant |
| Agent Teams | 所有本地 store/lease/effect/recovery 不降级；官方 Team 包未成为 authoritative writer |
| Project | lane 隔离、legacy binding、claim_next 原子性、request takeover、root recovery、cursor stale/tamper/cross-project |
| UI | 跨会话看板只显示安全投影；分页不预取/轮询；项目切换清空旧 DOM；SSE 只触发 refetch |

## 8. 证据索引

### 8.1 官方 `0a53fb55` 关键路径

- `LICENSE`
- `packages/api/remotes/README.md`
- `packages/api/session-controller/README.zh.md`
- `packages/session/session-projection/README.zh.md`
- `packages/client/connection/src/browser-auth.ts`
- `packages/core/tools/README.zh.md`, `src/ptc.ts`
- `packages/subagent/tool-subagent/README.zh.md`, `src/model-selection*.ts`
- `packages/acp/acp/README.md`
- `packages/sdk/README.zh.md`
- `packages/bundle/sdk-app/README.zh.md`
- `packages/compaction/compaction-basic/README.zh.md`
- `packages/llm/token-meter/README.zh.md`
- `packages/attachment/attachment/README.zh.md`
- `packages/experimental/agent-team/README.zh.md`
- `packages/experimental/agent-team/src/types.ts`
- `packages/experimental/agent-team/src/task-board.ts`
- `packages/experimental/agent-team/src/lifecycle.ts`

所有链接可从固定 commit tree 进入：[`tree/0a53fb55`](https://github.com/deepseek-ai/deepseek-harness/tree/0a53fb55bea101816fa226bb964ae2bed71c343b)。

### 8.2 维护树关键路径

- `package.json`, `package-lock.json`
- `scripts/patch-official-runtime.mjs`
- `scripts/conversation-work-tree-patch.mjs`
- `electron/bridge/model-routing-service.cjs`
- `electron/bridge/agent-teams-session-launch-service.cjs`
- `plugins/dsh-agent-teams/lib/index.js`
- `plugins/dsh-agent-teams/lib/client.js`
- `plugins/dsh-agent-teams/lib/project-task-domain.js`
- `plugins/dsh-agent-teams/lib/project-task-store.js`
- `plugins/dsh-agent-teams/lib/project-task-web.js`
- `plugins/dsh-agent-teams/lib/project-entry-registry.js`
- `plugins/dsh-agent-teams/lib/project-session-launch.js`
- `docs/AGENT-TEAMS-ARCHITECTURE.zh-CN.md`

## 9. 审计限制

- 本文是静态源码审计，没有运行 alpha.2 的官方 profile，也没有操作现有 GUI、安装包或发布流程。
- 本地工作树存在其他会话的大量未提交改动；本文没有修改、清理、暂存或解释这些改动。
- “可直接采用”仍要求独立集成任务完成构建、迁移、协议和安全测试；不等于本次已交付集成。
- 官方 experimental Agent Team 的 README 明示不进入正式发布；其 source availability 不等于 npm 发布/稳定支持承诺。
