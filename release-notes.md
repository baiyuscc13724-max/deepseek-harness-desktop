# Harness Desktop 1.0.52

v1.0.52 是一次统一的桌面、Android 与 iOS/iPadOS 源码稳定更新，集中修复 **更新器、Agent Teams、Git 连接状态、browser_control 超时、右侧工作区、跨会话附件与设备控制**，并整合 Mobile 会话和时间线改进。

本版本不会静默替用户安装。桌面端只有在用户于更新中心明确点击更新/安装后才会切换版本；Android 也必须由用户手动安装签名 APK。本次隔离验证没有升级或重启当前 Harness Desktop，也没有把 debug APK 安装到手机。

## 更新器、Git 与 Agent Teams

### Git 连接卡片不再把“折叠”误当成“关闭”

- Git/GitHub 的真实连接状态与详情展开状态完全分离。
- 用户已经连接时，连接开关保持开启；状态信息默认折叠不会再让卡片显示为关闭。
- 未连接、Git 尚未准备好和已连接分别显示，不用同一个开关混淆不同事实。
- Git、GCM、SSH 的状态、连接入口、修复动作和既有功能全部保留；折叠只影响信息密度，不会禁用能力。

### 更新中心保留稳定版与 PR Preview

- 稳定版检查、签名 PR Preview、安装前说明、下载进度、失败重试、稍后安装和回滚入口继续共存。
- 下载或安装仍必须由用户明确触发，不会因为检查到新版而静默切换。
- 更新确认弹层继续继承当前主题，启动安装失败时提供可见错误和重试路径。

### Agent Teams 继续复用官方工作台

- 桌面 Agent Teams 只注册官方 `conversation.view`，不再向输入区注入隐藏 dock，也不建立第二套弹层或任务状态。
- Mobile 直接复用官方团队工作区、画布、任务板与自动化表面，移除矛盾的自定义 Mobile task hub。
- Ready / Running / Attention / Done、取消历史、依赖阻塞、capability unknown、外部结果不确定、文件冲突和未验证 checkpoint 的安全投影全部保留。
- 自动团队开关、计划 `draft → committed → active`、claim/lease fencing、Stop、两阶段 Resume 与 handoff/adopt 契约不被本次 UI 合并覆盖。

## browser_control：不再被一次悬挂输入拖死

- CDP 鼠标和键盘输入统一经过 8 秒硬上限；底层 Promise 忽略 abort 时，服务端也会释放序列化队列，不再让后续调用连续卡满外层 60 秒。
- 主动取消返回明确 cancelled 状态；超时返回 `browser-outcome-unknown`，不会伪装成“确定没有发生”。
- 可变操作结果未知后，同一控制会话的后续点击、输入、选择和导航会被 fence，避免盲目重试扩大副作用。
- `observe`、截图、console、network 等只读诊断仍可使用；显式停止并重新建立控制会话后才清除 fence。
- 浏览器插件把该状态显示为安全阻止，并明确提示不要自动重试。
- 原有凭据和交易硬边界不变：不代输密码、账户、验证码、支付或银行内容，也不执行登录、支付、取款或转账流程。

## 右侧工作区、文件预览与附件

### 不再挤压官方会话

- 右侧工作区现在覆盖在官方工作台右侧，不再缩小 `#runtimeView` 或挤压聊天内容。
- 首页使用 280px 紧凑宽度，具体工具保持 640px 默认可调宽度；窄屏按 48px 上下文边缘或全宽覆盖响应。
- 顶部 76px 安全区由右栏自身维护，可随主题、壁纸、首页/工具模式一起更新。
- 新增真实 Electron 几何门禁，分别验证首页、工具页和 800px 窄屏布局。

### 更完整的只读预览

- 工作区文件可以在右栏预览文本、源码、HTML、图片、音频、视频和 PDF。
- HTML 只在隔离环境试玩；程序和安装包不会执行，源码只读展示。
- 右键菜单先规范化本地目标，再执行“在右侧工作区预览”“打开此项目”“在文件夹中显示”或复制路径。
- 相对路径限制在工作区；绝对路径、类型、大小、远程来源和 MIME 继续由宿主验证。

### 工具结果归属真实会话

- 图片、普通文件、音频和视频工具结果统一进入持久转发路径。
- 附件保留真实 owner/session，不再把后台会话产出误挂到当前前台会话。
- 会话时间线可重新定位附件和完成结果；跨会话完成通知、草稿转移和归档入口继续保留。
- 可恢复编辑冲突会作为明确错误展示，不静默覆盖用户内容。

