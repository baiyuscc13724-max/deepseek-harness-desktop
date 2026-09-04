# Changelog

## 1.0.59

### 官方 Harness alpha.5 与会话可靠性

- 官方 Harness Runtime 及完整 required/optional DSH 依赖图由官方 npm 注册表精确固定为 `0.1.2-alpha.5`；根依赖、lockfile、Desktop 自有插件 peer 图、精确哈希/语义锚点与幂等补丁门禁同步更新。官方 Schedule 与 Desktop `dsh-desktop-schedules` 同时注册、互不冒充或覆盖，既有 session append-only events 不改写；历史 alpha.2–alpha.4 分支继续只作审计基线。
- 官方 subagent lifecycle 补充受限、脱敏的终态类别与精确 activation/run identity；`PI_AI_ERROR` / `Not Found` 只映射为当前 generation/run 的脱敏诊断类别、阶段与可操作恢复提示，原始 provider 文本、stack、路径、prompt、output、session/token 不进入公开诊断。Agent Teams admission 以 generation/child/run 绑定 reservation、accepted、started、end 与 drain，旧 run 不能释放新 lease。
- recovery retry/replace 在真正进入可能产生外部效果的 dispatch 之前保持确定性的 `not_started`；admission 超时、队列容量、Stop 与晚到生命周期按精确阶段收敛，graceful retirement 可由同一 run 的晚到完成回执安全结束，未知现场仍不自动重放。
- 发送后 Stop、排队、继续与相关官方会话控件会随当前状态及时出现，不再要求切页或等待额外轮询；长会话切换时“跟随最新/保留阅读位置”意图不再丢失，滚到底部会立即提交 follow 状态，reader 锚点仍有界采样并在旧 DOM 卸载前刷新。
- 官方“回到底部”控件恢复可见，提供至少 44×44 命中区、键盘语义与清晰焦点状态，不用无条件滚底破坏主动阅读；整枚“子代理会话：可继续”芯片的任一点都是同一个切换目标，单次指针操作只开合一次，Enter/Space 与至少 44×44 命中语义保持一致。

### Agent Teams 编排、状态与路径边界

- “自动接力”全局默认由版本化 Desktop Host 设置证明持久化；直接用户建队、计划提交与两阶段 Resume 只在 root、canonical project、Goal、team、pause epoch、plan/settings hash 与 authorization epoch 全部匹配时派生或重绑权限，Stop、撤销、跨项目、未知能力或副作用继续 fail closed。
- 修复安全计划重提交被误当作权限丢失而反复停住的问题；普通 Goal round 不会静默重授，缺失或撤销的 grant 只显示明确恢复路径。等待态用语义 fingerprint 在 `store.mutate` 之前判重，重复 reconcile 零写入、零发布、零空转唤醒；没有新 durable transition 或 eligibility 变化的空 automatic round 会直接 park，不消耗 Goal 追加预算。
- 成员遇到至少两个可持续且文件/资源不重叠的工作流时可提交持久扩员提案；提案不产生嵌套团队或隐藏成员，只有 Root 通过后才会持久化任务并创建用户可见的平级成员，Root 仍按容量、冲突、成本与安全门禁决定。受 admission backpressure 的可见成员按持久 FIFO 与精确 generation/task fence 接力，重复提案和旧释放事件不消耗 Goal round。
- 团队、成员、任务、后台计数与诊断卡通过单一权威状态流实时更新；已发送聊天 prose 明确保持“发送时快照”，乱序旧事件、断线重连与 HMR 不覆盖较新 revision。relay `queued` 只表示本机持久排队、接收方尚未确认，不再误报 delivered。
- 工作区、资源与文件边界改为逐码点保真：只规范真实分隔符、`.`、重复/尾斜杠及 Windows 实际大小写比较；NFC/NFD、全角/ASCII 等兼容等价但不同的路径不会被 NFKC 合并。Host adopted-root 恢复同时绑定 exact actor/project/board/slot/operation，错误身份全部拒绝。
- Agent Teams 权威存储新增版本化 hot/cold COW：关闭团队进入 content-hashed immutable shard，迁移只复制并保留 legacy 原件与可回滚 generation；写前校验、OCC、claim/lease/submission/acceptance、wake/routing、handoff/recovery、authorization、quality/evidence 与 external-effect/idempotency 历史均不删减。
- Root 投影/SSE 编码提供不超过 32 MiB 的有界缓存，但默认关闭，并保留可立即回滚的 `disabled | shadow | enabled` 三态：`disabled` 走原权威投影，`shadow` 只比较候选且仍返回权威结果，`enabled` 仅在 store generation、root/project/ACL、选择、revision、owner/pause/auth epoch 全部匹配时命中；fresh ACL 始终先于缓存，任何身份或线性前驱不明立即重算。SSE 在断线、Stop、HMR/重载时清理 listener、abort/backpressure 队列与关联引用；65-root 已测热命中 p95 低于 1 ms，但不作为默认启用承诺。

### 无损性能、同步与存储

- 自动缓存维护改用 cache-only 窄扫描，在递归前剪除 runtime、sessions、attachments、memories 与未请求的 temp/workspace；shadow oracle 候选不逐项等价时仅预览并 fail closed，手动 scan/preview/apply 与回滚开关保留。
- Desktop 活动预览改为内存中的有界 latest frame，Android 面板直接消费每设备一个 2 fps persistent stream；连续预览不再写盘、回读或 base64 往返，只有用户明确截图才进入带源尺寸与坐标空间的 durable evidence store。Stop、撤销、旋转、离线恢复和旧轮询回滚语义保持不变。
- preview、evidence 与 legacy namespace 物理/逻辑分域；安全 GC 只处理没有 attachment/tool-card/history 引用且 token 过期并经过安全裕量的 preview，先 quarantine、延迟删除并支持晚到引用恢复。既有 Android 混存内容仍按 conditional-authoritative 只读保留，不盲目清理。
- Mobile Sync v6 以单一 canonical snapshot、严格不超过 512 KiB 的 bounded delta journal 和小型 heartbeat/preferred-port 原子记录替代每个事件携带全量快照；保留 v5 只读备份、精确 reverse exporter、cursor/tombstone/offline replace、operation/idempotency 与 crash recovery，shadow 阶段不双发同步。
- Schedule 继续以 session append-only events 为唯一权威源，内存 fold 仅维护 seq/generation/checksum；15 秒刷新支持 ETag、`If-None-Match`、since delta 与无 body 的 304，任何 gap/rewind/generation 分叉立即 fail closed 为一次权威 full replay，304 不重复 JSON 解析或渲染。

### 手机工作台

- 修复在已打开的会话详情中点击底部“代理团队”会被旧导航保护逻辑吞掉的问题；只要底部标签可见且可用，现在就会进入官方 Agent Teams 画布，不再静默停留在对话页。
- 手机输入适配当前官方 `data-composer-input` contenteditable 合同；长文本、键盘抬升、附件、语音与文件 `@` 引用都跟随当前官方编辑器，旧 textarea 只保留隔离兼容路径。
- 发送、停止、排队与恢复状态继续完全由官方主按钮和编辑器状态机拥有；手机层不再把 contenteditable 的 Stop 改名或拦截为合成 Enter，避免排队后按钮状态被平行逻辑卡灰。
- 修复刚进入会话、历史仍在加载时，官方新增 body 包装层使手机滚动区与输入框锚定规则失效的问题；任务栏和输入框现在保持在视口底部，加载完成前后不再漂到页面上半部或明显跳位。

### 版本与发布边界

- Desktop 根包、lockfile 与 15 个自有插件统一为 `1.0.59`；Android 为 `versionName=1.0.59` / `versionCode=1005900`，iOS/iPadOS 为 `MARKETING_VERSION=1.0.59` / build `10059`，Desktop Mobile Sync、移动更新示例、Web Search User-Agent 与组件签名验证 workflow identity 同步更新。
- 独立官方集成 `@zseven-w/dsh-android` 继续保持自身 `0.1.0-rc.4`，不伪装成 Desktop 产品版本。
- `v1.0.58` 是上一不可变稳定版；其 Tag、Release 资产、签名 APK、组件、`release-manifest.json`、镜像和 stable feeds 均不移动、不覆盖。本节只描述 `v1.0.59` 候选源码，尚不代表已经发布或可被更新客户端发现。
- 正式发布仍只能由仓库唯一 resumable publisher 在干净、已提交的精确 revision 上完成安全审查、静态/全量/移动门禁、云构建与签名、双云核对后创建新的不可变 `v1.0.59`；不得手工提交资产、移动旧 Tag 或盲目基线化失败。

## 1.0.58

### 官方 Harness alpha.4 兼容升级

- 官方 Harness Runtime 及完整 required/optional DSH 依赖图精确固定为 `0.1.2-alpha.4`，并以精确版本、依赖图闭包、产物哈希、语义锚点和幂等 patch 门禁阻止 alpha 漂移。
- Desktop 适配 alpha.4 的 branded session sequence、事件所有权、projector/node-store 与 Host follow-up queue 合同；自研 Agent Teams 的 Host 一次性授权、root/project/body 绑定、runtime epoch 撤销、任务账本和自动驾驶仍是唯一权威，没有被官方核心替代或双写。

### 桌面启动根因与认证会话

- 官方 Runtime 的 token 重定向改由承载工作台的同一个 `persist:harness` Electron session 跟随并建立 Cookie；每一跳继续限制为精确 loopback authority，跨来源、循环、缺少 Cookie 或 clean `/` 非 2xx 均 fail closed。
- 同一 runtime home 的并发启动合并为 singleflight；启动前只清理能够精确归属且已失去可访问 Web 服务的陈旧进程，不按端口、PID 或名称猜测终止。
- Runtime readiness 必须由真实认证链证明。可选 MCP 的连接与首次工具同步增加有界 startup deadline 和 supervisor 收敛，不能再无限阻塞基础 Web 启动；fatal MCP 配置仍保持失败语义。

### 手机同步与 Agent Teams 自动驾驶

- 官方工作台中的手机同步入口经受限 guest preload 进入可信 shell bridge，只转发固定动作并打开已有同步面板；仍只有一个入口和一份设备状态，不改变配对、权限、撤销或传输加密边界。
- 左侧栏“设置”和“手机同步”保留独立点击区与 8px 间距；展开态横向排列、折叠态纵向错开，避免背景和命中区域粘连或覆盖。
- 候选 v1.0.58 为 Agent Teams 增加可信桌面设置“自动接力，不用发送继续”，默认勾选；旧数据没有该字段时采用默认值，已明确关闭的配置仍保持关闭。用户点击“保存”并完成一次 Desktop Host 确认后即可使用，即使尚无团队也会记录偏好；每个目标可选择固定的 1–200 轮追加上限，默认 200。
- 无团队的可信保存只生成 settings proof，不会凭偏好伪造 Goal 权限。首个符合条件团队创建时还必须把当前 Host 授权 epoch、直接用户回合或精确 Goal round 与 Level 3 routing receipt 绑定，最终 grant 精确落到 root、canonical project、active Goal、team、pause epoch 与设置值；全局开关、静态请求头或模型参数都不能替代。后续同 root 下事实完整一致的平级团队才可继承仍存活的授权组。
- 获得授权后，正常成员等待期间 Root 安全 park；成员提交、释放与状态转换以持久事件合并唤醒，自动继续验收和调度，不再消耗轮次等待用户回复“继续”。显式 Stop 或安全 blocker 仍会解除授权并保持人工恢复门禁。
- 自动 park 要求所有未完成内部任务都由 live worker 持有，或沿同一 root 的依赖链最终落到 live producer；跨 team 可证明依赖链可用。缺失/循环/终态 blocker、跨 root/project、paused、capability 未验证、文件冲突、effect 非 `none` 与 `outcome_unknown` 全部 fail closed。
- 每个 durable transition 最多补一个 goal round，只恢复明确的 `round-limit`；达到用户设置的固定预算即停止。Host/plugin 重启、Stop、handoff、关闭设置、降低预算、权限确认、外部副作用未知和其他 blocker 都会撤销或阻断授权，不以无限循环或盲目重试兜底。
- 修复成员容量设置与自动建队脱节：关闭自动接力时，单独保存 `maxMembers` / `maxActiveTurns` 不再错误要求 Host 授权；完整 Bootstrap 与扩员提案不再固定卡在 4，而是遵守当前设置并支持到 8。系统提示与设置页明确这两项是容量上限而非强制凑满人数，并提示 8 人同时启动需要两项都设为 8。
- 官方输入框现在只在“对话”视图挂载到可见布局；切到“轨迹、代理团队、归档历史、Godot 预览”等视图时不再遮挡内容或进入键盘焦点顺序。团队页生成草稿后会先保存草稿再切回“对话”，仍由用户亲自发送。

### 会话附件拖拽

- 恢复直接向会话工作区拖入广泛文件类型：PNG/JPEG/WebP/GIF 继续作为原生图片附件，文档、源码、TIFF 等其他文件保存到 `uploads/` 并加入可发送的 `@` 引用；混合拖入不会再因官方 alpha.4 仅有 `onAddImages` 通道而整批失败。
- 混合拖入与回形针多选最多 64 项；保存到 `uploads/` 的文件沿用单文件 50 MB 边界和串行上传队列，原生图片继续遵守官方图像数量、类型与大小限制。拖入期间提供明确接收反馈，回形针及键盘操作继续作为非拖拽替代。

### 手机端输入与模型选择

- 修复 Android 会话切换或官方输入框重挂载后，“+”附件入口仍绑定首个旧输入框而无法打开的问题；入口现在跟随当前活动会话重新挂载，相册、拍摄、语音输入和文件选择保持可用。
- 修复手机模型选择弹层把五个直接子项排入四行网格造成模型列表被推到弹层底部的问题；拖拽柄、标题、当前状态、标签页与可滚动列表现在各占明确网格行，Android 与 iOS 保持同一布局。

