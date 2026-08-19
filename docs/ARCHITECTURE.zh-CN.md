# Harness Desktop 架构

## 单一工作台原则

DeepSeek Harness 官方 Web UI 是唯一工作台。桌面端不复制会话、工作区、模型、权限、插件、技能、MCP、终端或 Git Review 功能。

```text
Electron Main
  ├─ Runtime Manager ──→ bundled @deepseek-ai/dsh web
  ├─ UpdateService ────→ 国内/全球发布源 + DeepSeek 官方 npm manifest
  ├─ AppStateStore ────→ 仅更新偏好
  ├─ Packaged Self-Test
  └─ BrowserWindow
       ↓ 最小 contextBridge / IPC
     Desktop Shell Renderer
       ↓ localhost-only WebView
     DeepSeek Harness 官方 Web UI
```

## Main Process

`electron/main.cjs` 只负责：

- 解析并启动固定版本的官方 `dsh web`；
- 探测本机 Runtime URL；
- 连接既有 Runtime，或回收桌面端自己启动的子进程；
- 创建安全的 Electron 窗口和 localhost-only WebView；
- 检查桌面版与 Harness 核心更新，并安全启动桌面版原位升级；
- 执行无 GUI 的打包后自检。

它不保存模型密钥，也不实现文件、终端、Git、Provider、MCP、Skill、Plugin 或 Session 后台。

## Renderer 与 Preload

Renderer 是轻量加载壳：显示启动状态、载入官方 Web UI，并把更新行嵌入官方通用设置。Preload 只暴露以下能力：

- 启动 Runtime / 读取 Runtime 状态；
- 读取与修改更新偏好 / 立即检查更新 / 下载并安装桌面版更新；
- 在系统浏览器打开 HTTP/HTTPS Release 链接；
- 订阅 Runtime 和更新结果。

Renderer 无 Node.js、文件系统或任意进程启动权限。

## WebView 安全边界

- 初始地址和后续导航都必须是 `http://127.0.0.1:*` 或 `http://localhost:*`；
- 附加 WebView 时清除 preload，并保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`；
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
- 目录提供“当前 / 历史 / 全部”筛选，并递归统计嵌套子代理；
- 补丁不包含 `removeChild`、`deleteSubagent` 或 `archiveSubagent`，官方 bundle 锚点变化时拒绝继续打包。

## 服务商额度协议

额度由桌面主进程读取，Renderer 只接收不含凭据的版本化快照。通用界面只识别 `balance`、`usage-window`、`spending-budget` 和 `token-counter` 四种计量类型，并统一处理实时、缓存、需授权、不支持和刷新失败状态。

内置适配器位于 `electron/bridge/provider-meter-adapters`，启动时自动发现；新增服务商只需增加一个实现 `createAdapter()` 的适配器文件，不需要修改额度注册表或界面。DeepSeek 适配器读取官方余额，Codex 适配器优先使用 Harness 已登录 OAuth 直接查询官方 WHAM，用本机官方 Codex 客户端作为无 Harness 凭据时的后备。OpenCode Go 仅凭模型 API key 无法查询套餐用量时会明确显示需账户授权，并指向官方账户页，不用固定上限伪装实时结果。

## 更新边界

桌面版与核心更新是两条独立链路。桌面版优先读取 CNB 国内发布源，CNB 不可用时回退到 GitHub；资产可以通过 `mirror_urls` 声明镜像与全球后备地址。更新清单地址来自通用 JSON 配置，资产地址来自发布时的 URL 模板，因此以后替换发布仓库只改配置，不改下载器源码。`HARNESS_DESKTOP_UPDATE_FEEDS` 可用分号配置多个清单地址，旧的单地址变量继续兼容。

下载器会拒绝伪装成安装包的 HTML、JSON 或 XML 响应，对校验文件和安装包分别执行超时控制，并检查最大尺寸、清单声明尺寸和 SHA-256。任一源校验失败都会删除该源留下的残片并切换下一源；只有同一 Release 的 `SHA256SUMS.txt` 与最终文件完全匹配才启动原位升级。镜像配置、注册信息和打包 AI 的发布步骤见[更新镜像接入说明](UPDATE-MIRRORS.zh-CN.md)。

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
