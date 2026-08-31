# Harness Desktop 1.0.55

v1.0.55 是一次面向 Agent Teams 自动驾驶、安全授权、模型密钥可用性、Android 配对可靠性和长会话响应速度的正式更新。它修复了普通项目内续作反复要求用户发送“继续”的问题，恢复了环境密钥场景下直接输入安全覆盖的能力，并修复 v1.0.53 Android 正式 APK 扫码配对后由 WebRTC JNI 混淆触发的原生闪退，同时保留真实外部副作用和不可逆操作的硬门禁。

本版本不会静默替用户安装。桌面端只有在用户于更新中心明确点击更新/安装后才会切换版本；Android 仍必须由用户手动安装长期证书签名的 APK。

## 官方 Harness alpha.2 维护迁移（发布前硬门禁）

- 官方运行时维护依赖已从历史 `0.1.1-rc.2` 原子迁移到精确 `0.1.2-alpha.2`：20 个直接 DSH roots、861 个 lock locations、216 个 DSH locations / 215 个唯一包名。执行时重新查询的官方 tag 为 `dsh-v0.1.2-alpha.2`，ref 为 `0a53fb55bea101816fa226bb964ae2bed71c343b`；npm 的 `alpha` dist-tag 同样指向 `0.1.2-alpha.2`，而 `latest`/`next` 仍是 `0.1.1-rc.2`，因此产品始终使用精确 pin，不以浮动 tag 取代它。
- alpha.2 已移除 `@deepseek-ai/dsh-client-runtime` 和 `@deepseek-ai/dsh-host-apiproxy`。旧补丁入口已退休；New Session、SessionManager/list baseline 与 workspace force-new 已按公开 Session Controller、native session-list 和 `startSession` owners 重基。首次 patch 精确改变 25 个文件，第二次为 0 差异、0 byte delta。
- **RPC wire 合同**：桌面、Mobile 与桌宠生产客户端只发出固定 `workspace/...` / `session/...` slash endpoints 和 descriptor-shaped 参数；Workspace 只消费 `workspace/follow` baseline frames，Session 只消费 snapshot/cursor projection frames；generated strict descriptor 或 codec 漂移一律 fail closed。
- 自研 Project/Team、canonical-project 隔离、submission acceptance ledger、routing receipts、locks、recovery、cursors 与 evidence 继续是唯一 authoritative 数据面。官方 experimental Team 不接管，也不进行 schema 或状态双写。
- 历史 rc.2/NO-GO/`runtimeEquivalent=false` 审计仍可追溯，但已被当前维护迁移证据取代，不能作为本版运行时或发布状态的描述。尚未执行的 hermetic 终验、完整矩阵和 Root fresh-review ACK 仍是发布前硬门禁；本说明不把它们写成已通过，也不声明未产生的最终计数。

## Agent Teams 自动驾驶不再反复打断

- 同一 exact live root、同一 canonical project、团队 active 且未暂停，且 capability 已验证、文件无冲突、外部 effect 全为 `none` 时，修复、复测、checkpoint、reclaim、reopen 和无歧义重规划可沿既定目标自动继续。
- 默认 AI 选择的 main/subagent 路由属于普通授权范围，不会因为 main-tier 成员或全员已退休而额外索要“继续”。
- 新运行以成功发布后的 `publishedAt` 保留持续授权；旧团队只接受与 member session、claimId、leaseEpoch 精确绑定的历史执行收据，retired/failed 占位本身不能伪造授权。
- 新建团队、显式 Stop 后 Resume、handoff/adopt/recover、未知能力、文件冲突、跨项目或所有权扩张、真实外部副作用、`outcome_unknown`、不可逆风险和目标歧义仍然硬性停止。
- 持续授权保持 `human_attested`，绝不会被模型升级成 `host_verified`。

## Agent Teams P1 安全与持久化整改

- accepted-completed 团队接管继续把 acceptance 绑定到原负责人 epoch；adopt 不篡改 `acceptedBy`，旧 claim/lease 在新 pause epoch 下失效。
- `resolve_unknown` 改用 Host 发行、短时效、单用途授权，绑定 root、turn、team/task/effect、attempt、outcome、pauseEpoch、team revision 和规范化参数摘要；替换参数、过期、跨回合、跨工具与重放全部拒绝。
- 项目设备、E2EE 与 LAN 私钥通过 Host secret capability 和系统安全存储桥接；profile 只保留不敏感引用，迁移、篡改、能力不可用和落盘泄露都有动态门禁。
- 安全信道 receipt 具备持久化、重启和容量语义；same-dedupe 的检查与 Inbox 追加进入同一串行 mutation，双实例竞态不再依赖调用方自行规避。
- 打包版首次启动从真实的版本化 runtime cache复制 Agent Teams 依赖，避免对 `app.asar` 虚拟目录递归复制；修复 Windows 在 `preparing-runtime` 阶段退出、APP 无法打开的问题。

## 环境密钥可直接输入安全覆盖

