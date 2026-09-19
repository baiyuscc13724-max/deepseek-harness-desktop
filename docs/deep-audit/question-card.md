# 手机问答卡：真实组件复核与并发修复候选

## 结论与状态

**不能宣称用户真机“点击选项基本无效”已定位或已修复。** 本次不操作真机、当前 GUI，不发真实问题卡，也不要求用户回答或复现。

已确定并修复另外两类真实前端缺陷：React 尚未提交新视图时，连续激活读旧 draft 丢选项/提交旧值；提交中的锁仅存于组件局部状态，同批次激活及同卡重挂载可重复调用 `pending.answer`。修复只进入 exact-hash 维护 helper 候选，**没有写入 node_modules、当前运行实例或 APK**。正式安装链胶合交基础成员，根独立验收前不能视为交付到用户。

在启用真实移动注入逻辑的隔离 Chromium 中，单次可信触摸始终只产生一次选中；没有复现 label/checkbox 双触发、普通流式重绘丢草稿或 DOM 被搬离 React root。不能把这些负面结果扩大成真机不存在故障。

## 唯一新增输出

- `scripts/deep-audit-question-card-patch.mjs`：版本/整文件输入输出摘要门控、原子维护写入 API。
- `tests/deep-audit-question-card.test.cjs`：实际 bundle、内嵌 React/store、移动注入、可信触摸及回执链基线/修复对照。
- 本报告。

未修改 renderer、MainActivity、MobileUiAdapter、mobile assets、安装器；未 stage/commit/release。

## 实际工具链，不是名称相似的另一个组件

维护仓与运行中 1.0.62 的问答 bundle 在首次只读比对时完全相同，均为 `@deepseek-ai/dsh-client-ui-user-questions@0.1.2-alpha.5`。

1. `dsh-tool-ask-user/lib/index.js:14–16` 注册 `ask_user_question`。其描述与模型工具一致。
2. `execute:96–111` 调 `ctx.userQuestions.ask`，明确 `multi_select → multiSelect`，选项不改写；返回 `answers.map` 原样复制 `id`、`selected` 和可选 `custom`。
3. `dsh-user-questions/lib/index.js:52–76` 验证调用及意图，进入 `user-questions/request` waterfall。这里没有生成空选择的超时成功分支。
4. `dsh-api-remotes/lib/index.js:87–88` 将此事件声明为远程 waterfall。
5. `dsh-client-ui-user-questions/lib/client.js:840–881` 用同一事件创建 `PendingQuestion`，注册 pending interaction，并将 `QuestionComposer` 注入 `conversation.composer`。
6. `QuestionComposer:452–465` 将 matched carrier 交给 `QuestionFlow`，以 `question.key` 为 React key；普通问题不会进入计划确认面板。
7. `QuestionFlow` 的选项是 **button role=checkbox/radio + aria-hidden 装饰 span**，不是 label 包 input。原代码唯一选项激活处理是 button.onClick；没有依据增加 touchend 补点。
8. `pending.answer` 同步 resolve `pending.result`；客户端 answerQuestion 的 finally 移除 pending presentation。工具 Consumer 再复制 selected 输出。
9. `dsh-client-ui-tool/lib/client.js` 的 `AskQuestionRow` / `AskQuestionCard` 是完成后的结果摘要，不负责待回答卡的选择。其 `answeredPresentation` / `pairAnswers` 按问题 id 回配 selected/custom，不发提交。

测试将真实 Consumer.execute、真实 UserQuestionService.ask 方法、真实 answerQuestion/PendingQuestion 和真实结果 Row/Card 串接；唯一远程边界为本地合成 waterfall/序列化。**这不是调用运行中 ask_user_question 工具或私有 API。** 最终实证使用三题混合请求：多选 `multi_select:true`、单选 `false`、多选显式跳过。可信触摸先选择两项、Next、单选并自动前进，期间 pending 始终未移除；末题 Skip 触发完整回执，三个稳定 id 对应 `["Option 0","Option 1"]`、`["Option 1"]`、`[]`，presentation 恰好移除一次，真实结果 Row/Card 完整保留三题内容。

### `selected:[]` 能说明什么

