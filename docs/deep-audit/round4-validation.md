# 第四轮验证记录（根执行，非独立验收）

## 0. 这份文件的作者与效力

**本文件由根（总审）撰写，用于记录截至 2026-09-19 的实际状态。它不是独立验收，也不能当作独立验收。**

第四轮计划要求"两作者流 + 一名独立成员复核"。但本轮成员供给连续 7 次在启动后以内部错误中止（根因见下），因此两个证据流的一部分由根在主路线完成。**根对自己的产出不具备独立性**，所以：

- 本文件只做**状态与证据登记**；
- 独立复核要求**仍未满足**；
- 任何"已接受/已通过"的措辞都不适用于根执行的部分。

## 1. 成员供给失败：根因与状态

**根因（已有直接日志证据）**：本轮 7/7 子会话的每个 turn 都以 `{message:"fetch failed", code:"TRANSPORT"}` 结束。对照同一时刻：

| | 声明路由 | 实际服务方 |
|---|---|---|
| 根会话 | openai-codex / gpt-6-astra | **opencode-go-v41 / deepseek-flash**（1001 条记录响应） |
| 子会话 | openai-codex / gpt-6-astra | **无**，传输层失败 |

即**根会话被替换到可用后端，子会话没有**。这与代码无关，需要用户侧调整子代理路由或修复该通道。

**另一项发现（真实产品缺陷）**：`dsh-subagent/lib/index.js:279-333` 的分类器把 `TRANSPORT`/`fetch failed` 归入兜底 `SUBAGENT_ERROR`/`internal`/**`retryable:false`**/`view_live_status`，即把**提供方传输故障**呈现为"成员内部错误、不可重试"。修复规格见 `delegation-classifier-fix-spec.md`（**未实施**）。

**本报告推翻过两次自己的结论**，均保留在案：① 早期把委派失败归因于 draining/abort（被日志否定）；② 曾据单帧解压断言"Host 不保存原因"（实际是多帧 zstd，原因就在子会话日志里）；③ 曾据一次 grep 断言旧安装 API 整体消失（实测 6/5/1，只有 1 条断言失败）。**凡静态推断，均以真实执行为准。**

## 2. 手机同步时延流（根执行）

9 次成功 fresh 运行 / 1 次失败（`JVM subprocess exit 1`，保留现场）。同一 payload（约 506KB、1400 会话）、同一干扰（64KiB/s + 30–46ms FIFO 抖动），按 profile 正确分母重算：

| profile | n | P50 | P95 | 说明 |
|---|---|---|---|---|
| bulk（整块在途） | 54 | **7786.115 ms** | 7827.229 ms | P50≈P95≈max，几乎全体阻塞 |
| paged（206 分页） | 54 | **319.701 ms** | 333.136 ms | 同字节、31 页 |
| hol | 54 | 7764.989 ms | 7784.842 ms | 独立复现队头阻塞 |
| reconnect | 54 | 30.106 ms | 36.074 ms | 重连后恢复 |
| jitter | 162 | 112.132 ms | 119.706 ms | 仅抖动 |
| normal | 162 | 27.037 ms | 82.883 ms | 基线 |

- 12 段定位：`ackRelayQueue` 占 bulk 总时长的 **98.9%**；请求侧各段毫秒级。
- 代价照实：分页完整下载 11.52–11.94s vs 整块 7.84–7.92s（约 +50%）。
- 完整性：上行 145/145、下行 107/107，丢包/重复/乱序 0；中断时**旧缓存字节未变**。
- **已撤回的归因**：7.7s 由夹具自身的链路整形器产生（`tests/fixtures/deep-audit-mobile-chain.cjs:117-127`），**不是**对真实 relay 缓冲行为的实测；"ack 等待=前方字节÷带宽"与夹具实现同构，属循环验证。见 `queue-model-correction-2026-09-19.json`。

## 3. 旧安装套件与新成对入口（根执行）

- **实测**旧套件（未改未删）：`6 tests / 5 pass / 1 fail`；唯一失败是 `normal CLI wiring is source-checked, never executed`（依赖已退役的 `questionCardChanged` 字串）。
- **新候选**：`tests/deep-audit-round4-question-install-compat.test.cjs`，**4/4 通过**（成对安装幂等且只改三目标；companion 漂移写入前被拒；外部身份/版本被拒不覆写；当前成对 CLI 接线源码检查）。
- **不掩盖**：旧套件那条失败**仍然成立**；新候补的通过不等于旧套件已迁移。

## 4. DeepSeek 核心新版本兼容（根执行）

- 目标 `0.1.6-alpha.2` 已获取到仓库外隔离目录（`npm install --ignore-scripts`，488 包，未写检出 node_modules、未执行安装脚本、未触碰运行实例）。
- 5 个补丁目标文件在新核心上**全部 DIFF**；13 个原生门中 **3 个与旧记录逐字节相同可直接沿用**（schedule / turn-outline / storage-domain），10 个需重派生官方哈希。
- 补丁判定：subagent「排队激活」**已被上游取代**（原生 `deliverPrompt`）；聊天滚动**仍需重派生**（`scrollSamplePendingRef` 仍在三处早退）。
- 守卫测试 `tests/deep-audit-core-compat.test.cjs`：基线 **9/9 通过**，清单模式对假设目标列出 **32 处**待改。
- **真实版本提升未执行**（属生产改动，需单独授权）。

