# Harness Desktop v1.0.40 安全、权限与隐私审查

范围：代理团队统一工作台及容量治理、内嵌浏览器的用户/模型来源隔离、主题与壁纸修复、DSH Plugin Marketplace 1.5.5、Linux Electron 沙箱测试门禁、会话体验小修，以及既有不可变发布链。

## 当前结论

v1.0.40 保留官方 Harness 对主对话、模型配置和 Provider 凭据的所有权。代理团队新增界面是现有 Team Runtime 的有界只读投影，不新增任意脚本执行、密钥读取或绕过用户确认的写接口；浏览器修复进一步收紧模型导航和下载来源。Linux 云端真实 Electron 测试显式恢复 Chromium 要求的 setuid sandbox 权限，不使用 `--no-sandbox` 降级。正式发布仍必须由统一可恢复发布器完成源码、Windows、GitHub 多平台、Android、组件签名、CNB 镜像和 stable feed 门禁；真实结果完成前，本审查不把候选版本描述为已发布。

## 代理团队工作台与规模边界

- 工作台继续位于原“代理团队”页面，Team Runtime、Broker、Memory、Scheduler 和本机/局域网/跨网络入口保持可用；任务板、画布、流程、定时任务、参与者与协调 Inbox 不建立第二套团队状态源。
- 任务板只投影当前选中团队并保持只读。响应式 1/2/4 列和列内滚动避免任务量挤压整页；每团队最多向 UI 投影 200 项，真实总数单独显示，未投影项仍保留在运行时和历史中。
- 画布提供 Fit、10%–200% 缩放、平移和键盘操作；节点、关系线和动画均有上限，`prefers-reduced-motion` 继续生效。隐藏页面会停止 UI 订阅，但不会停止运行中的团队。
- Team worker 的进程级准入为 8 个活跃槽、32 个全局等待、每个根 8 个等待及 30 秒超时；取消、Stop、团队关闭和运行 ID 变化都会释放或拒绝旧准入。该门禁只覆盖团队 worker，不声称已统一调度所有桌面 Provider/API 请求。
- 自动化页复用既有会话定时任务投影，不创建第二个 Scheduler；本版未实现项目级自动化。压力测试覆盖 12/24 个根、250 项任务、SSE 快照合并、慢客户端背压和会话隔离，但不据此宣称 10+ 会话可长期满负载无人值守。

## 人、AI 与多电脑交互

- 人对 AI 的目标仍从官方输入框进入；团队创建草稿不会自动发送。AI 对 AI 的分配、领取、依赖和中继均绑定 root、team、task、member 与 run ID，跨团队投递带有去重元数据。
- 人对人的项目协作入口与 Agent Teams 的执行视图分离，但不复制成员身份或任务状态。协调 Inbox 使用有界、可审计的投影，不暴露原始会话 ID、Provider 凭据或设备私钥。
- 多电脑目前只提供安全配对、加密连通和 presence 预览；没有跨电脑任务共同编辑、离线任务同步、冲突合并或自动唤醒承诺。局域网 mTLS、一次性邀请、X25519/AES-256-GCM 凭据保护与 WSS/443 盲中继边界不放宽。

## 内嵌浏览器

- 浏览器分区继续与官方 Harness 会话隔离。模型动作必须绑定当前可见标签、精确 origin、稳定 request ID 和有效控制代次；用户可信输入不会被模型合成事件降级或冒充。
- 点击、表单、重定向、`window.open`、下载与文件选择都携带来源证明并经过导航守卫。模型不能通过被点击页面、重定向目标或取消后的下载意图永久释放后续导航。
- 修改状态的动作串行执行；重复 request ID 只复用同一摘要绑定结果，冲突载荷拒绝。Stop 可绕过饱和队列，客户端断开或取消信号会阻止未开始的副作用。
- 密码、Cookie、Authorization、Token、银行卡、验证码和账户值仍禁止模型读写；上传、下载、提交、发布与删除继续需要精确载荷绑定的一次性用户确认。审计与诊断只保存有界、脱敏元数据。

## 主题、标题栏与壁纸

- 设置主题预览和官方客体面板只调整滚动所有权与文字布局，不增加 DOM 权限。Windows 标题栏按钮颜色由纯策略解析：显式深/浅模式固定对比色，系统模式跟随 `nativeTheme.shouldUseDarkColors`。
- Wallpaper Engine 只扫描已知 Steam 库和用户当前配置，路径需通过 containment、realpath 与 symlink 复核；scene、web 和 application 类型仍拒绝。
- 图片和视频在用户明确导入后复制到受管目录，受单项、总字节数、数量、临时文件和原子替换门禁约束。视频预览使用受管文件的有界 Range 响应；壁纸和对话内容不上传。

## 插件市场与供应链

- `dsh-plugin-marketplace` 固定到上游 v1.5.5 的不可变提交与 lockfile integrity。桌面只复制经过审计的运行时文件，并使用单一 patch 注册所有权，避免 bundle 与 profile 重复加载。
- 只有仓库来源匹配的可信旧版本可升级；来源缺失、畸形或冲突时 fail closed，不覆盖用户包、不注册、不启动运行时。可信的更高用户版本保留。
- Marketplace 保持在 ASAR 内，产物审计验证版本、仓库、运行文件、补丁、许可证和 packed-only 约束。dashi taskboard 的 Apache-2.0 完整许可证随包提供。
- `@deepseek-ai/cordis-plugin-group@1.0.1` 继续是根生产依赖；锁文件、产物审计和打包后自检共同防止旧版“Cannot find module”回归。

## Linux Electron 沙箱门禁

- GitHub Linux CI 与 Release 在运行真实 Electron 浏览器导航安全测试前，仅对当前 Runner 冷安装得到的 `node_modules/electron/dist/chrome-sandbox` 设置 `root:root` 所有权和 `4755` 权限，并立即用 `stat` 复核；任一步失败都会阻断测试和发布。
- 测试继续通过 `xvfb-run` 启动真实 Electron，并启用真实输入路径；没有增加 `--no-sandbox`、禁用 Chromium sandbox 或放宽浏览器导航策略。该 Runner 权限准备不读取用户数据，也不改变 Windows/macOS 或公开制品的权限模型。

## 发布与验证

- 桌面、全部随包插件、Android `versionCode 10040`/`versionName 1.0.40`、iOS build/marketing version、移动路由和发布工作流默认目标同步到 1.0.40。
- `release-manifest.json` 与三个 stable feed 在候选源码中继续指向上一健康版本；只有 GitHub/CNB 资产、签名组件和精确 18 项清单全部通过后，发布器才最后原子提升 stable feed。
- GitHub→CNB 大文件保持云到云，禁止本机上传发布二进制。Android 继续使用 Actions Secret 中的长期 release 证书；macOS 继续执行显式无签名、双架构 DMG/ZIP、`安装.command` 与结构自检契约。
- `npm run verify`、`npm run verify:release`、Windows 安装版/便携版、打包后自检、真实组件健康与回滚测试必须在同一干净提交上通过；随后发布器再创建不可变 `v1.0.40` Tag 并记录每个可恢复阶段。
