# Harness Desktop 1.0.44

## 本次更新

- `v1.0.43` 候选 Tag 本地官方门禁 1202 tests/1200 pass/2 skip/0 fail 通过；云端矩阵三项已确认失败、iOS 通过：Ubuntu（run 32741226632）CAS concurrent finalize 的 POSIX rename overwrite/inode identity race；Windows（同 run job 97475914969，Git 2.55.0.windows.4）六个 project-foundations-runtime merge 在 async canonical TEMP 加长后触发 Git refs/worktrees MAX_PATH，cherry-pick 非零且无冲突文件时被伪装成空冲突结果；macOS（job 97475914937）源测试与 x64/arm64 构建完成，packaged x64 self-test 启动失败（`runtimeWebBoot=false`，dsh-agent-teams `ctx.projectFoundations?.runner` 在 Cordis plugin fiber 抛 cannot get property without inject）。该 Tag（289ef403）不移动、不重建，未公开 Release、未提升 stable feed；三项修复随 v1.0.44 重新接受云端矩阵。
- 修复 Linux CAS 并发原子发布竞态：两个同 digest finalize 在 POSIX 上均先见 target 不存在，`rename(temp,target)` 会覆盖既有 target，验证者在 lstat 与 open 之间遇到 inode 替换而误报 `ARTIFACT_CAS_CIPHERTEXT_INVALID`。改为跨平台原子 no-clobber 发布——赢家发布、输家只验证既有不可变对象，绝不覆盖或修复已存在损坏对象；fsync、路径 containment、密文/nonce/digest fail-closed 语义不放宽。
- 修复 Windows Git 长路径合并失败：win32 每次 Git 调用固定注入 `core.longpaths=true`（不依赖用户/全局 gitconfig），merge 临时 worktree basename 缩短到 14 字符（receipt 仍经 `refs/harness/merge-groups/<groupRef>` 精确绑定）；cherry-pick 非零且无 unmerged paths 时先 abort 再抛明确的 `GIT_OPERATION_FAILED`，不再伪装成空冲突结果。
- 修复 macOS 打包运行时可选服务读取：dsh-agent-teams 在 Cordis plugin fiber 中用官方 `ctx.get` strict optional lookup 读取 `projectFoundations`，缺失 provider 时安全默认启用，不将可选服务加入 required inject。
- 在此之前已合入的跨平台修复继续生效：macOS `/var`→`/private/var` 与 Windows 临时目录别名/大小写/8.3 short-path 的异步 realpath fixture 归一化、Linux LAN mTLS/E2EE 异步 delivery 有界等待、macOS 并发 Git worktree 变更协调；生产代码的 trusted-root/workspace containment、mTLS、E2EE、listener isolation、ACK、immutable receipt/CAS 与 close 语义均不放宽。

- 女仆鲸进入结构化智能陪伴：她会根据任务开始、多任务、等待决定、受阻、完成和长时间运行给出低频情境提示，而不是每次状态变化都播放固定动作与固定文案。新增本地默契/每日进度/连续完成记录、克制/温柔/元气表达风格和主动陪伴开关；全程不读取对话正文、屏幕或文件。
- 代理团队工作台新增项目任务、项目自动化与业务同步能力：任务支持创建、领取、依赖、文件边界和加密完整性校验；自动化定义按任务状态变更编排，人工批准后才运行；业务同步以 authority/collaborator 模式在受控成员间交换有界、可审计的消息；桌面 Git 能力只允许在显式授权的项目根目录内执行版本库操作。
- 新增 Host-only 模型准入插件 dsh-model-admission：模型请求进入有界公平准入与排队（8 个活跃槽、32 个全局等待、每个根至多 8 个、30 秒超时），队列饱和时明确拒绝而非无限堆积；该门禁只覆盖模型请求，不宣称统一调度所有桌面 Provider/API。
- 壁纸库补齐视频生命周期与 Range 流式播放回归测试：图片/视频预览继续使用受管文件，视频通过有界 Range 响应流式播放，不把整段视频读入内存；敏感动作与上传边界不变。
- 内嵌浏览器继续沿用并收紧用户/模型来源隔离、导航防护、防重放、停止与取消恢复；文件选择、下载、弹窗及敏感动作仍强制显式授权。
- 桌面会话生成停止后的自动跟随等运行时补丁与小修同步合入；本次仍不把自动团队控制描述为全桌面统一调度池。

## macOS

- macOS 无 Apple Developer 会员时的显式无签名契约、Intel/Apple Silicon 双架构 DMG/ZIP、`安装.command` 一键安装助手和云端结构自检流程完全不变。
- 未签名包不等同于 Developer ID 签名、Apple 公证或 Gatekeeper 验收；推荐打开 DMG 后使用其中的 `安装.command`。

## 发布与完整性（Tag 后置契约）

- 自 v1.0.44 起，正式 `v1.0.44` Tag 在以下全部成功之后才创建：干净已门禁提交快进到 `main`，锁定 SHA 的全平台 candidate build/test（Windows/macOS/Linux/iOS），以及 pre-Tag Windows installer/upgrade 全量验证（安装、覆盖升级、便携版自检、卸载）。
- 候选失败不回退版本：保持同一 v1.0.44 候选迭代修复；恢复时复用同一 candidate run 的 Actions artifacts 发布桌面，绝不重复 desktop build，也绝不经过本机传输大文件。
- Tag 一旦真正创建仍不可移动、不可重建、不可覆盖；本文件准备阶段不会提前修改 stable feed 或已发布资产清单。
- 统一可恢复发布器只在本机执行源码/安全门禁并明确删除、拒绝 `dist`；Windows、macOS、Linux 正式包全部由 GitHub Actions 从同一候选 SHA/正式 Tag 生成。
- 在普通客户端检测到更新前，云端必须完成 Windows 安装版/便携版、打包后自检、组件健康/回滚，以及真实下载、安装、更新和卸载验证。
- GitHub 跨平台云构建、签名 Android、签名组件、精确 18 项清单与 GitHub→CNB 云镜像全部成功后，才最后提升 stable feed；中断恢复会重新绑定精确 workflow 身份并在提升前重验两云 18 项资产，不通过本机重复搬运已验证的大文件。
- 所有公开资产仍需提供并验证 SHA-256，生产组件与稳定源继续强制 Ed25519 签名。