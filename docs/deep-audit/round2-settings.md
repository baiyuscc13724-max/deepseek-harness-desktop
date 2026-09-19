# 实际设置表单与模态交互补验

## 结论

本轮是**维护树真实 renderer 的隔离 DOM 补验和红证据交付，不是设置功能全通过或生产修复**。没有修改生产、旧测试、旧报告、master/round1 coverage、安装产物或正在运行的 GUI。

最终 `author-final-v2`：Windows 缓存 Electron **43.2.0 / Chromium 150.0.7871.129**，1 个 Node 测试，47 项内部期望检查，**39 符合、8 不符**，0 skip/cancel，约14.07秒。Node 断言保留全部不符项，故 **exit 1**；不能把 Electron 完成取证的 exit 0 当作产品通过。8 项不是8个独立用户要求，也不是8个均已确认的生产缺陷：其中 input-only 预览关闭回退属于契约待核。执行入口、TAP、逐项 observed/expected 和完整请求顺序均保留。

- 测试：`tests/deep-audit-settings-components.test.cjs`
- Fixture：`tests/fixtures/deep-audit-settings-components/{run.ps1,deny-network.cjs,renderer.js,checks.js}`
- 最终证据：`.artifacts/deep-audit-round2-settings/author-final-v2/{inputs.json,receipt.json,result.json,node.tap,electron.log}`
- 最终 receipt SHA-256：`8e336356ee7680d6429024d27139eb6b45d8712c1826035d565b5d1ea63dc0ee`

## 实际执行层和受控装载差异

**真实执行：**完整 `renderer/index.html` 的产品表单/模态 markup、原始 `styles.css` / `right-workspace.css`，原始 `app.js` 的监听、渲染、保存回调、`theme-integration.js` 的 picker generation、`modal-focus.js` 的 MutationObserver/Tab/focus，以及原始12项 `theme-catalog.js`。不是复制一份理想表单，也没有只提取 VM 算法求绿。

装载采用真实 Chromium DOM，生产文件只读；receipt.seams 保留每一处 before/after，逆序撤销后逐字节等于源文件：

1. HTML 中14个自动 script 标签逐个替为独有注释，避免应用/原生子系统自动启动。之后只显式执行 modal-focus/theme-catalog/theme-integration/app。
2. HTML CSP 收紧为无网络、无 frame、无 script 自动装载；允许精确本地样式和图标。xterm CSS 改为临时目录内同字节副本。产品设置 markup 不改。
3. 唯一 `<webview id="runtimeView" partition="persist:harness">` 换为 inert div，`webviewTag=false`；其 `getURL()` 合成返回空，生产 `themeIntegration.publish()` 走真实 early-return，不执行 guest JavaScript。**官方 guest 设置页及父设置关闭链未验。**
4. app 尾部唯一 CRLF 分隔的 `playStartupAnimation()` / `startOfficialWorkspace().catch(...)` 替为私有 `audit` export。export 只暴露真实 open/close、合成初始状态 seed 和只读 snapshot；不改变任一事件、保存、focus或渲染算法。每次场景 reset 只在所有合成请求已settled后使用 seed。
5. executeJavaScript 对 fixture/app 末尾加 `;void 0;`，仅避免函数对象跨进程结果克隆错误；不修改逻辑。原始 app 副本和 HTML 副本保留在 fresh profile 中，其hash在receipt.outputs。

**合成边界：**`desktopHarness.setTheme/saveCustomTheme/setUiPreferences/chooseThemeBackground` 是可手动迟延/拒绝的 Promise 数据端口；其余bridge全部拒绝。订阅只登记回调、不发真实消息。设置存储是内存对象，回复时按相应请求载荷更新内存；这是受控“异步完成/回执可逆序”的边界，不证明主进程真实磁盘提交顺序或IPC一定会逆序。catalog图像assets以空合成映射准备，不读真实壁纸/字体资源。

