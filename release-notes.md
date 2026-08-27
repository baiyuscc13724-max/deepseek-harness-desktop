# Harness Desktop 1.0.50

v1.0.50 是一次统一的桌面、Android 与 iOS/iPadOS 源码正式更新：重点完成 **Mobile Orbit 手机工作台重构**，同时纳入统一更新中心、全桌面 Computer Use、Agent Teams/会话可靠性、浏览器首次使用、文件预览、工具图片、模型目录和安全重试修复。

本版本不会静默替用户安装。桌面端只有在用户于更新中心明确点击更新/安装后才会切换版本；Android 也必须由用户手动安装签名 APK。

## Mobile Orbit：手机端重新设计

- 手机端采用固定四域导航：**对话、代理团队、定时任务、设置**，不再把不同对象混入同一搜索或使用无功能占位页。
- 对话详情、项目/会话列表、搜索、设置详情、团队详情、弹层和系统/边缘返回按可预测层级关闭；新增带文字的“首页”入口，避免只依赖图标理解。
- Android 与 iOS/iPadOS 共用同一套审查过的移动 CSS/运行时资源，覆盖安全区、深浅色、横竖屏、键盘抬升、放大字体、减少动态效果、非纯颜色选中态和关键触控目标。
- 代理团队页明确展示“所属项目”和“来源会话”，说明同名项目不会合并团队；“选择其他项目或会话”通过权威会话控件切换，不按名称猜测团队、任务或会话。
- 官方 TodoDock、QueueDock、Agent Team 和定时任务仍是唯一权威状态源；手机层只做适配和展示，不复制任务状态或发明第二套任务标识。
- 未读仅在同一会话的最新权威历史成功加载后清除。过期快照、失败请求、子代理历史或会话不匹配均不会提交已读回执。
- 手机设置可只读查看配对电脑的真实模型路由、Provider 余额/额度与插件清单；结果受数量和文本长度限制，移除凭据、本机路径、原始错误和私密来源字段，接口为 GET-only 且 `Cache-Control: no-store`。
- iOS/iPadOS 前台恢复保持配对、幂等并感知网络状态。没有 Apple Developer 会员时继续使用 iPhone/iPad 模拟器门禁和 Safari/添加到主屏幕方案，不发布未签名 IPA。

## Android 原生输入与隐私

输入框“+”现在只显示四个真实系统动作：

1. **相册**：使用 Android Photo Picker，可多选但有上限。
2. **拍摄**：调用系统相机，把照片写入受限 `FileProvider` 临时缓存；最大 12 MiB，成功、取消和异常后都会清理。
3. **语音输入**：调用系统语音识别并沿用系统语言，不申请应用自身的录音权限。
4. **文件**：调用系统文件选择器并只保留本次临时读取授权。

相册/文件结果继续进入官方粘贴或拖放预览与发送流程；应用不申请 `READ_MEDIA_*`、外部存储或 `RECORD_AUDIO`。截图检测只显示隐私提示并建议打开系统照片选择器，应用不会读取截图像素。WebView 从后台恢复时不强制 reload，避免丢失草稿、滚动和页面状态。

局域网连接优先选择非 VPN 物理网络 socket，失败后再使用 Android 系统路由；既有 P2P、端到端加密 WSS/SOCKS 和中继边界不变。

## 统一更新中心

- 桌面稳定版、签名组件与已签名 PR Preview 在同一更新中心展示。
- 每项更新包含来源、版本/提交、说明、审查、下载/应用进度、历史、失败重试和回滚状态。
- 已安装 Preview 的精确 PR/head 会被持久记录；同一 head 重新发布不会重复提示，真正的新 head 仍会显示。
- Preview 应用失败或健康检查失败时保留稳定回滚点；“退出当前预览”恢复稳定通道。

## Computer Use：重要权限变化

> **请在授权前阅读：v1.0.50 有意扩大了桌面 Computer Use 的控制范围。**

