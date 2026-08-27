# Harness Desktop v1.0.51 安全审查

审查日期：2026-08-28

审查范围：Agent Teams 计划/任务/恢复状态机、桌面与 Mobile 任务投影、Android/iOS 共用移动运行时、Android 原生恢复与输入桥、Mobile 文档上传，以及 v1.0.51 发布身份同步。

## 1. 结论

v1.0.51 可以作为新的不可变候选进入仓库 resumable publisher，但必须继续满足以下条件：

1. 只从干净、已提交并能安全快进到 `main` 的精确源码提交发布。
2. 正式 Tag 只能是新的 `v1.0.51`；已发布 `v1.0.50` 及其资产、组件、APK 与 stable feed 不得移动、覆盖或复用。
3. 桌面包、Android APK、组件签名、18 项 release manifest、GitHub→CNB 云镜像和 stable feed 提升只能由统一发布器按固定阶段完成；本机 debug APK 与其他本地产物不得成为发布输入。
4. 当前没有可信 Host UI 签发 `host_verified` 的入口。模型工具参数只能形成 `human_attested`，因此依赖 `host_verified` 的 `confirm_each` 外部副作用必须继续 fail closed。
5. 任意网页、桌面 UI 或第三方操作不能获得通用 exactly-once 保证；出现 `outcome_unknown` 时，自动重试和任务完成必须停止，直到精确 direct-human root 明确解决。

审查未发现需要扩大 v1.0.50 Computer Use 权限的变更。v1.0.50 已审查的全桌面授权范围与 browser_control 独立硬边界保持原样，详见 [`SECURITY-REVIEW-v1.0.50.zh-CN.md`](SECURITY-REVIEW-v1.0.50.zh-CN.md)。

## 2. Agent Teams 信任边界

### 2.1 计划不是模型口头承诺

团队计划持久化为 `draft | committed | active`：

- 任务、依赖、文件边界、capability 或外部副作用等计划材料发生变化后，plan revision/hash 会更新并回到 `draft`。
- 新 claim 或公开 spawn 只接受与当前 canonical 投影一致的 revision/hash，且 `confirmed_plan_hash` 必须精确匹配。
- 没有已建立 worker 时，CAS commit 保持可观察的 `committed`；第一个成功 claim 或完整 child publication 才进入 `active`。
- 已存在 worker 或在途任务的安全 recommit 不会把执行中的 active 计划错误降级。
- 与当前 committed/active 计划完全一致的重放返回同一安全状态，不重复授权或伪造启动。

公开 `team_plan_commit` 的布尔字段来自模型工具调用，不是 Host 证明。其授权最多为：

- `human_attested`：直接用户根会话对精确 plan hash 的声明；
- `unknown`：没有可验证证据；
- `host_verified`：仅保留给未来注册过的 Host 私有证据路径，当前公共工具不能生成。

### 2.2 Spawn、claim 与 lease fencing

公开成员启动必须绑定至少一个已持久化任务。Host 在调用 continuable child 前原子保存：

- 成员占位和固定 parent；
- 任务预绑定；
- plan revision/hash；
- 启动意图与有界 attempt 记录。

成员 publication 或 work followup 失败时，系统区分“确定未发布”“已发布但后续失败”和“清理结果不确定”，不会无证据重复启动。

每个团队持久化 `pauseEpoch`；每次任务认领生成单调 `attempt`、随机 `claimId` 和当前 `leaseEpoch`。成员 complete、release、checkpoint 与外部副作用回写必须携带当前 fence。旧 claim、旧 lease、Stop 前 epoch 和其他迟到写入都会被拒绝；只有完全匹配的已持久化 receipt 可幂等收敛。

### 2.3 Checkpoint 不是 Host 事实

成员 checkpoint 和 next step：

