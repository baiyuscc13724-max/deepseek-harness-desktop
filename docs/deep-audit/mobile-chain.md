# Android 合成真实组件全链分段验收

## 范围与结论门槛

用户报告 Android App 在4G/5G和外部WiFi发送慢。本项只补原目标的本地传输链证据，**不改任何生产代码/协议、不增加业务重放、不接真机、公网、真实配对或Harness能力端点**。

实际组合：新Java请求 → 当前生产 `HarnessWebProxy` HTTP处理和 `connectThroughSocks5` → 当前生产 `WssRelayClient` / OkHttp / Java AES-GCM codec → 本地真实 `services/wss-relay/server.cjs` blind router / ws → 当前生产 `WssRelayAdapter` / Node codec → 当前生产 `MobileSyncService` / http-proxy / synthetic MobileSyncStore → fixture HTTP core ACK → 原路回Java请求读取完成。

不是复制状态机：生产源码直接编译/require。只注入包内factory/connector接缝来限定端点；proxy connector调用生产SOCKS方法而非fake socket。Android Context为null，不运行Android网络绑定；唯一Android API空桩为Log，防止SDK android.jar在纯JVM写日志时抛异常。合成URL `wss://fixture.invalid/chain` 被两端factory精确改映射到本轮loopback `ws://`，所以**TLS/WSS证书握手不在证据中**。

### 明确不证明

- 不是实体Android、蜂窝或外部WiFi测速；没有NAT、DNS切换、系统Doze与MainActivity生命周期证据。
- 请求为合成HTTP POST，不是WebView官方composer/RPC操作；fake core只校验JSON及返回hash，不执行模型、工具或用户命令，不证明LLM/Host业务调度或界面绘制延迟。
- 断线恢复由fixture明确stop/start，不证明App自动重连时机；另注入一次旧callback到真实Wss生产listener，单独标记为负例。
- 30–46ms上下行抖动和64KiB/s为**FIFO transport scheduler注入**，不是系统级tc/netem，也不是公网吞吐实测。初版独立timer造成过不符合TCP的乱序，已保留失败轨迹并改正测试调度器，不能归因生产。
- 此报告不把前轮route受控P95约491→94ms替代全链，也不外推iOS。

## 场景设计

1. normal：18个命令，3批，每批CyclicBarrier同时释放6线程。
2. jitter：18个命令，6并发，mobile→relay入队与relay→mobile出队加入30–46ms抖动；每连接/方向单head FIFO保证不重排。
3. 大快照共流：真实MobileSyncStore灌入1400个合成session元数据，生产 `/__harness_mobile__/sync/manifest?refresh=0` 返回完整manifest；下行按64KiB/s FIFO发送。等待真实队列至少400KiB再同时释放6条小命令，测ACK队头阻塞。完整快照字节数和SHA256与生产workspaceManifest预计算值比较。
4. 断线/迟到：fake core收到late-0后延迟700ms ACK；fixture终止对应mobile relay socket，旧请求应失败且不重发。新建通道后把缓存的旧binary/旧error回调投入真实旧listener，再发送6条新命令，验证ID、payload hash与重复执行次数。旧core ACK单独记录是否下游已经销毁。

每个成功请求核对唯一ID与请求payload SHA256；快照完整hash校验同流字节序。跨独立流的ACK完成顺序可以变化，不将“非数字ID顺序”误判为协议乱序。

## 隔离和可复跑方式

工作目录：`D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`。

```powershell
$keep=@('PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS')
Get-ChildItem Env: | Where-Object { $_.Name -notin $keep } | ForEach-Object { Remove-Item ('Env:'+$_.Name) }
node tests/fixtures/deep-audit-mobile-chain.cjs
```

