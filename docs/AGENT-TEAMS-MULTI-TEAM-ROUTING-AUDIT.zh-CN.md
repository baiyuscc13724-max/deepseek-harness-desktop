# Agent Teams 多团队创建策略审计

## 范围与结论

本审计基于维护 checkout `release-v1.0.28-worktree` 中的源码，而非仅依据运行时提示。结论是：实现**没有“已有 active team 即禁止创建第二团队”的全局抑制**。`createTeam`/`team_start` 与 reviewed `team_bootstrap` 均按同一固定 top-level root 统计未关闭团队；只要当前直接用户 root 回合、Agent Teams 已启用且容量/输入校验通过，第二个无关目标可以建立为平级团队。

“已有 active team 时必须加到原团队”只适用于**该 active 团队目标仍需更多委派**的路由规范：成员不得自行创建团队；应向 root 发 `team_expansion_request`，由 root 在原团队内建立任务和正式成员。它不是 Host 对 root 的第二团队硬拒绝。

## 源码证据（维护 checkout）

- 硬常量位于 `plugins/dsh-agent-teams/lib/index.js:46-55`：`HARD_MAX_MEMBERS = 8`、`HARD_MAX_TEAMS_PER_ROOT = 8`，扩展/Bootstrap 的批次硬上限与成员硬上限同为 8；配置 schema `:122-126` 将 `maxMembers` 与 `maxActiveTurns` 限制在 1–8。
- 持久化校验 `:1087-1093` 按 `rootLeadSessionId` 统计所有非 `closed` 团队，超过 8 拒绝；这证明计数是“每个 root 的平级团队”，不是全局一队。
- `createTeam` `:2630-2667` 只要求启用状态并检查该 lead 的未关闭团队数；无“已有 active team”条件。其 `:2634-2635` 在第 9 个时返回 `AGENT_TEAMS_TEAM_LIMIT`。
- reviewed `bootstrapTeam` `:2980-3012` 使用同样的 root 计数（`:2994`），并分别检查本次成员数不超过 `maxMembers`（`:2995`）及所有团队活动 worker 回合不超过 root 共享 `maxActiveTurns`（`:2996`）。
- `activeWorkerTurnsForLead` `:2489-2495` 汇总该 root 所有未关闭团队的 provisioning/running/shutting_down worker；因此拆第二队不能绕过活动回合预算。`team_spawn` 的相同检查在 `:3114-3115`。
- root 身份与当前用户授权由 `requireDirectHumanRoot` `:2251-2260` 审核：调用者必须是 top-level root，且当前 open turn 含 `user/message` 且 `source.kind === "user"`。工具描述也明确 `team_start` 只在当前直接用户 root 回合使用（`:5080-5081`）。
- 创建路径契约在运行时系统提示 `:4409-4421` 与工具描述 `:5080-5107`：完整有界计划走 `team_bootstrap`，否则 `team_start → team_task_create → team_plan_commit → team_spawn`；同一团队不能混用两条路径。自动 Level 3 需至少两个持续、真正独立、分给不同可见成员且需要跨回合协调的工作流；只有一个辅助执行者走普通 subagent；显式用户要求可覆盖自动阈值。
- 同一团队内继续拆分必须走扩展请求：`validateExpansionRequestForDelivery` `:2536-2575` 要求当前 worker、其 in-progress 且归属自己的 source task，并同时消耗该队成员槽、root 共享活动回合槽和任务槽，另检查其它 in-progress 任务的文件边界冲突。实现没有把扩展请求变成第二团队。
- 第二团队之间只能是同一固定 root 的平级团队。跨团队依赖校验 `:1105-1111` 与 `requireCommonFixedLead` `:2523-2526` 禁止跨 root；提示 `:4421` 同时禁止嵌套团队。多团队存在时必须显式 `team_id`（`resolveTeamForCaller` `:2499-2504`）。
- 自动后续 recommit 的安全 gate 不是新团队创建 gate：`assertAutomaticPlanRecommitAllowed` `:2721-2730` 仅约束同一 canonical project、既有 worker、能力已验证、文件无冲突和 effect-free；它不证明/触发第二队创建。

## 可执行路由契约

| 客观条件 | 路由 |
|---|---|
| 简单、紧耦合或非并行 | root 主模型独立完成（Level 1） |
| 仅一个一次性/可持续辅助，且不需要多个可见责任主体与协调 | 普通 `subagent`/`subagent_fork`（Level 2） |
| 至少两个持续独立 workstream，需不同可见成员，且有依赖/交接/文件边界/汇总等跨回合协调 | 新 Agent Team；计划完整用 `team_bootstrap`，否则 `team_start` 后持久化任务并 CAS commit，再 spawn（Level 3） |
| 已有团队目标仍可容纳新增独立 workstream | 原团队 `team_expansion_request` → root 释放/重构父任务范围 → `team_task_create` → 可见成员 spawn |
| 已有团队与新目标无关，且新目标自身满足 Level 3 | 同一 root 创建第二个平级团队；不得因已有 active team 一律抑制 |
| 已达 8 个未关闭团队、root 非 top-level、非当前直接用户回合、Agent Teams disabled | 拒绝；典型错误码分别为 `AGENT_TEAMS_TEAM_LIMIT`、`AGENT_TEAMS_POLICY`/直接 root 错误、`AGENT_TEAMS_DIRECT_HUMAN_REQUIRED`、`AGENT_TEAMS_DISABLED` |
| 第二团队会使该 root 活动 worker 总数超过 `maxActiveTurns`，或本队成员超 `maxMembers` | 拒绝 `AGENT_TEAMS_ACTIVE_TURN_LIMIT` / `AGENT_TEAMS_MEMBER_LIMIT`；拆队不增加预算 |

## 规范与实现的边界

规范要求 root 在直接用户回合评估三层 gate，并禁止成员创建/派生团队；源码对 `createTeam` 本身主要落实 enabled、root、8 队上限，直接用户 root 检查在工具执行层完成。规范中的“目标相关性”“持续独立性”“协调成本”主要是路由决策责任，当前 Host 不会从 objective 语义自动判定。因此调用者不能把“工具接受了第二队”解释为模型已证明其必要性；应在计划/审计记录中保留独立 workstream 与协调理由。

## 测试

新增 `tests/agent-teams-multi-team-routing-policy.test.cjs`，以源码契约测试锁定：无 active-team 全局抑制、8 队按 root 统计、共享活动回合函数、root/直接用户 gate、两条创建路径互斥，以及 Level 1/2/3 与 expansion 的路由文字。测试只读源码，不改变调度核心。
