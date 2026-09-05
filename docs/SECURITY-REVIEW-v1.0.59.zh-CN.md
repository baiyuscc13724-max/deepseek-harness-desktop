# Harness Desktop v1.0.59 安全审查

审查日期：2026-09-05

审查对象：Harness Desktop `1.0.59` 候选源码、官方 Harness `0.1.2-alpha.5` 依赖与补丁、Agent Teams 自动接力/扩员/生命周期/权威存储/投影、长会话与移动工作台、Schedule、Mobile Sync v6、设备预览与证据存储，以及正式发布器的安全边界。

## 审查结论与证据状态

v1.0.59 候选源码继续以 fail closed、单一权威、逐码点身份和可立即回滚为默认。当前结论只覆盖候选源码审查与本地定向门禁，不表示版本已经发布、签名、镜像或进入 stable feed。上一稳定版仍是不可变的 `v1.0.58`。

**发布动态证据仍待唯一 resumable publisher。** 正式云构建、公开 Windows x64 便携包隔离自检、Android/组件签名、精确 18 资产、GitHub→CNB 云到云镜像及 stable feeds 最后提升，必须由 publisher 在干净、已提交的精确 revision 上重新取得并绑定；本文件不能替代这些证据，也不能把待验证项预先标记为成功。

## 1. 威胁模型与信任边界

本轮重点防范以下失效模式：

- 依赖或补丁漂移让旧 alpha、非官方包或缺失的 optional root 混入候选；官方能力与 Desktop 自有能力重名后互相覆盖或双写。
- 普通 Goal round、重复投影、状态轮询或模型声明伪造自动接力权限，或者在 Stop、跨项目、旧 epoch、未知能力和未知副作用后继续执行。
- 成员扩员提案绕过 Root 审批，产生嵌套团队、隐藏执行者、文件/资源冲突或超容量 dispatch。
- Provider 原文、路径、prompt、output、session、token、stack 或 Host 私有引用通过诊断、SSE、日志或历史 prose 泄漏。
- Unicode 规范化把不同码点路径折叠成同一资源，或 hermetic manifest 接受重复、非规范相对路径和乱序记录。
- hot/cold 迁移、投影缓存、Mobile Sync 增量化或预览 GC 删除权威历史、越过 ACL/epoch/revision、复用回滚分支，或在崩溃边界产生半提交状态。
- 候选文档或本地构建被误当作正式云制品证据，进而提前签名、镜像或提升 stable feed。

信任根保持不变：官方 npm 完整性与 lockfile、Desktop Host 发行的短期能力和 authorization epoch、canonical project/root/team/Goal 身份、Agent Teams append-only 生命周期与 external-effect 账本、签名 release manifest，以及唯一 publisher 保存的远端证据状态。模型文本、网页内容、已发送聊天 prose、缓存命中、进程存活和本地开发包都不是这些信任根。

## 2. 官方 alpha.5、补丁与 Schedule 共存

- 根 `package.json`、lockfile 和 Desktop 自有插件 peer graph 必须把官方 required/optional DSH roots 精确固定到 `0.1.2-alpha.5`。官方 Tag `dsh-v0.1.2-alpha.5` 精确绑定 commit `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`；历史 alpha.2–alpha.4 合同只作审计基线，不能成为当前生产分支的回退条件。
- 静态门禁同时绑定 Desktop 产品身份 `1.0.59` 与官方核心身份 `0.1.2-alpha.5`；任一 root 缺失、使用范围版本、重新引入已移除 root 或出现额外直接 DSH root，都必须失败。
- 官方补丁以精确输入哈希、语义锚点和幂等二次执行约束变更；不能通过宽泛字符串替换或跳过漂移检查强行适配。
- 官方 Schedule 使用 `id=schedule` / `@deepseek-ai/dsh-schedule`，Desktop Schedule 使用 `id=desktop-schedules` / `dsh-desktop-schedules`。部署只补齐缺少的两条 profile entry，官方 Schedule 与 Desktop `dsh-desktop-schedules` 必须同时存在、互不冒充、互不覆盖。
- Schedule 继续以 session append-only events 为唯一权威源。内存 fold 只保存 seq/generation/checksum；ETag、`If-None-Match`、since delta 与无 body 的 304 只优化读取，gap、rewind 或 generation 分叉必须回退一次权威 full replay，不能改写既有会话日志。

## 3. 全局 Host 自动接力、空轮次与撤销

