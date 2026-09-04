# Harness Desktop 1.0.59

v1.0.59 候选将官方 Harness 完整依赖图升级到 `0.1.2-alpha.5`，并集中解决长时间、多团队、多设备运行中已经复现的可靠性与性能问题：Agent Teams 的全局自动接力、计划重提交、admission/recovery/retirement、实时状态和 Unicode 工作区边界得到收敛；长会话滚动、手机编辑器与导航恢复当前官方合同；Mobile Sync、Schedule、设备预览、缓存维护和团队投影改为可回滚、可验证的增量路径。

上一稳定版是不可变的 `v1.0.58`。其 Tag、Release 资产、签名 Android APK、组件、`release-manifest.json`、镜像与 stable feeds 均不移动、不覆盖。本文件描述 `v1.0.59` 候选源码与发布要求，不代表新版本已经公开、已经签名或已经进入 stable feed。

## 官方 Harness `0.1.2-alpha.5`

- 根依赖与完整 required/optional DSH 闭包来自官方 npm 注册表，并精确固定到 `0.1.2-alpha.5`；lockfile、Desktop 自有插件 peerDependencies、运行时补丁、精确哈希与语义锚点同步更新，漂移继续 fail closed。
- Desktop 适配 alpha.5 的 branded session sequence、事件所有权、projector/node-store、Host follow-up queue、Schedule catalog、Remote stream 与受限 lifecycle/activation seam；官方 Schedule 与 Desktop `dsh-desktop-schedules` 同时注册、互不冒充或覆盖，既有 session append-only events 不改写。历史 alpha.2–alpha.4 分支只作为兼容审计基线保留。
- 官方 experimental Team 不接管或双写 Desktop 的 Project/Team、canonical-project 隔离、submission acceptance ledger、routing receipts、locks、recovery、cursors、evidence 与 external-effect 状态。
- 独立官方集成 `@zseven-w/dsh-android` 继续使用自身 `0.1.0-rc.4`，不跟随 Desktop 产品版本号。

## Agent Teams：安全自动接力与生命周期收敛

- “自动接力”由版本化 Desktop Host 设置证明全局持久化；直接用户建队、计划提交和两阶段 Resume 只在 root、canonical project、Goal、team、pause epoch、plan/settings hash 与 authorization epoch 全部一致时派生或重绑权限。
- 修复安全计划重提交被误判为授权丢失、导致普通 Goal round 反复停住的问题。缺失或撤销 grant 不会被普通轮次静默补发，只显示明确的恢复路径；Stop、跨项目、未知能力、文件冲突与未知副作用继续 fail closed。
- 等待态使用包含 Goal、grant、action 与 scheduler 事实的语义 fingerprint，在权威写入前判重；重复 idle reconciliation 不再写 store、发布同值状态或制造空转唤醒。没有新 durable transition 或 eligibility 变化的空 automatic round 会直接 park，不消耗 Goal 追加预算。
- 成员可为至少两个持续、独立且不重叠的结果提交持久扩员提案；提案本身不生成嵌套团队、隐藏成员或执行权限，只有 Root 通过后才会持久化任务并创建用户可见的平级成员，仍由 Root 复核容量、文件/资源冲突、成本、安全边界与可验证验收标准。
- 受 admission backpressure 的可见成员按持久 FIFO 接力；reservation/accepted/started/end/drain 精确绑定 generation、child、run 与 task，旧 run 不能释放新 lease，重复提案或旧释放事件不消耗 Goal round。
- retry/replace 在真正进入可能产生副作用的 dispatch 前保持确定性的 `not_started`；admission timeout、Stop 与晚到 lifecycle 按精确阶段收敛。graceful retirement 可由同一 run 的晚到完成回执安全结束，现场不明时仍不自动重放。
- `PI_AI_ERROR` / `Not Found` 只映射为当前 generation/run 的有界、脱敏诊断类别、阶段与修复动作；原始 provider 文本、stack、路径、prompt、output、session、token 与 Host 私有引用不进入模型或 UI，旧诊断不会覆盖更新的当前态。

## Agent Teams：实时状态、路径身份与权威账本

- 团队、成员、任务、后台计数与安全诊断通过单一权威状态流实时刷新；乱序旧事件、断线重连与 HMR 不覆盖较新 revision。已发送聊天 prose 继续保持发送时快照，不被后续活动静默改写。
- relay `queued` 明确表示消息只在本机持久排队、接收方尚未确认；不会由发送路径提前升级成 delivered，Stop、关闭与重启边界保持可审计。
- 工作区与资源 identity 改为逐码点保真：只规范真实分隔符、`.`、重复/尾斜杠及 Windows 实际大小写比较；NFC/NFD、全角/ASCII 等兼容等价但不同的路径不再被 NFKC 合并。
- Host adopted-root 恢复绑定 exact actor、project、board、batch、slot 与 operation，并使用可重建索引避免宽泛扫描；错误 actor/root/project/slot/op 全部拒绝。
- Agent Teams 权威存储新增版本化 hot/cold COW：关闭团队进入 content-hashed immutable shard，迁移保留 legacy 原件、可验证索引和可回滚 generation；OCC、claim/lease、submission/acceptance、wake/routing、handoff/recovery、authorization、quality/evidence 与 external-effect/idempotency 历史均不删减。
- Root 投影/SSE 编码提供不超过 32 MiB 的有界缓存，但默认关闭，并保留可立即回滚的 `disabled | shadow | enabled` 三态：`disabled` 走原权威投影，`shadow` 只比较候选且仍返回权威结果，`enabled` 只允许完整 identity/revision/ACL 命中；fresh ACL 永远先于缓存，身份或线性前驱不明时立即权威重算。SSE 在断线、Stop、HMR/重载时清理 listener、abort/backpressure 队列与关联引用。65-root 已测热命中基线 p95 低于 1 ms，但不作为默认启用承诺。

