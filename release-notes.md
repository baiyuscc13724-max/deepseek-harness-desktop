# Harness Desktop 1.0.30

## 本次更新

- 汇总近期已完成的功能修复与体验优化，覆盖会话与附件体验、项目入口、文件插件、主题与外观、壁纸库、模型路由及 Agent Teams 交互。
- 保持既有安全边界、权限确认、敏感数据保护和不可变发布规则不变。
- 桌面、插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.30；Android 继续只发布长期证书签名 APK，iPhone/iPad 继续使用 Safari 工作台。

## macOS

- macOS 的显式无签名契约、双架构 DMG/ZIP、一键安装助手及云端自检流程与 v1.0.29 完全一致，本版本不作任何改变。
- 未签名包不等同于 Developer ID 签名、Apple 公证或 Gatekeeper 验收；推荐打开 DMG 后使用其中的 `安装.command`。

## 发布与完整性

- 发布绑定唯一不可变 `v1.0.30` Tag。
- 只有本地 Windows 门禁、GitHub 跨平台云构建、签名 Android、签名组件、精确 18 项清单、GitHub→CNB 云镜像全部成功后，才最后提升 stable feed。
- 所有公开资产均提供 SHA-256 校验信息，并由统一可恢复发布器记录真实结果。
