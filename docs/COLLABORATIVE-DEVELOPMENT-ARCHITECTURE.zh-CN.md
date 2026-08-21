# 自动协作与多人研发架构

本文描述 Harness Desktop 从本地代理团队扩展到跨会话、跨用户和多人源码研发的统一边界。LAN 只是传输方式，不是团队类型；画布、列表和历史都是同一事件模型的安全投影。

## 1. 总体分层

1. **暂停与身份基础层**：用户停止后持久化暂停栅栏；自动消息、团队报告、目标、计划任务和旧 epoch 事件都不能唤醒会话。UI 和模型只使用稳定 `collaboratorRef/routeRef`，`sessionId/memberId` 始终留在 Host 内部。
2. **本地代理团队层**：官方子代理目录负责运行中、可继续和历史会话；团队页负责目标、任务、依赖、冲突和实时画布，不复制第二套成员目录。
3. **自动协作层**：`WorkPresenceIndex/CollaborationDirectory` 发现经过 ACL 授权的最小工作状态；`CollaborationBroker` 只接受 Host 可验证的必要协作意图。
4. **项目协作层**：用户是泳道，每个用户的本地代理团队是可折叠组；LAN mTLS 和远程 E2EE WSS 传输同一种签名事件协议。
5. **源码权威层**：权威对象仓库与可写工作区分离；每个用户、任务和 Agent 使用独立 clone/branch/worktree，通过不可变 ChangeSet 和合并队列进入主线。
6. **质量与缺陷层**：精确 merge-group commit、签名 Artifact Set、影响测试、全量回归、Defect 路由、修复与发布观察形成证据闭环。

## 2. 自动协作准入

固定决策顺序：

```text
Observe → Avoid → Require → Resolve → Admit → Deliver
```

模型只能提交结构化 `CollaborationIntent`，不能输入或解析原始会话 ID。Host 必须重新验证：

- 目标是否是当前 ACL 下可见、未过期的精确 `routeRef`；
- 是否存在 `DEPENDENCY_BLOCKED`、`UNIQUE_OWNER`、`RESOURCE_CONFLICT`、`FORMAL_HANDOFF` 或策略限定的 `MANDATORY_REVIEW`；
- 对应任务、资源、Owner、移交或评审策略证据是否仍然成立；
- 是否命中重复、冷却、环路、扇出、跳数、暂停 epoch 或撤权规则。

默认 `fanout=1`、本地 `hop<=1`、LAN `hop=0`。普通投递进入无唤醒 Inbox；只有明确的值班/授权策略允许 L2 唤醒。暂停目标只能得到绑定 `pauseEpoch` 的延迟投递，恢复后仍须重新验证，不能直接重放旧事件。

纯策略核心位于 `plugins/dsh-agent-teams/lib/collaboration-broker.js`，提供：

- HMAC 派生且不可反查的稳定 `routeRef`；
- 默认拒绝的 ACL 发现；
- 必要理由和证据门禁；
- 发送方/目标新鲜度、单目标、冷却、去重、环路、扇出和跳数限制；
- L0 建议、L1 无唤醒 Inbox、L2 授权唤醒和暂停延迟；
- 一次性 `admissionRef`，只有 Host 消费时才能取得私有目标会话。

Host 持久层位于 `plugins/dsh-agent-teams/lib/collaboration-service.js`。它把同一固定负责人拥有的未关闭本地团队聚合成一个不透明 scope，持久化最小 Presence、私有路由映射、Inbox、跨重启冷却和有界顺序审计到 `storages/agent_collaboration.json`，并用原子临时文件提交。`plugins/dsh-agent-teams/lib/index.js` 注册 `collaboration_discover`、`collaboration_intent` 和 `collaboration_inbox`；三个工具都必须通过当前精确活动调用者与团队成员资格检查。当前 `hasWakeGrant` 固定为拒绝，因此 L2 请求只会降级，代码没有协作自动唤醒路径。

暂停状态变化会单调推进服务层 `pauseEpoch`。旧 Inbox 或延迟项一旦跨越暂停/显式恢复边界就标记为 `superseded`，不能在恢复后重放。当前接入只覆盖同一固定负责人的本地 Agent Teams；跨根/跨用户目录、项目 RBAC、LAN 传输和显式 L2 值班授权尚未接入。

## 3. 源码最初位于电脑 A

电脑 A 的实时工作目录永远不能成为多人共享的可写真相源。导入时先检查 dirty/untracked、秘密、`.env`、嵌套仓库、子模块、LFS、大文件、符号链接、大小写碰撞、换行和生成文件，再形成显式基线。

优先模式：

1. 已有 GitHub/GitLab/Gitea：远程 Git 为权威源，A 是普通节点；
2. 隔离 LAN：A 托管 bare 权威仓库、LFS/CAS、签名事件日志和加密备份；
3. 源码不可复制：每个用户和 Agent 的隔离 worktree/容器仍位于 A；
4. 非 Git：先使用内容寻址 Snapshot/Shadow Git，SVN/Perforce 后续通过适配器接入。

