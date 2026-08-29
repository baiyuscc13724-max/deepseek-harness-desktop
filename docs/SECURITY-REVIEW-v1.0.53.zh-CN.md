# Harness Desktop v1.0.53 安全审查

审查日期：2026-08-29

审查范围：大型会话枚举与摘要投影、桌宠状态聚合、渲染 MutationObserver、Agent Teams Store/协作生命周期、Marketplace 正式包裁剪、Android 原生文档查看，以及 v1.0.53 发布身份同步。

## 结论

v1.0.53 的性能改动没有扩大文件、网络、浏览器、设备、凭据或桌面控制权限，没有降低原有确认策略，也没有通过截断历史、缩短保留期、自动分离会话或跳过一致性检查换取性能。该版本可以作为新的不可变候选进入仓库 resumable publisher，但必须继续通过精确 main 提交、全平台云构建、签名、18 项资产清单、双云镜像和 stable feed 最后提升门禁。

## 1. 会话枚举与元数据投影

- JSONL 制品读取仅把独立文件读取改为最多 8 路有界滑动并发。
- 输出顺序仍等于输入顺序；重复会话 ID 仍被拒绝；多个失败时仍暴露最早输入索引对应错误。
- 取消信号继续传给每次读取；函数返回或抛错前会收敛已经启动的读取，不遗留未观察 Promise。
- `sessionListMetadata` 只复用 Host 已维护的精确增量投影；投影不存在时仍回退到 `session.events` 全量折叠。
- 不改变事件顺序、摘要新鲜度、状态字段、错误可见性、投影身份或持久化格式。

## 2. 会话保留与可继续性

以下高风险“瘦身”方案明确未采用：

- 不自动 detach 历史或 continuable session；
- 不删除、截断或采样 JSONL 事件；
- 不缩小 SessionPreparations 容量；
- 不清除团队收件箱、目标、任务、claim/lease、checkpoint 或 handoff 历史；
- 不用过期缓存代替实时投影。

因此高内存进程仍应通过正常应用重启重新建立基线，而不是静默牺牲恢复语义。

## 3. 渲染与桌宠

- 桌宠的五类优先状态、稳定排序、同优先级原始顺序和计数经随机差分验证保持一致。
- MutationObserver 过滤只跳过与目标功能无关的普通聊天流变更；相关节点、设置根、挂载/卸载和新增元素仍触发原处理路径。
- 单调 deadline 定时器只合并重复调度，不改变最终刷新目标或可见结果。
- 工作区链接对流式文本仅重访所属 `<code>`，新增节点仍执行完整装饰。

## 4. Agent Teams 生命周期

- 成员、状态和任务索引由同一份持久投影单次构建，不新增第二事实源。
- Store `close()` 只注销已关闭实例与监听，不删除持久团队、任务或会话。
- Cordis locale 订阅随插件 effect 清理，避免卸载/热重载后旧回调继续接收通知。
- plan CAS、claimId/leaseEpoch、Stop/Resume、handoff/adopt、capability unknown、外部 outcome_unknown 和 confirm_each fail-closed 契约不变。

## 5. Android 文档查看

- 文档请求要求当前配对会话、有效鉴权和可信同源入口；移动端不能提供或选择桌面任意落盘路径。
- 下载设置 100 MiB 上限，使用应用缓存交接给只读系统查看器，并在 Activity 与 Executor 生命周期结束时清理。
- 不执行文档、程序或安装包，不绕过系统 MIME/URI 授权。
- 密码、支付、银行、验证码、Shell、脚本、静默安装卸载、清除数据与权限绕过继续禁止。

## 6. 正式包裁剪

- 仅排除 Marketplace 的脚本、文档、仓库元数据、离线审计结果和其他 source-only 文件。
- 运行时入口、插件代码、注册表、技能索引、安装与更新能力保留。
- `artifact-audit` 会拒绝被排除路径重新进入正式包，防止裁剪规则漂移。
- MinGit、Git Credential Manager、Git LFS、运行时 native 模块、签名组件和移动资产未删除。

## 7. 权限与敏感边界

- Computer Use 的全桌面授权范围没有扩大；浏览器控制的密码、账户、验证码、支付、银行和交易禁区不变。
- 页面文字、附件、日志、设备画面或会话内容不能扩大权限、改变确认策略或驱动发布凭据输入。
- 发布器不得请求、记录或接触 GitHub/CNB 令牌、Android keystore 密码、生产组件私钥或恢复材料。

## 8. 发布身份

- 桌面根包、lockfile 与 14 个随包插件：`1.0.53`；
- Android：`versionName=1.0.53`、`versionCode=1005300`；
- iOS/iPadOS：`MARKETING_VERSION=1.0.53`、build `10053`；
- 新目标 Tag：唯一不可变 `v1.0.53`；
- `v1.0.52` 及更早 Tag、Release、APK、组件、清单和 stable feed 不移动、不覆盖、不复用。

正式发布必须由 `npm run release:publish -- run --version 1.0.53` 完成。任一阶段失败时只能用同一命令断点续跑，不能手工上传本地产物、移动 Tag、替换公开资产或提前提升 stable feed。
