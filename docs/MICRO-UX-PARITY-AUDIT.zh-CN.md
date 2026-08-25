# Codex / Claude Code 小优化对标审计

> 审计日期：2026-08-25
>
> 对象：Harness Desktop `release-v1.0.28-worktree`
>
> 范围：只评估低侵入的小体验改进；不借机扩展大功能，也不在桌面壳层重复实现官方 DSH 运行时已经拥有的能力。

## 结论

本轮结论分为三类：

1. **需要且本轮实施**：模态框焦点约束与焦点恢复、Computer Use 授权卡小窗口可达与重新聚焦防误授权、浏览器错误的无障碍即时播报、右侧文件/计划筛选和刷新时的滚动保持。
2. **已经具备，不重复实现**：会话草稿与当前会话持久化、失败保留草稿、历史分页锚定、模型重试状态、停止后的滚动跟随、回复复制、附件/归档/完成通知、长会话压缩、Windows 进程与窗口兼容等。
3. **不适用或本轮不做**：终端/TUI 专属键位与 pane、第二套草稿/会话存储、自定义 Token/状态 Dock、上游 composer 内部编辑能力，以及超出“小优化”范围的通用 pane 系统或全局 Agent Center。

## 需要：本轮实施

| 项目 | 为什么需要 | 本轮处理 | 主要门禁 |
| --- | --- | --- | --- |
| 模态框 Tab 焦点约束 | 壳层已有多个 `aria-modal="true"` 对话框，但仅标注语义不足以阻止键盘焦点逃到背后页面 | 增加统一焦点陷阱；打开时把焦点留在最上层可见模态框，关闭后在安全条件下恢复到原触发控件 | `tests/modal-focus.test.cjs` |
| Computer Use 授权操作始终可达 | 小窗口或长说明下，允许/拒绝按钮不能随正文滚出可视区 | 卡片改为有界弹性布局：说明区独立滚动，操作区固定可达，状态文本有界 | `tests/browser-sidebar-ui.test.cjs` |
| 防止重新聚焦首击误授权 | 窗口失焦后，用户用于重新激活窗口的第一下鼠标点击可能恰好落在高权限授权按钮上 | 只拦截重新聚焦后的首个指针授权点击并给出提示；键盘激活、拒绝和后续明确点击保持原语义 | `tests/browser-sidebar-ui.test.cjs` |
| 浏览器错误即时播报 | `#browserStatusText` 的异常曾只是普通文本，与右侧工作区 `role="alert"` 规则不一致 | 统一状态写入；异常设 `role="alert"`，普通进度/成功回到 `role="status"` | `tests/browser-sidebar-ui.test.cjs` |
| 文件/计划列表滚动保持 | 筛选或刷新会 `replaceChildren()`，长列表的阅读位置可能跳回顶部 | 仅在同一可滚动列表筛选/刷新时捕获并夹取恢复 `scrollTop`；空态、错误、首次进入和主动切换不复用陈旧位置；搜索框重新聚焦使用 `preventScroll` | `tests/right-workspace-ui.test.cjs` |

## 已具备：确认后不改实现

### 会话与输入

| 项目 | 现有证据 | 决定 |
| --- | --- | --- |
| 每会话草稿持久化 | 官方 `dsh-client-ui-conversation` 的 `createChatStore()` 使用 `persist: "dsh.conversation.chat"`，`ConversationSession` 用 `storedDraft` 回填并通过 `bindDraftMirror` 镜像 | 不增加桌面 `localStorage`/IndexedDB 草稿键 |
| 当前会话恢复 | 官方 `dsh-client-runtime` 使用 `dsh.sessions.current`，构造 `SessionManager` 时恢复 `sessionId` 与子代理地址 | 不增加第二套 active-session 键 |
| 发送失败保留输入 | 官方发送契约只在草稿未被用户继续改动时恢复，并通过 `promptError` 显示原因 | 不重复写失败恢复逻辑 |
| 更早历史与阅读位置 | 官方 `loadOlder()` 配合 `{ key, top }` 锚点 | 不另写桌面历史分页 |
| 模型重试可见性 | 官方包含 scheduled/active/cancelled/started 状态、次数/延时/失败原因及 `role="status"` | 不增加另一套“重试卡” |

