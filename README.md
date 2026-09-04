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

项目额外提供女仆鲸桌宠、桌面/手机独立外观皮肤、DSH 插件市场、受管 Skills 与 Codex 风格 `@`/`$` 触发、集成终端、主模型与子代理路由、Android/iOS 移动工作台、原生 WebRTC P2P 直连与 WSS/443 端到端加密后备线路，以及经过 SHA-256 校验的完整安装包更新。官方工作台仍然是唯一主界面，没有第二套侧栏和重复设置页。

> Harness Desktop 是社区维护的开源项目，不是 DeepSeek 官方应用，也不代表 DeepSeek 官方背书。

## 下载

下一发布候选：**v1.0.59** · 上一稳定版：**v1.0.58** · [查看候选更新内容](release-notes.md)

> 已发布的 `v1.0.58`、其精确 Tag、Release 资产、组件、签名 Android APK、`release-manifest.json` 与 stable feeds 保持不可变。候选 `v1.0.59` 将官方 Harness 完整依赖图升级到 `0.1.2-alpha.5`，增强 Agent Teams 的全局自动接力、精确 lifecycle/admission、实时状态、Unicode 路径边界与热冷账本；投影缓存默认关闭并提供 `disabled | shadow | enabled` 可回滚三态，空 automatic round 不耗 Goal 追加预算。发送后控制、长会话最新区域和整枚“子代理会话：可继续”芯片也按单一键盘/至少 44×44 目标收敛，同时为 Mobile Sync、Schedule、设备预览和缓存维护补齐无损可靠性与性能改进。
>
> `v1.0.59` 尚未发布，也尚未进入 stable feed。下表继续提供不可变的 `v1.0.58` 稳定资产；新版本只有在安全审查、全量与移动门禁、正式云构建/签名和双云核对全部完成后，才会由唯一 resumable publisher 创建并让客户端发现。完成前请以[永久最新版下载页](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest)为准。
>
> 此前的官方 `0.1.2-alpha.4` 与更早版本仅保留为可复核的历史迁移基线，不再描述当前候选运行时。

