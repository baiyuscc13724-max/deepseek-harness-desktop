# Harness Desktop 1.0.29

## 官方运行时与桌面能力

- 官方 DeepSeek Harness 运行时闭包升级并固定到 `0.1.1-rc.2`，同步视觉模型、Files API 图片处理、子代理谱系导航和沙箱安全修复。
- 新增 MCP 管理器、会话定时任务、工作区文件视图和自适应进度 Dock；凭据只保存引用，文件写入、MCP 进程启停和危险操作继续要求明确确认。
- 浏览器工作区补齐受控链接路由、历史记录、站点授权、诊断和模型工具；密码、验证码、支付及银行内容仍禁止自动输入。
- 加入壁纸选择、模型推理力度控件、更新下载与组件状态改进，并内置受信 MinGit 运行时以支持隔离源码协作。

## 自动代理团队与协作开发

- Agent Teams 增加活跃优先排序、历史折叠和不重叠的实时画布；成员、任务、依赖和协作事件保持响应式、可访问且不投影消息正文。
- 自动协作采用精确单目标必要性门禁、无唤醒 Inbox、暂停 epoch、跨重启冷却和有界审计；不会公开原始会话、成员、用户或设备 ID。
- 项目协作加入 Ed25519 RBAC/事件、AES-256-GCM 状态 CAS、X25519 E2EE、默认关闭的 LAN mTLS 与 blind-relay WSS 适配器。
- 多人源码协作使用独立 bare Git Authority、隔离 worktree、真实 cherry-pick、远程 bundle/CAS 精确准入和 Git Head CAS 写前日志；电脑 A 的实时工作树不成为共享写入位置。
- 新增持久 Runner 队列、merge/nightly/release 调度、签名 TestAttestation 与精确 Gate Receipt；模板只绑定管理员登记的 digest，不接受模型提供任意 Shell 命令。
- Defect 从 Signal、Occurrence、Fix、Verification 到 ReleaseObservation 全程加密持久；GitHub、GitLab、Jira 通过凭据零持久化 Outbox 幂等同步，外部关闭事件不能直接改变内部结论。
- Stop 会让团队成员、Runner、延迟报告和外部投递保持休眠，只有用户显式 resume 才能恢复。

## 移动、安全与发布

- mesh、network 和 tunnel 密钥迁移到 Electron `safeStorage` 版本化密文；旧明文原子迁移，OS 加密不可用或密文损坏时 fail closed。
- WSS 与移动端服务地址统一，Android 控制继续只开放固定动作并在敏感输入、文件写入和清理前确认。
- 桌面、Android 与 iOS/iPadOS 源码同步到 1.0.29。Android 只发布长期证书签名 APK；iPhone/iPad 继续使用 Safari 工作台，不发布未签名 IPA。
- 发布仍绑定唯一不可变 Tag：本地 Windows 门禁、GitHub 跨平台云构建、签名 Android/组件、精确 18 项清单、GitHub→CNB 云镜像全部成功后，才最后提升 stable feed。
