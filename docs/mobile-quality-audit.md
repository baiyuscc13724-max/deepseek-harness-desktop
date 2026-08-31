# Android 移动产品工程质量专项审计

> 审计基准：参照成熟苹果平台产品对状态连续性、反馈闭环、可恢复性和辅助技术兼容性的工程要求，但不复制 iOS 视觉或交互外观。  
> 审计对象：`io.harnessdesktop.mobile` 1.0.54，源码工作区 `release-v1.0.28-worktree`。  
> 审计日期：2026-08-30。本文只记录证据、缺口和可验证验收标准，不修改产品实现。

## 1. 范围、方法与环境

### 1.1 覆盖范围

- 首次启动、已配对启动、Home/Recents/返回与前台恢复。
- 加载、空、错误、离线、网络切换和重连。
- 导航可预测性、触控反馈与触控目标。
- 输入焦点、IME、滚动、大字体、横竖屏和动态布局。
- 状态栏、导航栏、刘海/挖孔安全区。
- TalkBack/无障碍树、动态状态播报、Reduce Motion。
- 视觉稳定、错误解释、手动恢复与“忘记此电脑”。

### 1.2 证据方法

1. 静态审计：`MainActivity.java`、`HarnessCaptureActivity.java`、原生布局/主题/Manifest、`mobile-runtime.js`、`mobile-compat.css`。
2. 隔离模拟器：Android 15，1080×2400；另以 200% 字体和 2400×1080 横屏验证动态布局。模拟器无真实账号与配对资料。
3. 已配对实体机只读观察：Android 15，1080×1920；不点击消息、发送、设置或任何未知控件。
4. 运行日志：限定 `io.harnessdesktop.mobile` 进程和 Warning 级别。

### 1.3 严重度

- **P0**：数据/安全灾难、核心流程普遍不可用且无绕行。本轮未发现。
- **P1**：关键流程、恢复或辅助技术明显受阻；应在下一次移动版发布前解决。
- **P2**：一致性、可理解性或边缘场景缺口；应进入近期质量债计划。

## 2. 执行摘要

Android 壳层已经具备成熟产品所需的大部分“隐形工程”：持久配对、稳定回环 origin、网络回调与退避、WebView 前后台不重载、系统 Picker、48dp 原生基准、IME/safe-area 桥、扫码拒权恢复和 Reduce Motion。针对初审发现的 7 项缺口，复验确认产品实现与自动化契约均已补齐；`tests/mobile-quality-audit.test.cjs` 当前 **14/14 通过、0 TODO**。其中 MQA-03 被重新定性为**时序/状态性语义刷新缺陷**：复验覆盖文档加载三个注入时点、DOM 结构变化后的重装饰、无 Dialog 与有 Dialog 两种状态，以及 Dialog 关闭后的焦点返回。

| 严重度 | 初审数量 | 未关闭 | 复验结论 |
| --- | ---: | ---: | --- |
| P0 | 0 | 0 | 未发现发布即阻断级故障 |
| P1 | 5 | 0 | MQA-01～05 已由实现与定向契约关闭 |
| P2 | 2 | 0 | MQA-06～07 已由实现与定向契约关闭 |

## 3. 已满足的质量基线

| 领域 | 证据 | 结论 |
| --- | --- | --- |
| 状态连续性 | `MainActivity.onResume()` 仅恢复 WebView timers 并幂等注入，不调用 `reload()`；`MobileControlBridge` 保存/恢复安全会话引用 | Home/Recents/系统 Picker 返回不会主动丢弃草稿、附件和流式文档 |
| 离线/重连 | 默认网络回调、1.5 秒去抖、LAN/P2P/WSS/EasyTier 路由恢复、800–5000ms 工作台重试 | 网络变化有自动恢复机制，且保留配对身份 |
| 加载反馈 | 全屏连接 overlay、`accessibilityLiveRegion="polite"` 状态、顶部进度条、慢加载提示和连接设置入口 | 初始连接和慢加载不是无反馈黑屏 |
| 空状态 | 移动 runtime 为无项目、无模型提供方、无插件列表和空任务列提供具体文案，不以空白页代替 | 空数据具备解释；其 TalkBack 可达性仍受 MQA-03 约束 |
| 原生触控 | `harness_touch_min=48dp`；主按钮 48/52dp；扫码返回和权限按钮达到 48dp | 原生主要控件满足 Android 触控基准 |
| IME/安全区 | `SOFT_INPUT_ADJUST_RESIZE`、system bar/cutout/IME inset 监听、CSS `safe-area-inset-*`、`visualViewport` | 已建立原生到 Web 的键盘与安全区契约 |
| 权限恢复 | 模拟器拒绝相机后出现“需要相机权限”、重试、系统设置、返回四条可理解路径；标题主动播报 | 扫码权限拒绝可恢复且不形成死路 |
| 视觉稳定 | 启动主题、浅/深色资源、系统栏颜色、稳定 overlay、`prefers-reduced-motion` | 已避免主要闪白和强制动画问题 |
| 忘记/清理 | 二次确认后清配对、Cookie、历史并回到配对页 | 高破坏动作具备确认与明确结果 |