- “全局自动接力”设置持久化的只是版本化 settings proof 与当前 authorization epoch，不持久化某个 team grant、短期 receipt、root/session 私有引用或模型可重放的授权材料。
- 短期 Host receipt 绑定精确 Desktop origin/webContents、设置内容与 epoch，TTL 为 15 秒且只能消费一次；错误 origin、设置漂移、过期、重放、未知 id 和旧 epoch 都 fail closed。
- 真正的 team grant 只可在直接用户建队、精确计划提交或两阶段 Resume 边界派生，并同时绑定 root、canonical project、活动 Goal、team、pause epoch、plan/settings hash 与 authorization epoch。普通 Goal round、routing 声明和进度消息不能补发缺失或已撤销 grant。
- 没有新的 durable transition 或 eligibility 变化时，空 automatic round 直接 park，零追加预算、零新 wake、零重复 store 写入和零重复 publication。只有 claim-bound 任务提交、成员失败或依赖满足关系改变等已持久化事实，才允许每个 transition 至多补充一轮。
- Stop、显式关闭自动接力、Host/runtime 重启撤销、handoff/adopt、跨项目、pause epoch 或授权 epoch 变化、计划/设置漂移、能力未知、文件冲突、非 `none` effect，以及没有被当前精确进程内恢复尝试围栏覆盖的 `outcome_unknown`，都撤销或阻断自动继续。预算不能因 Resume 或重新提交计划而重置。

### 3.1 明确失败成员的自动恢复

- `team_member_recover` 仍只接受精确存活的顶层 Root。直接用户轮次可执行；非直接用户轮次必须同时证明当前是 Host 承认的同一 armed Goal round，且 Root 的全部未关闭团队形成完整、活动、可信的 autopilot grant group。
- 自动路径逐项重验同一 root、canonical project、Goal identity/objective/round cap、pause epoch、authorization epoch、活动且 hash-bound 的 plan、已验证能力、无文件冲突、全部 effect policy=`none`、精确 failed member、未完成任务、claim/lease 与容量。任一 Stop、跨项目、未知能力/成本、副作用、冲突、stale claim/revision 或既有未收敛恢复 receipt 均 fail closed。
- 可继续的原 session 且唯一活动 claim/lease 未变时，只允许一次自动 `retry`；同一成员的该次 retry 已确认送达后再次失败，Host 以 `AGENT_TEAMS_AUTOMATIC_RETRY_EXHAUSTED` 拒绝第二次自动 retry，并要求同一安全 Goal round 直接 `replace`，不要求用户选择或发送同意短语。replace 会撤销旧 claim/lease、保留 checkpoint/生命周期审计，并把相同未完成任务预绑定给一个用户可见的同级成员。
- 每次恢复先写 durable receipt 再 dispatch。模块内 `AUTOMATIC_MEMBER_RECOVERY_ATTEMPTS` 只在精确调用进行期间，以 team/request/input hash/root/member/action/revision/pause epoch 共同匹配当前尝试；这只避免已围栏的本次 `prepared`/`outcome_unknown` 自我撤销 grant，不把模型输入升级为 Host 事实。`finally` 按对象 identity 删除记录；进程重启、调用结束或不匹配时，durable `outcome_unknown` 立即重新阻断 autopilot。`prepared + dispatchOutcome=not_started + retryable=true` 因尚未发生 dispatch 可安全原样续跑。
- Agent Teams 页面不再为结果明确的 retry/replace 再弹第二层确认。Root 的手动后备按钮单击即提交，操作中禁用全部恢复按钮、切换工作文案，并在容器暴露 `aria-busy`，完成后使用 live status/alert 直接反馈；移动布局保持单列与至少 44px 命中区。只有 `outcome_unknown` 的 delivered/not-delivered 对账继续保留直接用户确认，且不会重发模型调用。
- 本轮 canonical-LF 身份：Host `plugins/dsh-agent-teams/lib/index.js` = `7b5e141f1907fefbc5528481a816ab10df9022aecfd2b850db7b41f057a14134`；Client `plugins/dsh-agent-teams/lib/client.js` = `5a6a9ed1b2019d99495e3cfa680f945f08c6cc11e551347d16f645ff3904a271`；定向测试 `tests/agent-teams-autopilot.test.cjs` = `1010d340b1ed3f2b109b620e1e15e4e36a609e36a2f2725674e05419af71ba51`、`tests/agent-teams-runtime.test.cjs` = `0f798f6d02fdc88d1cdefc2f9369a44015f6396845a1df094345022142ec6528`、`tests/agent-teams-tools.test.cjs` = `2ec27df1801025fd3159c77cfdd7dc473ec3a4f8dad1fda3a2ab8a9185402752`、`tests/agent-teams-ui.test.cjs` = `f5b9989198a8fc32d2b28c64103fabda2f0dcbc6077bdbf1e52d710029c80ae4`。
- 精确门禁结果：autopilot 65/65、UI 40/40、tools 16/16、domain 79/79、runtime 37/37，均为 0 fail/0 skip；runtime 单文件由 Node 测试进程自然退出，没有使用 `--test-force-exit`。
- Unix 云端普通 smoke 退出边界保持严格：测试 teardown 先关闭同文件的 peer Store，插件 disposer 再关闭最后一个 Store、撤销后续 retention，并通过 `closeAndSettle()` 等待已经在途的低优先级 retention I/O 完整结算；没有跳过、强退、改变并发或降低门禁。

