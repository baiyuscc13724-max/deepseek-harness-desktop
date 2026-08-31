# 代理团队任务看板与统一协作设计稿

> 状态：方案已批准并进入第一阶段实现；长期任务域、全局准入和跨设备数据面仍按阶段演进。
> 记录日期：2026-08-23；实现快照更新：2026-08-29。
> 目的：持久保存产品讨论，防止会话压缩后丢失已经确认的方向。

## 1. 已确认的产品方向

用户已经同意以下推荐：

1. 不把 `dashi-taskboard` 作为 iframe、外部服务或第二套任务数据库直接塞进代理团队。
2. 将现有代理团队重构成原生、任务优先的协作工作台。
3. 一个固定根负责人旗下的平级团队共用一张总看板；团队是标签、筛选条件和执行资源，不再各自形成割裂的任务页面。
4. 允许用户在界面中直接管理任务，而不是继续生成对话草稿让模型代为修改；所有写操作必须经过 Host 权限和状态转换校验。
5. 分阶段交付：先整理信息架构并形成可用总看板，再升级完整任务生命周期和协作模型。
6. 设计必须同时覆盖 AI 与 AI、人和人、人和 AI 三种交互。

## 2. 核心原则

组织单位是任务，不是对话。

- 项目拥有任务。
- 人和 AI 都是参与者。
- 代理团队只是 AI 执行资源，不再是任务的权威容器。
- 对话是执行任务产生的过程；任务保存目标、责任、关系、进度、讨论、证据和验收结果。
- 看板是任务状态的权威投影，不能和代理运行状态形成第二套真相。

## 3. 推荐信息架构

长期建议将页面升级为“协作工作台”，第一阶段可继续使用“代理团队”名称以降低迁移成本。

```text
协作工作台
├─ 任务板
├─ 参与者
│  ├─ 人类协作者
│  └─ 每个人的代理团队
├─ 动态
└─ 协作接入
```

任务板按根负责人或项目聚合所有平级团队：

```text
┌────────┬────────┬────────┬────────┬────────┬────────┐
│ 想法池 │ 待处理 │ 进行中 │ 待验收 │ 已阻塞 │ 已完成 │
│Backlog │  Todo  │ Doing  │ Review │Blocked │  Done  │
└────────┴────────┴────────┴────────┴────────┴────────┘
```

- `Canceled` 进入历史，不长期占据主看板。
- “已完成”默认折叠。
- 原实时画布保留为二级“关系图”，不再作为默认主视图。
- 成员目录、动态和历史保留为按需视图。
- 局域网、远程邀请、证书和中继配置迁移到“协作接入”，不再压在日常任务板顶部。

## 4. 任务生命周期

推荐状态：

1. `backlog`：尚未批准执行或仍未想清楚的事项。
2. `todo`：范围和验收标准明确，可以分配或认领。
3. `in_progress`：执行者已经认领。
4. `in_review`：执行者已经提交结果、摘要和验证证据。
5. `done`：固定负责人或具备权限的评审者验收通过。
6. `blocked`：依赖、资源冲突或外部条件阻塞。
7. `canceled`：明确不再继续，保留历史和原因。

关键规则：

- 普通执行 AI 不能直接把自己的任务标记为 `done`，只能提交到 `in_review`。
- 负责人可以批准、退回修改或取消。
- 团队关闭前必须处理所有进行中、待验收和阻塞任务。
- 一个任务同一时间只有一个当前执行者；真正的并行工作必须拆为子任务。
- 现有任务迁移建议：`pending → todo`、`in_progress → in_progress`、`completed → done`；内部 UUID 保留，同时新增可读编号。

## 5. 三类交互使用同一任务模型

### 5.1 AI 与 AI

AI 之间不采用无目的自由聊天，只允许围绕明确任务产生：

- 依赖解除请求；
- 唯一 Owner 请求；
- 文件或外部资源冲突；
- 正式交接包；
- 独立评审请求；
- 结构化进度、阻塞和验证报告。

默认进入静默、无唤醒 Inbox。只有负责人批准、预先授权策略命中或 Host 重新验证确有必要时才允许唤醒。继续复用 `Observe → Avoid → Require → Resolve → Admit → Deliver`、匿名 `routeRef`、暂停 epoch、冷却、去重和 L0/L1/L2 投递等级。

### 5.2 人和人

人际协作发生在任务上：评论、`@` 提及、分配、附件、评审、审批和决策记录。

沿用现有项目角色：

- `owner`：项目、成员和最终权限；
- `maintainer`：任务、成员、评审和日常管理；
- `contributor`：领取和执行任务；
- `reviewer`：评论、评审、退回或批准；
- `observer`：只读、关注和接收通知。

LAN mTLS 和远程 E2EE/WSS 是同一签名事件协议的传输方式，不是新的团队类型。

### 5.3 人和 AI

推荐主流程：

```text
人创建或确认任务
→ 明确“交给 AI”
→ AI 认领并执行
→ AI 写入结构化进展
→ AI 提交验收
→ 人或负责人 AI 通过 / 退回
→ 完成
```

任务评论提供两个明确动作：

- “仅留言”：只保存，不调用模型；
- “发送并执行”：保存并唤醒指定 AI。

权限顺序固定为：

```text
用户明确指令
> 项目角色权限
> 固定负责人 AI
> 普通执行 AI
```

普通 AI 不能覆盖人类决定、修改权威需求、批准自己的结果或私自派生隐藏成员。

## 6. 三种信息通道必须分开

1. **任务讨论**：人和 AI 都能留下的持久信息，按项目权限可见。
2. **执行会话**：AI 的完整上下文、工具调用和调试过程，按需打开，不自动灌入任务讨论。
3. **协调 Inbox**：AI 与 AI 之间定向、结构化、最小必要的协作信息。

看板只投影任务结论和安全事件，不复制所有聊天内容。

## 7. 任务责任与并发模型

每个任务至少记录：

- 发起人；
- 唯一结果负责人；
- 唯一当前执行者；
- 一个或多个评审者；
- 所属项目、团队标签和父子任务；
- 依赖、资源声明和文件边界；
- 当前及历史执行会话引用；
- 进度、阻塞、交接、验证和评审事件；
- `revision` 与 `requirementsRevision`。

AI 开始执行后，如果人修改目标、描述、验收标准或文件边界，必须递增 `requirementsRevision`。当前执行者确认新版本前显示“需求已变化”，不得按旧要求静默完成。

任务修改采用乐观版本控制；评论和证据采用追加事件；认领、交接和评审必须由 Host 原子校验。

## 8. 推荐任务详情

任务卡显示：

- 可读编号与标题；
- 团队标签；
- 人类/AI 类型明确的负责人和执行者；
- 优先级、依赖、阻塞和冲突；
- 最近进度与需求变更提示。

右侧详情抽屉分为：

1. **任务**：目标、验收、依赖、文件边界和责任人；
2. **讨论**：人和 AI 的任务级评论与提及；
3. **执行记录**：AI 会话、交接、改动、测试证据和评审结果。

列表/SSE 继续只广播安全投影。完整描述、敏感路径和正文通过与当前负责人会话绑定的短期能力读取，不能为了看板而扩大公开投影。

## 9. 推荐领域边界

最终边界应为：

- 项目任务域：任务、状态、讨论、评审、依赖、证据和审计的权威来源；
- 代理团队域：成员、会话、模型路由、运行、暂停、退役和容量；
- 协作 Broker：发现、必要性准入、定向投递、唤醒和暂停门禁；
- 项目协议：人类成员、角色授权、签名事件和 LAN/WSS 传输；
- UI：上述权威状态的投影，不自行维护第二份状态。

## 10. 分阶段交付建议

### 第一阶段：先止乱

- 建立一个负责人/项目一张总看板；
- 团队成为标签和筛选条件；
- 默认看板，画布、成员、动态和接入降级；
- 任务详情抽屉；
- 用户直接创建、编辑、排序和管理安全状态；
- 兼容现有三状态任务。

### 第二阶段：完整任务流

- Backlog、Review、Blocked、Canceled；
- 优先级、标签、可读编号、验收标准；
- AI 进度记录、提交验收、批准和退回；
- 执行会话绑定和历史尝试；
- `revision`、`requirementsRevision`、审计和撤销。

### 第三阶段：统一多人协作

- 任务讨论、`@` 提及和通知；
- 人类 RBAC 与项目成员；
- 每个人的本地代理团队折叠为参与者组；
- 将现有 LAN mTLS 和远程 E2EE/WSS 接入同一任务事件流。

## 11. 明确不采用

- 不直接 iframe 外部 `dashi-taskboard`；
- 不维护第二个 SQLite/任务服务；
- 不让团队页继续依赖生成提示词来完成日常任务管理；
- 不把所有 AI 对话自动复制成任务评论；
- 不允许普通成员创建隐藏第三层代理；
- 不把 LAN、公网或本机当成不同任务模型。

## 12. 仍需讨论

1. 最终产品名称是否从“代理团队”升级为“协作工作台”；
2. 哪些拖拽状态转换可以直接执行，哪些需要确认或评审权限；
3. 人类评论默认是否通知执行者，以及 `@AI` 是否默认唤醒；
4. 负责人 AI 与人类 Owner 同时存在时，最终任务批准边界；
5. 项目任务域从当前团队存储迁出的具体兼容路径；
6. 自动化触发器第一阶段开放到什么程度，以及哪些动作必须经过人工门禁。

## 13. 参考资料

- 抖音视频：`https://www.douyin.com/video/7669733815660596507`
- 上游项目：`https://github.com/chuspeeism/dashi-taskboard`
- 当前代理团队用户指南：`docs/AGENT-TEAMS-USER-GUIDE.zh-CN.md`
- 当前代理团队架构：`docs/AGENT-TEAMS-ARCHITECTURE.zh-CN.md`
- 当前多人协作架构：`docs/COLLABORATIVE-DEVELOPMENT-ARCHITECTURE.zh-CN.md`

## 14. 视频后半段完整补充分析

已从 10:30 连续看到 15:21 结尾，并按约 3 秒间隔留帧核对。后半段的重点不是让更多人进入同一个聊天室，而是把**输入供给、多人协作、无人参与时的降级和流程编排**接到同一套任务系统中。

### 14.1 10:30–11:12：持续工作流首先需要持续输入

作者提出“更关键的问题”：一条自媒体选题调研工作流能否循环起来，关键在于是否能及时获得足够多的候选输入。

基础流程是：

```text
人工将感兴趣的选题放进积压选题
→ 选题会筛选合适选题
→ Codex 从 Todo 中领取任务并完成调研
```

这里说明 Backlog 不只是“暂时没做的任务”，还是外部信号进入正式生产流程前的缓冲区和人工门禁。

### 14.2 11:12–12:06：从被动接收改为主动获取

作者在原流程之外增加主动获取路径：让 Codex 定期收集用户在不同平台点赞、收藏的文章或视频，再将候选输入送到选题筛选环节。

设计含义：

- 任务系统不能只等待用户手工创建卡片；
- 需要受控的定时采集器和外部来源适配器；
- 自动采集只能生成候选项，不能绕过人工筛选直接进入执行；
- 候选项必须保留来源、采集者、去重键和时间。

