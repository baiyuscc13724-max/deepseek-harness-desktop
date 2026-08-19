# 协作团队（Agent Teams）架构

## 目标

在不替换官方 DSH 会话引擎的前提下，为 Harness Desktop 增加显式、实验性的多会话协作能力：固定负责人、独立可恢复队友、同级消息、共享依赖任务、团队工作台和安全生命周期。

## 边界

- 默认关闭；只有根会话中的直接用户回合可创建团队。
- 每个根会话同时最多一个活跃团队；负责人固定。
- 队友使用官方 `continuable` subagent，独立上下文且共享工作目录。
- 不把具名普通子代理隐式转换为队友。
- 不支持嵌套团队和领导权转移。
- 本版本不自动创建 Git worktree；任务可记录文件范围并在 UI 提示冲突。

## 组成

`dsh-agent-teams` 是随桌面端安装到 `$DSH_HOME/profiles/web` 的一方插件：

1. Host 插件注册团队模型工具、持久化存储、HTTP/SSE API 和 subagent 生命周期观察器。
2. Client 插件通过原生 Cordis slots 注入团队入口、团队工作台和任务摘要条。
3. 桌面壳只负责把插件原子复制进 Web profile 并确保 `cordis.patch.yml` 中只有一个注册项。

## 持久化

状态存储在 `$DSH_HOME/storages/agent_teams.json`。所有修改经过单一 Promise 写链，使用同目录临时文件、`fsync` 和原子 `rename` 发布。任务认领在一条串行 mutation 中验证并写入，避免两个队友同时认领。

短暂成员状态在重启时校正：`provisioning/running/shutting_down` 不会作为正在执行的事实直接恢复，而转换为 `ready` 或 `failed`。成员会话本身由官方 continuable session 持久化，可在新消息到达时冷恢复。

## 消息授权

团队插件先验证调用者是精确 live agent，且发送者与接收者属于同一活跃团队。队友到队友的消息仍通过固定负责人作为官方 subagent 的直接父级进行投递，从而不绕过官方 lineage 检查。消息使用 `coordinator/relay` 来源并记录真实 `senderSessionId`，永远不获得 `user` 权限。

团队工作台的 HTTP/SSE 面只读展示成员、任务和消息状态，并从 Web 投影中移除消息正文、任务描述和文件路径；唯一可写的 UI 请求是实验设置，并要求同源回环、`x-harness-agent-teams: 1` 头和 256 KiB 正文上限。创建/发信/任务变更/成员生命周期全部只走模型工具的精确 live-agent 鉴权，避免客户端伪造会话身份。用户可从工作台打开官方成员会话，直接发消息或使用官方中断能力。原负责人不可恢复时，只能由新根会话中的直接用户通过 `team_recover` 预览并显式确认关闭无活动成员的孤儿团队。

## 任务

任务状态只有 `pending`、`in_progress`、`completed`。`blockedBy` 从未完成依赖派生，不单独持久化。完成前置任务会自然解除后续任务阻塞。认领要求任务未分配、未阻塞且状态为 pending。

## 成本和冲突护栏

默认最多 4 名队友，硬上限 8；默认最多 4 个活跃成员。UI 始终显示独立上下文带来的 Token 成本提示。多人共享同一工作目录时，任务可声明文件范围；重叠范围在工作台中显示警告。

## 兼容性

插件关闭时不创建团队，不改变 `subagent`、`subagent_fork`、`send_message`、`list_agents` 或 workflow 的行为。团队成员仍是标准 continuable subagent，因此现有会话导航、历史读取、中断和冷恢复继续生效。
