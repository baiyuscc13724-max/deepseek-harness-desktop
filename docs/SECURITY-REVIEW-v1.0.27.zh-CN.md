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
- 修复极光模式侧栏 `backdrop-filter` 将官方固定设置弹窗困在侧栏的问题；语义选择器只在设置打开时移除 containing block，不依赖上游哈希类名。
- 界面模式双击后立即应用、关闭设置并在首页显示明确材质差异；顶栏隐藏入口不再留下空槽，中文界面统一使用“代理团队”。
- 桌面启动官方 Runtime 固定使用 `--no-open`，避免同时暴露一个缺少桌面隐私扩展的外部浏览器页。
- Renderer 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；官方 WebView 只允许本机 Harness Runtime。

## 权限与隐私边界

- Browser 使用独立分区；密码、Cookie、令牌、验证码、支付和银行内容不可由模型读取或输入，提交类动作逐次确认。
- Computer Use 只作用于 Harness Desktop 自身窗口并逐次确认；截图有会话级数量、大小和时效限制。
- 手机控制仅暴露固定动作；敏感输入、静默安装卸载、清除数据和权限绕过永久禁止。
- 本地记忆只允许有限稳定内容，敏感模式硬拒绝或脱敏；模型不能修改或删除记忆。
- 自动缓存维护只覆盖应用自有七天过期缓存，不触碰会话、附件、记忆、工作区和活动运行时；启动后每 24 小时重复维护，长期运行无需等到重启。
- 本地记忆库最多 1000 条，模型每次按需召回最多 8 条、单条返回正文最多 2000 字，不会把整库或缓存自动注入每轮对话。

## 供应链与发布

- 桌面版本、Android versionCode/versionName、iOS build/marketing version、Agent Teams 包版本和工作流目标同步到 1.0.27。
- Release 绑定单一干净提交和不可变 Tag；云端先创建 draft，重新下载精确资产集合并验 SHA-256 后才公开，同名资产不覆盖。
- Android 只由已有 Actions Secret 的长期 release 证书构建，并复核包名、版本、证书指纹和 `apksigner`。
- 生产组件继续使用内置单一 Ed25519 公钥、逐目标签名清单、组件 ZIP 文件索引、路径穿越/大小写冲突/解压上限检查和完整安装包兜底。
- CNB 只由云端从 GitHub 公开资产按大小和哈希镜像；本机不上传大型二进制。
- 密码、Token、Android keystore、组件私钥和恢复密钥不得进入 Git、聊天、日志或发布资产。

## 已完成验证

- `npm run verify`：静态门禁通过，387/387 桌面单元、安全、集成与发布自动化测试通过。
- `npm run verify:release`：不可变发布契约审计通过。
- 从最终 lock 冷执行完整 `npm ci` 成功安装 721 个包，自动应用 rc.8 受控补丁并按 Electron 43.2.0/x64 重建 `node-pty`；冷安装后再次 384/384 通过。
- `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org`：0 个已知漏洞。
- 隔离源码人工验收已确认窗口拖动、设置布局、顶栏间距、首页界面模式、代理团队中文和单一桌面窗口行为正常。

## 发布后外部验证

- GitHub `Build & Release Desktop`、正式 Android 和生产组件工作流均成功；公开 Release 为非 draft、非 prerelease，精确包含 18 个资产。
- GitHub 公开 Windows 安装版 SHA-256 为 `31f1f7b336e5f7f811561762d81c96df987d7203f4741f2f3f7bdfd5cc00358c`；真实隔离安装、1.0.25 升级标记保留、1.0.27 自检、卸载和原 HKCU 注册信息恢复全部成功。安装器未使用 Authenticode 证书，Windows 可能显示 SmartScreen 提示，信任依据为公开不可变 Tag、GitHub digest 和 SHA-256 校验文件。
- GitHub 公开便携版 SHA-256 为 `6e2e7e938e1b68048672a8c2745fafabb89cc3c0000a91f1a9fa9d28ea6d2313`；直接运行自检确认版本 1.0.27、Electron 43.2.0、官方核心 rc.8 和七项打包检查通过。
- 正式 APK SHA-256 为 `6b8eddfd85f81d94fedc4288551dd95cd9defbeff171bf1401a92f0092b42c3a`，长期证书 SHA-256 为 `092aea424b7e2edadd648967b7a9f909997fc028072532aea6cf459fcebf1c21`。
- 三个生产组件清单的 Ed25519 签名、组件 ZIP digest、完整包兜底 digest 和 `COMPONENT-SHA256SUMS.txt` 已独立复核；CNB Runner 从 GitHub 云端镜像并验证全部 18 个资产。
- CNB、GitHub 与仓库内三个稳定 feed 字节完全一致；真实在线更新检查确认 1.0.25 可直接选择 1.0.27 安装器，并保持 CNB 优先、GitHub 后备。