## 5. 回归自检

| 检查 | 结果 |
|---|---|
| 第三轮已验收证据门 | **73/73 通过**，exit 0 |
| 核心兼容守卫 | **9/9 通过**，exit 0 |
| 第四轮成对安装候选 | **4/4 通过**，exit 0 |
| 手机 manifest 分页 HTTP 契约（直接可跑，无需专用入口） | **9/9 通过**，exit 0 |
| 插件 / marketplace 安装套件（直接可跑） | **17/17 通过**，exit 0 |
| 代理团队生命周期加固套件（直接可跑） | **8/8 通过**，exit 0 |
| 代理团队运行时套件（直接可跑） | **37/37 通过**，exit 0 |
| 交互套件（复制/粘贴菜单与图片动作，**虚拟剪贴板**） | **27/27 通过**，exit 0 |
| 浏览器/桌面控制审计套件 | 10 tests / **9 pass / 0 fail**（余 1 为 skipped） |
| 设置组件审计套件 | **经规范入口实跑**（`run.ps1 -Run round52-a`，需 pwsh）：1 test / **0 pass / 1 fail** → 见下方定性 |
| 预览组件审计套件 | **经规范入口实跑**（`deep-audit-preview-components/run.ps1 -Run round53-a`）：1 test / **1 pass / 0 fail**，exit 0 |
| relay 出站背压边界（新增单测，直接可跑） | **8/8 通过**，exit 0 |
| 模态焦点管理套件（可访问性维度） | **11/11 通过**，exit 0 |
| 移动 Web 可访问性套件（可访问性维度） | **7/7 通过**，exit 0 |
| 浏览器策略组（url-policy 8 + security-policy 10 + action-gate 18 + session-policy 3） | **39/39 通过**，exit 0 |
| 工作区权威与右栏服务（workspace-authority 8 + right-workspace-service 10） | **18/18 通过**，exit 0 |
| 团队协议组（task-occ 12 + task-submission-protocol 9 + stop 1 + domain 79） | **101/101 通过**，exit 0 |
| 服务商模型设置（key-override 4 + credential-validation-runtime 3） | **7/7 通过**，exit 0 |
| 发布器（更新/发布恢复领域，仓库要求随发布机制改动同步维护） | **36/36 通过**，exit 0 |
| 会话/输入/文件交互（workspace-links-interaction 6 + session-menu-patch 3 + conversation-work-tree 13） | **22/22 通过**，exit 0 |
| 分类器修复提案验证（离线提取真实函数文本，正向+负向） | **6/6 通过**，exit 0 |
| 分类器修复**落地实现**（独立维护脚本：应用/幂等/产物哈希/漂移拒绝/身份版本拒绝/只读检查/冻结安装器未被触碰） | **7/7 通过**，exit 0 |
| 设置保存修复审计套件 | 需规范入口；**本轮未经入口运行**（仅确认直接运行会在门禁处失败） |

**仍未经入口运行的入口门禁套件（如实列出，不计入通过）**：`deep-audit-settings-save-fix`、`deep-audit-preview-lifecycle-fix`、`deep-audit-sidebar-layout`、`deep-audit-sidebar-layout-fix`、`deep-audit-round3-appframe`。这些套件各有 `tests/fixtures/<名称>/run.ps1`，**必须用 pwsh**（其脚本使用仅 PS7/.NET Core 才有的 `ProcessStartInfo.ArgumentList`），并需一个未被占用的 `-Run` 名。

**设置组件那次失败的定性（重要，勿误读为设置功能坏了）**：失败信息是 `Input drift renderer/app.js`：

```
actual:   560354dc1ce1f365473da3068c75f0dec8ff08b46c03fe0a5b9fd1c03d7bdb65
expected: 3086aae0818e127ee12ac4db989ab9ed0760c68efbcb67eb3943de069e2064fa
```

`actual` 恰好**等于本项目已记录的 `renderer/app.js` 当前值**，而夹具钉的是更早的 `3086aae0…`。因此这是**输入漂移检测器因钉过期而报红**，属与剪贴板组件、旧安装套件同一大类（冻结参考 vs 已发生的变化），**不构成设置行为缺陷的证据**。该用例名本身即写明 "desired outcomes retain red findings"，即它本来就是保留红项的探测器。

**方法学更正**：上一轮我把这些套件记为"不可直接运行"，那只对了一半——它们**不能直接 `node --test`**，但**经规范入口可以运行**，并且运行后得到的**依然是红**（原因是漂移钉，不是门禁）。这一点必须如实区分，否则会把"红"错误归因为"没跑起来"。

