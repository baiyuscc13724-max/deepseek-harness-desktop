# 手机同步与兼容层

## 目标

手机端不复制一套 DeepSeek Harness，也不维护第二份会话数据库。Harness Desktop 在电脑上启动当前固定版本的官方 Web 工作台，手机应用通过桌面端的局域网网关访问这一个工作台。因此电脑和手机看到的是同一批工作区、会话、任务、插件、Skills、模型路由与运行状态。

```text
Android Harness Mobile
  │  一次性二维码配对 + 持久设备凭据
  │  HTTP / WebSocket（局域网优先，远程线路自动接管）
  ▼
Harness Desktop MobileSyncService
  │  只做鉴权、连接转发和目标切换
  │  不解析会话、模型或任务协议
  ▼
127.0.0.1 上当前运行的官方 DeepSeek Harness Web UI
```

## 为什么能承受官方破坏性更新

DeepSeek Harness 官方 README 明确提示开发者预览阶段可能出现兼容性破坏。手机端因此不依赖官方内部 API、消息结构、会话数据库或插件协议，只加载官方页面并转发原始 HTTP 与 WebSocket 流量。

桌面端唯一需要感知官方变化的边界是 `getRuntimeTarget()`：它提供当前官方工作台的本机地址。只要官方仍能提供 Web 工作台，页面和内部协议的变化会原样到达电脑与手机，无需分别重写两套客户端。若官方未来彻底取消 Web 工作台，只需替换这一适配器，而配对、设备管理和 Android 外壳可以继续使用。

## 配对和设备身份

- 电脑端为每次配对生成 24 字节随机令牌，有效期 10 分钟，只能使用一次。
- 配对成功后为手机生成独立的 32 字节随机凭据；电脑只保存其 SHA-256 摘要。
- 手机凭据保存在 `HttpOnly`、`SameSite=Strict` Cookie 中，Android 应用保存官方工作台入口和 WebView Cookie。
- 电脑最多保存 32 台已配对设备，并显示名称、配对时间和最近在线时间。
- 用户撤销设备时，该设备的后续请求立即失效，已建立的实时连接也会断开。
- 桌面端重新启动后仍可恢复已启用的同步服务和已配对设备；手机无需重复扫码。
- EasyTier network secret、WSS room ID 与 tunnel key 不以明文写入状态文件：磁盘只保存版本化密文 envelope，Electron `safeStorage` 使用 Windows DPAPI 或 macOS Keychain 等操作系统能力保护密钥。旧版 0600 明文 mesh 仅在 OS 加密可用时加载，并立即原子迁移为密文；加密不可用、密文损坏或解密失败时远程 mesh fail closed，且不会生成新的明文秘密。运行时适配器仅在内存中取得解密值，设备列表、状态投影与日志不包含这些秘密。
- 用户可在设置中一键启用或关闭自动连接；关闭时会停止远程线路，但不会删除配对身份。

## 线路选择与故障接管

- 手机始终先尝试同一可信网络中的局域网地址，不要求虚拟网卡，也不会占用首页空间。
- 配置个人 WSS 后，远程自动顺序是：应用内原生 WebRTC DataChannel 直连 → 同一条个人 WSS/443 端到端加密中继 → 已有 EasyTier / Tailscale 兼容线路。EasyTier/Tailscale 不参与原生 P2P 打洞；只有历史配对仍需要且本机组件已经存在时才保留兼容旁路，不会为此静默安装新组件。
- 原生 P2P 只用公开 STUN 获得 NAT 映射；不接受 TURN、TURN 凭据或第三方数据中继。STUN 不承载 Harness 业务字节。对称 NAT、CGNAT 或 UDP 阻断时，业务自动使用用户自己的 WSS 加密中继。
- 个人 WSS 同时承载低流量的端到端加密 offer/answer/ICE 信令和旧二进制盲中继。DataChannel 未真正打开前状态只能是“协商中”或“WSS 中继”；只有通道 OPEN 后才显示“原生 P2P 直连”。
- 新原生客户端使用带新鲜双方 nonce、peer/direction/session AAD 和单调序列滑窗的会话密钥；历史密文不能跨重连重放，且同一 TCP tunnel stream 固定使用 direct 或 relay，不能因逐帧拥塞回退而乱序。
- 旧二维码和只保存了 `wss-relay` 的 Android 配对资料会在内存中复用原 relay URL、room ID、tunnel key 与 origin 派生可选原生配置，无需重新扫码。只有 `welcome.signalingVersion=1` 且 `desktopCapabilities` 含 `native-p2p-v2` 才协商 P2P；旧 relay server 或旧 Desktop 缺少能力时立即继续纯 v1 WSS。旧客户端会忽略新 descriptor/字段，并继续使用完整的旧 `wss-relay` 描述。
- 所有覆盖网服务入口仍统一使用 `10.253.77.254:<gateway-port>`；`10.254.77.0/24` 保留给历史 EasyTier 节点地址。
- 仓库内 WSS/443 服务默认没有公开域名。Desktop 运行时配置的个人 URL 只写入 userData；必须是公网可信证书、443 端口、无 URL 凭据的 `wss://`。中继只能看到连接元数据（来源、时序、长度），不能解密 Harness 内容。
- 用户更换个人中继 URL 后，旧配对仍保留旧线路；只有需要切换到新 URL 的手机才需重新扫码。普通版本升级、原生 P2P 启用和旧配置迁移都不要求重新配对。
- 现有 VPN 或系统代理不会被应用关闭或改写；如果网络策略阻断所有候选线路，界面只显示远程不可用，电脑端与局域网仍可使用。

