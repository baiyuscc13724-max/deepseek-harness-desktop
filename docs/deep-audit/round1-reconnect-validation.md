# 自动重连接缝独立复核与现行输入重绑

## 结论

**接受“当前生产controller + 真实JVM计时/本地传输”的有限自动恢复证据；不接受“Android手机自动恢复/真实WAN已验收”的表述。**

独立复跑没有修改生产、作者test/fixture/报告、旧master或先前cc冻结文件。全部源输入以当前工作树完整SHA绑定，不把旧MainActivity全类hash继续称为当前，也不把工作树快照称为发布commit。

| 验证层 | 独立结果 | 不应混算为 |
|---|---:|---|
| 独立证据Node suite | 5/5，0fail/skip/cancel，56600.7084ms | 5项新用户要求 |
| 内嵌作者3个Node场景 | 3/3，8857.1004ms | 与外层5项简单相加 |
| controller逻辑/真实链条目 | 21虚拟逻辑+6真实链/清理=27 | 27个JUnit或真机场景 |
| 当前全部生产Java离线编译 | 27源文件 | Android资源/APK构建 |
| API26 Java引用子集 | 156/156 | 全Android API兼容性 |
| D8 | min-api26，DEX038，335236B | APK、安装或真机运行 |
| 选定旧JUnit | 15/15 | 原完整77或全仓测试 |
| 原61命令HOL/paging链复跑 | 60ACK+1预期loss，0意外drop/重复 | 自动owner恢复证据 |

唯一后台执行 `pwsh-148` 已退出0并收齐。完整raw子进程日志、命令/env键、结果JSON和编译产物保留于新独验目录。本轮未确认新产品缺陷。

## 现行冻结输入

| 文件 | 完整SHA-256 |
|---|---|
| 当前 MainActivity.java | `a544e739c9b5fdf9d27cf87aafa27f8f0f507fe8b1218f541604a80338fcd05e` |
| 当前 RemoteReconnectController.java | `ed496cf0b5fdb70fd4e82e816ef9b550f561761606507c9a6a61f313b0a6d58b` |
| 当前 DeepAuditReconnectControllerTest.java | `6d4bda624a62dbafc705f6ffa7e9d59fdb430293357fe7ec966c3c5fa656f807` |
| 作者 handoff-8817ceaf4dde195a.json | `7acfcfb618c7f351a4bd9a37559462c7a6155919118d499c28c84e536f1df886` |
| 独立测试 deep-audit-reconnect-evidence.test.cjs | `c0238c57048dd34ae437a2ad3402ec80df927b5ea767bcde4473769813207ea7` |
| 新实际链 source-manifest.json | `dac63fa1e0f442a3fb17e699e32f1b74a457e853291658ec7626a41b3ccf7d7c` |
| 旧 master，完全不改 | `8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794` |
| 先前cc final-freeze，完全不改 | `f4fdd2f59cdefd03ffc9ad6016a7e6d06e2d4143ea8641d1e655e2bd95caa210` |

作者handoff的源/证据、46 direct+92 loaded CJS全部先核hash；每个有界执行前后再核。92个实际加载模块与作者最终链完全相同。先前cc的35个冻结文件逐个仍一致；其历史owner结论保持原时点。本次仅新增 `coverage-round1-reconnect.json`，旧598域行、115聚类、104有限接受、2929=2889pass+7fail+33skip全部不变。

## 生产接线独立审查

当前 `MainActivity` 的Controller Scheduler直接代理原 `mainHandler.postDelayed/removeCallbacks`。三transport的activation调用 `start(profile, channel, token→connect...)`；重试直接走connect，不递归activation重置计数。五个离线/认证/路由方法与历史快照逐字节一致：`requestOfflineSync`、`clearRevokedPairing`、`openWorkbench`、`applyReadyRoutes`、`readyRoutes`。

### 七个失效点

| 当前源码位置 | 动作 |
|---|---|
| connect，L787 | 配对profile赋值之前stop |
| activateProfile，L1002 | 新activation前stop，再清理旧transport |
| reconnectAfterNetworkChange，L1071 | committed loss时stop并清旧线路 |
| reconnectAfterNetworkChange，L1100 | usable recovery重新start前stop |
| restartRemoteTransportsAfterNetworkSwitch，L1111 | 稳定切网重绑之前stop |
| disconnect，L1203 | 清配对后stop，随后清transport |
| onDestroy，L1910 | WebView/transport销毁之前stop |

### 八类执行时通知

Native：relay-ready→ready、direct-ready→ready、direct-failure→post、failure→failed；WSS：ready→ready、failure→failed；EasyTier：ready→ready、error→failed。8个闭包开头均再次执行 `canApplyRemote(profile)`，同时controller在队列实际执行时验证profile引用、channel state、attempt token及failed状态。socksPort、routes、状态文案、打开工作台等操作均在此守卫内，不是只在排队前比profile。

native `onDirectFailure` 仍只发布降级状态，**没有新增retry**；同attempt的relay-ready和direct-ready均可执行。remote线性3/5/7/9/11/13/15秒、native5/10/15/20/25/30秒保持，未缩短真实3000ms首档，未改为指数退避，controller没有业务请求队列或重放代码。

