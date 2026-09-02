# Harness Desktop v1.0.29 验收

本文件先记录验收计划；真实命令结果、公开哈希和在线验证只在实际完成后填写。

## 自动化

```bash
npm run verify
npm run verify:release
# 仅供开发者本地复现；统一发布器不得调用或采用该命令生成的包
npm run release:orchestrate -- run --version 1.0.29 --through windows
```

正式发布包全部由 GitHub Actions 从不可变 Tag 构建；本地 `windows` 阶段不是发布门禁或发布输入。

自动化必须验证单一官方工作台、最小 IPC、WebView 安全边界、更新校验、隐私控制、Agent Teams 独立会话视图与宿主权限、同根多团队/跨根隔离、打包后 Runtime/Renderer/userData、自检、Windows 安装落盘契约和产物 SHA-256。官方 Runtime 补丁还必须验证精确锚点、旧补丁原位迁移、二次执行不再改动，以及删除 `setView` 透传后只降级为手动返回“对话”。普通子代理目录必须默认只留下紧凑计数入口，打开时固定为右侧抽屉而非输入区下方浮层。

## 源码实例：代理团队

1. 从隔离的 `$DSH_HOME` 启动源码实例，确认不影响日常 HarnessData、授权和已配对设备。
2. 默认关闭时，“代理团队”标签显示启用说明；打开“启用自动团队”后无需刷新即可进入工作区。确认开关只保存设置：没有伪造用户消息、没有填入草稿、没有模型或团队工具请求；策略从下一条真实的普通需求起生效。完成一次启用 → 关闭 → 再启用 round-trip：`teams=0` 时“关闭自动团队”必须位于顶部“自动团队已开启”介绍区之后、模板和输入框之前，点击后立即显示未启用说明，全程不发送消息、不写草稿、不调用模型且模型 Token 增量为 0；存在任一非 `closed` 团队时，关闭按钮必须禁用并明确提示先关闭所有活动团队，不能假成功。模拟关闭 API 失败时，页面应显示错误并重新读取权威状态回滚。
3. 启用后先不提供目标，确认零请求；发送简单任务，确认主模型负责人 solo。无活动团队且只有一个独立的一次性辅助时，确认最多使用一个官方普通 `subagent`，不创建团队且不显示为持久成员；发送至少两个需委派给不同成员的持续独立工作流、并确需依赖/交接/文件边界/汇总协调的目标，确认 AI 才创建团队。成员名称应为“界面、测试、安全、文档”等 2–6 字直白职责名，不出现技术称谓。另验证模板只是可选草稿入口，不会自动发送。
4. 点击“放入输入框”后，草稿必须先写入官方输入状态，再立即切换到“对话”供用户检查；不得自动发送、模拟点击或绕过官方输入。编辑、取消或发送均只在“对话”中完成；若视图切换能力不可用，团队页应给出切换到“对话”的明确后备提示。
5. 新会话默认打开“对话”。切换到“轨迹 / 代理团队 / 归档历史 / Godot 预览”等非对话视图时，只替换中央内容，左侧导航保持不变；底部官方输入框必须完全退出布局、键盘焦点顺序和辅助技术树，也不能留下空白占位。切回“对话”后输入框恢复，已有草稿不得丢失。
6. 创建测试团队后，确认主区域提供“实时画布 / 任务列表”切换并共用同一份团队状态：画布能派生活动成员、待处理/进行中任务、分配、依赖、阻塞和冲突关系，不产生新的写请求；已完成任务只显示为聚合入口并继续进入默认收起且带计数的“任务历史”。切回列表后仍可完整查看任务；成员通过统一官方“代理目录”按需查看，协作动态才使用右侧侧栏，“更多操作”和“团队设置”默认收起。确认页面不再出现常驻三列卡片墙或重复成员卡片；动态侧栏支持关闭按钮和 `Esc`，`prefers-reduced-motion` 下停止非必要动画，900px 以下安全降级、620px 以下占满可用宽度，均无遮挡、横向溢出或不可达控件。
7. 确认正式团队成员是工作区可见、持久、可关停的责任主体。点击“添加成员”不出现成员设计表单；生成的草稿要求 root 根据目标、任务缺口、成本和冲突判断是否扩员。分别让成员尝试调用 `subagent`、`subagent_fork`、`workflow` 和 `ralph`，必须全部硬拒绝；成员报告缺口；需要扩员时，只能由最外层 root 创建正式成员和持久任务。确认该禁令无法绕过 `maxMembers` / `maxActiveTurns`、文件冲突检查、任务认领和关停控制。
8. 点击“添加协作团队”，确认只生成待审草稿，不直接创建团队。草稿必须要求 AI 根据项目目标、现有团队分工和成本先判断必要性：现有团队足够时说明原因且不创建；确需新增时自动确定同级团队目标、必要成员、主/子模型、跨团队依赖和共同负责人中继。
9. 尝试添加全角/大小写/空白归一化后的同名成员，确认稳定拒绝且团队保持可用。
10. 点击团队页“代理目录”或画布成员节点，确认只打开当前负责人已有的官方子代理目录，不在团队页复制第二套成员卡片；负责人和 `provisioning:*` 记录不出现无效实时入口，健康 worker 可进入官方只读成员会话并在“轨迹”查看工具时间线。
11. 在官方代理目录确认运行中代理排在最前，可继续代理随后，已结束记录默认不展开；同组按最近活动稳定排序。团队画布中的成员节点采用同一活动优先顺序；主区域任务继续显示依赖、阻塞和冲突。关闭目录后不在团队工作区遗留成员侧栏。
12. 在“主模型与子代理”中先配置不同模型：确认固定负责人始终使用主模型；普通成员任务默认使用子代理模型；高复杂推理、总体架构、安全关键任务或子模型失败升级时才为成员选择主模型。清除独立子代理路由后，成员必须继承主模型。团队工作区和设置中不得出现重复的团队 Provider/模型/密钥配置 UI。
13. 在同一 root 下创建多个平级团队；只有此时才显示紧凑团队切换区，进行中团队直接可选，已关闭团队进入默认折叠的“历史团队”，跨团队投递元数据在所选团队的“动态”侧栏按需查看。确认宿主导出 `HARD_MAX_TEAMS_PER_ROOT = 8`：8 个未关闭团队应成功，第 9 个必须以 `AGENT_TEAMS_TEAM_LIMIT` 拒绝；关闭一个后才可再创建。把 `maxMembers` 和 `maxActiveTurns` 调低，确认前者对每队分别限制成员数，后者对全部团队的活动回合合计限制，拆分团队不能绕过并发上限且超限返回 `AGENT_TEAMS_ACTIVE_TURN_LIMIT`。再把两项都设为 8，确认设置回显 8/8、完整 `team_bootstrap` 可一次持久化并启动 8 名可见成员，且第 9 名在任何路径均于启动前拒绝；只把 `maxMembers` 设为 8、而 `maxActiveTurns` 保持 4 时，第 5 个活动成员仍应拒绝。通过自动判断路径重复边界测试，结果必须完全相同。团队切换后，未选中的团队成员继续后台运行。
14. 建立从团队 B 到团队 A 已知任务的跨团队依赖，确认 A 未完成时 B 显示 `teamId:taskId` 阻塞，A 完成后自动解除；循环依赖、未知团队/任务、跨 root 依赖，以及把团队成员再作为 root 建嵌套团队均必须拒绝。
15. 由共同负责人从团队 A 向团队 B 成员中继消息，确认事件含来源/目标团队元数据且正文不投影；普通成员跨团队中继、不同根负责人中继和省略歧义 `team_id` 均必须拒绝。
16. “动态”侧栏中的协作事件只显示发送方、接收方、状态和时间，不显示消息正文或内部投递错误；默认关闭侧栏时事件卡片不在主工作区出现。非空文件范围只显示安全隐藏说明。
17. 普通团队协调消息在主聊天为低权重折叠 `Agent Teams` notice，不再占据大块消息区域；展开后仍能审计模型实际收到的上下文。
18. 团队运行时切回“对话”和“轨迹”，确认成员继续后台工作；再切回团队视图时恢复最新状态，且客户端切换没有触发中断、退役或关闭。
19. 对官方 conversation view owner 补丁执行一次和二次，确认第一次只新增 `setView: actions.setView`，第二次幂等无改动；用无该属性的回退夹具确认团队创建成功后显示手动返回提示，且不会 DOM 点击或伪造路由。另对官方普通子代理补丁验证一次旧版迁移和一次二次执行：默认仅显示“子代理 N”紧凑入口；点击后从右侧打开目录抽屉，保留当前/历史/全部筛选、嵌套树、Token、时长、方向键/`Esc`、打开只读子会话。团队页调用 `sessions.setSubagentCatalogOpen(team.leadSessionId, true)` 后，精确匹配负责人的目录打开事件必须由同一抽屉消费，其他负责人不响应，监听器卸载时清理；二次补丁保持幂等。确认过滤后的分支严格按运行中、可继续、历史排序，运行后代能提升父分支；没有当前工作时仍停留在空的“当前”视图，历史不会自动铺开，必须由用户手动选择。900px 以下近全宽、620px 以下安全全宽，关闭后不占输入区空间。
20. 关闭一个团队后，它进入“历史团队”，选择后默认展开任务历史；成员记录仍从统一代理目录查看，协作事件继续从团队专属“动态”侧栏查看，其他平级团队继续运行，并能生成“创建新团队”草稿。
21. 用 v1.0.27 格式的 ZWJ 表情成员名和归一化碰撞存储启动，确认 v1 → v2 原位迁移且插件不会整体失效。
22. 检查键盘焦点、按钮名称、单一 `<h1>`、ARIA live 区域和浅色/深色主题可读性。
23. `dsh-desktop-progress` 只能注入语义化进度汇报策略，不得声明 Web client、轮询状态 API 或 `conversation.input.dock`；首页和官方输入区在 idle、运行、失败、受阻等任何状态下都不出现自定义进度条，进展只通过正常对话中的低频语义更新表达。
24. 从一个有明确资源 Owner 的成员调用 `collaboration_discover`，确认结果只含一个 ACL 允许的 `routeRef`、显示名、活动和最小任务/资源声明；结果、工具参数和渲染文本均不得含 `sessionId/memberId/userId/deviceId`。无匹配或不同 fixed-root scope 返回空，不能扩大为广播。
25. 对 `UNIQUE_OWNER`、`DEPENDENCY_BLOCKED`、`RESOURCE_CONFLICT` 和 `FORMAL_HANDOFF` 分别提供成立与伪造证据；Host 只准入成立的一项。重复、过期、环路、`fanout>1`、LAN hop、暂停发送方和未配置的 `MANDATORY_REVIEW` 必须拒绝。请求 `wake_level=2` 时确认降级为 L1 Inbox，`subagents.followup`、root followup 和模型 driver 均没有被调用。
26. 目标成员在自然协调边界调用 `collaboration_inbox`，确认只能读取/确认自己的项；其他成员为空。重启 Host 后 Presence 路由、Inbox 和冷却仍有效。检查 `agent_collaboration.json` 使用 Host 私有原始映射，模型公开结果仅保留不透明引用。
27. 在 Intent 入箱后执行真实 UI Stop：团队持久变为 paused，发送方不能再发起协作，目标不被唤醒；恢复前 Inbox 不返回旧项。由用户在后续直接回合显式 `team_resume` 后，旧 `pauseEpoch` 项应为 `superseded` 而不是重放。并发订阅继续按 50ms 窗口合并 SSE，受影响 root 收到更新，其他 root 不收到无关快照。