- 永远持久化 `verified:false`；
- 保存有界文本、报告时间、报告者、原 claimId 与 leaseEpoch；
- 禁止注入权限、外部结果、路径、凭据、原始协调消息、百分比或其他 Host 字段；
- 不能完成任务、授予 capability 或解决 `outcome_unknown`；
- 在 release、下一次 claim、Stop、force-retire 和 adopt 后保留最后一份恢复上下文，直到新的合法持有者明确覆盖。

保留旧 fence/报告者的目的仅是审计来源；新持有者不能用旧 checkpoint 获得旧 lease 权限。

### 2.4 Stop 与 Resume

直接用户 Stop 的顺序是：

1. 持久化新的 `pauseEpoch` 与暂停门禁；
2. 取消团队产生的排队唤醒；
3. 隔离迟到 start；
4. 中断已知成员；
5. 把需要恢复的在途任务安全放回 pending，同时保留未验证 checkpoint。

Resume 分为 preview 与 CAS commit。receipt 绑定 `requestId + previewId + pauseEpoch + teamRevision`；相同请求可幂等重放，陈旧预览拒绝。Resume 只提交恢复决定，不自动唤醒或投递成员；失败节点不会冻结健康节点。

### 2.5 Capability 与外部副作用

Capability 默认 `unknown`。模型不能用批量布尔把它升级为 verified；明确 `unavailable` 的 capability 会阻止执行。

外部副作用策略固定为：

- `none`：没有外部副作用；
- `idempotent`：仅表示相应工具参与了明确幂等协议；
- `confirm_each`：每次执行需要可信 Host 验证；
- `forbidden`：禁止执行。

Effect identity 只由 Host 使用 team/task/effect 的稳定材料派生，公共 schema 不接受调用者提供的 key。`outcome_unknown` 阻止重试与完成；解决路径要求精确 direct-human root。普通 UI 点击、网页提交、第三方 API 或跨系统动作不因此获得 exactly-once 声明。

## 3. Handoff / Adopt 审查

团队接管只允许：

- 源与目标都是当前存活的最外层 root；
- 团队已持久暂停；
- 双方本地根规范化后得到相同 canonical project identity；
- 目标提供短期、单次 handoff token；
- 调用来自 direct-human root。

Adopt 会递增 `pauseEpoch`、撤销全部旧 claim/lease、把旧 lead/worker 退休为审计身份、释放未完成任务并保留 attempt/interruption/checkpoint 历史。旧 child 不会被伪装成 reparent，也不会自动 wake。

Canonical `projectKey` 与 handoff `tokenHash` 只保存在 durable store。公开团队投影会删除 `projectKey` 和私有 handoff 对象；公开 ownership history 只包含事件类型、源/目标 root、时间与 pause epoch；handoff 结果只返回调用方需要的单次 token，不返回 project hash 或 token hash。动态回归测试同时验证私有审计字段仍存在、公开结果不存在对应键名。

## 4. 旧存储迁移

Store schema 升级为 v5，并保持非破坏迁移：

- 空团队或没有 worker 的旧团队进入 `draft + legacy_unplanned`；
- 已有在途 worker/任务的团队保持旧执行，进入 `active + legacy_active_gate`；
- legacy gate 阻止新的 claim/spawn，直到 direct-human root 按当前 canonical 计划 recommit；
- 既有成员、任务状态、排序、结果与审计历史不会因迁移被伪造或删除。

迁移重放稳定；存储继续拒绝未知字段和非法状态组合。

## 5. 任务板与公开投影

桌面和 Mobile 只使用 Ready / Running / Attention / Done 四个主区，Cancelled 进入历史。界面不再展示模型估算百分比、随机 pulse 或虚假 progressbar。

Attention 仅来自可核对状态：依赖阻塞/失败、capability unknown、权限未证实、外部 outcome unknown、文件冲突、陈旧 lease、成员失败或部分 publication。成员 checkpoint/next step 均带“未验证”标签。

