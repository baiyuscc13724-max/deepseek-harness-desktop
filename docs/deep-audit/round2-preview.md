# 实际文件预览与 HTML 隔离补验

## 结论与计量

**有限组件证据，保留一个已复现生命周期缺陷；不是整个 USER、运行中 Desktop 或完整产品验收。**

- `final-v4`：真实 Electron **43.2.0** / Chromium **150.0.7871.129**，**35 个具名组件断言 = 34 pass + 1 fail**。
- 外层 Node suite：**1 test / 0 pass / 1 fail / 0 skip / 0 cancelled**，4588.4049ms；这是因组件红断言而失败，不能把 Electron 进程正常退出0写成全绿。
- 明确红项：`HTML-LIFECYCLE close stops active HTML execution`。关闭后 iframe 保留并继续执行定时器。没有修改生产代码，已向总审移交最小修复范围。
- 原生能力调用、Node 网络调用、网络 fallback、导航 guard 拦截均 **0**；4次唯一合成协议请求在进程内从明确本地文件字节返回，没有 socket。
- 当前输入、旧 master 和所列旧证据执行前后 hash 漂移均0。旧统计、coverage、其他成员文件全部保留。

## 实际产品绑定，不是理想模型

维护树 `package.json` 为 **1.0.60**。本次不读取或验证正在运行的1.0.62应用，不启动60131或新的GUI服务。

真实入口链：

1. `renderer/index.html:39–98` 的 sidebar 子树逐字节提取；同文件原 CSP meta 原样保留。
2. `renderer/right-workspace.js`、`right-workspace-integration.js`、`right-workspace.css`、`styles.css` 均逐字节复制到本次 fresh profile，只加载两份实际 renderer JS。
3. `plugins/dsh-desktop-files/lib/index.js` 原字节复制为临时 `.mjs`，直接调用其已存在的正式导出 `previewFile`、`contentPresentation`、`contentHeaders`。8份 fresh合成文件由真实文件系统读取、真实上限与二进制判断产生预览数据。
4. 当前 `package.json:97–108` 正式打包清单包含 `renderer/**/*` 与 `plugins/dsh-desktop-files/**/*`；`index.html:518/520` 为实际脚本入口。此类桌面文件不需要额外patch installer转化。因此本次**没有运行安装API、安装CLI或生成/宣称已安装包**，仅证明当前候选打包输入的组件字节。
5. `runtimeView` 是无能力的合成div，真实 `ipc-message` 监听接收合成context；`desktopHarness` 仅注入延迟可控的文件/可见性/nonce消息端口。没有 official session manager、RPC、账户或真实native端口。

没有复制渲染函数、改变产品函数体或增加export seam；真实原始模块可装载，故未使用VM替代。详细本地路径/sha/原DOM切片在 `final-v4/binding.json`，执行脚本冻结在 `final-v4/harness-snapshot/`。

| 当前源 | SHA-256 |
|---|---|
| renderer/right-workspace.js | `0ad6dac836c1bb169c4a778246c3d748894a50fae46320518ec77f8eb9796a40` |
| renderer/right-workspace-integration.js | `e0f8c6cf400335cf29a0a99e8172a0abf9a05e566afa1435c18d1195cc7c6919` |
| renderer/right-workspace.css | `ca9cf7220f161672dd894a1bbd46eedf588ae499f9b8cb615948195720a1d60b` |
| renderer/styles.css | `091929333dedea6eb0892cc32d24be327b476b1738e40490cfe778dda2fe64c8` |
| renderer/index.html | `1a338ec3017db59fe7f8ae6dc468cc87f77592bb1d61d390309dacad161fafe9` |
| plugins/dsh-desktop-files/lib/index.js | `b9bb0fdff9f057436ba411f769e2728c7517b1e5635aa1b4bcacf8373c5eb65b` |
| Electron缓存可执行文件 | `8593db40c0c6e5e3c4b6b0a225b1dc9a549ecdf10f6cf2010cf5b6ce869ce07f` |

## 已证明的具名路径

全部断言的 observed、expected、pass 位与事件在 `final-v4/receipt.json`。下表是范围汇总，不与35项相加。

