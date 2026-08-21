# Harness Desktop 架构

## 官方工作台与桌面壳分层

DeepSeek Harness 官方 Web UI 是唯一工作台，官方 `@deepseek-ai/dsh` 是会话、工作区、模型、权限、工具、Skills、MCP、终端和 Git Review 的唯一核心实现。桌面仓库不分叉或复制这些后台；升级核心时直接替换经过兼容验证的官方固定版本。

桌面能力属于另一层，通过 Electron 壳、localhost bridge 和可卸载 DSH 插件接入：

```text
Electron Main（Desktop Shell）
  ├─ Runtime Manager ──→ 官方固定版本 @deepseek-ai/dsh web
  ├─ Shell Services ───→ 更新 / 浏览器 / 手机 / Computer Use / 桌宠 / 本机数据
  ├─ Plugin Installer ─→ dsh-desktop-* / dsh-mobile-* / dsh-agent-teams
  └─ BrowserWindow
       ↓ 有限 contextBridge；高权限 IPC 绑定主窗口 webContents
     Desktop Shell Renderer
       ↓ sandboxed localhost-only WebView（独立最小 guest preload）
     DeepSeek Harness 官方 Web UI / Workspace
```

边界规则：

- 新功能优先实现为 `electron/bridge/*` 独立服务或 `plugins/dsh-*` 可插拔插件；
- 不修改 `node_modules/@deepseek-ai/*`，不把官方会话、工作区或工具后台复制进桌面壳；
- 插件可以向官方 Runtime 注册桌面专属工具和设置路由，但用户停用/移除插件后官方核心仍可独立运行；
- 官方核心升级不应要求长期维护一份私有分支；新增功能不得扩大现有表现层兼容补丁。

## Main Process

`electron/main.cjs` 负责：

- 解析、启动和回收固定版本的官方 `dsh web`；
- 创建安全窗口、官方 localhost WebView 和独立权限分区的桌面浏览器；
- 承载桌面更新、签名组件更新、手机 bridge、Computer Use、桌宠、存储与系统集成等壳层服务；
- 把桌面插件安装到独立 `DSH_HOME`，不改官方包源码；
- 对更新、手机控制、模型路由、文件打开等高权限 IPC 执行精确 sender allowlist；
- 执行无 GUI 的打包后自检。

桌面壳不保存第二份模型密钥，也不实现官方文件、终端、Provider、MCP、Skill、Plugin 或 Session 后台；相关设置和执行仍由官方 Harness 负责。

## Renderer 与 Preload

Renderer 负责窗口标题栏、启动状态、桌面设置入口、浏览器/手机/桌宠等壳层界面，并载入官方 Web UI。Preload 暴露的是固定方法集合，包括 Runtime、更新、外观、桌宠、模型路由显示、本地数据管理、浏览器、Computer Use、手机同步和受限系统打开操作；它不是通用 IPC、文件系统或进程执行接口。

所有高权限方法只接受桌面主窗口的 `webContents`。宠物窗口只使用独立 preload 的 `pet:*` 最小通道，官方 WebView 只保留选择工作区等显式允许的官方界面能力。Renderer 本身保持 `nodeIntegration: false`、`contextIsolation: true` 和 `sandbox: true`。

## WebView 安全边界

