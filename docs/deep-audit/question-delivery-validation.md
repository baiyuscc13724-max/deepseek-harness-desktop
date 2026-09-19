# 问答交付修复：两流证据整合与边界验收

## 1. 结论与责任边界

**建议在限定候选、限定链段内接受；不是 Host 证明、全 USER 完成、真实手机问题解决或发布许可。** 安装与界面两独验流已由总审接受，本整合再次独立解析原始收据、源码与冻结材料；未把成员的 pass 字段直接当作结论。最终整合仍须总审独立接受。

本次只新增三个 docs/test 文件及 `integration/`，未改变生产、作者或两独验流原件、旧冻结、覆盖主表。未启动安装器、Electron、客户端、真实 CLI 或监听端口；只运行只读文件哈希与元数据测试。未访问当前 GUI、Host、模型、账户、配对设备、剪贴板、公网、下载、发布或替换运行版。

| 限定完整产物 | SHA-256 |
|---|---|
| Question client | `39f1fa00ea15159b6700e553787f6071d06974c676d4fa269c5d6a80519b0fa7` |
| Gateway client | `52814635f68d59587542b5d2f0fc1835ac9e6d4ecad2c50ed7085c2ba4ed63cc` |
| 维护链 conversation companion | `30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066` |

## 2. 单一来源闭包与历史保留

`integration/integrity.cjs` 不调用作者验证器或产品模块，而是独立读取文件并核 SHA/字节数。现行 **34,396 个唯一文件**重算结果与前成员留下的 `integrity-before.json` 相等；这不是当前整个仓库文件数，也不是用户覆盖数。

| 闭包项目 | 独立核验口径 |
|---|---|
| round3 旧固定输入 | 6,571 项；授权变化的 installer 经 before 原件映射，不改旧 pin |
| round3 旧最终冻结 | 179 项及原完整 manifest SHA |
| 作者交付最终冻结 | 7,354 项及原完整 manifest SHA |
| 作者 before / takeover | before 121 原件；takeover 13 源 + 3,402 历史文件 |
| 作者 source-remap | 16 种显式原字节映射；按指定 manifest 与旧 SHA 定位，不通用跳过 |
| 作者运行历史 | 18 个带 freeze 的 run；`core-after-v2` 记录的 producer 漂移仍保留为无效历史 |
| 界面第二次冻结 | 1,079 项；首版479冻结文件+freeze自身=480份，原位置和 `submitted-v1/` 副本一致 |
| 安装最终输出清单 | 15,668 项逐文件核验；最终三个 run 各5,180输入前后相等 |
| 更早冻结 | round2被退回v1的365项与4项原字节映射、已接受v2的383项、历史638项、AppFrame807项及手机6次run冻结均在旧闭包内保留 |

历史 resolution 共48次匹配（同一历史来源可被多个清单引用），不是48个缺失文件。两份原 producer 未当时归档，后来分别重构匹配 `e017f2…`、`b0d91b…` 完整 SHA：**只有重构后字节一致证明，没有原始存档存在证明**。`core-after-v2` 的 `e017f2…→525395…` 运行中漂移绝不提升为有效通过。

作者 final-matrix-v1/v2 输入分别5,082/5,083，界面复验各5,087，补充5,088；不能称这些完整输入全集相同。安装每run虽然均5,180，主脚本不同，也不能称三份全集相同。UI before-v1遗漏动态旧 ESM 的独立绑定被保留；最终 before-v2 另加121份原件前后哈希补闭合，没有回填第一次日志。

## 3. 原始分母重算

| 独立来源 | 实际分母 / 原始数据 |
|---|---|
| UI matrix-v1、matrix-v2 | 各80条=原34链/几何桶+46直接组件；34不是34个纯网络E2E场景 |
| 每轮原始网络/呈现 | 14次浏览器RPC、13次HTTP接收、11次dispatch/受控business receipt、16次呈现、**results=0** |
| before-v2 | 7条旧行为 characterization；它通过不等于旧行为正确或已修复 |
| legacy-v1 | 44条冻结局部oracle；RPC/HTTP/受控receipt均0，不是delivery网络链 |
| UI补充 | 2个probe，122子断言=45同owner压力+76身份退休+1边界，不加入原80 |
| 安装matrix-v3 | 43条测试，51份receipt（部分负例分别调用preflight/API） |
| 安装supplement-v3 | 17条=16目录receipt+1历史保护证明 |
| 安装chain-v3 | 1次精确维护链安装段；不是额外UI运行或测试套件 |
| 本整合证据门 | 73条=6正向核验+67拒绝变异；这是元数据门条目，不是新增用户功能 |

