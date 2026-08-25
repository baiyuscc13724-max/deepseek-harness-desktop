# Harness Desktop v1.0.45 安全、权限与隐私审查

范围：Android API 26 兼容与 WSS/SOCKS 稳定性修复、个人 WSS/443 中转服务器配置与部署包、Computer Use 插件设置卡，以及 v1.0.44 已发布基线和全云端 Tag 后置发布链。

## 当前结论

v1.0.45 未新增任意脚本执行、凭据读取、支付/银行操作或静默安装能力。个人中继增加的是用户显式配置的无凭据 `wss://` 传输入口；内容仍由 Desktop 与手机持有的配对密钥端到端加密。Computer Use 仅新增设置页可发现性，没有扩大 v1.0.44 已明确授权的 unlimited 权限：插件卡不能选择授权范围，只有 Harness Desktop 宿主卡能接受“本次授权”或“永久授权”。

历史 Tag 和资产保持不可变。已发布的 `v1.0.44` 不移动、不重建、不覆盖；`v1.0.45` 必须作为新的 1.0.45/10045 候选重新通过本地门禁、全平台云构建/测试、pre-Tag Windows 安装升级门禁、签名 Android/组件、双云精确资产与 stable-last 验证。

## Android API 26 兼容边界

- `minSdk=26` 且未启用 core library desugaring，因此生产 Java 不再调用 `String.isBlank()`；所有相关守卫改为 API 26 可用的 `trim().isEmpty()`，避免 API 26–32 上的 `NoSuchMethodError`。
- 修改覆盖 Cookie、HTTP 响应、MIME、Base64、EasyTier 状态/错误、Content-Length、连接状态与缓存路径等输入；所有可空输入继续先做 null 短路。
- 新增 EasyTier route 回归测试，空、控制空白与 null 输入不会进入 JSON 解析，真实 `/32` route 仍能命中，不匹配 route 继续拒绝。
- 正式 Android 工作流仍强制 `io.harnessdesktop.mobile`、`versionCode=10045`、`versionName=1.0.45`、长期 release 证书固定指纹、APK Signature Scheme v3 与公开下载后的 SHA-256/签名复核。本地 debug APK 绝不进入 Release 或 CNB。

## WSS、线程与本地监听边界

- WSS 连接不再为每次 SOCKS accept 无限创建线程：每条客户端使用一个 accept 线程、固定 8 个工作线程和 16 个 `ArrayBlockingQueue` 排队槽，`AbortPolicy` 在饱和时明确拒绝；关闭路径同时停止 listener、workers 与 WebSocket。
- SOCKS listener 与 Android Web 代理都显式绑定 `127.0.0.1`，不会暴露到 Wi-Fi、蜂窝或 VPN 接口；EasyTier 临时探测 listener 同样只绑定 loopback。
- 帧和隧道继续使用配对阶段生成的 AES-256-GCM 密钥，WSS 外层 TLS 不替代端到端加密；连接重试、错误回执与生命周期均保持有界。
- 手机端控制仍只暴露固定动作，密码、支付、银行、验证码、清除数据、静默安装卸载和权限绕过保持禁止；普通文本输入、文件写入与缓存清理仍由手机端二次确认。

## 个人中继服务器边界

- 用户只能保存公开、无用户名/密码/查询凭据的 `wss://` 地址；明文 `ws://`、非 443 生产地址、嵌入凭据和无效来源均被拒绝。检测成功后才原子替换现有配置，失败不会破坏原有可用地址。
- 地址变更会使旧二维码资料过期并提示重新扫码，不会静默远程改写已配对手机。删除个人地址后恢复打包默认配置。
- 独立 Node 中继默认只监听 `127.0.0.1:8787`，由 Caddy/Nginx/云负载均衡提供公开 443 与受信 TLS；不得关闭客户端证书校验。
- 中继不持有 tunnel key、不解密 Harness 内容、不保存离线帧、配对资料、设备身份或会话。它只能观察连接时间、房间关联、帧长度和流量。
- 默认容量上限：512 总连接、64 未完成 hello、256 活跃房间、每来源 32 连接、每房间 1 个 Desktop 与最多 32 个移动端；单帧约 64 KiB，每连接 10 秒最多 16 MiB。超限明确关闭，不能无限排队。
- 手机只可向房间 Desktop 发帧，Desktop 只可向中继分配的当前 peer ID 发帧；房间 ID 与 tunnel key 均由每台 Desktop 随机生成并通过一次性二维码交付。