### 14.3 12:06–12:36：把多人协作放进同一套流程

视频明确展示“把多人协作也放进同一套流程里”。示例结构是：

```text
我的 Codex 定期收集我的点赞/收藏
同事的 Codex 收集同事的点赞/收藏
→ 各自同步到共享的飞书多维表格
→ 我的 Codex 定期从共享表格拉取候选项
→ 进入积压选题
→ 选题会筛选
→ 执行 Agent 从 Todo 领取任务
```

这不是 AI 之间自由聊天，而是典型的 **Hub-and-Spoke（中心汇聚）**：多个“人 + 个人 AI”节点向共享入口提交结构化候选，统一去重、筛选和入队，再由执行 Agent 消费。

因此，对当前方案作如下强化：

1. 人和 AI 都可以是任务来源、负责人、执行者或评审者；
2. AI 与 AI 的默认协作方式应是共享任务事件、候选池和交接包，直接消息只用于精确阻塞或交接；
3. 每个人可以拥有自己的本地代理团队，但项目任务域是共享权威源；
4. 看板必须保留 `createdBy`、`sourceActorRef`、`sourceType`、`sourceRef` 和去重信息；
5. 共享入口需要准入和筛选，不允许外部采集结果直接唤醒执行 Agent。

### 14.4 12:36：无人参与时必须有降级逻辑

视频给出的设计原则是：一条可持续运行的 Agent 工作流必须设置“无人参与时”的降级逻辑。

在本产品中应具体化为：

- 人工评审超时：保持在 Backlog/Review，不自动批准；
- 没有人领取：等待、提醒或降级为 AI 预分析，不偷偷开工；
- 负责人离线：进入无唤醒 Inbox，不无限重试；
- 外部数据源失败：记录来源失败和下次重试时间，不制造空任务；
- AI 不可用或预算不足：暂停自动动作，保留可人工继续的上下文；
- 依赖长期未解除：进入 Blocked 并按策略提醒、过期或取消；
- 所有降级都必须可见、可解释、可恢复，不能在后台静默改变任务目标。

### 14.5 失败 root 不能变成永久占位或隐式替身

“负责人离线进入无唤醒 Inbox”还必须覆盖真实顶层会话创建/运行失败。失败 evidence 只能由 Host 绑定到 exact top-level operation；不能让模型把 Team member、hidden subagent 或新 prompt 声称为 root。

恢复有且只有两条显式路径：Host batch 绑定的原 launch owner 对同一 continuable root/operation 做幂等 retry（发起者与真实失败/受益 actor 分离）；或先完成 durable takeover request 的响应/期限审计，由 coordinator 发起、从 exact requester 事务派生受益者，再 `prepare → 一次 reserve 全部 seat/task → activate → ready → 私有 adoption` 建立 replacement real root。所有阶段跨重启稳定重放；双击不增加模型成本；`outcome_unknown`、第三方锁、权限/容量不足、Stop、旧 session 迟到和 adoption 失败均 fail closed。Task owner/assignee 与旧 owner/assignee locks 同事务迁移，第三方 locks 不迁移；`claim_next` 因此可让其他健康 root 继续消费任务，而不是被一个失败席位全局卡住。

看板把 recovery 作为同一 Project Task 缺陷的安全审计切面，而不是第二套 Team task：仅展示固定状态、opaque ref 和权限派生动作。交互先确认、再 loading、失败后刷新权威状态；44px、键盘/ARIA 与窄屏边界和其他 Project Task 控件一致。

### 14.6 12:51–13:42：外部 Issue 和反馈进入同一任务入口

作者展示了 GitHub Issue 同步和 Bug 修复应用：定期从 GitHub 获取 Issue；群聊中的 Bug 反馈通过问卷进入飞书多维表格；Codex 再定期读取反馈并送入任务看板。

这说明任务来源至少需要覆盖：

- 人工创建；
- 人类讨论或表单；
- AI 主动发现；
- GitHub/GitLab 等外部 Issue；
- 共享表格或其他团队系统；
- 定时采集器。

所有来源先进入统一 Intake，再经过规范化、去重、权限、范围和执行准入。

### 14.6 13:42–14:51：从任务看板走向流程编排

视频最后一部分明确提出“从任务看板走向流程编排”：任务不仅被管理，还要连接触发器、条件和后续动作。演示中的流程画布可以选择 AI 模型、MCP、飞书、GitHub 等动作，任务状态本身成为流程触发信号。

推荐在领域模型中预留四类对象：

1. **Trigger**：定时、任务创建、状态变化、评论、需求版本变化、依赖解除、外部事件；
2. **Condition**：角色权限、标签、优先级、来源、预算、是否有人在线、是否已人工批准；
3. **Action**：创建/更新任务、分配参与者、发送无唤醒通知、调用 Agent、调用 MCP/Skill、同步外部系统、请求评审；
4. **Fallback**：等待、降级为预分析、提醒、暂停、过期、转人工或失败留档。

首期不需要立即提供完整可视化编排器，但任务事件 schema 和权限模型必须从一开始允许这些对象存在，避免未来再次迁移任务域。

### 14.7 视频对当前产品方案的最终修正

推荐的完整协作闭环应变为：

```text
人 / 个人 AI / 外部系统
→ Intake 候选池
→ 规范化、去重与权限准入
→ Backlog
→ 人或授权 AI 筛选
→ Todo
→ 人或执行 AI 认领
→ In Progress
→ 提交证据与评审
→ In Review
→ Done
→ 状态事件触发后续动作或下一轮输入
```

因此，“团队”不能只表现为一组同时运行的 Agent 卡片。真正的团队模型是：**多个人分别带着自己的 AI，通过一个共享任务域、清晰的准入门禁和可降级的自动化循环协作。**

## 15. 上游开源项目真实代码核查

### 15.1 核查基线与验证结果

已将上游仓库独立拉取到：

`D:\DeepSeek-Harness-Desktop\.reference\dashi-taskboard`

本次核查基线：

- 仓库：`chuspeeism/dashi-taskboard`；
- 分支：`main`；
- 提交：`f12f473c0049757bd0090be418f9d969a1d91194`；
- 提交时间：2026-08-23 15:40:31 +08:00；
- 包版本：`1.1.4`；
- 许可证：Apache-2.0。

已在该提交真实执行 `npm ci` 和 `npm run check`：

- TypeScript 检查通过；
- 生产 Web 构建通过；
- Node 测试 343 项，341 通过、0 失败、2 项因本机无 Chrome/Chromium 跳过；
- React 组件测试 9 项全部通过。

另外用独立临时数据库启动了真实本地服务，实际创建了人类任务和 AI 任务，核对了看板、任务详情、负责人、评论区域、仪表盘、自动化设置和 AI 对话面板。上游检出保持 clean，没有修改其源码。

### 15.2 当前代码真正实现了什么

上游的核心是一个独立的 Project/Task 任务域，而不是对话列表的视觉包装：

- 七状态：`backlog / todo / in_progress / in_review / blocked / done / canceled`；
- Task 具有项目、可读编号、优先级、标签、排序、负责人、分支/worktree、日期、周期、外部来源、归档和 `version`；
- Task 旁挂评论、附件、字段变更活动和父子/阻塞/相关关系；
- 本地 SQLite 为权威源，UI 与 `taskctl` 共用 HTTP API；
- 写入后通过 SSE 更新本地客户端；云端模式用全局 revision 轮询；
- 任务可绑定 Codex thread、项目、主机和 workspace；
- Skill 要求 AI 读取任务、评论和附件，使用任务版本认领，完成后评论并提交到 `in_review`，用户接受后才到 `done`。

真实认领路径为：

```text
taskctl issue get + comment list + attachment list
→ taskctl issue move --status in_progress --if-version N
→ POST /api/tasks/:id/move
→ SQLite WHERE id = ? AND version = ?
→ version + 1、状态活动、SSE
→ 看板卡片移动
```

这条路径值得吸收：AI 不是在聊天中口头声称“已认领”，而是对共享任务事实源执行一次有并发前提的状态命令。

真实界面包括：

- 仪表盘、议题看板、列表、甘特图和项目文档；
- 主看板显示 Todo、In Progress、Blocked、In Review；Backlog、Done、Canceled 和 Archived 收入二级面板；
- 卡片跨列拖动、列内排序、筛选、未读和关联对话；
- 任务详情中的 Markdown 描述、评论、附件、活动、关系、日期、周期和开发上下文；
- 全局 AI 对话面板，支持模型、推理强度、沙箱、附件、Skill 和配置 Agent 引用；
- 项目级“自动认领 Todo”设置。

### 15.3 三种交互的真实成熟度

#### 人和 AI：当前最成熟

- 人可以创建任务、调整属性、评论、打开新 Codex 对话和验收 Review 卡片；
- AI 可以通过稳定 CLI/API 认领、评论、绑定会话和提交评审；
- 任务保存真实项目、主机、workspace、branch/worktree 和 thread 路由；
- 执行对话与任务讨论有一定分离。

#### AI 和 AI：只有间接协调

- 多个 AI 可以通过共享任务、乐观版本和 thread binding 避免重复认领；
- AI Chat 的 `@Agent` 只是单个 Codex 对话里的配置 Agent 引用；
- 没有具名 Agent 参与记录、团队拓扑、协调 Inbox、正式交接、请求/回复关联、等待状态或 SLA；
- 所有 CLI AI 在任务域中都显示为同一个 `codex-agent`。

#### 人和人：有共享记录，没有成熟协作治理

- 有人类身份、评论、附件、活动和实时刷新；
- “参与人”只是从创建人、当前负责人、评论者和操作人动态聚合，不是成员关系；
- 没有成员目录、邀请、RBAC、Reviewer、Watcher、`@mention` 路由和个人通知 Inbox；
- 云端模式只面向两名可信协作者，共享一个 Basic Auth 密码；用户名只是显示名称，不是可信身份，知道密码的人可以任意读写并选择任意名字。

### 15.4 视频愿景与当前代码的关键差距

视频结尾展示或描述的完整流程编排，在当前开源提交中**没有实现**。

当前“自动化”真实能力仅为：

```text
定时检查某项目的 Todo
→ 按额度、间隔、模型、推理强度决定是否运行
→ 启动一个 Codex 自动化会话
→ 依靠长 Prompt 执行认领、派发、等待和状态写回规则
```

它不是通用的 `Trigger → Condition → Action → Fallback` 图形编排器。代码中的旧 `workflow_id` 和 `workflow_workspaces` 还被当前本地迁移及 Cloudflare migration 0009 主动删除。

视频示例中的飞书采集、GitHub Issue Intake、多个人的个人 AI 汇聚和可视化 MCP/模型动作也没有形成通用连接器框架。当前仓库实际有专门的 Jira 同步实现，但没有视频所示的飞书或 GitHub Intake 实现。

### 15.5 不能照搬的领域缺口

