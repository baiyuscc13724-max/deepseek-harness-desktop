# Android 移动质量最终复验

> 复验日期：2026-08-30  
> 复验范围：MQA-01～MQA-07 及既有移动质量基线  
> 边界：本轮只修改质量契约与文档，不修改产品实现；不删除检查、不降低阈值、不以 OCR 替代语义树。

## 1. 结论

七项初审缺口均已由真实实现与自动化契约关闭。`tests/mobile-quality-audit.test.cjs` 的 7 个 `test.todo` 已逐项替换为可执行断言；定向审计契约为 **14 tests / 14 pass / 0 fail / 0 todo**。

MQA-03 的最终定性不是“缺少若干静态 ARIA 属性”，而是**时序/状态性语义刷新缺陷**。关闭证据同时覆盖：

1. 文档尚未 ready 时不得错误锁定 runtime marker；
2. page started、commit visible、page finished 三个加载时点均重新注入；
3. DOM 结构变化与页面恢复可见后重新执行语义装饰；
4. 无 Dialog 时清理旧焦点状态；有 Dialog 时约束焦点；关闭后回到仍连接的触发器；
5. 真实 role/label/landmark 是验收对象，OCR 明确禁止作为替代。

## 2. MQA-01～07 证据表

| ID | 关闭证据 | 自动化保护 | 结论 |
| --- | --- | --- | --- |
| MQA-01 | `pairing_scroll` 使用 `fillViewport`；其直接内容容器为 `wrap_content`；移除 0dp weight 占位；连接按钮保持 compact 48dp 基线 | 解析真实 `activity_main.xml` 并拒绝 `match_parent`/占位回归 | 通过 |
| MQA-02 | `showPairingError()` 隐藏 IME、保留原输入、调用 `requestRectangleOnScreen()` 与 `requestChildFocus()`；错误只使用 polite live region | 约束方法体与布局，不允许额外 `announceForAccessibility` 或清空输入 | 通过 |
| MQA-03 | WebView 显式加入可访问树并可聚焦；0/250/900ms 注入；三段页面生命周期刷新；MutationObserver/visibility 刷新；完整 landmarks；Dialog 焦点约束与返回 | 同时读取 `MainActivity.java`、`MobileUiAdapter.java`、`mobile-runtime.js`，覆盖加载后刷新、无/有 Dialog、焦点返回与禁止 OCR | 通过 |
| MQA-04 | HTTP/WebView/SSL 进入 RETRYING/AUTH_EXPIRED/OFFLINE/TERMINAL_ERROR；SSL 取消；重试耗尽终止；终止态隐藏 spinner 并提供重试/重扫 | 覆盖分类器默认终止分支、SSL 分支、退避上限、终止态动作和文案 | 通过 |
| MQA-05 | 最终 CSS 级联层对核心导航、会话、设置、composer、输入/模型按钮强制最小 48×48px；品牌 glyph 保持 34px 但外框 48px | 保持 48px 阈值；验证最终层晚于 34px 旧规则；pressed/disabled/focus-visible 不改变几何 | 通过 |
| MQA-06 | Manifest 启用 `enableOnBackInvokedCallback`；主 Activity 与扫码 Activity 均使用 AndroidX dispatcher；扫码取消只消费一次 | 拒绝扫码页重新出现 `onBackPressed()` | 通过 |
| MQA-07 | 局部加载只在开始和完成播报；失败立即隐藏；隐藏后设置 `IMPORTANT_FOR_ACCESSIBILITY_NO` | 约束开始/完成门闩、失败路径、隐藏状态与文案 | 通过 |

## 3. 自动化执行记录

### 3.1 定向质量契约

```powershell
node --test tests/mobile-quality-audit.test.cjs
```

结果：14 tests，14 pass，0 fail，0 todo。

### 3.2 新增依赖契约联合执行

```powershell
node --test tests/mobile-native-quality.test.cjs tests/mobile-web-accessibility.test.cjs tests/mobile-quality-audit.test.cjs
```

结果：25 tests，25 pass，0 fail，0 todo。

### 3.3 完整 mobile 测试

```powershell
node --test tests/mobile-*.test.cjs
```

结果：188 tests，188 pass，0 fail，0 todo。测试输出包含一条 Node `DEP0060` 依赖弃用警告，以及既有附件 rail 的诊断日志；两者均未造成测试失败，也不改变本轮 MQA 判定。

## 4. MuMu 最终实测清单

以下清单用于在 MuMu Android 15 镜像留取最终运行证据。每项应保存屏幕录制/截图、UIAutomator 深树与限定应用进程的 Warning 日志；OCR 只能辅助定位，不能代替无障碍树。