### 浏览器对等与发布门禁

- Codex 浏览器的可见导航、交互、检查与停止能力继续经过来源/actor、站点授权、导航、敏感动作、文件/下载、取消与审计等动态安全门禁；最终结论由 browser 专项真实 Electron 场景复核，失败即阻止发布。
- 新增 v1.0.58 安全审查。正式云桌面构建及安装器门禁成功并公开桌面 Release 后，发布器必须按精确 revision/run/Release/asset/digest 把正式 Windows x64 便携包下载到本机隔离目录，使用独立 Electron userData 与 Harness runtime home 运行 packaged self-test，严格核对版本、随包 Runtime token→Cookie→clean `/` 启动链和全部报告项；本地开发实例不能替代该证据。
- 桌面根包、lockfile、15 个自有插件、Android、iOS/iPadOS、桌面移动路由、移动更新示例和 Web Search User-Agent 统一到 `1.0.58`；Android `versionCode=1005800`，iOS build code 为 `10058`。`@zseven-w/dsh-android` 保持独立的 `0.1.0-rc.4`。
- `v1.0.57` 是上一不可变稳定版；其 Tag、资产、签名 APK、组件、镜像和 stable feed 不移动、不覆盖。v1.0.58 仍必须由唯一 resumable publisher 完成隔离验证、双云核对后才提升 stable feed。

## 1.0.57

### 官方 Harness alpha.3 启动与认证兼容

- 本地 Web 启动地址完整保留 `/?token=...`，支持 stdout/stderr 跨分块识别；packaged self-test 现在验证 token 请求返回 303、取得精确 authority 的认证 Cookie，并携带该 Cookie 访问 clean `/` 获得 2xx 的完整链路，401/404/5xx 不再误报为已就绪。
- Runtime 状态、自检诊断与可选输出统一隐藏启动 token，只保留 loopback origin；解析器拒绝非本机、非根路径、无效端口和歧义 query。
- 主进程 HTTP RPC 与事件 WebSocket 复用官方 `persist:harness` 会话的认证 cookie，避免工作台启动后设置、事件与桌宠通道继续收到 401。
- MobileSync WebSocket 在 401 拒绝与 101 成功握手中都会剥离上游 `dsh-auth-*` `Set-Cookie`，同时保留普通 Cookie；401 握手不会被自动重放，只以单飞刷新认证供后续新连接使用。

### 插件 alpha.3 API 迁移

- Computer Use 设置注册迁移到 `settingsCtx.settings.installSection(...)`，不再导入 alpha.3 已删除的 `dsh-settings` 命名辅助函数。
- Browser Tools 技能候选迁移到 `ctx.remote.skills` 与新版 RpcResult，不再访问退休的 `connection.api.skills`。
- 随包 Web 客户端清理 `dsh-client-runtime` / `dsh-client-ui-slots` 退休注入，并增加全插件负向回归，防止旧 API 或旧 manifest 重新进入发布包。

### Agent Teams 与跨项目会话恢复

- Host 冷启动后会在精确 canonical project/workspace 绑定恢复时重新排队持久化为 `queued` 的顶层会话操作，并复用同一 operation/session/prompt identity；同一操作的启动、重试与 reconcile 合并到一条执行链，避免崩溃窗口留下永久排队或重复创建、重复投递。
- `prompt_dispatched` 的 `outcome_unknown` 由 Host 自动合并 `session/control` 与 `session/follow` 的 exact requestId 证据：已投递直接收敛为 `ready`，精确证明未投递才进入可安全失败/重试路径；证据不足时只保持后台观察并指数退避，不盲目再次发送 prompt。
- Root recovery 会在重启和后续用户活动后自动恢复同一 durable recovery。只有 exact Host 证据证明未投递或处于可安全重试的确定失败时才执行有界自动重试；未知现场只观察、不重复外部效果，revision/CAS 与原 operation/session/prompt identity 继续阻止并发或崩溃窗口造成双发。Host 关闭会等待已经受理的操作与持久写入收敛。
- 显式 Stop 现在会先取消该 root 的顶层项目会话启动与 admission，即使它尚未建立私有 Agent Team；项目任务 wake 在 Host 重启后以 exact `wakeRef` 核对完整 session/inbox 证据，未知现场不盲目重投，普通用户消息也不会凭空建立未由 `claim_next` 创建的 waiter。
- Root recovery 的 Web 投影改为 Host 签发、绑定 exact project/actor/action/revision 的不透明 capability；retry 继续绑定原始 Host launch reference，takeover 继续要求协调者、已审计请求与已迁移任务所有权，私有 recovery/actor 标识不作为可执行输入暴露给页面。
- 上述自动驾驶只覆盖能够由 Host 精确证明的会话启动与 root recovery；缺少精确持久证据的任意外部副作用继续受原安全门约束，不会被推断为成功或自动重放。

### 团队生命周期、重启与注意事项

- Graceful retirement、force drain、follow-up 与恢复启动增加统一的有界 deadline/Abort；超时会释放串行调用链，但不会把无法取消的底层 drain 推断为成功，成员持久化为 failed + shutdown/stop unconfirmed，供显式重试或替换。
- Host 重启遇到仍持有 `in_progress` 的旧 worker 时，会把 worker 标为 failed 并保留原 claimId/leaseEpoch 与 interruption evidence；任务不自动重放，也不伪装成可继续的健康执行。
- 崩溃遗留的 `closing` 团队不会只凭本地任务终态自动宣告关闭；重新执行关闭并获得 Host drain 成功后才收敛，失败继续保留 closing/failed/unconfirmed 审计。`submitted` 任务现在进入统计、Attention 与 `acceptance_required`，不会被当作普通在途或已完成任务。
- 一次无关的后续消息成功不会清除旧 `failed_delivery` 告警；在缺少可证明“同一 payload 重试”的持久 lineage 前，该告警保持可见，避免把未送达误报为已恢复。

### 桌面界面与发布身份

- 删除桌面外壳重复的“手机同步”按钮，只保留与官方左侧栏对齐、具备连接状态与无障碍语义的唯一入口。
- v1.0.57 未包含 Agent Teams UI 重设计；现有卡片界面、功能与权限不变，仅补充恢复动作所需的数据接线。
- 桌面根包、lockfile、15 个自有插件、Android、iOS/iPadOS、桌面移动路由和更新示例统一到 `1.0.57`；Android `versionCode=1005700`，iOS build code 为 `10057`。
- 新增 [`docs/SECURITY-REVIEW-v1.0.57.zh-CN.md`](docs/SECURITY-REVIEW-v1.0.57.zh-CN.md)。正式发布只走 resumable publisher，创建新的不可变 `v1.0.57`；已发布的 `v1.0.56` Tag、资产、组件、签名 Android APK 与 stable feed 保持不变。
- 当前条目记录的是源码修复与定向契约，尚不等同于正式发布验收；最终全仓 `npm run verify`、`npm run verify:release`、干净 revision、云构建/签名、双云镜像与 stable feed 仍待发布器产生证据。

## 1.0.56

### 官方 Harness alpha.3 与 Schedule 收敛

- 直接官方 DSH roots 统一精确固定为 `0.1.2-alpha.3`，lockfile、removed-root、unexpected-root、resolved/integrity 和 capability artifact SHA-256/语义片段门禁同步更新。
- 接入官方 Session Controller 长历史加载、轮次导航/turn-outline、附件队列缩略图、手动断线重连、Schedule catalog 与 Gateway/Remotes stream；Session Experience 移除已退休的 `dsh-client-runtime` fallback。
- Desktop Schedule profile 安装器改为删除退休的重复插件与 patch 项，只保留一个官方 `@deepseek-ai/dsh-schedule` 入口，并保持第三方 patch 与幂等迁移。

### Agent Teams、Project 任务与跨重启恢复

- 修复 `leaseEpoch=0` UI 可见性、Stop/迟到 submission 竞态、强制退休 claim 清理与 release ledger、retired target replay、pause-before-replay 和 state-only 请求拒绝。
- Root 破坏性项目任务命令（含 `release`）补齐 revision/CAS/request receipt；幂等 no-op 有持久回执，stale revision 与参数替换 fail closed，外部 effect 变更推进 revision。
- 顶层会话启动使用 schema v13 持久 waiter/outbox 与 Host wake scheduler，重启后恢复未确认投递而不重复已确认 delivery；精确 workspace 预检结果与 child cwd 一并持久传递。
- 新增 Agent Teams 使用缺陷审计、OCC、路由/计划、任务板、Stop、恢复、会话启动和跨重启回归覆盖。

### Mobile 导航、设置、输入与附件

- Android/iOS 共享 runtime/CSS 继续字节一致；四域导航优先绑定官方 Agent Teams 画布、正式定时任务视图和官方 Settings 页面，不再创建“我的”重复占位表面。
- 修复设置页异步挂载、页面隔离、返回层级、项目展开焦点抢占和对话详情状态滞后；loading/reconnecting 的权威工作区不再被误判为不可用。
- 附件图片预览按 DOM 结构识别为全屏 lightbox，避免通用 sheet 裁切；系统返回优先关闭预览，48px close control 不依赖本地化文本。
- 原生输入 action、附件上传、tool-result 图片交付和 session task panel 补齐 Android/iOS/Node 契约测试，敏感输入与权限边界不变。

### 版本、安全与发布

- 桌面根包、lockfile、14 个随包插件、Android、iOS/iPadOS、桌面移动路由和移动更新示例统一到 `1.0.56`；Android `versionCode=1005600`，iOS build code 为 `10056`。
- 新增 [`docs/SECURITY-REVIEW-v1.0.56.zh-CN.md`](docs/SECURITY-REVIEW-v1.0.56.zh-CN.md) 与 [`docs/audits/agent-teams-usage-audit.md`](docs/audits/agent-teams-usage-audit.md)，明确 source-level 审计结论与尚待 publisher 动态证明的云端阶段。
- 正式发布只走仓库 resumable publisher：精确候选 revision、不可变 `v1.0.56`、GitHub Actions 全平台构建与签名、精确 18 项资产、GitHub→CNB 云到云镜像，最后才提升三个签名 stable feed。
- 已发布 `v1.0.55` 的 Tag、18 项资产、签名 APK、组件与 stable feed 保持不可变，不移动、不覆盖、不复用。

## 1.0.55

### Agent Teams 自动续作与安全边界

- 同一 exact live root、同一 canonical project、团队 active/未暂停、能力已验证、文件无冲突且 effect 全为 `none` 时，checkpoint、reclaim、reopen、安全修复、复测和无歧义重规划沿既定目标自动继续，不再每轮要求用户发送“继续”。
- 默认 AI 选择的 main/subagent 路由进入普通持续授权；成功发布的成员以 `publishedAt` 保留证据，旧团队只接受 session/claimId/leaseEpoch 精确绑定的历史执行收据，retired/failed 占位不能伪造授权。
- 新建团队、显式 Stop 后 Resume、handoff/adopt/recover、未知能力、文件冲突、跨项目/所有权变化、真实副作用、`outcome_unknown`、不可逆风险与目标歧义继续硬性停止；授权保持 `human_attested`，不伪造 `host_verified`。
- accepted-completed 接管继续绑定原 owner epoch；`resolve_unknown` 改用 Host 发行、短时效、单用途且绑定完整参数摘要的授权，替换参数、过期、跨回合/工具和重放均拒绝。
- 项目设备/E2EE/LAN 私钥通过 Host secret capability 与系统安全存储托管；secure-channel receipt 持久化，collaboration same-dedupe 的检查与 Inbox 追加进入同一串行 mutation，覆盖重启、容量和双实例竞态。
- 打包版首次启动从已展开的版本化 runtime cache复制 Agent Teams 的运行依赖，不再对 `app.asar` 虚拟目录执行递归 `fs.cp`；Windows packaged self-test 与普通启动因此不会在 `preparing-runtime` 阶段退出。

### 官方 Harness alpha.2 维护迁移

- 官方核心维护依赖已从历史 `0.1.1-rc.2` 原子迁移到精确 `0.1.2-alpha.2`：20 个直接 roots、861 个 lock locations、216 个 DSH locations / 215 个唯一 DSH package names；官方 tag `dsh-v0.1.2-alpha.2` 固定到 `0a53fb55bea101816fa226bb964ae2bed71c343b`。此前 rc.2/NO-GO 报告仅保留为历史审计，不再描述当前维护依赖状态。
- alpha.2 已移除 `dsh-client-runtime` 和 `dsh-host-apiproxy`；旧私有补丁入口已退休，New Session、SessionManager/list baseline 与 workspace force-new 迁至公开的 Session Controller、native session-list 和 `startSession` owners。首次 patch 精确改变 25 个文件；第二次为 0 差异、0 byte delta。
- **RPC wire 合同**：桌面、Mobile 与桌宠生产客户端只发出固定 `workspace/...` / `session/...` slash endpoints 和 descriptor-shaped 参数；Workspace 只消费 `workspace/follow` baseline frames，Session 只消费 snapshot/cursor projection frames；generated strict descriptor 或 codec 漂移一律 fail closed。
- 自研 Project/Team、canonical-project 隔离、submission acceptance ledger、routing receipts、locks、recovery、cursors 与 evidence 继续是唯一 authoritative 数据面；官方 experimental Team 不接管且不双写。
- alpha.2 维护迁移不等同于最终发布验收：hermetic 终验、完整矩阵与 Root fresh-review ACK 仍是发布前硬门禁，未在此写入尚未产生的终验通过结论或最终计数。

### 模型密钥编辑与无障碍

