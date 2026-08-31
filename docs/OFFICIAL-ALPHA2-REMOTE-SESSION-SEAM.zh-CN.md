# 官方 alpha.2 Remote / Session 公共 seam 安全审计

> 固定上游：`deepseek-ai/deepseek-harness` tag `dsh-v0.1.2-alpha.2`，commit `0a53fb55bea101816fa226bb964ae2bed71c343b`。  
> 审计制品：隔离安装 `D:\DeepSeek-Harness-Desktop\.alpha2-audit\isolated-project` 中六个精确 `0.1.2-alpha.2` npm 包。  
> 范围：只读 package exports、公开 `.d.ts` 与发布 bundle；对照 Desktop 当前 `0.1.1-rc.2` 的 `dsh-client-runtime` / `dsh-host-apiproxy` 测试和补丁意图。  
> 结论性质：公共合同审计，不授权依赖升级、补丁迁移、GUI 集成、打包或发布。

## 1. 判定

alpha.2 提供了可替代旧私有 bundle 读取的公开骨架，但**不提供 Desktop canonical project → Workspace/Session 的归属证明**，也不对“已突破受信 Host carrier 后、结构合法但语义伪造的 event/baseline”提供独立签名或业务真实性证明。因此迁移只能按下列边界进行：

1. New Session 使用公开 `ctx.sessions.clear()` → `ctx.sessions.create({ workspaceId | cwd })` → `ctx.sessions.open(sessionId)`；底层公开 Remote 是 `ctx.remote.session.create(request)`。
2. live session-list 以 `session/list` 成功响应为权威 baseline，以 `api-session/{added,removed,status,activity,error}` 为同 generation 增量；这些普通通知**不 replay**，连接重建后必须重新 `session/list`。
3. queue/jobs/projections 使用 `session/control`；每一物理 generation 必须先收到且只收到一个 `baseline`，随后才接受 replacement delta。重连用新 baseline 原子替换，不把瞬态控制帧当耐久事件。
4. Session history 使用 `session/follow` 的 opening snapshot/cursor 与 `session/page` 修复；stale、部分重叠、倒序、断页、gap 修复失败均终止，只有 `RemoteStreamCarrierError` 属于自动恢复类。
5. 任何从旧补丁意图到上述公开 seam 不能由 exports/types/bundle 证明的语义，标为 **`unproven=blocked`**，禁止猜私有符号、文件名或隐式 Workspace 规则。

## 2. 公开包边界

| 包 | 可依赖的公开入口 | 本审计使用的合同 |
|---|---|---|
| `dsh-api-remotes` | `.`, `./client`, `./types`, `./invariant` | 应用选择的 Remote contribution；Host 转发事件 allowlist；普通事件不 replay |
| `dsh-api-session-controller` | `.`, `./client`, `./types`, `./remote-events`, `./remote`, `./typert` | `session/*` namespace、Session list/control/follow/page、`ctx.sessions` 客户端服务 |
| `dsh-api-gateway` | `.`, `./client`, `./types`, `./invariant` | generated descriptor 安装、严格 codec、RemoteResult、RemoteStream/Journal/Snapshot 生命周期 |
| `dsh-client-connection` | `.`, `./client`, `./invariant` | 受认证 transport、generation、连接状态、手动 reconnect、`connection/reset` |
| `dsh-session-projection` | `.`, `./types`, `./invariant` | whole current JSON value、`asOfSeq`、Host fold/provider registry |
| `dsh-session-query` | `.`, `./invariant` | Host 内部 live-preferred/cold-safe 查询与一致观察；**不是**浏览器 Remote namespace |

禁止把 `./src/*` 当稳定迁移 seam；虽然 package export 暴露它，发布 `files` 清单并不包含源码，隔离制品也没有源码。

## 3. Remote namespace / method / failure

### 3.1 精确 Session namespace

生成的 `dsh-api-session-controller/remote` 声明下列直接方法：

- `session/attachment`
- `session/cancel`
- `session/canOpenWorkspacePath`
- `session/control`（stream）
- `session/create`
- `session/follow`（stream）
- `session/fork`
- `session/list`
- `session/modelCatalog`
- `session/openWorkspacePath`
- `session/page`
- `session/prompt`
- `session/rename`
- `session/search`
- `session/selectModel`
- `session/updateQueue`

