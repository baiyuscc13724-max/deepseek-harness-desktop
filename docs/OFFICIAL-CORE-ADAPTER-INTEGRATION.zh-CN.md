# 官方兼容核心端口：生产接入事实与行为契约

> 实施基线：Harness Desktop `1.0.54` 维护树。  
> 官方源码证据：`deepseek-ai/deepseek-harness` tag `dsh-v0.1.2-alpha.2`，commit `0a53fb55bea101816fa226bb964ae2bed71c343b`，MIT。  
> 重要限定：这些值只固定源码、许可证和 capability 审计证据；它们**不表示**本机已安装或运行语义等价的 alpha.2 runtime。

## 1. 当前生产结论

生产 Host 现在通过 `official-core-ports.js` 装配项目域，不再只存在一组未使用的接口：

1. `OfficialProjectIdentityPort` 等价入口由 `projectIdentity.open()` 承接；它调用 canonical-project registry，返回全字段不可枚举的 Host capability context。
2. `OfficialTaskPort` 等价入口由 `task.bind()` 创建现有 `ProjectTaskCommandService`。
3. `OfficialCollaborationPort` 等价入口由 `collaboration.bind()` 创建现有 `ProjectCollaborationService`。
4. `OfficialProjectionPort` 等价入口由 `projection.createWebRuntime()` 创建现有 `ProjectTaskWebRuntime`。
5. `OfficialRecoveryHostPort` 等价入口由 `recovery.continueRoot/recoverMember/reconcileMember` 承接 confirm-first 根恢复与成员恢复。

`index.js` 的模型工具、真实顶层会话启动前的 project board/seat 预留、根失败 observer、HTTP 恢复动作和 Web projection 都消费这一集合。端口之下仍是已验证的自研权威实现；没有删除 Store、Service、Registry 或 StateStore。

## 2. Provider admission

当前阶段只允许一个 provider：

- `kind=custom`
- `role=primary`
- `schemaVersion=12`
- `storageMode=sqlite-wal`
- 必须完整声明 project identity、task、collaboration、projection、recovery 五类能力和全部 adapter method。

门禁 fail closed：

- 无 provider、未声明字段、accessor 字段、缺方法或缺 capability 均拒绝；
- port set 只承认 `createOfficialCorePorts()` 写入 module-private `WeakSet` 的实例；同形 duck-typed 对象不能绕过 provider normalization，raw ProjectEntry 只能重新包成 custom provider；
- 两个 primary 拒绝；
- official provider 即使自报 alpha.2 名称/commit/runtimeEquivalent 也拒绝；固定源码证据不能变成本机 runtime 证明；
- `writeMode=dual-write` 拒绝；当前没有 secondary writer、尽力双写或 last-writer-wins；
- provider metadata 只投影非敏感声明，不暴露 adapter 内部对象。

相应稳定错误码以 `OFFICIAL_CORE_*` 为前缀，包括 `PRIMARY_REQUIRED`、`MULTIPLE_PRIMARY`、`PROVIDER_INCOMPLETE`、`OFFICIAL_RUNTIME_UNVERIFIED`、`BARE_DUAL_WRITE_FORBIDDEN`。

## 3. Host capability 与公开边界

`execution` 继续是不可序列化 Host capability：

- port 将 project context 包装成 null-prototype、冻结、全字段不可枚举对象；
- `execution` 自身也必须是冻结、零 own key、null-prototype 对象；`JSON.stringify(context)` 与 `JSON.stringify(context.execution)` 都只能得到 `{}`；
- context 六个敏感字段必须全部为 own data descriptor，继承字段与 getter/setter 一律拒绝且绝不执行；验证失败只从 own data `dispose` 做 best-effort exactly-once 清理；`ProjectTaskStore` 构造本身也在同一 `try/finally` 内，因此非法 filePath/constructor failure 仍 exactly-once dispose 且不留下数据库副作用；
- actor/project/authority 仍由 Host resolver 和 canonical lane 派生；
- 端口级 `assertPublicInput` 作为 provider contract probe，拒绝 raw execution/actor/project/canonicalProjectKey/projectKey/session/cwd/rootPath/workspace 字段，并要求 plain、lossless JSON：object property 与 array index 必须 enumerable own data descriptor，且无 accessor/symbol/cycle/sparse array；它不被描述成公开入口的唯一防线。

