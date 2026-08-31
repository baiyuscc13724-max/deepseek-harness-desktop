# Harness Desktop v1.0.56 安全审查

审查日期：2026-08-31
审查范围：官方 Harness `0.1.2-alpha.3` 依赖与 capability artifact 绑定、Agent Teams Stop/租约/OCC/恢复与顶层会话投递、Desktop Schedule 退休迁移、Mobile 设置/导航/附件 lightbox，以及 v1.0.56 的版本绑定发布证据。

## 审查结论与证据状态

v1.0.56 不通过放宽权限、忽略 stale revision、重放外部副作用、自动安装、保存敏感输入或复用旧签名资产来交换兼容性。本版继续要求：仅同一 exact live root、同一 canonical project、能力已验证、文件无冲突且 effect 全为 `none` 的连续计划可以自动推进；Stop、跨项目、未知能力、真实副作用、结果未知、不可逆操作、密码/支付/验证码和发布密钥仍由可信 Host 或直接用户处理。

本审查确认 **v1.0.56 的源码声明、版本身份和静态发布门禁已显式绑定当前维护目标**。这不是云端动态发布通过声明：本文不宣称 GitHub Actions、iPhone/iPad 模拟器、Windows 安装/卸载、Android 签名、生产组件签名、18 项资产镜像或 stable feed 提升已经完成。上述阶段必须由仓库唯一的 resumable publisher 在精确已提交 revision 上实际执行并留下状态证据。

## 1. 官方 alpha.3 供应链与兼容性边界

- 所有直接官方 DSH roots 必须精确等于 `0.1.2-alpha.3`；被移除的 root、意外直接 root、浮动版本、非 HTTPS lock source、缺失强 integrity 或 resolved/integrity 漂移均 fail closed。
- Session Controller、Chat、Conversation、Connection、Schedule、Turn Outline、Gateway 与 Remotes 的关键 runtime artifact 同时绑定精确 SHA-256 与最小语义 capability 片段；仅版本字符串相同不足以通过门禁。
- 已退休的 `@deepseek-ai/dsh-client-runtime` 不得因 Session Experience fallback 重新进入依赖或运行路径；timeline append 只接受明确允许的事件类型。
- 官方 Schedule 成为唯一 profile 入口。迁移只移除 Harness Desktop 自有的重复插件记录，保留其他 Cordis patch；重复执行必须无副作用。

## 2. Agent Teams 状态、授权与重放边界

- task claim/submission/release 继续绑定 claimId、leaseEpoch、task revision 和 pause epoch；`leaseEpoch=0` 是有效值而非缺失值，stale claim 不会因 UI 或反序列化退化为可操作状态。
- Stop 先推进 pause epoch，再处理并发或迟到提交；旧 epoch submission 不能提交、解锁依赖或重新激活已暂停工作。
- 强制退休必须原子清理 claim、写入释放历史并把未完成任务恢复为可审查 pending；退休占位或旧 receipt 不构成新授权。
- Root 破坏性任务命令使用 revision/CAS 和持久 request receipt。参数替换、state-only 请求、stale revision 与跨目标 replay 被拒绝；完全相同的已完成请求仅返回幂等收据。
- 外部 effect 状态变化推进 revision；`outcome_unknown` 只接受 Host 发行、短时、单用途且绑定 tool/root/turn/team/task/effect/attempt/outcome/epoch/revision/规范参数的授权。
- 顶层会话 waiter/outbox 与 wake scheduler 可跨重启恢复，但只对未确认投递继续；已确认 delivery 不会因恢复或重复请求再创建根会话。
- workspace 在投递前精确预检，验证后的 cwd 随持久记录传递；不存在、越界或歧义 workspace 均 fail closed。

## 3. Mobile、附件与输入边界

- “我的”页面只复用官方 Settings 语义表面；页面隔离只隐藏真正无关的 sibling surface，不会把设置页自身或其祖先隐藏、inert 化或从辅助技术树移除。
- 图片预览依赖结构而非本地化文本识别；全屏 mask、图片和关闭按钮具有独立样式，系统返回只触发可识别的预览 close control，不点击未知控件。
- Android 与 iOS 的 mobile runtime/CSS 必须字节一致。附件、tool-result 图片和原生输入保持大小、来源、MIME、生命周期与用户确认边界；密码、支付、银行、验证码和权限绕过禁区不变。

## 4. v1.0.56 版本绑定与发布约束

- `scripts/verify-static.mjs` 将本 v1.0.56 安全审查纳入必需发布文件；缺失即失败。
- 桌面根包、lockfile、14 个随包插件、Android `versionName/versionCode`、iOS `MARKETING_VERSION/build`、桌面移动路由、移动更新示例、README、CHANGELOG 和 release notes 必须一致指向 `1.0.56`。
- 已发布 `v1.0.55` 的 Tag、资产、摘要、签名 APK、组件与 stable feed 保持不可变；不得把旧资产重命名、覆盖或作为 v1.0.56 动态验收证据。

v1.0.56 只能使用：

```text
npm run release:publish -- run --version 1.0.56
```

发布器本地只执行源码/安全门禁并拒绝 dirty tree 与本地 `dist`；正式制品必须由 GitHub Actions 从精确候选 revision 构建。只有云端门禁与完整证据成功后，才能创建唯一不可变 Tag、发布签名 Android 和生产组件、验证 GitHub→CNB 云到云 18 项资产镜像，并最后提升 stable feed。任一阶段失败均不得手工上传、移动 Tag、覆盖旧资产或跳过摘要/签名/快照验证。
