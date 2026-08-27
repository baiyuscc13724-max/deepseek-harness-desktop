# Harness Desktop 1.0.51

v1.0.51 是一次统一的桌面、Android 与 iOS/iPadOS 源码稳定更新，重点完成 **Agent Teams 计划/追踪/恢复契约**，并合入 Mobile APP 的导航、项目身份、权限、IME、前台恢复、附件与文档上传修复。

本版本不会静默替用户安装。桌面端只有在用户于更新中心明确点击更新/安装后才会切换版本；Android 也必须由用户手动安装签名 APK。本次隔离验证没有升级或重启当前 Harness Desktop，也没有把 APK 安装到手机。

## Agent Teams：先计划，再执行

- 团队计划现在具有可观察的 `draft → committed → active` 生命周期。任务或安全边界变化会产生新的 revision/hash 并回到 draft；精确 CAS commit 后才允许新 claim/spawn。
- 没有已建立成员时，提交后的计划保持 `committed`；首个成功任务认领或完整成员 publication 才进入 `active`，不会在 worker 尚未存在时提前宣称执行已开始。
- 重放完全相同的已提交计划会复用当前状态；陈旧 revision/hash、缺失任务绑定或尚未提交的 draft 都会拒绝执行。
- 公开 spawn 必须绑定真实持久任务。Host 在创建 continuable child 前原子记录成员占位、任务预绑定、计划 revision/hash 和启动意图；启动前失败、publication 不确定与后续工作投递失败均保留可恢复审计。
- 每个团队保存 `pauseEpoch`，每次任务尝试保存单调 `attempt`、`claimId` 和 `leaseEpoch`。Stop 前的旧 claim、旧 lease 与迟到写入无法覆盖新状态；完全一致的持久 receipt 可安全重放。

## Stop、Resume 与未验证 Checkpoint

- Stop 会先持久化新 epoch 和暂停门禁，再取消排队唤醒、隔离迟到 start 并中断成员，避免旧成员在“已停止”之后继续写入。
- Resume 改为两阶段 preview + CAS commit。回执绑定 requestId、previewId、pauseEpoch 与 teamRevision；陈旧预览拒绝，相同请求幂等复用，且恢复提交不会自动唤醒任何成员。
- 成员 checkpoint 和 next step 永远标记 `verified:false`，不能完成任务、授予权限或证明外部动作成功。
- 最后一份未验证 checkpoint 会在 release、再次 claim、Stop、force-retire 与 adopt 后继续保留其旧 claim/lease/报告者，用作下一位持有者的审计上下文，直到新持有者明确覆盖。
- 旧 fence 的保留不代表旧成员继续拥有执行权；任何写入仍必须通过当前 claim/lease 检查。

## 权限、Capability 与外部副作用

- 模型工具中的确认布尔最多形成 `human_attested`，不能产生 `host_verified`。当前没有注册过的 Host UI 证据入口，因此需要 Host 验证的 `confirm_each` 操作继续 fail closed。
- Capability 默认 `unknown`；没有 Host 证明时不会被 UI 或模型布尔升级为 verified。
- 外部副作用显式区分 `none | idempotent | confirm_each | forbidden`。Effect identity 只由 Host 从 team/task/effect 派生，公共工具不能提交任意 effect key。
- 普通网页、桌面 UI 与第三方动作不获得通用 exactly-once 声明。发生 `outcome_unknown` 时会阻止自动重试和完成，直到精确 direct-human root 明确解决。

## 同项目 Handoff / Adopt

- 暂停团队可由另一个最外层 direct-human root 在同一 canonical project 内接管；双方必须具有相同规范化项目身份，并使用短期单次 handoff token。
- Adopt 会递增 epoch、撤销旧 lease、退休旧 parent worker、释放未完成任务并保留 attempt/interruption/checkpoint 历史；不会把旧 child 伪装成 reparent，也不会自动 wake。
- 私有 canonical project hash 与 handoff token hash 只保留在 durable store。公开团队、ownership history 与 handoff 投影不会泄露这些哈希。
- v4 及更早团队采用非破坏迁移：空团队进入 `legacy_unplanned`，已有在途工作的团队进入 `legacy_active_gate`；旧工作不被删除，但新 claim/spawn 前必须按当前计划 recommit。

## 新任务板与 Mobile 追踪

