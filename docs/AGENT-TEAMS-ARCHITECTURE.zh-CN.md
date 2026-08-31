# 协作团队（Agent Teams）架构

## 目标

在不替换官方 DSH 会话引擎的前提下，为 Harness Desktop 增加显式、实验性的多会话协作能力：固定负责人、独立可恢复队友、同级消息、共享依赖任务、团队工作台和安全生命周期。

## 边界

- 默认关闭；只有根会话中的直接用户回合可创建团队。
- 每个根会话最多保留 8 个未关闭的平级团队；负责人固定，所有平级团队共享同一个 `maxActiveTurns` 总额。
- 队友使用官方 `continuable` subagent，独立上下文且共享工作目录。
- 不把具名普通子代理隐式转换为队友。
- 不支持嵌套团队和领导权转移。
- 运行时保持负责人到可见同级成员的扁平拓扑；任务成果负责人不是可派生下级的“组长”。
- 旧团队任务本身仍不创建 Git worktree；M5 Project Foundations 只有在 Host 验证真实 Git 根、固定负责人和资源声明后，才为明确分配的项目工作创建隔离 worktree，并通过持久 change set、合并与质量门禁推进。

## 组成

`dsh-agent-teams` 是随桌面端安装到 `$DSH_HOME/profiles/web` 的一方插件：

1. Host 插件注册团队模型工具、持久化存储、HTTP/SSE API 和 subagent 生命周期观察器。
2. Client 插件通过原生 Cordis slots 注入团队入口、团队工作台和任务摘要条。
3. 桌面壳只负责把插件原子复制进 Web profile 并确保 `cordis.patch.yml` 中只有一个注册项。

## 负责人、岗位成员与真实产出边界

一旦为当前目标建立 Agent Team，固定负责人默认只承担协调职责：把用户目标拆成实质成果，持久化并分配任务，维护依赖与交接，核对任务状态，审查并接收成员交付，最后完成最小必要的集成和面向用户的综合说明。负责人不能亲自替代已经分配、或按目标本应分配给岗位成员的实现、研究、设计、测试、文档等核心专业产出；允许的直接修改仅限于把已接收成果接起来所必需的最小胶水工作。发现覆盖缺口时，应重构或新增持久任务并分给可见成员，容量不足时走结构化扩员，而不是由负责人吸收核心工作。

岗位成员对自己已分配且已认领的任务负责：在声明的文件或资源边界内形成真实交付物，依据可观察的验收标准完成验证，并用当前 `claimId/leaseEpoch` 显式完成或释放任务。进度消息、checkpoint、最终报告或一次成功的成员回合都不等于持久任务完成；成员也不得把自己的核心交付反向交给负责人代做，或通过隐藏子代理形成第三层执行者。

真实团队必须满足“产出覆盖”，而不只是“人数覆盖”：

- 团队全部持久任务与岗位职责合起来，必须覆盖用户目标所需的实质成果；每项核心成果都应有明确负责的可见成员、真实交付物和可观察验收标准。
- 负责人自身的协调、复核、集成和总结不算第二条独立工作流，也不能用来填补成员职责覆盖。
- 不得创建装饰性、占位性或仅做轻量复核的成员，却把实现、研究、设计、测试等核心产出留给负责人；独立审校可以是有效岗位，但必须有独立审查结论、缺陷证据或架构记录等可验收成果。
- 若目标不值得把实质生产交给至少两个持续且独立的可见岗位，就不应创建 Agent Team，应按三级门禁选择主模型单独完成或一个普通子代理辅助。
- 负责人只有在成员交付已经完成并被接收后才能做最终集成；若交付缺失、失败或范围变化，应先重分配、重开或扩充任务，不能用负责人直接补做来伪造团队完成。

这些规则属于注入根会话的运行时职责契约，并由回归测试确认其通过真实 system-prompt 注册通道生效、关键职责语义存在且“接收成员交付”先于最终集成。它们约束模型决策，但不是 Host 对每一次文件编辑或工具调用的机械权限隔离；持久任务、文件范围、claim fencing 与验收记录提供可审计事实，不能把提示词测试误述为已经从执行层绝对阻止负责人越界。

### 交付、验收与责任事实

当前存储 schema v6 把成员交付与负责人验收保存为同一当前 claim 的两份独立 receipt。成员 `complete` 只能由当前 claimant 携带精确 `claimId/leaseEpoch` 提交，并生成绑定 `taskId`、claim、lease、`submittedBy` 和 `submittedAt` 的 `submission`；可见 `result` 也必须绑定同一任务与 claimant，未限定任务的一条会话输出不能批量证明多个任务完成。负责人不能对成员持有的 foreign claim 调用普通 `complete`，只能在有效 submission 之后写入单独的 `acceptance`。依赖满足、正常关闭和孤儿恢复的成功路径都要求当前 submission 与 acceptance 同时匹配；错误、拒绝、未验收完成和取消不能投影为成功。

v1–v5 的已完成历史迁移到 v6 时，会生成成对的兼容 receipt，并把 `submission.source` 标为 `legacy_migration`。客户端以这个来源为整组 provenance：历史 assignee、合成 submission/result/acceptance 可以继续展示，但统一降级为旧迁移记录，不能称为当前实际执行者或当前负责人审查。当前真实完成使用 `explicit_complete`；v6 不用额外的 v7 acceptance-source 枚举来推断来源。

显式 release 会保存成对的 `releasedAt/releaseReason`。这是一条跨后续 assign、claim、complete 和 accept 保留的、有界最新安全释放事实，不是当前 ownership；只有任务仍为 `pending` 且未分配时才触发 release Attention。取消使用成对的 `cancelledAt/cancellationReason`，仅在 `cancelled` 状态有效，reopen 会清除；界面只陈述通用“任务已取消；这不是成功完成”，不根据 reason、来源或 actor 猜测是谁取消。团队 closure receipt 明确区分 `succeeded`、`cancelled`、`forced`、`failed`；空团队的正常关闭/恢复是 `cancelled`，失败关闭没有 `closedAt`，`closed` 本身不等于成功。