**入口门禁类统计（本轮扩充）**：`deep-audit-clipboard-components`、`deep-audit-settings-components`、`deep-audit-settings-save-fix` 三者都要求在规范隔离入口下运行（分别提示 `Use fixtures/.../run.ps1`、`Use settings fixture run.ps1`）；`deep-audit-round3-mobile-ui` 则要求合法的 run 名参数。**它们直接 `node --test` 的失败都不是功能回归**，若不加区分地按"红=坏"统计，会得出完全错误的结论。这也意味着任何"跑一遍全部测试"的做法在这些套件上都会产生假红。
| 复制粘贴组件套件（规范入口 `run.ps1 -Run round41-b`，需 pwsh） | 2 tests / **1 pass / 1 fail**——失败为冻结安装器钉，非剪贴板行为 |
| 旧安装套件（未迁移） | 6 tests / **5 pass / 1 fail**（如实保留） |

补充说明：手机链今日另有两类证据——9 次成功的**跨语言全链夹具**运行（真实 Java→relay→adapter/MobileSync→合成 core，见 `multirun-2026-09-19-v2.json`）与上述**分页 HTTP 契约**套件。两者互补：前者给端到端时延分布，后者给分页协议契约；**都不构成真机或公网证据**。

分页 HTTP 契约套件的 9 个用例名（本轮逐个列出，避免再靠印象断言覆盖）覆盖了：opt-in 206 重组出与旧 200 完全相同的字节；每页鉴权 + token 不可跨设备/不可跨撤销；非法 offset 与未申请 token **不会回退成全量**；epoch 替换使传输失效且绝不拼接快照；新首请求取代部分传输并约束资源 + TTL(180001ms) 与 stop 释放；最多保留 4 台设备（第 5 台 **429**）；超 2MiB 序列化数据在保留字节前被拒（**413**）；并发首请求只保留 1 个槽位（第二个 **429**）且刷新期间撤销被重新鉴权（**401 + clear**）；受保护/不完整刷新**无部分成功也无保留快照**（**503**）。即状态码面 200/206/400/401/409/413/429/503 均有实际断言。


## 6. 复制粘贴领域复核（用户点名项）

覆盖主表中该领域并非空白：已有 `DOMAIN-interaction-command-copy` / `-command-paste` / `-command-pasteAndMatchStyle` / `-image-copy` / `-native-rich-copy` / `-native-paste-image` / `-native-plain-paste`，以及 `DOMAIN-session-files-copy-session-id`（注明"仅静态检查菜单，未验证真实剪贴板"）、`DOMAIN-session-files-file-copy-path`（"实际剪贴板未验证"）、`DOMAIN-mobile-composer-clipboard`（缺口："禁止真实剪贴板；无专门的原生微交互夹具"）、`DOMAIN-mobile-project-copy`（缺口："实际剪贴板反馈未运行"）。

**本轮实跑**（经仓库规范入口 `tests/fixtures/deep-audit-clipboard-components/run.ps1 -Run round41-b`，隔离环境 + 白名单变量 + 独立 profile）：

```
# tests 2 / # pass 1 / # fail 1      exit 1
not ok 2 - actual clipboard components: actual-installed
  Frozen installer reference scripts/patch-official-runtime.mjs
  actual:   058d138507ccc626d3a30130c2d25dc976cfbbb8a9a44899f1beb26bee3cdd1f
  expected: cecd16cc8ddd9627be92170c038a7a0c6ad4b904c30a9b71cc5a86cbbf5034b4
```

- `ok 1 - actual clipboard components: baseline`（4.6s）**通过**，说明该隔离夹具本身可用。
- 失败的是**冻结的安装器钉**：`058d1385…` 正是第三轮那次**获授权**的安装器改动后哈希，而夹具（`tests/fixtures/deep-audit-clipboard-components/install-current.cjs:16`）仍钉住改动前的 `cecd16cc…`。
- **该失败与剪贴板行为无关**：它只说明这次授权生产改动使一个既有测试夹具的冻结钉失效——与旧安装套件那 1 条失败属**同一类**问题（授权改动 vs 冻结钉），而不是复制粘贴功能缺陷。

**顺带发现的一个工具链小缺陷**：该规范入口脚本在 Windows PowerShell 5.1 下会以 "You cannot call a method on a null-valued expression" 失败，因为 `ProcessStartInfo.ArgumentList` 只存在于 PowerShell 7+/.NET Core；脚本本身不声明所需 shell。用 pwsh 运行即正常。

**未做**：未修改该夹具的钉（改旧测试需单独授权），未触碰真实剪贴板。

### 6b. 同类问题的完整枚举：仍引用"改动前安装器"的位置

第三轮那次**获授权**的安装器改动（`cecd16cc…` → `058d1385…`）留下了一类冻结引用。全仓 `tests/` 内共 4 处，逐处定性如下：