另有 `skills/list` 与 Agent-scoped `fileReferences/list`。业务代码应通过 `ctx.remote.session.<method>` 或更窄的 `ctx.sessions` / Session face；不得拼接旧 `session.*` ApiProxy 字符串，也不得直接调用 Gateway 私有安装表。

### 3.2 descriptor 安装与调用

Gateway Client 不使用 JavaScript Proxy。`TypertRemoteContribution.descriptors` 按 namespace 分组并安装成 `remote.<namespace>` Cordis Service。发布 bundle 明确拒绝：

- 同 contribution 重复 direct/scoped method；
- 与已挂载 method、Gateway 保留字段或既有 Cordis Service 冲突；
- parameter / Context invocation codec 不是 `strict`；
- scoped descriptor 未精确选择唯一 lookup 参数；
- 参数数不符，或 strict schema parse 失败；
- contribution 中途安装失败时未完全回滚（bundle 实际倒序撤回已装项）。

Unary 调用返回 `RemoteResult<T>`；Host/business failure 保留 code/details，carrier/cancel/withdraw 被折叠为 Remote failure。Gateway 基础 failure 的公共闭集为 `gateway/{ambiguous-endpoint,arguments-invalid,binding-invalid,context-failed,context-not-found,context-unavailable,definition-unavailable,input-invalid,invocation-unavailable,lookup-failed,lookup-not-found,lookup-unavailable,method-unavailable,provider-mismatch,result-invalid,service-unavailable,signature-invalid}`，details 至少携带 canonical `namespace/method` endpoint。

**伪造 descriptor 负向：**离线合同必须固定上述重复、冲突、非 strict、scope mismatch 拒绝路径。不得从 bundle 内局部变量名推导新的 adapter API。

## 4. New Session seam

### 4.1 可证明调用

公开 `ISessions` 明确暴露：

```ts
ctx.sessions.clear()
const sessionId = await ctx.sessions.create({ workspaceId }) // 或受信 cwd
ctx.sessions.open(sessionId)
```

`create()` resolution 保证：返回时新 Session 已在 list store 中，`binding(sessionId)` 可同步解析，随后 `open()` 可立即寻址。底层 `SessionCreateRequest` 允许 `workspaceId?`, `cwd?`, `sessionId?`, `agentPreset?`；Client `ctx.sessions.create` 的公共面只暴露前三项。Host 成功返回 `{ sessionId, agentPreset? }`。失败通过 `SessionCreateError.rpcError` 暴露；`session/workspace-attach-failed` details 会携带 `sessionId` 与 `workspaceId`，Client bundle 会把已创建但 attach 失败的 identity 协调进列表，但 promise 仍失败。

这可承载旧 Desktop “所有 New Session 入口强制新建，不调用 connect/reuse”意图：gesture adapter 应先清 selection，再显式 create，成功后 open。不得复用旧 `connectWorkspace()` 私有方法，也不得读取 alpha.2 私有 bundle 符号。

### 4.2 `unproven=blocked`

- **canonical project ownership：blocked。**六包只证明 `workspaceId`/`cwd` 是请求字段；未证明 Desktop project key、规范化路径、Workspace ACL 或“当前会话属于哪个 canonical project”的解析算法。`SessionSummary.cwd` 是显示/列表字段，不是所有权凭证。
- **blank Session reuse 等价：blocked。**alpha.2 Client 注释仍称 Workspace New Session 可复用同 workspace 的 blank row，但六包公开 `ISessions` 没有“按 workspace 找 blank 并安全复用”的方法；旧 Desktop 补丁的目标恰是强制新建。迁移不得恢复隐式复用。
- **从 session list 的 `cwd` 反推 `workspaceId`：blocked。**路径相等、大小写、symlink/junction、远程卷和 Workspace 注册状态都未由本范围证明。

因此 adapter 必须接收另一条已审计 Workspace Controller/项目注册表提供的受信 `workspaceId`（或明确、规范化且已授权的 cwd）。缺少该输入时 New Session fail closed，不退回 recent workspace、当前 Session cwd 或 UI label 猜测。

## 5. live session-list metadata

### 5.1 权威 baseline

`session/list({}) -> RemoteResult<{items: SessionSummary[]}>` 是 list authority。每行公开字段：

`sessionId, updatedAt, running, blank, parentSessionId?, origin?, cwd?, projections?`。

