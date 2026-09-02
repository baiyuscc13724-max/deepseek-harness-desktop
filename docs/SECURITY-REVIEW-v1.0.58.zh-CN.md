# Harness Desktop v1.0.58 安全审查

审查日期：2026-09-01

审查范围：官方 Harness 核心 `0.1.2-alpha.4` 兼容边界、Electron 同会话跳转认证、本地 Runtime 启动收敛、MCP 启动上界、手机同步 guest→shell 入口、Agent Teams 事件驱动自动驾驶、Codex 内置浏览器能力对等，以及 v1.0.58 云制品进入公开更新前的本机隔离验证边界。

## 审查结论与证据状态

v1.0.58 候选继续以 fail closed 为默认行为。官方核心升级不替代或双写 Desktop Agent Teams；启动修复不绕过官方认证；自动驾驶不放宽 project/root/team、权限确认或未知副作用边界；手机入口修复不增加新的同步通道；浏览器能力不因“对等”目标而跳过站点授权、来源、导航、下载、文件选择、停止与审计门禁。

本文件记录已经进入候选源码的安全合同和正式发布必须取得的动态证据，不等于 v1.0.58 已经发布。上一稳定版是不可变的 `v1.0.57`。候选 `v1.0.58` 只有在干净、已提交的精确 revision 上通过全部门禁、完成正式云 Windows 制品的本机隔离启动验证，并由唯一 resumable publisher 核对两云资产后，才允许让普通用户检查到更新。

## 0. 官方核心 alpha.4 兼容边界

- 随包 Harness Runtime 及全部 required/optional DSH roots 必须精确固定为 `0.1.2-alpha.4`；版本不一致、依赖图不闭合、产物哈希或语义锚点漂移时均 fail closed。
- Desktop 只按 alpha.4 的 branded session sequence、事件所有权、projector/node-store 和 Host follow-up queue 合同迁移，不通过去除品牌类型、混用 own/snapshot events 或恢复退休 API 取得兼容。
- 自研 Agent Teams 的 Host 一次性授权、root/project/body 绑定、runtime epoch 撤销、任务账本、生命周期和自动驾驶继续保持单一权威；官方 experimental Team 不接管、不双写，也不能旁路 Desktop 安全门禁。

## 1. Electron 同会话跳转认证

- 官方工作台仍运行在隔离的 `persist:harness` Electron session 中。启动 token 仅用于 loopback 首次认证，不写入诊断、状态摘要或面向用户的错误详情。
- token 请求产生的同源重定向由同一个 Electron session 跟随，认证 Cookie 由该 session 的 CookieStore 持有；不会用 Node 默认请求栈另建一套无 Cookie 会话，也不会把 bearer 改写成长期请求头。
- 重定向每一跳仍受 loopback、authority、scheme、路径和数量上界约束。跨来源、缺失认证 Cookie、重定向循环、401/404/5xx 或 clean `/` 非 2xx 均不得判定为就绪。
- 主窗口、RPC、事件 WebSocket、右侧工作区和 Mobile 代理继续复用受控认证状态；移动端不能注入官方认证 Cookie，上游认证 `Set-Cookie` 也不能穿透到移动端。

## 2. Runtime 单飞、陈旧进程清理与 MCP 启动上界

- 同一 runtime home 的并发启动收敛到 singleflight；调用者共享同一在途启动结果，不并发创建第二个官方 Runtime。
- 启动前只清理由桌面端能够精确归属、已经失去可访问 Web 服务且通过身份检查的陈旧子进程。PID 存活、身份不明或归属证据不足时 fail closed，不按端口或进程名猜测终止用户进程。
- readiness 必须由真实可认证的本地 Web 服务证明；仅有进程存活、端口占用或日志文本不算启动完成。
- 可选 MCP 集成的连接与首次工具同步具有明确上界，并受 supervisor 管理。非强制 MCP 超时不得无限阻塞基础 Web 启动；标记为启动失败即致命的 MCP 仍按原配置失败，不被静默忽略。

## 3. 手机同步 guest→shell bridge

- 官方工作台侧栏中的手机同步入口通过受限 guest preload 发送结构化请求，再由可信 Electron shell bridge 打开已有的同步面板；不再依赖 guest DOM 直接访问主进程能力。
- bridge 只接受既定 channel、受信 guest/webContents 和固定动作，不提供通用 IPC、任意方法名或任意参数转发。
- 桌面只保留一个手机同步入口。修复不创建第二份设备状态、不改变配对密钥、远程中继、设备权限、撤销或传输加密语义。

## 4. Agent Teams 事件驱动自动驾驶

