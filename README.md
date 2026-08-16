# Harness Desktop for Windows

<p align="center">
  <img src="docs/assets/harness-desktop-hero.jpg" alt="Harness Desktop：DeepSeek Harness 中文 Windows 桌面版，带桌宠、主题和插件市场" width="100%">
</p>

<p align="center">
  <a href="https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/baiyuscc13724-max/deepseek-harness-desktop?label=%E7%A8%B3%E5%AE%9A%E7%89%88"></a>
  <a href="https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/baiyuscc13724-max/deepseek-harness-desktop/total?label=%E4%B8%8B%E8%BD%BD"></a>
  <a href="https://github.com/baiyuscc13724-max/deepseek-harness-desktop/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/baiyuscc13724-max/deepseek-harness-desktop?style=flat&label=Stars"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/baiyuscc13724-max/deepseek-harness-desktop"></a>
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows">
</p>

把官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 工作台装进 Windows。打开软件就能使用，不用另外安装 Node.js，也不用在命令行里启动服务。

这版额外提供女仆鲸桌宠、外观皮肤、DSH 插件市场、主模型与子代理路由，以及经过 SHA-256 校验的自动更新。官方工作台仍然是唯一主界面，没有第二套侧栏和重复设置页。

> Harness Desktop 是社区维护的开源项目，不是 DeepSeek 官方应用，也不代表 DeepSeek 官方背书。

## 下载

当前稳定版：**v1.0.16** · [查看本次更新内容](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.16)

| 版本 | 适合谁 | 下载 |
| --- | --- | --- |
| Windows 中文安装版 | 日常使用；会创建快捷方式并保留原安装位置 | [下载安装包](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.16/Harness-Desktop-1.0.16-win-x64.exe) |
| Windows 便携版 | 不想安装；下载后直接运行 | [下载便携版](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.16/Harness-Desktop-1.0.16-portable-x64.exe) |
| SHA-256 校验文件 | 手动核对安装包完整性 | [下载校验文件](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.16/SHA256SUMS.txt) |

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
| 桌面更新 | 后台下载、SHA-256 校验、中文安装引导，并在更新前展示改动内容 |
| 用户配置保护 | 主题、插件和模型路由保存在用户目录，更新官方 Harness 时不会被覆盖 |

## 三步开始

1. 下载并运行中文安装版，或直接打开便携版。
2. 在官方 Harness 设置中添加服务商和模型。
3. 选择一个工作区，开始新会话。

需要换皮肤时点窗口顶部的调色盘；需要桌宠时点女仆鲸入口。插件、Skills、模型和通用设置都在官方设置页面里。

## 项目边界

Harness Desktop 负责 Windows 窗口、运行时启动、安装、更新和桌面增强。会话、工作区、权限、终端和智能体能力来自官方 DeepSeek Harness。

- Renderer 没有 Node.js 权限。
- WebView 只允许访问本机 Harness Runtime。
- 外部链接通过受限 IPC 交给系统浏览器。
- 更新只接受 GitHub Release 的 HTTPS 安装包，并强制匹配公开的 SHA-256。
- 用户插件和外观设置不会随官方 Harness 更新被覆盖。

安全边界见 [SECURITY.md](SECURITY.md)，实现结构见 [架构说明](docs/ARCHITECTURE.zh-CN.md)。

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

Harness Desktop is a community-maintained Windows client for the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. It bundles the local runtime and adds a verified Windows installer, portable build, desktop pet, themes, in-app DSH plugin discovery, model routing, and self-updates.

Download the current stable build from [GitHub Releases](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest). The project is unofficial and is not endorsed by DeepSeek.
