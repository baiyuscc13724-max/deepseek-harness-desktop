# 第三轮补验计划：授权恢复与执行记录

## 当前状态

用户直接授权“按已保存的第三轮补验计划继续，维持原安全限制”后，原revision4计划成功提交。手机与布局作者证据、独立复核及最小修复设计现均已接受。独验再次复现回执前移卡、503重呈现丢选择，证据gate 47/47；用户截图白栏仍未复现或归因。补验及设计阶段未修改生产；随后限定的两客户端修复候选、安装/UI独验与最终整合均已接受。总审另行只读复跑证据门73/73、核对四份最终清单摘要，第三轮团队已正常关闭（8完成、1被拆分替代的取消项）。这仅是限定候选与证据验收，不是全端用户问题或全项目验收。未发布或替换运行版。

为落实原计划“实证后限定最小修复”，先完成只读设计，再持久化一个两客户端修复任务及其独立回归任务。随后独验成员提出安装安全/UI协议分流；原宽scope在无文件或run时取消，改为两个独立流及依赖两者的窄整合任务。计划revision10已按精确hash重新提交，来源仍为human_attested；目标active/armed、revision9。最初3项，后来增加6项，共9个持久任务含1个被替代取消项；只是原修复验证重新分工，不是新增用户功能范围或覆盖。原布局成员完成后正常退休，未复活旧任务或扩大到服务器协议。

首轮成员登记窗口提示通过Host已published后的跟进通知解除，未重复创建成员。以下保留先前阻塞历史，不代表当前仍缺执行授权。

## Goal第5轮授权拒绝历史

Goal第5轮自动续作读取到目标active/armed。已核前两轮边界并保存三个相互隔离的持久任务，但新计划提交被执行授权门明确拒绝：

```text
automatic plan recommit requires an established team or the exact pending Host Goal-round grant
```

团队创建/路由记录被接受，不等于成员执行已获授权。计划保持draft revision4；没有成员发布、任务claim、新增产品测试或生产变更。没有再次提交、改走bootstrap/隐藏代理、复活已关闭团队或由总审接管核心工作来绕过拒绝。该拒绝不是产品测试失败，也不证明技术方案不可行。

这次新阻塞在本轮首次观察；不能把前一轮已经恢复的历史授权阻塞拼接为连续三轮。本轮未将全项目目标标记完成或正式blocked，也没有手动resume来伪造新授权。

## 已保存的工作边界

| 工作 | 新增证据目标 | 仍不得声称 |
|---|---|---|
| 手机选择题与回执界面 | 实际维护后的问答/移动前端与真实协议处理组件，测UI提交至受控回执/DOM呈现，覆盖旧卡、重复、失败恢复和窄屏可达 | Chromium替身等于Android WebView/Handler；受控ACK等于真实业务执行；本地时延等于WAN |
| 正式AppFrame嵌入壳 | 用真实官方对话组件替代第二轮合成guest，验证壳/Shadow DOM/webview/内容/侧栏边界及取图扰动 | 稳定浏览器几何已修等于首页持久白栏已归因；强制取图恢复等于无故障 |
| 独立复核 | 依赖前两项由总审接受后再执行，独立复跑、来源/计数/时钟/隔离与负证据门控 | 报告自证、整个USER完成、旧source pins可静默改绑 |

仅允许新测试、fixture、报告及专用artifact；先证据后按缺陷另定最小生产修复范围。封闭loopback仅可用于逐项登记的合成测试端点，其他真实服务、网络与端口全部拒绝；不得启动真实dsh Host或执行真实模型/能力。

## 与既有交付的关系

- [第一轮状态](round1-status.md)：现行RemoteReconnectController已获得真实JVM timer→新握手→新请求ACK有界证据；不重做已完成的owner提取。Android Handler/Activity/Doze/WAN仍未验。
- [问答安装报告](question-card-install.md)：现行问答包44项真实Chromium检查成立，但Android bridge是替身，不能视为Android Java/View/WebProxy端到端。
- [第二轮状态](round2-status.md)：三修复已有独验；原生侧栏91/91及三源组合6/6不包含正式AppFrame；预览两次47/48时序红、设置两契约、持久白栏仍保留。
- 第二轮统计首版曾被退回，须同时保存原freeze及`review-rejected-v1/mapping.json`，以已接受v2为现行证据；不删除错误历史或修改旧pins。

