# Harness Desktop v1.0.32 安全、权限与隐私审查

范围：本版本新增的统一右侧工作区、文件/文档预览、会话级已安排任务、上下文压缩恢复、手机同步端口分配，以及既有不可变发布链。

## 当前结论

v1.0.32 不改变官方 Harness 主对话所有权，不增加任意脚本、凭据读取或直接调度写接口。正式发布仍完全复用仓库既有统一发布器、Windows 本地更新实测、GitHub 多平台矩阵、Android 长期证书、显式无签名 macOS 双架构包、组件签名、18 项清单与 CNB 云镜像流程。

## 统一右侧工作区

- 官方 Web 工作台继续作为唯一主界面；右侧工作区属于 Desktop renderer，只复用现有隔离浏览器 `persist:harness-side-browser`，不复制第二套聊天或模型配置。
- 普通网页仍进入隔离浏览器；OAuth/SSO、安装包和下载意图继续走既有系统浏览器策略，危险 scheme 与凭据输入仍被拒绝。
- Shell 只通过固定 IPC 读取当前活动 root session 的 files/schedules GET 资源；Runtime URL 必须是无凭据 loopback HTTP，响应大小和超时有硬上限。
- 工作区文件预览复用 realpath/containment 校验；本机文档必须由用户点击，拒绝网络路径，只允许文本/代码扩展名，读取上限 1 MiB，二进制不渲染，内容仅写入 `textContent`。

## 已安排任务

- 任务状态仍来源于官方 `schedule/change` 日志；Desktop 页面只读 GET snapshot，不提供 POST mutation。
- 创建、停用和重新创建均只调用官方 `inputActions.setDraft`，不会自动 submit/send；固定频率最短 300 秒，会话关闭后不唤醒系统。
- 当前官方 schedule 后端没有 pause/resume，因此界面明确把“停用”实现为待确认删除草稿，把恢复实现为待确认重新创建草稿，不伪造原生暂停能力。

## 上下文压缩与手机同步

- Desktop 压缩插件继承官方 compaction durable mutation；服务端确认 `CONTEXT_WINDOW_EXCEEDED` 后，仅在完整工具调用配对边界压缩，surface generation 确认前进后才重试原请求。
- 摘要请求自身溢出时最多有限次数缩小旧的完整消息前缀；取消信号优先，无法收敛时停止并给出人工恢复提示，不进行无限请求重放。
- 插件在 Runtime 启动前安装并投影到托管 preset；投影失败不再静默启动一个没有压缩能力的 Runtime。
- 手机同步端口分配拒绝浏览器规范永久禁用端口；配对令牌、一次性 Cookie、设备撤销和 loopback 控制约束保持不变。

## 供应链与发布

- 桌面、Desktop 插件、Android `versionCode 10032`/`versionName 1.0.32`、iOS build/marketing version及工作流目标同步到 1.0.32。
- Release 绑定单一干净提交和不可变 `v1.0.32` Tag；stable feed 只在本地更新下载/安装实测、GitHub/CNB 资产、签名组件和精确 18 项清单全部通过后最后提升。
- Android 继续只使用 Actions Secret 中长期 release 证书；macOS 完全沿用 v1.0.31 的显式无签名契约（`identity: null`、拒绝签名/公证输入）和 `安装.command`，不修改 Apple 发布策略。
- 私钥、keystore、密码、Token 和 Provider 凭据不进入 Git、聊天、日志或发布资产。

## 发布候选验证记录

- `npm run verify`、`npm run verify:release` 和 Windows 本地阶段必须由统一发布器通过。
- 安装版/便携版、打包后自检、真实更新下载与安装、GitHub 桌面矩阵、Android、组件、清单和 CNB 双源结果由 `.release-state/v1.0.32-publish.json` 原子记录；真实工作流完成前不视为发布成功。
