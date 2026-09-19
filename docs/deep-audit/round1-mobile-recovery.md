# 手机自动恢复补验：实际责任边界与负面链证据

## 结论

**本轮没有完成 App 自动重连验收。** 已完成当前生产 `NetworkReconnectPolicy`、`WssRelayClient` 与真实 Java/Node 传输链的有界负面验证，并实证指出自动恢复 owner 无法直接用当前纯 JVM 环境运行。测试成功表示这些有限断言成立，不表示 Android 自动重试已经通过，也不表示 App 本身不能自动恢复。

当前生产由 `MainActivity` 的 Android `Handler` 调度重连；`WssRelayClient` 失联后只停止并调用上层 `onFailure`。因此不能把测试代码主动调用第二次 `start()`、已 ready 后的新请求，或 OkHttp 的 `retryOnConnectionFailure(true)` 当作 App 层自动重连证据。

本次只新增测试、fixture、本文及专用证据。生产、原61命令fixture、原报告与 `coverage-master.json` 未改；未运行发布、安装、真实设备、60131、公网、账户、实际配对或业务模型。

## 已检查的实际责任链

| 层 | 当前责任和边界 |
|---|---|
| `MainActivity.java:198–209` | `remoteReconnect`/`nativeReconnect` Runnable 检查 profile 引用后重新启动相应 transport |
| `MainActivity.java:1398–1433` | 真实 WSS `onFailure` 清 ready port、更新 routes，经 `runOnUiThread` 向 Handler 安排重试；ready 清 attempts |
| `MainActivity.java:1334–1395` | native P2P/WSS failure 同样交 Activity 调度；不是 Java transport 自己持续重建 |
| `MainActivity.java:1070–1149` | 网络回调 debounce 后 commit，丢网停止 transport；稳定切网重置路由偏好并重启，正常恢复重新启动 |
| `NetworkReconnectPolicy.java` | 纯 Java 候选/commit/generation 状态；只返回 holdoff，不拥有 Android 时钟或网络事件来源 |
| `WssRelayClient.java:268–288` | 当前 generation failure → `stop()` → Listener；清 socket、SOCKS、openingSockets、streams；自身无重连 timer |
| `HarnessWebProxy.java:169–255` | 请求建连前 race/cooldown/路线偏好；失败路线不是已转发 HTTP 业务的重放器 |
| `WssRelayAdapter` | socket generation、握手 deadline、关闭/stream 清理；disconnect 发事件给上层，未自行循环重试 |
| `NativeP2pClient` / `native-p2p-host` / `native-p2p-adapter` | Android native WebRTC 和 Electron renderer 依赖独立存在；没有执行其真实 NAT/设备路径 |
| `desktop-device-stream.cjs` | Computer Use 授权与目标/capture generation；不是 Android WSS 重连 owner，未调用真实 capture/input |

**退避并非指数。** 源码现行 WSS/EasyTier 为 `min(15000, 3000 + attempt*2000)`，即3/5/7/9/11/13/15秒并封顶；native 为5/10/15/20/25/30秒。本文只把此项记作精确源码事实，没有执行 Android Handler 验证整个时间序列。没有为了满足“指数退避”措辞擅改策略。

## 为什么不能声称 owner 已执行

新 `owner-probe.cjs` 用真实 Android35 SDK 和 JDK21，fresh HOME、JVM user.home/tmpdir、全拒绝网络/进程权限，实际调用 `new Handler(Looper.getMainLooper())`：

```text
java.lang.RuntimeException: Stub!
  at android.os.Looper.getMainLooper(Looper.java:30)
  at OwnerProbe.main(OwnerProbe.java:1)
EXPECTED_ANDROID_SCHEDULER_STUB
```

证据：`.artifacts/deep-audit-round1-mobile/owner-probe-1789275582138/result.json`。这是预期环境边界，不是生产崩溃复现。公共 Gradle modules cache 内未发现 `*robolectric*.jar`；不下载依赖、不读用户 Gradle properties/init 或真实配置。既有 `MainActivityTest` 的静态方法/源码检查与先前全类编译不等于运行 Activity 构造、Handler、生命周期或 WebView。

没有源方法复制成理想状态机，没有提取后仅测试副本并称生产 owner，没有修改字节码或制造假的自动 retry controller。

## 新实际组件链与正式运行

正式复跑：`pwsh-135`，直接 Node test reporter **3/3**，0 fail/skip/cancel，9650.619ms。内部为 **17 个具名 Java 检查**，不是额外17个 Node/JUnit tests 或用户需求。

- 汇总：`.artifacts/deep-audit-round1-mobile/checks-96c22ef5626f3a7f/summary.json`
- 真实链：`.artifacts/deep-audit-round1-mobile/transport-checks-96c22ef5626f3a7f/`
- 首轮同向成功 `pwsh-133`：`transport-2026-09-13T04-56-14-255Z-f79684/`；runner 后仅新增严格 run-key 独立目录，旧证据保留。
- 两个 job 已自然结束并收齐输出；没有遗留后台任务。