### 计划追踪与恢复专项

- **计划门禁与重放**：保存 draft 后分别尝试 spawn、claim、complete，均须在 child driver 或任务 mutation 前拒绝；提交后核对 canonical plan hash/revision。完全相同请求重放不得新增团队、成员、任务或 attempt；相同请求标识配不同 hash、旧 revision 或实质变化必须以幂等/CAS 冲突拒绝。
- **任务先于成员**：无持久任务的公开 spawn 必须拒绝；模拟成员启动前崩溃，确认可以从未发布占位恢复；模拟 child 已发布但 work followup 失败，确认保留 partial/uncertain 记录且重放 fail closed，不重复 child。
- **Stop 竞态与 fencing**：在 spawn、claim、complete 各自进入串行边界时并发 Stop，验证新 `pauseEpoch` 先持久化；旧 `claimId/leaseEpoch/attempt` 的完成、释放和 checkpoint 回写全部拒绝。中断失败不得恢复 active；正常新 epoch 操作不被旧事件污染。
- **checkpoint 边界**：零 checkpoint 必须可安全预览/恢复，不能凭空生成；合法 checkpoint 始终标记未验证。注入 Host 状态、完成百分比、权限、路径、凭据、消息正文、外部 receipt 或超限内容必须拒绝或从安全投影删除，不能覆盖 Host attempt/interruption 历史。
- **两阶段 Resume**：preview 只读、零唤醒且团队仍为 paused；commit 必须绑定 request、preview、team revision 与 pause epoch，并在状态变化同一事务保存 receipt。完全相同 request/CAS 重放幂等；同 request 不同内容、旧 token、过期 preview/CAS 拒绝。混合健康、失败、权限 unknown、陈旧 claim 和 `outcome_unknown` 节点时，只恢复健康节点，异常节点保留 Attention，不能冻结全队或批量误重放。
- **授权、能力与外部副作用**：逐项覆盖 `unknown|human_attested|host_verified`；普通布尔、错 plan hash、非 direct-human 和模型 checkpoint 都不得生成 `host_verified` 或升级 capability。工具不能提供可验证权限事实时只能返回 `unknown`，不得猜成 allowed。外部 effect identity 必须由 Host 导出，模型 `idempotencyKey` 不权威；`resolve_unknown` 只允许精确 direct-human root。对有稳定 command/receipt 协议的夹具验证幂等收敛；对任意外部 UI/无 receipt/网络超时夹具必须产生 `outcome_unknown` 并阻塞自动重试，测试名称和文档均不得声称普遍 exactly-once。
- **同项目跨会话**：同一 canonical `projectKey` 的另一个最外层直接用户先 preview adopt/handoff，再 CAS commit；核对 append-only `ownershipHistory`，全部旧 worker lease/claim 被撤销、旧 child 不 reparent、未完成任务回 pending，旧 attempt/checkpoint/任务历史保留。跨项目、同名不同 project、成员调用、自动续轮、旧 revision 和缺少直接用户授权全部拒绝。
- **迁移与依赖**：分别载入旧空/无 worker 团队和含活跃 worker、pending/in_progress/completed/cancelled 记录的旧存储；前者必须成为 `draft + legacy_unplanned`，后者不得强行中断现有 worker，但在 recommit 前必须拒绝新扩张、spawn 与 claim。确认非破坏升级、顺序与审计字段保留，缺省新字段使用安全值。继续覆盖依赖环、缺失依赖、reopen 与进行中 dependent 冲突、跨团队来源关闭/取消失效，以及 force close 只取消未完成任务并保留 completed 历史。
- **陈旧回写**：Stop、adopt、reopen 和新 attempt 后，使用旧 claim/lease 的 complete、release、checkpoint 必须返回陈旧 fencing 错误并保持状态逐字不变；只有当前 fence 或已提交且完全匹配的 receipt 可以幂等收敛。
- **桌面与手机真实性**：四主区固定为 Ready/Running/Attention/Done，Cancelled 只进历史；不得根据模型文本渲染数值百分比，只允许 Host 验证里程碑计数、attempt、最后活动和时间。checkpoint 与成员 Todo 里程碑均明示未验证，permission unknown 与 `outcome_unknown` 有独立说明；手机首屏和无障碍摘要必须回答“需要确认什么、卡在哪里、下一步做什么”，保留键盘/读屏、44px 触控、焦点、对比度、减少动态和无横向滚动门禁。

