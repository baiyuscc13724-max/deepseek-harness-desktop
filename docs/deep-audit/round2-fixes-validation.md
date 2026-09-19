# 三项必要修复：独立回归、组合装载与原证据重绑

## v2：总审退回的统计语义错误

上一版把master的115/104/598错误标成“自动覆盖/人工或环境阻塞/目标”；原检验器也复制了同一错误常量，旧8/8门控没有证明这些标签正确。root据此退回。本次只修统计解释、实际master字段投影和元证据门控，不改master、638历史、生产源码、真实Electron回执或两次47/48预览红；不重跑Electron、不展开destroy调查。

修改前按原 `final-freeze.json` 的摘要逐字保存6份报告/sidecar/test/检验脚本，其中4份当前文件获准修改。完整旧字节、精确原路径→保存副本映射位于 `review-rejected-v1/mapping.json` 与 `review-rejected-v1/files/`。原freeze SHA仍为 `0a177daaa181f7c7829279113cc1a46d4614ccea507ff474dc55258903918208`，不覆写；其365逻辑文件核验时只有这4个已改路径解析到映射的原字节副本，其余仍核对原路径。不能把当前改正文档冒充旧freeze原件。

新检验器从真实master解析三个原字段及数值，不使用重命名常量作为真值；新增3种错标签、3种错数值拒绝，并实际拒绝已保存的错误v1 sidecar。新元证据记录为 `metadata-v2.json`，新清单为 `final-freeze-v2.json`；原所有run和v1清单保持不变。

## 结论

本次独立执行支持**窄窗/缩放原生几何修复、HTML close/reopen 修复、保存去重/错误恢复/陈旧快照修复**的有界证据；不等于全产品或当前 GUI 验收。几何和设置回归符合既定范围；预览有一个必须保留的销毁瞬时计数重复性限制，不能照抄作者的无条件48/48。

- 几何：原23断言由18/23变为23/23；最终新源码91/91。旧源扩展仅43/66，**66与91不是同分母**。
- 预览：本次旧源41/48；未改时序的最终源码两次均47/48；增加观察性探针的一次48/48。新13项close/reopen/source/nonce断言在最终源码均通过。唯一剩余原始断言为 `LIFECYCLE-02 controller destroy detaches sidebar and stops iframe`，详情见下。
- 设置：原47由39/47变为45/47；新增15由4/15变为15/15。**原有两项取消/关闭契约待定，不被改成通过。** 真实fresh `AppStateStore` 合并和重新打开读取通过。
- 最终三生产文件共同装载交叉烟测6/6，附带原几何91/91未退化。
- v2仅重跑元证据门控 **9/9**：13个坏回执、原11个坏sidecar、新增6个错字段/错数值对象及保存的错误v1 sidecar，合计31个拒绝用例通过。绿色门控包括“原红保留正确”，不是产品全绿；旧8/8不能证明错误统计标签正确。

## 实际源与历史保全

维护树 `release-v1.0.28-worktree`，package 1.0.60；缓存 Electron **43.2.0 / Chromium 150.0.7871.129**，Electron内置Node24.18.0，启动器Node24.16.0。**未操作运行中的1.0.62桌面/当前GUI。**

| 文件 | 本次最终源码 SHA-256 | 实际旧字节 SHA-256 |
|---|---|---|
| `electron/main.cjs` | `74ea22e9b158dd34fb244d8dac6f0b91dd5a9e873e1017c8d26e597cbb8d24f9` | `4e547cd4fa5a0cff7b58c84b9d3747129eec574ce09014c48ca6e0a2bf8b42fc` |
| `renderer/right-workspace-integration.js` | `bf81102462e8802fbc9520826271886a6822077bd23e4a5bb67665a66a1e2eb8` | `e0f8c6cf400335cf29a0a99e8172a0abf9a05e566afa1435c18d1195cc7c6919` |
| `renderer/app.js` | `560354dc1ce1f365473da3068c75f0dec8ff08b46c03fe0a5b9fd1c03d7bdb65` | `3086aae0818e127ee12ac4db989ab9ed0760c68efbcb67eb3943de069e2064fa` |

