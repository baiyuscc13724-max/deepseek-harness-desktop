# 手机问答回执与草稿：最小跨层修复方案

> **只读设计，尚未实现、未部署、未验收。** 承接已接受的有界作者证据 `ROUND3-QUESTION-ACK-LIFETIME`、`ROUND3-QUESTION-RETRY-DRAFT`；原证据的独验另行进行。本轮只新增本文和独立输入绑定，不修改生产、旧测试/报告/冻结证据，不创建runtime。下列接口名、状态名和限额凡标“拟新增”均不是现有API。

## 1. 决策：只改两个客户端产物，不改服务器与Connection

采用**本地两阶段交付通知 + 按真实event身份保留短期草稿**。Question监听器先把答案交给Gateway；Question按钮另等Gateway对真实RPC的最终解析通知。失败不自动重发；必须有新一代事件流明确重呈现同一pending事件，才能恢复草稿并允许用户再提交。

改动目标仅 `dsh-api-gateway/lib/client.js` 与 `dsh-client-ui-user-questions/lib/client.js`，通过维护installer精确组合。不修改gateway server、Connection、uiSession、Android、会话持久化或业务协议。

**语义上限**：目前成功RPC只证明“该答复请求的传输回执已确认”，不证明“本客户端答案赢得Host waterfall”，更不证明模型/工具已执行。真实工具结果必须继续由原session projection提供，不用本地selected伪造结果行。若要求business-winner证明或按nonce查最终receipt，当前接口不够；这是另一个服务器协议任务，不能偷偷纳入本方案或绕过13项原生能力门。

## 2. 已读现状与必守约束

以下行号指当前未二次改写的安装源；question当前磁盘为官方base，已接受证据测试的是正式临时安装后的旧维护版。三包manifest版本均为 `0.1.2-alpha.5`，完整SHA见 `inputs.json`。

| 源及位置 | 当前事实 / 对设计的约束 |
|---|---|
| question client L87–118、L153–157 | `PendingQuestion.result`为监听器结果；`answer()`仅settle它，随后释放原abort listener。不能把该result改成等待网络的promise |
| question client L840–859 | `answerQuestion` await `pending.result`，finally立即`remove()`；`completed`供域delegate等候。UI移除必须另行管理，而监听器return不能被UI回执等待阻塞 |
| gateway client L605–648、L654–691 | `pumpEvents`有per-event controller、generation signal和tasks；`answer`先await `dispatchWaterfall`再`connection.rpc.call`。catch触发原generation恢复，finally等待所有tasks；新增UI订阅不可被纳入这些tasks的等待链 |
| connection client L4606–4627 | HTTP非2xx抛普通Error；成功需读完整JSON、验证envelope和rpcId后才返回。Gateway现在没有结构化HTTP状态/“未dispatch”证明，禁止解析错误message决定可重放 |
| gateway server L566–575、L688–698 | 活跃client存在但event已无pending或不属于delivery时也返回 `ok:true,value:undefined`。重复ACK不代表重复业务；空成功值不能当business receipt |
| gateway server L639–667、L585–607 | eventId是随机UUID并保存在pending；新client流重发仍pending frame、clientId另生成。只据此跨generation关联，不据提示文字/题目id/顺序猜身份 |
| gateway server L691–727 | winning delivery在settle前被移除；finish向其余delivery发只含eventId的cancel。cancel没有“谁答了/为什么结束”的证明，UI只能称远端结束，不能显示本地答案已生效 |
| uiSession client L160–175 | 域销毁先撤掉可见项，再await每个delegate。若delegate等UI-ACK完成而Gateway dispose又在等listener，会形成第二种销毁环；必须分离 |
| question client L175–187、L475–495、L550–557 | store只留一个requestKey/progress；新PendingQuestion递增key。旧回调clear有key保护，不能简单给重呈现复用旧key，也不能用同题文字匹配草稿 |

## 3. 拟新增内部契约（仅当前JS realm，无wire字段）

在Gateway的 `user-questions/request` waterfall request上用固定内部Symbol（拟名 `Symbol.for("harness.question.delivery.v1")`）注入只读handle；构造在wire frame严格解析及agent Context resolve之后。不从wire扩展字段读这个handle，不序列化它，不替换request原`agent/signal/questions`。其他Remote事件行为不改。

