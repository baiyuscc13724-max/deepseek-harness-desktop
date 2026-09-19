# Round 3：正式 AppFrame 嵌入壳白栏与布局补验

## 1. 判定与边界

**正式组件链已安全挂载；用户截图中的持久白栏尚未归因，不能称已修复或验收通过。** 本轮没有修改任何生产 HTML、CSS、布局函数、ResizeObserver、main、旧夹具、历史报告或 coverage master。

本报告针对 1460×930 用户图的三个不同区域：对话约结束于 x820，白列约 x820–1139，另一个右栏约 x1142–1443。用户附件仅只读观察与记录几何，SHA-256 `77ba43e3b9fa171da5f426b7f0804cb4622100691265a4ad573bf2876bfa3299`；没有复制其对话内容。本文所有新 PNG 均为**合成会话数据、实际官方组件**，不是用户截图，也不是截图复刻。

原 round2 的 native browser bounds 修复与本次白列不是同一结论。本轮同样没有复现该持续白列，不将“本夹具未复现”升级为“产品不存在”。实际发现的是：隐藏 Electron 中，官方 AppFrame 子列的 CSS 过渡可能在 2200ms 的首次终点测量仍未完成；提前 capture 与不提前 capture 的结果不同。此现象保留，不能用强制 repaint/CSS 覆盖来掩盖。

## 2. 实际加载了什么

- Electron **43.2.0**、Chromium **150.0.7871.129**；独立隐藏 BrowserWindow，真实 `<webview id="runtimeView">`，真实 right-workspace Shadow DOM。
- 正式 `renderer/index.html` 元素骨架、styles.css、right-workspace.css；完整执行 `right-workspace.js` 和 `right-workspace-integration.js`。自动启动脚本被显式可逆 bootstrap seam 阻止；**没有执行生产 app.js 初始化或完整 main 应用**。
- 完整官方前端 `index-Df-65__b.js` + vendor，使用其真实 React、ReactDOM、Cordis、client-store、primitives；不复制 layout solver。
- 正式安装 API 在每个新 profile 的 `installed-runtime` 中执行并验证 current core conversation：`30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066`。完整模块保留，增加 export-only seam 暴露 presentation 函数，逐次反向替换应恢复原字节 SHA。
- **AppFrame → ConversationRoot → ConversationSessionHeader / ConversationSession / InputBar → ChatView → UserMessageNodeView；DetailsPanel** 均为官方组件真实 DOM。
- AppFrame 使用官方 `createLayoutStore().create()` 和真实 actions；不是重新实现 `computeColumns`。ConversationRoot、ChatView 的宽度发布、滚动、ResizeObserver、rAF、CSS 过渡均保留。
- `SessionInputShell` 为官方实例，业务发送 sink 只拒绝。官方 ui-theme 的 `installThemeStyles` 通过真实 Cordis plugin fiber 管理生命周期；官方 `ThemePresenter` 使用合成 light/14px 与18px快照。最终 35 个官方 style tag 逐项存 SHA；销毁后六个全局主题样式撤回、两个模块静态样式保留。

**仍然是夹具的部分：** 两个合成 session 的快照/hooks、slot 注入映射、空权限响应、左侧 sidebar 文本标签，以及 desktopHarness 传输替身。没有真实左侧会话树、完整 Cordis 插件图、Host/模型/账户、assistant/tool 大会话、用户自定义主题/宽度设置。没有 native WebContentsView；browser 模式仅执行真实 renderer 预留空间，不能检验 native view 白色覆盖层。没有启动实际安装 GUI、生产 Host 或任何替代服务器。

## 3. CSP、安全装配与失败记录

### 3.1 不把测试 CSP 当产品 CSP 验收

`static-bootstrap.json` 在官方前端 SHA `9e845cbbe80482a49831d912b9c02324c5ff1e8c35b9cc5f7009ecbe6e4537c1` 的 offset **35722** 定位到顶层 Cordis config evaluator：`new Function("ctx","expr", ... with(ctx) ... eval(expr))`。它在依赖 bundle 装配阶段即创建，即使本次不执行动态配置。所检查官方 index.html、dsh-web、dsh-host-webserver、dsh-web-app 文件没有找到 CSP 字串；这**不代表已读取实际服务 HTTP headers**，更不证明生产 CSP 配置。

