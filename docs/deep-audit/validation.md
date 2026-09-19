# 全功能独立验收（阶段交付，非全产品通过）

> 必要限定修复的独立验证已完成，待总审最终汇总：FIFO41/41、alpha兼容加core13/13、移动分页/PreparedSync联合链及问答正式temp组合均有新证据。冻结口径：598域细项中104项有限接受，10条当前记录、9条历史stale、0partial；另494域细项和115个宽泛用户操作聚类并未整体验收。唯一2929全量仍为2889pass/7fail/33skip，绝不倒填；没有再次全量、JVM77、旧Teams623、真实GUI／设备操作或发布。具体计费层、真实安装范围、未执行矩阵与原生复制粘贴限制见下文。

## 最后组合：问答正式安装与移动HOL

### 问答实际临时安装

`acceptance-question-install-review-v1`：8文件 **122=119pass+3原alpha.2 skip**，45.294s，0fail/cancel/parse/source/test/audit drift，67个明确直接输入前后不变。TAP SHA `297cfcb324d7b3108b5bcc2d3537521001b3945bb5b3896c6258c0edaad2a72b`；事件 SHA `eedaf7f3f640ebae61110b045ce46ad863e023e2cb389fbd90cda85753ead51c`；精确记录 `question-install-independent-acceptance.json`。

- 当前installer完整SHA `cecd16cc8ddd9627be92170c038a7a0c6ad4b904c30a9b71cc5a86cbbf5034b4`，问答输出唯一 `6f382a535cb182b062365773c57b23579e8195c0096901c1864c0b1ae0079457`。
- 同一必经完整gate先验问答包及13项native，再执行相关visibility/provider/marketplace/imageQueue/core/question组合。缺包、错身份/版本/hash在任何维护写之前拒绝；真实writer锁冲突和rename故障保持旧文件并恢复。重复组合字节不变。
- 实际临时安装文件在独立Chromium执行原44项细分断言，明确禁止`patchModule`和二次内存transform；三题selected回执、旧分页闭包、busy、重挂载/取消/skip、实际44px目标仍通过。44不是额外44个Node tests。
- 当前组合仍输出core `30f413…0066`、provider `28a785…0207`、marketplace `bba241…6bde`。新8文件里的core28是原测试模式；先前实际安装26运行行为＋1provenance＋1纯transform证据仅凭完整相同产物SHA及未变输入重用，不伪称新执行了26个实装案例。
- 正常CLI只做必经接线检查，实际执行的是完整相关临时组合，不是整个CLI、实际安装更新或部署。真实Android原生丢触摸仍未复现/归因。验收wrapper曾抄多一个hash字符，在dispatch前拒绝；更正后才执行这次测试，无产品修改或旧红覆盖。

共享installer使旧RUNTIME-2/MODELS-2/SESSION-CORE-2/CORE-INSTALL-1失效；新增RUNTIME-3/MODELS-3/SESSION-CORE-3/CORE-INSTALL-2绑定新组合，旧034及原始证据不改。没有增加域行或用户需求。

### 移动同层比较与缓存边界

新独验目录 `mobile-hol-v1/run-2026-09-12T19-31-25-867Z-402f8a`；记录 `mobile-hol-independent-acceptance.json`（SHA `6f1620e684894ff1978fdeabdf44a1dec96f579083fceb33d0424c3216e7ff83`）。**61命令=60ACK+1预期断线**，非额外61测试；60成功行各13点/12段重新计算一致；上行153/153、下行107/107，无丢重/同流乱序。42绑定行实际为34不同源码，107实际CJS文件及明确依赖无漂移。

| 相同506112B／1400会话，6并发 | 原整包 | 31页拉取 |
|---|---:|---:|
| ACK P95 ms | 7808.549 | 334.032 |
| 注入下行队列P95 ms | 7737.762 | 256.677 |
| 完整下载ms | 7846.440 | 11985.768 |

同run正文SHA `81cb813fd7832ee6e4f1a42274169a6469820b8b1f9fcd4c6926093bc9e26b10`。分页prepare98.735ms在generation门外，atomic commit0.840ms门内，总耗时12089.426ms。真实分页失联111.547ms以503结束，旧缓存字节不变；最多1个有界遗留transfer在stop/TTL释放，最终所有stream/transfer/start=0、cleanupErrors=[]。

