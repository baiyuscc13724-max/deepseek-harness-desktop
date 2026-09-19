# 第四轮计划与执行授权记录

## 当前状态

第三轮已关闭，限定Q/G候选、两流独验和最终整合已接受；总审只读复跑证据门73/73通过。全项目目标仍active/armed。没有把第三轮验收提升为全项目完成。

**用户已直接授权按第四轮计划继续（维持原安全限制）**，计划 revision 5（hash `1e32450798bba46221be8437aec04c402bed99da35d647a6d169dbe326603631`）提交为 active，团队获得合法执行条件。此后用户又提出新增需求「DeepSeek 核心已有更新版本，需要完成兼容更新」并明确「说的是 DeepSeek 的核心，不是我们自己的」，随后选择授权获取官方新核心包；本轮据此把该需求持久化为任务 `7d6fb1ee` 并推进（见文末新增章节）。

**成员供给本轮几乎全程不可用**：连续 6 次派出/替换的成员都在启动后约 40 秒以同一内部错误中止（`SUBAGENT_ERROR / internal / work_followup / retryable false / partialOutputPresent false`），零输出、零 claim；长提示词与精简提示词都失败过。按仓库规则未继续盲生成，改为在主路线推进可离线完成的兼容分析。这不是代码测试失败，也不能把任务已保存说成测试已经跑过。

## 连接已有缺口的范围

| 分工 | 必须交付 | 独占新增输出 |
|---|---|---|
| 安装兼容 | 原181行旧安装测试在隔离副本中的真实红；旧单Q/v1与新Q/G成对入口的逐断言映射及新兼容候选；保留旧文件和所有红项 | `tests/deep-audit-round4-question-install-compat.test.cjs`、同名fixture目录、`round4-question-install-compat.md`、`.artifacts/deep-audit-round4-question-install-compat/` |
| 同步负载 | 实际Java/WebProxy/SOCKS/OkHttp/AES→relay/adapter/MobileSync→合成core的大快照/并发命令有限矩阵，完整字节相同的200/206对照与恢复证据 | `tests/deep-audit-round4-mobile-snapshot.test.cjs`、同名fixture目录、`round4-mobile-snapshot.md`、`.artifacts/deep-audit-round4-mobile-snapshot/` |
| 独立验收 | 两作者被接受后独立fresh复跑必要对比/负例，原始trace与源码核验、严格证据门及五维旁表 | `tests/deep-audit-round4-evidence.test.cjs`、`round4-validation.md`、`coverage-round4.json`、`.artifacts/deep-audit-round4-acceptance/` |

以上为同一目标的两个独立证据流和后续复核，非三项新增用户需求。尚无实际工作成员。当前未授权修改旧测试、现行生产或旧冻结；必要进一步迁移/生产修复必须先实证再单独限定任务，不能把新候选测试通过当旧套件已迁移。

## 本轮已核对的来源

1. 通过pwd确认工作目录为`D:\DeepSeek-Harness-Desktop`；维护树仍为`release-v1.0.28-worktree`。
2. 读取旧`tests/deep-audit-question-card-install.test.cjs`前100行：L15钉Q-v1，L23–25旧fixture不含Gateway client，L49调用旧API，L68–69要求已不在当前CLI中的旧接线字串。只是静态核对，未执行旧suite。
3. 读取`mobile-hol-fix.md`前110行：既有506112B/1400会话、64KiB/s与FIFO抖动对照只含6个并发样本；完整下载取舍、共享WSS FIFO、实际Android/WAN/Host未验限制仍有效，不重复宣称这些缺口已闭合。
4. 沿用第三轮`question-delivery-validation.md`的Q39f1/G528146完整产物与原13门、不变服务器/Connection/UiSession约束。当前主覆盖表与旧冻结没有更新。

## 已保存计划的执行边界

第四轮计划revision4，精确hash：

`af2d9a1a4f9db57864c0883e887d2345efa22453afac10c5d3f4262e1f70b8a0`

路由记录承认本次Goal round来源，团队和三个任务已持久化；但提交返回：

> automatic plan recommit requires an established team or the exact pending Host Goal-round grant

因此仍为draft，不能claim或spawn。此处的路由/任务记录不替代实际执行授权；文件系统完全访问也不代表团队授权。不能用旧团队复活、普通子代理、总审代做核心任务或重复创建团队绕过拒绝。

本条件首次出现在第四轮（Goal轮8）。第9轮通过get_goal与team_status重新核对：目标仍active/armed、revision9；团队与计划仍revision4/draft且hash不变；3任务均pending、attempt0，无工作成员或新的执行授权记录。同一限制已持续两轮，未重试被拒提交、未claim/spawn或启动测试。当前文件权限仍不代替团队执行授权，且会话审批提示禁用。

按目标策略尚未标blocked；目标保持active，不手动resume制造授权。后续若授权事实未改变，只核对持久状态和本记录，不盲重提同一被拒命令、不重复创建任务。若同一限制持续满足至少三轮，再按策略记录真实blocked原因。

## 获得合法执行条件后的步骤

