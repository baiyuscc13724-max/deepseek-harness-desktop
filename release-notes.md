# Harness Desktop 1.0.47

## 桌面工作台、终端与 Skills

- 新增桌面集成终端，支持固定 PowerShell、CMD、Git Bash、WSL 与系统默认 shell；仅人工桌面壳可调用，终端数量与输入大小有界，不向模型工具开放任意 Shell 或脚本旁路。
- 补齐 Codex 风格输入体验：`@` 用于文件引用，`$` 用于 Skill 触发；随包安装受管 Skills，并保留用户自有同名 Skill，不静默覆盖。
- 新增默认关闭的 Codex image bridge。启用后仍固定本机可执行文件、参数、环境与输出目录，限制提示词、参考图、超时及输出大小，并校验图片魔数、尺寸、宽高比后才写入 Harness 附件库。
- 修复 Electron sandbox 中 guest preload 加载相对模块失败、导致“Harness Desktop 工作区选择窗口不可用”的问题；preload 现在只加载 Electron，并通过回归测试及真实 sandbox 启动探针验证。

## Computer Use、浏览器与 PR Preview

- Computer Use 与右栏浏览器控制共用同一可信宿主授权状态；“本次授权 / 永久授权 / 拒绝”仍只能由宿主卡决定，插件不能自行扩大权限。
- 桌面控制期间显示持续可见的蓝色控制指示和光标位置，并支持全局 Esc 立即停止；浏览器控制继续禁止密码、账户、验证码、支付和银行敏感输入。
- 随包浏览器插件增加工作台客户端能力、明确的打开浏览器意图与受管 Skills 注入；右栏仍使用隔离 Profile 和有界网页工具，不把页面内容当成可信指令。
- 修复 PR Preview 配置初始化误用状态存储 API 导致入口错误禁用的问题；受保护 Preview 的无密钥构建、默认分支签名、真实更新/重启/回滚门禁及 Required Reviewer promotion 契约保持不变。

## Agent Teams 生命周期

- 统一显式 Stop 后的内存暂停门与持久化状态，状态查询、任务认领、恢复、UI 和 SSE 都投影同一有效生命周期。
- 增加 Stop/Resume pause epoch，丢弃暂停前或暂停期间排队的旧生命周期事件，防止成员被“幽灵复活”为运行中。
- 暂停期间禁止新增成员、Bootstrap 扩张、项目权限操作和后台协作唤醒；Resume 只生成恢复计划，不自动唤醒成员。
- 失败或停止未确认的成员保留真实状态并拒绝继续认领；崩溃后遗留的 `closing` 团队可以继续收敛，关闭时释放未完成任务并保留已完成审计历史。

## Android、iPhone/iPad 与移动同步

- 完成 Android 移动工作台重构，改进响应式布局、照片发送、输入法与输入框体验，并保留固定动作、敏感输入禁止和二次确认边界。
- 已配对 Android 可通过经过认证、单请求并发限制的移动接口请求桌面原生工作区选择；普通网页和未配对设备不能调用。
- 桌面二维码与移动更新示例统一指向完整 `v1.0.47` Release。iPhone/iPad 继续通过 Safari/添加到主屏幕使用实时工作台，不提供无法公开安装的未签名 IPA。

## 版本、构建与完整性

- 桌面、14 个随包插件、Android 与 iOS/iPadOS 源码统一到 `1.0.47`；iOS build code 为 `10047`，Android 单调 `versionCode` 为 `1004700`，高于 `1.0.46.x` 独立修订版。
- 完整发布 Android workflow 与源码共同使用同一版本编码器，避免新 APK 因内部版本码倒退而无法覆盖安装；三段完整版本发布到 `v1.0.47`，四段独立 Android 修订版仍使用 `android-v<version>`。
- 已发布 `v1.0.46`、其精确 18 项资产、稳定 feed、组件以及 `android-v1.0.46.1` 全部保持不可变，不移动、不覆盖、不复用。
- 统一可恢复发布器仍是唯一正式入口：锁定 SHA 的 GitHub Actions 构建全部正式二进制，CNB 只从 GitHub 云到云镜像；两云精确资产回读通过后，三个签名 stable feed 才最后提升。