- 经 Harness Desktop 推送的可信授权卡选择“本次授权”或“永久授权”后，Computer Use 可读取并控制所有显示器组成的**完整 Windows 虚拟桌面**。
- 截图和输入共用一个全局坐标面；点击、滚动直接使用最新截图的像素坐标，由宿主映射到实际显示器，修复重复缩放和多显示器偏移。
- 授权后不再选择单个窗口，也不再使用窗口绑定、逐动作确认、内容级敏感窗口/敏感输入过滤；桌面输入可能作用于当前获得焦点的任意应用。
- “永久授权”会跨应用重启保留，并在启动时自动恢复共享控制会话；锁屏、睡眠和系统会话切换会暂停，恢复后继续。按 `Esc`、点击停止或在“设置 → 插件 → Computer Use”撤销永久授权可终止控制。
- 透明控制指示覆盖每块显示器，不拦截鼠标且不会进入 Computer Use 截图。
- `browser_control` 仍保留独立硬边界：不能代输密码、账户、验证码、支付或银行信息，也不执行登录、支付、转账流程。文件、仓库、网页和手机任务仍必须优先使用结构化工具，Computer Use 只作为最后视觉后备。

完整审查见 [`docs/SECURITY-REVIEW-v1.0.50.zh-CN.md`](docs/SECURITY-REVIEW-v1.0.50.zh-CN.md)。

## 桌面可靠性与工具体验

- Agent Teams 区分无访问权、成员失败、受控停止和无内容完成，避免错误归因；失败成员保持 fail-closed，不能继续接收未完成任务。
- 会话置顶、未读和起始时间由桌面端持久保存，重启和本地运行端口变化后仍能恢复。
- 内置浏览器支持首次 `navigate`/`tabOpen` 从严格空 URL 或 `about:blank` 安全启动，并保持后台优先；其他内部或错误页面不能借此建立来源。
- 右侧工作区可安全预览工作区内图片、音频、视频、PDF、HTML 和有界文本；用户明确点击的工作区外绝对路径只读放行，路径、大小、远程来源和 MIME 检查不变。
- 图片生成等工具结果可持久显示并在重载后恢复，只信任桌面附件存储物化的文件；恶意远程图片、任意 `file:` URL 和超大 data URL 继续拒绝。
- 正式包恢复完整 Provider/Model catalog，设置和模型路由不再因打包裁剪而缺少可选模型。
- `edit` 锚点失配时停止原样重试，只基于最新文件内容尝试一次短、唯一、有界恢复；候选含糊仍拒绝修改。
- Codex 临时过载支持最多五次、可取消的有界指数退避并覆盖流式中途失败；认证、额度和其他 Provider 错误不重试，耗尽后保留当前会话和恢复说明。

## 纳入范围