## 第5轮只读完整性核对

直接用Get-FileHash逐项比较预期SHA，6项全部匹配，命令退出0。这只是指定文件完整性，不是新增产品通过或全树无漂移证明。

| 文件 | SHA-256 |
|---|---|
| `electron/main.cjs` | `74ea22e9b158dd34fb244d8dac6f0b91dd5a9e873e1017c8d26e597cbb8d24f9` |
| `renderer/right-workspace-integration.js` | `bf81102462e8802fbc9520826271886a6822077bd23e4a5bb67665a66a1e2eb8` |
| `renderer/app.js` | `560354dc1ce1f365473da3068c75f0dec8ff08b46c03fe0a5b9fd1c03d7bdb65` |
| `scripts/patch-official-runtime.mjs` | `cecd16cc8ddd9627be92170c038a7a0c6ad4b904c30a9b71cc5a86cbbf5034b4` |
| `docs/deep-audit/coverage-master.json` | `8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794` |
| `.artifacts/deep-audit-round2-fixes-acceptance/final-freeze-v2.json` | `62f41c0c1c1f863c7cec76c0e9865ede16b28f76578e2f51e1cc86fb66719512` |

master的实际summary仍为115 userOperations、104 independentlyAccepted、598 domainFindingRows；不能改称115自动覆盖/104阻塞，也不加入本轮测试数量。

## 第5轮恢复与安全约束记录

等待执行层出现有效授权后复用既有三任务与计划，不创建重复团队；在实际成功之前不得说测试已运行或后台工作已开始。用户无需补充诊断信息，本记录不请求账户、设备、密钥或权限降级。

没有真实设备、账户、配对、剪贴板、当前GUI、公网、下载、安装、发布或运行版替换操作；本轮没有后台作业。本文仅做本地结构复核，未打开禁止操作的当前GUI右栏预览。全项目审计目标未完成。

## Goal第6轮状态复核

本轮重新读取Goal和团队持久状态：Goal仍active/armed、revision7；团队/计划仍revision4、draft，计划hash仍为`ace1406099205903b0d8e76480f211ed2f63afcd88e6cce5722d750d162cc03f`。三个任务全部pending、attempt0，无工作成员、claim或提交结果；没有出现允许执行的新授权事实。

同一阻塞已在Goal第5、6轮连续观察两轮。本轮没有重试先前被拒绝的计划提交，没有调用spawn、另建团队、手动resume或接管专业任务；仅更新此状态记录，没有新增产品测试、覆盖通过项或源修改。尚未达到连续三轮的正式blocked门槛，目标保持active，不宣称自动工作正在后台执行。

## Goal第7轮与直接授权恢复

第7轮读取持久状态仍为同一draft、三项attempt0，连续三轮阻塞，目标正式记为blocked/revision8并停止自动续作。用户随后直接授权沿用第三轮计划及安全限制。

恢复先核对实际工作目录与原计划revision/hash；原计划提交成功，不重复创建团队。成功提交后目标恢复为revision9/active/armed，依序发布手机、布局两名成员；它们只获各自全新证据目录写入范围，生产和已冻结交付仍只读。独立复核任务继续受原依赖约束，不在作者输出前假称已验收。执行中的任何具体缺陷仍须先持久化精确修复范围再行动。

手机成员随后因internal/work_followup的SUBAGENT_ERROR中断，诊断为retryable:false且已有部分输出，未提交产品结论。总审按同任务定点替换，保留旧claim历史与现场；替补已经新claim（attempt2），没有扩域或重复创建整队。曾出现团队投影ready而实际子会话注册表running的状态差异，已在恢复边界核对，未重复启动正在工作的成员。

两条尚待验证的线索：手机真实PendingQuestion交付与HTTP回执先后可能不同于旧defer替身；正式AppFrame可通过受控props/slot挂载，但新guest的依赖装配首先遭过紧夹具CSP拒绝。均不是已经接受的产品缺陷。任何夹具策略差异只在fresh隔离测试里说明，不能修改产品CSP或算作产品安全验收；全部真实网络/权限/设备/Host隔离仍须先于加载。

## 作者交付与独验交接