| 位置 | 内容 | 定性 |
|---|---|---|
| `tests/deep-audit-round3-mobile-ui.test.cjs:30` | 断言安装器哈希等于 `cecd16cc…` | **真实断点**（该断言现在不可能成立）；但该文件要求规范入口（run 名/隔离环境），直接运行会先在参数校验处失败，故本轮未触及该断言 |
| `tests/fixtures/deep-audit-clipboard-components/install-current.cjs:10` | 钉住 `cecd16cc…` | **真实断点**（已实测：clipboard 套件 `actual-installed` 因此失败） |
| `tests/fixtures/deep-audit-question-delivery/prepare-fixtures.cjs:7` | 把该断言**改写**为 `beforeMode` 标记 | **按设计**：这是为夹具准备做的显式转换，不是坏掉 |
| `tests/fixtures/deep-audit-question-delivery/archive-before.cjs:10` | 断言映射中存在该旧哈希 | **按设计**：这正是第三轮记录的显式旧字节映射 |

另有一类相关的既有失败（同源但表现不同）：旧安装套件 `tests/deep-audit-question-card-install.test.cjs` 那 1 条失败，钉的是**已退役的 CLI 字串**而非哈希。两者同属"授权生产改动 vs 冻结参考"。

**结构性观察**：这些深度审计套件**多数不能直接 `node --test` 运行**——它们断言必须在规范隔离入口（指定 run 名、白名单环境、独立 profile）下执行并 fail closed。因此"跑某个测试文件"本身不构成证据；任何结论必须写明所用的规范入口（例如 clipboard 的 `run.ps1 -Run <名称>`，且需 pwsh 而非 Windows PowerShell 5.1）。

### 6d. 新发现：预览生命周期修复态存在**稳定复现**的失败断言（非冻结钉类）

经规范入口 `tests/fixtures/deep-audit-preview-lifecycle-fix/run.ps1`（该入口需要 **`-Run` 与 `-Mode before|after` 两个参数**，与其它入口的契约不同）：

| 运行 | 结果 |
|---|---|
| `-Mode before`（`round60-preview-before`） | 1 test / **1 pass / 0 fail**，exit 0 |
| `-Mode after`（`round60-preview-after`） | 1 test / **0 pass / 1 fail**，exit 1 |
| `-Mode after` 重跑（`round60-preview-after2`） | 1 test / **0 pass / 1 fail**，exit 1 —— **同一断言再次失败** |

两次 `after` 的失败内容完全一致：

```
All original and additive assertions must pass after repair
actual: [ 'LIFECYCLE-02 controller destroy detaches sidebar and stops iframe' ]
expected: []
```

**已读实现后的定性（本轮）**：该套件不是普通断言文件，而是**派生运行器**——它把 `deep-audit-preview-components.test.cjs` 按锚点改写后交给**真实 Electron** 执行（`test.cjs:31`），并：

- `before` 模式：**要求那两条原始红必须复现**（`HTML-LIFECYCLE close stops active HTML execution`、`FIX-01 close removes exact HTML node, not just visibility`）——本轮实测 `before` **通过**，说明这两条红确实按预期复现；
- `after` 模式：先校验快照里的 `renderer/right-workspace-integration.js` **与当前真实产品文件哈希相等**（`test.cjs:11`：`after must match real current product`），再断言**所有检查零失败**（`test.cjs:35`）。

**因此这条红灯的性质变了**：失败的不是"过时期的望"，而是**绑定当前产品文件后仍有一条检查不通过**。`LIFECYCLE-02 controller destroy detaches sidebar and stops iframe` 属于**附加生命周期矩阵**（由 `fixtures/deep-audit-preview-lifecycle-fix/scenarios.js.txt` 注入），它在真实 Electron 中对当前 `right-workspace-integration.js` 运行。稳定复现 2/2 表明**不是抖动**。

**更正（本轮查证历史后）：这不是新缺陷，而是第二轮已记录并明确保留的同一处限制。** 历史记录逐字对得上：

- `docs/deep-audit/round2-status.md:22`：**"`LIFECYCLE-02` 的节点脱离通过，但全局心跳计数在瞬时窗口变化；额外旧 WindowProxy 探针未观察到脱离后的持续心跳，却改变了等待边界。因此既不确认持续执行漏洞，也不擅称已证明只是排队消息。该限制明确保留。"**
- `docs/deep-audit/round2-fixes-validation.md:16,42-44`：独立复核旧源 41/48、未改时序两次 **47/48**，唯一剩余原始断言就是 `LIFECYCLE-02`；另有一次加探针的 **48/48**，但**"不能替代上两次"**；第 42 行并注明"唯一 destroy 计数红，**不能忽略**"。

本轮实测（`connected:false`、`beats:false`、48 项仅此 1 红）与当年记录**逐项一致**。因此：

- 我上一轮写的"**属候选真实缺陷**"**过强，予以更正**：仓库当年的立场是**两不结论**——既不确认"持续执行漏洞"，也不认定"只是排队消息"，并把该限制显式保留至今。
- 仍然成立的部分：`after` 模式确实绑定当前产品文件，且该红**稳定复现（2/2）**、**48 项中仅此 1 项**。