**64KiB/s按relay传给mobile的二进制WS消息payload Buffer.length计费**，含路由外包和AES-GCM密文，不是解码HTTP正文；发生在`ws.send`之前，因此不计WS帧头/掩码、TLS/TCP/IP/链路开销，非binary控制消息不纳入预算。上行只有FIFO30–46ms抖动，下行另加相同抖动。整包/分页模式实际下行binary总量508750B/534062B，包含各自交互/控制binary，非纯正文。整包≥400KiB、分页≥8KiB真实排队屏障不同且明确；这是同层受控消息调度比较，**不是物理公网带宽模型**。完整下载变慢是明确代价，旧200及其它大流HOL仍存在。

31新JVM检查、9新HTTP原生具名case、7旧manifest、7旧cache均通过。首HTTP隔离run因fixture清除NODE_TEST_CONTEXT，只产生1外层file-pass但原日志列9；另以直接node:test原生reporter捕获同9事件（SHA `9344722e68991bbbaf18bc9721ceec35721553eceafe7c1bf6e755deb2d8638c`），未改assertion/env/fence，也不计为10项。26生产Java源码在SDK35及真实缓存依赖编译；API26检查147个Java成员、0不支持，2 compiler bootstrap另经D8；DEX038/328908B/SHA `d45e39cc4fe7f66d3d019b05ab04b019029f3ef0dc9cb240ca9429db931c1d6f`。含R/BuildConfig占位，不是资源/Gradle/APK验证。MainActivity生命周期只有源码＋编译；未把纯JVM缓存线程屏障当成Activity运行。16真实网络格仍0执行。

## 历史问答组件候选独验

`acceptance-question-card-final-v1`：3顶层tests全部通过，81.740s，0skip／parse／source／test／audit drift；额外24个直接输入指纹一致。基线43条具名观测有意验证旧错误，修复44条具名观测验证预期行为；它们不是额外87个tests或用户需求。最终输出`6f382a535cb182b062365773c57b23579e8195c0096901c1864c0b1ae0079457`，e354/d63过渡候选不接受。pager审查后新增多题Next／Previous、相反旧回调、busy、旧Continue/Skip边界实测；真实Consumer→UserQuestionService→本地waterfall→PendingQuestion三题回执为多选两项／单选一项／显式skip空数组，presentation移除一次。coarse Skip／Continue／Submit真实layout最少44px。

完整观测见`question-card-independent-acceptance.json`；log SHA `2a3d24e953ecc4fb955fcfb0b1c8b668f3d6fdc54d49e74baf00fdabc0c5e242`。这是实际组件＋合成Electron/原生桥替身，不是真Android View/WebView、60131或真实工具调用，也未复现用户原生丢触摸根因。**这是当时的组件候选结论；其“正常安装待验”已由上方新组合独验接续，旧034只留作历史。**

## 身份与口径

- 维护源码1.0.60，不是当前运行1.0.62；未修改/刷新/重启当前GUI。完整初始源码hash基线见 `.artifacts/deep-audit-20260912/source-baseline.json`，SHA256 `2c29d0e939957a0920830831bd724fd9ae504ca992250d5a4e5f9456b12dbc03`。
- 台账分层：115人工用户操作聚类、1394入口事实、617初始模块、598域操作细项，以及222官方安装包/36字面工具发现。不是需求数或覆盖百分比，安装存在不等于profile启用。动态路由/实际原生效果仍有缺口。
- 修复前17:50 UTC快照：103域细项在指定unit/real-adapter/synthetic-Electron层、精确当时source/test绑定下有限接受；10条记录含1条relay partial，另保留4条stale历史。计划22后的当前数以文首及JSON绑定检查为准。runtime/models/core由新联合130及actual-installed28重绑；files仅取最终全量精确通过子集，不接受同文件中的深Git红。新增1个core正常安装入口，relay抖动项因最终红暂停接受。旧hash/旧run不改，宽泛用户操作/入口不批量标绿；每facet具名绑定scope、case、hash及limitations。JSON `memberClaim`仍不是独立证明。
- 用户已确认**安卓App＋移动流量／外部WiFi多种情况**；两项最高优先需求另列P1：实时指令延迟、外网同步恢复。JVM77/relay38已限定独验，但完整端到端与真实公网体验未验收，不能用分段通过替代。
- 证据级别：static-review / unit / real-adapter / synthetic-Electron / e2e。明确不适用使用applicable:false+reason+not-applicable；没有动态证据不补pass。
- 这是并发脏树的before/after观察，不是不可变commit。原35失败、provider44/迁移4/MCP49、Teams60秒超时只作历史，不能算本轮覆盖。