驱动 click、keydown、显式 input/change 为程序化事件，不等同物理键盘/真实IME。Chromium 在两次 checkbox `.click()` 后自行生成4个 `isTrusted=true` input/change（减少动效和低性能各2个）；完整trace明确记录，**不冒充原生用户输入**。所有 driver click/keydown 均 `isTrusted=false`。

## 固定输入及防漂移

以下完整SHA在执行前后校验，不凭字符串anchor猜测输入版本：

| 输入 | SHA-256 |
|---|---|
| renderer/app.js | `3086aae0818e127ee12ac4db989ab9ed0760c68efbcb67eb3943de069e2064fa` |
| renderer/index.html | `1a338ec3017db59fe7f8ae6dc468cc87f77592bb1d61d390309dacad161fafe9` |
| renderer/styles.css | `091929333dedea6eb0892cc32d24be327b476b1738e40490cfe778dda2fe64c8` |
| renderer/right-workspace.css | `ca9cf7220f161672dd894a1bbd46eedf588ae499f9b8cb615948195720a1d60b` |
| renderer/modal-focus.js | `1d85ed57f85d9d508af10edef70a5cb5ee6dfb4d92ff2413cb064e30a9f481cd` |
| renderer/theme-catalog.js | `23f1ad41624790be5d4425e97923dfdff8f8454c1eef6d2d57ad0692827670ff` |
| renderer/theme-integration.js | `002e541379cb6d4d0d2eec5cbde03123e860f832c5222aff5e85b830a3cad340` |
| renderer/assets/deepseek-icon.svg | `8489214b4e427b511073ebfbd0b68276b3f56ee9325abc8a5c18215344506f5c` |
| node_modules/@xterm/xterm/css/xterm.css | `854a7c0fb70e8b1a083c16797ab827299fb18744f5ad34f227b48337e33293c6` |
| node_modules/electron/dist/electron.exe | `8593db40c0c6e5e3c4b6b0a225b1dc9a549ecdf10f6cf2010cf5b6ce869ce07f` |

另固定旧 master `8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794`、interaction `8114d11e4b707c8c41b4403cf152c923ba237ec38d6feb95d27741efdfad3388`、只读 clipboard test `5516d18bee7972be4921a86b3a84f21861eb2c4bd00958f50b496a13cfdda78c`。本轮测试和4份fixture自hash、前后对比均在 inputs/result；最终 `drift=0`。没有运行clipboard测试或其安装流程。

## 红证据与修复范围请求

下列检查名为 receipt.checks 的精确名称；红断言均保留。

| 候选/状态 | 可重现实际结果 | 生产定位及边界 |
|---|---|---|
| `pending save supplies disabled or busy feedback` | custom save Promise未决时按钮 disabled=false，aria-busy不为true | app.js:3507–3512；可见待定反馈缺失 |
| `same pending save is deduplicated` | 同步两次实际button.click，产生2条saveCustomTheme请求，而非1条 | app.js:3507–3512；没有同轮去重；非重复扣费/真实磁盘损坏证明 |
| `custom save failure has visible inline error` | Promise拒绝后弹窗仍开，但没有可见错误；unhandledrejection记录synthetic settings write failure | app.js:3507–3512；重试成功，但失败反馈缺失 |
| `theme rejection remains open and visible feedback` | 主题保存拒绝后仍开、无可见错误；keypress apply catch吞掉错误 | app.js:566–580；再次选择可成功 |
| `old theme receipt after close reopen does not mutate reopened appearance` | 旧deep-ocean成功在关闭重开后把新界面由official改为deep-ocean；焦点仍在skinCustomAccent且弹窗仍开 | app.js:568–569先写状态，theme-integration.js:1074–1086后做generation检查；**旧焦点修复通过，不推翻其原有范围**；关闭是否取消已提交保存需契约确认 |
| `A then B reversed replies keep latest chosen theme` | A=deep-ocean、B=porcelain-mist；B先成功、A后成功，最终显示A | app.js:566–569；合成异步逆序状态覆盖，不声称真实存储已证明逆序 |
| `different range fields reversed replies retain newest blur` | brightness=100提交（blur=2），再blur=8提交；第二条先成功、第一条后成功，真实blur控件退回2 | app.js:3488–3505；两个真实字段及payload均记录 |
| `cancel preview restores persisted settings rather than silently retaining draft` **契约review** | 仅派发brightness input=110、不派change；关闭重开保留110，而合成持久值82 | app.js:3475–3485 / 687–690；真实range交互通常随后派change并自动保存，不能把此合成input-only场景直接当“取消按钮损坏”；界面只有关闭，不是明确事务取消 |