这些 receipt 仍有明确边界：负责人可以显式 release 一个 foreign claim，再以自身身份 claim 并同步完成/验收；这是工作台可见且可审计的接管，而不是 Host 机械禁止的行为。`task.files` 是计划、提示和审计边界，通用文件工具并不会据此实施机械访问控制。submission/acceptance 证明的是状态转换、claim 归属与接收者，不证明产物内容正确、测试充分或审查质量；普通负责人 acceptance 也不等同于独立审查，要求岗位独立性的目标仍需单独的审查任务和真实审查证据。

## 持久化

状态存储在 `$DSH_HOME/storages/agent_teams.json`。所有修改经过单一 Promise 写链，使用同目录临时文件、`fsync` 和原子 `rename` 发布。任务认领在一条串行 mutation 中验证并写入，避免两个队友同时认领。

短暂成员状态在重启时校正：`provisioning/running/shutting_down` 不会作为正在执行的事实直接恢复，而转换为 `ready` 或 `failed`。成员会话本身由官方 continuable session 持久化，可在新消息到达时冷恢复。

### 计划先行与任务 fencing

团队计划先以 `draft` 保存，并经过 `committed` 才能成为 `active`；只有 Host 完整校验目标、依赖 DAG、成员、文件边界、能力和外部副作用后，计划才可执行。未提交 draft 可以查看和修订，但不能启动成员，也不能认领或完成任务。提交记录绑定 canonical plan hash 与单调 revision：完全相同的 hash/revision 重放只返回既有结果；相同请求标识搭配不同计划、旧 revision 或计划发生实质变化时拒绝并要求重新校验，不能把“请求曾成功”误当成新计划也获批。

授权事实只有 `unknown`、`human_attested`、`host_verified` 三态。普通工具布尔值、模型声明、错误 plan hash 和非 direct-human 回合最多形成 `human_attested`，绝不能产生 `host_verified`，也不能批量把 capability 从 `unknown` 升级为可用；`host_verified` 必须绑定 Host 私有验证记录和当前精确 plan hash。任何实质计划变化都会回到 draft，并使旧授权失效。

公开成员启动必须绑定至少一个已经持久化的任务。Host 在同一原子 mutation 中保存成员占位、任务预分配和启动意图，随后才调用官方 continuable child；没有任务的 spawn 在调用 child driver 前拒绝。若启动前可证明没有发布 child，可以安全恢复该占位；如果 child 是否发布或工作 followup 是否送达不确定，则保留部分失败和 Host attempt 记录，不自动重复执行。

每个团队持久化 `pauseEpoch`；每次任务执行尝试拥有单调 attempt，以及与当前认领绑定的 `claimId/leaseEpoch`。认领、完成、释放和 checkpoint 写入都必须携带当前 fencing 前提；旧 Stop epoch、旧 claim 或旧 attempt 的迟到回写被拒绝。Host attempt/interruption 历史是有界的权威事实；成员 checkpoint/next step 单独保存并明确标记为**未验证自报**，不能覆盖 Host 状态、权限结果、任务完成或外部副作用结果，也不能接收路径、凭据、原始消息或其他敏感字段注入。

### Stop 与两阶段 Resume

直接用户 Stop 的顺序固定为：先持久化新的 `pauseEpoch` 和暂停门禁，再取消排队唤醒、隔离新启动并中断成员。Stop 与 spawn/claim/complete 并发时，只有携带当前 epoch 与 claim fencing 的 mutation 可以提交；中断调用成功与否不会回滚已发布的暂停事实。

Resume 是两阶段协议。预览阶段只返回绑定 request、team revision、pause epoch 和当前任务/成员事实的恢复计划，团队仍保持 `paused`，不唤醒成员、不改任务；提交阶段必须携带该预览的 CAS 前提，并原子保存提交 receipt。完全相同 request 与 CAS 的已提交恢复请求可依据 receipt 幂等返回既有结果；同 request 搭配不同内容、过期 preview、revision 或 epoch 必须拒绝。恢复按节点隔离：健康且前提仍成立的任务可以继续，失败成员、权限未知、无有效 claim、外部副作用 `outcome_unknown` 或其他异常节点保持 Attention，不得因一个异常节点冻结整个团队，也不得被批量误判为可重放。

### 失败成员恢复 saga

失败成员恢复是旧团队 Web 数据面的唯一成员生命周期窄写入口，也是模型工具 `team_member_recover` 的同一 Host 原语。它只接受 exact fixed root、当前 direct-human 显式确认、稳定 `requestId`、精确 team revision 和状态仍为 `failed` 的 worker；自动续轮、普通成员、已完成/运行中/退役成员、paused/closed team、计划或费用授权未知、能力未验证、容量不足、文件范围冲突以及未核对 recovery/external effect 全部 fail closed。界面只在负责人查看 active 团队且确有失败成员时显示操作，替换必须二次确认并明确新的模型成本，不自动唤醒、不后台重试。Project board 只向 exact root 投影 opaque member id/name、当前 revision，以及未决 receipt 的完整 request/action/phase；不投影 session、child、claim 或 receipt 内部字段。恢复 overlay 逐项计算最终 JSON 的 UTF-8 字节并硬守 128 KiB page budget，以 `unresolvedRemaining/unresolvedTruncated` 诚实标记未显示项；requestId 绝不截断，前序 receipt 终结后后续项可渐进进入投影。

`retry` 要求 exact continuable session 仍有且仅有一个未变的 `in_progress` active claim；同一成员的若干 `pending` 已分配任务保持原 assignment，不强迫替换。receipt 固定 active task、`claimId/leaseEpoch` 与所有任务；`prepared` 重放继续同一 attempt，投递前进入 `retry_dispatching` fence。followup observer 即使先把成员置为 running 或让 exact worker 正常推进，只要 pending assignment、in-progress session/claim/lease，或 completed explicit submission 能与 receipt 审计绑定，均可收敛为 delivered，并原样保留 task state/claim/result；成员状态按 active work 推导为 running，否则为 ready/idle。投递抛错或崩溃一律保留 `outcome_unknown`，不凭异常猜测未送达，也不盲重放。