- 自动接力在可信桌面设置中默认勾选；旧数据缺少该字段时采用默认值，已明确关闭的配置仍保留。用户点击“保存”并完成一次 Desktop Host 确认后即可记录偏好，即使尚无团队也不需要先构造 scope；每个目标选择固定的 1–200 轮追加上限，默认 200。模型参数、routing 声明和普通 goal round 都不能扩大该额度。
- 无团队的可信保存只生成与 settings hash 和 Host authorization epoch 绑定的 proof，`hostAuthorization` 仍为 `null`，不能单独取得 Goal 权限。首个符合条件团队创建时还必须证明同一精确直接用户回合或 Host-admitted Goal round，并匹配 Level 3 routing receipt；最终 grant 才精确落到 root、canonical project、active Goal、team、pause epoch 与设置值。全局开关、静态请求头或模型声明不能替代这些事实；只有同 root 下完整、仍存活且事实一致的平级团队，才可继承仍存活的授权组。
- 获得授权后，正常成员等待期间 Root 不再消耗轮次轮询，也不再要求用户发送“继续”触发验收；安全的成员提交、释放和状态变化会通过持久 Agent Teams 事件在 Root 空闲时合并唤醒，自动继续验收或调度。显式 Stop 或安全 blocker 会撤销自动权限，仍须人工恢复。
- 自动 park 只有在所有未完成的内部安全任务都由 `running` / `provisioning` worker 持有，或其依赖链最终能够证明落到同一 root 下的 live producer 时成立；至少必须存在一个 producer。跨 team 的可证明依赖链允许 park。
- 依赖缺失、循环、终态/取消 blocker、跨 root、paused team、project 不一致、capability 未验证、文件冲突、effect 非 `none` 或 `outcome_unknown` 均 fail closed，不能 edit/resume/followup/steer。
- 每个 durable transition 最多补充一个 goal round；只恢复明确的 `round-limit`，不清除 Stop、权限确认、外部副作用未知或其他 blocker。达到固定预算，或出现 Host/plugin 重启、Stop、handoff、设置关闭、预算下调、目标/计划/项目/安全事实变化时，live capability 与未完成 wake 会被撤销或取消。该机制不是无限循环或盲目重试。

## 5. Codex 内置浏览器能力对等

- 候选以 Codex 内置浏览器的可见导航、交互、检查和停止能力为对等目标，但所有调用仍经过动态安全门禁：来源与 actor 绑定、站点授权、导航策略、动作确认、文件/下载边界、取消和审计不可旁路。
- “功能可调用”不等于“安全对等已验收”。最终通过状态由 browser 专项代理以真实 Electron 动态场景复核；复核完成前，本节仅作为候选发布要求，不宣称所有浏览器 parity 场景已经通过。
- 任何动态证据失败都必须阻止候选发布，不能用静态字符串检查、关闭门禁或扩大默认授权替代。

## 6. 正式云 Windows 制品的本机隔离验证阶段

- 本地开发构建不能替代正式云资产。publisher 先要求绑定精确 source revision、requestId 和 workflow run 的桌面云构建全部成功，创建不可变 Tag 并公开该 run 的桌面 Release；随后只从公开 Release 的规范 URL 下载正式 Windows x64 便携包。
- 隔离阶段把 Release/asset ID、大小、GitHub SHA-256 digest 与 40 位产品提交绑定到证据，在版本/提交/validation ID 隔离目录中使用各自唯一的 Electron userData 和 Harness runtime home 实际运行 packaged `--self-test`。正式包必须启动随包 Runtime 的随机端口 token→Cookie→clean `/` 链路，并返回精确产品版本与全部规定检查项；不得借用当前开发实例的 Cookie、端口、用户数据或已运行 Runtime 得到伪阳性。
- 只有正式字节、隔离报告以及下载后的第二次远端元数据核对都成功，才允许继续 Android、组件、桌面签名清单、18 项集合、GitHub→CNB 镜像和最后的 stable feed。失败或证据未知时停在发布器状态中，不让客户端发现 v1.0.58。
- 该阶段属于正式发布动态证据；当前候选源码和本文件本身不能把它预先标记为完成。

## 7. 版本与不可变发布边界

- 根包、lockfile、15 个桌面自有插件、Android `1.0.58/1005800`、iOS/iPadOS `1.0.58/10058`、桌面移动路由、移动更新示例、Web Search User-Agent、README、CHANGELOG 和 release notes 必须一致。独立集成的 `@zseven-w/dsh-android` 保持自身 `0.1.0-rc.4` 版本，不伪装成桌面产品版本。
- 上一稳定版 `v1.0.57` 的 Tag、资产、签名 APK、组件、镜像与 stable feed 保持不可变。不得移动、覆盖或复用其资产。
- 正式发布前必须在精确 revision 上完成 `npm run verify`、`npm run verify:release`、版本定向测试、browser 专项动态复核、正式云 Windows 资产本机隔离验证和 `git diff --check`。
- 正式发布只允许：

```text
npm run release:publish -- plan --version 1.0.58
npm run release:publish -- run --version 1.0.58
npm run release:publish -- status --version 1.0.58
```

禁止手工上传大型资产、移动 Tag、覆盖旧资产、跳过摘要/签名核验或提前修改 stable feed。