### 串行契约与Stop局限

源码同步锁只保护短状态变更，connect/UI action在monitor外；failed action重入Stop会使之后timer注册检查失效。Virtual Scheduler中的旧token、旧已脱队timer、排队ready/failure/UI、同profile新attempt、不同profile、两channel独立、25倍重复failure、8档延迟/封顶、ready reset、100 activation/Stop周期均执行实际生产controller。

但**正确性依赖Scheduler与owner lifecycle/UI同线程串行**。已经通过准入且开始运行的action，不会被稍后的Stop从中间强制打断。live测试使用单线程ScheduledExecutorService处理通知/timer，初始激活和测试结束Stop由测试线程按latch边界调用，并非对任意线程交错的强制取消压力证明。不得宣称任意跨线程Stop都能阻止刚准入的action。Android的Handler/Looper/Activity/UI实际线程行为本次没有执行。

`activity-independent.diff` 是在fresh HOME、禁外部diff/textconv的仓库Git下独立生成的完整当前/历史差异；预期diff退出1已明确作为“存在差异”处理，命令最终退出0，未改源。各接线方法文本hash在 `wiring-review.json`。

## 历史callback精确提取与新行为

旧快照完整SHA为 `c465f787e0c812de1ec379b88d2b0d4c840807cc39980ce3f284204fae667ffb`。独立重跑作者的精确WSS `onFailure`提取probe，另验证其start/end切片与编译进wrapper的callback逐字节相同，callback SHA **`085dd7ccbe28bae5dee16c165a19e4c393957c7c264f7cc0bcbffc7a91b4b291`**。

分别在旧callback入队后替换profile、保持profile但标记新attempt，再执行已排队closure，均真实观察到合成外围UI状态覆盖及3000ms timer注册，输出 `EXPECTED_OLD_STALE_UI_AND_TIMER switchedProfile=true/false`。wrapper只替换外层Android/UI/Handler端口，不修改callback正文。

这是“精确旧callback + 合成外围”的行为刻画，不是旧Activity构造/生命周期或真实设备缺陷复现。新生产controller的执行时token检查在当前独立逻辑/链中通过，但不能自动把此刻画升级成“真机旧bug及修复已验”。

## 真实自动恢复链与单调时间

实际链为当前生产 `RemoteReconnectController → WssRelayClient → SOCKS5/HarnessWebProxy → AES-GCM/OkHttp → 本地blind relay → WssRelayAdapter → MobileSyncService/http-proxy → fake core ACK`。Scheduler是替代端口，重试算法不是测试复制。OkHttp设置retryOnConnectionFailure(false)。

关键序列：只1次显式初始化 → 初始hello/ready → normal-0 ACK → late-0已到核心后强断socket → failed进入生产controller → 注册3000ms → timer回调产生**第二次**connect/socket/hello/ready → 160旧socket callback不污染新状态 → **新ID** recovery-0 ACK。没有fixture手动第二次start。

| 计时边界 | 本轮ms |
|---|---:|
| failure→scheduled | 0.159912109375 |
| scheduled→timer | 3000.15185546875 |
| timer→第二ready | 4.126220703125 |
| 第二ready→新ACK | 17.1962890625 |
| failure→新ACK | 3021.63427734375 |

所有这些差值从同一Java nanoTime锚点的原始events/requests独立重新计算，并与结果JSON精确比较；断言failure≤scheduled<timer≤第二ready≤新ACK，不混用Java/Node时钟。只有1次恢复样本，不能产生P95/P99或WAN SLA。

3业务=2ACK+1预期loss；normal-0、late-0、recovery-0核心执行计数各1，重复0。late-0确实执行且核心有迟到ACK、downstreamDestroyed=false，但客户端没有完整200响应。**恢复没有重放旧业务，丢ACK也不意味着业务已撤销或可安全重发。** streams/openingSockets、adapterStreams、manifestDownloads/Starts最终为0，cleanupErrors/sourceDrift均空。

## 实際产物绑定：全Java/API/D8/旧JUnit

离线编译重新使用27个当前生产Java源、SDK35、明确公共缓存AAR/JAR，R与BuildConfig是受控标识符placeholder，没有Gradle/resource合并或APK构建。API26校验覆盖ManifestDownload、MobileAssetCache、controller及其nested classes的156个Java常量池引用，unsupported=[]；不是对整个App全部Android API的证明。

真实链运行目录中的controller与5个nested `.class`，逐个与全部27Java编译目录的对应产物SHA相同；controller主class SHA为 **`275a4c26d973118f52fcbcfdd8e5f7533d7230d6956b04a86d47b2ec2a435723`**。这把实际运行类绑定到当前完整编译源，不只校验源文件名或打印成功。

D8输出DEX038、335236B、min-api26，完整SHA **`9e8432e239e567ac6c4426394e61005fb955d5af6c7e8b44b1898996363ce049`**，与作者结果相同；无StringConcatFactory/LambdaMetafactory残留标志。D8不是APK、资源或Android运行验证。

