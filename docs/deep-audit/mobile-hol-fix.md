# Android manifest HOL 修复与缓存短提交验收

## 结论

已实现**实际 Android 消费链**的兼容性有界 manifest 拉取，不是只缩小测试负载。桌面仅对 `paging=1` 提供顺序 16KiB 页；`MainActivity` 使用新的 `ManifestDownload` 拉完整内容，再通过 `MobileAssetCache.PreparedSync` 在后台准备、在短 generation 门内原子替换。没有改 blind relay、密文次序或业务重放策略。

受控真实 WSS 链中，同一份 **506112B、1400 个会话**、同一 SHA256，在相同 **64KiB/s 下行 + 双向 30–46ms FIFO 抖动**和 6 个并发小命令下，ACK P95 从 **7810.928ms 降至 349.943ms（约 95.5%）**。代价是完整后台下载从 7.855s 增至 12.092s。这里的 ACK 是合成 HTTP core ACK，**不是 LLM、真实 RPC 执行或公网 SLA**。

## 验证对象和证据

维护树：`D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`。

下表artifact目录相对于 `.artifacts/deep-audit-mobile-chain/`；`tests/` 开头的源码路径相对于维护树：

| 证据 | 目录/文件 | 结果 |
|---|---|---|
| 最终冻结源码全链 | `run-2026-09-12T18-57-43-209Z-1898f1/` | 原 49 + 新 12 = 61 命令；60 ACK、1 原有预期失联；3 完整快照 + 1 有意中断分页 |
| 同负载比较 | 最终目录 `paging-comparison.json`、`result.json` | 全量字节、哈希一致；1400 会话已实际写入缓存 |
| 真正分页失联 | 最终目录 `paging-interruption.json` | 真实 relay 断开后 113.180ms 返回失败503；旧缓存字节未变、1400 会话仍可读 |
| 帧完整性/资源 | 最终目录 `integrity.json`、`completion.json` | 成功请求 DATA 上传153/153、下行107/107，drop/duplicate/reorder均0；sourceDrift空；清理错误空 |
| 新 JVM 组件/缓存负面 | 最终目录 `manifest-jvm-result.json` | 31/31 |
| 新桌面 HTTP 契约 | `tests/deep-audit-mobile-manifest-paging.test.cjs`；运行输出 pwsh-117 | 9/9 |
| 原有 manifest 契约 | `legacy-manifest-1789239810972/`；运行输出 pwsh-120 | 7/7；原测试仅按 manifest 名称过滤，未改原断言 |
| 原有缓存 JUnit | `legacy-cache-1789240091015/` | 原 `MobileAssetCacheTest` 7/7；未运行完整77用例/Gradle |
| MainActivity 全类编译 | `main-compile-1789238926787/manifest.json`、`result.json` | 26 个生产 Java，含 MainActivity，真实 Android35 SDK + 33 缓存 AAR + 实际 JAR；javac通过 |
| minSdk API 核查 | 同编译目录 `api26-result.json`、`paging-bytecode.txt` | 147 个 helper/cache Java 成员引用依 SDK API继承元数据解析，0 个缺失/高于26；2 个编译器 bootstrap 单列 |
| min-api26 DEX转换 | `d8-api26-1789240733135/` | 缓存 SDK35 D8，26生产源码的编译类（含R/BuildConfig占位）转换成功；DEX038，328908B，两类bootstrap名称均未出现在DEX |
| 交付时绑定 | `handoff-final-manifest.json` | 再核当前源码与最终全链、全类编译输入一致；另记录新 HTTP 测试、报告哈希 |

最终全链的前后 JSON SHA256 都是 `0b0e67d72120575560b0a7776412ff3772d6d427d123987e816dc0c26a6a7dbe`。每轮重新生成 epoch/cursor，所以跨运行哈希会不同；每轮**内部**都比对同一完整字节串，未用更小快照替代。

## 同负载实测

| 指标 | 原200整块快照 | 新206有界分页 |
|---|---:|---:|
| 全量 payload | 506112B | 506112B，31页 |
| 会话数 | 1400 | 缓存实际保留1400 |
| 并发 ACK 数 | 6 | 6 |
| ACK total P95 | 7810.928ms | 349.943ms |
| ACK 在 relay 出队前等待 P95 | 7738.236ms | 266.781ms |
| 完整下载 | 7854.528ms | 12091.782ms |
| 后台准备（合并/哈希/写/fsync） | 未测 | 99.707ms |
| 原子提交 API | 未测 | 1.116ms |
| 新路径下载+准备+提交+收尾 | — | 12196.863ms |

每组仅6个并发样本，本组 P95/P99 接近最大值；不是长期分位数估计。原49命令场景仍先独立执行。追加比较中，整块模式用至少400KiB积压作 barrier，分页模式仅需至少8KiB积压；不能要求已避免巨量积压的分页再积压400KiB。两者都在真实快照数据已排队时发送命令，带宽、FIFO jitter一致。