使用现有团队、三个既有任务及精确计划revision/hash继续，不重建。先提交成功，再分别指派兼容与同步两个可见成员；同步成员先给出有限矩阵和来源绑定供总审核对。两个作者均被接受后再指派独验。

同步矩阵最多两种带宽形状、三个不超过2MiB合法payload梯度；主对比至少3次fresh run、合计至少30命令样本。每次比较相同完整字节/SHA，明确barrier差异、经验nearest-rank分位与样本数，禁止跨进程时钟直接相减或外推公网SLA。所有来源、失败与资源收尾必须可独立重算。

## 安全限制与未验项

只允许已缓存离线依赖、独立HOME/DSH_HOME/profile、先fence后载入、逐项登记的合成loopback。兼容流不需网络；同步流禁止任意localhost或真实Host路由。禁止真实GUI、账户、设备/配对、剪贴板、公网、下载、真实CLI、发布或运行实例替换。

Android/WAN、完整Host业务与结果投影、用户白栏、大快照/尾延迟和全主题读屏仍未验或未归因。文档未在被禁止的当前GUI/右栏预览，仅本地文本校核。全项目审计仍未完成。

## 新增：DeepSeek 核心新版本兼容（任务 7d6fb1ee）

**安全限制的一处经授权的修订**：用户明确授权获取官方新核心包，因此"不下载依赖"对**官方核心包获取**这一项被用户直接授权取代；其余限制（不发布、不替换运行实例、不碰 GUI/Host/账户/设备/剪贴板、不执行真实 CLI、不下载无关依赖）全部不变。

目标版本经官方 dist-tags 确定为 **`0.1.6-alpha.2`**（`latest`/`next` = `0.1.5-rc.2`，现行钉 = `0.1.2-alpha.5`）。已用 `npm install --ignore-scripts` 获取到**仓库外**隔离目录 `core-compat-upstream\0.1.6-alpha.2`（488 包、exit 0），未写检出 `node_modules`、未执行安装脚本、未触碰运行实例、未发布。

**兼容确实是断的，但断法分两类，必须分开处理：**

- **补丁类**：subagent「排队并激活」补丁**已被上游取代**——新核心原生提供 `Symbol.for("dsh.subagent.deliverPrompt")` 与真实 `queuePrompt`/`steerPrompt`，注释明确该符号正是为 host 适配器投递而设；重贴自己的符号可能与之重复或冲突。聊天滚动补丁经复核**并未被取代、仍然需要**（此处更正本节初版判断）：`scrollSamplePendingRef` 仍在新核心三处早退（`dsh-client-ui-chat/lib/client.js:2183, 2280, 2403`），`observedTopRef`/`onScrollRef`/`message.turnError` 及中英文字串都在，消失的只是我们自己注入的助手名，因此必须按新文本重派生。**锚点消失只证明周围文本变了，绝不证明缺陷消失**；这两类看起来一样、实质相反。这类**不能靠改哈希重新钉住**。
- **能力门类（13 门）**：**绝大多数可忠实重派生**——27 个判别性锚点中 24 个逐字存活；仅 4 项变化且都透明（注释锚点消失、助手 `queueImageRefs` 消失、`backoffMaxMs: 1e4` 移入 schema 默认写法、投影缓存升到 `version: 7, compatibleVersions: [3,4,5,6]` 而纪律未变）。

把门和补丁一起机械改哈希，会同时放过补丁冲突、又浪费掉本可安全升级的门。

**更正一处总审自身的误判**：storage-domain 谓词 `spec.invalidRecords !== "backup-and-skip" || unit.backupRecord === void 0` 曾被记为"未确认"，直接读取新源码证明它**逐字存活**（`dsh-storage-domain/lib/index.js:373`），已在证据文件中更正。

### 本轮新增证据（只读分析，未改生产）

| 文件 | 内容 |
|---|---|
| `.artifacts/deep-audit-core-compat/source-before.json` | 版本钉/门消费点原字节 SHA 与各 runtime 核心版本 |
| `tests/deep-audit-core-compat.test.cjs` | 离线守卫测试：基线 9/9 通过；清单模式对假设目标列出 32 处待改 |
| `.artifacts/deep-audit-core-compat/fetched-0.1.6-alpha.2.json` | 目标版本、获取方式、5 个补丁目标新旧 SHA 全部 DIFF |
| `.artifacts/deep-audit-core-compat/anchor-survival-0.1.6-alpha.2.json` | 补丁锚点存活图：16 存活 / 4 确定消失 / 1 未确认（后者已更正为存活） |
| `.artifacts/deep-audit-core-compat/re-derivation-0.1.6-alpha.2.json` | 3 个补丁的重派生判定与上游替代证据 |
| `.artifacts/deep-audit-core-compat/gate-survival-0.1.6-alpha.2.json` | 13 原生门逐锚点存活图（24/27 逐字存活） |

```powershell
node --test tests/deep-audit-core-compat.test.cjs                # 9/9 通过
$env:CORE_COMPAT_TARGET_VERSION='0.1.6-alpha.2'; node --test tests/deep-audit-core-compat.test.cjs   # 列出升级所需改动
```