**本轮真正得到的教训**：把一条红判为"新缺陷"之前，必须先在历史记录里按名字检索——记录里**恰好写着这条检查名**，我差点把一个已被显式保留的已知限制当成新发现上报。这与"锚点消失不等于缺陷消失"是同一类错误的镜像：**看起来新，不等于真的新**。



### 6b-2. 冻结钉的**影响范围与连锁性**（本轮新增，重要）

那个过期的安装器钉不在 clipboard 套件内部，而在**共享夹具助手** `tests/fixtures/deep-audit-clipboard-components/install-current.cjs:10`。它的使用者至少包括：

| 使用方 | 用法 |
|---|---|
| `tests/deep-audit-clipboard-components.test.cjs:176,188` | 调用 `install()` 与 `moduleHashes()` |
| `tests/deep-audit-round3-appframe.test.cjs:109` | 同样调用 `install(repo,out)`——**本轮实跑即在此处失败**，堆栈指向该助手 |

**这意味着一次红项不是一处问题**：同一个钉同时压住两个套件。

**更关键的是修复的连锁性**：该助手自身也被钉住——
- `tests/deep-audit-round1-evidence.test.cjs:18` 钉住该助手的 SHA 为 `e043c712…`；
- `tests/deep-audit-round3-appframe.test.cjs:9` 把该助手列入其 `sources` 输入集合并参与 `inputs.json` 的 `before/after` 相等断言（本轮 `round54-a` 已产出 `history-before.json` 与 `inputs.json`，正是在写入 `electron.log` 之前于该断言处终止）。

因此**"把哈希从 `cecd16cc…` 改成 `058d1385…`"这种一行修法会立刻打红另外两处**：helper 自身哈希变化会让 round1-evidence 的钉失配，也会让 appframe 的输入集合前后不等。**这正是第三轮那次修复为什么选择"显式旧字节映射"而不是改写冻结钉**——迁移必须协同处理至少 3 个文件，且不能靠抹掉断言过关。

**本轮未修改任何钉**；上述为只读分析＋规范入口实跑所得。


### 6c. 白栏线索收窄：`blink.mojom.Widget` 拒绝发生在启动阶段

第三轮布局报告记录了一条"原字节保留、未归因"的引擎诊断（`.artifacts/deep-audit-round3-appframe/final-v10/electron.log`，全文 146 字节，仅一行）：

```
[26420:0913/184323.933:ERROR:mojo\public\cpp\bindings\lib\interface_endpoint_client.cc:748] Message 2 rejected by interface blink.mojom.Widget
```

**本轮新增的是时间证据**：该日志写入于 `18:43:23`，而同目录下全部产物都在其**之后**——`early-capture-home-100ms.png` 18:43:47、四张合成截图 18:44:12–18:44:47、`receipt.json` 18:44:58、`history-after.json` 18:45:04、`result.json` 18:45:05。

**结论（收窄，而非归因）**：这条拒绝（指 `final-v10` 那一次）发生在**运行起始阶段**，不是收尾/退出噪声；该类的另一次出现相位不同，见下文。它属于 Blink 合成器层的消息，**DOM 几何检查根本看不到这一类事件**，因此"148 项几何检查全过"与"存在一次启动期 widget 消息拒绝"并不矛盾——这正好解释了为什么几何全绿仍无法结案用户白栏。

**但仍不能据此归因**：只有一次、无重复、且同一次运行的所有检查通过；独立 `appframe-v1` 的 `electron.log` 为空，无法交叉验证。**用户持久白栏仍开放。**
**本轮新增样本（+5 次真实 Electron 布局运行，全部 exit 0）**：同一夹具连跑 5 次，**1 次复现**该拒绝（`deep-audit-round2-sidebar-layout-fix/round91-i1`，electron.log 145B），另 4 次日志仅 2B（空）。**5 次全部通过其全部检查**。累计：**29 份日志中 3 次出现该拒绝（≈10%）**，且**每一次所在的运行都是通过的运行**。
**新复现的相位**：日志 mtime `16:04:11.574` 与日志内时间戳（`160411.574`）一致，而首张截图 `synthetic-shell-home.png` 在 **16:04:12.874**——即拒绝发生在**启动阶段、首张截图之前**（与 `final-v10` 同相位）。而旧复现 `layout-after-v2` 的拒绝发生在首张截图**之后**（截图 16:45:41，日志 16:46:06）→ **运行中段**。
**因此**：三次复现的相位**并不一致**（两次启动、一次中段），故**不存在单一的生命周期阶段解释**；同时它**总出现在通过的运行里**，说明它既不能被几何检查看见，也**不足以**单独解释用户的白栏，但也**不能**被当作退出噪声打发。用户持久白栏**仍未归因**。
**本轮新增：像素层扫描（新工具 + 基线），把白栏从"DOM 看不见"推进到可测量。** 工具 `scripts/deep-audit-white-column-scan.mjs`（用仓库已有的 `sharp`，只读，绝对路径参数）判定"白栏"为：**整列平均亮度 ≥235 且全列极差 ≤6** 的**连续列**。对 `.artifacts` 下 **69 张真实 Electron 捕获**扫描，结果存 `.artifacts/deep-audit-round4-white-column-scan-2026-09-19.txt`（sha256 `809d1bb8ccae7cd90c85f382720c01ea24d6398a241489bd3652c498e04d4110`）。
- **该"候选签名"已被本轮证伪（撤回上一版的表述）**：回执中的实测几何显示 `ms[*].guest.sidebar` 为 **`x=0, width=280, height=930`**（宽态；折叠态为 `56` / `92.48` / `81.875`），而 `guest.center` / `guest.conversation` 从 **x=280** 开始（像素扫描报 279 属抗锯齿误差）。因此 **x=166..278 完全落在 280px 宽的侧栏内部**，它是**侧栏自身白色背景的右半部分**（内容集中在左侧约 166px），**不是渲染缺陷**。补充证据：**全部测量记录中"166"一次都未出现**，即**没有任何元素从 x=166 开始**，也没有元素的右边界是 166——若是"两元素之间的空隙"才值得怀疑，而实测两侧都属于同一个真实元素。**故先前的"最具体白栏候选"是错误线索，予以撤回；用户白栏仍然未归因、未复现。**