## 4. 重任务扩员、admission 与外部副作用

- 成员只能为自己已经 claim 的 in-progress 任务提交结构化 expansion proposal，并至少给出两个持续、独立、文件/资源不重叠的 deliverable、验收标准和并行收益。
- expansion proposal 只是持久请求，不创建任务、不启动成员、不授予 delegation authority。只有 Root 审批后才能先持久化任务，再创建用户可见的平级成员；禁止嵌套团队、隐藏子代理或成员自行 fan-out。
- Root 必须复核现有文件 claim、外部资源所有权、层级冲突、最大成员数、全局 active-turn 容量、成本与能力。宽泛 source task 若与拟拆分范围重叠，必须先 release/restructure，再创建新任务。
- admission reservation、accepted、started、end 与 drain 绑定 exact generation/child/run/task。旧 run、重复提案或晚到 release 不能释放新 lease，也不能消耗额外 Goal round。
- 外部副作用 identity 与 idempotency key 由 Host 从 team/task/effect 身份派生，模型输入不是权威。`prepare` 必须先把 outcome 写成 `outcome_unknown`；随后成功/失败必须回显 exact attemptId 与 claimId/leaseEpoch。
- `outcome_unknown` 禁止盲目重放。只有精确直接用户授权的 `resolve_unknown` 可以将同一 attempt 收敛为 succeeded、failed 或 not_started；普通 UI 动作不能宣称 exactly-once，只有参与式幂等协议可使用相应保证。

## 5. sent-time prose、current-only 诊断与实时状态

- 已发送聊天 prose 是 sent-time snapshot：后续成员失败、恢复、重连、HMR 或较新投影不能静默改写历史消息文字。用户应以独立的 Host 权威实时状态卡判断当前状态。
- `PI_AI_ERROR` / `Not Found` 只允许映射为当前 generation/run 的有界类别、阶段、retryable、partial-output-presence 与 next action。原始 provider 文本、stack、绝对路径、prompt、output、session/token、claim/run id 和 Host 私有引用不得进入持久状态、公开 JSON 或 UI。
- current-only 意味着：未解决且仍属当前 run 的失败可以显示脱敏诊断；较新 run 已开始、成员已恢复/退休或问题已收敛后，旧诊断不得重新覆盖当前状态。
- relay `queued` 只表示本机持久排队，接收方尚未确认；发送路径不能把它提前升级为 delivered。
- 团队、成员、任务、后台计数和诊断共用单一 SSE 权威流。可见生命周期内最多一个 EventSource；旧 revision、乱序事件和旧 snapshotVersion 不覆盖较新状态。失败后的 HTTP 只是稀疏安全网，不得恢复高频轮询。
- 隐藏、Stop、断线、HMR/重载和销毁时必须关闭 EventSource，并清理 listener、timer、abort、backpressure 队列、待编码文档及相关缓存引用；零 client 时 SSE broadcaster 不持有 document 或 timer。

## 6. 长会话、发送后控件与可访问交互

- 长会话把“跟随最新”与“保留阅读位置”作为显式意图。滚到底部立即写入 follow；主动阅读时保存有界语义 anchor，并在旧 DOM 卸载前刷新。切换、延迟 hydration、卡片/Goal/tool-result reflow、resize 与 zoom 不得无条件滚底。
- 发送后 Stop、排队、继续以及当前官方状态机拥有的控件必须随状态立即可见，不要求切页或额外轮询；Desktop/mobile 适配层不得把 Stop 改名、合成 Enter 或接管官方 click ownership。
- “回到底部”控件必须可见，具有键盘语义、清晰 focus-visible 状态和至少 44×44 命中区，同时不得破坏正在阅读历史的用户。
- 整枚“子代理会话：可继续”按钮是一个原生 disclosure：正文、状态和箭头都属于同一按钮，不嵌套第二个按钮。任意一点单次 pointer activation 只开合一次；Enter/Space 依赖同一原生 click，不产生第二次 toggle；命中区至少 44×44。

