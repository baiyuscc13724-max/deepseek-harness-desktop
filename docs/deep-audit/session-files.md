# 会话、附件、文件预览与项目入口深入审计

## 证据边界

- 维护源码：本工作树；没有修改、刷新、重启或验证运行中的 1.0.62 Desktop。测试结果不能等同于用户安装版已修复。
- 逐功能清单：`coverage-session-files.json`。`pass` / `fixed` 只表示该行明确注明的函数、VM 客户端、临时文件系统或假原生适配器层；没有把静态文本契约当完整操作通过。
- 主任务包含会话生命周期、上传/历史、文件列表/打开/预览/复制路径、目录选择/终端、项目 Git/协作入口。首次提出将会话和 Git 两域拆出，Host 因只有一席可用拒绝；总审要求原 scope 串行推进。没有子委派。
- 现有脏改和首批修复保留；没有 stage、commit、发布、用户 Git 修改或实际服务端操作。`node_modules` 只读。Git adapter 在协作成员 scope，仅新增专属临时 fixture 向其移交红证据。
- `services` 实际只有 `wss-relay`：已报总审，由移动成员只读覆盖；不是遗漏后默认通过。

## 本轮确定并修复的问题

| 问题 | 红证据 | 修复与绿证据 |
|---|---|---|
| 两套附件上传使用 `lstat(candidate)` 后 `rename`，并发同名存在竞争窗口 | 专属测试让两次真实 ENOENT 一起返回；Windows 上两套路径均出现 rename EPERM，同名并发未成功；POSIX rename 可覆盖的结论仅来自 API 语义，不伪称本机已观察覆盖 | 两套插件均在不可见临时子目录写完并 sync，再 hard-link 原子不覆盖发布，EEXIST 换序号；旧文件、已确认上传不覆盖；专属2用例及旧顺序碰撞测试通过 |
| 两套文件名清洗允许 `:`、设备名和尾随点空格 | `safeFileName('payload.exe:note.txt')` 原样返回；专属两例失败 | 替换 Windows 保留字符，移除尾部点/空格，CON/NUL/COM1 等设备别名加前缀；两套测试通过 |
| 本地和工作区文本预览仅调用一次 `read`，短读取被误认为完整文件 | 假本地 descriptor 每次仅3字节时只返回 `com` 而非 `complete text preview` | 两处循环读取直至 EOF 或 limit+1；本地假 descriptor、工作区真实文件包装2字节读取均验证完整文本与关闭句柄 |
| 原生绝对路径中的 `%20`/`%25` 被无条件 URL 解码，可能打开另一文件 | `D:\\files\\report%20draft%25.md` 变为含空格和 `%` 的另一名字 | 保留原生绝对路径字面字符；file URL 正常解码；仅非绝对形式的 legacy open-local 额外编码层保留旧兼容；专属与旧 normalization 测试通过 |
| 目录选择关闭又打开后，旧请求结果交给当前 props | VM hook 驱动 open→close→open，先完成旧请求，观察到 `old-project` 进入新回调 | 请求 revision 绑定 open 代次；关闭失效旧代次，成功/失败都检查存活与代次；新选择照常完成 |
| 原生目录选择同步 throw 遗留 pending/timer | 假 native throw 后 pending.size=1 | `Promise.resolve().then(choose)` 收敛同步和异步异常；拒绝后 pending.size=0 |
| 归档恢复同轮双击 fork 两次，且未 await child open 就显示恢复成功 | VM 同一按钮 handler 连续调用，forks=2；原实现直接调用 open 不链入 Promise | 同步 ref 锁+可见 busy/disabled 状态；等待 fork→open 全链才报成功；错误显示可重试提示并释放锁 |
| 永久删除同轮双击可发送两次请求 | VM 同一确认按钮 handler 连续调用，requests=2（fetch 为假，无真实删除） | 同步 ref 锁，网络完成 finally 解锁；保留原二次确认与服务端串行清理；专属验证只发一次 |

### 上传文件系统兼容性边界

新发布原语依赖文件系统支持硬链接，同一 uploads 目录保证同卷。NTFS 临时 fixture 已通过。**FAT/exFAT、某些网络盘、权限禁止硬链接时不可上传**，采用 fail-closed；没有回退至会覆盖同名文件的 rename。不能声称这些文件系统已验证或兼容。

对 EPERM/ENOTSUP/EOPNOTSUPP/ENOSYS/EXDEV 统一返回 `UPLOAD_ATOMIC_PUBLISH_UNAVAILABLE`（409），明确提示“原文件未被覆盖；请改用支持硬链接且有写入权限的本地工作区（Windows 建议 NTFS）后重试”。新增两套插件共4用例：逐一注入这5种错误后 staging 不残留、原文件字节不变、恢复正常原语后同名重试生成 report-1；写入异常会关闭句柄、清除半成品且可再试。不是只抛原始 EPERM。应由产品决定是否提供支持不覆盖且不暴露半成品的独立跨平台发布原语；本轮没有用弱化安全语义掩盖不支持。