- mount-v3 的自设 strict guest CSP 拒绝该 constructor；原拒绝保留。
- mount-v4 曾只在隔离 guest 加 `unsafe-eval`，未修改产品 CSP；这是失败中间版，不能用于安全验收。
- mount-v5 起采用更窄离线方案：只将该未使用 config evaluator 替换为抛出 `FIXTURE_CONFIG_EXPR_DENIED` 的函数，并做可逆字节核验。最终 **script-src 没有 unsafe-eval**。不向未知配置或输入开放解释能力。
- themed-v6 发现官方模块内嵌 `data:font/woff2` 被自设 `font-src 'self'` 拒绝；themed-v7 起允许 `font-src 'self' data:`。没有外部字体下载；字体数据来自已固定 SHA 的完整官方模块。base/theme 样式延迟安装以及14→18→14px的真实 ThemePresenter变化均有测量，但**没有模拟任意网络字体慢加载**。
- 最终 guest：default none、connect none、object none、script self、style self/unsafe-inline、img self/data、font self/data；outer shell 另为 script none，通过受控 executeJavaScript 注入固定官方字节。该装配差异透明记录，不宣称通过生产脚本/CSP生命周期。

### 3.2 副作用屏障

白名单环境启动 Node，HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP/DSH_HOME 全部指向新 run/profile；每次新 partition。Node network guard、Electron native 拒绝替身、权限 request/check 拒绝、download/window-open/navigation 拒绝均先安装。webview 无 Node、无 preload、contextIsolation 与 sandbox 开启；会话 onBeforeRequest 只允许生成清单内的 file URL。renderer 侧真实网络、敏感端口也先安装拒绝替身。

最终成功 run 的网络/native/非白名单请求/guest敏感端口计数均为0，guest JS错误数组为空；v7/v8的electron.log为空。**final-v10原始electron.log另外有一条Chromium引擎ERROR：`Message 2 rejected by interface blink.mojom.Widget`**。没有guest JS异常或几何断言失败与其对应；本轮未定位该引擎诊断，不把它武断判为无害，也不靠重跑删除。148/148是显式断言通过，不代表stderr完全无诊断。这里是**本次执行未触及真实能力**的证据，不是全产品安全渗透验收。实际 Clipboard、手机、账户、模型、文件业务端口、真实设备、浏览器公网没有被使用。

### 3.3 保留的全过程

| Run | 结果 | 责任边界 |
|---|---|---|
| mount-v1 | 失败 | 新夹具重复HTML占位注释导致反向替换核验失败，非产品错 |
| mount-v2 | 失败 | 首次装载失败，仅有generic Electron错误；不得倒推为已充分诊断 |
| mount-v3 | 失败 | strict测试CSP拒绝官方顶层动态config evaluator，诊断明确 |
| mount-v4 | 失败 | fixture data adapter箭头笔误、DOM selector引号错误；另在运行期间添加history helper造成外层harness漂移门拒绝；全部保留，不验收 |
| mount-v5 | 115/115 | 实际组件链与store通过，但未安装theme全局样式；不能充完整外观 |
| themed-v6 | 失败 | 实际主题/矩阵执行完成，最终使用不存在的Context.dispose失败；内嵌字体CSP拒绝也记录。修为真实plugin fiber.dispose |
| themed-v7 | 132/132 | 完整主题、真实组件、字体字号变化、cleanup与隔离检查 |
| fresh-v8 | 132/132 | themed-v7同字节夹具、新profile独立复跑 |
| passive-v9 | 148/148 | 加入独立5200/10000ms无中间观测控制 |
| final-v10 | 148/148 | passive-v9同字节夹具、新profile最终复跑 |

v1最初仅记录harness SHA，没有当时完整快照；现用v2保存字节与已知唯一改动反推，**3份文件逐一符合v1 inputs原始SHA后**保存于 `recovered-mount-v1`，明确标记 after-fact reconstruction。v2快照在修改前保存；v3及之后每run自动保存harness。失败日志与截图不删除、不改写。

## 4. 几何实测与观察干扰

单位为 CSS px，除注明外外窗物理1460×930、100%。报告以有界终点读数为准，不将名字里的 `stable` 自动当真实稳定证据。`receipt.json` 保存每次 host、shadow iframe、guest viewport、AppFrame、sidebar/center/details、conversation、content、composer/input 的 box、背景、style、命中节点与时间线。

### 4.1 themed-v7 代表性实测