1. **Actor 太粗**：只有 `user | agent`，UI 负责人只能在“当前用户”和统一的“Codex Agent”之间选择。
2. **没有团队执行实体**：无具名 Agent、Agent Team、协作者、Reviewer、Watcher、ExecutionSession、Attempt、Lease、Heartbeat、Artifact 或 Handoff。
3. **状态机只在 Skill 中成立**：服务端只校验目标状态属于枚举，没有合法迁移表、角色权限和验收记录；AI 直接调用 API 仍可把任务改成 `done`。
4. **依赖门禁不在服务端**：`blocks` 关系不会阻止状态移动，依赖检查主要写在自动化 Prompt 中。
5. **需求并发不完整**：Task 有 `version`，但新增评论不递增 Task version，也没有 `requirementsRevision`；AI 可能按刚刚过期的评论集合成功认领。
6. **会话绑定不是执行历史**：Task 只有一个当前 binding；历史主要从带 thread 的评论反推，没有正式的执行尝试和交接模型。
7. **自动化过度依赖 Prompt**：关键并发、stale thread、远端派发和补偿规则集中在一段很长的自然语言 Prompt 中，不是确定性的命令/状态机。
8. **多人权限不足**：云端共享密码、身份可冒用、评论修改和删除缺少作者/角色授权。
9. **AI 输出身份被压平**：AI Chat 事件只有 user/assistant/activity/error，无法表达多个 Agent 的来源和协作链。

### 15.6 DeepSeek Harness 集成的真实情况

上游 `integrations/deepseek-harness` 不是原生功能移植：

```text
读取 launcher-runtime.json
→ Harness 路由返回 307
→ 侧栏打开一个 iframe
→ iframe 加载独立 Taskboard 服务
```

它没有复用 Harness Agent Teams 的任务、成员、项目协议、Broker 或会话存储，也没有把 Taskboard 变成 Harness 的统一事实源。因此不能以“上游已经适配 Harness”为理由直接安装；那会产生第二个任务服务、第二套身份和第二套状态。

进一步沿调用链核对后，这个 iframe 适配甚至没有接通“任务 ↔ Harness 对话”桥：Taskboard 在 `host=deepseek-harness` 时会向父窗口发送 `taskboard:open-thread` / `taskboard:create-thread`，并等待宿主 challenge 与 `taskboard:host-context`；上游 integration 和当前 Harness 都没有对应消息接收器。因此当前适配最多可使用独立看板 CRUD，无法真实创建、打开或绑定 Harness 执行会话。

### 15.7 最终借鉴结论

推荐采用“语义移植”，不采用“项目嵌入”：

| 上游能力 | Harness 处理方式 |
| --- | --- |
| 七状态和 Backlog/Todo 分离 | 原生加入项目任务域 |
| Task `version` 与 409 冲突 | 保留，并增加 `requirementsRevision` |
| taskctl 稳定 JSON 命令 | 设计 Host 原生 typed task commands |
| thread/project/host/workspace binding | 升级为 ExecutionSession 与 Attempt 历史 |
| 评论、附件、活动、关系 | 原生任务详情统一承载 |
| SSE/全局 revision | 接入现有签名项目事件流和安全投影 |
| Skill 中的 Review/Done 规则 | 下沉到服务端状态命令与 RBAC |
| 定时自动认领 | 作为未来流程系统的一个模板 |
| iframe Harness 插件 | 不采用 |
| 共享密码云协作 | 不采用；复用现有签名成员、RBAC、mTLS/E2EE |

由此进一步确认：Harness 应把 **Project Task** 升级为唯一任务真相，把 **Agent Team** 降为可分配、可观察、可暂停和可退役的执行资源；AI-AI 的精确协作继续使用 Broker/Inbox，人-人和人-AI 则通过同一个任务服务、权限模型、评论/评审事件和通知系统完成。

### 15.8 当前 Agent Teams“能用但乱”的代码级原因

对当前维护仓库同步核查后，混乱不是单纯的 UI 排版问题，而是四套能力没有汇到同一个 Project Task：

1. 当前任务属于 Team，状态只有 `pending / in_progress / completed`，不是项目级共享任务；
2. 团队 revision 会增长，但任务修改调用没有 `expectedRevision` 并发前提；
3. UI 安全投影删除了任务 description 和 files，Web action 又除设置外拒绝直接修改；
4. “创建、分配、协调”等快捷动作只是生成 Prompt 并写进输入框，用户仍需通过聊天管理状态；
5. Agent Teams Store、Collaboration Broker 和 Project Entry/Collaboration 各自保存独立状态，项目协议虽声明 `task.upsert / review.submit / handoff.request`，却没有接到真实任务业务流。

但当前系统已有三块应保留的成熟底座：

- `ctx.subagents.startContinuable / followup / steer` 提供真正可续跑的 AI 执行与消息通道；
- Collaboration Broker 已有结构化必要性、证据、去重、冷却、静默 Inbox、唤醒 grant 和 pause epoch；
- 多人项目协议已有 owner/maintainer/contributor/reviewer/observer、设备签名、授权、撤销、mTLS 与 E2EE。

所以重构不是推倒代理团队，而是把这三块接到新的 typed Project Task Service：Task 保存业务真相，Agent Team 保存运行态，Broker 保存最小必要协调，项目协议负责人的身份与权限。

## 16. 2026-08-23 新增确认：能力不回退、画布与定时任务

### 16.1 不可突破的能力保护原则

新“协作工作台”是现有代理团队的统一入口、任务事实源和编排层，**不是用简化看板替换代理团队运行时**。任何实施阶段都必须满足：

1. 原有能力只能保留、迁移或增强，不能为了适配新任务模型而删除；
2. 新旧模型切换前必须建立逐项能力矩阵、兼容适配层、数据迁移与回滚路径；
3. UI 暂未承载的旧能力继续保留可达入口，不得等同于后端删除；
4. Agent Team 仍然是可真实运行的执行单元，Project Task 只接管业务任务真相；
5. 迁移期间旧任务和新任务不得双写出两套互相冲突的权威状态；
6. 每个阶段必须用现有团队能力回归测试作为发布门禁。

当前列入“不得回退”基线的能力包括：

- 创建、续跑和管理真实 continuable subagent；
- 团队成员、角色、指令、任务与运行状态的持久化；
- `followup / steer` 等 AI 消息与控制能力；
- 暂停、恢复、停止、交接、等待和结果汇总；
- AI-AI 结构化 Broker、必要性校验、证据、去重、冷却、静默 Inbox、唤醒授权和 pause epoch；
- 人类根负责人对团队的控制和授权边界；
- 多人项目的成员角色、设备签名、授权、撤销、mTLS/E2EE 和远程协作底座；
- 当前画布已经具备的团队/成员/任务关系展示与实时运行观察能力；
- 当前定时任务已经具备的持久事件日志、严格时间解析、到期触发、逾期补发、空闲准入和投递记录能力。

上述清单是最低基线，后续以代码审计形成的完整能力矩阵为准，只增不减。

### 16.2 画布的产品定位待升级，不删除

当前“实时画布”不能仅因为简陋就被任务板取代。推荐将两者明确分工：

- **任务板**回答“现在要做什么、谁负责、进度和验收是什么”；
- **团队画布**回答“谁在和谁协作、任务如何拆解、依赖/交接/消息如何流动、哪些执行会话正在运行”；
- **流程画布**回答“什么事件会自动触发什么条件、动作和降级逻辑”。

团队画布与流程画布可以共享节点、连线、缩放、选择器和属性面板等基础设施，但领域模型不能混为一张图。下一步先审计现有画布真实能力，再决定是渐进增强还是重建其表现层；在结论形成前不删除现有入口和数据。

### 16.3 定时任务的预设决策：纳入团队模式，不删除

当前默认方向是**保留现有定时任务体系，并把它接入统一任务与团队执行模型**，不直接删除：

```text
现有 Scheduler / 定时任务定义
→ 产生带来源的 TriggerRun
→ 创建、唤醒或推进 Project Task
→ 通过统一权限和认领命令选择 Agent / Agent Team
→ 创建 Execution Attempt
→ 保存运行、失败、重试、暂停和人工验收记录
```

其中：

- Scheduler 继续负责可靠时间触发、持久化、错过触发处理、重试和启停；
- Project Task 负责目标、责任、状态、依赖、讨论和验收；
- Agent Team 负责真实执行，不承担另一套业务任务真相；
- 流程画布只编辑 Trigger、Condition、Action、Fallback 的定义，不自己实现第二个调度器；
- “定时自动认领 Todo”是一个内置流程模板，不等于整个自动化系统；
- 旧定时任务必须能以兼容模式继续运行，并逐项迁移到新的 `TriggerRun → Task → Execution Attempt` 记录链。

只有代码审计证明旧体系与现有 Scheduler 完全重复、且全部可靠性能力可无损接管时，才允许退役重复的外壳；不得删除调度数据、运行历史或用户已有规则。

### 16.4 实施前核查清单（已转为持续发布门禁）

1. 建立当前 Agent Teams 完整能力矩阵，并标明未来归属：Task Service、Team Runtime、Broker、Project Collaboration 或 UI；
2. 核对现有实时画布的节点、连线、布局、交互、数据源、写操作和运行态能力；
3. 核对现有定时任务的存储、调度器、触发语义、错过执行、并发、重试、取消、通知和历史；
4. 给出“原样保留 / 接入适配 / 升级重构 / 可退役重复外壳”的逐项结论；
5. 能力矩阵和迁移方案已经用户确认；后续每次实现仍须逐项核对本清单，不得因进入施工而取消门禁。

### 16.5 新增确认：开源能力复用优先，不重复造轮子

`dashi-taskboard` 当前核查版本采用 Apache License 2.0，允许复制、修改和形成二次开发版本；实际复用时必须保留许可证和相关归属，并在修改过的文件中标明改动。产品与工程决策采用以下顺序：

1. **直接复用**：领域语义和运行环境都兼容的纯函数、协议、组件与交互，优先原代码移植；
2. **适配复用**：能力成熟但依赖上游 Taskboard API/身份/存储的部分，保留核心实现，替换边界适配器；
3. **二次开发**：现有实现覆盖大部分需求时，以其代码为基线增加 Harness 的 Actor、Agent Team、RBAC、Execution Attempt、Broker 和项目事件能力；
4. **最后才新建**：只有上游没有实现，或其安全/架构边界无法修正复用时，才编写新的模块。

优先进入复用评估的上游能力：

- 七状态 Task 模型、Backlog/Todo 授权边界和卡片/列表/详情交互；
- 看板拖拽、列内重排、筛选、卡片显示配置和完成/历史收纳；
- 任务详情中的 Markdown、附件、评论/活动时间线、任务关系和开发上下文；
- Task revision、`expectedVersion`/409 冲突处理和稳定 taskctl JSON 契约；
- 会话、项目、主机、工作区绑定与历史 conversation refs 的组合逻辑；
- 甘特图、未读、运行进度以及自动认领流程中的可复用部分；
- 上游已有测试、迁移和数据校验逻辑。

下列内容不因“复用优先”而直接照搬，但可以抽取其中可用代码：

- 独立 Taskboard 服务、307 跳转和 iframe 宿主方式；
- Codex userscript、CDP、DOM selector、键盘模拟和私有 Electron 路由；
- Basic 共享密码、可伪造 username、单一 `codex-agent` 身份；
- 浏览器 localStorage 承担权威自动化策略；
- 只有 Prompt 约束而没有服务端命令、RBAC 和状态机的关键规则；
- worktree 缺失时静默回退主 checkout；
- 上游已删除的旧 workflow schema，或视频中尚未开源实现的流程画布愿景。