- 实际 `skipQuestion` 会清空本题，并在末题提交 `selected:[]`；测试已证实。
- 单选的自定义文本答案也可合法使用空 selected，同时包含 custom。
- 实际 cancel → `ASK_CANCELLED` rejection；实际 AbortSignal → `ASK_ABORTED` rejection。两者不是成功的空 selected 回执；均已直接测试真实 PendingQuestion。
- 单个空数组不能证明丢点击、双 toggle、用户跳过或服务器超时。没有读取该次用户卡的私有历史/实时 DOM，因此**本报告不推定该次空回执的来源**。

## 原样源码与测试激活边界

不是重写一套理想问答模型：

- 将实际 web shell 的最后启动语句替换为导出 `zp()` 静态模块；其它核心代码/本地 vendor 保留，加载于全新临时目录。不会启动 shell 的插件装载、账号配置或网络。
- 使用其中的 React、ReactDOM、真实 defineStore/Immer 状态、真实 Primitives；不是假 Store 或假 Button。最终 fixture 同时加载实际 Web shell `index-b24khbeK.css` 和 `vendor-BNsW4eBh.css`，触控尺寸不是缺失基础按钮样式时的默认值。
- 加载实际 `dsh-client-ui-renderer` factory，导出其真实 `bindSnapshotSelector` 与 `renderChainResult`；保留 overlay fallback 真正 `display:none` 行为。
- 加载待答 bundle 全 factory，仅增加测试导出；修复组先在内存经过维护 helper，原始依赖不落盘变更。
- 外层会话骨架是合成 DOM，匹配实际 conversation 根/scroll/seat 结构，加载实际 ConversationRoot 样式；不是完整工作台启动。
- 读取 MobileUiAdapter 中实际 `FILE_ENTRY_JS` 和 `buildInjectionScript` 字符串拼接表达式。只接受已观察到的 Java 字面量/指定变量/JSONObject.quote 拼接，拒绝未知表达式；CRLF 仅归一化以解析 Java 结构。JSONObject.quote 对应本地 JSON.stringify。
- 重建后的完整注入包含真实 mobile CSS/runtime 和原生附件入口 JS。重复注入返回 ready 且不增加 listener；不是单纯 eval runtime 后称“App 已覆盖”。
- 合成 Android UA、`HarnessMobilePlatform='android'`、Navigation route `/m/conversations`、Control/cache bridge 替身。无真实原生文件/媒体/剪贴板动作；观测到的桥调用仅 `navigation.subscribe`。
- Chromium CDP 启用 touch/focus emulation；实测 document.visibilityState=`visible`，因此真实 MutationObserver/rAF 分支不是隐形窗口跳过状态。
- 实测 platform=android，四个 capabilities 全 true，runtime marker=ready，shell/observer/inputEntry/imeSendBridge 存在，pointer:coarse=true。
- 注入注册了 click capture、scroll、pointerdown 等真实监听。可信 option taps 后选中准确，无合成第二 click；问答节点仍在原 React delegated root，fallback 仍隐藏。

此夹具没有 Android Java View、WebView 版本差异、原生连接遮罩或真实 WebProxy/远程 socket。Navigation/Control 是明示替身，不可据此声称覆盖原生触摸分发/网络。

## 基线 → 修复的确定证据

基线组有意断言下面的**旧版错误观测值**以证明缺陷仍能重现；它的测试通过不代表旧版满足验收要求。

| 操作 | 原始 bundle 观测 | 修复 bundle 观测 |
|---|---|---|
| 同一 JavaScript dispatch 内激活两项 | 只保留 Option 1 | 两项均保留 |
| 同一 dispatch 对同一项激活两次 | 仍为选中 | 两次准确切换，最终未选 |
| 已选一项，激活第二项后立即 Submit | 提交旧的 Option 0 | 提交最新两项 |
| 同一 dispatch 连点 Submit | pending.answer 调用 2 次 | 调用 1 次 |
| 在途卡严格重挂载 | Submit 再次可用 | 继续 disabled |
| 多选行反馈 | 仅小方框，无选中行 class | 选中行 class 与 aria-checked 一致 |
| coarse 页脚 Skip / Submit / Continue | 86×36 / 56×36 / 70×36 px | 86×44 / 56×44 / 70×44 px |