- Node再清一次非白名单env，每次建 `.artifacts/deep-audit-mobile-chain/run-<UTC>-<random>/home`；HOME/USERPROFILE/TEMP/TMP/APPDATA/LOCALAPPDATA/DSH_HOME全部指向新空目录。
- JDK：`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`；Android SDK：`D:\Android\Sdk\platforms\android-35\android.jar`。
- 不启动Gradle；仅从 `C:\Users\Administrator\.gradle\caches\modules-2\files-2.1` 的精确模块目录选4个现成jar：okhttp4.12.0、okio-jvm3.6.0、kotlin-stdlib2.1.0、org.json20240303。**不读取Gradle用户properties、init脚本、配对或凭据**。`GRADLE_USER_HOME`指向未使用的隔离目录。
- javac编译生产时Android jar优先（checked JSONException），编译测试及运行时org.json JVM实现优先；都使用 `--release 17`，生产源码未改。两次javac各30s限时；Java整体100s限时；不重跑原77全量测试。
- javac的`-J-Duser.home`/`-J-Djava.io.tmpdir`与Java的`-Duser.home`/`-Djava.io.tmpdir`均显式指向新home。JVM Network SecurityManager只准本轮精确proxy/socks/relay/control端口；Node同样只准明确登记端口，禁止IPC；均用负例确认60131拒绝。SecurityManager依赖JDK21的兼容支持，不宣称适用移除该功能的新版JDK。
- gateway只放行fixture ACK及refresh=0 manifest路径，拒绝upgrade与所有其他路径；fake core只放行字面fixture ACK，cookie为新synthetic store的测试cookie。所有listener绑定127.0.0.1。端口冲突即失败，Java proxy的随机回退端口被fence拒绝。
- 子进程stdio=inherit，不建立Harness IPC或读用户配置；成功/失败均保留artifacts、源hash及cleanup错误。任务不触发发布/安装。

## 试跑历史（保留，不用失败数据充当成功性能）

- `pwsh-101` / `run-2026-09-12T16-33-31-017Z-dae9eb`：单一classpath误让JVM JSONException先于Android定义，原生产multi-catch编译冲突。调整fixture为两阶段编译；生产0变更。
- `pwsh-103` / `run-2026-09-12T16-35-26-670Z-176e21`：Node net已normalize参数数组被fence再次normalize，错误拒绝本轮本地端口。修正参数形状识别，允许范围不变；全部cleanup无错误。
- `pwsh-104` / `run-2026-09-12T16-37-10-564Z-14d0b6`：18 normal及部分jitter已经真实组件回执；初版独立setTimeout在毫秒舍入下逆序同流：stream51的DATA先到(1789231033785.42)，OPEN后到(1789231033786.2622)，生产adapter按协议RESET。此测试注入缺陷已改为单head FIFO，旧run不作为生产缺陷/完整成功结论。

## 正式本轮结果

**本地合成真实组件链通过，真实Android/WAN用户验收仍未通过。** 本fixture覆盖的是legacy WSS protocol=1备用链，不包括native QUIC/WebRTC路径。WSS房间已就绪后才开始HTTP命令计时；normal含首批冷SOCKS/route/JIT成本，不含首次WSS连接、TLS或rendezvous耗时；reconnect数值也是新通道就绪后的请求延迟，不是App自动重连耗时。

最终复核：`pwsh-106`，退出0，artifacts目录：

`.artifacts/deep-audit-mobile-chain/run-2026-09-12T16-47-25-091Z-5f0f66/`

| 场景 | 命令数 / 同时并发 | P50 ms | P95 ms | P99 ms |
|---|---:|---:|---:|---:|
| normal | 18 / 6 | 29.215 | 78.505 | 78.505 |
| FIFO上下行抖动 | 18 / 6 | 123.384 | 138.336 | 138.336 |
| 大快照共用下行物理队列 | 6 / 6，另有快照流 | 7750.998 | 7757.140 | 7757.140 |
| 新通道就绪后的6请求 | 6 / 6 | 17.553 | 17.848 | 17.848 |

总计49命令：48正常ACK、1故意断线无ACK；无非预期命令丢失、core重复执行或跨流ID串线。成功请求对应DATA包：上行96发/96收、下行56发/56收，丢包/重复/同流乱序都为0。此计数不把主动断线旧流计入成功包序校验；完整快照与请求payload仍独立作SHA256验证。

快照实际 **506112 bytes**，用时 **7824.775ms**，SHA256 `3aa0ca820258b0c76cfa0fcb6f9869d1b3767d574053c1fb4dd2582b7f8f928c`。每轮metadata时间字段可能导致1字节长度/hash差异，均与各轮生产manifest预计算值相等；不是固定死写expected hash。断线后旧fake core仍产生ACK且其HTTP响应对象`downstreamDestroyed=false`，但未串到新mobile流；这证明**通道丢ACK不等于核心未处理/已取消**，不能据此安全重发业务。本轮没有业务重放。

