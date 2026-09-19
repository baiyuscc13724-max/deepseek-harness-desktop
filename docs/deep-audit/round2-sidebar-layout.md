# 右侧双空栏与原生视图布局：有界诊断

## 结论

- **用户截图的持久白色整列尚未完整复现，根因未确认。** 不能把截图像素、100ms 跨进程读数或本报告的窄窗缺陷替代为截图根因。
- 隔离 Electron 中，浏览器→首页确实出现过外层 webview/内部 shadow iframe 都为 1140px、guest `innerWidth` 暂为 820px 的 **320px 瞬态差异**。但绘制捕获后 guest 为 1140px；无捕获对照在额外等待 1.5s 后也恢复。最终合成窗口截图没有中间白条。
- **已证实的稳定问题：原生浏览器 WebContentsView 与实际右面板 CSS 的横向几何契约不一致。** 窄窗停靠/覆盖断点和 125% 缩放共 5 个失败场景，归为响应式与坐标单位两类问题，而非 5 个独立缺陷。
- 最终 `author-final-v5`：**23 项检查，18 符合、5 失败；Node 1 test 因保留红断言 exit 1**。这是组件级诊断，不是整应用验收通过。生产文件均只读。

## 输入、范围与安全

用户原图：1460×930，SHA-256 `77ba43e3b9fa171da5f426b7f0804cb4622100691265a4ad573bf2876bfa3299`。仅观察对话区、空区、右侧首页三者的几何关系，没有复制、提取或分析私人对话内容，没有修改原图。

维护源：`D:\DeepSeek-Harness-Desktop\release-v1.0.28-worktree`。`pwd` 初始为上级 workspace；已阅读维护树 AGENTS。UI/UX 技能的 targeted UX 查询命中 Container Width/Horizontal Scroll 通用指导，但这不是根因证据，也没有据此用 `display:none`、负 margin 或溢出裁切掩盖问题。

隔离运行：缓存 **Electron 43.2.0 / Chromium 150.0.7871.129 / Node 24.18.0**。创建 show:false 的全新 1460×930 无框窗口、原 webview 和两个真实 WebContentsViews。所有 profile、临时目录、DSH_HOME 均在本次证据目录内。没有访问 60131、当前运行 GUI、用户配置、真实会话/账户、设备、剪贴板、公网；未下载、安装、发布或启动产品服务。

`run.ps1` 使用 `ProcessStartInfo.Environment.Clear()`，仅保留显式系统启动键和 fresh 目录键。Node 网络构造、fetch/WebSocket、Electron net、clipboard/shell/dialog/desktopCapturer/globalShortcut、输入和窗口显示/焦点方法均封堵；session 仅允许 6 个精确 fixture file URL（和原生空页），权限请求拒绝，下载和新窗口拒绝。唯一可附加 webview 的 URL/partition 精确校验，移除真实 preload，保留 nodeIntegration=false/contextIsolation=true/sandbox=true。允许的窗口尺寸变化仅作用于此测试窗口。

最终回执：renderer 错误、renderer/native/Node 禁用端口尝试、非白名单请求均为 **0**；输入前后 drift=0。运行时捕获只来自测试窗口，图中仅有 `LAYOUT FIXTURE ONLY` 与产品侧栏控件。

## 真实与合成的边界

| 层 | 实际执行内容 | 明确未覆盖/替换 |
| --- | --- | --- |
| Shell | 原 `index.html`、完整 styles/right-workspace CSS、完整 right-workspace.js/integration.js | 自动脚本入口移除，只显式加载目标组件；startup/status 改为测试就绪态 |
| 主对话嵌入 | 原 `<webview id="runtimeView">`、真实 Chromium shadow iframe 与独立 guest WebContents | partition/src 改为 fresh 合成页面；没有官方对话 React 树、真实消息或 preload |
| 浏览器原生层 | 原 `effectiveBrowserPanelWidth`、`layoutBrowserView` 函数原文；两个真实 WebContentsViews，产品 backgroundThrottling=false | 不加载 main 全局产品启动；状态对象与命令桥为合成值；无网页导航 |
| 官方栏宽算法 | 原 `clampWidth`/`computeColumns` 原文执行 | 仅纯函数，不声称 AppFrame、插件槽位或全部 bootstrap 已运行 |
| 安全 | 原 CSS/脚本有界载入，精确文件白名单、native/network deny | OS 可见窗口合成器、屏幕截图、真实运行版本均未验证 |