真实生产工具继续由每个 action 的窄 `projectToolPayload` allowlist、领域 normalizer 与 Host-derived context 防护；Web 继续由 `normalizeWebCommand` 的 forbidden-key/深度/64 KiB 门禁防护。行为测试直接调用已注册 `project_collaboration`：raw `canonicalProjectKey` 被拒绝，同时 `add_evidence.path` 的合法 project-relative 路径仍可通过。这不改变现有公开工具、HTTP 或 UI DTO；内部 `projectRef/databasePath/keyProvider` 绝不进入安全投影。

## 4. 写入、receipt 与 unknown outcome

普通 Task 写仍由 schema v12 Store 的同一事务语义负责：稳定 command/request id、expected revision、event/command receipt、idempotency drift、`BEGIN IMMEDIATE` 与 WAL 均保留。`claim_next` 仍在单一权威 Store 内原子执行。

恢复端口独立于普通 task port：

- 根恢复和成员恢复控制对象先按严格 allowlist 归一化：所有字段必须是 enumerable own data descriptor，继承/own getter 都不执行；adapter 只收到复制并冻结的 normalized input；随后才检查 `confirm:true` 与 expected revision；`continue_root_recovery` 先读取当前 recovery revision，再把同一个值同时交给 port 和 `continueProjectRootRecovery` 做 exact OCC；
- `autoRetryUnknown` 在 continue/recover/reconcile 全部路径永久拒绝；
- `outcome_unknown` 只能走独立 reconcile/observer-first 路径，而且 reconcile 必须带显式 resolution，绝不是自动重试；
- revision 在读取与 effect 之间变化时，必须在任何 launch effect 前返回 `PROJECT_ROOT_RECOVERY_CONFLICT`；
- UI 的二次点击仅是 confirm 手势，Host 仍验证 exact root/member、project/team/revision、failure evidence、receipt 与权限。

因此 Task primary 切换不能隐式迁移 recovery primary，反之亦然。

## 5. 保留不变的持久与传输契约

此次适配没有改变：

- Project Task schema v12、SQLite WAL、`synchronous=FULL`、future schema 拒绝降级；
- canonical-project lane、独立 projectRef/key/file 和 legacy `copying → complete` backup 恢复；
- AES-256-GCM 字段信封和 AAD；
- Web AES-GCM 游标、跨项目/陈旧/篡改拒绝；
- 任务页最多 120 项、协作 section 页最多 24 项、单页 128 KiB；这些是页预算，不是总量上限；
- SSE 仅作 invalidation/reset，可靠恢复继续 refetch state/page；
- trusted origin/header、64 KiB Web command、safe DTO/error mapping；
- root/member confirm-first → parent/Host callback → recovery adapter 的分层；
- Store/Service/Registry/StateStore 的所有既有消费者。

## 6. 测试证据

`tests/official-core-ports.test.cjs` 覆盖：

- 精确 alpha.2 tag/commit/license 仅作为源码证据；
- custom 唯一 primary；
- undeclared/incomplete/accessor-backed/fake official/multiple-primary provider doubles；
- outer context 与 execution 两层不可序列化、恶意 own/inherited getter 不执行、失败清理 exactly once；
- module-private brand 拒绝 fake duck ports，五类 production port 均调用 primary adapter；
- raw actor/project/session/canonicalProjectKey/cwd/rootPath/execution 注入，以及 plain lossless JSON 原型/enumerable/accessor/cycle/sparse-array 门禁；
- 已注册真实工具拒绝 raw Host identity，同时接受合法 project-relative evidence path；Store constructor failure 无数据库副作用且 context exactly-once dispose；
- Task 与 recovery 分层；
- recovery inherited/own getter 与 non-enumerable 控制字段在 getter=0/operation=0 下拒绝；confirm-first、所有路径 `autoRetryUnknown` 永久拒绝、显式 observer-first reconcile、根恢复 stale revision 在 launch 前失败；
- 裸双写声明拒绝。

原有 `official-core-compatibility-contract.test.cjs`、Project Task Domain/Store/Service/Web/API、Agent Teams tools/recovery 相关测试继续作为不可降级矩阵。

## 7. 后续 official provider 条件

未来若要加入 official provider，必须另行提供并验证本机 runtime identity、包锁定、Remote descriptor、event/projection、schema/transaction、receipt、recovery 和 projection 预算的逐项 capability evidence。只有同名 package/type、tag 文本或 provider 自报字段不构成证据。在此之前 custom 必须保持唯一 primary，official 不得写、不得驱动 UI、不得触发恢复或自动 retry。