正常流程：

```text
导入基线 C0
→ 任务创建独立 WorkspaceLease + branch/worktree
→ 声明 ResourceClaim
→ 私有编辑与检查点
→ 发布不可变 ChangeSet
→ 重叠检测/重放/审查
→ 生成精确 merge-group commit
→ Build once、测试同一 Artifact Set
→ 独立 GateDecision
→ CAS 合入主线
→ 所有工作区 fetch 新主线
```

同步 immutable commit/ChangeSet，不做实时文件夹镜像。A-only Authority 离线时，已有 clone 可继续私有编辑，但不能产生新的权威合并；提升备用 Authority 必须产生新 epoch、显式审批并使旧租约失效。

## 4. 重叠、冲突和合并

资源身份是 `repoRef + canonical resourceRef`，不是裸路径。声明可覆盖文件、行、符号、API/Schema、数据库迁移、生成源、二进制、lockfile、构建目标、测试环境和设备。

- 读/读允许；读/写提示；写/写需要协商或显式并行计划；
- 普通文本使用 pinned base 的乐观并发和三方合并；
- 二进制、Schema、迁移序列、生成源和部分 lockfile 使用带 fencing token 的强租约；
- rename/modify、delete/modify、case-only rename、symlink escape、换行、submodule pointer 和 LFS 冲突必须有专门处理；
- 生成文件在源文件合并后统一重建，lockfile 在合并组中用固定工具链重算。

合并队列只允许落地已测试的同一 Git tree/OID。主线发生变化后旧 Gate 立即 stale，必须重新生成和验证 merge group；严禁用绿色开发分支的结果替代集成树测试。

## 5. 测试和全量回归

不可变决策元组：

```text
mergeGroupCommit
+ artifactManifestDigest
+ testPolicyVersion
+ environmentManifestDigest
```

- L0：格式、lint、类型、编译、secret、受影响单测；
- L1：ChangeSet 受影响组件、契约、覆盖率、依赖和静态安全；
- L2：精确 merge group 的集成、关键 E2E、安装/升级冒烟和合并门禁；
- L3：nightly 全量、多平台、fuzz、soak、性能和完整迁移链；
- L4：Release 全量、全新安装、跨版本升级、回滚、签名、权限、灾备、网络切换和 canary。

发布、工具链/CI、公共基础、认证/加密、更新安装、数据库迁移、API/协议/文件格式、平台代码、未知影响、高风险修复、证据污染和回滚验证必须全量回归。影响图未知或过期只能扩大范围。

Worker 只提交绑定精确环境和制品的签名 TestAttestation；独立 Verifier/Policy Engine 生成 GateDecision。Flaky 首次失败不可隐藏；隔离必须有 TTL、Owner 和 SLA。

## 6. 缺陷闭环

原始 Signal、一次 Occurrence、去重 Defect、Fix、Verification 和 ReleaseObservation 分层保存。测试失败先生成 FailureRecord，经指纹、复现和分类后才升级 Defect，避免 Issue 风暴。

```text
New → Triage → NeedsRepro/Confirmed → Assigned → Fixing
→ Review → Verification → Resolved → Released → Verified → Closed
```

同指纹在已修复 release 再现、回归测试再次失败、安全规则再次命中或风险接受到期时自动 Reopened，旧 Fix 和验证链保持不可变。

路由综合 CODEOWNERS、任务 Owner、近期相关 ChangeSet、组件经验和值班策略，一次只选择一个最佳 Owner；默认 silent/no-wake。S0/S1 只有站立 on-call 授权才能唤醒。修复必须尽量先提供在 base 上失败、在 patch 上通过的回归测试，再运行定向、影响、合并组和策略要求的全量回归。

日志、转储、附件和客户数据在 Authority 边缘完成校验、隔离、秘密/PII 脱敏和加密；外部 GitHub/GitLab/Jira 只同步允许公开的最小投影，并使用幂等事件 ID、来源标记和字段所有权避免回声循环。

## 7. 画布

- **执行视图**：用户、代理团队、任务、依赖、冲突和交接；
- **代码视图**：仓库、Workspace、ChangeSet、资源声明、Merge Queue；
- **质量视图**：Artifact、TestRun、Gate、Defect 和 Release。

当前本地团队画布只读地派生成员、活动任务、完成聚合、分配、依赖、阻塞和冲突；列表与历史继续保留。项目级画布后续以用户为泳道，将每个用户的本地代理团队折叠为组。动画只能表示真实运行或真实传输，并遵守 `prefers-reduced-motion`。

## 8. 分阶段落地