`replace` 在 prepare mutation 中同时保存 receipt、把旧成员转入退役审计、把旧 claim/lease 追加到 interruption history 后撤销、将所属未完成任务置回 pending，并预绑定一个名称严格为 2–12 字符的可见同级 replacement 占位。持久 phase 依次为 `prepared → drain_started → start_dispatched → child_started → published → followup_dispatching → followup_returned`；Host restart 在每个窗口只用 receipt 中预留的 exact child id 修复 publication/assignment 并继续，绝不重复 start 或 work followup。child 可能已经创建后的 Stop、CAS 或 dispatch 失败只能保持 `outcome_unknown`，不能写 failed 后允许新 child。

`team_member_reconcile` 和同源 UI 的明确二次确认是未决 receipt 的人工收敛路径：`delivered` 只结算原 request，并接受 exact replacement/retry worker 已正常 claim 或以 explicit submission 完成的强审计证据；foreign assignee、legacy migration 或冲突 claim 仍 fail closed。`not_delivered` 会先 CAS 验证所有 replacement 任务仍为 pending 且绑定 reserved placeholder/child，再 drain exact child（如有），并在删除 replacement 前再次验证；claimed、terminal 或迁移任务会保持 `outcome_unknown`。两者都不会重新投递。paused 团队仍向 exact root 投影未决 receipt，但只允许 `not_delivered` 安全结算，不允许把成员置回 running。相同 request 重放复用原 receipt。每队最多保留 24 条 recovery receipt；达到上限时只淘汰最旧 terminal (`delivered/failed`) receipt，绝不淘汰 `prepared/outcome_unknown`，也不要求关闭仍有未完成任务的团队。

### 能力、外部副作用与跨会话接管

能力预检只记录 Host 可验证的事实。当前工具无法证明的权限必须投影为 `unknown`，既不能伪造为允许，也不能把 unknown 当成永久拒绝；执行前需要重新取得可验证能力。外部效果的稳定 effect identity 由 Host 根据团队、任务和已声明效果导出；模型提供的 `idempotencyKey` 只是非权威输入，不能覆盖 Host identity。`prepare` 必须先持久化 `outcome_unknown` 与 attempt fence，再允许调用外部系统；只有持有当前 attempt 的结果或精确 direct-human root 的 `resolve_unknown` 才能解除阻塞。对于参与稳定 command id、receipt 和幂等重放协议的工具，可以在协议边界内收敛为一次逻辑效果；任意外部 UI 点击、未提供 receipt 的系统、网络超时后的第三方动作都**不保证 exactly-once**。

原负责人会话不可继续时，另一个最外层直接用户会话只能在 Host 证明双方绑定同一 canonical `projectKey` 后发起 adopt/handoff；操作必须显示来源、目标、计划 revision 和未决风险，并以 CAS 提交。所有 ownership 变化追加到不可改写的 `ownershipHistory`。adopt 撤销所有旧 worker 的 lease/claim，把其未完成任务安全放回 `pending`；旧 child 只保留审计身份，绝不 reparent 给新 root。跨项目、仅项目同名、普通成员、自动续轮或缺少直接用户授权的请求全部拒绝。接管只改变后续协调权，不篡改旧 attempt、checkpoint、消息和任务历史。Stop、adopt、reopen 或新 attempt 之后，旧 complete/release/checkpoint 不得改变状态；只有当前 fence 或已持久化且完全匹配的 receipt 可以幂等收敛。

旧存储迁移采用非破坏门禁：空团队或没有 worker 的团队进入 `draft + legacy_unplanned`；仍有活跃 worker 的团队不被迁移强行中断，但标记 legacy gate，禁止新的扩张、spawn 或 claim，直到 direct-human root 按当前 canonical 计划 recommit。迁移保留既有成员、任务顺序、完成历史和审计字段。

## 消息授权

团队插件先验证调用者是精确 live agent，且发送者与接收者属于同一活跃团队。队友到队友的消息仍通过固定负责人作为官方 subagent 的直接父级进行投递，从而不绕过官方 lineage 检查。消息使用 `coordinator/relay` 来源并记录真实 `senderSessionId`，永远不获得 `user` 权限。

旧团队运行时工作台的 HTTP/SSE 面默认只读展示成员、团队任务和消息状态，并从 Web 投影中移除消息正文、任务描述和文件路径；唯一成员生命周期窄写例外是上一节的失败成员 retry/replace，它要求同源受信请求、exact fixed root、direct-human 确认、稳定 request/OCC 与持久 recovery receipt。除此之外，创建/发信/团队任务变更/成员生命周期仍只走模型工具的精确 live-agent 鉴权，避免客户端伪造会话身份。Project Tasks 的窄写入口是独立例外，只接受本章后述的 create/allowed transition，并由 Project authority、actor resolver、RBAC 与 OCC 重验，不能写旧团队状态。写请求要求同源回环、`x-harness-agent-teams: 1` 头和有界正文。用户可从工作台打开官方成员会话，直接发消息或使用官方中断能力。原负责人不可恢复时，只能由新根会话中的直接用户通过 `team_recover` 预览并显式确认关闭无活动成员的孤儿团队。

## 团队运行时任务（旧任务板）

团队运行时任务保留 `pending`、`in_progress`、`completed`、`cancelled` 四个持久主状态。桌面与手机把它们连同 Host 门禁派生为 Ready / Running / Attention / Done 四个主区；`cancelled` 只进入历史，Attention 是阻塞、失败、权限未知、陈旧租约或副作用不确定等事实的安全投影，不是模型估算的第五种完成百分比。`blockedBy` 从未完成依赖派生，不单独冒充进度；完成前置任务会自然解除后续任务阻塞。认领要求任务已属于已提交计划、未分配、未阻塞且状态为 `pending`，并发布新的 claim fencing。这套任务继续保存在 `agent_teams.json`，由团队模型工具维护；它不会自动迁移、复制或双写到下面的 Project Tasks。

## Project Tasks（项目级任务域）

Project Tasks 是与团队运行时任务并列的独立域，保存 `backlog`、`todo`、`in_progress`、`in_review`、`blocked`、`done`、`canceled` 七态任务。它面向项目生命周期，不以 Team、根会话或 session Scheduler 作为身份；旧团队关闭、会话切换或提醒触发都不会隐式修改 Project Task。

### Host-only 本机权威上下文

