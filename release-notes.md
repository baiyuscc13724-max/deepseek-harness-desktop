# Harness Desktop 1.0.58

v1.0.58 候选将官方 Harness 核心兼容升级到 `0.1.2-alpha.4`，修复桌面启动认证、Runtime 并发启动和陈旧进程残留造成的真实失败；把手机同步入口接回可信 shell bridge；并将 Agent Teams 从“耗尽轮次后等待用户回复继续”改为受安全门禁约束的事件驱动自动驾驶。本版本不通过关闭认证、扩大权限、自动重放未知副作用或无限重试换取可用性。

上一稳定版是不可变的 `v1.0.57`。本文件描述候选源码与发布要求，不代表 v1.0.58 已经公开或已进入 stable feed。

## 官方核心 alpha.4、启动、认证与 Runtime 收敛

- 当前随包官方 Harness Runtime 及完整 required/optional DSH 依赖图精确固定为 `0.1.2-alpha.4`；此前的 `0.1.2-alpha.3` 与更早的 `0.1.2-alpha.2` 只作为可复核的历史迁移基线保留，不再描述当前运行时或发布目标。
- Desktop 已适配 alpha.4 的 branded session sequence、事件所有权、projector/node-store 与 Host follow-up queue 合同，并继续通过精确版本、依赖图闭包、产物哈希、语义锚点和幂等 patch 门禁阻止漂移。
- 自研 Agent Teams 的 Host 一次性授权、root/project/body 绑定、runtime epoch 撤销、任务账本与事件驱动自动驾驶仍是唯一权威；官方核心升级没有替代、双写或旁路这些边界。
- 官方工作台 token 跳转由同一个 `persist:harness` Electron session 跟随，使认证 Cookie 在真正承载 WebView/RPC/WebSocket 的 session 内建立；每一跳仍限制为精确 loopback authority，跨来源、缺失 Cookie、循环或非成功 clean `/` 均 fail closed。
- 同一 runtime home 的并发启动使用 singleflight，共享同一在途结果，不再同时拉起多个官方 Runtime。
- 启动前清理能够精确证明属于 Harness Desktop 且已经失去可访问 Web 服务的陈旧进程；PID/身份/归属证据不足时不会猜测终止。
- Runtime readiness 必须通过真实本地 Web 认证链，不以“进程存在”或“端口被占用”冒充成功。
- 可选 MCP 连接和首次工具同步具有启动上界，由 supervisor 收敛；非强制 MCP 不会无限阻塞基础 Web 服务，配置为 fatal 的连接失败仍保持失败语义。

## 手机同步入口

- 官方工作台里的手机同步入口通过受限 guest preload 把固定动作交给可信 Electron shell bridge，再打开已有手机同步面板。
- bridge 不提供通用 IPC 或任意方法转发；只接受受信 guest/webContents 和既定动作。
- 仍只有一个手机同步入口和一份设备状态。配对密钥、局域网/P2P/WSS 传输、权限、撤销与加密边界不变。
- 左侧栏“设置”和“手机同步”现在保留独立点击区与 8px 间距；展开态横向排列，折叠态纵向错开，不再覆盖或连成一个按钮。

## Agent Teams 自动驾驶

- 候选桌面设置新增“自动接力，不用发送继续”，默认关闭，旧配置升级也不会静默开启。用户显式开启后可为每个目标选择固定的 1–200 轮追加上限，默认 200。
- 首个团队必须消费一次性 Desktop Host 授权回执才获得本生命周期权限；回执精确绑定 root、canonical project、active Goal、team、pause epoch 与设置值，不能靠全局开关、静态请求头、模型参数或稍后创建的团队取得权限。只有同 root 下完整、仍存活且事实一致的平级团队，才可继承该授权组。
- 获得授权后，正常成员等待期间 Root 会安全 park，不再消耗轮次轮询，也不再要求用户发送“继续”。成员提交、释放和状态变化通过持久事件在 Root 空闲时合并唤醒，自动继续验收和调度；显式 Stop 或安全 blocker 始终撤销自动权限，仍须人工恢复。
- 自动 park 需要所有未完成内部任务都由 live worker 持有，或沿同一 root 的依赖链最终落到 live producer；支持跨 team 的可证明依赖链。
- 缺失/循环/终态 blocker、跨 root、paused、project 不一致、capability 未验证、文件冲突、effect 非 `none` 或 `outcome_unknown` 均 fail closed，不会 edit/resume/followup/steer。
- 每个 durable transition 最多补一个 goal round，并且只恢复明确的 `round-limit`。达到用户选择的预算，或发生 Host/plugin 重启、Stop、handoff、关闭设置、降低预算、权限确认、外部副作用未知和其他 blocker 时，授权都会停止或撤销。

