# 复制粘贴实际组件补验

## 结论与证据范围

本轮新增**实际发行版编辑组件的隔离行为证据**，不提升既有 USER 聚类为整体通过，不改历史 coverage、生产文件、冻结测试或安装产物。

在 Windows 缓存 Electron 43.2.0 / Chromium 150.0.7871.129 / React 18.3.1 中，真实 `InputBar → ComposerContentEditable → SessionInputShell → 内嵌 Lexical 0.49.0` 消费合成 `ClipboardEvent` 和浏览器真实 `DataTransfer` 对象。断言检查实际编辑器草稿、选区复制载荷、DOM、焦点及生命周期，不是菜单 dispatch 计数，也没有复制理想编辑算法。

- `tests/deep-audit-clipboard-components.test.cjs`：**2 项 Node 测试**，baseline / actual-installed 各运行完全相同的 **32 项实际组件检查**。64次内部检查执行不是64项新用户要求，不混入旧全量计数。
- `tests/fixtures/deep-audit-clipboard-components/renderer.js`：只提供合成会话投影、无输出的 slot、真实 state 的 React 订阅、选区/事件驱动与假发送端口。
- `tests/fixtures/deep-audit-clipboard-components/deny-network.cjs`：Node 网络端口全部拒绝。
- `tests/fixtures/deep-audit-clipboard-components/run.ps1`：fresh profile、明确环境白名单、缓存 Node/Electron 离线启动。

**边界：**这是 composer 的纯文本编辑模型，富文本 clipboard 同时存在 `text/plain` / `text/html` 时取 plain，不保留富文本样式。并未激活 `webContents.pasteAndMatchStyle`，所以不能把这项结果等同“原生粘贴为纯文本入口已全链通过”。真实跨应用/OS clipboard、真实鼠标选区、原生快捷键和 IME、RTF、图片粘贴、普通网页编辑器、其他操作系统均未验。

## 实际生产路径与可逆装载差异

baseline 读取维护树缓存产物；actual-installed 执行已审阅的正式安装导出API，但所有目标均为本次fresh临时包。**不运行真正CLI、不写真实 node_modules、不操作当前运行的 GUI**：

| 输入 | 完整 SHA-256 |
|---|---|
| conversation `lib/client.js` | `6f797eb8e87c07e33b9ef35eaacc0eca9bc122e04e14d176ea81354fd53358a2` |
| shell `index-Df-65__b.js` | `9e845cbbe80482a49831d912b9c02324c5ff1e8c35b9cc5f7009ecbe6e4537c1` |
| vendor `vendor-CCJJTK99.js` | `38f95ea3ff85b49dc4d8f237db208bbaedd2cb8c31611215c246dde41786ff21` |
| cached `electron.exe` | `8593db40c0c6e5e3c4b6b0a225b1dc9a549ecdf10f6cf2010cf5b6ce869ce07f` |

初交仅绑定 **visibility 输入**，因此总审退回补齐当前候选安装闭环。该历史证据保留为baseline，不冒充最新实装。修订后actual-installed的输入为实际临时安装后完整 conversation：**`30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066`**。两组均运行下文同一32项断言；输入选择发生在Electron主进程读文件时，renderer不执行任何安装transform。

受控副本差异仅两处，receipt 保留逐字节 seam 与输出 hash：

1. 本地 shell 副本把唯一 `new Bp(lc).run()` 启动块替换为 `window.shippedModules=zp()`，取发行版真实 React、ReactDOM、store、UI primitives、Cordis 等依赖，禁止运行产品应用启动器。vendor 原字节复制。
2. conversation 内只在唯一 `exports.apply = apply` 前加测试私有 export，导出真实组件、shell、keymap 与同 bundle Lexical root/selection/command 常量。撤掉该字符串必须与输入逐字节相等；没有替换 handler、事件算法或旧 fixture。

### 当前候选的实际临时安装

`install-current.cjs` 派生自只读的 `deep-audit-session-core-install.test.cjs` 与 `deep-audit-question-card-install.test.cjs` 已验收 fixture/相关顺序，未运行它们的测试入口，未编辑任何原test/helper。导入前固定完整hash：正式installer `cecd16cc…`、core helper `e86c9d2d…`、question helper `251b67da…`、两份安装测试 `bc04b80c…` / `ab76113f…`；完整值在 `installation.json.pinnedReferences`。