`ProjectEntryService.localProjectTaskContext()` 只向 Host 内部返回能力对象。创建上下文前会刷新加密的持久 authority，并核验本机设备仍是 active owner、membership grant 签名与有效期正确，且 project、authority epoch/key id、member、device、role、device key 与 grant version 全部匹配。未创建项目、协作者设备、过期/篡改/不匹配 grant 或已撤销成员均不能取得写上下文。

上下文提供固定的 `$DSH_HOME/storages/agent_project_tasks.sqlite`、不可伪造的冻结 `execution` 对象、`actorResolver(execution, projectRef)` 和 `keyProvider(projectRef)`：

- `actorResolver` 只接受同一对象身份和同一项目，并返回由当前 authority member 派生的 human owner actor；Web 请求不能提交或覆盖 actor/project/role。
- `keyProvider` 使用本机项目加密材料、固定用途域和 `projectRef` 经 HMAC-SHA256 派生 Project Task 专用 32-byte key，不直接返回 Project Entry 原始 encryption key；每次调用返回独立 Buffer。
- 两个闭包都绑定当前 persisted authority identity/revision。authority 变化后旧上下文立即失效。
- `ProjectEntryService.close()` 在首个异步等待前推进 context epoch、使现有 resolver/provider 立即报错，并 `fill(0)` 清零全部已派生 task key；重复 close 保持幂等，close 后不能再创建 task context。
- `execution`、resolver 和 provider 是不可枚举属性；`status()`、JSON/Web projection 均不出现 execution、actorRef、private/encryption key。

### 加密 SQLite 与任务一致性

`ProjectTaskStore` 使用独立 SQLite 文件，初始化 `WAL`、`synchronous=FULL`、foreign keys 和 busy timeout，并尽力将文件权限限制为 owner-only。schema v3 包含 project revision、tasks、actors、events、comments、relations、attempts、reviews 与 command receipts：

- title、requirements、file scope、event payload、comment/review body 和 receipt result 等字段使用 AES-256-GCM；AAD 绑定 envelope version、algorithm、`projectRef` 与逻辑字段名，密文不能跨项目或字段搬用。
- 所有 mutation 使用数据库事务与 expected task revision（OCC）。状态变化、actor/event/record 和 command receipt 在同一提交边界完成。
- `requirementsRevision` 随要求变化前进；旧 execution attempt 会失效，已有 review 会 supersede，避免用旧要求下的结果完成新要求。
- schema v3 的 command receipt 绑定 `commandId`、`eventRef`、request digest、actor 和 task。相同意图重放返回既有 receipt；同一 command/event 搭配不同请求拒绝为幂等冲突，不会重复产生副作用。
- Actor 只能由 `TrustedProjectActorResolver` 从 Host execution 解析。RBAC、任务状态转换、依赖环、认领/分配、attempt 提交与 review guard 均在服务端校验，客户端按钮不是授权来源。

### 安全 Web 投影与固定路由

Project Tasks 使用独立 Web contract：

- `GET /api/agent-teams/project/tasks/state` 返回当前 canonical project 的首个安全页；本机 authority 响应包含精确 `projectRevision/totalTasks/totalExact:true` 以及 `page.includedTasks/hasMore/nextCursor`；
- `GET /api/agent-teams/project/tasks/page?cursor=...` 只允许本机 authority 按用户明确点击读取后续页；remote collaborator 返回 `409 PROJECT_TASK_PAGE_AUTHORITY_REQUIRED`，不提供完整分页；
- `POST /api/agent-teams/project/tasks/action` authority 接受明确 `create` 与服务器投影的 allowed transition；collaborator 只接受 capability 和条目 `allowedActions` 同时允许的 `claim/transition`；
- `GET /api/agent-teams/project/tasks/stream` 的 `reset/capability/task` 事件只作为首屏失效通知，Client 重新 GET 并清空已追加页面，不把 SSE payload 当权威结果。

Authority 的 state/page 使用同一安全任务投影。每页至多读取 120 项，并在序列化后受 128 KiB UTF-8 传输预算约束；若字节预算先命中，只发送能完整容纳的前缀，并以最后一个实际发送项生成下一边界，避免丢行或重复；只有单条安全投影仍放不下才失败。这两个数字都是**单页预算，不是项目任务容量**。`totalTasks` 是当前项目完整精确总数。后续页采用以 `(updatedAt, taskRef)` 为边界的 keyset 游标；游标绑定项目与 `projectRevision`，并由进程内随机密钥通过 AES-256-GCM 认证加密，边界引用不会出现在 base64 明文中，篡改、跨项目重放、进程重启密钥变化或 revision 过期均 fail closed。Client 只在 authority 且 `totalExact:true` 时显示完整总数、剩余数和“加载更多”；项目/capability/revision、首屏页元数据或 SSE 首屏任务事实变化都会回到首屏。分页不预取、不轮询、不自动重试。

请求不接收 `projectRef`、`eventRef`、session 身份、actor、role 或 authority；这些值和 create 所需引用均由 Host 派生。Authority Web task projection 保持原安全摘要；collaborator 只增加 `hasAssignee/blockedByCount/allowedActions`，且 Client 不把内部 taskRef 渲染成文字，不返回 device/message/digest/reset、actor、文件路径、requirements、comment/review body、key 或原始错误栈。远端状态目标排除 `blocked/in_review/done`。POST 顶层限制为 `commandId/type/taskRef?/expectedRevision/payload`；一次明确用户动作只发送一个浏览器 POST。Transport error 或结果未知会进入现有显式错误路径，绝不隐式重放、改写 revision 或生成新意图；用户必须先显式刷新，再以新的明确动作重新发起。

Remote collaborator 的状态不是 authority 分页的缩小版，而是现有 Project Business Sync 加密 `safeCache` 的连接预览：整个同步 Store 明文序列化有 16 MiB 防御预算，浏览器收到 `totalExact:false` 和 `page.available:false`，只能陈述本机已安全同步的条目数，并引导到 authority 设备查看完整任务和分页。它不能把安全缓存条目数冒充完整总数，也不能把任何内部条目防御限制宣传为系统任务容量。