handle拟有：版本1、Gateway实例opaque ownerToken、当前target Context引用、eventId/agentId、generationToken、clientId、一次性attemptToken、`subscribeDelivery(listener)`和只读`getDeliverySnapshot()`。subscriber只能观察，不能resolve Gateway、提交业务或修改身份。每次callback均含精确attemptToken；listener调用不await、异常单独隔离，不能改变协议任务成功/失败。终态先落一次，再同步通知；晚订阅能读取终态，防订阅竞态。token为本地对象/随机nonce，不冒充已存在的服务端幂等键；wire请求及rpcId产生/校验仍由原Connection负责。

拟状态仅描述交付：`editing → submitting → transport-acknowledged | unknown | remote-ended | owner-disposed`。generation中断在尚未作答时用 `interrupted-before-answer`；没有通用 `safe-to-replay` 状态。`transport-acknowledged`仅在原RPC成功**解析完成**、`response.ok===true`、本attempt仍current时触发。所有HTTP错误、envelope/rpcId错误、超时、发送后断线默认unknown；不得仅凭503把它升级为确定未交付。

### 无死锁的顺序

1. Question同步锁本carrier并保存最新draft。`PendingQuestion.answer()`先settle原`result`（保持lossless JSON答案），**返回另一份**由delivery通知settle的UI promise。
2. `answerQuestion`收到原result立即return，让`dispatchWaterfall`结束；只释放listener-completed，不在finally移除一个已提交且由有效handle接管的UI。未接管/委托/构造异常仍执行原清理。
3. Gateway `answer()`到达真实RPC；成功或异常都先终结handle状态，再保持原throw/恢复逻辑。UI observer独立更新/清理。UI promise不是Gateway返回值，也不是listener-completed。
4. 域delegate：未作答时保持原`pending.delegate()`→`next()`；已提交时只解绑UI、标记owner-disposed并完成本地cleanup，绝不再delegate已提交答案或等网络。域清理等listener退出（有abort保证），不等UI promise/未来generation。
5. `remove`、unsubscribe、timer清理、UI promise completion、listener-completed各自once；终态之后旧callback不得写新carrier。插件/Context销毁在有限时间内完成，即使RPC永不返回。

拟为每次**问题结果RPC**增加30秒等待上限，用单独AbortController与现有signal组合；到期先unknown，再走原generation failure/recovery，不重发。此数是待验设计常量，不是现有超时、SLA或WAN测量。dispose会主动settle未完成handle；不能仅注册一个永远等不到的callback。计划审批面板也经同一PendingQuestion/交付状态门保护，不能在新呈现时自动代用户再次批准。

## 4. 草稿身份、恢复门与有限资源

Question插件拥有一个本实例内存registry（拟新增），不放Gateway全局、不落localStorage/磁盘/日志。键必须包含：Gateway ownerToken + 精确target Context对象 + `ctx.sessions.scopeOf(owner)`的真实返回值 + agentId + eventId + event名。Gateway target必须与监听器`this`同一Context；scope不存在就不恢复、不猜session。每记录同时绑定完整原questions的规范结构（所有字段、题/选项顺序、标签和计划内容），精确比较；fingerprint只是辅助，不单独作为身份。

每个**尝试**还绑定generationToken、clientId、attemptToken；这三个不能混进跨generation稳定键，但所有异步更新必须检查它们。新的PendingQuestion保留新render key；从匹配registry取得`initialProgress`，不能复用旧key或旧promise。每次同步draft变更都更新本carrier的独立不可变progress，再写store；延续旧维护版progressRef和WeakMap同tick锁。

允许恢复的全部条件：

- 新generation已通过原ready/frame解析；同一Gateway实例、同一target与真实session、同一eventId/agentId/event名，题结构完全一致。
- 旧尝试为unknown或interrupted-before-answer，仍在有效期；新frame是服务器当前重呈现，**不是本地计时器合成**。同generation重复event拒绝并使该generation失败，不能悄悄覆盖active controller。
- 替换只撤去旧carrier自身的UI/订阅；旧record退休且nonce变化，新carrier恢复选项但不调用answer。提示“问题已重新到达，已保留选择；请确认后重新提交”。
- 旧尝试若已acknowledged、remote-ended、明确丢弃或owner-disposed，不恢复。同文字但新event、新session、新Context、新Gateway实例均视为新题。