## 4. 问题清单

### MQA-01 · 200% 字体横屏时配对主操作不可达

- **严重度：P1**
- **复验状态：已关闭（实现 + 自动化契约）**
- **复现**
  1. 在 Android 15 模拟器将系统字体缩放设为 200%。
  2. 冷启动未配对 App，旋转为横屏（2400×1080）。
  3. 尝试向下滚动配对页以到达“扫码连接电脑”“使用配对地址连接”。
- **证据**
  - 运行时树只显示品牌、标题和说明；`ScrollView` 标记为 `scrollable=true`，但连续两次向下滚动后截图字节与元素位置均未变化，主操作仍不在可见树中。
  - `activity_main.xml:21-32`：`ScrollView` 内唯一 `LinearLayout` 使用 `android:layout_height="match_parent"`，其大字体子项溢出 viewport，却没有可靠形成可滚动内容高度。
- **影响**：大字体用户在横屏/小高度窗口中无法完成首次配对，属于核心流程阻断。
- **根因候选**：ScrollView 子容器高度错误；`layout_weight` 占位 View 与 `match_parent` 子容器组合使溢出内容未计入 scroll range。
- **建议归属文件**：`mobile/android/app/src/main/res/layout/activity_main.xml`。
- **可验证验收标准**
  - ScrollView 内容容器使用 `wrap_content`，不依赖 0dp weight 占位制造底部对齐。
  - 字体 100%/200%，竖屏和 2400×1080 横屏下，扫码、地址输入、连接按钮、错误和页脚均可通过一次连续滚动到达。
  - 新增 Android UI 测试：滚动后 `connect_button` 可见且高度不小于 48dp。

### MQA-02 · 无效地址提交后错误被 IME 覆盖，用户看不到失败反馈

- **严重度：P1**
- **复验状态：已关闭（实现 + 自动化契约）**
- **复现**
  1. 首次启动，在地址输入框输入 `https://example.com`。
  2. 点击软键盘 Go/Enter。
  3. 保持键盘打开观察页面。
- **证据**
  - 截图 `screenshot-emulator-5556-3.png`：键盘从约 y=1515 开始，连接按钮已被部分遮挡，错误完全不可见。
  - 同帧 UI 树中输入框仍 `focused=true`；错误节点确已生成在 y=1564–1672，恰落在键盘后方。
  - `MainActivity.configureActions()` 直接调用 `connect()`；`showPairingError()` 只设置文本/可见性，没有隐藏 IME、滚动错误进入视口或把焦点移到错误摘要。
- **影响**：用户执行操作却视觉上“无反应”，会重复提交或误认为 App 卡死。
- **根因候选**：错误呈现与焦点/滚动状态分离；IME action 没有完成态策略。
- **建议归属文件**：`MainActivity.java`、`activity_main.xml`。
- **可验证验收标准**
  - 无效提交后错误在 300ms 内进入可见 viewport；可选择隐藏 IME 或使用 `requestRectangleOnScreen()`/平滑滚动。
  - TalkBack 通过 polite live region 只播报一次；输入框保留原值以便修正。
  - 360×640dp、横屏和 200% 字体三种矩阵均能同时定位输入框与错误恢复信息。

### MQA-03 · WebView 语义未随文档时序与 Dialog 状态可靠刷新