- 环境 secret 保持不可读取、不可回写，但原密码字段允许直接键入/粘贴并创建隔离的 `HARNESS_DESKTOP_<PROVIDER>_API_KEY` 覆盖；设置、日志、审计和模型上下文只接触 credential ref。
- 支持覆盖新增、修改、删除与恢复环境来源；unset 失败按最新 settings revision 补偿重绑仍存在的引用，自定义 Provider 删除会清理页面托管凭据而不误删环境引用。
- DeepSeek `credentialOnly`、OpenAI、Codex、custom/pi-ai 和 inheritance/fallback 均有行为测试；字段补齐原生 label、稳定 id、密码掩码、`autocomplete=new-password`、持续帮助文本和 44px 操作目标。

### Android 扫码配对与 Release JNI 完整性

- 修复 v1.0.53 正式 APK 的 R8 混淆改名 WebRTC / jni_zero JNI 绑定，导致扫码启动 P2P 时 `libjingle_peerconnection_so.so` 在 `JNI_OnLoad` 触发 `SIGTRAP` 的原生闪退。
- Release 规则保持 `org.webrtc.**`、`org.jni_zero.**` 和注解元数据；`assembleRelease` 新增 R8 mapping 硬门禁，精确验证 `PeerConnectionFactory.initialize`、`NativeLibrary.initialize` 与 `JniInit` 未改名。
- 覆盖安装修正版可直接恢复既有加密配对配置，无需清除 App 数据。

### 长会话、渲染与工作区性能

- 大型消息树投影基准约由 150.828 ms 降至 1.128 ms；折叠的 4,000 步对话首批固定 64 项并优先保证深层 selected call 可达，不截断或删除历史。
- 会话字段投影约由 113.540 ms 降至 0.436 ms，160 个会话制品约由 2,457.747 ms 降至 279.330 ms；会话列表、持久化、Session Experience 生命周期、renderer observer 和右侧工作区进入双层性能门禁。
- 最终隔离 Electron 场景的 switch p95 为 9.5 ms、最长 long task 91 ms、无 retained heap/listener 增长；production contracts 31/31 通过。
- Conversation Work Tree 与 tool-result owner 补丁精确支持 raw、flat 和 `workTreeItems + renderedNodeKeys` 组合；完整组合幂等，半补丁与漂移继续 fail closed。

### 验证与发布身份

- 新增 [`docs/SECURITY-REVIEW-v1.0.54.zh-CN.md`](docs/SECURITY-REVIEW-v1.0.54.zh-CN.md) 与 [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)，记录自动驾驶授权、secret custody、密钥覆盖和性能证据边界。
- 以下为 alpha.2 维护迁移前记录的 v1.0.54 历史验证（全仓 `npm run verify` 1717 通过/0 失败/5 跳过；Agent Teams 160 通过/0 失败/2 跳过；模型密钥 28/28；artifact-fixture smoke 2/2；P1 矩阵 11/11；Android、`verify:release` 与 `git diff --check` 通过），不构成 alpha.2 的最终或发布验证。它已由本节“官方 Harness alpha.2 维护迁移”的新发布前硬门禁取代；终验须产生新的独立证据与计数后才能声明通过。
- macOS Host IPC endpoint 增加 100 UTF-8 bytes 硬上限及长 `TMPDIR` 回退，Windows 命名管道前缀保持兼容；安装后 workbench smoke 同步真实 Stop/continue 文案；Windows 云端冷启动使用独立 350 ms 上限但不放宽稳态性能与泄漏门禁。
- 桌面根包、lockfile、14 个随包插件、Android、iOS/iPadOS、桌面移动路由和移动更新示例统一到 `1.0.55`；Android `versionCode=1005500`，iOS build code 为 `10055`。
- 正式发布只走仓库 resumable publisher：精确 main SHA、不可变 `v1.0.55`、GitHub Actions 全平台构建与签名、精确 18 项资产、GitHub→CNB 云到云镜像，最后才提升三个签名 stable feed。
- 已发布 `v1.0.53` 的 Tag、18 项资产、签名 APK、组件与 stable feed 保持不可变，不移动、不覆盖、不复用。

## 1.0.53

### 大型会话与高频渲染性能

- JSONL 会话制品枚举改为最多 8 路有界滑动并发，在保持输入顺序、最早索引错误、重复检测、取消和已启动读取收敛语义不变的前提下，983 个真实会话的中位枚举耗时由约 958 ms 降至约 172 ms。
- Host 已附着会话摘要直接复用精确增量 `sessionListMetadata` 投影，无投影时仍回退到原全量折叠；不会截断历史、改变投影身份或缩短会话保留期。
- 桌宠会话优先级、稳定排序和各状态计数合并为单次遍历；10,000 组随机差分保持输出完全一致，2,500 会话基准约由 257.35 ms 降至 10.80 ms。
- 主题、模型路由、工作区链接、设置集成和子代理扫描的 MutationObserver 仅处理相关目标，并采用单一单调定时器；聊天流普通变更不再反复触发全局设置挂载。

### Agent Teams、更新中心与生命周期

- Agent Teams 协作状态在单次遍历中建立成员、状态和任务索引；Store 关闭时注销共享实例、清理监听，客户端语言订阅通过 Cordis effect 生命周期释放，避免卸载或热重载后保留旧引用。
- 保留并正式整合团队计划、任务、认领/租约、暂停/恢复、交接、协作收件箱与移动端表面；关闭和退休仍需协调持久任务状态，不会自动丢弃历史可继续会话。
- 更新中心和相关回归保持稳定版检查、PR Preview、安装确认、失败重试、稍后安装及回滚语义；不会静默下载、安装或重启。

### Mobile 与发布体积

- Android 增加经过配对鉴权、同源约束、缓存交接、100 MiB 有界下载与生命周期清理的原生文档查看路径；密码、支付、银行、验证码、Shell、静默安装卸载及权限绕过边界不变。
- Android/iOS 共用的移动 runtime/CSS 保持字节一致；原生输入、附件、系统返回、会话和 Agent Teams 工作区语义保持一致。
- 正式包排除 Marketplace 的脚本、文档、仓库元数据和离线审计源文件；产物审计拒绝这些 source-only 路径，运行时插件、索引、技能及安装功能不变，原始输入减少约 5.89 MiB。
- 桌面根包、lockfile、14 个随包插件、Android、iOS/iPadOS、桌面移动路由和移动更新示例统一到 `1.0.53`；Android `versionCode=1005300`，iOS build code 为 `10053`。
- 维护树通过全仓 1660 通过/0 失败/2 个平台条件跳过，Agent Teams 240/240、渲染/插件专项 89/89、移动 Node 49/49，Android `testDebugUnitTest` 成功。
- 正式发布只走仓库 resumable publisher：精确 main SHA、不可变 `v1.0.53`、GitHub Actions 全平台构建与签名、精确 18 项资产、GitHub→CNB 云到云镜像，最后才提升三个签名 stable feed。
- 已发布 `v1.0.52` 的 Tag、资产、签名 APK、组件与 stable feed 保持不可变，不移动、不覆盖、不复用。

## 1.0.52

### 更新器、Git 与 Agent Teams 状态修复

- Git/GitHub 的真实连接状态与详情折叠彻底分离：已连接时开关保持开启，信息可默认折叠；未连接和 Git 未准备好各自呈现，Git、GCM、SSH 状态及全部既有动作不被折叠逻辑覆盖。
- 稳定版更新、签名 PR Preview、安装前说明、进度、失败重试、稍后安装和回滚继续共存；更新仍需要用户明确确认，不静默下载或安装。
- Agent Teams 只注册官方 `conversation.view`，不再向输入 dock 注入隐藏 session 组件；Mobile 复用官方团队工作区、画布和自动化表面，移除重复的 Mobile task hub，同时保留 Ready / Running / Attention / Done 与全部 plan/claim/lease 安全契约。

### browser_control 超时与结果未知 fencing

- CDP 输入统一经过 8 秒有界执行；服务端把处理器与 abort 信号竞争，即使底层 Promise 不合作也会释放序列化 scope tail，不再让一次悬挂输入导致后续调用连续卡满外层 60 秒。
- 点击、输入、选择或导航超时后返回 `browser-outcome-unknown` 并 fence 后续可变操作；只读 observe/截图/console/network 仍可用于核对现场，显式停止并重建控制会话后才清除 fence。
- 浏览器工具适配层把未知结果作为安全阻止而非可重试错误；原有密码、账户、验证码、支付、银行与交易流程禁区保持不变。

### 右侧工作区、附件与时间线

- 右侧工作区改为覆盖官方会话而不是缩小 `#runtimeView`：首页 280px、工具页 640px 默认宽度，800px 窄屏保留 48px 上下文边缘，顶部 76px 安全区随主题和模式一体呈现。
- 文本、源码、隔离 HTML、图片、音频、视频和 PDF 可在右栏只读预览；程序与安装包不执行，本地目标先规范化为 `local.path`，相对路径继续受工作区边界限制。
- 图片、文件、音频和视频工具结果统一持久转发并绑定真实 owner/session；跨会话完成通知、附件定位、草稿转移、归档历史和可恢复编辑冲突不会再误挂到当前前台会话或静默覆盖。
- Session Timeline 与 Right Workspace 增加真实 Electron 夹具，分别验证会话引用及首页/工具页/窄屏几何。

### 桌面、Android 与 Mobile 设备体验

- 统一设备工作区可查看已授权 Windows 桌面流和已配对 Android 手机，保持设备来源、连接状态、画面比例、控制工具和停止入口可见，不挤压官方会话。
- Android 控制继续只开放固定动作；Shell、脚本、密码、支付、银行、验证码、清除数据、静默安装卸载和权限绕过禁止，文本/文件/清缓存继续由手机二次确认。
- Android 插件安装使用临时目录、备份恢复和对 Windows `EACCES`/`EBUSY`/`EPERM` 的有界退避重试，避免短暂文件锁留下半安装状态。
- Android/iOS 共用移动 runtime/CSS 保持逐字节一致；Mobile 继续复用官方会话与 Agent Teams 表面，并保留较新的会话安全转移、附件状态、前台恢复和文档上传边界。
- Android 四宫格附件菜单改为 body 级固定面板，不再被真实 WebView 中带 transform/overflow 的 composer 祖先裁剪；菜单内点击、外部关闭和 composer 重挂载后的孤立面板清理均有回归测试，四个固定原生动作不变。

### 安全、验证与发布完整性

- 新增 [`docs/SECURITY-REVIEW-v1.0.52.zh-CN.md`](docs/SECURITY-REVIEW-v1.0.52.zh-CN.md)，记录浏览器 unknown-outcome、路径规范化、附件归属、设备控制和 Mobile 官方表面复用边界；Computer Use 全桌面权限未扩大。
- 集成树通过全仓 1629 通过/0 失败/2 跳过；Android 50 个 compile/unit/lint/assemble 任务成功；Android 插件连续 3 轮重复安装、Session Timeline 和 Right Workspace Electron 夹具均通过。
- Windows 打包组件健康/回滚门禁现在等待 baseline 自检进程真正退出并释放单实例锁，移除固定 2 秒后继续导致 `awaiting-health` 假超时的竞态；正式健康确认与回滚判定保持不变。
- Linux Electron 导航安全门禁在真实鼠标输入前等待 compositor 帧并先发送 mouse move 建立 hit-test，再有界等待 DOM `isTrusted` 点击证据；消除云 Runner 调度延迟导致的 `undefined` 假失败，不改成脚本点击。
- Windows 云端审计实测受控 `app.asar.unpacked` 为 31.69 MiB；按 v1.0.52 正式插件增长仅把该项预算从 31 MiB 调整到 32 MiB，物理文件数、禁止整个 DSH runtime/marketplace 展开以及其他产物预算均不放宽。
- PR Preview 本地门禁的临时 profile 清理使用 Node 原生有界 `maxRetries`/`retryDelay`，吸收 Windows 杀毒或进程收尾造成的短暂 `EBUSY`/`EPERM`；持续锁仍会使门禁失败。
- 桌面根包、lockfile、14 个随包插件、Android、iOS/iPadOS、桌面移动路由、移动更新示例和发布工作流统一到 `1.0.52`；Android `versionCode=1005200`，iOS build code 为 `10052`。
- 正式发布只走仓库 resumable publisher：精确 main SHA、不可变 `v1.0.52`、GitHub Actions 全平台构建与签名、精确 18 项资产、GitHub→CNB 云到云镜像，最后才提升三个签名 stable feed。
- 已发布 `v1.0.51` 的 Tag、18 项资产、签名 APK、组件与 stable feed 保持不可变，不移动、不覆盖、不复用。

## 1.0.51

### Agent Teams 计划先行与可恢复执行