非 2xx 采用 `{ ok:false, error:{ code, message, nextAction, retryable, safeDetails } }`。Client 保留 code/nextAction 做有界人类化提示，不直接展示机器 message。capability 明确区分 `authority`、`collaborator`、`no-project` 与 `unavailable`；只有 `canCreate=true` 显示/执行 Create。

### 唯一跨会话任务看板与项目隔离

Client 只提供一个**“跨会话任务”**工作区：它订阅当前 canonical `projectKey` 的独立项目协作投影，展示真实顶层会话席位、项目所有任务、责任/资源范围/阶段/下一步，以及依赖、移交、锁冲突、待决策、交付证据和变更历史。任务不按 Agent Team 分组；每个会话的 Agent Team 仅作为执行摘要。独立 Project Tasks API 与 Project Automation 基础设施继续保留，由安全数据面提供分页与能力矩阵；不存在 `project_task_*` 重复工具，浏览器只观察、刷新、分页或写入负责人草稿，不直接执行工具。

每个 canonical `projectKey` 独立准备会话席位、项目任务、依赖移交、资源锁、失败根恢复、证据、历史与协作请求；八个 section 都使用 SQLite `COUNT(*)` 精确 totals 和带确定性 tie-breaker 的独立 keyset 窗口。每区后续页最多读取 24 项，总首屏/序列化受 120 项与 128 KiB 预算保护，这些数字都不是项目总量。任务区把状态优先级写入可索引排序边界，完成项之后不会在后页重新出现更高优先级项。AES-GCM 游标、缓存、SSE debounce、队列和锁均按 canonical 项目隔离。每个真实顶层 root 是其 seat 唯一的项目板代表，并私下管理自己的 Agent Team；私有 Team 只服务当前已领取项目任务，成员只获得有界任务上下文，不能读取项目板。看板只显示有界 Team 摘要，不投影成员、聊天或完整团队任务上下文。Team 报告或完成不是项目证据，也不会自动更新项目板；root 必须核对交付并显式提交 evidence/status。项目板工具仅授予 exact top-level root，成员只能使用 `team_task_*`。项目切换时清理旧项目的列表 DOM。任务页按稳定 opaque taskRef keyset 分页，SSE 只增量合并当前项目投影并去抖，游标或项目 revision 变化时回到最新首屏，不扫描其他项目。

Root 在采用席位时及每个项目任务边界先读取协作请求，并优先响应 `targetedToMe=true` 的请求。请求 kind 固定为 `dependency_unblock`、`release`、`handoff`、`takeover`，目标响应固定为 `accept`、`reject`、`release`；请求持久化、去重、no-wake，禁止轮询或唤醒已停止 root。模型只看到由 execution-derived actor 计算的 `mine`、`targetedToMe`、`escalationEligible`，绝不看到 actor ref。`respondByAt` 到期后协调 root 才可审计解决；若提前处理，必须由 Host 验证当前精确 root 回合中的显式用户授权，模型 payload 不能自报授权。

Root 完成或提交当前项目任务后调用原子 `project_task claim_next`：Store 在当前项目的一次 SQLite `BEGIN IMMEDIATE` transaction 内按 `(updated_at, task_ref)` 公平选取一个无未完成依赖、无外部占用/冲突锁的 backlog/todo，并 CAS 为该 root 的唯一 `in_progress` 项；手工 claim 与所有进入 `in_progress` 的 transition 使用同一事务内单活检查，不用会破坏历史重复数据的唯一索引迁移。稳定 request id 由持久 receipt 幂等重放。无可领任务时只返回 `all_terminal`、`temporarily_empty` 或 `blocked` 及有界 blocker refs。阻塞 root 先创建一个持久请求，再尝试其他 eligible 项；只有全部终态或所有剩余阻塞均已记录才结束。

服务端只对最近使用的 16 个项目保留 prepared-board LRU；每个条目保存 prepared 投影并可缓存其首屏。后续页按游标从 prepared 投影即时计算，**不缓存后续页面**。16 是进程内 prepared 首屏缓存预算，不是可创建、可切换或可分页项目的数量上限；24/120/128 KiB 同样不是团队或任务容量。

这里描述的是当前代码和固定 HTTP/SSE 契约及自动化测试边界，不代表所有打包版本已完成安装后实机验证。

## 结构化扩员

成员不获得 `subagent`、`subagent_fork`、`workflow`、`ralph`、团队创建或成员创建权限。只有精确 live 的活动 worker，才能针对分配给自己且处于 `in_progress` 的任务调用 `team_expansion_request`。申请包含 1–4 个独立成果，每项必须声明交付物、验收标准以及文件或外部资源边界；Host 在与消息落盘相同的串行 mutation 中重验身份、任务归属、当前成员/回合/任务容量、提案内部边界和提案文件与其他进行中任务的文件冲突，避免检查与投递之间的竞态。

文件范围使用平台感知的保守重叠规则：精确路径、目录/子路径、glob 字面前缀均算冲突，只有 Windows（或显式指定不区分大小写）折叠大小写。拆分所引用的源母任务不参与这一步活动文件比较，避免宽父范围阻断所有子拆分；负责人批准后必须先释放/重构母任务，使它不再以冲突宽范围处于 `in_progress`。外部资源尚未进入持久任务占用 schema，Host 只检查申请内部的精确或 `/` 分隔层级冲突，现存外部状态由负责人审批核对，不能宣称已经自动验证。

通过校验的申请作为有界、持久的 coordinator message 送到固定负责人，不自动创建任何对象。负责人按并行独立性、交接成本、文件冲突、真实外部资源状态、关键路径/独立复核收益和预算审批；批准后必须先处理母任务宽范围、创建持久任务，再创建可见同级成员。该机制表达逻辑上的工作流拆分，但不改变扁平运行拓扑，也不允许嵌套团队或隐藏第三层执行者。

## 成本和冲突护栏

每个团队默认最多 4 名队友，硬上限 8；同一固定负责人旗下所有未关闭平级团队默认合计最多 4 个活跃成员。UI 始终显示独立上下文带来的 Token 成本提示。多人共享同一工作目录时，任务可声明文件范围；重叠范围在工作台中显示警告。

## 全局模型请求准入