## 网络与隐私边界

- 网关只接受 `127.0.0.1` 或 `localhost` 上的官方工作台作为上游，不能被改成任意远程代理。
- 手机同步没有开发者自营云服务，也不会在项目方云端复制会话、工作区或模型密钥。首选原生 P2P 的业务字节只在电脑与手机之间传输；公开 STUN 只做 NAT 发现。直连失败时使用用户配置的个人 WSS/443 盲中继；历史 EasyTier/Tailscale 线路仅作兼容。任何业务中继只能看到连接元数据（来源、时序、长度），无法解密端到端加密内容。
- 当前局域网通道采用带设备鉴权的 HTTP/WebSocket，不提供传输加密。只应在本人控制的家庭、办公室等可信 Wi-Fi 中使用，不应在公共 Wi-Fi 开启局域网直连。
- 桌面模型插件不通过 LAN 设备 Cookie调用控制 API：该 API 只接受 loopback，并要求每次服务启动重新生成的随机 Bearer 与 generation。凭据只写入用户数据目录的私有 sidecar，停止或重启后立即失效。
- 尚未派发的手机动作可以确定取消；已经派发的动作只记录 `cancel/stop requested`，必须等手机真实回执才能宣称完成。超过命令有效期仍无回执时返回 `CANCEL_UNCONFIRMED` / `STOP_UNCONFIRMED`，不会伪装成已停止。
- 电脑关机或 Harness Desktop 退出时，手机端无法独立继续执行任务；重新连通后应用会自动重试并恢复工作台。
- Windows 首次开放局域网端口时可能显示防火墙提示。只应允许专用网络，不应允许公共网络。

## Android 应用边界

- 最低 Android 8.0（API 26），不依赖 Google Play 服务。
- 应用内 DataChannel 使用 BSD-3-Clause 的 `io.github.webrtc-sdk:android:144.7559.14`；WebRTC 只启用数据通道，不新增音视频采集权限。应用已有的 CAMERA 权限只用于二维码扫描，未声明 RECORD_AUDIO。APK 包含 arm64-v8a、armeabi-v7a、x86、x86_64 四种 ABI，因此安装包体积会明显增加。
- 只允许首次配对地址使用私有 IPv4 和非特权端口，拒绝公网、HTTPS 降级跳转和任意外部站点留在应用内。
- 同源页面留在应用内，外部链接交给系统浏览器。
- 同一二维码兼顾安装与配对：相机、微信或浏览器扫码会下载 Android APK，Harness Mobile 内扫码会直接解析配对信息并连接。
- 支持竖屏扫码、手动粘贴、返回导航、自动重连和重新配对；页面滚动不会触发整页刷新。
- 手机端不保存 Provider API 密钥的第二份副本；密钥仍由电脑上的官方 Harness 配置管理。

## 破坏性更新回归合同

每次更新官方 Harness 依赖时至少验证：

1. 桌面工作台能够启动，并被 `getRuntimeTarget()` 解析为 loopback HTTP 地址。
2. 手机通过既有设备凭据访问工作台，无需重新配对。
3. 官方首页、会话列表和已有工作区在手机端与电脑端一致。
4. HTTP、WebSocket 和外部链接行为没有 401、403、跨域或连接丢失错误。
5. 更换官方 Runtime 端口后，现有网关连接自动转向新目标。
6. 局域网不可用时，原生 P2P 能在可打洞网络中接管；不可打洞时个人 WSS 能接管；远程组件不可用时局域网和电脑端不受影响。
7. 旧二维码、旧 Android 保存资料、旧 relay server 与忽略未知字段的旧客户端都能继续工作，普通升级不要求重新扫码。
8. UI 只在 DataChannel OPEN 后显示 direct；协商、WSS fallback、断线重连与流级路径固定均有自动化断言。
9. 会话重连重放、peer/方向改绑、序列滑窗、慢中继消费者和输入/stream/peer 上限通过安全回归。
10. 手机应用不出现任何依赖旧官方内部 API 字段的代码变更。

自动化测试覆盖一次性配对、HTTP/WS 代理、目标切换、Header 隔离、设备撤销、本地持久化、原生 P2P 信令/会话与 WSS fallback；发布前仍需在不同运营商/CGNAT 条件下用 Android 真机完成一次端到端直连与回退检查。
