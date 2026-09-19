# 浏览器与桌面控制深审

## 范围与可信度

仅维护 checkout 源码、合成 DOM、VM/native adapter doubles、隔离临时 Electron profile；不操作用户真实账号、不改当前运行实例、不伪造 Host 授权、不扩大真实高风险/Stop/权限边界。main/preload 归交互成员；文件预览服务归会话成员；旧结构测试归验证成员。未覆盖项必须与通过项分开，不将旧审计或静态 regex 当行为证据。

## 基线（2026-09-12，编辑前）

工作目录由 pwd 确认。已读取仓库 AGENTS、ui-ux-pro-max。UX 查询 `navigation back error recovery --domain ux` 返回 Back Button（Mobile，仅参考可预测返回原则）、Error Recovery（All，明确下一步）、Error Messages（All，role=alert）。

已有工作区脏改完整保留，不 stage/commit/reset；本域编辑前 git diff --stat 为 8 文件、484 insertions/101 deletions，包含前批API、loopback server、UIA、插件、sidebar修改。浏览器 control server 含别域 workspace lane，不修改。

| 文件 | 编辑前 SHA-256 |
|---|---|
| electron/bridge/browser-codex-api.cjs | 345D5CB4D6325EB3E13DB63E3812797A86E70E830EE996C3187F554937CBC643 |
| electron/bridge/windows-desktop-ui.cjs | 09F5BF8B15E3C3C6E821F01698541EA1B5FF1FB78D34DB77A75E0EF373C4C564 |
| renderer/browser-sidebar.js | 201D2BEE0AE3AF21552631F2B42175E0A5DA56FAA75EEAD3A0086491BB453C89 |
| electron/bridge/browser-control-server.cjs | 5F8F8833DE59018D1BF716ADB508B2A365E0E6464240936892322ACD08EC6F46 |
| electron/bridge/browser-history-store.cjs | 4D382486020A0D0A489E66E203430C2D9F1E72544E7A647A3E626E61BEF402DF |
| electron/bridge/computer-use-coordinate-space.cjs | F987C12A9FD842DA22DEF56E1999CB0D411F6B79A171ADACC450635D6A0FBFBE |
| electron/bridge/windows-computer-use.cjs | 473D24547C4AE33DF0EBF85434A25211657D592D5756A4C12F09802E4A3FE596 |

## 从入口列出的微功能清单

### 用户浏览器侧栏

1. 快捷入口、Ctrl+Shift+B、关闭/再次打开、与右工作区模式同步。
2. URL/搜索提交、空输入、IME Enter、重复Enter、加载中编辑草稿、Escape恢复当前URL、Ctrl/Cmd+L。
3. 标签新建/关闭/末标签、切换、前后方向键/Home/End/Enter/Delete、关闭按钮、标题更新焦点保留。
4. 返回/前进、无历史禁用、刷新/失败重试、加载取消（不同于模型Stop）、迟到回执隔离。
5. 宽屏、拖拽宽度、键盘宽度、pointercancel/lostcapture、窄屏地址栏边界。
6. 历史打开/搜索/空结果/删除/清空确认/搜索竞态；目前仅存origin，不保留标题、路径、query。
7. 下载进度/完成/中断/取消/空列表；文件预览/系统打开属其他成员服务。
8. Profile打开/关闭、登录状态、站点清理确认、全部清理确认、reset中禁用。
9. 网页选择/复制/剪切/粘贴/撤销/重做/全选、链接菜单、用户缩放；main-owned接口单独交接。
10. 授权卡会话/永久/拒绝/关闭/Escape、后台重聚焦防误授、busy、失败反馈。

### 浏览器模型入口

11. status冷启动/blank/background/authorization-required/stopped/crashed，不借status自启。
12. observe结构化ref、inspect、extract text/links/tables、隐藏/敏感内容、节点上限。
13. ref click/type/contenteditable/select/hover/scroll/keypress；disabled/readonly、丢ref、跨tab/navigation/observation失效。
14. playwright全部14个固定操作，CSS/role/text/same-origin frame定位；参数缺失/空值、严格模式、遮挡、disabled/inert、field重绑定。
15. screenshot与mediaInfo/mediaFrame：时间点、字幕元数据、遮罩、空/保护画面、DPR/scroll、stop期间结果失效。
16. navigate/back/forward/reload/tabOpen/tabList/tabSwitch/tabClose、外来源/私网/协议边界、后台恢复。
17. upload确认/取消/本地选择/尺寸/节点替换/跨tab；download确认/限额/同源/重定向/中止；禁止静默提交。
18. dialog接受/拒绝/文本/确认过期/跨tab隔离；console/network脱敏与容量。
19. loopback认证/token重启失效、固定scope/action、请求去重/冲突、Stop插队、超时/unknown outcome不重放。

### 桌面模型入口