另一次成功对照 `run-2026-09-12T18-42-58-563Z-a084cf` 为 7809.776→335.666ms，完整下载7849.620→11993.054ms；它尚未加入最后的分页断线/缓存线程屏障用例，不能替代最终证据。

## 协议与兼容性

- 旧客户端不带 `paging`，维持原200全量接口；新手机遇到旧桌面200，仅首响应允许有界完整兼容回退。**这种回退没有HOL收益**。
- 206 每页最多16384B，携带 `Content-Range`、transfer token、整包SHA256、cache identity、epoch、cursor；完整标记为0，不能把一页当完整快照应用。
- 后续 GET 只拉同一 token 的严格下一个 offset；每次请求重新检查配对授权及当前 epoch。token不是凭证，跨设备、撤销、epoch变化、乱序和过期均不能继续读取。
- 每设备仅一条下载；新的首请求替换旧的部分下载；同设备首请求尚在准备时返回429。全服务最多4个开始中/已保留的下载，每份JSON最多2MiB，固定180s TTL，stop/revoke/完成及时释放。
- 上述8MiB仅指4份保留的 immutable payload上界，**不包含序列化临时对象和传输栈缓存**。每次发送复制当前小页，避免已完成响应继续引用整包。
- 新手机一次只等一页；页间让出20ms，不并发预取，也不为失联重发业务。页面拼接后校验完整 hash、tuple、UTF8和JSON元数据，才能交给缓存。
- 连接8s、单次读15s、下载总预算120s。预算在读前后检查；一个阻塞读可使实际返回超过总预算，直到读超时。`cancel()` 是不阻塞 UI 的标记，I/O所有者在finally关闭连接，**不是保证即时打断内核读**。
- 因仍共用物理WSS FIFO，其他旧客户端大响应、其他大流或丢包仍可能阻塞；本修复约束的是新消费者的manifest在途量，不是全局QoS保证。

## MainActivity 与缓存生命周期

`requestOfflineSync` 捕获配对和 generation，以实际 `ManifestDownload` 获取数据。JSON完整校验、缓存合并/哈希/临时文件写入及文件fsync都在 `offlineSyncLock` 外；进入该锁后重新核 generation、profile和cancel状态，再调用短提交、保存相同同步游标。切换、disconnect及destroy使用同一门失效旧generation/取消旧下载；旧任务finally释放占用后可调度当前profile，避免新profile被旧在途状态饿死。

`PreparedSync` 是私有暂存对象，绑定 cache实例、配对identity、mutation revision；每个缓存实例只准一个未关闭 preparation。全部delta先在内存合并并验证，最后一个非法delta不会逐项污染旧快照。clear与旧API成功写入会增加mutation revision；提交只验证轻量状态、执行缓存根内原子rename及元数据更新，不重新hash/fsync。

读取旧快照的准备路径是非破坏性的，不能因后台旧读失效而删除并发新文件。受控双线程屏障验证：准备读暂停时clear仍可返回，解除屏障后的准备被revision拦截，缓存不能复活。`PreparedSync.close()` 在Activity门外删除pending/prune并释放permit；异常、取消、TTL和未提交阶段均覆盖清理。超过10分钟遗留stage可在后续准备中清理。

原子move不支持/失败时不做非原子覆盖回退；已测试提交前注入move失败保留旧字节。**未做断电故障实验，也未为目录做fsync；不声称目录项断电持久性**。cache monitor内仍有rename/文件元数据操作，门外prune仍可能占用cache monitor，不承诺所有存储设备上零UI等待。暂存安全假设应用私有目录，无跨进程恶意文件替换测试。

## 负面与回归覆盖

- 桌面真实HTTP：旧200字节重构、每页授权/跨设备/撤销、非法offset/token/query、epoch替换、首请求替换/TTL/stop、最多4份、超2MiB、并发首请求+await期间revoke、incomplete小503。
- JVM生产下载器：范围/长度/整包hash/identity/epoch/cursor/token变更、EOF、超页/超总量、非法UTF8、初始旧200兼容、途中200、途中鉴权失败、禁止跳转、取消和连接关闭。
- 实际cache API：暂存不改旧字节、一次性/实例/配对绑定、clear和revision失效、多delta末项非法无部分提交、合法多delta只rename一次、move错误、TTL、stage写入错误和permit回收。
- 真正全链分页断线：FIFO队列进入分页 barrier后关闭真实mobile relay连接，生产下载器未返回完整JSON，最后一份完整缓存保持。废弃下载在stop前保留1个有界项，stop后 `manifestDownloads=manifestStarts=adapterStreams=0`。这是只读manifest拉取失败，没有业务重放。

## 编译、API与运行时边界

