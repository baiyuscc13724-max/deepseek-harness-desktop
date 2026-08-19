# Harness Desktop 1.0.25

## 外观与交互

- 自定义壁纸新增 GIF、APNG 与动态 WebP，单文件上限为 50 MB。
- 壁纸以前景完整显示，空白区域使用同图模糊填充，避免裁掉主体。
- 面板通透上限提高到 92%，新增“文字保护”控制，在高透明背景下保持文字和占位内容清晰。
- 文字选区重新清晰可见；点击非输入区域、按 Esc 或右键“取消选择”可以清除选区，输入框和可编辑区域的正常选择不受影响。

## 更新可靠性

- 签名组件增量更新已在隔离的 Windows 1.0.24 基线包上完成真实验证：健康的 1.0.25 组件激活成功，损坏的 1.0.26 组件失败后自动回滚到 1.0.25。
- 继续保留完整安装包兜底；生产组件更新源仍默认关闭，不会未经审核公开推送组件。

## macOS 与移动端

- 修复 macOS 包遗漏 `node-pty` 原生运行模块的问题。
- Intel 与 Apple Silicon 均完成独立依赖安装、架构检查、原生模块检查和打包后真实自检。
- iPhone 与 iPad 模拟器测试通过；Android 与 iOS/iPadOS 源码版本同步到 1.0.25。
- Android 正式 APK 必须使用长期 release 密钥；iPhone/iPad 只通过 App Store/TestFlight 安装，不把 debug APK 或未签名 IPA 作为用户发布包。

## 验证

- 342 项桌面单元、安全、集成和发布契约测试通过。
- Android JVM 单元测试与 debug 构建通过；正式 release 签名发布需由发布者配置私有密钥。
- Apple 云端验证通过 iPhone Simulator、iPad Simulator、macOS Intel 打包自检和 Apple Silicon 打包自检。
- GitHub Release 提供 Windows、macOS 与 Linux 桌面制品；CNB 云端镜像提供经大小和 SHA-256 校验的国内下载资源。
