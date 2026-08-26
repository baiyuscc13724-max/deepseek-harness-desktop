# Desktop / Mobile 原生 P2P 与 WSS/443 后备协议

## 支持矩阵

配对协议不依赖操作系统。相同 Bridge API、设备 Cookie 和传输描述用于下列组合：

| Desktop | Mobile | 局域网 | 内置原生 P2P | 个人 WSS/443 fallback | 旧覆盖网兼容 |
|---|---|---:|---:|---:|---:|
| Windows | Android | 是 | 是 | 是 | EasyTier / Tailscale |
| Windows | iPhone / iPad | 是 | 当前未实现 | 是 | 不要求 |
| macOS Intel / Apple Silicon | Android | 是 | 是 | 是 | EasyTier / Tailscale |
| macOS Intel / Apple Silicon | iPhone / iPad | 是 | 当前未实现 | 是 | 不要求 |

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
2. 已真实打开的应用内 `native-p2p` DataChannel；
3. 同一条个人 `wss-relay` 端到端加密 fallback；
4. 历史配对仍需要的 EasyTier/Tailscale 兼容路线。

同一 tunnel stream 在 OPEN 时固定使用 direct 或 relay。通道拥塞或关闭时终止该 stream，让回环代理的新连接在 WSS 上重建；不能把一个 TCP 字节流逐帧跨 DataChannel/WSS 发送，否则两个有序通道之间仍会发生全局乱序。

Android 使用 `ConnectivityManager.NetworkCallback`，iOS 使用 `NWPathMonitor`。默认网络、可用性或接口发生变化后，客户端等待短暂抖动窗口，清理旧线路、重建远程连接并重新加载稳定 Origin。

## 内置原生 P2P

Desktop 隐藏、sandbox/contextIsolation 的 Chromium transport renderer 与 Android WebRTC SDK 建立 ordered `harness-sync-v1` DataChannel。默认只使用 `stun:stun.cloudflare.com:3478` 做 NAT 发现；两端拒绝 TURN、ICE 凭据和未受限 URL，因此业务数据不会静默改走第三方 TURN。

`native-p2p` descriptor 与完整旧 `wss-relay` descriptor 同时存在，descriptor 的 `protocolVersion` 为兼容旧解析器继续保持 1；`native-p2p-v2` capability 才表示会话数据 envelope v2。旧客户端忽略未知项后仍能中继；新版 Android 也会从历史的合法 `wss-relay` 保存资料派生可选 native 配置，因此版本升级不要求重新扫码。Android 只有在 `signalingVersion=1` 且 relay 回传的 `desktopCapabilities` 含 `native-p2p-v2` 时才等待 v2 offer；旧 relay server 或旧 Desktop 缺少相应字段时立即继续纯 v1 WSS，不依赖猜测超时。

```json
{
  "id": "native-p2p",
  "origin": "http://10.253.77.254:3081",
  "relayUrl": "wss://relay.example.com/",
  "roomId": "<32 random bytes, base64url>",
  "tunnelKey": "<32 random bytes, base64url>",
  "protocolVersion": 1,
  "fallbackTransport": "wss-relay",
  "iceServers": [{ "urls": ["stun:stun.cloudflare.com:3478"] }]
}
```

个人 WSS 只路由有界、不透明的 `signal` 文本。Desktop 是唯一 offerer；内部 canonical kind 是 `offer|answer|ice|end-of-candidates`。信令 payload 仍使用 room key 的 AES-GCM v1 frame，relay 只路由外层。内层 offer 精确绑定 `source=desktop`、`target=<peerId>`、`desktopNonce` 与 description；answer 回显这些绑定并增加 `source=<peerId>`、`target=desktop`、`mobileNonce`。Mobile 的 ICE/end 必须带两个 nonce；Desktop 的 ICE/end 始终带 desktopNonce，并在 answer 后带 mobileNonce。`sessionId` 不上 wire，只由双方本地派生。

每次 desktop/mobile 会话的 transcript 是无尾换行 UTF-8：

```text
native-p2p-v2\n<roomId>\n<16 lowercase hex peerId>\n<desktopNonce>\n<mobileNonce>
```

两个 nonce 都是 32 个随机字节的无填充 base64url。`sessionKey = HMAC-SHA256(roomKey, transcript)`；`sessionId = first16(SHA-256(transcript))`。原生 v2 数据 envelope 是：