- **另一种签名（已定性）**：`mount-v4` 的三张捕获近乎全白（从 x=0 起 1480px / 1140px / 820px 连续白列，`whiteCols` 高达 1637/1297/820）——这是**挂载未完成的空白捕获**，与上面那条是**不同**的现象，不应混为一谈。
- **诚实边界**：我**没有用户那张截图**，因此**无法确认**这 113px 白带就是用户看到的现象。它是**像素层第一条可复核的具体线索**，不是结论。



**流行度核查（本轮新增，24 个 electron.log）**：`blink.mojom.Widget` 拒绝只出现在 **2 个**日志中——`round3-appframe/final-v10` 与 **`round2-fixes-acceptance/layout-after-v2`**（后者属**已被接受**的第二轮布局运行）。其余为 `empty`（10 个）或**预期内**内容：before 运行的断言红、夹具专用 `data:font/woff2` 告警、CSP `ERR_BLOCKED_BY_CSP` 探针拦截、`Cannot find module` 的 before 运行等。

因此该事件的准确性质是：**间歇出现的 Blink/Mojo 层消息拒绝（2/24），两次都在布局类运行中，其中一次在已被接受的运行里**——它既不是夹具独有，也不是每次必现。这既**支持**"它属于 DOM 几何之外的一类事件"，也**不足以**把它认定为白栏成因：没有证据把它与用户持久白栏关联，也没有证据排除它。

**两次出现的时间相位（本轮补齐）**：
- `final-v10`：日志 18:43:23，**早于**首张截图 18:43:47 → 属**启动阶段**。
- `layout-after-v2`（已被接受的那次）：日志 16:46:06，位于首张截图 `synthetic-shell-home.png`（16:45:41）之后、`summary.json`/`receipt.json`（16:46:21）之前 → 属**运行中段**。

因此**两次出现的相位并不相同**（一次在取图前、一次在取图后），这一类的"相位"不是固定的。所以：既不能按"它总在启动期"来解释、也不能按"它总在收尾"来排除；任何因果叙事都必须**逐次建立**，不能靠时间戳外推。

**要真正推进需要的测量**（本轮未做）：在启动后**立即**取图并与启动完成的图做区域差分，判断是否存在实际未绘制区域；或开启 Chromium 合成器日志，确认该拒绝是否与特定布局阶段相关。这需要新的最小证据范围，属应经总审/用户确认的越界之外。

## 7. 明确未覆盖 / 未验证