HTML 每项替换都写入 `receipt.json.seams`，反向替换须逐字恢复原始 HTML。原生/官方函数片段原文与 hash 均记录。没有重写理想布局代替实际 Shell，也没有复制产品算法求绿。

## 截图假设与对照结果

### 320px 瞬态 guest 差异（诊断，不计稳定产品红证据）

原图红框约 x820–1139 白区、x1142 起右侧首页；几何上接近浏览器 640px→首页 320px 的差值，但像素相似不证明因果。

最终序列，外窗口 1460×930、100%：

| 观察点 | 外 webview | shadow iframe | guest innerWidth | 首页 x/宽 | native 可见 |
| --- | ---: | ---: | ---: | --- | --- |
| 首页初开 | 1140 | 1140 | 1140 | 1140 / 320 | 否 |
| 浏览器 | 820 | 820 | 820 | 820 / 640（浏览器模式） | 仅活动 tab |
| 浏览器→首页，约100ms探针 | 1140 | 1140 | 820 | 1140 / 320 | 否 |
| 捕获实际测试窗口绘制后 | 1140 | 1140 | 1140 | 1140 / 320 | 否 |
| 再等待1.5s的终点 | 1140 | 1140 | 1140 | 1140 / 320 | 否 |

`synthetic-shell-home.png` 经实际查看为连续合成主区直达 x1140，没有白色中间列，SHA-256 `692cfe37d7936e0b721b8bed1359c2543ec996b596579ab0baaf4510fb3fba17`。

必须保留的测量局限：

1. 先读取 DOM rect 会强制 Shell layout；立即读取另一进程 guest 不保证该 resize 已交付。v1 初探不应被解读为永久冻结。
2. v4/v5 增加 **先 flush→等待100ms→再次读 DOM/guest**，仍可见暂时差异；`capturePage()` 本身促进绘制，因此最终照片不能重建绘制前那一瞬间。
3. v2/v3 无捕获的额外1.5s等待也可恢复。这里只证明在离散采样点已收敛，不能给出精确自动恢复时长。
4. 原 native browser bounds 的 y=158，而图中白列从顶部贯穿；且首页时两 native views 均不可见。因此没有证据把它直接归为仍可见的 native browser 白底。
5. home 在多个窗宽仅预留一次 320px。官方当前 solver 在 viewport=1140/820、sidebar=280/details=320 时 details=0；这排除了该纯函数在这些输入下重复预留，但未排除未运行的官方组件/版本差异。
6. detach native views 与 guest 关闭 background throttling 的实验不能消除所有短时读数延迟；不据此建议生产加 `setBackgroundThrottling(false)`。

没有修改或补丁化截图问题。后续若要定位持久现象，需要在经授权的真实安装版本，或严格复制其运行依赖的可见隔离窗口内，关联一帧的 outer rect、shadow rect、guest viewport/resize 时间戳和真实绘制；本任务不越界获取这些数据。

### 稳定响应式/缩放几何红证据

对每个稳定场景先执行原 native layout，读实际 DOM，再额外等待约1.2s并重复测量。下表是最终实际 `getBounds()` 和 `getBoundingClientRect()`，DIP 用 Shell zoom 因子换算（100% 时等于 CSS px），容许误差 1px。

| 外窗宽 / zoom | CSS 面板换算 DIP x / 宽 | 原 native x / 宽 | 结果 |
| --- | --- | --- | --- |
| 1460 / 100% | 820 / 640 | 820 / 640 | 符合 |
| 1000 / 100% | 560 / 440 | 360 / 640 | 左侵主区200px |
| 901 / 100% | 560 / 341 | 261 / 640 | 左侵主区299px |
| 900 / 100% | 48 / 852 | 260 / 640 | 面板内留下212px空档 |
| 760 / 100% | 48 / 712 | 120 / 640 | 面板内留下72px空档 |
| 1460 / 125% | 700 / 760 | 820 / 640 | 面板内留下120px空档 |

这两个机制有精确源位置：

