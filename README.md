# Harness Desktop for Windows & macOS

<p align="center">
  <img src="docs/assets/harness-desktop-hero.jpg" alt="Harness Desktop：DeepSeek Harness 中文 Windows 桌面版，带桌宠、主题和插件市场" width="100%">
</p>

<p align="center">
  <a href="https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/baiyuscc13724-max/deepseek-harness-desktop?label=%E7%A8%B3%E5%AE%9A%E7%89%88"></a>
  <a href="https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/baiyuscc13724-max/deepseek-harness-desktop/total?label=%E4%B8%8B%E8%BD%BD"></a>
  <a href="https://github.com/baiyuscc13724-max/deepseek-harness-desktop/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/baiyuscc13724-max/deepseek-harness-desktop?style=flat&label=Stars"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/baiyuscc13724-max/deepseek-harness-desktop"></a>
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows">
  <img alt="macOS source preview" src="https://img.shields.io/badge/macOS-12%2B%20source%20preview-000000?logo=apple">
</p>

把官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 工作台装进 Windows 或 macOS。公开稳定包目前以 Windows 为正式支持平台；macOS DMG 与已签名 Android 客户端作为公开预览提供，macOS 仍等待真实 Apple 硬件完成正式验收。iPhone/iPad 在没有 Apple Developer 会员时继续使用 Safari 实时工作台，不分发无法公开安装的未签名 IPA。

项目额外提供女仆鲸桌宠、外观皮肤、DSH 插件市场、主模型与子代理路由、Android/iOS 移动工作台、局域网优先与 WSS/443 端到端加密后备线路，以及经过 SHA-256 校验的完整安装包更新。官方工作台仍然是唯一主界面，没有第二套侧栏和重复设置页。

> Harness Desktop 是社区维护的开源项目，不是 DeepSeek 官方应用，也不代表 DeepSeek 官方背书。

## 下载

当前稳定版：**v1.0.40** · [查看本次更新内容](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.40)

| 版本 | 适合谁 | 下载 |
| --- | --- | --- |
| Windows 中文安装版 | 日常使用；会创建快捷方式并保留原安装位置 | [下载安装包](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.40/Harness-Desktop-1.0.40-win-x64.exe) |
| Windows 便携版 | 不想安装；下载后直接运行 | [下载便携版](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.40/Harness-Desktop-1.0.40-portable-x64.exe) |
| macOS Apple Silicon | M1/M2/M3/M4 系列 Mac | [下载 DMG](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.40/Harness-Desktop-1.0.40-mac-arm64.dmg) |
| macOS Intel | Intel 处理器 Mac | [下载 DMG](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.40/Harness-Desktop-1.0.40-mac-x64.dmg) |
| Android 手机端 1.0.40 | 与桌面端扫码配对、同步会话并授权固定手机操作 | [下载签名 APK](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.40/Harness-Mobile-1.0.40-android-universal.apk) |
| SHA-256 校验文件 | 手动核对本次桌面安装包完整性 | [下载校验文件](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.40/SHA256SUMS.txt) |

[进入永久最新版下载页](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest) · Windows 10/11 x64

安装版按当前用户安装，不要求管理员权限。模型和密钥由官方 Harness 设置管理，桌面壳不会保存第二份 Provider 密钥。

