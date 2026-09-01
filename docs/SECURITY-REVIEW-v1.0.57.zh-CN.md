# Harness Desktop v1.0.57 安全审查

审查日期：2026-09-01

审查范围：官方 Harness `0.1.2-alpha.3` 本地 Web 启动认证、桌面主进程认证会话、Computer Use 与 Browser Tools API 迁移、Agent Teams 顶层会话 Host、跨项目 Stop/wake/root recovery、团队生命周期与 Attention、手机同步入口去重，以及 v1.0.57 的版本和发布边界。

## 审查结论与证据状态

v1.0.57 候选源码保持 fail closed：不关闭官方启动认证，不把不确定投递当作成功，也不因恢复页面存在按钮而扩大 project/root/team authority。Host 会话启动与 root recovery 使用精确持久证据自动收敛；证据不足时只观察和退避，不盲目重复会话提示、项目 wake、任务执行或其他副作用。每个可变恢复动作继续绑定 exact project、actor/root、operation/task、revision 和持久证据。

本审查已核对源码边界与对应定向行为合同；`scripts/verify-static.mjs` 也显式纳入新的 `runtime-web-url`、`runtime-session-auth` 模块及其测试。但是当前工作树仍在发布候选收口阶段，不能据此宣称最终全仓验证、云构建、签名、镜像或 stable feed 已完成。最终动态证据只能由干净、已提交的精确 revision 和唯一 resumable publisher 产生。

## 1. 本地运行时认证边界

- URL 解析拒绝 HTTPS、非 loopback 主机、无效端口、非根路径、userinfo、fragment、多余 query 和不符合 base64url 约束的 token。
- stdout 与 stderr 分别使用有界滚动缓冲识别跨分块 URL，避免无界累积；状态详情、自检 diagnostics 与可选日志不得出现 token 原文。
- Packaged self-test 采用 `redirect: manual` 验证完整认证链：token 请求必须返回 303，其响应必须提供适用于精确 loopback authority 的认证 Cookie；随后携带该 Cookie 请求 clean `/`，且只有 2xx 才算启动成功。缺少 Cookie、错误 authority、重定向、401/404/5xx 或未认证根地址均 fail closed。
- 官方 WebView 继续使用 `persist:harness` 隔离分区。启动 token 只用于该分区的本机 cookie 交换；主进程 RPC、事件 WebSocket、右侧工作区和 Mobile 代理随后使用隔离 cookie，不把 bearer 改写为长期 header、写盘或发送到非 loopback 目标。
- Mobile 传入的伪造认证 cookie 会被过滤，上游认证 `Set-Cookie` 不回传给 Mobile；WebSocket、桌宠和移动同步只在受控目标上注入官方 session cookie。
- MobileSync WebSocket 对 401 拒绝与 101 成功握手采用相同的响应边界：剥离 `dsh-auth-*` `Set-Cookie`，保留普通 Cookie。401 握手不重放，避免重复连接副作用；认证刷新保持单飞，并且只供后续新连接使用。

## 2. 插件兼容与注入边界

- Computer Use 通过公开 settings context 注册配置段；授权、窗口身份、权限策略与确认状态仍由可信 Electron Host 独占，插件不能自授予权限。
- Browser Tools 只通过 alpha.3 的 `remote.skills` 读取技能目录，并验证 RpcResult；不再触达退休的 `connection.api` 私有面。
- 随包 Web client manifest 不得注入 `dsh-client-runtime` 或 `dsh-client-ui-slots`，client bundle 不得重新调用 `ctx.get('connection').api`。回归合同遍历全部随包插件并 fail closed。
- 本次迁移不扩大文件、Shell、浏览器、Computer Use、移动控制或外部服务权限。

## 3. Agent Teams Host 启动与 unknown-outcome

- 顶层会话 operation 在执行前持久化。Host 崩溃发生在 `queued` 已落盘、尚未入内存队列的窗口时，冷启动不会凭脱敏状态文件猜测 workspace；只有 exact canonical project/workspace/caller 重新绑定成功，才把同一 operation 重新入队。
- 恢复复用原 operationRef、sessionId、workspace/session phase 和 prompt requestId。会话列表探测与 phase fence 防止重复 `session/create`；进入 `prompt_dispatched` 后若发送结果未知，Host 不重新 prompt，而是自动核对 `session/control` 队列 baseline 与 `session/follow` 会话 snapshot 中的 exact requestId。
- 任一路精确证据发现该 requestId 时 operation 自动收敛为 `ready`；control baseline 与 follow snapshot 均完整且都确认不存在时收敛为 `failed` / `HOST_SESSION_PROMPT_NOT_DELIVERED`，允许上层沿原 launch reference 进入有界恢复；任一路不可用、截断或无法完成时继续保持 `outcome_unknown`。同一 operation 的排队、启动、观察与 reconcile 合并/串行，revision/CAS fence 保证并发观察不会提交相反结果。
- 关闭 Host 时先拒绝新请求，再等待已经受理的启动、reconcile chain 和持久写入完成，避免 close 返回后旧实例继续覆盖新状态。

## 4. Stop、项目 wake 与 root recovery