### 仍然未做，且不可外推

- **真实版本提升未执行**：改 `package.json` 钉、重派生门哈希表、重写发布门契约都属生产改动，必须另行取得直接授权后单独限定任务。
- **补丁退役/重写决定未做**：需先复核当年促成 subagent 排队激活与聊天滚动的原始发现，再决定退役或重写，不默认。
- **新核心从未运行**：安装器、打包自检、桌面启动、手机/WSS 链均未在 `0.1.6-alpha.2` 上跑过，因此"已兼容"无从谈起。
- **两个第四轮证据流仍未交付**：旧安装套件迁移（`1966cc76`）因成员持续失败且我未在主路线接手，至今没有交付物；大快照时延量化（`fe051f14`）已由总审在主路线产出真实结果（见下）。

## 新增：手机同步时延流（总审在主路线完成）

成员供给连续 7 次失败后，总审按仓库规则改在主路线执行，直接使用既有离线跨语言夹具（真实 Java/WebProxy/SOCKS/OkHttp/AES-GCM → Node blind relay → 真实桌面 adapter/MobileSync → 合成 core），未写任何新产品代码，未触碰运行实例。

**同日 10 次 fresh 运行：9 次成功、1 次失败**（`JVM subprocess exit 1`，已保留现场并排除在统计外）。

| 结论 | 数值 |
|---|---|
| 整块快照在途（`bulk-*`，n=54） | P50 **7786.115ms**、P95 7827.229ms、max 7835.176ms（**P50≈P95≈max**，即几乎是全体阻塞而非少数尾巴） |
| 分页 206（`paged-*`，n=54） | P50 **319.701ms**、P95 333.136ms、max 336.777ms |
| 代价 | 同样字节完整下载 11.52–11.94s vs 整块 7.84–7.92s（约 +50%） |
| 分段定位 | 12 段中 `ackRelayQueue`（relay 收到 ACK→实际转发）占整块 7786ms 里的 **7700.8ms（98.9%）**；请求侧各段与回执后段全在毫秒级 |
| 其它 profile | jitter n=162 P50 112.1ms；hol n=54 P50 **7765.0ms**；reconnect n=54 P50 **30.1ms**（重连后恢复） |
| 完整性 | 上行 145/145、下行 107/107，丢包/重复/乱序均 0；每轮资源计数归零 |
| 中断与缓存 | 分页中断 137.8ms 快速失败，**旧缓存字节未变**，保留 1 个有界传输 |

**一处重要的自我更正（必须连同结论一起读）**：我一度把"延迟=前方字节÷带宽"当成对**真实中继**行为的实测验证并报告。随后读到夹具自身的整形实现（`tests/fixtures/deep-audit-mobile-chain.cjs:117-127`，按 `bytes/(64*1024)*1000` 串行化并累加 `outTail`），确认那 7.7 秒由**夹具的链路模型**产生——我的"验证"与夹具的实现是同一个公式，属循环验证；对真实 relay 的物理归因**已撤回**。同时撤回"夹具 relay 观测点已确认对应 `sendBounded()`"，那些点由夹具自己的包装器记录。

仍成立的是：在上述链路模型下，把在途压到一页可消除绝大部分等待（约 31 倍）；请求侧不受影响；relay 源码确实有 4MiB/连接与 4429 超限关闭（**读到但未触发**）。

**仍未覆盖**：无真机/无 WAN/无真实 LLM/无完整 Host；未把 relay 的 4MiB 边界逼到 4429；无显式 429 与下载中切换 profile 用例；超时重试只由一次 503 覆盖。

证据：`.artifacts/deep-audit-round4-mobile-snapshot/` 下 `multirun-2026-09-19-v2.json`、`segment-breakdown-2026-09-19.json`、`ack-queue-model-2026-09-19.json`、`queue-model-correction-2026-09-19.json`、`relay-queue-mechanism-2026-09-19.json`、`coverage-addendum-2026-09-19.json`。

## 新增：委派通道失败的调查

用户要求查清并修复委派失败。已把 7/7 同一诊断（`SUBAGENT_ERROR`/`internal`/`work_followup`/`retryable false`）定位到代码路径，并排除"接口缺失""插件陈旧"等解释（档案插件与应用自带插件字节相同）。当前收敛到两个候选抛出点（`assertAdmitting` 的 `DRAINING`，或 `throwIfAborted()` 的 abort），二者都能精确产生该诊断，但**确切错误原文尚未取得**——Host 不持久化 `rawDetail`/`errorMessage`，应用无运行日志，运行实例不可插桩。详见 `delegation-failure-investigation.md`。**尚未修复。**

## 新增：DeepSeek 核心新版本兼容

见上文"新增：DeepSeek 核心新版本兼容（任务 7d6fb1ee）"。补充：13 个原生门中 **3 个（schedule / turn-outline / storage-domain）与旧记录逐字节相同可直接沿用**，其余 10 个需重派生官方哈希；补丁类判定为"subagent 排队激活已被上游取代（原生 `deliverPrompt`）而聊天滚动仍需要重派生"。真实版本提升未执行。