- 团队计划现在持久经历 `draft → committed → active`：任务或安全边界变化会回到 draft；精确 plan revision/hash 的 CAS commit 才能允许新认领或成员启动；无已建立成员时 committed 可被观察，首个成功 claim 或完整 child publication 才进入 active。
- 公开 spawn 必须绑定至少一个已持久化任务。Host 在调用 continuable child 前原子保存成员占位、任务预绑定、计划 revision/hash 和启动意图；启动前失败、publication 不确定与 work followup 失败均保留可恢复审计，不重复猜测执行。
- 每个团队持久化 `pauseEpoch`，每次任务尝试拥有单调 `attempt`、`claimId` 与 `leaseEpoch`。旧 claim、旧 epoch 和迟到 complete/release/checkpoint 写入会被拒绝；完全相同的已完成 receipt 可安全重放。
- Stop 先持久化新 epoch 和暂停门禁，再取消排队唤醒并中断成员。Resume 改为 preview + CAS commit，receipt 绑定 requestId/previewId/pauseEpoch/teamRevision，异常节点不冻结健康节点，也不会自动唤醒任何成员。
- 成员 checkpoint/next step 始终标记 `verified:false`，不能携带权限、外部结果、路径、凭据、原始消息或进度百分比。最后一份未验证上下文在 release、再次 claim、Stop、force-retire 与 adopt 后继续保留旧 fence/报告者用于恢复审计，直到新持有者明确覆盖。
- capability 默认为 `unknown`，只有注册过的 Host 证据才能成为 verified；模型布尔只可形成 `human_attested` plan 授权，不能产生 `host_verified`。`confirm_each` 在没有 Host 验证入口时持续 fail closed。
- 外部副作用显式区分 `none | idempotent | confirm_each | forbidden` 与 `outcome_unknown`。effect identity 只由 Host 从 team/task/effect 稳定派生；任意 UI 或第三方动作不声明通用 exactly-once，未知结果在直接用户根会话解决前阻止重试和完成。
- 同一 canonical project 的 direct-human root 可通过短期单次 token handoff/adopt 接管暂停团队；接管递增 epoch、撤销全部旧 lease、退休旧 parent worker、释放未完成任务且不伪造 reparent。私有 project/token hash 只保留在 durable store，不进入公开团队或 handoff 投影。
- v4 及更早团队采用非破坏迁移：空/无 worker 团队进入 `legacy_unplanned` draft；已有在途工作的团队保留旧执行并进入 `legacy_active_gate`，但新 claim/spawn 前必须按当前计划重新提交。

### 桌面与手机任务规划追踪

- 桌面工作台和 Mobile Orbit 统一采用 Ready / Running / Attention / Done 四个主区；Cancelled 只进入历史，不再显示模型臆测百分比、随机脉冲或伪 progressbar。
- Attention 只呈现 Host 可核对事实：依赖失败、权限未知、capability 未证实、外部结果不确定、文件冲突、陈旧 lease、成员失败或部分 publication；成员 checkpoint 与下一步明确标注“未验证”。
- 手机代理团队首屏直接回答“需要确认什么 / 卡在哪里 / 下一步做什么”，Running 任务可展示成员建议的下一步但不把它当作 Host 指令或完成事实。
- Android 与 iOS 共用字节一致的移动 runtime/CSS，保留 48dp Android、44pt iOS 触控基线、可见键盘焦点、非纯颜色状态、放大文字、减少动态效果、安全区和无横向滚动布局。

### Mobile APP 修复

- 四域导航、系统/边缘返回、首页、项目/会话上下文与设置入口统一走版本化原生桥或权威语义控件；设置只从“我的”进入，不通过对话菜单或坐标猜测。
- 项目、会话、团队和任务继续使用稳定身份；同名项目不合并。权限模式、项目身份和来源会话投影均有新增回归测试。
- Android 前台恢复不再伪造网页 `online`/`focus` 事件，也不重复注入 runtime；保留 WebView 草稿、滚动、IME 和页面状态，系统/边缘返回不会双重派发。
- 相册、拍摄、语音和文件继续使用固定原生动作与系统授权。文件结果通过已配对设备鉴权、POST + intent header、50 MiB 上限、有限上游响应和官方 `/api/desktop-files/upload` 路径进入工作区；手机不能提供本机落盘路径。
- 文档、图片、相机临时 URI、IME 截图提示、导航与 session task panel 的边界均补充自动化覆盖；Android/iOS 共用资源在合并后继续逐字节一致。

### 安全、验证与发布完整性

- 新增 [`docs/SECURITY-REVIEW-v1.0.51.zh-CN.md`](docs/SECURITY-REVIEW-v1.0.51.zh-CN.md)，记录 plan 授权、fencing、checkpoint、外部副作用、handoff/adopt、Mobile 文档上传与公开投影边界。v1.0.51 不扩大 v1.0.50 已审查的 Computer Use 桌面权限。
- 合并后的本地门禁通过 Agent Teams 128/128、Mobile 119/119、全仓 1540 通过/0 失败/2 跳过；Android `testDebugUnitTest`、`lintDebug`、`assembleDebug` 共 50 个任务成功，验证期间未安装 APK、未升级或重启当前 Harness Desktop。
- 桌面根包、lockfile、14 个随包插件、Android、iOS/iPadOS、桌面移动路由、移动更新示例和发布工作流统一到 `1.0.51`；Android `versionCode=1005100`，iOS build code 为 `10051`。
- 正式发布只走仓库 resumable publisher：精确 main SHA、不可变 `v1.0.51`、GitHub Actions 全平台构建与签名、精确 18 项资产、GitHub→CNB 云到云镜像，最后才提升三个签名 stable feed。
- 已发布 `v1.0.50` 的 Tag、18 项资产、签名 APK、组件与 stable feed 保持不可变，不移动、不覆盖、不复用。

## 1.0.50

### Mobile Orbit 工作台与跨平台体验

- 重构手机端为稳定的四域导航：**对话、代理团队、定时任务、设置**。底部导航、详情返回、抽屉、搜索、弹层和系统/边缘返回遵循同一分层协议，不再依赖模拟键盘事件或占位页面。
- Android 与 iOS/iPadOS 共用审查过的 `mobile-compat.css` 和 `mobile-runtime.js`；提供安全区、深浅色、放大字体、减少动态效果、IME 抬升、非纯颜色选中态与不低于 48dp 的关键触控目标。
- “首页”入口和对话历史切换更明确；从详情返回先回到当前域，再展开项目与对话列表，避免跳转到错误层级。
- 代理团队明确显示**所属项目**与**来源会话**，说明团队不会因为项目同名而合并，并可通过权威会话选择切换上下文；团队、任务、项目和会话继续使用真实稳定标识，不按显示名称猜测。
- 手机端继续装饰官方 TodoDock 与 QueueDock，而不复制任务状态；未读只在同一会话的最新权威历史成功加载后提交精确回执，失败、过期、子代理或不匹配历史不会误清未读。
- 手机设置增加已配对电脑的真实模型路由、Provider 余额/额度与插件清单只读投影；响应有数量、文本、路径和私密字段边界，使用 GET-only、`no-store`，不在手机端暴露凭据、设置写入口或本机私有路径。
- iOS 前台生命周期恢复保持配对、幂等并感知网络状态；没有 Apple Developer 会员时仍只做 iPhone/iPad 模拟器验证，并提供 Safari/添加到主屏幕路径，不发布未签名 IPA。
- 随包提供移动实现审计、交互蓝图、视觉系统、可运行 Orbit 预览与五张审查截图，覆盖对话、团队、设置和详情状态。

### Android 原生输入、隐私与连接

- 输入框“+”只提供四个明确原生动作：**相册、拍摄、语音输入、文件**；四宫格面板适合拇指操作，并复用官方粘贴/拖放预览与发送流程。
- 相册和文件使用系统选择器与临时读取授权，不申请广泛媒体/外部存储权限，也不保留持久 URI 授权。
- 拍摄使用受限 `FileProvider` 缓存 URI，单文件上限 12 MiB，成功、取消和异常路径都会清理临时文件。
- 语音输入委托系统识别器并沿用系统语言，不申请应用自身的录音权限；原生桥仅接受固定动作和固定回调，并在 UI 线程以 JSON 安全值返回。
- 屏幕截图提示仍只在输入流程中建议打开系统照片选择器；应用不会读取截图内容。WebView 恢复不强制 reload，保护草稿、滚动和页面状态。
- 局域网连接优先选择非 VPN 物理网络 socket，失败时回退 Android 系统路由；既有端到端加密 WSS/SOCKS、P2P 协商与中继安全边界保持不变。

### 统一更新中心与 Preview 去重

- 把稳定版更新、已签名 PR Preview、安装前审查、下载进度、更新历史、重试、回滚和退出预览统一到一个更新中心，保留签名校验、显式应用、健康检查和稳定版回滚边界。
- 精确记录已安装的 Preview PR/head 后不再重复提示同一提交；同一 PR 的新 head 仍会正常出现并保持可更新。
- Preview 批量签名继续绑定精确提交、审计清单和回滚点；安装 Preview 后必须重启 Harness Desktop，退出 Preview 可从更新中心恢复稳定版。

### Computer Use 全桌面控制与明确权限模型

- Computer Use 改为经可信宿主授权后控制**完整 Windows 虚拟桌面**：截图覆盖所有已连接显示器，点击和滚动统一使用最新完整截图的全局像素坐标，修复多显示器映射和重复缩放误差。
- 恢复本次授权/永久授权的持续控制与自动恢复；永久授权可跨应用重启恢复共享会话，锁屏、睡眠或系统会话切换时暂停，恢复后重新采集全桌面；透明置顶控制指示覆盖每块显示器、不拦截鼠标且不进入截图。
- 这是有意扩大的桌面权限：授权后不再选择单个窗口，也不再使用窗口绑定、逐动作确认或按内容识别的敏感操作过滤；`Esc`、停止或撤销永久授权仍可立即结束控制。
- 浏览器结构化控制仍保留独立安全边界，禁止代输密码、账户、验证码、支付和银行内容，也不执行登录、支付、转账等流程；文件、仓库、网页和手机任务继续优先使用专用结构化工具。

### 桌面可靠性、浏览器、会话与工具结果

- Agent Teams 明确区分“调用者无权访问团队”“目标成员失败不可接收任务”和受控停止/无内容完成，避免把正常停止或成员失败误报为根负责人会话失效；失败成员继续 fail-closed。
- 持久化侧栏会话置顶、未读和起始时间，并与移动端精确历史回执协同，应用重启或本地运行端口变化后不再丢失置顶状态。
- 修复内置浏览器首次使用时的新标签导航与后台优先行为；仅严格空 URL 与 `about:blank` 可作为安全启动页，其他内部或错误页面不能借此建立来源。
- 允许工作区内文件和用户明确点击的工作区外绝对路径在安全右栏中只读预览；图片、音频、视频、PDF、HTML 与文本继续执行路径、大小、远程来源和 MIME 边界检查。
- 为官方运行时的工具结果补上持久图片渲染与重载恢复，仅放行经桌面附件存储物化的生成图片，继续拦截恶意远程图片、任意 `file:` URL 与超大 data URL。
- 恢复随包 Provider/Model catalog，确保设置和模型路由在正式安装包中仍能发现受支持模型。
- 当 `edit` 的字面锚点因引号转义或单一拼写差异失配时，停止原样重试，只允许基于最新内容重建一次短而唯一的恢复候选；含糊匹配继续拒绝修改。
- Codex 临时过载通过持久化可见事件执行最多五次、有界、可取消的指数退避，覆盖流式中途失败并明确排除认证、额度及其他 Provider 错误；没有注入随机源时生产行为保持确定性。
- 补充 PR Preview 激活文档，明确重启要求、稳定版回退入口和逐步操作。

### 版本、纳入范围与发布完整性

- 桌面根包、lockfile、14 个随包插件、Android、iOS/iPadOS、桌面移动路由、移动更新示例和发布工作流统一到 `1.0.50`；Android `versionCode=1005000`，iOS build code 为 `10050`。
- 完整纳入通过门禁的 PR #27、#28、#29、#30、#34、#35、#37、#39、#40、#41、#42；PR #33 的累计 head 用作所有这些来源均已包含的集成证明。
- PR #2 与 #7 不纳入本版：正式基线继续精确固定 Electron `43.2.0` 和 `@earendil-works/pi-ai` `0.82.1`。
- 正式发布仅由仓库 resumable publisher 在干净、已提交源码上执行：精确 main SHA、不可变 `v1.0.50`、GitHub Actions 全平台构建与签名、精确 18 项资产、GitHub→CNB 云到云镜像、最后提升三个签名 stable feed。
- 已发布 `v1.0.49` 的 Tag、18 项资产、签名 APK、组件与 stable feed 保持不可变，不移动、不覆盖、不复用。

## 1.0.49

- 修复 Android 原生 P2P 协商期间外网工作台可能等待最长约 20 秒才获得可用通道的问题：已有端到端加密 WSS/SOCKS 后备立即开放，WebRTC 协商继续在后台进行，切换到 v2/直连前仍关闭旧流并保持既有降级防护。
- 稳定 Computer Use 控制指示与路由：移除无限透明度动画和整页 backdrop filter，重复状态同步改为幂等并原子替换注入样式；网页与仓库任务继续强制优先结构化工具，桌面截图控制只作为最后后备。
- Agent Teams 完成任务后会把匹配成员运行的最终文本结果以 12,000 字符上限持久化，并直接显示在已完成任务卡片、侧栏和详情中；非文本块、原始工具事件与内部会话载荷不进入用户结果，任务重开会清除旧结果。
- 桌面、14 个随包插件、Android 与 iOS/iPadOS 源码统一到 1.0.49；Android `versionCode` 为 1004900，iOS build code 为 10049，完整正式包使用新的不可变 `v1.0.49`。已发布 `v1.0.48` 的 Tag、18 项资产、组件与 Android APK 保持不可变。

## 1.0.48

