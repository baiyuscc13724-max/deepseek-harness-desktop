# MCP、自动化、文件、远程访问、记忆与进度对标

> 调研日期：2026-08-21。只把产品官方文档或项目官方文档视为能力依据；没有找到官方能力时标为“未见官方”，不由 Harness Desktop 自行杜撰。

## 结论

- **MCP**：Codex、Claude Code、Hermes 均有官方 MCP 路径。Harness Desktop 应复用 DeepSeek Harness 官方 MCP 客户端，不恢复已删除的任意 Electron 命令 IPC。
- **定时任务**：Codex App Automations 与 Claude Code Scheduled Tasks 都有正式入口；Harness Desktop 复用官方 DSH Schedule，并明确其会话内、不唤醒系统的边界。
- **文件**：三者都以智能体工作区和受约束文件工具为核心。Harness Desktop 采用“用户选择导入 → 工作区引用 → 官方 `read` / `write` / `edit` → 下载产物”，不增加任意宿主文件后台。
- **异地访问**：Claude Code 有官方 Remote Control；Codex 有云任务/应用形态，但本次未找到与本地会话组网完全等价的官方协议；Hermes 文档主要描述本地/自托管工具。Harness Desktop 继续加固已有 EasyTier/WSS/Tailscale 适配层，不声称三者协议兼容。
- **记忆，不是自我训练**：Codex Chronicle、Claude auto memory、Hermes persistent memory 都是持久上下文、项目指令或可召回记录；没有证据表明它们会在本地持续训练或改写模型权重。因此 Harness Desktop **不实现或宣传模型“自我学习/自我训练”**，只保留明确 opt-in、可审计、可删除的有限本地记忆。
- **进度**：Claude SDK 有 Todo tracking，Hermes 有 Kanban；Codex 强调计划、目标与长任务迭代。共同模式是按阶段、任务状态、里程碑和异常报告，而不是每 N 步/每 N 次工具调用/每 N 秒刷屏。Harness Desktop 因此采用语义事件驱动策略。

## 能力矩阵

| 能力 | Codex | Claude / Claude Code | Hermes Agent | Harness Desktop 对标决定 |
| --- | --- | --- | --- | --- |
| MCP | 官方 MCP 配置 | 官方 MCP，项目级服务器有审批 | 官方 MCP 配置 | 官方 `@deepseek-ai/dsh-mcp-client`；stdio/Streamable HTTP；凭据引用；显式启停确认 |
| 定时 | Codex App Automations | Scheduled Tasks | 未见与前两者同级的官方桌面调度入口 | 官方 DSH Schedule；可观察但明确 session-local/no wake |
| 文件 | 本地/Worktree/Cloud 工作环境与文件工具 | Claude Code 项目文件工具 | 内置文件工具 | 上传只落工作区 `uploads/`；下载仅普通文件；编辑通过官方工具草稿 |
| 远程 | 云任务与应用；未把它等同本地组网 | 官方 Remote Control / Mobile | 以本地/自托管工具文档为主 | 加固现有跨平台配对与 WSS/EasyTier/Tailscale，不虚构公共中继 |
| 记忆 | Chronicle memories | `CLAUDE.md` 与 auto memory；API memory tool | Persistent Memory / providers | 有限、opt-in、敏感过滤、可删除；不称自训练 |
| 进度 | 计划/目标/困难问题迭代 | Agent SDK Todo tracking | Kanban board | Todo/Goal/工具/阻塞/里程碑的语义状态 Dock 与自适应文字汇报 |

## 关键安全和体验边界

1. MCP 秘密只使用 Harness 凭据引用；公共投影永不返回解析后的值。stdio 必须使用绝对命令，HTTP 默认 HTTPS、仅回环允许 HTTP。
2. 定时任务只在当前 DSH 会话可投递；电脑休眠或运行时关闭时不会唤醒，恢复后才处理逾期任务；循环最短 300 秒。
3. 上传/下载有大小上限、路径规范化、realpath containment 和 symlink 逃逸检查。编辑不会从浏览器直接覆盖宿主文件。
4. 异地同步秘密使用 OS `safeStorage`；不可用、密文损坏或解密失败时 fail closed。默认没有生产 WSS 公网中继 URL。
5. 进度报告由计划开始、阶段变化、里程碑、失败/恢复、用户决策和阻塞等事件触发；不制造假的助手消息。
6. 本地记忆默认关闭。开启后仍只允许稳定偏好/项目事实，且提供查看、停用和删除。

## 官方来源

### OpenAI Codex

- [Model Context Protocol](https://developers.openai.com/codex/mcp)
- [Automations](https://developers.openai.com/codex/app/automations)
- [Chronicle memories](https://developers.openai.com/codex/memories/chronicle)
- [Codex App](https://developers.openai.com/codex/app)
- [Follow a goal](https://developers.openai.com/codex/use-cases/follow-goals)

### Anthropic Claude / Claude Code

- [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)
- [Run prompts on a schedule](https://code.claude.com/docs/en/scheduled-tasks)
- [How Claude remembers your project](https://code.claude.com/docs/en/memory)
- [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Remote Control](https://code.claude.com/docs/en/remote-control)
- [Todo tracking](https://code.claude.com/docs/en/agent-sdk/todo-tracking)
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

### Nous Research Hermes Agent

- [Tools & Toolsets](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools)
- [MCP Config Reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)
- [Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)
- [Memory Providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers)
- [Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)