## 长会话与移动工作台

- 发送后 Stop、排队、继续与相关官方会话控件会随当前状态及时出现，不再要求切页或等待额外轮询；长会话切换后“跟随最新/保留阅读位置”意图不再漂移，滚到底部立即提交 follow 状态，reader 锚点有界采样并在旧 DOM 卸载前刷新。
- 恢复官方“回到底部”控件的可见性、至少 44×44 命中区、键盘语义与焦点状态；整枚“子代理会话：可继续”芯片的任一点都是同一个切换目标，单次指针操作只开合一次，Enter/Space 与至少 44×44 命中语义保持一致。
- 已打开会话详情中的底部“代理团队”入口不再被旧导航保护逻辑吞掉；标签可见且可用时会进入官方 Agent Teams 画布。
- Android 与 iOS 适配当前官方 `data-composer-input` contenteditable 合同；长文本、键盘抬升、附件、语音与文件 `@` 引用跟随活动编辑器，旧 textarea 只保留隔离兼容路径。
- 发送、停止、排队与恢复继续完全由官方主按钮和编辑器状态机拥有；手机层不再改名 Stop 或把它拦截为合成 Enter。
- 修复初次进入会话、历史仍在加载时新增 body 包装层使任务栏和输入框漂到页面上半部的问题；加载前后继续锚定视口底部。

## 无损性能、同步与存储

- 自动缓存维护改用 cache-only 窄扫描，在递归前剪除 runtime、sessions、attachments、memories 与未请求的 temp/workspace；shadow oracle 不逐项等价时只预览并 fail closed，手动 scan/preview/apply 和回滚开关继续保留。
- Desktop 活动预览使用有界 latest frame 内存槽；Android 面板复用每设备一个 2 fps persistent stream，连续预览不再反复写盘、读盘或 base64 往返。只有用户明确截图才进入带源尺寸和坐标空间的 durable evidence store。
- preview、evidence 与 legacy namespace 分域；安全 GC 只处理没有 attachment/tool-card/history 引用且 token 过期并经过安全裕量的 preview，先 quarantine、延迟删除并允许晚到引用恢复。既有 Android 混存内容在迁移证明完成前保持 conditional-authoritative，只读保留而不盲目清理。
- Mobile Sync v6 以单一 canonical snapshot、严格不超过 512 KiB 的 bounded delta journal 和小型 heartbeat/preferred-port 原子记录替代事件内嵌全量快照；保留 v5 只读备份、精确 reverse exporter、cursor/tombstone/offline replace、operation/idempotency 与 crash recovery。
- Schedule 继续以 session append-only events 为唯一权威源；内存 fold 只维护 seq/generation/checksum，15 秒刷新支持 ETag、`If-None-Match`、since delta 和无 body 304，gap/rewind/generation 分叉立即回退一次权威 full replay。

## 版本身份

- Desktop 根包与 lockfile：`1.0.59`
- 15 个 Desktop 自有插件：`1.0.59`
- Android：`versionName=1.0.59`、`versionCode=1005900`
- iOS/iPadOS：`MARKETING_VERSION=1.0.59`、build `10059`
- Desktop Mobile Sync 当前版本、移动更新示例、Web Search User-Agent 与组件签名验证 workflow identity：`1.0.59`
- 计划中的正式不可变 Tag：`v1.0.59`
- 上一稳定版：`v1.0.58`；其历史安全审查、Tag、资产、签名 APK、组件、清单、镜像与 stable feeds 保持不可变

## 发布门禁

正式发布前仍必须在干净、已提交的精确 revision 上完成：

- `npm run upstream:status`，确认官方 npm latest 仍与锁定的 `0.1.2-alpha.5` 一致；若出现更高官方版本，停止版本同步并重新审计，不能盲目发布。
- `npm run verify`、`npm run verify:release`、版本定向测试、全量测试、Node/JSON 语法检查与 MinGit `diff --check`。
- Agent Teams lifecycle/admission/recovery、自动接力、实时状态、Unicode 工作区、hot/cold store、投影缓存与性能门禁。
- 长会话滚动、Schedule 增量刷新、Mobile Sync v6、Android/iOS 输入与导航、设备预览、evidence/GC、Android compile/test 与 iPhone/iPad simulator 验证。
- 新的 v1.0.59 安全审查和精确 release evidence；最终 ACCEPTED hashes 只能在对应实现与门禁全部冻结后由后续验收生成，本次版本同步不预填、不沿用旧值。
- 正式云构建、签名、精确资产清单与 GitHub/CNB 双云一致性核对。

正式制品只能由仓库唯一的 resumable publisher 创建新的不可变 `v1.0.59`。不得手工上传本地二进制、移动或重建旧 Tag、覆盖 v1.0.58 资产、改写旧 `release-manifest.json`，也不得为追求全绿而盲目基线化真实失败。

## 发布完成后获取更新

`v1.0.59` 尚未发布。完成全部门禁前，请继续从[永久最新版入口](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest)获取不可变的 `v1.0.58` 稳定资产。publisher 完成后，新的 Tag、下载文件与校验摘要才会出现在相应的 GitHub Release，并由固定云端流程镜像到 CNB。