- 新增桌面与 Android 原生 WebRTC DataChannel P2P 直连：以个人 WSS/443 仅承担信令与盲转发后备，直连不可用时自动保持端到端加密中继；会话密钥绑定房间、双方身份与双 nonce，并以方向、peer、session AAD 和 4096 包滑窗拒绝重放及路径重绑定。
- WSS relay 升级为有界的 P2P 信令与盲中继服务，保留连接、握手、房间、来源、帧大小、速率和背压限制；桌面原生 P2P Host、Android WebRTC/DataChannel/SOCKS 与中继线程、socket、窗口和定时器均在停止或断线时收敛回收。
- 手机端新增与桌面外观完全隔离的皮肤设置，核心表面保持可读且不读取桌面壁纸文件；优化输入法抬升、单图快速选择、照片内容复制、历史请求短暂故障恢复和有界 DOM 观察，Android Back 继续只把任务移到后台而不终止同步。
- Agent Teams 增加显式任务取消、失败前置投影、终态历史与关闭收敛语义；优雅成员退休/团队关闭拒绝遗留未完成工作，强制关闭先记录取消审计，任务重开继续维护依赖一致性。
- PR Preview 改为默认发现已签名候选并复用正常更新通知；Computer Use 永久授权只跨重启记住、不在应用启动时自动控制，窗口控制指示保持准确；修复共享更新通知可能把签名组件更新误送入完整安装器路径的问题。
- 修复远程通道断线切换与用户关闭同步并发时，旧适配器清理结束后仍可能复活备用通道的生命周期竞态；所有异步 prepare/start/fallback 在提交状态前绑定并复核当前 lifecycle revision。
- 桌面、14 个随包插件、Android 与 iOS/iPadOS 源码统一到 1.0.48；Android `versionCode` 为 1004800，iOS build code 为 10048，完整正式包共用新的不可变 `v1.0.48`。已发布 `v1.0.47` 的 Tag、18 项资产、组件与 Android APK 保持不可变。

## 1.0.47

- 新增桌面集成终端：只允许人工桌面壳使用固定 PowerShell、CMD、Git Bash、WSL 或系统默认 shell，限制终端数与输入大小，不向模型工具暴露任意 Shell/脚本入口。
- 补齐 Codex 风格的 `@` 文件引用与 `$` Skill 触发语法，随包提供受管 Skills；新增默认关闭、固定可执行文件/参数/输出目录且强校验图片魔数、尺寸和附件落盘的 Codex image bridge。
- Computer Use 与右栏浏览器共用可信宿主授权，增加持续可见的蓝色控制指示与全局 Esc 停止；浏览器仍禁止密码、账户、验证码、支付和银行敏感输入。
- 加固 Agent Teams 的 Stop/Resume 生命周期、暂停 epoch、失败成员、Bootstrap、任务认领、SSE/UI 投影和 closing 恢复，显式 Stop 后不会由排队旧事件或后台协作隐式复活团队。
- 完成 Android 移动工作台重构、照片与输入体验、扫码配对后的受控工作区选择，以及移动端与桌面端二维码路由统一；iPhone/iPad 继续使用已验证的 Safari/添加到主屏幕路径。
- 修复 Electron sandbox 中 guest preload 依赖相对模块导致原生工作区选择器不可用的问题；preload 仅加载 Electron，并由回归测试和真实 sandbox 启动探针验证。
- 修复 PR Preview 配置初始化误用状态存储 API 导致入口错误禁用的问题，并整合受保护 Preview 更新、浏览器 PR 改动、终端、Skills、移动端与代理团队改进。
- 桌面、14 个随包插件、Android 与 iOS/iPadOS 源码统一到 1.0.47；Android `versionCode` 使用单调编码 1004700，完整发布 APK 与桌面资产共用不可变 `v1.0.47` Release。现有 `v1.0.46`、其 18 项资产/稳定 feed/组件以及 `android-v1.0.46.1` 全部保持不可变。

## 1.0.46

- 新增受保护的官方同仓库 PR Preview 更新通道：无密钥 PR 构建、默认分支独立 Ed25519 签名、不可变候选、本机真实组件更新/重启/退出恢复/失败回滚证据，以及 Required Reviewer 后置 promotion 完全分离；签名阶段不会提前修改 `latest`。
- Preview 客户端固定 CNB 优先、GitHub 后备双源，严格绑定官方仓库、同仓非 fork PR、`main`、精确 head SHA、单调 sequence、最长七天有效期、完整 SHA-256 和独立 `harness-preview-v1` 公钥；未知来源、重放、降序或签名错误全部失败关闭。
- CNB handoff 绑定远端 `pr-preview` 的精确当前 OID 并只使用普通 non-force push；CNB 完整回读不可变资产后才依次提升 CNB 与 GitHub feed，生产凭据只由固定受限密钥仓库 imports 注入。
- 合入共享 Computer Use 授权/浏览器控制面、右侧工作区原生文件按钮与有界预览、明确浏览器打开意图、模态焦点恢复、主题/背景可读性、会话归档永久删除重试，以及 Agent Teams 项目任务详情与安全 optional-service 合并。
- 包含 v1.0.45 候选中的 Android API 26–32 兼容、WSS/SOCKS 有界线程池与 loopback 监听、个人 WSS/443 中继配置及盲转发部署；现有 v1.0.45 Tag/草稿保持不可变、不复用。
- 桌面、13 个随包插件、Android 与 iOS/iPadOS 源码同步到 1.0.46，Android `versionCode` 更新为 10046；正式发布继续由统一可恢复发布器执行全平台云构建、精确 18 项资产、GitHub→CNB 云镜像和 stable-last 门禁。

## 1.0.45（不可变候选，未公开发布）

- 修复 Android API 26–32 兼容问题：移除生产代码中的 `String.isBlank()` 等高版本 API 依赖，补齐配对、文件选择、前台服务、更新检查与错误处理兼容路径，避免旧系统出现 `NoSuchMethodError`。
- 修复 WSS 中继成功连接后无限创建 SOCKS 转发线程并最终 OOM 闪退：改为单接收线程、固定 8 个工作线程与 16 个有界排队槽，过载时明确拒绝；Android 本地 SOCKS/Web 代理固定绑定 `127.0.0.1`。
- 新增可配置个人 WSS/443 中转服务器与桌面检测/保存/清除界面，附独立 Node 服务、Caddy 和 systemd 部署示例；中继仅盲转发端到端加密帧，不持有密钥或内容，并强制总连接、握手、房间、来源、帧大小与速率上限。
- Computer Use 状态和控制入口迁移到“设置 → 插件 → 插件配置”；插件只能请求、停止、恢复或撤销，`本次授权 / 永久授权 / 拒绝` 仍由可信宿主卡独占。保留 v1.0.44 的 `unlimited=true` 语义，不引入旧版受限模式或插件自授权旁路。
- 桌面、13 个随包插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.45，Android `versionCode` 更新为 10045；正式包继续使用 Tag 后置、GitHub Actions cloud-only 构建、精确 18 项资产、GitHub→CNB 云镜像和 stable-last 契约，历史 Tag（含已发布 v1.0.44）保持不变。

## 1.0.44

- 修复 v1.0.43 候选在托管 Runner 暴露的三项跨平台门禁问题：Linux CAS 并发原子发布竞态（POSIX `rename(temp,target)` 覆盖造成 inode 替换、验证者误报 `ARTIFACT_CAS_CIPHERTEXT_INVALID`，改为 no-clobber 原子发布，赢家发布、输家只验证既有不可变对象）；Windows Git refs/worktrees MAX_PATH（win32 每次 Git 调用注入 `core.longpaths=true`、缩短 merge 临时 basename，cherry-pick 非零且无 unmerged paths 时 abort 后明确抛 `GIT_OPERATION_FAILED`，不再伪装空冲突）；macOS 打包运行时可选服务读取（dsh-agent-teams 改用官方 `ctx.get` strict optional lookup 读取 `projectFoundations`，缺失 provider 时安全默认，不加入 required inject）。路径 containment、trusted root、immutable receipt/CAS、密文/nonce/digest fail-closed 语义均不放宽。
- v1.0.44 起采用 Tag 后置契约：先对锁定 SHA 做全平台 candidate build/test（Windows/macOS/Linux/iOS）与 pre-Tag Windows installer/upgrade 全量验证，全部成功后创建唯一正式 `v1.0.44` Tag；失败保持同一 1.0.44 候选迭代（不自动提升补丁版本），恢复时复用同一 run artifacts、不重复 desktop build；Tag 一旦创建仍不可移动、不可覆盖。
- 桌面、全部随包插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.44，Android `versionCode` 更新为 10044；发布工作流默认目标更新为 v1.0.44（Tag 按新契约后置创建）。

## 1.0.43（候选 Tag，未发布）

- `v1.0.43` 本地官方门禁 1202 tests/1200 pass/2 skip/0 fail 通过；云端矩阵三项已确认失败、iOS 通过：Ubuntu（run 32741226632）CAS concurrent finalize 的 POSIX rename overwrite/inode identity race；Windows（同 run 的 job 97475914969，Git 2.55.0.windows.4）六个 project-foundations-runtime merge 在 async canonical TEMP 加长后触发 Git refs/worktrees MAX_PATH，cherry-pick 非零且无冲突文件时被伪装成空冲突结果；macOS（job 97475914937）源测试与 x64/arm64 构建完成，但 packaged x64 self-test 启动失败（`runtimeWebBoot=false`，dsh-agent-teams `ctx.projectFoundations?.runner` 在 Cordis plugin fiber 抛 cannot get property without inject）；iOS job 成功。发布器按设计停止，未公开 Release、未提升 stable feed；该不可变 Tag（289ef403）保持原样，三项修复随 v1.0.44 重新接受云端矩阵。

- 修复 v1.0.42 候选在托管 Runner 暴露的两项跨平台门禁问题：Windows 同步/异步 realpath fixture 不一致（同步保留 8.3 短路径、异步展开长路径）与 macOS 并发 Git worktree 元数据锁竞态；仅校正测试 fixture 归一化与仓库变更协调机制，不放宽生产代码的路径 containment、trusted root、immutable receipt/CAS 与 close 语义。
- 桌面、全部随包插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.43，Android `versionCode` 更新为 10043；发布工作流默认目标提升到不可变 `v1.0.43`。

## 1.0.42（候选 Tag，未发布）

- `v1.0.42` 本地 1200 项门禁与 Ubuntu/iOS 云端门禁通过，但 Windows 同步/异步 short-path fixture 与 macOS 并发 Git worktree 竞态在托管 Runner 失败，未公开 Release、未提升 stable feed；该 Tag 保持不可变，修复随 v1.0.43 发布。

- 包含原 v1.0.41 候选中的女仆鲸结构化智能陪伴、代理团队项目任务/自动化/业务同步、Host-only 模型准入、壁纸视频生命周期回归与全云端发布链改造；v1.0.41 的不可变 Tag 因托管 Runner 跨平台门禁失败而保持未发布，不移动、不重建。
- 修复托管 macOS `/var`→`/private/var` realpath 与 Windows 临时目录别名/大小写导致的测试 fixture 误判，并修复 Linux LAN mTLS/E2EE 异步 delivery 竞态；仅校正测试环境归一化与等待方式，不放宽生产代码的路径 containment、mTLS、E2EE、listener isolation 或 ACK 门禁。
- 桌面、全部随包插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.42，Android `versionCode` 更新为 10042；发布工作流默认目标提升到不可变 `v1.0.42`。

## 1.0.41（候选 Tag，未发布）

- `v1.0.41` 在 GitHub 托管 Runner 的跨平台测试 fixture 门禁中失败，未公开 Release、未提升 stable feed；该 Tag 保持不可变，修复随 v1.0.42 发布。

- 女仆鲸加入结构化智能陪伴：根据任务开始、多任务、等待决定、受阻、完成和长时间运行给出低频情境提示；新增本地默契/每日进度/连续完成记录、克制/温柔/元气风格及主动陪伴开关，不读取对话正文、屏幕或文件。
- 代理团队工作台新增项目任务、项目自动化与业务同步能力：任务支持创建、领取、依赖、文件边界与加密完整性校验；自动化定义按任务状态变更编排并可人工批准运行；业务同步以 authority/collaborator 模式在受控成员间交换有界、可审计的消息；桌面 Git 能力只允许在显式授权的项目根目录内执行版本库操作。
- 新增 Host-only 模型准入插件 dsh-model-admission：模型请求进入有界公平准入与排队（8 个活跃槽、32 个全局等待、每个根至多 8 个、30 秒超时），饱和时明确拒绝而非无限堆积，不与官方 Provider/API 调度混淆。
- 壁纸库增加视频生命周期与 Range 流式播放回归测试，图片/视频预览继续使用受管文件；桌面会话生成停止后的自动跟随等运行时补丁与小修同步合入。
- 统一发布器改为真正的全云端打包：本机只执行源码/安全门禁并删除、拒绝 `dist`，Windows、macOS、Linux 正式包和组件健康/回滚验证全部在绑定不可变 Tag/提交的 GitHub Actions 中完成；旧状态强制重跑新门禁，断点 runId 绑定精确 workflow 身份，stable 提升前重新核对两云 18 项资产，GitHub→CNB 仍保持云到云与 stable-last。
- 桌面、全部随包插件、Android 与 iOS/iPadOS 候选源码曾同步到 1.0.41，Android `versionCode` 为 10041；该候选未公开发布。

## 1.0.40

