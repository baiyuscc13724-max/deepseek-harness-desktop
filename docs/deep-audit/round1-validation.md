# 第一轮补验独立复核

## 结论

**有限证据接受，不是全功能或自动恢复验收。** 独立执行了实际临时安装前后同一剪贴板组件检查，并用原字节 Activity 快照重现历史移动 owner 边界及未变生产传输链。没有修改生产、作者测试/fixture/报告、旧 coverage 或历史证据。

- 剪贴板：独立进程 **2/2 Node tests**，baseline **32/32** 与 actual-installed **32/32** 内部组件检查通过；0 fail/skip/cancel，10750.5119ms。
- 独立证据测试：**5/5 Node tests**，0 fail/skip/cancel，10373.0201ms；包含真实 SDK probe 和实际 Java/Node 传输复跑，另有输入/安装/冻结/既有ID验证。**不是原作者3项 wrapper 的原封不动重跑。**
- 移动：**17个内部 Java 检查**、2条合成命令=1ACK+1预期loss；核心各执行1次，重复执行0，只有1次初始start/hello，观察3350.4064ms无第二次socket创建；自动恢复明确未执行。
- 本轮无新确认产品缺陷。旧 Activity 源码静态契约对当前并发重构版本已过期；此为证据时点差异，不能作为当前App失败或成功。

两个执行作业 `pwsh-140`、`pwsh-143` 已自然退出0并收齐；没有待收作业。Node次数、32项组件检查、17项Java检查和2条命令属于不同计量单位，不混加。

## 冻结与时点

旧 `coverage-master.json` 完整SHA保持 **`8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794`**。598域行、115 USER聚类、104有限接受，以及旧2929=2889pass+7fail+33skip均不变。本次只新增 `coverage-round1.json` sidecar，不回填旧master或把native域整体标绿。

| 输入/输出 | SHA-256 |
|---|---|
| 作者剪贴板报告 | `2de6cec55a7549089e8c565963e8eba9f8d33d5c921c3f79212e86b82703e32c` |
| 作者移动历史报告 | `980b33d960588cf1b5eb42766195e4e664bcdaade4f49323d0e765277308ff47` |
| 作者剪贴板测试 | `5516d18bee7972be4921a86b3a84f21861eb2c4bd00958f50b496a13cfdda78c` |
| 作者移动测试 | `7d72d4eb481e66fae789e72b3aa58b5baf5f5287d3ee542312ae377e78c86105` |
| 独立测试 | `1fe4387663c53122e763e274648ac79afdccdfca8af52f2984f42eb1c4123539` |
| 历史 MainActivity 快照 | `c465f787e0c812de1ec379b88d2b0d4c840807cc39980ce3f284204fae667ffb` |
| 复跑时当前 MainActivity，仅观察 | `a544e739c9b5fdf9d27cf87aafa27f8f0f507fe8b1218f541604a80338fcd05e` |

历史快照为 `.artifacts/deep-audit-round1-reconnect-controller/before/MainActivity.java`，独算完整hash与作者684交付的旧manifest完全相同。独立测试检查历史WSS3/5…15秒、native5/10…30秒及Handler调度三条契约均成立；对当时当前Activity同三条检查为 **false/false/false**，明确记录在 `owner-boundary.json`。当前Activity不是本次编译/执行输入，不冻结其并发开发，不假称旧hash仍是当前源。当前controller/Activity接线及恢复全链归后续专门任务，本报告不提前做其验收。

旧移动manifest的 **43 direct + 92 loaded CJS** 中只把当前MainActivity排除出“仍未变”检查；剩余 **134条历史依赖记录** 在独验前后hash一致。它们是记录数，不是134个唯一组件。新传输manifest仍为43+92，92载入模块的路径/hash与历史完全相同；直接绑定仅3个差异：新派生runner、同字节历史Activity快照路径、本次生成的同字节Log.java路径。旧日志/fixture/master没有改动。

## 剪贴板实际组件与实际安装

复跑直接使用作者冻结 `run.ps1 -Run independent-review-v1`，没有重写其断言。真实缓存Electron/Chromium、发行版React、InputBar、ComposerContentEditable、SessionInputShell与内嵌Lexical执行编辑。测试私有导出只是可逆增加export；shell仅替换应用bootstrap以获取正式模块，vendor逐字节不变。

### 临时安装闭环

`installation.json` 独立复核了：16个包身份（15个alpha.5、marketplace1.5.5）、32份复制输入、24个正式安装模块的hash，及以下真实导出API序列：

`preflight → visibility → provider → marketplace → imageQueue → core → question`

所有API目标是本次fresh临时包；没有启动安装CLI或写真实node_modules。完整安装后conversation确为 **`30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066`**，question为原规定6F382完整hash。重复序列全部false、字节不变，manifest与真实输入前后不变。