`baseline.json` 绑定638份历史/作者冻结文件、15当前输入和三个完整原源码提供者。旧main来自作者冻结 `before-inputs/`；旧integration来自上一轮**独立复核** `preview-independent-v1/profile/local/`；旧app来自冻结 `app.before.js`。全部复制为本次 `snapshot/original/`，旧pin没有换成当前摘要。15当前输入保存在 `snapshot/current/`。

统一核验再次读取真实提供者、当前源、快照和638文件，零漂移。旧master、round1、reconnect、round2 sidecar/report/freeze/fixture只读。直接读取被冻结master的真实 `summary`：`userOperations=115`（用户操作）、`independentlyAccepted=104`（独立接受项）、`domainFindingRows=598`（领域发现记录行）。这些不是“自动覆盖/人工或环境阻塞/目标”三个指标；其历史测试2929总/2889通过/7失败/33跳过不重算、不提升。本次只新建 `coverage-round2-fixes.json` 增量边车。

## 运行证据及分母

所有路径下述均相对 `.artifacts/deep-audit-round2-fixes-acceptance/`。

| run | 实际断言 | 原矩阵 | Node退出 | 判读 |
|---|---:|---:|---:|---|
| `preview-before-v1` | 41/48 | 33/35 | 0 | 原close红+新5红+额外destroy计数红；outer仅要求关键旧红存在 |
| `preview-after-v1` | 47/48 | 34/35 | 1 | 唯一destroy计数红，不能忽略 |
| `preview-after-v2` | 47/48 | 34/35 | 1 | 同未改夹具单独复跑，重复同红 |
| `preview-probe-after-v1` | 48/48 | 35/35 | 0 | 原assert不改，额外观察产生新await边界，不能替代上两次 |
| `layout-before-v2` | 43/66 | 18/23 | 1 | 精确旧5横向几何红，扩展有23红 |
| `layout-after-v2` | 91/91 | 23/23 | 0 | 真实DOM/native与事件生命周期通过 |
| `settings-after-v2/before` | 39/47 + 4/15 | 39/47 | — | 与after同一4-test启动器 |
| `settings-after-v2/after` | 45/47 + 15/15 | 45/47 | 0（4/4） | 仅两契约待定保留，真实store也通过 |
| `layout-after-combined` | 91/91 + 6/6 | 23/23 | 0 | 最终三源共同活跃装载，不是仅对app算hash |
| `evidence-after-v1` | 8/8旧门控 | 24旧拒绝用例 | 0 | 后被root指出统计标签与自证常量错误；原记录保留 |
| `evidence-after-semantic-v2` | 9/9元证据门控 | 31拒绝用例 | 0 | 实际master原字段/数值投影及退回字节映射验证，无Electron重跑 |

各真实receipt完整SHA见新sidecar的 `receiptBindings` 和 `verification.json`；输入/夹具、派生、错误、TAP及源码全部保留，改正后的当前清单见 `final-freeze-v2.json`，旧 `final-freeze.json` 保留作为退回版本证据。

### 预览销毁计数限制：不隐藏第三种结果

未改原destroy断言观测两次均 `{connected:false, beats:false}`，预期 `{connected:false, beats:true}`。节点已脱离；布尔 `beats:false` 表示全局计数在该瞬时窗口改变，不单独证明该特定frame持续执行。

观察性派生捕获**确切旧 WindowProxy**，不改原断言、不删消息监听；trace为：
- t≈5909.9ms，一个heartbeat来自仍connected的旧frame；
- 原检查后≈6145.3ms、额外100ms宽限后≈6254.2ms、再300ms后≈6563.4ms，均为ticks=1且connected=false。

这支持该观察run销毁后无持续心跳；但增加观察调用本身多一个await，可改变排队消息交付。因此**不能将此run包装成原时序稳定48全绿，也不能仅凭前两红宣称持续执行漏洞**。本次最终状态明确保留这项夹具/时序不确定性，交给root判断是否需要后续单独审计；不追加生产修改、不扩大修复。