复用验收不以“能编译”为准，而以“不削减现有 Harness 能力”为准：任何上游模块接入前都必须通过能力矩阵，证明不会覆盖现有 continuable agent、团队生命周期、Broker/Inbox、安全多人项目、定时任务和运行历史。最终代码应形成 Harness 内部可维护的原生模块，而不是长期依赖第二套服务运行。

## 17. 代码审计后的能力、画布、调度与复用矩阵

### 17.1 对第一版 UI 原型的修正

第一版原型只验证了“项目任务板 + 参与者 + Inbox + 自动化”的信息架构，**没有完整表达现有 Agent Teams 能力**。未出现于原型不代表删除或降级。下一版 UI 方案必须明确保留入口或状态投影，至少覆盖：

- 多个平级团队的切换、活动团队和历史团队；
- 固定根负责人、真实 continuable member、成员模型和容量；
- `followup / steer` 路由、跨团队中继和失败消息审计；
- 结构化扩员申请、临时 Memory Pack 和任务/文件边界；
- 用户 Stop、暂停、恢复、优雅退休、强制 drain、部分关闭失败和孤儿团队恢复；
- Collaboration Broker 的 discover、intent、Inbox、deferred、ack、去重、冷却、pause epoch 和默认不唤醒；
- 多人项目的 Owner/Maintainer/Contributor/Reviewer/Observer、邀请、设备签名、撤销、密钥轮换、LAN mTLS、WSS 和 E2EE；
- SSE 实时投影、重连/背压/轮询降级、历史和统一代理目录；
- 会话本地定时任务及其历史。

新任务板只能取代“通过聊天管理任务状态”的混乱入口，不能取代 Team Runtime、Broker、Project Collaboration 或 Scheduler。

### 17.2 最终模块责任边界

| 模块 | 唯一责任 | 主要来源 |
| --- | --- | --- |
| Project Task Service | 项目任务、七状态、revision、需求版本、评论、附件、关系、验收、结果和 Artifact 引用 | 优先二次开发 `dashi-taskboard` 任务域 |
| Team Runtime | 真实 continuable subagent、固定根负责人、成员生命周期、followup/steer、Stop/drain、容量与模型权限 | 完整保留当前 `dsh-agent-teams` |
| Collaboration Broker | 精确 AI-AI 路由、必要性/证据校验、静默 Inbox、去重/冷却/pause epoch | 完整保留当前 Broker/Service |
| Project Collaboration | 人类身份、RBAC、签名事件、邀请/撤销、LAN/WSS、mTLS/E2EE | 完整保留当前项目协作底座并接任务事件 |
| Scheduler | 时间解析、timer、持久事件、到期/逾期、空闲准入、投递 | 完整保留 `@deepseek-ai/dsh-schedule` |
| Automation Service | 版本化 Trigger/Condition/Action/Approval/Fallback 与 Run Ledger | 新增薄编排层，动作只调用上述 typed service |
| Local Memory Service | 本地个人/项目记忆、候选审核、敏感过滤、限定召回与生命周期 | 完整保留当前 `memory-service` 与 `local_memory` |
| Context Service | 按任务和执行授权召回、生成临时 Memory Pack、记录使用清单 | 在现有 Memory Pack 上新增薄适配层，不复制记忆库 |
| Workbench UI | 任务板、团队画布、流程画布、详情/收件箱/历史和统一命令入口 | 上游任务 UI 二次开发 + Harness 原生运行视图 |

### 17.3 现有 TeamCanvas 的真实能力与升级结论

> 本节记录的是画布升级前的审计基线。表现层中“不能缩放、不能自适应、只能横向长排”等问题已经由 19.4 所述第一阶段实现修正；任务域、关系类型和跨设备数据面缺口仍然有效。

升级前的 `TeamCanvas`（`plugins/dsh-agent-teams/lib/client.js`）是一个只读“实时关系快照”：

- 节点只有本团队成员、活跃任务和一个完成任务聚合节点；
- 边只有 `assigned / depends / blocked / conflict`；
- 成员与任务固定为两条横向行，卡片固定大小，SVG 直线连接，内容多时只向右滚动；
- 没有 pan、zoom、fit、minimap、自动布局、框选、多选、边详情和布局持久化；
- 任务可打开只读侧栏，成员只会打开整个代理目录；
- Broker intent/Inbox、handoff、review、消息、Execution Attempt、人类 Actor 和真实跨团队边都没有进入图；
- 实时 SSE 合并、背压、隐藏页降载和轮询降级较成熟，应原样保留。

因此升级采用三层而不是把所有内容画在一张图：

1. **任务板**：默认工作入口，管理业务任务；
2. **团队画布**：实时观察 Human、Team、Agent、Task 摘要和 Execution Attempt，显示分配、依赖、消息、Broker intent、交接、审批、控制和跨团队关系；
3. **流程画布**：独立编辑 `Trigger → Condition → Action → Approval/Fallback`，显示 FlowRun/Step，不与实时团队拓扑共用领域模型。

三者可以共享 Graph Shell：viewport、缩放/平移、fit/minimap、选择、属性面板、节点/边注册、键盘访问、自动布局、过滤、图层和视口偏好。优先评估成熟开源图框架（例如 `@xyflow/react` + ELK）与现有插件构建方式的兼容性，不再手写一套通用图编辑器。旧 Canvas/List 在新团队画布达到能力对等前继续保留。

### 17.4 定时任务最终决策：保留 Scheduler，接入团队，不删除

当前 `@deepseek-ai/dsh-schedule` 不是简单的 UI 计时器。它已经实现：

- 会话事件日志拥有状态，`schedule/change` 严格记录 `create / delete / dispatch`；
- `after`、显式时区 `at` 和最短 300 秒的固定间隔 `every`；
- DST 空洞拒绝、重叠时间确定选择、超长 timer 分段和墙钟重新检查；
- 同一 Agent 的 FIFO 管理与触发、持久化 flush barrier、Agent 忙时等待 idle；
- 循环任务错过多次时只补最新一次，并把多个逾期循环提醒合成一批；
- 提醒内容作为不可信内容进行固定 framing，避免把提醒文本直接当新指令。

它也有必须如实保留的限制：

- 仅 session-local，App/原会话未 live 时不会 OS 唤醒，只在恢复后补发 overdue；
- 没有 Cron/日历规则、全局并发、retry/backoff/dead-letter、独立执行结果或用户已读回执；
- 没有真正 pause/resume，当前 UI 的“停用/重新启用”其实是 delete/recreate，会改变 ID 和周期锚点；
- `dispatch` 只表示 followup 已接纳，不表示模型成功、任务完成或用户已读；
- 当前“每日/每周五”用固定秒数表达，不能保证日历语义，UI 文案与模板需要修正。

目标链路为：

```text
Schedule Definition
→ Scheduler 产生 occurrence
→ 创建幂等 AutomationRun（automationId + scheduledFor）
→ typed Condition/Gate
→ Project Task create/claim/update
→ Team Runtime 创建或继续 Execution Attempt
→ 结果进入 in_review / blocked / fallback
→ Run Ledger 保存每步证据
```

现有 `schedule_*` 和 `schedule/change` 保持兼容，继续服务会话提醒。新的项目自动化另建 `AutomationDefinition` 与 `AutomationRun`，不得改写旧 Session JSONL，也不得自行修改 `agent_teams.json`。

上游 Taskboard 的“自动认领”并非另一套 scheduler：它通过 Codex 原生 Automation/CDP 保存 RRULE，再运行一段认领 Prompt。可复用的是其中的控制流模板：列出 Todo、依赖门禁、完整读取、version 二次检查、原子认领、精确 thread/worktree 绑定、继续/创建执行会话、成功进 Review、失败进 Blocked 或补偿回 Todo；不复用 Codex CDP、私有 renderer bridge 和“长 Prompt 充当状态机”。

### 17.5 上游开源代码的具体复用清单

上游基线采用 Apache License 2.0；接入时记录 upstream commit，保留许可证/归属，并在修改文件中标明二次开发。

| 上游部分 | 决策 | Harness 改造边界 |
| --- | --- | --- |
| `BoardColumn`、`TaskCard`、原生拖放和列内重排 | 尽量直接复用 | DTO 对齐 ProjectTask，写操作接 CommandBus |
| `IssueListView`、`TaskFilterMenu`、卡片显示偏好 | 直接复用 | 仅替换数据来源与宿主样式适配 |
| ActorAvatar、Icons、Label/PropertyPicker、Description、PendingAttachments | 直接复用 | Actor 扩展到 human/agent/team/system |
| 乐观移动、分数 sortOrder、409 回滚/undo | 直接抽取 | 请求替换为 Harness revision command |
| `TaskDetail` | 适配复用 | 保留详情/评论/活动/附件/对话/关系 UX，将直接 `api.ts` 调用改成 `TaskDataProvider + HarnessTaskCommandBus` |
| `IssueRelations` | 适配复用 | 保留搜索/键盘/父子/blocks/related UI，服务端使用 Harness taskRef、RBAC 和环检测 |
| 评论、活动、附件、Markdown/InlineMediaComposer | 适配复用 | 接 Artifact CAS、签名项目事件和扩展 Actor |
| `GanttView` 与 MIT `dhtmlx-gantt` 集成 | 第二阶段复用 | 保留 smart rendering、缩放、日期拖动和依赖线；依赖写操作仍需授权 |
| 七状态、Task revision、关系、评论/附件/活动、CAS/409 逻辑 | 二次开发复用 | 增加 requirementsRevision、Reviewer、Execution Attempt、Artifact、RBAC |
| 自动认领控制流 | 复用为内置流程模板 | 拆成 typed nodes，不保留长 Prompt 作为权威状态机 |
| 整份上游 `App.tsx`、Server/Cloud/Tauri、iframe、Codex injector/CDP | 不整体复用 | 只抽组件/算法，避免第二套宿主、身份、任务库和会话运行时 |
| `user|agent`、`current-user|codex-agent` 和共享密码模型 | 不作为最终模型 | 替换为 Harness Actor、Team 和 Project RBAC |
| 视频中的流程画布 | 无代码可复用 | 当前仓库没有实现且旧 workflow schema 已删除，改用成熟图框架和 Harness typed services 构建 |

建议把需要复用的上游组件做成带 provenance 的 vendor/package 层，尽量保持源文件可追踪；在其外部建立 `DashiTaskViewModelAdapter` 和 `HarnessTaskCommandBus`。不要照着截图重写一套相似组件，也不要复制整份 `App.tsx`。

### 17.6 实施前的硬门禁