链：生产 `HarnessWebProxy` → 生产 SOCKS5 → 生产 `WssRelayClient` / AES-GCM / 实际 OkHttp → 实际 loopback blind relay → 实际 `WssRelayAdapter` → 实际 `MobileSyncService` / http-proxy / 全新合成 store → 合成 HTTP core ACK。

初始化只显式 `startRelay()` **一次**。随后测试向 fake core 发一条正常命令和一条待迟到 ACK 的命令；core 确認接收后由 fixture 终止真实 mobile relay socket。**第二次 start、自动恢复和恢复后新 ACK 均没有执行。**

| 观测 | 正式结果 |
|---|---:|
| 合成命令 | 2 |
| 正常 ACK | 1 |
| 故意断线无 ACK | 1 |
| core 执行 `normal-0` / `late-0` | 1 / 1 |
| 重复 core 执行 | 0 |
| mobile hello | 1 |
| 失联后观察窗口 | 3350.917ms |
| 窗口内新建 socket | 0 |
| 旧 callback 注入 | 40轮 × failure/closed/welcome/binary = 160 |
| 最后 streams/openingSockets/adapterStreams | 0 / 0 / 0 |
| 最后 manifestDownloads/manifestStarts | 0 / 0 |
| cleanupErrors/sourceDrift | [] / [] |

观察超过第一档3000ms，仅说明**没有接 Activity owner 时 transport 本身不重建**；不是 App 重连失败，也不证明永久不会重建。旧 callback 注入在失败后的旧 generation 上进行，不能外推“当前 Activity 上一个 profile 的已排队 UI Runnable”已验证。显式 Stop 是失败后再次 Stop 的惰性/不复活检查，不是实际 Android 用户按钮操作。

迟到 core ACK 确实产生，`downstreamDestroyed=false`；客户端拿不到 ACK **不等于核心未执行、被撤销或可安全重发**。本 fixture 从未重放业务。正常 ACK 对照唯一ID和请求正文 SHA256，未依赖只打印成功的日志。

### Java 同一单调时钟时间线

相对于一次显式初始化调用；epoch仅用于展示，差值来自同一 Java nanoTime 锚点，不作跨 Node/Java 亚毫秒性能结论。

| 事件 | 相对 ms |
|---|---:|
| explicitInitialStart | 0.000 |
| WebSocket factory 创建 | 39.144 |
| wireOpen | 73.259 |
| 收到 welcome | 76.856 |
| 生产 relayReady | 78.472 |
| normal-0 完整 ACK | 141.915 |
| 请求故障注入 | 150.136 |
| 生产 relayFailure | 151.041 |
| late-0 返回无完整200 | 151.593 |

正常命令耗时53.027ms；故意失联命令8.026ms。各仅一条，不给P95/P99或公网SLA。没有测自动retry等待、重连握手和恢复后ACK三个阶段；表格的78.472ms是**首次初始化**，绝不能改名为恢复耗时。

### NetworkReconnectPolicy 的12项内部断言

重复 active availability 不调度；switch holdoff=3000ms；旧网络 lost 不覆盖较新 usable candidate；commit前保持当前逻辑网络；稳定切换一次generation；重复commit无效；loss holdoff=1500ms；commit断网；recovery holdoff=250ms；commit恢复；旧网络迟到loss无效；100轮合成切换generation单调达到103。

这些执行的是未修改的生产 Java policy。测试自己调用 `commitPending()`，**不是实际 Android 回调计时、蜂窝切换或 Doze**。

## 既有ID增量映射与五维边界

原master SHA256 `8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794` 前后相同。598域行/115 USER聚类/104有限接受/唯一2929=2889pass+7fail+33skip保持原样，不倒填或增加覆盖计数。

| 既有ID | 本次适用范围 | 仍未知 |
|---|---|---|
| `network-debounce` | 生产纯Java policy的正常/失败/合成切换子场景有限通过 | Android默认网络回调、真实holdoff计时、系统后台 |
| `ws-android-legacy` | 真socket断线、旧generation回调拒绝、失败后Stop不复活及资源空集 | Activity owner自动重试、切profile排队回调、实际用户Stop |
| `rpc-duplicate` | fake core两条各一次；丢ACK仍执行、未重放 | official composer RPC幂等性、真实业务 exactly-once |
| `wan-end-to-end` / `USER-MOBILE-REALTIME-LATENCY` | 一条受控legacy链ACK和一条预期loss | WAN/4G/5G/外部WiFi/实际Host排队与UI呈现；USER整体未验 |
| `USER-MOBILE-EXTERNAL-RECOVERY` | 真实传输失联及最小owner边界证据 | 真正自动retry→握手→新ACK主链仍未执行；USER整体未验 |

五维：**normal**仅初始legacy握手/一条合成ACK；**error-recovery**验证fail/迟到/不重放，但自动恢复未知；**concurrency-switch**只有100合成policy周期及40旧callback周期，不是物理并发切网；**isolation**精确端口、synthetic身份、旧generation及HOME边界有限通过；**a11y**不适用于纯传输指标，未把Android UI无障碍算通过。