- 启动环境中的 Provider secret 仍不可读取、显示或回写；设置和审计层只保存 credential ref，不保存原始密钥。
- 原密码字段现在可直接键入或粘贴。输入第一个字符即创建隔离的 `HARNESS_DESKTOP_<PROVIDER>_API_KEY` 覆盖，不需要额外开启“自定义密钥”。
- 支持覆盖的新增、修改、删除和“恢复环境来源”；恢复失败会按最新 settings revision 补偿重绑仍存在的覆盖，避免普通单故障留下孤儿引用。
- 删除自定义 Provider 会清理页面托管的普通或 `HARNESS_DESKTOP_*` 凭据引用，但不会把环境引用误当作可删除 secret。
- 字段使用原生 label、稳定 id、密码掩码、`autocomplete=new-password`、持续帮助文本和不小于 44px 的输入/恢复/删除/确认目标；没有粘贴拦截。

## Android 扫码配对不再触发原生闪退

- 修复 v1.0.53 正式 APK 在 R8 混淆后改名 WebRTC / jni_zero JNI 绑定，导致扫码启动 P2P 时 `libjingle_peerconnection_so.so` 于 `JNI_OnLoad` 触发 `SIGTRAP` 的问题。
- Release shrinker 现在保持 `org.webrtc.**`、`org.jni_zero.**` 及其注解元数据；正式 `assembleRelease` 额外解析 R8 mapping，若 `PeerConnectionFactory.initialize`、`NativeLibrary.initialize` 或 `JniInit` 被改名会直接阻断构建。
- 覆盖安装修正版即可继续使用原有加密配对配置，不要求清除 App 数据或重新读取二维码中的敏感字段。

## 长会话与工作区性能门禁

- 大型消息树投影基准由约 150.828 ms 降至 1.128 ms；折叠的 4,000 步对话不再急切渲染全部前缀，首批固定为 64 项，并优先保证深层已选调用可达。
- 会话字段投影基准由约 113.540 ms 降至 0.436 ms；160 个会话制品由约 2,457.747 ms 降至 279.330 ms。
- 会话列表、会话持久化、Conversation Work Tree、Session Experience 生命周期、renderer observer 和右侧工作区进入同一双层门禁。
- 最终合成 Electron 场景覆盖 8 个会话、每个 1,200 条逻辑消息、180 次切换和 120 次滚动：switch p95 9.5 ms、最长 long task 91 ms、无保留堆增长、listener cleanup 回到 0。该结果表示预算通过，不把不同场景的时序差异包装成绝对性能承诺。
- 会话性能补丁与 tool-result owner/session 补丁精确支持 raw、flat 及 `workTreeItems + renderedNodeKeys` 组合；完整组合幂等，任一半补丁继续 fail closed。

## 验证与发布前硬门禁

当前维护迁移已具备独立的 alpha.2 dependency/patch receipts，但最终 hermetic 终验尚未执行；因此不会复用历史 rc.2/候选报告中的 `6/6`、旧摘要或测试总数来宣称当前发布通过。发布前必须重新在干净、隔离的来源与依赖快照上完成并记录：

- 20 个精确 alpha.2 roots、861 个 lock locations、216 / 215 DSH locations/unique names，以及 removed-package=0、resolved/integrity drift=0；
- detached install、patch 首次 25 文件 / 第二次 0 差异的可重跑证据；
- submission/acceptance、routing、canonical project/Team isolation、locks/recovery/cursors/evidence 与官方 seam 的完整 hermetic 矩阵；
- 相关静态、发布说明和链接合同，以及 `git diff --check`；
- Root 对完整 evidence、源摘要与计数的 fresh-review ACK。

通过上述硬门禁后，正式发布仍只能由仓库唯一的 resumable publisher 从精确 main 提交执行全平台 GitHub Actions 构建、iPhone/iPad 模拟器验证、Windows 安装/卸载与打包自检、Android 长期证书签名、生产组件签名、精确 18 项资产清单、GitHub→CNB 云到云镜像，并在所有不可变资产就绪后才提升三个 stable feed。

## 版本身份

- 桌面根包、lockfile 和 14 个随包插件：`1.0.55`
- Android：`versionName=1.0.55`、`versionCode=1005400`
- iOS/iPadOS 源码：`MARKETING_VERSION=1.0.55`、build `10054`
- 正式不可变 Tag：`v1.0.55`
- 已发布 `v1.0.53` 的 Tag、18 项资产、签名 APK、组件与 stable feed 保持不可变

## 获取更新

### Windows

打开 Harness Desktop 设置中的更新中心，点击“立即检查”，阅读更新说明后明确选择下载和安装。也可以从 GitHub Release 下载安装版或便携版。

### Android

下载 `Harness-Mobile-1.0.55-android-universal.apk` 及其 `.sha256`，核对摘要后由用户手动安装。若 Android 提示签名冲突，请不要强行覆盖来源不明的旧包。

### macOS 与 iPhone/iPad

macOS 提供 Intel 和 Apple Silicon 的 DMG/ZIP 预览包，当前仍采用明确无 Developer ID/公证契约并可能显示 Gatekeeper 提示。iPhone/iPad 不发布未签名 IPA，继续通过 Safari 工作台和“添加到主屏幕”使用。

## 下载与完整性

- GitHub Release：[v1.0.55](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/tag/v1.0.55)
- 永久最新版入口：[GitHub Releases / latest](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/latest)
- 桌面摘要：[SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.55/SHA256SUMS.txt)
- 组件摘要：[COMPONENT-SHA256SUMS.txt](https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases/download/v1.0.55/COMPONENT-SHA256SUMS.txt)

如果 GitHub 下载受限，可把同一文件名中的下载前缀换为 `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v1.0.55/`。GitHub 与 CNB 文件应具有相同大小和 SHA-256；不一致时不要运行该文件。