- 完整纳入通过门禁的 PR：[#27](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/27)、[#28](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/28)、[#29](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/29)、[#30](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/30)、[#34](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/34)、[#35](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/35)、[#37](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/37)、[#39](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/39)、[#40](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/40)、[#41](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/41)、[#42](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/pull/42)。
- PR #33 的累计 head 用作上述全部来源均已包含、且包含发布时主分支的集成证明。
- PR #2 与 #7 不纳入：正式基线继续固定 Electron `43.2.0` 与 `@earendil-works/pi-ai` `0.82.1`。
- 另包含维护工作区中的完整 Mobile Orbit APP 重构及其最后一轮移动设置、上下文和返回协议修复。

## 版本与正式产物

- 桌面根包、lockfile 和 14 个随包插件：`1.0.50`
- Android：`versionName=1.0.50`、`versionCode=1005000`
- iOS/iPadOS 源码：`MARKETING_VERSION=1.0.50`、build `10050`
- 正式 Tag：`v1.0.50`
- 正式 Release 必须精确包含 18 项：
  - 2 个 Windows 包：安装版、便携版
  - 4 个 macOS 包：Intel/Apple Silicon 的 DMG 与 ZIP
  - 2 个 Linux 包：AppImage、DEB
  - 1 个云签名 Android APK 与 1 个 APK SHA-256
  - 3 个平台 desktop-shell ZIP
  - 3 个签名组件 manifest
  - `SHA256SUMS.txt` 与 `COMPONENT-SHA256SUMS.txt`

这些资产只由仓库 resumable publisher 绑定精确 main SHA 后在 GitHub Actions 构建和签名，再由 CNB Runner 从 GitHub 云到云镜像；不会从本机上传二进制。三个签名 stable feed 只在 GitHub 与 CNB 的 18 项资产全部验证后最后提升。已发布 v1.0.49 的 Tag、资产、APK、组件和 feed 保持不可变。

## 如何更新（需要用户手动确认）

### 已安装的 Windows/macOS 桌面版

1. 保存正在进行的工作；更新安装阶段会要求重启应用。
2. 点击界面右下角显示“当前版本”的按钮。
3. 在“更新中心”点击 **立即检查**。
4. 找到“桌面版 1.0.50”，先展开并阅读说明，再点击 **立即更新**；下载完成后按界面提示点击 **立即安装**。
5. 应用重新打开后，再次点击右下角版本按钮；预期看到 `1.0.50` 和“当前已是最新”。

如果未出现更新：确认联网后再点一次“立即检查”；仍失败时打开 [GitHub v1.0.50 Release](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.50) 下载安装包。不要在其他会话仍执行任务时安装或重启；可选择“稍后安装”。

### Windows 直接下载

- 安装版：[Harness-Desktop-1.0.50-win-x64.exe](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.50/Harness-Desktop-1.0.50-win-x64.exe)
- 便携版：[Harness-Desktop-1.0.50-portable-x64.exe](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.50/Harness-Desktop-1.0.50-portable-x64.exe)

下载完成后双击对应文件。安装版预期保留当前用户安装位置和配置；便携版直接启动。若浏览器提示下载未完成，请不要反复运行半成品，删除失败文件后从 Release 页面重新下载并核对 SHA-256。

### macOS 直接下载

- Apple Silicon：[Harness-Desktop-1.0.50-mac-arm64.dmg](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.50/Harness-Desktop-1.0.50-mac-arm64.dmg)
- Intel：[Harness-Desktop-1.0.50-mac-x64.dmg](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.50/Harness-Desktop-1.0.50-mac-x64.dmg)

打开 DMG，把 Harness Desktop 拖入“应用程序”，再从“应用程序”启动。若 macOS 阻止首次打开，请在 Finder 中右键应用并选择“打开”，核对应用名称与 v1.0.50 Release 来源后确认。

### Android

1. 在桌面 Harness Desktop 打开“手机与远程同步”，确保已点击 **开启手机同步**。
2. 如果 Harness Mobile 已安装，可直接下载并安装 [Harness-Mobile-1.0.50-android-universal.apk](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.50/Harness-Mobile-1.0.50-android-universal.apk)；同一正式签名可覆盖安装并保留应用数据。
3. 首次安装时，也可在电脑上点击 **添加手机**，先用手机相机/浏览器扫描二维码下载 APK，再安装。
4. 打开 Harness Mobile，点击 **扫码连接电脑**，扫描电脑上的配对二维码。二维码有效期 10 分钟且只能成功配对一次。
5. 预期进入四域工作台，并在系统应用信息中看到版本 `1.0.50`。

若 Android 报“应用未安装”，先核对 [APK SHA-256](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.50/Harness-Mobile-1.0.50-android-universal.apk.sha256)。从非正式开发签名版本升级可能出现签名冲突；卸载会清除配对和本地应用数据，执行前请确认影响。

### iPhone/iPad

本版没有 IPA。请在电脑的“手机与远程同步”中点击 **开启手机同步**、再点 **添加手机**，用 iPhone/iPad 相机扫描二维码并在 Safari 打开工作台。需要固定入口时，在 Safari 点击“分享”→“添加到主屏幕”。预期以后从主屏幕图标进入同一配对工作台；若二维码过期，回到电脑再次点击“添加手机”生成新二维码。

## 完整性与下载故障

- GitHub Release：[v1.0.50](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.50)
- 永久最新版入口：[GitHub Releases / latest](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest)
- 全部桌面摘要：[SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.50/SHA256SUMS.txt)
- 组件摘要：[COMPONENT-SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.50/COMPONENT-SHA256SUMS.txt)

如果 GitHub 下载受限，可把同一文件名中的下载前缀换为 `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v1.0.50/`。GitHub 与 CNB 文件应具有相同大小和 SHA-256；不一致时不要运行文件，并在项目 Issues 报告具体文件名与观测到的摘要。