- [手机报告](round3-mobile-ui.md)：作者两次fresh运行各12条显式检查，8RPC/8HTTP/7受控业务receipt/1旧请求abort/9呈现。真实协议链跨过旧defer替身，但结果DOM由测试驱动注入，Android/WAN/完整Host/大同步快照/尾延迟仍未验。两项交互现象已被作者有界复现，不称真机根因。手机handoff摘要`1545b7131b61f855f0a65926aa85f9a64cfc7ef59b6ddd5f841aee674d56c7cd`。
- [布局报告](round3-appframe.md)：作者final-v9/v10各148条显式检查；真实AppFrame和官方主题挂载，5.2/10秒无中间观测组填满1140px guest。2200ms观测干扰和v10的Chromium Widget诊断保留；没有native overlay/完整main及app启动，用户白栏仍开放。冻结807个文件，摘要`7cedd7c9d4a723ab96441ed25a8c6212aabf45c4edf6eadf86ea104d9be3c91c`。总审只读检查合成home PNG，不是用户原图复现。
- 上述均为作者重复，不是两个独立复核。原两项任务已经接受，独验任务随后claim；独验在自身scope内作可逆路径派生和fresh重跑，不写入已冻结作者目录。
- 总审重新直接核对前述6个旧关键文件与2个新handoff/freeze摘要，8项全部匹配、退出0；不是全树无漂移或新增产品测试证据。
- 中途一次团队relay发送发生admission timeout，保留failed delivery，不重试；手机替补已经通过直接通知接续并提交，不能把失败relay等同于任务未执行。新方案仅只读设计，待独验与设计收齐后再限定任何生产修复。

## 独验接收与限定实施

[第三轮独验](round3-validation.md)及`coverage-round3.json`已经接收：独立手机12条、AppFrame148条、证据gate 47/47（7正向、40拒绝），6571项固定输入/历史文件前后相同；179文件最终freeze摘要`2fdd642d66fe2fbe84e871480a81fb92c455e394b289c569c3a037809416ee52`，总审直接Get-FileHash核对匹配。两处手机交互缺口均独立复现；空ok不是business-winner、普通503不是未dispatch证明。布局终点读rect仍可能影响布局，不能证明终读前像素；白栏继续未归因。master未提升。

[只读修复设计](round3-question-delivery-design.md)已接受为实施依据，非运行结果。唯一既有生产写域为`scripts/patch-official-runtime.mjs`，另新增`scripts/deep-audit-question-delivery-patch.mjs`，通过正式临时安装API生成Question/Gateway client两个完整候选。服务器、Connection、uiSession、旧question helper和原13项native门保持不变；新增Gateway client全文件companion门、两阶段UI回执、未知不重发、精确身份的有界草稿恢复。旧证据/源码pins全部保留，新授权改变的installer须有完整before封存及显式历史映射。

修复作者与独立回归已预先保存为相互依赖的任务，仅作者进入实施；独立回归等待作者提交经总审接受，不能提前称新版本通过。该实施不授权真实CLI、运行版安装/替换、发布、真实账户设备或公网；所有旧未验边界仍有效。

## 实施中断与定点续作

实施成员在产生候选与初步核心对照后再次因internal/work_followup错误停止，retryable:false且有部分输出。总审在实际失败状态下仅替换该任务的成员，保留原claim与before-v2等现场；独验依赖不解除，没有把候选当最终修复。替补需从实际文件与运行收据继续，不盲重放未知作业。

原成员报告核心core-before-v3 7条、core-after-v3 11条，延迟窗口新busy卡可见、503重呈现恢复选择且无业务重放，pwsh-49退出0；这些只是尚待核对及完整回归的阶段报告。安装v1仍为37/43，6条夹具路径/长度预期红保留，不能删红或降低源身份校验。最终完整pair、安装矩阵、销毁/未知回执/限额和独验尚未交付；Q/G候选前缀不是最终来源证明。

## 修复候选交付与回归交接

[修复作者报告](question-delivery-repair.md)已接受为候选交付：最终Q为`39f1fa00ea15159b6700e553787f6071d06974c676d4fa269c5d6a80519b0fa7`，G为`52814635f68d59587542b5d2f0fc1835ac9e6d4ecad2c50ed7085c2ba4ed63cc`。作者两次final matrix各80（34链路/几何、46直接组件），旧44/44、安装43/43、旧版对照7；后者是旧失败characterization通过，不能称旧问题不存在。总审读报告和installer完整diff后接受，已把依赖解除给原独验成员；尚非独验通过。

