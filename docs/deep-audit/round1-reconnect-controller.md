# Round 1：生产自动重连调度接缝与恢复全链（c957）

## 结论与验收边界

**生产控制器已抽出、接入并完成受控验证；不是“Android 真机自动恢复已验收”。**

- `MainActivity` 现在实际使用新增 `RemoteReconnectController`，不再内藏第二套 remote/native retry Runnable。测量使用同一份未经转换的 controller 源码。
- 实际 WSS 链仅显式初始化一次，断线后 **生产 controller 的真实 3000ms 定时器**创建第二次连接。第二个 hello/ready 之后，新 ID 获得 ACK。没有 fixture 手工第二次 start，也没有重放旧业务。
- 最终新 Node suite **3/3**；其中 Java controller/live 检查条目 **27**。另有未修改的旧 JUnit **15/15**；全部 **27 个当前生产 Java** 离线编译通过，API26 Java API 引用检查 **156/156**，离线 D8 成功。
- 有限证据涵盖纯调度逻辑、真实 JVM WSS/SOCKS/Node 数据链、Activity 源接线和完整 Java 编译；**Android Handler/Looper、Activity 生命周期/UI、实际 ConnectivityManager 回调、WebView、Doze、NAT/TLS/WAN、Native P2P/EasyTier 原生运行未执行**。
- 独立验收仍归后续 b8 复核。本报告与成员提交不是根验收，也不改写冻结的旧 684、61 命令指标或 master USER 状态。

## 改动与不变项

生产仅两文件：

1. `mobile/android/app/src/main/java/io/harnessdesktop/mobile/RemoteReconnectController.java`（新增 139 行）
   - profile 引用身份、`REMOTE`/`NATIVE` channel、每次尝试唯一 token 三层守卫。
   - transport 的 ready/failure/普通状态通知先进入 Scheduler，再在**执行时**验证 token；不能依赖入队前 profile 比较。
   - 失败只受理一次；每次重试生成新 token，保留同一 activation 的失败次数；有效 ready 重置失败次数。显式 activation（包括相同 profile）建立新状态与计数；不同 profile 失效两 channel。
   - Stop 取消已知 timer 并失效 token；已脱队旧 timer、旧 ready/failure/UI closure 也不能启动或修改新状态。
   - 所有 connect/UI action 在 monitor 外；仅短状态读写同步。动作中重入 Stop 不死锁，并阻止之后注册 retry timer。
   - 依赖 Scheduler 与 lifecycle/UI 同线程串行的明确契约。已在 owner 线程获得准入的 action 不会被稍后的 Stop 从中间打断；不是任意跨线程执行器的强制中断屏障。
2. `mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java`
   - Scheduler 直接适配原 `mainHandler.postDelayed/removeCallbacks`。
   - 三 transport 各自拆出 activation 与 connect 方法；retry 调用 connect，不递归 activation/reset。
   - 8 类通知的 socksPort、route、状态文案和打开工作台行为均移到执行时守卫内部。
   - 7 个失效点：新 pairing 赋值前、activateProfile、网络 loss、recovery、稳定切网、disconnect、onDestroy。
   - native `onDirectFailure` 仍只发布降级状态，不新增 retry；native relay-ready 与 direct-ready 均可由当前 token 发布。

保持原线性策略：

| 通道 | 连续失败延迟 | 上限 |
|---|---|---|
| WSS / EasyTier (`REMOTE`) | 3、5、7、9、11、13、15 秒 | 15 秒 |
| Native (`NATIVE`) | 5、10、15、20、25、30 秒 | 30 秒 |

未改为指数退避、未为测试缩短延迟；未新增业务队列/请求重放、未改凭据、配对校验、路由优先级或分页 2MiB 总量/16KiB 每页边界。`requestOfflineSync`、`clearRevokedPairing`、`openWorkbench`、`applyReadyRoutes`、`readyRoutes` 的方法文本与原快照一致；旧稳定切网/离线重试源断言也保持原样通过。

### 生产冻结摘要

