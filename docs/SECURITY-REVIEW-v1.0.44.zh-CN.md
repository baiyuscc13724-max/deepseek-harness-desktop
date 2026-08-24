# Harness Desktop v1.0.44 安全、权限与隐私审查

范围：继承 v1.0.41/v1.0.42/v1.0.43 候选中的代理团队项目能力、Host-only 模型准入、女仆鲸结构化智能陪伴、壁纸视频生命周期和全云端发布链；补充 v1.0.43 托管 Runner 暴露的三项跨平台门禁修复（Linux CAS 并发原子发布竞态、Windows Git refs/worktrees MAX_PATH、macOS 打包运行时可选服务读取）与 v1.0.44 起生效的 Tag 后置发布契约。

## 当前结论

v1.0.44 不新增产品权限、任意脚本执行、凭据读取或绕过用户确认的写接口。v1.0.41、v1.0.42 与 v1.0.43 的不可变 Tag 均未公开发布、未提升 stable feed；v1.0.43 本地官方门禁 1202 tests/1200 pass/2 skip/0 fail 通过，云端矩阵三项已确认失败、iOS 通过（Ubuntu CAS concurrent finalize 的 POSIX rename/inode race；Windows Git refs/worktrees MAX_PATH 合并；macOS packaged x64 self-test 因可选服务读取失败），发布器按设计停止。相关 Tag 不移动、不重建，三项修复通过新的 v1.0.44/10044 候选重新接受完整门禁。v1.0.44 起采用 Tag 后置契约：锁定 SHA 的全平台候选构建/测试与 pre-Tag Windows 安装/升级验证全部成功后才创建唯一正式 Tag；失败保持同一候选，成功恢复复用同一 run artifacts。真实发布完成前，本审查不把 v1.0.44 描述为已发布，也不就尚未完成的候选门禁抢先作结论。

## CAS 原子发布修复边界

- `artifact-cas` 的并发 finalize 改为跨平台原子 no-clobber 发布：优先评估同卷 hard-link create/exclusive 语义，赢家发布不可变对象，输家只验证既有对象，绝不覆盖或修复已存在损坏对象；验证者在 lstat 与 open 之间不会再遇到 inode 替换。
- 保留 fsync、路径 containment、密文/nonce/digest fail-closed；现有篡改/错误测试不放宽。
- 修复仅限 CAS 发布路径，不改变桌面 Git、项目任务、业务同步或任何其他授权边界。

## Windows 长路径与 macOS 可选服务修复边界

- Windows：`git-workspace-adapter` 在 win32 每次 Git 调用固定注入 `-c core.longpaths=true`（仅 argv，不从环境注入配置，不依赖用户/全局 gitconfig）；merge 临时 worktree basename 缩短且不嵌入 groupRef（receipt 仍精确绑定）；cherry-pick 非零且无 unmerged paths 时 abort 后抛 `GIT_OPERATION_FAILED`，绝不伪装空冲突，真实冲突仍返回有界 conflicts。路径 containment、trusted root、receipt/CAS 与 close 语义不放宽。
- macOS：dsh-agent-teams 在 Cordis plugin fiber 中仅通过官方 `ctx.get(name, strict=true)` 读取可选 `projectFoundations`，缺失 provider 时安全默认并正常启用；可选服务不加入 required inject；只接受普通 record 的固定 runner/connector/runnerEvidence 投影，避免 getter/proxy/原型输入越界。
- 两项修复均在对应 Windows/macOS 托管 Runner 上接受定向与全量门禁；单一本机通过不能替代云端矩阵证据。

## 之前的跨平台修复边界（继续生效）