## 专属行为测试

`tests/deep-audit-session-files.test.cjs` 覆盖：

1. 本机路径百分号字面身份；
2. 两套文本预览短读取与 EOF/关闭；
3. 上传空请求与流式超限；
4. 来源 live/cold root、child 同根及异根拒绝、错误 cold identity 释放观察句柄；
5. 模型预览正确 nonce/source/revision、只裁文档、监听清理；
6. 不可见、superseded、failed receipt 不返回旧图；
7. 模型预览 single-flight busy、取消清理、后续重试；
8. 目录选择旧回执、同步失败；
9. 归档恢复/删除同轮并发；
10. 两套上传同名竞争和 Windows 名称；
11. pending fetch 参数来源快照不跟随外部对象切换；
12. 系统打开成功、执行文件 reveal、缺失、系统关联失败（全是假 OS adapter）；
13. 真 Git 深路径仅专用临时 fixture。

该测试的客户端注入只在内存暴露原函数给轻量 React hook 驱动器，不修改生产导出，不调用真实 Electron、Web GUI、能力 API。模型预览图像为明确标注的 mock bytes；仅证明回执/crop/取消逻辑，不证明 PNG 渲染画质。第一个 UI 红测试因未清理第二个 fake picker 的 180s timer 被命令15s中断；修正的是专属 fixture 清理，并在第二次取得4 fail/0 cancel的完整红证据；不是产品超时。

## 回归运行与剩余失败

所有后续广组由隔离 Node 子进程运行：环境只复制 SystemRoot/WINDIR/COMSPEC，PATH 仅 Node 目录；HOME/USERPROFILE/APPDATA/LOCALAPPDATA/DSH_HOME/TEMP/TMP 全部新建临时目录；GIT_CONFIG_NOSYSTEM=1、GIT_CONFIG_GLOBAL/SYSTEM=NUL、GIT_TERMINAL_PROMPT=0、GCM_INTERACTIVE=Never。未继承能力端点、token、真实 runtime session 标识或提供商凭据。临时目录结束清理；这不是 OS 级网络沙箱，测试代码仍须显式 fake 网络。

| 运行 | 结果 | 解释 |
|---|---|---|
| 最初专属7例 | 2 pass / 5 fail | 上传并发2、Windows名2、短read1红证据 |
| 修复后专属+desktop-files+right-workspace-service+session-experience+local-target-service | 47/47 pass | 尚未包含之后新增的客户端4例、模型预览等 |
| 客户端目录与归档专属红回归 | 4 fail / 0 pass | 四项问题如上；修复后均过 |
| 百分号路径专属红用例 | 1 fail | 原生字面路径被解码成别名 |
| 隔离主矩阵：专属、desktop-files、session-experience、local-target-service、right-workspace-service、right-workspace-ui、workspace-links-interaction、terminal-service、terminal-ui | **83 tests / 81 pass / 2 fail / 0 skip** | 当时专属18例绿、Git1例红；另旧UI静态regex红，见下 |

主矩阵两项失败：

- 深 Git 失败是真实临时 Git 进程失败，不是测试断言升级或缩短路径处理。
- `right-workspace-ui.test.cjs` 的 `Desktop shell exposes one unified right workspace...` 要求 `/else \\{[\\s\\S]{0,220}api\\.setBrowserVisible\\(false\\)/`，当前候选委托 `setBrowserVisible(false)`，不满足旧静态形状。本轮未改 renderer 此函数或断言，不拿别的动态 helper 通过来宣称该契约通过。

另一隔离广组验证了 compaction overload 的5次有界退避、取消、上下文保留/overflow shrink，progress 指导、directory picker 安装入口、guest protocol/platforms、git runtime 环境能力、timeline引用与工作区菜单。其失败还包括 `desktop-compaction.test.cjs`、`desktop-directory-picker-plugin-service.test.cjs` 期待版本1.0.59、实际1.0.60的旧版本契约；3项 attachment alpha2 专属条件跳过，不计通过。`tests/session-persistence-performance.test.cjs` 与该组一起运行，详细计数以验收成员复跑为准；不把多个重跑数相加成覆盖率。

### 最终合并复跑（覆盖前面重复项目，不相加）

