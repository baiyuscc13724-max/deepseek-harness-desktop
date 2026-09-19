# 第三轮手机问答：真实协议链补验

## 结论与证据等级

本轮**跨过旧44项中的延迟 `pending.answer()` 替身边界**：当前正式临时安装产物的 QuestionComposer / PendingQuestion / answerQuestion，实际 ClientRemoteEvents、RemoteStreamMuxClient、Connection RPC、Node HTTP bridge / rpcFetchHandler、Gateway dispatch / RemoteStreamMuxServer 在 fresh Chromium 的封闭 loopback 中联通。未改生产、旧测试、旧 pins、覆盖主账或运行版。

**作者完成有限组件链证据，不是独立接受，不是用户问题已解决。** 明确观察到两个需要后续评审的问题：

1. `ROUND3-QUESTION-ACK-LIFETIME`：卡在HTTP回执之前已被移除，不能将旧defer替身下的busy锁解读成网络等待期间仍有busy卡。
2. `ROUND3-QUESTION-RETRY-DRAFT`：提交前置HTTP503后，实际JS连接恢复并重呈现服务器仍pending的事件；新卡key不同，已选内容清空，无原卡错误/重试态。没有自动执行业务，但用户必须重新选择并提交。

这不是实体手机触摸故障或4G/5G慢的归因。Android WebView/Handler/IME/MainActivity、WebProxy/relay/WSS/TLS/WAN、真实模型/工具/Host调度、真实会话投影均未装载。旧JVM自动controller证据不在本轮重跑，也不由本轮取代。

## 实际链与接缝

```text
合成 scoped question source / 空Context身份映射
 → 真 Gateway event projection、pending/delivery归属、WS mux
 → 真 ClientRemoteEvents解析、Cordis scope/waterfall
 → 真 answerQuestion / PendingQuestion / QuestionComposer / draft reducer
 → Chromium可信touch，或明确标记的同tick DOM.click
 → 真 createWebConnectionRpc correlation + JSON envelope
 → loopback HTTP → 真 bridge / rpcFetchHandler / Gateway dispatch
 → 受控source.resolve记录（不是模型业务）
 → 测试驱动将已观察结果传给真 AskQuestionRow / AskQuestionCard → DOM
```

| 层 | 实际执行与边界 |
|---|---|
| 问答、renderer、tool结果行 | 完整client文件；仅唯一marker插入私有export，反向替换逐字节相等；问答行为不二次patch |
| 发行React/ReactDOM/Cordis | 完整官方frontend shell+vendor；唯一bootstrap改为导出内置依赖，不启动AppFrame或官方Host应用 |
| 移动兼容 | 完整当前 `mobile-runtime.js` 与 `mobile-compat.css`；`HarnessMobilePlatform=android`和cacheIdentity为合成；native control仅disabled/status与合成cacheIdentity，无真实Java桥 |
| Connection/Gateway | 完整双端模块；服务器仅追加私有export暴露 `bridge/rpcFetchHandler/RemoteStreamMuxServer`，其正文不改；真实server envelope/schema、event ID/client ID归属、客户端rpcId校验运行 |
| Slot / uiSession | 合成会话身份、pending registry及composer挂载；保留真实React snapshot selector/renderChainResult，不是完整uiSession/AppFrame |
| Host应用 | 合成event source与受控settlement，不加载真实CLI/credentials/模型/能力；未调用 connection模块 `apply` 的BrowserAuth/credentials装配；只使用安全隔离的真实协议组件 |
| 结果呈现 | 实际AskQuestionRow/Card解析选项，**结果由测试驱动从已记录受控receipt注入**；不是真实session projection推送链 |

因此本轮补齐的是**UI→实际传输/解析→受控返回**，以及分段的实际结果DOM解析；不宣称完整Host端到端。没有用复制的理想重连/ACK状态机替代协议实现。

## 场景、分母和发现

最终组件运行是12个显式检查条目，**不是12个Node `test()`，不是12项用户功能，也不与旧44或JVM计数相加**。另有作者元数据负对照4条，不计入产品12条。

- 可信DOM touch：选Option 0再提交，经过真mux/waterfall/HTTP parser得到受控selected，实际tool result DOM显示Option 0。
- 同tick：先在上一事件中选Option 0让原生button enable；同一JS tick点击Option 1，再双击提交，只有一个RPC，完整selected为Option 0+1。这里DOM.click的isTrusted=false，不冒充两次物理触摸同tick。
- 350ms受控HTTP前置等待：卡已经移除而server仍未settle；等到真实dispatch后才得到受控结果。busy保护仅在本地settlement期间成立，未覆盖该HTTP等待窗口。
- 390×844窄窗、16选项：实际移动CSS，滚动后提交按钮56×44 CSS px，中心命中它自身，可触达；不等于Android dp/可访问性全审或所有窄屏尺寸。
- 合成会话A的旧请求保持pending，切到B完成B；显式abort旧请求后A无卡，旧carrier.answer拒绝already settled，新会话未被覆盖。
- 前置503：一次客户端RPC、一次HTTP入站，未到Gateway业务dispatch；生产JS连接generation由1变2、原server pending事件重呈现，选项全false，status空、submit disabled。无业务重放；显式第二次选择/提交才产生一个受控receipt。
- 已完成事件的重复结果：真实Gateway保持无第二次settlement；错误clientId被真实Gateway拒绝。此两项是直接调用真实dispatch边界的负例，不伪装为第二台手机发送。
- 业务已settle后篡改HTTP响应rpcId：真实客户端拒绝并恢复连接；业务仍只settle一次，无自动重发。之后新请求正常完成。