- 女仆鲸加入结构化智能陪伴：根据任务开始、多任务、等待决定、受阻、完成和长时间运行给出低频情境提示；新增本地默契/每日进度/连续完成记录、克制/温柔/元气风格及主动陪伴开关，不读取对话正文、屏幕或文件。
- 将代理团队升级为原页面内的统一工作台，保留原有 Team Runtime、Broker、Memory、Scheduler 与多人接入能力，并加入所选团队任务板、可缩放自适应画布、流程视图、既有定时任务投影、参与者和协调 Inbox。
- 高任务量界面采用响应式列数、列内独立滚动与有界投影；画布支持 Fit、10%–200% 缩放、平移、键盘操作、自动换行和关系线限额，自动团队控制收紧为紧凑开关。
- Team worker 增加进程级公平准入、全局及单根等待上限、超时、取消和精确生命周期释放；压力测试覆盖 12/24 个根、250 项任务、SSE 合并与慢客户端背压，不把这一阶段描述为全桌面 Provider/API 调度池。
- 强化内嵌浏览器的用户/模型来源隔离、跨来源导航、防重放、停止与取消；文件选择、下载、弹窗及敏感动作继续强制显式授权。
- 修复主题预览滚动与说明裁切、系统模式标题栏按钮对比度；改进 Wallpaper Engine 当前壁纸识别、图片/视频预览、受管导入和背景可读性。
- DSH Plugin Marketplace 升级到上游 1.5.5，并保留单一可信注册所有权；`@deepseek-ai/cordis-plugin-group@1.0.1` 继续作为根生产依赖并由打包自检锁定。
- Linux CI 与 Release 在真实 Electron 浏览器导航安全测试前显式配置并复核 `chrome-sandbox` 的 `root:root`/`4755` 权限；配置失败即阻断，不使用 `--no-sandbox` 绕过。
- 对标 Codex 与 Claude Code 的小体验优化：壳层模态框约束并恢复键盘焦点，Computer Use 授权卡在小窗口保持操作可达且防止重新聚焦首击误授权；浏览器错误即时播报，文件/计划筛选和刷新保留阅读位置。
- 明确的“打开右侧浏览器”与 HTTP(S) 网址指令由随包客户端插件在本地消费并自动显示右栏，不调用 Browser Control；只跨 WebView 传递有限枚举或校验后的网址，插件升级漂移可诊断且快捷按钮始终保留。
- 改进生成停止后的自动跟随与会话菜单图标；桌面、全部随包插件、Android 与 iOS/iPadOS 同步到 1.0.40，Android `versionCode` 更新为 10040。

## 1.0.38

- 修复运行中的旧版 Harness Desktop 阻止覆盖安装并返回 Windows 错误码 5：Inno Setup 使用 `CloseApplications=force` 强制执行关闭契约，桌面进程收到 Windows Restart Manager 会话结束通知后进入真实退出路径、优雅停止运行时且不自动重启旧应用。
- 以缺陷修复和运行减负为主：修复启动注入、右侧浏览器反复开关、Git 浏览器授权重复弹码与不刷新，以及旧版客户端更新重定向/校验兼容问题；完整性签名与 SHA-256 门禁不降级。
- 重整设置、模型、会话菜单和“已安排的任务”等既有页面层级，修复搜索标签、顶栏、菜单和统计文字遮挡；账户额度、主/子模型字段持续可见，归档与已安排入口移入次要菜单。
- 新增持久化壁纸库页：用户导入的 Wallpaper Engine 或本地图片/视频复制到受管目录并卡片化，原程序或源文件关闭后仍可使用；双击从任意主题应用并返回主界面，自定义背景文字按对比度自动适配。
- 新用户的本地记忆默认开启，旧用户已经明确关闭的选择保持不变；记忆仍仅保存在本地，并保留查看、删除、敏感内容过滤和关闭入口。
- 修复代理团队本机/局域网/跨网络入口；成员可对可继续拆分的已领任务提交结构化扩员申请，由固定负责人重构为同级、可见、受容量与文件边界约束的任务和成员，不引入隐藏第三层或嵌套子代理。
- 发布流程继续断点续传并由 GitHub→CNB 云端镜像大文件，稳定源在真实下载、安装、更新和卸载验证后最后提升；macOS 无会员的显式无签名双架构包与 `安装.command` 助手流程完全不变。
- 桌面、全部随包内置插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.38；Android `versionCode` 更新为 10038。

## 1.0.35

- 修复桌面启动时 Computer Use 注入缺少 `systemPrompt` 能力导致的 Harness 启动失败，并让安装器在升级前关闭占用 DLL 的运行实例。
- 修复 Chromium 取消手动重定向导致的更新校验失败，保留旧客户端可读取的兼容清单和 SHA-256 校验；右侧浏览器工作区不再重复开关。
- 重整设置、模型和“已安排的任务”页面；恢复可见的账户额度与子模型选择，并把会话 ID 收入 Codex 风格会话菜单。
- 修复本机建队、局域网自动 mTLS 与跨网络邀请/批准流程；设备批准中的局域网凭据由 X25519 派生密钥和 AES-256-GCM 保护。
- 第二次 CNB stable 同步改为 metadata-only，避免重复下载和校验 18 项不可变资产；保持 v1.0.32 的 macOS 显式无签名契约和 `安装.command` 不变。
- 桌面、插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.35；Android `versionCode` 更新为 10035。

## 1.0.32

- 新增 Desktop 自有统一右侧工作区，将隔离浏览器、工作区文件、链接和有界文本/代码文档预览收敛为可返回、可调整宽度且响应式的单一侧栏。
- 将会话级定时任务升级为可搜索、带建议、活动/停用筛选和最近历史的“已安排”页面；所有创建、停用与重新创建仍只生成待用户确认的输入草稿。
- 新增长会话自动压缩插件：在模型返回 `CONTEXT_WINDOW_EXCEEDED` 后按工具调用完整边界压缩并有限重试；托管压缩 preset 无法建立时不再静默启动。
- 手机同步监听避开浏览器永久禁用端口；保持 v1.0.31 的 macOS 显式无签名契约、一键安装助手、双架构打包与云端自检流程不变。
- 桌面、插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.32；Android `versionCode` 更新为 10032。

## 1.0.31

- 完善桌面 Computer Use 应用策略、Windows 控制链路、确认状态和截图存储边界，并补齐对应自动化测试。
- 扩展本地记忆生命周期、候选审核、作用域与状态管理，同时完善 Agent Teams、浏览器侧栏和桌面插件交互。
- 保持 v1.0.30 的 macOS 显式无签名契约、一键安装助手、双架构打包与云端自检流程完全不变。
- 桌面、插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.31；Android `versionCode` 更新为 10031。

## 1.0.30

- 汇总近期已完成的功能修复与体验优化，覆盖会话与附件体验、项目入口、文件插件、主题与外观、壁纸库、模型路由及 Agent Teams 交互。
- 保持 v1.0.29 的 macOS 显式无签名契约、一键安装助手、双架构打包与云端自检流程完全不变。
- 桌面、插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.30；Android `versionCode` 更新为 10030。

## 1.0.29

- 官方 DeepSeek Harness 运行时闭包从 `0.1.0-rc.8` 原子升级到 `0.1.1-rc.2`：采用官方视觉模型、Files API 图片上传复用与自动预处理、Bubblewrap PID namespace 安全修复和子代理谱系导航；桌面缓存明细投影迁移到新的 state/wire 契约，并在官方谱系能力存在时停止覆盖子代理页头。
- 新增 MCP 管理器，复用官方 `@deepseek-ai/dsh-mcp-client` 的 stdio 与 Streamable HTTP；只保存凭据引用，限制命令、URL 与危险请求头，并在启停本地进程前由用户确认。
- 启用官方 `@deepseek-ai/dsh-schedule`，新增当前会话定时任务视图、精确任务 ID、下次运行与逾期状态；明确不唤醒系统、恢复会话后再补投递且循环最短 300 秒。
- 新增工作区文件视图：用户主动上传到 `uploads/`、有界下载普通文件、路径/realpath/symlink 越界防护；编辑只准备官方 `read` / `edit` 请求草稿，不自动发送或绕过文件策略。
- 新增自适应进度策略与无障碍状态 Dock，按 Todo、Goal、工具状态、里程碑、失败和阻塞等语义事件汇报，不采用固定步数、工具数或时间间隔。
- 异地组网的 mesh、network 与 tunnel 秘密改为 Electron `safeStorage` 版本化密文；旧明文原子迁移，OS 加密不可用或密文损坏时 fail closed；WSS 与移动端服务地址统一为 `10.253.77.254`，公网 WSS 中继仍默认未配置。
- Codex Chronicle、Claude auto memory 与 Hermes persistent memory 调研结论均属于持久记忆/指令上下文而非模型权重自训练；因此不新增“自我训练”，只保留明确 opt-in、敏感内容过滤、可查看/删除的本地记忆，并将旧 schema 安全迁移为关闭。
- 浏览器工作区补齐受控链接路由、历史记录、站点授权、诊断和模型工具；高风险操作继续逐次确认，凭据、验证码、支付与银行内容保持禁止自动输入。
- Agent Teams 新增活跃排序、历史折叠、无重叠实时画布、自动必要性门禁、静默 Inbox、暂停 epoch 和跨重启冷却；原始会话、成员、用户与设备 ID 不进入公开投影。
- 新增项目级 Ed25519 RBAC、X25519 E2EE、LAN mTLS/WSS 适配器、独立 bare Git Authority、隔离 worktree、远程 bundle/CAS 精确准入、Workspace 落地日志与崩溃恢复；电脑 A 的源工作树始终不是共享可写 Authority。
- 新增持久 Runner 编排、签名 TestAttestation/Gate、加密 Defect 生命周期，以及 GitHub/GitLab/Jira 凭据零持久化 Outbox；Stop 后任务与外部投递保持休眠，只有显式 resume 才恢复。
- 内置受信 MinGit 组件和发布包资源审计；桌面、Android 与 iOS/iPadOS 源码同步到 1.0.29，Electron 固定为 43.2.0。

## 1.0.28

- 代理团队迁移到官方 `conversation.view`，与“对话 / 轨迹”并列；删除旧 Modal、顶栏符号和输入 Dock，保留官方输入框与会话基础设施。
- 新增“启用自动团队”：开关本身不发消息，从下一条普通需求起由 AI 判断；无目标不产生请求，简单任务由主模型负责人 solo。“自定义团队”和三种方向模板保留为可选草稿入口。
- 无活动团队且只有一个独立的一次性辅助时，使用官方普通 `subagent`；至少两个需委派给不同成员的持续独立工作流且需要依赖、交接、文件边界或汇总协调时才建团队。正式成员是可见、持久责任主体，硬性禁止调用 `subagent`、`subagent_fork`、`workflow` 或 `ralph`；扩员只能由 root 创建，以免绕过 `maxMembers` / `maxActiveTurns`、冲突检查和关停。
- AI 自动规划必要团队和增员，成员使用“界面、测试、安全、文档”等 2–6 字直白职责名，不要求用户设计成员；成员/任务/协作事件工作区保持中文、响应式与无障碍。
- 团队模型复用现有主模型/子代理路由：固定负责人始终主模型；普通成员任务默认子代理模型，高复杂推理、架构、安全关键或失败升级才由 AI 选择主模型；无独立子模型时继承主模型，不增加重复设置 UI。
- 新增“添加协作团队”快捷提示：AI 按项目目标、现有分工和成本决定是否新增同级团队；现有团队足够则不创建，否则自动规划目标、成员、主/子模型、跨团队依赖和负责人中继。
- 创建请求只在用户真实发送并成功消费草稿后自动返回“对话”；官方 view owner 仅最小透传既有 `actions.setView`，补丁保持精确锚点、幂等和可回退。
- 自动判断不改变安全限额：同一 root 由 `HARD_MAX_TEAMS_PER_ROOT = 8` 限制未关闭平级团队，第 9 个以 `AGENT_TEAMS_TEAM_LIMIT` 拒绝；每队分别受 `maxMembers`，所有团队共同受 `maxActiveTurns`，合计超限为 `AGENT_TEAMS_ACTIVE_TURN_LIMIT`。团队总览/切换、跨团队任务阻塞和负责人鉴权中继保持可见；跨 root 与嵌套团队禁止。
- 成员卡片显示当前任务和最后活动，“查看实时工作”复用官方成员会话和轨迹；普通协调回报在主聊天降为可折叠事件通知。
- 成员显示名按 NFKC、空白和大小写归一化后全团队唯一；Web 投影不包含团队消息正文，对无法证明安全的非空文件范围返回隐藏原因。
- 保留直接用户根权限、每团队固定负责人、持久成员、原子任务认领、依赖/冲突、跨团队无环校验、同根合计并发硬限制、优雅/强制关闭和孤儿恢复。
- 新增代理团队中文用户指南，覆盖首次使用、实时查看、文件冲突、成本、失败替换、关闭与恢复。
- 桌面更新在当前版本已是最新时改为幂等成功状态，不再显示“更新失败”；重新检查成功后同时清除旧错误提示。
- 桌面、Android 与 iOS/iPadOS 源码同步到 1.0.28；官方 Harness 继续固定为 `0.1.0-rc.8`，Electron 固定为 43.2.0。

## 1.0.27

- 官方 DeepSeek Harness 固定升级到 `0.1.0-rc.8`；原生采用图文 `/goal`/`/plan`、文件与会话 `@` 引用、Claude Code/Codex Profile Bundle、持久 PowerShell、并发 `web_search` 和子代理及时回报。
- 删除桌面壳旧的非图片附件路径注入、附件检查 IPC、历史图片降级和载荷改写；文件、会话、图片及模型模态能力统一交给官方运行时。
- 修复部分 Windows/高 DPI 机器从最大化状态拖动顶部空白区时窗口尺寸异常：拖动前固定读取正常恢复边界，不再依赖异步 `unmaximize()` 后的瞬时尺寸。
- 修复 rc.8 设置弹窗被极光模式限制在侧栏、界面模式首页效果不明显及应用后不关闭设置的问题；顶栏浏览器入口自动收紧，Agent Teams 中文界面统一为“代理团队”。
- 桌面启动官方 Web Runtime 时固定使用 `--no-open`，不再额外打开无桌面扩展的浏览器页；七天过期缓存除启动维护外，每 24 小时重复安全维护一次。
- 发布入口更新为 1.0.27 的不可变 Tag、draft 远端复核、正式 Android 签名和 Ed25519 组件工作流；本地编排继续绑定同一干净提交。
- Windows、macOS、Android 与 iOS/iPadOS 源码同步到 1.0.27；完整安装包仍是原生模块、Bootstrap 和不兼容存储变化的兜底。

## 1.0.26