当前scripts代码发现为103（明确顶层代码扩展名口径）：初始不可改快照只含92；另11个未在快照内包括4个维护helper及7个Python资源辅助脚本。后7项是发现盲点，不等于本轮新建或已验。基础原100和完整102 canonical SHA `81b601b4983db7975c534f56a6f41e34487dec2c590197acafc2e34932074347`保留；当前103在新runtime16中严格核对文件集合/唯一性/当前installer。JSON `currentScriptDiscovery`和`foundationCurrentScriptIndex`分别保留发现与分类口径，计数不是功能通过数。

## 最终Node基线与当前缺口

**唯一最终全量：324文件，2929=2889通过／7失败／33跳过，0取消、0超时、source/test/audit三类漂移均0。** ordinary312文件=2774（2737/7/30），performance12文件=155（152/0/3）。四个危险精确标题未执行，未计pass/skip。完整逐文件结果与失败分类见`final-baseline-summary.json`；原生file/name/status事件均parse0。真实Teams被本次全量枚举执行，没有独立再跑旧623。

| 最终7红 | 判断与处理 |
|---|---|
| ordered-jitter 24并发，reordered22 | 不是延迟阈值失败。额外保留原断言、每次synthetic schedule加明确0.2ms CPU停顿的单例诊断，reorder7；发送端已倒序，send/relay ingress/forward/desktop/ack/receipt六段完全一致，drop/dup0。证明fixture独立setTimeout不是FIFO；不冒称已修，也不把原始全量未记录的层序列补成已知 |
| 深canonical Git | `GIT_ADMIN_PATH_TOO_LONG`先拒绝；正向深路径仍不支持 |
| alpha兼容安装源契约 | 旧literal仍找`runtimeClient/hostApiProxyRuntime`；当前真实guard以显式nodeModulesRoot定位。需真实retired temp拒绝负例后校准，不仅改regex求绿 |
| v1.0.59安全与性能hash（2项） | 历史不可变证据与当前候选不同，历史不重写 |
| publication scan | `CHANGELOG.md`不满足旧alpha5发布快照；未执行发布 |
| Windows node-pty | 仍-1；既有诊断为guard拒绝原生未登记pipe，不能证明产品终端回归 |

此外，新的8文件联合验收130=127pass/3历史alpha2skip；原core28从**真实临时正常安装产物**加载后28/28，未二次VM transform，断言未改。两次均source/test/audit drift0。正常安装集成只是临时包/受控外部端口验收，未修改真实安装或GUI。

### Android物理矩阵及补充证据

- `final-verification-matrix.json`及master的`androidAppNetworkAcceptancePlan`记录16个物理网络计划格：移动流量/外部WiFi × warm/cold × 1/24并发 × 静默/320KiB共流；8类网络切换/断线/旧回执恢复。**这些格已执行数量为0**，不拿分段或合成结果填绿。
- 新合成链已独验：`pwsh-108`退出0；direct javac编译真实Java组件，走WebProxy→SOCKS→Wss/AES-GCM→真实relay→WssRelayAdapter→MobileSyncService/http-proxy→fake HTTP core ACK。原fixture仅在内存改artifact输出目录，断言/生产不变；额外绑定101个实际加载CJS模块/就近package manifest，所有源码/模块漂移0。49合成命令=48成功ACK+1主动断线无ACK，非额外49个Node/JUnit测试；上行DATA96/96、下行56/56，无非预期丢重/同流乱序，48成功命令全部13个时点及12段样本齐全。
- 6并发P95：normal72.835ms、FIFO抖动146.016ms、506113字节快照按64KiB/s共流7771.383ms，其中ACK注入下行队列7741.690ms；新WSS通道就绪后的请求28.570ms。快照7854.465ms、SHA `3dee0f73d6893229bb6aef1c9a009cc9b6c114271fccdfe2c1544ce61a3c7be3`。不混同320KiB计划约5s，也不是初始WSS/TLS/自动重连耗时或24并发。总耗时来自单个Java nanoTime；跨时钟校准offset1.186ms/半RTT0.304ms仅观测，不是误差保证，分段P95不可相加。
- 旧fake core在断線后确实产生迟到ACK，`downstreamDestroyed=false`，未串入新流；丢ACK不代表业务未处理/已取消，不可据此重放。cleanupErrors0/adapterStreams0，新的合成HOME随证据保留，未宣称删除。此链只有legacy protocol1，Context null/Log桩、无TLS/Android系统绑定/WebView/真实composer/RPC/LLM/QUIC/WebRTC。完整独验摘要`mobile-chain-independent-acceptance.json`；真实网络16格仍0执行。
- 最终Node输出同时保留TAP和原生test事件的file/name/status JSONL。custom reporter初次用Windows绝对路径被ESM当`d:` URL而code7（dispatch前、0tests）；改为真实file URL后harness-v2 **5/5**。再只筛一条已知原core baseline：真实`1!==0`断言，exit1及准确file-bound test:fail；不是加载失败或全部重跑。正负均event parse0、source/test/audit drift0，旧失败目录保留。
- 九契约经root正式接受rev4；此前独立67/67及search5桥接保留为历史。最终全量中9文件又实际执行67/67，原test hash不变，逐文件具名结果在`final-nine-contracts.json`，是2929的子集而非新增67。3移动旧契约也在本次全量实际22/22（Android6/Swift源契约3/P2P13）。不另开67或623专项，接受测试修改不等于实际原生功能全部通过。

