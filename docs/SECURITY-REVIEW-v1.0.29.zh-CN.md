# Harness Desktop v1.0.29 安全、权限与隐私审查

范围：官方 Runtime 升级、浏览器/MCP/文件/定时任务能力、自动代理团队、项目级协作开发、移动同步、更新与不可变发布链。

## 当前结论

源码审查与自动化门禁未发现需要绕过既有权限边界的设计。正式发布仍必须依次通过干净提交、完整测试、发布契约审计、Windows 真实打包与安装验证、GitHub 多平台矩阵、Android 长期证书、显式无签名 macOS 包（含一键安装助手）、公开资产 SHA-256 和组件 Ed25519 验签。发布后证据在真实工作流完成前不视为通过。

## 官方能力和桌面边界

- 官方 DeepSeek Harness 固定为 `0.1.1-rc.2`，Electron 固定为 43.2.0；优先采用官方 Files API、视觉模型、子代理谱系、Bubblewrap PID namespace 和 session projection 契约。
- 官方 Web 工作台仍是唯一主界面；Agent Teams 复用 `conversation.view`、官方 composer、官方子代理会话与轨迹，不复制第二套聊天、终端、编辑器、模型或 Token 控件。
- Renderer 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。Browser/Computer/Android 控制只暴露固定动作；密码、验证码、支付和银行内容禁止自动输入。
- MCP 管理器只保存凭据引用，限制命令、URL、危险请求头和环境；启停本地服务需用户确认。工作区文件写入继续通过官方工具和确认门禁，不绕过路径、realpath 或 symlink 边界。

## 自动团队与身份隔离

- 只有直接用户触发的最外层 root 可建立团队；同 root 最多 8 个未关闭团队，成员和活动回合受独立硬上限，跨 root、嵌套团队和成员自行扩员均禁止。
- 自动团队仅在至少两个持续、独立且需要协调的工作流时建立；单一辅助使用普通 subagent，简单任务由主模型完成，不为展示或凑人数扩张。
- 成员显示名执行 NFKC、空白折叠和大小写无关键唯一校验。公开投影不含原始 `sessionId/memberId/userId/deviceId`、团队消息正文或不可证明安全的文件路径。
- 自动协作采用 Observe→Avoid→Require→Resolve→Admit→Deliver：精确单目标、`fanout=1`、必要性理由、ACL、跳数、环路、冷却和暂停 epoch 全部由 Host 校验；默认只进入无唤醒 Inbox。
- Stop 会暂停团队、Runner 和外部 Outbox，清除或延迟可唤醒投递；只有新的直接用户请求才能显式 resume。

## 项目协作和源码 Authority

- 项目身份使用 Host HMAC 不透明引用；Grant、事件、测试证据和 Gate 使用 Ed25519，项目数据包使用 X25519+HKDF+A256GCM。Host snapshot 使用 AES-256-GCM、原子 rename/fsync 和 revision CAS。
- LAN adapter 默认关闭并要求 TLS 1.3、mTLS、ALPN、私网地址和连接/帧上限；WSS adapter 复用 blind relay，只路由定向密文，未签名准入前不绑定设备。
- Authority store、电脑 A 的实时工作树和任务 Workspace 强制路径分离。受信固定 Git 只读导入电脑 A 的已提交 HEAD，所有任务在独立 bare repository/worktree 中执行。
- ChangeSet、MergeGroup 和 ArtifactSet 内容寻址且不可变；远程 Git bundle 先进入有界 CAS，再在 quarantine ref 中验证 bundle/fsck 并重算 commit、唯一 parent、文件集、binary diff digest 和 tree digest。
- 主线落地先持久 `landing_pending`，再执行 Git Head CAS，最后保存 Authority 状态；崩溃后只有 base/result Head 可自动协调，无关 Head 必须拒绝。

## 测试证据和缺陷闭环

- Runner 只领取管理员预注册的 template/environment digest，不接受模型提供 command/args；capability、trust、租约、超时、有限重试和取消均由持久调度器校验。
- TestAttestation 必须由 Runner 签名并绑定同一 plan、suite、merge group、commit、ArtifactSet 和 manifest；Gate Receipt 只接受满足最小测试数、信任级别与时效的精确证据。
- Signal→Occurrence→Defect→Fix→Verification→ReleaseObservation 使用加密 Host snapshot 和 revision CAS；错误修复制品或外部状态不能关闭内部缺陷。
- GitHub/GitLab/Jira 凭据仅按请求从回调取得且不持久化。Outbox 先保存 pending、再调用平台、最后提交完成 revision；Issue 和评论使用稳定 marker，崩溃重试不重复创建。验签 webhook 只产生候选观察。

## 供应链与发布

- 桌面、Agent Teams、Android `versionCode 10029`/`versionName 1.0.29`、iOS build/marketing version和工作流目标同步到 1.0.29。
- Release 绑定单一干净提交和不可变 `v1.0.29` Tag；云端先建立不可覆盖 draft，重新下载精确资产集合、校验 SHA-256 并完成 Windows 安装/自检后才公开。
- Android 只使用 Actions Secret 中长期 release 证书；macOS 按显式无签名契约构建（`identity: null`、拒绝签名/公证输入），包内含一键安装助手；未签名包不等同于 Developer ID 签名、公证或 Gatekeeper 验收，用户仍会看到 Gatekeeper 提示。
- 生产组件使用既有单一 Ed25519 信任根；私钥、恢复资料、keystore、密码和 Token 不进入 Git、聊天、日志或发布资产。
- CNB 仅由云端 Runner 从 GitHub 镜像并复核大小/哈希；稳定 feed 只在 GitHub、CNB 和精确 18 项清单全部就绪后最后提升。

## 发布候选验证记录

- `npm run verify`：源码静态门禁和完整自动化测试必须通过。
- `npm run verify:release`：单一官方工作台、发布、供应链和不可变资产契约审计必须通过。
- Windows 安装版/便携版、自检、安装/卸载、GitHub 桌面矩阵、Apple 模拟器、签名 APK、组件、18 项清单和 CNB 双源：由统一 `release:publish` 状态文件记录真实结果。