1. 在本次 `profile/installed-runtime/node_modules` 创建16个受控包，复制32份明确的package.json/JS输入。每个manifest逐项断言真实包名、15个alpha.5版本与marketplace 1.5.5，源字节、metadata字节及导入的24份安装模块hash均记录。
2. 仅临时conversation调用正式visibility restore准备完整官方 `7ee5792b…` 输入并落盘；这是与原已验收安装fixture相同的准备步骤，不是renderer候选生成。
3. 调用完整 `assertInstalledAlpha5RuntimePreflight(runtime)`，包含question完整身份/完整hash门和既有13项native capability门；不是用旧13项API代替新完整gate。
4. 对全部明确的临时路径依次调用正式 `patchInstalledModernConversationComposerVisibility` → `patchInstalledProviderAuthIsolation` → `patchInstalledMarketplace155` → `patchInstalledAlpha5ImageQueuePerformance` → `patchInstalledSessionCoreClient` → `patchQuestionCardRuntime`。这些API内部真实原子writer写临时包，不替换writer、算法或输出。每一阶段逐文件hash及changed结果保留。
5. conversation最终严格等于30F完整hash、question等于6F382完整hash；重复同一完整相关顺序所有changed=false，所有文件字节不变；manifest与维护树源文件前后不变。整个CLI分支未运行，四个危险旧测试入口均不包含在本次2个测试中。
6. Electron actual-installed从**该真实落盘conversation文件**重新readFile，复核包名、版本、完整30F hash，再加与baseline相同的可逆private export。没有从baseline在renderer二次transform。CSS使用该bundle实际注入内容；receipt逐style记录id/hash/字节，comparison记录baseline与当前候选CSS和安装文件差异。

安装相关前提包只是gate/顺序的输入，不执行它们的服务入口；真正组件依赖仍是已固定shell/vendor中的React、store、primitives/Cordis，无新增理想fallback。对比测试把32项完整setup+assertion源码片段与首交快照逐字节相等，并再比较两组全部observed/expected完全相等；变更候选输入不能悄悄改断言。

实执行链（以下行号指baseline完整 conversation 输入；actual-installed因已接受补丁会有行号位移，完整输出hash绑定）：

- `SessionInputShell` 11487、构造器 11542–11559：真实 editor、plain-text/history 注册和更新订阅。
- `ComposerContentEditable` 14661–14682：真实 React layout effect 绑定/解绑 resident DOM 和 `setEditable`。
- `InputBar` 15320–15720，15468–15496：真实锁态 gate / keymap 注册；`pasteText` 真实调用 shell.paste。
- `registerComposerKeymap` 14774–14788：从 event.clipboardData 取 plain、处理空数据、阻止 default。
- `SessionInputShell.paste` 11693–11705：真实选区插入、占位符过滤、paste 历史边界。
- 内嵌 Lexical plain-text copy 10251–10261、10319–10320：真实选区序列化为 `text/plain` 与安全 `text/html`。

非编辑依赖只作本地数据边界：session hook 返回合成 `running/removed` 等投影；busy 检查通过投影 `phase=submitting` 激活真实 InputBar 锁分支，并非执行真实网络提交。`useInput/useNotices` 订阅真实 shell store。复制/粘贴算法和 React/DOM 均未替身。

## 32 项细分证据

精确名称及 expected/observed 逐项保存在 `receipt.json.checks`；下面按适用维度归组。

| 组 | 检查与实际结果 |
|---|---|
| 实装与普通复制 | 真实InputBar/role/editor挂载；选中 `alpha` 得对应 plain/HTML、不改draft；collapsed selection不写载荷；`<tag>&中文🙂` 的HTML正确转义 |
| 富文本与纯文本粘贴 | rich双格式只取plain并替换原选区，保留中文/emoji/换行；恶意HTML不产生script/img/b/iframe，不执行；HTML-only/empty不删选中内容；plain-only保留两侧文字；真实Lexical undo/redo仅撤回/恢复该次paste |
| 不可编辑 | disabled反映contentEditable=false和aria-disabled；readonly仍允许选区copy；removed、blocked、busy都保留原草稿，busy确实setEditable(false) |
| 会话/焦点/生命周期 | resident DOM切到新shell后旧editor root=null、新草稿一次插入、焦点是编辑面；直接向旧editor派发晚到命令不改新会话；外部焦点目标paste不改composer；20个不同shell重复挂载始终只有一个root且每次只插入一次；unmount后旧DOM事件不改变保留draft |
| 合成IME与故障 | composition Enter不提交；compositionend后paste保持输入；getData/setData主动抛错确实穿过真实handler并被错误观察器记录，旧内容保留，正常paste随后恢复；缺失ClipboardData保留内容 |
| 安全守卫 | renderer native/fallback/network调用0；全体copy/paste事件isTrusted=false；除两种主动故障外无其他renderer error；主进程native和Node网络调用0、无被拒网络资源请求 |