1. **已实现**：本地团队生命周期排序、历史折叠、统一代理目录和实时画布；
2. **已实现**：Broker 纯核心的目录、匿名路由、必要性、ACL、冷却、唤醒与暂停门禁；
3. **已实现（本地 fixed-root 范围）**：持久 Presence、Intent 工具、无唤醒 Inbox、暂停 epoch、跨重启冷却和审计；
4. **已实现协议、加密持久化与 LAN/WSS 传输适配器，产品配置待接入**：项目、协作者和设备均使用 Host 生成的不透明引用；成员 Grant 与事件采用 Ed25519 签名，按角色执行 RBAC，按设备维护序列/哈希链和幂等事件引用，并支持带 HMAC 的离线游标、撤权、设备密钥轮换及双签 authority epoch 迁移。Host snapshot 使用 AES-256-GCM、原子 rename/fsync、revision CAS 和 rollback 下限持久化，事务服务只有加密保存成功后才发布内存变更；LAN/WSS 定向数据包使用 X25519+HKDF+A256GCM、Ed25519、TTL 和重放门禁，LAN 额外要求 pinned mTLS peer。LAN TLS 1.3/mTLS/ALPN 监听适配器默认关闭，只接受显式私网 IP、有限连接/帧和已认证 peer；远程适配器复用现有 blind relay 的 authority/collaborator 房间，只转发有界密文，并在 E2EE 签名准入后建立设备到 relay peer 的临时绑定。当前仍未配置真实证书/Pin/relay room、注册生产项目服务或模型工具；
5. **已实现 Authority、Git/worktree、远程 bundle/CAS 与崩溃一致性层，产品服务待接入**：Authority store、电脑 A 的实时工作树和任务 Workspace 强制使用互不包含的路径；WorkspaceLease 绑定 epoch/fencing token，ResourceClaim 区分读写提示与写写/独占硬冲突，ChangeSet、MergeGroup 和 ArtifactSet 内容寻址且不可变。固定受信 Git 只读导入电脑 A 的已提交 HEAD 到独立 bare Authority，真实隔离 worktree 生成精确 diff/tree digest，MergeGroup 以临时 worktree 执行 cherry-pick、报告冲突并把结果锚定到精确 group ref；落地主线使用 `update-ref <new> <old>` CAS，电脑 A 的工作树和 HEAD 始终不被写入。Artifact CAS 支持分块 offset/chunk digest、最终 sha256、原子去重、回读上限和损坏检测；发送端把精确 ChangeSet ref 打包后进入 CAS，接收端在 quarantine ref 中验证 bundle，并重新计算 commit、唯一父提交、无 rename 歧义文件集、binary diff digest 与 tree digest，全部一致才原子绑定 ChangeSet ref。Workspace Authority Host snapshot 带 HMAC 后加密持久化；落地先写 `landing_pending` 日志，再执行 Git Head CAS，最后发布状态 CAS，崩溃后可按 base/result Head 自动补全，无关 Head 会拒绝恢复。当前尚未注册生产项目服务或模型工具；
6. **已实现质量/缺陷核心和可持久 Runner 编排，执行器与连接器待接入**：TestPlan 按 suite、最低 Runner 信任级别和最小测试数验收 Ed25519 TestAttestation；GateDecision 只接受同一 merge group、commit、ArtifactSet 与 manifest 的未过期证据，并签发可被 Workspace Authority 精确验证的 Receipt。调度器只下发管理员预注册的 template/environment digest，不接收命令或参数；merge、nightly、release profile 精确选择 suite，release 优先级最高，Runner capability/trust 决定可领取任务。租约、心跳、超时、有限重试、取消和项目暂停均带 fencing，暂停期间不唤醒 Runner，只有显式 resume 才会重新排队。Quality 私钥、Runner、计划、证据、Receipt、活动租约和队列以 HMAC Host snapshot 经 AES-256-GCM 与 revision CAS 原子持久化；失败保存不会提前消费租约或发布证据，重启会协调过期租约。Signal→Occurrence→Defect→Fix→Verification→ReleaseObservation 按指纹去重，Verification 必须引用同一修复制品的已准入证据，干净发布观察才能关闭、精确复现会重新打开。GitHub/GitLab/Jira adapter 只在单次请求时取得凭据，公开投影只含不透明 external issue ref；外部 Issue 状态和验签 webhook 只能形成候选观察，不能直接改变内部 Defect。加密 Outbox 先持久 pending、再调用平台、最后提交完成 revision；远端创建/评论成功而最终保存中断时，稳定 marker 搜索使重试不重复。项目 Stop 会先持久 pause epoch，暂停期间只积压、不投递；必须显式 resume 才恢复出站。Defect Host snapshot 同样使用 HMAC、AES-256-GCM 和 revision CAS，保存失败不发布内存状态。当前尚未接入真实 Runner 进程/容器适配器和各平台管理员凭据配置；
7. **待实现**：SSO/SCIM、KMS、DLP、数据驻留、legal hold、SIEM 和可信构建。
