# 代理工作区 UX 调研与改版说明

> 调研日期：2026-08-21。这里区分 Claude Code CLI、Claude Desktop Code 和 Claude Code Agent View；三者不是同一个界面。

## 结论先行

Harness Desktop 不应继续把“成员、所有任务、所有事件、所有快捷操作、设置”同时铺成卡片墙。正确方向是：

1. 主区域只保留现在需要关注的工作；
2. 完成内容进入默认收起、可审计的历史；
3. 团队成员和普通子代理合并到一个统一代理目录；协作动态使用独立的按需面板；
4. 已关闭团队、已退役成员、一次性子代理记录按生命周期分组；
5. 隐藏只是停止占用和低频刷新，不是删除数据；
6. 状态必须来自权威宿主，避免已经结束却仍显示“运行中”的僵尸卡片。

## Claude 的真实产品方式

### Claude Code CLI：Agent Teams

[官方 Agent Teams 文档](https://code.claude.com/docs/en/agent-teams)描述的是 CLI 交互：

- 默认 `in-process` 模式把队友放在输入区下方的 agent panel；用方向键选择、Enter 查看会话，`Ctrl+T` 切换共享任务列表。
- 可选 split panes，让每个队友占一个 tmux/iTerm2 pane；它不是 Web 右侧栏，且不支持 VS Code 集成终端、Windows Terminal 或 Ghostty。
- 任务状态是 pending / in progress / completed，并可有依赖。
- 当前版本在会话退出时自动清理团队配置；任务列表和会话记录按保留规则继续存在。

所以，“Claude Agent Teams 的成员都在右侧栏”不是当前官方 CLI 的准确描述。

### Claude Desktop Code：Tasks / Subagent 面板

[官方 Desktop 文档](https://code.claude.com/docs/en/desktop)确认：

- Code 标签由 chat、diff、browser、terminal、file、plan、tasks、subagent 等可拖动、可调整大小、可关闭的 pane 组成。
- Tasks pane 展示当前会话中的 subagents、后台命令和动态 workflows；点击条目后在 subagent pane 看输出或停止。
- Agent Teams 当前属于 CLI，不在 Desktop Code 中；Desktop 的相近体验来自 Tasks/Subagent pane 与 workflows。

用户记忆中的“平时不显示、需要时打开的右侧任务栏”更接近这个 Desktop Tasks pane，而不是 CLI Agent Teams。

### Claude Code Agent View

[官方 Agent View 文档](https://code.claude.com/docs/en/agent-view)描述的是独立的全屏后台会话总览：

- 按 Needs input、Ready for review、Working、Completed 分组；需要人处理的内容在最上方。
- Completed 只使用剩余空间，放不下时折成 `… N more`，不会无限向下铺。
- 离开 Agent View 后后台会话继续运行。
- 一个会话内部创建的 subagents 和 Agent Teams teammates 不会作为独立行出现在 Agent View。

这比“把所有内部对象永久展示”更符合真实工作流：先看需要处理什么，再按需进入细节。

## 官方社区中的真实反馈

以下是 Anthropic 官方 `claude-code` 仓库的用户报告。关闭状态可能表示已修复或已处理，不代表当前版本仍有同一问题；它们仍能证明真实使用中的 UX 风险。

- [#40557：希望 VS Code 有 Agent 侧栏](https://github.com/anthropics/claude-code/issues/40557)——并行 3–5 个 agent 后，标签堆积、难以区分运行/完成/空闲。
- [#75863：希望 VS Code 补齐 Desktop 的 Background Tasks 面板](https://github.com/anthropics/claude-code/issues/75863)——用户明确希望统一查看 subagents/workflows，而不是只在聊天内联输出中寻找。
- [#26955：团队删除后僵尸成员指示仍留在 UI](https://github.com/anthropics/claude-code/issues/26955)——生命周期结束和可见状态不同步会直接破坏信任。
- [#58457：子代理已完成但 Tasks 面板仍显示 Running](https://github.com/anthropics/claude-code/issues/58457)——“停止”按钮无效进一步放大错误状态的危害。
- [#53867：折叠/非活动 task panel 仍导致显著性能下降](https://github.com/anthropics/claude-code/issues/53867)——视觉折叠不够，隐藏区域还应停止昂贵渲染与非必要订阅。
- [#51504：并行子代理场景中会话历史丢失](https://github.com/anthropics/claude-code/issues/51504)——清爽 UI 不能以删除审计历史为代价。

## 对原工作区的用户层审计

原三列工作区存在五个根因：

1. **对象模型直接等于页面结构**：members、tasks、events 各一列，数组有多少条就渲染多少张卡。
2. **没有生命周期信息架构**：进行中、已完成、已退役、已关闭只靠卡片徽标区分，完成后不会退出当前注意区。
3. **低频操作权重过高**：六个快捷提示和“关闭自动团队”与当前任务争夺首屏。
4. **团队内与全局概念混杂**：团队切换、跨团队动态和所选团队详情同时展开。
5. **历史虽然保留，却没有“历史入口”**：用户看到的是无限堆积，而不是可检索、可展开的记录。

## 已落地的信息架构

### 团队工作区

- 默认只显示 pending / in_progress 任务。
- completed 任务自动移入“任务历史”；默认收起，首次最多渲染 40 条，可继续加载。
- 团队页不再复制成员卡片或第二套成员侧栏；“代理目录”和画布成员节点都打开负责人已有的统一子代理目录。
- 协作动态保留独立的按需侧栏；多团队时只显示紧凑切换条，closed 团队进入“历史团队”。
- 快捷提示进入“更多操作”，关闭自动团队进入页尾“团队设置”。
- 动态侧栏在窄屏降级为遮罩抽屉，支持关闭按钮和 `Esc`。

### 统一代理目录

- 输入区只保留紧凑计数入口，团队页复用同一入口，不再重复展示同一个会话。
- 打开后使用右侧抽屉，保留“当前 / 历史 / 全部”、嵌套树、Token、时长、方向键、`Esc` 和只读子会话入口。
- 旧 lifecycle 浮层补丁可原位迁移；补丁二次执行不再改动。

### 官方首页边界

- `dsh-desktop-progress` 仅保留语义化系统提示，不再声明 Web client、状态轮询或输入区 Dock。
- 首页不显示“当前无活动工作”等自定义状态条；进度通过正常对话中的低频语义更新表达。

## 与 Claude 还差多远

底层不是从零开始：Harness Desktop 已有持久团队、任务依赖、原子认领、同根跨团队中继、文件冲突提示、主/子模型路由和只读安全投影。主要差距在产品外壳，而不是“能不能运行多个代理”。

仍需后续建设：

1. **全局 Agent Center**：跨会话汇总“需要输入 / 受阻 / 工作中 / 待审 / 已完成”，而不是只看当前团队。
2. **通用 pane 系统**：任务、子代理、diff、终端、浏览器可拖动、调整大小和记住布局；这才接近 Claude Desktop，而不只是右侧抽屉。
3. **注意力信号**：完成、失败、等待用户、权限请求、长期无进展的通知与角标。
4. **结果入口**：任务直接关联 diff、测试、交付物、PR/提交和最终报告。
5. **历史治理**：搜索、筛选、分页、保留周期、归档与明确删除；隐藏和删除必须分开。
6. **性能门禁**：关闭面板后停止目录观察和昂贵流渲染，大列表采用增量渲染。
7. **状态可信度**：对“运行中但宿主已结束”、断线、重启恢复和僵尸记录建立一致的权威状态与修复入口。

因此可以做出与 Claude 相同的使用逻辑，但不应像素级照抄某一个界面。Claude 自己也把 CLI Agent Teams、Desktop Tasks pane 和 Agent View 分成三种表面；Harness Desktop 更适合把它们统一成“当前工作 + 按需侧栏 + 全局 Agent Center”三层结构。
