# 移动端深度审计：限定层候选与未验证清单

## 约束与证据分层
仅维护源码；不接触真实配对数据、真实设备、账号或能力服务，不发布APK，不操作运行实例。专属JS测试显式使用内存fetch/API、虚拟设备，后续Node/Gradle子进程清理能力环境变量，仅保留工具链/系统变量。已有测试使用本地临时HTTP/WS及临时配对fixture，不等同真机。

## 基线（修改前）
已有脏改全部保留；`git diff --stat`移动相关10文件632 insertions/184 deletions。

| 文件 | 修改前SHA256 |
|---|---|
| electron/bridge/mobile-control-broker.cjs | 6E85961EC628D01DDD91CE483E10F438E1EB4CC930F428077A64D27E754F917E |
| electron/bridge/mobile-sync-service.cjs | 2FA21401A4887D64F79370FF4C0DA2CE0963AE4CCCCD1733502C2D0928E5F662 |
| electron/bridge/sync-transports/wss-relay-adapter.cjs | 21DCE486F5EEAA9D3306349CEE60F3B3950ED8D6AADA3CCC2905B9288D168D03 |
| Android/iOS mobile-compat.css | EA7E8CD55492DDDBEBA4BCD0A472776305552D3E58025DE8B4FCE36026B81C3D |
| Android/iOS mobile-runtime.js | 4E354EA27D61847527E358F0B72946DAA24A8F5B72B99337641C28AD55615EB3 |
| mobile/android/app/version.properties | C5C80A8D1479810CD0A384393EC67DD1F5FA590F772C6676298E1D0F0938C890 |
| mobile/ios/project.yml | 68FC36C5BFE9C2EE1867EEC80FD47D77C0DAEF309C2F954D9C3D0891B87AC6C1 |
| mobile/mobile-app-update.example.json | 4B37CF1198271D8F443AC6E3406F08B54F2A072B4466DCDA465F986F1CA5BC97 |

上表为前任记录，保留其原文，不冒充本轮重新取得的基线。本轮开始核得 `renderer/native-p2p.js` SHA256=A72A9A7ACC71C48011C71E8571AC4D365F60FA8EC0784F7C8E88DF497A4660B9；`desktop-device-stream.cjs`=5028B5909B746B94EF5C93E35268390B8653F501976A73903BCD30B2DF52C3A4。前者已有44+/10-；后者和HarnessWebProxy本轮前无git差异。

## 用户高优先问题：手机指令慢、外网难同步

### 两条链路不能混为一谈
1. **手机给AI发消息**：mobile-runtime官方composer的点击/Enter → 官方Web应用HTTP/WS → Android `HarnessWebProxy.handle` → `connectRoute` → LAN直连或本地SOCKS（`NativeP2pClient` / `WssRelayClient`）→ 加密DATA帧经P2P或WSS → 桌面transport adapter连接mobile gateway → `MobileSyncService.#handleHttp/#handleUpgrade`授权/反代 → 官方runtime接收/排队/Host执行 → 原连接回执 → 官方composer呈现。输入动作沿用官方所有权，代理不业务重放。
2. **AI控制手机**：`plugins/dsh-mobile-control` → desktop-command → MobileControlBroker排队 → Android ControlForegroundService控制轮询 → 原生确认/执行 → result POST → 插件读取回执。850ms控制轮询并不是手机发AI消息的延迟来源。

### 已读源码的等待预算（上限不是观测值）
| 段 | 当前源码值与含义 |
|---|---|
| Android代理LAN连接 | 每socket800ms；指定非VPN网络失败后可再试默认网络，可能2次 |
| Android代理remote连接 | 2200ms；SOCKS另有本地connect1200ms及read2200ms |
| 冷选路race | 每候选错开120ms，整个race等待2450ms；最多4个route workers |
| 旧热路失败后 | 原热路等待后再冷race，并非合计2450ms；本修复不缩短它 |
| Android网络稳定策略 | recovery250ms / switch3000ms / loss1500ms |
| Android native WS | connect12s，标准WS ping20s；失败重连5s递增5s封顶30s |
| Android legacy WSS | connect15s，标准WS ping20s；失败重连3s递增2s封顶15s |
| P2P协商 | native先开放WSS SOCKS，直连协商在旁路进行，不能把协商TTL算作每请求必等 |
| 桌面WSS adapter | handshake/ready15s，stop close回收1s；manager重连基数1s，上限30s乘0.75–1.25 jitter |
| iOS代理 | 每次connect先LAN，最长1.2s失败后relay；无last-good缓存 |
| iOS首文档 | WorkbenchView URLRequest timeoutInterval30s；不是所有composer RPC的TTL |
| Host执行/首回执/呈现 | 此Windows源码fixture未测官方runtime真实队列和服务商响应；不能承诺端到端SLA |