### 实际协调边界（运行1.0.62观察，归因未定）

多次peer消息出现admission timeout；root已逐次可靠转交，已交付产物未因此丢失。`queued`仅代表接收转发请求，不当作模型已读。root另观察到相关任务均接受后，`team_status(wait_for_change)`仍因历史`failed_delivery`立即返回attention；没有`autopilot.status=active`的证明，因此**不承诺自动停驻续跑**。此为运行实例观察，尚不能精确绑定到已修候选源码。现有`teams-contracts-review.md`明确区分维护源码与运行1.0.62；不拿其623结果证明当前等待告警已修。未重发旧消息、未修改真实团队存储清告警，也不为此新开生产修复。

## 隔离与完整基线

唯一全量runner：`.artifacts/deep-audit-20260912/run-isolated.cjs`。

1. 子环境allowlist只保留OS必须变量，PATH重新构造；HOME/USERPROFILE/APPDATA/LOCALAPPDATA/DSH_HOME/TMP/TEMP全部新临时目录。不继承能力端点、会话标识、token、provider key、代理。
2. `offline-guard.cjs`只允许当前Node进程的`net.Server.listen`实际登记端点（包括精确命名管道），close撤销。外网、未登记loopback/pipe和当前GUI60131始终拒绝。NODE_OPTIONS传播给普通Node子进程。
3. 不是OS沙箱：native进程和主动清空NODE_OPTIONS的子进程不受该Node钩子约束，必须单独审核。原生PTY已独立捕获guard拒绝原生ConPTY未登记pipe（before-native-connect），不得改原退出码断言或宽泛放行未知pipe；该环境未验证生产终端行为。
4. 普通阶段并发4、时序阶段并发1；文件90秒/阶段15分钟上限，失败和skip分别保留。无真实GUI/API opt-in；仅已审阅隔离Electron fixture可通过特定mode显式启用。
5. 后续独立候选run记录测试前后hash与已发现所有当前生产代码（补含新脚本）/官方依赖hash。初版sourceIndex会漏新文件，已补Git当前tracked/untracked代码发现并复跑files-runtime-v2；不拿缺hash的v1冒充全候选绑定。