## Codex 浏览器能力对等

- 候选将可见导航、交互、检查和停止能力置于 Codex 浏览器对等合同下，同时保留来源/actor、站点授权、导航、敏感动作、文件/下载、取消和审计等动态安全门禁。
- 最终验收以 browser 专项代理的真实 Electron 动态证据为准；专项复核完成前，不把静态合同表述成已通过的动态结论。任何失败都阻止发布，不能靠扩大默认授权或跳过门禁补救。

## 发布前：正式云 Windows 资产本机隔离验证

在用户能够检查到 v1.0.58 之前，唯一 resumable publisher 必须：

1. 先让绑定精确 source revision、requestId 和 workflow run 的正式云构建通过全部桌面门禁，再创建不可变 Tag，并公开该 run 产生的桌面 Release 资产；
2. 仅从该公开 Release 的规范 URL 下载正式 Windows x64 便携包，绑定 Release/asset ID、大小、GitHub SHA-256 digest 与 40 位产品提交，并保存到新的版本/提交/validation ID 隔离目录；
3. 使用各自唯一的 Electron userData 与 Harness runtime home 实际运行 packaged `--self-test`，由正式包启动随包 Runtime 的随机端口 token→Cookie→clean `/` 链路，并严格核对产品版本及全部检查项；
4. 只有正式字节和隔离报告都通过并再次核对远端元数据后，才继续签名 Android、签名组件、桌面签名清单、GitHub→CNB 镜像和最后的 stable feed。

本地开发实例、旧 Cookie、已运行 Runtime 或手工上传的资产不能充当该阶段的证据。失败或观测未知时，发布器必须停住，客户端不得发现 v1.0.58。

## 版本身份

- 桌面根包、lockfile 和 15 个自有插件：`1.0.58`
- `@zseven-w/dsh-android`：保持独立集成版本 `0.1.0-rc.4`
- Android：`versionName=1.0.58`、`versionCode=1005800`
- iOS/iPadOS：`MARKETING_VERSION=1.0.58`、build `10058`
- 计划中的正式不可变 Tag：`v1.0.58`
- 上一稳定版：`v1.0.57`，其 Tag、18 项资产、签名 APK、组件、镜像与 stable feed 保持不可变

## 发布门禁

正式发布前仍必须在干净、已提交的精确 revision 上完成：

- `npm run verify`、`npm run verify:release`、版本定向测试和 `git diff --check`；
- Electron 同会话认证、Runtime singleflight/陈旧进程清理/MCP 启动上界、手机同步 bridge、Agent Teams 自动驾驶的定向测试；
- browser 专项真实 Electron 动态复核；
- packaged self-test、Android 与 iPhone/iPad 门禁；
- 正式云 Windows 资产本机隔离验证、云端跨平台构建、签名、精确资产清单和双云一致性验证。

正式制品只能由仓库唯一的 resumable publisher 创建新的不可变 `v1.0.58` Tag。不得手工上传、移动 Tag、覆盖 v1.0.57 资产，或在隔离验证与双云核对完成前提升 stable feed。

## 发布完成后获取更新

以下链接只有在 publisher 完成全部门禁后才代表 v1.0.58 正式版本：

- GitHub Release：[v1.0.58](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.58)
- 永久最新版入口：[GitHub Releases / latest](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest)
- 桌面摘要：[SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.58/SHA256SUMS.txt)
- 组件摘要：[COMPONENT-SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.58/COMPONENT-SHA256SUMS.txt)

若 GitHub 下载受限，可把同一文件名的下载前缀替换为 `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v1.0.58/`。GitHub 与 CNB 文件的大小和 SHA-256 应一致；不一致时不要运行。