| 场景 | shadow / guest / AppFrame宽 | 左列宽 | center起点+宽 | details起点+宽 |
|---|---:|---:|---:|---:|
| 首次官方CSS/theme延迟后、outer未开栏 | 1460 | 280 | 280+1180 | 1460+0 |
| home | 1140 | 280 | 280+860 | 1140+0 |
| browser基线首次读数 | 820 | 280 | 280+540 | 820+0 |
| passive回home 2200ms | 1140 | 95.21875 | 95.21875+1044.78125 | 1140+0 |
| 上一行已读rect后，再等3000ms | 1140 | 280 | 280+860 | 1140+0 |
| early-rect回home 100ms / 2200ms | 1140 | 56 | 56+1084 | 1140+0 |
| early-capture回home 2200ms | 1140 | 280 | 280+860 | 1140+0 |
| 1460外窗、125% | 848 | 56 | 56+792 | 848+0 |
| 1460外窗、200% | 730 | 56 | 56+674 | 730+0 |
| 900 / 760 / 480外窗 | 900 / 760 / 480 | 56 | 56+844 / 704 / 424 | 同guest末端+0 |
| 1800外窗、详情展开 | 1480 | 280 | 280+840 | 1120+360 |
| 详情DOM按钮关闭 | 1480 | 280 | 280+1200 | 1480+0 |
| session切换自动关闭详情 | 1480 | 280 | 280+1200 | 1480+0 |
| 1460外窗请求详情 | 1140 | 280 | 280+860 | 1140+0 |
| 左栏偏好420 / 264 | 1140 | 420 / 264 | 420+720 / 264+876 | 1140+0 |

缩放时 outer sidebar 的响应式模式也会变化，所以125%下guest848而200%下guest730；不能把物理尺寸与CSS尺寸直接相减。每个测点分别记录outer/guest zoom和真实shadow box。

home 的 conversation边界与center完全相同，延伸到x1140，不停在820；默认content宽680，x366–1046，是center内的居中内容宽度，不是320px空白列。1460下详情按官方预算退让为0；1800下详情确实占360px并可经官方DOM按钮关闭。短两条/长十二条用户消息、blank hero、session改变、字号18再14的容器链均已测。**没有用隐藏详情、负margin、display:none或人工宽度覆盖制造“通过”。**

### 4.2 哪些观察会改变系统

`auditPassive()` 只记录事件、store、inline style属性与节点是否存在；不读rect、computed style、offset/client/scroll宽，不取图。产品自身正常ResizeObserver/rAF/计算样式保持原样。

主对照：同一browser预置→home，分别不提前观测、100ms读rect、100ms capture；2200ms取第一次终点读数，5200ms再次读数。首次终点调用按 **host rect → guest rect** 顺序，它本身可能促成布局；5200ms因已有2200ms观测，**不是纯被动5200ms**。PNG也明确标记capturePage可能促成paint/layout，不将截图当成未干预事实。

因此得到的是有界差异：AppFrame总框与conversation/center始终互相填满，但左列CSS过渡可能仍处中间值；提前capture能改变终点值。未证明这是用户可见窗口的持久问题，更未证明用户白列与此同因。以下独立更长控制避免把第二次测量误当纯被动观察。

### 4.3 最终长窗口重复对照（同字节v9/v10）

每组另行从browser基线切home，之后**完全不执行额外rect读取或capture**，分别等5200ms与10000ms，先保存passive trace/inline style，再进行唯一终点几何读取。

| Run | 2200ms passive左列 | 5200ms独立无中间观测 | 10000ms独立无中间观测 |
|---|---:|---:|---:|
| passive-v9 | 124.78125 | 左列280，center280+860，frame1140 | 左列280，center280+860，frame1140 |
| final-v10 | 56 | 左列280，center280+860，frame1140 | 左列280，center280+860，frame1140 |

两run的early-rect组2200ms左列均56，early-capture组均280。两run更长控制的终点前inline style均已为 `280px minmax(0px, 1fr) 0px`，trace中的真实resize与setNarrow(false)早于终点；没有区间中间的显式rect事件。v9可见resize→setNarrow约1000ms，符合隐藏子页面调度可能延迟的观察，**未进一步隔离出具体Chromium调度根因**。

