# Agent Teams 任务提交协议与生命周期审计

## 结论

任务交付采用严格两阶段状态机：

1. worker 持当前 `claimId` / `leaseEpoch` 调用 `team_task_update(action=complete)`，只写入 `submission` 并把任务置为 `submitted`；
2. 固定 root 对当前、未过期、与 assignee/claim/lease 完全绑定的 submission 调用 `accept`，才写入 `acceptance` 并把任务置为权威 `completed`。

因此 worker complete、普通 report、消息送达、turn 成功、checkpoint 或 result 都不能自行完成任务、解锁依赖、允许优雅退休或产生成功 closure。

## 持久化 schema

Store v7 为每个 task 增加 `lifecycleLedger`。事件严格 allowlist：

- `claim`
- `submission`
- `acceptance`
- `reopen`
- `reject`
- `cancel`
- `release`
- `migration`

每条事件包含连续 `sequence`、ISO `at`、非负 `attempt`，并按事件类型强制 claim、lease、actor、owner epoch 与 bounded reason。ledger 最多 256 条且不删除旧事件。容量门禁按转换保留最短成功路径：claim 预留 submission+acceptance，submission 预留 acceptance，reject/release/reopen 预留下一轮 claim+submission+acceptance；acceptance/cancel 可使用最后槽位。因而 253 条既有历史仍能追加 254 claim、255 submission、256 acceptance 达到权威完成；同样也能在 255 submission 后由 force terminalization 写入 256 cancel 并清除当前 review 投影。持久化的 256 条非终态 ledger 会被 validator 拒绝，不会被“有界”策略锁死或覆盖/重编号旧历史。

当前投影中的 `submission` / `acceptance` 可在 reject、reopen、cancel 后清除，但 ledger 不被清除。旧事实不会被新 attempt 覆盖，也不能重新用作当前 acceptance。

## 状态与门禁

- `pending`：可分配/claim；不得携带当前 submission、acceptance、result 或 completedAt。
- `in_progress`：绑定当前 assignee、claim、lease。
- `submitted`：必须存在当前 task-scoped submission；仍视为未完成。
- `completed`：必须同时存在匹配的 submission、固定 root acceptance 与 completedAt。
- `cancelled`：终态但不代表成功；当前 submission/acceptance 投影被清除，历史仍在 ledger。

依赖判断只接受 `state === completed && taskAcceptanceMatches(task)`。同团队与跨团队 `blockedBy` 使用相同谓词。优雅成员退休要求其任务已独立验收；优雅团队关闭拒绝 submitted 或任何其他未完成任务。

## reopen / reject / OCC

- `reject` 只允许固定 root 对当前 `submitted` 任务执行；记录 ledger 后回到 pending，下一 claim 生成新 claim fence。
- `reopen` 只允许固定 root 对 authoritative completed 或 cancelled 执行；旧 submission/acceptance 保留在 ledger，当前投影清除。
- complete 的幂等重放只允许原 claimant 携当前 claim/lease；foreign、stale claim、stale lease 均 fail closed。
- store mutation 使用现有串行化/OCC 写入路径；并发 submit/accept/claim 不能绕过状态与 fence。

## 向后迁移

v1–v6 统一迁移到 v7：

- 为旧 task 生成有序 migration/claim/submission/acceptance ledger；
- 旧 `completed + submission + no acceptance` 降为 `submitted`，不发明 root 验收；
- 旧 `completed + 可证明 acceptance` 保持 authoritative completed，并补 owner epoch；
- 已关闭团队中的旧未验收完成会终态化为 cancelled，同时保留 submission ledger，并产生 forced closure 审计回执；
- migration 不删除旧 attempt、checkpoint 或 interruption 历史。

## UI

任务卡与详情将 `submitted` 显示为“待负责人验收 / Awaiting lead acceptance”，`completed` 显示为“已验收完成 / Accepted and completed”。责任面板使用原生 `<details>/<summary>` 和有序列表展示最近的 immutable lifecycle history，并为时间使用 `<time dateTime>`；键盘、ARIA 与小屏现有布局不变。

## 验证覆盖

相关矩阵覆盖：submission/acceptance 分离、foreign/stale fence、reject/reclaim、accept/reopen、ledger 保留与严格 schema、v1–v6 迁移、同/跨团队依赖、优雅退休/关闭、失败 turn/result、恢复、handoff owner epoch、UI 语义、并发 store 与路由 OCC。
