# Harness Desktop v1.0.27 安全、权限与隐私审查

审查日期：2026-08-20。范围：官方 Harness rc.8 升级、桌面主进程/预加载、运行时补丁删减、Agent Teams、窗口拖动、移动同步、更新下载、生产组件协议和不可变发布链。

## 当前结论

源码升级阶段未发现需要绕过安全边界的问题。正式发布仍必须通过干净提交、本地源码与发布审计、Windows 真实打包自检、GitHub 多平台矩阵、Android 长期证书、远端资产 SHA-256 复核和组件 Ed25519 验签；任何一步失败均不得宣称完成。

## 官方 rc.8 优先原则

- 官方运行时固定为 `0.1.0-rc.8`，lock 中不允许混入 rc.7。
- 图文 `/goal`/`/plan`、文件和会话 `@` 引用、图片载荷控制、Claude Code/Codex Profile Bundle、持久 PowerShell、并发 `web_search` 和子代理 `reportDelivery` 直接采用官方实现。
- 已删除桌面壳旧的非图片附件路径注入、附件检查 IPC、拖放提示改写、历史图片降级和消息载荷改写，不再维护第二套附件或模态判断。
- Agent Teams 只提供官方尚未覆盖的固定负责人、可恢复独立成员、共享依赖任务、鉴权消息和文件冲突提示；默认关闭并限制团队、成员和并发数量。
- rc.8 公告说明 SQLite 存储结构不兼容。桌面清理逻辑继续永久排除 sessions、attachments、workspace、memories 和当前 runtime；发布说明明确建议升级前备份 HarnessData。

## 本次桌面修复

- 最大化窗口拖动不再在 `unmaximize()` 后立即读取可能仍为最大化状态的瞬时边界；先读取 `getNormalBounds()`，再按真实正常尺寸恢复并移动。
- 新增异步取消最大化回归测试，覆盖普通拖动、最大化恢复和 Linux 禁用路径。
- Renderer 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；官方 WebView 只允许本机 Harness Runtime。

## 权限与隐私边界

- Browser 使用独立分区；密码、Cookie、令牌、验证码、支付和银行内容不可由模型读取或输入，提交类动作逐次确认。
- Computer Use 只作用于 Harness Desktop 自身窗口并逐次确认；截图有会话级数量、大小和时效限制。
- 手机控制仅暴露固定动作；敏感输入、静默安装卸载、清除数据和权限绕过永久禁止。
- 本地记忆只允许有限稳定内容，敏感模式硬拒绝或脱敏；模型不能修改或删除记忆。
- 自动缓存维护只覆盖应用自有过期缓存，不触碰会话、附件、记忆、工作区和活动运行时。

## 供应链与发布

- 桌面版本、Android versionCode/versionName、iOS build/marketing version、Agent Teams 包版本和工作流目标同步到 1.0.27。
- Release 绑定单一干净提交和不可变 Tag；云端先创建 draft，重新下载精确资产集合并验 SHA-256 后才公开，同名资产不覆盖。
- Android 只由已有 Actions Secret 的长期 release 证书构建，并复核包名、版本、证书指纹和 `apksigner`。
- 生产组件继续使用内置单一 Ed25519 公钥、逐目标签名清单、组件 ZIP 文件索引、路径穿越/大小写冲突/解压上限检查和完整安装包兜底。
- CNB 只由云端从 GitHub 公开资产按大小和哈希镜像；本机不上传大型二进制。
- 密码、Token、Android keystore、组件私钥和恢复密钥不得进入 Git、聊天、日志或发布资产。

## 已完成验证

- `npm run verify`：静态门禁通过，384/384 桌面单元、安全、集成与发布自动化测试通过。
- `npm run verify:release`：不可变发布契约审计通过。
- 从最终 lock 冷执行完整 `npm ci` 成功安装 721 个包，自动应用 rc.8 受控补丁并按 Electron 43.2.0/x64 重建 `node-pty`；冷安装后再次 384/384 通过。
- `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org`：0 个已知漏洞。

## 待发布门禁

- Windows 安装版、便携版、打包后自检与真实组件健康/回滚结果。
- GitHub Actions Windows/macOS/Linux、iPhone/iPad 模拟器和正式 Android 结果。
- GitHub/CNB 公开资产、SHA-256、组件签名和三个稳定 feed 的外部验证。
