# Harness Desktop 1.0.27

## 官方 Harness rc.8

- 官方运行时从 `0.1.0-rc.7` 升级到 `0.1.0-rc.8`，直接采用官方原生多模态、`/goal` 与 `/plan` 图文输入、文件/会话 `@` 引用，以及图片体积与历史载荷控制。
- Claude Code 与 Codex 子代理改由官方 Profile Bundle 按需安装；Codex 支持非交互权限模式和多个命名实例。
- Windows 终端直接采用官方持久 PowerShell 会话；并带入官方的流式取消续问、OpenAI 兼容网关、并发 `web_search`、子代理 `reportDelivery` 与大历史分叉修复。
- rc.8 的 SQLite 存储结构与旧版不兼容；桌面壳不会自动清理会话、附件或工作区数据，升级前仍建议备份 HarnessData。

## 减少桌面壳重复能力

- 删除桌面壳旧的非图片附件路径注入、附件检查 IPC 与相关测试，文件、会话和图片引用统一交给官方 Harness。
- 删除与 rc.8 多模态处理重叠的历史图片降级兼容路径，不再修改官方消息载荷；模型能力判断与图片裁剪统一由官方实现。
- 桌面壳继续只补官方未覆盖的窗口与安装、双源更新、移动工作台、桌宠与主题、受限 Browser/Computer Use、本地隐私管理和默认关闭的 Agent Teams。

## 桌面体验与长期维护

- 修复极光界面模式使 rc.8 官方设置弹窗被限制在侧栏的问题；界面模式双击后会关闭设置页，并在首页输入区、侧栏和整体材质上显示明确差异。
- 顶栏浏览器入口不再为已隐藏的记忆/缓存按钮保留空槽；Agent Teams 中文界面统一显示为“代理团队”。
- 桌面启动官方 Runtime 固定传入 `--no-open`，不再同时弹出缺少桌面扩展的浏览器页。
- 本地记忆仍只按需召回最多 8 条有限内容；应用自有七天过期缓存除启动维护外，每 24 小时重复安全维护，会话、附件、记忆、工作区和当前 Runtime 永久排除。

## 发布与平台

- 继续使用绑定单一干净提交的可恢复发布编排：本地完成源码、发布契约、Windows 安装包、打包自检和组件回滚门禁；Tag 后由 GitHub Actions 构建并复核 Windows、macOS、Android 与 Apple 模拟器资产。
- Release 先以 draft 汇总并重新下载验 SHA-256，通过后一次性公开；组件包与稳定指针仍验 Ed25519 签名并保持 CNB 优先、GitHub 后备。
- Windows、macOS Intel、macOS Apple Silicon、Android 与 iOS/iPadOS 源码同步到 1.0.27；Android 只发布长期证书签名 APK，iPhone/iPad 继续使用 Safari 实时工作台。
