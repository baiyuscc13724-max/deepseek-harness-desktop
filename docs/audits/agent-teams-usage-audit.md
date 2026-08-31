# Agent Teams 独立对抗审计与验收

> 状态：**最终独立 QA 全绿通过（2 项环境跳过已如实记录）。**
>
> 唯一证据工作树：`D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`。
> 先前其他工作树的任何结论均已撤销，不进入本报告。

## 已核验的功能与不变量

| 旅程 | 最终维护实现 | 独立结论 |
|---|---|---|
| 成员领取与提交 | `claimId`/`leaseEpoch` 围栏；五态协议；成员只提交，Root acceptance 才完成 | 通过 |
| 依赖与生命周期 | accepted completed 才解锁；ledger 追加；release/retire/Stop 保留边界 | 通过 |
| Stop/恢复/自动驾驶 | pause epoch 围栏、direct-human resume、durable waiter/outbox、project wake scheduler | 通过 |
| 跨会话/项目隔离 | caller Root、项目 HMAC、会话启动能力和公共投影均失败关闭/最小披露 | 通过 |
| UI 状态真实性 | `leaseEpoch=0` 可见，submitted 与 immutable lifecycle 可见 | 通过 |
| 精确工作树绑定 | parent exact-cwd anchor preflight 与 child durable cwd inheritance | 通过；`task.files` 非 ACL |
| Root 破坏性动作 | revision + state/claim/lease + pause epoch 围栏、receipt/replay/no-op 协议 | 通过 |

## 已确认并修复（独立证据）

### FIX-001 — 首代 `leaseEpoch=0` 的 UI 可见性

`client.js` 的 `taskBoardLeaseEpoch` 接受非负安全整数；
`tests/agent-teams-workbench-ui.test.cjs:1046` 断言 `leaseEpoch: 0` 投影为 `0`，而非“无租约”。
**独立结论：通过。**

### FIX-002 — Stop 后的迟到 submission 围栏

`tests/agent-teams-domain.test.cjs:1441` 覆盖 Stop 时间戳后才提交的任务，断言持久化状态回退为
`pending`，不保留为可审查交付。**独立结论：通过。**

### FIX-003 — 强制退休撤销 claim 时保留 release 审计 ledger

`tests/agent-teams-domain.test.cjs:252–254` 断言强制退休会清除当前 claim 投影，并追加包含旧
claim 的 `release` lifecycle event。**独立结论：通过。**

### FIX-004 — 队列会话启动在重启后继续推进

`tests/agent-teams-top-level-session-launch.test.cjs:308` 覆盖重启后的 status 重新驱动 queued
slot，不需要再次激活命令；同文件还覆盖 Stop 对 queued slot 的耐久取消。**独立结论：通过。**

## 候选缺陷

### AT-003 — 相对文件范围未绑定到精确 Host 工作树，可产生错误版本假成功（高）

- **证据**：`spawnMember` 调用 `startContinuable` 时只传递 parent、注册 prompt、
  tool filter 与可选 model（`index.js` L3393–3404）；后续 `workPrompt` 只含 team/member/task
  标识和自然语言 prompt（L3470）。未见 Host-derived `workspace`、`cwd` 或可验证文件范围。
  `task.files` 在该插件仅用于任务冲突检查和投影；成员不能调用 project-only
  `project_workspace_open` 取得受围栏的工作区。
- **复现**：根目录下存在同名 sibling worktree 时，成员可把相对 `task.files` 对应的读写
  定向到错误 worktree，仍可提交任务、获得 Root acceptance，团队投影显示成功而维护目标
  未变更。
- **影响**：跨版本/跨工作树错交付、审计证据与实际代码不一致；属于错误版本假成功，普通
  task completion 与报告无法检测。
- **修复验收标准**：成员创建、followup、claim 与提交/验收均应携带或校验同一 Host-derived
  opaque workspace/project binding；文件操作必须在该绑定的 exact workspace 内解析，越界或
  sibling workspace 应失败关闭；用户/UI 只显示安全的绑定状态而不泄漏路径。
- **建议归属**：架构（成员启动和 Host 合约），体验（安全、可见的目标工作区状态）。
- **状态（已重新评估）**：新增 spawn preflight 已独立运行
  `tests/agent-teams-planning-contract.test.cjs` 22/22 通过，覆盖 sibling-only anchor 拒绝与
  exact parent anchor 正向启动。另独立核验 runtime 1.0.54
  `@deepseek-ai/dsh-subagent/lib/types/child-agent.js:80–93`：`childSessionMeta` 将
  `parent.session.header.cwd` 持久复制到 child metadata，创建与 cold resume 共用此路径。
  因此“parent exact-cwd preflight + child durable cwd inheritance”足以闭合本次 sibling
  worktree 错版本假成功，**AT-003 针对此缺陷已通过**。

  **保留边界**：`task.files` 仍只是计划/冲突元数据，不是 danger-full-access 下的文件 ACL；
  本结论不声称成员只能写入所列 files，也不替代 Host 文件系统围栏。

### AT-004 — `temporarily_empty` 后没有可恢复的同项目可用任务唤醒（高）

- **证据**：`ProjectTaskStore.claimNextTask`（`project-task-store.js` L1002–1080）只持久化
  claim-next receipt，并可返回 `temporarily_empty`；`ProjectTaskCommandService.claimNextTask`
  （`project-task-service.js` L361–365）直接返回结果。代码和测试中未发现 waiter、outbox、
  subscription 或 root wake 机制。系统提示反而要求 Root 在 `temporarily_empty` 后不能停止，
  但不提供阻塞等待原语。
