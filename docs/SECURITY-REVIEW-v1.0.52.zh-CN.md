# Harness Desktop v1.0.52 安全审查

审查日期：2026-08-28

审查范围：内置浏览器控制超时与未知结果 fencing、Git/更新器/Agent Teams 状态展示、右侧工作区与工具结果附件、会话时间线、桌面与 Android 设备工作区、Mobile 会话/附件桥，以及 v1.0.52 发布身份同步。

## 1. 结论

v1.0.52 可以作为新的不可变候选进入仓库 resumable publisher，但必须继续满足以下条件：

1. 只从干净、已提交并能安全快进到 `main` 的精确源码提交发布。
2. 正式 Tag 只能是新的 `v1.0.52`；已发布 `v1.0.51` 及更早版本的 Tag、资产、组件、APK 与 stable feed 不得移动、覆盖或复用。
3. 桌面包、Android APK、组件签名、精确 18 项 release manifest、GitHub→CNB 云镜像和 stable feed 提升只能由统一发布器按固定阶段完成；本机 debug APK 与其他本地产物不得成为发布输入。
4. 浏览器可变操作一旦超时，其外部结果按 `outcome unknown` 处理，后续可变操作必须被 fence；不得因为客户端超时而盲目重试点击、输入、选择或导航。
5. 右侧工作区的文件预览只允许经过规范化和边界检查的本地目标；程序、安装包和源码不会从预览面执行。
6. 设备控制继续要求用户先在可信界面授权或配对。Android 控制只暴露固定动作，不执行 Shell、脚本、密码、支付、银行、验证码、静默安装卸载、清除数据或权限绕过。

本次没有扩大 v1.0.50 已审查的 Computer Use 全桌面授权范围。v1.0.51 的 Agent Teams plan/claim/lease、Stop/Resume、handoff/adopt 与外部副作用边界也保持不变；本审查只记录本版新增或重新接线的风险面。

## 2. browser_control 超时与未知结果

### 2.1 有界底层操作

CDP 鼠标、键盘等输入通过统一的 `runBrowserOperation` 执行，默认硬上限为 8 秒。调用被主动中止时返回明确的取消结果；超过上限则返回 504 类错误，不再无限等待底层 Promise。

服务端处理器同时与 action abort 信号竞争。即使底层驱动不合作、忽略 abort 或迟迟不 resolve，序列化 scope 的 tail 也会释放，后续只读诊断不会被一个悬挂操作永久占用。这直接消除了原先外层 60 秒超时反复出现、同一 scope 后续调用继续排队的故障形态。

### 2.2 可变操作 fencing

对点击、输入、选择、导航等可变操作，超时并不等价于“动作没有发生”。系统因此：

- 返回 `browser-outcome-unknown`，而不是伪造失败后自动重试；
- fence 同一共享控制会话中的后续可变操作；
- 允许 `observe`、截图、console、network 等只读动作继续用于核对现场；
- 只有显式停止并重新建立控制会话后才清除 fence；
- 插件适配层把该结果展示为安全阻止状态，并明确提示不要自动重试。

这不能为任意网页动作提供 exactly-once 保证；它只是确保结果未知时停止扩大副作用。

### 2.3 浏览器原有硬边界

结构化浏览器通道仍禁止代输密码、账户、验证码、支付和银行内容，也不执行登录、支付、取款、转账流程。网页内容继续视为不可信数据，不能改变授权、确认、文件或敏感信息策略。

## 3. 右侧工作区、路径与附件

### 3.1 覆盖布局不改变会话主体

右侧工作区从窗口顶部拥有完整列，并使用 76px 内部安全区对齐官方工作台。首页保持紧凑宽度，具体工具使用用户可调宽度；两者都覆盖在 `#runtimeView` 之上，不再通过修改主会话宽度挤压聊天区域。窄屏工具页使用近全宽或全宽覆盖，并保持无水平溢出。

真实 Electron 几何夹具同时核对：

- 桌面首页 280px 覆盖宽度；
- 桌面工具页 640px 覆盖宽度；
- 800px 视口下保留 48px 上下文边缘；
- 会话区域始终保持完整视口宽度；
- 顶部安全区、拖拽手柄与文档溢出不产生越界。

### 3.2 本地目标规范化

右键菜单先用 `resolveGuestLocalTarget` 规范化目标，再把得到的 `local.path` 传给预览、打开项目、在文件夹中显示或复制路径动作。相对目标被限制在当前工作区，绝对路径仍需宿主验证；不再把未规范化的原始 `localValue` 直接用于系统动作。

HTML 只在隔离预览中打开；文本与源码只读展示；图片、音频、视频和 PDF 受路径、类型和大小边界约束。程序和安装包不会执行，远程 URL 也不能伪装成本地文件。

### 3.3 工具结果与会话归属

官方 runtime 补丁现在统一转发图片、普通文件、音频和视频工具结果，并保存真实 owner/session 归属。跨会话完成通知、时间线定位和草稿转移使用该归属，不把当前前台会话误当成产出会话。