1. 先建立自动化的能力清单与可执行回归测试，不允许只靠文档承诺“不回退”；
2. 每个上游模块标注 `direct / adapted / rejected`、upstream commit、license 和修改点；
3. 新 Task Service 上线前，旧 `team_task_*` 通过 adapter 读写同一事实源，禁止双写两套任务状态；
4. 新团队画布达到节点、关系、运行控制、实时性、可访问性和历史能力对等前，旧 Canvas/List 不移除；
5. 新 Automation Service 达到旧提醒的时间、持久化、逾期和空闲准入语义前，不替换 `dsh-schedule`；
6. Team Runtime、Broker、Project Collaboration 和 Scheduler 的现有测试套件全部作为迁移发布门禁；
7. 本设计已经用户确认并进入第一阶段实现；未完成的 Task Service、全局准入和多人同步不得被第一阶段 UI 误标为已完成。

## 18. 记忆库与任务、团队及自动化的关系

### 18.1 总结：有关联，但不能合并为同一个事实库

记忆库应成为协作系统的**受控上下文层**，而不是任务、聊天、产物或运行历史的替代品：

| 数据 | 负责回答的问题 | 是否是权威事实 |
| --- | --- | --- |
| Project Task、评论、活动和关系 | 现在要做什么、谁负责、进展与验收如何 | 是，属于工作事实 |
| Execution Attempt、消息和 Run Ledger | 谁在何时执行了什么、是否成功、如何失败 | 是，属于运行事实 |
| Artifact / Result | 实际交付了什么、证据和版本是什么 | 是，属于产物事实 |
| Memory Entry | 哪些稳定偏好、项目决策、约束和经验值得跨任务复用 | 是，经审核后才是可召回知识 |
| Memory Pack / Context Manifest | 某次任务被授权使用了哪些记忆版本 | 是一次执行的上下文快照，不是新的长期记忆 |

聊天记录、任务描述、评论和模型输出都只能作为记忆的**来源**，不能因为存在就自动变成长期记忆。相反，任务或运行历史也不能依赖记忆库来重建；即使记忆被停用或删除，原始任务和审计历史仍须完整。

还必须区分当前三套不同机制：

1. **Local Memory**：SQLite 中可跨会话检索、可审核和可撤销的持久条目；
2. **Team Memory Pack**：root 为一个具体执行任务下发的有界上下文；
3. **Session Compaction**：单个长会话超过上下文窗口时的摘要/裁剪。

Compaction 不写 `memory.sqlite`，没有作用域、来源、审核或跨会话检索语义，不能成为长期记忆的隐式写入通道。

### 18.2 现有记忆能力与真实缺口

当前 Harness 已有可保留的本地记忆基础：

- `electron/bridge/memory-service.cjs` 使用本地 SQLite，支持 FTS5/LIKE 搜索、`secure_delete`、条数/大小/查询/返回上限、敏感内容拒绝或脱敏；
- Schema 已支持 `personal / project / team / task` 四种作用域，以及 `candidate / active / stale / superseded / conflict / archived` 生命周期、revision、来源、验证时间、过期时间、置顶和 `never` 召回策略；
- `local_memory` 只允许根 Agent 检索；`remember / suggest` 只允许直接用户驱动的根回合；正常召回最多 8 条；
- 显式用户要求保存的稳定事实可以进入 `active`，AI 在自然任务边界提出的内容应进入 `candidate`，审核后才参与召回；
- 团队成员不能直接搜索私人记忆库。根 Agent 只能为本团队一个具体活跃任务的精确 assignee 生成并发送临时 Memory Pack：最多 5 条、1200 字、30 分钟有效，正文不会写入团队持久存储；
- 现有记忆中心已经能搜索、筛选、批准候选、停用、设为永不召回、纠错、删除、导出和安全擦除。

这里的“本地”只描述数据库存储位置，不能误写成端到端私密知识库：当前 SQLite 没有静态加密，仅开启 `secure_delete`，导出是明文 JSON；记忆一旦被模型召回就会进入当前模型上下文。当前搜索也是 FTS5/LIKE 的有界全文检索，不是 Embedding、向量 RAG、文档摄取或知识图谱。

当前缺口也必须如实标记：

- `team / task` 目前主要存在于存储 Schema 和底层筛选能力中，模型工具默认只暴露个人与当前项目作用域，尚未与 Project Task、项目 RBAC 或远程协作事件完整接线；
- 当前 `project` 作用域使用本机绝对工作目录作为 ref，只是本机召回过滤，不是多人共享知识库，也不是可跨设备的稳定 Project ID；
- Memory Pack 目前是根 Agent 先召回、再调用 `team_memory_pack` 的两步交接，没有统一的 Context Manifest 和运行使用记录；
- `local_memory pack` 虽然返回 item id/revision/source，但 `team_memory_pack` 当前只接收正文与过期时间，无法证明正文确实来自该 Pack，也会丢失结构化来源链；
- 任务完成、审核结论和 Artifact 尚不会自动产生可审核候选，也没有基于来源变化自动标记 stale/conflict 的完整服务；
- 生命周期字段已经存在，但 expires 目前只在召回时过滤，stale/superseded/conflict 尚没有自动检测引擎；
- 上游 `dashi-taskboard` 没有项目记忆库、团队记忆授权或 Memory Pack 领域实现。这部分必须保留 Harness 现有能力并继续扩展，不能期待上游替代。

### 18.3 目标四种作用域与权限

| 作用域 | 内容 | 默认可读者 | 写入与审核规则 |
| --- | --- | --- | --- |
| Personal | 用户偏好、长期指令、跨项目稳定事实 | 本机用户与其根 Agent | 绝不自动同步给项目或其他人；显式分享时创建新的 Project Memory，不改变原条目的私有性 |
| Project | 项目约束、架构决策、词汇、验收标准、已验证经验 | 目标态为项目内获授权的人和根 Agent | 当前只能标为“项目（本机）”；未来 Contributor 可提候选，Owner/Maintainer/Reviewer 按 RBAC 批准，远程同步必须另建签名与 E2EE 项目事件 |
| Team | 某类团队可复用的工作约定、能力边界和交接规范 | 该项目内被授权团队的 root | 不得包含 Personal 原文；由 root 或项目审核者批准，成员仍通过任务级 Context Grant 使用 |
| Task | 只对一个任务有效的需求澄清、局部决定和工作上下文 | 任务参与者 | 默认随任务关闭进入过期检查；需要跨任务复用时另提 Project/Team candidate，不能直接提升作用域 |

临时 Memory Pack 不属于第五种长期作用域。目标态下它是一次 `Context Grant`：绑定 `teamId + taskId + assignee + expiresAt + memory refs/digest`，只授权本次执行使用。当前实现通过普通 subagent followup 投递，因此只能保证正文不进入 `agent_teams.json`；正文仍会进入 worker 会话上下文，尚不能证明不会进入会话 transcript 或模型请求。未来若要求严格到期失效，需要专用的有界上下文通道，而不是只在文本里注明过期时间。

### 18.4 统一沉淀与召回链路

```text
Task / Comment / Review / Artifact / Human instruction
→ 生成带来源引用的 Memory Candidate
→ 敏感检测、去重、冲突检查和作用域检查
→ 用户或项目 Reviewer 审核
→ Active Memory（带 revision / verifiedAt / expiresAt）
→ 执行前按 Personal + Project + Team + Task 权限检索
→ Context Manifest 记录命中的 id / revision / scope / source
→ 私有或团队受限内容压缩成临时 Memory Pack
→ Execution Attempt 使用
→ 结果只能再次提出 Candidate，禁止自我循环写成 Active
```

只有用户明确说“记住”时，直接用户根回合才可把一条稳定事实写为 `active`。普通聊天、AI 推断、任务结果、评论摘要和自动化运行结果一律最多进入 `candidate`，不得静默长期化。

### 18.5 三类交互中的记忆

- **人 ↔ 人**：共享的是 Project Memory；界面显示作者、来源、作用域、revision、审核者、冲突和替代关系。不同意见进入 conflict/review，不能让最后一次编辑静默覆盖团队共识。
- **人 ↔ AI**：AI 必须能说明本次使用了哪些记忆及来源；用户可以纠错、停用、永不召回或要求记住。任务完成时 AI 可以提出“沉淀为项目记忆”，但默认等待批准。
- **AI ↔ AI**：worker 不直接查询个人记忆库；root 或授权 Context Service 按任务生成最小 Memory Pack。AI 之间的消息、Broker Intent 和结果不会自动进入记忆库，只能产生带来源的候选。

### 18.6 定时任务与记忆

Automation Definition 只保存召回策略，不保存被召回的记忆正文，例如：

```text
MemoryPolicy {
  scopes: [project, team, task]
  queryTemplate: "本次运行目标 + 当前任务要求"
  maxResults: 5
  required: false
}
```

每次触发时按当时仍为 active、未过期且有权限的记忆重新检索，并在 AutomationRun 中保存 Context Manifest 的 id/revision/来源和授权证据。私有正文不写入 Automation Definition、Run Ledger 或团队 JSON。这样记忆更新只影响未来运行，历史运行仍能解释“当时用了哪个版本”，又不会复制敏感内容。

若记忆服务关闭、权限撤销或没有命中，默认记录 `no-context` 后继续；只有流程显式配置 `required: true` 时才进入等待审批或 fallback，不能让调度器自行扩大权限。

### 18.7 UI 关系

记忆库不应变成任务板的第四种主数据，也不应把每条记忆画成常驻画布节点：

1. 现有“记忆中心”继续作为独立管理入口，负责全库搜索、候选审核、纠错、归档、导出和删除；协作工作台只增加“更多 → 本地记忆”，不重造管理器；
2. 任务详情增加“上下文”区域，只显示任务引用的记忆、当前 Execution Attempt 实际使用的 Context Manifest，以及“建议沉淀为记忆”；
3. 团队画布只在需要追踪时显示 `Context Grant / Memory Pack` 关系和失效时间，不展开私人记忆正文；
4. 流程画布提供显式的“检索上下文”和“提出记忆候选”节点，禁止在后台隐式写长期记忆；
5. 自动化详情显示 Memory Policy、最近一次命中数量和授权状态，不显示不该共享的正文；
6. 协作 Inbox 增加“待审核记忆候选/冲突”类型，但不把普通 AI 消息自动升级为候选。

### 18.8 实施门禁

1. 任务、评论、聊天、Run、Artifact 与 Memory 必须分表/分实体，不允许用聊天摘要冒充记忆；
2. Personal Memory 永不因加入团队、项目邀请或远程同步而被共享；
3. worker 和远程 peer 永不获得本地私人记忆库的搜索能力；
4. 每次召回都校验用户开关、作用域、RBAC、状态、过期时间、敏感度和 `recallPolicy`；
5. Memory Pack 正文不进入 Team Store、Broker 审计、Run Ledger 或项目事件；
6. Context Manifest 必须记录记忆 id/revision/来源和使用者，但对无权查看者只投影最小元数据；
7. candidate 不参与自动召回；archive/never/revocation 必须对下一次召回立即生效；
8. 任何自动沉淀都只能创建 candidate，且必须防止 AI 输出反复引用自身形成反馈循环；
9. 新 Context Service 达到上述边界前，继续保留现有两步 `local_memory pack → team_memory_pack` 安全路径。
10. 在真正建立项目级共享记忆前，UI 必须把现有 project scope 标为“项目（本机）”，不得暗示它会同步给其他人或设备；
11. `local_memory status` 也应受 root/宿主权限边界保护，避免 worker 获得不必要的私人库聚合信息；
12. 若产品继续使用“完全本地”文案，必须明确它仅指静态存储；召回给云端模型或投递到 worker 后应有可见提示与授权记录。