### 新复现与修复
**M-LAT-01：Android全局socket建连队头阻塞。** 原`private synchronized connectRoute`把建连、SOCKS、race等待包含在同一monitor，6个HTTP/WS请求只能1个进入connector。24个connection worker也不能并行选路。新增`DeepAuditMobileRouteTest`通过未连接Socket、CountDownLatch和生产函数反射调用复现，不模拟算法替身。修复只在route状态读写持有短锁，网络I/O离锁；不改任何连接/轮询超时、不自动重发业务请求。

**M-ISO-01：网络reset期间旧建连恢复旧preference。** 新JVM红例证明reset后旧warm socket仍返回，污染下一请求。补route revision，updateRoutes/reset/close后的旧成功关闭socket不交付，旧失败不写新网络backoff。补profile更换、close、late failure、dead LAN→relay场景。这里拒绝的是选路尚未交付的socket，不声称能撤回已发出的业务字节。

| 受控基准 | 样本/条件 | P50 | P95 | P99 |
|---|---|---:|---:|---:|
| 原全局monitor（测试接缝已接入，逻辑未修） | 5批×6并发，连接固定sleep80ms，n=30 |242ms|491ms|493ms|
| 首次候选 | 同条件 |81ms|91ms|91ms|
| 最终全Android测试复跑 | 同条件 |90ms|94ms|94ms|

基准只证明本地选路锁放大延迟被消除，**不是公网、真实手机或端到端p95**。确定性门闩断言（6connector同时进入）比墙钟阈值更重要；基准不靠降低测试门槛判通过。

**M-ISO-02：桌面设备帧/输入跨代次。** 补target/clear contextRevision、并发captureRevision；窗口枚举/选目标/截图及保存await后重新检查授权代次；拒绝上一授权帧的指针输入，清帧期间迟到截图不能复活；乱序capture只保留新帧。专属fixture实际fake-native动作计数必须为0，不能以source regex替代。

**M-REC-01：旧P2P socket error误报新连接。** 红例旧socket.onerror在新start后仍发error。补socket和lifecycleGeneration检查，包含异步messageChain失败、过期key import失败。保留前任所有peer/decrypt/offer/answer generation修复；21项专属Node测试包含这些行为并通过。

### 仍须显式保留的风险
- **iOS外网每请求先试LAN1.2s、RelayTunnelClient.connect无single-flight且await可重入**：源码可见风险，尚无Swift执行复现或修复；URLSession接收循环的旧错误也可清新socket状态。Windows无swift/xcodebuild，不能以JS regex通过冒充iOS通过。
- **Android legacy WssRelayClient回调没有native方案同等generation绑定**：源码风险，真机/OkHttp重连竞态未验证；不因此关闭安全边界。
- **桌面transport manager冷start/stop及legacy兼容启动的长await、4个route worker冷路争用**：这里只列预算与风险，不宣称本次已消除所有尾延迟。
- **relay服务端半开desktop占房/慢端关闭回收**：交独立server owner，不修改services，不把其消息当已验收证据。
- **标准WS heartbeat兼容**：本地ws库default autoPong=true且receiverOnPing自动pong；Android源码OkHttp pingInterval20s；Chromium及URLSession需各平台协议实测。Android onStop只注销back/capture，未停WS，但Doze/杀进程不保证应答。codec加密PING/PONG不同于标准WS控制帧，不能混用证据。
- **重放边界**：代理只在写业务前选路，无失败后业务重发。broker TTL/取消结果保留unknown直到真实回执；加密codec replay window不等价端到端AI消息幂等。真实RPC在回执丢失时是否避免用户二次发送，未验证。

## 前任候选保留与当前证据
- Android current command期间继续仅poll stop/cancel；不派发第二普通动作；当前command lease检查跨确认/截图/文件回调，配对/断开清旧控制同意。JVM协议测试与Node broker验证通过；实际Activity/MediaProjection/确认按钮生命周期未运行。
- renderer/device-workspace防旧device回执/手势串设备，文档上传跨session不插入另一输入框；纯DOM/API fixture通过。
- 插件abort发生在state读取后不可提交动作，delay清abort listener；fixture通过。
- iOS activate/forget代次与Workbench requestedURL保留；源码审读，未编译、未实机。
- mobile-runtime/CSS的前批可访问性、缓存、history、主题和IME改动全部保留；混合静态/DOM测试证据不代表所有屏幕视觉验收。