| 执行 | 真实结果 | 解释 |
|---|---|---|
| baseline | 测试dispatch前失败 | Windows ESM绝对路径未转fileURL；已修runner |
| baseline-v2 | 主动取消，部分输出 | 304普通文件启动后收到隔离事故告警；已kill/collect并核残留，不算完整 |
| isolation-proof | 测试dispatch前失败 | NODE_OPTIONS反斜杠解析；已修 |
| isolation-proof-v2 | 3/3 | 初次网络/环境/台账证明 |
| baseline-v3 | 主动取消 | guard误拒当前fixture自建pipe；非产品失败 tally。新增pipe登记/close撤销及独立正负例 |
| baseline-v4 | **320根文件，2800 tests = 2750 pass / 17 fail / 33 skip / 0 cancelled** | 普通308文件2645=2598/17/30；时序12文件155=152/0/3。全部自然终态；普通4测试运行时改动，仅阶段基线 |
| acceptance-pet-ui | 31/31 | pet5+守卫4+UI22；非全功能 |
| contracts-v2 | 71/71 | 9授权旧契约+隔离4；作者回归，另由总审安排独立审查，不自批 |
| acceptance-files-runtime-v2 | **206 = 201 pass / 2 fail / 3 skip** | 25文件；仅深Git功能与native PTY红。全部本域新修复行为通过；源码/test无漂移 |
| acceptance-interaction-v1 | **117 = 116 pass / 0 fail / 1 skip** | 14文件，27专属新例全部绿；1skip为Windows不适用的大小写敏感主机断言；源码/test无漂移 |
| acceptance-browser-v2 | 97/97，0skip | 含一条隔离Electron43.2.0测试中的14生产DOM组（不把97+14相加），4生产hash匹配，0漂移；v1为误写测试路径，dispatch前拒绝 |
| acceptance-relay-v1 | 38/38，0skip | 真loopback WS + fake-clock/transport；3组各24指令分段、丢重乱序0；保留低速FIFO HOL未修 |
| acceptance-mobile-node-v1 | 135/135，0skip | 9文件含21专属、device/broker/service/store和3旧契约，0漂移 |
| acceptance-mobile-jvm-v2 | **77/77，0skip/failure/error** | cached Gradle8.11.1/JDK21/SDK35，offline/no-daemon/no-build-cache/rerun-tasks；21任务全实执行、8fresh XML、实际main及test编译，0源码漂移。外层最后删临时HOME报EPERM(exit1)，不是JUnit失败；未绕过/重试删除。v1为CMD转义错误dispatch前失败，旧77XML全fresh=false不计 |
| acceptance-inventory-v4 | 5/5 | 最新570细项/76有限接受/7记录的全层结构与精确危险入口排除验证 |
| contracts-mobile-v1 | 26/26，0skip | 3授权移动旧契约22+旧隔离4，作者回归；见mobile-contracts.md，Swift仅源契约 |
| acceptance-inventory-v3 | 5/5 | 覆盖所有台账层唯一ID/具名证据、4个精确排除默认argv及禁止覆盖的实际dispatch前负例 |
| acceptance-terminal-diagnosis | 4=3pass1fail | 不改断言；只读观察独立证明原生PTY被guard在connect前拒绝，原失败保留 |
| acceptance-models-final-v1 | **109=106pass/3历史alpha2skip** | 6文件，同一个BBA市场候选：真实temp installer17、配置handler40及runtime composition/web-search/integrity；4危险入口强制排除，0漂移，实际installed包仍原F935 |
| acceptance-session-core-baseline-v2 / candidate-v2 | **25/28三红 → 28/28全绿** | 四个真实client bundle，原始3红=1queue订阅释放根因，VM纯transform候选未接installer；所有client与test前后hash无漂移。v1同结果但source manifest只收集了index.js，未含4个client.js；v2补齐后重验，不虚报v1为完整源绑定 |
| acceptance-inventory-v5 | 5/5 | 当时597细项/103有限接受/9记录的结构验证；随后真实hash检查将9个runtime项降为stale，不追改历史run |
| acceptance-inventory-v6 | 5/5 | 当前597细项/94有效接受/8有效记录+1历史stale；log SHA256 `84d2ce9d5c0bb0d63b708b6564d3f37f2010f7d4020ad46feafe320883872428` |

| acceptance-models-runtime-core-final-v1 | **130=127pass/3skip** | 新正常installer5+runtime16+市场17+models40+相关composition/search/integrity；全部独验无漂移 |
| acceptance-session-core-baseline-installed-v1 | **28/28** | 真实temp正常安装输出30f413…d0066，原28断言不改，只把runtime load指到真实temp文件；第二次VM transform关闭 |
| baseline-final-candidate-v1 | **324文件，2929=2889/7/33** | 唯一最终全量，当前Teams及9契约包含其中，三类漂移0；7红逐项保留 |
| acceptance-relay-order-diagnostic-v1 | **1fail（原断言）** | 明确0.2ms受控调度停顿，发送端已经乱序7，后续5段保持同序；仅定位fixture，非公网基准 |

所有run目录在`.artifacts/deep-audit-20260912/`，含完整log/manifest/result；不能相加重跑数制造覆盖率。最终全量在基础FINAL_READY后只执行一次；后续限定诊断或文档更新不追改该run。JVM77明确reuse/not-rerun，不计本次2929；新增Java＋Node合成链专项仍单列。

最终相关SHA256（完整证据，不用重跑数相加）：

- final ordinary log：`65607c8b1a9a09f1991ac22e6580ce7dd2674642b03b7e6ba6855e8ce548bfe3`；events：`8ea52cacc8d22ae922ee6d9c17f4f9fb5526a4472e315559415dd29af030b9b0`。
- final performance log：`22bb114e70412f5bd44df9ba96948c261fdc4cf454c3a65e006ec93b55b54c09`。
- 联合130 log：`e3c77bdb987083f0d4370aaa7091c769f257d33f6d5c77005682c9b10b012fff`；events：`98d7eef37797dd06b226c584df67d8cfd6349de896c8c6940b4ae635cc56bd86`。
- actual-installed28 log：`02841b470d4c4358be94d67fabbe4fb082ed5a22896d328a78d3ea7e6ba9640a`；events：`779c7c9b78a68d3df2d3a55777b3d27dc84529f6552f4ffd80daf3fe56c460fe`。
- relay-order diagnostic log：`d916243dc84214b2263a90d680c7310cd954587c0d3c7bb69d6d7faf5cb0b993`。

