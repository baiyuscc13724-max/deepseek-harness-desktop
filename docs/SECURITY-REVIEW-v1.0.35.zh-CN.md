# Harness Desktop v1.0.35 安全、权限与隐私审查

范围：启动与更新修复、设置/模型/会话/定时任务界面、右侧浏览器稳定性、代理团队项目入口、局域网与跨网络配对，以及既有不可变发布链。

## 当前结论

v1.0.35 不改变官方 Harness 主对话所有权，不增加任意脚本、凭据读取或绕过用户确认的写接口。完整源码测试与 npm 生产/开发依赖审计均通过；正式发布继续使用统一可恢复发布器、Windows 隔离安装/更新/卸载实测、GitHub 多平台矩阵、Android 长期证书、显式无签名 macOS 双架构包、组件签名、18 项清单和 CNB 云镜像。

## 启动、安装与更新

- Computer Use 插件只补齐既有 `systemPrompt` 与 `tools` 注入点，不扩大插件能力或改变权限确认。
- Inno Setup 在覆盖旧安装前请求关闭 Harness Desktop，且不自动重启应用，避免仍被进程占用的 DLL 被跳过或形成半更新状态。
- 更新器只对经过既有 HTTPS/可信来源/最大跳转次数策略核验的 Chromium redirect-cancel 情况重试；签名清单和 SHA-256 仍为强制条件，没有降级为不校验下载。
- 旧客户端继续读取兼容的顶层数组清单；stable feed 仍在本地安装、更新和卸载验证及双源资产核验完成后最后提升。

## 界面与会话

- 设置增强只重排现有选项，不补造 AI 参考图中不存在的设置项；模型页沿用现有服务商、子模型和额度接口，不在 renderer 读取 Provider Secret。
- 会话 ID 从顶栏移入会话菜单；置顶/未读仅保存最多 1000 个、单项最长 256 字符的本地 UI 状态，复制和新窗口协议仍由 Desktop Shell 限定处理。
- 浏览器可见状态去重，避免重复 IPC 触发开关；既有隔离分区、当前可见标签、站点授权与关键动作确认策略保持不变。

## 代理团队项目入口

- 本机建队仍使用项目 Authority 和加密状态存储；局域网入口自动生成项目 CA、TLS 1.3 服务端/客户端证书并要求双向认证和固定 ALPN。
- 一次性邀请、加入请求和批准响应绑定项目、Authority key、成员 grant 与双方 Ed25519/X25519 设备密钥。批准响应整体由 Authority 签名；其中局域网私钥、固定入口和中继房间再由 X25519 共享密钥派生的 AES-256-GCM 密文保护。
- 局域网不广播设备扫描；跨网络只接受无凭据的 WSS/443 盲中继，传输内容仍为有界、签名且端到端加密的项目包，中继无法读取正文。
- 私钥文件使用应用私有存储和原子写入；状态投影和页面不返回 PEM、设备私钥、邀请 HMAC secret 或 Provider 凭据。

## 供应链与发布

- 桌面、Desktop 插件、Android `versionCode 10035`/`versionName 1.0.35`、iOS build/marketing version和工作流目标同步到 1.0.35。
- Release 绑定单一干净提交和不可变 `v1.0.35` Tag；stable feed 只在本地更新下载/安装/卸载、GitHub/CNB 资产、签名组件和精确 18 项清单全部通过后最后提升。
- 第一次 CNB 阶段仍逐项镜像并校验全部 18 个不可变资产；stable 提升后的第二次同步只校验三份签名 feed，不重复下载资产。
- Android 继续只使用 Actions Secret 中长期 release 证书；macOS 完全沿用 v1.0.32 的显式无签名契约（`identity: null`、拒绝签名/公证输入）和 `安装.command`，未修改 Apple 助手或会员相关流程。

## 发布候选验证记录

- `npm run verify`、`npm run verify:release` 和 Windows 本地阶段必须由统一发布器通过。
- 安装版/便携版、打包后自检、真实更新下载/安装/卸载、GitHub 桌面矩阵、Android、组件、清单和 CNB 双源结果由 `.release-state/v1.0.35-publish.json` 原子记录；真实工作流和外部 URL 核验完成前不视为发布成功。
