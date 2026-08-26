# Harness Desktop v1.0.48 安全、权限与隐私审查

范围：原生 WebRTC P2P 与 WSS 信令/盲中继后备、桌面隐藏 P2P Host、Android NativeP2pClient、手机独立外观与 history 恢复、Agent Teams 任务取消/关闭语义、PR Preview 默认发现、Computer Use 授权说明、组件更新通知路径，以及完整 `1.0.48` 发布身份。

## 当前结论

v1.0.48 没有把 relay 凭据、端到端密钥、任意 TURN 配置、桌面壁纸文件、任意 IPC、Shell、脚本、密码、支付、银行、账户、验证码、私钥或签名材料暴露给网页或模型。原生 P2P 只改变加密包的传输路径，不放宽既有配对认证、设备授权、固定手机动作或敏感输入边界。

已发布 `v1.0.47` 的 Tag、精确 18 项资产、签名 APK 与组件保持不可变。v1.0.48 使用新的 Tag、资产、摘要和 stable 提升，不移动、不覆盖、不复用历史发布。

## 原生 P2P 会话与信令

- 桌面和 Android 只在已有配对身份、房间密钥与个人 `wss://` relay 配置上协商原生 P2P；没有合法配对材料时不能建立可用会话。
- v2 会话 transcript 绑定 room、peer id、desktop nonce 与 mobile nonce，并生成固定 session id；端到端帧同时绑定方向、peer、session AAD，避免另一房间、另一设备或另一轮协商的密文被重用。
- 每个方向维护 4096 包滑动重放窗口。重复、过旧、未知 session、错误 peer、错误路径或 v2 建立后的 v1 帧全部失败关闭；已确认会话拒绝 nonce/path rebinding 和降级。
- WebRTC offer、answer 与 ICE 信令使用 AES-GCM 信封并限制长度、来源、target、peer、nonce 和每 peer ICE 数；信令 nonce 保存有界 4096 项重放集合。
- ICE server 仅接受最多 8 项、每项最多 8 个、固定格式的 `stun:` URL；不接受 `turn:`、用户名、密码或 relay 下发的任意额外字段。

## 桌面 P2P Host 与 Android 资源边界

- 桌面 WebRTC 运行在隐藏 BrowserWindow：`nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`，禁止导航与新窗口；主进程只接受来自该精确 webContents 的固定事件枚举。
- IPC 对 peer id、nonce、session id、path、stream id、base64 和最大 64 KiB tunnel packet 做独立校验；pending command、peer、ICE、bufferedAmount 和信令消息都有上限。
- Android WebRTC/DataChannel、WSS、SOCKS、线程池、socket 和定时器在 stop/close 时统一回收；Manifest 不增加录音、通讯录、广泛相册或后台位置权限。
- `SyncTransportManager` 使用 lifecycle revision 约束异步 prepare/start/fallback/断线接管。用户关闭远程同步会立即使旧轮次失效并等待在途切换收敛，旧清理完成后不能复活备用传输。
- Android WebRTC 依赖 `io.github.webrtc-sdk:android:144.7559.14`，BSD-3-Clause 许可原文随 APK 资源和 `THIRD_PARTY_NOTICES.md` 一并保存。

## WSS 信令与盲中继

- relay 只读取有限 hello/signal 路由元数据并盲转发二进制端到端加密帧，不持有 tunnel/session key，也不解密 Harness payload。
- 服务强制总连接、每来源、每房间、握手时限、房间标识、peer 数、帧大小、速率、队列和 WebSocket backpressure 上限；过载或违规连接会被明确关闭。
- P2P 不可达时继续使用既有端到端加密 relay path；回退不改变保存的配对身份，不把 relay 变成可信明文终点。
- EasyTier/Tailscale 仍是可选线路，不参与原生 P2P 会话密钥或授权扩张。

## 手机外观、照片与 history 恢复

- 手机外观持久化在独立 `mobileAppearance` 中；背景文件、Wallpaper Engine 路径和签名字段始终归零。移动主题资源路由只读取固定随包 allowlist，不能通过 `custom-background` 读取电脑壁纸。
- 手机核心表面保持不透明可读；输入框只在 textarea 聚焦且 IME/visual viewport 确实覆盖时抬升，页面重排不会改变认证或输入权限。
- 照片继续使用系统 Photo Picker 的按次 URI，页面先复制内容再交给官方附件 intake；不申请常驻相册权限，不绕过官方数量、预览或大小限制。
- Android 14+ 声明普通权限 `DETECT_SCREEN_CAPTURE` 并只使用系统 callback 通知“发生过截屏”；回调不返回 Bitmap、URI 或媒体内容，应用不查询 MediaStore，用户仍须在 Photo Picker 中明确选择才会读取并发送图片。
- history 恢复仅拦截固定 session/subagent history 路由，单请求最多重试一次并合并相同在途请求；缓存最多 8 项、仅短期使用，prompt 与其他 mutation 不重试、不缓存。
- MutationObserver 跳过流式会话文本 token，只在结构节点变化时有界重挂载，避免每个 token 触发全页面扫描。

## Agent Teams、更新与 Computer Use

- Agent Teams `cancelled` 是显式终态，记录 `cancelledAt` 和原因并阻断 dependents；重开会清除终态字段并重新检查依赖，不能把失败前置伪装成普通等待。
- 优雅成员退休拒绝仍归属该成员的未完成任务，优雅团队关闭拒绝任意未完成任务；强制关闭先将未完成任务记为取消，完成历史不被重写。
- PR Preview 默认发现不等于自动应用：候选仍须同仓库、默认分支签名、sequence、期限、摘要和本机确认门禁，退出/失败继续回滚。
- 共享更新通知为 preview、组件和完整安装器维护独立动作类型；签名组件只能走暂存、健康检查、原子切换与失败回滚路径。
- Computer Use 永久授权仅跨重启记住 scope，不在应用启动时自动开始控制。只有活动外部窗口目标显示指示；可信 Host 卡、Esc 停止和 browser_control 敏感数据硬限制不变。

## 版本与正式发布门禁

- 根 package/lock、14 个随包插件、Android、iOS/iPadOS、桌面移动路由、移动更新示例和发布工作流默认值全部绑定 `1.0.48`。
- Android `versionCode=1004800` 高于 `1.0.47.99`；完整三段版本的正式 APK 放入 `v1.0.48`，只有四段独立修订版使用 `android-v<version>`。
- iOS marketing version 为 `1.0.48`、build code 为 `10048`；无 Apple Developer 会员时只做 iPhone/iPad 模拟器验证和 Safari/添加到主屏幕工作台，不发布未签名 IPA。
- 正式 Tag 只在干净、已提交、快进 `main` 且精确 main CI 成功的源上创建。发布器删除并拒绝本地 `dist`，所有桌面、Android 与组件正式制品都来自 GitHub Actions。
- GitHub 与 CNB 必须分别回读精确 18 项不可变资产、大小与摘要；三个 Ed25519 stable feed 最后提升。同版本不同摘要、Tag 漂移、资产替换、旧版本覆盖或本地二进制上传全部失败关闭。