## 桌面与 Android 设备工作区

- 右栏增加统一设备模式，可在同一工作区查看已授权 Windows 桌面流或已配对 Android 手机。
- 设备来源、连接状态、画面比例、工具栏和停止入口保持可见；切换设备不会挤压官方会话。
- Windows 结构化 UI 自动化和 Computer Use 继续复用可信 Host 授权，不创建第二套授权入口。
- Android 控制只暴露固定动作；必须先查询配对状态和 capability，不执行 Shell 或脚本。
- 密码、支付、银行、验证码、清除数据、静默安装卸载和权限绕过始终禁止；文本输入、文件写入与清理缓存仍由手机端二次确认。
- Android 插件采用临时目录、备份目录和有界退避重试；Windows 防病毒或索引产生短暂 `EPERM`/`EBUSY` 时不再留下半安装目录。

## Mobile 会话、附件与官方团队入口

- Android/iOS 继续共享逐字节一致的 `mobile-runtime.js` 和 `mobile-compat.css`。
- Mobile 不通过额外输入 dock 猜测会话，而是复用官方会话和团队工作区；项目、会话、团队和任务继续使用稳定 ID。
- 会话安全转移、时间线引用、附件状态与前台恢复保留较新的实现，避免合并回退到旧的重复状态。
- Android 四宫格附件菜单挂载到页面 body，固定面板不再被真实 WebView 中带 transform/overflow 的 composer 祖先裁剪；菜单自身点击不会被误判为外部点击，composer 重挂载会清理孤立面板，四个固定动作不变。
- 文档上传继续要求已配对 cookie、POST intent、50 MiB 上限和官方工作区上传路径；手机不能决定桌面落盘路径。
- Android 原生输入、系统/边缘返回、相册、拍摄、语音、文件选择、IME 与临时 URI 清理边界不变。

## 安全审查

- 完整审查见 [`docs/SECURITY-REVIEW-v1.0.52.zh-CN.md`](docs/SECURITY-REVIEW-v1.0.52.zh-CN.md)。
- v1.0.52 没有扩大 v1.0.50 已审查的 Computer Use 全桌面权限。
- v1.0.51 已审查的 Agent Teams plan/claim/lease、Stop/Resume、handoff/adopt、checkpoint 与外部副作用契约保持不变。
- 浏览器超时只能证明“结果未知”，不能证明第三方页面没有动作；因此必须 fence 而不是自动重试。
- 任何页面文字、附件内容或设备画面都不能改变授权、敏感输入、文件或发布策略。

## 隔离验证

合并源码在维护工作树中完成：

- 全仓 `npm run verify`：1628 通过、0 失败、2 跳过；
- Android `testDebugUnitTest + lintDebug + assembleDebug`：50 个任务，`BUILD SUCCESSFUL`；
- Android 插件重复安装压力测试：连续 3 轮通过；
- Session Timeline 真实 Electron 夹具：通过；
- Right Workspace 首页/工具页/窄屏真实 Electron 几何夹具：通过；
- Android/iOS 共用 runtime 与 CSS：合并后逐字节一致；
- `npm run verify:release` 与 `git diff --check`：通过。

上述全仓、release audit、Android 和 Electron 门禁均已在版本号、发布说明和安全审查完成后重新执行。正式 publisher 还必须通过锁定 main SHA 的 Windows/macOS/Linux 云构建、iOS 模拟器、Windows 安装/卸载、Android 长期证书签名、组件签名、精确 18 项资产与 GitHub/CNB 双云验证。

## 版本与正式产物

- 桌面根包、lockfile 和 14 个随包插件：`1.0.52`
- Android：`versionName=1.0.52`、`versionCode=1005200`
- iOS/iPadOS 源码：`MARKETING_VERSION=1.0.52`、build `10052`
- 正式 Tag：`v1.0.52`
- 正式 Release 必须精确包含 18 项：
  - 2 个 Windows 包：安装版、便携版
  - 4 个 macOS 包：Intel/Apple Silicon 的 DMG 与 ZIP
  - 2 个 Linux 包：AppImage、DEB
  - 1 个云签名 Android APK 与 1 个 APK SHA-256
  - 3 个平台 desktop-shell ZIP
  - 3 个签名组件 manifest
  - `SHA256SUMS.txt` 与 `COMPONENT-SHA256SUMS.txt`