28. 对项目协作纯协议核心生成 owner、contributor、reviewer 三种设备 Grant，确认公开投影只含 `projectRef/collaboratorRef/deviceRef`，不含私有项目、用户或设备句柄；篡改 Grant、越权事件、原始身份字段、非 lossless JSON、过期事件、错序/错链和伪造签名必须拒绝。
29. 按游标分页重放离线事件并篡改游标，确认 HMAC 绑定项目和偏移；执行设备撤权、Ed25519 设备密钥轮换和双签 authority epoch 迁移，确认旧 Grant、旧签名或被撤权设备不能再写入。
30. 将 Host snapshot 写入 AES-256-GCM 项目状态存储，确认磁盘仅有不透明 `projectRef`、revision、nonce、密文和 tag，不含私有项目/用户/设备句柄、项目 secret、成员表、事件或 Authority 私钥。错误密钥、密文篡改、同文件并发 CAS、last-seen rollback 和外部 minimum revision 回退必须失败；恢复后事件 sequence/hash chain 连续。持久服务只有加密 CAS 成功后才能发布内存变更。
31. 分别以 `lan_mtls` 与 `remote_wss` 封装定向 E2EE 数据包，确认 X25519+HKDF+A256GCM 隐藏事件正文、Ed25519 绑定发送设备，`hop=0/fanout=1` 且目标唯一。LAN 数据包还必须通过 pinned mTLS peer 回调；篡改密文、签名、epoch、目标、收件密钥、TTL 或重放均拒绝。显式 LAN adapter 必须默认关闭，拒绝 wildcard/DNS/公网 bind，启用后强制 TLS 1.3、双向证书、`dsh-project/1` ALPN、连接/帧上限和通用拒绝响应；测试不得因此注册生产监听端口。远程适配器必须只接受无凭据的 WSS/443，复用 blind relay 路由密文；authority 只能在签名包成功准入后绑定临时 relay peer，重放、断线 peer 和未出现目标均不得投递。
32. 以三个互不包含的路径初始化 Workspace Authority，确认 Authority store、电脑 A 的实时工作树和隔离任务 Workspace 不能重合；公开 WorkspaceLease 不得含物理路径。读/写重叠只产生提示，写/写和独占重叠必须带 `RESOURCE_CONFLICT` 拒绝；未被当前 Workspace 写声明覆盖的文件不能发布 ChangeSet。Git adapter 必须只运行 fixed allowed root 内的受信 `git(.exe)`，把电脑 A 的已提交 HEAD 只读导入独立 bare repository；即使电脑 A 有未提交文件，导入、任务提交、合并和落地也不得改变其 HEAD 或内容。
33. 从真实隔离 worktree 提取无 rename 歧义的文件集、binary diff digest 和 tree digest，对同一 pinned base 发布不可变 ChangeSet并规划 MergeGroup。临时 merge worktree 必须真实 cherry-pick、报告冲突、把无冲突结果锚定到精确 group ref，主线用 Git `update-ref` old/new CAS；替换 group result、主线 Head 变化和旧 authority epoch 都必须阻止落地。分块 Artifact CAS 必须拒绝错 offset、伪造 chunk digest、超限、不完整和错误总 digest；相同内容并发写应原子收敛，回读有界，磁盘损坏可检测，公开状态不含 object/staging 路径。只为精确 result commit 记录 ArtifactSet，伪造 Gate 或替换 ArtifactSet 必须拒绝；晋升 epoch 后旧 Lease、Claim、MergeGroup 全部 fenced。
34. 把远端 ChangeSet ref 打成 Git bundle 并经 Artifact CAS 分块传输；接收端必须在唯一 quarantine ref 内完成 bundle verify/fsck，重新计算 commit、唯一 parent、文件集、binary diff digest 和 tree digest，任一替换、错误仓库、错误 ref、缺失 CAS 或超限都拒绝，成功后才原子绑定正式 ChangeSet ref；并发导入相同内容应幂等。Workspace Authority 快照必须带 HMAC 后加密保存；落地先持久 `landing_pending`、再执行 Git Head CAS、最后发布状态 CAS。模拟 Git 已前进但最终状态写入中断，重启应自动补全；无关 Head 抢占必须保留日志并拒绝恢复。
35. 注册只含 template/environment digest、版本、profile、超时和重试上限的测试模板；任何 command/args 字段必须拒绝。merge 只调度 required suite，nightly/release 调度全部 suite，release 优先；Runner 只有 capability 和 trust 均满足才能取得任务。验证租约心跳、超时重试、并发 revision CAS、取消、暂停不唤醒和显式 resume 重排队。Quality 私钥/Runner/计划/证据/Receipt 与调度队列/活动租约必须在同一加密 Host snapshot 中重启恢复；模拟最终保存失败时不得提前发布 TestAttestation 或消费租约，重启必须持久协调过期租约。使用不同信任等级 Runner 提交 Ed25519 TestAttestation，确认只有满足 TestPlan 最小数量、信任级别、时效且绑定同一 merge group/commit/ArtifactSet/manifest 的证据能得到 passing Gate Receipt。
36. 沿 Signal→Occurrence→Defect→Fix→Verification→ReleaseObservation 建立加密持久闭环；错误修复制品、未知证据、不同指纹复现不能验证或重开该 Defect，干净发布观察后才能关闭，同指纹同制品复现必须 Reopened。GitHub/GitLab/Jira adapter 只能从回调临时取得白名单 credential header，拒绝私网/IP endpoint、伪造操作、超限响应和未验签/重放 webhook；公开结果不得含项目定位符、原始 Issue ID 或凭据。外部关闭只能形成候选观察，不能改变内部状态。Outbox 必须先持久 pending，再投递平台，最后提交完成 revision；分别模拟 Issue 创建和 ReleaseObservation 评论成功但最终状态保存失败，重试不得重复创建或评论。Stop 必须持久 pause epoch，暂停和重启后均不投递，只有显式 resume 才恢复。