20. status/targets/selectTarget、窗口/虚拟桌面、有界UIA树、inspect代际。
21. ref click Invoke/Selection/Toggle及视觉fallback；ref type聚焦后输入；ref scroll聚焦与中心坐标。
22. screenshot frame坐标→原图→虚拟桌面负origin/窗口global bounds，缩放与多显示器。
23. disabled/sensitive/browser-preferred、过期runtime/ref、目标消失/切换、并发observe/select。
24. 授权请求复用、Stop、代际变化、abort、原生超时/错误、失败后可重新observe，不重放。
25. native adapter窗口枚举/截图/键鼠/能力降级仅fake adapter验证；真实多显示器、系统UIA/剪贴板/受保护桌面不在隔离测试可证明范围。

## 结果与证据等级

**结论：源码修复及隔离行为审计已交付；不是“所有功能实机全通过”。** `coverage-browser-control.json` 将上述25组拆为160个具名微功能状态：101项具有限定行为证据、40项仅源码审阅、7项部分验证、8项跨成员交接、4项未验证。另有全部14个受限 Playwright operation 的逐操作证据。正常、负面、并发、跨目标四个维度分别列出；空数组明确表示无本次证据，不表示“不适用”或通过。各组粒度不等，这些数量不是质量评分或独立用户需求数。

| 证据 | 执行及结果 | 能证明什么 |
|---|---|---|
| E1 / pwsh-64 | 新专属fixture + API/sidebar/UIA旧回归，51/51；其中新 Electron 生产DOM 14组全通过 | Electron 43.2.0 的真实DOM、受信任CDP点击/输入；侧栏生产JS + 合成Host回执；UIA协调层/native进程契约double |
| E2 / pwsh-54 | 15个纯域/adapter测试文件，122项：121通过、1跳过、0失败 | 策略、历史、诊断、坐标、假native adapter、截图存储；该命令未启用Electron，且早于最终sidebar/输入计划编辑 |
| E3 / pwsh-66 | loopback/recovery/stream/plugin等9文件，77/77 | 临时真实回环、假handler/native、选取main生产函数VM、插件回执；部分旧integration仍只是源码契约 |
| E4 | 独立筛选复跑交互域菜单/legacy type/select，8/8 | 生产菜单函数和mutation片段VM；精确接收者、乱序/关闭/禁用flags、输入setter及零副作用；不推导其他19条或真实剪贴板通过 |
| V1 | 四个生产文件和新test的 `node --check`；生产文件 `git diff --check` | 语法及空白检查通过；不能替代行为验证 |

准确复现命令、文件SHA-256与每组证据均在JSON中。命令有重叠，**不能把51+121+77当作唯一测试或功能总数**。旧测试名称中出现“端到端/完整”不改变其实际fixture证据等级。此前组合38项有2项旧mock失配，已通知验证成员；最终E1包含其契约更新，生产focus/selection校验没有降级。

## 本轮实际修复

| 编号 | 缺陷与复现 | 修复及验证 |
|---|---|---|
| B01 | `fill text:''` 和 `selectOption value:''` 被当成缺参数 | 参数层区分明确空字符串与未提供；DOM清空/空选项reset通过 |
| B02 | 隐藏WebContents中Ctrl+A不选中原文本，fill把 `Draft` 插到 `initial` 前后并报unknown | 对精确WebContents调用 `selectAll()`，前后复核绑定/focus，再用CDP `Input.insertText`；冷页测试，无诊断预热 |
| B03 | contenteditable自己的文本参与可访问名/指纹，正常输入后立即判绑定变化 | own-value不作为fallback可访问名；仅输入后的内部verify允许可变文本指纹；预检/prepare仍全指纹 |
| B04 | 嵌套按钮文字同时匹配父子节点，text locator误报strict ambiguity | 归并到唯一语义父按钮/链接，保留父控件submit/download元数据；断言仅目标nested收到一次trusted click |
| B05 | range input隐式role被返回range而非slider | 修为slider，真实role读通过 |
| B06 | `pointer-events:none` 元素连只读role/text定位都不可读 | 只读定位不要求pointer-events；输入动作仍要求可交互 |
| B07 | disabled option/optgroup未在输入前拒绝，尝试键盘选择后才unknown | prepare/verify拒绝禁用项；断言select值不变且零事件 |
| B08 | pressSequentially在中段选区正确写入 `DrXt plus`，但endsWith检查误报unknown | 在隔离绑定内记录精确选区替换计划；最终值精确匹配，不把文本回传模型；中段替换仅一次trusted input |
| D01 | UIA global bounds直接当截图frame像素：窗口实得(650,320)而期望(125,60)，负origin实得(-1770,120)而期望(75,60) | UIA节点标注global-screen-pixels；按窗口左上或虚拟桌面origin及source/frame比例转换，再交provider映射一次 |
| D02 | publicTarget省略hwnd，UIA observe读取undefined并落到整个desktop | 从严格window:id恢复句柄，无效窗口目标拒绝；注入runner断言hwnd=7且无扩张读取 |
| D03 | SetFocus失败被忽略，ref type仍向当前未知焦点输入 | native返回HasKeyboardFocus；协调层没有明确focused:true就拒绝，所有失败分支零keyboard |
| D04 | 实时disabled/password状态未复核，native拒绝回执仍可落到坐标/键盘fallback | PowerShell检查当前IsEnabled/IsPassword；协调层对disabled/sensitive/stale明确失败，不fallback |
| D05 | 浏览器父窗口识别不传子控件，browser_control优先门可被子ref绕开 | browserContext沿UIA祖先传播；before-perform拒绝浏览器子控件 |
| D06 | UI Stop只能挡await后的动作，无法通知仍运行的UIA子进程 | 每个native调用持有AbortController，Stop/caller abort传到runner并kill；pre-abort零spawn、active abort kill一次，假进程invalid JSON受控失败 |
| U01 | 关键确认按钮双击发送两请求；过期确认rejection无人处理 | pending-id Set防重、允许/拒绝同时busy、失败role=alert；只合并确认列表避免覆盖迟到导航状态；DOM双击仅一请求且零unhandled rejection |

