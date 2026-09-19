# 第三轮独立复核：真实问答协议链与正式 AppFrame

## 1. 验收意见

**建议总审接受本轮有界证据；不接受“用户问题全部解决”。** 本成员独立启动了两条 fresh 隔离运行，不使用作者的自检摘要替代运行结果：

- 手机 `mobile-v1`：12项显式检查，UI→实际 RPC/协议解析→受控业务返回成立；**回执前移卡、503恢复后选择清空**再次复现。
- 布局 `appframe-v1`：148项显式检查、35个几何测点、5张合成截图；实际官方 AppFrame/Conversation/ChatView 填满已分配区域，但**用户持久白栏尚未归因**。
- 独立证据 gate：**47/47 Node tests**，其中7项正向核验、40项语义/来源负对照；它们不是47项用户功能或新增产品覆盖。
- 冻结与输入集合：6571个去重文件前后相等；旧 master 的 `userOperations=115`、`independentlyAccepted=104`、`domainFindingRows=598`原义不变。没有生产修改、旧 pins 重绑、master 回写、发布、下载、设备或当前GUI访问。

本报告是成员的独立复核提交，最终接受由总审完成；不是Host签名、G级审批、全产品安全或全USER完成证明。另一个成员后续设计文档不属于本次证据输入。

## 2. 独立运行、来源与副作用边界

### 2.1 路径-only 派生，原作者文件只读

作者入口将输出根写死在各自 artifact 目录。为遵守复核独占 scope，只在 `.artifacts/deep-audit-round3-acceptance/runners/` 生成两个路径-only 副本：改变 repo/fixture/require 定位及输出根，不改变测试动作、布局算法、CSS、故障模式或断言。

`runner-derivations.json` 保存原路径、源/派生SHA、每条替换及次数；逆序反向替换与作者当前完整字节相等。`author-source/`保存实际原入口字节。作者的 Electron/renderer/fence 夹具仍从原路径只读装载；旧测试、旧报告和旧冻结不修改。

| 入口 | 原始 SHA-256 | 派生 SHA-256 |
|---|---|---|
| 手机 | `c0e6b776dc80c207725d0d492860c8f745c9020266e48aa385f2f54fa2526fc8` | `635512effdc8b1ddcd86f729185a60f7e5349f8b9057b6310e7b964447e99efc` |
| AppFrame | `ddaecaedddfede5c9faac315c92c02a5519b1dbe5403005d80ebfc98ed01972a` | `317cfd6c97e4ea64540fb26433ba54806a254c1e564524a04b6f45233ed2ae89` |

正式安装API只操作新目录里的 `installed-runtime`；未运行真实CLI。两流当前 conversation 均为 `30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066`，question为 `6f382a535cb182b062365773c57b23579e8195c0096901c1864c0b1ae0079457`。独验重算5075个手机输入、25个布局直接输入以及包安装收据、完整加载源码、30条AppFrame接缝/6条手机接缝；完整源码反推与实际生成字节匹配，不是只认作者写的 `pass`。

### 2.2 先安装隔离，再装产品组件

运行使用白名单环境、新 HOME/APPDATA/DSH_HOME/profile、隔离 Electron partition；不继承真实凭据环境，不装依赖。Node/renderer/Electron能力拒绝在产品组件装载前建立。手机仅有一个登记的 `127.0.0.1`临时端口：固定静态资源、`/api/remote.mux`和`/api/$events/result`；Host/Origin/路径/方法再次受限。布局只允许已登记本地生成文件，无网络端点。

手机对当前GUI端口、外域443、额外listen/IPC和child spawn的负例均在调用实际能力前拒绝；没有实际连接这些目标。正常运行仍有31次本地theme.js请求被拒绝，不伪称真实主题服务加载成功。移动fixture保留 `unsafe-eval` CSP警告及console事件弃用警告；布局guest禁用未使用config evaluator以保持测试CSP无eval。这些都是测试装配边界，**不是生产CSP验收，也不是OS级出站抓包证明**。

实际Clipboard、账号、配对数据、手机/Android、模型、完整Host、公网、下载/发布没有被调用。源文件只读Hash比较不构成对未执行能力的安全担保。

## 3. 手机链：跨过旧替身到哪里

实际执行的是当前完整 QuestionComposer/PendingQuestion/answerQuestion、ClientRemoteEvents、RemoteStreamMux、Connection RPC、Node HTTP bridge/rpcFetchHandler/Gateway，以及真实发行React/Cordis。旧44项的deferred answer替身被真实客户端交付链取代。

仍为接缝的部分：Context身份/会话与pending registry、合成event source、受控business settlement、disabled native marker。**结果呈现只有一次：测试从已观察的受控receipt将value注入实际AskQuestionRow/Card，再检验DOM。** 它不是完整Host session projection主动推送。

