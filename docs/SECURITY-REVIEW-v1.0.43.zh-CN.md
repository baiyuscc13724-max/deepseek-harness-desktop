# Harness Desktop v1.0.43 安全、权限与隐私审查

范围：继承 v1.0.41/v1.0.42 候选中的代理团队项目能力、Host-only 模型准入、女仆鲸结构化智能陪伴、壁纸视频生命周期和全云端发布链；补充 v1.0.42 托管 Runner 暴露的 Windows 同步/异步 realpath fixture 不一致与 macOS 并发 Git worktree 竞态修复。

## 当前结论

v1.0.43 不新增产品权限、任意脚本执行、凭据读取或绕过用户确认的写接口。v1.0.41 与 v1.0.42 的不可变 Tag 均未公开发布、未提升 stable feed；v1.0.42 通过了本地 1200 项门禁与 Ubuntu/iOS 云端门禁，因 Windows short-path fixture 与 macOS 并发 Git worktree 竞态失败而未发布。相关 Tag 不移动、不重建，修复通过新的 v1.0.43/10043 版本重新接受完整门禁。真实发布完成前，本审查不把 v1.0.43 描述为已发布。

## 跨平台 fixture 与竞态修复边界

- Windows 测试 fixture 改用与生产相同的异步 realpath：`fs.realpathSync` 会保留 8.3 short TEMP，而 `fs/promises.realpath` 展开长路径；修复只校正测试 fixture 的平台归一化，不削弱生产代码的 `realpath`、trusted root、workspace containment、symlink 或目录逃逸拒绝。
- macOS 并发 Git worktree 竞态：两个共享 bare repository 的 adapter 不再因并发 worktree add/仓库元数据锁而出现非 allowFailure 子进程失败；生产代码建立有界、按规范化 repositoryPath 隔离、可清理且不死锁的同进程仓库变更协调，保留 immutable receipt/CAS/close 语义。不顺序化测试、不吞错误、不放宽断言。
- 既有 macOS `/var`→`/private/var`、Windows 临时目录别名/大小写、Linux LAN mTLS/E2EE 有界等待修复继续生效；真实网络、双向 TLS、端到端加密、listener isolation、ACK 与超时语义保持不变。
- 跨平台修复必须在对应 Windows、macOS、Ubuntu 托管 Runner 上通过；单一本机通过不能替代云端矩阵证据。

## 既有权限与隐私边界

- 项目任务、自动化和业务同步继续使用显式命令门禁、角色权限、规范化输入、修订号、文件边界与有界消息；桌面 Git 只在显式授权且经真实路径复核的项目根内工作。
- `dsh-model-admission` 仍是 Host-only 的有界模型请求准入门禁，不读取 Provider 凭据、不改变官方模型路由，也不宣称统一调度所有桌面 API。
- 女仆鲸陪伴只使用桌面持有的结构化任务状态和本地记录，不读取对话正文、屏幕或文件；壁纸视频继续从受管副本以有界 Range 响应播放。
- 内嵌浏览器和 Computer Use 继续绑定可见目标、来源、控制代次与一次性确认；密码、Token、Cookie、验证码、支付和银行内容禁止模型读写。

## 版本与发布门禁

- 桌面及全部随包插件同步到 1.0.43；Android 使用 `versionCode 10043`/`versionName 1.0.43`，iOS build/marketing version 和移动更新示例同步，发布工作流默认目标为不可变 `v1.0.43`。
- v1.0.41/v1.0.42 的失败状态和 Tag 仅作为历史证据保留，不能迁移为 v1.0.43 的成功阶段；v1.0.43 必须使用新状态文件、新 Tag 和同一干净提交重新执行本地源码/安全门禁及完整 GitHub Actions 矩阵。
- 发布器本机删除并拒绝正式 `dist` 包，只由绑定 Tag/提交的 Actions 生成 Windows、macOS、Linux、Android 与生产组件资产；断点 runId 必须重新核对权威 workflow ID/name/path、event、SHA、ref、成功结论和资产。
- 正式 Release 必须精确包含 18 项签名/摘要绑定资产；进入 stable 提升前重新核对当前 GitHub Release 与签名清单，并验证 CNB 逐项 URL、状态、大小及 checksum 摘要。GitHub→CNB 保持云到云，stable feed 最后提升。
- macOS 继续采用无 Apple Developer 会员时的显式未签名双架构 DMG/ZIP 与 `安装.command` 契约；这不等同于 Developer ID、Apple 公证或 Gatekeeper 验收。

## 验证要求

- 版本/静态门禁必须确认 package/lock、13 个随包插件、Android、iOS、移动路由、工作流默认值、测试契约和本文档全部绑定 1.0.43/10043。
- v1.0.41/v1.0.42 的失败说明必须保留在 CHANGELOG、README、release notes 与发布指南中，避免把失败 Tag 误称为公开稳定版。
- 合入其他成员的 fixture/竞态修复后，应运行各自定向测试及完整 `npm run verify`；只有不可变 `v1.0.43` Tag 的 Windows/macOS/Ubuntu/iOS 云端门禁全部成功，才可继续公开发布、Android/组件签名、18 项清单、CNB 镜像和 stable-last。