独立的 Host-only `dsh-model-admission` 插件在公共 `llm/stream` provider-attempt 接点统一准入真正的 Agent Loop 请求。因此根会话、普通 subagent、团队成员、定时唤醒和 provider retry 共享同一并发预算；Agent Teams 自身的 `maxActiveTurns` 仍只负责团队生命周期，不能冒充全局模型限流。

默认最多同时放行 8 个 provider attempt、全局排队 32 个、每个固定根排队 8 个，最长等待 30 秒；配置另有不可突破的硬上限。队列在同一根内保持 FIFO、不同根之间轮转，取消、超时、插件关闭和异步流正常/异常/提前 return 都会精确释放。队列只保留有界根键和调度元数据，不保存 prompt、message 或请求正文；父会话环会归一到同一稳定根键，避免绕开配额。

## 本地引导与恢复投影

首批本地自动化通过新增的 `team_bootstrap` 工具提供；既有 `team_start`、`team_task_create`、`team_spawn` 的显式参数调用和结果语义保持兼容。完整且有界的任务/成员计划已经确定时，负责人直接调用 `team_bootstrap`，不先调用 `team_start`；计划尚未确定时仍走 `team_start → team_task_create → team_spawn`。同一团队只能选择其中一条创建路径，不能先建空团队再 Bootstrap。

`team_bootstrap` 只允许最外层根负责人在当前直接用户回合调用；一次最多声明 4 个任务和 4 个可见同级成员。Host 先完整校验任务键、依赖 DAG、成员名、容量和文件边界；分给不同成员的任务若存在平台感知的路径/目录/glob 重叠会在启动前拒绝，同一成员内部的重叠不构成并行写冲突。校验通过后，Host 在一次原子 mutation 中持久化团队与全部 `pending` 任务，随后才逐个启动官方 continuable member。成员的真实 session id 在工作 followup 前与其任务绑定，因而不会出现成员已开始但任务尚未落盘的正常路径。

调用方必须提供 `request_id`。同一根负责人以相同参数重放时复用原团队、任务和已完成成员，不重复启动；同一 id 配不同参数会以幂等冲突拒绝。若成员启动在可证明尚未发布 child 前失败，计划可从该成员继续；若已经出现成员记录或落入不确定窗口，则计划保持 `partial` 并返回稳定的错误阶段，自动重放 fail closed，避免重复执行。持久 schema v3 仅增加有界 bootstrap 引用和阶段；v1/v2 读取时原地迁移，普通团队仍无需该字段。

当根负责人恰好只有一个符合生命周期状态的团队时，`team_spawn`、`team_resume` 和 `team_shutdown` 可以省略 `team_id`；零个候选报未找到，多个候选仍强制显式选择，绝不按“最近使用”猜测。显式 id 的旧错误语义保持不变。

个别成员在 Host 确认退役后，其未完成任务会自动回到 `pending` 并解除 assignee/claim；已完成任务保留历史归属。整队关闭仍保留任务历史，直接用户 Stop 仍将进行中任务回滚为 pending 但保留原 assignee，以便显式恢复后继续。`team_resume` 只返回 `resumePlan`（ready/failed member、pending assigned、blocked/stranded task），不会启动、唤醒或投递任何成员消息。团队详情同时派生有界 `attention` 代码；Web 只得到代码和计数，不恢复消息正文、任务描述或文件范围。

## Project Automation 与 session Scheduler

Project Automation 是独立于 Project Tasks 和 session Scheduler 的项目级执行域。v1 只有手动触发、一个 `project_task.transition` step，并要求人类 owner/maintainer 明确审批；批准只把 Run 从 `awaiting_approval` 推进到 `queued`，实际 effect 由单独 Runner 随后执行。自动化目标只允许 `backlog/todo/in_progress/blocked/canceled`，不能借自动化绕过 `in_review/done` 所需的 attempt、review 和验收。

### Host authority、加密持久化与命令边界

`ProjectEntryService.localProjectAutomationContext()` 复用本机 owner membership/grant/authority revision 校验，但从原始项目材料用独立 HMAC domain 派生 Automation 专用 32-byte key。它与 Project Task key 不相等；execution、actor resolver、key provider 和 dispose 均不可枚举。context 失效或 Entry 关闭时，旧 resolver 立即拒绝，所有持有的 key buffer 被清零。

`ProjectAutomationStore` 使用独立加密文件，业务明文严格为 `projectRef/definitions/runs/approvals/commandReceipts/ledger/nextLedgerSequence`，outer revision 只存在于加密 envelope/result。Definition、Run、Approval、CommandReceipt 和 Ledger 都有 exact persisted codec、数量/16 MiB 限制与 outer CAS；AES-256-GCM AAD 绑定项目和字段，错误 key、回滚、篡改、跨项目搬用与 Ledger hash-chain 断裂全部 fail closed。Ledger 从 `previousHash=null` 的 genesis 开始，sequence 连续，hash 使用一次 SHA-256 base64url 编码。

浏览器 contract 固定为：

- `GET /api/agent-teams/project/automations/state`：只返回 capability、安全定义、安全任务选择、安全 Run 和最近 Ledger 投影；
- `POST /api/agent-teams/project/automations/action`：只接受 `definition.create/definition.update/manual_run/approve/reject/retry/cancel` 的 canonical body；
- `GET /api/agent-teams/project/automations/stream`：只发送 `reset/automation` 失效通知，Client 收到后重新 GET，不解析事件为执行结果。

POST 只允许 `{commandId,type,definitionRef?,runRef?,expectedRevision,payload}`，query 必须为空，并要求可信回环 origin 与 `x-harness-agent-teams: 1`。`projectRef`、event/trigger/approval/ledger ref、actor/session/role/authority、路径、input hash、effect/task command identity 均由 Host 创建或解析，任何层级出现这些调用方字段都在查对象前拒绝。Definition 创建和 manual run 还会从权威 Task SQLite 重新读取真实 task/transition/revision；浏览器不能把任意 taskRef 或旧 revision 伪装成可运行目标。