历史关键日志SHA256：

- baseline-v4 ordinary：`b2f5c3fefd74e1ab7e4db7fc75528ce6fbdf627e8b038cd6139115f567f928d2`
- baseline-v4 performance：`da267f650f72578389fb6d15b29b7d63009ea1cdadbf76517578bdf2da74e8b2`
- contracts-v2：`cb43072b6ad22a7c0a12f5a1208d533056e9985ee7703ad35eb66a9c7eb908a4`
- acceptance-files-runtime-v2：`d4b0c05e79ec14a7ab4f6dc8644b15edfc40222afb6e34656721295211c642e9`
- acceptance-interaction-v1：`3e81ff2f83930c45586b267fc15a492f422b47d71db6c81939156396d4c2fff6`

### v4失败归因，不是17个全部产品bug

- 9授权测试文件10项版本/焦点契约失败：现动态源/目标manifest与真实生产动作顺序证据修复，见`contracts.md`；非简单换版本常量或删安全检查。
- 3项`official-followup-hermetic-acceptance`历史审查hash/发布扫描绑定漂移：保留历史，不改hash涂绿。候选需新独立审查。
- `desktop-android-shell`、`mobile-ios-lifecycle`加上后发现的`native-p2p-desktop`共3个旧结构断言已按新授权校准并submitted。实际JS函数/完整P2P renderer+WebCrypto验行为，Swift仅明确的源契约；两项精确readFile故障注入实际红证明payload/late-close断言敏感。详见`mobile-contracts.md`，作者不自批测试提交。
- `deep-audit-session-files`深Git真实行政路径失败：当前前置`GIT_ADMIN_PATH_TOO_LONG`防止部分写入，但不能叫支持深路径。
- `terminal-service`真实node-pty返回-1：普通和独立25文件均复现；现独立观察到`AUDIT_NETWORK_BLOCKED: unregistered IPC path`发生于`before-native-connect`。node-pty吞原error只发-1，不是生产回归证明。诊断log SHA256 `662286fb4aecc6be78d7a7f5ec3f10266d81d0f8380247516d90470803624cba`。

v4旧全量还有4个需后续显式排除的入口：installed MCP/Goal patchInstalled（两调用断言false通过，证明该次返回未修改，但潜在writer不应默认运行）、publisher plan/失败门槛/release-audit只读CLI。没有执行publisher run、真实发布或安装器。当前runner已强制4个精确名字的anchored排除，并拒绝调用者覆盖（任何dispatch前）；manifest明确not-executed策略，不掩藏、不算通过。基础成员后续100组兼容run也误带该MCP/Goal旧no-op入口：两次false及固定hash通过，真实写入未发生但潜在writer确实被调用，已保留记录；其随后过滤99组不是撤销前次记录。市场adapter始终只操作临时包。

新增日志：browser-v2 `27041756e449cef438ff35e71276782f08ba6621e0cede6ebecb08399c8b033b`；relay-v1 `7096a3e49843ebb063ae045af40d1b30bb4c88e566fbf33c9bbc79d058cfee2e`；mobile-node-v1 `82b0f463f4cc564b918f2cec8fab0363dbb0fea32e7118615434106054cf9ddd`；mobile-jvm-v2 `4ccbd996846438755b13af5b7283f4fc2c9b09ced551da7e4f9d92b0fb2859c7`；inventory-v4 `8a04e989448a9801c59eca9fde6f508b48b05a75c862ee64051452269a4a4faa`。

配置final log `e1fd6a8878ff060c782cae3e595360db6ed1404314f1b459c40a8ed96f8f54a9`；core baseline-v2 `2b93810a56d32c27d372419adacd904439f1cb52b27d932992f6ec580f402d74` / candidate-v2 `f2799a077d5ed0ff41ba471f5f7b67a96a3a0245dffded4b9d65121d1850164a`；inventory-v5 `359fe7f0ac82a93c7c7db6f4b51d90c10e9c0825232023ca20f3984d468655fd`。

## 已独立接受的有限候选