新增close专用矩阵更严格：先确认实际运行的≥2个心跳，持有旧WindowProxy/节点，100ms队列宽限后再观察240ms；闭合后移除节点、重开新上下文/焦点、Home/Files/Browser切换、迟到请求/来源/nonce不复活均通过。旧35源码断言块摘要 `0751ecc6c2cba315ae50057818608dd8aa1e98df6ac35c21d9593e24a7b221bd`，新13块 `07ef9b6d3f2304e7f34440ac919b4dbe3fffa4fd156ce7d107655d7d966935cb`。每run派生均可逐项逆转成实际原测试字节。

### 几何：源契约与真实回执

独立比较完整原/新main，将两授权函数/必要helper段、偏好字段、resize绑定点规范化后，其余字节完全相同；renderer/CSS没有由本复核改动。旧23断言源码除 `repo→sourceRoot` 装载seam外逐字相同。

核对 `main.cjs:533–629`：owner、webContents、frame、文档generation、binding token共同约束；每次 `isOwnedPageSender` 重验实际本地 `renderer/index.html` URL及frameURL。固定一次性resize Promise只返回有限三元组；无用户脚本入口、无定时轮询；pagehide/dispose解绑，reject停止本轮，不忙重试。重新装载可恢复。

实际新main测试**程序setZoomFactor后不手工layout**，观察100+1200ms稳定收敛。旧A真实renderer tuple完成后仅在测试传输层扣留，B是真实另一窗口/原生view；resolve、注入reject两分支均验证B已经可见且写入计数>0，交付旧A后B的bounds/可见性/写入计数逐项不变。该reject不是声称Electron自然产生同错误。

原main没有新监听段，在特性不可用红后退出该扩展段，故66与91只能分列；原23仍全部实际执行。截图 `synthetic-shell-home.png` 已独立看图并核对实际PNG摘要：只有明确标记 `LAYOUT FIXTURE ONLY` 的合成guest和320px主页rail。**官方React AppFrame没有挂载；用户截图首页持久白栏未复现/未确认根因，不能标修复。**

### 设置：同步提交与异步快照不是一回事

独立读取当前main `appearance:setTheme/setUiPreferences/saveCustom`：均先 `ensureStateStore().updateAppearance(...)`，再返回异步 `appearancePayload()`；真实 `AppStateStore` 自有字段合并、同步持久化。独验fresh disk写入两次并新实例读取，原accent/brightness与后blur/UI字段共存。

renderer实际保存handler接受受控Promise：同tick重复请求去重、pending busy/禁用、错误live status、重试、旧成功/失败回执、最新失败保留先前成功、未保存range草稿、20次突发逆序快照与恢复official原子patch均验证。rAF等待使用实际Chromium requestAnimationFrame及60ms延迟，2s内不来即失败；未替换rAF实现或改原47断言。DOM `.click()`及事件派发属于合成用户输入，Chromium自行生成trusted checkbox子事件也不等于物理键盘/鼠标证据。

保留的两项：
1. `cancel preview restores persisted settings rather than silently retaining draft`
2. `old theme receipt after close reopen does not mutate reopened appearance`

测试快照延迟/逆序不会反向改写persisted；不能声称真实IPC/真实磁盘提交逆序，也不能声称关闭取消已经提交的保存。

## 三源共同装载与五维适用性

组合夹具在原几何/事件矩阵之后、同一真实shell/native owner仍存活时，加载完整最终app及modal/theme依赖，仅替换原bootstrap为私有seed/export。保留完整integration，main仍是精确原函数切片；新6项覆盖singleflight/aria-busy、失败live提示、重试应用/关闭、保存后的自动zoom、close隐藏native、Home及guard状态恢复。guest仍为真实合成webview，仅设置探针期间临时令其getURL为空，避开官方guest外观发布；结束恢复原方法。**不是完整main进程启动，也不是官方guest应用集成验收。**

