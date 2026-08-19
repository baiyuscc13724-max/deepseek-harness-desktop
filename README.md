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

把官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 工作台装进 Windows 或 macOS。当前公开稳定包仍为 Windows 版；macOS、iOS/iPadOS 和增量更新位于源码验证阶段，完成真实 Mac/iPhone 测试前不会冒充可下载成品。

项目额外提供女仆鲸桌宠、外观皮肤、DSH 插件市场、主模型与子代理路由、Android/iOS 移动工作台、局域网优先与 WSS/443 端到端加密后备线路，以及经过 SHA-256 校验的完整安装包更新。官方工作台仍然是唯一主界面，没有第二套侧栏和重复设置页。

> Harness Desktop 是社区维护的开源项目，不是 DeepSeek 官方应用，也不代表 DeepSeek 官方背书。

## 下载

当前稳定版：**v1.0.25** · [查看本次更新内容](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.25)

| 版本 | 适合谁 | 下载 |
| --- | --- | --- |
| Windows 中文安装版 | 日常使用；会创建快捷方式并保留原安装位置 | [下载安装包](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.25/Harness-Desktop-1.0.25-win-x64.exe) |
| Windows 便携版 | 不想安装；下载后直接运行 | [下载便携版](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.25/Harness-Desktop-1.0.25-portable-x64.exe) |
| macOS Apple Silicon | M1/M2/M3/M4 系列 Mac | [下载 DMG](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.25/Harness-Desktop-1.0.25-mac-arm64.dmg) |
| macOS Intel | Intel 处理器 Mac | [下载 DMG](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.25/Harness-Desktop-1.0.25-mac-x64.dmg) |
| Android 手机端 1.0.25 | 与桌面端扫码配对、同步会话并授权固定手机操作 | [下载签名 APK](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.25/Harness-Mobile-1.0.25-android-universal.apk) |
| SHA-256 校验文件 | 手动核对本次桌面安装包完整性 | [下载校验文件](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.25/SHA256SUMS.txt) |

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
| 官方 Harness 工作台 | 软件自动启动固定版本的官方运行时，直接进入原生 Web UI |
| 女仆鲸桌宠 | 跟随任务工作、休息、庆祝和进食 TOK；支持抚摸、拖动、屏幕边缘及窗口互动 |
| 外观皮肤 | 从顶部快捷入口切换配色和背景；支持开源主题与自定义外观 |
| DSH 插件与 Skills | 在应用内发现、安装和更新；英文简介自动生成中文摘要，并保留原文 |
| 主模型与子代理 | 子代理可以跟随主模型，也可以单独选择服务商和模型 |
| 协作团队（实验） | 在设置中显式开启；固定负责人协调独立队友、共享依赖任务、同级消息和可恢复会话，默认关闭并限制并发与成员数 |
| 桌面更新 | 国内源优先、全球源自动回退、SHA-256 校验和中文安装引导，并在更新前展示改动内容 |
| 用户配置保护 | 主题、插件和模型路由保存在用户目录，更新官方 Harness 时不会被覆盖 |
| Android / iOS 移动工作台 | 跨 Windows/macOS 扫码配对；局域网优先，异地使用端到端加密 WSS/443；iOS 不提供跨 App 控制 |
| 组件增量更新（源码验证阶段） | Electron Bootstrap 验签、按组件暂存、健康检查和自动回滚；完整安装包始终作为后备 |

## 三步开始

1. 下载并运行中文安装版，或直接打开便携版。
2. 在官方 Harness 设置中添加服务商和模型。
3. 选择一个工作区，开始新会话。

需要换皮肤时点窗口顶部的调色盘；需要桌宠时点女仆鲸入口。插件、Skills、模型和通用设置都在官方设置页面里。

手机同步放在设置页中：首次扫码后会保存受信设备，之后可一键连接或关闭，不必重复扫码。应用优先使用局域网直连；离开同一 Wi-Fi 后使用 443/WSS 盲中继传输端到端加密字节流，EasyTier/Tailscale 保留为可选优化线路。电脑仍需保持 Harness Desktop 运行，中继不会保存或解密 Harness 数据。详细边界见[手机同步架构](docs/MOBILE_SYNC_ARCHITECTURE.zh-CN.md)和[跨平台/WSS 协议](docs/CROSS-PLATFORM-MOBILE.zh-CN.md)。

## 项目边界

Harness Desktop 负责 Windows/macOS 窗口、运行时启动、安装、更新和桌面增强。会话、工作区、权限、终端和智能体能力来自官方 DeepSeek Harness。

- Renderer 没有 Node.js 权限。
- WebView 只允许访问本机 Harness Runtime。
- 外部链接通过受限 IPC 交给系统浏览器。
- 更新只接受项目配置的 HTTPS 安装包；国内镜像不可用时自动换到后备源，并强制匹配公开的 SHA-256。
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
