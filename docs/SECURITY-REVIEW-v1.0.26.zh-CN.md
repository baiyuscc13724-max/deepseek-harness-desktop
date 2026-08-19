# Harness Desktop v1.0.26 安全、权限与隐私审查

审查日期：2026-08-19。范围：桌面主进程/预加载、官方工作台集成、浏览器与 Computer Use、本地记忆、存储清理、移动同步、更新下载、生产组件协议、GitHub/CNB 发布链和生产依赖。

## 结论

本地源代码和发布门禁未发现未修复的高危或中危阻断问题。生产发布仍必须通过云端 Windows/macOS/Android 门禁、双源资产核验和稳定组件指针最后提交；任何凭据缺失或外部验证失败都按失败处理。

## 审查中发现并修复

1. **GitHub Actions 标签可变**：所有第三方 Action 从 `@v4`/`@v2` 改为 40 位不可变提交，并增加自动测试和发布审计，防止回退到浮动标签。
2. **活跃缓存删除竞态**：缓存年龄从目录自身时间改为整棵缓存树的最新修改时间；自动维护在删除前再次应用七天阈值。即使预览后同大小文件恢复活动，也会取消删除。
3. **Windows 编排兼容性**：Node 24 在当前 Windows 环境直接 `spawnSync npm.cmd` 返回 `EINVAL`，编排改为通过 `npm_execpath` 和当前 Node 运行 npm CLI，并纳入回归测试。
4. **Android 与桌面发布竞态**：正式 Android 工作流随 Tag 自动启动，先验 Secret，再等待已经通过矩阵门禁的桌面 Release；仍支持同 Tag 手动安全重跑。

## 多会话工作树整合

- 发布前重新枚举全部 Git worktree、独立提交和未提交文件，而不是依赖对话中是否逐项汇报。
- Agent Teams、桌面能力、附件/子代理基础修复已在当前历史中；子代理生命周期会话通过独立完整测试后保存为 `61c7b64`，再按 rc.7 锚点精准移植并复测。
- 更新镜像会话的最终“进度报告器保持按需安装”约束已移植到静态和打包审计；旧 v1.0.20 WinGet/宣传素材与 1.0.26 源码无关，保持原工作树不动。
- `install-workspace-worktree` 按明确禁令完全未修改。

## 供应链与发布

- `npm audit --omit=dev --audit-level=moderate --registry=https://registry.npmjs.org`：0 个已知漏洞。
- `npm ls --all --omit=dev`：生产依赖树可解析；仅显示非当前平台的预期 optional native 依赖缺失。
- Electron 固定 43.2.0 / Node 24；electron-builder 固定 26.15.7；官方 DSH 固定 0.1.0-rc.7；Marketplace 使用提交哈希。
- Inno Setup 固定 Chocolatey 6.7.0；Windows 安装器语言文件固定上游提交和 SHA-256；XcodeGen 固定 2.46.0 发布资产和 SHA-256；发布工作流重新运行源码测试、发布审计、制品体积审计、打包自检和安装/卸载冒烟。
- 组件顶层清单和描述均使用 Ed25519；ZIP 校验大小、SHA-256、逐文件索引、路径穿越、符号链接、大小写冲突和解压上限。
- 生产私钥与 Bootstrap 公钥在生成组件前强制匹配；脚本不输出私钥内容。加密备份为 AES-256-GCM，恢复密钥与备份分离。
- CNB 为优先下载源，GitHub 为后备；稳定清单只允许无凭据 HTTPS URL，并必须在两端不可变资产验证后最后更新。

## Electron 与权限边界

- 主窗口保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，阻止任意新窗口、非预期导航和 WebView 附加。
- 本地能力服务器仅监听 `127.0.0.1`，使用随机 Bearer Token 和固定能力白名单；状态/审计不返回 Token 或正文。
- Browser 使用独立持久化分区，与官方工作台隔离；模型只作用于当前可见已授权标签。密码、Cookie、令牌、验证码、支付和银行内容从结构上不可读写；提交/上传/下载/删除要求逐次确认。
- Computer Use 仅控制 Harness Desktop 自身窗口，默认关闭；点击、输入和滚动逐次确认。截图限制单文件、总量、数量和时效，并在启动、停用、接管、停止和退出时清理。
- 手机控制使用固定动作和能力协商；密码、支付、银行、验证码、静默安装/卸载、清除数据和权限绕过永久禁止。跨网后备只接受无凭据 WSS，配对撤销立即关闭连接。
- 子代理目录补丁只分类 running/continuable/history 和增加筛选，不修改 transcript 或删除会话；源码与测试明确拒绝删除、归档类调用。

## 本地记忆

- 新安装和 schema 6 迁移使用本地自动记忆；用户可总开关并分别关闭自动召回、自动保存。
- 自动写入只允许当前直接用户驱动的根会话；子代理、团队成员、自动续轮和已结束回合不能写。
- 只允许 preference/instruction/project/fact，限制标题/正文/标签/条数和搜索结果；不保存原始对话，精确内容去重。
- 密码、API key、Token、Cookie、Authorization、银行卡、验证码和 secret 模式由共享 censor 拒绝或按用户选择脱敏。
- 模型工具只能状态、有限搜索和安全新增，不能修改或删除；UI 保留查看、搜索、单删、全删、导出和导出副本删除。
- 全删使用 SQLite `secure_delete`、WAL 截断和 `VACUUM`，并有数据库文件正文痕迹回归测试。

## 缓存与删除

- 自动删除只覆盖应用自有 cache，最低七天；旧运行时和临时项仍必须由用户预览并明确确认。
- sessions、attachments、memories、workspace、当前 runtime 和未达年龄阈值/刚恢复活动的 cache 永不自动删除。
- 清理路径要求位于 HarnessData 根内，拒绝根目录、路径逃逸和符号链接；预览绑定随机 ID、十分钟 TTL、目录身份与候选大小，应用前再次扫描。

## 本地验证证据

- `npm run verify`：静态门禁通过，391/391 桌面单元、安全、集成与发布自动化测试通过。
- `npm run verify:release`：发布契约审计通过。
- Android：Gradle debug/release JVM 测试共 43 个任务执行成功；正式 APK 仍只由长期 release Secret 的云端工作流构建和验签。
- 生产组件脚本：使用生产公私钥匹配检查，对三个目标生成 ZIP/签名清单并在本地重新验签成功（仅测试兜底文件，未上传）。
- 便携 Git LFS 3.7.1 从官方 Release 下载，按 `sha256sums.asc` 校验后使用。

## 发布后必须补齐

- Windows v1.0.26 最终安装版/便携版真实自检和组件健康/回滚。
- GitHub Actions macOS Intel、Apple Silicon、iPhone Simulator、iPad Simulator 结果。
- 正式 Android APK 的证书、包名、版本和公开 SHA-256。
- GitHub/CNB 全部公开资产和稳定组件 raw URL 的外部下载、大小、SHA-256 与签名核验。