| 维度 | 已实际验证 | 未提升范围 |
|---|---|---|
| 正常 | responsive几何、sandbox预览、保存成功、三源并存 | 当前GUI/官方AppFrame |
| 恢复 | 真实reload/rebind、close/reopen、失败后重试 | destroy原时序重复性、两取消契约 |
| 并发 | 旧owner/document回执、连续zoom/resize、nonce/request竞态、保存逆序snapshot | 真实IPC/磁盘乱序 |
| 隔离 | owner/frame/URL、opaque source、CSP/source/nonce、空端口越界记录 | 真账号/设备/剪贴板 |
| 可访问性 | zoom、DOM焦点/Enter/Escape、disabled/aria-busy/live status/滚动 | 屏幕阅读器/真输入/IME |

## 安全与完整性

每run新建profile，ProcessStartInfo清空环境后只保留系统/隔离路径白名单；Node/Electron/renderer网络和native端口先封堵，严格CSP及精确文件URL allowlist。preview使用 `http://127.0.0.1:9/preview-fixture` 的进程内protocol handler，**没有监听socket/server**。没有下载、安装、构建、发布、当前GUI、真实账户设备/剪贴板/用户设置操作。未重跑全库或危险入口。

证据门控拒绝：伪Electron、缺失/重复断言、伪green、native/network越界、旧源洗成新源、旧owner写B隐瞒、手工layout冒自动事件、删契约红、弱化expected、膨胀分母；sidecar的master覆盖提升、不同分母合并、白栏已修/预览全绿/真实IPC等虚假提升也被拒绝。**v2为原13+11与新增6个内存毒化对象，再加保存的错误v1 sidecar，共31个拒绝用例；真实产品回执与历史文件不改。**

## 复核自身纠错记录（全部保留）

- `prepare-more-after-v1` 唯一锚点空白不匹配，未改变已写派生；修正后校验已存在文件字节相同，不覆盖。
- `layout-before-v1` / `layout-after-v1` 在observer helper相对require路径失败，measurements为空，不能当作产品红；新 `layout-v2.cjs` 只修两require路径。
- `settings-after-v1` renderer before/after完整完成，但真实store单测漏改相对require，outer3/4；新 `settings-v2.cjs` 仅修该路径后4/4。
- `prepare-more-after-recovery` PowerShell参数Entry与foreach entry大小写不敏感冲突；子进程未启动，修循环变量后独立新目录运行。
- `prepare-more-after-combined` 唯一循环锚点前导空白不匹配；修正后新目录生成，生产不动。
- `summarize-after-v1` 拒绝把作者旧源6红套成本次独验结果；读取本次receipt确认额外destroy红，严格绑定本次7红/41通过后，`summarize-after-v2` 成功。

首版源、失败目录和原作者冻结均未删除/重写。路径恢复和组合派生分别有可逆manifest；本复核只写新test/sidecar/report/专用acceptance目录。

## 重验与交付

```powershell
# 仅核验证据，不再次启动Electron；Run必须未存在
pwsh -NoProfile -File .artifacts/deep-audit-round2-fixes-acceptance/run.ps1 -Kind evidence -Run NEW
# 真实布局before/after可分别使用 -Kind layout -Mode before/after -Entry layout-v2
# 设置成对运行使用 -Kind settings -Entry settings-v2
# 预览原时序为 -Kind preview；观察探针为 -Kind preview-probe，不能混同
```

本次统计语义返修的metadata/evidence作业已收齐，9/9通过后生成 `final-freeze-v2.json` 并再次核验；原 `final-freeze.json` 及全部旧run不覆写。该清单包含主要交付、来源、实际执行源码、receipt/TAP/错误/派生材料；排除易变的profile缓存、不包括自身，避免自指。Markdown与JSON已本地结构验证；为遵守不操作真实GUI边界，未调用右栏文档预览。交付等待root独立接受；没有自我批准/全量覆盖提升。