`projections` 是 `SessionProjectionHints`：`{ asOfSeq, values }`，定义明确称其为 partial / possibly stale hints；缺 key 表示未知，不得解释为 false 或 capability absence。`sessionListMetadata` 仅含 `blank` 与 `lastPromptAt`，Host `ApiSessionList` 对 live Session 用 current projection，对 cold Session 使用有界 probe/缓存安全降级。

Client list phase 为单调 `pending -> ready`；第一次成功前 `items=[]` 不表示真实空列表。后续 refresh 失败只改变 `state/error`，不得把 phase 退回 pending。refresh 期间到达的 live mutation 被记录并在 baseline 上重放；已建立顺序通过 `mergeOrderedBaseline` 保留，baseline 缺失 identity 会被移除。

### 5.2 普通事件与 recovery

allowlist 中的 list 事件为：

- `api-session/added(summary)`
- `api-session/removed(sessionId)`
- `api-session/status(sessionId, running)`
- `api-session/activity(sessionId, updatedAt)`
- `api-session/error(sessionId, message)`

它们均为普通 `emit`，不 replay。Connection `$events` generation 的 ready 只证明增量 listener 已挂载；建立 generation 后 `connection/reset` 触发 `sessions.handleConnected()`，重新 `session/list` 并重启已打开窗口。恢复顺序是“先挂增量观察，再 pull baseline，再重放 pull 期间 mutation”，不得颠倒。

**伪造 event 负向：**Gateway 对 frame 做 exact-key、plain-record、JSON、安全保留字段检查；waterfall request 禁止自带 `agent`/`signal`。但是 Client runtime 对结构合法 `emit.event` 只检查非空字符串，运行时没有再次对 `API_REMOTE_FORWARDED_EVENTS` 做 allowlist membership 检查。其安全前提是已认证、受信 Host Gateway 是唯一 frame 产生者。故：

- malformed/extra-key/non-JSON/保留字段注入：可证明拒绝；
- 非 allowlist 但结构合法的事件来自恶意 carrier：**`unproven=blocked`**；不得宣称 Client 二次 allowlist 防护；
- Desktop 若引入非官方 carrier/tunnel，必须在信任边界验证 allowlist，不能只依赖 TypeScript key face。

## 6. control baseline 与 projection

`session/control()` 每 generation 精确协议：

```text
baseline { queues, jobs, projections }
  -> queue(sessionId, complete items)
  -> jobs(sessionId, complete jobs)
  -> projection(sessionId, key, whole value, seq)
```

这里所有 delta 都是 replacement/whole value，不是 durable replay log。`RemoteSnapshotStream` 规则：update-before-baseline 拒绝；同 generation 第二个 baseline 拒绝；只有 domain `replace()` 成功后才 `accept()` opening；重连时保留旧 snapshot 直到新 baseline 验证并应用成功，然后替换。

Session projection 的 baseline 是 `{asOfSeq, values}` 的精确 cut。history follow opening 也携带 projection baseline；live `projection` frame 用 `seq`，Client store 采取 watermark / higher-seq-wins，并在 control baseline 时 `truncate(asOfSeq)` 后 `seed(block)`。普通 list hint 与精确 follow/control baseline 不得混用。

**错误 baseline 负向：**

- opening 不是 baseline、同 generation 重复 baseline、delta 先于 baseline：可证明终止；
- schema 不合法：generated strict stream result codec 应拒绝；
- schema 合法但 Host 恶意伪造的 queues/jobs/projection 内容或 watermark：**`unproven=blocked`**，协议没有独立签名/耐久日志交叉证明；
- control baseline 是 process-local，官方 README 明确不能在 Host restart 后重建 jobs。

## 7. history stale / gap / reconnect

`SessionEventStream` 是 `RemoteJournalStream` 的公开 domain adapter：

- opening 必须是 `snapshot`，携带 header、cursor、contiguous records、hasMore、projections；live 只能是单个 `event`，packed chunk 仅允许历史页；
-普通 event cursor 范围 `[seq,seq]`，packed chunk 覆盖 `[seq, seq+memberCount-1]`，相邻关系固定为 `right === left + 1`；
- reconnect opening cursor 小于已应用尾 cursor：拒绝 stale resume；
- 完全旧/重复 entry（尾 cursor不大于当前）忽略；部分重叠拒绝；
- gap 触发 `session/page` 尾页修复，修复页必须连续且尾部精确达到请求 cursor；无法合并或再次缺口则终止；
- page prepend 与当前首 entry 不连续时发布空/`hasMore:false` 后抛协议错误，防止继续错误分页；
- 只有 `RemoteStreamCarrierError` 触发自动 generation 替换；business、persistence、descriptor/schema 或 unresolved continuity failure 都是 terminal。