上述同批次实验是程序化 DOM 激活，**不是将真机手势故障伪装成已复现**。实际 PendingQuestion 本身已有单次 finish 保护，因此重复 `pending.answer` 调用不等于远端接受两个答案；前端修复避免多次调用及“already settled”错误竞争。

## 首次候选被退回的证据（保留，不作为最终通过）

首次提交输出 SHA 为 `d63cc0a7e789fb2872d284c7fb5a13ae0e7cdbaebab22c9bf26fa8e35d48a331`；对应 helper 文件 `d4836510c1ab27a558da58e9286b1c7283f97591d05f99728034ccaa12de6f18`，测试文件 `d1e743f426a779e49381fa4faf440a8357912b7b77d5ca714e9a2d93b98050a9`，当时 3/3 测试约 51.5s。

根独立 review 指出原 bundle 738/757 两个 pager 箭头仍使用旧 `drafts`；首次测试的状态链/Consumer 仅一题，不能覆盖多题分页。任务被明确 reject 并重新 claim，历史提交不抹除，安装链尚未接入。

**先复现、后修复**：在 d63 候选上补三题真实 DOM，同一个 JS dispatch 内得到：

| 三题操作 | d63 首次候选实际观测 | 本次最终候选观测 |
|---|---|---|
| 本题选择 → Next | 当前题所选丢失，三题全空 | 所选保留，进入下一题 |
| 第二题选择 → Previous | 第二题所选丢失 | 所选保留，返回第一题 |
| 第二题 Next → 同批次旧 Previous | index 从 1 经 2 错跳到 0 | 旧回调拒绝，停在 2 |
| 末题 Submit → 同批次旧 Previous | 已提交一次，却在 busy 中把 index 改到 1 | 保持 index 2，提交仍一次 |
| 第二题新增选择 → Previous → 旧 Continue | 旧 Continue 被拦，但 Previous 已丢掉新增项 | index 0 且第二题全部选择保留 |

三题可信触摸、跨帧 Next/Previous 在原始基线与修复组都正常；依旧不是已复现真机丢触摸。新增回归另覆盖旧 Skip 不清离开的题、Continue 读最新两项、旧 Continue 不跨题、单选自动前进后旧选择不能覆盖原题。

返工夹具首次使用了错误的 `storeState.drafts` 路径，抛出 TypeError；重读真实 store 后纠正为 `storeState.progress.drafts`，再取得上述实证。该夹具错误不混同产品缺陷。

## 修复设计

- 同步维护 latest progress ref，update/continue/skip/快捷提交读最新 snapshot，不等待 React 下一次渲染。
- 两个 pager 箭头统一进入 `movePage(delta)`：同步验证 busy/current.index/边界，使用最新 current.drafts，拒绝旧回调时不清理错误状态。Continue/Skip/选择也共享 busy/index 防线，旧 index 闭包不能把旧题事件误作用于已翻到的下一题。
- 每个 pending carrier 用 WeakMap 保存同步 busy/error 外部状态，并由 useSyncExternalStore 订阅；锁先于异步调用建立，严格重挂载不会丢失。
- Promise 包裹同步 provider throw，错误可见且保留草稿供重试。
- 原始 store.clear(requestKey) 的隔离保护保留；旧成功/失败都不能修改新卡。每个新 pending carrier 独立锁，WeakMap 不形成永久强引用。
- 不增加 touchend/label 代理点击，不改变提交 JSON。保留浏览器原生滚动取消 click 的行为。
- 多选也呈现选中行；只对该组件在 coarse pointer 下设置选项最小 48px、图标按钮 44px、页脚动作按钮最小 44px、页脚换行和原生 manipulation。Skip/Continue/Submit 真实 computed layout 均有断言。CSS 改进不是根因诊断。

同 carrier 的普通 rerender、流式文本更新和 strict remount 草稿保留已测。**重连若创建新的 PendingQuestion/key，当前隔离契约会建立新草稿；不得按相同问题 id 偷合并旧卡选择**。跨传输的新请求关联/重放策略不在本候选中实现。

## 验证命令与结果

```powershell
node --check scripts/deep-audit-question-card-patch.mjs
node --check tests/deep-audit-question-card.test.cjs
node --test tests/deep-audit-question-card.test.cjs
```