每次完整成功运行：8次UI RPC、8次HTTP请求、7个受控业务receipt、1个旧请求abort；8个源请求对应9次卡呈现（503重呈现一次）。503是一个预期未交付尝试，wrong-rpc是已交付业务后的回执失败；不能把二者都叫业务失败。旧卡检查不覆盖任意恶意/并发设备模型。

### 两个问题的精确责任边界

当前question源码的 `PendingQuestion.answer` 仅settle本地promise；`answerQuestion` await该promise后在finally移卡。真实Gateway `ClientRemoteEvents` 才在listener完成以后提交并等待HTTP事件结果。UI生命周期和远端回执生命周期没有同一promise。

503情况下重连重送的是**服务器尚未完成的question presentation**，不是自动重放已完成业务；新PendingQuestion递增key引发store重置。两者均为本轮实际输入下的受控复现，不表示旧44项失效，也不把旧defer测得的错误状态推广到真实网络失败。

已向总审报告最小生产责任范围：question `PendingQuestion.answer` / `answerQuestion finally` 与gateway `ClientRemoteEvents.answer` 的 `dispatchWaterfall`→`connection.rpc.call` 交付边界（当前gateway client L654–679）。当前installer只修question局部状态，不能在未验证协议语义下简单扩大busy等待或自动重放。**本轮无生产修复授权、无生产修改**。

## 时间语义

`browserTrace`为单一renderer `performance.now()`；`serverTrace`为另一个Node `performance.now()`，**未跨时钟相减**。

- browser `ui-click`→`rpc-submit`：DOM click至fetch调用，包含本轮移动脚本/事件循环/React成本。
- `http-response`：fetch获得HTTP headers；不是response JSON解析完成、rpcId被接受或Host任务完成。
- `result-dom`：测试驱动从已观察的受控receipt挂载实际结果组件；可早于客户端收到HTTP headers，不应被包装成完整Host回显延迟。
- 350ms场景的移卡早于rpc-submit及HTTP headers，是因果顺序证据。
- 本轮没有大同步快照负载，没有WAN限速/吞吐测试，不产出P50/P95/P99，也不拿8个异质场景冒充尾延迟样本。

作者summary保留每个RPC的原始单时钟点及派生值。v6的350ms单场景：click=3389.5ms、移卡=3390.8ms、fetch提交=3453.8ms、HTTP headers=3811.1ms；移卡至headers间隔420.3ms。它是n=1的受控顺序样本，不是生产延迟指标；v5同场景顺序相同。最终数字以相应run的JSON为准，不用跨时钟server点填补DOM链缺口。

## 隔离与失败保留

- Node和Electron的HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP/DSH_HOME全部新建；继承env仅PATH/SystemRoot等系统白名单，无凭据环境。
- 先安装Node网络/native-addon/子进程/IPC拒绝，再导入产品模块。只捕获一次listener能力绑定 `127.0.0.1:0`，所得唯一端口写 `ports.json`；该数字host的lookup只返回本地字面量，不查询DNS。
- Chromium为无Node、sandbox=true、contextIsolation=true的fresh隐藏窗口；没有preload。权限全部拒绝，导航/新窗口拒绝；请求只准本轮精确origin资产以及 `/api/remote.mux`、`/api/$events/result`，server再次检查Host/Origin/方法/路径。
- 闭环拒绝试验：当前GUI端口、外域443、额外listen/IPC、child spawn在调用网络前被拒绝。没有访问这些端口或外域。
- mobile runtime尝试加载 `__harness_mobile__/theme.js` 被webRequest拒绝；重复尝试原样保留，使用fixture theme变量，不静默假装加载了真实主题服务。
- 隔离fixture的CSP允许发行依赖装配所用eval/inline，Electron对此发出安全警告，保留原日志。这不是生产CSP更改或产品安全验收。真实服务/账户/剪贴板/native桥均不可用。
- 各次成功及失败都保留exit/failure/process.log、source-before、integrity、freeze。超时或失败不删红。

