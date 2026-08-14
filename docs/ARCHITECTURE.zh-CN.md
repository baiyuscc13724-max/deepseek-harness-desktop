# Harness Desktop 架构

## 单一工作台原则

DeepSeek Harness 官方 Web UI 是唯一工作台。桌面端不复制会话、工作区、模型、权限、插件、技能、MCP、终端或 Git Review 功能。

```text
Electron Main
  ├─ Runtime Manager ──→ bundled @deepseek-ai/dsh web
  ├─ UpdateService ────→ GitHub Releases + DeepSeek 官方 manifest
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

## 更新边界

桌面版与核心更新是两条独立链路。桌面版读取项目 GitHub Releases，选择 Windows 中文安装包，下载后强制核对同一 Release 中的 `SHA256SUMS.txt`，校验通过才启动原位升级；安装版与便携版都可进入这条升级链路。核心读取 DeepSeek 官方 manifest，发现新版本时只提示维护者和用户，不在安装目录内直接运行包管理器或静默替换代码。

`AppStateStore` 只保存自动检查开关、发布通道和最后检查时间。

## 打包后自检

`--self-test` 不创建窗口，验证：

- Renderer 入口存在；
- bundled Harness 可解析；
- 内置 Node Runtime 满足最低要求；
- userData 可写；
- 官方 Web 工作台路径仍启用。

Release 工作流还会启动 Windows unpacked 程序执行该自检，并检查 Inno Setup 实际安装目录中的 EXE 与 `app.asar`，随后执行静默卸载。
