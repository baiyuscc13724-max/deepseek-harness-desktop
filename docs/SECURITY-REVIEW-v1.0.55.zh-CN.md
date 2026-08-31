# Harness Desktop v1.0.55 安全审查

审查日期：2026-08-31  
审查范围：v1.0.54 已审查的 Agent Teams 持续授权与计划授权、接管/恢复/外部副作用 fencing、项目 secret custody、跨实例 replay/dedupe、模型密钥覆盖、会话性能补丁组合，以及 v1.0.55 的版本绑定发布证据。

## 审查结论与证据状态

v1.0.55 不以关闭输入、只读化密钥字段、取消外部副作用确认或扩大项目所有权来交换发布便利。v1.0.54 已记录的安全边界继续适用：仅同一 live root、同一 canonical project、能力已验证、文件无冲突且 effect 全为 `none` 的连续计划可自动推进；Stop、接管、跨项目、未知能力、真实副作用、结果未知、不可逆风险和目标歧义仍须可信 Host 或直接用户处理。

本审查确认 **v1.0.55 发布声明与静态门禁已绑定当前源码版本**。这不是动态发布门禁的通过声明：本文件创建时，云端构建、iPhone/iPad 模拟器、Windows 安装/卸载、Android 签名、生产组件签名、18 项资产镜像与 stable feed 提升均未由本文宣称完成。它们仍必须由仓库唯一的 resumable publisher 在精确提交上实际执行并记录结果。

## 1. 持续授权、接管与副作用边界

- 自动 recommit 仍同时要求 exact live root、active 未暂停团队、不变的 canonical project、全部 capability 已验证、无文件冲突、全部 effect 为 `none`、无 `outcome_unknown`，以及与 worker/`publishedAt` 或精确 member session、claimId、leaseEpoch 关联的可信执行证据。
- 新建团队、首次 bootstrap、Stop 后两阶段 Resume、handoff/adopt/recover、跨项目、文件冲突、unknown/unavailable capability、`idempotent`/`confirm_each`/`forbidden` effect、`outcome_unknown` 与不可逆或参数歧义操作不受持续授权覆盖。
- `resolve_unknown` 仍只接受 Host 发行、单用途、短时且绑定 tool/root/turn/team/task/effect/attempt/outcome/epoch/revision/参数摘要的 opaque authorization；Provider 缺失或重放均 fail closed。

## 2. 密钥、协作与性能边界

- 启动环境中的 secret 不读取、显示或改写；页面、Provider 设置、日志、审计和模型上下文只接触 credential ref，独立安全覆盖仍由 Host credential store 托管。
- 项目设备身份、E2EE 与 LAN 私钥仍通过 Host secret capability 进入安全存储；迁移只在安全存储写入成功后清理旧明文，失败或篡改拒绝继续。
- secure-channel receipt 继续持久化并绑定 authority epoch；协作 dedupe 在同一串行 mutation 中完成，重启、竞态和 TOCTOU 不能把已消费项重新放行。
- Conversation Work Tree、tool-result owner patch 与会话性能优化不扩大文件、浏览器、设备、网络或桌面控制权限；不支持的组合仍 fail closed。

## 3. v1.0.55 版本绑定与可复核性

- `scripts/verify-static.mjs` 将本 v1.0.55 安全审查纳入必需发布声明文件，缺失即失败。
- official alpha.2 migration 与 hermetic acceptance 的 hash-bound 输入必须记录当前已提交的 `package.json`、`package-lock.json`、静态门禁和 migration 测试精确 SHA-256；版本号或源代码漂移不得以宽松匹配、跳过或历史哈希冒充当前证据。
- 历史 alpha.2 安装 oracle 保持只读且与当前 plain-Windows fresh-install 假设分离；历史结果不能被描述为 v1.0.55 动态验收成功。

## 4. 正式发布约束

v1.0.55 只能使用：

```text
npm run release:publish -- run --version 1.0.55
```

发布器本地只执行源码/安全门禁并删除、拒绝 `dist`；正式制品必须由 GitHub Actions 从精确候选提交构建。只有实际云端门禁与完整证据成功后，才能创建唯一不可变 Tag、发布签名 Android 和生产组件、验证 GitHub→CNB 云到云 18 项资产镜像，并最后提升 stable feed。任一阶段失败均不得手工上传、移动 Tag、覆盖旧资产或跳过摘要/签名/快照验证。