`getData/setData` 抛错测试只证明内容保留及恢复：产品异常会到达 renderer error 事件，由 harness 记录并抑制未捕获默认日志；**不证明产品有可见错误提示，也不证明真实 OS clipboard API 的错误恢复**。没有基于纯合成端口抛错提出生产改动或放宽断言。

晚到命令针对旧 editor，只声明不能污染新会话；不声明旧 editor 的独立内部状态绝不变化。程序化 Lexical 选区不等于真实拖选；合成 CompositionEvent/KeyboardEvent 不等于候选窗、真实中文输入法或平台组合键。

## 既有 USER / 域 ID 的五维映射

固定旧 `coverage-master.json` SHA：`8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794`。原598域行、115 USER、2929=2889pass/7fail/33skip和104有限接受不变。本表是增量关联，不重写其状态。

| 既有用户项 / 域项 | normal | error-recovery | concurrency-switch | isolation | a11y |
|---|---|---|---|---|---|
| `USER-c890c86ded0b` 复制选中文字；`DOMAIN-interaction-command-copy` / `DOMAIN-interaction-native-rich-copy` | composer选区plain/HTML序列化、空选择和HTML转义有限通过；跨应用native仍未知 | 合成setData失败保留draft；产品错误提示/native失败未知 | 共享编辑面生命周期有证据；真实菜单焦点变化沿用旧dispatch证据，不合并宣称E2E | fresh profile和假事件端口通过；无真实clipboard | textbox/readonly copy及焦点局部证据；读屏/拖选/原生快捷键未知 |
| `USER-aff2717caf0c` 粘贴文本及格式；`DOMAIN-interaction-command-paste` / `DOMAIN-interaction-native-paste-image` | composer rich双格式剥离、plain插入、empty/HTML-only有限通过；富样式保留/图片/native未知 | 合成getData失败保留再恢复；readonly/removed/blocked/busy不变 | resident切换、旧editor命令、外部目标、20次切换/unmount有限通过 | native/network端口零调用；恶意HTML不入DOM | role/aria-disabled/focus及合成IME分支有限通过；真实IME/读屏未知 |
| `USER-b6a989460a46` 粘贴纯文本；`DOMAIN-interaction-command-pasteAndMatchStyle` / `DOMAIN-interaction-native-plain-paste` | 实际composer纯文本路径有限通过；未执行原生pasteAndMatchStyle，入口整体未知 | 空/缺Data/故障保留、undo/redo及锁态有限通过 | 同上composer生命周期有限通过 | 同上；未读系统clipboard | 同上；未声明原生Ctrl/Cmd+Shift+V通过 |

域里带 `native-*` 的行只建立“相关但仍未验native”的关联，本轮不是这些域整行pass。原 `interaction.md` 明示的跨应用HTML/RTF、真实密码字段剪切、图片、多级原生历史等未覆盖项全部保留。

## 安全执行边界

1. PowerShell `ProcessStartInfo.Environment.Clear()` 后只给 Node 系统目录与专属fresh HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP/DSH_HOME；只增加本次输出目录和 Node test runner 的无能力worker标记。Electron再次从固定白名单构造环境，不传真实能力端点、代理、token或用户配置。
2. 运行前后验证四个实际输入完整SHA及六个冻结参考文件SHA；测试/fixture自hash写入本次inputs/result，并前后对照。未知输入直接拒绝，不能靠anchor形状放行。
3. 先替换 Electron clipboard 所有函数与WebContents copy/cut/paste/pasteAndMatchStyle/selectAll/undo/redo/copyImageAt/insertText/sendInputEvent为抛错端口，再装载页面；未调用任一原方法。没有菜单原生edit命令、真实GUI控制或WebView。
4. renderer `nodeIntegration=false, contextIsolation=true, sandbox=true`。在取真实React模块之前先封死 `document.execCommand`、navigator.clipboard、fetch/XHR/WebSocket/EventSource/sendBeacon/window.open；页面无真实服务bootstrap。
5. Node net/tls/http/https/http2/dgram/dns及global fetch/WebSocket拒绝；Electron net端口拒绝、background networking/component update/sync关闭、resolver映射NOTFOUND；专属session webRequest只允许profile内精确三份file URL（fixture/shell/vendor），其余全部cancel，包含60131；权限/download/new-window/navigation拒绝。没有尝试联系60131、真实账号设备、公网或loopback服务。这里是受控执行通道证据，不是OS全进程网络抓包证明。
6. 本次仅调用正式导出API在受控临时包安装候选；没有下载依赖、真实安装/构建/发布/提交，未访问真实会话或桌面。报告只做文本结构复核，不以GUI预览突破任务禁止GUI控制的约束。