15个未修改旧JUnit：MainActivityTest三个选定policy/stable-switch/incomplete-sync源码/逻辑用例，全部DeepAuditMobileWssTest和MobileAssetCacheTest。使用本次current compile与新chain classpath，result count15/failed0、manifest sourceDrift=[]；没有跑整个77项旧suite。源码断言并不执行Activity UI。

## 原61命令/HOL/cache的现行必要回归

原61链在新路径复跑，Java场景和业务/分页/顺序断言完全不改。test目录根和require深度作精确可逆路径派生；额外只在临时端口分配/gateway加入拒绝60131断言，原registered loopback fence未弱化。旧fixture/证据只读。

- 61条合成业务：60ACK、1预期断线loss，0意外drop、0重复核心执行。
- 成功DATA upload150/150、download107/107，无丢失/重复/重排；按流ID/body SHA验证，不宣称跨流回应全局有序。
- 3个完整快照成功；受控中断快照保留旧cache，最终所有manifest转移/启动清零。
- 对照快照1400 sessions、506112B，字节hash前后同为 `b855a6add9784d29be71f74aa195eaa1f9dad2a468b12aa8d263d00b029c384a`。
- 本轮合成FIFO抖动/64KiB每秒限速对照，bulk ACK P95 **7795.957ms**、paged ACK P95 **337.3ms**，满足原 `<1/3` 边界。此值只属于本轮本地受控样本，不替换旧报告数值、不等于OS网络仿真或现网SLA。

其manifest中的当前MainActivity记录与a544e739完整hash一致，未变HOL/cache/WebProxy/WSS等生产依赖逐项与全27Java编译源重绑。该旧61链仍**fixture显式重连**，不执行新controller；自动owner证明只来自前述3业务链。两条证据层明确分开。

## 隔离、派生与限制

- 顶层先清空非系统环境，再创建fresh HOME/USERPROFILE/APPDATA/TMP/DSH_HOME；各子进程再次白名单，JVM user.home/tmpdir都落新目录。只读明确SDK/JDK和公共Gradle modules缓存，不读用户Gradle配置，不下载依赖。
- 新链Node仅登记127.0.0.1临时端口，Java SecurityManager拒绝非登记connect/listen及进程；60131故意负例在connect前拒绝。没有弱化fence、UI控制或访问公网。
- 配对身份、cookie、密钥、store与core全部合成。真实网络设备、账号、剪贴板、手机、GUI、发布/安装均未操作。
- 作者3Node suite仅改根目录、输出目录、fixture位置及旧快照明确路径；断言正文未改变。chain工具仍用作者完整deterministic转换；独立重建生成源并逐字节比较。所有外层before/after/count/反向还原记录在 `derivations.json`，SHA `7c976715a4c7450f7c71b8d255771028d1c1563501981e7bcab4d60f941817d7`。
- 安全结论是受控端口/API与代码审查证据，不是OS全进程syscall/抓包证明；JDK21 SecurityManager兼容模式不外推未来JDK。
- 部分javac原始日志采用非UTF8本地编码：`read`对toolchain.log报告invalid UTF-8，保留原字节及完整hash；未因此重跑或重写。编译/API/D8/进程结果JSON可读且各退出0。弃用警告及预期丢ACK异常均保留。
- 未执行Android Handler/Looper/Activity生命周期、ConnectivityManager、WebView、Doze、Native P2P/EasyTier runtime、WAN/NAT/TLS、官方RPC/model。Markdown仅结构/数据校验；任务禁止GUI，未打开右栏预览。

## Sidecar与交付

`coverage-round1-reconnect.json`按6个既有ID记录五维局部证据：USER-MOBILE-EXTERNAL-RECOVERY、DOMAIN-mobile-ws-android-legacy、DOMAIN-mobile-network-debounce、DOMAIN-mobile-rpc-duplicate、DOMAIN-mobile-cache-index、USER-MOBILE-REALTIME-LATENCY。所有master原状态不变；尤其手机外网实时性与实际Android恢复仍没有整体通过。

- `tests/deep-audit-reconnect-evidence.test.cjs`：独立复跑/源接线/类产物/时间重算/旧回归验证。
- `docs/deep-audit/coverage-round1-reconnect.json`：新sidecar，旧cc sidecar冻结不变。
- `docs/deep-audit/round1-reconnect-validation.md`：本报告。
- `.artifacts/deep-audit-round1-reconnect-acceptance/independent-v1/`：执行日志、命令回执、review-summary、输入冻结、差异。
- `.artifacts/deep-audit-round1-reconnect-acceptance/final-freeze.json`：最终明确证据与当前compiled产物SHA清单，不自引用。

在维护树中新PowerShell进程中复跑时必须选不存在的run名；不要覆盖本次证据：

```powershell
$keep=@('PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE')
Get-ChildItem Env: | Where-Object { $_.Name -notin $keep } | ForEach-Object { Remove-Item ('Env:'+$_.Name) }
node tests/deep-audit-reconnect-evidence.test.cjs independent-v2
```

源或已冻证据hash改变应停止重新审定，不可改旧断言求绿。本报告不是实际App/发布/真机验收凭证。
