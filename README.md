# Harness Desktop

[![Release](https://img.shields.io/github/v/release/baiyuscc13724-max/deepseek-harness-desktop?include_prereleases)](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases)
[![License](https://img.shields.io/github/license/baiyuscc13724-max/deepseek-harness-desktop)](LICENSE)

Harness Desktop 是面向 Windows 的开源桌面客户端，直接运行并显示官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI。

本项目由社区维护，不是 DeepSeek 官方应用，也不代表 DeepSeek 官方背书。

## 下载

当前版本：`v1.0.0`

- [Windows 中文安装版](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.0/Harness-Desktop-1.0.0-win-x64.exe)
- [Windows 便携版](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.0/Harness-Desktop-1.0.0-portable-x64.exe)
- [SHA-256 校验文件](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.0/SHA256SUMS.txt)

安装版按当前用户安装，不要求管理员权限；便携版可以直接运行。模型和密钥在官方 Harness 设置中管理，本项目不保存第二份 Provider 配置。

## 为什么做这个项目

官方 Harness 已经提供完整的工作台。Harness Desktop 只补充桌面运行、Windows 安装和安全更新，不重复实现会话、工作区、模型、权限、插件或终端界面。

- 启动应用后自动运行固定版本的官方 Harness，并直接进入官方工作台；
- 只保留一套界面，没有引导页、重复侧栏、顶部黑条或独立桌面设置；
- 桌面版更新和 Harness 核心更新状态嵌入官方“设置 → 通用设置”；
- Windows 桌面版通过仓库发布清单检查更新，避免 GitHub API 匿名限流；
- 下载新安装包后强制校验 `SHA256SUMS.txt`，校验通过才会启动中文升级程序；
- 在官方“设置”内增加外观皮肤：内置多款开源配色、Deep Whale 女仆工坊皮肤和自定义颜色/背景图，双击卡片即可应用；
- 桌面壳顶部提供独立“皮肤”快捷窗，双击应用后自动关闭，不必先打开完整设置；
- 在官方“模型”设置中增加主模型与子代理的直接选择；子代理可跟随主模型或单独指定，配置保存在用户目录并可跨官方更新保留；
- 在官方设置中内置实时 DSH 插件市场，可直接安装和更新社区插件；用户插件不会被桌面版或 Harness 核心更新覆盖；
- 应用、安装包、便携版和卸载列表使用 DeepSeek 鲸鱼图标。

## 皮肤许可说明

桌面壳代码采用 MIT 许可证。内置配色保留各上游项目许可证；Deep Whale 女仆工坊图片来自 [`Small-tailqwq/dsh-deep-whale`](https://github.com/Small-tailqwq/dsh-deep-whale)，单独采用 **CC BY-NC-SA 4.0**，不得用于商业用途。完整来源和署名见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 开发与验证

需要 Node.js 24、npm 和 Git。

```bash
npm install
npm run dev
```

```bash
npm run verify
npm run verify:release
npm run dist
```

Renderer 没有 Node.js 权限。WebView 仅允许访问本机 Harness HTTP Runtime；外部链接通过受限 IPC 交给系统浏览器。桌面更新只接受 GitHub Release 提供的 HTTPS 安装包，并强制匹配 SHA-256。

更多信息见 [安全说明](SECURITY.md) 和 [架构说明](docs/ARCHITECTURE.zh-CN.md)。

## English

Harness Desktop is an open-source Windows desktop client that launches and displays the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI.

The project adds desktop startup, Windows packaging, verified self-updates, and an appearance panel inside the official settings surface without rebuilding the official workbench. It ships a Simplified Chinese installer and a portable executable. Desktop updates are downloaded from GitHub Releases and must match the published SHA-256 checksum before installation.

Harness Desktop is community-maintained. It is not an official DeepSeek application and is not endorsed by DeepSeek.

## License

The desktop shell is released under the [MIT License](LICENSE). The bundled Deep Whale artwork is separately licensed under CC BY-NC-SA 4.0 and is non-commercial. Third-party components and notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
