# Harness Desktop v1.0.31 安全、权限与隐私审查

范围：官方 Runtime、浏览器/MCP/文件/定时任务能力、自动代理团队、项目级协作开发、本地记忆、Windows Computer Use、移动同步、更新与不可变发布链。

## 当前结论

源码审查与自动化门禁未发现需要绕过既有权限边界的设计。正式发布仍必须依次通过干净提交、完整测试、发布契约审计、Windows 真实打包与安装验证、GitHub 多平台矩阵、Android 长期证书、显式无签名 macOS 包（含一键安装助手）、公开资产 SHA-256 和组件 Ed25519 验签。发布后证据在真实工作流完成前不视为通过。

## 官方能力和桌面边界

- 官方 DeepSeek Harness 与 Electron 继续使用仓库锁定版本；优先采用官方 Files API、视觉模型、子代理谱系、沙箱和 session projection 契约。
- 官方 Web 工作台仍是唯一主界面；Agent Teams、会话体验、文件与项目入口均复用官方 composer、会话、轨迹和插件基础设施，不复制第二套聊天、终端、编辑器、模型或 Token 控件。
- Renderer 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。Browser/Computer/Android 控制只暴露固定动作；密码、验证码、支付和银行内容禁止自动输入。
- Windows Computer Use 继续绑定应用策略、可见窗口、逐次确认和有界截图存储；跨应用、敏感输入、静默权限提升和任意脚本执行保持禁止。
- 本地记忆继续 opt-in，候选、有效、过期、替代、停用等状态与作用域均经明确策略；敏感内容过滤、查看、纠错和删除能力保持可见。

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

## 测试证据和缺陷闭环

- Runner 只领取管理员预注册的 template/environment digest，不接受模型提供 command/args；capability、trust、租约、超时、有限重试和取消均由持久调度器校验。
- TestAttestation 必须由 Runner 签名并绑定同一 plan、suite、merge group、commit、ArtifactSet 和 manifest；Gate Receipt 只接受满足最小测试数、信任级别与时效的精确证据。
- Signal→Occurrence→Defect→Fix→Verification→ReleaseObservation 使用加密 Host snapshot 和 revision CAS；错误修复制品或外部状态不能关闭内部缺陷。
- GitHub/GitLab/Jira 凭据仅按请求从回调取得且不持久化；外部关闭事件不能直接改变内部结论。

## 供应链与发布

- 桌面、插件、Android `versionCode 10031`/`versionName 1.0.31`、iOS build/marketing version和工作流目标同步到 1.0.31。
- Release 绑定单一干净提交和不可变 `v1.0.31` Tag；云端先建立不可覆盖 draft，重新下载精确资产集合、校验 SHA-256 并完成 Windows 安装/自检后才公开。
- Android 只使用 Actions Secret 中长期 release 证书；macOS 按与 v1.0.30 完全相同的显式无签名契约构建（`identity: null`、拒绝签名/公证输入），包内含一键安装助手；未签名包不等同于 Developer ID 签名、公证或 Gatekeeper 验收，用户仍会看到 Gatekeeper 提示。
- 生产组件使用既有单一 Ed25519 信任根；私钥、恢复资料、keystore、密码和 Token 不进入 Git、聊天、日志或发布资产。
- CNB 仅由云端 Runner 从 GitHub 镜像并复核大小/哈希；稳定 feed 只在 GitHub、CNB 和精确 18 项清单全部就绪后最后提升。

## 发布候选验证记录

- `npm run verify`：源码静态门禁和完整自动化测试必须通过。
- `npm run verify:release`：单一官方工作台、发布、供应链和不可变资产契约审计必须通过。
- Windows 安装版/便携版、自检、安装/卸载、GitHub 桌面矩阵、Apple 模拟器、签名 APK、组件、18 项清单和 CNB 双源：由统一 `release:publish` 状态文件记录真实结果。