可恢复的编辑冲突仍作为可检查错误呈现，不把冲突内容静默覆盖。附件输入继续走官方 composer/Files 流程，不建立第二套私有上传状态。

## 4. Git、更新器与 Agent Teams 展示

Git 连接状态与详情折叠状态已分离：

- 已连接时开关反映真实连接，不因详情默认折叠而显示“关闭”；
- 详情可折叠，但 Git、GCM、SSH 状态和既有操作继续保留；
- 未连接、Git 未准备好和已连接状态分别呈现，不用一个 disclosure 开关混淆授权/连接事实。

更新中心继续保留稳定版更新与签名 PR Preview 的既有能力。下载或安装不会静默开始，正式安装仍需要用户在更新界面明确确认；失败和稍后安装路径继续可见。

Agent Teams 继续只占用官方 `conversation.view`，不再向 `conversation.input.dock` 注入隐藏状态组件。Mobile 复用官方 Agent Teams 工作区、画布和自动化表面，不维护第二份 `mobileTasksState` 或 `taskProjectionState`。Ready / Running / Attention / Done、取消历史、capability unknown、外部结果不确定、文件冲突和未验证 checkpoint 的安全投影保持原样。

## 5. 桌面与 Android 设备控制

右侧设备工作区只负责展示已存在的可信控制通道和明确状态，不自行提升权限。

Android 控制边界：

- 必须先查询 `status` 并确认已配对设备与 capability；
- 只接受 `observe`、tap、longPress、swipe、back、home、recents、textInput、openApp、openUri、openSettings、screenshot、fileOpen、fileCreate、clearCache 与 stop 等固定动作；
- 不接受 Shell 或任意脚本；
- 密码、支付、银行、验证码、清除数据、静默安装卸载和权限绕过始终禁止；
- textInput、文件写入与清理缓存继续由手机端二次确认。

Windows Computer Use 仍复用可信 Host 的本次/永久授权。授权后的完整虚拟桌面范围、最新截图像素坐标、Esc/停止/撤销和锁屏/挂起暂停行为不变。设备工作区没有创建新的授权方式，也不能绕过原有控制会话。

## 6. Mobile 会话与资源一致性

Android/iOS 移动运行时继续复用官方会话、Todo/Queue 和 Agent Teams 表面，不通过额外输入 dock 猜测 session ID。移动端的项目、会话、团队和任务身份仍使用稳定 ID；同名项目不合并。

文档与附件仍只经已配对 cookie、POST intent、50 MiB 上限和官方工作区上传路径转发；手机不能决定桌面本地落盘路径。Android/iOS 的 `mobile-runtime.js` 与 `mobile-compat.css` 保持逐字节一致。

Android 插件安装改为临时目录 + 备份目录的可恢复替换。Windows 上遇到 `EACCES`、`EBUSY` 或 `EPERM` 临时锁时进行有界退避重试；新目录启用失败时尝试恢复旧目录，不在删除旧版本后留下半安装状态。

## 7. 本地隔离验证证据

在未安装 APK、未升级或重启当前 Harness Desktop 的维护工作树中完成：

- 全仓 `npm run verify`：1628 通过、0 失败、2 跳过；
- Android `testDebugUnitTest + lintDebug + assembleDebug`：50 个任务，`BUILD SUCCESSFUL`；
- Android 插件重复安装压力测试：连续 3 轮通过；
- Session Timeline 真实 Electron 夹具：通过；
- Right Workspace 首页/工具页/窄屏真实 Electron 几何夹具：通过；
- Android/iOS `mobile-runtime.js` 与 `mobile-compat.css`：合并后逐字节一致；
- `npm run verify:release` 与 `git diff --check`：通过。

上述全仓、release audit、Android 和 Electron 门禁均已在版本准备后重新执行。本地证据不替代正式发布器的云端 Windows/macOS/Linux 构建、iOS 模拟器、Windows 安装/卸载、Android 长期证书签名、组件签名、18 项资产和双云验证。本机 debug APK 不得进入正式 Release。

## 8. 版本与剩余边界

- 桌面与 14 个随包插件：`1.0.52`；
- Android：`versionName=1.0.52`、`versionCode=1005200`；
- iOS/iPadOS 源码：`MARKETING_VERSION=1.0.52`、build `10052`；
- 目标不可变 Tag：`v1.0.52`。

剩余边界：

1. 浏览器驱动在超时时可能已经产生外部动作；fencing 只能阻止继续扩大影响，不能倒推第三方页面真实结果。
2. 真机 Android 控制、完整 Windows 多屏输入、macOS 真机与签名产物仍需要设备或云端证据；单元测试和本地 debug 构建不能伪装成这些事实。
3. iPhone/iPad 在没有 Apple Developer 会员时继续走模拟器门禁与 Safari“添加到主屏幕”，不发布未签名 IPA。
4. 正式发布必须由 `npm run release:publish -- run --version 1.0.52` 完成并以同一命令断点续跑；任何阶段失败都不得手工跳过、移动 Tag、替换资产或提前提升 stable feed。