- 桌面和手机统一采用四个主区：**Ready / Running / Attention / Done**；Cancelled 只进入历史。
- 不再显示模型猜测百分比、随机进度动画或伪 progressbar。
- Attention 只展示可核对状态：依赖失败、capability unknown、权限未证实、外部结果不确定、文件冲突、陈旧 lease、成员失败或部分 publication。
- 手机团队首页优先回答“需要确认什么 / 卡在哪里 / 下一步做什么”；Running 卡片可展示成员建议，但明确标注为未验证上下文。
- Android 与 iOS 共用字节一致的移动 runtime/CSS，保留 Android 48dp、iOS 44pt 触控基线、可见键盘焦点、非纯颜色状态、放大文字、减少动态效果、安全区和无横向溢出。

## Mobile APP 修复

### 导航与身份

- 四域导航、系统/边缘返回、首页、项目/会话上下文与设置入口统一走版本化原生桥或权威语义控件；设置只从“我的”进入，不再从对话菜单或未标识坐标猜测。
- 项目、会话、团队和任务继续使用稳定 ID；同名项目不会合并。新的权限模式、项目身份与来源会话测试防止回归。
- 团队页继续明确展示所属项目和来源会话，不复制官方 TodoDock、QueueDock 或 Agent Teams 的第二份状态。

### Android 前台、IME 与原生输入

- Android 从后台恢复时不再伪造网页 `online`/`focus` 事件，也不重复注入 runtime，避免草稿、滚动、IME 和页面状态被意外刷新。
- 系统返回和边缘返回共用固定协议，不再双重派发。
- 相册、拍摄、语音和文件继续使用固定原生动作与系统授权：不申请广泛媒体/外部存储读取权限，语音输入不申请应用自身录音权限，相机临时 URI 在成功、取消和异常后清理。
- 截图提示只建议打开系统照片选择器，不读取截图像素。

### 受限文档上传

- 只有已配对设备通过 cookie 鉴权后才能访问上传路由。
- 上传必须使用 POST 和固定 intent header；session ID、文件名、请求体、超时、重定向与响应大小都有边界，单次请求最大 50 MiB。
- 内容只会转发到官方 `/api/desktop-files/upload`，由 live root 提供权威 workspace cwd；手机不能提交或决定桌面本地落盘路径。
- 上游结果经过固定 schema 清洗，不向手机回传本地路径、任意 JSON 或原始错误正文。

## 安全边界没有被悄悄扩大

- v1.0.51 不扩大 v1.0.50 已审查的 Computer Use 桌面权限。经可信授权后的全 Windows 虚拟桌面范围、永久授权自动恢复、Esc/停止/撤销入口与透明控制指示保持不变。
- `browser_control` 仍有独立硬边界：不能代输密码、账户、验证码、支付或银行信息，也不执行登录、支付或转账流程。
- 文件、仓库、网页和手机任务仍必须优先使用结构化工具，Computer Use 只作为最后视觉后备。
- 完整审查见 [`docs/SECURITY-REVIEW-v1.0.51.zh-CN.md`](docs/SECURITY-REVIEW-v1.0.51.zh-CN.md)；既有全桌面授权审查见 [`docs/SECURITY-REVIEW-v1.0.50.zh-CN.md`](docs/SECURITY-REVIEW-v1.0.50.zh-CN.md)。

## 隔离验证

版本号、发布说明与安全审查完成后，合并源码已在独立工作树中重新通过：

- Agent Teams：128/128；
- Mobile：119/119；
- 全仓 `npm run verify`：1540 通过、0 失败、2 跳过；
- `npm run verify:release`：通过；
- Android `testDebugUnitTest + lintDebug + assembleDebug`：50 个任务，`BUILD SUCCESSFUL`；
- Android/iOS 共用 `mobile-runtime.js` 与 `mobile-compat.css`：SHA-256 一致。

上述本地门禁已在 `1.0.51` 版本准备后重新完成。正式 publisher 还必须通过锁定 main SHA 的 Windows/macOS/Linux 云构建、iOS 模拟器、Windows 安装/卸载、Android 长期证书签名、组件签名、精确 18 项资产与 GitHub/CNB 双云验证。

## 版本与正式产物

- 桌面根包、lockfile 和 14 个随包插件：`1.0.51`
- Android：`versionName=1.0.51`、`versionCode=1005100`
- iOS/iPadOS 源码：`MARKETING_VERSION=1.0.51`、build `10051`
- 正式 Tag：`v1.0.51`
- 正式 Release 必须精确包含 18 项：
  - 2 个 Windows 包：安装版、便携版
  - 4 个 macOS 包：Intel/Apple Silicon 的 DMG 与 ZIP
  - 2 个 Linux 包：AppImage、DEB
  - 1 个云签名 Android APK 与 1 个 APK SHA-256
  - 3 个平台 desktop-shell ZIP
  - 3 个签名组件 manifest
  - `SHA256SUMS.txt` 与 `COMPONENT-SHA256SUMS.txt`