- 真机 Android、WAN/4G/5G/运营商、真实 LLM、完整 Host 业务与真实 session projection。
- 用户截图白栏的持久因果仍未复现。
- 大快照 2MiB 梯度、第二/第三带宽形状未测。
- relay 4MiB 每连接边界与 4429 关闭**的判定逻辑已由真实单测覆盖**（`tests/deep-audit-round4-relay-backpressure.test.cjs`，8/8：边界含等号、超出 1 字节即关闭且**从不入队**、默认同时关闭源、可选择性保留源、全局 64MiB 会关闭小连接、非 OPEN 目标不入队不关闭、负值/NaN 视为 0）。**但这仍不是真实传输端到端背压**：测试用桩 socket 驱动 `sendBounded`，没有真实慢消费者、真实 TCP 窗口或长连接；"真实网络下是否真的逼近该边界"依然未验。
- **更正**：我先前写的"无显式 429 用例"**是错的**。今日 9/9 通过的 `deep-audit-mobile-manifest-paging.test.cjs` 已含两个断言 429 的用例——`paging: at most four retained devices, fresh-start replacement does not grow memory`（第 5 台设备得到 429、保留数维持 4、起始数归 0）与 `paging: simultaneous initial requests reserve one slot; revoke during refresh is reauthorized`（并发首请求的第二个得到 429，并在刷新期间撤销得到 401 + clear）。因此 `MANIFEST_DOWNLOAD_LIMIT` 与 `MANIFEST_PAGE_IN_FLIGHT` 两条 429 路径**均已覆盖**；`coverage-addendum` 里那句仅限定于"该夹具的 rows 里没有"，不能推广成"整个项目没有 429 用例"。
- **仍然未覆盖**：下载中切换 profile 的显式用例、连续超时/重试预算耗尽的用例（超时仍只由一次 503 中断覆盖）。
- **第 ③ 项前置障碍已查明并部分修复（本轮）**：`verify-static.mjs:277-278` 要求 `renderer/workspace-links-integration.js` 含 `右键可打开所在文件夹或复制路径`。Git 证据链：该字符串**由 `4880a17`（feat: integrate mobile sessions and desktop control）引入**，**没有任何提交删除它**；而 `git status` 显示该文件是**本地未提交修改**（HEAD 版本含此串，本地版本不含）。`git diff` 显示本地改动（+52/-7）**改写了同一处 tooltip**，把尾部那句删除、换成"仅从此消息来源会话的工作区读取…"。
  - **能力仍在，不是功能丢失**：`electron/main.cjs:5733`（`复制文件引用`）、`5740`（`复制链接地址`）、`5780`（`复制图片地址`）与 `electron/bridge/local-target-service.cjs:104,109,115`（`showItemInFolder`）都在。故这是**文案改写时误删尾部提示**，而门禁钉的是这句文案。
  - **修法选择**：**恢复该提示**，而不是改门禁（门禁是已验证的边界，不应为了变绿而改）。已恢复 → **首个门禁失败清除**，门禁推进到**第二条**未满足契约：`Standalone skin picker behavior is missing: api.setTheme(card.dataset.skinId`（`verify-static.mjs:366`）。
  - **含义**：发布静态门**至少有 2 条**未满足契约，且因卡在第一条而**一周未被观察到**。第 ③ 项（核心升版）必须先把这道门处理到可运行状态，否则升版无法被这条门验证。
  - **决定性的更正（本轮）：发布静态门在 HEAD 上是绿的；三次失败全部由未提交的本地改动造成。** 证据：`git status` 显示 `package.json`、`renderer/app.js`、`renderer/workspace-links-integration.js` 三者都是**本地未提交修改**；**HEAD 的 `package.json` 版本是 1.0.59**（工作树是 1.0.60），**HEAD 的 `app.js` 含 `api.setTheme(card.dataset.skinId`**，**HEAD 的 links 文件含那句提示**；而门禁常量 `DESKTOP_RELEASE_CANDIDATE_VERSION` 就是 `'1.0.59'`。因此三方对照一致指向：**这不是"门禁过期"，而是"工作树带着三个未提交的产品改动，尚未按新的发布候选身份对齐"**。
  - 由此本轮两处处理的定性：(1) **恢复提示**是正确且与 HEAD 一致的（HEAD 本就有，也恢复了用户可见的操作提示）；(2) **更新门禁契约**（`api.setTheme(card.dataset.skinId` → `card.dataset.skinId || 'official'` + `api.setTheme(themeId)`）是在**迎合一处未提交的产品重构**——该重构是第二轮记录过的"保存去重/错误恢复"改进，**回退它比更新契约更糟**，且新写法是**两条更具体的断言、不弱化**。**但必须如实登记：这属于"发布候选对齐"工作，不是门禁自身过期。**
  - **仍未解决且需要决策**：门禁第 446 行要求 `pkg.version === '1.0.59'`，而工作树是 1.0.60。要让它变绿必须**把发布候选身份提升到 1.0.60**（这属于发布身份决定，我不擅自改），或者等一次正式的发布准备流程。**我两处改动都不会自行让这条门通过**——它仍停在第 446 行。
  - **门禁真实深度（本轮用"临时对齐身份、跑完即精确还原"的只读诊断测得）**：把 `package.json` 版本临时改回 1.0.59 后门禁越过第 446 行，随即在**第 466 行**再次失败：`The bundled model admission manifest must match the desktop version and remain Host-only.`（第 464–467 行要求 `plugins/dsh-model-admission/package.json` 的 `version === pkg.version`）。**该诊断已逐字节还原**（`RESTORED EXACTLY: True`，版本回到 1.0.60）。
  - **关键事实：工作树是一次完整、彼此一致的 1.0.60 提升**——`package.json` 与 **16 个插件清单**（含 `plugins/dsh-model-admission`）**全部为 1.0.60**，其中 `plugins/dsh-model-admission/package.json` 的 HEAD 为 1.0.59、工作树为 1.0.60；`git status` 中共 **16** 个 `package.json` 类文件处于本地未提交修改。也就是说**版本耦合的产物之间是自洽的**，**唯一滞后的是门禁自己的常量** `DESKTOP_RELEASE_CANDIDATE_VERSION = '1.0.59'`。
  - **含义（成本已收窄）**：让这道门在当前工作树上跑通，**很可能只需把该常量对齐到 1.0.60**（外加我已做的两处契约处理），而不是"逐文件重新对齐"。**但这一行属于发布身份决定，我未擅自修改**——它需要你的明确同意（或由正式发布准备流程承担）。另注：`.release-state/` 下存在 `v60`、`mobile-pr47-v1.0.61`、`v1.0.59-*` 等目录，其中 `v60` 是**仓库文件快照**（内含 AGENTS.md/CHANGELOG/package.json 等副本，其内部 manifest 记录的 releaseVersion 为 1.0.24），**不足以证明 v60 已发布**，故我不据此推断发布状态。
  - **发布门本轮推进了 5 层（每层都以实跑确认为准，逐层暴露下一层）**：① `renderer/workspace-links-integration.js` 提示文案（**已恢复**）；② `app.js` 皮肤面板精确串（**已更新为等价且更严格的断言**）；③ `DESKTOP_RELEASE_CANDIDATE_VERSION` 1.0.59→**1.0.60 已对齐**；④ `plugins/dsh-model-admission` 版本一致性——**对齐③后自动通过**；⑤ README 候选/稳定版内容——**已修**：`PREVIOUS_STABLE_DESKTOP_VERSION` 1.0.58→**1.0.59**（README 下表列的本就是 v1.0.59 资产，常量滞后），并把 README 第 24 行改为门禁模板 `下一发布候选：**v1.0.60** · 上一稳定版：**v1.0.59**`（原为 `**v1.0.60（待验收）**` / `当前稳定版：`，措辞与门禁不符）。
  - **已暴露的下一层（未修）**：`release-notes.md` 需要精确字符串 `上一稳定版是不可变的 \`v1.0.59\``（`verify-static.mjs:590`）——即**版本身份钉在文档层是多文件链条**：README、release-notes.md、门禁常量必须一起对齐。
  - **如实标注的取舍**：我把 README 的 `（待验收）` 去掉以匹配门禁模板，**该诚实标记因此从这一行消失**（第 28 行那段 blockquote 仍完整说明候选尚未完成、不是所有问题已修复、技能加载不等于专业认证）。这是"文档对齐门禁"的代价，登记备查。
