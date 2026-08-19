# Harness WSS/443 盲中继

该服务是 EasyTier/Tailscale 之外的跨网络后备线路。它只转发端到端加密的二进制帧，不终止 Harness 应用层加密，也不直接暴露电脑的 3081 网关。

## 网络边界

- 服务默认只监听 `127.0.0.1:8787`。
- 生产环境必须放在 Caddy、Nginx 或云负载均衡之后，由反向代理提供公开 `wss://relay.example.com/...` 的 TLS 1.2/1.3 与 443 端口。
- 电脑端和手机端都只建立出站 WSS 连接；不要求路由器端口映射。
- 房间 ID 为 256 位随机值，只用于不可猜测的路由；负载使用配对二维码中的独立 256 位密钥进行 AES-256-GCM 加密。
- 中继只能看到连接时间、房间关联、帧长度和流量，无法读取 Cookie、HTTP、WebSocket 或会话内容。

## 反向代理示例

```caddy
relay.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

启动内部服务：

```text
HARNESS_RELAY_HOST=127.0.0.1
HARNESS_RELAY_PORT=8787
node services/wss-relay/server.cjs
```

桌面开发环境配置：

```text
HARNESS_MOBILE_RELAY_URL=wss://relay.example.com/
```

正式版本不得依赖环境变量注入密钥；公开中继 URL 可进入经过审核的发行配置，但房间 ID 和隧道密钥始终由每台 Desktop 本地随机生成并通过一次性二维码传递。

## 资源限制

- 每个房间最多 1 台 Desktop 和 32 台手机/平板。
- 单帧最大约 64 KiB。
- 每连接 10 秒最多转发 16 MiB。
- 手机只能向房间 Desktop 发帧，不能直接向另一台手机发帧。
- Desktop 只能向中继分配的当前 peer ID 发帧。

中继服务不保存配对、设备身份、会话或离线数据。生产部署仍需在外层增加连接数限制、DDoS 防护、指标和无内容日志策略。