registry建议硬上限：每owner 32条、全插件64条、每记录规范题结构+草稿合计64KiB、总1MiB；仅恢复缓存自中断起5分钟，不滑动延长；活跃编辑不是5分钟自动过期。超限拒绝缓存而非截断答案，给出“本地恢复草稿未保留”提示；原提交仍遵守原答案校验。定时器一份最近到期调度，淘汰取消listener/timer且不持有旧pending/React闭包。纯数据size界限与UTF-8字节统计需新测试，不能把JSON字符串长度当字节数。

成功回执、真实cancel、明确本地丢弃、Context/插件销毁清理记录；普通切换可保留在原真实session内，绝不展示在另一个session。unknown卡只读、无提交/远端取消按钮；允许**纯本地**“收起提示”，不调用已settle的`pending.cancel()`。新题到来应优先展示，旧unknown不得长期挡住composer；其短期恢复缓存仍按身份/期限管理。到期说明“回执未确认，草稿已过期；请查看会话结果”，不自动重试或声称成功。不要把“当前流没有该event”当已成功证据；没有完整snapshot-end/receipt查询协议。

### 关键竞态

| 注入/动作 | 必须得到的结果 |
|---|---|
| 350ms回执延迟 / body解析再延迟 | 卡仍可见且明确busy；输入/提交锁住，raw result早已交给Gateway；解析成功后才结束交付UI |
| 明确夹具pre-dispatch503 | 客户端先unknown；新流重呈现同event后恢复完整draft并允许显式提交；总受控业务仅一次 |
| 已settle后wrong-rpc、响应丢失 | unknown、原attempt不重发；无新pending frame就不出现可重试按钮。HTTP头成功不够 |
| 用户双击、同tick更改后提交 | 同carrier只settle一次；最后同步draft进入完整答案；plan review同样不能重复确认 |
| cancel与RPC终态交错 / 非本客户端完成 | 状态机once、远端结束不伪装成我的selected成功；原真实结果行决定业务呈现 |
| 新generation复现后旧finally/ACK/timeout到达 | token与controller对象身份不符则no-op，不clear新key、不delete新active、不清新草稿 |
| 同event但错client/generation/agent/session/fingerprint | 不恢复、不提交；保留原服务器client归属校验及Connection rpcId校验 |
| domain teardown / next委托 / dispose时永不返回RPC | UI/待决promise/监听器/timer有限退出；不等未来ACK，不向next重复交付已答结果 |

## 5. Installer精确责任及安全门

**待批准的维护文件**：新增 `scripts/deep-audit-question-delivery-patch.mjs`；修改 `scripts/patch-official-runtime.mjs`。旧 `scripts/deep-audit-question-card-patch.mjs`及publication helper不改：新模块用其纯 `patchQuestionCardSource`把base先组合到已证明的旧维护版，再做delivery v2；不删旧竞态保护。

**生成目标**（仅正式temp安装器发布，不手改node_modules）：

- `node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js`：限定上述handle、`pumpEvents/answer/dispatchWaterfall/dispose`的交付通知/清理；重复frame检查和active删除须对象identity保护。
- `node_modules/@deepseek-ai/dsh-client-ui-user-questions/lib/client.js`：`PendingQuestion`两promise、`answerQuestion`两种completion、QuestionFlow/PlanReviewPanel交付展示和草稿registry、成对zh/en消息。

gateway **server**现hash `c69e…156f8a8`确属13项native列表；Connection client现hash `1b8e…3308257`也在列表。均保持原字节；`OFFICIAL_ALPHA5_CAPABILITY_ARTIFACTS`的13项、完整文件hash、anchors、包身份/版本、已退役artifact不存在检查全部不减、不加marker豁免。Gateway client不在旧13项中，故必须**另加**完整companion预检，不能声称旧13门已覆盖它。

推荐installer实现为新增组合入口（拟名 `patchQuestionDeliveryRuntime`）与配套完整预检；它先执行现 `assertInstalledAlpha5RuntimePreflight`（question身份/版本/完整hash + 原13门），再验证Gateway manifest和完整client文件，最后在内存同时生成两个最终文件并验证两个完整输出hash。正常CLI在L3534–3535附近的**第一处写入之前**完成这套额外预检；L3571的最终question阶段改为组合入口。新isolated install必须调用同一组合入口/预检，不复制简化安装链。