这些契约由新增的只读门禁 `tests/conversation-micro-ux.test.cjs` 固化；测试只读取固定版本的官方源码，发现上游漂移时要求重新审计，而不是静默补一套桌面实现。

### 滚动、消息与会话管理

- `scripts/chat-stop-follow.mjs` 已实现停止后的 settling 跟随、读者主动上滑退出跟随、锚点与 resize 稳定处理。
- `scripts/assistant-copy-patch.mjs` 已提供完整助手回复复制入口。
- `plugins/dsh-session-experience` 已提供附件上传、会话归档/恢复/复制 ID/定位及完成通知。
- 官方/桌面补丁已有长会话历史分页、上下文压缩、缓存与输出保留策略。

### 桌面与无障碍基础

- 右侧工作区已经在宽屏收缩主区、窄屏降级为覆盖层；非对话视图不会让 composer 遮挡页面。
- 已广泛使用 `aria-live`、`role="status"`、`role="alert"`、`focus-visible` 与 `prefers-reduced-motion`；本轮只补真实缺口，不另做“屏幕阅读器模式”。
- 文件行、文档头和浏览器标签已有省略处理；列表优先展示文件名而非整条路径，因此本轮不额外引入路径中段裁切算法。
- Windows 目录选择、进程树停止、Node/Electron 子进程 `windowsHide` 等已有实现与回归测试。

## 不适用或本轮不做

| 项目 | 决定与原因 |
| --- | --- |
| Vim/readline/反引号、终端滚动与全屏 TUI | 属 CLI/TUI 交互，本产品是 Electron + WebView GUI，没有同构界面，照搬会制造冲突 |
| tmux/iTerm split pane 或通用可拖动 pane 系统 | 是大功能，不属于本轮“小优化” |
| 全局 Agent Center | 有产品价值，但涉及跨会话聚合、状态可信度和历史治理，应作为独立设计，不夹带实施 |
| 桌面第二套草稿/当前会话持久化 | 官方已经持久化；双写会导致切换、失败恢复和升级后的状态冲突，明确禁止 |
| 自定义 Token/进度/状态 Dock | 现有产品策略要求由正常对话和官方语义状态表达；不恢复已移除的常驻自定义 Dock |
| composer autosize、Markdown、@mention 等内部编辑 | 属官方 `dsh-client-ui-conversation` 所有权；桌面壳层只复用 `inputActions.setDraft`，不以 DOM 补丁越权 |
| 全局 composer 聚焦快捷键 | 收益与快捷键冲突/跨 WebView 焦点语义尚不明确，本轮不做猜测式绑定 |
| 路径中段裁切 | 现有页面主要显示文件名并已有尾部省略；未观察到任务阻断证据，暂不增加另一套裁切规则 |

## 验证策略

专项命令：

```powershell
node --test tests/browser-sidebar-ui.test.cjs tests/modal-focus.test.cjs tests/right-workspace-ui.test.cjs tests/conversation-micro-ux.test.cjs
node --test tests/chat-stop-follow.test.cjs tests/session-experience.test.cjs tests/official-runtime-patch.test.cjs
```

完整门禁：

```powershell
npm run verify
npm run verify:release
```

## 本轮主要文件

- `renderer/modal-focus.js`：统一模态焦点约束与安全焦点恢复。
- `renderer/index.html`、`renderer/styles.css`、`renderer/browser-sidebar.js`：授权卡布局、防误触和浏览器状态播报。
- `renderer/right-workspace-integration.js`：文件/计划筛选与刷新滚动保持。
- `tests/modal-focus.test.cjs`、`tests/browser-sidebar-ui.test.cjs`、`tests/right-workspace-ui.test.cjs`：新增/扩展行为门禁。
- `tests/conversation-micro-ux.test.cjs`：官方已具备能力的只读源契约门禁。

> 本轮不修改 `node_modules`，不替换官方 conversation/runtime 实现，也不触碰工作树中与本任务无关的已有未提交改动。