## 7. Unicode 逐码点身份与 hermetic manifest

- 工作区、文件和资源 identity 保留 Unicode 逐码点身份。只规范真实路径分隔符、`.`、重复/尾斜杠及 Windows 实际大小写比较；不执行 NFC/NFKC 折叠。
- 因此 NFC 与 NFD、全角与 ASCII 等码点不同的普通路径保持不同；Windows 大小写等价不能扩展成 Unicode 兼容等价。
- frozen manifest 只接受可逆 UTF-8、安全且规范的相对 POSIX 路径、64 位十六进制哈希和 unsigned UTF-8 `Buffer.compare` 严格递增顺序。
- NFC/NFD 两个不同码点路径按 UTF-8 排序后都必须被接受；只有完全相同的路径才算 duplicate。非法 UTF-8、绝对路径、反斜杠、空组件、`.` / `..`、重复/尾斜杠、完全重复与乱序继续拒绝。

## 8. Agent Teams hot/cold 权威账本

- v8→hot/cold promotion 是 copy-only：legacy v8 原件保持逐字节不变，并复制为 content-hashed immutable source；关闭团队进入 content-addressed shard，活动数据、closed catalog、manifest 与 current pointer 都带内容哈希并在切换前完整验证。
- promotion 使用源文件同级的 `*.promoted.json` 两阶段 sentinel（`prepared`→`committed`）。崩溃恢复必须先核对 immutable source、pointer 与全部 artifact；校验失败不能把 sentinel 提升为 committed。历史 inner marker 只迁移，不得被覆盖。
- retention 保留 current+4 个完整 generation（当前加四个完整前驱），并额外保留下一枚 manifest-only 线索；这给出两次可重启 rollback 的完整基线与后续线性历史证明。第三次无证据 rollback 必须拒绝。
- 默认垃圾债务软预算为 48 files / 4 MiB，hard watermark 为 192 files / 16 MiB。hard watermark 只计算可回收垃圾债务，不把合法 live shards、回滚基线或 immutable source 误算为垃圾；超过硬线时必须在发布新 generation 前失败。
- exportV8 必须重建与当前权威视图等价的 v8 文档；目标若是 legacy source、ledger 内部路径、source/ledger 的 symlink、junction、hardlink 或其他 filesystem alias，必须拒绝。导出不能覆盖 promotion sentinel。
- OCC、claim/lease、submission/acceptance、wake/routing、handoff/recovery、authorization、quality/evidence 与 external-effect/idempotency 历史不得因分层、GC 或 rollback 丢失。

### 8.1 第二轮持久化优化的安全等价复核

第二轮持久化优化已独立逐项审查其产品与回归差异；当前 Host 在该等价性能实现上叠加 §3.1 的自动恢复权限围栏，性能合同文件保持不变。冻结以下两个 canonical-LF 源身份：

- `plugins/dsh-agent-teams/lib/index.js`：`7b5e141f1907fefbc5528481a816ab10df9022aecfd2b850db7b41f057a14134`
- `tests/agent-teams-store-performance.test.cjs`：`68323e2eecd9e410d75547301275859d681dfac54527fbc36729228596d3a887`

独立复核确认性能恢复没有缩小权威数据域、耐久边界或拒绝条件：

