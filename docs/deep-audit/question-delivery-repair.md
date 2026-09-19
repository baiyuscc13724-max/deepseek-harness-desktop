# 问答回执等待与受控草稿恢复：作者交付

> **限定客户端候选，待独立复核；未发布、未部署。** 对应 `ROUND3-QUESTION-ACK-LIFETIME`、`ROUND3-QUESTION-RETRY-DRAFT`。本报告不宣称真实手机、WAN、完整Host或用户白栏问题已解决。

## 1. 最终产物与范围

仅维护两个生产脚本：修改 `scripts/patch-official-runtime.mjs`，新增 `scripts/deep-audit-question-delivery-patch.mjs`。通过同一正式安装API，在全新临时目录生成两个完整client文件；没有手改真实 `node_modules`，没有执行真实CLI或替换运行实例。

| alpha.5候选 | 完整SHA-256 |
|---|---|
| Question client | `39f1fa00ea15159b6700e553787f6071d06974c676d4fa269c5d6a80519b0fa7` |
| Gateway client | `52814635f68d59587542b5d2f0fc1835ac9e6d4ecad2c50ed7085c2ba4ed63cc` |
| 真实配套conversation client（沿用原维护产物） | `30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066` |

原 question-card helper、发布CAS helper、Gateway **server**、Connection、UiSession和原13项native能力块全部保持原字节。安装器diff见 `.artifacts/deep-audit-question-delivery/installer-source-diff.txt`；接续成员追加的helper差异见 `recovery-helper-diff.txt`。完整原生产输入121份已保存于 `before-v2/original`，接续前13份源码及3402项本任务历史文件另在 `takeover-v1` 绑定。

## 2. 实现语义

### 两个独立promise，避免等待环

- `PendingQuestion.result`仍立即提供监听器结果，Gateway waterfall可以继续提交。
- 按钮的返回promise独立等待本地delivery通知。busy和fieldset禁用保持到原Connection完成HTTP **完整JSON、envelope及rpcId解析**，不是仅收到响应头。
- Gateway订阅者不参与网络任务等待；终态一次落定，晚ACK/abort不能改写旧终态。每次事件载体绑定Gateway实例、target Context、generation、clientId和attempt对象；替换载体有新render key。
- 真实UiSession域delegate/销毁不等待网络回执；未答时仍可委托next，已答时仅撤UI和本地缓存，不向next重复交付答案。
- 成功只命名为 `transport-acknowledged`。原server对无pending事件仍可能返回空 `ok`，因此**不是本客户端business-winner证明**。选项不能据此伪造成Host工具结果。

### 未知回执与恢复

一般503、错误rpcId、丢失响应及30秒deadline均为unknown；不解析错误字符串猜“未dispatch”，不自动重发业务。只有真实新generation再次收到同pending事件，且Gateway owner、target Context、真实scopeOf session、event/agent和完整题结构完全匹配，才能恢复纯内存draft。新卡仍要求显式提交；计划审批不会自动再批准。缺真实scope/不匹配handle不进入恢复路径。

unknown卡只读；新题可以替代旧提示；“收起提示”仅本地关闭，不调用远端cancel。缓存全局64条、每owner32条、单条题结构+草稿64KiB、合计1MiB，按UTF-8计数；规范结构深度、节点数和字符串长度也受限。中断后5分钟TTL不滑动，只有一份最近到期调度器。

本次续作额外实证并修正两个候选问题，均局限于该helper：

1. 缓存因超大题被拒绝时，unknown提示原可绕过缓存限额（70个实际组件载体产生 entries=0 / views=70 / timers=1）。现在独立限制unknown提示全局64、同owner32；不淘汰editing/submitting，不发业务请求。
2. 新增本地收起按钮在390×844实际DOM中原为80×27px。现在92×44px，底边776位于844px视口内；只加该按钮最小高度和内边距，未改全局布局/CSS。

## 3. 最终验证与分母

命令均从维护根运行，仅使用已缓存依赖与fresh目录。以下不是用户操作覆盖率，不相加成“已覆盖167项用户功能”。