- `renderer/right-workspace.css:311–325` 在 >900 CSS px 时把工具宽度限制为 `min(preference,100vw-560px)`，同时只让主 webview 预留相同宽度；≤900 的已有覆盖规则改用 `100vw-48px`，而首页独立为320px。
- `electron/main.cjs:466–470,497–511` 只用 BrowserWindow 的 DIP 内容宽与 preference 的360–1400限制计算 panelWidth；不知道 renderer 900px断点、560px主区下限或 CSS zoom。故重复等待不会修复这5项横向错位。
- 此缺陷影响 **浏览器模式**，不能偷换成 1460/100% **首页** 持久白列的根因。

## 最小生产修复范围建议（尚未授权/实施）

| 优先级 | 文件/范围 | 建议与边界 |
| --- | --- | --- |
| 必要核心 | `electron/main.cjs` 的 effectiveBrowserPanelWidth/layoutBrowserView 及相应 resize/zoom 生命周期 | 让 native bounds 与 renderer 的响应式和 zoom 同一契约；保留活动tab/显隐栅栏。当前默认640仅在1460/100%巧合一致。 |
| 契约输入 | `renderer/right-workspace.css` 根变量与 breakpoint 块 | 可以保持 CSS 不变，将现有规则作为验收事实；若抽共享几何策略需显式授权。不得取消合理主区最小宽以掩盖 native 左侵。 |
| 若采用 DOM bounds 报告方案 | `renderer/right-workspace-integration.js`、`electron/preload.cjs`、`electron/main.cjs` 对应新的窄 IPC geometry port | 使用 actual browser content rect、zoom换算和 revision/当前模式校验；main 验证有限数值、窗口内边界、发送者与活动状态。此为设计备选，不是已验证补丁，不默认扩大授权。 |
| 明确不需要为本轮盲改 | `renderer/app.js`、`electron/guest-preload.cjs`、官方 frontend 包 | 截图持久问题没有可证实修复点，不能猜测改主题或隐藏官方 details。 |

与现有生产 owner 协调：`right-workspace-integration.js` 的统一 close 生命周期修复已属于预览作者；`app.js` 主题保存属于设置作者。布局没有抢写两文件。优先由 root 安排 main 几何修复；若后续确定需要 integration geometry 接线，先划分范围/顺序，再修改和复核。

## 执行、产物与冻结

安全复跑（必须换新 Run 名，原目录拒绝覆盖）：

```powershell
pwsh -NoProfile -File tests/fixtures/deep-audit-sidebar-layout/run.ps1 -Run independent-layout-review-01
```

运行前 `pins.json` 对13项精确源/资源/缓存 Electron hash 进行验证，运行后再次验证。若生产后续变化，旧测试应先报 input drift；不要直接改旧证据或静默重置 pins 求绿。后修复验证需要明确新输入绑定。

主产物：

- `tests/deep-audit-sidebar-layout.test.cjs`：真实 shell/guest/native 几何、生命周期、原 solver 检查；保留5红断言。
- `tests/fixtures/deep-audit-sidebar-layout/`：fresh launcher、网络守卫、合成端口、完整输入 pins；`inspect.cjs` 为未执行产品代码的只读静态搜查辅助。
- `.artifacts/deep-audit-round2-sidebar-layout/author-final-v5/`：inputs、receipt、summary、node.tap、electron.log、合成绘制截图与独立 profile。
- `receipt.json` SHA-256：`a81cf241575111a205d19add398c2f644adee18da2b3250db37040f719db2462`。

阶段记录：initial-v1（初探）、controls-v2（长等待/resize/detach）、native-prefs-v3（对齐产品 native backgroundThrottling=false）、flush-controls-v4（先flush+窄窗/zoom）、author-final-v5（固定输入+稳定红断言+实际绘制对照）。前四次是探针，exit0 仅表示采集成功，不是产品全绿；最终 exit1 精确对应上述5项稳定失败。五个作业 pwsh-155/156/157/158/159 均已收齐，无遗留后台任务。

未修改旧 master/覆盖数字、round1/round2 其他作者证据、任何冻结清单或生产源。报告只能增量支持本次截图调查和已证实的浏览器几何问题，不将既有 USER/域 ID 整体标绿。未打开实际 GUI 文档预览（该任务禁止），本文以 read 结构复核；合成布局截图以 read_image 核验。