前一完整成功 `pwsh-105` / `run-2026-09-12T16-42-08-056Z-6a8963` 给出normal P95 66.323ms、jitter 144.101ms、共流7768.111ms、恢复后24.815ms，方向一致；最终复核增加显式DATA序列和源hash漂移断言。

### 分段P95（ms）

| 分段：起点→终点 | normal | jitter | 快照共流 | 恢复后 |
|---|---:|---:|---:|---:|
| Java提交→mobile tunnel enqueue，含loopback proxy/SOCKS/route | 34.402 | 5.211 | 4.632 | 3.223 |
| mobile enqueue→relay ingress，含上行注入等待 | 3.416 | 57.971 | 1.719 | 0.689 |
| relay ingress→转发调用 | 0.037 | 0.034 | 0.020 | 0.010 |
| relay转发→desktop adapter接收 | 2.417 | 1.392 | 1.771 | 0.775 |
| adapter接收→MobileSyncService handler | 13.627 | 4.269 | 6.056 | 3.007 |
| handler→合成core收到HTTP | 13.139 | 3.249 | 6.005 | 3.125 |
| 合成core收请求→ACK产生，非模型执行 | 17.539 | 9.405 | 17.541 | 6.446 |
| core ACK→desktop tunnel enqueue | 4.356 | 2.669 | 4.893 | 1.829 |
| desktop enqueue→relay ingress | 2.466 | 1.240 | 1.488 | 0.938 |
| ACK relay ingress→实际转发，含下行注入队列 | 0.054 | 58.724 | **7719.292** | 0.018 |
| relay转发→mobile解码观察点 | 2.567 | 2.620 | 2.766 | 0.453 |
| mobile解码→Java完整HTTP读取完成 | 1.372 | 1.598 | 5.727 | 0.663 |

总延迟使用Java单一`nanoTime`差值，不依赖跨进程墙钟。分段用Java单调时间锚定epoch、Node performance epoch，并通过7次fixture clock请求选最小RTT估算offset **+0.646ms**、半RTT **0.289ms**。该半RTT是本地校准观测值，不是时钟误差保证；亚毫秒跨进程差异不作性能结论。表格分段P95不能相加成总P95。n=18或6下P95/P99按nearest-rank同为样本max，**不是生产尾延迟置信估计**。合成core设置3ms timer但Windows排程/事件循环实际等待更长，以观测值为准。

核心证据：在该明确注入的64KiB/s共享队列下，小ACK约7.72s在relay下行队列等待，而gateway/core分段仍是毫秒级。真实组件在这组条件下可复现“发送/回显数秒”，不是仅route connector模型；但并不能断言用户4G/5G实际现场就是这一根因，或当前route锁修复已解决所有慢路径。降低快照体积、分页/增量、入WSS前公平分片或独立物理通道属于后续需单独授权和验证的方案，本任务未实施。

### 证据文件与源码绑定

- `result.json`：49命令逐条points、总/分段分位、跨流ACK完成顺序、迟到core ACK及范围说明。
- `events.json` / `java-result.json` / `node-events.json`：真实组件被动观察日志；使用不含8字节peer前缀的密文SHA256对应两侧同一个包，不修改协议载荷。
- `integrity.json`：DATA包同流序列计数、源码漂移为[]、时钟校准观测。
- `source-manifest.json`、`test-compile-command.json`、`java-command.json`：生产/fixture/dependency SHA256及精确离线编译/运行参数。
- `completion.json`：ok=true，cleanupErrors=[]，adapterStreams=0。JDK SecurityManager/旧API和Node util._extend仅deprecated告警；主动断线对应一次预期Upstream closed日志，不掩盖错误。
- Node fixture SHA256：`e68157bc877dfc23405b23553f82ba20c61da40e73cac602198cfa4361bccdcf`。
- Java fixture SHA256：`29d653d0e4107fbfb4e3f26142d6e98f0ec3304b354651c5c266924eab215117`。

本项只新增上述两个fixture文件、本文与专用artifact目录。既有生产、前轮mobile.md/coverage-mobile.json以及其他dirty改动均未改；未stage/commit。Markdown按结构与证据字段审校，未打开GUI预览（60131在本任务明确禁止访问）。