- Windows 测试 fixture 使用与生产相同的异步 realpath（`fs.realpathSync` 保留 8.3 short TEMP，而 `fs/promises.realpath` 展开长路径）；macOS 测试处理 `/var`→`/private/var`；修复只校正测试 fixture 的平台归一化，不削弱生产代码的 `realpath`、trusted root、workspace containment、symlink 或目录逃逸拒绝。
- macOS 并发 Git worktree 竞态使用同进程、按规范化 repositoryPath 隔离、可清理且不死锁的仓库变更协调，保留 immutable receipt/CAS/close 语义；不顺序化测试、不吞错误、不放宽断言。
- Linux LAN mTLS/E2EE 测试改为有界等待真实异步 delivery；真实网络、双向 TLS、端到端加密、listener isolation、ACK 与超时语义保持不变。
- 跨平台修复必须在对应 Windows、macOS、Ubuntu 托管 Runner 上通过；单一本机通过不能替代云端矩阵证据。

## 既有权限与隐私边界

- 项目任务、自动化和业务同步继续使用显式命令门禁、角色权限、规范化输入、修订号、文件边界与有界消息；桌面 Git 只在显式授权且经真实路径复核的项目根内工作。
- `dsh-model-admission` 仍是 Host-only 的有界模型请求准入门禁，不读取 Provider 凭据、不改变官方模型路由，也不宣称统一调度所有桌面 API。
- 女仆鲸陪伴只使用桌面持有的结构化任务状态和本地记录，不读取对话正文、屏幕或文件；壁纸视频继续从受管副本以有界 Range 响应播放。
- 内嵌浏览器和 Computer Use 继续绑定可见目标、来源、控制代次与一次性确认；密码、Token、Cookie、验证码、支付和银行内容禁止模型读写。

## 版本与发布门禁

- 桌面及全部随包插件同步到 1.0.44；Android 使用 `versionCode 10044`/`versionName 1.0.44`，iOS build/marketing version 和移动更新示例同步，发布工作流默认候选目标为 v1.0.44。
- v1.0.41/v1.0.42/v1.0.43 的失败状态和 Tag 仅作为历史证据保留，不能迁移为 v1.0.44 的成功阶段。
- Tag 后置契约（v1.0.44 起）：正式 `v1.0.44` Tag 在本地源码/安全门禁、锁定 SHA 的全平台 candidate build/test 与 pre-Tag Windows installer/upgrade 全量验证全部成功之后创建；候选失败保持同一 1.0.44 版本迭代（不自动提升补丁版本），同版本新提交仅在无 Tag/Release/CNB/stable 副作用且可安全快进的条件下 rebind 候选阶段并保留审计，否则 fail-closed；发布阶段复用同一 candidate run 的 Actions artifacts，绝不从本机打包或上传大文件。Tag 一旦创建仍绝对不可移动、不可覆盖。
- 发布器本机删除并拒绝正式 `dist` 包，只由绑定候选 SHA/正式 Tag 的 Actions 生成 Windows、macOS、Linux、Android 与生产组件资产；断点 runId 必须重新核对权威 workflow ID/name/path、event、SHA、ref、成功结论和资产。
- 正式 Release 必须精确包含 18 项签名/摘要绑定资产；进入 stable 提升前重新核对当前 GitHub Release 与签名清单，并验证 CNB 逐项 URL、状态、大小及 checksum 摘要。GitHub→CNB 保持云到云，stable feed 最后提升。
- macOS 继续采用无 Apple Developer 会员时的显式未签名双架构 DMG/ZIP 与 `安装.command` 契约；这不等同于 Developer ID、Apple 公证或 Gatekeeper 验收。

## 验证要求

- 版本/静态门禁必须确认 package/lock、13 个随包插件、Android、iOS、移动路由、工作流默认值、测试契约和本文档全部绑定 1.0.44/10044。
- v1.0.41/v1.0.42/v1.0.43 的失败说明必须保留在 CHANGELOG、README、release notes 与发布指南中，避免把失败 Tag/候选误称为公开稳定版。
- 合入其他成员的 CAS/Windows/macOS 修复后，应运行各自定向测试及完整 `npm run verify`；先完成锁定 SHA 的 Windows/macOS/Ubuntu/iOS candidate build/test 与 pre-Tag Windows installer/upgrade 全量验证，全部成功后才创建唯一正式 `v1.0.44` Tag，随后才可继续公开发布、Android/组件签名、18 项清单、CNB 镜像和 stable-last；Tag 创建后绝不移动。