- **Pet lifecycle**：精确pet-window hash `6877568056f6b886ccd672087e890cf72bc08d648f60cb08e05ef53bd868a3c9`；5个假BrowserWindow/screen例。无真实原生窗口/多DPI证明。
- **Core/UI及正常安装**：12分层流程+1订阅释放；现已集成`patchInstalledSessionCoreClient`正常安装入口。4完整输入/输出hash对、精确包名/version、拒绝同形异hash和损坏replay、原子rename故障及100真实Lexical订阅释放有5项独验。正常temp链visibility→provider→marketplace→imageQueue→core输出`30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066`；原28中26个运行行为用例加载实际temp产物，另1个原包出处、1个纯transform契约用例分别保留原语义；所有断言未改，运行载入的第二次VM transform关闭。原测试a23e5b…cef759、改载入路径后的test5cf732…ed221及每个runtime路径在`installed-core-load-ivHDX3/receipt.json`；输入出处case仍报原包，不将其冒充实际加载hash。receipt标明child-v8、sourceDrift0和removed-own-temp。先前纯VM输出ad31c94…17e94仅历史。真实安装/GUI没有变；16可隔离/2只读/8平台的剩余缺口仍保留。
- **Models/marketplace**：14个限定组：meter缓存隔离/失效/并发，routing双文件回滚，memory权限前置，MCP生命周期，search/fetch边界，schedule，image输入边界及市场16路由/队列/环境值/替换/安装器。真实临时安装与40 handler均用output`bba2417fc236501badf532c76a85673410c5579a5e54d420565c02e963836bde`；原installed保持`f9352630e7fbb6d38647ff2fcf988cef071648f78166a9c09d65ba42e8ae7699`。不访问真实凭据/服务，环境恢复不代表OS跨文件瞬时原子或所有编码支持。
- **Session/files**：上传同名原子不覆盖及Windows名、来源百分号、短read、目录旧回执/同步throw、归档恢复和删除single-flight；7固定功能行有限接受。Git、unsupported-hardlink文件系统、实际剪贴板/媒体/官方会话全链不接受。
- **Runtime/storage（第三条记录）**：c7538f、710e8b、034cfd旧来源及test hash保留历史；新联合122包含runtime16、相关installer/composition和实际安装问答，当前CECD16…绑定RUNTIME-3。9个原限定facet不扩范围。脚本索引原100/102与baseline不变，当前103独验，与全球初始92发现快照分开；103不是功能覆盖率。仅接受授权关闭/半帧、组件CAS/中断/坏记录/bundled fallback、缓存竞争/IPv6/内容损坏等原限定情形，不能外推所有writer、断电、实际删除或部署。
- **Interaction**：实际注册9pet IPC、精确WebContents编辑菜单、IME/Escape/焦点、截图generation、桌宠手势/键盘/失败恢复、主题picker旧回执、壁纸身份清理。31操作facet有限接受，18真实端到端缺口保留。

- **Browser**：97/97含14真实隔离Electron DOM组，main所属legacy只链接已验交互片段；14个Playwright操作逐个有限接受。sidebar是实际DOM+fake Host，UIA是实际协调类+fake native，不外推media/dialog、原生剪贴板/真实UIA。
- **Mobile**：9个有界组，20个专属JS行为+14个纯JVM行为具名绑定10个实际源文件；设备切换/输入取消、跨会话上传、broker撤销、tool abort清理、异步P2P crypto、native API截图代次、Android route短锁/revision、legacy WSS生命周期和ControlCommand纯协议校验。不是77个原生功能全过。route受控6并发n30本次91/92/92ms，旧491ms基线保留；140次旧callback/profile周期和gated SOCKS证明迟到旧工作不能污染新WS。iOS后续核心方案未实施、真实机/WAN仍未验；manifest分页与缓存HOL受控证明另列，不混入这9个原功能组。
- **Relay（当前6个有限facet）**：旧partial/stale保留，新RELAY-2由FIFO41/41重绑6项liveness/close/隔离/write/有序受控测量。受控旧诊断发现fixture发出前已倒序，不将其反推为原全量22乱序的完整归因；生产server未改。默认20s+10s不是业务30秒恢复SLA。新增manifest HOL证据单列，未验证真实WAN/composer，也不代表所有320KiB大流都获公平调度。

`acceptance-registry.json`及master中的`independentAcceptances`记录逐生产文件/test hash，不把整个main diff归功本轮。当前4个旧UI测试验证了真实函数/实际local-target adapter，非只有regex求绿；也不等于原生剪贴板或Chromium编辑引擎测试。

## 配置成员记忆隔离事故（单列，不能被绿测冲销）

只读报告与代码，未调用记忆工具、访问真实端点/能力文件/私有库，未尝试删除或补救写入。

