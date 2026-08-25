# Harness Desktop 1.0.45

## 本次更新

- 修复 Android 旧系统兼容问题：移除生产代码对 `String.isBlank()` 等高版本 Java/Android API 的依赖，兼容最低支持的 Android API 26，避免 API 26–32 上出现 `NoSuchMethodError`；同时补齐配对、文件选择、前台服务、更新检查与错误处理的兼容路径。
- 修复 Android WSS 中继连接成功后反复创建线程、最终触发 OOM 闪退的问题；每条中继连接只保留一个 SOCKS 接收线程，转发任务改为固定 8 个工作线程和 16 个有界排队槽，过载时明确拒绝而不是无限增长。
- Android 本地 SOCKS 与 Web 代理固定绑定 `127.0.0.1`，不再监听全部网络接口；远程流量仍通过配对生成的 AES-256-GCM 隧道密钥端到端加密。
- 新增可配置的个人 WSS/443 中转服务器：桌面“手机与远程同步”页可检测、保存或清除无凭据的 `wss://` 地址，变更后要求重新扫码更新手机配对资料；仓库提供 Caddy、systemd 与独立 Node 服务部署示例。
- 个人中继继续采用盲转发边界：服务默认只在 `127.0.0.1:8787` 接受反向代理流量，不持有隧道密钥、不解密 Harness 内容、不保存离线帧，并对总连接、未完成握手、房间、来源、帧大小和速率实施有界限制。
- Computer Use 在“设置 → 插件 → 插件配置”中增加可发现的状态卡，可请求授权、恢复/停止控制或撤销永久授权；“本次授权 / 永久授权 / 拒绝”仍只能由 Harness Desktop 宿主授权卡决定，插件不能自行选择授权范围。
- 保留 v1.0.44 的 Computer Use 契约：授权后 `unlimited=true`，点击、输入和滚动不再逐次确认，原有应用策略及 UAC/系统/提权窗口/敏感窗口/敏感输入门禁不再拦截；停止会立即结束当前控制会话并清除目标。

## Android 与移动端验证

- Android 生产源码已清除 `String.isBlank()`；新增 API 26 空白输入回归测试，并覆盖真实 EasyTier route 的命中与拒绝。
- WSS/OOM、固定线程池与有界队列、loopback 绑定、个人中继配置/健康检查/容量背压均有自动化契约测试。
- 正式 Android APK 只由 GitHub Actions 使用长期 release 证书生成并复核包名、版本、证书与 SHA-256；本地 debug APK 不进入任何发布资产。

## macOS

- macOS 无 Apple Developer 会员时的显式无签名契约、Intel/Apple Silicon 双架构 DMG/ZIP、`安装.command` 一键安装助手和云端结构自检流程完全不变。
- 未签名包不等同于 Developer ID 签名、Apple 公证或 Gatekeeper 验收；推荐打开 DMG 后使用其中的 `安装.command`。

## 发布与完整性

- 正式 `v1.0.45` Tag 只会在干净候选提交快进到 `main`、全平台 candidate build/test（Windows/macOS/Linux/iOS）以及 pre-Tag Windows 安装/原地升级/自检/卸载全部成功后创建；历史 Tag（包括已发布的 `v1.0.44`）绝不移动或重建。
- 统一可恢复发布器只在本机执行源码与安全门禁并删除、拒绝 `dist`；Windows、macOS、Linux 正式包均由 GitHub Actions 从同一候选 SHA 构建，恢复阶段复用同一 run 的制品，不经过本机传输大文件。
- 桌面、签名 Android、签名组件与精确 18 项清单在 GitHub 全部公开并复核后，CNB Runner 才从 GitHub 云端镜像；三个签名 stable feed 始终最后提升并再次同步到 CNB。
- 所有公开资产继续提供并验证 SHA-256，生产组件与稳定源继续强制 Ed25519 签名；同版本不同摘要视为冲突，绝不覆盖。