最终返工运行：3 个顶层 tests 全通过，0 failure / 0 skip，约 81.8 秒；Electron 43.2.0 / Chromium 150.0.7871.129。基线与修复组输出每项实际 observed 值，不只成功旗标。

覆盖还包括：原生 CDP 可信 touchStart→touchEnd 单击、装饰方框与文本分别激活、单/多选、原生 touchMove 滚动确实增加 scrollTop 且零 click/零选择、IME composing Enter 不提交、正常 Enter 保留多选与 trim 自定义文本、失败重试原值保留、旧成功不清新卡、旧错误不显示在新卡、同步 provider throw 恢复、完整 Consumer/待答卡/已答结果卡回执链、cancel/abort/显式 skip。

夹具使用 Electron 自有临时 profile、白名单基础环境；阻断 HTTP/HTTPS/WS/WSS，禁止下载 Electron。Electron 缺失应明确失败，不静默 skip。无后台进程残留。

开发过程中如实处理的夹具失败：最初给 QuestionComposer 错误 owner/store props（实际契约是 matched/useStore/actions），补读生产签名后纠正；Java 注入解析首次因 CRLF 边界失败，归一化后通过。它们不是产品根因。helper 的模糊缩进锚点首次被唯一性门控拒绝，改为完整换行锚点；没有绕过门控或写入依赖。

## 安装链交接与快照摘要

API：`await patchQuestionCardRuntime(runtimeRoot)`。目录应是将被正式安装的 runtime root；函数读取其 `node_modules/@deepseek-ai/dsh-client-ui-user-questions/package.json`，只接受精确 name/version，再对 lib/client.js 全文件输入/输出 SHA 门控。导入无副作用；未知输入、未知版本直接拒绝。写入复用既有 `writePatchedRuntimeFile` 的合作锁/独占临时文件/并发源检查；它不承诺任意外部写进程的原子 CAS。

已测隔离目录首次 patch、二次幂等、输入加一个换行拒绝且文件不变、错误版本拒绝、真实依赖文件前后不变。正式安装 hook 及发行产物验收尚需基础/根完成。

| 快照 | SHA-256 |
|---|---|
| 问答 bundle 基线 | `232a66c60ab295db19336fbe37ab3b0c326b38a17c9d1d0cf23371b8b4664df6` |
| 问答 bundle 最终修复输出 | `6f382a535cb182b062365773c57b23579e8195c0096901c1864c0b1ae0079457` |
| ui-tool 结果 bundle | `2371e34f802d8f39ae52389f6d92c45610cd17f5c3273dfbd35b7ce67b7f6fde` |
| ui-renderer bundle | `859d0a187e436d682c71d18f0266d588f923d7e1628157ad73000f99a377d151` |
| Web shell index-Df-65__b.js | `9e845cbbe80482a49831d912b9c02324c5ff1e8c35b9cc5f7009ecbe6e4537c1` |
| MobileUiAdapter.java（只读） | `750f4fdee6487a7af1e9c735b06354077a4149f447978ab34b596c483ebe4ed1` |
| mobile-runtime.js（只读） | `8830194ab1be206936bcd64022af876eef62c14450ceae088f371c3d8addcc63` |
| mobile-compat.css（只读） | `ea7e8cd55492dddbeba4bcd0a472776305552d3e58025de8b4fce36026b81c3d` |
| Web shell index-b24khbeK.css | `9694138b84b0f07c6e1c29f34172b27865d1250a79001ec11ed6a4468bcd5923` |
| Web vendor-BNsW4eBh.css | `9860041e810431da5a6b83e63f883ab8ff4fc49b4af3fc76681b46f778783a9f` |
| 维护 helper | `251b67da1cc2c3846181200a681bb9849927758e0ace48d6eac72b0d773f2fe7` |
| 最终测试文件 | `b42ad3d295fce400a76ed469f5b2b35783b3eeac1d221edb5b322d07c83a82b8` |

这些是本次验证快照，不承诺其它成员后续修改后仍相同。用户真机问题的最终归因仍需有明确证据的 native overlay/连接状态或真实发布产物验证；本次没有为获取这些证据再向用户提问。