| 证据 | 最终运行 | 结果及职责 |
|---|---|---|
| 真实组件/协议链与资源测试 | `final-matrix-v1`、`final-matrix-v2` | 各80：34个链路/几何检查，加46个直接组件身份/资源检查 |
| 原44条交互oracle | `final-legacy-v1` | 44/44；原断言段原样提取，绑定新完整Question；仍为合成carrier/native回调与局部工具执行，**不冒充delivery链** |
| 旧维护版对照 | `final-before-v1` | 7项characterization通过；350ms响应持有时旧版提前移卡、503新呈现丢选择仍复现 |
| 严格成对安装 | `final-install-v1` | 43/43，包括六种known组合、零写拒绝、13门与写入失败恢复 |
| 历史与冻结验算 | `author-verification.json` | 121原件、3402接续历史、原round3独验179/AppFrame807/mobile handoff16，及18个新旧run冻结逐项校验 |

两次最终矩阵实际加载/执行的测试与产品字节一致。输入清单分别5082、5083项：第二次多绑定了运行中新增但不参与产品执行的 `verify-delivery.cjs`；**不声称完整输入集合相同**。各最终run的before/after sourceDrift均为零。

原round3的12项是旧版本缺陷characterization，不改旧12测试和pins，也不声称新80就是旧12重新全绿。新before/after针对原两个失败现象采用相反断言。旧44通过不证明跨层回执，真正跨层证据来自新矩阵。

### 覆盖的真实链与受控边界

完整正式Question、Gateway client、Connection client、Gateway server、RemoteStreamMux、HTTP bridge/rpcFetchHandler都实际加载。Controller的真实createScope/scopeOf和UiSession/PendingInteractionDomain通过export-only seam装配，未替换其实现。官方React、renderer和QuestionComposer实际渲染；DOM触摸与键盘通过隔离Chromium调试输入生成。

合成部分严格标明：roster/slot adapter、事件源、身份名字、封闭loopback HTTP响应策略、bootstrap和private exports。直接资源测试调用实际类和registry，但handle由测试构造；TTL用单调时钟越过真实deadline的可逆seam，**不是实际等待五分钟或真实断线重连证据**。

每次最终矩阵：14次浏览器RPC提交观察、13次HTTP端点接收、11次受控business receipt、16次呈现。多出的一次RPC观察是owner销毁后的委托结果在已abort信号上调用fetch，随即报“Remote event was cancelled by the Host”，未到HTTP端点；不能把它算作成功重传。两个503在夹具中明确读取body但未dispatch，客户端本身仍按unknown处理。

矩阵的 `results` 数组为0：没有把受控receipt注入为真实session projection。实际AskQuestionRow/Card的selected解析与显示在独立旧44链段验证；这是分段证据，不是Host→session projection→结果DOM端到端证明。

### 关键时序与隔离

| 条件 | 观察 |
|---|---|
| 350ms持有完整响应 | 新卡保持busy，旧版提前移除；同tick双选择+双提交只有一个RPC |
| 先响应头、后JSON尾部 | 两次renderer测量头→完整JSON约349.3/351.0ms；移卡晚于JSON解码约0.9/0.5ms |
| 已dispatch后wrong-rpc | UI为unknown且只读，未自动重传，不声称业务失败 |
| 真实30秒deadline、无重新呈现frame | renderer等待约29955.8/29964.8ms；保留unknown，收起不发送请求 |
| 重复active frame | 原Gateway代际恢复；同event新key恢复draft，旧流cancel和旧PendingQuestion答复不污染新卡 |
| 计划审批 | 同tick双批准仅一次请求，重呈现仍需第二次显式批准 |
| 域销毁时网络尚未返回 | UiSession dispose各约0.6ms，pending=0，不等待350ms网络 |
| next尚未完成的委托 | 域已经退出，raw next仍未完成；随后单独resolve，注册表清零 |
| owner/plugin、UTF8/TTL/限额 | 实际Context销毁清理；错scope/owner/agent/event/结构/代际拒绝恢复；末态与失效record不能回写新记录 |

仅同一renderer的performance.now互减；Node/server时间轴分开保留，从不跨时钟相减。n=2受控条件，不报告分位/SLA，不外推WAN、大同步快照或移动尾延迟。

## 4. 安装安全

新增Gateway client整文件companion门；Question原整文件门只新增最终39f1…完整SHA。中间候选323e…、2e99…不是认可的安装输入。Q-base/Q-v1/final与G-base/final六种已知整文件组合仅可离线收敛，不授权混合pair运行。