候选追加修正unknown未缓存提示64/32限额和本地收起44px按钮，未扩生产写域。46项资源测试有构造handle/可逆TTL时钟接缝；matrix结果DOM为0，分段旧44结果显示不算完整Host投影。两次最终执行字节相同但输入全集5082/5083不同；旧core-after-v2存在producer漂移，被保留为无效run。

作者7354文件freeze摘要`f2e1ffcc73fcb6f96403edee457c8392fa0d05b5b7474e7634f438d3bfbd78c3`，16种旧变更源采用精确原字节映射；其中两producer是后续重构且匹配旧SHA，不冒称原本已归档。独验须重新检验这些边界与最终pair，不能重绑旧清单。接续报告51–67作业已收齐，旧成员不可见jobs仍只引用其实际旧回执。

第二次新团队消息relay也返回admission timeout，记录为失败且未重试；直接子成员通道的真实报告及提交正常到达。失败消息不代表业务或任务失败，不作为重复创建成员依据。

## 两流独验接受与最终整合

安装独验已接受：最终fresh 43/43、单列竞争/整包补测17/17及精确维护安装段通过，原13门和保护源码未改。15668输出manifest摘要`3e5139827f4ec50764c6ae12abd2d2d232803bfc55bfdee916d17c8062bfc7a0`。保留枚举ENOENT、v2前台60秒中断，最终v3重跑；跨文件非原子、合作writer CAS与未运行真实CLI仍是明确限制。

UI独验首版97行报告经审阅退回两个证明缺口；新增第二版66行报告后接受。原两轮80、旧44、before7原样通过；最终before另以121原件前后绑定补足动态导入清单。单列2组件probe/122子断言补同owner未缓存unknown上限与退休旧记录严格拒写：32unknown加2活跃哨兵是34总views，不能把上限误写成所有view≤32；16旧save中5合法独立true、11真正退休false，新record均不变。原480首版文件在原处及副本保持一致，1079项新freeze摘要`609b9676bdecdccdf93a5072621c47aec574ad59cb410456353c914977e0f712`。新probe没有业务RPC，不与原80/44相加为功能覆盖。

安装与UI任务已分别接受；生产作者及两独验成员正常退役，回执称自有作业和合成资源已清理。最终整合成员随后因internal/work_followup、retryable:false和partial输出中断，总审仅替换该窄任务成员，保留现场与旧claim；不重跑两个runtime流或扩展生产。整合尚未交付，总审未作最终验收。旧安装测试/历史入口与新成对接线的兼容边界须明确，不宣称全仓或旧安装套件已全绿。

## 最终接受与第三轮收口

上述整合等待为历史阶段：首替补也在同类内部错误后停止，第二次定点替补完成原任务。8份既有现场及旧失败精确保留，第三个新的relay通知也发生admission timeout且未重试；实际子成员已工作并通过直接通道提交，未将失败relay当成功送达。

总审读回[最终验收报告](question-delivery-validation.md)、57行五维旁表与证据测试及其读取模块；以`node tests/deep-audit-question-delivery-evidence.test.cjs`单独复跑得到73/73、零fail/cancel/skip（约15.4秒），只核文件与元数据，未运行runtime。34,396唯一文件闭包与48次明确历史匹配保持一致；最终37项冻结包括3个docs/test，不是37+3。总审另核其8677字节manifest摘要`a7e21c7c1b2bbc6523593e572f6091db581762d8b947e0872704597ed6f62316`，与封存回执一致。最终整合已显式接受，全部成员正常退役；第三轮团队关闭、剩余任务0，closure的cancelled来自被拆分替代的旧宽任务，不是未完成任务被隐藏。

**仍有已知兼容边界：**旧`tests/deep-audit-question-card-install.test.cjs`仍要求旧CLI变量/API字串，当前CLI已改成对交付；旧helper只接受base/v1而非Q39。此处只读确认不兼容，没有执行旧suite或迁移它，不声称全仓回归全绿。未通过发布流程，也未执行真实CLI生命周期。

本轮限定修复的是回执完整解析前撤卡及真实重新呈现后选择丢失；未知回执不自动重放业务，原有安全边界未放松。Android/WAN、完整Host结果投影、用户白栏、大同步快照/尾延迟和全主题读屏仍未验或未归因，不能外推为真实用户所有问题解决。全项目主覆盖表没有提升。

本记录未在禁止操作的当前GUI中预览；文档仅本地读回校核。全项目审计仍未完成。