- **严重度：P1**
- **复验状态：已关闭（实现 + 自动化契约）**
- **复现**
  1. 在 Android 15 已配对实体机启动 App，分别观察初始加载、`onPageCommitVisible` 与加载完成后的语义树。
  2. 在无 Dialog、打开 Dialog、关闭 Dialog 三种状态下获取未过滤的深层无障碍树并检查焦点。
  3. 触发工作台结构变化与前台可见性恢复，确认语义节点会再次装饰而非只在首次注入生成。
- **证据**
  - 初审实体机树共 8 个节点；叶节点仅为 `io.harnessdesktop.mobile:id/webview`，说明缺陷具有加载时序/状态性，而不是单一静态 ARIA 缺失。
  - `MobileUiAdapter.inject()` 现显式启用 WebView accessibility/focus，并以 0/250/900ms 三次注入覆盖 DOM 尚未就绪的时窗；不完整文档不会被标记 ready。
  - `MainActivity` 在 page started、commit visible、finished 三个阶段刷新；`MutationObserver` 与 visibility change 在后续结构变化/焦点状态变化时重新执行 `mount()`。
  - `decorateAccessibilitySemantics()` 建立 banner/heading/navigation/tree/log/composer/send/stop 语义；`decorateDialogs()` 即使列表为空也调用 `syncDialogFocus([])` 清理旧状态，有 Dialog 时约束 Tab，关闭后把焦点返回仍连接的触发器。
- **影响**：修复前 TalkBack、语音访问和基于语义的自动化会因加载或弹窗状态不同而间歇失去核心工作台；修复后以真实语义而非 OCR 暴露操作面。
- **根因候选**：WebView accessibility 主机未显式参与；注入过早时错误标记 ready；动态 DOM/Dialog 状态变化后缺少幂等语义刷新和焦点恢复。
- **建议归属文件**：`MainActivity.java`、`MobileUiAdapter.java`、`mobile-runtime.js`、`mobile-compat.css`。
- **可验证验收标准**
  - 启用 TalkBack 后，工作台至少暴露顶部导航、当前标题、对话列表、消息区、composer 和发送/停止控件。
  - 初始加载、加载完成和 DOM 结构刷新后均保持稳定 role/label；无 Dialog 不残留旧焦点约束，有 Dialog 时焦点被约束，关闭后回到触发器。
  - 禁止以 OCR 作为无障碍验收替代品。

### MQA-04 · 非退避错误没有错误态，只表现为长时间“仍在加载”

- **严重度：P1**
- **复验状态：已关闭（实现 + 自动化契约）**
- **复现**
  1. 使用有效配对资料进入工作台。
  2. 让主文档返回 HTTP 404/500，或触发 SSL/重定向/不受支持协议等非 retryable WebView 错误。
  3. 观察 overlay 状态和可执行恢复动作。
- **证据**
  - `onReceivedError()` 仅对 CONNECT/HOST_LOOKUP/IO/PROXY_AUTH/TIMEOUT 设置自动重试；其他主帧错误只标记 `mainFrameLoadFailed=true`。
  - `onReceivedHttpError()` 仅处理 502/503/504 和 401/403/410；404/429/500 无错误解释。
  - 随后 `beginWorkbenchReadyCheck()` 最长轮询约 90 秒，只在第 20/80 次改成通用“功能仍在加载/加载时间较长”。
- **影响**：用户无法区分电脑未启动、配对过期、服务器错误、证书问题或永久失败，手动重连也缺少成功可能性的解释。
- **根因候选**：错误分类只服务自动重试，没有面向用户的有限状态机和终止态。
- **建议归属文件**：`MainActivity.java`、`strings.xml`、`activity_main.xml`。
- **可验证验收标准**
  - 每个主帧失败进入 `retrying`、`auth-expired`、`offline` 或 `terminal-error` 之一；终止态停止轮询。
  - 终止态显示可理解原因、保留配对的“重试”以及需要时的“重新扫码”；状态通过 live region 播报。
  - 404/429/500、SSL error、DNS timeout、401/403/410 均有自动化分支测试。

### MQA-05 · Web 工作台存在 34px 可点击目标，低于移动触控契约