`ProjectAutomationCommandService` 的顺序固定为：strict normalize → Host actor resolve → owner/maintainer 授权 → actor-bound input hash/receipt preflight → object lookup → mutation。accepted 和 deterministic rejected receipt 都持久化；相同 command 和可信输入重放返回同一结果，id 或 actor/input 漂移报幂等冲突。Web 错误只投影固定 code、nextAction、retryable 和允许的 currentRevision，不返回 receipt、原始 message、stack、路径或私有引用。

### receipt-first Runner 与恢复

Run 固定 Definition snapshot、Task `revision` 和 stable effect identity；后续 requirements 变化会推进 Task revision，从而使旧运行的 OCC 前提失效。Runner 启动 effect 前先查 schema-v3 Task command receipt：

1. 已有匹配 receipt 时直接收敛 Automation Run，不重复 Task effect；
2. 明确 `not_committed` 才能安全取消；
3. receipt 未知或查询暂时失败时保持可恢复的非终态，不猜测成功；
4. 只有确定没有 receipt 才用 Host 私有 system execution 提交稳定 Task command。

Task commit 后、Automation save 前崩溃时，重开会用相同 `taskCommandId` 查询 Task receipt并收敛；receipt 必须含正 `projectRevision`、匹配 taskRef 和目标 status，否则报 `PROJECT_AUTOMATION_TASK_RECEIPT_INVALID`、保持 Run 可恢复且绝不盲目重执行。Runner 串行有界 pump，startup 对 `queued/running/cancel_requested` 执行 recover；approve/retry HTTP 只持久化排队事实并异步调度 pump。context stale 不降级权限，close 先拒绝新工作、drain action/Runner/Store，再清理两个独立 context。

现有“当前会话提醒”继续来自 session-local Scheduler：它依赖原会话存活或恢复，使用自己的提醒日志和生命周期。它不读写 Project Task SQLite 或 Automation Store，不把提醒触发视为任务成功，也不能借 `sessionId` 充当项目自动化身份。Scheduler 历史永远不与 Automation Ledger 合并；当前 v1 也不会从提醒自动触发 Project Automation。

## M4 跨设备安全业务同步

Project Business Sync 使用端到端加密的 durable Store 保存独立 Task/Automation 游标、安全缓存和离线 outbox。只有通过 fresh authority epoch 与 membership grant 校验的 capability 才能更新协作者权限；撤销、伪造或旧 epoch 消息不能改变 capability。浏览器只得到 `available/mode/writable/taskCommands/automationCommands` 与业务安全摘要，不得到 device、actor、message/ref、digest、reset token、路径、需求、评论、评审或原始账本。

协作者提交的 canonical command 会在首次生成时固定 `sentAt/messageRef` 和可信 request digest。网络失败最多 byte-identical 重试一次；离线时同一 wire 保存在加密 outbox。最终 receipt 反向绑定 peer、commandId、replyTo 和 request digest，并在同一事务删除 outbox、保存原 wire 与结果。Client 只显示 capability 与条目 `allowedActions` 交集，不乐观改缓存；SSE 只唤醒 refetch。Automation Runner 仍只在 authority 电脑执行，协作者最多审批当前允许的等待运行。

## M5 Project Foundations 与安全状态卡

M5 将旧团队任务的文件范围提示扩展为 Host-only 项目基础流水线：从真实 Git 根验证开始，按明确资源声明打开隔离 worktree，发布持久 change set，经串行合并、可信质量运行器、本地缺陷与可选外部缺陷 outbox 推进。源不是 Git 根、源脏/冲突、runner 不可信、质量失败或本地缺陷存在时全部 fail closed；浏览器状态不会触发这些操作。

`GET /api/agent-teams/project/foundations/state` 仅接受可信同源本机 GET 且 query 必须为空。固定响应只有 `{ok,mode,available,ready,sourceStatus,workspaceCount,claimCount,queuedChangeSetCount,campaignCount,queuedJobCount,runningJobCount,defectCount,outboxPendingCount,attention}`；计数有界，`attention` 只含固定安全 token。任何 commit/digest/ref/path/task file/actor/runner key/evidence/credential 都不能进入响应或状态卡。

Client 不再保留静态“团队工作流程”说明页；该导航位置现为唯一且真实的“跨会话任务”只读聚合看板。Project Foundations 仍只消费安全摘要：Authority 根据安全状态看到“系统已自动做什么/负责人下一步”；collaborator 的 `sourceStatus=authority_managed` 只表达“由主设备负责工作区、合并和质量门禁”，不渲染基础设施操作按钮。浏览器看板、摘要卡或草稿入口都不能触发 worktree、合并、质量或缺陷操作；`source_invalid` 明确表示当前真实源不是 Git 根，状态不可用时也不猜测路径或证据。

## Canonical Project 运行通道隔离

Project Entry 的设备身份、远程邀请、LAN/WSS 与 OS-backed secret capability 仍保持单例，绝不为每个工作目录重复消费秘密能力。只有 Host-only 的本机任务/协作 Context 经 `ProjectEntryRegistry` 分片：exact top-level execution 的规范化工作根由 Host 计算 `canonicalProjectKey`，再在安装/authority 密钥域内 HMAC 成不可逆 `laneRef`、lane 专用 `projectRef` 与 32-byte Store key；模型参数没有选择 lane 的字段。每个 lane 使用独立目录、SQLite/WAL、写锁和 Context epoch，目录名、持久状态与工具输出均不保存原始 canonical key 或 workspace path。

会话启动插件同样为每个 lane 延迟创建独立 ledger、索引、write chain 与队列；同一 lane 的首次打开共享一个 `ready` single-flight，失败只按 entry identity 驱逐，随后可以安全重试。同一个 raw request/batch/slot/operation id 可在不同 lane 安全并存。Desktop Host bridge 保留全局有界公平 admission/backpressure，但以 Host HMAC `laneRef` 建索引，慢项目不会通过共享 pending key 或文件锁串行化其他项目。新 ledger 不持久化 workspace/canonical binding；重启后必须由 exact execution 再次解析 Host binding，跨 lane 的 status/stop/adopt/reconcile 全部 fail closed。旧全局启动 ledger 保持原位且仍是其中记录的唯一 owner；lane 查询未命中时，`status/stop/redeemAdoption` 仅以 exact Host-derived binding 回退旧 runtime。启动账本不做实体复制、不创建 migration marker，也不产生第二 owner。