不合计80+44+43+17+122成用户操作或验收率。`coverage-master.json` 完整 SHA 保持 `8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794`；原 summary 的 **userOperations=115、independentlyAccepted=104、domainFindingRows=598** 含义不变。

## 4. 问答链、回执和资源语义

实际完整 Question/Gateway/Connection/RemoteStreamMux/HTTP parser 及官方 React/renderer/QuestionComposer 经已记录可逆 bootstrap/private-export seam 装配。Controller scope 与 UiSession domain 是真实类；roster/slot/业务数据和结算由受控夹具提供。9项产品seam完整重做派生哈希，16份UI runner/fixture反向来源一致。没有完整Host工具业务或真实session投影。

- 延迟完整回执期间，卡保持submitting及disabled，同tick额外选择与双提交仅一RPC。same-tick是 `DOM.click()` 非trusted；另有真实Chromium trusted触摸和键盘，不能合称所有输入均trusted。
- 原始RPC按rpcId匹配JSON/headers；dispatch以event与非503 attempt区分，receipt再与dispatch完整outcome匹配。503后同event的第二次显式提交是另一attempt，不可误当重复投递。
- 延迟body实测同renderer时钟头→JSON为 **351.7 / 363.7ms**，JSON→移卡均约 **0.6ms**。头到达不等于解码成功。Node/server时间轴只在内部排序，不与renderer互减；n=2受控条件，不报分位/SLA/WAN时延。
- wrong-rpcId已有受控业务效果但界面unknown；真实约 **29,945.7 / 29,944.8ms** 等待的丢回执deadline也进入只读unknown，不自动业务重传。无真实新frame就无可重试题；本地收起不发送。
- 503夹具已消费body且该server trace段无dispatch，只有夹具的已知前提支持该次判断。**一般503无未dispatch证明；空ok/transport-acknowledged不等于business-winner。** 不改变真实server、Connection或UiSession协议。
- 真实新generation可恢复同精确身份/结构draft，仍要用户显式再提交；旧carrier、旧cancel、owner释放及domain dispose按各自原始检查隔离。未完成next是实际类上构造handle的直接组件证据，不冒充完整业务生命周期。
- 两轮结果投影均0。旧44的实际结果卡/selected解析是局部oracle，不是Host→session→结果DOM端到端证据。result中的通用“manual result publication”边界说明不能用来凭空增加本轮results。
- 补probe先同时创建42个未缓存presentation，再将40个逐步变unknown。结束32unknown+editing/submitting各1=34 views，淘汰8个unknown，两个活跃sentinel无伤；dispose后42个remove各恰1且缓存/计时器清零。
- 16次严格旧save中，5个仍合法独立记录返回true，11个真正退休/替换/终态返回false；对应16份新记录快照不变。错身份不恢复另行独立断言。单独sessionId键测试为direct-registry参数seam，不冒称真实attach。
- TTL用可逆 `performance.now` 越过五分钟deadline，不是真等待五分钟或网络断线；1MiB/64KiB按UTF-8字节，不是JS字符串长度。
- 390×844两轮收起按钮均92×44 CSS px、bottom776可达。44 CSS px是本任务目标，不混称Android48dp、iOS44pt或完整WCAG。全主题/对比度/读屏/IME/横屏/系统字体/safe-area未验。

## 5. 安装安全与旧套件兼容边界

完整43矩阵和17补测的目录receipt逐项回读现存文件核SHA，日志独立重算✔条目与tests/pass/fail/cancelled/skipped/todo。完整17缓存包5,137文件仅两目标变动，其余5,135不变。矩阵的conversation规范化基线为 `7ee5792b…`；另一个精确安装链段才证明维护后的 `30f413…` companion，不偷换为三流使用同一基线。

旧native proof连续区域9,807字节、SHA `9d04b750bebbb8d25ec02d68796d1f7bd2000312108087e02c6ec2af7db61342` 与before原件一致；原13清单、身份/版本、hash/anchor及退役artifact门不减。Gateway client由新增companion门覆盖，不冒充原13已覆盖。before121现行已有文件仅installer变化，另一获准新增维护文件为delivery helper；旧question-card、CAS helper、Gateway server、Connection、UiSession字节不变。

实际 `patch-official-runtime.mjs` L3257–3286在完整native门后prepare输出；publish再检查完整source/output及首写前整pair。CLI源L3548–3550预检早于L3552的可能首写，最终L3586调用delivery API；此处仅源码接线证明，**从未执行真实CLI**。