| 路径 | 真实观察与边界 |
|---|---|
| REAL-01 / TEXT-01–03 | 实际控制器及文本pre；中文/emoji/metacharacter精确保留，script不生成可执行DOM。Markdown按源码展示，不是富文本渲染。空文件仍有空pre。 |
| TEXT-BOUNDARY | binary.txt、unknown.xyz、1MiB+1文本、5MiB+1 HTML由真实previewFile产生原因，真实DOM显示二进制/系统应用/超限提示。未点击系统打开。 |
| SOURCE-01–04 | frozen link来源；缺失来源在IPC前拒绝。实际Files列表的旧节点在A→B后脱离DOM，延迟触发仍携带A而非当前B，真实openDocument回调正确显示响应。 |
| RACE-01–03 | A旧成功及旧失败不覆盖先完成的B；只改变context也使A回复失效。都是实际DOM和产品代次判断，服务返回由fixture精确调序。 |
| ERROR-01–02 | 注入服务拒绝后真实role=alert；显式重开正常文件后恢复。不是实际服务宕机或自动重试证明。 |
| LIFECYCLE-01 | 请求未完成时关闭，迟到成功不重新打开、不画入旧内容。 |
| MODEL-01–02 | 来源不匹配nonce忽略；cancel后observe返回superseded。没有截图、模型请求或rendered图像质量结论。 |
| A11Y-01–02 | 打开后document.activeElement为带标签关闭按钮；合成Escape触发产品处理，关闭并把焦点归还quick button；isTrusted=false。 |
| HTML-01–06 | 实际sandbox、no-referrer和标题；脚本能运行，opaque origin=null；parent DOM/localStorage抛SecurityError；合成点击更新计数；真实reload重启app并focus iframe。 |
| HTML-03/03b/04/SECURITY | fetch、远端script/image/nested iframe被真实CSP拒绝；表单由sandbox的无allow-forms先拒绝，而不是等待form-action事件。top/popup被sandbox拒绝；`.invalid`自导航有真实attempt消息，随后父页frame-src以ERR_BLOCKED_BY_CSP拒绝，未到测试网络guard。 |
| HTML-LIFECYCLE / LIFECYCLE-02 | **close持续执行为红**；换成文本移除旧iframe后心跳停止；重新加载活跃HTML后destroy移除sidebar并停止心跳。 |

## 红证据：隐藏不等于销毁HTML执行环境

最小相关生产范围：`renderer/right-workspace-integration.js`，`controller.on('close')`（当前878–886行）只增加generation、更新chrome并加hidden，没有清空documentView或撤销iframe。`right-workspace.js` 的关闭控制器本身保留当前pane。建议由总审安排生产owner在统一close失效路径清理主动内容并测试恢复；本成员未自行修改生产。

本次使用同一renderer `performance.now()` 锚点，HTML每60ms发合成心跳，先等待100ms排除已排队单个消息，再观察240ms：

| 时点ms | controller open | iframe仍连接 | 已收心跳 |
|---|---|---|---|
| 1006.100 | true | true | 8 |
| 1006.900，关闭完成 | false | true | 8 |
| 1107.900，关闭后约101ms | false | true | 9 |
| 1349.100，再过约241ms | false | true | 12 |

关闭后新增4个消息，后段仍增3个，非单个排队回执；换文本后在后续200ms没有新增。该缺陷影响“关闭应停止主动内容”的生命周期验收，不等同于网络逃逸、真实用户数据泄漏或恶意系统操作。隐藏Electron窗口且backgroundThrottling=false用于稳定观察，不据此推导生产CPU/音频功耗。

## 隔离与负面执行

- PowerShell沿用只读剪贴板runner的 `ProcessStartInfo.Environment.Clear()`；仅固定SystemRoot/WINDIR/PATH及全新HOME/USERPROFILE/APPDATA/LOCALAPPDATA/DSH_HOME/TEMP/TMP进入Node。Electron子进程再次白名单。没有真实用户token/config/session环境。
- Node在加载服务前拒绝net/tls/http/https/http2/dgram/dns/fetch/WebSocket。Electron入口也封死子进程创建；缓存Electron是外层runner唯一显式启动进程。未下载依赖。
- Electron clipboard、shell、desktopCapturer、net与WebContents编辑/下载/打印/capture先替换为抛错端口，再加载组件。全部permission拒绝；window-open、will-navigate、will-frame-navigate与will-download配置fail-closed。
- renderer加载产品前封禁execCommand、navigator.clipboard、fetch、XHR、WebSocket、EventSource、sendBeacon、window.open。HTML子frame依靠实际sandbox及真实服务CSP执行负例，不假装其CSP来自测试重写。
- 唯一 `http://127.0.0.1:9/preview-fixture` 是合成资源标识，在专属session的 `protocol.handle` 中**连接前**从明确fresh本地HTML字节及正式contentHeaders返回；无HTTP server/socket。webRequest允许精确5条本地file URL和该唯一in-process标识，其余全拒。无一般localhost白名单。
- HTML攻击目标仅 `fetch.invalid`、`script.invalid`、`image.invalid`、`frame.invalid`、`form.invalid`、`top.invalid`、`popup.invalid`、`self-navigation.invalid`。真实CSP/sandbox在到达guard之前拒绝，所以guard fallthrough为0。没有访问任何真实地址、60131、原生剪贴板/应用或真实会话。
- 这不是OS级syscall隔离或抓包证据。精确注册protocol路径、renderer端口和CSP实跑是证据边界。