原61链60ACK+1预期loss、P95 7808.549→334.032ms及完整下载7846.440→11985.768ms仍仅引用前轮独验，不重跑、不改写。当前新链无快照性能负载，不把2命令加入61作为新吞吐结果。2MiB/16KiB生产上限和原有认证均未改变。真实Android16物理网络格仍0执行。

## 安全复跑与输入绑定

维护树 `D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`：

```powershell
$keep=@('PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE')
Get-ChildItem Env: | Where-Object { $_.Name -notin $keep } | ForEach-Object { Remove-Item ('Env:'+$_.Name) }
node tests/deep-audit-mobile-recovery.test.cjs
```

直接fixture可执行 `node tests/fixtures/deep-audit-mobile-recovery/run.cjs`。可选run-key仅接受1–100位字母数字短横线，输出限定自身artifact根，已存在目录拒绝覆盖；不接收任意输出路径或端点。

Node与JVM只允许本轮自建/登记的127.0.0.1临时端口；60131负例在connect前拒绝，无包发送给GUI。没有IPC、公网、真实服务token。gateway仅允许两条字面fake ACK路径，禁止其他请求和upgrade；synthetic room/key/cookie不是用户认证数据。Java SecurityManager在JDK21兼容模式生效，不是OS级沙箱或对任意未来JDK的保证。

每个child的HOME/USERPROFILE/APPDATA/LOCALAPPDATA/DSH_HOME/TEMP/TMP/JVM user.home/java.io.tmpdir均为新目录。仅精确读取四个公共缓存JAR（OkHttp4.12.0、Okio3.6.0、Kotlin2.1.0、org.json20240303）与SDK35；不启动Gradle、不下载、不读取其用户配置。生产先用Android checked JSONException编译，再以JVM org.json编译测试。唯一Android API替身为Log；Context null意味着系统网络绑定未执行。WSS测试factory精确映射synthetic URL到登记的本地ws，因此TLS/证书不在证据中。

源绑定：正式transport manifest含43个直接/工具链/附加package输入、92个实际载入CJS/JSON模块路径，sourceDrift=[]；wrapper另绑定自身与master。不是全仓库冻结证明，且未声称文档后续新建字节在更早run中已存在。

| 文件 | SHA256 |
|---|---|
| `tests/deep-audit-mobile-recovery.test.cjs` | `7d72d4eb481e66fae789e72b3aa58b5baf5f5287d3ee542312ae377e78c86105` |
| `tests/fixtures/deep-audit-mobile-recovery/run.cjs` | `48256fd83ad863057ad93b869e01b4997c2b62cf2e57bfc92f1323c59818d23c` |
| `tests/fixtures/deep-audit-mobile-recovery/owner-probe.cjs` | `46ae57ae25528e06e2b92dcfcf8d2cd9d6af17ef0220b56db8f0c181c63bfdb9` |
| `DeepAuditMobileRecoveryTest.java` | `74a6193db6f36a7665d4582e87db6dd8e43155e4d0caff7fc08b68753c671020` |
| 正式transport `result.json` | `6d2dfae249b652c8dec5d3110f0b876afeadfee3fb7272a7d7f5b23335b406a8` |
| 正式transport `completion.json` | `7f15c1eedbafd45074cc7889472bad7599ccd9ba90123089ea7a8319fbfd162e` |
| 正式transport `source-manifest.json` | `2f27dcf1eb438d346f365e72821a300d203a830a29d15a4ce0c710ac9752c203` |

`DeepAuditMobileRecoveryTest`直接复用冻结旧测试的包内HTTP/trace/fence helper，旧Main的61场景没有执行。新Node runner为独立受控派生，保留相同真实组件/端口守卫，删除不相关HOL/manifest场景；完整新增源与 `source-manifest.json.derivation` 记录区别，不伪称逐字节相同副本。

## 最小后续接缝提案（未实施，等待明确范围）

已向root提交证据与范围请求，当前不擅改生产。若要在本地闭合实际自动retry而不下载模拟环境，建议单独授权：

1. 新增同包 `RemoteReconnectController.java`，承载现行退避、唯一待运行任务、profile identity/generation、ready/reset/stop逻辑；只接受Scheduler接口与实际connect callback，不引入网络/业务重放。
2. `MainActivity.java`用真实Handler实现该Scheduler，真实失败/ready/断开/切换/destroy路径必须委托该controller；不能只是另写一套测试模型而Activity继续旧调度。保持线性策略、认证、配对、分页限制及UI语义。
3. JVM测试编译未修改的同一生产controller，先用可控时钟覆盖重复失败、封顶、ready重置、排队旧callback、Stop、profile切换，再用真实计时连接现有Wss链，记录失联→自动timer→第二次hello→ready→新ACK；旧在途命令仍只执行一次。
4. 独立复核必须核对Activity确实调用该接缝、source hash/完整编译与负面断言；即使通过，Android生命周期/UI/WAN仍不能宣称完成。

这是可审查的最小生产变更建议，不是已发生修改，也不是已通过验收。当前交付可接受为有界负面证据与精确缺口，不能将主目标自动恢复标绿。本文仅做Markdown结构/数据校对；本任务禁止访问60131，因此未打开GUI右栏预览。