- 首次负面测试未fake fetch/清env：一次remember，合成项目内容、synthetic-root、无cwd；assert.rejects得到Missing expected rejection，返回对象未保存；suggest未执行。
- 维护插件仅据HTTP ok抛错/返回body；服务可返回stored:false duplicate:true或stored:true。fulfilled仅证明未抛错，**持久化结果unknown**。
- 源码推理不能证明运行1.0.62的回执。当前项目作用域提前拒绝已有受控能力端口独立证据；不以当前或历史绿测推断事故未写入。可能合成项仅由负责人依直接用户授权处理，验收者不访问私有库。

## 问题状态/所有者/后续

计划22两项新增独验：`acceptance-relay-fifo-independent-v1` **41/41**，log `c834dfcfbd7d0e40d9cbafc558f9671af09ede2e57e53cf3a0801da542f1b947`、events `8efd0f985d43fbedbc3276b21624d9a5f8652c2f6c04030cc70ef489e11b8931`；`acceptance-alpha3-independent-v1` **13/13**，log `5cc47949fc7046fe0a4c8a0127ee6ffe91fec6e22e88f1f9345b707757bce1f3`、events `448e1da0e6c0d0d9f03eb12cc23745dd651c5946de0aff769050d8bbeffd20aa`。两run均0skip/parse/source/test/audit drift。完整映射`plan22-fixture-independent-acceptance.json`；不是重新执行或改写原全量。

| ID | 严重度/状态 | 复现或缺口 | 所有者 | 后续 |
|---|---|---|---|---|
| MOBILE-LATENCY | P1 / 合成legacy链已验、真机未验 | JVM77历史不重跑；新增6并发真实Java/Node组件→fake ACK独验，normal P95 72.835ms，不是真实composer/Host业务公网SLA | 移动+会话relay | 仍缺物理warm/cold/24并发全链、Host排队与回执呈现；16物理格0执行 |
| MOBILE-EXTERNAL | P1 / manifest HOL受控改善，真实公网未验 | 同层506112B/6并发P95 7808.549→334.032ms；门外prepare/门内atomic commit及旧cache恢复已验；分页下载变慢 | 移动+会话relay | 16真实格仍0；旧200和其它bulk未全局调度，不扩大为独立物理通道/业务重放方案 |
| RELAY-FIXTURE-FIFO | P2 / 夹具修正已独验，非产品修复 | 41/41；24同批入队、每次0.2ms扰动八层保序、单timer早醒重arm；真实出口交换0/1后原健康断言确实抛错 | 会话，root接受rev4 | 旧全量乱序22及受控诊断7仍保留；没有修改生产server60b239…或旧日志 |
| INSTALL-SOURCE-CONTRACT | P2 / 契约校准已独验 | 13/13；复制13当前能力包，三退休残留各自真实拒绝／全树无损，错误identity/version拒绝，合法core唯目标改变及重复false | 基础，root接受rev4 | 当前alpha5拒绝旧残留，不声称运行完整alpha3或生产自动清理；034历史冻结，新CECD16完整gate/temp组合已独验 |
| MEMORY-ISOLATION | P1 / outcome unknown | 未捕获一次remember结果，见上文 | 配置+总审 | 不重试/删库，负责人处理 |
| GIT-DEEP | P1 / fail | 专属合法深路径，bundled Git '$GIT_DIR too big'，现在前置typed-error | 旧队Git | 保留真实正向红；独立支持策略或可操作设置提示，不能缩fixture掩盖 |
| NATIVE-PTY | P2 / 环境blocked，原test仍fail | guard拒绝ConPTY原生pipe，before-native-connect→exit -1已独立确认 | 验收环境 | 后续精确native fixture能力登记或OS隔离；不改0断言/不放宽未知pipe |
| UPLOAD-FS | P2 / blocked | 硬链接原语不支持/权限拒绝时不上传 | 会话 | 保留无覆盖、清staging、明确重试指导；跨平台无覆盖原语待产品方案 |
| STORAGE-DELETE | P2 / blocked by safety | 缺可信exact-object递归删除，当前0删除 | 基础 | 不把安全拒绝当实际清理成功 |
| HISTORICAL-HASH | P2 / fail | 3项历史hash/扫描不匹配候选 | 旧验证/总审 | 历史不改；新候选精确独立审查 |
| REAL-PLATFORM | 未验证 | 真GUI/clipboard/读屏/多DPI、iOS/真机、付费API、发行 | 各域 | 另有明确范围及环境时验证，非本轮完成证明 |

提交给总审的是有界、可追溯的源码修复验收和缺口台账，不是“所有功能已全部正常”。最终只读账实核对见`final-ledger-post-repair-verification.json`；原17:50的`final-ledger-verification.json`保持历史，不覆盖原回执。