## 验证与限制
- `pwsh-70`基线：3个route测试，2个预期业务红例，n30分位数如上。更早`pwsh-68`失败因Android Log JVM stub未mock；只接缝禁用测试日志后才取得红例，不把环境错误算产品复现。
- `pwsh-77`最终：`gradlew.bat --offline --no-daemon :app:testDebugUnitTest`，7个测试类72 tests，0失败/0跳过；21 Gradle任务中2 executed/19 up-to-date。首次候选轮同时实际compileDebugJavaWithJavac通过。未assemble、未安装APK、未联网下载。SDK XML版本提示为warning，未隐藏。
- `pwsh-76`：19 Node文件190 tests，188通过、1失败、1既有skip。失败是`native-p2p-desktop.test.cjs:358`旧精确嵌套await正则不容许decrypt后generation复核；已交总审维护测试契约，未私改其他owner文件。skip是官方QueueDock编辑/删除/立即发送，保持unverified。
- 专属`deep-audit-mobile.test.cjs`最终21项全部通过（包含上述190项）；`desktop-device-stream`8项与broker17项通过；fake clock TTL、50隔离设备cancel/stop循环、旧key/packet/reply延迟均有独立断言。
- Node子进程与Gradle调用只保留系统/工具链env，HOME/USERPROFILE/TEMP/APPDATA使用新临时目录，未继承DSH能力凭据。Gradle仅复用本机已存在cache且--offline，未读取/复制用户凭据。未启动桌面、未读配对文件、未碰真实手机/剪贴板/账号。
- `swift`/`xcodebuild`命令不存在；iOS编译、iPhone/iPad、真实Android手势/IME/旋转/通知/后台/公网质量均未验。

## 本轮最终候选哈希（SHA256）
| 文件 | SHA256 |
|---|---|
| mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessWebProxy.java |773648BA410F1709729B4838DE87A4382156BBE8F575C6BA0F16545BB7BB8B50|
| electron/bridge/desktop-device-stream.cjs |632348B54AA682CDE4E409504765865AB2C1CD536A71D8599866D8D8BD855CA2|
| renderer/native-p2p.js |235F0EAE8BDDE3F7C4A3160E6A62A7E37431002728964925E9F48023DBB45F8A|
| tests/deep-audit-mobile.test.cjs |6665B3E4C68E071BED45B03906965FEC6334BFE2B7C1344159E7F0481EF8F8F1|
| mobile/android/app/src/test/java/io/harnessdesktop/mobile/DeepAuditMobileRouteTest.java |2AB8C0A2FB83DE4FAA00D1096EAF8644405F18D3383AE9DC4D327780DA0807F3|
| mobile/android/app/src/test/java/io/harnessdesktop/mobile/DeepAuditMobileControlTest.java |DCD0F3FF241CC09C92D472D9DE731BC6DD3C47BCD2400E8AAE7B9F45D65F3D3D|

逐功能与场景证据见`coverage-mobile.json`。此报告提交的是源码候选与有限层验证，不是“移动全部功能/外网问题已全部解决”验收结论。

## Attempt 4：总审要求的同范围必要续作（保留以上历史证据）

### M-REC-02：legacy Android WSS迟到回调与旧SOCKS worker
前一attempt将它列作未修风险；本attempt已在**真实JVM生产类**复现并提交候选，替代该风险项的当前状态，但不删除先前记录。

- `WssRelayClient`接入包内`WebSocket.Factory`和`SocksServerFactory`接缝；测试使用fake WebSocket及未绑定ServerSocket，不创建网络连接，不读取实际profile。
- `pwsh-83`基线3测试2个红例：旧socket.onFailure在profile重开后关闭/通知新连接；stop后迟到onOpen仍发送旧hello、welcome仍能打开SOCKS。这不是推测的模型测试。
- 最小修复：start/stop generation；所有WS open/text/binary/close/failure及accept-loop回调绑定该代次；codec和socket先捕获，解密后/加密排队前再校验；异步旧worker的OPEN/DATA/FIN/RESET不能写新WS。streams.remove使用key+socket身份，旧worker finally不能删新流。
- 附带关闭当前正在SOCKS握手的socket：原worker在OPEN入表前未被stop追踪，弱网/旧连接可占8个worker至10s读超时。现在先登记openingSockets，stop统一关闭；测试gated InputStream证明reset立即释放旧worker，且新WS二进制发送数为0。已发出去的业务字节不能撤回，未增加业务重放。
- 所有state锁仅覆盖状态/OkHttp非阻塞send入队，不持有SOCKS read/网络等待；未缩短握手、heartbeat或重连TTL。
- 新`DeepAuditMobileWssTest`共5测试：7种旧callback×20次profile替换(140周期)、stop后hello/welcome负例、blocked旧SOCKS/reset/旧send负例、当前非法包仍fail-closed、当前失败只通知一次且clean restart成功。
- `pwsh-87`定向5/5并实际compileDebugJavaWithJavac通过；`pwsh-88`完整Android **77/77，0失败0跳过**，8个JVM测试类；21 Gradle tasks中1 executed/20 up-to-date。仍使用清能力env、临时HOME、现成cache和--offline，无APK。
- 本次未改route代码，复跑受控n30 latency P50/P95/P99=91/93/93ms；前轮242/491/493基线与90/94/94结果全部保留，不选择性擦除样本。