## 19. 第一阶段当前实现状态（2026-08-23）

本节是对前述长期方案的实现快照。为避免把 UI 原型误认为完整任务系统，下列状态词含义固定为：

- **已实现**：当前维护工作树中已有代码和回归测试；
- **兼容投影**：复用现有 Team Store，只读展示，不是新的 Project Task 权威写入口；
- **目标态**：已经确定边界但尚未完成，不得在 UI 或发布说明中声称可用。

### 19.1 已实现：在原“代理团队”位置内形成统一工作台

第一阶段没有新建突兀的顶级页面，也没有删除原团队入口。现有 `conversation.view` 中的“代理团队”页增加了内部工作区导航：

```text
代理团队
├─ 任务板
├─ 团队画布
├─ 跨会话任务
├─ 定时与自动化
├─ 参与者
└─ 协调收件箱
```

原有活动团队、团队切换、成员目录、运行动态、任务详情、历史、设置、快捷指令、项目协作入口、LAN/WSS/E2EE 配置入口仍可到达。第一阶段只整理呈现层，不以适配任务板为由减少 Team Runtime、Broker、Project Collaboration、Scheduler 或 Memory 能力。

其中边界必须如实描述：

- “任务板”仍是**所选团队安全投影的只读视图**，不会把团队运行时任务写入独立 Project Tasks；
- “跨会话任务”是唯一的项目协作工作区，只订阅当前 canonical `projectKey`，展示真实顶层会话席位、项目所有任务、依赖/移交、资源锁/冲突/待决策以及交付证据/变更历史；任务不按 Agent Team 分组，Team 仅作为会话的有界执行摘要。每个 root 独占其 seat 的项目板代表，私有 Team 只服务当前已领取任务并只获得有界任务上下文；成员、聊天和完整团队任务上下文不投影，Team 报告/完成不是项目证据，必须由 root 核对后显式提交 evidence/status。root 在采用席位和每个任务边界读取并响应定向请求；kind 固定为 `dependency_unblock/release/handoff/takeover`，响应固定为 `accept/reject/release`，遵守 `respondByAt`、no-wake 和 Host 验证的显式提前用户授权。随后通过原子 `claim_next` 一次领取一个 eligible 项并持续工作，手工 claim 和所有进入 `in_progress` 的 transition 共享事务内单活约束；阻塞时只创建一次持久请求后转取其他任务，直到全部终态或所有剩余 blocker 已记录；
- 独立七态 Project Task 与 Project Automation 的底层能力继续保留并作为安全数据面来源，但不再提供重复的一级产品入口，也没有 `project_task_*` 重复工具；
- “定时与自动化”同时保持 session-local Scheduler 与独立 Project Automation 的边界，没有创建第二套提醒历史；
- “参与者”保留已有项目协作入口，但当前跨设备业务数据同步能力以 21.4 的真实边界为准；
- 协调 Inbox 只展示安全元数据，不扩大消息正文投影。

### 19.2 已实现：大任务板不会随任务数无限拉长或横向挤压

当前四列为 `待处理 / 进行中 / 已阻塞 / 已完成`，其中 `blocked` 由 `blockedBy` 关系推导，不伪造 Team Store 中不存在的第四种持久状态。

任务多时采用“固定弹性视口 + 每列独立排队”，而不是让卡片缩成不可读宽度：

- 看板主区按**实际可用宽度**使用容器查询，自动切换 1、2、4 列；
- 每列高度在约 360–640 px 间随视口变化，列内独立纵向滚动；
- 打开任务详情时，宽屏使用侧栏，窄屏使用覆盖抽屉，剩余主区会重新选择列数；
- 卡片固定可读结构，长标题最多显示三行，状态、负责人、依赖和冲突保持独立区域；
- 待处理按最早创建优先，进行中/阻塞按最近更新优先，已完成按最近完成优先，先稳定排序再截断；
- 卡片和旧列表行使用 `content-visibility` 与固有尺寸提示，浏览器可跳过离屏绘制；
- 每列另有 200 张卡片的防御性显示上限；当前后端安全投影本身最多返回所选团队 200 个任务，因此正常情况下不会一次创建 800 个卡片 DOM；
- Team Store 中的旧任务不会因 UI 截断而删除。投影受限时界面明确显示“当前显示数 / 真实总数”，并说明较早任务仍保留在运行时。

未创建团队时仍显示完整四列空看板，帮助用户理解任务将如何进入队列；引导区放在看板之后，不再挤占看板主体。

### 19.3 已实现：自动团队改为真正的紧凑开关

“自动团队开启/关闭”只占一条紧凑状态栏：左侧是状态与一句说明，右侧是“返回对话”动作和原生可访问 `switch`。研究、开发、诊断、自定义方向以及立即填写目标被收进默认关闭的“可选：协作方向”折叠区。

关闭语义没有改变：存在活动团队时仍由 Host 拒绝关闭；允许关闭时只阻止创建新团队，已关闭团队历史继续保留。紧凑化只改变布局，不绕过原安全门禁。

### 19.4 已实现：团队画布缩放、平移和自适应

画布仍是只读实时关系图，但表现层已经从固定两条超长横排升级为一个统一 viewport/world：

- 默认 `Fit`，根据节点数、容器宽高和纵横比选择 1–20 列，将成员与任务分别自动换行；
- 使用 `ResizeObserver` 监听画布真实尺寸；处于 Fit 模式时，窗口、工作区侧栏或宿主布局变化会自动重新适应；
- 支持工具栏 `− / 百分比 / + / 适应`，缩放范围 10%–200%，百分比按钮可回到 100%；
- 支持 `Ctrl/Cmd + 滚轮` 围绕指针缩放，拖拽空白处平移，触屏保留原生双向滚动；
- 支持键盘 `+ / - / 0 / F` 和方向键，并保留明确焦点样式与 reduced-motion 降级；
- 节点和 SVG 关系线位于同一变换世界中，平移/缩放时直接更新 transform，避免每一帧重新渲染全部 React 节点；
- 关系线总量最多绘制 500 条，每个任务每种非分配关系最多绘制 6 条；分配关系优先，省略时显示明确提示，完整关系仍可从任务详情读取；
- 画布列表模式和原成员/任务点击能力继续保留。

当前自动布局测试覆盖 8 个成员与 200 个任务；桌面视觉核查覆盖 43 个任务、Fit/100%/放大/拖拽、打开侧栏后的重新适应。它证明第一阶段不会再把几十张卡片排成一条数千像素长行，但不等于已经具备 minimap、框选、持久布局、Execution Attempt 或跨设备任务边；这些仍属于目标态。

### 19.5 已实现部分的发布判定

第一阶段 UI 只有同时满足以下条件才算完成：

1. 无团队、普通团队、高任务量投影和窄宽度四种布局均可用；
2. 任务总数和安全投影截断对用户可见，不得用“只看到 200 条”冒充“只有 200 条”；
3. 画布 Fit、100%、缩放、平移、容器变化和列表回退均通过；
4. 原团队运行、Broker、Scheduler、Memory 和项目协作回归测试不减少；
5. 所有未接通能力继续写成“计划/预览”，不得由页面布局暗示已经具备。

### 19.6 已实现：唯一跨会话看板的全局稳定排序、精确总数与项目隔离

唯一“跨会话任务”工作区使用“同一 canonical 项目”这一用户上下文；底层 Project Tasks 与 Collaboration 数据面保留独立事实源、游标和写能力：

| 工作区 | 事实源与权限 | 首屏/后续页 | 完整性语义 |
| --- | --- | --- | --- |
| 跨会话任务 | 独立 Project Tasks/Collaboration 安全投影，展示席位、按状态秩/priority/时间稳定分组的任务、锁、移交、失败根恢复、证据、历史与请求 | 每区原生 keyset window + exact `COUNT(*)`/group totals；AES-GCM opaque cursor 绑定项目/revision/section/完整复合 boundary；按实际 UTF-8 预算推进 | 任务属于项目而非团队；24/120/128 KiB 只是页预算；Agent Team 只作为会话摘要 |

Remote collaborator 的业务同步 Store 有现存 16 MiB 明文序列化防御预算；它保护包含 task/automation 安全缓存、游标、receipt 与 outbox 的加密持久状态，不是 Project Task authority 页预算，也不是完整任务列表容量。任何内部条目防御限制都不能被宣传为系统任务容量。

每个 canonical `projectKey` 独立拥有会话席位、项目任务、依赖移交、资源锁、失败根恢复、证据、历史与协作请求；项目切换清理旧列表 DOM，不共享游标、缓存、SSE debounce、队列或锁。八个 section 各自按确定性 keyset 边界和精确 COUNT 查询，后续页绝不先读完整表再 slice，也不扫描其他项目。

项目任务的数据库查询与 cursor 共同使用固定复合键：`statusRank ASC, explicitPriority DESC, updatedAt DESC, createdAt DESC, taskRef ASC`。状态秩固定为 `in_progress/working`、`in_review/review`、`blocked`、`todo/assigned/queued/pending/backlog`、`done/completed`、`canceled/cancelled`；未知兼容值只能落入待开始组，不能越过执行中。cursor 的 AEAD AAD 绑定 canonical project，密文内同时保存 project revision 与完整末项边界；任何 revision 变化都拒绝续页，避免 SSE 移组后跳序、重复或漏项。精确 `taskGroupTotals` 在同一 read transaction 内按当前项目计算，priority 和 statusGroup 只通过固定安全投影暴露。

Client 收到 SSE 新首屏、project/capability/revision 变化、页元数据或首屏任务事实变化时，都会回到新首屏。每个 section 的“加载更多”以服务端 next keyset 页替换该区当前窗口，其他区不变；只有当前页完成渲染后才暴露其 next cursor。这样所有项目记录都能逐页到达而不会被 120 项 DOM 上限静默越过，React DOM 和内存也始终有界。任务按六个固定语义组显示精确计数、状态徽标和空态；完成组视觉弱化，取消组独立置底，但文字对比、键盘焦点、44 px 触控、ARIA 标题、375–1440 px 重排、reduced-motion 和 `content-visibility` 不降级。页面不预取、不为分页轮询、不自动重试；一个 `role=status aria-atomic=true` 的上下文状态统一宣告加载结果，各 section 用 `aria-busy` 和带区名的 accessible name。

所有看板动作继续遵守安全边界：“跨会话任务”只有只读筛选/翻页/刷新与写入官方 composer 的负责人草稿；真正的 `team_task_*` 团队变更必须由经过鉴权的 durable team tools 完成。独立 Project Tasks/Automation 基础设施不从此看板暴露重复写入口。任何工作区都不能绕过 Host 权限，自动创建成员、发送、审批、合并或执行基础设施操作。

## 20. 10+ 会话 × 200+ 任务的容量与模型准入设计

### 20.1 当前硬边界和真实风险

当前 Agent Teams 的容量限制分布在不同层，不能只看单个团队的 `maxActiveTurns`：

