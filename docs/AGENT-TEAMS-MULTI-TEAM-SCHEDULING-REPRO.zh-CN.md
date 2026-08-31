# 已有 active team 时无关新目标的跨团队路由复现矩阵

## 复现范围

本报告只覆盖同一个固定 top-level root 收到一个**与已有团队无依赖的新目标**时的路由判定。测试使用 `AgentTeamsStore`、`createTeam`、`createTask` 与源码契约断言；不启动 child、不访问 GUI、不产生外部 effect。

## 判定矩阵

| 新目标形态 | 独立持续流 | 与旧 team 文件 | 容量 | 期望路由 | 负向契约 |
|---|---:|---|---|---|---|
| 普通单步 | 0/1 | 任意 | 任意 | Level 1/Level 2，留在 root 或普通 subagent | 不创建 peer team |
| 多轮但只有一个辅助流 | 1 | 不冲突 | 足够 | Level 2，普通 continuable subagent | 不创建第二 peer team |
| 两个以上持续独立流，需要跨轮协调 | >=2 | 不冲突 | 足够 | 创建第二 peer team；必须同一 fixed root、独立 durable tasks/members | 不塞入旧 team backlog，不嵌套 team |
| 两个以上独立流 | >=2 | 冲突 | 足够 | 不自动启动冲突写入；先拆分/释放父任务或由 root 选择串行方案 | 不绕过文件边界，不把冲突伪装为无冲突 |
| 两个以上独立流 | >=2 | 不冲突 | `maxActiveTurns` 不足 | 延迟/拒绝新成员或等待；不盲目创建 | 不突破跨 team active-turn 总预算 |
| 两个以上独立流 | >=2 | 不冲突 | 已有 8 个未关闭 peer teams | 拒绝第二（或后续）团队，错误 `AGENT_TEAMS_TEAM_LIMIT` | 不创建第 9 个团队 |
| 新目标只是旧 team 当前 objective 的缺口 | >=2 | 同一工作域 | 足够 | 扩员提案 → root 审批 → 旧 team 内建 task 后再 spawn | member 不能自行 `team_start`/`team_bootstrap` |

## 可观察证据

- `createTeam` 只按 `rootLeadSessionId` 与 `state !== "closed"` 计算 8-team 上限；因此无关目标不会因旧 active team 自动合并，也不会按最近团队猜测。
- `activeWorkerTurnsForLead` 汇总同一 root 名下全部未关闭团队；第二团队并不获得额外 active-turn 配额。
- `spawnMember` 需要显式非空 `taskIds`，任务必须先持久化、pending 且未分配；因此新目标不得以隐藏 backlog 或未持久化任务启动。
- `resolveUniqueLeadTeam` 在 root 同时拥有多个团队时要求显式 `team_id`，避免把无关目标路由到旧团队。
- 文件冲突仅阻止扩员提案与其他进行中任务边界重叠；跨团队创建的文件边界仍由 root 在审批时核对，不能宣称自动验证。

## 结论

第二 peer team **应创建**：新目标至少有两个持续、真正独立的工作流，跨轮协调收益超过上下文/模型成本，文件与外部资源边界明确且不冲突，且 root 的 team/active-turn 容量足够。

第二 peer team **不应创建**：目标简单或只有一个辅助流；只是并行但无需持续协调；与旧 team 的活动文件/资源冲突未解决；容量不足；或只是为了填满席位。若需求实际属于旧 team，应走 `team_expansion_request` 提案流程，而非 member 自行建团队。