已在发现后向总审请求：如继续修复，最小候选生产scope为 `renderer/app.js` 的保存序号/去重/反馈/preview生命周期；仅若需要共享picker状态接口才另审 `renderer/theme-integration.js`。**本任务未获生产写入scope，也没有自行改源。** 建议优先核实失败可见提示与重复提交，再区分“丢弃旧回执”与“服务层串行持久化”的契约，不用renderer假状态掩盖真实存储问题。

## 已增加的有限正面证据

- 实际dialog角色、aria-modal、标题关联及打开时close按钮焦点；真实tabs选中与pane隐藏状态。
- 12项真实catalog全部逐项键盘选择、更新root data-shell-theme、关闭picker；4个实际UI模式逐项更新选中状态且不改主题。**只是状态/CSS变量路径，不是12套视觉、字体、明暗系统矩阵全验。**
- 自定义明暗/配色实际payload、成功后color-scheme/light、关闭与trigger恢复；未保存palette关闭重开丢弃DOM draft。
- range实时预览、真实输出数字、无写端口；change失败显示可见role=status，之后重试保存成功。
- 仅合成chooser取消/异常：无新壁纸时保持picker与“没有导入新壁纸”，异常显示“导入失败”；没有任何原生文件选择器或导入。
- 旧成功/失败在关闭重开后不关闭picker或抢焦点；10次重开始终一个可见modal和close按钮初始焦点。
- Escape composition/repeat/keyCode229/defaultPrevented被拒绝，普通Escape关闭并恢复；主题Enter composition/repeat不调用save。
- 实际Tab首尾双向环绕，动态disabled、CSS visibility隐藏与inert剔除、修复焦点。合成Tab只证明生产边界接管，不等同完整浏览器原生Tab顺序。
- `setZoomFactor(2)`下真实布局：viewport 632×417，dialog bounds=(28,48,604,389.5)，scrollWidth=clientWidth=574，未横向溢出且在viewport内。对话框自身overflow=hidden，内部pane使用产品overflow；**未断言每个离屏控件的可视滚动/阅读顺序，也未把bounds结果叫WCAG全通过。**

## 既有 ID 的五维增量映射

原598域、115 USER、104有限接受、历史2929/2889pass/7fail/33skip均保持不变。本表只做局部证据关联，不改变旧行状态。

| 既有USER / DOMAIN | normal | error-recovery | concurrency-switch | isolation | a11y |
|---|---|---|---|---|---|
| `USER-36be79d18ec4`；`DOMAIN-interaction-skin-picker-race`、`DOMAIN-interaction-theme-visual-all` | 12主题/4模式及自定义payload/成功应用有限通过；全视觉未知 | range可见提示和重试通过；custom/主题提示红证据 | 旧回执不抢焦点通过，旧状态覆盖/逆序主题与字段红证据 | fresh profile、合成bridge、无真实theme配置；0受禁端口调用 | 主题IME/repeat及控件标记有限证据；全对比度/读屏未知 |
| `USER-dabcc40bc9f5`；`DOMAIN-interaction-focus-candidates`、`DOMAIN-interaction-focus-boundary`、`DOMAIN-interaction-focus-hidden`、`DOMAIN-interaction-escape-modal` | 真实产品modal打开关闭和标题有限通过 | 动态隐藏/disabled/inert焦点修复通过 | 10次重开和旧成功/失败不抢焦点通过；官方父设置链未知 | 仅一个inert guest，未操作当前GUI或真实窗口控制 | 双向Tab边界/恢复/Escape合成分支及200% bounds有限通过；真实IME、完整可视Tab、读屏未知 |
| `USER-9db0f88b0fdc`；`DOMAIN-interaction-wallpaper-dialog-all` | 只增量关联空库/合成chooser取消 | 合成chooser拒绝可见提示通过 | 导入/切换/删除/codec/GPU未验；range逆序红证据关联外观参数 | 无原生选文件、读图片视频或修改壁纸库 | 禁用按钮/role=status有限证据；原生dialog未知 |