- 修复 Electron 退出时浏览器 `webContents` 已释放导致的 JavaScript 错误，并补强所有 BrowserView 生命周期竞态。
- 链接右键菜单明确提供“复制链接地址”；窗口拖动捕获不再阻断灰色选区清除，Esc 可取消选区。
- 锁定桌面工作台外层视口，防止输入框和对话框随整个页面向上滚动；移动端继续允许正常纵向滚动。
- Codex 额度改为使用 Harness 已登录 OAuth 直接查询官方 WHAM，用客户端 CLI 作为无凭据时的后备；不返回令牌、账户 ID 或个人信息。
- 整合 Agent Teams 实验插件、Browser/Computer Use 重置竞态、截图会话清理、界面模式和完整删除控制。
- 子代理目录分离“当前 / 历史 / 全部”：运行中与可继续会话保持前台，结束的一次性任务只保留完整记录，不误显示为仍在工作。
- 本地记忆与应用缓存改为类似 Codex 的低干扰后台使用：仅保存稳定偏好和项目约束，敏感内容硬过滤；入口移到托盘“数据与隐私”，保留预览、关闭、单项/全部删除。
- 首次公开启用 Ed25519 签名生产组件更新：CNB 优先、GitHub 后备、逐目标清单、健康确认、自动回滚和完整安装包兜底。
- `dsh-progress-reporter` 保持社区市场按需安装，不随 Harness Desktop 默认安装或打包。
- 发布编排绑定干净 Git 提交并级联重置下游阶段；GitHub 桌面/APK 资产禁止同名覆盖，Android 使用独立不可变校验文件。
- 桌面、Android 与 iOS/iPadOS 源码同步到 1.0.26；Android 延续长期 release 证书，iPhone/iPad 在无 Apple Developer 会员时继续 Safari 工作台。

## 1.0.25

- 自定义壁纸新增 GIF、APNG 与动态 WebP，单文件上限 50 MB；前景完整显示并以同图模糊填充空白区域。
- 面板通透上限提高到 92%，新增“文字保护”可读性控制，并保持全部内置主题原有表现。
- 文字选择重新可见；点击非输入区域、按 Esc 或使用右键“取消选择”均可清除选区。
- 签名组件增量更新完成真实隔离包验证：健康版本激活成功，损坏版本自动回滚到上一健康组件。
- 修复 macOS Intel/Apple Silicon 包遗漏 `node-pty` 原生运行模块的问题；双架构均完成打包后真实自检。
- Android 与 iOS/iPadOS 源码同步到 1.0.25；正式移动分发继续要求 Android 长期 release 密钥及 Apple App Store/TestFlight 账户与证书。
- GitHub 与 CNB 同步提供 Windows、macOS Intel、macOS Apple Silicon 桌面制品及 SHA-256 校验。

## 1.0.24

- 新增 Codex 风格右栏浏览器、可见地址栏、独立持久化 Profile、用户登录入口与站点数据清理；与官方 Harness 会话完全隔离。
- 新增按站点、按动作授权的浏览器模型工具；密码、Cookie、令牌、验证码、支付和银行内容永久禁止，提交类操作逐次确认。
- 新增默认关闭的本地 SQLite 跨会话记忆、有限召回工具、敏感内容拒绝/脱敏、搜索、导出与删除管理。
- 新增仅限 Harness Desktop 窗口的受限 Computer Use，截图、逐次输入确认、一键停止与用户接管均纳入安全门禁。
- 工作区选择改为由主窗口拥有的原生目录窗口，解决窗口难以唤起或隐藏到后台的问题。
- 存储管理改为扫描、预览、确认后清理；永久保护会话、附件、记忆、当前运行时与活动临时文件。
- 桌宠 280 帧改为八个无损 WebP 图集并按需加载；新增 Windows 制品、语言包、运行资源和仓库源素材体积门禁。
- 新增 Ed25519 签名组件更新、逐文件校验、独立助手、原子切换、健康确认、自动回滚和完整安装包兜底。
- 完善 macOS Intel/Apple Silicon 运行时、原生依赖、进程、托盘和更新打包，并新增原生 iPhone/iPad 客户端、局域网优先与加密 WSS/443 后备线路。
- 手机下载与独立更新按平台分流：Android 校验 APK 哈希、包名和签名后交由系统确认安装；iOS/iPadOS 只使用 App Store/TestFlight。
- Android 应用版本仍为 1.0.20；本次本地发布打包生成 Windows 1.0.24 安装版和便携版，移动端与 Apple 正式制品仍需各平台签名配置。

## 1.0.23

- 允许包含历史图片的会话切换到仅支持文本输入的模型，无需删除或重建原会话。
- 请求组装时仅把历史图片转换为明确的文字占位，包含在工具结果中的嵌套图片同样安全处理，原始会话记录保持不变。
- 当前待发送的新图片仍会阻止切换到纯文本模型，避免用户刚添加的图片被静默丢弃；支持图片的模型继续接收原始图片。
- 运行时补丁保持幂等，并在官方运行时结构变化时明确失败，避免错误替换。
- CNB 发布固定改为云端从 GitHub 镜像，并由官方 `cnbcool/attachments` 插件上传，不再通过本机传输大文件。

## 1.0.22

- 修复自定义皮肤给侧栏添加 `backdrop-filter` 后形成定位容器，导致设置页被限制并挤压在左侧栏内的问题。
- 自定义侧栏改为与内置皮肤一致的透明表面，不再强制增加分隔边框，同时保留输入框和对话框的玻璃模糊效果。
- 自定义主题编辑器改用容器宽度响应式布局，设置内容区较窄时自动上下排列，避免“壁纸质感”控件越界。
- 两项界面修复均经过源码窗口人工验证；Android APP 继续沿用 1.0.20 测试版。

## 1.0.21

- 在现有“外观皮肤”中新增壁纸明暗、模糊、面板通透和边框清晰调节，不增加重复设置入口。
- 壁纸使用独立背景层渲染，调节效果不会模糊文字、代码和操作控件。
- 玻璃和边框效果只作用于自定义主题，保持全部内置皮肤原有视觉表现。
- 新增移除壁纸、旧格式文件清理、参数边界校验和自定义壁纸禁用长期缓存。
- Windows 桌面安装版和便携版同步发布到 GitHub 与 CNB；Android APP 继续沿用 1.0.20 测试版。

## 1.0.20

- 在现有 Harness Mobile 中新增用户明确授权的手机控制：节点摘要、点击、长按、滑动、返回/主页/最近任务、非密码文本输入、打开应用/链接/设置、单次截图和系统文件选择器。
- 新增控制协议版本与能力协商、命令 ID、结果回执、取消、超时、有限重试，以及桌面端和手机通知中的“立即停止”。
- 手机设置页新增权限向导和总开关；输入文字、保存文件、清理缓存必须在手机端再次确认，密码、支付、银行、验证码、账户安全、清除数据、安装/卸载和任意脚本始终拒绝。
- 新增 Provider 用量适配、安装目录内独立 `HarnessData` 工作区，以及更广泛的本地文档和图像附件支持。
- 正式启用 CNB 国内更新源并保留 GitHub 后备源；所有来源继续强制校验文件大小与 SHA-256。
- 保留原二维码下载、APP 内扫码配对、会话同步、实时刷新、官方设置结构和安装数据；覆盖升级不会清除现有配对。

## 1.0.19

- 升级内置官方 DeepSeek Harness 至 0.1.0-rc.7，并保持所有桌面运行时依赖精确锁定。
- 核心版本查询优先使用 npmmirror，失败后自动回退 npm 官方 Registry 和官方 GitHub manifest。
- 桌面更新清单及发布资产支持多地址优先级与自动换源，国内镜像可以通过 `mirror_urls` 排在 GitHub 前面。
- 设置页明确区分可安装的桌面更新与等待兼容发布的官方核心更新，避免出现“发现新版但没有更新按钮”的误导状态。
- 增加国内镜像清单生成工具，并继续对所有安装来源强制执行大小和 SHA-256 校验。
- Electron 与 electron-builder 的公开构建组件改由 npmmirror 获取，无代理的国内开发机也可以完成打包。

## 1.0.18

- 手机同步二维码改为双用途入口：相机、微信或浏览器扫码会下载 Android APK，Harness Mobile 内扫码会直接连接电脑。
- 普通浏览器打开下载地址不会消耗一次性配对码；安装完成后仍可返回桌面端，用 APP 扫描同一二维码完成配对。
- 桌面设置页增加首次安装与已安装两种操作提示，明确说明下载、安装和连接步骤。
- 手动复制地址同步升级为双用途地址，并继续保留局域网与远程线路的完整配对信息。

## 1.0.17

- 新增 Android 手机端测试版，通过桌面设置中的同一入口完成扫码下载、设备配对和连接管理。
- 支持局域网优先、远程连接回退、已信任设备自动重连和手动开关；配对状态与用户配置保存在用户目录。
- 手机端适配安全区域、系统返回手势、设置页、历史会话、插件市场和外观皮肤。
- 修复手机端首次进入白屏、后台恢复缓慢、会话点击无响应、历史加载失败及上下滑动误触刷新的问题。
- 插件市场提供实时列表、中文摘要、英文原文与安装状态。
- 构建流程支持本地生成 Windows 安装版、便携 ZIP 和 Android APK，并统一产物校验与密钥扫描。

## 1.0.16

- 修复首次启动或重复启动时，两个运行时准备流程争用同一缓存目录并触发 `EPERM rename`，导致 Harness 无法启动的问题。
- 同一进程只展开一次运行时；多个进程同时启动时会复用先完成的有效缓存，并对安全软件造成的短暂文件占用自动重试。

## 1.0.15

- 升级程序会把当前桌面程序所在目录写给安装器，更新时不再因卸载登记缺失而跳回 C 盘。
- 安装器永久记录上一次安装位置，并按“升级提示、上次位置、当前 Inno、历史 NSIS”的顺序恢复目录。
- 手动下载仍可自由浏览新目录；目录提示只影响默认值，不限制用户修改。
- 安装器不再尝试关闭腾讯电脑管家等无关安全进程；应用内更新会先快速退出桌面程序，再由安装器替换文件。

## 1.0.14

- 修复 1.0.13 Windows 中文安装版启动即提示“安装文件已损坏”的问题。
- Inno Setup 改为使用真实磁盘路径编译，避免临时盘符在大 ASAR 构建中生成被截断的安装数据区。
- 本次发布已完成本机真实安装、安装后运行时启动和卸载检查。

## 1.0.13

- 窗口拖动改为动态空白区域命中：顶部和正文空白处均可拖动，交互控件与文字会自动避让。
- 子代理入口恢复全行点击，并可进入官方实时子会话详情页。
- 缓存显示区分最近一步、热请求、前缀复用、累计冷启动和提供方未报告状态。
- 修复跟随主模型时删除桌面路由兼容预设，导致历史桌面会话无法恢复的问题；用户自建预设保持原样。
- 未变化的模型路由不再在每次启动时重复生成和写入。
- 官方工作区本机路径支持打开、复制和定位；顶部桌宠卡片支持点击外部自动收起。
- Harness JavaScript 运行时收进应用主包，减少安装阶段释放的小文件数量。

## 1.0.12

- 子代理下拉窗口改为自适应宽版布局，最多使用 680 像素并保留视口边距；长任务名、工作区和 TOK 信息不再挤成窄列。
- 子代理列表根据官方运行状态圆点增加三段动态指示器，运行中的代理可以在列表中直接识别，并自动遵循系统“减少动画”设置。
- 启动检查发现桌面新版时主动弹出应用内更新提醒，直接展示本次更新内容，并支持立即后台下载、查看发布页或稍后提醒；设置页也同步显示更新说明。
- DSH 插件市场与通用 Skills 为英文简介自动生成中文摘要，保留可展开的英文原文；增强只应用于桌面版管理的市场副本，不覆盖用户自行升级的更新版本。

## 1.0.11

- 修复桌面宠物台词被透明窗口形状裁成一条横线的问题；台词改为无边框、无底色的清晰悬浮文字。
- 按动画真实可见像素收紧宠物命中范围，台词与右键菜单仅在显示时加入各自的小区域，不再让整块透明窗口拦截鼠标。
- 修复加入桌面宠物入口后，Windows 无边框窗口的可拖动区域被意外缩窄为仅 24 像素，且仍使用旧版拖拽样式声明，导致窗口无法正常拖动的问题。
- 按 Electron 43 的窗口交互规范恢复 36 像素高的完整标题栏拖动区域，同时保留女仆鲸、皮肤入口和原生窗口控制按钮的独立点击区域。
- 增加标题栏命中区域回归测试，防止后续快捷按钮再次挤占窗口拖动区域。

## 1.0.8

- 修复选择已有项目文件夹时报错“win32 folder dialog worker exited before reporting a result”：Windows 桌面包改用系统文件夹选择框，绕开官方 Koffi/COM 对话框子进程的原生崩溃。
- 精简安装包内不参与运行的源码映射、类型声明、测试和示例文件；官方运行时仍保留实体依赖目录，兼容项目、插件、Skill 和子代理的模块链接。

## 1.0.7
- 修复 Electron/Node 24 在 Windows 上直接启动 `npm.cmd` 返回 `spawn EINVAL` 的问题；已用 `dsh-at-file` 完成真实依赖安装、注册及重启加载测试，并用 `anthropics/skills` 完成 18 个 Skills 的真实安装测试。
- 修复全新安装时内置 DSH 插件市场从 `app.asar` 虚拟目录复制失败的问题；现在会从真实的 `app.asar.unpacked` 目录安装到用户 DSH profile。
- 将桌面插件市场加入打包自检和产物审计，发布包必须能在空白用户目录完成安装、注册客户端并启动官方 Web 工作台。
- 补齐主题对最新版官方按钮、选中项、浮层和侧栏导航色彩变量的覆盖，避免青瓷云雾等亮色皮肤叠加官方深色偏好后出现黑色块。
- 插件市场仍保存在用户目录；桌面版或官方 Harness 更新不会覆盖用户自行更新的市场与插件。