独立原始分母：8次UI RPC、8次HTTP入站、7次受控业务settlement、1次旧请求abort、8个源请求对应9次卡呈现、1次结果DOM挂载。本夹具的503尝试没有到业务dispatch；wrong-rpc在业务已settle后篡改回执相关ID，不能把两者统称业务失败。

独立读取当前gateway server `dispatchRpc`（L566–575）和`receiveRemoteEventResult`（L688–710）确认：pending已不存在或不属于此delivery时，后者可直接return，而前者仍返回空`ok:true`。因此**解析后的RPC成功只是传输确认，不是business-winner证明；一般HTTP503也不证明未dispatch，不能据此擅自自动重放。** 本夹具的未交付/已settle结论来自受控request mode、实际dispatch trace和source.resolve记录，不是仅凭HTTP状态。后续设计未实施，其拟议API不计入本轮能力。

### 3.1 两项有限复现失败

| ID | 独立观察 | 判定 |
|---|---|---|
| ROUND3-QUESTION-ACK-LIFETIME | 350ms受控HTTP前置等待期间原卡已移除，尚无业务settlement；移卡甚至早于fetch提交 | 生命周期缺口复现；不能宣称网络等待中保留busy卡 |
| ROUND3-QUESTION-RETRY-DRAFT | HTTP503导致真实JS连接恢复，未完成question重呈现为新key；checked全false、status空、submit disabled | draft/错误反馈缺口复现；无自动业务重放，显式重新选中再提交成功 |

受控可信Chromium touch得到Option0；同tick用DOM.click追加Option1及双提交，只有一次RPC且结果保留两项。DOM.click的`isTrusted=false`不伪装成物理同tick触摸。旧会话abort后的carrier拒绝、错误clientId拒绝、完成事件重复交付惰性、错误rpcId后恢复且新请求成功，均在实际协议实现下重算。

回执事件没有新测nonce、expiry deadline矩阵或完整快照乱序；不能用clientId/eventId/rpcId与旧carrier检查替代这些缺口。真实Android WebView/Handler/IME/Activity、Java桥/WebProxy/relay/WAN均未装载。**手机选择题真实用户故障与移动实时慢仍没有完成归因和验收。**

### 3.2 时间口径

只在同一renderer `performance.now()`中计算：本次n=1受控延迟场景 click3495.5ms、移卡3497.0ms、fetch3554.2ms、HTTP headers3914.3ms；移卡至headers为417.3ms，fetch至headers360.1ms。完整原点和计算在 `independent-summary-v1.json`。

Node serverTrace是另一时钟，不参与跨时钟相减。HTTP headers不是响应JSON解析/相关ID被接受，不是Host业务完成；manual结果DOM还可能先于headers出现。本轮未加载大同步快照，不计算P50/P95/P99，不把8个异质场景当尾延迟样本或WAN指标。

原始connection-state订阅回调没有generation字段；503状态快照记录generation2、最终last-browser记录generation3。首次独立分析器错误要求回调里也有generation，产生的 `analysis-failure-*.json`已保留；修正后检验真实connecting→connected顺序及最终快照，未补造丢失采样点，未修改/重跑产品收据来消除这次分析失败。

## 4. 布局链：真实AppFrame但不是完整应用

挂载完整官方AppFrame → ConversationRoot/Session/Header/InputBar → ChatView/UserMessageNodeView与DetailsPanel，使用真实layout store/actions、CSS、ResizeObserver、rAF、ThemePresenter/Cordis样式生命周期。真实Electron webview与Shadow DOM、当前right-workspace/integration均在运行；不是纯solver切片或 `LAYOUT FIXTURE ONLY`矩形guest。

合成两会话stores/hooks/slots、文字左栏、拒绝业务发送sink与desktopHarness替身保持透明。没有完整app.js/main自动初始化、真实左树/用户配置、native WebContentsView覆盖层、用户可见compositor或真实服务CSP，因此不能解释所有真实白栏成因。

### 4.1 独立终点数据与观察干扰

| 场景（CSS px） | 左列 | 中列宽 | AppFrame宽 |
|---|---:|---:|---:|
| home1460×930、100% | 280 | 860 | 1140 |
| passive首次2200ms终点 | 124.78125 | 1015.21875 | 1140 |
| 100ms提前读rect，2200ms终点 | 56 | 1084 | 1140 |
| 100ms提前capture，2200ms终点 | 280 | 860 | 1140 |
| 独立5200ms，无区间读rect/capture | 280 | 860 | 1140 |
| 独立10000ms，无区间读rect/capture | 280 | 860 | 1140 |

5.2/10秒分别从新browser基线开始，不是已在2200ms读过rect的延长组；独验按trace中的explicit-rect-read计数、capture时间与baseline逐项检查无中间观察。终点仍按host→guest读rect，**仍可能促成最终layout，不能证明读取前每个像素已绘制**。

home下conversation与center同到x1140；content宽680居中，不是额外320px白列。1800宽时details实际360，可用真实DOM关闭，切session也自动关闭；1460时details按官方预算退让为0。125/200%与480/760/900/1800窄宽、短/长消息、blank hero、字体18→14、sidebar偏好均保留在35个测点内。