## 既有ID与未验边界

`summary.json.coverage` 在本scope中记录3个USER既有ID、关联domain行和五维局部证据，不回填master：

| USER | 关联旧ID | 本次范围 |
|---|---|---|
| USER-01a3c4e3ad85 | PLUGIN-TOOL-OR-CONFIG-dfd6f84f79e2；preview-fetch-source-snapshot、preview-model-receipt、preview-load-switch-close | 真实组件来源/代次/nonce局部 |
| USER-394498c58518 | SOURCE-MODULE-5eda90fb9479；preview-text-short-read、preview-too-large-binary、preview-load-switch-close | 真实文件数据到pre与提示；仍非整域通过 |
| USER-815f7e7b046f | SOURCE-MODULE-5eda90fb9479；preview-html-sandbox、preview-load-switch-close | 真iframe/CSP局部，close明确红 |

后两个USER原master挂在compaction占位模块，不是实际预览入口；本次已明确补绑真实renderer/service，保留旧链接和旧状态，不冒充改正master。

未验：实际安装/发布版运行；真会话Host身份鉴权与IPC wire；完整模型图像/crop/视觉质量；图片、音视频、PDF解码；脚本worker/wasm/指针锁/全屏的完整矩阵；真实键盘/IME/鼠标/读屏；375px/主题对比度；异OS。没有将相同脚本多次执行相加成覆盖率。

控制台另保留父页CSP IPv6字面`http://[::1]:*`被Chromium忽略的警告；未实跑IPv6路径，列为后续限制而非扩大本轮修复scope。

## 运行历史、派生与复跑

| run / job | 结果与解释 |
|---|---|
| probe-v1 / pwsh-149 | fixture的executeJavaScript尾表达式返回函数不能clone，尚无组件断言；修复仅在私有setup末尾加void0。 |
| probe-v2 / pwsh-150 | 31项中29过、close红；另误期待form-action事件。保留原日志，不把测试观察层失配当产品缺陷。 |
| current-v3 / pwsh-151 | 35项中33过、close红；console事件使用旧参数形状，form检查不可得。自导航已改成等加载后真实发起并有attempt消息。 |
| final-v4 / pwsh-152 | **35项34过、仅close红**。现代console事件字段证实sandbox提前禁表单。Electron正常退出0，Node wrapper保留红exit1。 |

四个后台job均已完成并收齐；没有遗留运行job或Electron窗体。证据目录保留fresh合成profile以复核输入，不是用户profile。

`derivation.json` 保存原/新runner与deny-network的完整before/after/hash；runner仅4个声明替换，规范化换行后逐字节相等。网络deny集合未放宽。新增协议映射和native/CSP guard均只在本scope。

维护树中新PowerShell用**未存在**Run名执行：

```powershell
& ./tests/fixtures/deep-audit-preview-components/run.ps1 -Run independent-v5
```

当前产品未修复时预期外层exit1。不要覆盖 `final-v4` 或修改expected求绿；修复后重新绑定当前输入hash，并独立重跑相同断言。

## 交付与证据hash

- `tests/deep-audit-preview-components.test.cjs`：真实Electron组件测试。
- `tests/fixtures/deep-audit-preview-components/`：独立安全runner、端口、HTML负例与汇总验证器。
- `.artifacts/deep-audit-round2-preview/final-v4/`：原始日志、进程、组件回执、输入/执行副本与脚本快照。
- `.artifacts/deep-audit-round2-preview/summary.json`、`derivation.json`、`evidence-freeze.json`：机器可读结论、派生、冻结。

| 文件 | SHA-256 |
|---|---|
| final-v4/receipt.json | `0b1a793299f70f09a59ed0e088d28e3e7c1e781e633d73799bd303b917887e85` |
| final-v4/binding.json | `d5f409339928b3889a4ebc0425a8c4a3717f671c3c8bccec0d4dacd4aee600fc` |
| final-v4/input-manifest.json | `1fb26d5baa8ec76e8ea047015a67ee83baadd86348cf7a797b3cb0e02bd78fb3` |
| summary.json | `af0bb0c3e2ef8b1ae2b16ac066f336bd834cf083d73cef2fd8c5cbd912b9d9d4` |
| 旧coverage-master.json，未改 | `8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794` |

报告仅作Markdown结构与数据复核。任务禁止操作现行GUI，故没有打开右栏预览，也没有宣称视觉排版人工验收。