## Windows 安装版

1. 从实际发布候选下载或复制安装器，先核对 SHA-256。
2. 启动 Inno Setup，确认简体中文向导、官方图标和当前用户安装。
3. 记录原安装目录与 HKCU 卸载信息；覆盖安装 1.0.29 后确认原目录、授权、会话、主题、插件、移动配对和用户数据保留。
4. 启动后进入官方 Harness；确认版本 1.0.29、Electron 43.2.0、官方 Harness `0.1.1-rc.2` 和打包自检通过；复验旧会话投影可重折叠、子代理谱系切换、视觉模型与 Files API 图片上传回退。
5. 复验代理团队独立视图和“查看实时工作”。
6. 在已经是 1.0.29 时再次执行“下载并安装”，确认显示“当前桌面版已经是最新版本”，不是更新失败，并清除旧错误。
7. 使用不可达首选地址和可达后备地址检查更新，确认自动换源且最终文件仍强制 SHA-256。
8. 完成真实模型请求、官方权限操作和可继续子代理会话。
9. 退出后确认无残留 Runtime 进程。
10. 卸载测试安装并恢复验收前精确注册信息；默认不删除 HarnessData。

## Windows 便携版

1. 核对公开便携版 SHA-256 后直接运行。
2. 执行 `--self-test`，确认版本、官方核心、Renderer、原生模块、Agent Teams 插件和 userData 检查全部通过。
3. 重复官方工作台、代理团队、更新幂等和真实请求验收。
4. 关闭后确认进程退出，不在程序目录留下安装器状态。