| 版本 | 适合谁 | 下载 |
| --- | --- | --- |
| Windows 中文安装版 | 日常使用；会创建快捷方式并保留原安装位置 | [下载安装包](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.58/Harness-Desktop-1.0.58-win-x64.exe) |
| Windows 便携版 | 不想安装；下载后直接运行 | [下载便携版](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.58/Harness-Desktop-1.0.58-portable-x64.exe) |
| macOS Apple Silicon | M1/M2/M3/M4 系列 Mac | [下载 DMG](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.58/Harness-Desktop-1.0.58-mac-arm64.dmg) |
| macOS Intel | Intel 处理器 Mac | [下载 DMG](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.58/Harness-Desktop-1.0.58-mac-x64.dmg) |
| Android 手机端 1.0.58 | 扫码配对、四域工作台、原生输入、受限文档上传与固定手机控制 | [下载签名 APK](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.58/Harness-Mobile-1.0.58-android-universal.apk) · [SHA-256](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.58/Harness-Mobile-1.0.58-android-universal.apk.sha256) |
| SHA-256 校验文件 | 手动核对本次桌面安装包完整性 | [下载校验文件](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.58/SHA256SUMS.txt) |

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
| 官方 Harness 工作台 | 维护依赖及完整 required/optional DSH 图统一精确固定为官方 `0.1.2-alpha.5`；branded session sequence、事件所有权、projector/node-store、Host follow-up queue、轮次导航、附件队列、断线重连、Schedule catalog、turn-outline projection、Remote stream 与受限 lifecycle/activation seam 使用 alpha.5 合同，关键 capability artifacts 以精确哈希和语义片段双重校验，漂移即 fail closed。自研 Project/Team、canonical-project 隔离、submission acceptance ledger、routing receipts、locks/recovery/cursors/evidence 仍是唯一权威，官方 experimental Team 不接管也不双写。当前候选仍受 hermetic 终验和唯一 resumable publisher 硬门禁约束 |
| 女仆鲸桌宠 | 感知结构化任务节奏并主动提醒，记录本地默契、每日进度与连续完成；支持 TOK、抚摸、拖动、屏幕边缘及窗口互动，不读取对话正文或屏幕 |
| 外观皮肤 | 从顶部快捷入口切换桌面配色和背景；手机端拥有独立皮肤设置与不透明核心表面，不会读取或套用电脑壁纸文件 |
| DSH 插件与 Skills | 在应用内发现、安装和更新；随包受管 Skills 支持 Codex 风格 `$` 触发，`@` 继续用于文件引用；英文简介自动生成中文摘要并保留原文 |
| 主模型与子代理 | 子代理可跟随主模型或单独选模型；目录区分运行中、可继续与只读历史，结束任务不会删除完整记录 |
| 协作团队（实验） | 启用后自动判断：简单任务由主模型 solo；一个独立辅助使用普通 `subagent`；至少两个持续独立工作流且需要依赖、交接或文件边界时才建团队。计划按 `draft → committed → active` 持久化，成员启动与扩员提案都必须绑定真实任务；认领和 admission 带 attempt/claim/lease/generation/run fencing，Stop、两阶段 Resume、同项目 handoff/adopt、晚到生命周期与未验证 checkpoint 均保留审计。“自动接力”由版本化全局 Host 设置证明持久化，每个目标固定追加 1–200 轮（默认 200），仍须精确绑定 root/project/goal/team/pause/plan/settings/authorization epoch，不能靠开关、静态请求头或普通 Goal round 伪造。任务与诊断经权威状态流实时更新，relay queued 只表示本机排队；显式 Stop、跨项目、权限/能力/副作用不明仍 fail closed。详见[代理团队用户指南](docs/AGENT-TEAMS-USER-GUIDE.zh-CN.md) |
| 内置浏览器 | 对齐 Codex 的可见导航、交互、检查与停止能力；来源/actor、站点授权、导航、敏感动作、文件/下载、取消与审计继续经过动态安全门禁，最终发布结论以真实 Electron 专项复核为准 |
| 桌面更新 | Ed25519 签名发布清单、国内源优先、全球源自动回退、逐跳 HTTPS 与 SHA-256 校验，并在更新前展示改动内容 |
| 用户配置保护 | 主题、插件和模型路由保存在用户目录，更新官方 Harness 时不会被覆盖 |
| MCP 连接 | 设置页管理官方 MCP 客户端的 stdio 与 Streamable HTTP 连接；秘密只保存凭据引用，启用本地进程前明确确认 |
| 可观察定时任务 | 复用官方 Schedule append-only events；查看当前会话任务、精确 ID、下次运行和逾期状态。15 秒刷新支持 ETag/304 与 since delta，出现 gap、rewind 或 generation 分叉即回退一次权威 full replay；任务不唤醒系统，关闭会话后只会在恢复时补投递 |
| 文件上传、下载和编辑 | 用户主动把文件导入工作区 `uploads/`，下载工作区内普通文件；编辑通过官方 `read` / `edit` 工具准备为待检查草稿，不绕过文件策略 |
| 右侧工作区与会话附件 | 工作区覆盖在官方会话右侧，不压缩聊天区域；文本、源码、HTML、图片、音频、视频与 PDF 按路径/MIME/大小边界只读预览。活动 preview 与 durable evidence 分域，只有明确截图才持久化；工具结果附件仍按真实会话归属投递并可从时间线重新定位 |
| 设备工作区 | 在同一右栏查看并操作已授权的 Windows 桌面流或已配对 Android 手机；活动桌面帧留在有界内存，Android 使用每设备一个 2 fps persistent stream，来源、比例、坐标空间、控制状态和停止入口保持可见，未授权或能力缺失时不猜测操作 |
| 集成终端 | 仅供用户在桌面壳中打开固定 PowerShell、CMD、Git Bash、WSL 或系统默认 shell；终端数量和输入有界，不作为模型的任意 Shell/脚本旁路 |
| 自适应进度 | 按计划、里程碑、失败与阻塞等语义事件显示“当前 / 已完成 / 下一步”，不按固定步数、工具数或时间刷屏 |
| 自动本地记忆与缓存 | 显式开启后低干扰使用，只保存稳定偏好和项目约束；敏感信息硬过滤。自动维护使用 cache-only 窄扫描并在不确定时只预览、fail closed；托盘“数据与隐私”保留查看、关闭、手动预览/应用和全部删除，不宣称模型自训练 |
| Android / iOS 移动工作台 | 跨 Windows/macOS 扫码配对；Mobile Sync v6 使用 canonical snapshot、bounded delta journal 与原子 heartbeat/端口记录，保留可逆 v5 备份。四域导航保持稳定项目/会话身份，当前官方 contenteditable、长文本、键盘、附件、语音、Stop/排队与任务栏锚定继续由官方状态机拥有；文档经已配对设备鉴权、POST intent、50 MiB 上限和官方工作区上传路径导入。局域网优先，异地协商原生 WebRTC P2P，失败时保持端到端加密 WSS/443 后备；秘密由操作系统加密存储，iOS 不提供跨 App 控制 |
| 个人 WSS 中转 | 在“手机与远程同步”中检测并保存自己的无凭据 `wss://` 地址；服务仅承担 P2P 信令与加密帧盲转发，强制容量、速率和背压上限，仓库附 Caddy/systemd 部署示例 |
| Computer Use | 在“设置 → 插件 → 插件配置”授权后直接捕获并控制整个 Windows 虚拟桌面（含多屏），不再选择单个窗口，也不设置内容级敏感操作过滤；永久授权会在启动时自动恢复，锁屏/挂起期间暂停，Esc/停止/撤销可立即收回控制 |
| 签名组件增量更新 | 生产 Ed25519 验签、CNB 优先/GitHub 后备、按组件暂存、健康检查和自动回滚；完整安装包始终作为后备 |

## 三步开始

1. 下载并运行中文安装版，或直接打开便携版。
2. 在官方 Harness 设置中添加服务商和模型。
3. 选择一个工作区，开始新会话。

需要换皮肤时点窗口顶部的调色盘；需要桌宠时点女仆鲸入口。插件、Skills、模型和通用设置都在官方设置页面里。

手机同步放在设置页中：首次扫码后会保存受信设备，之后可一键连接或关闭，不必重复扫码。应用优先使用局域网直连；离开同一 Wi-Fi 后由个人 443/WSS 完成信令并协商原生 WebRTC P2P DataChannel，直连受网络限制时自动回退到同一端到端加密盲中继，EasyTier/Tailscale 保留为可选线路。电脑仍需保持 Harness Desktop 运行，中继不会保存或解密 Harness 数据。详细边界见[手机同步架构](docs/MOBILE_SYNC_ARCHITECTURE.zh-CN.md)和[跨平台/WSS 协议](docs/CROSS-PLATFORM-MOBILE.zh-CN.md)。

## 项目边界

Harness Desktop 负责 Windows/macOS 窗口、运行时启动、安装、更新和桌面增强。会话、工作区、权限和智能体核心能力直接采用官方 DeepSeek Harness，不维护私有核心分支。新增桌面能力只进入 Electron bridge 或可卸载的 `dsh-*` 桌面插件；移除这些插件后官方工作台仍能独立运行。

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
