# Harness Desktop 1.0.24

## 桌面能力

- 新增 Codex 风格右栏浏览器、独立持久化 Profile、由用户亲自完成的网站登录，以及按站点、按动作授权的受限 `browser_control`。
- 新增默认关闭的本地 SQLite 跨会话记忆与只读 `local_memory` 有限召回工具；敏感内容默认拒绝保存。
- 新增仅限 Harness Desktop 自身窗口的受限 `computer_use`，支持截图以及逐次确认的点击、输入和滚动；截图按数量与时间自动清理。
- 工作区选择改为由主窗口拥有的原生目录窗口，解决窗口隐藏到后台的问题。
- 新增扫描—预览—确认式存储清理，永久保护会话、附件、记忆、当前运行时和活动临时文件。

## 更新与跨平台

- 新增签名组件增量更新：Ed25519 清单、SHA-256 与逐文件校验、差异组件、暂存、独立助手、原子切换、健康确认、失败回滚及完整安装包兜底。
- 完善 macOS Intel/Apple Silicon 的运行时展开、原生依赖、路径、进程生命周期、托盘、更新资产、签名与公证配置。
- 新增原生 iPhone/iPad 客户端源码：二维码配对、Keychain、WKWebView 工作台、局域网优先与端到端加密 WSS/443 后备线路。
- Windows/macOS 与 Android/iOS 使用相同的 OS 无关配对协议；iOS 不声明 Android 式跨 App 控制或不合规后台能力。
- 手机下载入口按系统分流；Android 支持独立更新检查、APK SHA-256/包名/签名校验和系统确认安装，iOS/iPadOS 只通过 App Store/TestFlight 更新。

## 体积与性能

- 女仆鲸桌宠 280 帧转换为八个无损 WebP 图集，按需加载且最多保留三个已解码图集。
- Windows 包只保留简体中文和英文语言资源，并新增安装包、便携版、ASAR、原生依赖、语言包、桌宠与仓库素材体积门禁。

## 安全与隐私

- 浏览器 Cookie 与官方 Harness 会话完全隔离；密码、Cookie、Authorization、令牌、验证码、支付和银行内容不会提供给模型。
- 本地记忆默认关闭；模型不能保存、修改、删除或整库读取记忆。
- Computer Use 每次启动默认关闭，只能截取和操作 Harness Desktop 自身窗口，不执行 Shell、脚本或任意系统命令。
- 生产组件源、WSS 中继、Android 更新源和 iOS Store 地址默认保持关闭，启用前仍需正式签名与发布配置。

## 验证

- 340 项桌面单元、安全、集成和发布契约测试通过，Android 单元测试通过。
- Windows 隔离包已完成真实组件更新、重启、健康确认和故障回滚；本次整合后的 1.0.24 制品将重新执行同一套打包验证。
- 私有 Apple 云端验证已通过 iPhone Simulator、iPad Simulator、macOS Intel 打包自检和 Apple Silicon 原生依赖检查。