- **严重度：P1**
- **复验状态：已关闭（实现 + 自动化契约）**
- **复现**
  1. 打开移动工作台的通用设置、任务中心或带品牌 Home 控件的 app bar。
  2. 检查可点击按钮的 CSS box 尺寸。
- **证据**
  - `mobile-runtime.js:3351` 注入“手机控制/管理”按钮，内联 `min-height:34px`。
  - `mobile-compat.css:3294-3303` 将任务中心标题按钮设置为 `min-height:34px`。
  - `mobile-compat.css:3605-3611` 将可点击品牌按钮设置为 34×34px，7px margin 不属于点击区域。
  - 原生层已经明确 `harness_touch_min=48dp`，Web 层与之不一致。
- **影响**：拇指点击误触、运动障碍用户难以操作；同一 App 内触控质量不一致。
- **根因候选**：视觉尺寸和 hit target 未分离；后置 CSS 视觉层覆盖了早期 44/48px 规则。
- **建议归属文件**：`mobile-runtime.js`、`mobile-compat.css`。
- **可验证验收标准**
  - 所有主要按钮和 icon button 的实际可点击 box 至少 48×48 CSS px；紧凑视觉图形可置于 48px hit box 内。
  - 自动化遍历可见 `button/a/[role=button]`，排除正文内联链接后，不得出现任一边小于 44px；核心导航不得低于 48px。
  - pressed、disabled、focus-visible 三态不改变布局尺寸。

### MQA-06 · Android 15 预测返回未显式启用

- **严重度：P2**
- **复验状态：已关闭（实现 + 自动化契约）**
- **复现**
  1. Android 15 冷启动 App。
  2. 查看应用进程 Warning 日志并执行边缘返回。
- **证据**
  - 日志：`WindowOnBackDispatcher: OnBackInvokedCallback is not enabled for the application. Set android:enableOnBackInvokedCallback="true" in the application manifest.`
  - App targetSdk 35；主界面使用 `OnBackPressedDispatcher`，扫码页仍覆盖已弃用的 `onBackPressed()`。
  - Manifest 未声明 `android:enableOnBackInvokedCallback`。
- **影响**：系统返回手势动画和完成语义可能与 Android 15 预期不一致，跨主界面/扫码页行为不统一。
- **根因候选**：迁移到 AndroidX dispatcher 未完成 Manifest/子 Activity 收尾。
- **建议归属文件**：`AndroidManifest.xml`、`HarnessCaptureActivity.java`。
- **可验证验收标准**
  - 启用预测返回；所有 Activity 使用 dispatcher/callback，不再产生该 Warning。
  - 工作台层/抽屉优先关闭，随后 Web 历史，最后退到后台；扫码页返回配对页；每次手势只消费一次。

### MQA-07 · 顶部加载进度没有辅助技术状态

- **严重度：P2**
- **复验状态：已关闭（实现 + 自动化契约）**
- **复现**
  1. 在已配对工作台触发同源导航或资源加载。
  2. 使用 TalkBack 观察从 0–100% 的加载状态。
- **证据**
  - `activity_main.xml:230-237` 的水平 `ProgressBar` 没有 content description/live region，也没有关联状态文本。
  - `onProgressChanged()` 只更新视觉进度和可见性；当全屏连接 overlay 已隐藏时，无可访问加载反馈。
- **影响**：盲人用户无法判断导航是否开始、仍在进行或完成。
- **根因候选**：全屏连接状态与 WebView 局部加载进度采用两套反馈通道。
- **建议归属文件**：`MainActivity.java`、`activity_main.xml`、`strings.xml`。
- **可验证验收标准**
  - 导航开始/完成至少各播报一次；进度细粒度变化不刷屏。
  - 加载指示器隐藏后无残留焦点；失败转入 MQA-04 的明确错误态。

## 5. 主流程与异常流程覆盖矩阵