## 复跑与历史记录

在维护树执行，**每次使用未存在的 Run 名**：

```powershell
& ./tests/fixtures/deep-audit-clipboard-components/run.ps1 -Run independent-review-v1
```

不要直接从继承用户环境的 `node --test` 启动；环境gate会拒绝。只需已有Node与缓存Electron，不使用npm/npx、不安装依赖、不访问当前GUI URL。两组总耗时约10秒，最终进程退出后才可读取证据；脚本保留fresh profile、临时安装包与本地模块副本供差异复核。

本次证据目录统一位于 `.artifacts/deep-audit-round1-clipboard/`：

- `author-v1`：Node新增测试worker标记未纳入初始allowlist，预检拒绝，未启动Electron。
- `author-v2`：PowerShell自动补入PSModulePath，预检拒绝，未启动Electron；更换为明确ProcessStartInfo环境清空，没有允许该用户配置变量。
- `author-v3`：第一版24项组件检查通过，只有历史初版证据，不代表最终32项。
- `author-v4`：前26项检查通过，新增20次切换脚本误用顶层await（executeJavaScript非module），harness脚本执行失败；不是产品失败，不删旧记录。只把循环包进async函数，没有改生产或预期。
- `author-v5`：32项组件检查通过；后续仅为runner增加TAP输出目的地。
- `author-final-v1`：**1 Node test / 32组件检查通过，0 fail/skip/cancel，约4.68秒，drift=0**。最终代码与fixture hash绑定、TAP/receipt/result为提交候选，由总审与独立验收再决定接受。

首交快照在 `submission1-snapshot/`：原测试SHA `2a93ecaaee4ef6782fda0ffe216ca1694eb5e387b4d86dddd23bc79f998b995e`、原报告SHA `5f63cdef45dc4bee343ea4df8713301686edf5d80a730682ab7aac98cb2ca132`；`author-final-v1`仍只代表最初baseline，不能冒充修订后的候选证据。

### 第二次提交：当前候选闭环结果

- `installed-author-v1`：baseline32/32、actual-installed32/32通过，2 Node tests全通过；首次实际30F落盘→Chromium装载记录保留。
- **`installed-final-v1`：最终2 Node tests通过，baseline32/32 + actual-installed32/32，0 fail/skip/cancel，约10.98秒，drift=0。** 两组全部observed/expected完全相同，32项原setup/断言片段SHA固定为 `61d5e6d447a59524d29dd3f1a97ca3257b39f62742651bd29784f834f24c8c87`，没有改动求绿。
- 现行测试SHA `5516d18bee7972be4921a86b3a84f21861eb2c4bd00958f50b496a13cfdda78c`；新增安装fixture SHA `e043c712987a13ab97e64cbe72cfab2da170ed5d7172790adcc12cab54b774fd`。renderer/deny-network/run.ps1保持首交字节不变。
- actual-installed receipt SHA `d1aab762fedb39d31d2633db2901bf3c13d2fe3130f0980aabc6c3d922cebebf`；baseline receipt SHA `0971d0eb57ecec49daca3b6dae722356c6c54956b33b8f1949f28e46ae5622ce`。`comparison.json`明确结果相等、CSS diff为空；安装临时包的6个JS变化仅为session-controller、conversation、attachment、question、provider、marketplace，完整前后hash都在该文件中，未变的manifest及10个JS同样保留在installation逐阶段清单。

最终入口为 `installed-final-v1/node.tap`，两组分别有 `baseline/`、`actual-installed/` 的inputs/result/receipt/electron.log；根目录 `installation.json`含32份复制输入、16份metadata、24份导入安装模块、完整stage序列与重复安装证明；`comparison.json`含断言片段hash、结果相等和CSS/文件差异。当前候选32项有限通过映射到上表同三个USER，**仍不提升其native或全维度整体状态**。所有旧失败及首交记录保留，不覆盖。