这支持“本夹具无需提前capture也可在5.2/10秒终点取得正常列宽”，但终点读取仍可能促成最终layout，不能声称读取前每个像素都已绘制；更不能把本结果推广到可见用户compositor或任意无限持续时间。每run148项均通过，检查frame填满guest、conversation填满center、shadow与guest一致及renderer错误为空；这些检查**刻意不等价于2200ms子列过渡完全完成**。最终无生产修复，白带root cause保持开放。

## 5. 源码、历史冻结与统计口径

主源绑定：

| 文件 | SHA-256 |
|---|---|
| electron/main.cjs（只读固定，不执行完整main） | `74ea22e9b158dd34fb244d8dac6f0b91dd5a9e873e1017c8d26e597cbb8d24f9` |
| renderer/right-workspace-integration.js | `bf81102462e8802fbc9520826271886a6822077bd23e4a5bb67665a66a1e2eb8` |
| renderer/app.js（只读固定，不运行自动初始化） | `560354dc1ce1f365473da3068c75f0dec8ff08b46c03fe0a5b9fd1c03d7bdb65` |
| dsh-client-ui-layout/lib/client.js | `3a0243033f1a2c074b20fc7574cea3a338cd49dd0e88c084fc7f889d967ce33e` |
| current正式temp-installed conversation | `30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066` |
| coverage-master.json | `8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794` |

每个run保留 `inputs.json / installation.json / source`，harness快照时间边界如上；成功run另有 `receipt.json`，失败run按到达阶段留下TAP/log/failure.json。它们记录更多文件、包安装顺序、重复安装changed:false、真实加载原始SHA、bootstrap seams与派生文件。styles单独哈希，逐个函数未切片、CSS未改写。

`history.cjs` 新增只读核验：旧v1 **365**项通过显式mapping还原（4个原路径映射到review-rejected-v1保存版本），旧v2 **383**项，baseline historical **638**项；前后完全一致，不把已知v1错误摘要的canonical路径变化伪称新漂移，也不跳过旧失败证据。旧v1 freeze SHA `0a177daaa181f7c7829279113cc1a46d4614ccea507ff474dc55258903918208`；v2 `62f41c0c1c1f863c7cec76c0e9865ede16b28f76578e2f51e1cc86fb66719512`。

本轮115/132/148等是**此夹具测量断言数量**，不是新的用户操作覆盖数，不相加。master实际仍为 `userOperations=115`、`independentlyAccepted=104`、`domainFindingRows=598`；没有“115自动化/104阻塞”的口径，没有回写master。

## 6. 交付与复核

主测试：`tests/deep-audit-round3-appframe.test.cjs`；新增辅助：`tests/fixtures/deep-audit-round3-appframe/{run.ps1,renderer.js,history.cjs,static.cjs}`。历史失败、source/harness副本、截图、receipt与投影摘要在 `.artifacts/deep-audit-round3-appframe/`。

在维护checkout中以**全新**run名执行：

```powershell
pwsh -NoProfile -File tests/fixtures/deep-audit-round3-appframe/run.ps1 -Run independent-review-1
```

最终合成图片：[home 1460×930](../../.artifacts/deep-audit-round3-appframe/final-v10/synthetic-official-appframe-home.png)、[详情展开1800×930](../../.artifacts/deep-audit-round3-appframe/final-v10/synthetic-official-details-open.png)、[长内容1460×930](../../.artifacts/deep-audit-round3-appframe/final-v10/synthetic-official-long-content.png)。已用图像工具只读检查；本任务禁止访问安装GUI，因此没有声称在真实GUI右栏预览验收报告。

`final-freeze.json` 捕获本轮固定证据集合（不含自身与可变新profile缓存，保留正式installed-runtime与生成guest/renderer），并绑定报告/测试/辅助脚本。独立只读核验命令：`node .artifacts/deep-audit-round3-appframe/verify.cjs`。重复验证不会运行Electron、安装API或网络。

已有run目录拒绝覆盖；不需要真实Host、服务端口、安装GUI、公网、账号或手机。不要用该测试去证明完整产品安全/发布验收，也不要凭本报告扩大允许的生产修复范围。

进一步归因若要涉及真实native overlay、完整应用bootstrap、真实主题/会话树或用户窗口compositor，必须由总审先确认新的最小证据范围；本成员没有越界执行。最终结论保持：**已缩小纯AppFrame/center固定缺320px的假设范围，但截图白栏原因仍开放；不提出未经实证的产品修复。**
