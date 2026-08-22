# Harness Desktop 1.0.31

## 本次更新

- 完善桌面 Computer Use 的应用策略、Windows 控制链路、确认状态与截图存储边界，并补齐对应自动化测试。
- 扩展本地记忆生命周期、候选审核、作用域与状态管理，完善记忆管理界面和桌面记忆工具。
- 优化 Agent Teams、浏览器侧栏和桌面插件交互，保留既有权限确认、敏感数据保护和不可变发布规则。
- 桌面、插件、Android 与 iOS/iPadOS 源码版本同步到 1.0.31；Android 继续只发布长期证书签名 APK。

## macOS

- macOS 的显式无签名契约、双架构 DMG/ZIP、一键安装助手及云端自检流程与 v1.0.30 完全一致，本版本不作任何改变。
- 未签名包不等同于 Developer ID 签名、Apple 公证或 Gatekeeper 验收；推荐打开 DMG 后使用其中的 `安装.command`。

## 发布与完整性

- 发布绑定唯一不可变 `v1.0.31` Tag。
- 只有本地 Windows 门禁、GitHub 跨平台云构建、签名 Android、签名组件、精确 18 项清单、GitHub→CNB 云镜像全部成功后，才最后提升 stable feed。
- 所有公开资产均提供 SHA-256 校验信息，并由统一可恢复发布器记录真实结果。
