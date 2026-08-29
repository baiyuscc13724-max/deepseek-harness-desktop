# Harness Desktop v1.0.54 安全审查

审查日期：2026-08-29  
审查范围：Agent Teams 自动续作与计划授权、接管/恢复/外部副作用 fencing、项目 secret custody、跨实例 replay/dedupe、模型密钥覆盖、会话性能补丁组合、安装后工作区与正式发布门禁。

## 结论

v1.0.54 没有通过关闭输入、把密钥字段改成只读、取消外部副作用确认或扩大项目所有权来换取“安全”。本版本把项目内普通自动驾驶与真实高风险边界分开：满足同一 root、同一项目、能力已验证、文件无冲突且 effect 全为 `none` 的续作可以自动推进；Stop、接管、跨项目、未知能力、真实副作用、结果未知、不可逆风险和目标歧义仍需可信 Host 或直接用户处理。

模型设置不会读取启动环境中的 secret 值，但允许用户在原密码字段直接输入独立安全覆盖。Provider 设置、日志、审计和模型上下文只接触 credential ref，不接触原始密钥。

在本地动态门禁全部通过后，v1.0.54 可以进入仓库唯一的 resumable publisher。正式安全判断仍绑定精确 main SHA、全平台云构建、iPhone/iPad 模拟器、Windows 安装/卸载、Android 长期证书、生产组件签名、18 项资产清单、GitHub→CNB 云镜像和 stable feed 最后提升；任一阶段失败都不能手工上传或移动 Tag。

## 1. Agent Teams 持续授权

### 允许自动继续的条件

自动计划 recommit 只接受以下同时成立的条件：

- 调用者是 exact live root，团队为 active 且未暂停；
- canonical project 未改变；
- 所需 capability 已验证，没有 unknown/unavailable 项；
- 文件范围无冲突；
- 所有外部 effect 均为 `none`，没有 `outcome_unknown`；
- 路由成本属于默认 AI 选择的 main/subagent 范围；
- 已存在可信执行证据：当前活跃 worker、成功发布后的 `publishedAt`，或与历史 member session、claimId、leaseEpoch 精确绑定的 submission/result/checkpoint。

checkpoint、重复 claim、release→reclaim、complete→reopen、同目标修复/复测和无歧义重规划不再把计划无条件退回 draft，也不会要求用户每轮重复发送“继续”。仅有 retired/provisioning/failed 占位、曾经是 root、或缺少精确 claim/lease 的历史记录不能建立授权。

### 保留的硬门禁

以下操作不被持续授权覆盖：

- 新建团队与首次 bootstrap；
- 显式 Stop 后的两阶段 Resume；
- handoff、adopt、recover 与所有权变化；
- 跨项目、文件冲突、unknown/unavailable capability；
- `idempotent`、`confirm_each`、`forbidden` 等真实外部 effect；
- `outcome_unknown`；
- 不可逆动作或目标/参数存在实质歧义。

持续授权只记录为 `human_attested`，模型输入不能批量升级为 `host_verified`。

## 2. 接管与外部副作用授权

- accepted-completed 任务的 acceptance 增加 owner epoch 绑定；团队 adopt 后继续验证原 ownership history，不篡改 `acceptedBy`。
- adopt 增加 pause epoch 并使旧 claim/lease 失效，旧 claimant 不能在新所有权下继续提交。
- `resolve_unknown` 只接受 Host provider 发行的 opaque authorization id。
- 单用途授权绑定 tool、root session、turn、team、task、effect、当前 attempt、目标 outcome、pauseEpoch、team revision 与 canonical 参数摘要，TTL 不超过两分钟。
- 授权先消费再进入 domain mutation，防止并发重放；跨工具、跨回合、替换参数、替换 outcome、过期、revision/epoch 漂移与重复消费全部 fail closed。
- Provider 未注入时功能拒绝执行，普通用户消息或布尔标记不能冒充 Host 授权。

## 3. 项目秘密托管

- 项目设备身份、E2EE 密钥与 LAN 私钥经 Host secret capability 进入系统安全存储；普通 profile 只保存不敏感引用和公开信息。
- 旧 profile 迁移在安全存储写入成功后才清理明文；能力缺失、写入失败或篡改时拒绝继续，不把 secret 回退写回普通 JSON。
- 受管引用和 Host provider 都有动态装配测试；项目入口扫描确保 secret 值不进入配置、日志、审计输出或发布资产。
- profile 恢复路径只恢复允许的公开/引用字段，不把生成目录中的历史 secret 重新带回活动 profile。