短窗口的观察敏感性被独立复现，但长期终点正常只缩小了“纯AppFrame固定缺320px”的假设，不把未复现持久白栏改称产品不存在。作者final-v10的一条 `blink.mojom.Widget`引擎诊断原字节保留、未归因；独立appframe-v1的electron.log为空不能冲销它。

### 4.2 图像只证明捕获后的合成界面

本成员用图像工具只读检查了home、details-open、long-content三张原PNG，几何与可见边界相符。长内容可见滚动区域、composer仍在底部；详情图在conversation右侧出现实际360px详情列，外侧另有320px壳栏。不是用户附件复刻、真实账户画面或无干预绘制证据。

- [合成home1460×930](../../.artifacts/deep-audit-round3-acceptance/appframe-v1/synthetic-official-appframe-home.png)
- [合成详情1800×930](../../.artifacts/deep-audit-round3-acceptance/appframe-v1/synthetic-official-details-open.png)
- [合成长内容1460×930](../../.artifacts/deep-audit-round3-acceptance/appframe-v1/synthetic-official-long-content.png)

## 5. 五维与既有ID关联

`coverage-round3.json`保留normal、error-recovery、concurrency-switch、isolation、a11y五维。每条列出有限通过、真实复现失败与未验，没有回写任何原ID状态：

- `QUESTION-INSTALL-20260912-1`：补真实协议交付链，并保留两项新有限UX失败；不抹除旧44项的原替身边界。
- `USER-MOBILE-REALTIME-LATENCY` / `USER-MOBILE-EXTERNAL-RECOVERY`：增加受控浏览器链证据，完整USER目标仍unverified。
- `MENU-LABEL-ff7edbb57fc5`：仅关联既有browser壳入口；`USER-36be79d18ec4`仅关联实际ThemePresenter样式/字号呈现，不宣称主题保存或全导航接受。

a11y只包含390×844下56×44 CSS px提交命中与程序缩放/详情DOM动作；没有Android dp、物理输入、IME、读屏、全面对比度审查。旧总测试2929/通过2889/失败7/skip33是既有冻结历史，本轮不复跑、不改计数、不删除红与skip。

## 6. 证据gate、历史与资源

47项证据tests：7项正向重算、40项拒绝变异（原45项运行也保留，最终另加空ok冒business-winner与普通503冒未执行的拒绝）。负例包括坏selected/旧carrier/错client/重复settlement、错HTTP rpcId、删重连记录/丢失UX发现、伪可信touch、错完整模块SHA/假guest矩形、污染passive区间、隐去native调用、错计数及把旧44相加、错master字段含义、来源换成作者收据、跨时钟、headers冒ACK、异质场景冒P99、手工结果冒Host projection、未验snapshot/nonce/expiry及Android/WAN/白栏/读取前像素冒充完成。所有变异只在内存，不篡改原收据。

独立 `integrity.cjs`不调用作者验证器：重算旧v1冻结365条（4条经明确savedPath映射）、已接受v2冻结383条、历史638条，作者AppFrame冻结807条，手机六run共384条与16项handoff绑定，再结合5075输入闭包去重为6571文件。前后完全一致；新增设计文档不进入固定旧闭包，不误报为旧输入漂移。既有失败run和恢复来源mapping都只读保留。

两后台作业 `pwsh-44`（手机）与`pwsh-45`（布局）均已收齐且exit0。手机cleanup为sockets/pending/clients=0、serverListening=false、cleanupErrors=[]；布局finally销毁窗口/app退出。限定本次fixture/acceptance命令行的只读进程检查为0。这不是对其他会话作业或整个系统无进程的证明。

报告按Markdown标题、表格及本地链接结构核验，未打开禁止访问的当前GUI/右栏。主要产物是本报告、`coverage-round3.json`、`tests/deep-audit-round3-evidence.test.cjs`与acceptance目录内新证据；`final-freeze.json`冻结最终交付集合并由只读verify复核。仅缓存/profile可变文件被排除，实际installed-runtime、完整生成guest/renderer和源码副本保留。

## 7. 复核命令与未完成边界

只读证据复核（不启动Electron、网络、安装API）：

```powershell
node --test tests/deep-audit-round3-evidence.test.cjs
node .artifacts/deep-audit-round3-acceptance/verify.cjs
```

新一次行为复跑只允许新的run名，并继续遵守本任务限定；不得覆盖本次或作者目录。`run-controlled.ps1`及path-only副本已随证据保存。

**本轮到此停止：不自行修复跨层回执生命周期、不扩大状态协议、不以CSS/repaint掩盖白栏、不增加真实设备/WAN/完整Host权限。** 总审可以接受“真实协议/真实AppFrame的有限证据与明确失败”，但手机实时慢、真实用户白栏和完整Android体验仍开放。