| 文件 | SHA-256 |
|---|---|
| 当前 MainActivity.java | `a544e739c9b5fdf9d27cf87aafa27f8f0f507fe8b1218f541604a80338fcd05e` |
| 当前 RemoteReconnectController.java | `ed496cf0b5fdb70fd4e82e816ef9b550f561761606507c9a6a61f313b0a6d58b` |
| 历史 MainActivity.java | `c465f787e0c812de1ec379b88d2b0d4c840807cc39980ce3f284204fae667ffb` |

历史文件准确路径：`.artifacts/deep-audit-round1-reconnect-controller/before/MainActivity.java`。它是实施前只读快照，**不是当前 Activity**。当前全链、编译与最终 suite 均绑定当前生产 SHA，不用历史快照代替当前 Activity。

## 历史队列行为刻画，不冒充真机缺陷

`tests/fixtures/deep-audit-reconnect-controller/old-queue-probe.cjs` 从以上已固定 SHA 的原 Activity 中定位 WSS `onFailure(String message)`，以原字节正文编译到小型 Java wrapper。只替换外围 Android/UI/Handler 端口，不改该 callback body。

两次试验：旧 callback 先入队，然后（a）替换 profile；（b）同 profile 开启新 attempt 的状态标记。最后执行已排队 closure，均观察到旧 UI 状态覆盖和旧 3000ms timer 注册。wrapper 会把这两种**预期旧行为**作为通过条件，输出 `EXPECTED_OLD_STALE_UI_AND_TIMER`。

最终证据：`.artifacts/deep-audit-round1-reconnect-controller/old-queue-1789277678849-5a8c09/result.json`，含源码 SHA、精确提取 start/end、callback 文本/hash、生成 wrapper/hash 和 javac/java 命令。

这是“原 callback 正文 + 合成外围端口”的可复现刻画；未实例化原 Activity，不能称为 Android 真机/UI 缺陷复现。此前 SDK `Looper.getMainLooper()` 的 `Stub!` 是环境限制，旧 684 的负面证据仍只证明当时 WssRelayClient 本身没有 App retry owner，不等于当前 controller 不会重连。

## 当前生产 controller 的可控调度检查

`DeepAuditReconnectControllerTest.logic()` 的 Virtual Scheduler 只替换时钟/队列，不实现 retry 算法。27 条总检查中的前 21 条为逻辑检查（条目内包含多次断言），后 6 条为实际链/清理检查：

- 两 channel 各 8 次连续失败，逐个核验原延迟与 cap；每次注入 25 个重复 failure，只有一次 UI action/一个 retry。
- 边界前 1ms 不连接，到期恰好一次；ready 重置下一次延迟。
- Stop 后，即使直接执行已取出的旧 timer，也不连接；旧 ready/failure/post 全部丢弃。
- 同 profile 新 activation 前已经排队的旧 ready/failure/UI 不覆盖新状态。
- 同 profile 两 channel 并存；native ready 不会取消 remote timer；profile 替换失效两个 channel。
- 失败 action 内重入 Stop 阻止 timer 注册；connect 内重入 Stop；初始 connect 入队后立即 Stop。
- native 两种 ready 都受理；failure 后同 attempt 的 ready/post 不再复活。
- 100 次 activation/Stop 队列清零；connect、ready、failed action 使用 `Thread.holdsLock` 验证不持 controller monitor。

这些是实编生产 controller 的 JVM 逻辑测试，不是实际 Android 调度时间、网络回调或 Native P2P 运行证据。

## 真实自动恢复链

### 实际组成与替身

- 实际 Java：`RemoteReconnectController → WssRelayClient → RelayTunnelCodec(AES-GCM) → SOCKS5 → HarnessWebProxy`。
- 实际 Node：盲 WSS relay、`WssRelayAdapter`、mobile gateway/`MobileSyncService`、http-proxy。
- 替换 Scheduler 为单线程 `ScheduledExecutorService`，真实单调时钟，不推进虚拟时间；Java OkHttp `retryOnConnectionFailure(false)`，因此不能把 OkHttp 内部重试当作 App restart。
- 合成 profile/tunnel key/auth cookie、synthetic core HTTP ACK，映射固定 `wss://fixture.invalid/chain` 到显式注册的 `127.0.0.1` WS listener；不是 TLS。
- 所有监听/连接仅该 run 注册端口；Java/Node 均有 deny-before-connect 的 WAN/未知 loopback/60131/IPC 边界。独立 HOME、USERPROFILE、APPDATA、LOCALAPPDATA、DSH_HOME、TEMP/TMP 与 JVM user.home/java.io.tmpdir；未运行 Gradle、未读用户配置、未下载依赖。