- **发布静态门的历史记录（本轮修复前）**：`node scripts/verify-static.mjs` 在**未改动任何依赖钉**的情况下即失败于首条契约检查：`Workspace local-link integration is missing: 右键可打开所在文件夹或复制路径`（`scripts/verify-static.mjs:277-278`）。**这是既有问题、不是本会话引入的**：`docs/AUDIT-20260912-VALIDATION.md:37` 已逐字记录同一失败，并明确"首次检查即失败，尚未运行至其后门禁，不能把后续门禁视为通过"，同时记录了另一处静态不符（门禁内 445 行固定候选版本 1.0.59 与当前 package 1.0.60 冲突）。**含义**：在升版前必须先处理这道门（或明确其当前红线），否则"升版后由发布门验证"这一说法无法成立。
- **一次失败的尝试（已撤回，但产生一条负面结论）**：我试写了一个用**真实 ws 套接字 + 暂停消费者**验证 relay 背压的测试（`tests/deep-audit-round4-relay-real-transport.test.cjs`），**该文件已删除**，因为前提不成立：在 loopback 上即使把消费者 socket `pause()`，`ws` 报告的 `bufferedAmount` 也不增长到所给边界（64KiB 界下连续推送 16KiB 块仍从未被拒绝）。即 **loopback 传输本身不产生可观测的排空压力**，需要真正受限的链路才会出现。这**反过来支持**了此前的更正：多秒级排队来自**被建模的受限链路**（夹具整形器），而非 loopback 传输行为。
  - 过程中还暴露我自己两处缺陷（均在删除前定位）：① `once(server,'connection')` 的回调参数是套接字本身，用数组解构会 `not iterable`；② 以 `port:0` 构造 `WebSocket.Server` 后再注册 `listening` 存在错过事件的竞态（应用构造回调）。**两者都不是产品问题**——说明"测试挂了"常常是测试自身的缺陷，不能据此推断产品有问题。
  - **删除理由**：留着它会变成一个前提错误、可能长期红的测试，正是本手册警告的"假红"来源；宁可如实记录结论为空并保留这条负面发现。
- 分类器修复、真实核心版本提升、子代理路由修复**均未实施**。
- 根执行部分**没有独立复核**。

## 7. 待用户授权

1. 子代理路由/通道修复（运行实例配置，根未擅自改）。
2. 按 `delegation-classifier-fix-spec.md` 立项实施分类修复。
3. 真实核心版本提升（26 钉 + 发布门契约 + 10 门哈希重派生）。
