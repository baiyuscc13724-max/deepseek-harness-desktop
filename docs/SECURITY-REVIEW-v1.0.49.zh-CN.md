# Harness Desktop v1.0.49 安全、权限与隐私审查

范围：Android 原生 P2P 协商期间的 WSS/SOCKS 后备启动时序、Computer Use 指示与结构化优先路由、Agent Teams 完成结果持久化和用户投影，以及完整 `1.0.49` 发布身份。

## 当前结论

v1.0.49 没有扩大设备、relay、Computer Use、浏览器、文件、Shell、账户、支付、银行、验证码、签名材料或发布凭据权限。P2P 修复只提前开放既有端到端加密后备线路；Computer Use 修复收紧结构化工具优先级；Agent Teams 只把匹配成员运行的最终文本结果以有界形式保存并展示给当前本地项目用户。

已发布 `v1.0.48` 的 Tag、精确 18 项资产、签名 APK 与组件保持不可变。v1.0.49 使用新的 Tag、资产、摘要和 stable 提升，不移动、不覆盖、不复用历史发布。

## P2P 与 WSS 后备启动顺序

- Android 检测到原生 P2P 能力后立即开放既有加密 WSS/SOCKS route，WebRTC offer/answer/ICE 协商继续在后台进行；这消除可用性等待，不改变配对身份、房间密钥或 tunnel/session key。
- relay 仍只承担受限信令和端到端加密帧盲转发，不持有明文或端到端密钥；连接、来源、房间、帧大小、速率、队列和 backpressure 上限不变。
- v2 切换前继续关闭 legacy streams；方向、peer、session AAD、双 nonce、4096 包重放窗口、nonce/path rebinding 拒绝和降级防护均保持不变。
- 原生 P2P 协商失败或受网络限制时继续使用同一受认证后备通道，不增加 TURN 凭据、广泛网络监听或新 Android 权限。

## Computer Use 指示与路由

- 控制指示器移除无限 opacity pulse 和整页 backdrop filter；重复状态同步幂等，导航后注入 CSS 原子替换，避免先删除再插入造成闪烁。视觉变化不参与授权判定，也不能授予或延长控制。
- Computer Use 明确是无结构化通道时的最后后备。文件和仓库使用固定文件/Git 工具，网页优先 browser_control 的 CDP/DOM 引用，手机优先 android_control；可用结构化通道不得退回桌面截图坐标操作。
- 本次/永久授权仍只能由可信 Host 卡授予；插件不能自授权。Esc 停止、外部窗口精确目标绑定、会话控制状态以及浏览器对密码、账户、验证码、支付和银行输入的硬限制均未放宽。

## Agent Teams 结果持久化与用户可见性

- 只有与结束生命周期事件中的成员、团队和本次运行相匹配，且任务已经进入 `completed` 的记录才可附加结果；其他成员、过期运行或未完成任务不能写入该任务成果。
- 输入仅取最终助手消息的文本块，按顺序合并并限制为最多 12,000 个字符；非文本块、原始 tool event、session id、内部协调载荷和其他结构化消息不会进入持久结果或 UI 投影。
- 结果记录只包含 `text`、`reportedAt` 和 `truncated`，随团队任务存入本地有界 store；schema 1–3 加法迁移到 schema 4，不把旧的内部消息反向推断为成果。
- 已完成任务卡片、看板、侧栏和任务详情只渲染经过上述规范化的文本。任务重开、停止回退或清除终态元数据时同步删除旧结果，避免历史成果覆盖新一轮任务。
- 这项变更使当前本地项目用户能够看到此前仅负责人收到的成员最终报告，但不会向远端、其他团队或无权限项目额外广播内容。

## 版本与正式发布门禁

- 根 package/lock、14 个随包插件、Android、iOS/iPadOS、桌面移动路由、移动更新示例和发布工作流默认值全部绑定 `1.0.49`。
- Android `versionCode=1004900` 高于 `1.0.48.99`；完整三段版本的正式 APK 放入 `v1.0.49`。iOS marketing version 为 `1.0.49`、build code 为 `10049`，没有 Apple Developer 会员时继续只做模拟器验证并使用 Safari/添加到主屏幕。
- `v1.0.48..v1.0.49` 的产品源码范围包含 PR #25、#26、#31。PR #27 未合并，其主分支记录只是独立签名 Preview feed promotion，不把未合并文档提交带入产品源码。
- 正式 Tag 只在干净、已提交、快进 `main` 且精确 main CI 成功的源上创建。发布器删除并拒绝本地 `dist`；所有桌面、Android 与组件正式制品来自 GitHub Actions。
- GitHub 与 CNB 必须分别回读精确 18 项不可变资产、大小和摘要；三个 Ed25519 stable feed 最后提升。同版本不同摘要、Tag 漂移、资产替换、旧版本覆盖或本地二进制上传全部失败关闭。
