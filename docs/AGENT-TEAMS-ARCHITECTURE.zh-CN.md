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

### 能力、外部副作用与跨会话接管

能力预检只记录 Host 可验证的事实。当前工具无法证明的权限必须投影为 `unknown`，既不能伪造为允许，也不能把 unknown 当成永久拒绝；执行前需要重新取得可验证能力。外部效果的稳定 effect identity 由 Host 根据团队、任务和已声明效果导出；模型提供的 `idempotencyKey` 只是非权威输入，不能覆盖 Host identity。`prepare` 必须先持久化 `outcome_unknown` 与 attempt fence，再允许调用外部系统；只有持有当前 attempt 的结果或精确 direct-human root 的 `resolve_unknown` 才能解除阻塞。对于参与稳定 command id、receipt 和幂等重放协议的工具，可以在协议边界内收敛为一次逻辑效果；任意外部 UI 点击、未提供 receipt 的系统、网络超时后的第三方动作都**不保证 exactly-once**。

原负责人会话不可继续时，另一个最外层直接用户会话只能在 Host 证明双方绑定同一 canonical `projectKey` 后发起 adopt/handoff；操作必须显示来源、目标、计划 revision 和未决风险，并以 CAS 提交。所有 ownership 变化追加到不可改写的 `ownershipHistory`。adopt 撤销所有旧 worker 的 lease/claim，把其未完成任务安全放回 `pending`；旧 child 只保留审计身份，绝不 reparent 给新 root。跨项目、仅项目同名、普通成员、自动续轮或缺少直接用户授权的请求全部拒绝。接管只改变后续协调权，不篡改旧 attempt、checkpoint、消息和任务历史。Stop、adopt、reopen 或新 attempt 之后，旧 complete/release/checkpoint 不得改变状态；只有当前 fence 或已持久化且完全匹配的 receipt 可以幂等收敛。

旧存储迁移采用非破坏门禁：空团队或没有 worker 的团队进入 `draft + legacy_unplanned`；仍有活跃 worker 的团队不被迁移强行中断，但标记 legacy gate，禁止新的扩张、spawn 或 claim，直到 direct-human root 按当前 canonical 计划 recommit。迁移保留既有成员、任务顺序、完成历史和审计字段。

## 消息授权

团队插件先验证调用者是精确 live agent，且发送者与接收者属于同一活跃团队。队友到队友的消息仍通过固定负责人作为官方 subagent 的直接父级进行投递，从而不绕过官方 lineage 检查。消息使用 `coordinator/relay` 来源并记录真实 `senderSessionId`，永远不获得 `user` 权限。

旧团队运行时工作台的 HTTP/SSE 面只读展示成员、团队任务和消息状态，并从 Web 投影中移除消息正文、任务描述和文件路径；除实验设置外，创建/发信/团队任务变更/成员生命周期仍只走模型工具的精确 live-agent 鉴权，避免客户端伪造会话身份。Project Tasks 的窄写入口是独立例外，只接受本章后述的 create/allowed transition，并由 Project authority、actor resolver、RBAC 与 OCC 重验，不能写旧团队状态。写请求要求同源回环、`x-harness-agent-teams: 1` 头和有界正文。用户可从工作台打开官方成员会话，直接发消息或使用官方中断能力。原负责人不可恢复时，只能由新根会话中的直接用户通过 `team_recover` 预览并显式确认关闭无活动成员的孤儿团队。

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

- `GET /api/agent-teams/project/tasks/state` 返回 canonical capability、最多最近 500 个 safe task 和 `hasMore`；
- `POST /api/agent-teams/project/tasks/action` authority 接受明确 `create` 与服务器投影的 allowed transition；collaborator 只接受 capability 和条目 `allowedActions` 同时允许的 `claim/transition`；
- `GET /api/agent-teams/project/tasks/stream` 的 `reset/capability/task` 事件只作为失效通知，Client 合并后重新 GET，不把 SSE payload 当权威结果。

请求不接收 `projectRef`、`eventRef`、session 身份、actor、role 或 authority；这些值和 create 所需引用均由 Host 派生。Authority Web task projection 保持原安全摘要；collaborator 只增加 `hasAssignee/blockedByCount/allowedActions`，且 Client 不把内部 taskRef 渲染成文字，不返回 device/message/digest/reset、actor、文件路径、requirements、comment/review body、key 或原始错误栈。远端状态目标排除 `blocked/in_review/done`。POST 顶层限制为 `commandId/type/taskRef?/expectedRevision/payload`；同一网络意图最多用完全相同 body 重试一次，HTTP/OCC/幂等冲突不重试，也不做 optimistic revision 改写。

非 2xx 采用 `{ ok:false, error:{ code, message, nextAction, retryable, safeDetails } }`。Client 保留 code/nextAction 做有界人类化提示，不直接展示机器 message。capability 明确区分 `authority`、`collaborator`、`no-project` 与 `unavailable`；只有 `canCreate=true` 显示/执行 Create。`hasMore=true` 必须显示 500 项上限，不能静默截断或以空数组冒充不可用。

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

Client 只在既有“团队工作流程”中显示一张摘要卡，不增加导航。Authority 根据安全状态看到“系统已自动做什么/负责人下一步”；collaborator 的 `sourceStatus=authority_managed`，只显示“由主设备负责工作区、合并和质量门禁”，不渲染按钮。`source_invalid` 明确表示当前真实源不是 Git 根；状态不可用时也不猜测路径或证据。

## 兼容性

插件关闭时不创建团队，不改变 `subagent`、`subagent_fork`、`send_message`、`list_agents` 或 workflow 的行为。团队成员仍是标准 continuable subagent，因此现有会话导航、历史读取、中断和冷恢复继续生效。