Q允许输入只可为：官方base `232a66…664df6`、旧完整维护版 `6f382a…9457`、经独验得出的Q-v2完整SHA。G-client只允许当前base `55dbd5…950cd`、经独验得出的G-v2完整SHA。**v2 SHA当前未生成，不能填虚构值。** question原预检增加精确Q-v2项以支持重跑，旧13门不动；新增Gateway-client预检也不能只看Symbol/marker。所有包仍须精确alpha.5身份；未知hash、缺companion、混版本在任何写入前失败。

任意已知整文件组合（Q-base/Q-v1/Q-v2 × G-base/G-v2）可由离线installer收敛到唯一final pair；这只处理跨文件写入中断，不授权混合版本运行。先准备全部文件，逐文件调用既有 `writePatchedRuntimeFile`，保留CAS-read/exclusive lock/temp fsync/rename/失败清理；最后再次核对pair。它不是跨文件原子事务。中断原样报错，禁止启动/发布，下一次精确重跑完成；不回滚其他人的修改、不删竞争锁。

运行时对缺失/版本不匹配的内部handle不等待不存在的promise，不凭题目内容恢复缓存；可以保留旧行为并标明交付反馈不可用，**不能把混合pair算修复成功**。部署/独验必须证明两个client来自同一完整final pair。若要求混合pair也fail-closed禁用所有答题而不是旧行为，需要额外可发现的客户端能力握手；当前没有该接口，不在本次最小设计中伪造它。

旧installer测试有硬编码旧Q最终SHA和CLI接线文本（L14–17、L49、L65–69），且旧fixture只复制gateway/index.js不复制client.js。因此不能声称原安装测试未经调整就覆盖新companion门，也不能放宽新门迁就旧fixture。旧文件保持冻结、按旧输入作为历史oracle；新版本安装测试单独绑定新完整pair与正式入口，旧44条的交互不变量在新版本重新执行，而不是重写旧hash让旧报告“继续全绿”。

## 6. 后续执行与验收范围（不是本轮测试结果）

只建议以下新文件范围，须root另授写权：`tests/deep-audit-question-delivery.test.cjs`（完整客户端协议链/交互），`tests/deep-audit-question-delivery-install.test.cjs`（精确安装），`tests/fixtures/deep-audit-question-delivery/`，`.artifacts/deep-audit-question-delivery/`，`docs/deep-audit/question-delivery-repair.md`。不复用或改写原round3-mobile-ui run目录。

1. 从缓存全量正式文件建立新fresh环境，拒绝网络/native/敏感能力先于产品加载；新模块import无CLI副作用。两目标先证明精确可逆与新SHA，再安装；原13文件逐个前后hash相等。
2. 在同一真实Gateway/Connection/parser与Question组件链执行第4节矩阵；增加真实UiSession domain释放，不用理想ACK状态机；回执点必须在Connection parse/rpcId后。UI callback抛错不能制造第二业务调用；一次事件有多个listener的next路径必须退出。
3. 安装正例包括Q-base/Q-v1升级、final replay零写、两文件写中断后收敛；负例包括版本/身份/单字节/marker相同但hash未知、缺Gateway client、输出篡改、竞争写、每次写失败/残留lock、旧13任一失败→零写。全量实际输出，不能用小字符串假包替代正式gate。
4. 旧44是draft/同tick/触摸与局部pending行为oracle；新12是旧缺陷的真实协议链characterization，修后应针对“卡提前消失/草稿清空”的断言反向变化；它们不是“56项用户功能”。新测试自有明确条目、样本、边界，不伪造旧报告重新通过。
5. 保留真实selected结果解析的分段验证，**实际session projection、Android生命周期/Java桥/WebProxy/WAN仍未验证**；大同步快照负载与尾延迟仍不得从n=1受控延迟推断。未来如测性能需同一renderer时钟和单独样本/排队定义。

UX仅沿现有样式加 `role=status` 的“正在提交 / 回执未确认 / 已恢复选择，请确认后重新提交”，依delivery状态控制disabled，不只靠变色；支持键盘与窄屏固定操作区，不加入通知动画或改布局。参考本地UX库“Forms / Submit Feedback”（明确loading后显示状态）；这是设计建议而非视觉验收。本轮不访问被禁止的GUI预览，仅文本结构审校。

**总审决策点**：批准上面的两client产物与两个维护脚本范围后方可实施。接受“transport-acknowledged≠business-winner”的明确上限；若不接受，停止客户端补丁扩大，单列服务器receipt协议及13native-proof迁移任务。当前交付只是一份可实施且边界明确的方案，不是两个问题已修复。