1. 全链先用 Android35类库编译生产 helper，再用 JVM org.json 编译/执行fixture，避免把Android checked JSONException与JVM unchecked实现混淆。
2. MainActivity全类编译另外使用真实离线 Android/AAR API；仅本应用 `R`、`BuildConfig` 常量是生成占位。随后用缓存D8对这些实际class做 `--min-api 26` 转换。**没有验证资源打包、依赖一并打入APK、签名/安装、Android生命周期或WebView行为**。
3. 项目minSdk=26。额外解析本机 Android SDK `api-versions.xml`，核查helper/cache编译常量池147个Java成员；Files.move/deleteIfExists/readAllBytes和File.toPath均API26，AutoCloseable API19，ByteArrayOutputStream使用老的 `write(byte[],offset,length)`。没有把InputStream.readAllBytes、HexFormat、API33的writeBytes/Charset版toString引入生产。JDK-only HexFormat等只在fixture。
4. 两个编译器生成的StringConcatFactory/LambdaMetafactory bootstrap先从API查表单列，后追加离线D8实转验证：`D:/Android/Sdk/build-tools/35.0.0/lib/d8.jar`、`--min-api 26`、512MiB JVM上限/60s单次超时，产出DEX038，328908B，SHA256 `d45e39cc4fe7f66d3d019b05ab04b019029f3ef0dc9cb240ca9429db931c1d6f`，DEX字节中两名称均不存在。该步骤闭合转换边界，**不是完整AGP/APK或设备运行证明**。SDK只安装Android35，无API26设备/运行镜像。本次不是Android lint，也没有下载依赖或运行用户Gradle配置。
5. 网络实验是本地真实 Java代理/SOCKS/OkHttp/AES-GCM → blind relay/ws →真实桌面adapter/网关；固定protocol1、已建立房间、合成core。没有TLS/WAN/4G/5G/外网WiFi/native QUIC/WebRTC/真实Android/真实LLM证据。公网端到端仍需后续实机验收。
6. Native触摸只做只读检查：未发现MainActivity拦截touch-up的override，swipeRefresh保持禁用。没有据此把连接overlay推定为问答按钮故障原因，也没有修改原生触摸；该交互问题由独立交互工作处理。

## 失败记录与可复现命令

保留失败证据，不覆盖旧报告 `mobile-chain.md`：

- 初始红测试pwsh-111：未实现分页时6项失败（200与所需206/503不符）。
- `run-2026-09-12T18-41-01-378Z-a67e83`：新增bulk/paged名字未加入合成core精确白名单导致403；仅改fixture名单后成功，不是生产协议故障，也未扩大端口边界。
- `legacy-cache-1789239989376`：辅助JUnit编译缺少真实PairingProfileStore类；加入已编译的实际生产class路径后7/7。未修改原测试或生产来掩盖问题。

从维护树运行，先清除非白名单环境；fixture再创建独立HOME/DSH_HOME/JVM临时目录。全链只允许精确自建loopback端口，拒绝60131、IPC、公网和任意loopback；原有manifest回归使用独立preload同样限制自建端口。

```powershell
$keep=@('PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE')
Get-ChildItem Env: | Where-Object { $_.Name -notin $keep } | ForEach-Object { Remove-Item ('Env:'+$_.Name) }
node tests/deep-audit-mobile-manifest-paging.test.cjs
node tests/fixtures/deep-audit-mobile-chain.cjs
# 仅31个选择性JVM检查可用同一fixture追加 --contracts-only
node --require ./.artifacts/deep-audit-mobile-chain/legacy-preload.cjs --test-name-pattern=manifest tests/mobile-sync-service.test.cjs
node .artifacts/deep-audit-mobile-chain/compile-all-java.cjs
# 下列参数使用新输出的完整artifact目录；不要指向用户配置/项目外目录
node .artifacts/deep-audit-mobile-chain/api26-check.cjs <main-compile目录>
node .artifacts/deep-audit-mobile-chain/d8-check.cjs <main-compile目录>
node .artifacts/deep-audit-mobile-chain/legacy-cache-check.cjs <成功全链目录> <main-compile目录>
```

## 修改清单与交付状态

生产：`electron/bridge/mobile-sync-service.cjs`；Android `ManifestDownload.java`、`MainActivity.java`、`MobileAssetCache.java`。

验证：`tests/deep-audit-mobile-manifest-paging.test.cjs`、`tests/fixtures/deep-audit-mobile-chain.cjs`、`DeepAuditMobileChainTest.java`、`DeepAuditMobileManifestPagingTest.java`；辅助离线编译/API/旧回归工具只在上述artifact目录内。源码完整SHA保存在最终run的 `source-manifest.json`，交付再检查见 `handoff-final-manifest.json`。

未运行产品打包/发布/上传/安装，未改用户凭据、用户Gradle配置或实际会话数据。本文完成Markdown结构/内容检查；按本任务隔离要求**未打开GUI60131或右栏预览**。