使用 [Scoop](https://scoop.sh) 的用户可以从项目软件源安装，清单会核对同一 GitHub Release 发布的 SHA-256：

```powershell
scoop bucket add harness-desktop https://github.com/baiyuscc13724-max/scoop-harness-desktop
scoop install harness-desktop/harness-desktop
```

## 这版有什么

| 功能 | 使用方式 |
| --- | --- |
| 官方 Harness 工作台 | 固定使用官方 `0.1.1-rc.2` 原生 Web UI；视觉模型、Files API 图片复用与预处理、文件/会话 `@` 引用、Claude Code/Codex Profile Bundle 和持久 PowerShell 均直接采用官方实现 |
| 女仆鲸桌宠 | 感知结构化任务节奏并主动提醒，记录本地默契、每日进度与连续完成；支持 TOK、抚摸、拖动、屏幕边缘及窗口互动，不读取对话正文或屏幕 |
| 外观皮肤 | 从顶部快捷入口切换配色和背景；支持开源主题与自定义外观 |
| DSH 插件与 Skills | 在应用内发现、安装和更新；英文简介自动生成中文摘要，并保留原文 |
| 主模型与子代理 | 子代理可跟随主模型或单独选模型；目录区分运行中、可继续与只读历史，结束任务不会删除完整记录 |
| 协作团队（实验） | 启用后自动判断：简单任务由主模型 solo；无活动团队且只有一个独立一次性辅助时用官方普通 `subagent`；至少两个需交给不同成员的持续独立工作流且需要依赖、交接或文件边界时才建团队。成员是可见、持久责任主体，禁止调用 `subagent` / `subagent_fork` / `workflow` / `ralph`；扩员由 root 创建正式成员，防止绕过 `maxMembers` / `maxActiveTurns`、冲突检查和关停；详见[代理团队用户指南](docs/AGENT-TEAMS-USER-GUIDE.zh-CN.md) |
| 桌面更新 | Ed25519 签名发布清单、国内源优先、全球源自动回退、逐跳 HTTPS 与 SHA-256 校验，并在更新前展示改动内容 |
| 用户配置保护 | 主题、插件和模型路由保存在用户目录，更新官方 Harness 时不会被覆盖 |
| MCP 连接 | 设置页管理官方 MCP 客户端的 stdio 与 Streamable HTTP 连接；秘密只保存凭据引用，启用本地进程前明确确认 |
| 可观察定时任务 | 复用官方 Schedule；查看当前会话任务、精确 ID、下次运行和逾期状态。任务不唤醒系统，关闭会话后只会在恢复时补投递 |
| 文件上传、下载和编辑 | 用户主动把文件导入工作区 `uploads/`，下载工作区内普通文件；编辑通过官方 `read` / `edit` 工具准备为待检查草稿，不绕过文件策略 |
| 自适应进度 | 按计划、里程碑、失败与阻塞等语义事件显示“当前 / 已完成 / 下一步”，不按固定步数、工具数或时间刷屏 |
| 自动本地记忆与缓存 | 显式开启后低干扰使用，只保存稳定偏好和项目约束；敏感信息硬过滤，托盘“数据与隐私”保留查看、关闭、预览和全部删除，不宣称模型自训练 |
| Android / iOS 移动工作台 | 跨 Windows/macOS 扫码配对；局域网优先，异地使用端到端加密 WSS/443；mesh/tunnel 秘密由操作系统加密存储，iOS 不提供跨 App 控制 |
| 签名组件增量更新 | 生产 Ed25519 验签、CNB 优先/GitHub 后备、按组件暂存、健康检查和自动回滚；完整安装包始终作为后备 |

## 三步开始

1. 下载并运行中文安装版，或直接打开便携版。
2. 在官方 Harness 设置中添加服务商和模型。
3. 选择一个工作区，开始新会话。

需要换皮肤时点窗口顶部的调色盘；需要桌宠时点女仆鲸入口。插件、Skills、模型和通用设置都在官方设置页面里。

手机同步放在设置页中：首次扫码后会保存受信设备，之后可一键连接或关闭，不必重复扫码。应用优先使用局域网直连；离开同一 Wi-Fi 后使用 443/WSS 盲中继传输端到端加密字节流，EasyTier/Tailscale 保留为可选优化线路。电脑仍需保持 Harness Desktop 运行，中继不会保存或解密 Harness 数据。详细边界见[手机同步架构](docs/MOBILE_SYNC_ARCHITECTURE.zh-CN.md)和[跨平台/WSS 协议](docs/CROSS-PLATFORM-MOBILE.zh-CN.md)。

## 项目边界

Harness Desktop 负责 Windows/macOS 窗口、运行时启动、安装、更新和桌面增强。会话、工作区、权限、终端和智能体核心能力直接采用官方 DeepSeek Harness，不维护私有核心分支。新增桌面能力只进入 Electron bridge 或可卸载的 `dsh-*` 桌面插件；移除这些插件后官方工作台仍能独立运行。

- Renderer 没有 Node.js 权限。
- WebView 只允许访问本机 Harness Runtime。
- 外部链接通过受限 IPC 交给系统浏览器。
- 更新清单必须通过内置 Ed25519 公钥验签；安装包每一跳保持 HTTPS，国内镜像不可用时自动换到已签名清单声明的后备源，并强制匹配清单尺寸和 SHA-256。
- 用户插件和外观设置不会随官方 Harness 更新被覆盖。
- 手机端只通过带设备鉴权、可切换线路的适配层加载当前官方工作台，不绑定官方内部 API；官方页面和协议变化不会形成两套客户端维护负担。

安全边界见 [SECURITY.md](SECURITY.md)，实现结构见 [架构说明](docs/ARCHITECTURE.zh-CN.md)，国内多源发布见[更新镜像接入说明](docs/UPDATE-MIRRORS.zh-CN.md)。

## 开发

需要 Node.js 24、npm 和 Git。

```bash
npm install
npm run dev
```

提交前运行：

```bash
npm run verify
npm run verify:release
npm run dist
```

## 许可与署名

桌面壳代码采用 [MIT License](LICENSE)。内置配色保留各上游项目许可证。

Deep Whale 女仆工坊图片来自 [`Small-tailqwq/dsh-deep-whale`](https://github.com/Small-tailqwq/dsh-deep-whale)，单独采用 **CC BY-NC-SA 4.0**，不得用于商业用途。完整来源和署名见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## English

Harness Desktop is a community-maintained Windows and macOS client for the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. The current public stable artifact remains Windows-only; macOS and iOS/iPadOS are source previews pending real Apple hardware validation. The project bundles the local runtime and adds verified updates, mobile pairing, a desktop pet, themes, in-app DSH plugin discovery, and model routing.

Download the current stable build from [GitHub Releases](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest). The project is unofficial and is not endorsed by DeepSeek.