- Root ledger projection 只在单次 `rootLedgerProjectionHashes` 调用内，按已校验的 canonical ordinal 有序子序列复用 scope digest；Map 不跨 mutation、generation 或 ACL 存活，返回行仍保留每个原始 `rootSessionId` 的逐码点身份。独立 oracle 覆盖 NFC/NFD 规范等价但码点不同的 root、共享与不同 scope、scope 变化及重启。
- hot 与 manifest 只在写前完整 `validateIndexedStore`、canonical bytes 和全部 hash 已确定后并行落盘；`Promise.allSettled` 等待两支完全结束，hot 错误优先，拒绝返回后不存在晚到 writer。随后仍按 after-hot fault gate、物理 hot 的 hash/长度/JSON/team-entry exact 核验、manifest gate，最后才原子替换 pointer；pointer 是唯一可见提交边界。
- immutable writer 继续使用同目录随机 temp、`wx`、文件 `fsync`、rename、readback 与目录同步。rename 后只让 readback 与目录同步并发执行，并以 `Promise.allSettled` 等待二者完全结束；没有省略或后移任一耐久步骤。`tempOwned` 只在 rename 真正成功后清除；失败或 EEXIST/EPERM 碰撞只清理由本调用拥有的 temp，绝不 `rm` destination。hot 的第二次物理核验仍在，删除的只是同一已验证内存图的重复全局遍历。
- retention 的 artifact/JSON/catalog 复用键精确包含 `path + hash + bytes + generation`，并且生命周期只限一次 plan。正常线性提交可把上一份已验证、且与完整 pointer authority 同生共失的 manifest descriptor chain 仅用于并发发起物理读取；每个 manifest 仍逐一执行 path/hash/bytes/generation、JSON 与链关系核验，链不一致立即失败，peer adoption、rollback、写后故障或 authority 变化都会清除此提示。catalog 读取可与 manifest 链核验重叠，但 merged ordinal、document/security/projection hash、ACL/epoch、closed shard 和 immutable v8 source 仍分别验证。任何 unlink 前仍先完成删除前的 `fullValidation`，每次 unlink 前仍重读并比对完整 pointer bytes 与 stat identity。
- soft maintenance 仅是按 `filePath` 共享、与 writer 共用 mutation lane 的 captured quiet job；`setImmediate().unref()` 只调度，不授权。token 同时绑定 canonical pointer bytes 的 SHA/长度/stat、generation、manifest descriptor、retention floor、debt/revision、lifecycle 与 foreground epoch；`init/read/mutate/rollback`、peer adoption、post-commit failure、同 generation 分支替换、Stop/close 都会使旧 token 失效，结果只有在 CAS 仍匹配时才可回写，maintenance 不产生 publication。captured promise 完整吸收诊断分支异常，close 会取消 queued/running maintenance，取消后不会开始下一次 unlink。
- hard watermark 不等待 soft job：下一次真实写在写入第一个新 artifact 前仍同步刷新 reachability，并在超线时执行完整同步 sweep 或 fail closed refusal。保留集合仍是 current+4 个完整 generation 与 depth 5 的 manifest-only 线索，两次可重启 rollback、promotion source/sentinel、Unicode、task/claim/lease/OCC 历史均未降级。
- exact-origin fast path 只对刚完成首轮 adopt 且对象 identity、stamp 与 branch descriptor 全部一致的提交者生效，并执行等价 retention normalization；活动团队 mutation 若保持全部 closed entry 的相同对象 identity 与 canonical 顺序，可直接复用 catalog descriptor，否则仍回退到完整 JSON 等价比较。ledger projection identity 也只按同一不可变 generation entry 的 `WeakMap` identity 复用；任何新 entry 都重建 member/ownership hash。peer store、listener/SSE、rollback、init、failure 和外部分支继续走完整 adoption。一次 mutation 仍只产生一次 publication。

性能合同保持 45 次、丢弃前 5 次、p95 `<75 ms`、写入 `<30%`，没有 sleep、额外 warmup、样本减少、阈值或 runner 重分类。Windows `10.0.22621` / Node `v24.16.0` 以原合同复验当前候选：完整 store 为 74/74、0 skip，目标 p95 为 `20.14 ms`，写入仍为 `5290/149443`（`3.54%`）；65-root 完整投影专项为 12/12，冷 miss 中位数 `30.416 ms`，缓存 65 项仍为 `2705970` bytes，RSS 增长 `405504` bytes。上一轮 security/OCC/Stop accepted 矩阵 169/169、authorization/projection/SSE 专项 29/29 与 official hermetic acceptance 继续作为未放宽的基线；`node scripts/verify-static.mjs`、Node syntax 与 MinGit `diff --check` 仍是正式发布前门禁。既有 historical-audit skip 继续由 `DSH_HISTORICAL_ALPHA2_AUDIT` 显式门控，没有改成通过，也没有掩盖产品测试失败。

## 9. Root 投影缓存与 SSE 清理