`DOMAIN-interaction-theme-font-persist` 和 `DOMAIN-interaction-wallpaper-video-native` 没有新增通过证据。interaction.md:76–85的其他明确缺口保持，不推断OS/跨应用/托盘/宠物/Steam通过。

## 安全隔离与复跑

```powershell
# 在维护树执行；Run必须从未存在。
& ./tests/fixtures/deep-audit-settings-components/run.ps1 -Run independent-settings-v1
```

预期现行已pin输入会完成47项取证并**exit 1保留8条红期望**；先检查result/receipt确认完成，若出现failure.json或输入drift，应按harness失败处理，不更新pin或盲重试。不要直接继承用户环境执行node --test，不使用npm/npx、不下载/安装/构建/发布，不打开60131。

1. PowerShell ProcessStartInfo.Environment.Clear()，最小OS目录和fresh HOME/USERPROFILE/APPDATA/LOCALAPPDATA/DSH_HOME/TEMP/TMP；Node再给Electron精确白名单，不传用户profiles/token/代理或服务端口。
2. require产品之前安装Node net/tls/http/https/http2/dgram/dns/global-fetch/WebSocket拒绝；Electron clipboard、shell、dialog、desktopCapturer、globalShortcut、net端口先封死。
3. hidden新BrowserWindow，nodeIntegration=false/contextIsolation=true/sandbox=true/webviewTag=false；复制/粘贴/inputEvent/native window show/focus/move等受禁。只用专属窗口的executeJavaScript运行固定fixture，以及setZoomFactor做本地缩放；没有控制现有GUI。
4. 装载无script HTML之前装好专属session exact-fileURL allowlist（fixture HTML、2份CSS、xterm CSS、图标5份）；其余网络/file URL全部cancel，download/navigation/new-window/permissions/webview拒绝。CSP额外无connect/frame/script；background-network/update/sync关闭、resolver NOTFOUND。
5. 执行产品前封死renderer clipboard、execCommand、fetch/XHR/WebSocket/EventSource/sendBeacon/open/window控制/alert/confirm，bridge只开放4种合成数据端口与10种只登记订阅。
6. 最终nativeAttempts/nodeNetworkAttempts/renderer portAttempts/blockedRequests全空。此为通道封堵与零调用证据，不是OS全进程网络抓包证明。

报告按documents技能做文本结构复核；任务明确禁止当前GUI和网络，因此不以右栏预览突破隔离要求。ui-ux-pro-max定向`keyboard focus modal --domain ux`命中可见焦点与不被遮挡AA/AAA区别，本轮只采纳可观测DOM边界，不宣称WCAG认证。

## 保留的运行历史

- `author-v1`：fixture最后表达式返回函数，executeJavaScript结果不能clone；取证装载失败，不是产品缺陷。
- `author-v2`：bootstrap seam误用LF而真实app为CRLF，精确anchor gate拒绝；未修改生产或放宽gate。
- `author-v3`：40检查，32符合/8期望不符，首批真实红证据。
- `author-final-v1`：扩展47检查，38符合/9不符；第9项是harness误认为checkbox.click后全部input/change也应isTrusted=false。trace证明这4条为Chromium原生生成的checkbox后续事件，不是OS输入；更正该provenance断言，不改任一产品失败预期。
- **`author-final-v2`**：47检查，39符合/8不符；完整trace和hash、防漂移最终候选。所有进程前台结束，无后台job待收集。

交付完成仅表示补验证据可供独立复核，不是成员自批准或总体验收通过。
