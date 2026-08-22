# HypoMux 能力评估与跨网组队入口说明

> 范围：评估 HypoMux 是否适合"手机/电脑跨公网同步"；记录现有多人协作审计结论；说明本次落地的组建团队、局域网发现、远程邀请/连接三个入口的真实能力边界。

## 1. HypoMux 是什么

HypoMux 是一个 **Windows 多网卡带宽聚合工具**（[GitHub 仓库](https://github.com/Hypostasis-Cat/HypoMux)），目标是"一键聚合多网卡（有线、Wi-Fi、手机热点等），实现物理级多线下载与叠加网速"。其许可证为 **AGPL-3.0**（GNU Affero General Public License v3）。

它不是同步协议、不是传输协议、不是设备发现层，也不提供任何数据同步、中继路由、设备身份或端到端加密语义。它只做一件事：在同一台 Windows 机器上把多条本地网络接口的带宽合并用于下载。

## 2. 适用性评估（手机/电脑跨公网同步）

| 维度 | 评估 | 结论 |
| --- | --- | --- |
| 许可证 | AGPL-3.0，强 copyleft。直接捆绑、修改或网络化集成会引入额外源码提供义务，不符合 Harness Desktop 当前保持 MIT 主产品与既有发布链简洁的目标。 | **不直接集成** |
| 网络模型 | 单机多 NIC 聚合，仅 Windows；无跨设备同步、无中继/房间、无邀请、无公网打洞语义。手机端完全不支持。 | **不适用** |
| 传输能力 | 不提供 LAN 自动发现、远程邀请、加密数据通道；与项目协作所需的设备身份、Grant、签名事件模型无交集。 | **无复用价值** |
| 维护成本 | 外部二进制/驱动级工具，需要持续跟踪上游、签名与打包；引入后只是"带宽聚合"，不解决任何组队问题。 | **高成本零收益** |
| 安全边界 | 网络层带宽工具，不提供认证/授权/加密通道；误用会引入不可审计的网络路径。 | **负收益** |

**结论：HypoMux 不适合手机/电脑跨公网同步，不引入。** 对手机与电脑的外网连接，仓库已经由 `electron/bridge/sync-transport-manager.cjs` 在 EasyTier、WSS/443 中继和 Tailscale 之间按可用性选择并自动回退；这类加密隧道/中继才是同步所需的网络模型。项目协作域另外已有两条真实传输路径：

- `plugins/dsh-agent-teams/lib/project-lan-transport.js`：LAN 内 TLS 1.3 + 互认证（mTLS）+ ALPN 监听传输；
- `plugins/dsh-agent-teams/lib/project-wss-relay-transport.js`：非局域网 WSS 盲中继传输（E2EE 签名准入，只转发有界密文）；
- `plugins/dsh-agent-teams/lib/project-secure-channel.js`：X25519+HKDF+A256GCM+Ed25519 端到端安全数据包；
- `services/wss-relay/`：真实可运行的中继服务端（健康检查 + 房间路由），有对应测试。

## 3. 现有多人协作审计

**已实现并接入产品：**

- 本地代理团队插件（`plugins/dsh-agent-teams`）：团队生命周期、任务/依赖/冲突、成员目录、实时画布、协作 Broker/Service（Observe→Avoid→Require→Resolve→Admit→Deliver）、Web API（`/api/agent-teams/*`）与客户端 UI，由 `electron/bridge/agent-teams-plugin-service.cjs` 在启动时安装到 Web profile。

**已实现（协议/加密/传输层，有测试）但此前未接线到产品：**

- 项目协作权威（`project-collaboration.js`）：不透明 project/collaborator/device 引用、Ed25519 签名事件、RBAC 角色、Grant 签发/续期/撤权、设备密钥轮换、authority epoch 迁移、离线游标；
- 加密持久化（`project-state-store.js`）：AES-256-GCM 信封、原子 rename/fsync、revision CAS 与回滚下限；
- 持久化权威服务（`project-authority-service.js`）：事务式 `PersistedProjectAuthority`；
- LAN mTLS 传输（`project-lan-transport.js`）与远程 WSS 中继传输（`project-wss-relay-transport.js`），均默认关闭、要求显式策略与配置。

即：**组建项目的权威与成员资格、两条传输路径的底层能力已经真实存在**；缺的是产品侧的装配服务、Web API 入口、客户端入口与状态/占位说明。

## 4. 本次落地：跨网组队入口（真实能力边界）

新增 `plugins/dsh-agent-teams/lib/project-entry-service.js` 装配服务 + `/api/agent-teams/project/*` 路由 + 客户端“组建协作团队”原生面板，全部基于已有域层，不假装实现底层不存在的传输能力：

| 入口 | 真实能力 | 状态/占位说明 |
| --- | --- | --- |
| 组建团队 | 创建持久化项目权威：生成 projectRef/authority 密钥、加密存储 Host 状态、注册 owner 设备并持久化设备凭据；重启后通过 `DSH_HOME/storages` 恢复。 | 无项目时显示"未组建"与创建动作；已组建时显示 projectRef、owner、成员数与修订号。 |
| 局域网入口 | LAN mTLS 传输模块真实存在，项目证书会自动生成并通过端到端加密的一次性批准串交付；为避免暴露设备，产品不广播扫描信标。 | 显示真实入口地址、连接状态和启动/停止控制，不伪造扫描结果。 |
| 非局域网远程邀请/连接 | 一次性邀请码真实可生成（HMAC 签名、绑定 projectRef/roomRef/authority 密钥、带过期且落盘仅存指纹）；凭邀请码+设备公钥可真实赎回并签发成员 Grant；中继 URL 配置后（`set-relay`）可真实启动 WSS 中继传输并报告连接状态。 | 中继未配置或 WebSocket 实现不可用时返回明确错误码（`RELAY_NOT_CONFIGURED`/`RELAY_WEBSOCKET_UNAVAILABLE`），不假装已连接。 |

**明确不做（避免假装底层不存在的传输能力）：**

- 不做局域网自动发现信标/扫描（底层没有该能力，需要新的安全设计，超出本任务）；
- 不做端到端设备数据通道的密钥交换装配（域层已有 `project-secure-channel.js` 协议，但设备 X25519 密钥交换与 mTLS 证书固定仍是显式配置步骤，入口如实标注"channel 未就绪"）；
- 不引入 HypoMux 或任何未经论证的重依赖（本任务全部使用 Node 内置模块与仓库已有依赖）。

## 5. 测试与安全

- `tests/project-entry-service.test.cjs`：创建/恢复项目、邀请码生成与赎回、中继配置校验、LAN 状态占位、远程连接前置条件错误码；
- `tests/agent-teams-ui.test.cjs`：客户端入口面板存在性、无外链 URL 字面量、无伪传输动作；
- 所有新路由复用 `trustedRequest`（仅 127.0.0.1/localhost）与 `x-harness-agent-teams` 头校验；设备凭据文件以 0600 权限原子写入 `DSH_HOME/storages/`。
