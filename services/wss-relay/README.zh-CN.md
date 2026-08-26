# Harness WSS/443 直连协调与盲中继

这是 Harness Desktop 手机同步的个人远程入口。新版本首先借助它交换端到端加密的原生 P2P 信令；直连成功后，Harness 业务流量不经过服务器。网络无法打洞时，同一连接继续作为端到端加密的二进制盲中继。旧版 Desktop、旧版手机、现有个人中继 URL 和既有配对仍按原协议工作，不需要改变用户操作。

## 最简单的个人服务器部署

准备一台有公网 IPv4 的 Linux 服务器、Node.js 20+ 和 Caddy。服务器只需开放入站 TCP 80/443；Desktop 与手机均只建立出站 WSS 连接，不需要路由器端口映射。

1. 有自己的域名时，让域名解析到服务器，并按 `Caddyfile.example` 替换域名。只有公网 IPv4 时，Caddy 2.10+ 可申请受信任的短期 IP 证书，配置见下文；无需把 IP 写进客户端源码。
2. 把本目录复制到 `/opt/harness-wss-relay`，执行 `npm ci --omit=dev`，并创建不可登录的系统用户 `harness-relay`。
3. 将 `harness-wss-relay.service` 安装到 `/etc/systemd/system/` 后启用，安装 Caddy 配置并重载 Caddy。
4. 浏览器访问 `https://你的域名或公网IP/healthz`，应得到 `{"ok":true,"protocolVersion":1,"signalingVersion":1}`。旧客户端只读取 `protocolVersion`，新增字段不会破坏兼容性。
5. 在 Harness Desktop 的“手机与远程同步 → 个人中继服务器”中填入域名/IP 或完整 `wss://` 地址，点击“检测并保存”。手机会在下一次扫码配对时自动获得该地址。

只有公网 IPv4 时，可把下列 `203.0.113.10` 替换为自己的地址。`default_sni` 让不发送 IP SNI 的 Android/Node 客户端也能取得正确证书；Caddy 会自动续期短期证书。

```caddy
{
  default_sni 203.0.113.10
}

https://203.0.113.10 {
  tls {
    issuer acme {
      dir https://acme-v02.api.letsencrypt.org/directory
      profile shortlived
    }
  }
  reverse_proxy 127.0.0.1:8787
  log {
    output discard
  }
}
```

> 更换中继地址不会远程改写手机里已经保存的旧配对资料。改地址后，请重新生成二维码，并在已配对手机上重新扫码以更新远程线路。

## 原生 P2P 与兼容回退

- Desktop 和手机仍使用版本 1 `hello` 加入同一个随机房间；服务端在 `welcome` 中附加 `signalingVersion: 1`，旧客户端会安全忽略。
- 新客户端可在 `hello.capabilities` 中声明能力。服务端只保留去重后的 `native-p2p-v1`、`native-p2p-v2`，丢弃未知值：手机能力通过 `peer-joined.capabilities` 告知 Desktop；Desktop 能力通过手机的 `welcome.desktopCapabilities` 或稍后的 `desktop-online.desktopCapabilities` 告知手机。只有清洗结果非空时才添加这些字段，因此未声明 capability 的旧 Desktop 所对应的 `welcome`、`desktop-online` 仍保持精确旧形状。
- 新客户端可发送 `{type:"signal",version:1,target,payload}`。手机只能把目标设为 `desktop`，Desktop 只能选择该房间中由服务端分配的 16 位十六进制 peer ID；服务端重写 `source`，客户端不能伪造来源或跨房间路由。
- `payload` 是最多 48 KiB 的 base64url 不透明密文。offer、answer 和 ICE candidate 位于由配对 tunnel key 保护的密文内，中继不读取信令内容。
- 信令与二进制帧共用连接和速率预算。P2P 建立成功后业务流量直达两端；失败时无需重新配对，会话已建立的新客户端以 session-bound v2 经同一 WSS 回退，旧客户端继续使用原 AES-256-GCM v1 二进制中继。
- 这项升级不删除个人中继：个人服务器同时承担低流量直连协调和必要时的数据兜底。双方都是严格 CGNAT、对称 NAT 或 UDP 被阻断时，数据中继仍不可避免。

## OpenCloudOS / RHEL 系示例

```bash
dnf install -y nodejs npm caddy
useradd --system --home-dir /opt/harness-wss-relay --shell /sbin/nologin harness-relay
mkdir -p /opt/harness-wss-relay
# 将 server.cjs、package.json、package-lock.json 复制到该目录
cd /opt/harness-wss-relay && npm ci --omit=dev
chown -R harness-relay:harness-relay /opt/harness-wss-relay
install -m 0644 harness-wss-relay.service /etc/systemd/system/harness-wss-relay.service
systemctl daemon-reload
systemctl enable --now harness-wss-relay
# 编辑 /etc/caddy/Caddyfile 后：
systemctl enable --now caddy
systemctl reload caddy
```

生产环境必须由 Caddy、Nginx 或云负载均衡提供公开的可信 TLS 证书和 443 端口。不要在客户端关闭证书校验，也不要把 SSH 密钥、room ID、tunnel key 或设备 secret 放入 URL、日志或源码。

## 网络与隐私边界

- 内部 Node 服务默认只监听 `127.0.0.1:8787`。
- 房间 ID 为 256 位随机值，只用于不可猜测的路由；负载使用配对二维码中的另一把 256 位密钥进行 AES-256-GCM 端到端加密。
- 中继只能看到连接时间、房间关联、帧长度和流量，无法读取 Cookie、HTTP、WebSocket、会话或模型凭据。
- 服务不保存离线帧、配对资料、设备身份或会话。
- 服务自身默认限制 512 条总连接、64 条未完成 hello 的连接、256 个活跃房间和每来源 32 条连接；每个房间最多 1 台 Desktop 和 32 台手机/平板。
- 单帧最大约 64 KiB；每连接 10 秒最多转发 16 MiB。外层代理仍应设置与服务器容量匹配的连接与 DDoS 防护。
- 所有服务端发出的控制、信令和二进制消息都会在入队前检查 `bufferedAmount`：单连接待发上限为 4 MiB，所有连接合计待发上限为 64 MiB。预计越界时服务端以 4429 关闭慢目的端和本次来源，不会继续无限排队。
- 手机只能向房间 Desktop 发帧，Desktop 只能向中继分配的当前 peer ID 发帧。

## 启动与健康检查

不使用 systemd 时可以直接启动：

```bash
HARNESS_RELAY_HOST=127.0.0.1 HARNESS_RELAY_PORT=8787 npm start
curl --fail http://127.0.0.1:8787/healthz
```

外层反向代理仍应增加连接数/DDoS 限制、可用性监控和无内容日志策略。Node 服务只在直连来源为 loopback 时读取 `X-Forwarded-For`，并使用地址链最后一项；Caddy 默认会安全设置该头，其他代理必须覆盖伪造值或把真实客户端地址追加到末尾。公开客户端配置只包含无凭据的 `wss://` 地址；房间 ID 和隧道密钥始终由每台 Desktop 本地随机生成并通过一次性二维码传递。