- 投影缓存 feature flag 只有 `disabled | shadow | enabled` 三态，默认 `disabled`。`disabled` 直接走权威投影并清空缓存；`shadow` 计算并比较候选但始终返回权威结果；只有 `enabled` 才允许命中。
- 权威投影仍只序列化一次。只有 `canonicalSnapshot === teamSnapshot` 且候选也是内建恒等函数的 enabled 路径，才把刚生成、尚未逸出的权威纯对象直接 deep-freeze，并复用同一 canonical text 生成 SSE 与 exact UTF-8 byte-length 计量；不再重复 parse、分配常驻 Buffer 或对自身做无信息哈希。shadow 或任一注入候选仍执行独立 materialization、clone、序列化、逐字节比较和 hash mismatch 断路，不能绕过 A/B 审核。
- 缓存采用不超过 32 MiB 的 LRU，预算同时计算 deep-frozen JSON projection 与 SSE encoding。SSE 字节预算按 exact UTF-8 canonical bytes 加固定 ASCII framing 计算，与实际 payload 等长；eviction、disable 和 close 必须把 bytes 归零，不能留下 document 引用。
- fresh ACL 必须先于 cache lookup。hot/cold cache branch descriptor 精确绑定 `path + hash + bytes + generation`，命中键和前驱验证还覆盖 store publication serial、root/canonical project、team/task selection、revision、owner、pause/auth epoch；只有经过 artifact 校验的线性 predecessor 才能 reuse。ACL 撤销、选择变化、rollback、generation 分叉或外部 branch 都必须 miss 并重新权威投影。
- shadow mismatch 立即打开 fail-safe circuit，之后返回权威结果；不能用缓存结果掩盖身份或序列不一致。
- SSE broadcaster 对断线、error、Stop 和 backpressure client 执行精确 cleanup；零客户端时不渲染、不保留 pending document，也不保留 keepalive/debounce timer。

## 10. Mobile Sync v6、v5 备份与反向导出

- Mobile Sync v6 只保存一份 canonical snapshot 与 lossless delta journal；journal 严格不超过 512 KiB。单次超大权威变化使用有界 anchor 并失效无法继续增量的旧 cursor，不能截断仍宣称可重放的 delta。
- heartbeat 与 preferred-port 写入小型独立原子记录，不重写 canonical ledger。同一设备单调递增的亚秒 heartbeat burst 在内存投影中保持最新值，但复用最近一次 durable heartbeat；达到 1 秒窗口或发生 preferred-port 更新时立即原子持久化最新记录，从而消除 Windows 同步 flush 抖动而不放宽 p95 门槛。operation/idempotency、cursor、tombstone、offline replace、generation/hash 与崩溃恢复仍是权威合同。
- complete manifest 的 delta 比较只对已经规范化的扁平记录使用逐键全等；若无 tombstone 且 workspace/session/read-message 三组 identity 的长度与顺序逐项相同，可直接证明既有 Map merge 保序，不再重复构造并序列化整份 replay。任一删除、重排、identity 变化或未来嵌套值均走原有完整 replay/full-reset 校验；主文件仍在每次已应用提交时执行同目录 temp、文件 `fsync` 与原子 rename，耐久边界未改变。
- v5→v6 首次迁移保留精确、只读的 `.v5.bak`，包括加密 secret envelope；不得把明文 network secret 写回备份或 reverse export。
- `exportV5State` 必须能从 v6 精确反向生成 v5 canonical state；显式切回 v5、再迁移 v6 后 canonical hash 必须一致。shadow 阶段只比较 v5/v6 canonical hash，仍持久化单一 legacy transaction，不双发同步。
- main、runtime、backup、fsync 与 rename 任一崩溃点只能恢复完整旧事务或完整新事务；损坏的 canonical/runtime integrity record fail closed，错误文本不得回显损坏内容。

### 10.1 本轮云端性能恢复的等价复核