- 初始地址和后续导航都必须是 `http://127.0.0.1:*` 或 `http://localhost:*`；
- 附加 WebView 时只允许仓库内固定的最小 `guest-preload.cjs`，绝不继承桌面壳 preload，并保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`；
- 父窗口和 WebView 都拒绝新窗口；
- 外部链接只能通过白名单 IPC 交给系统浏览器。

## Runtime 生命周期

默认探测 `127.0.0.1:3080`。如果已有服务，桌面端只连接；否则启动 bundled `@deepseek-ai/dsh web` 并从输出探测实际本地 URL。退出时只停止自己创建的进程树。

Windows 直装版会由桌面壳把官方 Runtime 的 `DSH_HOME`、进程工作目录和 Runtime 解包缓存固定到安装目录下的 `HarnessData`：

- `HarnessData/dsh-home`：官方 Harness 配置、会话与插件；
- `HarnessData/workspace`：官方进程的默认工作目录；
- `HarnessData/runtime`：桌面壳解包的固定版本官方 Runtime；
- `HarnessData/temp`：官方 Runtime、PowerShell 及 Windows ACL 沙箱的临时目录。

桌面壳会在官方 Runtime 的子进程环境中强制覆盖 `DSH_HOME`、`TEMP`、`TMP` 和 `TMPDIR`。因此 Windows 的非“全部权限”模式即使经过官方 ACL 受限启动器，其私有临时目录也会继续留在安装盘，不会因父进程环境重新落回 C 盘。便携版使用便携 EXE 实际所在目录，而不是 Electron 临时解包目录。开发启动、显式 `--user-data-dir` 的隔离启动及 Microsoft Store 沙箱仍使用对应的可写 `userData/HarnessData`。桌面壳不会静默回退到用户主目录，也不会自动搬移或删除旧的 `~/.dsh`；旧数据需要由用户确认后另行迁移或清理。

## 子代理生命周期显示

桌面安装时对固定版本官方子代理目录应用幂等、锚点校验的表现层补丁，不改变会话存储或删除语义：

- “运行中”来自实际 running 状态；“可继续”只表示 continuable 会话待命，不会自行发起模型请求；
- 一次性任务结束后归入“历史”，完整 transcript 原样保留，只读展示；
- 目录提供“当前 / 历史 / 全部”筛选并递归统计嵌套子代理；过滤后按“运行中 → 可继续 → 历史”排序，运行中的后代会提升父分支，同组按可信更新时间倒序且缺失时间保持原序；“当前”为空时仍保持空态，历史只能由用户主动展开；
- 补丁不包含 `removeChild`、`deleteSubagent` 或 `archiveSubagent`，官方 bundle 锚点变化时拒绝继续打包。

这是现存的表现层兼容债务，不是推荐扩展方式：冻结其能力范围，不再新增官方 bundle 补丁；后续逐项迁移到桌面插件或壳层投影后删除。任何会话、工具或存储语义变更都必须留在官方 Harness。

## 本地自动协作边界

Agent Teams Host 将同一固定负责人拥有的本地平级团队投影为一个 ACL scope。`collaboration-broker.js` 负责不透明 HMAC `routeRef`、必要理由/证据、新鲜度、环路、扇出、跳数、冷却和暂停门禁；`collaboration-service.js` 在 Host 私有 `storages/agent_collaboration.json` 中原子持久化 Presence、路由映射、无唤醒 Inbox、跨重启冷却和有界审计。

模型只能调用 `collaboration_discover`、`collaboration_intent` 和 `collaboration_inbox`，返回值不包含原始 `sessionId`。Intent 一次只允许一个目标；当前没有 L2 自动唤醒授权，所有唤醒请求都会降级为静默 Inbox。暂停发送方被拒绝，暂停目标不被唤醒，且旧投递跨 `pauseEpoch` 后变为 stale。该 Host 工具边界当前不允许跨根或跨用户协作，也不注册 LAN 网络端点。

项目协作后续层已有一组不联网的可测试核心：`project-collaboration.js`（不透明身份、RBAC、Ed25519 事件和离线游标）、`project-state-store.js` + `project-authority-service.js`（外部注入且不落盘的密钥、AES-256-GCM、fsync/rename、revision CAS、rollback 门禁和写后发布）、`project-secure-channel.js`（LAN/WSS 共用的 X25519 E2EE 定向数据包、签名、TTL、重放与 pinned mTLS peer 门禁）、`project-lan-transport.js`（默认关闭、只允许显式私网地址的 TLS 1.3/mTLS/ALPN 有界监听适配器）、`project-wss-relay-transport.js`（复用现有 blind relay、只路由加密包并在签名准入后绑定设备）、`workspace-authority.js` + `workspace-authority-service.js`（隔离 Lease/Claim/ChangeSet/Merge/Artifact、HMAC 快照、加密 revision CAS、Git Head CAS 写前日志与崩溃恢复）、`git-workspace-adapter.js`（固定受信 Git、bare Authority、隔离 worktree、真实 cherry-pick 冲突、精确 ref CAS，以及经 CAS 传输后重算 parent/files/diff/tree 的 bundle 准入）、`artifact-cas.js`（分块 digest/offset 门禁、原子去重、回读和损坏检测）、`quality-evidence.js` + `test-orchestrator.js` + `test-orchestrator-service.js`（签名 TestAttestation、精确 Gate Receipt、无任意命令的 merge/nightly/release 队列、Runner 租约/重试/暂停以及加密 CAS 持久化）、`defect-lifecycle.js` + `defect-lifecycle-service.js`（Signal 到 ReleaseObservation 的加密 CAS 状态机），以及 `external-defect-connectors.js` + `external-defect-outbox.js`（GitHub/GitLab/Jira 临时凭据、验签 webhook、幂等 marker 与崩溃安全 Outbox）。它们故意尚未注册为模型工具或生产监听服务；LAN/WSS adapter 只能由后续项目策略显式启用，真实证书/Pin/relay room 配置、项目服务注册、真实 Runner 进程/容器适配器和各平台管理员凭据配置仍须作为独立适配层接入，不能绕过这些核心门禁。

## 服务商额度协议

额度由桌面主进程读取，Renderer 只接收不含凭据的版本化快照。通用界面只识别 `balance`、`usage-window`、`spending-budget` 和 `token-counter` 四种计量类型，并统一处理实时、缓存、需授权、不支持和刷新失败状态。

内置适配器位于 `electron/bridge/provider-meter-adapters`，启动时自动发现；新增服务商只需增加一个实现 `createAdapter()` 的适配器文件，不需要修改额度注册表或界面。DeepSeek 适配器读取官方余额，Codex 适配器优先使用 Harness 已登录 OAuth 直接查询官方 WHAM，用本机官方 Codex 客户端作为无 Harness 凭据时的后备。OpenCode Go 仅凭模型 API key 无法查询套餐用量时会明确显示需账户授权，并指向官方账户页，不用固定上限伪装实时结果。

## 更新边界

桌面版与核心更新是两条独立链路。桌面版优先读取 CNB 国内发布源，CNB 不可用时回退到 GitHub；资产可以通过 `mirror_urls` 声明镜像与全球后备地址。更新清单地址来自通用 JSON 配置，资产地址来自发布时的 URL 模板，因此以后替换发布仓库只改配置，不改下载器源码。`HARNESS_DESKTOP_UPDATE_FEEDS` 可用分号配置多个清单地址，旧的单地址变量继续兼容。

桌面 `release-manifest.json` 保持旧客户端可忽略新增字段的数组结构，但每条 release 都增加域分离 `kind`、`keyId` 和 Ed25519 `signature`。新客户端使用打包内置、与签名组件一致的审计公钥先验签，再解析版本、发布页和资产；用户或环境只能替换 feed，不能替换 trust root。发布器在首个发布阶段前做签名预检，并在 GitHub 清单提交、CNB 镜像和最终双云同字节检查前反复验签。

下载器会拒绝伪装成安装包的 HTML、JSON 或 XML 响应，对清单、校验文件和安装包执行有界手动重定向、HTTPS/来源校验和超时控制，并检查最大尺寸、签名清单声明尺寸和 SHA-256。任一源校验失败都会删除该源留下的残片并切换下一源；只有 `SHA256SUMS.txt` 与最终文件完全匹配已签名声明才启动原位升级。镜像配置、注册信息和打包 AI 的发布步骤见[更新镜像接入说明](UPDATE-MIRRORS.zh-CN.md)。

核心版本查询依次使用 npmmirror、npm 官方 Registry 和官方 GitHub manifest。核心代码与桌面补丁一起打包并经过兼容验证，不在安装目录内直接运行包管理器或静默替换代码；因此官方先发布新核心时，界面会明确显示“随桌面兼容版更新”，而不是显示一个无法执行的更新动作。

开发与打包使用 `package.json` 中的 Electron 和 electron-builder 国内二进制镜像配置，避免无代理环境在下载打包工具时访问 GitHub 超时。这只影响公开构建依赖，不改变应用运行时的用户代理设置。

`AppStateStore` 只保存自动检查开关、发布通道和最后检查时间。

## 打包后自检

`--self-test` 不创建窗口，验证：

- Renderer 入口存在；
- bundled Harness 可解析；
- 内置 Node Runtime 满足最低要求；
- userData 可写；
- 官方 Web 工作台路径仍启用。

Release 工作流还会启动 Windows unpacked 程序执行该自检，并检查 Inno Setup 实际安装目录中的 EXE 与 `app.asar`，随后执行静默卸载。