独立证据包括六种known pair收敛/幂等、完整未知源与原13漂移拒绝、prepared篡改、第一写前竞争、两位置锁、open/write/sync/rename故障、CAS锁内/temp后竞争和最终pair再次核验。顺序两文件写不是跨文件原子事务；第二文件失败可留下第一文件已更新，不能运行mixed pair，需精确离线恢复。CAS仅覆盖配合锁协议的writer与已测插入点，不是OS原子compare-and-swap或任意恶意writer防护。noLaunch仅表示本实验失败API没有启动链，非完整启动器实测。

**旧安装套件兼容限制不得隐藏：** `tests/deep-audit-question-card-install.test.cjs` L15仍钉v1 `6f382a…`，L49运行旧 `patchQuestionCardRuntime`，L68–69仍要求CLI的 `questionCardChanged`/旧API字串；现CLI已改为L3586的 `questionDeliveryChanged`/新API。旧字串在当前源不存在，故不能把历史旧suite通过称为当前新pair全绿。旧helper L20–23仅接收base或v1，不接收Q39。此为本次只读静态兼容观察；未重跑旧suite，也未篡改旧test/冻结让它通过。新43+17及链安装段是独立限定依据，不取代未来旧套件迁移/完整CLI验证。

## 6. 证据门与失败历史

可重跑命令（只有元数据/文件读取）：`node tests/deep-audit-question-delivery-evidence.test.cjs`。

正向检查覆盖完整源闭包、严格原始trace、实际安装目录收据、可逆派生、8份恢复现场、独立summary与旧五维关联。67拒绝变异包括坏receipt、错误event/rpcId/pair/companion、假source路径/hash/bootstrap、重复业务投递、headers冒ACK、ok冒winner、一般503冒无dispatch、TTL假真网络、结果projection冒实测、缺检查/假计数、32上限误伤editing、真正退休仍save、新record被改、CAS覆盖成功、漏清理、缩短deadline、错误触摸尺寸、覆盖主表/五维/全USER提升及删未验项。

变异只改内存副本，是**证据宣称拒绝测试**，不是向真实客户端发坏回执，更不是新产品安全测试。所有原始报告及run保持只读。

| 保留的失败/补闭合 | 处理 |
|---|---|
| 前两整合成员8个文件 | `pre-recovery-v3/`保存精确副本及SHA清单；原位置未改 |
| 前整合integrity-v1 | 将suffix export当needle导致unique seam失败；日志保留，现校验区分追加与替换 |
| 前整合integrity-v2 | UI supplement映射路径相对根误用导致ENOENT；日志保留，现按明确根解析 |
| 本整合semantic-v1 | 误要求每event只有一个submit，忽略503后合法显式第二attempt；失败日志及源v1保留，按rpcId和503段拆分 |
| 本整合semantic-v2 | 分组只匹配`B `遗漏一条`B:`边界子断言；失败日志及源v2保留，修正标签解析为45/76/1，不改原检查 |
| 作者历史红项 | core/install/recovery失败、producer漂移、原限额/尺寸缺陷均保留；不由新pass擦除 |
| 两独验流历史 | UI首版被要求补probe与before绑定缺口、安装prepare误枚举与v2中断均保留；不计入最终通过分母 |

## 7. 收尾、五维旁表与未验清单

`coverage-question-delivery.json` 关联旧question/ACK/draft、mobile recovery/latency及AppFrame ID，在normal、error-recovery、concurrency-switch、isolation、a11y五维逐项标限定通过/历史失败/未验，全部 `promotesMaster=false`。主表原含义及计数不变。

本成员后台作业仅pwsh-72（现场保留/字节闭包）、pwsh-73（元数据gate）与pwsh-74（最终闭包与73项gate复验），均已收齐exit0；回执记于 `integration/jobs.json`。前成员与两独验流的作业只引用其已冻结收尾记录，不以本会话空job列表冒充读取旧job。没有任何runtime后台进程由本整合启动。

Android View/Handler/IME/Activity、Java/WebProxy/relay/WAN、完整Host业务、真实session projection、用户持久白栏、大同步快照及尾延迟、全主题读屏和部署/完整CLI生命周期仍未验。已加载文档及UI审阅技能；按任务禁区不打开真实GUI或右栏预览，改为文本结构与精确哈希审校。

交接：本报告、`coverage-question-delivery.json`、`tests/deep-audit-question-delivery-evidence.test.cjs`、`integration/summary.json`、`receipt-bindings.json`、`integrity-before.json`/`integrity-after.json`、gate日志、`final-freeze.json`。最终freeze不自引用；其完整SHA与字节数由单独封存回执提供。
