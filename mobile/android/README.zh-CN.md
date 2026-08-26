# Harness Mobile（Android）

这是 Harness Desktop 的 Android 伴侣应用，不复制 DeepSeek Harness 的会话协议或会话数据库。

- 手机通过一次性二维码与电脑配对。
- 配对后，Android WebView 加载电脑当前运行的官方 Harness Web 工作台。
- HTTP、流式响应和 WebSocket 均由桌面端按字节转发；手机端不理解官方内部 API。
- 同一网络时优先局域网直连。新二维码的 `native-p2p` 描述或历史合法 `wss-relay` 配对资料会无感启用原生 WebRTC DataChannel，并保留同一 WSS/443 备用线路；只有 DataChannel 实际进入 `OPEN` 后才把 P2P SOCKS 路由交给工作台代理，协商超时、ICE 失败或通道断开都自动保留/恢复 WSS。旧二维码、LAN、EasyTier、WSS 字段和现有远程开关继续按原逻辑工作。
- P2P 信令复用个人 WSS 连接及既有 `hello`，通过服务端可忽略/盲转发的版本化 `signal` 文本消息交换；offer/answer/ICE 先用二维码中的 256 位隧道密钥做 AES-GCM，再以不透明 base64url 载荷路由。DataChannel 业务字节正常情况下不经过服务端；会话建立后的 WSS fallback 使用绑定 peer、方向和连接 nonce 的 v2 envelope，旧 server/旧客户端仍保留原 v1 AES-GCM 二进制帧。
- 连接设置会区分“DataChannel 已实际打开”“WSS 备用线路已实际连接”和“尚未验证接通”，不会把仅有配对描述或正在协商显示成直连成功。
- 官方发生破坏性更新时，优先只调整桌面端 `mobile-sync-service.cjs` 的运行目标适配，不重写手机界面。

## 使用

1. 首次配对时让电脑与 Android 手机处于同一个本人信任的网络。
2. 在 Harness Desktop 设置中打开“手机同步”，生成二维码。首次使用可先用相机、微信或浏览器扫码下载 APK。
3. 安装并打开 Harness Mobile，再用应用内的“扫码连接电脑”扫描同一二维码；也可以粘贴电脑端显示的双用途地址。
4. 配对完成后，手机会打开电脑上的同一个工作台。之后重启应用无需重复扫码，连接开关会控制自动连接和断开。

局域网通道有设备鉴权但不加密，不要在公共 Wi-Fi 使用。异地通道依赖第三方协调或中继基础设施，电脑端始终需要保持运行。完整边界见 `docs/MOBILE_SYNC_ARCHITECTURE.zh-CN.md`。

## 原生 P2P 依赖与生命周期边界

- Android 使用 Maven Central 的 `io.github.webrtc-sdk:android:144.7559.14`，其 POM 声明 BSD-3-Clause。解析到的 AAR 为 48,665,645 字节；当前通用 debug APK 为 110,420,722 字节，因此它有明确的下载体积成本。实际 APK 已核对包含 `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64` 四类 `libjingle_peerconnection_so.so`，构建门禁不能只跑 JVM 单元测试。
- 当前只创建无音视频轨道的 ordered/binary DataChannel；WebRTC 不新增音视频采集、VPN 或存储权限。应用已有的 CAMERA 权限只用于二维码扫描，未声明 RECORD_AUDIO，也不为原生 P2P 安装 EasyTier/Tailscale。
- `MainActivity` 存活时，WebRTC、信令 WebSocket 和本地 SOCKS 线程可在界面进入后台后继续；网络切换由现有 `NetworkCallback` 重建线路。Android 若回收整个应用进程，系统不会保证后台常驻，用户再次打开应用后才从加密保存的配对描述重建；这里不伪装成永久后台服务。
- 信令消息均有版本、会话绑定和长度上限；ICE 只接受无用户名/凭据的 `stun:` URL，明确拒绝 `stuns:`、`turn:`、`turns:` 和 ICE credential；信令只接受无 URL 凭据的 WSS/443。

## 本地构建

要求：JDK 21、Android SDK 35。

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot'
$env:ANDROID_SDK_ROOT='D:\Android\Sdk'
.\gradlew.bat testDebugUnitTest assembleDebug
```

APK 输出：`app/build/outputs/apk/debug/app-debug.apk`。