### 因果顺序与计数

1. 仅一次 `explicitInitialStart` 调用 controller.start，第一 socket/hello/ready。
2. `normal-0` ACK；提交 `late-0`，以服务端执行 barrier 确定它已经进 core。
3. fixture 只切断实际 relay socket，**不调用第二次 start、不创建测试 retry controller**。
4. 实际 Wss failure 进入生产 controller；它注册 3000ms timer，真实等待后调用原 Connector，第二 socket/hello/ready。
5. 注入旧 socket 的 failure/closed/welcome/binary 各 40 次，共 160 次过期回调；提交新 `recovery-0`，成功收到 ACK。
6. core execution ledger 三个 ID 均只出现一次；旧 `late-0` 仍是预期 ACK 丢失，不在重连后重新发送。

| 项目 | 最终测量 |
|---|---:|
| 显式初始 activation | 1 |
| controller connect / mobile hello / ready | 2 / 2 / 2 |
| 业务提交 | 3 |
| ACK | 2 |
| 已执行但未收到 ACK | 1 (`late-0`) |
| 重复 core 执行 / 旧业务重放 | 0 / 0 |
| 注册 timer → timer 执行 | 3000.283ms |
| timer 执行 → 第二次 ready | 3.944ms |
| 第二次 ready → 新 ID ACK | 10.852ms |
| failure → 新 ID ACK | 3015.214ms |

上述是一次受控 loopback 运行的分段数据，不是 P95/SLA，也不可外推到 WAN/移动网络。结果中继承的 `postFailureObservationMs` 字段此处指实际 scheduled→timer 间隔，不再表示旧“无恢复观察窗”。

**唯一最终 suite 对应证据目录：**

`.artifacts/deep-audit-round1-reconnect-controller/transport-checks-8817ceaf4dde195a/`

- `result.json`：27 检查、3/2/1 计数、actual recovery 与分段时间。
- `java-result.json`：显式 activation/controllerConnect/timer/ready、业务结果和 wire events。
- `node-events.json`：hello、encrypted lineage、gateway/core ID 与执行 ledger。
- `completion.json`：`ok=true`、cleanupErrors=[]、adapterStreams=0、manifestDownloads=0、sourceDrift=[]。
- `source-manifest.json`：46 direct inputs + 92 实际 loaded CJS/JSON，当前源码与运行后 hash 零漂移。
- `java.exe-2-command.json`、两份 javac 命令：完整类路径与隔离参数。
- `ports.json`：该次注册端口。`fixture-config.json` 仅有合成 fixture 资料，不是真实配对。

独立派生来源保存在 `source-checks-8817ceaf4dde195a/derivation.json` 与 `executed-chain.cjs`：wrapper 对只读旧 684 runner 作有计数的精确字面替换，变更主 Java 类、加入 controller 编译输入、增加 recovery-0、把断言改为 2 hellos/实际恢复；其他真实链、端口 fence、cleanup 与输入 hash 留存。旧 runner 本体完全未变。源 manifest 中历史 `frozenRunner` 是继承的最初链 lineage；完整新增派生关系以本次 derivation.json 为准。

## 编译、API26、D8 与旧回归

### 当前全部 27 Java

`tests/fixtures/deep-audit-reconnect-controller/toolchain.cjs` 从只读历史离线工具派生到新 artifact scope，记录每项原脚本/生成脚本 hash 与替换清单；编译输入包含新增 controller，不是只编译测量片段。