- canonical-LF 身份：`plugins/dsh-agent-teams/lib/index.js` = `7b5e141f1907fefbc5528481a816ab10df9022aecfd2b850db7b41f057a14134`；`electron/store/mobile-sync-store.cjs` = `da403e440f5d6c5a8f066e1af8773e32c1b662ef23968f31d84d8679ab33a1ba`。
- Windows / Node `v24.16.0` 保持原始样本与断言。此前云端证据已把 65-root 冷投影中位数由 `58.280 ms` 降至 `40.422 ms`，并把 1307-session changed commit p95 由 `12.672 ms` 降至 `9.952 ms`、128-event journal commit p95 由 `10.920 ms` 降至 `6.277 ms`；Mobile Sync 已通过固定门槛。当前 exact 候选进一步在本地原合同下得到 65-root 冷投影中位数 `30.416 ms` 和 146-team mutation p95 `20.14 ms`，门槛仍分别为 `<=60 ms` 与 `<75 ms`。相关 37 个 Mobile Sync 测试、74 个 hot/cold 测试与全部 Agent Teams 投影测试通过。
- run `33944441121` 的 Windows runner 曾得到 `80.47 ms`，暴露了串行 pointer 文件同步对慢速云端磁盘的敏感性。当前实现以 `prepareAtomicArtifact` 先写入并 `fsync` pointer 临时文件，并通过同一个 `Promise.allSettled` 与不可见的 hot/manifest 制品并行；只有两个不可变制品全部 settle、hot 物理回读及 manifest 分支验证完成后才执行 pointer rename。任一提交前失败会清理 pointer 临时文件且不改变可见 pointer，文件 `fsync`、回读校验、崩溃边界和原子提交语义均未删减。
- 没有提高阈值、减少样本、增加 warmup、sleep、跳过测试或更改 smoke 分组；内建缓存候选就是刚完成授权的同一未逸出 canonical 对象，任一 shadow/注入候选仍须逐字节/哈希等价，Mobile Sync 每次 applied commit 仍完成文件 `fsync` 与原子 rename。
- Unix 阻塞归因更正：run `33944441121` 被人工取消，`33946203388` 等待到约 60 分钟上限，`33949989349` 和 `33951393082` 后续也被人工取消；这些终止日志只证明 ordinary phase 在 `Agent Teams remains experimental and disabled by default` 之后停止输出，不能单凭有序 reporter 确定具体阻塞测试或活动句柄。此前把 Cordis/retention/peer Store 推断写成已证明根因的表述撤回。真实子 fiber 的 `fiber.dispose()`、peer 先关闭与 `closeAndSettle()` 是已实现并通过 Windows 验证的清理措施，尚未证明解决 Unix 阻塞。本地 runtime 37/37、hot/cold 74/74，旧候选的低并发 ordinary 2357 pass/29 intentional skip 不能替代 Unix 证据。独立、只读权限、最长 7 分钟的 Ubuntu 诊断仅运行两个候选测试文件，不打包或发布；其超时为诊断失败，不作正式门禁通过依据。正式 smoke 的并发、分组、断言和性能门槛不变。

## 11. preview/evidence 分域与延迟 GC

- 连续设备预览是内存中的有界 latest frame；Android 面板按设备复用单一约 2 fps persistent stream。预览帧不反复落盘、回读或 base64 往返。
- 只有用户明确截图才进入 durable `evidence` namespace，并保留源尺寸与坐标空间。`preview`、`evidence` 与 legacy/unknown namespace 物理和逻辑分域；evidence/legacy/unknown 默认不可由 preview GC 删除。
- preview GC 需要显式 flag、可信 normalized namespace、稳定 runtime identity、引用索引和时钟高水位。attachment、tool-card、history 与未过期 token 引用都保护对应文件。
- 无引用且过期的 preview 先进入 quarantine，再等待 token 最大 TTL、GC safety margin 与 quarantine delay 后删除。晚到引用可以从 quarantine 恢复；悬空引用、索引损坏、时钟回退、symlink/junction 或预算异常都停止删除。
- 既有 Android 混存内容在迁移证明完成前维持 conditional-authoritative、只读保留；不得为节省空间盲目清理。

## 12. 缓存维护与磁盘/内存预算

- 自动缓存维护只做 cache-only 窄扫描，并在递归前剪除 runtime、sessions、attachments、memories 及未请求的 temp/workspace。手动 scan/preview/apply 与回滚开关继续保留。
- Node 24 / Electron 43 没有跨平台 directory-handle 删除原语，因此 `1.0.59` 的 storage cleanup apply 明确为 `preview-only`：完成 canonical root/target、identity、current runtime、protected subtree、symlink/reparse 与二次校验后仍返回 `action=refused`、`applied=false`、`freedBytes=0`、`recovery.state=original-retained`，不调用 `rename`、`rm` 或 `rmdir`。候选和受保护数据都保留，遗留 `.dsh-cleanup-quarantine-` 条目永久不重新进入 planner。
- shadow oracle 必须逐项等价；任何差异只生成预览并 fail closed，不得直接删除。
- 明确的固定预算包括：投影缓存 32 MiB、Mobile Sync delta journal 512 KiB、hot/cold 垃圾债务 48 files / 4 MiB 软线与 192 files / 16 MiB 硬线。SSE/client queue、reader anchor、diagnostic、设备 latest frame 与截图引用索引也必须保持实现中的有界策略。
- 性能指标只用于发现退化，不能覆盖一致性、ACL、引用或回滚失败。缓存/增量路径一旦出现 mismatch，应回退权威读取而不是提高预算或放宽校验。

## 13. Feature flag 与回滚矩阵

