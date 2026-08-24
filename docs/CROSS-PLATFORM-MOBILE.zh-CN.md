# Desktop / Mobile 跨平台配对与 WSS/443 后备协议

## 支持矩阵

配对协议不依赖操作系统。相同 Bridge API、设备 Cookie 和传输描述用于下列组合：

| Desktop | Mobile | 局域网 | WSS/443 | 可选覆盖网 |
|---|---|---:|---:|---:|
| Windows | Android | 是 | 是 | EasyTier / Tailscale |
| Windows | iPhone / iPad | 是 | 是 | 不要求 |
| macOS Intel / Apple Silicon | Android | 是 | 是 | EasyTier / Tailscale |
| macOS Intel / Apple Silicon | iPhone / iPad | 是 | 是 | 不要求 |

Desktop Bridge API 版本保持为 2。二维码 payload 版本保持为 2，`transports` 是可扩展数组；旧客户端会忽略不认识的传输。

## 配对身份

1. Desktop 生成有效期 10 分钟的一次性配对 token，只在私网 HTTP `/__harness_mobile__/pair/<token>` 上兑换。
2. 兑换后 Desktop 生成 64 位设备 ID 与高熵设备 secret；服务端只保存 secret 的 SHA-256。
3. 客户端得到 `HttpOnly; SameSite=Strict` 的 `harness_mobile_auth` Cookie。
4. Android 保存经过校验的配对资料；iOS/iPadOS 将包含中继密钥的资料写入 `AfterFirstUnlockThisDeviceOnly` Keychain。
5. 忘记或撤销设备后，Desktop 立即关闭该设备当前的 HTTP/WebSocket 与控制连接。
6. Desktop 的 EasyTier network secret、WSS room ID 与 tunnel key 只以版本化密文 envelope 落盘；密钥由 Electron `safeStorage` 委托操作系统凭据保护。旧版 0600 明文状态仅在 OS 加密可用时加载，并在同一次启动中立即原子改写为密文；OS 加密不可用或密文损坏时远程 mesh fail closed，不生成新的明文秘密。

二维码的本地 setup URL 只是为了兼容普通相机；实际 payload 同时可由 `harnessmobile://pair?payload=...` 深链承载。客户端只接受私网/覆盖网 IPv4 上的 HTTP pairing URL，拒绝公网 HTTP、HTTPS 替换、低端口、用户信息和任意重定向。

## LAN-first 路由

客户端 WebView 固定访问 `http://harness.localhost:<ephemeral-port>`。应用内回环代理保持稳定 Origin 和 Cookie，并按顺序选择：

1. 当前 Wi-Fi/有线局域网直连；
2. payload 中已连接的 `wss-relay`；
3. Desktop 当次 payload 提供的 EasyTier/Tailscale 路线。

Android 使用 `ConnectivityManager.NetworkCallback`，iOS 使用 `NWPathMonitor`。默认网络、可用性或接口发生变化后，客户端等待短暂抖动窗口，清理旧线路、重建远程连接并重新加载稳定 Origin。

## WSS/443 盲中继

`wss-relay` pairing descriptor：

```json
{
  "id": "wss-relay",
  "origin": "http://10.253.77.254:3081",
  "relayUrl": "wss://relay.example.com/",
  "roomId": "<32 random bytes, base64url>",
  "tunnelKey": "<32 random bytes, base64url>",
  "protocolVersion": 1,
  "secureMode": true
}
```

`roomId` 和 `tunnelKey` 独立。room ID 是不可猜测的瞬时路由能力；中继从未得到 tunnel key。

### Relay envelope

连接后第一条文本消息是 `hello`：版本 1、角色 `desktop|mobile`、room ID。中继给手机分配 8 字节 peer ID。之后仅允许二进制数据：

```text
8 bytes destination peer id | opaque encrypted tunnel packet
```

手机只能把目标设为全零 Desktop ID；Desktop 只能发往该房间当前的已分配 peer ID。中继转发时把头部替换为来源 peer ID，因此不能伪造跨房间路由。

### 端到端 packet

```text
1 byte version (=1)
12 bytes random AES-GCM nonce
AES-256-GCM ciphertext
16 bytes authentication tag
```

AAD 为单字节协议版本。解密后的 frame：

```text
1 byte version
1 byte kind: OPEN=1 DATA=2 FIN=3 RESET=4 PING=5 PONG=6
4 bytes unsigned stream id, network byte order
0..65536 bytes payload
```

Desktop 与客户端对最近 4096 个 nonce 做重放拒绝。WebSocket 顺序传输之外不依赖计数器；随机 96 位 nonce 由系统 CSPRNG 生成。应用层 Cookie、HTTP、WebSocket 和会话内容都位于加密 payload 内，中继只能观察连接元数据和长度。

### 防滥用

- 每房间 1 台 Desktop、最多 32 台 Mobile。
- 单 envelope 上限约 64 KiB。
- 单连接每 10 秒 16 MiB。
- Desktop 和 Mobile 各自限制 WebSocket/本地 socket 待发送缓冲为 4 MiB。
- Desktop 只把 OPEN 接到 `127.0.0.1:<当前 Bridge 端口>`，客户端不能指定任意 Desktop 目标。
- 中继不保存离线帧、配对资料、设备身份或会话。

## 平台能力边界

Android 在用户明确启用无障碍服务并逐项确认敏感动作后，可以执行固定手机控制动作。桌面模型插件只经随机 Bearer + generation 保护的 loopback API 提交动作；固定请求头不是认证凭据。动作一旦派发，桌面取消只能作为请求送达手机，必须等待客户端最终回执或明确报告 `*_UNCONFIRMED`，不能宣称已经抢占停止。

iOS/iPadOS 普通 App 无权读取或操纵其他 App，iOS 客户端仅提供 Harness 工作台、二维码、上传/相机等系统允许能力。协议和 UI 必须明确显示这一差异，不能承诺或模拟 Android 式跨 App 控制。

## 运行时配置个人中继

Desktop 允许用户在运行时配置个人 WSS/443 中继：URL 只保存到用户数据目录（userData）的配置，不写入发行源码或仓库；配置经严格校验（`wss://`、仅 443、无内嵌凭据）后，保存并成功连接才进入新生成的配对二维码。手机通过二维码获得该中继描述符，协议版本不变，Android 端无需改动；Desktop 修改中继地址后，已配对手机重新扫码即可切换。个人中继必须使用公网可信证书（Android 走系统信任链，自签名不可用）。中继只转发端到端加密字节流，仅见连接元数据，无法解密应用内容；选择中继运营者时请自行评估其可靠性。

## 发布条件

仓库内的 WSS relay 默认没有公开域名。发行前必须：部署 443/TLS 中继、配置审核后的 `wss://` URL、完成 Android/iPhone/iPad 与 Windows/macOS 的真实网络切换测试，并通过独立安全审查。不得把 room ID、tunnel key、设备 secret 或签名私钥写入发行配置、日志或遥测。
