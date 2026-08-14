# Harness Desktop

> Community-maintained Windows desktop shell powered by the official DeepSeek Harness Web UI. This is not an official DeepSeek desktop application.

当前版本：`0.9.0-rc.2`
目标仓库：`baiyuscc13724-max/deepseek-harness-desktop`

Harness Desktop 将固定版本的官方 `@deepseek-ai/dsh` 打包进 Electron，并把 `dsh web` 提供的官方 Web UI 作为唯一工作台。桌面端不再重复实现会话、工作区、模型、权限、插件、终端或 Git 界面。

## 当前行为

- 启动应用后自动启动官方 DeepSeek Harness Web Runtime，并直接进入官方工作台；
- 没有首次启动引导、原生/Web 双模式、重复侧栏、顶部黑条或独立“桌面设置”；
- 模型、Harness 权限、插件、技能、MCP、工作区和会话均由官方工作台管理；
- 桌面版与官方 Harness 核心的更新状态嵌入官方“设置 → 通用设置”；
- 默认在启动后检查更新，用户可在官方设置中关闭；
- 检测到新的桌面版后，可在官方设置中下载、校验并启动中文安装包完成原位升级；
- 桌面程序只停止自己启动的 Harness 进程，不接管用户已经启动的本地服务；
- 安装包、便携版、程序文件与卸载列表统一使用官方 DeepSeek 鲸鱼图标。

## 结构

```text
Harness Desktop
  ├─ Electron 安全窗口与最小 IPC
  ├─ 官方 DeepSeek Harness 运行时启动/回收
  ├─ 桌面版安全升级与官方核心更新检查
  ├─ 打包后自检
  └─ WebView → 官方 DeepSeek Harness Web UI
```

Renderer 没有 Node.js 权限。WebView 只允许访问本机 `127.0.0.1` / `localhost` 的 HTTP Runtime；外部链接只能通过最小白名单 IPC 交给系统浏览器打开。

## 本地开发

建议使用 Node.js 24、npm 与 Git。

```bash
npm install
npm run dev
```

验证：

```bash
npm run verify
npm run verify:release
```

当前自动化覆盖：

- 官方工作台自动启动与单界面静态契约；
- 更新偏好持久化及桌面版/官方核心版本比较；
- 打包后的 Renderer、内置 Harness、Node Runtime 和 userData 自检；
- Electron 导航、WebView、窗口打开和 IPC 安全边界；
- 废弃原生工作台模块、SDK、桌面壳直接 `node-pty` 依赖和旧 Provider 脚本不得重新进入产物；
- 官方应用图标哈希锁定；
- 发布前疑似真实 API Key 扫描。

## 构建

```bash
npm run dist
```

Windows 产物包括：

- 纯简体中文、可选择安装目录、按当前用户安装的 Inno Setup `.exe` 安装包；
- 单文件 `.exe` 便携版。

仓库同时保留 macOS DMG/ZIP 与 Linux AppImage/deb 的 CI 目标。发布工作流会先执行源码验证、打包后自检、Windows 安装落盘检查和产物哈希审计，再创建 GitHub Release。

## 更新策略

桌面版与 Harness 核心分开更新：

```text
GitHub Releases → 下载 Harness Desktop 安装包与 SHA256SUMS
                                  ↓
                         校验后启动中文升级程序
DeepSeek 官方 manifest → 提示新的 Harness 核心版本
                                  ↓
                            兼容性验证与重建
                                  ↓
                           发布新的桌面版本
```

核心版本固定为 `package.json` 中的精确版本，不在用户机器上静默改写依赖。新上游版本先经过自动发现、测试、Windows 安装包验收，再随新的桌面版发布。

## 安全与隐私

- 不要把 API Key、OAuth token、私有工作区内容或本机日志提交到仓库；
- 模型密钥和权限由官方 Harness 工作台管理，本桌面壳不保存第二份 Provider 配置；
- 桌面升级只下载 GitHub Release 提供的 HTTPS 安装包，并强制匹配 SHA-256 校验值；
- 更新检查有超时与响应大小限制；
- `npm run verify` 会扫描源码中的疑似真实密钥。

详见 [SECURITY.md](SECURITY.md) 与 [架构说明](docs/ARCHITECTURE.zh-CN.md)。

## 品牌与许可证

本项目代码按 MIT License 开源，是社区维护的非官方桌面壳，不代表 DeepSeek 官方背书。应用使用的 DeepSeek 鲸鱼图标来自官方 DeepSeek GitHub 品牌资产；软件许可证与商标权相互独立，发行者仍应遵守最新品牌规则。

上游：`https://github.com/deepseek-ai/deepseek-harness`