```text
1 byte version (=2)
1 byte direction (1 Desktop→Mobile, 2 Mobile→Desktop)
8 bytes unsigned sequence, network byte order
12 bytes random AES-GCM nonce
ciphertext + 16-byte tag
```

AAD 精确为前 10 字节 header、8 字节 peer ID、16 字节 session ID；v2 明文 frame 严格为 `[version=2][type][streamId uint32 BE][payload]`，旧 v1 明文仍以 version 1 开头。sequence 是 64 位整数，发送端从 0 开始；接收端在验证 AEAD 后使用 4096 项序列滑窗拒绝重复或过旧包，同时容忍固定在不同通道的 stream 短暂乱序到达。新会话密钥使历史密文不能跨重连重放。没有 `native-p2p-v2` capability 的旧移动端继续使用原 v1 WSS 数据协议。

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

连接后第一条文本消息是 `hello`：版本 1、角色 `desktop|mobile`、room ID，可附可忽略的有界 capability。中继给手机分配 8 字节 peer ID。其后允许有界的 opaque `signal` 文本和旧二进制数据：

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

这是保留给旧 WSS 客户端和新客户端尚未收到 offer 的短暂兼容窗口的 v1 格式；双方仍对最近 4096 个随机 nonce 做基础重放拒绝，但该窗口会在重连时重置，因此 v1 不承诺跨重连的强重放防护。个人 relay 在这个兼容窗口内属于受信任的路由/可用性端点：主动恶意的 relay 可以删除 capability/offer 迫使继续 v1，并重放已离开窗口或来自旧连接的历史 v1 帧。新原生客户端一旦建立会话，即使回退 WSS 也只使用上一节的 session-bound v2、uint64 sequence 与 4096 项滑窗，同时关闭旧 v1 streams 并拒绝该 peer 后续 v1，从而提供跨重连历史包隔离。应用层 Cookie、HTTP、WebSocket 和会话内容都位于加密 payload 内，中继仍无法解密内容。

### 防滥用

- 每房间 1 台 Desktop、最多 32 台 Mobile。
- 单 envelope 上限约 64 KiB。
- 单连接每 10 秒 16 MiB。
- Desktop 和 Mobile 各自限制 WebSocket/DataChannel/本地 socket 待发送缓冲为 4 MiB；relay 限制单目的端 4 MiB、全局 64 MiB 待发送量，慢消费者超限时以 4429 fail closed，不无限排队。
- Desktop 限制 peer、IPC、总 stream 和每 peer stream 数；Android 在复制 DataChannel/WSS 输入前先限长。
- Desktop 只把 OPEN 接到 `127.0.0.1:<当前 Bridge 端口>`，客户端不能指定任意 Desktop 目标。
- 中继不保存离线帧、配对资料、设备身份或会话。

## 平台能力边界

Android 在用户明确启用无障碍服务并逐项确认敏感动作后，可以执行固定手机控制动作。桌面模型插件只经随机 Bearer + generation 保护的 loopback API 提交动作；固定请求头不是认证凭据。动作一旦派发，桌面取消只能作为请求送达手机，必须等待客户端最终回执或明确报告 `*_UNCONFIRMED`，不能宣称已经抢占停止。

iOS/iPadOS 普通 App 无权读取或操纵其他 App，iOS 客户端仅提供 Harness 工作台、二维码、上传/相机等系统允许能力。协议和 UI 必须明确显示这一差异，不能承诺或模拟 Android 式跨 App 控制。

## 运行时配置个人中继

Desktop 允许用户在运行时配置个人 WSS/443 中继：URL 只保存到用户数据目录（userData）的配置，不写入发行源码或仓库；配置经严格校验（`wss://`、仅 443、无内嵌凭据）后，保存并成功连接才进入新生成的配对二维码。普通应用升级会复用手机已保存的旧描述并无感尝试 P2P，不用重新扫码；只有 Desktop 更换 relay URL、且手机也要切到这个新地址时才需重新扫码。个人中继必须使用公网可信证书（Android 走系统信任链，自签名不可用）。中继只转发端到端加密字节流，仅见连接元数据，无法解密应用内容；选择中继运营者时请自行评估其可靠性。

## 发布条件

仓库内的 WSS relay 默认没有公开域名。发行前必须：部署 443/TLS 中继、配置审核后的 `wss://` URL、完成 Android/iPhone/iPad 与 Windows/macOS 的真实网络切换测试，并通过独立安全审查。不得把 room ID、tunnel key、设备 secret 或签名私钥写入发行配置、日志或遥测。