`assertInstalledQuestionDeliveryPreflight`在真实CLI源第一写之前执行原native门、身份/版本校验及两final内存生成。`patchQuestionDeliveryRuntime`再次预检后调用原CAS/独占锁/temp fsync/rename发布，再核完整pair。跨文件不是原子事务；第二文件锁/写失败可留下第一文件已更新，禁止启动/发布，精确重跑才收敛。

负例实跑未知同marker单字节、缺文件、错包身份/版本、原13中任一漂移、三种退役artifact、prepared output篡改、第一写前companion竞争、两文件锁和open/write/sync/rename故障。已有竞争锁不删；拥有的temp/lock清理。正常最终重跑changed=false且全目录快照不变。CLI只是源码绑定审查；从未运行真实CLI。

## 5. 失败、源映射与资源清理

所有旧失败输出保留，不覆盖旧freeze/pins。`source-remap-v2/mapping.json`把16种历史变更输入映射到逐项SHA匹配的原字节。前成员两份未直接保存的producer，通过当时保存的producer+hashes填入常量、以及原样拼接后续publication函数重构，分别精确匹配e017…与b0d9…；这是**重构后哈希证明**，不冒称当时已经归档。旧core-after-v2已有e017…→5253…运行中漂移，仍作为无效失败run记录，不升格接受证据。

| 历史红项 | 处理 |
|---|---|
| 原core-after-v1/v2、core-before-v1装配失败 | 原输出保留；含上述已记录producer漂移 |
| 原install-v1 37/43 | 五个路径分隔符谓词失败、一个臆测长度阈值失败；当前使用规范路径和完整原native块相等验证，未放宽门 |
| recovery-matrix-v1 | executeJavaScript返回PendingQuestion不可克隆；仅测试返回值改为void，不改产品 |
| recovery-matrix-v3 | 测试按JSON键插入顺序比较规范draft；改为规范结构等价，选择内容不变 |
| recovery-legacy-v1 | 非唯一源截取锚点被拒绝；换成实际唯一连续源码边界，44条断言不改 |
| recovery-uncached-v1、matrix-v4 | 真实候选限额、触摸尺寸缺陷；按第2节最小修复，旧红保留 |
| author-verification初次、source-remap-v1 | 检查器误要求历史失败run零漂移、发现两原producer副本缺失；保留错误日志，新核验显式容纳原失败状态并完成精确原字节重构 |

所有本接续后台jobs 51–67已收齐（无68或后续后台作业）。前成员46/47/49的收齐情况只引用总审转交回执，不冒称本会话可读取旧jobs。最终所有Electron窗口、client/pending、socket归零，server关闭，cleanupErrors=[]，browserFailures=[]。新会话空job_list不单独作为旧作业收尾证据；另有精确question-delivery进程检查。

Node/Chromium在产品装载前fence：拒绝当前GUI64524、公网、未登记监听/IPC、子进程、Shell和clipboard；每run仅一个排他loopback端口，开放静态资源与 `/api/remote.mux`、`/api/$events/result`。隔离renderer无Node/真实native桥。最终每run有72次mobile runtime请求合成 `__harness_mobile__/theme.js` 被拒绝，原拒绝数组保留，不为消除日志而放开路由。Electron实验CSP允许export装配所需unsafe-eval，保留其警告，**不据此宣称生产CSP安全验收**。

## 6. 保留边界与交接

- 未触真实手机、账户、配对设备、真实剪贴板、真实Host能力、当前GUI、公网或发布入口；无下载、运行版替换。
- Android View/Handler/IME/Activity、Java桥/WebProxy/relay/WAN、完整Host模型/工具业务、真实session projection、大同步快照/尾延迟、用户持久白栏仍未验证。
- 只测试390×844受控浅色Chromium的相关交互/触摸目标；不是全主题对比度、读屏、横屏/系统字体或设备safe-area验收。
- 主覆盖表SHA仍为 `8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794`，原summary的userOperations=115、independentlyAccepted=104、domainFindingRows=598不变，不提升为“全USER完成”。
- 交付入口：两个新tests、fixture目录、本文、`author-verification.json`、`source-remap-v2/mapping.json`、最终freeze。后续由独立任务复跑并由总审接受；作者提交不是发布或用户问题全端解决。
