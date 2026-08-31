# Agent Teams 多团队路由判定回执

## 定位与能力边界

Routing receipt 是**持久审计事实**，不是模型路由执行器。它记录 root 在一个普通直接用户目标开始前作出的 Level 1/2/3 判定及 team creation 结果，但单独不能强制、证明或重放实际模型选择。

Host 派生且工具输入不可覆盖的作用域：

- `rootSessionId`：精确 live top-level root；
- `turnKey`：当前 open turn 的 Host 摘要；
- `projectKey`：root 的 canonical project；
- Level 3 的 `teamId`：必须属于同一 fixed root/project。

公开输入只能声明判定内容，不能提交其他 root、project、turn 或 team 身份。`level`、理由、候选工作流数、显式用户团队请求和 creation path 均为 `decisionAuthority=model_declared`：它们是模型对当前 direct-human turn 的声明，不升级为 Host 证明或真正的 `human_attested` 事实。只有 root/turn/project 以及成功终态的 team 绑定由 Host 派生并交叉校验。

## Schema

Store v7 顶层 `routingReceipts` 最多 2048 条。每条严格 allowlist：

- `id`
- `rootSessionId`
- `turnKey`
- `projectKey`
- `level`: `level1 | level2 | level3`
- `reasonCategory`
- `explicitUserTeamRequest`
- `candidateWorkstreams`
- `creationPath`
- `outcome`
- 可选 `teamId`
- `decisionAuthority=model_declared`
- `createdAt`
- 终态可选 `finalizedAt`

同一 Host-derived root/turn 只允许一个判定。Level 1/2 的唯一合法 outcome 是 `recorded`，不得携带 team/finalizedAt。Level 3 支持显式两阶段：必须先写 `recorded`（不得绑定 team/finalizedAt），随后在不可变判定字段完全一致时恰好一次转为 `created | reused | failed`；不存在 recorded 时禁止直接插入终态。created/reused 必须绑定同 root 且 projectKey 精确相等的真实 team（缺失 project 也拒绝），failed 不得绑定 team。终态仅允许 outcome/teamId 完全相同的幂等重放，冲突终态 fail closed。

活跃窗口最多保留 2048 条明细。到达上限时只 rollover 已终态回执，按顺序把 `旧 chainHash + 完整旧回执` 纳入 SHA-256 链，并持久保存 `routingReceiptArchive.{version,count,chainHash,lastReceiptId,lastArchivedAt}` 后才移除明细。被 rollover 的完整 receipt 明细会被丢弃；当前 state 仅保留累计数量、链摘要和最后一条标记，不能从这些字段独立还原或逐条审阅已归档明细。该摘要可证明后续 rollover 按确定输入推进，但不是可重建的明细档案。未完成的 Level 3 `recorded` 不会被归档；若窗口全被未完成决定占用则明确拒绝，避免丢失可完成状态。

## 三层约束

- Level 1：`creationPath=none`，适用于简单、紧耦合或不可并行工作；
- Level 2：`creationPath=subagent`，适用于仅需一个辅助执行者；
- Level 3：`creationPath=team_start | team_bootstrap`。自动团队必须至少记录两个候选独立持续工作流；只有明确用户团队请求可覆盖该数量条件。

“两个工作流不相关”本身不构成 Level 3。仍需满足持续、可独立委派给不同可见成员，并需要跨回合协调/依赖/交接/状态追踪。receipt 记录的是判定类别，不把模型自述升级为 Host 证明。

## 创建路径

- `team_route_goal`：在 substantive work 前记录 Level 1/2 终态决定或 Level 3 的 `recorded` 初始阶段，要求当前 direct-human root turn；
- `team_start`：创建团队后自动把同一 Level 3、`creationPath=team_start` 决定 finalize 为 created 与真实 team；
- `team_bootstrap`：持久化 bounded plan、任务及成员后自动把同一 `creationPath=team_bootstrap` 决定 finalize 为 created/reused 与真实 team。

Level 1/2 receipt 不得绑定 team。Level 3 的 `explicit_user_team_request` 与 `candidate_workstreams` 必须由调用者显式提供并作为 model-declared 审计内容；实现不再以固定 `false` 或隐式 `2` 冒充事实。

## 校验与迁移

- routing receipt 使用严格字段、枚举、长度、ISO 时间与 SHA-256 project key 校验；
- Level/team/root/project 交叉引用必须一致；
- v1–v6 migration 添加空 `routingReceipts`，不伪造过去不存在的判定；
- store 串行 mutation 与 per-root-turn uniqueness 提供并发/OCC 安全。

## 负向覆盖

测试覆盖：伪造字段、错误枚举、Level 1/2 creation path 错配、Level 3 仅一个非显式工作流、同 turn 冲突判定、recorded→created 并发仅一次 finalization、终态 outcome/team 冲突拒绝、跨 root/project/team scope、2048 边界的有序 rollover 与重载后链摘要完整性，以及 model-declared/Host-derived 能力边界文案。
