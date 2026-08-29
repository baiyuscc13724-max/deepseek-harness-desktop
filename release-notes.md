# Harness Desktop 1.0.53

v1.0.53 是一次保持功能、交互、协议、持久化和安全边界不变的性能与稳定性正式更新，重点优化大型会话库、长对话流、Agent Teams 生命周期和移动端文档体验。

本版本不会静默替用户安装。桌面端只有在用户于更新中心明确点击更新/安装后才会切换版本；Android 仍必须由用户手动安装长期证书签名的 APK。

## 大型会话库显著提速

- JSONL 会话制品枚举改为最多 8 路有界滑动并发，同时保留输入顺序、最早索引错误、重复检测、取消和已启动读取收敛语义。
- 983 个真实会话的直接基准中，中位枚举耗时约从 958 ms 降至 172 ms，约 5.6 倍。
- 已附着会话摘要复用精确增量 `sessionListMetadata` 投影；投影缺失时仍执行原始全量折叠，不会牺牲新鲜度或正确性。
- 没有自动分离历史会话、截断事件、缩短保留期或降低可继续性。

## 桌宠、渲染与设置响应

- 桌宠会话优先级、稳定排序与状态计数合并为单次遍历；10,000 组随机差分验证输出一致，2,500 会话基准约从 257.35 ms 降至 10.80 ms。
- 主题、模型路由、工作区链接、设置集成和子代理扫描只响应相关 DOM 变更，并使用单一单调定时器合并刷新。
- 普通聊天流和工具输出不再反复触发无关的设置或模型挂载；主题、右侧工作区和可见交互保持不变。

## Agent Teams 生命周期与正式版整合

- 协作状态在单次遍历中建立成员、状态和任务索引，大型状态投影基准约从 585.14 ms 降至 85.32 ms。
- Store 关闭时注销共享实例并清理监听；Agent Teams 与 Session Experience 的语言订阅跟随 Cordis effect 生命周期释放。
- 团队计划、任务、claim/lease、Stop、两阶段 Resume、handoff/adopt、协作收件箱、外部副作用 fencing 和移动端团队表面全部保留。
- 关闭团队不会自动删除或分离历史可继续会话；未完成任务仍必须按既有协调协议处理。

## Mobile 文档与跨端一致性

- Android 增加原生文档查看路径，要求有效配对鉴权和可信同源请求；下载为 100 MiB 有界、缓存交接、只读打开，并在 Activity/Executor 生命周期结束时清理。
- Android 与 iOS 的 `mobile-runtime.js`、`mobile-compat.css` 继续保持逐字节一致。
- 原生输入、附件、系统/边缘返回、会话上下文、Agent Teams 工作区与前台恢复语义不变。
- 密码、支付、银行、验证码、Shell、脚本、静默安装卸载、清除数据和权限绕过仍禁止。

## 更小的正式包

- Marketplace 的脚本、文档、仓库元数据、离线审计报告和其他 source-only 文件不再进入正式包。
- 运行时插件、注册表、技能、安装和更新功能不变；产物审计会拒绝 source-only 文件回流。
- 打包输入原始体积减少 6,180,439 bytes，约 5.89 MiB。

## 验证

维护树在发布前完成：

- 全仓 `npm run verify`：1660 通过、0 失败、2 个平台条件跳过；
- Agent Teams 专项：240/240；
- 渲染与插件专项：89/89；
- Mobile Node 测试：49/49；
- Android `testDebugUnitTest`：成功；
- `git diff --check`：通过。

正式发布仍由同一 resumable publisher 从精确 main 提交执行全平台 GitHub Actions 构建、iOS 模拟器验证、Windows 安装/卸载与打包自检、Android 长期证书签名、生产组件签名、精确 18 项资产清单、GitHub→CNB 云到云镜像，并在所有不可变资产就绪后才提升三个 stable feed。

## 版本身份

- 桌面根包、lockfile 和 14 个随包插件：`1.0.53`
- Android：`versionName=1.0.53`、`versionCode=1005300`
- iOS/iPadOS 源码：`MARKETING_VERSION=1.0.53`、build `10053`
- 正式不可变 Tag：`v1.0.53`
- 上一版 `v1.0.52` 的 Tag、18 项资产、签名 APK、组件与 stable feed 保持不可变

## 获取更新

### Windows

打开 Harness Desktop 设置中的更新中心，点击“立即检查”，阅读更新说明后明确选择下载和安装。也可以从 GitHub Release 下载安装版或便携版。

### Android

下载 `Harness-Mobile-1.0.53-android-universal.apk` 及其 `.sha256`，核对摘要后由用户手动安装。若 Android 提示签名冲突，请不要强行覆盖来源不明的旧包。

### macOS 与 iPhone/iPad

macOS 提供 Intel 和 Apple Silicon 的 DMG/ZIP 预览包，当前仍采用明确无 Developer ID/公证契约并可能显示 Gatekeeper 提示。iPhone/iPad 不发布未签名 IPA，继续通过 Safari 工作台和“添加到主屏幕”使用。

## 下载与完整性

- GitHub Release：[v1.0.53](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.53)
- 永久最新版入口：[GitHub Releases / latest](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest)
- 桌面摘要：[SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.53/SHA256SUMS.txt)
- 组件摘要：[COMPONENT-SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.53/COMPONENT-SHA256SUMS.txt)

如果 GitHub 下载受限，可把同一文件名中的下载前缀换为 `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v1.0.53/`。GitHub 与 CNB 文件应具有相同大小和 SHA-256；不一致时不要运行该文件。
