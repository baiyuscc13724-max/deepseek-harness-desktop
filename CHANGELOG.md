# Changelog

## 0.9.0-rc.2

- 直接使用 DeepSeek Harness 官方 Web UI 作为唯一工作台，删除重复的原生会话、项目和聊天界面。
- 启动时自动拉起官方 Web 核心，不再显示首次启动引导或阻止进入工作台。
- 删除顶部黑色桌面栏和独立桌面设置，模型、权限、插件全部使用官方设置。
- 将桌面版与 Harness 官方核心的自动更新检查嵌入官方“设置 → 通用设置”。
- 修复 Windows 进程启动，固定 electron-builder 26.15.7 与 cross-spawn 7.0.6，并用纯简体中文 Inno Setup 替换会在部分机器上被拦截的 NSIS 安装外壳。
- 新增 Windows 安装落盘冒烟检查，并继续保留 packaged self-test 与发布秘密扫描。
- 删除旧原生工作台的 AgentBridge、Session、Provider、Terminal、Git、Workspace、MCP、Plugin、Skill、诊断后台及对应测试。
- 移除桌面壳对 `node-pty` 的直接依赖、SDK client 和真实 Provider 脚本；仅保留官方 Harness 核心自身所需的 native rebuild/ASAR unpack。
- 安装版、便携版、程序文件、快捷方式和卸载列表统一使用官方 DeepSeek 鲸鱼图标，并由发布验证锁定。

## 0.9.0-rc.1

- 新增安装包级 `--self-test` 模式：不创建 GUI，直接验证 Renderer、bundled Harness、userData、Headless Bridge 与 Web Compatibility。
- GitHub Actions Windows 构建在发布前会真实启动 `win-unpacked` 桌面程序执行 self-test；失败则阻断 Release。
- self-test 支持输出脱敏 JSON 报告，不读取项目文件、不输出 API Key。
- 新增 packaged self-test 单元测试与 release contract 校验。
- 新增 Windows RC1 最短人工验收清单，明确自动化与必须实机验证的边界。
- Release workflow 降低默认权限，并增加并发控制与超时。

## 0.8.0

- 新增首次启动向导：环境、模型、工作区完成后进入工作台。
- 新增 DiagnosticsService：检查 Node/Harness/userData/safeStorage/Provider/Workspace/Git/pnpm/Web Runtime。
- 新增脱敏诊断 JSON 导出与 Web Runtime 一键恢复。
- 新增 AppStateStore，持久化 onboarding 完成状态和更新检查偏好。
- 新增 UpdateService，分离 Harness Desktop 与 DeepSeek Harness Core 更新检查；核心不静默自动升级。
- Electron 升级并固定到 43.2.0，使用 Node 24.x 运行时以满足当前 Harness engine 要求。
- Windows NSIS 改为安装向导并允许选择安装目录，保留 portable。
- GitHub Actions tag 构建在三平台全部审计通过后自动创建 GitHub Release，并生成统一 SHA256SUMS.txt。
- smoke tests 扩展至 38 项。

## 0.7.0

- 新增 MCP / Skills / Harness Plugins 原生扩展中心。
- MCP 支持 stdio 与 Streamable HTTP，并以临时 Cordis `--patch` 注入官方 `dsh-mcp-client`。
- MCP 敏感配置优先使用 Electron safeStorage；不可用时不明文落盘。
- Skill 管理遵循 Harness 官方本地发现优先级，`.agents` 兼容来源只读。
- Plugin 管理委托官方 `dsh plugin --profile`，支持 headless / web Profile。
- 增加 Electron 导航/弹窗安全硬化与发布审计脚本。
- 新增 MCP、Skill、Plugin smoke tests。

## 0.6.0

- TerminalManager 新增 `node-pty@1.1.0` 后端、PTY resize、Ctrl+C 中断与 pipe fallback。
- Workspace 新增文件/文件夹创建、重命名和系统回收站/废纸篓删除入口。
- 修正 mutation path 的 symlink 语义：重命名/删除针对 symlink 条目本身，不误操作其真实目标。
- Git Diff 新增结构化 hunk 解析。
- 新增 hunk 级 Stage、Unstage、Discard，并通过当前 patch hash 防止旧 Diff 误应用。
- 新增“计划”Pane，按 Session 持久化展示 Plan、Subagent、Tool、Permission 与状态时间线。
- Preload / IPC 扩展 Workspace mutation、Terminal capability/resize、Git hunk API。
- Release 构建启用 native dependency rebuild。
- smoke tests 扩展至 20 项。

## 0.5.0

- 新增原生项目文件树与按需目录展开。
- 新增 2 MiB 内 UTF-8 文件预览/编辑、原子保存和 mtime 冲突保护。
- 新增工作区路径穿越与 symlink 边界防护。
- 新增真实本地 Shell TerminalManager 与独立 Agent 日志视图。
- Git Review 新增暂存、取消暂存、撤销 tracked 修改；未跟踪文件拒绝自动删除。
- SDK 事件标准化扩展到 `tool/call`、`tool/result`、Plan/Todo、Subagent 与 Permission。
- 新增 Tool/Plan/Subagent/Permission 原生事件卡片。
- 新增仅 localhost / 127.0.0.1 的开发服务器内嵌预览。
- smoke tests 扩展到 16 项。

## 0.4.0

- 新增 OpenCode Go Provider 预设。
- 新增 DeepSeek V4 Flash / Pro 模型选择。
- 新增 Electron safeStorage 密钥持久化；不可用时仅内存保存。
- 新增真实 Provider smoke 脚本。

## 0.3.0

- 原生 Session、Headless AgentBridge、Git Diff、Terminal 日志。
- SDK JSON-RPC 适配入口。
- 官方 Web UI 兼容模式。