| 范围 | 当前边界 | 当前保护 | 尚存风险 |
| --- | --- | --- | --- |
| 一个团队的持久任务 | 最多 1,000 | 写入校验 | Team Store 是单个 `agent_teams.json`，每次小变更仍可能校验、复制并重写大文档 |
| 所选团队 UI 任务投影 | 最多 200 | 活跃任务优先、较新完成任务补位，明确显示截断 | 不能从当前看板直接浏览较早的第 201–1,000 项；未来需分页/查询而不是扩大首屏 DOM |
| 本机 authority Project Tasks | 每页最多 120 项且 128 KiB | 精确 total、AES-GCM keyset cursor、用户点击后续页、revision stale 刷新 | 单页预算不是项目任务容量；大条目按最后实际发送项续页 |
| Remote collaborator Project Tasks | 现有加密 safeCache 连接预览；同步 Store 16 MiB 防御预算 | `totalExact:false`、无完整分页、authority 设备引导 | 本机已同步数不是完整 total；内部防御限制不是系统任务容量 |
| 跨会话任务八区 | 每区后续页最多 24 项、首屏最多 120 项且响应 128 KiB | 每区精确 total；任务另有精确 group totals；AES-GCM revision/section/复合 boundary cursor；每项目独立 | 页预算不是项目容量；Client 用下一页替换该区当前窗口，使全量可遍历且每次 DOM 至多 120 项 |
| Prepared project board LRU | 最近使用 16 个项目 | 每项目缓存 prepared 投影和首屏，项目 revision 变化重建 | 16 是进程内缓存预算，不是项目容量 |
| 一个团队持久消息 | 最多 500 | 有界存储 | 消息正文、关系、文件数组和团队总字节仍需更细的新写入预算 |
| UI 事件投影 | 每团队最多 50 | 新事件优先 | 高频事件仍会导致服务器为订阅者重复构造快照 |
| 一个根负责人的未关闭同级团队 | 最多 8 | Host 硬限制 | 团队数量仍会放大存储和 UI 投影压力，但不再能绕过下方 Team worker 进程级槽位 |
| 一个团队的受管 worker 槽位 | 最多 8 | Host 硬限制 | 仍受同一根 `maxActiveTurns` 和进程级 Team worker 准入的双重约束 |
| 一个根负责人的活跃 Team worker 回合 | 默认 4、可设 1–8，同一根旗下团队共享 | 防止单根无限扩员 | 这是团队域限制，不覆盖普通根回合、普通 subagent 或 Scheduler 根回合 |
| 全进程受管 Team worker Activation | 同时最多 8；全局排队 32；每个 exact root 排队 8；等待 30 秒 | exact-root 轮转公平、root 内 FIFO、取消/超时/Stop 清队列，队列只保存身份元数据 | 只覆盖本插件管理的 continuable Team worker；尚无 Provider/model 共享 cooldown、优先级或全桌面执行准入 |
| 画布关系 | 绘制最多 500；每任务每类非分配关系最多 6 | 省略提示、详情可追溯 | 关系图不是完整查询面，不能拿绘制数作为业务关系总数 |

本地压力审计给出的参考基线如下，**仅用于定位瓶颈，不是产品 SLA**：

- 10 个根 × 每根 1 团队 × 每团队 250 任务 × 500 消息：安全投影平均约 3.875 ms、P95 约 4.387 ms，存储约 1.55 MiB，一次微小变更约 52 ms；
- 10 个根 × 每根 2 团队 × 每团队 1,000 任务 × 500 消息：安全投影平均约 5.399 ms、P95 约 6.308 ms，存储约 6.28 MiB，一次微小变更约 218 ms。

这说明首屏投影本身尚可控，但单文件全量验证/比较/写回会随全局团队总量增长。当前新增的 Team worker 进程级 8 槽公平准入已经阻止 10 个独立根把受管 worker 并发简单相加到 40–80；普通根回合、普通 subagent、Scheduler 根回合和 Provider 重试仍可绕过它，因此整个桌面端仍可能形成模型 API 洪峰。当前协作 presence 还会在每次 Team Store 变化时全量重算，也需要改为只响应成员/连接等相关变更。因此 200 条 UI 投影和 Team worker 局部准入只是第一道保护，不能替代后端分区、全桌面准入和背压。

### 20.2 UI 承载策略：只渲染窗口，不搬运整个事实库

当前和目标策略分四层：

1. **旧团队所选视图的有界投影**：首屏只返回所选团队最多 200 个任务和 50 个事件；未选团队只返回摘要。SSE 在 50 ms 窗口内合并更新，慢客户端只保留最新快照；
2. **已实现的 Project Tasks authority 分页**：每页最多 120 项/128 KiB，返回精确 total，并用 AES-GCM keyset cursor 在用户点击后继续；remote collaborator 保持 `totalExact:false` 的加密 safeCache 预览，不复用 authority 分页；
3. **已实现的跨会话任务分页**：每个 canonical 项目独立计算完整统计；每页最多 24 团队/120 任务/128 KiB，16 项 prepared 首屏 LRU，后续页按需且不缓存；
4. **浏览器降载与仍待完成部分**：容器响应式列数、独立列滚动、`content-visibility`、画布自动换行、transform 平移缩放和关系线限额已完成；每列真正 windowing/virtual list、评论/事件查询和详情全量按需加载仍是后续目标。

`content-visibility` 只是跳过离屏绘制，并不会减少 React 元素数量、事件对象或安全投影 JSON 大小，不能把它写成“已经完成全虚拟化”。单页页预算必须配合稳定、不透明、完整性保护且 revision-aware 的游标，不能靠把首屏上限粗暴扩大来冒充容量。

隐藏页降载已完成第一步：页面隐藏时关闭团队 SSE 和轮询，恢复可见时重新订阅并补拉一次最新快照；尚未完成的是服务器侧每会话/每进程连接上限、心跳和过期订阅清理。

### 20.3 模型 API 统一准入池（Team worker 局部准入已实现；全桌面目标态尚未实现）

当前维护工作树已经加入一个进程级 **Team worker Admission**：最多同时保有 8 个本插件管理的 continuable worker Activation；全局等待队列最多 32 项，每个 exact root 最多 8 项，等待 30 秒；调度按 exact root 轮转且 root 内 FIFO。新建 worker、初始 followup、AI-AI relay 和优雅退出消息都经过这一入口；用户 Stop 会取消该 exact root 尚未启动的等待项。队列只保存 root/child 等身份元数据，不保存 prompt、Memory Pack 或正文，生命周期名额只由匹配的 `childId + runId` 释放，避免陈旧事件误释放和跨会话内容污染。

这仍是插件内的局部安全层，不是完整的模型 API 调度器。它不覆盖普通根回合、普通 subagent、Scheduler 根回合、Provider 重试/限流，也没有 Provider/model 共享 cooldown。常驻 worker 会在其准确的 Activation 生命周期结束前占用名额；30 秒只计算全局准入队列等待，不包含既有的每团队操作锁等待。当前锁定的子代理运行时会在新建或冷恢复消息被接受前同步发出生命周期 `start`，因此正常宿主启动/退出路径可以准确绑定名额；未来若支持只热重载 Agent Teams 插件、同时保留上游现存 Activation，则必须增加 active-lease adoption 或跨 apply 单例，不能用可能误释放慢启动的固定定时器代替。

所有会导致模型执行的来源必须先进入同一个进程级 Admission Controller：

```text
用户“发送并执行”
AI-AI 唤醒 grant
团队成员 start / followup / steer
定时任务 occurrence
自动化 Action
跨设备经授权的执行请求
→ Global Admission Queue
→ Provider / model 共享冷却与速率预算
→ 按根负责人公平调度
→ Team Runtime 执行
```

该控制器必须位于桌面端共享 LLM/执行运行时，而不是只放在 `dsh-agent-teams` 插件里；否则普通对话、Scheduler 或其他自动化仍能绕过团队自己的限额。

建议首个安全默认值为进程级同时活跃 8–12 个模型回合，并可按 Provider/模型单独收紧；这不是把每个根的 `maxActiveTurns` 相加。队列至少记录：

```text
WorkAdmission {
  admissionId,
  sourceType,
  rootSessionId,
  projectRef,
  teamId,
  taskId,
  attemptId,
  actorRef,
  provider,
  model,
  priority,
  idempotencyKey,
  contextGrantRef,
  createdAt,
  expiresAt
}
```

调度规则：

- 先满足用户前台动作，再处理已授权阻塞解除、普通团队推进和后台自动化；同一优先级按根负责人轮转，避免一个会话占满所有槽位；
- 保留每根 `maxActiveTurns` 作为局部上限，同时增加进程级、Provider 级和模型级上限；
- 429/限流使用共享 Provider cooldown、带抖动退避和 circuit breaker，不能让每个 worker 各自重试形成重试风暴；
- followup、Broker 唤醒和自动化队列都必须有条数、字节、TTL 和每 actor 速率上限；满载时返回可见的 `queued / throttled / expired / requires-human`，不得无限积压；
- 取消、暂停、团队关闭和成员撤销必须能移除尚未开始的 admission；已经开始的回合进入现有 drain/stop 语义；
- “已投递/已接纳”不能显示成“模型已处理”或“任务已完成”。

### 20.4 会话和任务隔离：防止相互污染

当前已有的强隔离必须保留：真实 `execution.agent.id` 认证；多个同级团队时强制 `team_id`；只允许同一固定根负责人跨团队中继；每个 worker 使用独立 Session、独立 system prompt，并且不复制根会话完整 transcript；managed worker 不能再次创建隐藏代理。

仍需补齐的隔离层：

- 每个模型请求必须绑定 `rootSessionId + projectRef + teamId + taskId + attemptId + actorRef`，不得只凭自然语言标题路由；
- AI-AI relay 进入接收者上下文前使用结构化 envelope，明确来源团队、来源任务、发送者类型、目的任务、messageRef 和授权原因；当前只传一段文本会产生同名任务的语义串线风险；
- 任务正文、Memory Pack、附件和工具结果按 capability 引用按需获取，不能把其他团队快照拼入共享全局 prompt；
- Provider 客户端可共享连接池和限流状态，但不得共享可变 conversation、tool-result、retry body 或 Memory Pack；
- 日志、指标和错误需带不可混淆的 admission/task/attempt 引用，同时对 UI 只投影获授权的最小元数据。

## 21. 密集交互下的人、AI 与多电脑协作

### 21.1 三类交互的统一但不混流

| 交互 | 权威载体 | 是否默认调用模型 | 密集场景保护 |
| --- | --- | --- | --- |
| 人 ↔ 人 | 签名任务评论、分配、评审、审批和决策事件 | 否 | RBAC、revision、幂等 eventRef、通知合并、未读游标；同一决定冲突进入 review，不做最后写入者静默覆盖 |
| 人 ↔ AI | 明确的任务命令、Execution Attempt、评论中的“仅留言/发送并执行” | 只有明确执行动作 | 全局 admission、任务与 Context Grant 绑定、需求 revision 确认、AI 只能提交评审不能自批 |
| AI ↔ AI | Broker Intent、依赖/冲突/交接/评审的结构化 envelope | 默认静默；只有 grant 才唤醒 | 必要性校验、来源任务、去重、冷却、TTL、有界 Inbox、pause epoch、每 actor 配额 |