actual-installed Electron进程重新读取真实落盘30F文件、复核包身份/hash再加载；不是renderer从旧bundle二次transform。独验再次对落盘文件hash、receipt安装引用hash、临时shell可逆还原、conversation导出seam哈希、原vendor哈希逐项断言。两组32项observed/expected与作者最终结果完全相等，原setup/断言片段完整SHA仍为 `61d5e6d447a59524d29dd3f1a97ca3257b39f62742651bd29784f834f24c8c87`。CSS diff空；安装JS差异精确6个包。另在内存故意破坏conversation hash与第一项observed，验证独立校验器确实拒绝，不改任何实物证据。

| 独立证据 | SHA-256 |
|---|---|
| baseline receipt | `0971d0eb57ecec49daca3b6dae722356c6c54956b33b8f1949f28e46ae5622ce` |
| actual-installed receipt | `d1aab762fedb39d31d2633db2901bf3c13d2fe3130f0980aabc6c3d922cebebf` |
| installation.json | `57009339ff80b975c395fd84aecf3ed4e3792c67f356d3e188b545d9dcb627c3` |
| comparison.json | `1a95ee30906cae82814f3504a1cee630d484a1d2edb57ff0ac32f25cd3546009` |

实际通过范围包括选区plain/HTML复制与转义、plain/rich双格式取plain及选区替换、empty/HTML-only保留、undo/redo、readonly/removed/blocked/busy锁态、20次真实shell切换、旧editor/卸载/外部焦点隔离，以及合成composition和DataTransfer故障保留恢复。故障抛错确实穿过产品handler，不仅是模拟日志，但错误由harness观察器记录，**不证明产品可见错误提示**。

未验：真实OS剪贴板、跨应用、native菜单/快捷键、真实鼠标拖选、RTF、图片粘贴、真实IME候选窗、读屏和其他OS。composer是plain-text模型，本次没有证明保留富样式；`pasteAndMatchStyle` 原生入口完全没有调用。

## 移动：historical-owner reproduction

### 派生差异可逆且未改行为

新fixture只放在 `.artifacts/deep-audit-round1-acceptance/fixtures-independent-review-v1/`：

- owner-probe：仅替换输出目录、MainActivity输入指向原字节历史快照。
- transport runner：仅替换输出目录、历史Activity输入映射、ownerBoundary文案。没有修改Java测试、业务场景、assertion、生产组件、环境白名单或registered ephemeral loopback fence。
- 每个替换必须唯一；反向替换后与原源逐字节相等，完整before/after及hash保存在 `derivation.json`。其SHA为 `02c89b66564665490006cd7c28c72104443ba696e3b2d758134350ab42f5ac1a`。

probe在真实SDK35/JDK21下再次得到 `java.lang.RuntimeException: Stub! at android.os.Looper.getMainLooper`。这是SDK stub运行限制；没有构造或执行实际Activity/Handler生命周期，也不表示手机App崩溃。probe result SHA为 `2e7b40c116a3d4f9ae69220b61d141f50f7bd669d1c75ec22d3a386706324d2a`。

### 真实执行链与故障真实性

未变生产 `HarnessWebProxy → SOCKS5 → WssRelayClient/AES-GCM/OkHttp → blind relay → WssRelayAdapter → MobileSyncService/http-proxy → fake core ACK`。生产Java先对Android checked API编译，再以JVM org.json编译测试；仅Log为Android API替身，Context为null，未执行系统网络绑定。所有真实业务端口仅合成替身。

初始仅一次显式start。normal-0 ACK逐项校验ID与请求body SHA；late-0在核心收到请求后强断mobile socket，核心实际仍执行一次并产生迟到ACK，客户端没有完整200响应。核心计数分别1、重复0；迟到ACK的downstreamDestroyed=false，不能把丢ACK解释成“业务未执行/撤销，可安全重发”。本次没有业务重放。

| 观测 | 独立结果 |
|---|---:|
| 初始start / mobile hello / factoryStart | 1 / 1 / 1 |
| 合成命令 / ACK / 预期loss | 2 / 1 / 1 |
| core normal-0 / late-0 执行 | 1 / 1 |
| 正常请求耗时（Java nanoTime） | 52.0498ms |
| 丢ACK请求耗时（Java nanoTime） | 11.0341ms |
| 失联后观察窗口 | 3350.4064ms |
| 窗口中新socket | 0 |
| 旧callback注入 | 40×4=160 |
| Java streams / openingSockets | 0 / 0 |
| adapterStreams / manifestDownloads / manifestStarts | 0 / 0 / 0 |
| cleanupErrors / sourceDrift | [] / [] |

事件使用同一Java nanoTime锚点；一次初始ready相对显式start约88.381ms，**不是恢复耗时**。样本仅两条，不得给P95/P99、吞吐或WAN SLA。观察超过第一档3000ms只证明未接owner时transport本身未重建，不表示App恢复失败或永久不重连。

12项policy断言执行真实NetworkReconnectPolicy，但候选/commit由测试手动调用；100合成周期不等于真实物理网络切换。160旧transport callback和失败后的Stop不复活，不等于当前Activity/profile已排队UI闭包、真实用户Stop或后台生命周期已验。