| 场景 | 复验结果 | 证据/引用 |
| --- | --- | --- |
| 首次启动未配对 | 通过 | 原生语义完整，主操作明确 |
| 空数据/无项目/无提供方 | 通过（实现契约） | 具体空状态文案；工作台语义刷新由 MQA-03 保护 |
| 无效配对地址 | 通过（实现契约） | 隐藏 IME、保留输入、错误滚入视口且仅使用 polite live region，MQA-02 |
| 扫码相机拒绝 | 通过 | 有重试、系统设置、返回和主动播报 |
| 已配对冷启动 | 通过（代码+既有实体机证据） | 自动激活保存 profile 并打开稳定 origin |
| Home/Recents/Picker 返回 | 通过（实现契约） | 不 reload 文档，保留当前会话 |
| 网络丢失/切换 | 通过（实现契约） | overlay + 自动重建路线；失败最终进入有界状态，MQA-04 |
| 401/403/410 | 通过（实现契约） | 进入 auth-expired 并回配对页 |
| 502/503/504、DNS/超时 | 通过（实现契约） | 有限退避并可手动恢复 |
| 404/429/500、SSL 等 | 通过（实现契约） | 取消 SSL、停止轮询并进入 terminal-error，MQA-04 |
| Android Back | 通过（实现契约） | Manifest 启用预测返回；主/扫码 Activity 均使用 dispatcher，MQA-06 |
| 200% 字体竖屏 | 通过（既有运行证据） | 全部元素仍在可视/可滚区域 |
| 200% 字体横屏 | 通过（布局契约；待 MuMu 手工留证） | ScrollView 子内容按 `wrap_content` 测量且无占位 weight，MQA-01 |
| TalkBack 原生页 | 通过（既有运行证据） | 文本、输入框、按钮和 live region 可见 |
| TalkBack 工作台 | 通过（实现契约；待 MuMu 手工留证） | 多时点注入、MutationObserver、ARIA landmarks、Dialog 焦点恢复，MQA-03 |
| 触控目标 | 通过（CSS 契约） | 最终级联层对核心目标强制 48×48px，状态不改变几何，MQA-05 |
| 局部加载播报 | 通过（实现契约） | 每次导航只播报开始/完成，隐藏后移出无障碍树，MQA-07 |
| safe area/IME bridge | 通过（静态契约） | systemBars/displayCutout/IME + CSS env/visualViewport |
| Reduce Motion | 通过（静态契约） | 统一压缩动画与平滑滚动 |

## 6. 关闭结论与持续边界

MQA-01～07 已全部关闭，不再保留发布阻断级 TODO。最终复验证据与 MuMu 实测清单见 `docs/mobile-quality-validation.md`。关闭结论不改变以下持续边界：不复制官方会话业务状态；不因网络切换/前台恢复无条件 reload；不放宽私网配对校验；不以 OCR 替代语义验收；不降低 48×48px 核心触控阈值。

## 7. 自动化质量契约

`tests/mobile-quality-audit.test.cjs` 固化 7 项既有质量基线与 MQA-01～07 的 7 项关闭契约：

- MQA-01：滚动内容按完整高度测量，连接操作保持 48dp 基线。
- MQA-02：IME 收起、错误滚入视口、输入保留、单一 polite 播报。
- MQA-03：WebView 可访问主机、加载多时点刷新、结构变化刷新、无/有 Dialog 与关闭焦点返回、禁止 OCR 替代。
- MQA-04：HTTP/WebView/SSL 失败进入 retrying/auth-expired/offline/terminal-error 有界状态。
- MQA-05：核心 Web 目标至少 48×48 CSS px，pressed/disabled/focus-visible 不改变几何。
- MQA-06：预测返回启用且所有 Activity 使用 dispatcher。
- MQA-07：局部加载只播报开始/完成，隐藏后不残留辅助技术焦点。

契约执行结果必须保持 **0 fail、0 todo**；不得通过删除检查、弱化分支覆盖或降低阈值制造绿灯。

## 8. 发布门槛

下列任一回归应重新阻断 Android 移动版发布：

- MQA-01～MQA-07 任一定向契约失败或重新出现 TODO。
- 完整 mobile 测试、Android unit/lint/debug build 任一失败。
- 断网、前后台或系统 Picker 返回导致 WebView 文档/草稿/附件被无条件重载。
- TalkBack 无法到达核心导航、消息区和 composer，或 Dialog 关闭后焦点不返回触发器。
- 大字体横屏无法到达首次配对主操作。
- 错误只有无限 loading，没有原因、自动退避终点或用户恢复动作。