## Computer Use 授权边界

- v1.0.45 保留 v1.0.44 的可信状态机：`requestAuthorization` 只推送宿主授权卡，用户在卡片上选择 `session`、`forever` 或拒绝后，Electron Host 才能执行 `authorizeComputerUse`。
- 插件设置卡只使用 `computer-use-refresh`、`computer-use-status`、`computer-use-toggle` 与 `computer-use-revoke-permanent` 路由；不存在 `authorize-session`、`authorize-forever` 或任意 scope 参数入口。
- 未有授权时，“请求授权”只调用宿主 `requestComputerUseAuthorization()`；已有 session/forever grant 时才可恢复。停止调用 `setComputerUseEnabled(false)`，撤销永久授权调用 Host 的专用撤销 API。
- 授权后 `unlimited=true` 的含义必须清楚展示：点击、输入和滚动不逐次确认，持久应用策略及原有 UAC、系统/提权窗口、敏感窗口、敏感输入门禁均不再拦截。该能力风险由授权卡与插件卡同时明示，不以“受限模式”文案误导用户。
- 每次输入前仍需绑定可见目标；外部应用输入会使上一次截图失效，下一次动作前必须重新截图。`stop` 立即结束当前会话并清除目标；插件和工具均不提供 Shell 或脚本执行。
- 旧 Profile 中重复的 Computer Use 开关、应用策略与确认 UI 已移除；根级宿主授权 overlay 及本次/永久/拒绝处理保留，避免出现第二授权源或授权状态分叉。

## 版本与发布门禁

- 根 package/lock、13 个随包插件、Android、iOS/iPadOS、桌面移动路由、移动更新示例、工作流默认值和测试契约全部绑定 1.0.45/10045。
- `release-manifest.json` 与三个 `component-feeds/stable/*.json` 在候选准备阶段继续指向已发布 v1.0.44；只有统一发布器在 GitHub/CNB 资产完成后才能生成新签名清单并最后提升 stable feed。
- 正式 Tag 只在干净候选提交快进 `main`、锁定 SHA 的 Windows/macOS/Linux/iOS candidate workflow 与 previous-stable→candidate Windows 安装/升级/自检/卸载全部成功后创建。Tag 创建后绝不移动、删除或重建。
- 本地发布器删除并拒绝 `dist`，不构建或上传正式二进制；GitHub Actions 生成桌面、签名 Android 与签名组件，CNB Runner 直接从 GitHub 云端镜像。
- GitHub 与 CNB 必须各自拥有精确 18 项不可变资产，大小、SHA-256、签名清单与下载 URL 一致；三个 Ed25519 签名 stable feed 最后提升并做第二次 metadata-only CNB 同步。

## 验证要求

- 本地必须通过静态门禁、Computer Use 定向测试、移动/中继定向测试、完整 `npm run verify` 与 `npm run verify:release`；偶发文件占用类环境失败只能在同一精确测试成功重跑后认定为已澄清，不能吞掉真实断言失败。
- Android SDK 完整单测、Lint、release assemble/签名与 API 26 兼容仍由有 SDK 的正式云工作流复核；MuMu/真机调试证据不能替代签名 APK、云端矩阵与公开下载复核。
- 发布完成前不得把 v1.0.45 描述为已发布；只有统一可恢复发布器状态、GitHub/CNB 两云资产和 stable feed 外部验证全部成功后才能完成目标。