- **复现**：多个顶层 Root 均单活时，闲置 Root 获取 `temporarily_empty`；另一个 Root 随后
  完成或释放工作使任务可领。闲置 Root 不会被通知，自动驾驶只能忙轮询或等待人工“继续”。
- **影响**：跨会话工作停滞/人工介入；若通过非耐久轮询补救则会引入重复唤醒、重启丢失与跨
  项目串扰风险。
- **修复验收标准**：需有按 canonical project 绑定、持久去重且重启安全的 idle-root waiter/
  outbox；任务 create/release/完成/解除依赖时只唤醒一个仍 eligible 的 active Root。paused 或
  explicit no-wake Root 不得被唤醒；投递证据可重试且不重复派工；不同项目绝不互相可见或唤醒。
- **建议归属**：跨会话。
- **状态（已修复并独立通过）**：schema v13 durable waiter 已由 Host scheduler 接入所有
  project task mutation producer。独立运行 `agent-teams-runtime + project-task-store` 为 53/53
  通过：同项目精确 root、foreign project 隔离、inbox/history 去重、accepted-before-throw
  识别为 delivered、未知 enqueue 围栏为 outcome_unknown、singleflight、重启、pause、单/
  双 candidate 防惊群均已覆盖。actorRef 仅在 Host scheduler/store 绑定内使用，未进入公共
  投影。本项可以关闭。

### AT-005 — 过期 Root 破坏性转换可撤销新领取的租约（高）

- **真实事件**：Root 基于 pending 快照准备 cancel 后，worker 在 20:22:13 领取任务；过期的
  cancel 在 20:23:06 仍然成功，撤销了新 claim。
- **源码证据**：`team_task_update` 的 lead action 分支接受 cancel/reopen/assign/unassign，
  但工具参数和 `updateTask`（`index.js` L4041–4177）没有 `expected_revision`，这些破坏性
  转换也不要求预期 task state、claimId 或 leaseEpoch。相同文件的 plan/member-recovery 路径
  已使用 `expectedRevision`，形成明显不对称。
- **影响**：过期协调 UI/模型动作可覆盖新工作，造成租约丢失、重复派工或错误取消；Root 身份
  不应替代并发正确性。
- **修复验收标准**：对破坏性 lead transition 使用 Host-derived task revision 或当前
  state+claimId+leaseEpoch 的 CAS；冲突必须失败关闭并要求刷新。精确同请求重放须幂等，
  但不同/陈旧 command 绝不能影响新 claim。覆盖 claim-vs-cancel、claim-vs-reopen、
  claim-vs-assign、claim-vs-unassign、submitted-vs-reject，以及暂停 epoch 后的旧命令。
- **建议归属**：架构。
- **状态（已修复并独立通过）**：最终实现将 fixed-root destructive commands 纳入版本化
  command receipt；公开动作要求 revision、预期 state、claim/lease 和 pause epoch 围栏。全套中的
  `agent-teams-task-occ.test.cjs` 已覆盖 claim-vs-cancel、root release、external-effect 后 stale
  cancel、reopen/assign/unassign CAS、submitted accept/reject、durable exact replay、state-only
  拒绝与 pause-epoch CAS，均通过。AT-005 可以关闭。

## 已撤销的旧工作树结论

旧工作树中的“四态直接完成”结论不适用于维护目标。维护实现的
`TASK_STATES` 已包含 `submitted`，并具备 submission/acceptance 绑定和验收后解锁机制；
不得将旧结论作为缺陷或交付证据。

## 维护基线执行证据

```text
node --test tests/agent-teams-task-submission-protocol.test.cjs \
  tests/agent-teams-cross-session-security-qa.test.cjs \
  tests/agent-teams-session-launch-caller-root.test.cjs \
  tests/agent-teams-ui.test.cjs
```

结果：50/50 通过。

随后独立运行 UI、域模型与顶层会话启动回归：

```text
node --test tests/agent-teams-workbench-ui.test.cjs tests/agent-teams-domain.test.cjs tests/agent-teams-top-level-session-launch.test.cjs
```

结果：103/103 通过，覆盖 FIX-001 至 FIX-004。

关键既有覆盖：

- 成员提交受 claim/lease 围栏，只有固定 Root acceptance 转为 `completed`。
- submitted 成果不解锁依赖，且不允许优雅退役/关闭。
- 生命周期 ledger 不因 reopen/reject/cancel 清除。
- Host 会话启动能力不会泄漏到公共状态、诊断或 prompt。
- UI 任务详情能显示 submitted 与不可变生命周期。

## 最终复验结果

- 核心任务/存储/服务/Web/automation/business 集合：**115/115 通过**。
- 专属 `tests/agent-teams-usage-defects.test.cjs`：**5/5 通过**；覆盖 resume 同次 dispatch、Stop
  wake 清理与交错、Stop-before-lookup `paused` ack、有界 evidence scan、仅 `not_delivered` 的 `unref`
  指数退避及 scheduler disposer。
- 修正后的 `tests/agent-teams-tools.test.cjs`：**15/15 通过**。两项静态契约已同步实际等价实现：
  `observeUserStops` 的 `projectEntry` 参数，及 `actorRefForSessionId(execution.agent.id)` 的 HMAC
  helper；相应运行时 observer/HMAC 黑盒仍保持通过。
- 全部 `tests/agent-teams*.test.cjs`：**306 通过、0 失败、2 跳过（308 总计）**。跳过均为显式环境/
  发布门控测试，不是失败：artifact-fixture Web smoke 与 P1 release-blocking matrix。

**最终产品结论：全绿通过；2 项环境跳过已如实保留。**