本轮改动生产文件仅 `electron/bridge/browser-codex-api.cjs`、`electron/bridge/windows-desktop-ui.cjs`、`electron/bridge/windows-ui-automation-source.cjs`、`renderer/browser-sidebar.js`。新测试仅 `tests/deep-audit-browser-control.test.cjs`。没有修改main/preload、已有测试、运行实例、release产物或其他成员文件。

`windows-ui-automation-source.cjs` 追加编辑前基线SHA-256为 `0D7BC328CCE33D1A2CF948BD45929E6C6F67D09FC4B279E01118A9128E8CA0EA`。最终hash见JSON；验收时可据此发现证据后漂移。

## 隔离方法与失败记录

- 新测试的Electron分支只在 `DSH_DEEP_BROWSER_ELECTRON=1` 时运行，使用仓库缓存Electron；临时userData/APPDATA/LOCALAPPDATA/USERPROFILE及内存partition。子进程环境仅保留操作系统基础变量，不继承Host服务凭证。
- 页面来自内部合成HTTPS protocol或data URL；侧栏加载经过移除script/link/webview的仓库HTML及生产sidebar JS。HTTP(S)外部请求阻断、网页权限拒绝。不接触实际Host endpoint/授权/账号/剪贴板，不发送OS键鼠。
- Playwright真实输入事件断言精确目标、数量、trusted；checkbox/setOption核对结果，禁用选项核对值和全部事件均未变化。侧栏事件是合成DOM事件，Host API为double，不能标成真实Host授权。
- 重用旧Electron fixture时只提取 `sidebarTests`，不运行其upload/capture/main入口，不读取真实应用配置。sidebarTests的真实CSS测试仅覆盖360/1000两种窗口宽度。
- UIA测试执行生产协调层和生产runner代码，但runner的child_process完全替换为EventEmitter假进程；从未启动实际PowerShell UIA或调用原生输入。
- 初始B01–B07共8个DOM分组失败；Ctrl+A/命令变体/焦点模拟的诊断尝试失败，不能作为证据。去除预热后的pwsh-40首次11组全通过；最终E1为14组。桌面5组首跑全失败后修复通过；B08与U01均有修复前失败记录。
- 临时fixture代码本身的structured-clone、history开窗时序、全局const重声明问题已修正，这些不计入产品缺陷。

## 仍需独立验收与交接

1. **main所属代码交接已部分闭环**：总审通知交互保留了菜单、legacy type/select修复后，本成员只读 `interaction.md`、对应新测试和main菜单注册行797–799，并独立筛选复跑8条相关VM用例，8/8。main实测SHA-256为 `4E547CD4FA5A0CFF7B58C84B9D3747129EEC574CE09014C48CA6E0A2BF8B42FC`。可确认精确WebContents的7条编辑命令、公共页不解析本地元数据、菜单迟到/关闭、普通contenteditable/input/textarea、禁用/只读/断连输入与disabled option/optgroup的mutation片段。不能把这些片段或交互整体27pass升级为完整legacy ref流水线、真实菜单/剪贴板或跨tab行为通过；这里也没有把Playwright修复冒充legacy修复。
2. **实际菜单/剪贴板/缩放**、完整observe/inspect/extract、legacy hover/scroll/keypress、真实跨tab/dialog/upload/download/media链路，由main/独立验收补执行证据。本成员对其源码/fixture审阅已记载，不能因已有测试文件存在就标通过。文件预览转会话成员。
3. **原生边界**：真实UIA树、Invoke/Toggle、物理多显示器DPI/旋转/热插拔、受保护桌面不可由fake adapter证明。focus复核与键盘派发之间仍有OS焦点竞争窗口；控件在observe后移动的原生fallback也需实机验收。取消进程不能撤销已送达的原生动作，取消/超时可能unknown，不能自动重放。
4. 侧栏history目前刻意只存origin；不能宣传为能恢复完整路径/标题的历史。Profile清理、授权会话/永久分支只验证UI回执和策略，未删除真实资料或授予实际控制权。
5. 不运行发布/打包、不刷新现有GUI、不启动替代服务器；本报告不作上线、发布、跨平台或产品全验收结论。Markdown/JSON经结构校验，未打开运行GUI中的文档预览。