- 直接用户 Stop 不再依赖 root 是否拥有私有 Agent Team：它始终先取消该 exact root 的顶层 project launch 和 admission，再处理可选的团队 pause/drain；另一 root 或另一 canonical project 不受影响。
- 项目 wake 的 `outcome_unknown` 只接受 exact `wakeRef` 的两类证据：在 session/inbox 中找到同一协调者消息，或确认检查了完整 session history 与两个 live inbox 队列且消息不存在。截断 history 不是否定证据，未知状态继续 fenced，不自动重投。
- Host 重启先逐 root reconcile 同一 project 的 durable waiter，再由每个 project 的一个代表执行一次 dispatch。普通用户消息只可解除已经存在的 paused waiter；从未调用 `claim_next` 的 root 不会因此获得 waiter 或被 steer。
- Root recovery Web 投影不暴露可执行的原 recoveryRef/actorRef，而是由 runtime 使用 project AAD 封装 actor/action/revision 绑定的 AEAD capability。POST 必须来自 exact top-level root、带直接确认，并再次核对 capability action、expected revision 与 durable recovery state。
- retry 把 Host failureRef 持久化为 exact launchRef，参数漂移被 CAS/idempotency fence 拒绝。后台调度器会在冷启动发现及后续用户活动后续跑同一 durable recovery：只有 exact Host 证据证明未投递或确定可安全重试时才执行有界自动重试；证据不足的 `outcome_unknown` 只做观察并退避，不再次触发 effect。takeover 仍要求 coordinator、已审计 takeover request、目标任务已经迁移给 beneficiary，以及新的 slot/adoption capability；页面不能凭不透明展示 ref 绕过这些检查。

## 5. 生命周期、重启与 durable task 状态

- Graceful retirement、force drain、follow-up 与恢复启动使用统一有界 deadline。外层 AbortSignal 在操作启动前可阻止调用；运行中则传给支持它的 follow-up/admission。当前底层 SDK drain 不接收 AbortSignal，因此 deadline 只释放调用方/串行队列，绝不把尚未确认的 drain 记作成功。
- lifecycle timeout/abort 会把相关 worker 持久化为 `failed`，并保留 `shutdownUnconfirmed` / `stopUnconfirmed`。原 task claimId、leaseEpoch 和 owner fence 不会为“方便重试”而清除；后续必须显式 retry、replace 或再次执行安全关闭。
- Host 重启发现旧 worker 仍持有 `in_progress` 时，把 worker 标记 failed，并为任务追加 restart interruption evidence；任务仍保留原 claim/lease，既不显示为健康执行，也不自动启动第二个 attempt。
- 缺少 Host drain/进程边界证明时，持久化的 `closing` 团队不会仅因任务看似终态而自动 `closed`，也不会伪造 `forced:false` 或清除 unconfirmed。它保持 `closing`、`closure_incomplete` / `unconfirmed_shutdown`；显式 force shutdown 仅在真实 drain 成功后 retire/terminalize/close。

## 6. Attention 与 UI 数据边界

- `submitted` 是独立的非终态：进入 submittedTasks、acceptanceRequiredTasks、task/team Attention 和 `acceptance_required` code，直到 exact root 对当前 claim/lease 的 submission 做独立验收。
- 当前 message outbox 没有能够证明“后一条消息是前一条 exact payload 重试”的持久 lineage/message identity。因此任何后来成功的消息（即使收件人相同）都不得清除旧 `failed_delivery`；失败审计和告警保守保留。
- Host 会话启动/root recovery 的自动收敛不能外推到全系统：任意外部副作用若没有 exact identity、完整持久观察或参与式幂等协议，仍须经过原安全门，未知结果不能自动重试或被推断为成功。
- 删除外壳重复的“手机同步”按钮，仅保留官方工作台侧栏中的单一入口；入口仍调用同一受控对话框，不新增同步通道。手机配对、远程中继、设备权限与撤销语义不变。
- v1.0.57 未包含 Agent Teams UI 重设计；现有卡片界面、功能与权限不变，仅补充恢复动作所需的数据接线。

## 7. v1.0.57 发布约束与待验证项

- 根包、lockfile、15 个自有插件、Android `1.0.57/1005700`、iOS/iPadOS `1.0.57/10057`、桌面移动路由、更新示例、README、CHANGELOG 与 release notes 必须一致。
- 已发布 v1.0.56 的 Tag、18 项资产、签名 APK、组件、镜像与 stable feed 不移动、不覆盖、不复用。
- 发布前仍须在干净且已提交的精确 revision 上完成全仓 `npm run verify`、`npm run verify:release`、`git diff --check`，并重新确认 Runtime auth、Agent Teams Host/Project/lifecycle/Attention 的最终测试矩阵。
- packaged self-test、Android/iPhone/iPad 门禁、云端 Windows/macOS/Linux 构建、签名、18 项资产、GitHub→CNB 镜像和 stable feed 均属于尚待 publisher 产生的动态证据。
- 正式发布只允许：

```text
npm run release:publish -- plan --version 1.0.57
npm run release:publish -- run --version 1.0.57
npm run release:publish -- status --version 1.0.57
```

发布器必须从精确 source revision 调度云构建，并在 Tag、签名 Android、生产组件、18 项 GitHub/CNB 镜像与三个 stable feed 全部验证后才报告完成。任一阶段失败不得通过手工上传、移动 Tag、重用旧资产或跳过摘要/签名检查补救。