这取代旧 mux `since`（rc.2 明确未实现）的模糊恢复意图。迁移不得自行重放普通事件，也不得在 gap 时“跳过到最新”。

## 8. 恶意/错误向量决策表

| 向量 | alpha.2 公共证据 | 决策 |
|---|---|---|
| descriptor 重复、非 strict codec、scope mismatch、namespace/method 冲突 | Gateway Client bundle fail closed | proven / reject |
| unary 参数或 result 不合 schema | generated descriptor + strict codec / Remote failure | proven / reject |
| malformed event、extra key、非 JSON、waterfall 注入 `agent`/`signal` | Gateway event parser | proven / reject |
| 结构合法但非 allowlist event（恶意 carrier） | Client 仅检查非空 event name | `unproven=blocked` |
| event generation 未以 exact ready 开始 | Gateway event parser | proven / reject/reconnect |
| control delta 先于 baseline、重复 baseline | RemoteSnapshotStream | proven / terminal |
| schema 合法但内容伪造的 baseline | 无独立真实性证明 | `unproven=blocked` |
| history stale reconnect cursor | RemoteJournalStream | proven / terminal |
| duplicate old event | cursor <= current tail | proven / ignore |
| partial overlap / inverted range / discontinuous page | journal assertions | proven / terminal |
| forward gap | `session/page` repair, exact through cursor | proven / repair-or-terminal |
| ordinary list event reconnect replay | 官方明确不 replay | forbidden；重新 list |
| Host restart 后 jobs recovery | control baseline process-local | `unproven=blocked` |
| SessionSummary.cwd 证明 canonical project | 无所有权合同 | `unproven=blocked` |

## 9. 旧 rc.2 补丁意图映射

| 旧意图 | alpha.2 公开 seam | 状态 |
|---|---|---|
| New Session 强制新建 | `ctx.sessions.clear/create/open`; `session/create` | proven，但 project 输入来源 blocked |
| 新建后立即可 open/binding | `ClientSessions.create` resolution guarantee | proven |
| list metadata 避免全日志重复 fold | Host `sessionListMetadata` projection + live `summaryFor` + cold hints | proven；不应继续补旧 Host bundle |
| projection frame 不全局污染/重连基线 | control baseline + keyed whole-value projection + watermark | public replacement exists；Desktop 性能等价需另测 |
| list 重连不丢 live mutation | listener-ready generation + refresh + mutation replay | proven |
| mux `since` 恢复 | `RemoteJournalStream` snapshot/cursor/page repair | 旧 `since` 不迁移 |
| forwarded Host event | `ctx.remote.$on`, application allowlist | proven only under trusted carrier |
| old `RpcError` handling | `RemoteResult` / `RemoteFailure`, `isRemoteFailure` | public replacement exists；逐调用点需迁移 |

## 10. 集成前置门

以下任一未满足，Remote/Session 迁移不得宣称完成：

1. Workspace Controller/项目注册表给出 canonical project → authorized `workspaceId` 的独立审计证据；
2. Desktop New Session adapter 只使用 `ctx.sessions` 公共面，并有“无归属不创建”的负向测试；
3. 非官方 carrier/tunnel 证明与 Web 同等认证/Host/Origin fence，且对 forwarded event 执行 allowlist；
4. generated descriptors 来自固定 alpha.2 contribution，禁止动态接受未固定 descriptor；
5. list、control、follow 三类恢复测试分别覆盖普通事件不 replay、baseline replacement、gap repair；
6. `RemoteFailure` business/transport/protocol 分类不触发未知结果的自动重试；
7. 不读取 `./src/*`、bundle 私有类名或消失包路径；
8. 对旧 patch 的退役逐项留下 receipt；本报告本身不修改 postinstall。

对应离线门：`tests/official-alpha2-remote-session-seam.test.cjs`。它固定精确版本/exports/公开声明和发布 bundle 的 fail-closed 路径，并执行恶意向量 policy oracle；它不冒充 GUI、真实 WebSocket、Host ACL 或 canonical project 集成证明。