这些资产只由仓库 resumable publisher 绑定精确 main SHA 后在 GitHub Actions 构建和签名，再由 CNB Runner 从 GitHub 云到云镜像；不会从本机上传二进制。三个签名 stable feed 只在 GitHub 与 CNB 的 18 项资产全部验证后最后提升。已发布 v1.0.50 的 Tag、资产、APK、组件和 feed 保持不可变。

## 如何更新（需要用户手动确认）

### 已安装的 Windows/macOS 桌面版

1. 保存正在进行的工作；更新安装阶段会要求重启应用。
2. 点击界面右下角显示“当前版本”的按钮。
3. 在“更新中心”点击 **立即检查**。
4. 找到“桌面版 1.0.51”，展开并阅读说明，再点击 **立即更新**；下载完成后按界面提示点击 **立即安装**。
5. 应用重新打开后，再次点击右下角版本按钮；预期看到 `1.0.51` 和“当前已是最新”。

如果未出现更新：确认联网后再点一次“立即检查”；仍失败时打开 [GitHub v1.0.51 Release](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.51) 下载安装包。不要在其他会话仍执行任务时安装或重启；可选择“稍后安装”。

### Windows 直接下载

- 安装版：[Harness-Desktop-1.0.51-win-x64.exe](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.51/Harness-Desktop-1.0.51-win-x64.exe)
- 便携版：[Harness-Desktop-1.0.51-portable-x64.exe](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.51/Harness-Desktop-1.0.51-portable-x64.exe)

下载完成后双击对应文件。安装版预期保留当前用户安装位置和配置；便携版直接启动。若浏览器提示下载未完成，请不要反复运行半成品，删除失败文件后从 Release 页面重新下载并核对 SHA-256。

### macOS 直接下载

- Apple Silicon：[Harness-Desktop-1.0.51-mac-arm64.dmg](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.51/Harness-Desktop-1.0.51-mac-arm64.dmg)
- Intel：[Harness-Desktop-1.0.51-mac-x64.dmg](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.51/Harness-Desktop-1.0.51-mac-x64.dmg)

打开 DMG，把 Harness Desktop 拖入“应用程序”，再从“应用程序”启动。若 macOS 阻止首次打开，请在 Finder 中右键应用并选择“打开”，核对应用名称与 v1.0.51 Release 来源后确认。

### Android

1. 在桌面 Harness Desktop 打开“手机与远程同步”，确保已点击 **开启手机同步**。
2. 如果 Harness Mobile 已安装，可直接下载并手动安装 [Harness-Mobile-1.0.51-android-universal.apk](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.51/Harness-Mobile-1.0.51-android-universal.apk)；同一正式签名可覆盖安装并保留应用数据。
3. 首次安装时，也可在电脑上点击 **添加手机**，先用手机相机/浏览器扫描二维码下载 APK，再安装。
4. 打开 Harness Mobile，点击 **扫码连接电脑**，扫描电脑上的配对二维码。二维码有效期 10 分钟且只能成功配对一次。
5. 预期进入四域工作台，并在系统应用信息中看到版本 `1.0.51`。

若 Android 报“应用未安装”，先核对 [APK SHA-256](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.51/Harness-Mobile-1.0.51-android-universal.apk.sha256)。从非正式开发签名版本升级可能出现签名冲突；卸载会清除配对和本地应用数据，执行前请确认影响。

### iPhone/iPad

本版没有 IPA。请在电脑的“手机与远程同步”中点击 **开启手机同步**、再点 **添加手机**，用 iPhone/iPad 相机扫描二维码并在 Safari 打开工作台。需要固定入口时，在 Safari 点击“分享”→“添加到主屏幕”。若二维码过期，回到电脑再次点击“添加手机”生成新二维码。

## 完整性与下载故障

- GitHub Release：[v1.0.51](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.51)
- 永久最新版入口：[GitHub Releases / latest](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest)
- 全部桌面摘要：[SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.51/SHA256SUMS.txt)
- 组件摘要：[COMPONENT-SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.51/COMPONENT-SHA256SUMS.txt)

如果 GitHub 下载受限，可把同一文件名中的下载前缀换为 `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v1.0.51/`。GitHub 与 CNB 文件应具有相同大小和 SHA-256；不一致时不要运行文件，并在项目 Issues 报告具体文件名与观测到的摘要。