| run | 结果与解释 |
|---|---|
| recovery-v1 | 0产品检查；fixture DNS fence拒绝Node对127.0.0.1 literal的lookup；cleanup全0。修为仅本地数字解析，不开放DNS |
| recovery-v2 | 3检查后超时：初始disabled按钮在同tick `.click()`不派发提交事件。选中已更新，但夹具不应期待RPC；另错误调用ctx.dispose导致cleanupErrors 1，socket close尚未观测。保留，不称完整通过 |
| recovery-v3 | 8检查，已看到移卡早于350ms回执；故障模式等待误读上一次request.done并提前恢复normal，后续期望重呈现超时；cleanup全0 |
| recovery-v4 | 8检查后超时：掐断未消费body的HTTP socket出现3次HTTP头入站，只有1次浏览器RPC调用；未到业务dispatch。不能据此称业务三次执行，也不声称已验证socket-drop的exactly-once；cleanup全0 |
| recovery-v5 | 首次完整12检查通过，5073输入文件无漂移；8RPC/8HTTP/7受控receipt，cleanup全0；67个freeze条目作者核对通过 |
| recovery-v6 | 最终fresh重复12检查通过；5075输入文件无漂移，69个freeze条目作者核对通过；8RPC/8HTTP/7受控receipt，cleanup全0。不是额外12项覆盖 |

v1–v4最初只冻结hash，未保存fixture原文本；补写了**新目录** `recovered-fixture-history`，从已冻结v5文本反向恢复历次明确编辑，并逐一匹配旧 `source-before.json` 的SHA，16/16文件验证。旧run未改；`mapping.json`说明恢复来源，不伪造当时保存时间。v5以后每轮直接保存 `fixture-source/` 原字节。

替补注册时本会话job_list无后台作业，原scope无artifact运行目录；该事实不证明不可见旧会话的jobs状态。替补自身所有已启动jobs均逐一收齐；最终资源回执含sockets=0、serverListening=false、pending=0、clients=0、cleanupErrors=[]。v2的旧清理错误不被后续成功覆盖。最终只读进程检查没有发现命令行包含本轮fixture路径的electron.exe（matchingFixtureProcesses=0）；6个新增JS/CJS文件syntax与限定scope的Git diff --check均退出0。

## 输入与输出

| 当前关键输入 | SHA-256 |
|---|---|
| 正式installer | `cecd16cc8ddd9627be92170c038a7a0c6ad4b904c30a9b71cc5a86cbbf5034b4` |
| 临时实装question | `6f382a535cb182b062365773c57b23579e8195c0096901c1864c0b1ae0079457` |
| 临时实装conversation | `30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066` |
| gateway client | `55dbd591222b28e557e7d47368f7770114a88d97206e910fae940768c83950cd` |
| gateway server | `c69e238a1b9b7cf36950e05a6ad5e86228a476b956e4ad056fb9125dc156f8a8` |
| connection client | `1b8e76d7fb14c9305e6d43ab03bd908328341537af05c4159747d6da33308257` |
| connection server | `91b8e7b90c5189a5dc0f4eafc4a62494eef9b5a28ded0715146ddf1a31126c8e` |
| mobile-runtime.js | `8830194ab1be206936bcd64022af876eef62c14450ceae088f371c3d8addcc63` |
| mobile-compat.css | `ea7e8cd55492dddbeba4bcd0a472776305552d3e58025de8b4fce36026b81c3d` |
| 旧coverage-master | `8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794` |

runner使用同一正式 `assertInstalledAlpha5RuntimePreflight` 和相关完整安装API组合，fresh temp产物hash严格一致；没有运行真实CLI或写真实node_modules。记录完整依赖package闭包及发行vendor输入，前后hash不变。旧master与round1/round2 freezes只读；115 userOperations、104 independentlyAccepted、598 domainFindingRows不变，不提升任何整项USER状态。

主要新增文件：

- `tests/deep-audit-round3-mobile-ui.test.cjs`：限时隔离入口、真实安装产物与输入绑定。
- `tests/fixtures/deep-audit-round3-mobile-ui/`：browser/electron/fence，以及history恢复与summary自查；不修改旧fixture。
- `.artifacts/deep-audit-round3-mobile-ui/recovery-v1` 至 `recovery-v6`：失败/成功原始记录。
- `.artifacts/deep-audit-round3-mobile-ui/recovery-v5-summary.json`、`recovery-v6-summary.json`：作者自查、原始trace导出、四个拒绝错误报告元数据的负对照；不是独验签名。
- 本报告：按文本结构与证据字段审校，未访问禁止的当前GUI/右栏预览。

复跑必须新run名，缓存Electron和既有依赖足够，不下载、不启动真实服务：

```powershell
$keep=@('PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE')
Get-ChildItem Env: | Where-Object { $_.Name -notin $keep } | ForEach-Object { Remove-Item ('Env:'+$_.Name) }
node tests/deep-audit-round3-mobile-ui.test.cjs independent-new-name
node tests/fixtures/deep-audit-round3-mobile-ui/summarize.cjs independent-new-name
```

本轮责任止于真实组件链与上述负面/限定证据；是否修复跨层回执生命周期、如何保留失败draft，须由总审明确生产范围后另验。不得从本报告推出Android/WAN、全Host业务或全USER目标完成。