隔离环境保持上述 allowlist，19个测试文件完整运行：**153 tests / 147 pass / 3 fail / 3 skip / 0 cancelled，2519.392ms**。测试集合为：`deep-audit-session-files`、`desktop-files`、`session-experience`、`local-target-service`、`right-workspace-service`、`right-workspace-ui`、`workspace-links-interaction`、`terminal-service`、`terminal-ui`、`session-timeline-reference`、`desktop-compaction`、`desktop-progress`、`desktop-directory-picker-plugin-service`、`guest-bridge-protocol`、`guest-bridge-platforms`、`git-runtime-service`、`attachment-input-delivery`、`workspace-session-menu-patch`、`session-persistence-performance`（均为 tests/*.test.cjs）。

- 专属24例为 **23 pass / 1 fail**：全部本域修复与新增边界用例通过，深Git功能保持红。
- 剩余另外2 fail仍为两项1.0.59/1.0.60安装版本契约；3 skip仍为旧alpha2附件补丁条件。
- 上述旧right-workspace UI形状契约已由测试owner在此最终复跑前对齐，本成员未修改它；最终不再失败。
- Git owner最终候选新增前置可读探测 `rev-parse --is-bare-repository`，确认 `$GIT_DIR too big` 后返回 `GIT_ADMIN_PATH_TOO_LONG`、明确 no repository/worktree write started。这提升了失败保护与提示，**不等于深路径功能已实现**，专属正向功能测试仍失败。
- 覆盖清单57项：22 pass（注明测试层）、7 fixed、1 blocked（不支持硬链接）、1 fail（Git深路径）、26 unverified。不是覆盖率或全产品通过率。
- 7个本成员代码/测试文件 `node --check` 全通过，所涉tracked文件 `git diff --check` 无空白错误。

### 深 Windows Git 路径移交

专属测试初始化一个最小本地 source，README 初始提交只在 fixture 内；构造合法段名但总行政路径超过260。原实现 `-c core.longpaths=true --git-dir <absolute repository> fetch --no-tags --no-write-fetch-head <fixture source> HEAD:refs/heads/authority` exit128，stderr **`fatal: '$GIT_DIR' too big`**。

协作成员在并行尝试中出现过 `-c worktree.useRelativePaths=true --git-dir .` 候选：initialize 过，但 worktree add 仍同样 exit128。当时 repositoryPath.length=236、metadataPath.length=289、workspacePath.length=224。之后主矩阵观察的源码又回到 absolute fetch 早期失败。这里只记录不同时间点的共享脏树观察，不冒充不可变版本比较。

已将红用例和具体参数移交总审→Git owner；我未改 adapter、基础 patch 或 node_modules。短 TMP 曾23/23只是控制变量，**不是产品修复**。没有已证明可解决所有深路径的最小方案，不建议重复宣称 `core.longpaths=true` 已足够。

## 修改前 SHA-256 快照

各值均在本成员首次修改该文件前采集；不是完整仓库原子快照。既有脏内容从读取后做 literal edit 保留。

| 文件 | 修改前 SHA-256 |
|---|---|
| plugins/dsh-desktop-files/lib/index.js | E43AC219F750F589398D6F6870BF7AC119A0EEAEAC87839FA04EB9B871775D83 |
| plugins/dsh-session-experience/lib/index.js | 092EBAF753B715798161F0FBCB0E6B187C6446CB79A7AE3D2D93DD99C7FAEBBF |
| electron/bridge/right-workspace-service.cjs | C54BD1B193AC0C6735616891418D644E72CB508ED1B1D265FF3DC97003E839FC |
| plugins/dsh-desktop-directory-picker/lib/client.js | 49BC2A0BB4C4A795CB6D861CB32CD4164018B49643185C7C5572C9CAF820EB3F |
| plugins/dsh-session-experience/lib/client.js | 68367DD4536F99EEA31DF1C72ED6E72538FD25C93FA353A1C852085E2F82468D |
| electron/bridge/local-target-service.cjs | 0369D6972C0B3D6E837AAED13566D5DB89AA52424D4C50396F5122376BD8BDE4 |

## 尚未证明，不能称全绿

- 官方会话新建/搜索/命名/归档、实际取消/重试/消息队列、从真实历史加载和切换时 UI 滚动焦点：只有部分官方 seam 和 helper 测试，完整操作未跑。
- 工作区文件面板是 `uploads` 顶层列表，不是递归文件树；列表100项截断后搜索不是全工作区搜索。
- 复制路径在 main/preload 原生上下文菜单中的最终剪贴板值、系统应用实际打开/下载导出、图片/音视频/PDF解码、HTML iframe真实脚本和网络隔离均未做实际GUI验证。
- 深路径/多项目 Changeset/merge/quality 全链由协作/验收成员接续，当前失败不消除。
- 无支持的真实运行实例验证授权，本轮没有借 @browser/@computer-use 越过要求去修改运行实例。
- UI只更改异步状态和动作锁；未声称屏幕阅读器、375px、主题对比度、reduced-motion 等视觉/辅助技术全验收。

提交的是有逐项缺口的源码修复与行为审计产物，不是“会话文件项目全功能已全部完成”的证据。
