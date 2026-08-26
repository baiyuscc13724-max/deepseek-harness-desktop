# Harness Desktop v1.0.47 安全、权限与隐私审查

范围：桌面集成终端、Codex 风格 Skills 与默认关闭的 image bridge、共享 Computer Use/浏览器授权、移动端工作区选择、Agent Teams Stop/Resume 生命周期、工作区选择 preload 修复，以及完整 `1.0.47` 发布与 Android 单调版本机制。

## 当前结论

v1.0.47 的新增能力没有把任意 Shell、脚本、密码、支付、银行、账户、验证码、私钥、签名材料或未经边界校验的文件访问暴露给模型或网页。所有正式二进制仍由锁定源 SHA 的 GitHub Actions 构建；CNB 只执行 GitHub→CNB 云到云镜像。

已发布 `v1.0.46`、其精确 18 项资产/稳定 feed/组件以及 `android-v1.0.46.1` 保持不可变。v1.0.47 使用新的 Tag、资产与摘要，不移动、不替换、不复用历史发布。

## 集成终端与 Electron 边界

- PTY 服务仅注册给可信桌面壳 IPC，WebView、普通网页和模型工具不能直接调用。shell 只能从固定的 PowerShell、CMD、Git Bash、WSL 与系统默认项选择，不接受调用方提供可执行文件、任意参数或环境。
- 每个会话限制同时存在的终端数量和单次输入字节数；终端关闭、窗口销毁和应用退出都会收敛资源。Computer Use 与浏览器工具仍不暴露 Shell 或脚本动作。
- guest preload 在 Electron sandbox 内只加载 `electron`；浏览器打开意图验证已内联为无文件依赖逻辑，避免相对 `require` 使整个 preload 提前中止。原生工作区选择仍由主进程验证来源、窗口和路径。
- preload API 保持窄接口，Renderer 与 WebView 不获得 Node.js、文件系统或任意 IPC 能力。

## Computer Use 与浏览器控制

- Computer Use 和右栏浏览器共享同一 Host 授权与启停状态；session/permanent scope 只能在可信宿主授权卡选择，插件卡只能请求授权、查询、停止或撤销，不能自行授权。
- 授权控制期间显示不可由网页隐藏的桌面蓝色指示层和位置反馈，全局 Esc 可立即停止共享会话。
- browser_control 继续永久拒绝密码、支付、银行、账户和验证码等敏感输入；登录、支付、转账类步骤必须由用户在桌面浏览器亲自完成。
- 浏览器 observe、extract、console、network 与页面对话框内容都视为不可信数据，不得改变工具授权、确认策略或文件边界。

## Skills 与 Codex image bridge

- 随包 Skills 安装使用受管标记，只更新 Harness Desktop 自己管理的副本；发现未标记的用户同名目录时跳过，不静默覆盖。
- Codex image bridge 默认关闭。启用配置要求绝对 Codex 可执行文件、Codex home 和输出目录，schema 拒绝未知字段；调用方不能选择 argv、环境、沙箱模式、权限覆盖或任意输出路径。
- 生成与编辑只接受有界文本和工作区内受支持参考图；输出必须位于配置目录，满足大小上限，并通过 PNG/JPEG/WebP/GIF 魔数、尺寸与宽高比检查后才进入 Harness 附件存储。
- 子进程 stdout/stderr、超时、提示词和文件数量均有上限；失败输出不会作为有效附件返回。

## 移动端工作区选择与同步

- 已配对 Android 的工作区选择请求必须通过现有移动认证 cookie、固定 intent header、POST 路由和一次仅一个请求的并发门；未配对客户端、普通网页及跨来源请求不能使用。
- 实际选择窗口仍由桌面主进程拥有，用户必须在原生窗口中亲自选择；手机不能直接传入或猜测任意本机目录。
- Android 控制保持固定动作 allowlist；密码、支付、银行、验证码、清除数据、静默安装卸载与权限绕过持续禁止，文本输入、文件写入和缓存清理仍需手机端二次确认。
- WSS 中继继续只盲转发端到端加密帧，不持有 tunnel key 或内容；局域网服务和 SOCKS/Web 代理保持 loopback 与有界资源限制。

## Agent Teams 生命周期

- 显式 UI Stop 立即建立内存暂停门，再异步收敛持久化状态；即使第一次持久化失败，状态、任务认领、UI 和 SSE 仍投影为 paused，后续 Resume 先修复持久状态再生成恢复计划。
- Stop/Resume pause epoch 使暂停前或暂停期间排队的成员 start/end 生命周期事件失效，旧事件不能把 paused 团队或成员重新标记为 running。
- paused 团队拒绝新建成员、Bootstrap、任务认领、项目权限操作、自动协作唤醒和后台继续；Resume 不自动唤醒任何成员。
- failed、shutdown-unconfirmed 或 stop-unconfirmed 成员保留失败证据并拒绝继续操作。关闭中崩溃的团队保留 `closing`，可在确认存活状态后继续收敛；未完成任务被释放，已完成任务和审计历史不重写。
- 协作 inbox 使用 pause epoch 绑定目标状态；暂停时不唤醒，跨显式恢复的旧请求变为 stale，不能被重放。

## 版本与正式发布门禁

- 根 package/lock、14 个随包插件、Android、iOS/iPadOS、桌面移动路由和移动更新示例全部绑定 `1.0.47`。
- Android `versionCode=1004700` 使用与独立四段修订版相同的单调编码器，高于 `1.0.46.99`；完整三段版本的 APK 放入 `v1.0.47`，只有四段独立修订版使用 `android-v<version>`。
- iOS marketing version 为 `1.0.47`、build code 为 `10047`；无 Apple Developer 会员时只做模拟器验证和 Safari/添加到主屏幕工作台，不发布未签名 IPA。
- 正式 Tag 只在干净、已提交、快进 `main` 的源上创建。发布器删除并拒绝本地 `dist`，所有桌面/Android/组件正式制品都来自 GitHub Actions。
- GitHub 与 CNB 必须分别回读精确 18 项不可变资产、大小与摘要；三个 Ed25519 stable feed 最后提升。同版本不同摘要、Tag 漂移、资产替换或历史覆盖全部失败关闭。