## GitHub、Android、组件与 CNB

1. `v1.0.29` Tag 不移动、不覆盖；`stage-draft` 必须拒绝 existing release，只创建非公开且禁用 overwrite 的 draft，并保存资产 ID/名称/大小/digest 精确 snapshot。
2. Windows 门禁必须用工作流身份认证下载 draft 全部资产，由 PowerShell 解析并逐项验证 `SHA256SUMS.txt`，且下载集合与 snapshot 完全一致；随后对下载的 Inno 安装器执行 `/VERYSILENT` 真实安装，检查 installed 版本与 `resources/app.asar`、解析 installed `--self-test` JSON、成功卸载并清理临时目录。最终 `publish` 仅在重新确认仍为 draft 且资产 snapshot 未变后设置 `draft=false`；任一失败都保留 draft。
3. Android APK 必须由长期证书签名，复核包名 `io.harnessdesktop.mobile`、versionCode `10028`、versionName `1.0.29`、证书指纹和独立 `.sha256`。
4. macOS Intel/Apple Silicon 执行架构和原生模块自检；iPhone/iPad 仅声明通过模拟器与 Safari 工作台，不声称有可安装 IPA。
5. 三个平台组件清单和 ZIP 复核 Ed25519、目标架构、文件索引、完整包后备 URL 与 SHA-256。
6. `release-manifest.json` 只在 GitHub 精确 18 项最终资产存在后刷新。
7. CNB 只从 GitHub 云端镜像；确认本机未上传二进制，并逐项核对 CNB/GitHub 大小与 SHA-256。
8. 仅在新组件双源验证后，把公开签名清单原字节提升为三个 stable feed，确认 GitHub、CNB 和仓库字节一致。

## 结果记录

- Agent Teams 域/运行时/UI/SSE、自动协作 Broker/Host/持久 Inbox、项目身份/RBAC/加密持久化、LAN mTLS/WSS E2EE、Workspace Authority/真实 Git/Merge/Artifact CAS/远程 bundle/落地恢复、签名测试证据/Gate、持久 Runner 编排、加密 Defect 闭环、GitHub/GitLab/Jira Outbox、模型路由与 MinGit 专项：171/171 通过；官方 Runtime 补丁兼容专项：10/10 通过；合计 181/181。
- 完整自动化：`npm run verify` 静态门禁和 690/690 测试通过；`npm run verify:release` 发布契约审计通过；`npm run verify:release` 发布契约审计通过。
- 源码实例人工验收：待执行。
- Windows 安装版 SHA-256/结果：待执行。
- Windows 便携版 SHA-256/结果：待执行。
- GitHub/Android/组件/CNB：待执行。