这些资产只由仓库 resumable publisher 绑定精确 main SHA 后在 GitHub Actions 构建和签名，再由 CNB Runner 从 GitHub 云到云镜像；不会从本机上传二进制。三个签名 stable feed 只在 GitHub 与 CNB 的 18 项资产全部验证后最后提升。已发布 v1.0.51 的 Tag、资产、APK、组件和 feed 保持不可变。

## 如何更新（需要用户手动确认）

### 已安装的 Windows/macOS 桌面版

1. 保存正在进行的工作；更新安装阶段会要求重启应用。
2. 点击界面右下角显示“当前版本”的按钮。
3. 在“更新中心”点击 **立即检查**。
4. 找到“桌面版 1.0.52”，展开并阅读说明，再点击 **立即更新**；下载完成后按界面提示点击 **立即安装**。
5. 应用重新打开后，再次点击右下角版本按钮；预期看到 `1.0.52` 和“当前已是最新”。

如果未出现更新：确认联网后再点一次“立即检查”；仍失败时打开 [GitHub v1.0.52 Release](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.52) 下载安装包。不要在其他会话仍执行任务时安装或重启；可选择“稍后安装”。

### Windows 直接下载

- 安装版：[Harness-Desktop-1.0.52-win-x64.exe](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.52/Harness-Desktop-1.0.52-win-x64.exe)
- 便携版：[Harness-Desktop-1.0.52-portable-x64.exe](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.52/Harness-Desktop-1.0.52-portable-x64.exe)

下载完成后双击对应文件。安装版预期保留当前用户安装位置和配置；便携版直接启动。若浏览器提示下载未完成，请不要反复运行半成品，删除失败文件后从 Release 页面重新下载并核对 SHA-256。

### macOS 直接下载

- Apple Silicon：[Harness-Desktop-1.0.52-mac-arm64.dmg](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.52/Harness-Desktop-1.0.52-mac-arm64.dmg)
- Intel：[Harness-Desktop-1.0.52-mac-x64.dmg](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.52/Harness-Desktop-1.0.52-mac-x64.dmg)

打开 DMG，把 Harness Desktop 拖入“应用程序”，再从“应用程序”启动。若 macOS 阻止首次打开，请在 Finder 中右键应用并选择“打开”，核对应用名称与 v1.0.52 Release 来源后确认。

### Android

1. 在桌面 Harness Desktop 打开“手机与远程同步”，确保已点击 **开启手机同步**。
2. 如果 Harness Mobile 已安装，可直接下载并手动安装 [Harness-Mobile-1.0.52-android-universal.apk](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.52/Harness-Mobile-1.0.52-android-universal.apk)；同一正式签名可覆盖安装并保留应用数据。
3. 首次安装时，也可在电脑上点击 **添加手机**，先用手机相机/浏览器扫描二维码下载 APK，再安装。
4. 打开 Harness Mobile，点击 **扫码连接电脑**，扫描电脑上的配对二维码。二维码有效期 10 分钟且只能成功配对一次。
5. 预期进入四域工作台，并在系统应用信息中看到版本 `1.0.52`。

若 Android 报“应用未安装”，先核对 [APK SHA-256](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.52/Harness-Mobile-1.0.52-android-universal.apk.sha256)。从非正式开发签名版本升级可能出现签名冲突；卸载会清除配对和本地应用数据，执行前请确认影响。

### iPhone/iPad

本版没有 IPA。请在电脑的“手机与远程同步”中点击 **开启手机同步**、再点 **添加手机**，用 iPhone/iPad 相机扫描二维码并在 Safari 打开工作台。需要固定入口时，在 Safari 点击“分享”→“添加到主屏幕”。若二维码过期，回到电脑再次点击“添加手机”生成新二维码。

## 完整性与下载故障

- GitHub Release：[v1.0.52](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.52)
- 永久最新版入口：[GitHub Releases / latest](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest)
- 全部桌面摘要：[SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.52/SHA256SUMS.txt)
- 组件摘要：[COMPONENT-SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.52/COMPONENT-SHA256SUMS.txt)

如果 GitHub 下载受限，可把同一文件名中的下载前缀换为 `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v1.0.52/`。GitHub 与 CNB 文件应具有相同大小和 SHA-256；不一致时不要运行文件，并在项目 Issues 报告具体文件名与观测到的摘要。