## 4. 跨实例 replay 与协作去重

- secure channel 的 packet/command receipt 持久化、有界并绑定 authority epoch，重启后仍拒绝已消费数据包。
- receipt 容量、TTL 与冲突语义有动态测试；过期清理不能让仍在有效窗口内的包重新可用。
- collaboration same-dedupe 的存在性检查与 Inbox 追加在同一串行 mutation 中完成，两个服务实例并发提交同一 dedupe key 只产生一个持久结果。
- 调用方不再承担非幂等去重责任，崩溃/重启和 TOCTOU 竞态均由服务端门禁处理。

## 5. 模型密钥覆盖

### 保密边界

- 启动环境中的 secret 不被读取、显示或改写。
- 页面与 Provider 设置仅持有 credential ref；原始密钥只进入 Host credential store。
- 审计、日志、测试输出与模型上下文都不得包含原始 secret。
- 环境引用不会被误当作页面可删除凭据。

### 可用性

- 环境来源为只读时，原密码字段仍允许直接输入/粘贴；首字符创建 `HARNESS_DESKTOP_<PROVIDER>_API_KEY` 隔离覆盖。
- DeepSeek `credentialOnly`、OpenAI、Codex、custom/pi-ai 与 inheritance/fallback 均有行为测试。
- 修改覆盖使用同一受管引用；删除 custom Provider 会调用真实 `credentials.unset` 清理页面托管引用。
- 恢复环境来源先删除 settings 引用，再 unset 覆盖；unset 失败时使用返回的最新 revision 补偿重绑仍存在的引用，避免普通单故障留下不可达 secret。
- 如果 unset 与补偿同时失败，错误保持可见、编辑器保持可重试。用户在重试前强制终止应用仍存在跨 settings/credentials 两域无原子事务时的极低概率残余风险；本版本没有用“禁用编辑”掩盖该风险。
- UI 使用原生 label/`htmlFor`、稳定 id、`type=password`、`autocomplete=new-password`、持续双语帮助和至少 44px 的相关操作目标；没有 paste blocker。

## 6. 性能补丁的安全组合

- Conversation Work Tree 对长对话采用有界批次和已选调用优先级，不删除、截断或改写历史节点。
- memoization 绑定 node-store 内容快照，而不是只看可变容器引用，避免展示陈旧节点。
- tool-result owner patch 只接受精确 flat、raw grouped 与 `workTreeItems + renderedNodeKeys` 变体；完整补丁幂等，任一 sessionId 转发缺失或混合漂移均 fail closed。
- 会话列表、持久化、observer 和右侧工作区优化没有扩大文件、浏览器、设备、网络或桌面控制权限。
- 合成性能 fixture 使用隔离 profile，不读取或修改真实用户会话。

## 7. 验证证据

提交前已完成：

- `npm run verify`：1714 pass、0 fail、4 skip（1718 total）；
- Agent Teams：159 pass、0 fail、2 个环境门禁 skip；
- 模型密钥专项：28/28；
- tool-result/conversation 组合：6/6；
- artifact-fixture 工作区 smoke：2/2；
- P1 release-blocking 动态矩阵：11/11；
- 性能门禁：synthetic 3/3、production 31/31；
- `npm run verify:release`、`git diff --check`：通过。

首次全仓回归曾因性能补丁把 `item.nodeKeys` 改为 `renderedNodeKeys` 而触发 owner patch 的真实组合失败。该失败没有被豁免；实现改为精确变体集合，并补充 raw、performance、flat、idempotence 与 partial-negative 动态测试后才重新放行。

## 8. 正式发布约束

- v1.0.53 Tag、18 项资产、签名 APK、组件与 stable feed 永不移动、覆盖或复用。
- v1.0.54 只能使用 `npm run release:publish -- run --version 1.0.54`。
- 发布器本地只执行源码/安全门禁并删除、拒绝 `dist`；正式制品全部由 GitHub Actions 从精确 main SHA 构建。
- 只有桌面矩阵、iPhone/iPad 模拟器和全部云端证据成功后才能创建唯一不可变 Tag。
- Android 必须使用长期 release 证书；生产组件必须由 Actions Secret 中的 Ed25519 私钥签名。
- CNB 只允许 GitHub→CNB 云到云镜像，本机不得上传 EXE、DMG、ZIP、APK。
- stable feed 必须在 GitHub/CNB 两端 18 项不可变资产和签名 manifest 全部验证后最后提升。