| 独立传输证据 | SHA-256 |
|---|---|
| result.json | `588479ae0c1c48ab6c6e9bf3dd44cf7fb8ddecb96a9e48ea0c2c74c9eb3da2ec` |
| completion.json | `7f15c1eedbafd45074cc7889472bad7599ccd9ba90123089ea7a8319fbfd162e` |
| source-manifest.json | `96d8acb1c38d73dd705a035304000d5f6ec0df933e129b9fdd2c26a124a06071` |

## 既有ID与五维覆盖

可机器读取的逐ID、五维、相关域关联在 `coverage-round1.json`。所有行均保留master原状态，不提升USER整体通过：

| 既有ID | 本次有限证据 | 核心未验 |
|---|---|---|
| USER-c890c86ded0b | 真实composer选择复制、转义、假端口失败与生命周期 | native/跨应用/读屏 |
| USER-aff2717caf0c | plain/rich合成粘贴、锁态/安全DOM/20次切换 | 图片、原生粘贴、富样式保留、真实IME |
| USER-b6a989460a46 | composer实际纯文本路径 | 原生pasteAndMatchStyle入口 |
| DOMAIN-mobile-network-debounce | 生产policy及手动commit边界 | Android回调/真实holdoff/Doze |
| DOMAIN-mobile-ws-android-legacy | 真socket断线、旧generation、资源清理 | 当前Activity自动owner、恢复握手 |
| DOMAIN-mobile-rpc-duplicate | 两个fake core ID各执行一次，丢ACK不撤销 | 官方RPC幂等性、通用exactly-once |
| DOMAIN-mobile-wan-end-to-end / USER-MOBILE-REALTIME-LATENCY | 本地legacy一ACK一loss | 真实WAN/4G/5G/Host队列/UI |
| USER-MOBILE-EXTERNAL-RECOVERY | 历史owner缺口与负面链 | 真正自动retry→第二次握手→新ACK |

normal仅限真实组件或初始链；error-recovery区分合成故障/真实transport失联与未验自动恢复；concurrency-switch不外推真实设备并发切网；isolation为本次精确执行端口/身份；a11y仅剪贴板role/focus等局部，移动纯传输不适用，不把Android UI无障碍记为通过。

## 隔离与安全边界

1. 剪贴板PowerShell清空ProcessStartInfo环境，只传系统及fresh HOME/USERPROFILE/APPDATA/TMP/DSH_HOME；Electron再建白名单。Node网络全拒，renderer加载组件前封禁execCommand、navigator.clipboard、fetch/XHR/WebSocket/EventSource/sendBeacon/window.open。
2. Electron clipboard所有函数、WebContents copy/cut/paste/pasteAndMatchStyle等先替换抛错端口；专属session只允许三条明确本地file URL。receipt验证native、fallback、网络请求均零调用，事件全部isTrusted=false。
3. 移动Node/JVM fresh HOME，禁止真实用户配置；只读四份明确公共缓存JAR及SDK/JDK，不运行Gradle/下载。Node只允许登记127.0.0.1临时端口；Java SecurityManager限制同批端口并拒绝进程启动。60131负例明确在connect前拒绝，无请求发送当前GUI。
4. synthetic配对身份/密钥、fake core/cookie不是用户账户；gateway只放行两个字面ACK ID路径，其他请求和upgrade拒绝。未调用手机、Android工具、账户、真实剪贴板或桌面捕获输入。
5. 这是受控API/端口运行证明，不是OS全进程系统调用或抓包证据。Java SecurityManager在JDK21兼容模式有效，不外推未来JDK。没有真实安装、发布、构建APK、连接公网/TLS证书路径或当前GUI。Markdown只做结构/数据复核，任务禁止GUI控制，未打开右栏预览。

## 复跑与交付

维护树内，剪贴板原命令使用未存在Run名；该已完成证据保持只读：

```powershell
& ./tests/fixtures/deep-audit-clipboard-components/run.ps1 -Run independent-review-v2
```

独立证据脚本固定绑定已冻结 `clipboard/independent-review-v1` 输入，不会再次启动剪贴板测试；运行以下命令用新名字创建自己的移动派生/证据，**不要覆盖本次目录**：

```powershell
$keep=@('PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE')
Get-ChildItem Env: | Where-Object { $_.Name -notin $keep } | ForEach-Object { Remove-Item ('Env:'+$_.Name) }
node tests/deep-audit-round1-evidence.test.cjs independent-review-v2
```

- `tests/deep-audit-round1-evidence.test.cjs`：独立执行与证据拒绝断言。
- `docs/deep-audit/coverage-round1.json`：既有ID增量sidecar。
- `docs/deep-audit/round1-validation.md`：本报告。
- `.artifacts/deep-audit-round1-acceptance/independent-review-v1/`：summary、派生差异、输入冻结、两子进程日志、进程回执、job输出摘录。
- `.artifacts/deep-audit-round1-acceptance/final-freeze.json`：最终明确输出/证据hash清单；不自引用、不把并发当前Activity纳入冻结。

旧报告的“当前”只对其原提交时点成立。后续接缝独验必须建立自己的当前生产绑定，不能修改本sidecar时点或沿用c465f旧hash宣称当前App通过。