## 1.0.6

- 完整固定官方 Harness Web 运行时实际使用、但上游仅声明为 peer dependency 的 18 个 DSH 模块，修复依次出现的 `dsh-scope` 等启动缺包问题。
- 将运行时模块放入真实的 `app.asar.unpacked` 目录并从该目录启动，保证官方 DSH 在 Windows 用户目录创建的 profile 模块链接可用，不再指向不可链接的 ASAR 虚拟目录。
- 按官方 Web profile 要求启用 Node 内部模块钩子，修复 HMR 服务启动条件缺失。
- 发布自检从执行命令行帮助升级为启动隔离的真实 Web 服务并探测本地端口；运行时没有真正就绪时禁止发布。
- 1.0.4 与 1.0.5 已标记为预发布，避免稳定通道继续安装不完整包。

## 1.0.5

- 修复 1.0.4 安装包启动时缺少 `@deepseek-ai/cordis-plugin-group` 的问题：将官方启动模块实际导入的 peer dependency 固定为桌面端直接依赖，避免打包器裁剪。
- 打包自检现在会真实加载内置 DSH 命令行依赖图，并检查 `app.asar` 中的关键运行时文件；缺少依赖时禁止发布。

## 1.0.4

- 修复主题层在左侧栏展开或收起时反复扫描整页并强制计算布局造成的窗口卡顿；页面变化与窗口缩放现在合并刷新。
- 修复桌面端误连机器上其他 Harness Web 服务，导致安装包内的新会话修复未生效：桌面端默认使用自身固定版本并监听随机空闲端口。
- 顶部“新会话”和项目行“+”统一立即清空旧工作区、创建独立会话并切换到目标项目；创建失败时恢复原会话。
- 增加双项目真实回归：项目 A、项目 B 可分别连续创建会话，全局入口保持当前项目归属。

## 1.0.3

- 修复项目行“+”复用已有空白会话而看似无响应：项目内快捷入口现在强制创建独立会话，顶部官方“新会话”行为保持不变。
- 消除桌面壳对主模型的重复持久化：官方 `settings.yaml` 是主模型唯一真相，桌面路由文件只保存子代理扩展，并自动迁移旧格式。
- 模型路由改为原子写入并在投影失败时回滚，避免桌面子代理状态与官方设置分叉。
- DSH 子进程启用 Node 24 原生代理支持：兼容环境变量、Windows 系统代理以及无代理直连，不再需要注入自定义网络脚本或强制开启 TUN。
- 官方 Session log 入口移至原生窗口按钮下方，避免占用会话标题区。

## 1.0.2

- 修复安装包内保存独立子代理模型时的 ENOENT：不再用 Node `fs.cp` 直接复制 ASAR 虚拟目录。
- 改为逐文件复制官方 Agent 预设，完整保留 `cordis` 的嵌套 Skills；主模型与继承主模型逻辑不受影响。
- 增加 `cordis + 子代理单独指定模型` 回归测试。

## 1.0.1

- 修复右上角官方会话日志入口、桌面皮肤按钮与 Windows 窗口控制按钮堆叠的问题。
- 官方顶部操作会自动避让桌面壳控制区，并在窗口尺寸变化后重新计算位置。
- 增加发布前回归检查，防止后续官方界面更新再次引入顶部控件重叠。

## 1.0.0

- 修复“立即安装”关闭桌面端后没有拉起安装向导：不再依赖隐藏 PowerShell 接力，改由 Windows 原生方式直接打开已经完成 SHA-256 校验的安装包。
- 只有 Windows 确认安装程序已经成功启动后才退出旧版；启动失败会保留当前程序并显示具体错误。
- 青瓷云雾作为稳定版默认皮肤，动态模型目录、主模型与子代理路由、傻瓜式插件与 Skills 安装进入首个稳定版本。

## 0.9.0-rc.9

- 主模型与子代理从官方随包目录动态识别服务商的全部模型；OpenCode GO 从仅显示默认模型修复为显示完整 16 个模型，并保留用户自定义模型。
- 模型设置新增“刷新模型”，每次打开模型页自动重新读取；切换到插件市场或其他设置页时立即卸载模型路由面板，修复跨页面叠加。
- 内置插件市场升级至 1.2.1：Skill 仓库可自动识别并安装任意子目录中的多个 `SKILL.md`，普通 Skill 不再索要 API Key 或“提交材料”。
- 插件与 Skill 安装改为固定居中的实时进度窗口，不再让卡片消失或把页面滚到顶部；完成后明确显示安装结果。
- 青瓷云雾成为首次安装和旧默认外观的默认皮肤；用户主动选择的其他皮肤保持不变。

## 0.9.0-rc.8

- 下载并校验完成后改用随主题变化的应用内确认页，不再弹出 Windows 系统消息框。
- 点击“立即安装”后先安全退出桌面端，再打开可见的纯中文安装向导，不再静默安装后无反馈。
- 安装包兼容旧版更新器传入的静默参数，从 rc.7 升级时也会自动转为可见中文向导。
- 安装完成页保留“运行 Harness Desktop”选项，方便用户立即回到新版本。

## 0.9.0-rc.7

- 在官方设置内加入实时 DSH 插件市场，可浏览、安装、识别和更新社区插件；市场本体与用户插件保存在用户 DSH 目录，桌面版或官方核心升级不会覆盖用户更新。
- 主模型与子代理改为直接选择式界面：子代理可在“跟随主模型”和“单独指定”间切换，并可从同一入口调用官方添加模型功能。
- 顶栏皮肤入口改为与官方窗口按钮一致的轻量图标样式；独立皮肤面板继承当前主题颜色。
- 更新安装改为先关闭桌面端及其本地 Harness 进程，再由后台交接程序启动安装器，避免要求用户手动关闭旧版。
- 保持系统代理、PAC 与无代理直连兼容，更新包继续在后台下载并执行 SHA-256 校验。

## 0.9.0-rc.6

- 在官方“模型”设置中加入主模型与子代理路由：主模型和子代理可分别选择服务商与模型；未配置子代理时默认跟随主模型。
- 独立子代理路由保存到用户目录，并从最新版官方 Agent 预设自动生成桌面管理预设，官方 Harness 更新不会覆盖用户配置。
- 桌面更新检查改用仓库内轻量发布清单，避开 GitHub Releases API 的匿名限流和 HTTP 403。
- 桌面壳顶部新增独立“皮肤”快捷入口，只弹出皮肤选择窗；双击应用后自动关闭并立即展示主题效果。

## 0.9.0-rc.5

- 修复重启后主题变量被官方嵌套配色层覆盖，导致背景、侧栏和文字颜色不一致的问题。
- 主题恢复改为幂等注入，避免主题样式自身触发 DOM 监听并反复重建。
- 更新检查与安装包下载改用 Electron 系统网络通道：自动适配系统代理、PAC 或无代理直连，不写死代理地址。
- 更新包在主进程后台下载并校验，关闭设置页不会中断；下载完成后使用桌面原生弹窗询问是否立即安装。

## 0.9.0-rc.4

- 修复 Windows 无边框窗口顶部拖动区域过窄，导致桌面端几乎无法从屏幕中央拖动的问题。
- 将拖动区域恢复为与系统标题栏一致的 36 像素高度，同时避开最小化、最大化和关闭按钮。
- 增加窗口拖动区域的发布前防回归检查。

## 0.9.0-rc.3

- 在 DeepSeek Harness 官方设置中新增“外观皮肤”，不增加第二套工作台或独立桌面设置。
- 内置官方外观、Deep Ocean、Catppuccin、Nord、Dracula、Gruvbox、Solarized、Tokyo Night、Rosé Pine 等配色。
- 加入 Deep Whale 女仆工坊皮肤，并保留 CC BY-NC-SA 4.0 非商业许可、来源和完整署名链。
- 新增自定义主题，可设置明暗模式、强调色、界面底色、文字颜色和本地背景图。
- 主题卡片改为双击立即应用；真实鼠标第二次点击与标准 `dblclick` 均可触发，选择会持久化。
- 修复会话日志入口与 Windows 窗口按钮区域重叠的问题。
- 修复官方“通用设置 → 打开配置文件”在桌面壳中无响应的问题。

## 0.9.0-rc.2

- 直接使用 DeepSeek Harness 官方 Web UI 作为唯一工作台，删除重复的原生会话、项目和聊天界面。
- 启动时自动拉起官方 Web 核心，不再显示首次启动引导或阻止进入工作台。
- 删除顶部黑色桌面栏和独立桌面设置，模型、权限、插件全部使用官方设置。
- 将桌面版与 Harness 官方核心的自动更新检查嵌入官方“设置 → 通用设置”。
- 修复 Windows 进程启动，固定 electron-builder 26.15.7 与 cross-spawn 7.0.6，并用纯简体中文 Inno Setup 替换会在部分机器上被拦截的 NSIS 安装外壳。
- 新增 Windows 安装落盘冒烟检查，并继续保留 packaged self-test 与发布秘密扫描。
- 删除旧原生工作台的 AgentBridge、Session、Provider、Terminal、Git、Workspace、MCP、Plugin、Skill、诊断后台及对应测试。
- 移除桌面壳对 `node-pty` 的直接依赖、SDK client 和真实 Provider 脚本；仅保留官方 Harness 核心自身所需的 native rebuild/ASAR unpack。
- 安装版、便携版、程序文件、快捷方式和卸载列表统一使用官方 DeepSeek 鲸鱼图标，并由发布验证锁定。

## 0.9.0-rc.1

- 新增安装包级 `--self-test` 模式：不创建 GUI，直接验证 Renderer、bundled Harness、userData、Headless Bridge 与 Web Compatibility。
- GitHub Actions Windows 构建在发布前会真实启动 `win-unpacked` 桌面程序执行 self-test；失败则阻断 Release。
- self-test 支持输出脱敏 JSON 报告，不读取项目文件、不输出 API Key。
- 新增 packaged self-test 单元测试与 release contract 校验。
- 新增 Windows RC1 最短人工验收清单，明确自动化与必须实机验证的边界。
- Release workflow 降低默认权限，并增加并发控制与超时。

## 0.8.0

- 新增首次启动向导：环境、模型、工作区完成后进入工作台。
- 新增 DiagnosticsService：检查 Node/Harness/userData/safeStorage/Provider/Workspace/Git/pnpm/Web Runtime。
- 新增脱敏诊断 JSON 导出与 Web Runtime 一键恢复。
- 新增 AppStateStore，持久化 onboarding 完成状态和更新检查偏好。
- 新增 UpdateService，分离 Harness Desktop 与 DeepSeek Harness Core 更新检查；核心不静默自动升级。
- Electron 升级并固定到 43.2.0，使用 Node 24.x 运行时以满足当前 Harness engine 要求。
- Windows NSIS 改为安装向导并允许选择安装目录，保留 portable。
- GitHub Actions tag 构建在三平台全部审计通过后自动创建 GitHub Release，并生成统一 SHA256SUMS.txt。
- smoke tests 扩展至 38 项。

## 0.7.0

- 新增 MCP / Skills / Harness Plugins 原生扩展中心。
- MCP 支持 stdio 与 Streamable HTTP，并以临时 Cordis `--patch` 注入官方 `dsh-mcp-client`。
- MCP 敏感配置优先使用 Electron safeStorage；不可用时不明文落盘。
- Skill 管理遵循 Harness 官方本地发现优先级，`.agents` 兼容来源只读。
- Plugin 管理委托官方 `dsh plugin --profile`，支持 headless / web Profile。
- 增加 Electron 导航/弹窗安全硬化与发布审计脚本。
- 新增 MCP、Skill、Plugin smoke tests。

## 0.6.0

- TerminalManager 新增 `node-pty@1.1.0` 后端、PTY resize、Ctrl+C 中断与 pipe fallback。
- Workspace 新增文件/文件夹创建、重命名和系统回收站/废纸篓删除入口。
- 修正 mutation path 的 symlink 语义：重命名/删除针对 symlink 条目本身，不误操作其真实目标。
- Git Diff 新增结构化 hunk 解析。
- 新增 hunk 级 Stage、Unstage、Discard，并通过当前 patch hash 防止旧 Diff 误应用。
- 新增“计划”Pane，按 Session 持久化展示 Plan、Subagent、Tool、Permission 与状态时间线。
- Preload / IPC 扩展 Workspace mutation、Terminal capability/resize、Git hunk API。
- Release 构建启用 native dependency rebuild。
- smoke tests 扩展至 20 项。

## 0.5.0

- 新增原生项目文件树与按需目录展开。
- 新增 2 MiB 内 UTF-8 文件预览/编辑、原子保存和 mtime 冲突保护。
- 新增工作区路径穿越与 symlink 边界防护。
- 新增真实本地 Shell TerminalManager 与独立 Agent 日志视图。
- Git Review 新增暂存、取消暂存、撤销 tracked 修改；未跟踪文件拒绝自动删除。
- SDK 事件标准化扩展到 `tool/call`、`tool/result`、Plan/Todo、Subagent 与 Permission。
- 新增 Tool/Plan/Subagent/Permission 原生事件卡片。
- 新增仅 localhost / 127.0.0.1 的开发服务器内嵌预览。
- smoke tests 扩展到 16 项。

## 0.4.0

- 新增 OpenCode Go Provider 预设。
- 新增 DeepSeek V4 Flash / Pro 模型选择。
- 新增 Electron safeStorage 密钥持久化；不可用时仅内存保存。
- 新增真实 Provider smoke 脚本。

## 0.3.0

- 原生 Session、Headless AgentBridge、Git Diff、Terminal 日志。
- SDK JSON-RPC 适配入口。
- 官方 Web UI 兼容模式。