Mobile 首屏的“需要确认什么 / 卡在哪里 / 下一步做什么”只总结 Host 投影；成员建议不会变成权限、计划或完成事实。Android/iOS 共用资源逐字节一致，并覆盖可见键盘焦点、Android 48dp / iOS 44pt 触控基线、非纯颜色状态、文本放大、减少动态效果、安全区和无横向滚动。

## 6. Mobile APP 安全审查

### 6.1 项目与导航身份

四域导航、系统/边缘返回、首页、项目/会话上下文和设置入口只走版本化原生桥或权威语义控件。项目、会话、团队和任务使用稳定 ID；同名项目不会合并或按显示文字猜测身份。

### 6.2 Android 前台与 IME

Android 回到前台时不再人工派发网页 `online`/`focus` 事件，也不重复注入 runtime。网络、焦点与页面生命周期继续由真实 WebView/系统事件驱动，避免草稿、滚动、IME 或页面状态被伪造或清空。系统返回与边缘返回共用固定协议，避免双重派发。

### 6.3 原生输入与权限

相册、拍摄、语音与文件仍使用固定原生动作和系统选择器：

- 不申请广泛媒体/外部存储读取权限；
- 语音输入委托系统识别器，不申请应用自身录音权限；
- 相机使用受限 FileProvider 临时 URI，并在成功、取消和异常后清理；
- 文件只保留完成官方附件接收所需的临时读取授权；
- 截图提示不读取截图像素。

### 6.4 文档上传

移动文档上传满足以下边界：

- 只有已配对设备通过 cookie 鉴权后才能访问上传路由；
- 只接受 POST，且必须带固定 intent header；
- session ID 与文件名有长度和字符边界；
- 请求体上限 50 MiB，空文件拒绝；
- 上游调用有超时、禁止重定向、`no-store` 与有界 JSON 响应；
- 只转发到官方 `/api/desktop-files/upload`，由 live root 提供权威 workspace cwd；
- 手机不能提交或决定桌面本地落盘路径；
- 返回值经过固定 schema 清洗，不回传原始路径、任意响应或上游错误正文。

## 7. 本地隔离验证证据

在未安装 APK、未升级或重启当前 Harness Desktop 的隔离工作树中完成：

- Agent Teams 目标套件：128/128 通过；
- Mobile 目标套件：119/119 通过；
- 全仓 `npm run verify`：1540 通过、0 失败、2 跳过；
- `npm run verify:release`：通过；
- Android `testDebugUnitTest + lintDebug + assembleDebug`：50 个任务成功；
- Android/iOS `mobile-runtime.js` 与 `mobile-compat.css`：合并后 SHA-256 成对一致；
- 核心/客户端/移动 JS 语法检查与 `git diff --check`：通过。

上述本地证据不替代正式发布器的云端 Windows/macOS/Linux 构建、iOS 模拟器、Windows 安装/卸载、Android 长期证书签名、组件签名、18 项资产和双云验证。隔离阶段没有把 debug APK 安装到设备，也没有用本机二进制作为发布输入。

## 8. 版本与剩余边界

- 桌面与 14 个随包插件：`1.0.51`；
- Android：`versionName=1.0.51`、`versionCode=1005100`；
- iOS/iPadOS 源码：`MARKETING_VERSION=1.0.51`、build `10051`；
- 目标不可变 Tag：`v1.0.51`。

剩余边界：

1. 当前没有 Host UI token 签发链，因此 `host_verified` 不可由模型获得；这是 fail-closed 设计，不是待模型绕过的缺口。
2. 真正的进程崩溃、双 live root 竞争、第三方 effect receipt 和签名 APK 真机行为仍需依赖 Host/云端/设备证据；单元测试不能伪装成这些外部事实。
3. iPhone/iPad 在没有 Apple Developer 会员时继续走模拟器门禁与 Safari“添加到主屏幕”，不发布未签名 IPA。
4. 正式发布必须由 `npm run release:publish -- run --version 1.0.51` 完成并以同一命令断点续跑；任何阶段失败都不得手工跳过、移动 Tag、替换资产或提前提升 stable feed。