| 能力 | 默认/观察态 | 提升条件 | 回滚与失败行为 |
| --- | --- | --- | --- |
| 全局自动接力 | Host 设置默认可见，但无精确 grant 不执行 | 直接用户边界、完整 identity/settings/epoch | Stop/disable/revoke 旋转 epoch；不恢复旧 wake，不重置预算 |
| hot/cold store | 未提升的 legacy 可保持原路径；达到策略或显式启用后 copy-only promotion | 全部 artifact + pointer + sentinel 校验 | 已 committed promotion 继续读权威 ledger；只允许受验 manifest rollback/export，不静默覆盖 legacy |
| 投影缓存 | `disabled` | `shadow` 全等后显式 `enabled` | 任意 mismatch 开 circuit；切 `disabled` 立即清空并走权威投影 |
| Mobile Sync v6 | canonical+delta；v5 备份保留 | canonical hash、journal、崩溃矩阵通过 | 显式 v5 mode + reverse exporter；损坏或超界 fail closed |
| preview GC | 分域存储；无 flag 不主动删除 | 引用重建、TTL、安全裕量和 quarantine delay 全部满足 | clock/index/reference/namespace 异常零删除；晚到引用恢复 |
| Schedule delta | 增量读取 | seq/generation/checksum/ETag 连续 | gap/rewind/fork 回退 full replay；不改写 append-only events |

## 14. 正式发布器、18 资产与证据边界

正式发布只能使用仓库唯一命令族：

```text
npm run release:publish -- plan --version 1.0.59
npm run release:publish -- run --version 1.0.59
npm run release:publish -- status --version 1.0.59
```

publisher 的不可变顺序是：

1. 干净、已提交的精确源码 revision 通过本地源码/安全门禁；删除并拒绝 `dist`，本地不构造正式发布包。
2. GitHub Actions 绑定精确 requestId/source revision 完成 Windows/macOS/Linux 构建、iOS simulator、组件与安装器门禁；全部成功后才创建唯一不可变 Tag。
3. 公开 Release 后只从规范 URL 下载正式 Windows portable x64，在独立 userData/runtime home 中执行真实 token→Cookie→clean `/` 与 packaged `--self-test`；绑定 release/asset ID、size、GitHub SHA-256 digest、产品提交和报告摘要。
4. 正式 Windows 动态证据通过后，依次发布签名 Android、签名组件和签名 `release-manifest.json`；清单必须恰好描述 18 个不可变资产。
5. CNB Runner 直接从 GitHub 云到云镜像 18 资产，禁止从本机上传二进制；两云 size/SHA-256/名称全部一致后，才最后提升三个 signed stable feeds，并执行 metadata-only CNB stable 同步。

候选源码审查、静态字符串、开发包、Actions artifact、旧 state 或本地已下载文件都不能代替第 3–5 步的发布动态证据。任何签名、资产集合、远端回读或隔离自检未知/失败都必须停在 publisher 状态中，不能移动 Tag、覆盖 `v1.0.58`、修改旧 release manifest 或提前让客户端发现 v1.0.59。

## 15. 发布前必须重新取得的证据

在 ACCEPTED 哈希冻结和正式发布前，至少需要：

- `node scripts/verify-static.mjs`、`npm run verify`、`npm run verify:release`、Node/JSON 语法、文档结构/链接/占位符与 MinGit `diff --check` 全部成功。
- official alpha.5 依赖/lock/patch/isolated acceptance、官方与 Desktop Schedule 共存、Unicode hermetic acceptance/isolated 门禁成功。
- Agent Teams authorization/autopilot/expansion/lifecycle/external-effects、hot/cold/retention/rollback、projection cache/SSE、current-only redaction 与实时 UI 门禁成功。
- conversation scroll restoration、发送后控件、整枚 disclosure 单次/键盘/44×44，以及 Android/iOS composer/navigation 门禁成功。
- Mobile Sync v6/v5 round-trip、preview/evidence/GC、cache-only scan 与相关崩溃矩阵成功。
- `npm run upstream:status` 仍确认官方最新目标与锁定的 `0.1.2-alpha.5` 相符；若上游身份改变，停止并重新审计。
- publisher 在最终 immutable revision 上取得正式云构建、签名、公开 Windows 隔离自检、18 资产及 GitHub/CNB/stable 一致性证据。

ACCEPTED 表的 12 个文本文件只能在上述实现与本地门禁冻结后，按 helper 的 `sha256CanonicalTextFile` 语义（CRLF/CR 统一为 LF，再计算 SHA-256）重算。不得用原始文件字节哈希代替，不得修改 `ACCEPTED_MIGRATION_FILES`、历史 baseline 或 alpha.2 常量，也不得为全绿而基线化真实失败。