人和 AI 可以共享同一 Project Task，但不能共享一段无边界的聊天上下文。高频状态应合并为最新进度快照；交接、审批、需求变更、失败和验收保留不可丢的追加事件。UI 默认显示需要行动的聚合项，用户展开时才加载完整时间线。

### 21.2 多窗口、多会话的浏览器侧一致性

- 每个工作台订阅只绑定当前 `sessionId + selectedTeamId`，切换团队不应继续渲染旧团队详情；
- SSE 快照带 revision，客户端丢弃旧 revision；写入目标态使用 `expectedRevision`，冲突时重新读取并让用户决定；
- 多个窗口只消费同一事实源，不在各自 localStorage 维护权威任务副本；
- 后台窗口暂停重渲染和 SSE，前台恢复后通过最新快照修复间隙；
- Toast、未读和声音按 eventRef 去重，多个窗口由一个本机通知协调器选主，避免十个会话重复提醒同一事件。

### 21.3 多电脑同步所需的数据面

真正的多电脑密集协作不能靠“连接成功”四个字。目标数据面至少需要：

```text
签名 Project Event
→ 本地事务写入 Outbox
→ LAN mTLS 或 WSS/E2EE 传输
→ 对端校验成员身份、role、epoch、sequence、prevDigest
→ 幂等落库 unique(projectRef, eventRef)
→ 业务 ACK
→ 缺口检测 / gap request / 重传
→ 差距过大时加密 snapshot fallback
→ 更新每设备同步水位
```

还必须有 frame/字节上限、`bufferedAmount` 慢连接保护、每 peer 有界发送尾队列、离线持久 Outbox、撤销后清队列、成员密钥轮换、稳定 Project Room、设备证书指纹绑定和明确的冲突/重放处理。任务、评论、评审、消息、Memory Candidate 和自动化事件分别使用 typed schema，不能把任意 JSON 当“已同步”。

### 21.4 当前多电脑能力的真实边界

当前项目协作底座已经具备较强的密码学基础：TLS 1.3/mTLS、X25519/HKDF/AES-GCM/Ed25519、项目/epoch/发送者/目标绑定、角色与签名序列校验、eventRef 幂等和加密本地状态。

但当前实际产品数据面只接通 `presence / presence.ack`；LAN/WSS 收包只更新连接/投递状态，**尚未把 Team Store 的任务、评论或 AI 消息同步到另一台电脑**。因此参与者页和发布说明必须标为“安全配对/连接预览”，不能声称已支持多电脑共同编辑任务或离线同步。

在进入真实业务同步前，至少还要修正：

1. 多次邀请必须复用稳定 Project Room；不能每次生成新 roomRef 并让早期成员失联；
2. 建立业务 ACK、持久 Outbox、重连和 gap repair，而不是把“写进 socket”当完成；
3. 限制 Promise 发送尾队列和 WebSocket `bufferedAmount`，慢电脑不能拖垮整个进程；
4. 成员撤销和 epoch/key 轮换必须同步到活跃传输 peer，并立即拒绝旧 sender key；
5. LAN 客户端证书必须绑定已批准 deviceRef 的指纹；
6. 新事件写入前就校验成员、事件数、frame 和字节预算，不能只在 restore 时限制；
7. 解决 64 KiB 业务事件经 Base64/加密封装后超过 64 KiB transport frame 的边界不一致；
8. replay/sequence 状态需要持久化，不能只依赖进程内短期缓存。

## 22. 记忆 Context Grant 与定时任务统一准入

### 22.1 Context Grant 是执行授权，不是共享记忆库

第 18 节定义的目标 `Context Grant` 需要成为 `WorkAdmission` 和 `Execution Attempt` 的一等引用：

```text
ContextGrant {
  grantId,
  rootSessionId,
  projectRef,
  teamId,
  taskId,
  attemptId,
  assigneeActorRef,
  memoryRefs: [{ id, revision, scope, sourceRef }],
  digest,
  issuedAt,
  expiresAt
}
```

进入模型队列前校验 grant 与 admission 的 task/attempt/assignee 完全一致；模型开始后把实际使用的 id/revision/digest 写入 Context Manifest。不同会话即使在同一工作目录，也不能复用另一个任务的 Team/Task Grant。Personal Memory 仍只由用户和根 Agent 检索，远程成员或 worker 不获得库级搜索权。

当前两步 `local_memory pack → team_memory_pack` 仍作为兼容安全路径：最多 5 条、1200 字、30 分钟。它尚不能从正文证明来源和 revision，因此 UI 只能把它称为临时 Memory Pack，不能声称已经具备可验证 Context Grant。

同一绝对工作目录的多个根会话当前会共享 project-scope 本地记忆，这是现有设计而不是会话串线；但它不是多人共享 Project ID。目标态必须用稳定 `projectRef` + RBAC 显式授权，并在 UI 标注“项目（本机）”与“已同步项目记忆”的区别。

### 22.2 定时任务进入同一模型准入池，不删除现有 Scheduler

保留现有 Scheduler 的时间计算、持久事件、到期/逾期、同 Agent FIFO 和 idle 门禁；任何只记录 timer/occurrence 的操作不占模型槽位。只有 occurrence 将要唤醒 Agent、推进任务或执行 Automation Action 时，才创建幂等 admission：

```text
idempotencyKey = scheduleId + scheduledFor + actionRevision
sourceType = schedule | automation
priority = background（除非用户明确提升）
```

该 admission 与前台人-AI动作、AI-AI 唤醒和团队成员回合共享进程级/Provider 级预算。这样十个会话同时到点不会直接产生十组独立重试；满载时 occurrence 保持可见的 queued/overdue 状态，由 Scheduler 的既有规则决定补发或合并，而不是创建重复任务。

自动化每次运行按当时权限重新取得 Context Grant。调度定义只保存 MemoryPolicy，不保存记忆正文；权限撤销、记忆过期或 grant 失败时进入 `no-context / approval / fallback`，不得让 Scheduler 绕过记忆或项目 RBAC。

## 23. 分阶段落地与不可越界的发布声明

### 阶段 A：工作台止乱（当前已实现）

- 在原代理团队页内提供所选团队任务板、团队画布、唯一“跨会话任务”聚合、定时与自动化、参与者和 Inbox 导航；
- 大任务板独立滚动和响应式 1/2/4 列；
- 自动团队紧凑开关与默认折叠模板；
- 团队画布 10%–200% 缩放、Fit、平移、自动换行和关系限额；
- 200 任务旧团队安全投影、Project Tasks authority 精确分页，以及按 canonical 项目聚合的“跨会话任务”分页；
- 保留原 Team Runtime、Broker、Scheduler、Memory 和多人项目入口。

发布声明可以如实写“七态 Project Tasks 已提供本机 authority 的窄写入口和完整按需分页”“跨会话任务已提供同项目只读聚合分页”；同时必须明确 remote collaborator 只是现有加密 safeCache 的 `totalExact:false` 连接预览、没有完整分页，且任何看板都不会绕过 Host 权限或自动执行基础设施操作。仍不能声称全局 API 调度、完整可写团队总看板或多电脑完整任务分页已经完成。

### 阶段 B：单机容量与准入加固（已部分实现）

- 已完成隐藏页关闭/恢复 SSE；继续限制服务器连接、订阅、关系、消息、附件和团队总字节；
- 关闭团队非破坏归档，避免历史无限堆积在热文档；
- 已增加 Team worker 进程级公平 Admission（8 活跃、32 全局等待、每 root 8、30 秒、取消/Stop、精确生命周期释放）；继续把它提升为覆盖整个桌面端和 Provider/model 的共享 cooldown、优先级及可观测状态；
- AI-AI relay 已增加 message/sourceTeam/targetTeam/senderMember/recipientMember 的结构化 envelope；task/attempt 与更通用 actor capability 仍待权威任务域接入；
- 定时任务和自动化模型动作进入同一 admission；
- UI 明确把多人协作标为连接预览，并持续执行 10+ 会话压力回归。

这一阶段可继续使用现有 Team Store，但不得把全量 JSON 写回性能当作长期架构。阶段 A 可以在如实标注边界的前提下独立发布；在阶段 B 完成并通过压力门禁前，不得宣称适合“10+ 会话长期满负载无人值守运行”。

### 阶段 C：Project Task 权威域和可写任务流（已部分实现）

- 已建立独立七态 Project Task SQLite/WAL、revision/OCC、RBAC、`requirementsRevision`、Execution Attempt、Review、关系、评论和事件领域；
- 已按 exact execution 的 canonical 项目建立 Host HMAC lane registry：Project Entry/OS secret 仍为单例，而每个 lane 独占 opaque projectRef、Store key、SQLite/WAL、启动 ledger/queue；相同 raw request/batch id 跨 lane 不冲突，持久化不含 raw canonical key/workspace path；旧任务库仅凭唯一证据自动绑定，否则只允许 exact 当前 top-level direct-human root 通过独立 `bind_legacy` 非破坏绑定，普通 `initialize`、Agent/Team member 或模型布尔字段不能抢占；旧启动 ledger 不实体迁移，继续原位承担 exact-binding 的 status/stop/redeem fallback；
- 已提供本机 authority 的安全摘要、明确 create/allowed transition、精确 totals 与 120 项/128 KiB 的 AES-GCM keyset 分页；remote collaborator 继续使用加密 safeCache 预览而非 authority 分页；
- 当前 Client 只暴露窄写按钮和分页列表；完整需求编辑、评论、附件、详情、拖拽、Attempt/Review/Artifact 交互仍待接通；
- 旧 `team_task_*` 与 Project Tasks 仍是两个明确事实域，不迁移、复制或双写；未来若统一必须通过显式 adapter/迁移，而不是静默合并；
- 真正虚拟列表、服务端搜索/筛选、评论与事件分页仍是后续容量工作。

### 阶段 D：真实多人、多电脑任务事件流

- 稳定 Project Room、签名 Project Event、持久 Outbox/ACK/gap repair/snapshot；
- 人类 RBAC、邀请/撤销、设备证书绑定和密钥轮换进入实际数据面；
- 同一 Project Task 支持人-人、人-AI、AI-AI 的 typed 评论、分配、评审和交接；
- Project/Team Memory Candidate 与 Context Manifest 只按授权同步，Personal Memory 永不自动同步。

只有完成本阶段业务事件同步测试后，产品才可声称“多电脑共同处理团队任务”。

### 阶段 E：可执行流程画布与长期规模化

- `Trigger → Condition → Action → Approval/Fallback` 变为版本化可执行定义；
- Schedule/外部 Intake/任务事件都通过幂等 AutomationRun 和统一 admission；
- 提供 Run Ledger、失败补偿、dead-letter、预算和人工门禁；
- 画布补充 minimap、过滤/图层、边详情、布局偏好和运行回放；
- 建立长期容量 SLO、Provider 公平性、跨设备一致性、灾难恢复和安全评审。

所有阶段都遵守同一原则：**先写实标注当前能力，再逐步接通权威数据与执行链；不能为了界面看起来完整而把“预览”包装成“已经同步或已经执行”。**