旧 `agent_project_tasks.sqlite` 永不删除。没有协作看板的空旧库不消费绑定；有数据时只有旧启动账本提供唯一 canonical 证据才自动绑定，否则普通 `initialize` 返回 `PROJECT_ENTRY_LEGACY_BINDING_REQUIRED`，仅 exact 当前 top-level direct-human root 的独立 `bind_legacy` 动作可完成一次性绑定；Agent、Team member 与模型布尔字段均不能选择该路径。绑定 lane 通过异步 SQLite backup 取得包含 WAL 的一致快照，并继续使用旧 `projectRef`/Store key，保证既有分区过滤、AAD、密文与 root actor HMAC 可读。marker 只保存 opaque laneRef，采用 `copying -> complete` 原子状态；崩溃恢复仅替换未完成的目标/临时副本，绝不删除旧库。marker 已绑定 A 后，普通 B 访问创建独立空 lane；只有 B 再次请求显式绑定才返回冲突。已知 lane 走每-lane 快路，不排队等待一次性 legacy 决策或其他 lane 的慢迁移；旧版残留的 lock artifact 不参与判定，也不会阻塞重启。

## 失败顶层会话的显式恢复

Project Collaboration schema v10 使用加密的 `project_collaboration_root_recoveries`，并把 `initiator`、真实失败/受益 actor 明确分栏：审计历史记录发起者，seat/task/lock 只按 Host 证据中的真实失败者、受益者与 replacement 变更。恢复必须来自 Host 对真实 top-level session operation 的确定失败证据，模型或浏览器不能提交任何 actor ref、原始 session、错误正文或所有权身份。`retry` 由 exact Host batch 绑定的 launch owner 发起，受益者仍是失败的 reserved slot 或已收养 root；它复用原 Host `operationRef/sessionId`，按持久 `workspace_dispatched → session_dispatched → session_ready → renamed → prompt_dispatched → prompted` phase observer-first 续作，双击和重启重放不会重建已存在 session、重复 prompt/model cost、seat 或任务。普通 status/reconcile 只观察 `session.list`，绝不 re-enqueue、rename、prompt 或唤醒；`prompt_dispatched` 的 `outcome_unknown` 只能由 exact top-level direct-human root 通过 Host `resolveUnknown` 定案。每次定案带稳定 requestId、exact operation/session observer proof 与 expectedRevision OCC：`delivered` 原子转为 `prompted/ready`，`not_delivered` 转回 `renamed/failed` 后才允许显式 retry；重复确认幂等，stale/foreign/drift 全部拒绝。outer runtime 不允许直接 retry 任意 `outcome_unknown`。

替代 root 先走既有 `takeover request → owner response/deadline escalation`，随后依次 `prepare → reserve → activate → ready`。prepare 只接受 `kind=takeover`、exact targetTaskRef、requester/failed target 以及已经由该 owner response/escalation 原子迁移到 requester 的 owner+assignee；错误 kind、别的任务或 ownership drift 全部拒绝。`reserve` 在一个 SQLite 事务中创建 replacement reserved seat、迁移该请求对应任务的 owner/assignee，以及只属于旧 owner/assignee 的任务锁；第三方锁保持原 owner 并继续造成冲突。每个 root 仍最多一个 `in_progress` Project Task。Host 只有在全部 seat/task reservation 成功后才启动 replacement **真实顶层会话**；ready child 再通过私有一次性 adoption capability 兑换 reserved seat，绝不调用 `team_spawn` 或隐藏 subagent 冒充 root。

可达路径由 exact direct-human root 调用 `project_collaboration recover_root`：插件先从持久 session-launch ledger 以 opaque failureRef 解析 exact caller/project/task/operation 的 Host evidence，再把 resolver 注入 Project Collaboration context；retry 复用原 operation，takeover 则在 adoption capability 已由 Host reserve 后原子 reserve replacement seat+既有任务+旧 owner locks，activate 真实 top-level launch，ready 后由 child 的 `adopt_slot` 私下兑换。UI 确认按钮生成精确的 `continue_root_recovery` 调用，不再只是泛化说明；foreign project、无 evidence 或非直接人类调用均 fail closed。

Recovery 以 requestId、recoveryRef、launchRef、revision 和状态转换做幂等/OCC 审计；`prepared/reserved/activated/ready/failed/outcome_unknown/cancelled` 可跨 Host restart 重建。未收养 child 的 retry 保留原 reserved seat 与私有 capability；ready child 收养成功后，Host 在 exact launch operation 上私下保存 adopted binding。插件只消费官方 scoped `agent/error`：事件中的 exact live top-level root 对象同时派生 canonical project binding 与 Project Entry actor，按该 actor 在对应私有 lane 中唯一定位 adopted operation，再以固定 `HOST_SESSION_LIFECYCLE_FAILED` 落盘；member/subagent、普通未收养 root、跨项目或零/多匹配都不产生恢复证据，原始 error/message 永不进入 ledger 或模型投影。重复事件与 Host restart 重放幂等，后续恢复因此解析到真实 adopted actor/task，而不是已删除 placeholder。takeover 激活从持久 launch ledger 恢复 exact slotRef/operationRef，即使 Host 已启动而 DB 仍停在 reserved 也不会再次 reserve、建 seat/task 或发 prompt；`outcome_unknown` 直接核对为 ready/failed 时同一 recovery row 随之收敛。Stop 只取消尚未产生不确定结果的 operation，旧 session 迟到不能覆盖新 revision；容量、权限、第三方锁、早期 deadline 未获 Host 直接用户授权、adoption 失败或部分 Host effect 都 fail closed。Web 只投影 opaque recoveryRef、固定 failureCode、状态与 Host 派生 `canRetry/canRequestTakeover`；不显示 failure evidence。恢复按钮 44px、键盘可达、先确认再提交，并具备 `aria-busy`、live error；页面不会自动唤醒、接管或重试。

## 兼容性

插件关闭时不创建团队，不改变 `subagent`、`subagent_fork`、`send_message`、`list_agents` 或 workflow 的行为。团队成员仍是标准 continuable subagent，因此现有会话导航、历史读取、中断和冷恢复继续生效。