| 新增候选 | SHA256 |
|---|---|
| mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java |31BD5A43518414792FC03644C56EC3420D921D12A23B9D9ECFA29EE90660D510|
| mobile/android/app/src/test/java/io/harnessdesktop/mobile/DeepAuditMobileWssTest.java |99F013AD83AF3C1F58DCE260EBD7DEF7E254A867984E16BFB0E03886DE80CDCA|

### iOS最小后续方案：明确未实施、未原生验证
本attempt不扩大Swift核心传输改动，保留前任Swift候选。Android测量和JVM green不能外推到iPhone。

1. `Core/LoopbackProxy.swift`的`RouteCoordinator`(66–95)：增routeEpoch及last-good/短LAN失败冷却；warm relay直接openStream，冷启动仍按现1.2s LAN预算。networkChanged/update先epoch++并detach relayClient=nil，再await旧client.disconnect。每个connect await后复核epoch，过期channel必须close而不是返回。不能把actor串行当作跨await原子性。
2. `Core/RelayTunnelClient.swift`(23–41)：`connecting Task`在首await前登记，并发openStream共享唯一hello/welcome握手；send/receive每次await后复核epoch+socket身份。`disconnect`(71+)先epoch++、清connecting/socket/stream状态后取消旧task；`receiveLoop`(88–108)旧task的catch不得清当前socket。`send`(80–85)在codec.seal await后复核，不能把旧工作发往新连接。
3. `RelayProxyChannel.send`(54–57)每块单独建Task，不能依靠actor或Task启动顺序保证每stream字节序。若以后做流公平调度，需要显式per-stream发送序列/有界队列；不能对所有小帧全局抢先导致同流FIN/DATA乱序。
4. **原生验收门槛**：macOS/Xcode + iPhone/iPad simulator中用受控URLSessionWebSocket transport测6并发connect只1hello；profile/reset/stop期间迟到welcome/error不复活；旧seal不能发新socket；LAN失败后warm relay无每请求1.2s开销；foreground/network change恢复；逐流随机分块字节一致；取消必须完成所有等待者。另需设备/系统暂停时heartbeat与网络恢复测试。Windows无Swift工具链，未用JS理想状态机替代。

### 大快照producer和endpoint HOL：只读定位，未仓促改协议
- Android `MainActivity.requestOfflineSync`(844+)独立offlineSyncExecutor发GET `/__harness_mobile__/sync/manifest?refresh=1`，connect8s/read45s；resume才带cacheIdentity、snapshotEpoch、cursor。它与WebView请求逻辑独立。
- 桌面`mobile-sync-service.cjs`(668+)并行读取官方workspace/follow baseline及session/list后commit；`workspaceManifest`(707+)交MobileSyncStore.readSyncChanges；store(1097+)在可resume时返回delta，epoch/identity不匹配及冷启仍返回完整snapshot。gateway(1229–1242)一次`response.end(JSON.stringify(manifest))`，未见服务端分页。
- 每HTTP请求拥有不同SOCKS streamId和upstream TCP socket，**但并非独立物理传输**。桌面`wss-relay-adapter.cjs`(174–180)在upstream data事件同步分块并连续send至同一WS/TCP发送队列；当前无公平流轮转或snapshot优先级。
- 团队relay owner报告512KiB前排快照+64KiB/s链的fixture小帧HOL约5s；此值是外部成员报告，不是本模块独立WAN验证。完整512KiB在64KiB/s序列化理论为8s，实际小帧排队取决于已发送量/入队时刻，不能固定宣传5s。
- 后续应在可识别语义的endpoint评估snapshot分页/增量、每流有界队列与公平轮转，并逐流保持DATA/FIN顺序。**blind relay不得业务解密、按消息意义重排或自动业务重发**。本attempt只定位、不改协议，也不称HOL已经解决。

