# Harness Desktop 1.0.56

v1.0.56 是一次整合官方 Harness `0.1.2-alpha.3`、Agent Teams 可靠性、Mobile 导航与附件体验，以及定时任务实现收敛的正式更新。本版把当前维护树中已完成的多会话修复统一纳入同一个不可变版本，并继续保留 Stop、跨项目、真实外部副作用、结果未知、敏感输入和发布签名的硬门禁。

本版本不会静默替用户安装。桌面端只有在用户于更新中心明确点击更新/安装后才会切换版本；Android 仍必须由用户手动安装长期证书签名的 APK。

## 官方 Harness alpha.3 维护迁移

- 所有直接官方 DSH 依赖统一精确固定为 `0.1.2-alpha.3`，lockfile 保留精确 resolved/integrity；移除包不得重新进入直接依赖图，意外新增 root 或版本漂移一律 fail closed。
- 此前的官方 `0.1.2-alpha.2` 证据仅作为 superseded 历史迁移基线保留，不再描述当前运行时、门禁或发布状态。
- 原生接入 Session Controller 的长历史 `loadThrough`、轮次导航与 `turnOutline` projection、附件队列缩略图、手动断线重连、Schedule catalog，以及 Gateway/Remotes stream 能力。
- 关键 alpha.3 capability artifacts 同时校验精确 SHA-256 和预期语义片段，避免“版本号相同但运行能力漂移”被误判为兼容。
- Session Experience 不再依赖已退休的 `@deepseek-ai/dsh-client-runtime`；append surface 只接受明确的 user/assistant/tool result 事件类型。
- 自研 Project/Team、canonical project 隔离、任务/租约/验收账本、路由回执、恢复和证据仍是唯一权威数据面；官方 experimental Team 不接管，也不进行状态双写。

## Agent Teams 任务、租约与恢复修复

- `leaseEpoch=0` 不再被 UI 当作缺失值；任务认领、提交、复核和释放继续精确绑定 claimId、leaseEpoch 与当前 revision。
- 修复显式 Stop 与迟到 submission 的竞态：暂停先于 replay 生效，迟到结果不能越过 pause epoch，停止后的任务可安全回到 pending。
- 强制成员退休会清理活动 claim、追加释放账本并恢复可认领任务，不再留下僵尸租约或长期阻塞。
- Root 的破坏性项目任务命令（含 `release`）统一使用 revision/CAS 和持久 request receipt；no-op replay、retired target replay、state-only 伪造及 stale revision 均有明确拒绝或幂等语义。
- 外部 effect 状态变化会推进 revision；`outcome_unknown` 仍须精确 Host 授权，不能因重试、恢复或 UI 重放而绕过。
- 顶层协作会话的排队启动状态写入 schema v13 waiter/outbox；Host wake scheduler 可在重启后恢复未完成投递，已确认投递不会重复创建。
- 顶层子会话启动前执行精确 workspace 预检，并把已验证的工作目录持久传递给子进程；错误目录或不可用 workspace 直接失败。
- 新增完整使用缺陷审计与 OCC 回归，覆盖自动路由、计划、任务板、Stop、恢复、会话启动和跨重启场景。

## Mobile 导航、设置与附件体验

- Android 与 iOS 共享资源继续保持字节一致；四域导航固定为“对话 / 代理团队 / 定时任务 / 我的”，并优先绑定权威 Agent Teams 画布和正式任务视图。
- “我的”直接复用官方 Settings 页面，不再创建重复占位表面；设置页挂载、异步打开、返回、页面隔离和加载/失败状态均按语义控件处理。
- 展开项目不会误关侧栏或抢占输入框焦点；对话详情状态滞后时，系统返回键可依据可见 composer 恢复正确层级。
- 附件图片预览按结构识别为全屏 lightbox，不再套用通用 bottom-sheet 几何；图片保持 viewport 内完整缩放，48px 关闭按钮可触摸，系统返回优先关闭预览且不依赖中英文按钮文本。
- 原生输入、附件选择/上传和 tool-result 图片交付继续接受有界数据与明确 MIME/来源，敏感输入及权限边界不变。

## 定时任务实现收敛

- 桌面启动时删除已退休的 `dsh-desktop-schedules` profile 副本和 patch 项，只保留一个官方 `@deepseek-ai/dsh-schedule` 入口。
- 清理过程保持原有第三方 patch 行、可重复执行，并把官方 replacement 状态显式返回给 Host。
- 既有 session-local schedule 工具合同继续可观察；普通创建、删除、列举和到期交付不因 UI 实现收敛而改变。

## 发布前门禁

正式发布必须在干净、已提交的精确 source revision 上重新完成：

- 全仓 `npm run verify` 与 `npm run verify:release`；
- 官方 alpha.3 dependency、capability artifact、patch composition、remote seam 和 hermetic acceptance；
- Agent Teams / Project 的任务、OCC、恢复、Stop、会话启动和 UI 契约；
- Android JVM 单元测试、iPhone/iPad 模拟器验证及 Android/iOS 共享资源一致性；
- `git diff --check`、版本身份、安全声明和发布合同。

正式制品仍只能由仓库唯一的 resumable publisher 从精确候选提交触发 GitHub Actions 云构建。发布器负责不可变 `v1.0.56` Tag、Windows/macOS/Linux 制品、签名 Android、签名生产组件、精确 18 项资产清单、GitHub→CNB 云到云镜像，并在两端验证完成后最后提升三个 stable feed；不得用本地打包或手工上传绕过任一阶段。

## 版本身份

- 桌面根包、lockfile 和 14 个随包插件：`1.0.56`
- Android：`versionName=1.0.56`、`versionCode=1005600`
- iOS/iPadOS 源码：`MARKETING_VERSION=1.0.56`、build `10056`
- 正式不可变 Tag：`v1.0.56`
- 已发布 `v1.0.55` 的 Tag、18 项资产、签名 APK、组件与 stable feed 保持不可变

## 获取更新

### Windows

打开 Harness Desktop 设置中的更新中心，点击“立即检查”，阅读更新说明后明确选择下载和安装。也可以从 GitHub Release 下载安装版或便携版。

### Android

下载 `Harness-Mobile-1.0.56-android-universal.apk` 及其 `.sha256`，核对摘要后由用户手动安装。若 Android 提示签名冲突，请不要强行覆盖来源不明的旧包。

### macOS 与 iPhone/iPad

macOS 提供 Intel 和 Apple Silicon 的 DMG/ZIP 预览包，当前仍采用明确无 Developer ID/公证契约并可能显示 Gatekeeper 提示。iPhone/iPad 不发布未签名 IPA，继续通过 Safari 工作台和“添加到主屏幕”使用。

## 下载与完整性

- GitHub Release：[v1.0.56](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.56)
- 永久最新版入口：[GitHub Releases / latest](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest)
- 桌面摘要：[SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.56/SHA256SUMS.txt)
- 组件摘要：[COMPONENT-SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.56/COMPONENT-SHA256SUMS.txt)

如果 GitHub 下载受限，可把同一文件名中的下载前缀换为 `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v1.0.56/`。GitHub 与 CNB 文件应具有相同大小和 SHA-256；不一致时不要运行该文件。