- [ ] **MQA-01 / 200% 字体竖屏**：未配对冷启动；确认扫码、地址输入、连接、错误与页脚可见或可连续滚达；连接按钮实际高度 ≥48dp。
- [ ] **MQA-01 / 200% 字体横屏**：2400×1080；一次连续向下滚动可到达连接按钮和页脚，滚动前后元素 bounds 明确变化。
- [ ] **MQA-02 / IME 错误可见性**：输入无效地址后从软键盘 Go 提交；300ms 内 IME 收起、输入值保留、错误完整进入 viewport；TalkBack 只播报一次。
- [ ] **MQA-03 / 无 Dialog**：工作台加载开始、commit visible、完全加载后各抓一次深树；顶部导航、当前标题、对话列表、消息区、composer、发送/停止控件保持稳定 role/label。
- [ ] **MQA-03 / 有 Dialog**：打开设置/确认 Dialog；焦点不能越出 Dialog，Tab/Shift+Tab 循环正确。
- [ ] **MQA-03 / Dialog 关闭**：关闭后焦点返回原触发器；随后触发 DOM 更新和前后台切换，语义树仍完整。
- [ ] **MQA-04 / HTTP**：分别注入 404、429、500；确认停止 loading、进入 terminal-error、原因可理解、保留配对，并出现重试/重新扫码。
- [ ] **MQA-04 / SSL 与网络**：SSL 必须取消并终止；DNS/timeout 使用有界退避；无网络进入 offline；401/403/410 回到 auth-expired 路径。
- [ ] **MQA-05 / hit box**：在 DevTools/自动遍历中测量可见核心 `button/a/[role=button]`；核心导航不得小于 48×48 CSS px；pressed/disabled/focus-visible 前后 box 不变。
- [ ] **MQA-06 / 预测返回**：执行工作台层/抽屉→Web 历史→后台、扫码页→配对页；每次手势只消费一次；应用 Warning 日志中无 `WindowOnBackDispatcher` 未启用警告。
- [ ] **MQA-07 / 加载播报**：同源导航/局部加载只播报“开始加载页面”“页面加载完成”；中间进度不刷屏；完成/失败后进度条不残留焦点。

### 4.1 本轮 MuMu Android 15 运行证据

| 场景 | 结果 | 运行证据 |
| --- | --- | --- |
| 冷启动与索引恢复 | 通过 | `adb install -r` 保留应用数据后冷启动，抽屉直接显示 `10 个项目 · 5 个对话`，不再停留在“正在恢复最新列表”；`DeepSeek-Harness-Desktop` 项目及既有会话 `跨会话团队任务看板优化` 均可通过 UIAutomator 身份点击并打开。 |
| 项目/会话语义树 | 通过 | 修复零尺寸抽屉祖先和中间 `inert`/`aria-hidden` 后，UIAutomator 深树稳定暴露项目、会话、`消息编辑器`、发送控件与当前会话标题；安装后的说明 Dialog 可聚焦、可关闭，关闭后工作台语义树恢复。 |
| 500/2000/10000 字符草稿 | 通过 | 仅写入草稿，未触发发送。三档实测值长度分别为 500、2000、10000；输入滚动区高度恒为 168 CSS px，`scrollHeight` 分别为 387/1443/7119；工具栏始终位于 616px 视口内（top 554.36、bottom 602.36），卡片横向保持在 360px 视口内（left 28、right 324）。零高度 IME 报告不再触发伪抬升；最终草稿已清空。 |
| Composer 可见性与点击面积 | 通过 | Hero 新会话的长草稿不再裁掉工具栏；最终候选包中发送控件 DevTools 实测 `48×48` CSS px（min/actual 均为 48），UIAutomator 仍可定位。 |
| 断线与错误恢复 | 通过（本轮覆盖） | 受控停止同步网关时应用进入明确 terminal-error，展示可理解原因、`重试加载` 与 `重新扫码`，并声明/实际保留配对信息；恢复网关后可重新配对并恢复项目/会话。此证据不替代上方尚未逐项执行的 404/429/500/SSL 发布矩阵。 |
| 日志与内存 | 通过 | 最终启动/长草稿期间未再出现 `appendChild` JavaScript 异常或应用崩溃；仅观察到 MuMu/Houdini、WebView relro/HWUI 与一次 Chromium 临时索引写入环境警告。长草稿验证后应用 `TOTAL PSS=143231 KB`、`TOTAL RSS=221508 KB`、`Swap PSS=923 KB`。 |
| 自动回归与构建 | 通过 | `node --test tests/mobile*.test.cjs`：188/188 pass、0 fail、0 todo；`testDebugUnitTest lintDebug assembleDebug`：BUILD SUCCESSFUL；最终 48px/Composer 定向复验 9/9 pass。 |

## 5. 发布判定

源码与自动化契约层面，MQA-01～07 已关闭。正式 Android 发布仍应绑定上述 MuMu 运行证据以及 Android unit/lint/debug build；任一契约失败、重新出现 TODO、TalkBack 树缺失、48px 阈值回退或错误态退化为无限 loading，均应重新阻断发布。