- evidence：`toolchain-1789277155761-13cacf.json`，`compile-1789277155761-13cacf/manifest.json`。
- JDK21、SDK35、缓存的 33 个 AAR classes.jar + 10 个 JAR；`javac --release 17 -proc:none`；全部 27 production source 成功。
- 仅 R/BuildConfig 为占位生成；不替换 production 类。没有 Gradle/resource/APK、签名/安装、发布。
- toolchain summary 绑定所有 production、cache libs、生成资源、实际 java/javac/javap/jar 可执行文件 hash，结束复核 sourceDrift=[]。
- API26：SDK35 `api-versions.xml` + 实际 bytecode 常量池，检查 ManifestDownload/MobileAssetCache/controller 及嵌套类的 Java member refs，**156，unsupported=[]**。不是 27 类所有 Android API 的完整 lint/runtime 证明。
- D8：对全部 27 source 编译结果（含 R/BuildConfig placeholders）执行 min-api26 离线 dex conversion。`classes.dex` **335236B**，SHA `9e8432e239e567ac6c4426394e61005fb955d5af6c7e8b44b1898996363ce049`；无残留 StringConcatFactory/LambdaMetafactory 字符串；并非 Android 设备加载验证。

### 未修改旧测试 15/15

`legacy-1789277497411-28d3a0/result.json` 与 manifest：

| 旧套件/选择 | 数量 |
|---|---:|
| MainActivityTest：network debounce/generation | 1 |
| MainActivityTest：稳定切网接线、保留配对 | 1 |
| MainActivityTest：不完整快照重试保留完整缓存 | 1 |
| DeepAuditMobileWssTest（旧回调、Stop、握手、malformed、失败/显式重启） | 5 |
| MobileAssetCacheTest | 7 |
| 合计 | 15，0 fail |

这些旧测试未编辑；全 JVM 拒绝网络/listen/subprocess，使用相同当前编译产物。只选择上述 15 项，不声称旧完整 77/全库2929 重新执行或通过。

## 复跑入口

在维护 checkout `D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`。先从命令环境清除非白名单变量；runner 自建隔离 home，无需安装/下载：

```powershell
$keep=@('PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE')
Get-ChildItem Env: | Where-Object { $_.Name -notin $keep } | ForEach-Object { Remove-Item ('Env:'+$_.Name) }
node --test --test-concurrency=1 tests/deep-audit-reconnect-controller.test.cjs
node tests/fixtures/deep-audit-reconnect-controller/toolchain.cjs
# 使用刚返回的compile路径和transport路径，不能盲选旧artifact：
node tests/fixtures/deep-audit-reconnect-controller/legacy.cjs <compile-dir> <transport-dir>
```

- 单独实际链：`node tests/fixtures/deep-audit-reconnect-controller/chain.cjs`；自动生成唯一 run key。显式指定 key 时不得复用已存在 key。
- 单独旧 callback 刻画：`node tests/fixtures/deep-audit-reconnect-controller/old-queue-probe.cjs`。
- 每次仅向新增 scope 输出；frozen sources 只读、字面派生失败即停止。不得把旧 684 对旧 MainActivity 的 source-boundary 断言直接跑在新 Main 上，然后把语法不匹配当产品回归。

## 过程异常与保留证据

- 初次真实链通过（`transport-auto-1789277031054-5c5229`），此后补了 pairing 赋值前的 Stop；因此最终绑定选用 `transport-checks-8817ceaf4dde195a`，不以第一次 Main SHA 代替最终 SHA。
- 新 Node 源断言开发时一次失败：测试写成 `List` 而实际签名为 `java.util.List`；同轮校正 delay helper 参数的 `attempt` 名。没有改动生产逻辑来迎合该断言。失败轮的真实链仍通过；最终完整 suite 3/3。此为测试作者笔误，不隐藏为产品失败或新修复。
- JDK SecurityManager/API 弃用与 Node util._extend 警告保留。drop 后 `Upstream closed before response headers` 是明确预期丢失，不是意外失败。
- 未访问 GUI60131、ADB/手机、真实帐号/剪贴板、公网、用户 Gradle 配置；未联网/安装/发布/签名/写 master。旧 684 五文件与历史快照 SHA 在 suite 前后均保持冻结。

## 待独立复核明确保留

后续 b8 应独立检查当前 Activity 7 处失效与8通知接线、线程串行契约、两 channel 策略，再独立复跑本次 controller/live chain 和编译/旧回归。本接缝增加可测性与过期通知防护；可刻画的历史 callback 行为仍不等于实机现网已复现缺陷，更不等于真机修复验收。原 61 命令性能对照、旧 684 有限负面结论、USER/master 限制状态均未被本次自动扩大。
